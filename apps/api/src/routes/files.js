import { z } from "zod";
import { Readable } from "node:stream";
import { zipEnFlux } from "../zip.js";
import { createHash, randomBytes } from "node:crypto";
import { prisma, serialize } from "../db.js";
import { creerJeton, lireJeton } from "../etatPartage.js";
import { authenticate, hashPassword } from "../auth.js";
import { basePublique } from "../espacePublic.js";
import { journaliser } from "../audit.js";
import { consommerQuota, ecrireOuNettoyer, piloteEcriture, piloteLecture } from "../storage.js";
import { typeDeFlux, typeNeutralise } from "../mimetype.js";

const folderSchema = z.object({
  name: z.string().min(1).max(255),
  parentId: z.string().nullable().optional(),
});

/// Rétention de la corbeille. Passé ce délai, un élément supprimé est
/// purgé pour de bon au premier passage sur la corbeille.
const RETENTION_JOURS = 30;

/// Vérifie qu'un nœud appartient bien à l'espace de travail appelant.
/// Sans ce garde-fou, un id deviné donnerait accès aux fichiers d'un autre client.
/// Un élément à la corbeille n'est pas « trouvé » : il ne se liste pas, ne
/// se télécharge pas, et n'accepte pas de nouvel enfant.
const findOwned = (tenantId, id) =>
  prisma.fsNode.findFirst({ where: { id, tenantId, deletedAt: null } });

/// Tout le sous-arbre d'un nœud, lui compris.
///
/// `vivantsSeulement` sert à la mise à la corbeille : un enfant déjà
/// supprimé auparavant garde sa propre entrée de corbeille au lieu d'être
/// absorbé par celle du parent — sans quoi le restaurer séparément
/// deviendrait impossible.
const collectSubtree = async (tenantId, node, { vivantsSeulement = false } = {}) => {
  const out = [node];
  const walk = async (parentId) => {
    const children = await prisma.fsNode.findMany({
      where: { tenantId, parentId, ...(vivantsSeulement ? { deletedAt: null } : {}) },
    });
    for (const child of children) {
      out.push(child);
      if (child.type === "FOLDER") await walk(child.id);
    }
  };
  if (node.type === "FOLDER") await walk(node.id);
  return out;
};

/// Efface définitivement un groupe de nœuds : lignes, octets, quota.
/// La cascade Prisma retire les descendants, d'où la suppression de la
/// seule racine — mais le quota et le stockage se règlent sur tout le lot.
const purgerGroupe = async (tenantId, racine, tous) => {
  // Les versions précédentes partent avec le fichier : leurs octets aussi.
  const versions = await prisma.versionFichier.findMany({
    where: { tenantId, nodeId: { in: tous.map((n) => n.id) } },
  });
  const liberes =
    tous.reduce((somme, n) => somme + n.size, 0n) + versions.reduce((somme, v) => somme + v.size, 0n);

  await prisma.$transaction(async (tx) => {
    await tx.fsNode.delete({ where: { id: racine.id } });
    if (liberes > 0n) {
      await tx.tenant.update({
        where: { id: tenantId },
        data: { usedBytes: { decrement: liberes } },
      });
    }
  });

  for (const n of [...tous, ...versions]) {
    if (n.storageKey) await (await piloteLecture(n.storage, tenantId)).remove(n.storageKey);
  }

  return liberes;
};

/// Versions d'un fichier au-delà de la limite : les plus anciennes partent,
/// octets et quota compris.
const VERSIONS_MAX = 10;
const elaguerVersions = async (tenantId, nodeId) => {
  const enTrop = await prisma.versionFichier.findMany({
    where: { tenantId, nodeId },
    orderBy: { creeLe: "desc" },
    skip: VERSIONS_MAX,
  });
  if (!enTrop.length) return;
  const liberes = enTrop.reduce((s, v) => s + v.size, 0n);
  await prisma.$transaction(async (tx) => {
    await tx.versionFichier.deleteMany({ where: { id: { in: enTrop.map((v) => v.id) } } });
    if (liberes > 0n) await tx.tenant.update({ where: { id: tenantId }, data: { usedBytes: { decrement: liberes } } });
  });
  for (const v of enTrop) await (await piloteLecture(v.storage, tenantId)).remove(v.storageKey).catch(() => {});
};

/// Purge paresseuse : pas de tâche planifiée, on nettoie ce qui a dépassé
/// la rétention au moment où quelqu'un ouvre la corbeille.
const purgerExpirés = async (tenantId) => {
  const limite = new Date(Date.now() - RETENTION_JOURS * 24 * 60 * 60 * 1000);
  const expirés = await prisma.fsNode.findMany({
    where: { tenantId, deletedAt: { lt: limite } },
  });

  // Seules les racines de suppression : leurs descendants partent en cascade.
  for (const racine of expirés.filter((n) => n.trashId === n.id)) {
    await purgerGroupe(tenantId, racine, await collectSubtree(tenantId, racine));
  }
};

/// Un nom libre dans le dossier visé — « rapport.pdf » devient
/// « rapport (2).pdf » si la place a été reprise depuis la suppression.
const nomLibre = async (tenantId, parentId, nom) => {
  const pris = new Set(
    (
      await prisma.fsNode.findMany({
        where: { tenantId, parentId, deletedAt: null },
        select: { name: true },
      })
    ).map((n) => n.name),
  );
  if (!pris.has(nom)) return nom;

  const point = nom.lastIndexOf(".");
  const base = point > 0 ? nom.slice(0, point) : nom;
  const ext = point > 0 ? nom.slice(point) : "";
  for (let i = 2; ; i++) {
    const essai = `${base} (${i})${ext}`;
    if (!pris.has(essai)) return essai;
  }
};

// ---------------------------------------------------------------------------
// Liens de lecture en flux
// ---------------------------------------------------------------------------
//
// Une balise <video> ne sait pas envoyer d'en-tête `Authorization` : elle
// émet la requête elle-même. Il faut donc que l'URL porte l'autorisation.
//
// On n'y met pas le jeton de session, ni même un JWT : un jeton **opaque**,
// c'est-à-dire une chaîne aléatoire sans contenu, associée en mémoire à un
// seul fichier et à une échéance. Rien à déchiffrer s'il fuite, révocable,
// et court — un JWT dépassait la longueur maximale d'un paramètre d'URL
// acceptée par Fastify (100 caractères), ce qui renvoyait « 414 URI Too
// Long » et faisait échouer la lecture.
//
// Les jetons vivent en base (voir src/etatPartage.js) : n'importe quelle
// instance de l'API reconnaît un lien créé par une autre.

const LIEN_DUREE_MS = 2 * 60 * 60 * 1000;

const creerLien = (fid, tid) => creerJeton("flux", tid, fid, LIEN_DUREE_MS);

const lireLien = async (jeton) => {
  const j = await lireJeton("flux", jeton);
  return j ? { fid: j.cible, tid: j.tenantId } : null;
};

export default async function fileRoutes(app) {
  app.addHook("preHandler", async (request, reply) => {
    // La lecture en flux ne peut pas porter d'en-tête `Authorization` :
    // c'est la balise <video> du navigateur qui émet la requête, et elle
    // ne sait pas en ajouter. Cette route s'authentifie donc par un jeton
    // d'URL dédié, à courte durée de vie et limité à un seul fichier —
    // jamais le jeton de session, qui n'a rien à faire dans une URL.
    if (request.raw.url?.startsWith("/api/files/stream/")) return;
    return authenticate(request, reply);
  });

  /// Consommation et quota de l'espace de travail.
  app.get("/usage", async (request) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: request.tenantId } });
    return serialize({
      quota: tenant.quota,
      usedBytes: tenant.usedBytes,
      availableBytes: tenant.quota - tenant.usedBytes,
    });
  });

  /// Contenu d'un dossier. Sans parentId, on liste la racine.
  app.get("/", async (request) => {
    const parentId = request.query.parentId || null;

    const nodes = await prisma.fsNode.findMany({
      where: { tenantId: request.tenantId, parentId, deletedAt: null },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      // De quoi signaler d'un coup d'œil un fichier partagé publiquement ou
      // qui a des versions précédentes.
      include: { _count: { select: { versions: true, partages: { where: { revoqueLe: null, expireLe: { gt: new Date() } } } } } },
    });

    return serialize(nodes.map(({ _count, ...n }) => ({ ...n, nbVersions: _count.versions, nbPartages: _count.partages })));
  });

  /// Contenu de la corbeille : uniquement ce que l'utilisateur a
  /// explicitement supprimé, pas les descendants partis avec.
  /// Tous les nœuds vivants de l'espace, à plat.
  ///
  /// L'Explorateur descend dossier par dossier, ce qui est juste pour lui :
  /// on y navigue. Un éditeur de code, non — on y cherche. « Ouvrir un
  /// fichier par son nom » et « chercher dans tout le projet » ont besoin
  /// de l'arborescence entière, et la reconstituer par un appel par dossier
  /// coûterait une requête par niveau, en cascade, à chaque frappe.
  ///
  /// Volontairement maigre : ni contenu, ni dates, ni auteurs. De quoi
  /// afficher un arbre et filtrer par nom, rien de plus. Quelques milliers
  /// de fichiers tiennent ainsi dans quelques dizaines de kilo-octets.
  ///
  /// Plafonné : au-delà, c'est que l'espace sert de dépôt de fichiers et
  /// non de projet, et l'ouverture rapide n'est plus le bon outil. Le
  /// client est prévenu par `complet: false` plutôt que de recevoir une
  /// liste tronquée en silence.
  const ARBRE_MAX = 5000;

  app.get("/arborescence", async (request) => {
    const nodes = await prisma.fsNode.findMany({
      where: { tenantId: request.tenantId, deletedAt: null },
      select: { id: true, name: true, type: true, parentId: true, size: true, mimeType: true, updatedAt: true, createdAt: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      take: ARBRE_MAX + 1,
    });

    return serialize({
      complet: nodes.length <= ARBRE_MAX,
      noeuds: nodes.slice(0, ARBRE_MAX),
    });
  });

  app.get("/trash", async (request) => {
    await purgerExpirés(request.tenantId);

    const nodes = await prisma.fsNode.findMany({
      where: { tenantId: request.tenantId, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
    });

    return serialize(nodes.filter((n) => n.trashId === n.id));
  });

  app.post("/folder", async (request, reply) => {
    const parsed = folderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Nom de dossier invalide" });
    }
    const { name, parentId = null } = parsed.data;

    if (parentId && !(await findOwned(request.tenantId, parentId))) {
      return reply.code(404).send({ error: "Dossier parent introuvable" });
    }

    try {
      const node = await prisma.fsNode.create({
        data: {
          tenantId: request.tenantId,
          ownerId: request.user.id,
          parentId,
          name,
          type: "FOLDER",
        },
      });
      await journaliser(request, "dossier.creation", node.name);
      return reply.code(201).send(serialize(node));
    } catch (err) {
      if (err.code === "P2002") {
        return reply.code(409).send({ error: "Un élément porte déjà ce nom ici" });
      }
      throw err;
    }
  });

  /// Envoi d'un fichier. Le quota est vérifié avant écriture, puis
  /// la consommation est incrémentée dans la même transaction que la
  /// création du nœud — sinon un envoi concurrent fausserait le compteur.
  app.post("/upload", async (request, reply) => {
    const upload = await request.file();
    if (!upload) {
      return reply.code(400).send({ error: "Aucun fichier reçu" });
    }

    const parentId = upload.fields?.parentId?.value || null;
    if (parentId && !(await findOwned(request.tenantId, parentId))) {
      return reply.code(404).send({ error: "Dossier parent introuvable" });
    }
    // « Garder les deux » : un nom libre (« rapport (2).pdf ») plutôt qu'un
    // refus. Le champ doit précéder le fichier dans le formulaire.
    const nomFichier =
      upload.fields?.conflit?.value === "renommer"
        ? await nomLibre(request.tenantId, parentId, upload.filename)
        : upload.filename;

    const tenant = await prisma.tenant.findUnique({ where: { id: request.tenantId } });
    if (tenant.usedBytes >= tenant.quota) {
      return reply.code(413).send({ error: "Quota de stockage atteint" });
    }

    // La destination des nouveaux fichiers vient de la console
    // Plateforme ; le nœud retient laquelle, pour savoir plus tard où
    // relire ses octets.
    const pilote = await piloteEcriture(request.tenantId);
    const key = pilote.buildKey(request.tenantId, upload.filename);
    const size = await ecrireOuNettoyer(pilote, key, upload.file);

    // Le stream a pu dépasser le quota restant : on annule dans ce cas.
    if (tenant.usedBytes + BigInt(size) > tenant.quota) {
      await pilote.remove(key);
      return reply.code(413).send({ error: "Quota de stockage dépassé" });
    }

    try {
      const node = await prisma.$transaction(async (tx) => {
        const created = await tx.fsNode.create({
          data: {
            tenantId: request.tenantId,
            ownerId: request.user.id,
            parentId,
            name: nomFichier,
            type: "FILE",
            size: BigInt(size),
            mimeType: typeNeutralise(upload.mimetype),
            storageKey: key,
            storage: pilote.nom,
          },
        });

        await consommerQuota(tx, request.tenantId, size);

        return created;
      });

      await journaliser(request, "fichier.import", node.name, {
        octets: size,
        type: upload.mimetype,
      });

      return reply.code(201).send(serialize(node));
    } catch (err) {
      await pilote.remove(key);
      if (err.code === "QUOTA") return reply.code(413).send({ error: err.message });
      if (err.code === "P2002") {
        return reply.code(409).send({ error: "Un fichier porte déjà ce nom ici" });
      }
      throw err;
    }
  });

  /// Demande un lien de lecture en flux pour un fichier.
  app.post("/:id/link", async (request, reply) => {
    const node = await findOwned(request.tenantId, request.params.id);
    if (!node || node.type !== "FILE") {
      return reply.code(404).send({ error: "Fichier introuvable" });
    }

    return { url: `/api/files/stream/${await creerLien(node.id, request.tenantId)}` };
  });

  /// Lecture en flux, avec gestion des plages d'octets.
  ///
  /// C'est ce qui permet à une vidéo de démarrer immédiatement et de se
  /// déplacer dans la timeline : le navigateur réclame `bytes=…` et on ne
  /// lui envoie que ce morceau. Sans cela, il faut télécharger le fichier
  /// entier avant la première image — 32 Mo d'attente pour une vidéo
  /// courte, et aucun déplacement possible.
  app.get("/stream/:token", async (request, reply) => {
    const lien = await lireLien(request.params.token);
    if (!lien) {
      return reply.code(401).send({ error: "Lien de lecture expiré" });
    }

    const node = await prisma.fsNode.findFirst({
      where: { id: lien.fid, tenantId: lien.tid, deletedAt: null },
    });
    if (!node || !node.storageKey) {
      return reply.code(404).send({ error: "Fichier introuvable" });
    }

    const total = Number(node.size);
    reply
      .header("Accept-Ranges", "bytes")
      .header("Content-Type", typeDeFlux(node.mimeType))
      .header("Cache-Control", "private, max-age=3600")
      // Le navigateur ne doit pas deviner un type que nous refusons de
      // déclarer : sans « nosniff », un fichier servi en octet-stream mais
      // commençant par « <html> » est parfois interprété comme du HTML.
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `inline; filename="${encodeURIComponent(node.name)}"`)
      // Ceinture et bretelles : si malgré tout un document s'ouvrait ici,
      // il n'aurait ni script, ni origine, ni requête réseau.
      .header("Content-Security-Policy", "default-src 'none'; sandbox");

    const plage = request.headers.range;
    if (!plage) {
      reply.header("Content-Length", total);
      return reply.send((await piloteLecture(node.storage, lien.tid)).read(node.storageKey));
    }

    const m = /^bytes=(\d*)-(\d*)$/.exec(String(plage).trim());
    let debut;
    let fin;
    if (m && !m[1] && m[2]) {
      // « bytes=-500 » : les 500 derniers octets.
      debut = Math.max(0, total - parseInt(m[2], 10));
      fin = total - 1;
    } else {
      debut = m && m[1] ? parseInt(m[1], 10) : 0;
      fin = m && m[2] ? parseInt(m[2], 10) : total - 1;
    }

    if (!m || !Number.isFinite(debut) || debut >= total || fin < debut) {
      return reply.code(416).header("Content-Range", `bytes */${total}`).send();
    }
    fin = Math.min(fin, total - 1);

    return reply
      .code(206)
      .header("Content-Range", `bytes ${debut}-${fin}/${total}`)
      .header("Content-Length", fin - debut + 1)
      .send((await piloteLecture(node.storage, lien.tid)).readRange(node.storageKey, debut, fin));
  });

  app.get("/:id/download", async (request, reply) => {
    const node = await findOwned(request.tenantId, request.params.id);
    if (!node || node.type !== "FILE") {
      return reply.code(404).send({ error: "Fichier introuvable" });
    }

    reply
      .header("Content-Type", node.mimeType || "application/octet-stream")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent(node.name)}"`);

    return reply.send((await piloteLecture(node.storage, request.tenantId)).read(node.storageKey));
  });

  /// Renommer ou déplacer un élément.
  ///
  /// Les deux gestes dans une seule route : ce sont la même écriture, et
  /// l'Explorateur les enchaîne souvent (glisser puis renommer). Le nom et
  /// le parent sont facultatifs — on ne touche que ce qui est fourni.
  app.patch("/:id", async (request, reply) => {
    const parsed = z
      .object({
        name: z.string().min(1).max(255).optional(),
        // `null` explicite = remonter à la racine, à distinguer de « absent »
        // qui veut dire « ne pas déplacer ».
        parentId: z.string().nullable().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Nom ou destination invalide" });
    }

    const node = await findOwned(request.tenantId, request.params.id);
    if (!node) {
      return reply.code(404).send({ error: "Élément introuvable" });
    }

    const { name, parentId } = parsed.data;

    if (parentId !== undefined && parentId) {
      const cible = await findOwned(request.tenantId, parentId);
      if (!cible || cible.type !== "FOLDER") {
        return reply.code(404).send({ error: "Dossier de destination introuvable" });
      }
      // Déplacer un dossier dans sa propre descendance le détacherait de
      // l'arbre : il disparaîtrait de l'Explorateur sans être supprimé, et
      // plus rien ne permettrait de le retrouver.
      const descendants = await collectSubtree(request.tenantId, node);
      if (descendants.some((d) => d.id === parentId)) {
        return reply
          .code(400)
          .send({ error: "Un dossier ne peut pas être déplacé dans lui-même." });
      }
    }

    try {
      const maj = await prisma.fsNode.update({
        where: { id: node.id },
        data: {
          ...(name === undefined ? {} : { name: name.trim() }),
          ...(parentId === undefined ? {} : { parentId }),
        },
      });

      await journaliser(
        request,
        name !== undefined && parentId === undefined
          ? "fichier.renommage"
          : "fichier.deplacement",
        maj.name,
        { avant: node.name, type: node.type },
      );

      return serialize(maj);
    } catch (err) {
      if (err.code === "P2002") {
        return reply
          .code(409)
          .send({ error: "Un élément porte déjà ce nom à cet endroit" });
      }
      throw err;
    }
  });

  /// Remplace le contenu d'un fichier, en gardant son identité.
  ///
  /// C'est ce qui permet à une application d'**enregistrer** : sans cette
  /// route, chaque Ctrl+S devrait déposer un nouveau fichier — « rapport
  /// (2).docx », « rapport (3).docx » — ou détruire puis recréer, ce qui
  /// changerait l'identifiant et casserait tout ce qui pointait dessus.
  ///
  /// Les nouveaux octets sont écrits sous une **nouvelle** clé de stockage
  /// avant que la base ne bascule : si l'écriture échoue à mi-chemin,
  /// l'ancien contenu est intact. L'ancienne clé n'est effacée qu'à la fin.
  app.put("/:id/content", async (request, reply) => {
    const upload = await request.file();
    if (!upload) {
      return reply.code(400).send({ error: "Aucun contenu reçu" });
    }

    const node = await findOwned(request.tenantId, request.params.id);
    if (!node || node.type !== "FILE") {
      return reply.code(404).send({ error: "Fichier introuvable" });
    }

    const attenduBrut = upload.fields?.expectedUpdatedAt?.value;
    const attendu = attenduBrut ? new Date(attenduBrut) : null;
    if (attenduBrut && (!Number.isFinite(attendu?.getTime()) || node.updatedAt.getTime() !== attendu.getTime())) {
      // La réponse part avant l'écriture du nouveau contenu, mais le flux
      // multipart doit tout de même être vidé proprement.
      upload.file.resume();
      return reply.code(409).send({
        error: "Ce fichier a été modifié dans une autre fenêtre. Rechargez sa dernière version avant d’enregistrer.",
        code: "FILE_VERSION_CONFLICT",
        updatedAt: node.updatedAt.toISOString(),
      });
    }

    const pilote = await piloteEcriture(request.tenantId);
    const cle = pilote.buildKey(request.tenantId, node.name);
    const taille = await ecrireOuNettoyer(pilote, cle, upload.file);

    const tenant = await prisma.tenant.findUnique({
      where: { id: request.tenantId },
    });
    // L'ancien contenu est gardé en version : le nouveau s'ajoute au quota
    // en entier.
    const difference = BigInt(taille);
    if (tenant.usedBytes + difference > tenant.quota) {
      await pilote.remove(cle);
      return reply.code(413).send({ error: "Quota de stockage dépassé" });
    }

    const ancienne = node.storageKey;
    let maj;
    try {
      maj = await prisma.$transaction(async (tx) => {
        // Le contrôle est répété dans l'écriture SQL : deux sauvegardes qui
        // arrivent ensemble ne peuvent donc pas toutes deux gagner après la
        // vérification ci-dessus.
        const filtre = attendu
          ? { id: node.id, updatedAt: attendu }
          : { id: node.id };
        const resultat = await tx.fsNode.updateMany({
          where: filtre,
          data: {
          size: BigInt(taille),
          storageKey: cle,
          storage: pilote.nom,
          mimeType: upload.mimetype ? typeNeutralise(upload.mimetype) : node.mimeType,
          },
        });
        if (resultat.count !== 1) throw Object.assign(new Error("Conflit de version"), { code: "FILE_VERSION_CONFLICT" });
        await consommerQuota(tx, request.tenantId, difference);
        if (ancienne) {
          await tx.versionFichier.create({
            data: {
              tenantId: request.tenantId,
              nodeId: node.id,
              storageKey: ancienne,
              storage: node.storage,
              size: node.size,
              mimeType: node.mimeType,
              auteurId: request.user.id,
              auteurNom: request.user.name,
            },
          });
        }
        return tx.fsNode.findUnique({ where: { id: node.id } });
      });
    } catch (erreur) {
      await pilote.remove(cle);
      if (erreur.code === "QUOTA") return reply.code(413).send({ error: erreur.message });
      if (erreur.code === "FILE_VERSION_CONFLICT") {
        return reply.code(409).send({
          error: "Ce fichier a été modifié dans une autre fenêtre. Rechargez sa dernière version avant d’enregistrer.",
          code: erreur.code,
        });
      }
      throw erreur;
    }

    await elaguerVersions(request.tenantId, node.id);
    await journaliser(request, "fichier.modification", node.name, {
      octets: taille,
    });

    return serialize(maj);
  });

  /// Mise à la corbeille, récursive. Rien n'est effacé : tout le sous-arbre
  /// est marqué du même `trashId`, celui de l'élément que l'utilisateur a
  /// désigné. Le quota n'est pas rendu — les octets occupent toujours le
  /// stockage tant que la corbeille n'est pas vidée.
  app.delete("/:id", async (request, reply) => {
    const node = await findOwned(request.tenantId, request.params.id);
    if (!node) {
      return reply.code(404).send({ error: "Élément introuvable" });
    }

    const tous = await collectSubtree(request.tenantId, node, {
      vivantsSeulement: true,
    });
    await prisma.fsNode.updateMany({
      where: { id: { in: tous.map((n) => n.id) } },
      data: { deletedAt: new Date(), trashId: node.id },
    });

    await journaliser(request, "fichier.corbeille", node.name, {
      type: node.type,
      elements: tous.length,
    });

    return reply.code(204).send();
  });

  /// Restauration d'un groupe supprimé.
  app.post("/:id/restore", async (request, reply) => {
    const racine = await prisma.fsNode.findFirst({
      where: {
        id: request.params.id,
        tenantId: request.tenantId,
        deletedAt: { not: null },
        trashId: request.params.id,
      },
    });
    if (!racine) {
      return reply.code(404).send({ error: "Élément introuvable dans la corbeille" });
    }

    // Le dossier d'origine a pu être supprimé entre-temps : dans ce cas on
    // remonte à la racine du cloud plutôt que de restaurer dans l'invisible.
    let parentId = racine.parentId;
    if (parentId && !(await findOwned(request.tenantId, parentId))) {
      parentId = null;
    }

    // La place a pu être reprise pendant le séjour à la corbeille.
    const name = await nomLibre(request.tenantId, parentId, racine.name);

    const restauré = await prisma.$transaction(async (tx) => {
      // L'ordre compte : l'index d'unicité ne regarde que les éléments
      // vivants. On replace et renomme tant que le nœud est encore marqué
      // supprimé, puis on le ramène à la vie — sinon il ressusciterait une
      // fraction de seconde sous un nom déjà repris.
      const cible = await tx.fsNode.update({
        where: { id: racine.id },
        data: { parentId, name },
      });
      await tx.fsNode.updateMany({
        where: { tenantId: request.tenantId, trashId: racine.id },
        data: { deletedAt: null, trashId: null },
      });
      return cible;
    });

    await journaliser(request, "fichier.restauration", racine.name, {
      renommeEn: name !== racine.name ? name : undefined,
      remonteALaRacine: parentId !== racine.parentId || undefined,
    });

    return reply.send(
      serialize({
        ...restauré,
        // De quoi prévenir l'utilisateur quand la restauration n'a pas pu
        // se faire à l'identique.
        renommé: name !== racine.name,
        remontéÀLaRacine: parentId !== racine.parentId,
      }),
    );
  });

  /// Suppression définitive d'un élément de la corbeille.
  app.delete("/trash/:id", async (request, reply) => {
    const racine = await prisma.fsNode.findFirst({
      where: {
        id: request.params.id,
        tenantId: request.tenantId,
        deletedAt: { not: null },
        trashId: request.params.id,
      },
    });
    if (!racine) {
      return reply.code(404).send({ error: "Élément introuvable dans la corbeille" });
    }

    await purgerGroupe(
      request.tenantId,
      racine,
      await collectSubtree(request.tenantId, racine),
    );

    await journaliser(request, "fichier.suppression", racine.name, { type: racine.type });

    return reply.code(204).send();
  });

  /// Vidage complet de la corbeille.
  app.delete("/trash", async (request, reply) => {
    const racines = await prisma.fsNode.findMany({
      where: { tenantId: request.tenantId, deletedAt: { not: null } },
    });

    let liberes = 0n;
    for (const racine of racines.filter((n) => n.trashId === n.id)) {
      liberes += await purgerGroupe(
        request.tenantId,
        racine,
        await collectSubtree(request.tenantId, racine),
      );
    }

    await journaliser(request, "corbeille.vidage", null, {
      elements: racines.filter((n) => n.trashId === n.id).length,
      octets: Number(liberes),
    });

    return reply.send(serialize({ liberes }));
  });

  // ---- Versions ------------------------------------------------------------

  app.get("/:id/versions", async (request, reply) => {
    const node = await findOwned(request.tenantId, request.params.id);
    if (!node || node.type !== "FILE") return reply.code(404).send({ error: "Fichier introuvable" });
    const versions = await prisma.versionFichier.findMany({
      where: { tenantId: request.tenantId, nodeId: node.id },
      orderBy: { creeLe: "desc" },
      select: { id: true, size: true, mimeType: true, auteurNom: true, creeLe: true },
    });
    return serialize({ actuelle: { size: node.size, updatedAt: node.updatedAt }, versions });
  });

  app.get("/:id/versions/:vid/download", async (request, reply) => {
    const node = await findOwned(request.tenantId, request.params.id);
    const v = node
      ? await prisma.versionFichier.findFirst({ where: { id: request.params.vid, nodeId: node.id, tenantId: request.tenantId } })
      : null;
    if (!v) return reply.code(404).send({ error: "Version introuvable" });
    const date = v.creeLe.toISOString().slice(0, 16).replace(/[T:]/g, "-");
    const point = node.name.lastIndexOf(".");
    const nom = point > 0 ? `${node.name.slice(0, point)} (${date})${node.name.slice(point)}` : `${node.name} (${date})`;
    reply
      .header("Content-Type", v.mimeType || "application/octet-stream")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent(nom)}"`);
    return reply.send((await piloteLecture(v.storage, request.tenantId)).read(v.storageKey));
  });

  /// Revenir à une version : elle redevient le contenu du fichier, et le
  /// contenu actuel devient une version (rien n'est perdu).
  app.post("/:id/versions/:vid/restaurer", async (request, reply) => {
    const node = await findOwned(request.tenantId, request.params.id);
    const v = node
      ? await prisma.versionFichier.findFirst({ where: { id: request.params.vid, nodeId: node.id, tenantId: request.tenantId } })
      : null;
    if (!v) return reply.code(404).send({ error: "Version introuvable" });
    const maj = await prisma.$transaction(async (tx) => {
      await tx.versionFichier.delete({ where: { id: v.id } });
      await tx.versionFichier.create({
        data: {
          tenantId: request.tenantId,
          nodeId: node.id,
          storageKey: node.storageKey,
          storage: node.storage,
          size: node.size,
          mimeType: node.mimeType,
          auteurId: request.user.id,
          auteurNom: request.user.name,
        },
      });
      return tx.fsNode.update({
        where: { id: node.id },
        data: { storageKey: v.storageKey, storage: v.storage, size: v.size, mimeType: v.mimeType },
      });
    });
    await journaliser(request, "fichier.version.restauration", node.name, { version: v.creeLe });
    return serialize(maj);
  });

  // ---- Liens de partage ------------------------------------------------------

  const partageSchema = z.object({
    joursValidite: z.number().int().min(1).max(90),
    motDePasse: z.string().min(6).max(200).optional(),
    maxTelechargements: z.number().int().min(1).max(10000).optional(),
  });

  const enLien = (l) => ({
    id: l.id,
    expireLe: l.expireLe,
    protege: !!l.motDePasseHash,
    maxTelechargements: l.maxTelechargements,
    telechargements: l.telechargements,
    dernierAcces: l.dernierAcces,
    creeParNom: l.creeParNom,
    creeLe: l.creeLe,
    actif: !l.revoqueLe && l.expireLe > new Date() && (!l.maxTelechargements || l.telechargements < l.maxTelechargements),
  });

  app.get("/:id/partages", async (request, reply) => {
    const node = await findOwned(request.tenantId, request.params.id);
    if (!node || node.type !== "FILE") return reply.code(404).send({ error: "Fichier introuvable" });
    const liens = await prisma.lienPartage.findMany({
      where: { tenantId: request.tenantId, nodeId: node.id, revoqueLe: null },
      orderBy: { creeLe: "desc" },
    });
    return serialize(liens.map(enLien));
  });

  /// Crée un lien public. Le jeton n'est montré qu'une fois : la base n'en
  /// garde que l'empreinte.
  app.post("/:id/partages", async (request, reply) => {
    const node = await findOwned(request.tenantId, request.params.id);
    if (!node || node.type !== "FILE") return reply.code(404).send({ error: "Fichier introuvable" });
    const parsed = partageSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Réglages du lien invalides (validité de 1 à 90 jours, mot de passe de 6 caractères au moins)." });
    const tenant = await prisma.tenant.findUnique({ where: { id: request.tenantId }, select: { partagePublic: true } });
    if (tenant?.partagePublic === false) {
      return reply.code(403).send({ error: "Les liens publics sont désactivés dans cet espace." });
    }
    const jeton = randomBytes(24).toString("base64url");
    const lien = await prisma.lienPartage.create({
      data: {
        tenantId: request.tenantId,
        nodeId: node.id,
        empreinte: createHash("sha256").update(jeton).digest("hex"),
        creeParId: request.user.id,
        creeParNom: request.user.name,
        expireLe: new Date(Date.now() + parsed.data.joursValidite * 86400_000),
        motDePasseHash: parsed.data.motDePasse ? await hashPassword(parsed.data.motDePasse) : null,
        maxTelechargements: parsed.data.maxTelechargements ?? null,
      },
    });
    await journaliser(request, "fichier.partage.creation", node.name, {
      jours: parsed.data.joursValidite,
      protege: !!parsed.data.motDePasse,
    });
    const base = await basePublique(request.tenantId);
    return reply.code(201).send(serialize({ ...enLien(lien), url: `${base.replace(/\/+$/, "")}/api/public/partages/${jeton}` }));
  });

  app.delete("/partages/:pid", async (request, reply) => {
    const lien = await prisma.lienPartage.findFirst({
      where: { id: request.params.pid, tenantId: request.tenantId, revoqueLe: null },
      include: { node: { select: { name: true } } },
    });
    if (!lien) return reply.code(404).send({ error: "Lien introuvable" });
    await prisma.lienPartage.update({ where: { id: lien.id }, data: { revoqueLe: new Date() } });
    await journaliser(request, "fichier.partage.revocation", lien.node?.name || null);
    return reply.code(204).send();
  });

  // ---- Récents, copie, archive ZIP ---------------------------------------------

  /// Les fichiers modifiés le plus récemment dans l'espace.
  app.get("/recents", async (request) => {
    const nodes = await prisma.fsNode.findMany({
      where: { tenantId: request.tenantId, deletedAt: null, type: "FILE" },
      orderBy: { updatedAt: "desc" },
      take: 40,
    });
    return serialize(nodes);
  });

  const COPIE_MAX = 2000;
  const selectionSchema = z.object({
    ids: z.array(z.string().min(1).max(40)).min(1).max(500),
    parentId: z.string().nullable().optional(),
  });

  /// Copier des fichiers et des dossiers (récursivement) vers un dossier.
  /// Les octets sont réellement dupliqués : la copie vit sa vie, ses
  /// versions et sa corbeille sont les siennes.
  app.post("/copie", async (request, reply) => {
    const parsed = selectionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Sélection invalide" });
    const parentId = parsed.data.parentId || null;
    if (parentId) {
      const cible = await findOwned(request.tenantId, parentId);
      if (!cible || cible.type !== "FOLDER") return reply.code(404).send({ error: "Dossier de destination introuvable" });
    }
    const sources = await prisma.fsNode.findMany({
      where: { tenantId: request.tenantId, id: { in: parsed.data.ids }, deletedAt: null },
    });
    if (!sources.length) return reply.code(404).send({ error: "Éléments introuvables" });

    // Tout le contenu à copier, mesuré avant de commencer : on refuse
    // d'emblée ce qui ne tient pas, plutôt que de s'arrêter à moitié.
    const arbres = [];
    for (const s of sources) {
      const tous = await collectSubtree(request.tenantId, s, { vivantsSeulement: true });
      if (parentId && s.type === "FOLDER" && tous.some((n) => n.id === parentId)) {
        return reply.code(400).send({ error: "Un dossier ne peut pas être copié dans lui-même." });
      }
      arbres.push(tous);
    }
    const nombre = arbres.reduce((n, a) => n + a.length, 0);
    if (nombre > COPIE_MAX) return reply.code(400).send({ error: `Copie limitée à ${COPIE_MAX} éléments à la fois.` });
    const octets = arbres.flat().reduce((t, n) => t + (n.type === "FILE" ? n.size : 0n), 0n);
    const tenant = await prisma.tenant.findUnique({ where: { id: request.tenantId } });
    if (tenant.usedBytes + octets > tenant.quota) return reply.code(413).send({ error: "Quota de stockage insuffisant pour cette copie." });

    const pilote = await piloteEcriture(request.tenantId);
    const copierNoeud = async (n, versParent, nom) => {
      if (n.type === "FOLDER") {
        const dossier = await prisma.fsNode.create({
          data: { tenantId: request.tenantId, ownerId: request.user.id, parentId: versParent, name: nom, type: "FOLDER" },
        });
        const enfants = await prisma.fsNode.findMany({ where: { tenantId: request.tenantId, parentId: n.id, deletedAt: null } });
        for (const e of enfants) await copierNoeud(e, dossier.id, e.name);
        return dossier;
      }
      const cle = pilote.buildKey(request.tenantId, nom);
      const taille = await ecrireOuNettoyer(pilote, cle, (await piloteLecture(n.storage, request.tenantId)).read(n.storageKey));
      try {
        return await prisma.$transaction(async (tx) => {
          const cree = await tx.fsNode.create({
            data: {
              tenantId: request.tenantId,
              ownerId: request.user.id,
              parentId: versParent,
              name: nom,
              type: "FILE",
              size: BigInt(taille),
              mimeType: n.mimeType,
              storageKey: cle,
              storage: pilote.nom,
            },
          });
          await consommerQuota(tx, request.tenantId, taille);
          return cree;
        });
      } catch (err) {
        await pilote.remove(cle).catch(() => {});
        throw err;
      }
    };

    const copies = [];
    try {
      for (const s of sources) {
        copies.push(await copierNoeud(s, parentId, await nomLibre(request.tenantId, parentId, s.name)));
      }
    } catch (err) {
      if (err.code === "QUOTA") return reply.code(413).send({ error: err.message });
      throw err;
    }
    await journaliser(request, "fichier.copie", sources.length === 1 ? sources[0].name : `${sources.length} éléments`, { elements: nombre });
    return reply.code(201).send(serialize(copies));
  });

  const ZIP_MAX_OCTETS = 2n * 1024n ** 3n;
  const ZIP_MAX_ENTREES = 10_000;

  /// Télécharger une sélection (dossiers compris) en une archive ZIP,
  /// produite au fil de l'eau — voir src/zip.js.
  app.post("/zip", async (request, reply) => {
    const parsed = selectionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Sélection invalide" });
    const sources = await prisma.fsNode.findMany({
      where: { tenantId: request.tenantId, id: { in: parsed.data.ids }, deletedAt: null },
    });
    if (!sources.length) return reply.code(404).send({ error: "Éléments introuvables" });

    // Chemin de chaque élément dans l'archive, à partir des racines choisies.
    const entrees = [];
    const vus = new Set();
    for (const s of sources) {
      const tous = await collectSubtree(request.tenantId, s, { vivantsSeulement: true });
      const chemins = new Map([[s.id, s.name]]);
      for (const n of tous) {
        if (n.id !== s.id) chemins.set(n.id, `${chemins.get(n.parentId)}/${n.name}`);
        if (vus.has(n.id)) continue;
        vus.add(n.id);
        entrees.push({ n, chemin: chemins.get(n.id) });
      }
    }
    if (entrees.length > ZIP_MAX_ENTREES) return reply.code(400).send({ error: `Archive limitée à ${ZIP_MAX_ENTREES} éléments.` });
    const total = entrees.reduce((t, { n }) => t + (n.type === "FILE" ? n.size : 0n), 0n);
    if (total > ZIP_MAX_OCTETS) return reply.code(400).send({ error: "Archive limitée à 2 Go : téléchargez en plusieurs fois." });

    const tenantId = request.tenantId;
    const nom = sources.length === 1 ? `${sources[0].name.replace(/\.[^.]+$/, "") || "archive"}.zip` : "fichiers.zip";
    await journaliser(request, "fichier.archive", nom, { elements: entrees.length, octets: Number(total) });
    reply
      .header("Content-Type", "application/zip")
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(nom)}`)
      .header("Cache-Control", "no-store");
    return reply.send(
      Readable.from(
        zipEnFlux(
          entrees.map(({ n, chemin }) => ({
            nom: chemin,
            dossier: n.type === "FOLDER",
            date: n.updatedAt,
            ouvrir: n.type === "FILE" ? async () => (await piloteLecture(n.storage, tenantId)).read(n.storageKey) : undefined,
          })),
        ),
      ),
    );
  });
}

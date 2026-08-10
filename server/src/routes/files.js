import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma, serialize } from "../db.js";
import { authenticate } from "../auth.js";
import { journaliser } from "../audit.js";
import { piloteEcriture, piloteLecture } from "../storage.js";
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
  const liberes = tous.reduce((somme, n) => somme + n.size, 0n);

  await prisma.$transaction(async (tx) => {
    await tx.fsNode.delete({ where: { id: racine.id } });
    if (liberes > 0n) {
      await tx.tenant.update({
        where: { id: tenantId },
        data: { usedBytes: { decrement: liberes } },
      });
    }
  });

  for (const n of tous) {
    if (n.storageKey) await (await piloteLecture(n.storage)).remove(n.storageKey);
  }

  return liberes;
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
// La table vit dans le processus : un redémarrage du serveur invalide les
// liens en cours, et le client en redemande un. En production multi-nœuds,
// c'est cette table qu'il faudra déporter (Redis).

const LIEN_DUREE_MS = 2 * 60 * 60 * 1000;
const liens = new Map();

const creerLien = (fid, tid) => {
  // Purge à l'occasion : la table reste petite sans tâche planifiée.
  const maintenant = Date.now();
  for (const [cle, valeur] of liens) {
    if (valeur.expire < maintenant) liens.delete(cle);
  }

  const jeton = randomUUID().replace(/-/g, "");
  liens.set(jeton, { fid, tid, expire: maintenant + LIEN_DUREE_MS });
  return jeton;
};

const lireLien = (jeton) => {
  const lien = liens.get(jeton);
  if (!lien) return null;
  if (lien.expire < Date.now()) {
    liens.delete(jeton);
    return null;
  }
  return lien;
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
    });

    return serialize(nodes);
  });

  /// Contenu de la corbeille : uniquement ce que l'utilisateur a
  /// explicitement supprimé, pas les descendants partis avec.
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

    const tenant = await prisma.tenant.findUnique({ where: { id: request.tenantId } });
    if (tenant.usedBytes >= tenant.quota) {
      return reply.code(413).send({ error: "Quota de stockage atteint" });
    }

    // La destination des nouveaux fichiers vient de la console
    // Plateforme ; le nœud retient laquelle, pour savoir plus tard où
    // relire ses octets.
    const pilote = await piloteEcriture();
    const key = pilote.buildKey(request.tenantId, upload.filename);
    const size = await pilote.put(key, upload.file);

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
            name: upload.filename,
            type: "FILE",
            size: BigInt(size),
            mimeType: typeNeutralise(upload.mimetype),
            storageKey: key,
            storage: pilote.nom,
          },
        });

        await tx.tenant.update({
          where: { id: request.tenantId },
          data: { usedBytes: { increment: BigInt(size) } },
        });

        return created;
      });

      await journaliser(request, "fichier.import", node.name, {
        octets: size,
        type: upload.mimetype,
      });

      return reply.code(201).send(serialize(node));
    } catch (err) {
      await pilote.remove(key);
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

    return { url: `/api/files/stream/${creerLien(node.id, request.tenantId)}` };
  });

  /// Lecture en flux, avec gestion des plages d'octets.
  ///
  /// C'est ce qui permet à une vidéo de démarrer immédiatement et de se
  /// déplacer dans la timeline : le navigateur réclame `bytes=…` et on ne
  /// lui envoie que ce morceau. Sans cela, il faut télécharger le fichier
  /// entier avant la première image — 32 Mo d'attente pour une vidéo
  /// courte, et aucun déplacement possible.
  app.get("/stream/:token", async (request, reply) => {
    const lien = lireLien(request.params.token);
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
      return reply.send((await piloteLecture(node.storage)).read(node.storageKey));
    }

    const m = /bytes=(\d*)-(\d*)/.exec(plage);
    const debut = m && m[1] ? parseInt(m[1], 10) : 0;
    let fin = m && m[2] ? parseInt(m[2], 10) : total - 1;

    if (!Number.isFinite(debut) || debut >= total) {
      return reply.code(416).header("Content-Range", `bytes */${total}`).send();
    }
    fin = Math.min(fin, total - 1);

    return reply
      .code(206)
      .header("Content-Range", `bytes ${debut}-${fin}/${total}`)
      .header("Content-Length", fin - debut + 1)
      .send((await piloteLecture(node.storage)).readRange(node.storageKey, debut, fin));
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

    return reply.send((await piloteLecture(node.storage)).read(node.storageKey));
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

    const pilote = await piloteEcriture();
    const cle = pilote.buildKey(request.tenantId, node.name);
    const taille = await pilote.put(cle, upload.file);

    const tenant = await prisma.tenant.findUnique({
      where: { id: request.tenantId },
    });
    // Le quota se juge sur la différence : remplacer 2 Mo par 2,1 Mo ne
    // demande que 0,1 Mo d'espace libre.
    const difference = BigInt(taille) - node.size;
    if (tenant.usedBytes + difference > tenant.quota) {
      await pilote.remove(cle);
      return reply.code(413).send({ error: "Quota de stockage dépassé" });
    }

    const ancienne = node.storageKey;
    const maj = await prisma.$transaction(async (tx) => {
      const fichier = await tx.fsNode.update({
        where: { id: node.id },
        data: {
          size: BigInt(taille),
          storageKey: cle,
          storage: pilote.nom,
          mimeType: upload.mimetype ? typeNeutralise(upload.mimetype) : node.mimeType,
        },
      });
      await tx.tenant.update({
        where: { id: request.tenantId },
        data: { usedBytes: { increment: difference } },
      });
      return fichier;
    });

    await (await piloteLecture(node.storage)).remove(ancienne);
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
}

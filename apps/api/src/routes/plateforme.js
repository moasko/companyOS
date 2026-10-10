// La console de l'exploitant du SaaS.
//
// ─────────────────────────────────────────────────────────────────────────
// AU-DESSUS DES ESPACES
//
// Un OWNER dirige son entreprise ; l'exploitant dirige la plateforme.
// Ces routes voient tous les espaces de travail — formule, effectif,
// stockage, activité — et changent une formule quand un client paie (ou
// arrête de payer) hors du circuit en ligne : un virement reçu, un accord
// commercial, un geste.
//
// L'accès ne tient pas à un rôle d'espace mais à une liste d'adresses
// email dans l'environnement (PLATFORM_ADMINS) : on ne devient pas
// exploitant en créant un espace, on l'est parce que le serveur le sait.
// ─────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { prisma, serialize } from "../db.js";
import { authenticate, exigerExploitant, revoquerSessions } from "../auth.js";
import { journaliser } from "../audit.js";
import { FORMULES, formuleDe } from "../formules.js";
import { chargerConfig, enregistrerConfig, testerConfig } from "../storage.js";
import { masquer } from "../chiffrement.js";
import { createReadStream } from "node:fs";
import { env } from "../env.js";
import { cheminLocal, sauvegarderBase, sauvegarderFichiers } from "../sauvegardes.js";
import { etatCaches, nomsCaches, viderCaches } from "../caches.js";
import { compterDonneesExpirees, etatServeur, purgerDonneesExpirees } from "../maintenance.js";
import { fluxOuverts } from "./evenements.js";

/// Journalise un geste de l'exploitant **deux fois** : chez lui, comme
/// toujours, et dans l'espace concerné.
///
/// Un client dont la formule change, dont un membre est promu ou dont
/// l'espace est suspendu doit pouvoir le lire dans son propre journal —
/// sans quoi une intervention de la plateforme ressemble, vue de chez lui,
/// à une modification que personne n'a faite.
const tracer = async (request, tenantId, action, cible, details) => {
  await journaliser(request, action, cible, details);
  if (tenantId && tenantId !== request.tenantId) {
    await journaliser(request, action, cible, details, { tenantId });
  }
};

export default async function plateformeRoutes(app) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", exigerExploitant);

  /// Tout le SaaS d'un coup d'œil : chaque espace avec ses chiffres, et
  /// les totaux — dont le revenu mensuel des formules payantes.
  app.get("/", async () => {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { users: true, installations: true, records: true } },
      },
    });

    // La dernière connexion de chaque espace : un client qui ne revient
    // plus est un client qu'on va perdre, bien avant qu'il ne résilie.
    const activites = await prisma.$queryRaw`
      SELECT u."tenantId" AS "tenantId", max(s."vuLe") AS "vuLe"
      FROM "sessions" s JOIN "users" u ON u."id" = s."userId"
      GROUP BY u."tenantId"`.catch(() => []);
    const vuLe = new Map(activites.map((a) => [a.tenantId, a.vuLe]));

    const espaces = tenants.map((t) => ({
      id: t.id,
      nom: t.name,
      slug: t.slug,
      plan: t.plan,
      prixMois: formuleDe(t.plan).prixMois,
      suspendu: t.suspendu,
      suspenduLe: t.suspenduLe,
      motifSuspension: t.motifSuspension,
      utilisateurs: t._count.users,
      applications: t._count.installations,
      fiches: t._count.records,
      usedBytes: t.usedBytes,
      quota: t.quota,
      creeLe: t.createdAt,
      dernierAcces: vuLe.get(t.id) || null,
    }));

    return serialize({
      espaces,
      formules: FORMULES,
      totaux: {
        espaces: espaces.length,
        utilisateurs: espaces.reduce((s, e) => s + e.utilisateurs, 0),
        stockage: tenants.reduce((s, t) => s + t.usedBytes, 0n),
        // Le revenu mensuel récurrent — la somme des formules payantes.
        mrr: espaces.reduce((s, e) => s + e.prixMois, 0),
      },
    });
  });

  /// Changer la formule d'un espace — le geste commercial de l'exploitant.
  /// Le quota suit la formule, comme dans le circuit self-service ; mais
  /// ici, pas de garde-fou de rétrogradation : l'exploitant assume, et un
  /// espace au-dessus de son nouveau quota ne perd rien — il ne peut plus
  /// écrire, c'est tout.
  app.put("/espaces/:id/formule", async (request, reply) => {
    const parsed = z
      .object({ plan: z.enum(["FREE", "PRO", "ENTERPRISE"]) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Formule inconnue." });

    const tenant = await prisma.tenant.findUnique({ where: { id: request.params.id } });
    if (!tenant) return reply.code(404).send({ error: "Espace introuvable." });

    const cible = formuleDe(parsed.data.plan);
    const maj = await prisma.tenant.update({
      where: { id: tenant.id },
      data: { plan: cible.id, quota: BigInt(cible.quota) },
    });

    await tracer(request, tenant.id, "plateforme.formule", tenant.name, {
      de: formuleDe(tenant.plan).nom,
      vers: cible.nom,
    });

    return serialize({ id: maj.id, plan: maj.plan, quota: maj.quota });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Stockage des fichiers
  // ─────────────────────────────────────────────────────────────────────
  //
  // L'exploitant choisit où atterrissent les fichiers de tous ses clients :
  // le disque du serveur, ou un stockage objet compatible S3.
  //
  // Le secret n'est **jamais** renvoyé, même à l'exploitant : l'écran en
  // affiche les quatre derniers caractères, assez pour reconnaître la
  // bonne clé, pas assez pour la reconstituer. Un navigateur, un cache ou
  // un journal de proxy n'ont pas à voir passer un secret qui donne accès
  // aux fichiers de toute la plateforme.

  /// Les membres d'un espace, pour l'exploitant.
  ///
  /// C'est le premier appel du support : « je n'arrive plus à me
  /// connecter », « mon associé est parti avec le compte propriétaire ».
  /// Sans cette vue, aucune de ces deux phrases ne peut être traitée.
  ///
  /// Volontairement maigre, et **jamais le mot de passe ni son empreinte** :
  /// l'exploitant a besoin de savoir qui compose un espace et avec quel
  /// rôle, pas de pouvoir se faire passer pour quelqu'un.
  app.get("/espaces/:id/membres", async (request, reply) => {
    const espace = await prisma.tenant.findUnique({
      where: { id: request.params.id },
      select: { id: true, name: true },
    });
    if (!espace) {
      return reply.code(404).send({ error: "Espace introuvable." });
    }

    const membres = await prisma.user.findMany({
      where: { tenantId: espace.id },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { name: "asc" },
    });

    // Le propriétaire d'abord : c'est lui qu'on cherche neuf fois sur dix.
    //
    // Le tri se fait ici et non en base : Prisma ordonne un enum selon son
    // **ordre de déclaration** dans le schéma, pas selon un rang métier.
    // `orderBy: { role: "desc" }` remontait donc MEMBER en tête — l'inverse
    // de ce qu'on veut, et sans rien signaler.
    const RANG = { OWNER: 0, ADMIN: 1, MEMBER: 2 };
    membres.sort((x, y) => RANG[x.role] - RANG[y.role] || x.name.localeCompare(y.name, "fr"));

    const invitations = await prisma.invitation.count({
      where: { tenantId: espace.id, acceptedAt: null },
    });

    return serialize({ espace, membres, invitationsEnAttente: invitations });
  });

  /// Changer le rôle d'un membre, depuis la console.
  ///
  /// La route équivalente existe déjà côté espace (`/auth/members/:id/role`)
  /// mais elle est cloisonnée à l'espace de l'appelant — c'est justement ce
  /// qu'on veut d'elle. L'exploitant a besoin de la même action **sur un
  /// autre espace** : le cas réel est le propriétaire parti sans avoir
  /// promu personne, et une entreprise entière bloquée derrière son compte.
  app.put("/espaces/:id/membres/:userId/role", async (request, reply) => {
    const parsed = z
      .object({ role: z.enum(["OWNER", "ADMIN", "MEMBER"]) })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Rôle inconnu." });
    }

    // Le membre est cherché **dans cet espace**, pas par son seul
    // identifiant : sans ce filtre, une URL bricolée changerait le rôle de
    // n'importe qui, dans n'importe quel espace.
    const membre = await prisma.user.findFirst({
      where: { id: request.params.userId, tenantId: request.params.id },
      select: { id: true, name: true, email: true, role: true, tenantId: true },
    });
    if (!membre) {
      return reply.code(404).send({ error: "Ce membre n'appartient pas à cet espace." });
    }
    if (membre.role === parsed.data.role) {
      return { id: membre.id, role: membre.role, inchange: true };
    }

    // Un espace sans propriétaire n'a plus personne pour inviter, facturer
    // ni régler quoi que ce soit — et rien dans l'application ne permet
    // d'en refaire un. Rétrograder le dernier, c'est le condamner.
    if (membre.role === "OWNER" && parsed.data.role !== "OWNER") {
      const proprietaires = await prisma.user.count({
        where: { tenantId: membre.tenantId, role: "OWNER" },
      });
      if (proprietaires <= 1) {
        return reply.code(400).send({
          error:
            "C'est le dernier propriétaire de cet espace. Promouvez d'abord quelqu'un d'autre.",
        });
      }
    }

    const maj = await prisma.user.update({
      where: { id: membre.id },
      data: { role: parsed.data.role },
      select: { id: true, name: true, email: true, role: true },
    });

    await tracer(request, membre.tenantId, "plateforme.role", membre.email, {
      avant: membre.role,
      apres: parsed.data.role,
    });

    return serialize(maj);
  });

  /// Fermer toutes les sessions d'un membre, depuis la console.
  ///
  /// Le geste du support face à un compte compromis — « on m'a volé mon
  /// téléphone », « un ancien salarié utilise encore mon poste » : tous les
  /// appareils du compte sont déconnectés sur-le-champ, sans toucher à ses
  /// données ni à son rôle. Le mot de passe reste à changer par la personne.
  app.post("/espaces/:id/membres/:userId/deconnexion", async (request, reply) => {
    const membre = await prisma.user.findFirst({
      where: { id: request.params.userId, tenantId: request.params.id },
      select: { id: true, email: true, tenantId: true },
    });
    if (!membre) {
      return reply.code(404).send({ error: "Ce membre n'appartient pas à cet espace." });
    }

    await revoquerSessions(membre.id);
    await tracer(request, membre.tenantId, "plateforme.deconnexion", membre.email);

    return { ok: true };
  });

  /// Suspendre un espace, ou lever sa suspension.
  ///
  /// Le seul levier de l'exploitant face à un client qui ne paie plus ou
  /// qui abuse du service. **Rien n'est supprimé** : les données restent
  /// intactes et reviennent telles quelles à la levée. C'est ce qui rend
  /// l'action utilisable sans crainte — on suspend d'abord, on discute
  /// ensuite.
  ///
  /// Le contrôle qui compte n'est pas ici mais dans `authenticate` : un
  /// membre d'un espace suspendu est refusé sur **toutes** les routes, pas
  /// seulement à la connexion.
  app.put("/espaces/:id/suspension", async (request, reply) => {
    const parsed = z
      .object({
        suspendu: z.boolean(),
        // Le motif est montré à l'utilisateur qui tente de se connecter :
        // « suspendu » sans explication transforme un litige commercial en
        // incident technique, et fait perdre du temps aux deux parties.
        motif: z.string().trim().max(280).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }

    const espace = await prisma.tenant.findUnique({ where: { id: request.params.id } });
    if (!espace) {
      return reply.code(404).send({ error: "Espace introuvable." });
    }

    // On refuse de suspendre l'espace depuis lequel on agit : l'exploitant
    // y échapperait par l'exception d'`authenticate`, mais ses collègues
    // non — et la console deviendrait injoignable pour eux.
    if (parsed.data.suspendu && espace.id === request.tenantId) {
      return reply
        .code(400)
        .send({ error: "On ne suspend pas l'espace depuis lequel on administre la plateforme." });
    }

    const maj = await prisma.tenant.update({
      where: { id: espace.id },
      data: {
        suspendu: parsed.data.suspendu,
        suspenduLe: parsed.data.suspendu ? new Date() : null,
        motifSuspension: parsed.data.suspendu ? parsed.data.motif || null : null,
      },
    });

    await tracer(
      request,
      espace.id,
      parsed.data.suspendu ? "plateforme.suspension" : "plateforme.reprise",
      espace.name,
      { motif: parsed.data.motif || null },
    );

    return serialize({ id: maj.id, suspendu: maj.suspendu, suspenduLe: maj.suspenduLe });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Santé : sauvegardes et erreurs
  // ─────────────────────────────────────────────────────────────────────

  /// L'état de santé de la plateforme, d'un coup d'œil : la dernière
  /// sauvegarde réussie de chaque type, l'historique récent, et les
  /// erreurs à traiter.
  app.get("/sante", async () => {
    const [historique, derniereBase, derniersFichiers, erreurs, aTraiter, config] =
      await Promise.all([
        prisma.sauvegarde.findMany({ orderBy: { debut: "desc" }, take: 30 }),
        prisma.sauvegarde.findFirst({
          where: { type: "base", statut: "ok" },
          orderBy: { debut: "desc" },
        }),
        prisma.sauvegarde.findFirst({
          where: { type: "fichiers", statut: "ok" },
          orderBy: { debut: "desc" },
        }),
        prisma.erreurApp.findMany({
          orderBy: [{ resolue: "asc" }, { derniere: "desc" }],
          take: 100,
        }),
        prisma.erreurApp.count({ where: { resolue: false } }),
        chargerConfig(),
      ]);

    return serialize({
      sauvegardes: {
        active: env.sauvegardeActive,
        heure: env.sauvegardeHeure,
        retentionJours: env.sauvegardeRetentionJours,
        fichiersSemaines: env.sauvegardeFichiersSemaines,
        // Sans stockage objet, les copies restent sur le disque qu'elles
        // protègent : la console doit le dire, c'est le premier risque.
        horsSitePossible: config.utilisable,
        archiveFichiers: env.storageDriver === "local",
        derniereBase,
        derniersFichiers,
        historique,
      },
      erreurs: { aTraiter, liste: erreurs },
    });
  });

  /// Lancer une sauvegarde tout de suite — avant une mise à jour risquée,
  /// typiquement. La réponse attend la fin : quelques secondes pour une
  /// base de PME.
  app.post("/sauvegardes", async (request, reply) => {
    const type = request.body?.type === "fichiers" ? "fichiers" : "base";
    try {
      const resultat =
        type === "fichiers"
          ? await sauvegarderFichiers("manuelle")
          : await sauvegarderBase("manuelle");
      await journaliser(request, "plateforme.sauvegarde", resultat.fichier, { type });
      return serialize(resultat);
    } catch (e) {
      return reply.code(500).send({ error: `La sauvegarde a échoué : ${e.message}` });
    }
  });

  /// Télécharger une sauvegarde encore présente sur le serveur.
  ///
  /// C'est toute la base de toutes les entreprises : le geste est
  /// journalisé, et réservé — comme toute cette console — à l'exploitant.
  app.get("/sauvegardes/:id/fichier", async (request, reply) => {
    const s = await prisma.sauvegarde.findUnique({ where: { id: request.params.id } });
    const chemin = s?.statut === "ok" ? await cheminLocal(s.fichier) : null;
    if (!chemin) {
      return reply.code(404).send({ error: "Cette sauvegarde n'est plus sur le serveur." });
    }
    await journaliser(request, "plateforme.sauvegarde.telechargement", s.fichier);
    reply.header("Content-Disposition", `attachment; filename="${s.fichier}"`);
    reply.header("Content-Type", "application/octet-stream");
    return reply.send(createReadStream(chemin));
  });

  /// Marquer une erreur comme résolue — ou la rouvrir. Une erreur résolue
  /// qui se reproduit repasse d'elle-même « à traiter ».
  app.put("/erreurs/:id", async (request, reply) => {
    const resolue = request.body?.resolue !== false;
    const { count } = await prisma.erreurApp.updateMany({
      where: { id: request.params.id },
      data: { resolue },
    });
    if (!count) return reply.code(404).send({ error: "Erreur introuvable." });
    return { ok: true, resolue };
  });

  // ─────────────────────────────────────────────────────────────────────
  // Maintenance : caches, ménage, état du serveur
  // ─────────────────────────────────────────────────────────────────────

  /// L'instance qui répond, ses caches, et ce qu'un ménage supprimerait.
  /// Derrière un répartiteur, chaque appel peut tomber sur une instance
  /// différente : les chiffres de mémoire et de caches sont les siens.
  app.get("/maintenance", async () =>
    serialize({
      serveur: await etatServeur(),
      tempsReel: fluxOuverts(),
      caches: etatCaches(),
      expirees: await compterDonneesExpirees(),
    }),
  );

  const schemaVidage = z.object({
    noms: z.array(z.string().max(60)).max(50).default([]),
    navigateurs: z.boolean().default(false),
  });

  /// Vider des caches (tous si la liste est vide) sur toutes les instances,
  /// et, à la demande, faire relire leurs données aux navigateurs ouverts.
  app.post("/caches/vider", async (request, reply) => {
    const corps = schemaVidage.safeParse(request.body || {});
    if (!corps.success) return reply.code(400).send({ error: "Demande de vidage invalide." });
    const inconnus = corps.data.noms.filter((n) => !nomsCaches().includes(n));
    if (inconnus.length) return reply.code(400).send({ error: `Cache inconnu : ${inconnus.join(", ")}.` });
    const resultat = await viderCaches(corps.data);
    await journaliser(request, "plateforme.caches.vider", corps.data.noms.join(",") || "tous", {
      entrees: resultat.entrees,
      navigateurs: corps.data.navigateurs,
    });
    return { ...resultat, navigateurs: corps.data.navigateurs, caches: etatCaches() };
  });

  /// Supprimer tout de suite ce que le ménage périodique supprimerait.
  app.post("/purge", async (request) => {
    const resultat = await purgerDonneesExpirees();
    await journaliser(request, "plateforme.purge", "donnees-expirees", resultat.lignes);
    return resultat;
  });

  app.get("/stockage", async () => {
    const config = await chargerConfig();
    const compte = await prisma.fsNode.groupBy({
      by: ["storage"],
      where: { type: "FILE" },
      _count: { _all: true },
      _sum: { size: true },
    }).catch(() => []);

    return serialize({
      actif: config.stockage,
      demande: config.demande,
      utilisable: config.utilisable,
      secretIllisible: config.secretIllisible,
      s3: config.s3
        ? {
            endpoint: config.s3.endpoint || "",
            region: config.s3.region || "",
            bucket: config.s3.bucket || "",
            accessKey: config.s3.accessKey || "",
            prefix: config.s3.prefix || "",
            pathStyle: config.s3.pathStyle !== false,
            secretMasque: masquer(config.s3.secretKey),
          }
        : null,
      // Combien de fichiers vivent à chaque destination : c'est ce qui
      // rassure au moment de basculer, et ce qui rappelle qu'on ne peut
      // pas retirer une destination encore utilisée.
      repartition: (compte || []).map((c) => ({
        destination: c.storage || "local",
        fichiers: c._count._all,
        octets: c._sum.size || 0n,
      })),
    });
  });

  const schemaS3 = z.object({
    endpoint: z.string().url("L'adresse doit être une URL complète, https:// compris."),
    region: z.string().min(1).max(64),
    bucket: z.string().min(1).max(255),
    accessKey: z.string().min(1).max(255),
    // Vide = « garde le secret déjà enregistré ».
    secretKey: z.string().max(512).optional().or(z.literal("")),
    prefix: z.string().max(255).optional().or(z.literal("")),
    pathStyle: z.boolean().optional(),
  });

  /// Essayer une configuration sans l'enregistrer : on écrit un objet
  /// témoin, on le relit, on le supprime. Un simple accès au bucket ne
  /// prouverait pas le droit d'écriture — et c'est celui qui manque le
  /// plus souvent.
  app.post("/stockage/test", async (request, reply) => {
    const parsed = z
      .object({ stockage: z.enum(["local", "s3"]), s3: schemaS3.optional() })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }
    try {
      await testerConfig(parsed.data);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.put("/stockage", async (request, reply) => {
    const parsed = z
      .object({ stockage: z.enum(["local", "s3"]), s3: schemaS3.optional() })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }

    // On refuse de basculer vers une destination qui ne répond pas :
    // enregistrer une configuration fausse rendrait tout téléversement
    // impossible, sans que personne comprenne pourquoi.
    if (parsed.data.stockage === "s3") {
      try {
        await testerConfig(parsed.data);
      } catch (err) {
        return reply.code(400).send({
          error: `Le stockage objet ne répond pas : ${err.message}`,
        });
      }
    }

    const config = await enregistrerConfig(parsed.data);
    await journaliser(request, "plateforme.stockage", parsed.data.stockage, {
      bucket: parsed.data.s3?.bucket,
    });
    return serialize({ actif: config.stockage, utilisable: config.utilisable });
  });
}

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
import { authenticate } from "../auth.js";
import { journaliser } from "../audit.js";
import { env } from "../env.js";
import { FORMULES, formuleDe } from "../formules.js";
import { chargerConfig, enregistrerConfig, testerConfig } from "../storage.js";
import { masquer } from "../chiffrement.js";

const exigerExploitant = async (request, reply) => {
  const email = request.user?.email?.toLowerCase();
  if (!email || !env.plateformeAdmins.includes(email)) {
    return reply
      .code(403)
      .send({ error: "Cette console est réservée à l'exploitant de la plateforme." });
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

    await journaliser(request, "plateforme.formule", tenant.name, {
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

    await journaliser(request, "plateforme.role", membre.email, {
      avant: membre.role,
      apres: parsed.data.role,
    });

    return serialize(maj);
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

    await journaliser(
      request,
      parsed.data.suspendu ? "plateforme.suspension" : "plateforme.reprise",
      espace.name,
      { motif: parsed.data.motif || null },
    );

    return serialize({ id: maj.id, suspendu: maj.suspendu, suspenduLe: maj.suspenduLe });
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

// Réglages propres à un espace de travail.
//
// ─────────────────────────────────────────────────────────────────────────
// « NOS DOCUMENTS RESTENT CHEZ NOUS »
//
// C'est la première objection d'un cabinet comptable, d'un notaire ou d'une
// entreprise qui manipule des bulletins de paie : accepter un service en
// ligne, oui, mais pas que les pièces dorment sur le serveur d'un tiers.
//
// L'entreprise peut donc désigner **son propre** stockage objet — son
// compte Amazon S3, son Cloudflare R2, ou le NAS de ses bureaux sous MinIO.
// À partir de là, ses fichiers y partent directement ; la plateforme n'en
// garde pas de copie.
//
// Ce que ça ne change pas : `FsNode.storage` retient la destination de
// chaque fichier. Basculer n'envoie donc rien nulle part, les fichiers
// déjà écrits continuent d'être lus là où ils sont, et revenir en arrière
// est tout aussi anodin. Voir src/storage.js.
//
// RÉSERVÉ AUX ADMINISTRATEURS
//
// Ce réglage engage les documents de toute l'entreprise, et une mauvaise
// adresse rendrait les téléversements impossibles pour tout le monde. Il
// suit donc la même règle que l'installation d'une application.
// ─────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { prisma, serialize } from "../db.js";
import { authenticate, exigerRole } from "../auth.js";
import { journaliser } from "../audit.js";
import { masquer } from "../chiffrement.js";
import {
  chargerConfigEspace,
  enregistrerConfigEspace,
  testerConfigEspace,
} from "../storage.js";

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

const corps = z.object({
  stockage: z.enum(["plateforme", "s3"]),
  s3: schemaS3.optional(),
});

export default async function espaceRoutes(app) {
  app.addHook("preHandler", authenticate);

  /// L'état du stockage de cet espace.
  ///
  /// Le secret ne revient jamais : seuls ses quatre derniers caractères,
  /// de quoi reconnaître la bonne clé sans permettre de la reconstituer.
  app.get("/stockage", { preHandler: exigerRole("ADMIN") }, async (request) => {
    const config = await chargerConfigEspace(request.tenantId);

    // Combien de fichiers vivent à chaque destination. C'est ce qui
    // rassure au moment de basculer, et ce qui rappelle qu'une destination
    // qui contient encore des fichiers ne doit pas être démantelée.
    const parDestination = await prisma.fsNode.groupBy({
      by: ["storage"],
      where: { tenantId: request.tenantId, type: "FILE" },
      _count: { _all: true },
      _sum: { size: true },
    });

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
      repartition: parDestination.map((c) => ({
        destination: c.storage,
        fichiers: c._count._all,
        octets: c._sum.size || 0n,
      })),
    });
  });

  /// Essayer une configuration **sans l'enregistrer** : on écrit un objet
  /// témoin, on le relit, on le supprime. Un simple accès au bucket ne
  /// prouverait pas le droit d'écriture — et c'est celui qui manque le
  /// plus souvent.
  app.post("/stockage/test", { preHandler: exigerRole("ADMIN") }, async (request, reply) => {
    const parsed = corps.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }
    try {
      await testerConfigEspace(request.tenantId, parsed.data);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.put("/stockage", { preHandler: exigerRole("ADMIN") }, async (request, reply) => {
    const parsed = corps.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }

    // On refuse de basculer vers une destination qui ne répond pas :
    // enregistrer une configuration fausse rendrait tout téléversement
    // impossible, sans que personne comprenne pourquoi.
    if (parsed.data.stockage === "s3") {
      try {
        await testerConfigEspace(request.tenantId, parsed.data);
      } catch (err) {
        return reply.code(400).send({
          error: `Votre stockage ne répond pas : ${err.message}`,
        });
      }
    }

    const config = await enregistrerConfigEspace(request.tenantId, parsed.data);
    await journaliser(request, "espace.stockage", parsed.data.stockage, {
      bucket: parsed.data.s3?.bucket || null,
    });
    return { actif: config.stockage, utilisable: config.utilisable };
  });
}

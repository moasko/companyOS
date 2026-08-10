import { z } from "zod";
import { prisma, serialize } from "../db.js";
import { authenticate } from "../auth.js";

/// Notifications internes.
///
/// Un seul mécanisme pour tout l'espace : une application n'a pas à savoir
/// comment prévenir quelqu'un, elle décrit ce qu'elle veut dire et à qui.
/// Le serveur ne connaît pas les tâches, les factures ni les stocks — il
/// range un titre, un message, une source et un lien.
///
/// Deux garde-fous portent tout le reste :
///   - on ne notifie que des personnes de son propre espace ;
///   - on ne lit et on ne marque que ses propres notifications.

const envoiSchema = z.object({
  /// Un identifiant, une liste, ou "tous" pour tout l'espace.
  a: z.union([z.string(), z.array(z.string()).min(1).max(200), z.literal("tous")]),
  source: z.string().min(1).max(40),
  titre: z.string().min(1).max(140),
  message: z.string().max(600).optional(),
  lien: z
    .object({ app: z.string().min(1).max(40), params: z.record(z.any()).optional() })
    .optional(),
});

export default async function notificationRoutes(app) {
  app.addHook("preHandler", authenticate);

  /// Mes notifications, les plus récentes d'abord.
  app.get("/", async (request) => {
    const { limite = 40, nonLues } = request.query || {};

    const liste = await prisma.notification.findMany({
      where: {
        userId: request.user.id,
        ...(nonLues === "1" ? { lu: false } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(limite) || 40, 100),
    });

    return serialize({
      notifications: liste,
      nonLues: await prisma.notification.count({
        where: { userId: request.user.id, lu: false },
      }),
    });
  });

  /// Envoyer. N'importe quel membre peut notifier n'importe quel autre :
  /// attribuer une tâche à son responsable est un usage normal, pas une
  /// escalade de privilège. La limite est l'espace de travail.
  app.post("/", async (request, reply) => {
    const parsed = envoiSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }
    const { a, source, titre, message, lien } = parsed.data;

    const destinataires = await prisma.user.findMany({
      where: {
        tenantId: request.tenantId,
        ...(a === "tous" ? {} : { id: { in: Array.isArray(a) ? a : [a] } }),
      },
      select: { id: true },
    });

    if (!destinataires.length) {
      return reply.code(404).send({ error: "Aucun destinataire dans cet espace." });
    }

    // Se notifier soi-même n'apprend rien à personne — sauf si c'est le
    // seul destinataire demandé, auquel cas c'est manifestement voulu
    // (un rappel qu'on se laisse à soi-même).
    const cibles =
      destinataires.length > 1
        ? destinataires.filter((u) => u.id !== request.user.id)
        : destinataires;

    await prisma.notification.createMany({
      data: cibles.map((u) => ({
        tenantId: request.tenantId,
        userId: u.id,
        auteurId: request.user.id,
        auteurNom: request.user.name,
        source,
        titre,
        message: message || null,
        lien: lien ?? undefined,
      })),
    });

    return reply.code(201).send({ envoyees: cibles.length });
  });

  /// Marquer comme lue. Le filtre sur `userId` n'est pas décoratif : sans
  /// lui, n'importe qui viderait la pile de son voisin.
  app.put("/:id/lu", async (request, reply) => {
    const { count } = await prisma.notification.updateMany({
      where: { id: request.params.id, userId: request.user.id },
      data: { lu: true },
    });
    if (!count) return reply.code(404).send({ error: "Notification introuvable" });
    return { ok: true };
  });

  app.put("/lu", async (request) => {
    const { count } = await prisma.notification.updateMany({
      where: { userId: request.user.id, lu: false },
      data: { lu: true },
    });
    return { lues: count };
  });

  app.delete("/:id", async (request, reply) => {
    const { count } = await prisma.notification.deleteMany({
      where: { id: request.params.id, userId: request.user.id },
    });
    if (!count) return reply.code(404).send({ error: "Notification introuvable" });
    return reply.code(204).send();
  });

  /// Tout effacer — sa propre pile uniquement.
  app.delete("/", async (request) => {
    const { count } = await prisma.notification.deleteMany({
      where: { userId: request.user.id },
    });
    return { supprimees: count };
  });
}

import { z } from "zod";
import { prisma, serialize } from "../db.js";
import { authenticate } from "../auth.js";
import { notifier } from "../notifier.js";
import { clesVapid, endpointAccepte } from "../push.js";

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

const abonnementSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }),
});
const PUSH_MAX_APPAREILS = 10;

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

    await notifier(
      request.tenantId,
      cibles.map((u) => u.id),
      { auteurId: request.user.id, auteurNom: request.user.name, source, titre, message, lien },
    );

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

  // ---- Push (appareil prévenu onglet fermé) --------------------------------

  /// La clé publique VAPID, pour que le navigateur s'abonne chez nous.
  app.get("/push/cle", async () => ({ cle: (await clesVapid()).publicKey }));

  /// Abonner cet appareil. L'adresse est celle du service de push du
  /// navigateur : seuls les services connus sont acceptés (voir src/push.js).
  app.post("/push", async (request, reply) => {
    const parsed = abonnementSchema.safeParse(request.body);
    if (!parsed.success || !endpointAccepte(parsed.data.endpoint)) {
      return reply.code(400).send({ error: "Abonnement push invalide." });
    }
    const { endpoint, keys } = parsed.data;
    const agent = String(request.headers["user-agent"] || "").slice(0, 200) || null;
    // Un appareil passé d'un compte à l'autre : l'abonnement suit la
    // personne connectée, jamais les deux.
    await prisma.abonnementPush.upsert({
      where: { endpoint },
      create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, agent, userId: request.user.id, tenantId: request.tenantId },
      update: { p256dh: keys.p256dh, auth: keys.auth, agent, userId: request.user.id, tenantId: request.tenantId, vuLe: new Date() },
    });
    // Plafond par personne : les plus anciens appareils cèdent la place.
    const miens = await prisma.abonnementPush.findMany({
      where: { userId: request.user.id },
      orderBy: { vuLe: "desc" },
      select: { id: true },
    });
    if (miens.length > PUSH_MAX_APPAREILS) {
      await prisma.abonnementPush.deleteMany({ where: { id: { in: miens.slice(PUSH_MAX_APPAREILS).map((a) => a.id) } } });
    }
    return reply.code(201).send({ ok: true });
  });

  app.delete("/push", async (request) => {
    const endpoint = String(request.body?.endpoint || "");
    const { count } = await prisma.abonnementPush.deleteMany({
      where: { userId: request.user.id, ...(endpoint ? { endpoint } : {}) },
    });
    return { supprimes: count };
  });

  /// Combien d'appareils reçoivent mes notifications.
  app.get("/push", async (request) => ({
    appareils: await prisma.abonnementPush.count({ where: { userId: request.user.id } }),
  }));
}

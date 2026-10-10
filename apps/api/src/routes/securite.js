import { z } from "zod";
import { prisma, serialize } from "../db.js";
import { authenticate, exigerExploitant, exigerRole } from "../auth.js";
import { journaliser } from "../audit.js";
import { GRAVITES, bloquerIp, debloquerIp, messageAlerte, titreAlerte } from "../detection.js";

/// Détection d'intrusion — voir src/detection.js.
///
///   /api/securite                 les alertes d'un espace (administrateurs)
///   /api/plateforme/securite      toute la plateforme (exploitant) :
///                                 alertes, adresses bloquées, blocage manuel

const vue = (a) => ({
  ...a,
  titre: titreAlerte(a.type),
  message: messageAlerte(a),
});

const filtres = (query) => {
  const where = {};
  if (query.gravite && GRAVITES.includes(query.gravite)) {
    where.gravite = { in: GRAVITES.slice(GRAVITES.indexOf(query.gravite)) };
  }
  if (query.etat === "ouvertes") where.traiteLe = null;
  if (typeof query.type === "string" && /^[a-z_]{2,40}$/.test(query.type)) where.type = query.type;
  return where;
};

/// Résumé des 24 dernières heures et des 7 derniers jours.
const resume = async (where) => {
  const depuis = (h) => new Date(Date.now() - h * 3600_000);
  const [jour, semaine, ouvertes] = await Promise.all([
    prisma.alerteSecurite.groupBy({ by: ["gravite"], where: { ...where, creeLe: { gt: depuis(24) } }, _count: true }),
    prisma.alerteSecurite.groupBy({ by: ["type"], where: { ...where, creeLe: { gt: depuis(24 * 7) } }, _count: true }),
    prisma.alerteSecurite.count({ where: { ...where, traiteLe: null, gravite: { in: ["haute", "critique"] } } }),
  ]);
  return {
    jour: Object.fromEntries(jour.map((l) => [l.gravite, l._count])),
    semaine: semaine.map((l) => ({ type: l.type, titre: titreAlerte(l.type), n: l._count })).sort((a, b) => b.n - a.n),
    ouvertesGraves: ouvertes,
  };
};

export async function securiteRoutes(app) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", exigerRole("ADMIN"));

  app.get("/alertes", async (request) => {
    const where = { tenantId: request.tenantId, ...filtres(request.query || {}) };
    const [alertes, synthese] = await Promise.all([
      prisma.alerteSecurite.findMany({ where, orderBy: { creeLe: "desc" }, take: 200 }),
      resume({ tenantId: request.tenantId }),
    ]);
    return serialize({ alertes: alertes.map(vue), resume: synthese });
  });

  app.post("/alertes/:id/traiter", async (request, reply) => {
    const { count } = await prisma.alerteSecurite.updateMany({
      where: { id: request.params.id, tenantId: request.tenantId, traiteLe: null },
      data: { traiteLe: new Date(), traitePar: request.user.email },
    });
    if (!count) return reply.code(404).send({ error: "Alerte introuvable ou déjà traitée" });
    await journaliser(request, "securite.alerte.traitee", request.params.id);
    return { ok: true };
  });

  app.post("/alertes/traiter-tout", async (request) => {
    const { count } = await prisma.alerteSecurite.updateMany({
      where: { tenantId: request.tenantId, traiteLe: null },
      data: { traiteLe: new Date(), traitePar: request.user.email },
    });
    if (count) await journaliser(request, "securite.alertes.traitees", String(count));
    return { ok: true, traitees: count };
  });
}

const IP = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]{2,39}$/i;
const blocageSchema = z.object({
  ip: z.string().trim().regex(IP, "Adresse IP invalide"),
  heures: z.number().int().min(1).max(24 * 365).default(24),
  motif: z.string().trim().min(2).max(200).default("blocage manuel"),
});

export async function plateformeSecuriteRoutes(app) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", exigerExploitant);

  app.get("/", async (request) => {
    const where = filtres(request.query || {});
    const [alertes, synthese, ips, espaces] = await Promise.all([
      prisma.alerteSecurite.findMany({ where, orderBy: { creeLe: "desc" }, take: 300 }),
      resume({}),
      prisma.ipBloquee.findMany({ where: { jusqua: { gt: new Date() } }, orderBy: { creeLe: "desc" } }),
      prisma.tenant.findMany({ select: { id: true, name: true } }),
    ]);
    const nomEspace = Object.fromEntries(espaces.map((e) => [e.id, e.name]));
    return serialize({
      alertes: alertes.map((a) => ({ ...vue(a), espace: a.tenantId ? nomEspace[a.tenantId] || null : null })),
      resume: synthese,
      ipsBloquees: ips,
    });
  });

  app.post("/alertes/:id/traiter", async (request, reply) => {
    const { count } = await prisma.alerteSecurite.updateMany({
      where: { id: request.params.id, traiteLe: null },
      data: { traiteLe: new Date(), traitePar: request.user.email },
    });
    if (!count) return reply.code(404).send({ error: "Alerte introuvable ou déjà traitée" });
    return { ok: true };
  });

  app.post("/blocages", async (request, reply) => {
    const parsed = blocageSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message || "Données invalides" });
    const { ip, heures, motif } = parsed.data;
    if (ip === request.ip) return reply.code(400).send({ error: "C'est votre propre adresse : vous vous enfermeriez dehors." });
    const r = await bloquerIp({ ip, motif, request, manuel: true, parEmail: request.user.email, dureeMs: heures * 3600_000 });
    await journaliser(request, "plateforme.ip.blocage", ip, { heures, motif });
    return serialize({ ok: true, ...r });
  });

  app.delete("/blocages/:ip", async (request) => {
    const ip = String(request.params.ip || "");
    await debloquerIp(ip);
    await journaliser(request, "plateforme.ip.deblocage", ip);
    return { ok: true };
  });
}

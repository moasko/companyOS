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
}

// Formule de l'espace de travail : consultation et changement.
//
// La consultation est ouverte à tous les membres — chacun peut voir ce que
// l'espace paie et ce qu'il consomme. Le changement est réservé au
// propriétaire : engager une dépense mensuelle n'est pas un geste
// d'administrateur, c'est un geste de patron.
//
// Rétrograder est permis, mais jamais en trichant : si l'espace consomme
// déjà plus que ce que la formule visée autorise (stockage, utilisateurs),
// le changement est refusé avec la raison exacte. Les données ne sont
// jamais coupées d'office.

import { z } from "zod";
import { prisma, serialize } from "../db.js";
import { authenticate, exigerRole } from "../auth.js";
import { journaliser } from "../audit.js";
import { FORMULES, formuleDe } from "../formules.js";

export default async function billingRoutes(app) {
  app.addHook("preHandler", authenticate);

  /// Les formules, celle de l'espace, et sa consommation réelle — tout ce
  /// qu'il faut pour afficher la page « Formule » sans autre appel.
  app.get("/", async (request) => {
    const [tenant, utilisateurs] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: request.tenantId } }),
      prisma.user.count({ where: { tenantId: request.tenantId } }),
    ]);

    return serialize({
      formules: FORMULES,
      actuelle: tenant.plan,
      usage: {
        utilisateurs,
        usedBytes: tenant.usedBytes,
        quota: tenant.quota,
      },
    });
  });

  /// Changement de formule. Le quota de l'espace est aligné sur la formule
  /// choisie dans la même écriture : les deux ne peuvent pas diverger.
  app.put(
    "/formule",
    { preHandler: exigerRole("OWNER") },
    async (request, reply) => {
      const parsed = z
        .object({ plan: z.enum(["FREE", "PRO", "ENTERPRISE"]) })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Formule inconnue." });
      }

      const cible = formuleDe(parsed.data.plan);
      const [tenant, utilisateurs] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: request.tenantId } }),
        prisma.user.count({ where: { tenantId: request.tenantId } }),
      ]);

      if (tenant.plan === cible.id) {
        return reply.code(409).send({ error: "C'est déjà votre formule." });
      }

      // Garde-fous de rétrogradation : on refuse avec la raison, on ne
      // coupe rien.
      if (tenant.usedBytes > BigInt(cible.quota)) {
        return reply.code(409).send({
          error: `Votre espace occupe plus de stockage que la formule ${cible.nom} n'en offre. Libérez de l'espace avant de rétrograder.`,
        });
      }
      if (cible.utilisateursMax !== null && utilisateurs > cible.utilisateursMax) {
        return reply.code(409).send({
          error: `Votre espace compte ${utilisateurs} utilisateurs ; la formule ${cible.nom} en autorise ${cible.utilisateursMax}. Retirez des membres avant de rétrograder.`,
        });
      }

      const ancienne = formuleDe(tenant.plan);
      const maj = await prisma.tenant.update({
        where: { id: tenant.id },
        data: { plan: cible.id, quota: BigInt(cible.quota) },
      });

      await journaliser(request, "espace.formule", cible.nom, {
        de: ancienne.nom,
        vers: cible.nom,
        prixMois: cible.prixMois,
      });

      return serialize({
        plan: maj.plan,
        quota: maj.quota,
        usedBytes: maj.usedBytes,
      });
    },
  );
}

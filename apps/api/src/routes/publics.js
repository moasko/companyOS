import { prisma } from "../db.js";
import { preuveDomaine } from "../espacePublic.js";

/// Routes publiques diverses : /api/public/…
///
/// /verification/:espace — appelée par le serveur lui-même, par le domaine
/// personnalisé qu'un espace veut utiliser (voir src/espacePublic.js). Elle
/// ne répond que si ce domaine est bien celui que l'espace a déclaré : un
/// domaine qui pointe déjà vers la plateforme ne peut pas être revendiqué
/// par un autre espace.
export default async function publicsRoutes(app) {
  app.get("/verification/:espace", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const hote = String(request.hostname || "").split(":")[0].toLowerCase();
    const t = await prisma.tenant.findUnique({ where: { id: String(request.params.espace) }, select: { domainePublic: true } });
    if (!t?.domainePublic || t.domainePublic !== hote) return reply.code(404).send({ error: "Introuvable" });
    return { companyos: true, preuve: preuveDomaine(request.params.espace, hote) };
  });
}

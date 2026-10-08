import { z } from "zod";
import { consigner } from "../erreurs.js";
import { idDuJeton } from "../auth.js";
import { prisma } from "../db.js";

/// Réception des erreurs du navigateur.
///
/// Route publique : une erreur peut survenir avant la connexion — c'est même
/// là qu'elle coûte le plus cher, puisqu'elle empêche d'entrer. Le jeton,
/// s'il est présent, sert seulement à dire qui était touché.
///
/// Garde-fous : un plafond par adresse IP, un corps borné, et rien de ce
/// qui arrive n'est jamais renvoyé ni exécuté — c'est du texte affiché dans
/// la console de l'exploitant.

const LIMITE = { rateLimit: { max: 30, timeWindow: "1 minute" } };

const schema = z.object({
  message: z.string().min(1).max(500),
  pile: z.string().max(8000).optional(),
  url: z.string().max(500).optional(),
});

export default async function erreursRoutes(app) {
  app.post("/", { config: LIMITE, bodyLimit: 16 * 1024 }, async (request, reply) => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Rapport d'erreur invalide." });

    const userId = idDuJeton(request);
    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId }, select: { tenantId: true } })
      : null;

    await consigner({
      source: "web",
      ...parsed.data,
      userId: user ? userId : null,
      tenantId: user?.tenantId || null,
    });
    return reply.code(204).send();
  });
}

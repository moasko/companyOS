import { z } from "zod";
import { prisma, serialize } from "../db.js";
import { authenticate, exigerRole } from "../auth.js";

/// Lecture du journal d'activité.
///
/// Écriture seule ailleurs (voir src/audit.js) : ce fichier n'expose que
/// des GET. Il n'y a volontairement aucune route pour effacer une ligne.

const PAGE = 50;

export default async function auditRoutes(app) {
  // Savoir qui a retiré un membre ou vidé la corbeille, c'est de la
  // surveillance : réservé aux administrateurs de l'espace.
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", exigerRole("ADMIN"));

  app.get("/", async (request) => {
    const parsed = z
      .object({
        action: z.string().max(40).optional(),
        auteur: z.string().max(120).optional(),
        avant: z.coerce.date().optional(),
        limite: z.coerce.number().int().min(1).max(200).default(PAGE),
      })
      .safeParse(request.query);

    const q = parsed.success ? parsed.data : { limite: PAGE };

    const evenements = await prisma.auditEvent.findMany({
      where: {
        tenantId: request.tenantId,
        // Le filtre par action accepte un préfixe : "fichier" retrouve
        // "fichier.import" comme "fichier.corbeille".
        ...(q.action ? { action: { startsWith: q.action } } : {}),
        ...(q.auteur ? { userEmail: q.auteur } : {}),
        // Pagination par curseur temporel plutôt que par offset : le
        // journal grossit par le haut, un offset décalerait les pages.
        ...(q.avant ? { createdAt: { lt: q.avant } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: q.limite,
    });

    return serialize(evenements);
  });

  /// De quoi remplir les listes déroulantes de filtres sans charger tout
  /// le journal côté client.
  app.get("/facettes", async (request) => {
    const [actions, auteurs] = await Promise.all([
      prisma.auditEvent.groupBy({
        by: ["action"],
        where: { tenantId: request.tenantId },
        _count: { action: true },
        orderBy: { _count: { action: "desc" } },
      }),
      prisma.auditEvent.groupBy({
        by: ["userEmail", "userName"],
        where: { tenantId: request.tenantId },
        _count: { userEmail: true },
      }),
    ]);

    return serialize({
      actions: actions.map((a) => ({ action: a.action, total: a._count.action })),
      auteurs: auteurs.map((a) => ({
        email: a.userEmail,
        nom: a.userName,
        total: a._count.userEmail,
      })),
    });
  });
}

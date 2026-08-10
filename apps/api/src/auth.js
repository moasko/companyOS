import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "./env.js";
import { prisma } from "./db.js";

export const hashPassword = (plain) => bcrypt.hash(plain, 12);

export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export const signToken = (user) =>
  jwt.sign({ sub: user.id, tenantId: user.tenantId, role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });

/// Préhandler Fastify : exige un Bearer token valide et attache
/// request.user + request.tenantId, sur lesquels toutes les requêtes
/// de données doivent être filtrées.
export const authenticate = async (request, reply) => {
  const header = request.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return reply.code(401).send({ error: "Authentification requise" });
  }

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    return reply.code(401).send({ error: "Jeton invalide ou expiré" });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { tenant: true },
  });

  if (!user) {
    return reply.code(401).send({ error: "Compte introuvable" });
  }

  // Espace suspendu : la porte est fermée pour tout le monde, y compris
  // pour son propriétaire.
  //
  // Le contrôle est ici et nulle part ailleurs. Le placer route par route,
  // c'est en oublier une — et il suffit d'une seule pour qu'un espace
  // suspendu continue d'envoyer du courrier.
  //
  // **Sauf pour l'exploitant de la plateforme.** Sans cette exception, il
  // s'enfermerait dehors en suspendant son propre espace, et personne ne
  // pourrait plus lever la suspension : les routes de la console exigent
  // elles aussi d'être authentifié.
  if (user.tenant?.suspendu && !estExploitant(user.email)) {
    return reply.code(403).send({
      error: "Cet espace de travail est suspendu.",
      motif: user.tenant.motifSuspension || null,
      suspendu: true,
    });
  }

  request.user = user;
  request.tenantId = user.tenantId;
};

/// L'exploitant du SaaS, reconnu à son adresse déclarée dans
/// l'environnement. On ne devient pas exploitant depuis l'application.
export const estExploitant = (email) =>
  !!email && env.plateformeAdmins.includes(String(email).toLowerCase());

/// Hiérarchie des rôles. Un rang plus élevé peut tout ce que peut le rang
/// en dessous : inutile d'énumérer les combinaisons.
const RANG = { MEMBER: 1, ADMIN: 2, OWNER: 3 };

export const auMoins = (role, minimum) => RANG[role] >= RANG[minimum];

/// Préhandler exigeant un rôle minimum. À placer **après** `authenticate` :
///
///   app.post("/…", { preHandler: [authenticate, exigerRole("ADMIN")] }, …)
///
/// Le contrôle vit ici et pas dans l'interface : cacher un bouton n'est pas
/// une autorisation, c'est une politesse. Toute règle qui compte doit tenir
/// même quand la requête arrive sans passer par notre écran.
export const exigerRole = (minimum) => async (request, reply) => {
  if (!auMoins(request.user?.role, minimum)) {
    return reply.code(403).send({
      error:
        minimum === "OWNER"
          ? "Seul le propriétaire de l'espace peut faire cela."
          : "Vous devez être administrateur de l'espace pour faire cela.",
    });
  }
};

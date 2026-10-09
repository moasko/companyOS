import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "./env.js";
import { prisma } from "./db.js";

export const hashPassword = (plain) => bcrypt.hash(plain, 12);

export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

/// Le jeton porte la **version de session** du compte (`ver`).
///
/// Un JWT ne se révoque pas : signé pour sept jours, il reste valable sept
/// jours, même après un changement de mot de passe. Le compte garde donc un
/// compteur, recopié dans chaque jeton ; l'incrémenter rend caducs, d'un
/// coup, tous les jetons émis avant — sur tous les appareils.
export const signToken = (user) =>
  jwt.sign(
    {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      ver: user.sessionVersion ?? 0,
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn, algorithm: "HS256" },
  );

/// Ferme toutes les sessions ouvertes d'un compte. Renvoie le compte à jour,
/// de quoi signer un jeton neuf pour la session qui a fait la demande.
export const revoquerSessions = (userId) =>
  prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });

/// Une adresse e-mail telle qu'on la stocke et qu'on la compare.
///
/// Sans cette forme unique, `Vous@x.fr` et `vous@x.fr` étaient deux comptes
/// distincts pour la base — alors que le contrôle d'exploitant, lui, passait
/// tout en minuscules : il suffisait de s'inscrire avec la bonne adresse
/// écrite en majuscules pour ouvrir la console de la plateforme.
export const normaliserEmail = (email) =>
  String(email ?? "")
    .trim()
    .toLowerCase();

/// Le compte qui porte cette adresse, quelle que soit sa casse.
///
/// La forme normalisée d'abord — le cas de tous les comptes créés depuis la
/// normalisation ; la recherche insensible ensuite, pour les comptes plus
/// anciens enregistrés avec des majuscules.
export const compteParEmail = async (email, options = {}) => {
  const adresse = normaliserEmail(email);
  return (
    (await prisma.user.findUnique({ where: { email: adresse }, ...options })) ||
    (await prisma.user.findFirst({
      where: { email: { equals: adresse, mode: "insensitive" } },
      orderBy: { createdAt: "asc" },
      ...options,
    }))
  );
};

/// Identifiant du compte porté par le jeton de la requête, ou `null`.
///
/// Sert à la limitation de débit, qui s'exécute en `onRequest` — donc
/// **avant** `authenticate` : `request.user` n'y existe pas encore. La
/// signature est vérifiée (un HMAC, sans accès à la base) : un jeton forgé
/// ne permet pas de se faire compter sous l'identité d'un autre.
export const idDuJeton = (request) => {
  const [scheme, token] = (request.headers.authorization || "").split(" ");
  if (scheme !== "Bearer" || !token) return null;
  try {
    return jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] }).sub || null;
  } catch {
    return null;
  }
};

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
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
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

  // Un jeton émis avant la dernière révocation (mot de passe changé,
  // « déconnecter tous mes appareils », intervention de l'exploitant) ne
  // vaut plus rien. Les jetons d'avant l'introduction du compteur n'ont pas
  // de `ver` : ils comptent pour 0 et restent valides jusqu'à la première
  // révocation, ce qui évite de déconnecter tout le monde au déploiement.
  if ((payload.ver ?? 0) !== (user.sessionVersion ?? 0)) {
    return reply.code(401).send({ error: "Session expirée. Reconnectez-vous." });
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
///
/// La comparaison est **exacte** : l'adresse stockée doit être déjà en
/// minuscules et figurer telle quelle dans la liste (elle-même passée en
/// minuscules par `env.js`). Un ancien compte `VOUS@…` créé à côté du vrai
/// `vous@…` n'hérite donc de rien.
export const estExploitant = (email) =>
  typeof email === "string" &&
  email === email.toLowerCase() &&
  env.plateformeAdmins.includes(email);

/// Préhandler de la console Plateforme. À placer après `authenticate`.
export const exigerExploitant = async (request, reply) => {
  if (!estExploitant(request.user?.email)) {
    return reply
      .code(403)
      .send({ error: "Cette console est réservée à l'exploitant de la plateforme." });
  }
};

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

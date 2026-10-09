import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "./env.js";
import { prisma } from "./db.js";

export const hashPassword = (plain) => bcrypt.hash(plain, 12);

export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
//
// Chaque connexion ouvre une **session** en base ; le jeton signé n'en porte
// que l'identifiant (`sid`). Toute requête relit la session : la fermer
// (déconnexion, appareil perdu, administrateur, exploitant) prend effet à la
// requête suivante, appareil par appareil.
//
// Dans le navigateur, le jeton vit dans un cookie `HttpOnly` : aucun script
// de la page ne peut le lire, donc ni une bibliothèque d'analyse de fichier
// compromise ni une injection ne peuvent l'emporter. En contrepartie, une
// requête qui modifie quelque chose doit porter l'en-tête `X-CompanyOS` :
// un site tiers ne peut pas l'ajouter sans une pré-vérification CORS, que
// la liste blanche des origines refuse (protection CSRF).
//
// Les outils (serveur MCP, scripts) gardent un jeton porteur
// (`Authorization: Bearer`) : session de type « api », créée à la demande,
// visible et révocable dans la liste des sessions.

export const COOKIE_SESSION = "cos_session";

/// Inactivité au-delà de laquelle une session de navigateur se ferme.
const INACTIVITE_MS = Number(process.env.SESSION_INACTIVITE_MINUTES || 12 * 60) * 60_000;
const DUREE_API_JOURS = 90;
const METHODES_SURES = new Set(["GET", "HEAD", "OPTIONS"]);

/// `SameSite` du cookie. `Strict` convient quand le shell et l'API sont sur
/// le même site (app.exemple.fr / api.exemple.fr) ; `None` seulement s'ils
/// sont sur deux domaines différents — il impose alors HTTPS.
const SAME_SITE = ["Strict", "Lax", "None"].includes(process.env.SESSION_SAMESITE)
  ? process.env.SESSION_SAMESITE
  : "Strict";

const signer = (user, sid, expiresIn) =>
  jwt.sign(
    {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      ver: user.sessionVersion ?? 0,
      sid,
    },
    env.jwtSecret,
    { expiresIn, algorithm: "HS256" },
  );

const cookie = (request, valeur, maxAgeSecondes) => {
  const securise =
    env.production || SAME_SITE === "None" || request.protocol === "https";
  return [
    `${COOKIE_SESSION}=${valeur}`,
    "Path=/api",
    "HttpOnly",
    `SameSite=${SAME_SITE}`,
    `Max-Age=${maxAgeSecondes}`,
    securise ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
};

/// Ouvre une session et rend son jeton. Pour un navigateur, le jeton part
/// dans le cookie et **n'a pas à être renvoyé dans le corps**.
export const ouvrirSession = async (
  request,
  reply,
  user,
  { type = "navigateur", mfa = false, libelle = null } = {},
) => {
  const api = type === "api";
  const duree = api ? `${DUREE_API_JOURS}d` : env.jwtExpiresIn;
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      type: api ? "api" : "navigateur",
      libelle: libelle ? String(libelle).slice(0, 80) : null,
      mfa,
      ip: request.ip || null,
      agent: String(request.headers["user-agent"] || "").slice(0, 300) || null,
      // Provisoire, fixée juste après d'après l'échéance du jeton.
      expireLe: new Date(Date.now() + 60_000),
    },
  });
  const token = signer(user, session.id, duree);
  const exp = new Date(jwt.decode(token).exp * 1000);
  await prisma.session.update({ where: { id: session.id }, data: { expireLe: exp } });
  if (!api) {
    reply.header(
      "set-cookie",
      cookie(request, token, Math.max(0, Math.floor((exp - Date.now()) / 1000))),
    );
  }
  return { token, session: { ...session, expireLe: exp } };
};

/// Efface le cookie du navigateur.
export const effacerCookie = (request, reply) =>
  reply.header("set-cookie", cookie(request, "", 0));

/// Ferme les sessions d'un compte — toutes, ou toutes sauf une.
export const revoquerSessions = (userId, { sauf = null } = {}) =>
  prisma.session.updateMany({
    where: { userId, revoqueLe: null, ...(sauf ? { id: { not: sauf } } : {}) },
    data: { revoqueLe: new Date() },
  });

const lireCookie = (request) => {
  const brut = String(request.headers.cookie || "");
  for (const morceau of brut.split(";")) {
    const i = morceau.indexOf("=");
    if (i > 0 && morceau.slice(0, i).trim() === COOKIE_SESSION) {
      return morceau.slice(i + 1).trim() || null;
    }
  }
  return null;
};

/// Le jeton de la requête : en-tête `Bearer` d'abord (outils), cookie
/// ensuite (navigateur).
const lireJeton = (request) => {
  const [scheme, token] = (request.headers.authorization || "").split(" ");
  if (scheme === "Bearer" && token) return { token, viaCookie: false };
  const c = lireCookie(request);
  return c ? { token: c, viaCookie: true } : { token: null, viaCookie: false };
};

const verifierJwt = (token) => jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });

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
  const { token } = lireJeton(request);
  if (!token) return null;
  try {
    const p = verifierJwt(token);
    return p.sid ? p.sub || null : null;
  } catch {
    return null;
  }
};

/// Routes accessibles à une session qui doit encore configurer sa double
/// authentification : de quoi la configurer, se déconnecter, et savoir qui
/// on est.
const ROUTES_SANS_MFA = [
  "/api/auth/me",
  "/api/auth/logout",
  "/api/auth/preferences",
];
const routeSansMfa = (request) => {
  const url = request.routeOptions?.url || "";
  return url.startsWith("/api/auth/mfa") || ROUTES_SANS_MFA.includes(url);
};

/// La double authentification est-elle exigée de ce compte ? Toujours pour
/// l'exploitant (il voit toute la plateforme), et pour tout le monde dans
/// un espace qui l'a rendue obligatoire.
export const mfaExigee = (user) => !!(user?.tenant?.mfaObligatoire || estExploitant(user?.email));

/// Préhandler Fastify : exige une session valide (cookie ou jeton porteur)
/// et attache request.user + request.tenantId, sur lesquels toutes les
/// requêtes de données doivent être filtrées.
export const authenticate = async (request, reply) => {
  const { token, viaCookie } = lireJeton(request);
  if (!token) {
    return reply.code(401).send({ error: "Authentification requise" });
  }

  // Protection CSRF : voir l'en-tête de la section « Sessions ».
  if (viaCookie && !METHODES_SURES.has(request.method) && request.headers["x-companyos"] !== "1") {
    return reply.code(403).send({ error: "Requête refusée (en-tête de protection manquant)." });
  }

  let payload;
  try {
    payload = verifierJwt(token);
  } catch {
    return reply.code(401).send({ error: "Jeton invalide ou expiré" });
  }
  // Les jetons d'avant les sessions serveur n'ont pas de `sid` : ils ne
  // valent plus rien, une reconnexion suffit.
  if (!payload.sid) {
    return reply.code(401).send({ error: "Session expirée. Reconnectez-vous." });
  }

  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    include: { user: { include: { tenant: true } } },
  });
  const maintenant = new Date();
  if (
    !session ||
    session.userId !== payload.sub ||
    session.revoqueLe ||
    session.expireLe < maintenant
  ) {
    if (viaCookie) effacerCookie(request, reply);
    return reply.code(401).send({ error: "Session expirée. Reconnectez-vous." });
  }

  // Inactivité : un poste oublié ouvert ne reste pas connecté une semaine.
  if (session.type === "navigateur" && maintenant - session.vuLe > INACTIVITE_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { revoqueLe: maintenant } });
    if (viaCookie) effacerCookie(request, reply);
    return reply
      .code(401)
      .send({ error: "Session fermée après une longue inactivité. Reconnectez-vous." });
  }
  // Mise à jour de l'activité, au plus une fois par minute.
  if (maintenant - session.vuLe > 60_000) {
    prisma.session
      .update({ where: { id: session.id }, data: { vuLe: maintenant } })
      .catch(() => {});
  }

  const user = session.user;

  // Un jeton émis avant la dernière révocation globale (outil de
  // l'exploitant) ne vaut plus rien.
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

  // Double authentification exigée mais pas encore configurée : la session
  // ne sert qu'à la configurer.
  if (!session.mfa && mfaExigee(user) && !routeSansMfa(request)) {
    return reply.code(403).send({
      error: "Activez la double authentification pour continuer.",
      mfaAConfigurer: true,
    });
  }

  request.session = session;
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

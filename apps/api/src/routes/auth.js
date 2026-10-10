import { randomInt } from "node:crypto";
import { z } from "zod";
import { prisma, serialize } from "../db.js";
import { effacerEchecs, noterEchec, verrouDe } from "../etatPartage.js";
import { env } from "../env.js";
import {
  authenticate,
  compteParEmail,
  estExploitant,
  exigerRole,
  hashPassword,
  normaliserEmail,
  effacerCookie,
  mfaExigee,
  ouvrirSession,
  revoquerSessions,
  verifyPassword,
} from "../auth.js";
import { chiffrer, dechiffrer } from "../chiffrement.js";
import {
  consommerSecours,
  empreinteSecours,
  nouveauSecret,
  nouveauxCodesSecours,
  ressembleSecours,
  uriOtpauth,
  verifierCode,
} from "../totp.js";
import jwt from "jsonwebtoken";
import { creerEspace } from "../espaces.js";
import { journaliser, journaliserPour } from "../audit.js";
import { formuleDe } from "../formules.js";
import { envoyerMail, mailInvitation } from "../mail.js";

const registerSchema = z.object({
  company: z.string().min(2),
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/// L'identité publique d'une personne, telle que le shell la reçoit.
///
/// Un seul endroit : les six routes qui renvoyaient l'utilisateur en avaient
/// chacune sa copie, et ajouter un champ en oubliait toujours une.
/// `passwordHash` ne peut pas s'y glisser par accident.
const profil = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  avatar: u.avatar || null,
  mfa: !!u.totpActif,
});

/// Adresse d'un exploitant de la plateforme : aucun compte ne se crée
/// dessus depuis l'application.
///
/// Rien ne vérifie qu'une personne qui s'inscrit, ou qui accepte une
/// invitation, possède vraiment l'adresse saisie. Or l'adresse est tout ce
/// qui fait un exploitant : tant que son compte n'existait pas, le premier
/// venu pouvait le créer — ou se faire inviter dessus par un espace monté
/// pour l'occasion — et recevait la console de toute la plateforme. Ces
/// comptes-là se créent sur le serveur, avec `npm run exploitant`.
const adresseReservee = (request, email) => {
  if (!estExploitant(email)) return false;
  request.log.warn(
    { email },
    "création de compte refusée sur une adresse d'exploitant (PLATFORM_ADMINS)",
  );
  return true;
};

/// Le plafond des routes qui gardent un secret : mot de passe pour la
/// connexion, code pour l'invitation. Il s'ajoute au plafond global déclaré
/// dans `index.js`, qui lui ne sert qu'à écrêter l'abus grossier.
///
/// Compté par IP, jamais par compte : sinon un jeton valide — celui d'un
/// espace créé pour l'occasion — ouvrirait un compteur neuf, et autant de
/// comptes que d'essais de mot de passe ou de code d'invitation.
const LIMITE_SENSIBLE = {
  rateLimit: { max: 8, timeWindow: "15 minutes", keyGenerator: (request) => request.ip },
};

/// La connexion a son propre plafond par IP, plus large : une grande
/// entreprise sort sur Internet par une seule adresse, et huit connexions
/// par quart d'heure pour tout un siège bloquaient le lundi matin. La
/// protection contre l'essai de mots de passe est **par compte**, juste
/// en dessous.
const LIMITE_CONNEXION = {
  rateLimit: { max: 40, timeWindow: "15 minutes", keyGenerator: (request) => request.ip },
};

/// Verrou par compte : après 5 échecs, chaque nouvel échec double l'attente
/// (1 min, 2, 4… plafonnée à 15 min). Un attaquant qui change d'IP à chaque
/// essai ne gagne donc rien. Le plafond est bas exprès : un verrou long
/// donnerait à n'importe qui le moyen de bloquer le compte d'un dirigeant.
// Compteurs en base, partagés par toutes les instances : voir
// src/etatPartage.js.

/// Une empreinte bcrypt jetable, comparée quand l'adresse n'existe pas :
/// la réponse prend alors le même temps (~250 ms) que pour un vrai compte.
/// Sans cela, la durée seule disait quelles adresses ont un compte.
/// Calculée dès le chargement : la première tentative ne doit pas, elle
/// non plus, se distinguer par sa durée.
const empreinteFactice = hashPassword("companyos-compte-inexistant");
const comparerFactice = async (password) => {
  await verifyPassword(password, await empreinteFactice);
  return false;
};

/// Créer un espace est plus coûteux qu'une simple écriture — une
/// transaction, un hachage bcrypt, des dossiers, un catalogue — et chaque
/// espace créé consomme un quota de stockage offert.
const LIMITE_INSCRIPTION = {
  rateLimit: { max: 5, timeWindow: "1 hour", keyGenerator: (request) => request.ip },
};

export default async function authRoutes(app) {
  /// Inscription : crée l'espace de travail, son propriétaire, son quota
  /// et sa racine de fichiers — le tout en une transaction, pour ne jamais
  /// laisser un tenant à moitié construit.
  app.post("/register", { config: LIMITE_INSCRIPTION }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Données invalides", details: parsed.error.flatten() });
    }
    const { company, name, password } = parsed.data;
    const email = normaliserEmail(parsed.data.email);

    // Même réponse pour une adresse réservée que pour une adresse prise :
    // inutile d'indiquer à un inconnu quelles adresses ouvrent la console.
    if ((await compteParEmail(email)) || adresseReservee(request, email)) {
      return reply.code(409).send({ error: "Cette adresse e-mail est déjà utilisée" });
    }

    const { user, tenant } = await creerEspace({
      company,
      name,
      email,
      passwordHash: await hashPassword(password),
    });

    await journaliserPour(
      request,
      { ...user, tenantId: tenant.id },
      "espace.creation",
      tenant.name,
    );

    await ouvrirSession(request, reply, { ...user, tenantId: tenant.id });

    return reply.code(201).send(
      serialize({
        user: profil(user),
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          quota: tenant.quota,
        },
      }),
    );
  });

  /// Huit tentatives par quart d'heure et par adresse IP.
  ///
  /// bcrypt à 12 tours coûte ~250 ms : c'est un ralentisseur, pas un mur.
  /// Sans plafond, un attaquant qui parallélise essaie des milliers de mots
  /// de passe par minute — et sature l'event loop du serveur au passage.
  app.post("/login", { config: LIMITE_CONNEXION }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Données invalides" });
    }
    const { email, password } = parsed.data;
    const cle = normaliserEmail(email);

    const attente = await verrouDe(cle);
    if (attente > 0) {
      return reply.code(429).send({
        error: `Trop de tentatives pour ce compte. Réessayez dans ${Math.ceil(attente / 60000)} min.`,
      });
    }

    const user = await compteParEmail(email, { include: { tenant: true } });
    // Message et durée identiques dans les deux cas : ne pas révéler quels
    // e-mails existent.
    const valide = user
      ? await verifyPassword(password, user.passwordHash)
      : await comparerFactice(password);
    if (!valide) {
      await noterEchec(cle);
      return reply.code(401).send({ error: "Identifiants incorrects" });
    }
    await effacerEchecs(cle);

    // Espace suspendu : on le dit ici, avec le motif. `authenticate`
    // refuserait de toute façon chaque requête suivante, mais l'utilisateur
    // n'y verrait qu'une application qui ne répond plus — sans savoir que
    // c'est une décision, ni laquelle.
    if (user.tenant?.suspendu && !estExploitant(user.email)) {
      return reply.code(403).send({
        error: "Cet espace de travail est suspendu.",
        motif: user.tenant.motifSuspension || null,
        suspendu: true,
      });
    }

    // Double authentification : le mot de passe ne suffit pas. On rend un
    // défi de cinq minutes, que seule la saisie du code transforme en
    // session.
    if (user.totpActif) {
      return {
        mfa: true,
        defi: jwt.sign({ sub: user.id, but: "mfa", jeton: !!request.body?.jeton }, env.jwtSecret, {
          expiresIn: "5m",
          algorithm: "HS256",
        }),
      };
    }

    return terminerConnexion(request, reply, user, { mfa: false });
  });

  /// Ouvre la session au terme de la connexion (avec ou sans second
  /// facteur) et rend ce que le shell attend.
  ///
  /// `jeton: true` dans le corps : un outil (le serveur MCP) demande un
  /// jeton porteur au lieu d'un cookie.
  const terminerConnexion = async (request, reply, user, { mfa, jeton = request.body?.jeton }) => {
    const { token } = await ouvrirSession(request, reply, user, {
      mfa,
      type: jeton ? "api" : "navigateur",
      libelle: jeton ? String(request.body?.libelle || "Outil").slice(0, 80) : null,
    });
    await journaliserPour(request, user, "session.connexion", null, { mfa });
    return serialize({
      ...(jeton ? { token } : {}),
      user: profil(user),
      mfaAConfigurer: !mfa && mfaExigee(user),
      tenant: {
        id: user.tenant.id,
        name: user.tenant.name,
        slug: user.tenant.slug,
        quota: user.tenant.quota,
        usedBytes: user.tenant.usedBytes,
      },
    });
  };

  /// Seconde étape de la connexion : le code de l'application
  /// d'authentification, ou un code de secours.
  app.post("/login/mfa", { config: LIMITE_CONNEXION }, async (request, reply) => {
    let defi;
    try {
      defi = jwt.verify(String(request.body?.defi || ""), env.jwtSecret, { algorithms: ["HS256"] });
    } catch {
      return reply.code(401).send({ error: "Délai dépassé. Reprenez la connexion." });
    }
    if (defi.but !== "mfa") return reply.code(401).send({ error: "Défi invalide." });

    const cle = `mfa:${defi.sub}`;
    const attente = await verrouDe(cle);
    if (attente > 0) {
      return reply.code(429).send({
        error: `Trop de codes erronés. Réessayez dans ${Math.ceil(attente / 60000)} min.`,
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: defi.sub },
      include: { tenant: true },
    });
    if (!user?.totpActif) return reply.code(401).send({ error: "Défi invalide." });

    const resultat = await verifierSecondFacteur(user, request.body?.code);
    if (!resultat) {
      await noterEchec(cle);
      await journaliserPour(request, user, "session.mfa.echec");
      return reply.code(401).send({ error: "Code incorrect." });
    }
    await effacerEchecs(cle);
    if (resultat === "secours") {
      await journaliserPour(request, user, "session.mfa.secours");
    }
    return terminerConnexion(request, reply, user, { mfa: true, jeton: defi.jeton });
  });

  /// Vérifie un code TOTP ou de secours et l'enregistre comme consommé.
  /// Rend "totp", "secours" ou null.
  const verifierSecondFacteur = async (user, code) => {
    if (ressembleSecours(code)) {
      const reste = consommerSecours(user.codesSecours, code);
      if (!reste) return null;
      // Mise à jour conditionnelle : deux connexions simultanées avec le
      // même code de secours ne passent pas toutes les deux.
      const { count } = await prisma.user.updateMany({
        where: { id: user.id, codesSecours: { equals: user.codesSecours } },
        data: { codesSecours: reste },
      });
      return count === 1 ? "secours" : null;
    }
    const secret = dechiffrer(user.totpSecret);
    if (!secret) return null;
    const pas = verifierCode(secret, code, { dernierPas: user.totpDernierPas });
    if (pas === null) return null;
    const { count } = await prisma.user.updateMany({
      where: {
        id: user.id,
        OR: [{ totpDernierPas: null }, { totpDernierPas: { lt: pas } }],
      },
      data: { totpDernierPas: pas },
    });
    return count === 1 ? "totp" : null;
  };

  /// Changement de mot de passe : l'ancien est exigé, sinon un poste
  /// resté ouvert suffirait à verrouiller le compte de son propriétaire.
  app.put("/password", { preHandler: authenticate }, async (request, reply) => {
    const parsed = z
      .object({ current: z.string().min(1), next: z.string().min(8) })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Le nouveau mot de passe doit faire 8 caractères au moins" });
    }

    const ok = await verifyPassword(parsed.data.current, request.user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ error: "Mot de passe actuel incorrect" });
    }

    // Changer de mot de passe, c'est souvent réagir à un doute : les
    // sessions ouvertes ailleurs — un poste partagé, un téléphone perdu, un
    // jeton volé — sont fermées dans le même geste. Celle qui fait la
    // demande reçoit un jeton neuf et reste connectée.
    await prisma.user.update({
      where: { id: request.user.id },
      data: { passwordHash: await hashPassword(parsed.data.next) },
    });
    await revoquerSessions(request.user.id, { sauf: request.session.id });

    await journaliser(request, "compte.motdepasse");

    return { ok: true };
  });

  /// « Déconnecter tous mes appareils » : ferme toutes les sessions du
  /// compte, sauf celle qui fait la demande.
  app.post("/sessions/revoquer", { preHandler: authenticate }, async (request) => {
    await revoquerSessions(request.user.id, { sauf: request.session.id });
    await journaliser(request, "compte.sessions.revocation");
    return { ok: true };
  });

  /// Se déconnecter : la session est fermée **côté serveur** — un jeton
  /// copié avant la déconnexion ne sert plus à rien.
  app.post("/logout", { preHandler: authenticate }, async (request, reply) => {
    await prisma.session.update({
      where: { id: request.session.id },
      data: { revoqueLe: new Date() },
    });
    effacerCookie(request, reply);
    await journaliser(request, "session.deconnexion");
    return { ok: true };
  });

  /// Mes sessions ouvertes : appareils connectés et jetons d'outils.
  app.get("/sessions", { preHandler: authenticate }, async (request) => {
    const sessions = await prisma.session.findMany({
      where: { userId: request.user.id, revoqueLe: null, expireLe: { gt: new Date() } },
      orderBy: { vuLe: "desc" },
      take: 100,
    });
    return sessions.map((x) => ({
      id: x.id,
      type: x.type,
      libelle: x.libelle,
      ip: x.ip,
      agent: x.agent,
      mfa: x.mfa,
      creeLe: x.creeLe,
      vuLe: x.vuLe,
      expireLe: x.expireLe,
      actuelle: x.id === request.session.id,
    }));
  });

  /// Fermer une de ses sessions (un téléphone perdu, un jeton d'outil).
  app.delete("/sessions/:id", { preHandler: authenticate }, async (request, reply) => {
    const { count } = await prisma.session.updateMany({
      where: { id: request.params.id, userId: request.user.id, revoqueLe: null },
      data: { revoqueLe: new Date() },
    });
    if (!count) return reply.code(404).send({ error: "Session introuvable" });
    if (request.params.id === request.session.id) effacerCookie(request, reply);
    await journaliser(request, "compte.session.fermeture");
    return { ok: true };
  });

  /// Un jeton pour un outil (serveur MCP, script) : montré une seule fois,
  /// révocable dans la liste des sessions. Il hérite du second facteur de
  /// la session qui le crée.
  app.post("/jetons", { preHandler: authenticate }, async (request, reply) => {
    const libelle = String(request.body?.libelle || "Jeton d'API").trim().slice(0, 80);
    const { token, session } = await ouvrirSession(request, reply, request.user, {
      type: "api",
      mfa: request.session.mfa,
      libelle,
    });
    await journaliser(request, "compte.jeton.creation", libelle);
    return { token, id: session.id, expireLe: session.expireLe };
  });

  // -------------------------------------------------------------------------
  // Double authentification
  // -------------------------------------------------------------------------

  app.get("/mfa", { preHandler: authenticate }, async (request) => ({
    actif: !!request.user.totpActif,
    exigee: mfaExigee(request.user),
    obligatoireEspace: !!request.user.tenant.mfaObligatoire,
    codesRestants: Array.isArray(request.user.codesSecours) ? request.user.codesSecours.length : 0,
  }));

  /// Étape 1 : un secret neuf, à scanner. Rien n'est actif tant qu'un
  /// premier code n'a pas été validé.
  app.post("/mfa/preparer", { preHandler: authenticate }, async (request, reply) => {
    if (request.user.totpActif) {
      return reply.code(409).send({ error: "La double authentification est déjà active." });
    }
    const secret = nouveauSecret();
    await prisma.user.update({
      where: { id: request.user.id },
      data: { totpSecret: chiffrer(secret), totpDernierPas: null },
    });
    return {
      secret,
      uri: uriOtpauth({ secret, compte: request.user.email, emetteur: "CompanyOS" }),
    };
  });

  /// Étape 2 : le premier code valide active la double authentification et
  /// rend les codes de secours — une seule fois. Les autres sessions,
  /// ouvertes sans second facteur, sont fermées.
  app.post("/mfa/activer", { preHandler: authenticate }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.id } });
    if (user.totpActif) {
      return reply.code(409).send({ error: "La double authentification est déjà active." });
    }
    const secret = dechiffrer(user.totpSecret);
    if (!secret) return reply.code(400).send({ error: "Recommencez la configuration." });
    const pas = verifierCode(secret, request.body?.code);
    if (pas === null) return reply.code(400).send({ error: "Code incorrect. Vérifiez l'heure du téléphone." });

    const codes = nouveauxCodesSecours();
    await prisma.user.update({
      where: { id: user.id },
      data: { totpActif: true, totpDernierPas: pas, codesSecours: codes.map(empreinteSecours) },
    });
    await prisma.session.update({ where: { id: request.session.id }, data: { mfa: true } });
    await revoquerSessions(user.id, { sauf: request.session.id });
    await journaliser(request, "compte.mfa.activation");
    return { ok: true, codesSecours: codes };
  });

  /// Nouveaux codes de secours (les anciens cessent de valoir). Exige un
  /// code de l'application.
  app.post("/mfa/codes", { preHandler: authenticate }, async (request, reply) => {
    if (!request.user.totpActif) return reply.code(409).send({ error: "Double authentification inactive." });
    if ((await verifierSecondFacteur(request.user, request.body?.code)) !== "totp") {
      return reply.code(400).send({ error: "Code incorrect." });
    }
    const codes = nouveauxCodesSecours();
    await prisma.user.update({
      where: { id: request.user.id },
      data: { codesSecours: codes.map(empreinteSecours) },
    });
    await journaliser(request, "compte.mfa.codes");
    return { codesSecours: codes };
  });

  /// Désactiver : mot de passe **et** code exigés — une session laissée
  /// ouverte ne suffit pas à retirer la protection.
  app.post("/mfa/desactiver", { preHandler: authenticate }, async (request, reply) => {
    if (!request.user.totpActif) return reply.code(409).send({ error: "Double authentification inactive." });
    if (mfaExigee(request.user)) {
      return reply.code(403).send({
        error: "La double authentification est obligatoire pour votre compte : elle ne peut pas être désactivée.",
      });
    }
    const motDePasse = await verifyPassword(String(request.body?.password || ""), request.user.passwordHash);
    if (!motDePasse || !(await verifierSecondFacteur(request.user, request.body?.code))) {
      return reply.code(401).send({ error: "Mot de passe ou code incorrect." });
    }
    await prisma.user.update({
      where: { id: request.user.id },
      data: { totpActif: false, totpSecret: null, totpDernierPas: null, codesSecours: null },
    });
    await journaliser(request, "compte.mfa.desactivation");
    return { ok: true };
  });

  /// Rendre la double authentification obligatoire dans l'espace. Réservé
  /// au propriétaire, qui doit l'avoir activée lui-même.
  app.put(
    "/tenant/securite",
    { preHandler: [authenticate, exigerRole("OWNER")] },
    async (request, reply) => {
      const obligatoire = request.body?.mfaObligatoire === true;
      if (obligatoire && !request.user.totpActif) {
        return reply.code(400).send({
          error: "Activez d'abord la double authentification sur votre propre compte.",
        });
      }
      await prisma.tenant.update({
        where: { id: request.tenantId },
        data: { mfaObligatoire: obligatoire },
      });
      await journaliser(request, "espace.mfa", obligatoire ? "obligatoire" : "facultative");
      return { ok: true, mfaObligatoire: obligatoire };
    },
  );

  /// Renommer son profil.
  app.put("/profile", { preHandler: authenticate }, async (request, reply) => {
    const parsed = z.object({ name: z.string().min(2).max(60) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Nom invalide" });
    }

    const user = await prisma.user.update({
      where: { id: request.user.id },
      data: { name: parsed.data.name.trim() },
    });

    await journaliser(request, "compte.renommage", user.name, {
      avant: request.user.name,
    });

    return serialize(profil(user));
  });

  /// Photo de profil.
  ///
  /// L'image arrive déjà redimensionnée et compressée par le navigateur
  /// (voir `redimensionnerImage` côté shell). On vérifie quand même ici :
  /// une route ne fait jamais confiance à ce qui la précède.
  app.put("/avatar", { preHandler: authenticate }, async (request, reply) => {
    const parsed = z
      .object({
        // null retire la photo et rend l'avatar aux initiales.
        avatar: z
          .string()
          .regex(/^data:image\/(png|jpeg|webp);base64,/, "Format d'image non reconnu")
          // ~200 Ko en base64. Au-delà, l'image n'a pas été redimensionnée :
          // la refuser vaut mieux que de la charger dans chaque liste.
          .max(280000, "Image trop lourde")
          .nullable(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }

    const user = await prisma.user.update({
      where: { id: request.user.id },
      data: { avatar: parsed.data.avatar },
    });

    await journaliser(
      request,
      parsed.data.avatar ? "compte.photo" : "compte.photo.retrait",
    );

    return serialize(profil(user));
  });

  /// Renommer l'espace de travail — réservé au propriétaire.
  app.put("/tenant", { preHandler: authenticate }, async (request, reply) => {
    if (request.user.role !== "OWNER") {
      return reply
        .code(403)
        .send({ error: "Seul le propriétaire peut renommer l'espace de travail" });
    }

    const parsed = z.object({ name: z.string().min(2).max(80) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Nom invalide" });
    }

    const avant = request.user.tenant?.name;
    const tenant = await prisma.tenant.update({
      where: { id: request.tenantId },
      data: { name: parsed.data.name.trim() },
    });

    await journaliser(request, "espace.renommage", tenant.name, { avant });

    return serialize({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      quota: tenant.quota,
      usedBytes: tenant.usedBytes,
    });
  });

  // -------------------------------------------------------------------------
  // Membres de l'espace de travail
  // -------------------------------------------------------------------------

  /// Liste des membres. Accessible à tous : assigner une tâche suppose de
  /// savoir à qui. Volontairement limitée à l'identité — jamais de mot de
  /// passe, jamais de trace d'activité.
  app.get("/members", { preHandler: authenticate }, async (request) =>
    serialize(
      await prisma.user.findMany({
        where: { tenantId: request.tenantId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          avatar: true,
          totpActif: true,
          createdAt: true,
        },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      }),
    ),
  );

  /// Un espace doit toujours garder au moins un propriétaire : sans cela,
  /// plus personne ne peut gérer les membres ni fermer l'espace.
  const proprietaires = (tenantId, client = prisma) =>
    client.user.count({ where: { tenantId, role: "OWNER" } });

  /// Un administrateur n'agit que sur un rang **strictement inférieur** au
  /// sien : un membre. Sans cette règle, un administrateur pouvait
  /// rétrograder, retirer ou déconnecter les autres administrateurs — et un
  /// seul compte compromis prenait l'espace en main. Le propriétaire, lui,
  /// agit sur tout le monde.
  const peutViser = (acteur, cible) =>
    acteur.role === "OWNER" || (cible.role === "MEMBER" && acteur.id !== cible.id);

  /// Le dernier propriétaire se vérifie **dans** la transaction qui le
  /// retire, en isolation sérialisable : deux propriétaires qui se
  /// rétrogradent l'un l'autre au même instant laissaient sinon l'espace
  /// sans aucun propriétaire.
  const sansDernierProprietaire = (tenantId, cible, operation) =>
    prisma.$transaction(
      async (tx) => {
        if (cible.role === "OWNER" && (await proprietaires(tenantId, tx)) <= 1) {
          throw Object.assign(new Error("dernier"), { code: "DERNIER_PROPRIETAIRE" });
        }
        return operation(tx);
      },
      { isolationLevel: "Serializable" },
    );

  const refusDernier = (reply, err) => {
    if (err?.code === "DERNIER_PROPRIETAIRE") {
      return reply.code(400).send({ error: "L'espace doit garder au moins un propriétaire." });
    }
    // Conflit de sérialisation : une autre modification est passée avant.
    if (err?.code === "P2034") {
      return reply.code(409).send({ error: "Modification concurrente : réessayez." });
    }
    throw err;
  };

  app.put(
    "/members/:id/role",
    { preHandler: [authenticate, exigerRole("ADMIN")] },
    async (request, reply) => {
      const parsed = z
        .object({ role: z.enum(["OWNER", "ADMIN", "MEMBER"]) })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Rôle invalide" });
      }
      const { role } = parsed.data;

      if (request.params.id === request.user.id) {
        return reply
          .code(400)
          .send({ error: "Vous ne pouvez pas changer votre propre rôle." });
      }

      // Nommer un propriétaire, c'est céder les clés : réservé au
      // propriétaire en place.
      if (role === "OWNER" && request.user.role !== "OWNER") {
        return reply
          .code(403)
          .send({ error: "Seul le propriétaire peut désigner un propriétaire." });
      }

      const cible = await prisma.user.findFirst({
        where: { id: request.params.id, tenantId: request.tenantId },
      });
      if (!cible) return reply.code(404).send({ error: "Membre introuvable" });

      if (cible.role === "OWNER" && role !== "OWNER") {
        if ((await proprietaires(request.tenantId)) <= 1) {
          return reply.code(400).send({
            error: "L'espace doit garder au moins un propriétaire.",
          });
        }
        if (request.user.role !== "OWNER") {
          return reply
            .code(403)
            .send({ error: "Seul le propriétaire peut rétrograder un propriétaire." });
        }
      }

      if (!peutViser(request.user, cible)) {
        return reply
          .code(403)
          .send({ error: "Seul le propriétaire peut modifier le rôle d'un administrateur." });
      }

      let maj;
      try {
        maj = await sansDernierProprietaire(
          request.tenantId,
          role === "OWNER" ? { role: "MEMBER" } : cible,
          (tx) =>
            tx.user.update({
              where: { id: cible.id },
              data: { role },
              select: { id: true, name: true, email: true, role: true, avatar: true },
            }),
        );
      } catch (err) {
        return refusDernier(reply, err);
      }

      await journaliser(request, "membre.role", cible.email, {
        avant: cible.role,
        apres: role,
        nom: cible.name,
      });

      return serialize(maj);
    },
  );

  /// Retirer un membre. Ses données restent : les fichiers et les
  /// enregistrements appartiennent à l'espace de travail, pas à la personne
  /// — sinon un départ emporterait les factures de l'entreprise.
  app.delete(
    "/members/:id",
    { preHandler: [authenticate, exigerRole("ADMIN")] },
    async (request, reply) => {
      if (request.params.id === request.user.id) {
        return reply
          .code(400)
          .send({ error: "Vous ne pouvez pas vous retirer vous-même." });
      }

      const cible = await prisma.user.findFirst({
        where: { id: request.params.id, tenantId: request.tenantId },
      });
      if (!cible) return reply.code(404).send({ error: "Membre introuvable" });

      if (cible.role === "OWNER" && (await proprietaires(request.tenantId)) <= 1) {
        return reply
          .code(400)
          .send({ error: "L'espace doit garder au moins un propriétaire." });
      }
      if (cible.role === "OWNER" && request.user.role !== "OWNER") {
        return reply
          .code(403)
          .send({ error: "Seul le propriétaire peut retirer un propriétaire." });
      }

      if (!peutViser(request.user, cible)) {
        return reply
          .code(403)
          .send({ error: "Seul le propriétaire peut retirer un administrateur." });
      }

      try {
        await sansDernierProprietaire(request.tenantId, cible, (tx) =>
          tx.user.delete({ where: { id: cible.id } }),
        );
      } catch (err) {
        return refusDernier(reply, err);
      }

      await journaliser(request, "membre.retrait", cible.email, {
        nom: cible.name,
        role: cible.role,
      });

      return reply.code(204).send();
    },
  );

  /// Déconnecter un membre de tous ses appareils, sans le retirer.
  ///
  /// Pour un poste partagé resté ouvert, un téléphone perdu, un départ en
  /// cours de préavis : l'accès se ferme tout de suite, les données et le
  /// rôle restent. Mêmes règles que pour les rôles — on ne vise pas un
  /// propriétaire sans l'être soi-même.
  app.post(
    "/members/:id/deconnexion",
    { preHandler: [authenticate, exigerRole("ADMIN")] },
    async (request, reply) => {
      const cible = await prisma.user.findFirst({
        where: { id: request.params.id, tenantId: request.tenantId },
      });
      if (!cible) return reply.code(404).send({ error: "Membre introuvable" });

      if (cible.id !== request.user.id && !peutViser(request.user, cible)) {
        return reply
          .code(403)
          .send({ error: "Seul le propriétaire peut déconnecter un administrateur." });
      }

      // Se viser soi-même revient à « déconnecter mes autres appareils » :
      // la session qui a fait la demande reste ouverte.
      await revoquerSessions(cible.id, cible.id === request.user.id ? { sauf: request.session.id } : {});
      await journaliser(request, "membre.deconnexion", cible.email, { nom: cible.name });
      return { ok: true };
    },
  );

  /// Réinitialiser la double authentification d'un membre (téléphone perdu
  /// **et** codes de secours égarés). Mêmes règles de rang que le reste ;
  /// toutes ses sessions sont fermées, il reconfigurera à la connexion.
  app.delete(
    "/members/:id/mfa",
    { preHandler: [authenticate, exigerRole("ADMIN")] },
    async (request, reply) => {
      const cible = await prisma.user.findFirst({
        where: { id: request.params.id, tenantId: request.tenantId },
      });
      if (!cible) return reply.code(404).send({ error: "Membre introuvable" });
      if (cible.id === request.user.id || !peutViser(request.user, cible)) {
        return reply.code(403).send({
          error: "Seul le propriétaire peut réinitialiser la double authentification d'un administrateur.",
        });
      }
      await prisma.user.update({
        where: { id: cible.id },
        data: { totpActif: false, totpSecret: null, totpDernierPas: null, codesSecours: null },
      });
      await revoquerSessions(cible.id);
      await journaliser(request, "membre.mfa.reinitialisation", cible.email, { nom: cible.name });
      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // Invitations
  // -------------------------------------------------------------------------

  /// Code court, lisible et dictable au téléphone. Pas de I, O, 0 ni 1 :
  /// ce sont les caractères qu'on confond en les lisant à voix haute.
  ///
  /// **Tiré par `randomInt`, jamais par `Math.random`.** Ce code vaut un
  /// mot de passe : l'accepter crée un compte dans l'espace d'une
  /// entreprise, avec le rôle que porte l'invitation — donc potentiellement
  /// ADMIN, donc les fichiers, la comptabilité et la paie. Or le générateur
  /// de V8 n'est pas cryptographique : son état interne se reconstitue à
  /// partir de quelques sorties observées. Un attaquant qui crée son propre
  /// espace et s'envoie une poignée d'invitations pourrait alors prédire
  /// les codes émis pour les autres espaces du même serveur.
  ///
  /// `randomInt` tire sans biais de modulo — 32 caractères divise 2^32, mais
  /// ne pas dépendre de cette coïncidence coûte le même nombre de lignes.
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const nouveauCode = () =>
    Array.from({ length: 3 }, () =>
      Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""),
    ).join("-");

  const INVITATION_JOURS = 14;

  app.get(
    "/invitations",
    { preHandler: [authenticate, exigerRole("ADMIN")] },
    async (request) =>
      serialize(
        await prisma.invitation.findMany({
          where: { tenantId: request.tenantId, acceptedAt: null },
          orderBy: { createdAt: "desc" },
        }),
      ),
  );

  app.post(
    "/invitations",
    { preHandler: [authenticate, exigerRole("ADMIN")] },
    async (request, reply) => {
      const parsed = z
        .object({
          email: z.string().email("Adresse e-mail invalide"),
          role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0].message });
      }

      const email = parsed.data.email.toLowerCase().trim();

      if (await prisma.user.findFirst({ where: { email, tenantId: request.tenantId } })) {
        return reply
          .code(409)
          .send({ error: "Cette personne fait déjà partie de l'espace." });
      }

      // La formule borne l'effectif : membres en place + invitations en
      // attente. Compter les invitations évite d'en émettre plus qu'il n'y
      // a de places — deux acceptations simultanées dépasseraient sinon la
      // limite sans que personne n'ait triché.
      const tenant = await prisma.tenant.findUnique({ where: { id: request.tenantId } });
      const formule = formuleDe(tenant.plan);
      if (formule.utilisateursMax !== null) {
        const [membres, enAttente] = await Promise.all([
          prisma.user.count({ where: { tenantId: request.tenantId } }),
          prisma.invitation.count({
            where: {
              tenantId: request.tenantId,
              acceptedAt: null,
              email: { not: email },
            },
          }),
        ]);
        if (membres + enAttente >= formule.utilisateursMax) {
          return reply.code(409).send({
            error: `La formule ${formule.nom} autorise ${formule.utilisateursMax} utilisateurs. Passez à une formule supérieure pour inviter davantage de monde.`,
          });
        }
      }

      // Réinviter quelqu'un remplace son code au lieu d'en empiler un
      // second : deux codes valides pour la même personne, c'est un code
      // qui reste actif après son arrivée.
      await prisma.invitation.deleteMany({
        where: { tenantId: request.tenantId, email, acceptedAt: null },
      });

      // Le code est unique en base. Une collision est très improbable
      // (32^12), mais « très improbable » finit par arriver et rendait
      // jusqu'ici une erreur 500 à un administrateur qui n'y est pour
      // rien : on retire simplement une autre fois.
      let invitation = null;
      for (let essai = 0; essai < 5 && !invitation; essai += 1) {
        try {
          invitation = await prisma.invitation.create({
            data: {
              tenantId: request.tenantId,
              email,
              role: parsed.data.role,
              code: nouveauCode(),
              createdById: request.user.id,
              expiresAt: new Date(Date.now() + INVITATION_JOURS * 86400000),
            },
          });
        } catch (erreur) {
          // P2002 = contrainte d'unicité. Toute autre erreur remonte.
          if (erreur?.code !== "P2002") throw erreur;
        }
      }
      if (!invitation) {
        return reply
          .code(503)
          .send({ error: "Impossible de générer un code d'invitation. Réessayez." });
      }

      await journaliser(request, "invitation.envoi", email, { role: parsed.data.role });

      // Le code part aussi par mail quand un relais SMTP est configuré.
      // Sinon — ou si l'envoi échoue — l'administrateur transmet le code
      // lui-même, comme avant : l'invitation n'attend pas le courrier.
      const contenu = mailInvitation({
        espace: request.user.tenant?.name || "votre entreprise",
        invitant: request.user.name,
        code: invitation.code,
        role: invitation.role,
        urlOs: env.urlPublique,
      });
      const mailEnvoye = await envoyerMail({ a: email, ...contenu });

      return reply.code(201).send(serialize({ ...invitation, mailEnvoye }));
    },
  );

  app.delete(
    "/invitations/:id",
    { preHandler: [authenticate, exigerRole("ADMIN")] },
    async (request, reply) => {
      const invitation = await prisma.invitation.findFirst({
        where: { id: request.params.id, tenantId: request.tenantId },
      });
      if (!invitation) return reply.code(404).send({ error: "Invitation introuvable" });

      await prisma.invitation.delete({ where: { id: invitation.id } });
      await journaliser(request, "invitation.annulation", invitation.email);

      return reply.code(204).send();
    },
  );

  /// Rejoindre un espace avec un code. Route publique : la personne
  /// invitée n'a pas encore de compte.
  app.post("/join", { config: LIMITE_SENSIBLE }, async (request, reply) => {
    const parsed = z
      .object({
        code: z.string().min(6),
        name: z.string().min(2, "Nom trop court").max(80),
        password: z.string().min(8, "Mot de passe : 8 caractères minimum"),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }

    const code = parsed.data.code.toUpperCase().replace(/\s/g, "");
    const invitation = await prisma.invitation.findUnique({ where: { code } });

    // Un seul message pour « inconnu », « déjà utilisé » et « expiré » :
    // distinguer les trois permettrait de deviner des codes valides.
    if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
      return reply.code(400).send({ error: "Code d'invitation invalide ou expiré." });
    }

    if (adresseReservee(request, normaliserEmail(invitation.email))) {
      return reply.code(400).send({ error: "Code d'invitation invalide ou expiré." });
    }

    if (await compteParEmail(invitation.email)) {
      return reply.code(409).send({
        error: "Un compte existe déjà avec cette adresse. Connectez-vous.",
      });
    }

    const user = await prisma.$transaction(async (tx) => {
      const cree = await tx.user.create({
        data: {
          tenantId: invitation.tenantId,
          email: invitation.email,
          name: parsed.data.name.trim(),
          passwordHash: await hashPassword(parsed.data.password),
          role: invitation.role,
        },
        include: { tenant: true },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      return cree;
    });

    await journaliserPour(request, user, "membre.arrivee", user.email, {
      role: user.role,
      nom: user.name,
    });

    await ouvrirSession(request, reply, user);

    return reply.code(201).send(
      serialize({
        user: profil(user),
        mfaAConfigurer: mfaExigee(user),
        tenant: {
          id: user.tenant.id,
          name: user.tenant.name,
          slug: user.tenant.slug,
          plan: user.tenant.plan,
          quota: user.tenant.quota,
          usedBytes: user.tenant.usedBytes,
        },
      }),
    );
  });

  app.get("/me", { preHandler: authenticate }, async (request) =>
    serialize({
      user: profil(request.user),
      mfaAConfigurer: !request.session.mfa && mfaExigee(request.user),
      mfaObligatoire: !!request.user.tenant.mfaObligatoire,
      tenant: {
        id: request.user.tenant.id,
        name: request.user.tenant.name,
        slug: request.user.tenant.slug,
        plan: request.user.tenant.plan,
        quota: request.user.tenant.quota,
        usedBytes: request.user.tenant.usedBytes,
      },
    }),
  );

  /// État personnel du shell. Un document JSON borné plutôt qu'une colonne
  /// par bouton : le bureau évolue plus vite que le schéma métier, tandis que
  /// la limite empêche d'utiliser cette route comme stockage de fichiers.
  app.get("/preferences", { preHandler: authenticate }, async (request) => ({
    preferences: request.user.preferences || {},
    updatedAt: request.user.updatedAt,
  }));

  app.put("/preferences", { preHandler: authenticate }, async (request, reply) => {
    const preferences = request.body?.preferences;
    if (!preferences || Array.isArray(preferences) || typeof preferences !== "object") {
      return reply.code(400).send({ error: "Préférences invalides." });
    }
    const taille = Buffer.byteLength(JSON.stringify(preferences), "utf8");
    if (taille > 100_000) {
      return reply.code(413).send({ error: "Les préférences dépassent 100 Ko." });
    }
    const user = await prisma.user.update({
      where: { id: request.user.id },
      data: { preferences },
      select: { updatedAt: true },
    });
    return { ok: true, updatedAt: user.updatedAt };
  });
}

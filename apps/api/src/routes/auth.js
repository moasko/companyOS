import { randomInt } from "node:crypto";
import { z } from "zod";
import { prisma, serialize } from "../db.js";
import { env } from "../env.js";
import {
  authenticate,
  compteParEmail,
  estExploitant,
  exigerRole,
  hashPassword,
  normaliserEmail,
  revoquerSessions,
  signToken,
  verifyPassword,
} from "../auth.js";
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

    return reply.code(201).send(
      serialize({
        token: signToken(user),
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
  app.post("/login", { config: LIMITE_SENSIBLE }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Données invalides" });
    }
    const { email, password } = parsed.data;

    const user = await compteParEmail(email, { include: { tenant: true } });
    // Message identique dans les deux cas : ne pas révéler quels e-mails existent.
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return reply.code(401).send({ error: "Identifiants incorrects" });
    }

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

    await journaliserPour(request, user, "session.connexion");

    return serialize({
      token: signToken(user),
      user: profil(user),
      tenant: {
        id: user.tenant.id,
        name: user.tenant.name,
        slug: user.tenant.slug,
        quota: user.tenant.quota,
        usedBytes: user.tenant.usedBytes,
      },
    });
  });

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
    const compte = await revoquerSessions(request.user.id);

    await journaliser(request, "compte.motdepasse");

    return { ok: true, token: signToken(compte) };
  });

  /// « Déconnecter tous mes appareils » : ferme toutes les sessions du
  /// compte, sauf celle qui fait la demande, qui reçoit un jeton neuf.
  app.post("/sessions/revoquer", { preHandler: authenticate }, async (request) => {
    const compte = await revoquerSessions(request.user.id);
    await journaliser(request, "compte.sessions.revocation");
    return { ok: true, token: signToken(compte) };
  });

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
          createdAt: true,
        },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      }),
    ),
  );

  /// Un espace doit toujours garder au moins un propriétaire : sans cela,
  /// plus personne ne peut gérer les membres ni fermer l'espace.
  const proprietaires = (tenantId) =>
    prisma.user.count({ where: { tenantId, role: "OWNER" } });

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

      const maj = await prisma.user.update({
        where: { id: cible.id },
        data: { role },
        select: { id: true, name: true, email: true, role: true, avatar: true },
      });

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

      await prisma.user.delete({ where: { id: cible.id } });

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

      if (cible.role === "OWNER" && request.user.role !== "OWNER") {
        return reply
          .code(403)
          .send({ error: "Seul le propriétaire peut déconnecter un propriétaire." });
      }

      const compte = await revoquerSessions(cible.id);
      await journaliser(request, "membre.deconnexion", cible.email, { nom: cible.name });

      // Se viser soi-même revient à « déconnecter mes autres appareils » :
      // la session qui a fait la demande reçoit de quoi continuer.
      return cible.id === request.user.id
        ? { ok: true, token: signToken(compte) }
        : { ok: true };
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

    return reply.code(201).send(
      serialize({
        token: signToken(user),
        user: profil(user),
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

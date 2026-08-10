// Courrier sortant des espaces de travail.
//
// Chaque espace branche **son** relais SMTP (réglages de l'app Courrier,
// rangés dans les paramètres de son installation) : les mails partent au
// nom de l'entreprise, depuis son domaine. À défaut, le relais de la
// plateforme sert de secours — s'il est configuré.
//
// L'envoi est ouvert à tous les membres : écrire à un client fait partie
// du travail. Les réglages, eux, sont d'administrateur — un mot de passe
// SMTP n'a rien à faire sous les yeux de tout le monde, et il ne ressort
// d'ailleurs jamais : on écrit par-dessus, on ne relit pas.
//
// Chaque envoi laisse une trace : une fiche dans l'historique du module
// (visible dans l'app) et une ligne au journal d'activité.

import { z } from "zod";
import { prisma, serialize } from "../db.js";
import { authenticate, exigerRole } from "../auth.js";
import { journaliser } from "../audit.js";
import { piloteLecture } from "../storage.js";
import { env } from "../env.js";
import { creerTransporteur, envoyerVia } from "../mail.js";
import { chiffrer } from "../chiffrement.js";
import { compterEnvois, messageQuotaAtteint, peutEnvoyer } from "../quota-mail.js";
import {
  adresseValide,
  adressesDe,
  adressesInvalides,
} from "@companyos/shared/courrier";

/// L'installation de l'app Courrier pour cet espace — c'est elle qui
/// porte les réglages SMTP.
const installationCourrier = async (tenantId) => {
  const app = await prisma.app.findFirst({
    where: { slug: "courrier", OR: [{ tenantId: null }, { tenantId }] },
  });
  if (!app) return null;
  return prisma.installation.findUnique({
    where: { tenantId_appId: { tenantId, appId: app.id } },
  });
};

const PIECE_JOINTE_MAX = 15 * 1024 * 1024; // 15 Mo : la limite des boîtes courantes.

/// Nombre de destinataires acceptés dans un même message (`a` et `cc`
/// comptés séparément). Au-delà, ce n'est plus du courrier : c'est un
/// envoi de masse, et il a son module, avec son suivi et son lien de
/// désinscription.
const DESTINATAIRES_MAX = 25;

/// Trente messages par quart d'heure et par personne. Un envoi manuel
/// demande d'écrire le message : personne n'en compose deux par minute
/// pendant un quart d'heure. Le plafond journalier de l'espace, lui, est
/// tenu par `quota-mail.js`.
const LIMITE_ENVOI = { rateLimit: { max: 30, timeWindow: "15 minutes" } };

export default async function courrierRoutes(app) {
  app.addHook("preHandler", authenticate);

  /// Les réglages SMTP de l'espace — sans le mot de passe. `defini` dit
  /// s'il en existe un ; `relaisPlateforme` si le secours global existe.
  app.get("/reglages", { preHandler: exigerRole("ADMIN") }, async (request) => {
    const installation = await installationCourrier(request.tenantId);
    const smtp = installation?.settings?.smtp || {};
    const relances = installation?.settings?.relances || {};
    return {
      host: smtp.host || "",
      port: smtp.port || 587,
      user: smtp.user || "",
      de: smtp.de || "",
      motDePasseDefini: Boolean(smtp.pass),
      relaisPlateforme: Boolean(env.smtpHost),
      relances: {
        actif: Boolean(relances.actif),
        paliers: relances.paliers?.length ? relances.paliers : [7, 15, 30],
        modeleId: relances.modeleId || "",
      },
    };
  });

  app.put("/reglages", { preHandler: exigerRole("ADMIN") }, async (request, reply) => {
    const parsed = z
      .object({
        host: z.string().trim(),
        port: z.coerce.number().int().min(1).max(65535).default(587),
        user: z.string().trim().default(""),
        // Vide = garder le mot de passe en place ; on ne force personne à
        // le ressaisir pour changer un port.
        pass: z.string().default(""),
        de: z.string().trim().default(""),
        // Relances automatiques de factures — voir src/relances.js.
        relances: z
          .object({
            actif: z.boolean().default(false),
            paliers: z.array(z.coerce.number().int().min(1).max(365)).max(6).default([7, 15, 30]),
            modeleId: z.string().default(""),
          })
          .optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }

    const installation = await installationCourrier(request.tenantId);
    if (!installation) {
      return reply
        .code(409)
        .send({ error: "Installez d'abord l'application Courrier." });
    }

    const actuel = installation.settings?.smtp || {};
    const smtp = {
      host: parsed.data.host,
      port: parsed.data.port,
      user: parsed.data.user,
      // Chiffré au repos, comme la clé S3 : une sauvegarde de base égarée
      // ne doit pas livrer le relais de messagerie de chaque client. Un
      // champ vide conserve l'existant, déjà chiffré — on ne le rechiffre
      // pas, ce serait chiffrer un chiffré.
      pass: parsed.data.pass ? chiffrer(parsed.data.pass) : actuel.pass || "",
      de: parsed.data.de,
    };
    const relances = parsed.data.relances
      ? {
          actif: parsed.data.relances.actif,
          paliers: [...new Set(parsed.data.relances.paliers)].sort((a, b) => a - b),
          modeleId: parsed.data.relances.modeleId,
        }
      : installation.settings?.relances;

    await prisma.installation.update({
      where: { id: installation.id },
      data: { settings: { ...installation.settings, smtp, ...(relances ? { relances } : {}) } },
    });
    await journaliser(request, "courrier.reglages", smtp.host || "relais retiré", {
      relances: relances?.actif ? `actives (J+${(relances.paliers || []).join(", J+")})` : "inactives",
    });
    return { ok: true };
  });

  /// Envoi d'un courriel, pièce jointe du cloud comprise.
  ///
  /// ───────────────────────────────────────────────────────────────────────
  /// CE QUE CETTE ROUTE NE DOIT PAS DEVENIR
  ///
  /// Un relais ouvert. Elle prend un destinataire, un sujet et un corps
  /// libres, et les remet à un vrai relais SMTP avec le nom de l'entreprise
  /// en expéditeur. Trois garde-fous, tous côté serveur :
  ///
  ///   1. les adresses sont validées ici — `adresseValide` existait déjà,
  ///      mais n'était appliquée que par l'écran, c'est-à-dire nulle part ;
  ///   2. le nombre de destinataires et la taille du message sont bornés ;
  ///   3. l'envoi passe par le compteur commun de `quota-mail.js`.
  ///
  /// Elle reste ouverte aux MEMBER : envoyer un courriel est le geste
  /// quotidien du module, l'interdire aux non-administrateurs reviendrait à
  /// donner ADMIN à tout le monde — ce qui supprimerait le contrôle plutôt
  /// que de l'appliquer.
  /// ───────────────────────────────────────────────────────────────────────
  app.post("/envoyer", { config: LIMITE_ENVOI }, async (request, reply) => {
    /// Une liste d'adresses séparées par des virgules, dont **chaque**
    /// entrée est une adresse valide. Nodemailer accepte la liste : sans
    /// cette vérification, `a` valait n'importe quelle chaîne de trois
    /// caractères et pouvait porter autant de destinataires qu'on voulait.
    const listeAdresses = (max, champ) =>
      z
        .string()
        .trim()
        .refine((v) => adressesDe(v).length > 0, `${champ} : aucune adresse valide.`)
        .refine(
          (v) => adressesDe(v).every(adresseValide),
          (v) => ({
            message: `${champ} : adresse invalide (${adressesInvalides(v).slice(0, 3).join(", ")}).`,
          }),
        )
        .refine(
          (v) => adressesDe(v).length <= max,
          `${champ} : ${max} destinataires au plus. Pour un envoi de masse, utilisez Campagnes.`,
        );

    const parsed = z
      .object({
        a: listeAdresses(DESTINATAIRES_MAX, "Destinataire"),
        cc: listeAdresses(DESTINATAIRES_MAX, "Copie").optional(),
        sujet: z.string().trim().min(1, "Le sujet est requis.").max(200, "Sujet trop long (200 caractères)."),
        texte: z.string().min(1, "Le message est vide.").max(100_000, "Message trop long."),
        // Jusqu'à cinq fichiers du cloud. `pieceJointeId` (singulier) reste
        // accepté pour les intégrations écrites avant le pluriel.
        piecesJointes: z.array(z.string()).max(5, "Cinq pièces jointes au plus.").optional(),
        pieceJointeId: z.string().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }
    const { a, cc, sujet, texte } = parsed.data;
    const idsPieces = [
      ...(parsed.data.piecesJointes || []),
      ...(parsed.data.pieceJointeId ? [parsed.data.pieceJointeId] : []),
    ].filter((id, i, l) => l.indexOf(id) === i);

    // Le plafond du jour est vérifié **avant** de lire les pièces jointes :
    // inutile de sortir 15 Mo du stockage pour un message qui ne partira pas.
    const destinataires = adressesDe(a).length + adressesDe(cc || "").length;
    if (!(await peutEnvoyer(request.tenantId, destinataires))) {
      return reply.code(429).send({ error: messageQuotaAtteint() });
    }

    // Le relais de l'espace d'abord, celui de la plateforme en secours.
    const installation = await installationCourrier(request.tenantId);
    const smtp = installation?.settings?.smtp;
    const transport = smtp?.host
      ? creerTransporteur(smtp)
      : creerTransporteur({
          host: env.smtpHost,
          port: env.smtpPort,
          user: env.smtpUser,
          pass: env.smtpPass,
        });
    if (!transport) {
      return reply.code(409).send({
        error:
          "Aucun relais SMTP configuré. Renseignez-le dans Courrier → Réglages.",
      });
    }

    // Pièces jointes : des fichiers du cloud de l'espace, vivants, et pas
    // plus de 15 Mo **à eux tous** — c'est le message entier que les
    // boîtes des destinataires plafonnent, pas chaque fichier.
    const piecesJointes = [];
    const nomsPieces = [];
    let totalOctets = 0n;
    for (const id of idsPieces) {
      const node = await prisma.fsNode.findFirst({
        where: { id, tenantId: request.tenantId, type: "FILE", deletedAt: null },
      });
      if (!node) {
        return reply.code(404).send({ error: "Pièce jointe introuvable." });
      }
      totalOctets += node.size;
      if (totalOctets > BigInt(PIECE_JOINTE_MAX)) {
        return reply
          .code(413)
          .send({ error: "Pièces jointes trop lourdes (15 Mo au total, maximum)." });
      }
      piecesJointes.push({
        filename: node.name,
        content: (await piloteLecture(node.storage, request.tenantId)).read(node.storageKey),
      });
      nomsPieces.push(node.name);
    }

    const de =
      smtp?.de ||
      `${request.user.tenant?.name || "CompanyOS"} <${smtp?.user || env.smtpUser || "no-reply@localhost"}>`;

    const resultat = await envoyerVia(transport, {
      de,
      a,
      cc,
      sujet,
      texte,
      piecesJointes: piecesJointes.length ? piecesJointes : undefined,
    });

    // Seuls les messages effectivement remis au relais consomment le
    // quota : un relais mal configuré épuiserait sinon le plafond de
    // l'espace sans qu'un seul courriel n'arrive, et l'administrateur
    // chercherait longtemps d'où vient le blocage.
    if (resultat.envoye) {
      await compterEnvois(request.tenantId, destinataires);
    }

    // L'historique dit aussi les échecs : un mail qu'on croit parti et
    // qui n'est jamais arrivé est le pire des silences.
    const fiche = await prisma.record.create({
      data: {
        tenantId: request.tenantId,
        userId: request.user.id,
        module: "courrier",
        collection: "envois",
        data: {
          a,
          cc: cc || null,
          sujet,
          // Le corps entier : le volet de lecture doit pouvoir relire le
          // message tel qu'il est parti, pas un extrait.
          texte,
          extrait: texte.slice(0, 160),
          pieces: nomsPieces,
          // L'ancien champ singulier, gardé pour les fiches déjà affichées.
          pieceJointe: nomsPieces[0] || null,
          envoye: resultat.envoye,
          erreur: resultat.erreur || null,
          date: new Date().toISOString(),
        },
      },
    });

    if (resultat.envoye) {
      await journaliser(request, "courrier.envoi", a, { sujet });
      return serialize({ envoye: true, id: fiche.id });
    }
    return reply.code(502).send({ error: `Envoi refusé : ${resultat.erreur}` });
  });
}

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
import { env } from "../env.js";
import { PORTS_SMTP } from "../mail.js";
import { chiffrer } from "../chiffrement.js";
import { envoyerCourriel } from "../courriels.js";
import { messagerieRoutes } from "./messagerie.js";

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
        port: z.coerce
          .number()
          .int()
          .refine((p) => PORTS_SMTP.includes(p), {
            message: `Port SMTP non autorisé (ports acceptés : ${PORTS_SMTP.join(", ")}).`,
          })
          .default(587),
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

  /// Envoi d'un courriel — l'ancienne forme (chaînes d'adresses, texte
  /// brut), gardée pour les intégrations. Passe par le même chemin que la
  /// messagerie : voir src/courriels.js.
  app.post("/envoyer", { config: LIMITE_ENVOI }, async (request, reply) => {
    const parsed = z
      .object({
        a: z.string().trim().min(3),
        cc: z.string().trim().optional(),
        sujet: z.string().trim().min(1, "Le sujet est requis.").max(200, "Sujet trop long (200 caractères)."),
        texte: z.string().min(1, "Le message est vide.").max(100_000, "Message trop long."),
        piecesJointes: z.array(z.string()).max(5, "Cinq pièces jointes au plus.").optional(),
        pieceJointeId: z.string().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });
    const d = parsed.data;
    try {
      const c = await envoyerCourriel({
        user: request.user,
        requete: request,
        message: {
          a: d.a,
          cc: d.cc || "",
          sujet: d.sujet,
          texte: d.texte,
          piecesIds: [...(d.piecesJointes || []), ...(d.pieceJointeId ? [d.pieceJointeId] : [])],
        },
      });
      if (c.statut !== "envoye") return reply.code(502).send({ error: `Envoi refusé : ${c.erreur}` });
      return serialize({ envoye: true, id: c.id });
    } catch (err) {
      return reply.code(err.statut || 500).send({ error: err.message });
    }
  });

  await messagerieRoutes(app);
}

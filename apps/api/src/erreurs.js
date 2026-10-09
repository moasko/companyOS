import { createHash } from "node:crypto";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { envoyerMail } from "./mail.js";

/// Journal des erreurs de la plateforme.
///
/// ─────────────────────────────────────────────────────────────────────────
/// POURQUOI
///
/// Une erreur 500 ne laissait de trace que dans les journaux du conteneur,
/// que personne ne lit — et une erreur du navigateur n'en laissait aucune.
/// L'exploitant apprenait les bogues par ses clients, quand ils prenaient
/// la peine d'écrire.
///
/// Chaque erreur est maintenant consignée en base, regroupée par empreinte,
/// lisible dans la console Plateforme ; une erreur **nouvelle** déclenche un
/// courriel aux exploitants, quand un relais SMTP est configuré.
///
/// Règle d'or : consigner ne doit jamais faire échouer quoi que ce soit.
/// Toutes les fonctions de ce fichier avalent leurs propres erreurs.
/// ─────────────────────────────────────────────────────────────────────────

const MAX_MESSAGE = 500;
const MAX_PILE = 8000;
const MAX_URL = 500;

/// Le message, débarrassé de ce qui change d'une occurrence à l'autre —
/// identifiants, nombres, chaînes entre guillemets — pour que la même
/// erreur garde la même empreinte.
const normaliser = (message) =>
  String(message || "")
    .replace(/\b[0-9a-f]{8,}\b/gi, "#")
    .replace(/\b[a-z0-9]{24,}\b/gi, "#")
    .replace(/\d+/g, "0")
    .replace(/(["'`«]).*?(["'`»])/g, "$1…$2")
    .slice(0, 200);

/// Le premier cadre de la pile qui pointe vers notre code : c'est lui qui
/// distingue deux « Cannot read properties of undefined » sans rapport.
const premierCadre = (pile) =>
  String(pile || "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("at ") && !l.includes("node_modules") && !l.includes("node:"))
    ?.replace(/:\d+:\d+\)?$/, "") || "";

export const empreinteDe = ({ source, message, pile }) =>
  createHash("sha1")
    .update(`${source}|${normaliser(message)}|${premierCadre(pile)}`)
    .digest("hex");

// Les alertes par courriel sont plafonnées : une panne qui produit cent
// erreurs différentes en une minute ne doit pas produire cent courriels.
const ALERTES_PAR_HEURE = 10;
let alertes = { api: [], web: [] };

/// Rapports **anonymes** (sans session) : la route est publique, donc
/// ouverte à n'importe quel script. Plafonds :
///   - empreintes nouvelles par heure, toutes IP confondues ;
///   - taille totale du journal — au-delà, plus rien d'anonyme n'entre.
/// Un rapport anonyme n'envoie pas d'alerte par courriel (le texte vient
/// de l'extérieur : ce serait offrir aux exploitants un message
/// d'hameçonnage), ne rouvre pas une erreur résolue et n'écrase pas
/// l'attribution d'une erreur déjà connue.
const ANONYMES_NOUVEAUX_PAR_HEURE = 100;
const JOURNAL_MAX_LIGNES = 20_000;
let anonymesNouveaux = [];

const alerter = async (erreur) => {
  if (!env.plateformeAdmins.length) return;
  const maintenant = Date.now();
  // Un budget par source : un navigateur qui invente dix erreurs par heure
  // ne doit pas faire taire les alertes du serveur.
  const pile = erreur.source === "api" ? "api" : "web";
  alertes[pile] = alertes[pile].filter((t) => maintenant - t < 3600_000);
  if (alertes[pile].length >= ALERTES_PAR_HEURE) return;
  alertes[pile].push(maintenant);

  const lien = env.urlPublique ? `\n\nConsole Plateforme : ${env.urlPublique}` : "";
  for (const a of env.plateformeAdmins) {
    await envoyerMail({
      a,
      sujet: `[CompanyOS] Nouvelle erreur ${erreur.source} : ${erreur.message.slice(0, 80)}`,
      texte:
        `Une erreur jamais vue jusqu'ici vient de se produire.\n\n` +
        `Source : ${erreur.source}\n` +
        `Message : ${erreur.message}\n` +
        (erreur.url ? `Adresse : ${erreur.url}\n` : "") +
        (erreur.pile ? `\n${erreur.pile.slice(0, 2000)}\n` : "") +
        lien,
    }).catch(() => {});
  }
};

/// Consigne une erreur. Ne lève jamais.
export const consigner = async ({ source, message, pile, url, tenantId, userId, details, anonyme = false }) => {
  try {
    const propre = {
      source: source === "web" ? "web" : "api",
      message: String(message || "Erreur sans message").slice(0, MAX_MESSAGE),
      pile: pile ? String(pile).slice(0, MAX_PILE) : null,
      url: url ? String(url).slice(0, MAX_URL) : null,
    };
    const empreinte = empreinteDe(propre);
    const maintenant = new Date();

    const existante = await prisma.erreurApp.findUnique({
      where: { empreinte },
      select: { id: true, resolue: true },
    });

    if (existante && anonyme) {
      await prisma.erreurApp.update({
        where: { id: existante.id },
        data: { occurrences: { increment: 1 }, derniere: maintenant },
      });
      return;
    }

    if (existante) {
      // Une erreur marquée résolue qui revient est une régression : elle
      // repasse en « à traiter » et mérite une nouvelle alerte.
      await prisma.erreurApp.update({
        where: { id: existante.id },
        data: {
          occurrences: { increment: 1 },
          derniere: maintenant,
          resolue: false,
          url: propre.url,
          tenantId: tenantId || null,
          userId: userId || null,
        },
      });
      if (existante.resolue) await alerter(propre);
      return;
    }

    if (anonyme) {
      const t = Date.now();
      anonymesNouveaux = anonymesNouveaux.filter((d) => t - d < 3600_000);
      if (anonymesNouveaux.length >= ANONYMES_NOUVEAUX_PAR_HEURE) return;
      if ((await prisma.erreurApp.count()) >= JOURNAL_MAX_LIGNES) return;
      anonymesNouveaux.push(t);
    }

    await prisma.erreurApp.create({
      data: {
        ...propre,
        empreinte,
        tenantId: tenantId || null,
        userId: userId || null,
        details: details ?? undefined,
      },
    });
    if (!anonyme) await alerter(propre);
  } catch (e) {
    // Deux créations simultanées de la même empreinte : la seconde perd la
    // course sur l'index unique. L'erreur est consignée, c'est l'essentiel.
    if (e?.code !== "P2002") console.error("Journal des erreurs indisponible :", e.message);
  }
};

/// Gestionnaire d'erreurs de Fastify.
///
/// Les erreurs 4xx — validation, droits, limitation de débit — sont des
/// réponses normales : renvoyées telles quelles, sans rien consigner.
///
/// Les 5xx sont consignées, et leur message **n'est plus renvoyé** au
/// client : il contenait parfois la requête Prisma entière, noms de
/// tables et de colonnes compris. Le client reçoit une phrase et une
/// référence, l'exploitant le détail.
export const gestionnaireErreurs = async (error, request, reply) => {
  const code = Number(error.statusCode) >= 400 ? Number(error.statusCode) : 500;

  if (code < 500) {
    return reply.code(code).send({
      statusCode: code,
      error: error.error || error.name || "Erreur",
      message: error.message,
      ...(error.validation ? { details: error.validation } : {}),
    });
  }

  request.log.error({ err: error }, "erreur serveur");
  await consigner({
    source: "api",
    message: error.message,
    pile: error.stack,
    url: `${request.method} ${request.routeOptions?.url || request.url}`,
    tenantId: request.tenantId,
    userId: request.user?.id,
  });

  return reply.code(500).send({
    statusCode: 500,
    error: "Erreur interne",
    message: "Une erreur interne est survenue. Elle a été signalée à l'équipe technique.",
  });
};

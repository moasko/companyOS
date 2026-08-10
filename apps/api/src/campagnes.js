// Le moteur des campagnes d'e-mail marketing.
//
// ─────────────────────────────────────────────────────────────────────────
// ENVOYER BEAUCOUP, SANS SE FAIRE GRILLER
//
// Un relais SMTP juge un expéditeur à sa cadence : cent messages en une
// seconde, c'est un spammeur. Le moteur passe donc régulièrement, prend
// les campagnes mûres (statut « programmée », heure atteinte) et les
// avance **par petits lots** — huit messages par passage, une pause entre
// chaque. Une campagne de deux cents clients s'étale ainsi sur une petite
// heure : invisible pour l'expéditeur, respectueux pour le relais.
//
// Chaque message porte son lien de désinscription, signé : personne ne
// peut désinscrire quelqu'un d'autre en devinant une adresse. Un
// désinscrit est marqué sur sa fiche CRM — aucune campagne future ne le
// touchera (voir audienceDe, côté domaine).
// ─────────────────────────────────────────────────────────────────────────

import { createHmac } from "node:crypto";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { creerTransporteur, envoyerVia } from "./mail.js";
import { journaliser } from "./audit.js";
import { appliquerModele } from "@companyos/shared/courrier";
import {
  estMure,
  htmlDe,
  resumeDe,
  variablesPour,
} from "@companyos/shared/campagnes";

const LOT = 8; // messages par passage et par campagne
const PAUSE_MS = 700; // entre deux messages d'un lot

// ---------------------------------------------------------------------------
// Désinscription signée
// ---------------------------------------------------------------------------

const signer = (corps) =>
  createHmac("sha256", env.jwtSecret).update(corps).digest("hex").slice(0, 24);

/// Le jeton de suivi : espace, campagne, fiche client — signé. Le même
/// jeton sert à l'ouverture (pixel), au clic (redirection) et à la
/// désinscription : trois routes, une seule preuve.
export const jetonSuivi = (tenantId, campagneId, clientId) => {
  const corps = `${tenantId}.${campagneId}.${clientId}`;
  return Buffer.from(`${corps}.${signer(corps)}`).toString("base64url");
};

/// Vérifie un jeton — le format à trois champs, et l'ancien à deux
/// (désinscriptions envoyées avant le suivi) pour que les vieux liens
/// restent honorés.
export const verifierJeton = (jeton) => {
  try {
    const morceaux = Buffer.from(jeton, "base64url").toString().split(".");
    if (morceaux.length === 4) {
      const [tenantId, campagneId, clientId, signature] = morceaux;
      return signature === signer(`${tenantId}.${campagneId}.${clientId}`)
        ? { tenantId, campagneId, clientId }
        : null;
    }
    const [tenantId, clientId, signature] = morceaux;
    return signature === signer(`${tenantId}.${clientId}`)
      ? { tenantId, campagneId: null, clientId }
      : null;
  } catch {
    return null;
  }
};

const baseApi = () => env.apiPublique || `http://localhost:${env.port}`;

const liens = (tenantId, campagneId, clientId) => {
  const jeton = jetonSuivi(tenantId, campagneId, clientId);
  return {
    desinscription: `${baseApi()}/api/campagnes/desinscription?jeton=${jeton}`,
    pixel: `${baseApi()}/api/campagnes/ouverture?jeton=${jeton}`,
    clic: `${baseApi()}/api/campagnes/clic?jeton=${jeton}`,
  };
};

/// Marque un destinataire d'une campagne — ouvert, cliqué, désinscrit.
/// Silencieux si la campagne ou le destinataire n'existe plus : un pixel
/// chargé deux ans après ne doit casser personne.
export const marquerDestinataire = async ({ tenantId, campagneId, clientId }, marque) => {
  if (!campagneId) return;
  const fiche = await prisma.record.findFirst({
    where: { id: campagneId, tenantId, module: "campagnes", collection: "campagnes" },
  });
  if (!fiche) return;
  const destinataires = fiche.data.destinataires || [];
  const dest = destinataires.find((d) => d.clientId === clientId);
  if (!dest || dest[marque]) return;
  dest[marque] = true;
  dest[`${marque}Le`] = new Date().toISOString();
  await prisma.record.update({
    where: { id: fiche.id },
    data: { data: { ...fiche.data, destinataires } },
  });
};

/// L'URL du bouton d'une campagne — relue depuis la fiche, jamais depuis
/// la requête : pas de redirection ouverte possible.
export const urlCtaDe = async ({ tenantId, campagneId }) => {
  if (!campagneId) return null;
  const fiche = await prisma.record.findFirst({
    where: { id: campagneId, tenantId, module: "campagnes", collection: "campagnes" },
  });
  const url = fiche?.data?.cta?.url;
  return url && /^https?:\/\//i.test(url) ? url : null;
};

// ---------------------------------------------------------------------------
// Le passage du moteur
// ---------------------------------------------------------------------------

const transporteurDe = async (tenantId) => {
  const app = await prisma.app.findFirst({ where: { slug: "courrier", tenantId: null } });
  const installation = app
    ? await prisma.installation.findUnique({
        where: { tenantId_appId: { tenantId, appId: app.id } },
      })
    : null;
  const smtp = installation?.settings?.smtp;
  return {
    transport: smtp?.host
      ? creerTransporteur(smtp)
      : creerTransporteur({
          host: env.smtpHost,
          port: env.smtpPort,
          user: env.smtpUser,
          pass: env.smtpPass,
        }),
    de: smtp?.de || null,
    smtpUser: smtp?.user || env.smtpUser,
  };
};

/// Avance toutes les campagnes mûres d'un lot. Renvoie le nombre de
/// messages partis — les tests s'en servent.
export const passerLesCampagnes = async () => {
  const fiches = await prisma.record.findMany({
    where: { module: "campagnes", collection: "campagnes" },
  });
  const maintenant = new Date().toISOString();
  let partis = 0;

  for (const fiche of fiches) {
    const c = fiche.data;
    if (!(estMure(c, maintenant) || c.statut === "envoi")) continue;

    try {
      partis += await avancerCampagne(fiche);
    } catch (err) {
      console.error(`Campagne ${fiche.id} en échec :`, err.message);
    }
  }
  return partis;
};

const avancerCampagne = async (fiche) => {
  const { tenantId } = fiche;
  const c = { ...fiche.data };
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const { transport, de, smtpUser } = await transporteurDe(tenantId);
  if (!transport) return 0; // pas de relais : la campagne attend, sans rien perdre

  const expediteur = de || `${tenant.name} <${smtpUser || "no-reply@localhost"}>`;
  const enAttente = c.destinataires.filter((d) => d.statut === "attente").slice(0, LOT);
  let partis = 0;

  for (const dest of enAttente) {
    const variables = variablesPour(dest, tenant.name);
    const suivi = liens(tenantId, fiche.id, dest.clientId);
    const sujet = appliquerModele(c.sujet, variables);
    const corps = appliquerModele(c.texte, variables);

    // Version texte pour les clients mail austères, version HTML habillée
    // — bandeau, bouton suivi, pixel d'ouverture — pour tous les autres.
    const texte =
      corps +
      (c.cta?.url ? `\n\n${c.cta.label || c.cta.url} : ${c.cta.url}` : "") +
      `\n\n—\nPour ne plus recevoir ces messages de ${tenant.name} :\n${suivi.desinscription}`;
    const html = htmlDe(
      { ...c, texte: corps },
      {
        entreprise: tenant.name,
        lienCta: c.cta?.url ? suivi.clic : "",
        lienDesinscription: suivi.desinscription,
        pixel: suivi.pixel,
      },
    );

    const resultat = await envoyerVia(transport, {
      de: expediteur,
      a: dest.email,
      sujet,
      texte,
      html,
    });
    dest.statut = resultat.envoye ? "envoye" : "echec";
    dest.erreur = resultat.erreur || null;
    if (resultat.envoye) partis += 1;

    // La pause qui fait la différence entre un expéditeur et un spammeur.
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  const bilan = resumeDe(c.destinataires);
  c.statut = bilan.attente === 0 ? "terminee" : "envoi";
  if (c.statut === "terminee") c.termineeLe = new Date().toISOString();

  await prisma.record.update({ where: { id: fiche.id }, data: { data: c } });

  if (c.statut === "terminee") {
    const user = await prisma.user.findUnique({ where: { id: fiche.userId } }).catch(() => null);
    if (user) {
      await journaliser({ user, headers: {} }, "campagne.terminee", c.nom, {
        envoyes: bilan.envoyes,
        echecs: bilan.echecs,
      });
    }
  }
  return partis;
};

/// Démarre le moteur : un premier passage rapide, puis toutes les
/// quarante-cinq secondes — huit messages par campagne et par passage.
export const demarrerCampagnes = () => {
  setTimeout(() => passerLesCampagnes().catch(() => {}), 20 * 1000);
  setInterval(() => passerLesCampagnes().catch(() => {}), 45 * 1000);
};

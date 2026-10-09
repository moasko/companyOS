// Le moteur des campagnes et des automatisations d'e-mail marketing.
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
// À chaque passage aussi :
//   • le test A/B est tranché quand son délai est écoulé (decisionAB) ;
//   • les automatisations font entrer les nouveaux clients concernés et
//     écrivent à ceux dont le tour est venu ;
//   • un rebond définitif (adresse inexistante) suspend l'adresse dans le
//     CRM ; un rebond temporaire (boîte pleine) est réessayé plus tard.
//
// Chaque message porte son lien de désinscription signé, et les en-têtes
// List-Unsubscribe que Gmail et Outlook exigent des envois de masse.
// ─────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { creerTransporteur, creerTransporteurEspace, envoyerVia } from "./mail.js";
import { journaliser } from "./audit.js";
import { compterEnvois, resteAEnvoyer } from "./quota-mail.js";
import { adresseValide } from "@companyos/shared/courrier";
import {
  ESSAIS_MAX,
  HEURES_ENTRE_ESSAIS,
  classerErreur,
  decisionAB,
  echeances,
  estMure,
  htmlDe,
  inscrire,
  liensDe,
  personnaliser,
  resumeDe,
  sujetPour,
  texteDe,
  variablesPour,
} from "@companyos/shared/campagnes";

const LOT = 8; // messages par passage et par campagne
const PAUSE_MS = 700; // entre deux messages d'un lot

// ---------------------------------------------------------------------------
// Jetons signés
// ---------------------------------------------------------------------------

const signer = (corps) =>
  createHmac("sha256", env.jwtSecret).update(corps).digest("hex").slice(0, 24);

/// Compare deux signatures en temps constant : `===` s'arrête au premier
/// caractère différent, et la durée de la réponse trahit alors combien de
/// caractères sont justes.
export const signatureEgale = (recue, attendue) => {
  const a = Buffer.from(String(recue ?? ""));
  const b = Buffer.from(String(attendue));
  return a.length === b.length && timingSafeEqual(a, b);
};

/// Le jeton de suivi : espace, campagne (ou automatisation), fiche client
/// — signé. Le même jeton sert à l'ouverture (pixel), aux clics
/// (redirection) et à la désinscription.
export const jetonSuivi = (tenantId, campagneId, clientId) => {
  const corps = `${tenantId}.${campagneId}.${clientId}`;
  return Buffer.from(`${corps}.${signer(corps)}`).toString("base64url");
};

/// Vérifie un jeton — le format à trois champs, et l'ancien à deux
/// (désinscriptions envoyées avant le suivi) pour que les vieux liens
/// restent honorés.
export const verifierJeton = (jeton) => {
  try {
    const morceaux = Buffer.from(String(jeton), "base64url").toString().split(".");
    if (morceaux.length === 4) {
      const [tenantId, campagneId, clientId, signature] = morceaux;
      // Un jeton de confirmation d'inscription a la même forme : il ne
      // vaut pas jeton de suivi.
      if (campagneId === "confirmer") return null;
      return signatureEgale(signature, signer(`${tenantId}.${campagneId}.${clientId}`))
        ? { tenantId, campagneId, clientId }
        : null;
    }
    const [tenantId, clientId, signature] = morceaux;
    if (morceaux.length !== 3) return null;
    return signatureEgale(signature, signer(`${tenantId}.${clientId}`))
      ? { tenantId, campagneId: null, clientId }
      : null;
  } catch {
    return null;
  }
};

const baseApi = () => env.apiPublique || `http://localhost:${env.port}`;

/// Le logo de l'espace, servi aux boîtes de réception.
export const signatureLogo = (tenantId) => signer(`logo.${tenantId}`);
const urlLogo = (tenantId) => `${baseApi()}/api/campagnes/logo?e=${tenantId}&s=${signatureLogo(tenantId)}`;

/// Une image du Cloud posée dans un message. Le Cloud est privé : on sert
/// cette image-là, et elle seule, par une adresse signée.
export const signatureImage = (tenantId, nodeId) => signer(`image.${tenantId}.${nodeId}`);
const urlImage = (tenantId) => (bloc) =>
  bloc.nodeId
    ? `${baseApi()}/api/campagnes/image?e=${tenantId}&f=${bloc.nodeId}&s=${signatureImage(tenantId, bloc.nodeId)}`
    : bloc.url;

/// Le formulaire d'inscription public d'un espace.
export const signatureFormulaire = (tenantId) => signer(`inscription.${tenantId}`);
export const urlFormulaire = (tenantId) => `${baseApi()}/api/campagnes/inscription?e=${tenantId}&s=${signatureFormulaire(tenantId)}`;
export const jetonConfirmation = (tenantId, clientId) => {
  const corps = `${tenantId}.confirmer.${clientId}`;
  return Buffer.from(`${corps}.${signer(corps)}`).toString("base64url");
};
export const verifierConfirmation = (jeton) => {
  try {
    const [tenantId, mot, clientId, signature] = Buffer.from(String(jeton), "base64url").toString().split(".");
    return mot === "confirmer" && signatureEgale(signature, signer(`${tenantId}.confirmer.${clientId}`)) ? { tenantId, clientId } : null;
  } catch {
    return null;
  }
};

/// La fiche de l'entreprise (Paramètres › Fiche de l'entreprise).
export const ficheEntreprise = async (tenantId) => {
  const fiche = await prisma.record.findFirst({
    where: { tenantId, module: "entreprise", collection: "profil" },
    orderBy: { createdAt: "asc" },
  });
  return fiche?.data || {};
};

/// Le pied légal d'un message commercial : qui écrit, d'où, sous quel
/// identifiant fiscal.
export const piedDe = (e = {}, nom = "") =>
  [
    e.nom || nom,
    [e.adresse, e.ville].filter(Boolean).join(", "),
    e.ncc ? `NCC ${e.ncc}` : "",
    e.telephone || "",
  ].filter(Boolean).join(" · ");

const liens = (tenantId, campagneId, clientId) => {
  const jeton = jetonSuivi(tenantId, campagneId, clientId);
  return {
    desinscription: `${baseApi()}/api/campagnes/desinscription?jeton=${jeton}`,
    pixel: `${baseApi()}/api/campagnes/ouverture?jeton=${jeton}`,
    clic: (i) => `${baseApi()}/api/campagnes/clic?jeton=${jeton}&l=${i}`,
  };
};

// ---------------------------------------------------------------------------
// Suivi : ouvertures, clics, désinscriptions
// ---------------------------------------------------------------------------

/// La fiche (campagne ou automatisation) désignée par un jeton, et la
/// liste de personnes qu'elle suit.
const ficheSuivie = async ({ tenantId, campagneId }) => {
  if (!campagneId) return null;
  const fiche = await prisma.record.findFirst({
    where: { id: campagneId, tenantId, module: "campagnes", collection: { in: ["campagnes", "automatisations"] } },
  });
  if (!fiche) return null;
  return { fiche, cle: fiche.collection === "campagnes" ? "destinataires" : "inscrits" };
};

/// Une ouverture dans les deux secondes de l'envoi n'est pas un humain :
/// c'est un antivirus ou un robot de messagerie qui précharge les images.
const OUVERTURE_ROBOT_MS = 2000;

/// Marque un destinataire — ouvert, cliqué (avec le numéro du lien),
/// désinscrit. Silencieux si la fiche n'existe plus : un pixel chargé deux
/// ans après ne doit casser personne.
export const marquerDestinataire = async (infos, marque, { lien = null } = {}) => {
  const trouvee = await ficheSuivie(infos);
  if (!trouvee) return;
  const { fiche, cle } = trouvee;
  const liste = fiche.data[cle] || [];
  // Une automatisation peut avoir écrit plusieurs fois au même client : le
  // dernier message envoyé est celui qu'il lit.
  const candidats = liste.filter((d) => d.clientId === infos.clientId && (cle === "destinataires" || d.statut === "envoye"));
  const dest = candidats[candidats.length - 1];
  if (!dest) return;
  const maintenant = new Date();
  if (marque === "ouvert" && dest.envoyeLe && maintenant - new Date(dest.envoyeLe) < OUVERTURE_ROBOT_MS) return;
  let change = false;
  if (!dest[marque]) {
    dest[marque] = true;
    dest[`${marque}Le`] = maintenant.toISOString();
    change = true;
  }
  if (marque === "clique" && Number.isInteger(lien) && lien >= 0 && lien < liensDe(fiche.data).length) {
    dest.liens = [...new Set([...(dest.liens || []), lien])];
    change = true;
  }
  if (!change) return;
  await prisma.record.update({
    where: { id: fiche.id },
    data: { data: { ...fiche.data, [cle]: liste } },
  });
};

/// L'adresse du i-ème lien d'un message — relue depuis la fiche, jamais
/// depuis la requête : pas de redirection ouverte possible.
export const urlLienDe = async (infos, i = 0) => {
  const trouvee = await ficheSuivie(infos);
  if (!trouvee) return null;
  // Seul un vrai destinataire de ce message est redirigé. Sinon,
  // n'importe quel espace fabriquait une redirection vers son site de
  // hameçonnage depuis le domaine de la plateforme, avec un jeton obtenu
  // en s'écrivant à lui-même.
  const liste = trouvee.fiche.data?.[trouvee.cle] || [];
  if (!liste.some((d) => d.clientId === infos.clientId)) return null;
  const tous = liensDe(trouvee.fiche.data);
  const l = tous[Number.isInteger(i) && i >= 0 ? i : 0] || tous[0];
  return l && /^(https?:|mailto:|tel:)/i.test(l.url) ? l.url : null;
};
export const urlCtaDe = (infos) => urlLienDe(infos, 0);

// ---------------------------------------------------------------------------
// Rendu et envoi d'un message
// ---------------------------------------------------------------------------

const transporteurDe = async (tenantId) => {
  const app = await prisma.app.findFirst({ where: { slug: "courrier", tenantId: null } });
  const installation = app
    ? await prisma.installation.findUnique({
        where: { tenantId_appId: { tenantId, appId: app.id } },
      })
    : null;
  const smtp = installation?.settings?.smtp;

  // **Le relais de la plateforme est exclu des campagnes**, et c'est
  // délibéré : une campagne part à des centaines d'adresses choisies par
  // le client. La faire sortir par l'IP commune, c'est confier la
  // réputation d'envoi de tous les espaces au moins prudent d'entre eux.
  //
  // Sans relais propre, la campagne **attend** au lieu de partir : rien
  // n'est perdu, elle repartira dès qu'un relais sera configuré.
  return {
    transport: smtp?.host ? creerTransporteurEspace(smtp) : null,
    de: smtp?.de || null,
    smtpUser: smtp?.user || null,
  };
};

/// Le contexte d'envoi d'un espace : relais, expéditeur, entreprise.
const contexteEnvoi = async (tenantId) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const { transport, de, smtpUser } = await transporteurDe(tenantId);
  const entreprise = await ficheEntreprise(tenantId);
  return {
    tenantId,
    tenant,
    transport,
    expediteur: de || `${tenant?.name || "CompanyOS"} <${smtpUser || "no-reply@localhost"}>`,
    entreprise,
    nomEntreprise: entreprise.nom || tenant?.name || "",
    pied: piedDe(entreprise, tenant?.name || ""),
  };
};

/// Le message d'une personne : objet, HTML, texte, en-têtes. `suivi` à
/// faux pour un test — ni pixel ni redirection.
export const rendreMessage = (ctx, message, dest, { ficheId = "", suivi = true, extra = {} } = {}) => {
  const variables = { ...variablesPour(dest, ctx.nomEntreprise), ...extra };
  const p = personnaliser({ ...message, sujet: sujetPour(message, dest) }, variables);
  const l = suivi ? liens(ctx.tenantId, ficheId, dest.clientId) : null;
  const lien = l ? (i) => l.clic(i) : (_i, url) => url;
  const options = {
    entreprise: ctx.nomEntreprise,
    lien,
    image: urlImage(ctx.tenantId),
    logo: ctx.entreprise.logo ? urlLogo(ctx.tenantId) : "",
    pied: ctx.pied,
    lienDesinscription: l?.desinscription || "",
    pixel: l?.pixel || "",
  };
  return {
    sujet: p.sujet,
    html: htmlDe(p, options),
    texte: texteDe(p, options),
    entetes: l
      ? {
          // RFC 8058 : le bouton « Se désinscrire » de Gmail et d'Outlook,
          // en un clic, sans ouvrir le message.
          "List-Unsubscribe": `<${l.desinscription}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        }
      : undefined,
  };
};

/// Envoie un message et classe l'échec. Renvoie { envoye, erreur, rebond }.
const envoyerA = async (ctx, dest, rendu) => {
  const r = await envoyerVia(ctx.transport, { de: ctx.expediteur, a: dest.email, sujet: rendu.sujet, texte: rendu.texte, html: rendu.html, entetes: rendu.entetes });
  return { ...r, rebond: r.envoye ? null : classerErreur(r.erreur) };
};

/// Après un rebond définitif, l'adresse est suspendue dans le CRM : plus
/// aucune campagne ni automatisation ne l'utilisera.
const suspendreAdresse = async (tenantId, clientId, erreur) => {
  const client = await prisma.record.findFirst({ where: { id: clientId, tenantId, module: "crm", collection: "clients" } });
  if (!client || client.data.emailRebond) return;
  await prisma.record.update({
    where: { id: client.id },
    data: { data: { ...client.data, emailRebond: true, emailRebondLe: new Date().toISOString(), emailRebondRaison: String(erreur || "").slice(0, 200) } },
  });
};

/// Applique le résultat d'un envoi à une personne suivie.
const appliquerResultat = async (ctx, dest, r) => {
  const maintenant = new Date();
  if (r.envoye) {
    dest.statut = "envoye";
    dest.erreur = null;
    dest.envoyeLe = maintenant.toISOString();
    return;
  }
  dest.erreur = r.erreur || null;
  if (r.rebond === "temporaire" && (dest.essais || 0) + 1 < ESSAIS_MAX) {
    dest.essais = (dest.essais || 0) + 1;
    dest.reessayerApres = new Date(maintenant.getTime() + HEURES_ENTRE_ESSAIS * 3600000).toISOString();
    return; // reste « attente »
  }
  dest.statut = "echec";
  if (r.rebond) dest.rebond = r.rebond;
  if (r.rebond === "definitif" && dest.clientId) await suspendreAdresse(ctx.tenantId, dest.clientId, r.erreur);
};

// ---------------------------------------------------------------------------
// Les destinataires que le moteur accepte réellement de servir
// ---------------------------------------------------------------------------
//
// Une campagne est une fiche `Record` : rien n'oblige à passer par l'écran
// pour l'écrire. Sans revalidation, une fiche aux destinataires choisis
// ferait partir des messages au nom de l'entreprise, avec un relais
// SPF/DKIM valide en garantie — le phishing le plus crédible qui soit.
//
// La règle : on n'écrit qu'à une adresse valide, connue du CRM **du même
// espace**, ni désinscrite, ni en rebond, ni en attente de confirmation.
const destinatairesServables = async (tenantId, destinataires, maintenant) => {
  const candidats = destinataires.filter(
    (d) => d.statut === "attente" && adresseValide(d.email || "") && !(d.reessayerApres && d.reessayerApres > maintenant),
  );
  if (!candidats.length) return [];
  const clients = await prisma.record.findMany({
    where: {
      tenantId,
      module: "crm",
      collection: "clients",
      id: { in: [...new Set(candidats.map((d) => d.clientId).filter(Boolean))] },
    },
  });
  const connues = new Map(
    clients
      .filter((f) => !f.data?.emailDesinscrit && !f.data?.emailRebond && !f.data?.emailAConfirmer)
      .map((f) => [String(f.data?.email || "").toLowerCase(), f]),
  );
  return candidats.filter((d) => connues.has(String(d.email).toLowerCase()));
};

// ---------------------------------------------------------------------------
// Campagnes
// ---------------------------------------------------------------------------

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
  const maintenant = new Date().toISOString();
  // Le test A/B : son délai écoulé, le gagnant part aux autres.
  let c = decisionAB(fiche.data, maintenant) || { ...fiche.data };
  const ctx = await contexteEnvoi(tenantId);
  if (!ctx.transport) {
    if (c !== fiche.data) await prisma.record.update({ where: { id: fiche.id }, data: { data: c } });
    return 0; // pas de relais : la campagne attend, sans rien perdre
  }
  // Le plafond de l'espace, tous chemins d'envoi confondus. Atteint, la
  // campagne attend demain au lieu d'échouer.
  const reste = await resteAEnvoyer(tenantId);
  if (reste <= 0) return 0;

  c = { ...c, destinataires: [...(c.destinataires || [])] };
  const servables = await destinatairesServables(tenantId, c.destinataires, maintenant);
  const enAttente = servables.slice(0, Math.min(LOT, reste));
  let partis = 0;

  // Les destinataires écartés sont marqués une fois pour toutes.
  for (const dest of c.destinataires) {
    if (dest.statut !== "attente" || servables.includes(dest) || (dest.reessayerApres && dest.reessayerApres > maintenant)) continue;
    dest.statut = "echec";
    dest.erreur = adresseValide(dest.email || "")
      ? "Destinataire absent du CRM de l'espace, désinscrit ou en rebond."
      : "Adresse invalide.";
  }

  for (const dest of enAttente) {
    const r = await envoyerA(ctx, dest, rendreMessage(ctx, c, dest, { ficheId: fiche.id }));
    await appliquerResultat(ctx, dest, r);
    if (r.envoye) partis += 1;
    // La pause qui fait la différence entre un expéditeur et un spammeur.
    await new Promise((res) => setTimeout(res, PAUSE_MS));
  }
  if (partis) await compterEnvois(tenantId, partis);

  // Relue juste avant d'écrire : une mise en pause décidée pendant le lot
  // l'emporte, et les ouvertures arrivées entre-temps ne sont pas perdues.
  const fraiche = await prisma.record.findUnique({ where: { id: fiche.id } });
  if (!fraiche) return partis;
  const parCle = new Map((fraiche.data.destinataires || []).map((d) => [d.clientId, d]));
  c.destinataires = c.destinataires.map((d) => {
    const f = parCle.get(d.clientId);
    if (!f) return d;
    // Les marques de lecture viennent de la fiche fraîche, l'état d'envoi
    // de ce passage.
    return { ...d, ouvert: f.ouvert || d.ouvert, ouvertLe: f.ouvertLe || d.ouvertLe, clique: f.clique || d.clique, cliqueLe: f.cliqueLe || d.cliqueLe, liens: f.liens || d.liens, desinscrit: f.desinscrit || d.desinscrit, desinscritLe: f.desinscritLe || d.desinscritLe };
  });
  const bilan = resumeDe(c.destinataires);
  const enPause = fraiche.data.statut === "pause";
  c.statut = enPause ? "pause" : bilan.attente === 0 ? "terminee" : "envoi";
  if (c.statut === "terminee") c.termineeLe = new Date().toISOString();
  await prisma.record.update({ where: { id: fiche.id }, data: { data: c } });

  if (c.statut === "terminee") {
    const user = await prisma.user.findUnique({ where: { id: fiche.userId } }).catch(() => null);
    if (user) {
      await journaliser({ user, headers: {} }, "campagne.terminee", c.nom, { envoyes: bilan.envoyes, echecs: bilan.echecs });
    }
  }
  return partis;
};

// ---------------------------------------------------------------------------
// Automatisations
// ---------------------------------------------------------------------------

const enEnregistrements = (fiches) => fiches.map((f) => ({ id: f.id, data: f.data, createdAt: f.createdAt?.toISOString?.() || String(f.createdAt || "") }));

/// Ce que les recettes lisent dans les autres applications de l'espace.
const contexteDonnees = async (tenantId) => {
  const lire = (module, collection) => prisma.record.findMany({ where: { tenantId, module, collection } }).then(enEnregistrements);
  const [clients, documents, mouvements] = await Promise.all([
    lire("crm", "clients"),
    lire("facturation", "factures"),
    lire("stock", "mouvements"),
  ]);
  return { clients, documents, mouvements };
};

export const passerLesAutomatisations = async () => {
  const fiches = await prisma.record.findMany({ where: { module: "campagnes", collection: "automatisations" } });
  const actives = fiches.filter((f) => f.data?.actif);
  const contextes = new Map();
  let partis = 0;
  for (const fiche of actives) {
    try {
      if (!contextes.has(fiche.tenantId)) contextes.set(fiche.tenantId, await contexteDonnees(fiche.tenantId));
      partis += await avancerAutomatisation(fiche, contextes.get(fiche.tenantId));
    } catch (err) {
      console.error(`Automatisation ${fiche.id} en échec :`, err.message);
    }
  }
  return partis;
};

const avancerAutomatisation = async (fiche, donnees) => {
  const maintenant = new Date().toISOString();
  const { auto: inscrite, nouveaux } = inscrire(fiche.data, donnees, maintenant);
  const { auto, prets } = echeances(inscrite, donnees, maintenant);
  let partis = 0;
  let change = nouveaux > 0 || auto.inscrits.some((i, k) => i !== inscrite.inscrits[k]);

  if (prets.length) {
    const ctx = await contexteEnvoi(fiche.tenantId);
    const reste = ctx.transport ? await resteAEnvoyer(fiche.tenantId) : 0;
    if (reste > 0) {
      const inscrits = [...auto.inscrits];
      const servables = await destinatairesServables(fiche.tenantId, inscrits.filter((i) => prets.includes(i.cle)), maintenant);
      for (const dest of servables.slice(0, Math.min(LOT, reste))) {
        const i = inscrits.indexOf(dest);
        const copie = { ...dest };
        const r = await envoyerA(ctx, copie, rendreMessage(ctx, auto, copie, { ficheId: fiche.id, extra: copie.extra }));
        await appliquerResultat(ctx, copie, r);
        inscrits[i] = copie;
        if (r.envoye) partis += 1;
        change = true;
        await new Promise((res) => setTimeout(res, PAUSE_MS));
      }
      // Un inscrit devenu injoignable (désinscrit, rebond) sort.
      for (const cle of prets) {
        const i = inscrits.findIndex((x) => x.cle === cle);
        if (i >= 0 && inscrits[i].statut === "attente" && !servables.some((s) => s.cle === cle) && !(inscrits[i].reessayerApres > maintenant)) {
          inscrits[i] = { ...inscrits[i], statut: "sorti", sortiLe: maintenant, erreur: "Injoignable" };
          change = true;
        }
      }
      auto.inscrits = inscrits;
      if (partis) await compterEnvois(fiche.tenantId, partis);
    }
  }
  if (!change) return 0;

  // Relue avant d'écrire : le contenu, l'activation et les marques de
  // lecture viennent de la fiche fraîche ; seuls les inscrits de ce
  // passage sont les nôtres.
  const fraiche = await prisma.record.findUnique({ where: { id: fiche.id } });
  if (!fraiche) return partis;
  const marques = new Map((fraiche.data.inscrits || []).map((i) => [i.cle, i]));
  const inscrits = auto.inscrits.map((i) => {
    const f = marques.get(i.cle);
    return f ? { ...i, ouvert: f.ouvert || i.ouvert, ouvertLe: f.ouvertLe || i.ouvertLe, clique: f.clique || i.clique, cliqueLe: f.cliqueLe || i.cliqueLe, liens: f.liens || i.liens, desinscrit: f.desinscrit || i.desinscrit } : i;
  });
  await prisma.record.update({ where: { id: fiche.id }, data: { data: { ...fraiche.data, inscrits } } });
  return partis;
};

// ---------------------------------------------------------------------------
// E-mail de test : le vrai rendu, aux membres de l'équipe seulement
// ---------------------------------------------------------------------------

/// Le test part **tel que les clients le recevront** (HTML, blocs,
/// images), mais seulement à des adresses de membres de l'espace : sinon
/// la route deviendrait un relais d'envoi de HTML arbitraire.
export const envoyerTest = async (tenantId, message, adresses, exemple = null) => {
  const membres = await prisma.user.findMany({ where: { tenantId }, select: { email: true } });
  const autorisees = new Set(membres.map((m) => String(m.email || "").toLowerCase()));
  const cibles = [...new Set(adresses.map((a) => String(a).trim().toLowerCase()))].filter((a) => autorisees.has(a)).slice(0, 5);
  if (!cibles.length) return { envoyes: 0, refusees: adresses.length };
  const ctx = await contexteEnvoi(tenantId);
  // Sans relais propre, le test emprunte celui de la plateforme : il ne
  // part qu'à l'équipe, la réputation commune ne risque rien.
  if (!ctx.transport && env.smtpHost) {
    ctx.transport = creerTransporteur({ host: env.smtpHost, port: env.smtpPort, user: env.smtpUser, pass: env.smtpPass });
    ctx.expediteur = env.mailFrom || ctx.expediteur;
  }
  const dest = exemple || { clientId: "test", nom: "Koné Distribution", contact: "Awa Koné", ville: "Abidjan" };
  let envoyes = 0;
  let erreur = null;
  for (const a of cibles) {
    const rendu = rendreMessage(ctx, message, { ...dest, email: a }, { suivi: false, extra: message.extraTest || {} });
    const r = await envoyerVia(ctx.transport, { de: ctx.expediteur, a, sujet: `[TEST] ${rendu.sujet}`, texte: rendu.texte, html: rendu.html });
    if (r.envoye) envoyes += 1;
    else erreur = r.erreur;
  }
  if (envoyes) await compterEnvois(tenantId, envoyes);
  return { envoyes, refusees: adresses.length - cibles.length, erreur };
};

/// Démarre le moteur : un premier passage rapide, puis toutes les
/// quarante-cinq secondes — huit messages par campagne et par passage.
export const demarrerCampagnes = () => {
  // Un passage peut durer plus que l'intervalle (beaucoup de campagnes,
  // un relais lent) : deux passages simultanés enverraient deux fois le
  // même lot. Le suivant attend donc la fin du précédent.
  let enCours = false;
  const passer = async () => {
    if (enCours) return;
    enCours = true;
    try {
      await passerLesCampagnes().catch(() => {});
      await passerLesAutomatisations().catch(() => {});
    } finally {
      enCours = false;
    }
  };
  setTimeout(passer, 20 * 1000);
  setInterval(passer, 45 * 1000);
};

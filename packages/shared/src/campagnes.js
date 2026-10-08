// Campagnes — les règles, sans React.
//
// ─────────────────────────────────────────────────────────────────────────
// DE L'EMAIL MARKETING QUI NE GRILLE PAS L'ENTREPRISE
//
// Écrire à tous ses clients d'un coup est utile — nouvelle offre, congés
// annuels, changement d'adresse — et dangereux : un envoi massif mal fait
// finit en spam et grille la réputation du domaine pour des mois. D'où
// trois règles, tenues par le serveur :
//
//   1. **L'audience vient du CRM**, jamais d'une liste collée : des gens
//      qui connaissent l'entreprise, avec une adresse vérifiable.
//   2. **L'envoi est cadencé** : par petits lots espacés, pas en rafale.
//   3. **La désinscription est un droit** : chaque message porte son lien,
//      et un désinscrit ne reçoit plus jamais de campagne.
//
// Une campagne vit en trois états : brouillon (modifiable), envoi (le
// serveur la déroule), terminée (les chiffres restent).
// ─────────────────────────────────────────────────────────────────────────

// Extension explicite : Vite s'en moque, et Node peut ainsi éprouver ce
// domaine sans bundler — comme tous les autres.
import { adresseValide } from "./courrier.js";

export const CAMPAGNE_VIDE = {
  nom: "",
  sujet: "",
  texte: "",
  // Le bouton d'action — facultatif : « Voir l'offre » vers le site, un
  // catalogue, un numéro WhatsApp. C'est lui qui porte le suivi des clics.
  cta: { label: "", url: "" },
  // Le texte d'aperçu (« preheader ») : la ligne grise qui suit l'objet
  // dans la boîte de réception. Vide, le client mail y met le début du
  // message — souvent « Bonjour, » — et gaspille la meilleure place.
  apercu: "",
  // La couleur d'en-tête de l'email, aux couleurs de l'entreprise.
  couleur: "#e8590c",
  // Segment : chaque critère réduit l'audience. `villes` et `secteurs`
  // vides = tous. `achatMois` : a reçu une facture ces N derniers mois (0 =
  // sans condition). `repos` : écarte qui a reçu une campagne ces N
  // derniers jours. `ids` : une liste fermée (relance des non-ouvreurs).
  filtres: { statut: "tous", villes: [], secteurs: [], achatMois: 0, repos: 0, ids: null },
  // Écartés à la main, pour cette campagne seulement.
  exclus: [],
  statut: "brouillon", // brouillon | programmee | envoi | terminee
  // Vide = dès que possible ; sinon l'instant (ISO) avant lequel le
  // serveur ne doit pas commencer — la campagne du lundi 8 h se prépare
  // le vendredi soir.
  envoyerLe: "",
  destinataires: [],
  creeLe: "",
};

/// Les statuts du CRM, tels que la fiche client les enregistre.
export const STATUTS_CRM = {
  tous: "Tous",
  actif: "Clients actifs",
  prospect: "Prospects",
  inactif: "Inactifs",
};

export const STATUTS_CAMPAGNE = {
  brouillon: { label: "Brouillon", ton: "idle" },
  programmee: { label: "Programmée", ton: "attente" },
  envoi: { label: "Envoi en cours", ton: "actif" },
  terminee: { label: "Terminée", ton: "ok" },
};

/// Une campagne programmée est mûre quand son heure est passée.
export const estMure = (campagne, maintenant = new Date().toISOString()) =>
  campagne.statut === "programmee" &&
  (!campagne.envoyerLe || campagne.envoyerLe <= maintenant);

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

/// Les filtres, au format courant — les campagnes enregistrées avant les
/// segments avaient une ville et un secteur uniques, et le statut
/// « client » (qui n'a jamais existé dans le CRM : c'est « actif »).
export const normaliserFiltres = (f = {}) => ({
  statut: f.statut === "client" ? "actif" : f.statut || "tous",
  villes: Array.isArray(f.villes) ? f.villes : f.ville ? [f.ville] : [],
  secteurs: Array.isArray(f.secteurs) ? f.secteurs : f.secteur ? [f.secteur] : [],
  achatMois: Number(f.achatMois) || 0,
  repos: Number(f.repos) || 0,
  ids: Array.isArray(f.ids) ? f.ids : null,
});

const dansListe = (valeur, liste) =>
  !liste.length || liste.some((v) => v.toLowerCase() === String(valeur || "").trim().toLowerCase());

/// Le contexte que l'audience consulte hors du CRM, calculé une fois :
///   • `derniereFacture` : clientId → date ISO de sa dernière facture ;
///   • `dernierEnvoi` : clientId → date ISO de la dernière campagne reçue.
export const contexteAudience = ({ factures = [], campagnes = [] } = {}) => {
  const derniereFacture = {};
  for (const f of factures) {
    const d = f.data || f;
    if (d.type && d.type !== "facture") continue;
    if (d.statut === "brouillon" || d.statut === "annule" || !d.clientId) continue;
    if (!derniereFacture[d.clientId] || d.date > derniereFacture[d.clientId]) derniereFacture[d.clientId] = d.date;
  }
  const dernierEnvoi = {};
  for (const c of campagnes) {
    const d = c.data || c;
    for (const dest of d.destinataires || []) {
      if (dest.statut !== "envoye") continue;
      const le = dest.envoyeLe || d.termineeLe || d.envoyerLe || d.creeLe || "";
      if (le && (!dernierEnvoi[dest.clientId] || le > dernierEnvoi[dest.clientId])) dernierEnvoi[dest.clientId] = le;
    }
  }
  return { derniereFacture, dernierEnvoi };
};

const ilYA = (jours, maintenant) => new Date(new Date(maintenant).getTime() - jours * 86400000).toISOString();

/// L'audience détaillée : qui correspond aux critères, et pourquoi les
/// autres sont écartés. `retenus` est ce qui partira.
export const segmenter = (clients = [], filtres = {}, { exclus = [], contexte = {}, maintenant = new Date().toISOString() } = {}) => {
  const f = normaliserFiltres(filtres);
  const ids = f.ids ? new Set(f.ids) : null;
  const ecartes = new Set(exclus);
  const limiteAchat = f.achatMois ? ilYA(f.achatMois * 30.44, maintenant).slice(0, 10) : null;
  const limiteRepos = f.repos ? ilYA(f.repos, maintenant) : null;
  const vues = new Set();
  const out = { correspondants: [], retenus: [], sansEmail: 0, desinscrits: 0, doublons: 0, auRepos: 0, exclus: 0 };

  for (const c of clients) {
    const d = c.data || {};
    if (ids && !ids.has(c.id)) continue;
    if (f.statut !== "tous" && d.statut !== f.statut) continue;
    if (!dansListe(d.ville, f.villes) || !dansListe(d.secteur, f.secteurs)) continue;
    if (limiteAchat && !((contexte.derniereFacture || {})[c.id] >= limiteAchat)) continue;
    out.correspondants.push(c);

    if (!adresseValide(d.email)) { out.sansEmail += 1; continue; }
    if (d.emailDesinscrit) { out.desinscrits += 1; continue; }
    const cle = d.email.trim().toLowerCase();
    if (vues.has(cle)) { out.doublons += 1; continue; }
    vues.add(cle);
    if (limiteRepos && (contexte.dernierEnvoi || {})[c.id] >= limiteRepos) { out.auRepos += 1; continue; }
    if (ecartes.has(c.id)) { out.exclus += 1; continue; }
    out.retenus.push(c);
  }
  return out;
};

/// Les clients du CRM qui recevront la campagne : adresse valide,
/// non désinscrits, filtres appliqués, doublons d'adresse retirés.
export const audienceDe = (clients = [], filtres = {}, options = {}) =>
  segmenter(clients, filtres, options).retenus;

/// La santé du fichier clients, vue de l'emailing.
export const santeDe = (clients = []) => {
  let joignables = 0;
  let sansEmail = 0;
  let desinscrits = 0;
  for (const c of clients) {
    const d = c.data || {};
    if (!adresseValide(d.email)) sansEmail += 1;
    else if (d.emailDesinscrit) desinscrits += 1;
    else joignables += 1;
  }
  return { total: clients.length, joignables, sansEmail, desinscrits };
};

/// Les valeurs distinctes d'un champ, pour remplir les filtres — triées,
/// vides écartés.
export const valeursDe = (clients = [], champ) =>
  [...new Set(clients.map((c) => (c.data?.[champ] || "").trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, "fr"),
  );

/// L'instantané d'un destinataire, figé au lancement : la campagne
/// n'oublie personne même si la fiche CRM change ensuite.
export const destinataireDe = (client) => ({
  clientId: client.id,
  email: client.data.email.trim().toLowerCase(),
  nom: client.data.entreprise || client.data.nom || client.data.email,
  contact: client.data.entreprise ? client.data.nom || "" : "",
  ville: client.data.ville || "",
  statut: "attente", // attente | envoye | echec
  erreur: null,
});

/// Les variables d'un destinataire, pour appliquerModele.
export const variablesPour = (destinataire, entreprise = "") => ({
  client: destinataire.nom,
  contact: destinataire.contact || destinataire.nom,
  ville: destinataire.ville,
  entreprise,
});

/// Les variables qu'on peut glisser dans l'objet et le message.
export const VARIABLES = [
  { id: "client", label: "Client", aide: "La société, ou le nom du contact" },
  { id: "contact", label: "Contact", aide: "La personne, quand la fiche a une société" },
  { id: "ville", label: "Ville", aide: "La ville de la fiche" },
  { id: "entreprise", label: "Votre entreprise", aide: "Le nom de votre espace" },
];

// ---------------------------------------------------------------------------
// L'email HTML
// ---------------------------------------------------------------------------
//
// Le gabarit des outils d'emailing professionnels : un bandeau aux
// couleurs de l'entreprise, le message, un bouton d'action, un pied avec
// la désinscription. En tableaux HTML — la seule mise en page que les
// clients mail respectent tous. Partagé : le serveur l'envoie, l'éditeur
// l'affiche en aperçu — le destinataire reçoit exactement ce qu'on a vu.

/// Échappe pour du **texte** HTML et pour l'intérieur d'un attribut.
///
/// Les guillemets en font partie, et ce n'était pas le cas : sans eux,
/// une valeur « échappée » placée dans un attribut peut en sortir avec un
/// simple `"`. C'est un piège classique — le texte paraît protégé, mais la
/// protection ne vaut que pour le contexte d'origine.
const echapperHtml = (t) =>
  String(t || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/// Une couleur, ou la couleur par défaut. Rien d'autre.
///
/// `couleur` vient de `fiche.data`, c'est-à-dire d'un champ JSON libre
/// écrit par l'API : l'écran utilise bien un `<input type="color">`, mais
/// l'API accepte n'importe quelle chaîne. Elle est ensuite posée dans un
/// attribut `style`, d'où on sort avec un guillemet — et le résultat est
/// un mail à l'en-tête d'une entreprise cliente, contenant le HTML de
/// l'attaquant. On valide donc la forme au lieu d'échapper : pour une
/// couleur, tout ce qui n'est pas une couleur est une erreur.
const COULEUR = /^#[0-9a-f]{3,8}$/i;
const couleurSure = (valeur, defaut = "#e8590c") => {
  const brute = String(valeur || "").trim();
  return COULEUR.test(brute) ? brute : defaut;
};

/// Une URL destinée à un `href`/`src`. Seuls http(s) sont acceptés :
/// `javascript:` et `data:` n'ont rien à faire dans un mail.
const lienSur = (valeur) => {
  const brute = String(valeur || "").trim();
  if (!/^https?:\/\//i.test(brute)) return "";
  return echapperHtml(brute);
};

export const htmlDe = (
  campagne,
  {
    entreprise = "",
    lienCta: cta = "",
    lienDesinscription: desabo = "",
    pixel: tracage = "",
    logo: logoUrl = "",
    pied = "",
  } = {},
) => {
  const couleur = couleurSure(campagne.couleur);
  // Les trois liens sont posés dans des attributs : même traitement.
  const lienCta = lienSur(cta);
  const lienDesinscription = lienSur(desabo);
  const pixel = lienSur(tracage);
  const logo = lienSur(logoUrl);
  // Le texte d'aperçu, caché dans le corps : les boîtes de réception le
  // lisent, le lecteur ne le voit pas dans le message ouvert.
  const preheader = campagne.apercu
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${echapperHtml(campagne.apercu)}</div>`
    : "";
  const paragraphes = String(campagne.texte || "")
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#26313d">${echapperHtml(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  const bouton =
    campagne.cta?.label && lienCta
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto 8px"><tr><td style="border-radius:9px;background:${couleur}">
           <a href="${lienCta}" style="display:inline-block;padding:12px 30px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none">${echapperHtml(campagne.cta.label)}</a>
         </td></tr></table>`
      : "";

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f2f4f7">${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f7;padding:26px 12px">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Segoe UI,Arial,sans-serif">
  <tr><td style="background:${couleur};padding:20px 32px">
    ${logo ? `<img src="${logo}" alt="" height="36" style="height:36px;max-width:160px;vertical-align:middle;margin-right:12px;border-radius:6px;background:#ffffff">` : ""}<span style="color:#ffffff;font-size:19px;font-weight:bold;letter-spacing:.02em;vertical-align:middle">${echapperHtml(entreprise)}</span>
  </td></tr>
  <tr><td style="padding:30px 32px 12px">${paragraphes}${bouton}</td></tr>
  <tr><td style="padding:18px 32px 24px;border-top:1px solid #edf0f3">
    ${pied ? `<p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#8a94a1">${echapperHtml(pied)}</p>` : ""}
    <p style="margin:0;font-size:12px;line-height:1.6;color:#8a94a1">
      Vous recevez ce message parce que vous êtes en relation avec ${echapperHtml(entreprise)}.
      ${lienDesinscription ? `<a href="${lienDesinscription}" style="color:#8a94a1">Se désinscrire</a>` : ""}
    </p>
  </td></tr>
</table>
${pixel ? `<img src="${pixel}" width="1" height="1" alt="" style="display:block">` : ""}
</td></tr></table></body></html>`;
};

// ---------------------------------------------------------------------------
// Progression et statistiques
// ---------------------------------------------------------------------------

const taux = (part, sur) => (sur ? Math.round((part / sur) * 100) : 0);

export const resumeDe = (destinataires = []) => {
  const total = destinataires.length;
  const envoyes = destinataires.filter((d) => d.statut === "envoye").length;
  const echecs = destinataires.filter((d) => d.statut === "echec").length;
  const ouverts = destinataires.filter((d) => d.ouvert).length;
  const cliques = destinataires.filter((d) => d.clique).length;
  const desinscrits = destinataires.filter((d) => d.desinscrit).length;
  const attente = total - envoyes - echecs;
  return {
    total,
    envoyes,
    echecs,
    attente,
    ouverts,
    cliques,
    desinscrits,
    tauxOuverture: taux(ouverts, envoyes),
    tauxClic: taux(cliques, envoyes),
    pourcent: total ? Math.round(((envoyes + echecs) / total) * 100) : 0,
  };
};

/// Prête au lancement : un nom, un sujet, un corps, au moins un
/// destinataire.
export const prete = (campagne) =>
  Boolean(
    String(campagne.nom || "").trim() &&
    String(campagne.sujet || "").trim() &&
    String(campagne.texte || "").trim() &&
    (campagne.destinataires || []).length,
  );

// ---------------------------------------------------------------------------
// Aide à la rédaction
// ---------------------------------------------------------------------------

/// Mots qui font tiquer les filtres anti-spam — à éviter dans l'objet.
const MOTS_A_RISQUE = ["gratuit", "urgent", "gagnez", "gagné", "100%", "cliquez ici", "argent facile", "offre limitée", "promo!!!", "€€€", "sans frais"];

/// Un avis sur l'objet : longueur, majuscules, ponctuation, mots à risque.
export const analyseObjet = (objet = "") => {
  const t = String(objet).trim();
  const longueur = t.length;
  const conseils = [];
  const lettres = t.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (lettres.length > 8 && lettres === lettres.toUpperCase()) conseils.push("Évitez les objets tout en majuscules.");
  if (/[!?]{2,}/.test(t)) conseils.push("Une seule ponctuation forte suffit.");
  const mots = MOTS_A_RISQUE.filter((m) => t.toLowerCase().includes(m));
  if (mots.length) conseils.push(`Mot à risque pour les filtres anti-spam : « ${mots[0]} ».`);
  if (longueur > 70) conseils.push("Objet long : il sera coupé sur mobile.");
  const ton = !longueur ? "vide" : conseils.length ? "attention" : longueur < 15 ? "court" : "ok";
  const avis =
    ton === "vide" ? "À écrire"
      : ton === "court" ? "Un peu court : dites ce que le client y gagne"
        : ton === "ok" ? "Bonne longueur"
          : conseils[0];
  return { longueur, ton, avis, conseils };
};

/// Le moteur envoie 8 messages toutes les 45 secondes (apps/api/src/
/// campagnes.js) : la durée d'un envoi, en minutes, arrondie.
export const MESSAGES_PAR_PASSAGE = 8;
export const SECONDES_PAR_PASSAGE = 45;
export const dureeEnvoi = (n = 0) => Math.max(1, Math.ceil(n / MESSAGES_PAR_PASSAGE) * SECONDES_PAR_PASSAGE / 60);
export const libelleDuree = (n = 0) => {
  if (!n) return "";
  const minutes = Math.round(dureeEnvoi(n));
  if (minutes < 2) return "environ une minute";
  if (minutes < 60) return `environ ${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `environ ${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}`;
};

/// Ce qui manque avant le lancement, dans l'ordre du parcours.
export const verificationsLancement = (campagne, nbRetenus, testEnvoye = false) => [
  { id: "nom", label: "Un nom interne", ok: Boolean(String(campagne.nom || "").trim()) },
  { id: "audience", label: nbRetenus ? `Une audience : ${nbRetenus} contact${nbRetenus > 1 ? "s" : ""}` : "Une audience", ok: nbRetenus > 0 },
  { id: "sujet", label: "Un objet", ok: Boolean(String(campagne.sujet || "").trim()) },
  { id: "texte", label: "Un message", ok: Boolean(String(campagne.texte || "").trim()) },
  { id: "cta", label: "Un lien valide pour le bouton", ok: !campagne.cta?.label || /^https?:\/\//i.test(campagne.cta?.url || ""), facultatif: !campagne.cta?.label },
  { id: "test", label: "Un test reçu dans votre boîte", ok: testEnvoye, conseil: true },
];

// ---------------------------------------------------------------------------
// Après l'envoi : analyse, relance, export
// ---------------------------------------------------------------------------

/// Les ouvertures heure par heure depuis le début de l'envoi (24 cases),
/// d'après l'horodatage enregistré par le pixel.
export const ouverturesParHeure = (campagne, heures = 24) => {
  const dests = campagne.destinataires || [];
  const dates = dests.map((d) => d.ouvertLe).filter(Boolean).sort();
  const debut = campagne.envoyerLe || dests.map((d) => d.envoyeLe).filter(Boolean).sort()[0] || dates[0];
  if (!debut) return { debut: null, cases: [] };
  const t0 = new Date(debut);
  t0.setMinutes(0, 0, 0);
  const cases = Array.from({ length: heures }, (_, i) => ({ heure: new Date(t0.getTime() + i * 3600000).toISOString(), n: 0 }));
  for (const le of dates) {
    const i = Math.floor((new Date(le) - t0) / 3600000);
    if (i >= 0 && i < heures) cases[i].n += 1;
  }
  return { debut: t0.toISOString(), cases };
};

export const FILTRES_DESTINATAIRES = {
  tous: { label: "Tous", garde: () => true },
  ouverts: { label: "Ouverts", garde: (d) => d.ouvert },
  cliques: { label: "Ont cliqué", garde: (d) => d.clique },
  nonOuverts: { label: "Non ouverts", garde: (d) => d.statut === "envoye" && !d.ouvert },
  echecs: { label: "Échecs", garde: (d) => d.statut === "echec" },
  desinscrits: { label: "Désinscrits", garde: (d) => d.desinscrit },
};

/// Une nouvelle campagne pour ceux qui n'ont pas ouvert : même message,
/// objet à retravailler, audience fermée sur ces seules personnes.
export const relanceDe = (campagne) => {
  const ids = (campagne.destinataires || []).filter((d) => d.statut === "envoye" && !d.ouvert && !d.desinscrit).map((d) => d.clientId);
  return {
    ...CAMPAGNE_VIDE,
    nom: `${campagne.nom || "Campagne"} — relance`,
    sujet: campagne.sujet || "",
    apercu: campagne.apercu || "",
    texte: campagne.texte || "",
    cta: { ...(campagne.cta || { label: "", url: "" }) },
    couleur: campagne.couleur || CAMPAGNE_VIDE.couleur,
    filtres: { ...CAMPAGNE_VIDE.filtres, ids },
    relanceDe: campagne.nom || "",
  };
};

/// Une copie à retravailler : le message et le segment, pas les résultats.
export const dupliquer = (campagne) => ({
  ...CAMPAGNE_VIDE,
  nom: `${campagne.nom || "Campagne"} (copie)`,
  sujet: campagne.sujet || "",
  apercu: campagne.apercu || "",
  texte: campagne.texte || "",
  cta: { ...(campagne.cta || { label: "", url: "" }) },
  couleur: campagne.couleur || CAMPAGNE_VIDE.couleur,
  filtres: normaliserFiltres(campagne.filtres),
});

/// Remet les échecs en file d'attente, pour un nouveau passage du moteur.
export const reessayerEchecs = (campagne) => ({
  ...campagne,
  statut: "programmee",
  envoyerLe: "",
  destinataires: (campagne.destinataires || []).map((d) =>
    d.statut === "echec" && !d.desinscrit ? { ...d, statut: "attente", erreur: null } : d),
});

const cellule = (v) => {
  const t = String(v ?? "");
  return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/// Les destinataires en CSV (séparateur « ; », que les tableurs français
/// ouvrent sans import).
export const csvDe = (campagne) => {
  const lignes = [["Nom", "E-mail", "Ville", "Statut", "Ouvert le", "Cliqué le", "Désinscrit", "Erreur"]];
  for (const d of campagne.destinataires || []) {
    lignes.push([d.nom, d.email, d.ville, d.statut, d.ouvertLe || "", d.cliqueLe || "", d.desinscrit ? "oui" : "", d.erreur || ""]);
  }
  return lignes.map((l) => l.map(cellule).join(";")).join("\r\n");
};

/// Les chiffres d'ensemble du tableau de bord, sur `jours` jours.
export const statistiquesGlobales = (campagnes = [], jours = 30, maintenant = new Date().toISOString()) => {
  const limite = ilYA(jours, maintenant);
  let envoyes = 0;
  let nb = 0;
  let sommeOuv = 0;
  let sommeClic = 0;
  let avecClic = 0;
  let mesurees = 0;
  for (const c of campagnes) {
    const d = c.data || c;
    const r = resumeDe(d.destinataires);
    const le = d.termineeLe || d.envoyerLe || d.creeLe || "";
    if (r.envoyes && le >= limite) { envoyes += r.envoyes; nb += 1; }
    if (d.statut === "terminee" && r.envoyes) {
      mesurees += 1;
      sommeOuv += r.ouverts / r.envoyes;
      if (d.cta?.label) { avecClic += 1; sommeClic += r.cliques / r.envoyes; }
    }
  }
  return {
    envoyes,
    campagnes: nb,
    tauxOuverture: mesurees ? Math.round((sommeOuv / mesurees) * 1000) / 10 : null,
    tauxClic: avecClic ? Math.round((sommeClic / avecClic) * 1000) / 10 : null,
  };
};

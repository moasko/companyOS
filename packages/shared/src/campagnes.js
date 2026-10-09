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
import { htmlBlocs } from "./campagnes-blocs.js";

export * from "./campagnes-blocs.js";
export * from "./campagnes-contacts.js";
export * from "./campagnes-auto.js";

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
  filtres: { statut: "tous", villes: [], secteurs: [], etiquettes: [], achatMois: 0, repos: 0, ids: null },
  // Écartés à la main, pour cette campagne seulement.
  exclus: [],
  statut: "brouillon", // brouillon | programmee | envoi | terminee
  // Vide = dès que possible ; sinon l'instant (ISO) avant lequel le
  // serveur ne doit pas commencer — la campagne du lundi 8 h se prépare
  // le vendredi soir.
  envoyerLe: "",
  destinataires: [],
  creeLe: "",
  // Le message par blocs (campagnes-blocs.js). Vide : l'ancien format,
  // `texte` + `cta`, rendu à l'identique.
  blocs: [],
  // La langue du message — le pied et le lien de désinscription la suivent.
  langue: "fr",
  // Test A/B de l'objet : `part` % de l'audience reçoit A ou B, moitié
  // chacun ; après `heures`, la version au meilleur taux d'ouverture part
  // au reste.
  ab: { actif: false, sujetB: "", part: 20, heures: 4, gagnant: "" },
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
  pause: { label: "En pause", ton: "attente" },
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
  etiquettes: Array.isArray(f.etiquettes) ? f.etiquettes : [],
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
  const out = { correspondants: [], retenus: [], sansEmail: 0, desinscrits: 0, rebonds: 0, aConfirmer: 0, doublons: 0, auRepos: 0, exclus: 0 };
  const etiquettes = f.etiquettes.map((e) => e.toLowerCase());

  for (const c of clients) {
    const d = c.data || {};
    if (ids && !ids.has(c.id)) continue;
    if (f.statut !== "tous" && d.statut !== f.statut) continue;
    if (!dansListe(d.ville, f.villes) || !dansListe(d.secteur, f.secteurs)) continue;
    if (etiquettes.length && !(d.etiquettes || []).some((e) => etiquettes.includes(String(e).toLowerCase()))) continue;
    if (limiteAchat && !((contexte.derniereFacture || {})[c.id] >= limiteAchat)) continue;
    out.correspondants.push(c);

    if (!adresseValide(d.email)) { out.sansEmail += 1; continue; }
    if (d.emailDesinscrit) { out.desinscrits += 1; continue; }
    // Une adresse qui a rebondi définitivement n'existe plus : insister
    // dégrade la réputation de l'expéditeur.
    if (d.emailRebond) { out.rebonds += 1; continue; }
    // Inscrit par le formulaire mais pas encore confirmé (double opt-in).
    if (d.emailAConfirmer) { out.aConfirmer += 1; continue; }
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
  let rebonds = 0;
  let aConfirmer = 0;
  for (const c of clients) {
    const d = c.data || {};
    if (!adresseValide(d.email)) sansEmail += 1;
    else if (d.emailDesinscrit) desinscrits += 1;
    else if (d.emailRebond) rebonds += 1;
    else if (d.emailAConfirmer) aConfirmer += 1;
    else joignables += 1;
  }
  return { total: clients.length, joignables, sansEmail, desinscrits, rebonds, aConfirmer };
};

/// Toutes les étiquettes posées sur les fiches, triées.
export const etiquettesDe = (clients = []) =>
  [...new Set(clients.flatMap((c) => (c.data?.etiquettes || []).map((e) => String(e).trim()).filter(Boolean)))].sort((a, b) => a.localeCompare(b, "fr"));

/// Les valeurs distinctes d'un champ, pour remplir les filtres — triées,
/// vides écartés.
export const valeursDe = (clients = [], champ) =>
  [...new Set(clients.map((c) => (c.data?.[champ] || "").trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, "fr"),
  );

const premierMot = (t) => String(t || "").trim().split(/\s+/)[0] || "";

/// L'instantané d'un destinataire, figé au lancement : la campagne
/// n'oublie personne même si la fiche CRM change ensuite.
export const destinataireDe = (client) => ({
  clientId: client.id,
  email: client.data.email.trim().toLowerCase(),
  nom: client.data.entreprise || client.data.nom || client.data.email,
  contact: client.data.entreprise ? client.data.nom || "" : "",
  // Le prénom de la personne de la fiche — « Awa » pour « Awa Koné » —,
  // vide pour une fiche sans nom de personne.
  prenom: premierMot(client.data.nom && client.data.nom !== client.data.email ? client.data.nom : ""),
  ville: client.data.ville || "",
  statut: "attente", // attente | envoye | echec | reserve (A/B)
  erreur: null,
});

/// Les variables d'un destinataire, pour appliquerModele.
export const variablesPour = (destinataire, entreprise = "") => {
  const contact = destinataire.contact || destinataire.nom || "";
  return {
    client: destinataire.nom,
    contact,
    // Le premier mot du contact : « Awa » pour « Awa Koné ». Une fiche
    // sans contact nommé donne la société entière, jamais un vide.
    prenom: destinataire.prenom || premierMot(destinataire.contact) || contact,
    ville: destinataire.ville,
    entreprise,
  };
};

/// Les variables qu'on peut glisser dans l'objet et le message.
export const VARIABLES = [
  { id: "client", label: "Client", aide: "La société, ou le nom du contact" },
  { id: "contact", label: "Contact", aide: "La personne, quand la fiche a une société" },
  { id: "prenom", label: "Prénom", aide: "Le premier mot du contact" },
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

/// L'e-mail HTML d'une campagne — voir htmlBlocs. `lienCta` reste accepté
/// pour l'ancien format : c'est le lien n° 0, celui du bouton.
export const htmlDe = (
  campagne,
  { entreprise = "", lienCta = "", lienDesinscription = "", pixel = "", logo = "", pied = "", lien, image } = {},
) =>
  htmlBlocs(campagne, {
    entreprise,
    lienDesinscription,
    pixel,
    logo,
    pied,
    image,
    lien: lien || ((i, url) => (lienCta && i === 0 && !(campagne.blocs || []).length ? lienCta : url)),
  });

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
  const rebonds = destinataires.filter((d) => d.rebond === "definitif").length;
  const attente = total - envoyes - echecs;
  return {
    total,
    envoyes,
    echecs,
    attente,
    ouverts,
    cliques,
    desinscrits,
    rebonds,
    tauxOuverture: taux(ouverts, envoyes),
    tauxClic: taux(cliques, envoyes),
    pourcent: total ? Math.round(((envoyes + echecs) / total) * 100) : 0,
  };
};

/// Un message à envoyer : des blocs avec du texte, ou l'ancien texte.
export const aUnMessage = (campagne = {}) =>
  (campagne.blocs || []).length
    ? campagne.blocs.some((b) => String(b.texte || b.label || b.code || "").trim() || (b.produits || []).length || b.url || b.nodeId)
    : Boolean(String(campagne.texte || "").trim());

/// Prête au lancement : un nom, un sujet, un corps, au moins un
/// destinataire.
export const prete = (campagne) =>
  Boolean(
    String(campagne.nom || "").trim() &&
    String(campagne.sujet || "").trim() &&
    aUnMessage(campagne) &&
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
  { id: "texte", label: "Un message", ok: aUnMessage(campagne) },
  { id: "cta", label: "Un lien valide pour le bouton", ok: (campagne.blocs || []).length ? campagne.blocs.filter((b) => b.type === "bouton").every((b) => b.label && /^https?:\/\//i.test(b.url || "")) : !campagne.cta?.label || /^https?:\/\//i.test(campagne.cta?.url || ""), facultatif: (campagne.blocs || []).length ? !campagne.blocs.some((b) => b.type === "bouton") : !campagne.cta?.label },
  { id: "ab", label: "Deux objets différents pour le test A/B", ok: !campagne.ab?.actif || (String(campagne.ab.sujetB || "").trim() && campagne.ab.sujetB.trim() !== String(campagne.sujet || "").trim()), facultatif: !campagne.ab?.actif },
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

const copieBlocs = (blocs) => JSON.parse(JSON.stringify(blocs || []));

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
    blocs: copieBlocs(campagne.blocs),
    langue: campagne.langue || "fr",
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
  blocs: copieBlocs(campagne.blocs),
  langue: campagne.langue || "fr",
  ab: { ...CAMPAGNE_VIDE.ab, actif: Boolean(campagne.ab?.actif), sujetB: campagne.ab?.sujetB || "" },
  filtres: normaliserFiltres(campagne.filtres),
});

/// Remet les échecs en file d'attente, pour un nouveau passage du moteur.
export const reessayerEchecs = (campagne) => ({
  ...campagne,
  statut: "programmee",
  envoyerLe: "",
  destinataires: (campagne.destinataires || []).map((d) =>
    d.statut === "echec" && !d.desinscrit && d.rebond !== "definitif" ? { ...d, statut: "attente", erreur: null, essais: 0 } : d),
});

const cellule = (v) => {
  const t = String(v ?? "");
  return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/// Les destinataires en CSV (séparateur « ; », que les tableurs français
/// ouvrent sans import).
export const csvDe = (campagne, entetes = ["Nom", "E-mail", "Ville", "Statut", "Version", "Ouvert le", "Cliqué le", "Désinscrit", "Erreur"]) => {
  const lignes = [entetes];
  for (const d of campagne.destinataires || []) {
    lignes.push([d.nom, d.email, d.ville, d.statut, d.variante || "", d.ouvertLe || "", d.cliqueLe || "", d.desinscrit ? "oui" : "", d.erreur || ""]);
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

// ---------------------------------------------------------------------------
// Test A/B de l'objet
// ---------------------------------------------------------------------------

/// Répartit les destinataires au lancement : les `part` % premiers, mêlés,
/// reçoivent A ou B en alternance ; les autres attendent le gagnant
/// (statut « reserve »). Sans test, rien ne change.
export const repartirAB = (destinataires = [], ab = {}, hasard = Math.random) => {
  if (!ab?.actif) return destinataires;
  const melanges = destinataires.map((d) => ({ d, k: hasard() })).sort((a, b) => a.k - b.k).map((x) => x.d);
  const part = Math.min(50, Math.max(5, Number(ab.part) || 20));
  // Au moins deux personnes par version, sinon le test ne mesure rien.
  const n = Math.min(melanges.length, Math.max(4, Math.round((melanges.length * part) / 100)));
  return melanges.map((d, i) =>
    i < n ? { ...d, variante: i % 2 ? "B" : "A" } : { ...d, variante: "", statut: "reserve" });
};

/// Les chiffres de chaque version.
export const resultatsAB = (campagne = {}) => {
  const par = (v) => {
    const dests = (campagne.destinataires || []).filter((d) => d.variante === v && d.statut === "envoye");
    const ouverts = dests.filter((d) => d.ouvert).length;
    const cliques = dests.filter((d) => d.clique).length;
    return { envoyes: dests.length, ouverts, cliques, tauxOuverture: taux(ouverts, dests.length), tauxClic: taux(cliques, dests.length) };
  };
  return { A: par("A"), B: par("B"), gagnant: campagne.ab?.gagnant || "" };
};

/// Faut-il trancher ? Quand tout l'échantillon est parti et que le délai
/// est écoulé depuis le dernier envoi du test. Renvoie la campagne mise à
/// jour (gagnant choisi, réserve libérée), ou null s'il faut attendre.
export const decisionAB = (campagne = {}, maintenant = new Date().toISOString()) => {
  if (!campagne.ab?.actif || campagne.ab.gagnant) return null;
  const dests = campagne.destinataires || [];
  const test = dests.filter((d) => d.variante === "A" || d.variante === "B");
  // Un destinataire du test en réessai (boîte pleine) ne bloque pas la
  // décision : il a déjà eu sa chance, et attendre pourrait durer un jour.
  if (!test.length || test.some((d) => d.statut === "attente" && !d.essais)) return null;
  const dernier = test.map((d) => d.envoyeLe || "").sort().pop() || "";
  const heures = Math.max(1, Number(campagne.ab.heures) || 4);
  if (dernier && new Date(maintenant) - new Date(dernier) < heures * 3600000) return null;
  const r = resultatsAB(campagne);
  // À égalité d'ouvertures, les clics départagent ; puis A, l'objet
  // d'origine.
  const gagnant = r.B.tauxOuverture > r.A.tauxOuverture || (r.B.tauxOuverture === r.A.tauxOuverture && r.B.tauxClic > r.A.tauxClic) ? "B" : "A";
  return {
    ...campagne,
    statut: dests.some((d) => d.statut === "reserve") ? "envoi" : campagne.statut,
    ab: { ...campagne.ab, gagnant, decideLe: maintenant },
    destinataires: dests.map((d) => (d.statut === "reserve" ? { ...d, statut: "attente", variante: gagnant } : d)),
  };
};

/// L'objet d'un destinataire, selon sa version.
export const sujetPour = (campagne = {}, destinataire = {}) =>
  destinataire.variante === "B" && campagne.ab?.sujetB ? campagne.ab.sujetB : campagne.sujet;

// ---------------------------------------------------------------------------
// Rebonds
// ---------------------------------------------------------------------------

/// Le genre d'un échec SMTP : « definitif » (5xx — adresse inexistante,
/// domaine introuvable), « temporaire » (4xx — boîte pleine, greylisting),
/// ou null (relais injoignable : rien à reprocher à l'adresse).
export const classerErreur = (message = "") => {
  const m = String(message);
  if (/\b5\.\d\.\d+\b|\b55[0-4]\b|user unknown|no such user|does not exist|mailbox unavailable|ENOTFOUND|domain not found|recipient address rejected/i.test(m)) return "definitif";
  if (/\b4\.\d\.\d+\b|\b4[2-5]\d\b|mailbox full|over quota|try again later|greylist/i.test(m)) return "temporaire";
  return null;
};

/// Combien d'essais pour un rebond temporaire, et à quel intervalle.
export const ESSAIS_MAX = 3;
export const HEURES_ENTRE_ESSAIS = 6;

// ---------------------------------------------------------------------------
// Liens, ventes et engagement
// ---------------------------------------------------------------------------

/// Clics uniques par lien : [n0, n1, …], d'après les numéros de liens
/// enregistrés sur chaque destinataire.
export const clicsParLien = (campagne = {}, nbLiens = 0) => {
  const t = Array.from({ length: nbLiens }, () => 0);
  for (const d of campagne.destinataires || []) {
    for (const i of new Set(d.liens || [])) if (i >= 0 && i < nbLiens) t[i] += 1;
  }
  // Les anciennes campagnes ne notaient pas le numéro : leurs clics vont au
  // seul lien qu'elles avaient, le bouton.
  if (nbLiens && !t.some(Boolean)) t[0] = (campagne.destinataires || []).filter((d) => d.clique).length;
  return t;
};

/// Les factures émises par un client dans les `jours` qui suivent son clic
/// — ce que la campagne a fait vendre, au sens prudent.
export const ventesAttribuees = (campagne = {}, factures = [], jours = 7) => {
  const clics = new Map();
  for (const d of campagne.destinataires || []) if (d.cliqueLe && d.clientId) clics.set(d.clientId, d.cliqueLe);
  const out = [];
  for (const f of factures) {
    const d = f.data || f;
    if (d.type !== "facture" || ["brouillon", "annule"].includes(d.statut) || !clics.has(d.clientId)) continue;
    const clic = clics.get(d.clientId).slice(0, 10);
    const limite = new Date(new Date(`${clic}T12:00:00Z`).getTime() + jours * 86400000).toISOString().slice(0, 10);
    if (d.date >= clic && d.date <= limite) {
      const montant = Number(d.totalTTC ?? d.total ?? d.montant ?? 0) || (d.lignes || []).reduce((s, l) => s + (Number(l.qte) || 0) * (Number(l.pu) || 0) * (1 - (Number(l.remise) || 0) / 100) * (1 + (Number(l.tva) || 0) / 100), 0);
      out.push({ id: f.id, numero: d.numero, clientId: d.clientId, client: d.clientEntreprise || d.clientNom || "", date: d.date, montant: Math.round(montant), joursApres: Math.round((new Date(`${d.date}T12:00:00Z`) - new Date(`${clic}T12:00:00Z`)) / 86400000) });
    }
  }
  return out.sort((a, b) => b.montant - a.montant);
};

/// L'engagement de chaque contact sur ses dernières campagnes : une note
/// de 0 à 5 (ouvre souvent, clique), et la date de la dernière ouverture.
export const engagementDe = (campagnes = []) => {
  const t = {};
  for (const c of campagnes) {
    for (const d of (c.data || c).destinataires || []) {
      if (d.statut !== "envoye" || !d.clientId) continue;
      const e = (t[d.clientId] ||= { envoyes: 0, ouverts: 0, cliques: 0, derniereOuverture: "" });
      e.envoyes += 1;
      if (d.ouvert) e.ouverts += 1;
      if (d.clique) e.cliques += 1;
      if (d.ouvertLe && d.ouvertLe > e.derniereOuverture) e.derniereOuverture = d.ouvertLe;
    }
  }
  for (const e of Object.values(t)) {
    const ouv = e.ouverts / e.envoyes;
    const cli = e.cliques / e.envoyes;
    e.score = Math.min(5, Math.round(ouv * 3 + cli * 4 + (e.envoyes >= 3 && ouv > 0 ? 0.5 : 0)));
  }
  return t;
};

/// Inactif : a reçu au moins trois campagnes et n'en a ouvert aucune
/// depuis six mois.
export const estInactif = (e, maintenant = new Date().toISOString()) =>
  Boolean(e && e.envoyes >= 3 && (!e.derniereOuverture || e.derniereOuverture < ilYA(182, maintenant)));

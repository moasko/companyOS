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
import { adresseValide } from "../courrier/domaine.js";

export const CAMPAGNE_VIDE = {
  nom: "",
  sujet: "",
  texte: "",
  filtres: { statut: "tous", ville: "", secteur: "" },
  statut: "brouillon", // brouillon | programmee | envoi | terminee
  // Vide = dès que possible ; sinon l'instant (ISO) avant lequel le
  // serveur ne doit pas commencer — la campagne du lundi 8 h se prépare
  // le vendredi soir.
  envoyerLe: "",
  destinataires: [],
  creeLe: "",
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

/// Les clients du CRM qui recevront la campagne : adresse valide,
/// non désinscrits, filtres appliqués, doublons d'adresse retirés.
export const audienceDe = (clients = [], filtres = {}) => {
  const vues = new Set();
  return clients.filter((c) => {
    const d = c.data || {};
    if (!adresseValide(d.email)) return false;
    if (d.emailDesinscrit) return false;
    if (filtres.statut && filtres.statut !== "tous" && d.statut !== filtres.statut) return false;
    if (filtres.ville && (d.ville || "").toLowerCase() !== filtres.ville.toLowerCase()) return false;
    if (filtres.secteur && (d.secteur || "").toLowerCase() !== filtres.secteur.toLowerCase()) return false;
    const cle = d.email.trim().toLowerCase();
    if (vues.has(cle)) return false;
    vues.add(cle);
    return true;
  });
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
  ville: client.data.ville || "",
  statut: "attente", // attente | envoye | echec
  erreur: null,
});

/// Les variables d'un destinataire, pour appliquerModele.
export const variablesPour = (destinataire, entreprise = "") => ({
  client: destinataire.nom,
  ville: destinataire.ville,
  entreprise,
});

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

export const resumeDe = (destinataires = []) => {
  const total = destinataires.length;
  const envoyes = destinataires.filter((d) => d.statut === "envoye").length;
  const echecs = destinataires.filter((d) => d.statut === "echec").length;
  const attente = total - envoyes - echecs;
  return {
    total,
    envoyes,
    echecs,
    attente,
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

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
  // Le bouton d'action — facultatif : « Voir l'offre » vers le site, un
  // catalogue, un numéro WhatsApp. C'est lui qui porte le suivi des clics.
  cta: { label: "", url: "" },
  // La couleur d'en-tête de l'email, aux couleurs de l'entreprise.
  couleur: "#e8590c",
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
  { entreprise = "", lienCta: cta = "", lienDesinscription: desabo = "", pixel: tracage = "" } = {},
) => {
  const couleur = couleurSure(campagne.couleur);
  // Les trois liens sont posés dans des attributs : même traitement.
  const lienCta = lienSur(cta);
  const lienDesinscription = lienSur(desabo);
  const pixel = lienSur(tracage);
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

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f2f4f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f7;padding:26px 12px">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Segoe UI,Arial,sans-serif">
  <tr><td style="background:${couleur};padding:20px 32px">
    <span style="color:#ffffff;font-size:19px;font-weight:bold;letter-spacing:.02em">${echapperHtml(entreprise)}</span>
  </td></tr>
  <tr><td style="padding:30px 32px 12px">${paragraphes}${bouton}</td></tr>
  <tr><td style="padding:18px 32px 24px;border-top:1px solid #edf0f3">
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

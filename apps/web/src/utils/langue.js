// La langue d'affichage de l'espace de travail.
//
// Par défaut « automatique » : celle que le navigateur annonce — un poste
// réglé en anglais ouvre CompanyOS en anglais, un poste en français reste
// en français. On peut épingler une langue à la main ; le choix est
// retenu sur le poste.
//
// Le shell historique est écrit en français dans les composants : ce
// réglage pilote i18next, donc les surfaces traduites (le module
// Présentations aujourd'hui, les chaînes extraites au fil de l'eau
// demain). Voir src/i18nextConf.js.

import i18n from "../i18nextConf";

const CLE = "companyos-langue";

export const LANGUES = [
  { code: "fr", nom: "Français" },
  { code: "en", nom: "English" },
];

/// La langue que le navigateur annonce, ramenée à ce qu'on sait servir.
export const langueDetectee = () => {
  const annonces = navigator.languages || [navigator.language || "fr"];
  for (const l of annonces) {
    const code = String(l).toLowerCase();
    if (code.startsWith("fr")) return "fr";
    if (code.startsWith("en")) return "en";
  }
  return "fr";
};

/// Le choix enregistré : "auto" ou un code de LANGUES.
export const langueChoisie = () => localStorage.getItem(CLE) || "auto";

/// La langue réellement appliquée.
export const langueEffective = () => {
  const choix = langueChoisie();
  if (choix !== "auto" && LANGUES.some((l) => l.code === choix)) return choix;
  return langueDetectee();
};

/// La locale des dates et des heures, alignée sur la langue.
export const localeEffective = () =>
  langueEffective() === "en" ? "en-US" : "fr-FR";

export const choisirLangue = (code) => {
  if (!code || code === "auto") localStorage.removeItem(CLE);
  else localStorage.setItem(CLE, code);
  appliquerLangue();
};

/// Aligne i18next et le document sur la langue effective. Appelée au
/// démarrage (App) et à chaque changement du réglage.
export const appliquerLangue = () => {
  const code = langueEffective();
  document.documentElement.lang = code;
  i18n.changeLanguage(code);
  // Les fenêtres ouvertes se re-rendent sur cet événement (voir intl.js).
  window.dispatchEvent(new Event("companyos-langue"));
};

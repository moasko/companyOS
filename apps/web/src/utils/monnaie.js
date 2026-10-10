// La devise d'affichage de l'espace de travail.
//
// Les montants de CompanyOS vivent en franc CFA : c'est la monnaie des
// écritures, des factures et des bulletins. Mais un associé à Paris ou un
// investisseur à New York lit mieux « 23 € » que « 15 000 F ». La devise
// d'affichage convertit donc *à l'écran seulement*, à titre indicatif —
// les données, elles, ne bougent pas.
//
// Par défaut « automatique » : déduite du fuseau horaire effectif (le même
// que l'horloge, voir heure.js) — Afrique → FCFA, Europe → euro, ailleurs
// → dollar. On peut épingler une devise à la main ; le choix est retenu
// sur le poste.

import { fuseauEffectif } from "./heure.js";

const CLE = "companyos-devise";

/// Taux indicatifs. La parité XOF/EUR est fixe (655,957 F pour 1 €,
/// arrimage du franc CFA) ; le dollar est un ordre de grandeur, pas un
/// cours du jour.
const TAUX = {
  XOF: 1,
  EUR: 1 / 655.957,
  USD: 1 / 600,
};

export const DEVISES = [
  { code: "XOF", nom: "Franc CFA", symbole: "F" },
  { code: "EUR", nom: "Euro", symbole: "€" },
  { code: "USD", nom: "Dollar américain", symbole: "$" },
];

/// La devise que le lieu suggère, déduite du fuseau de l'horloge.
export const deviseDetectee = () => {
  const fuseau = fuseauEffectif();
  if (fuseau.startsWith("Africa/")) return "XOF";
  if (fuseau.startsWith("Europe/")) return "EUR";
  return "USD";
};

/// Le choix enregistré : "auto" ou un code ISO de DEVISES.
export const deviseChoisie = () => localStorage.getItem(CLE) || "auto";

export const choisirDevise = (code) => {
  if (!code || code === "auto") localStorage.removeItem(CLE);
  else localStorage.setItem(CLE, code);
  // Les fenêtres ouvertes peuvent se rafraîchir sur cet événement.
  window.dispatchEvent(new Event("companyos-devise"));
};

/// La devise réellement appliquée. Un code inconnu (ancienne valeur)
/// retombe sur la détection au lieu d'afficher des montants muets.
export const deviseEffective = () => {
  const choix = deviseChoisie();
  if (choix === "auto") return deviseDetectee();
  return TAUX[choix] ? choix : deviseDetectee();
};

/// Un montant *déjà exprimé* dans une devise donnée, sans conversion :
/// c'est le formateur des documents qui portent leur propre devise
/// (une facture en euros reste en euros, quel que soit le réglage).
export const montantDans = (n, code = "XOF") => {
  const v = Number(n) || 0;
  if (code === "EUR")
    return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`;
  if (code === "USD")
    return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `${Math.round(v).toLocaleString("fr-FR")} F`;
};

/// Un montant en franc CFA, affiché dans la devise d'affichage de
/// l'espace : converti à l'indicatif pour l'euro et le dollar, tel quel
/// en FCFA. C'est le formateur que tous les modules délèguent.
/// Montant abrégé dans la devise d'affichage, pour les cartes et les
/// indicateurs : « 18,4 M » en FCFA, « $28 k » en dollars.
export const montantAbrege = (nXof) => {
  const code = deviseEffective();
  const v = (Number(nXof) || 0) * (code === "XOF" ? 1 : TAUX[code]);
  const a = Math.abs(v);
  const fmt = (x) => x.toLocaleString(code === "USD" ? "en-US" : "fr-FR", { maximumFractionDigits: 1 });
  const corps =
    a >= 1e9 ? `${fmt(v / 1e9)} Md` : a >= 1e6 ? `${fmt(v / 1e6)} M` : a >= 1e3 ? `${fmt(Math.round(v / 1e3))} k` : `${Math.round(v)}`;
  if (code === "USD") return `$${corps}`;
  if (code === "EUR") return `${corps} €`;
  return corps;
};

export const montant = (nXof) => {
  const code = deviseEffective();
  if (code === "XOF") return montantDans(nXof, "XOF");
  return montantDans((Number(nXof) || 0) * TAUX[code], code);
};

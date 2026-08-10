// Le kit international des applications.
//
// Une app CompanyOS n'a pas à connaître i18next ni les taux de change :
// elle déclare ses textes par langue, et affiche ses montants via le
// formateur central. Ce module fournit les deux, en version React (hooks
// qui re-rendent la fenêtre quand le réglage change) et en version brute
// (pour les domaine.js sans React).
//
//   const TEXTES = {
//     fr: { bonjour: "Bonjour {nom}", total: "Total" },
//     en: { bonjour: "Hello {nom}", total: "Total" },
//   };
//
//   // Dans un composant :
//   const t = useTraduction(TEXTES);
//   const { montant } = useDevise();
//   <h2>{t("bonjour", { nom })}</h2>
//   <b>{montant(15000)}</b>
//
//   // Hors React (domaine.js, PDF…) :
//   const t = creerTraducteur(TEXTES);
//
// Le repli est par clé : une entrée absente de la langue courante prend sa
// version française (la langue d'origine du produit), et une clé inconnue
// s'affiche telle quelle — mieux vaut « total » à l'écran qu'un trou.

import { useMemo, useSyncExternalStore } from "react";
import { langueEffective } from "./langue";
import { deviseEffective, montant, montantDans } from "./monnaie";

/// Abonnement à un événement fenêtre, au format de useSyncExternalStore.
const abonne = (evenement) => (rappel) => {
  window.addEventListener(evenement, rappel);
  return () => window.removeEventListener(evenement, rappel);
};

/// Remplace {nom} par sa valeur. Pas de pluriels savants : les libellés
/// d'une app de gestion n'en ont pas besoin, et « (s) » reste honnête.
const interpole = (texte, params) =>
  params
    ? texte.replace(/\{(\w+)\}/g, (_, cle) =>
        params[cle] === undefined ? `{${cle}}` : String(params[cle]),
      )
    : texte;

const traducteurPour = (bundles, code) => (cle, params) => {
  const texte = bundles[code]?.[cle] ?? bundles.fr?.[cle] ?? cle;
  return interpole(texte, params);
};

/// Traducteur hors React : lit la langue effective à chaque appel.
export const creerTraducteur = (bundles) => (cle, params) =>
  traducteurPour(bundles, langueEffective())(cle, params);

/// La langue courante, réactive : le composant re-rend quand elle change.
export const useLangue = () =>
  useSyncExternalStore(abonne("companyos-langue"), langueEffective);

/// Un `t()` réactif, à partir des textes déclarés par l'app.
export const useTraduction = (bundles) => {
  const code = useLangue();
  return useMemo(() => traducteurPour(bundles, code), [bundles, code]);
};

/// La devise courante et les deux formateurs, réactifs.
///   montant(nXof)        — converti dans la devise d'affichage
///   montantDans(n, code) — tel quel, dans la devise d'un document
export const useDevise = () => {
  const code = useSyncExternalStore(abonne("companyos-devise"), deviseEffective);
  return { code, montant, montantDans };
};

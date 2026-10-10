// Registre des applications de CompanyOS.
//
// Une application est un dossier dans src/apps/modules/<slug>/ dont
// l'index.jsx exporte un `manifest` :
//
//   { id, slug, name, icon, action, Window, systeme }
//
// (le descriptif sans `Window` vit dans manifest.js, à côté)
//
//   id      — identifiant de la fenêtre, UNIQUE dans l'OS (défaut : icon)
//   slug    — identifiant du catalogue serveur (seed.js), pour l'installation
//   icon    — nom d'un PNG de public/img/icon (plusieurs apps peuvent
//             partager la même image : ce n'est plus une clé)
//   action  — chaîne d'action Redux héritée, facultative désormais :
//             préférez `ouvrirFenetre(id)` de src/apps/windows.js
//   Window  — le composant de la fenêtre
//   systeme — true pour une app du socle : toujours montée, jamais
//             installée ni désinstallée, absente de la Boutique et du bureau
//
// Ce fichier découvre les dossiers tout seul : en créer un suffit.
// Les dossiers préfixés par _ (comme _template) sont ignorés.
//
// CHARGEMENT À LA DEMANDE
//
// Le shell n'a besoin, au démarrage, que du descriptif de chaque
// application (nom, icône, slug) : il est dans `manifest.js`, minuscule.
// Le code de la fenêtre — `index.jsx` et tout ce qu'il importe — n'est
// téléchargé qu'à la première ouverture. Avant, les trente-quatre
// applications partaient dans le lot principal (≈ 2 Mo) : ouvrir
// CompanyOS sur un téléphone en 4G coûtait le Classeur, l'Atelier Image
// et la Comptabilité, même pour ne regarder que ses notifications.
//
// `manifest.Window` reste un composant : un `React.lazy` qui charge le
// module et rend sa fenêtre. Le shell l'enveloppe d'un `Suspense`.

import { lazy } from "react";

const descriptifs = import.meta.glob(
  ["./modules/*/manifest.js", "!./modules/_*/manifest.js"],
  { eager: true },
);
const chargeurs = import.meta.glob(["./modules/*/index.jsx", "!./modules/_*/index.jsx"]);

const tous = Object.entries(descriptifs)
  .map(([chemin, mod]) => {
    const charger = chargeurs[chemin.replace(/manifest\.js$/, "index.jsx")];
    if (!mod.manifest || !charger) return null;
    return {
      ...mod.manifest,
      /// Télécharge le module sans l'afficher (préchargement au survol).
      precharger: charger,
      Window: lazy(() => charger().then((m) => ({ default: m.manifest.Window }))),
    };
  })
  .filter(Boolean);

/// Applications système : le socle de l'OS.
export const modulesSysteme = tous.filter((m) => m.systeme);

/// Applications métier : installables depuis la Boutique.
export const modules = tous.filter((m) => !m.systeme);

/// Toutes, système comprises — ce dont le shell a besoin pour monter les
/// fenêtres.
export const modulesTous = tous;

export const moduleBySlug = Object.fromEntries(
  tous.filter((m) => m.slug).map((mod) => [mod.slug, mod]),
);

export const moduleById = Object.fromEntries(
  tous.map((mod) => [mod.id || mod.icon, mod]),
);







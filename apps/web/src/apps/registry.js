// Registre des applications de CompanyOS.
//
// Une application est un dossier dans src/apps/modules/<slug>/ dont
// l'index.jsx exporte un `manifest` :
//
//   { id, slug, name, icon, action, Window, systeme }
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

const found = import.meta.glob(
  ["./modules/*/index.jsx", "!./modules/_*/index.jsx"],
  { eager: true },
);

const tous = Object.values(found)
  .map((mod) => mod.manifest)
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







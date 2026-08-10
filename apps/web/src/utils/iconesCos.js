// Résolution des icônes CompanyOS.
//
// Le jeu d'icônes historique (hérité de Win11React) était constitué de PNG
// reprenant les visuels Microsoft. Ils sont progressivement remplacés par le
// jeu vectoriel maison de `public/img/icon/cos/*.svg`.
//
// Ce module fait la bascule sans toucher aux manifestes des applications :
// les modules continuent de déclarer `icon: "excel"`, et le résolveur sert
// `img/icon/cos/stock.svg`. Un nom absent de la table retombe sur l'ancien
// PNG, donc la migration peut se faire icône par icône.

/// Icônes disponibles dans public/img/icon/cos/, sans l'extension.
export const ICONES_COS = new Set([
  // socle
  "demarrer",
  "recherche",
  "parametres",
  "taches",
  "explorateur",
  "terminal",
  "boutique",
  "corbeille",
  "corbeille-pleine",
  // documents
  "blocnotes",
  "notes",
  "editeur",
  "presentation",
  "pdf",
  "pressepapiers",
  // métier
  "projets",
  "stock",
  "facturation",
  "crm",
  "rh",
  "paie",
  "comptabilite",
  "livraison",
  "caisse",
  "achats",
  "agenda",
  "signature",
  "courrier",
  "campagnes",
  "conges",
  "frais",
  "plateforme",
  "analyse",
  "tableur",
  "classeur",
  "code",
  // média
  "photos",
  "video",
  "musique",
  "objet3d",
  // outils
  "studio",
  "calculatrice",
  "qrcode",
  "navigateur",
  // connecteurs génériques (remplacent les logos de marques tierces)
  "connecteur-chat",
  "connecteur-mail",
  "connecteur-drive",
  "connecteur-depot",
  "connecteur-visio",
]);

/// Ancien nom d'icône -> nouvelle icône CompanyOS.
///
/// Les clés de gauche sont les valeurs `icon:` encore présentes dans les
/// manifestes et dans utils/apps.js. Tant que cette table les couvre, aucun
/// module n'a besoin d'être modifié.
export const ALIAS_ICONES = {
  // socle
  home: "demarrer",
  search: "recherche",
  settings: "parametres",
  taskmanager: "taches",
  explorer: "explorateur",
  terminal: "terminal",
  store: "boutique",
  bin0: "corbeille",
  bin1: "corbeille-pleine",
  // fichiers et dossiers : les anciens noms Windows pointent sur le jeu
  // d'icônes de types (voir src/apps/iconesFichiers.js).
  "win/folder": "fichiers/dossier",
  "win/folder-sm": "fichiers/dossier",
  "win/docs": "fichiers/texte",
  "win/onedrive-sm": "cloud",
  // documents
  notepad: "blocnotes",
  notes: "notes",
  winWord: "editeur",
  powerpoint: "presentation",
  pdf: "pdf",
  clipboard: "pressepapiers",
  // métier
  todo: "projets",
  excel: "stock",
  msoffice: "facturation",
  people: "crm",
  // « yphone » était un téléphone du jeu hérité, sans rapport avec les RH.
  yphone: "rh",
  // « onenote » et « paint » étaient les visuels Microsoft du jeu hérité.
  onenote: "comptabilite",
  paint: "studio",
  // média
  photos: "photos",
  movies: "video",
  groove: "musique",
  objet3d: "objet3d",
  // outils
  code: "studio",
  calculator: "calculatrice",
  qrcode: "qrcode",
  // « edge » venait du jeu hérité : c'est un navigateur de Microsoft, pas
  // le nôtre. Même raison que pour les marques tierces plus bas.
  edge: "navigateur",

  // Marques tierces -> connecteurs génériques. Aucun logo Microsoft, Discord,
  // Spotify ou GitHub n'est redistribué avec CompanyOS : ce sont des marques
  // déposées, et leur présence dans un produit commercial suggère une
  // affiliation qui n'existe pas.
  discord: "connecteur-chat",
  skype: "connecteur-chat",
  teams: "connecteur-visio",
  twitter: "connecteur-chat",
  mail: "connecteur-mail",
  outlook: "connecteur-mail",
  oneDrive: "connecteur-drive",
  github: "connecteur-depot",
};

/// Chemin public de l'icône à afficher pour `nom`.
///
/// `ui` cible le sous-dossier icon/ui/ (icônes système de la barre des
/// tâches), non concerné par la migration pour l'instant.
export function cheminIcone(nom, ui = false) {
  if (!nom) return null;
  if (typeof nom === "string" && nom.includes("http")) return nom;

  if (!ui) {
    // Le jeu d'icônes de types de fichiers vit sous icon/cos/fichiers/ :
    // ses noms arrivent déjà préfixés (voir src/apps/iconesFichiers.js).
    const cible =
      ALIAS_ICONES[nom] ||
      (ICONES_COS.has(nom) || nom.startsWith("fichiers/") ? nom : null);
    if (cible) return `img/icon/cos/${cible}.svg`;
  }

  return `img/icon/${ui ? "ui/" : ""}${nom}.png`;
}

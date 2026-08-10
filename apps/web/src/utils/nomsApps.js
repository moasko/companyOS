// Le nom affiché des applications.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI UN NOM À PART
//
// `name` n'est pas qu'un libellé : c'est une **clé d'identité** dans tout
// l'OS. Les icônes du bureau sont rangées par nom (`deskLayout.js`), une
// app se retire du bureau par son nom (`desktop.js`, DESKREM), et les
// listes par défaut du menu Démarrer et de la barre des tâches désignent
// leurs entrées par leur nom (`utils/index.js`).
//
// Traduire `name` déplacerait donc les icônes de chacun au premier
// changement de langue, et casserait l'épinglage. Le nom reste ce qu'il
// est ; ce module fournit, à côté, le nom **d'affichage**.
//
//   import { useNomApp } from "../../utils/nomsApps";
//   const nomApp = useNomApp();
//   <div className="appName">{nomApp(app)}</div>
//
// Hors React (une commande du Terminal, un message) : `nomApp(app)`.

import { useMemo } from "react";
import { langueEffective } from "./langue";
import { useLangue } from "./intl";

/// Les noms anglais, indexés par clé stable : `id` ou `slug` d'un module,
/// `icon` pour les applications du socle (elles n'ont pas d'identifiant).
/// Le français n'est pas listé : c'est le `name` du manifeste, qui fait foi.
const NOMS_EN = {
  // Socle
  home: "Start",
  search: "Search",
  settings: "Settings",
  taskmanager: "Task manager",
  explorer: "File Explorer",
  terminal: "Terminal",
  notepad: "Notepad",
  calculator: "Calculator",
  store: "Store",
  bin0: "Recycle Bin",

  // Gestion
  achats: "Purchasing",
  analyse: "Analytics",
  agenda: "Calendar",
  caisse: "Point of sale",
  campagnes: "Campaigns",
  comptabilite: "Accounting",
  conges: "Leave",
  courrier: "Mail",
  crm: "CRM",
  facturation: "Invoicing",
  frais: "Expenses",
  paie: "Payroll",
  plateforme: "Platform",
  projets: "Projects",
  rh: "Human resources",
  signature: "Signature",
  stock: "Inventory",
  studio: "Studio",
  tableur: "CSV Editor",
  classeur: "Spreadsheet",

  // Outils et visionneuses
  musique: "Music",
  navigateur: "Browser",
  objet3d: "3D Viewer",
  pdf: "PDF Reader",
  photos: "Photos",
  presentation: "Presentations",
  pressepapiers: "Clipboard",
  qrcode: "QR Code Generator",
  video: "Video",
  word: "Word Processor",
};

/// Les applications du socle sont parfois désignées par leur seule clé —
/// leur titre de fenêtre est écrit dans le composant, pas dans un
/// manifeste. Leur nom français vit donc ici aussi.
///
/// Deux libellés corrigent au passage une incohérence : la Calculatrice
/// s'intitulait « Calculator » en pleine interface française, et le
/// Gestionnaire de tâches s'appelait « Moniteur du système » dans sa barre
/// de titre et autrement partout ailleurs.
const NOMS_FR = {
  home: "Démarrer",
  search: "Recherche",
  settings: "Paramètres",
  taskmanager: "Gestionnaire de tâches",
  explorer: "Explorateur de fichiers",
  terminal: "Terminal",
  notepad: "Bloc-notes",
  calculator: "Calculatrice",
  store: "Boutique",
  bin0: "Corbeille",
};

/// Traductions par langue. Côté français, seul le socle est listé : pour
/// un module, le `name` du manifeste **est** la version française.
const NOMS = { fr: NOMS_FR, en: NOMS_EN };

/// La clé stable d'une entrée d'application, quelle que soit sa
/// provenance : manifeste local, store Redux, ou catalogue serveur.
const cle = (app) =>
  (typeof app === "string" ? app : app?.id || app?.slug || app?.icon) || "";

/// Le nom d'affichage d'une application dans une langue donnée.
///
/// Une app inconnue du dictionnaire — une app Studio créée par le client,
/// un module plus récent — garde son nom d'origine : mieux vaut le
/// français qu'un trou ou un identifiant technique.
export const nomAppDans = (app, code) => {
  const nom = typeof app === "string" ? "" : app?.name || "";
  return NOMS[code]?.[cle(app)] || nom || cle(app);
};

/// Le nom d'affichage dans la langue courante, hors React.
export const nomApp = (app) => nomAppDans(app, langueEffective());

/// Version réactive : le composant se re-rend au changement de langue.
export const useNomApp = () => {
  const code = useLangue();
  return useMemo(() => (app) => nomAppDans(app, code), [code]);
};

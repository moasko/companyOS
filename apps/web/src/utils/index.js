import icons from "./apps";

// Disposition par défaut du shell. Les modules installés depuis la Boutique
// viennent s'ajouter au bureau dynamiquement (voir src/apps/sync.js).
var { taskbar, desktop, pinned, recent } = {
  taskbar: (localStorage.getItem("taskbar") &&
    JSON.parse(localStorage.getItem("taskbar"))) || [
    "Explorateur de fichiers",
    "Boutique",
    "Paramètres",
  ],
  desktop: (localStorage.getItem("desktop") &&
    JSON.parse(localStorage.getItem("desktop"))) || [
    "Explorateur de fichiers",
    "Boutique",
    "Terminal",
    "Corbeille",
  ],
  pinned: (localStorage.getItem("pinned") &&
    JSON.parse(localStorage.getItem("pinned"))) || [
    "Explorateur de fichiers",
    "Boutique",
    "Paramètres",
    "Gestionnaire de tâches",
    "Terminal",
    "Bloc-notes",
    "Calculatrice",
  ],
  recent: (localStorage.getItem("recent") &&
    JSON.parse(localStorage.getItem("recent"))) || [
    "Explorateur de fichiers",
    "Boutique",
    "Paramètres",
    "Terminal",
    "Bloc-notes",
    "Calculatrice",
  ],
};

export const taskApps = icons.filter((x) => taskbar.includes(x.name));

export const desktopApps = icons
  .filter((x) => desktop.includes(x.name))
  .sort((a, b) => {
    return desktop.indexOf(a.name) > desktop.indexOf(b.name) ? 1 : -1;
  });

export const pinnedApps = icons
  .filter((x) => pinned.includes(x.name))
  .sort((a, b) => {
    return pinned.indexOf(a.name) > pinned.indexOf(b.name) ? 1 : -1;
  });

export const recentApps = icons
  .filter((x) => recent.includes(x.name))
  .sort((a, b) => {
    return recent.indexOf(a.name) > recent.indexOf(b.name) ? 1 : -1;
  });

export const allApps = icons.filter((app) => {
  return app.type === "app";
});

export const dfApps = {
  taskbar,
  desktop,
  pinned,
  recent,
};

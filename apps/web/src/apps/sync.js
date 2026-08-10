// Synchronisation entre les installations côté API et le shell.
//
// Un module installé apparaît (bureau, menu Démarrer, fenêtre) ; un module
// non installé n'existe nulle part. Les modules **système** échappent à
// cette règle : ils sont toujours là, on ne désinstalle pas sa visionneuse
// d'images.

import store from "../reducers";
import { cleApp } from "../reducers/apps";
import { api } from "../api/client";
import { modules, modulesSysteme, moduleBySlug } from "./registry";
import { fenetre } from "./windows";

/// Entrée de shell d'un module livré dans le dépôt.
///
/// `id` est la clé de fenêtre, `icon` le fichier image : deux choses
/// différentes, contrairement à avant.
const toAppEntry = (mod) => ({
  id: cleApp(mod),
  name: mod.name,
  icon: mod.icon,
  type: "app",
  action: mod.action,
});

/// Les applications du Studio n'ont pas de code : leur fenêtre est rendue
/// par le moteur générique. Leur identifiant dérive du slug — deux apps
/// peuvent ainsi choisir la même image sans partager la même fenêtre.
export const customEntry = (app) => ({
  id: `custom-${app.slug}`,
  slug: app.slug,
  name: app.name,
  icon: app.icon,
  type: "app",
  action: `CUSTOMAPP_${app.slug.toUpperCase().replace(/-/g, "_")}`,
  definition: app.definition,
});

/// Une entrée du Studio se reconnaît à son slug et à sa définition.
const estEntreeDeShell = (mod) => mod.slug && mod.definition !== undefined;

const entreeDe = (mod) => (estEntreeDeShell(mod) ? mod : toAppEntry(mod));

/// Fait apparaître un module dans le shell.
export const attachModule = (mod) => {
  const state = store.getState();
  const entry = entreeDe(mod);

  if (!state.apps[entry.id]) {
    store.dispatch({ type: "ADDAPP", payload: entry });
  }
  if (!state.desktop.apps.some((a) => a.name === entry.name)) {
    store.dispatch({ type: "DESKADD", payload: entry });
  }
};

/// Retire un module du shell (fenêtre fermée, icônes enlevées).
export const detachModule = (mod) => {
  const state = store.getState();
  const entry = entreeDe(mod);

  if (state.apps[entry.id]) {
    fenetre(entry.id, "close");
    store.dispatch({ type: "DELAPP", payload: entry.id });
  }
  store.dispatch({ type: "DESKREM", payload: entry.name });
};

/// Les applications système sont montées sans condition, dès l'ouverture de
/// session : un double-clic sur un fichier doit toujours trouver de quoi
/// l'ouvrir. Elles ne figurent ni dans la Boutique ni sur le bureau.
export const attachSystemModules = () => {
  const state = store.getState();
  for (const mod of modulesSysteme) {
    if (!state.apps[cleApp(mod)]) {
      store.dispatch({ type: "ADDAPP", payload: toAppEntry(mod) });
    }
  }
};

/// Aligne le shell sur la liste d'installations de l'espace de travail.
/// Appelée à l'ouverture de session et après chaque (dés)installation.
export const syncInstalledModules = async () => {
  attachSystemModules();

  const installed = await api.installedApps();
  const installedSlugs = new Set(installed.map((a) => a.slug));

  // Modules métier livrés dans le dépôt.
  for (const mod of modules) {
    if (installedSlugs.has(mod.slug)) attachModule(mod);
    else detachModule(mod);
  }

  // Applications décrites dans le Studio.
  const previous = store.getState().customApps;
  const current = installed
    .filter((a) => a.kind === "CUSTOM" && a.definition)
    .map(customEntry);

  const ids = new Set(current.map((c) => c.id));
  for (const old of previous) {
    if (!ids.has(old.id)) detachModule(old);
  }
  for (const entry of current) attachModule(entry);

  store.dispatch({ type: "CUSTOM_APPS_SET", payload: current });
};

/// À la déconnexion : plus de session, plus de modules métier. Les modules
/// système restent — ils n'exposent rien tant qu'on ne leur donne pas de
/// fichier à ouvrir.
export const detachAllModules = () => {
  for (const mod of modules) detachModule(mod);
  for (const entry of store.getState().customApps) detachModule(entry);
  store.dispatch({ type: "CUSTOM_APPS_SET", payload: [] });
};

export { moduleBySlug };

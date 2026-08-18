// Préférences personnelles synchronisées entre les appareils.
//
// Les données métier, fichiers et installations vivent déjà côté serveur.
// Ici ne transitent que les choix du shell, sans jeton ni contenu utilisateur.

import store from "../reducers";
import { api } from "../api/client";
import { appliquerLangue } from "../utils/langue";
import { appliquerApparence } from "./appearance";

const CLES_LOCALES = [
  "companyos-langue",
  "companyos-fuseau",
  "companyos-devise",
  "companyos-mcp-writes",
  "companyos-code-formatage",
  "companyos-code-theme",
];

let arreter = null;
let minuterie = null;
let intervalle = null;
let derniere = "";

const fenetres = (apps) =>
  Object.fromEntries(
    Object.entries(apps)
      .filter(([id]) => id !== "hz")
      .map(([id, app]) => [
        id,
        Object.fromEntries(
          ["size", "hide", "max", "z", "dim", "ouvert"]
            .filter((key) => app?.[key] !== undefined)
            .map((key) => [key, app[key]]),
        ),
      ]),
  );

export const instantanePreferences = (state = store.getState()) => ({
  schemaVersion: 1,
  windows: fenetres(state.apps),
  wallpaper: { wps: state.wallpaper.wps, src: state.wallpaper.src },
  taskbar: { align: state.taskbar.align, search: state.taskbar.search },
  desktop: {
    hide: state.desktop.hide,
    size: state.desktop.size,
    sort: state.desktop.sort,
  },
  deskLayout: { positions: state.deskLayout.positions },
  setting: {
    person: { theme: state.setting.person?.theme, color: state.setting.person?.color },
  },
  appearance: {
    wallNodeId: state.appearance.wallNodeId,
    fontNodeId: state.appearance.fontNodeId,
    fontName: state.appearance.fontName,
    fontId: state.appearance.fontId,
    fontStack: state.appearance.fontStack,
  },
  locales: Object.fromEntries(
    CLES_LOCALES.map((key) => [key, localStorage.getItem(key)]),
  ),
});

const appliquerLocales = (locales = {}) => {
  for (const key of CLES_LOCALES) {
    const value = locales[key];
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  }
  appliquerLangue();
  window.dispatchEvent(new Event("companyos-devise"));
};

export const demarrerPreferences = async (tenantId) => {
  if (arreter) arreter();
  if (minuterie) clearTimeout(minuterie);
  if (intervalle) clearInterval(intervalle);

  const { preferences = {} } = await api.preferences();
  if (preferences && Object.keys(preferences).length) {
    appliquerLocales(preferences.locales);
    if (tenantId && preferences.appearance) {
      localStorage.setItem(
        `appearance:${tenantId}`,
        JSON.stringify(preferences.appearance),
      );
      await appliquerApparence(tenantId);
    }
    store.dispatch({ type: "PREFERENCES_RESTORE", payload: preferences });
    if (preferences.setting?.person?.theme) {
      document.body.dataset.theme = preferences.setting.person.theme;
    }
  }

  derniere = JSON.stringify(instantanePreferences());
  if (!preferences || !Object.keys(preferences).length) {
    await api.enregistrerPreferences(JSON.parse(derniere));
  }

  const programmer = () => {
    const prochain = JSON.stringify(instantanePreferences());
    if (prochain === derniere) return;
    derniere = prochain;
    if (minuterie) clearTimeout(minuterie);
    minuterie = setTimeout(() => {
      api.enregistrerPreferences(JSON.parse(prochain)).catch(() => {
        // Une coupure réseau ne doit jamais interrompre le bureau. Le prochain
        // changement réessaiera ; les reducers conservent leur repli local.
      });
    }, 900);
  };
  arreter = store.subscribe(programmer);
  // Les choix régionaux vivent encore dans localStorage et ne déclenchent
  // pas tous une action Redux. Ce contrôle léger les capture aussi.
  intervalle = setInterval(programmer, 10_000);
};

export const arreterPreferences = () => {
  if (arreter) arreter();
  if (minuterie) clearTimeout(minuterie);
  if (intervalle) clearInterval(intervalle);
  arreter = null;
  minuterie = null;
  intervalle = null;
};

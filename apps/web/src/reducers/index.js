import { combineReducers, createStore } from "redux";

import wallReducer from "./wallpaper";
import taskReducer from "./taskbar";
import deskReducer from "./desktop";
import menuReducer from "./startmenu";
import paneReducer from "./sidepane";
import appReducer from "./apps";
import globalReducer from "./globals";
import settReducer from "./settings";
import fileReducer from "./files";
import sessionReducer from "./session";
import cloudReducer from "./cloud";
import customAppsReducer from "./customApps";
import deskLayoutReducer from "./deskLayout";
import appearanceReducer from "./appearance";

const allReducers = combineReducers({
  wallpaper: wallReducer,
  taskbar: taskReducer,
  desktop: deskReducer,
  startmenu: menuReducer,
  sidepane: paneReducer,
  apps: appReducer,
  globals: globalReducer,
  setting: settReducer,
  files: fileReducer,
  session: sessionReducer,
  cloud: cloudReducer,
  customApps: customAppsReducer,
  deskLayout: deskLayoutReducer,
  appearance: appearanceReducer,
});

const rootReducer = (state, action) => {
  const next = allReducers(state, action);
  if (action.type !== "PREFERENCES_RESTORE") return next;
  const p = action.payload || {};
  const windows = { ...next.apps };
  // Des fenêtres de la session précédente, on ne reprend que la
  // **géométrie** : une fenêtre redimensionnée se rouvrira à la même taille.
  // On ne les rouvre pas : restaurer `hide` faisait réapparaître, à chaque
  // connexion, tout ce qui était ouvert la veille — souvent en plein écran —
  // et l'utilisateur n'arrivait jamais sur son bureau. Windows et macOS ne
  // le font pas non plus par défaut.
  for (const [id, saved] of Object.entries(p.windows || {})) {
    if (!windows[id] || !saved || typeof saved !== "object") continue;
    windows[id] = {
      ...windows[id],
      ...(saved.dim !== undefined ? { dim: saved.dim } : {}),
      ...(saved.size === "cstm" ? { size: "cstm" } : {}),
    };
  }
  return {
    ...next,
    apps: windows,
    wallpaper: { ...next.wallpaper, ...(p.wallpaper || {}) },
    taskbar: { ...next.taskbar, ...(p.taskbar || {}) },
    desktop: { ...next.desktop, ...(p.desktop || {}), apps: next.desktop.apps },
    deskLayout: {
      ...next.deskLayout,
      positions: p.deskLayout?.positions || next.deskLayout.positions,
    },
    setting: {
      ...next.setting,
      person: { ...next.setting.person, ...(p.setting?.person || {}) },
    },
    appearance: {
      ...next.appearance,
      ...(p.appearance || {}),
      wallUrl: next.appearance.wallUrl,
    },
  };
};

var store = createStore(rootReducer);

export default store;

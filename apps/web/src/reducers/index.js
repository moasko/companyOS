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
  for (const [id, saved] of Object.entries(p.windows || {})) {
    if (!windows[id] || !saved || typeof saved !== "object") continue;
    windows[id] = {
      ...windows[id],
      ...Object.fromEntries(
        ["size", "hide", "max", "z", "dim", "ouvert"]
          .filter((key) => saved[key] !== undefined)
          .map((key) => [key, saved[key]]),
      ),
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

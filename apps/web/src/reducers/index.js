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

var store = createStore(allReducers);

export default store;

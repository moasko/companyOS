import { desktopApps } from "../utils";

// Les réglages du bureau sont retenus : un réglage qui s'oublie au
// rechargement n'en est pas un.
const defState = {
  apps: desktopApps,
  hide: localStorage.getItem("desktop-hide") === "true",
  size: Number(localStorage.getItem("desktop-size")) || 1,
  sort: localStorage.getItem("desktop-sort") || "none",
  abOpen: false,
};

const deskReducer = (state = defState, action) => {
  switch (action.type) {
    case "DESKREM":
      var arr = state.apps.filter((x) => x.name != action.payload);

      localStorage.setItem("desktop", JSON.stringify(arr.map((x) => x.name)));
      return { ...state, apps: arr };
    case "DESKADD":
      var arr = [...state.apps];
      arr.push(action.payload);

      localStorage.setItem("desktop", JSON.stringify(arr.map((x) => x.name)));
      return { ...state, apps: arr };
    case "DESKHIDE":
      // « Actualiser » masque puis réaffiche : ce passage n'est pas un
      // choix de l'utilisateur, on ne l'enregistre donc pas.
      return {
        ...state,
        hide: true,
      };
    case "DESKSHOW":
      return {
        ...state,
        hide: false,
      };
    case "DESKTOGG":
      localStorage.setItem("desktop-hide", String(!state.hide));
      return {
        ...state,
        hide: !state.hide,
      };
    case "DESKSIZE":
      localStorage.setItem("desktop-size", action.payload);
      return {
        ...state,
        size: action.payload,
      };
    case "DESKSORT":
      localStorage.setItem("desktop-sort", action.payload || "none");
      return {
        ...state,
        sort: action.payload || "none",
      };
    case "DESKABOUT":
      return {
        ...state,
        abOpen: action.payload,
      };
    default:
      return state;
  }
};

export default deskReducer;

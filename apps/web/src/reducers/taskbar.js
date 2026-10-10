import { taskApps } from "../utils";

const alignment = localStorage.getItem("taskbar-align") || "center";

/// Applications épinglées : des clés de fenêtre (`id || icon`), dans
/// l'ordre de la barre. Repris de l'ancienne liste par noms à la première
/// ouverture, puis retenus — et synchronisés entre appareils avec les
/// autres préférences (src/apps/preferences.js).
const CLE_EPINGLES = "taskbar-epingles";
const lireEpingles = () => {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_EPINGLES) || "null");
    if (Array.isArray(brut)) return brut.filter((x) => typeof x === "string").slice(0, 40);
  } catch {
    // Valeur abîmée : on repart de la liste par défaut.
  }
  return taskApps.map((a) => a.id || a.icon);
};
const ecrireEpingles = (liste) => {
  try {
    localStorage.setItem(CLE_EPINGLES, JSON.stringify(liste));
  } catch {
    // Stockage refusé : l'épinglage vaut pour la session.
  }
  return liste;
};

const defState = {
  apps: taskApps,
  epingles: lireEpingles(),
  prev: false,
  prevApp: "",
  prevPos: 0,
  align: alignment,
  // Retenue, comme l'alignement : un réglage qui s'oublie n'en est pas un.
  search: localStorage.getItem("taskbar-search") !== "false",
};

const taskReducer = (state = defState, action) => {
  switch (action.type) {
    case "TASKADD":
    case "TASKPIN": {
      const cle = action.payload;
      if (typeof cle !== "string" || state.epingles.includes(cle)) return state;
      return { ...state, epingles: ecrireEpingles([...state.epingles, cle]) };
    }
    case "TASKREM":
    case "TASKUNPIN":
      if (!state.epingles.includes(action.payload)) return state;
      return { ...state, epingles: ecrireEpingles(state.epingles.filter((c) => c !== action.payload)) };
    case "TASKORDER": {
      // Nouvel ordre après un glisser-déposer : seules les clés déjà
      // épinglées sont gardées, et aucune ne se perd en route.
      const voulu = (action.payload || []).filter((c) => state.epingles.includes(c));
      const reste = state.epingles.filter((c) => !voulu.includes(c));
      return { ...state, epingles: ecrireEpingles([...voulu, ...reste]) };
    }
    case "TASKCEN":
      localStorage.setItem("taskbar-align", "center");
      return {
        ...state,
        align: "center",
      };
    case "TASKLEF":
      localStorage.setItem("taskbar-align", "left");
      return {
        ...state,
        align: "left",
      };
    case "TASKTOG": {
      const alignment = state.align == "left" ? "center" : "left";
      localStorage.setItem("taskbar-align", alignment);
      return {
        ...state,
        align: alignment,
      };
    }
    case "TASKPSHOW":
      return {
        ...state,
        prev: true,
        prevApp: (action.payload && action.payload.app) || "store",
        prevPos: (action.payload && action.payload.pos) || 50,
      };
    case "TASKPHIDE":
      return {
        ...state,
        prev: false,
      };
    case "TASKSRCH":
      localStorage.setItem("taskbar-search", action.payload);
      return {
        ...state,
        search: action.payload == "true",
      };
    default:
      return state;
  }
};

export default taskReducer;

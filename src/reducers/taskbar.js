import { taskApps } from "../utils";

const alignment = localStorage.getItem("taskbar-align") || "center";

const defState = {
  apps: taskApps,
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
      return state;
    case "TASKREM":
      return state;
    case "TASKCEN":
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
    case "TASKTOG":
      const alignment = state.align == "left" ? "center" : "left";
      localStorage.setItem("taskbar-align", alignment);
      return {
        ...state,
        align: alignment,
      };
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

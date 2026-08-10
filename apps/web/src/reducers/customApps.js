// Applications créées dans le Studio et installées dans cet espace.
//
// Elles n'ont pas de code dans le dépôt : leur définition (collections et
// champs) est chargée depuis l'API, et un moteur générique la rend. Ce
// reducer garde la liste de celles qui doivent avoir une fenêtre.

const customAppsReducer = (state = [], action) => {
  if (action.type === "CUSTOM_APPS_SET") return action.payload;
  return state;
};

export default customAppsReducer;

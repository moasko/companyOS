// Compteur de rafraîchissement du cloud.
// Toute app qui écrit un fichier dispatche CLOUD_TOUCH ; l'Explorateur
// observe `version` et recharge le dossier courant.

const cloudReducer = (state = { version: 0 }, action) => {
  if (action.type === "CLOUD_TOUCH") {
    return { version: state.version + 1 };
  }
  return state;
};

export default cloudReducer;

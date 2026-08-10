// Apparence personnalisée : fond d'écran et police choisis par l'espace
// de travail. La logique vit dans src/apps/appearance.js ; ce reducer ne
// garde que l'état lisible par les composants.

const defState = {
  tenantId: null,
  // Identifiants des fichiers dans le cloud
  wallNodeId: null,
  fontNodeId: null,
  fontName: null,
  fontId: "systeme",
  fontStack: null,
  // URL d'objet du fond courant, résolue au chargement
  wallUrl: null,
};

const appearanceReducer = (state = defState, action) => {
  switch (action.type) {
    case "APPEARANCE_SET":
      return { ...state, ...action.payload };
    case "APPEARANCE_WALL_URL":
      // L'URL précédente n'a plus d'utilité : on libère la mémoire.
      if (state.wallUrl && state.wallUrl !== action.payload) {
        URL.revokeObjectURL(state.wallUrl);
      }
      return { ...state, wallUrl: action.payload };
    case "APPEARANCE_RESET":
      if (state.wallUrl) URL.revokeObjectURL(state.wallUrl);
      return defState;
    default:
      return state;
  }
};

export default appearanceReducer;

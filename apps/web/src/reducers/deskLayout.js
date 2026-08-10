// Position des icônes sur le bureau.
//
// Rangées par nom d'application, et persistées par espace de travail :
// deux entreprises qui partagent un poste ne se renvoient pas leurs
// dispositions à la figure.

export const GRID = { x: 82, y: 92, top: 12, left: 12 };

const cle = (tenantId) => `desktop-layout:${tenantId || "anonyme"}`;

export const chargerLayout = (tenantId) => {
  try {
    return JSON.parse(localStorage.getItem(cle(tenantId)) || "{}");
  } catch {
    return {};
  }
};

const enregistrer = (tenantId, positions) => {
  if (!tenantId) return;
  try {
    localStorage.setItem(cle(tenantId), JSON.stringify(positions));
  } catch {
    /* quota du navigateur plein : la disposition sera simplement recalculée */
  }
};

const defState = { tenantId: null, positions: {} };

const deskLayoutReducer = (state = defState, action) => {
  switch (action.type) {
    case "DESKLAYOUT_LOAD":
      return {
        tenantId: action.payload,
        positions: chargerLayout(action.payload),
      };
    case "DESKLAYOUT_SET": {
      const positions = {
        ...state.positions,
        [action.payload.name]: { x: action.payload.x, y: action.payload.y },
      };
      enregistrer(state.tenantId, positions);
      return { ...state, positions };
    }
    /// Remet les icônes en colonnes, dans l'ordre du bureau.
    case "DESKLAYOUT_RESET":
      enregistrer(state.tenantId, {});
      return { ...state, positions: {} };
    default:
      return state;
  }
};

export default deskLayoutReducer;

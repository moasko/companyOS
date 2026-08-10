// Volet rapide. CompanyOS tourne dans un navigateur : pas de Wi-Fi, de
// Bluetooth, de batterie ni de luminosité à piloter. Ne restent que les
// réglages que l'OS contrôle réellement.
const defState = {
  quicks: [
    {
      ui: true,
      src: "sun",
      name: "Thème",
      state: "person.theme",
      action: "changeTheme",
    },
  ],
  hide: true,
  banhide: true,
  calhide: true,
};

const paneReducer = (state = defState, action) => {
  if (action.type == "PANETHEM") {
    var tmpState = { ...state };
    tmpState.quicks = tmpState.quicks.map((q) =>
      q.name === "Thème" ? { ...q, src: action.payload } : q,
    );
    return tmpState;
  } else if (action.type == "BANDTOGG") {
    return { ...state, banhide: !state.banhide };
  } else if (action.type == "BANDHIDE") {
    return { ...state, banhide: true };
  } else if (action.type == "PANETOGG") {
    return { ...state, hide: !state.hide };
  } else if (action.type == "PANEHIDE") {
    return { ...state, hide: true };
  } else if (action.type == "CALNTOGG") {
    return { ...state, calhide: !state.calhide };
  } else if (action.type == "CALNHIDE") {
    return { ...state, calhide: true };
  } else {
    return state;
  }
};

export default paneReducer;

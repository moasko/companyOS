// Session CompanyOS : compte connecté + espace de travail.
// Alimentée par l'écran de connexion et rechargée au démarrage via /auth/me.

const defState = {
  user: null,
  tenant: null,
  // "loading" tant que le jeton stocké n'a pas été vérifié auprès de l'API.
  status: "loading",
};

const sessionReducer = (state = defState, action) => {
  switch (action.type) {
    case "SESSION_SET":
      return {
        user: action.payload.user,
        tenant: action.payload.tenant,
        // Double authentification exigée mais pas encore configurée : le
        // bureau reste derrière l'écran de configuration.
        mfaAConfigurer: !!action.payload.mfaAConfigurer,
        status: "authenticated",
      };
    case "SESSION_MFA":
      return { ...state, mfaAConfigurer: !!action.payload };
    case "SESSION_USAGE":
      return {
        ...state,
        tenant: state.tenant ? { ...state.tenant, ...action.payload } : state.tenant,
      };
    case "SESSION_CLEAR":
      return { user: null, tenant: null, status: "anonymous" };
    default:
      return state;
  }
};

export default sessionReducer;

import { allApps } from "../utils";
import { appliquerMode, planDuDessus } from "../apps/pileFenetres";

var dev = "";
if (import.meta.env.MODE == "development") {
  dev = ""; // set the name (lowercase) of the app you are developing so that it will be opened on refresh
}

/// Clé d'état d'une application.
///
/// C'est son `id`, et plus son icône. Confondre les deux interdisait à deux
/// applications de partager une image, et forçait le Studio à fabriquer des
/// clés `custom-<slug>` qu'on retrouvait ensuite dans les chemins d'icônes.
/// `icon` redevient ce qu'il aurait toujours dû être : un fichier.
///
/// Le repli sur `icon` garde les anciennes entrées fonctionnelles le temps
/// que toutes déclarent un `id`.
export const cleApp = (app) => app.id || app.icon;

const nouvelleFenetre = (app) => ({
  ...app,
  id: cleApp(app),
  // Une fenêtre s'ouvre en taille normale : plein écran doit rester un
  // choix de l'utilisateur, pas l'état par défaut.
  size: "mini",
  hide: true,
  max: null,
  z: 0,
});

const defState = {};
for (var i = 0; i < allApps.length; i++) {
  // Copie : `allApps` est la description statique du catalogue, partagée
  // avec le bureau et le menu Démarrer. L'état de fenêtre lui appartient,
  // pas l'inverse.
  const cle = cleApp(allApps[i]);
  defState[cle] = nouvelleFenetre(allApps[i]);

  if (cle == dev) {
    defState[cle].hide = false;
    defState[cle].max = true;
    defState[cle].z = 1;
  }
}

defState.hz = 2;

const appReducer = (state = defState, action) => {
  // Gestionnaire de fenêtres générique : une seule action pour toutes les
  // applications, adressée par identifiant. Voir src/apps/windows.js.
  if (action.type == "WINDOW") {
    const { id, mode } = action.payload || {};
    if (!id || !state[id]) return state;
    return appliquerMode(state, id, mode, action);
  }

  var tmpState = { ...state };

  if (action.type == "SHOWDSK") {
    var keys = Object.keys(tmpState);

    for (var i = 0; i < keys.length; i++) {
      var obj = { ...tmpState[keys[i]] };
      if (obj.hide == false) {
        obj.max = false;
        obj.z = -1;
        tmpState[keys[i]] = obj;
      }
    }
    tmpState.hz = planDuDessus(tmpState);

    return tmpState;
  } else if (action.type == "EXTERNAL") {
    // `noopener` : la page ouverte ne reçoit pas `window.opener`, et ne
    // peut donc pas renvoyer le shell vers une fausse page de connexion.
    window.open(action.payload, "_blank", "noopener,noreferrer");
  } else if (action.type == "ADDAPP") {
    tmpState[cleApp(action.payload)] = nouvelleFenetre(action.payload);
    return tmpState;
  } else if (action.type == "DELAPP") {
    delete tmpState[action.payload];
    return tmpState;
  }

  // Compatibilité : les actions propres à une application continuent de
  // fonctionner (`EXPLORER`, `WORDAPP`…). Le code migre progressivement
  // vers `WINDOW`, qui n'a pas besoin de ce balayage.
  var keys = Object.keys(state);
  for (var i = 0; i < keys.length; i++) {
    if (state[keys[i]].action == action.type) {
      return appliquerMode(state, keys[i], action.payload, action);
    }
  }

  return state;
};

export default appReducer;

import { allApps } from "../utils";

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

// Rang d'ouverture des fenêtres, pour la barre des tâches : une icône
// apparaît à la suite des autres et garde sa place tant que la fenêtre est
// ouverte. Sans ce rang, la barre suivait l'ordre des clés de l'état — un
// ordre d'attachement des modules qui change à chaque installation ou
// synchronisation, et les icônes se mélangeaient. Simple compteur de
// module : il ordonne, il ne persiste pas.
let ordreOuverture = 1;

/// Applique un mode d'affichage à une fenêtre.
///
/// Renvoie un nouvel état : ni `state` ni les objets qu'il contient ne sont
/// modifiés. `tmpState` n'étant qu'une copie superficielle, muter une de ses
/// valeurs réécrirait aussi l'ancien état — et react-redux, qui compare les
/// références, ne verrait aucun changement à repeindre.
const appliquerMode = (state, cle, mode, action) => {
  const tmpState = { ...state };
  const obj = { ...state[cle] };
  const etaitCachee = obj.hide;

  if (mode == "full") {
    // « full » veut dire « ouvrir et mettre au premier plan » : on ne touche
    // pas à la taille, pour qu'une fenêtre déjà agrandie le reste.
    obj.hide = false;
    obj.max = true;
    tmpState.hz += 1;
    obj.z = tmpState.hz;
  } else if (mode == "close") {
    obj.hide = true;
    obj.max = null;
    obj.z = -1;
    tmpState.hz -= 1;
  } else if (mode == "mxmz") {
    obj.size = ["mini", "full"][obj.size != "full" ? 1 : 0];
    obj.hide = false;
    obj.max = true;
    tmpState.hz += 1;
    obj.z = tmpState.hz;
  } else if (mode == "togg") {
    if (obj.z != tmpState.hz) {
      obj.hide = false;
      if (!obj.max) {
        tmpState.hz += 1;
        obj.z = tmpState.hz;
        obj.max = true;
      } else {
        obj.z = -1;
        obj.max = false;
      }
    } else {
      obj.max = !obj.max;
      obj.hide = false;
      if (obj.max) {
        tmpState.hz += 1;
        obj.z = tmpState.hz;
      } else {
        obj.z = -1;
        tmpState.hz -= 1;
      }
    }
  } else if (mode == "mnmz") {
    obj.max = false;
    obj.hide = false;
    if (obj.z == tmpState.hz) {
      tmpState.hz -= 1;
    }
    obj.z = -1;
  } else if (mode == "resize") {
    obj.size = "cstm";
    obj.hide = false;
    obj.max = true;
    if (obj.z != tmpState.hz) tmpState.hz += 1;
    obj.z = tmpState.hz;
    obj.dim = action.dim;
  } else if (mode == "front") {
    obj.hide = false;
    obj.max = true;
    if (obj.z != tmpState.hz) {
      tmpState.hz += 1;
      obj.z = tmpState.hz;
    }
  } else {
    return state;
  }

  // La fenêtre vient de s'ouvrir : elle prend le rang suivant, et le garde
  // jusqu'à sa fermeture. C'est lui que la barre des tâches trie.
  if (etaitCachee && !obj.hide) obj.ouvert = ordreOuverture++;

  tmpState[cle] = obj;
  return tmpState;
};

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
        if (obj.z == tmpState.hz) {
          tmpState.hz -= 1;
        }
        obj.z = -1;
        tmpState[keys[i]] = obj;
      }
    }

    return tmpState;
  } else if (action.type == "EXTERNAL") {
    window.open(action.payload, "_blank");
  } else if (action.type == "OPENTERM") {
    var obj = { ...tmpState["terminal"] };
    obj.dir = action.payload;

    obj.size = "mini";
    if (obj.hide) obj.ouvert = ordreOuverture++;
    obj.hide = false;
    obj.max = true;
    tmpState.hz += 1;
    obj.z = tmpState.hz;
    tmpState["terminal"] = obj;
    return tmpState;
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

// Pile des fenêtres : premier plan, réduction, fermeture, bascule depuis la
// barre des tâches. Sans React ni Redux — testé dans test/pile-fenetres.test.js.
//
// Chaque fenêtre porte `z` (son plan ; -1 = réduite ou fermée), `max`
// (affichée), `hide` (fermée) ; `hz` est le plan le plus haut : la fenêtre
// qui l'occupe est la fenêtre active.

// Rang d'ouverture des fenêtres, pour la barre des tâches : une icône
// apparaît à la suite des autres et garde sa place tant que la fenêtre est
// ouverte. Sans ce rang, la barre suivait l'ordre des clés de l'état — un
// ordre d'attachement des modules qui change à chaque installation ou
// synchronisation, et les icônes se mélangeaient. Simple compteur de
// module : il ordonne, il ne persiste pas.
let ordreOuverture = 1;

/// Le plan le plus haut parmi les fenêtres visibles. Après une fermeture
/// ou une réduction, `hz` y redescend : la fenêtre restée devant redevient
/// active (comme sous Windows), et la prochaine ouverte passe au-dessus
/// d'elle. Décrémenter de 1 « à l'aveugle » créait des doublons de plan
/// dès qu'on fermait une fenêtre qui n'était pas devant : deux fenêtres
/// au même z, toutes deux allumées dans la barre des tâches.
export const planDuDessus = (state) => {
  let haut = 1;
  for (const [id, f] of Object.entries(state)) {
    if (id !== "hz" && f && typeof f === "object" && f.hide === false && f.max && f.z > haut) haut = f.z;
  }
  return haut;
};

/// Applique un mode d'affichage à une fenêtre.
///
/// Renvoie un nouvel état : ni `state` ni les objets qu'il contient ne sont
/// modifiés. `tmpState` n'étant qu'une copie superficielle, muter une de ses
/// valeurs réécrirait aussi l'ancien état — et react-redux, qui compare les
/// références, ne verrait aucun changement à repeindre.
export const appliquerMode = (state, cle, mode, action) => {
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
  } else if (mode == "mxmz") {
    obj.size = ["mini", "full"][obj.size != "full" ? 1 : 0];
    obj.hide = false;
    obj.max = true;
    tmpState.hz += 1;
    obj.z = tmpState.hz;
  } else if (mode == "togg") {
    // Clic sur l'icône de la barre des tâches : la fenêtre active se
    // réduit ; toute autre — fermée, réduite ou cachée derrière une autre —
    // passe au premier plan. Une fenêtre ouverte mais recouverte se
    // réduisait jusqu'ici au lieu de revenir devant.
    const active = !obj.hide && obj.max && obj.z == tmpState.hz;
    obj.hide = false;
    if (active) {
      obj.max = false;
      obj.z = -1;
    } else {
      obj.max = true;
      tmpState.hz += 1;
      obj.z = tmpState.hz;
    }
  } else if (mode == "mnmz") {
    obj.max = false;
    obj.hide = false;
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
  if (etaitCachee && !obj.hide) {
    obj.ouvert = ordreOuverture++;
    // Cascade : chaque fenêtre ouverte se décale un peu de celles déjà à
    // l'écran, comme sous Windows. Elles s'empilaient jusqu'ici exactement
    // au même endroit, et la dernière cachait entièrement les autres.
    const visibles = Object.entries(state).filter(
      ([id, f]) => id !== cle && f && typeof f === "object" && f.hide === false,
    ).length;
    obj.cascade = visibles % 6;
  }

  tmpState[cle] = obj;
  if (obj.z < 0) tmpState.hz = planDuDessus(tmpState);
  return tmpState;
};

var wps = Number(localStorage.getItem("wps")) || 0;
var locked = localStorage.getItem("locked");

/// Fonds livrés avec CompanyOS.
///
/// Ce sont des SVG et non des JPEG : ils reprennent la tuile squircle du jeu
/// d'icônes, pèsent environ 1 Ko au lieu de 2 Mo, et restent nets quelle que
/// soit la définition de l'écran. Les fonds Windows 11 hérités du fork
/// (default/, dark/, ThemeA à ThemeD) ont été retirés.
const walls = [
  "clair/img0.svg",
  "sombre/img0.svg",
  "aurore/img0.svg",
  "prairie/img0.svg",
  "ambre/img0.svg",
  "nuit/img0.svg",
];

const themes = ["clair", "sombre", "aurore", "prairie", "ambre", "nuit"];

// La liste est passée de 18 à 6 entrées : un `wps` mémorisé par une session
// antérieure peut pointer hors du tableau et donner un `src` indéfini, donc
// un bureau sans fond. On ramène dans les bornes.
if (!(wps >= 0 && wps < walls.length)) wps = 0;

const defState = {
  themes: themes,
  wps: wps,
  src: walls[wps],
  locked: !(locked == "false"),
  booted: false || import.meta.env.MODE == "development",
  act: "",
  dir: 0,
};

const wallReducer = (state = defState, action) => {
  switch (action.type) {
    case "WALLUNLOCK":
      localStorage.setItem("locked", false);
      return {
        ...state,
        locked: false,
        dir: 0,
      };
    case "WALLNEXT":
      var twps = (state.wps + 1) % walls.length;
      localStorage.setItem("wps", twps);
      return {
        ...state,
        wps: twps,
        src: walls[twps],
      };
    case "WALLALOCK":
      return {
        ...state,
        locked: true,
        dir: -1,
      };
    case "WALLBOOTED":
      return {
        ...state,
        booted: true,
        dir: 0,
        act: "",
      };
    case "WALLRESTART":
      return {
        ...state,
        booted: false,
        dir: -1,
        locked: true,
        act: "restart",
      };
    case "WALLSHUTDN":
      return {
        ...state,
        booted: false,
        dir: -1,
        locked: true,
        act: "shutdn",
      };
    /// Accepte un indice ou un chemin de fond. `wps` reste **toujours** un
    /// indice : il y stockait auparavant le chemin, ce qui cassait
    /// « fond suivant » (l'incrément donnait NaN) et faisait perdre le
    /// choix au rechargement.
    case "WALLSET":
      var idx = Number.isInteger(Number(action.payload))
        ? Number(action.payload)
        : walls.findIndex((item) => item === action.payload);

      if (idx < 0 || idx >= walls.length) idx = 0;
      localStorage.setItem("wps", idx);

      return {
        ...state,
        wps: idx,
        src: walls[idx],
      };
    default:
      return state;
  }
};

export default wallReducer;

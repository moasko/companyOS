// Garde-fou des fenêtres : leur barre de titre reste toujours à portée.
//
// ─────────────────────────────────────────────────────────────────────────
// LE PROBLÈME
//
// Les boutons Réduire / Agrandir / Fermer sont en haut à droite de la
// fenêtre. Trois chemins les faisaient sortir de l'écran — et une fenêtre
// qu'on ne peut plus ni fermer ni agrandir, c'est un bureau bloqué :
//
//   • une taille minimale pensée pour un grand écran (« min-width: 940px »)
//     sur un portable : la fenêtre déborde à droite, ses boutons avec ;
//   • un déplacement sans bornes : on tire la barre de titre au-dessus du
//     haut de l'écran, ou trop à droite ;
//   • une position retenue sur un grand écran, retrouvée sur un petit (ou
//     après avoir réduit la fenêtre du navigateur).
//
// LA RÈGLE
//
// Une fenêtre qui n'est pas en plein écran :
//   • ne dépasse jamais la taille du bureau ;
//   • garde sa barre de titre sous le haut de l'écran et au-dessus du bas ;
//   • garde son bord droit — là où sont les boutons — dans l'écran, et au
//     moins une poignée de sa barre de titre visible à gauche.
//
// Le déplacement et le redimensionnement s'arrêtent à ces bornes (voir
// `ToolBar`), et ce module rattrape tout le reste : à l'ouverture d'une
// fenêtre, à chaque changement de taille, et quand la fenêtre du
// navigateur change de dimensions. La correction passe par le magasin
// (taille « cstm ») : Agrandir et Restaurer continuent de fonctionner.
// ─────────────────────────────────────────────────────────────────────────

/// Hauteur de barre de titre qui doit rester visible en bas de l'écran.
export const BARRE_VISIBLE = 40;
/// Largeur de barre de titre qui doit rester visible à gauche.
export const POIGNEE_VISIBLE = 160;
const TOLERANCE = 1;

/// Les bornes de position d'une fenêtre de taille (largeur, hauteur) dans
/// un bureau de taille (zl, zh).
export const bornes = (largeur, hauteur, zl, zh) => ({
  minTop: 0,
  maxTop: Math.max(0, zh - BARRE_VISIBLE),
  minLeft: Math.min(0, POIGNEE_VISIBLE - largeur),
  maxLeft: Math.max(0, zl - largeur),
});

const borner = (v, min, max) => Math.min(Math.max(v, min), max);

/// Le cadre corrigé d'une fenêtre, ou null si elle est déjà bien placée.
/// `cadre` : { top, left, width, height } relatifs au bureau.
export const ramener = (cadre, zl, zh) => {
  const width = Math.min(cadre.width, zl);
  const height = Math.min(cadre.height, zh);
  const b = bornes(width, height, zl, zh);
  // Une fenêtre qu'on vient de ramener à la taille de l'écran y tient
  // entièrement ; sinon, seule la barre de titre doit rester visible.
  const reduite = width < cadre.width || height < cadre.height;
  const top = borner(cadre.top, b.minTop, reduite ? Math.max(0, zh - height) : b.maxTop);
  const left = borner(cadre.left, b.minLeft, b.maxLeft);
  const change =
    Math.abs(width - cadre.width) > TOLERANCE ||
    Math.abs(height - cadre.height) > TOLERANCE ||
    Math.abs(top - cadre.top) > TOLERANCE ||
    Math.abs(left - cadre.left) > TOLERANCE;
  return change ? { top, left, width, height } : null;
};

/// La zone où vivent les fenêtres (le bureau, barre des tâches exclue).
const zoneDe = (el) => el.offsetParent || el.parentElement;

/// Vérifie une fenêtre et renvoie l'action qui la ramène, ou null.
export const actionPour = (el) => {
  if (el.dataset.hide !== "false" || el.dataset.max === "false" || el.dataset.size === "full") return null;
  // Une fenêtre en cours de déplacement : on la laisse finir.
  if (el.classList.contains("notrans")) return null;
  // Mode téléphone : les fenêtres sont fixées plein écran par la feuille de
  // style, il n'y a rien à ramener.
  if (getComputedStyle(el).position === "fixed") return null;
  const type = el.querySelector(":scope > .toolbar")?.dataset.action;
  const zone = zoneDe(el);
  if (!type || !zone) return null;
  const z = zone.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (!z.width || !z.height || !r.width || !r.height) return null;
  const corrige = ramener(
    { top: r.top - z.top, left: r.left - z.left, width: r.width, height: r.height },
    z.width,
    z.height,
  );
  if (!corrige) return null;
  return {
    type,
    payload: "resize",
    dim: {
      top: `${Math.round(corrige.top)}px`,
      left: `${Math.round(corrige.left)}px`,
      width: `${Math.round(corrige.width)}px`,
      height: `${Math.round(corrige.height)}px`,
      // Une taille minimale de feuille de style ne doit pas regonfler la
      // fenêtre au-delà de l'écran.
      minWidth: "0px",
      minHeight: "0px",
    },
  };
};

/// Lance la surveillance. Rend une fonction d'arrêt.
export const demarrerGardeFenetres = (store) => {
  let minuteur = null;
  let dernierEtat = store.getState().apps;

  const verifier = () => {
    minuteur = null;
    const apps = Object.values(store.getState().apps || {});
    document.querySelectorAll(".floatTab").forEach((el) => {
      const action = actionPour(el);
      if (!action) return;
      // Si la fenêtre porte déjà exactement ce cadre, c'est qu'une feuille
      // de style l'emporte : on n'insiste pas, sinon on bouclerait.
      const fenetre = apps.find((f) => f && typeof f === "object" && f.action === action.type);
      if (fenetre?.size === "cstm" && JSON.stringify(fenetre.dim) === JSON.stringify(action.dim)) return;
      store.dispatch(action);
    });
  };

  // Les fenêtres s'ouvrent et se redimensionnent avec une transition de
  // 250 ms : on mesure une fois qu'elles sont posées.
  const planifier = (delai = 320) => {
    window.clearTimeout(minuteur);
    minuteur = window.setTimeout(verifier, delai);
  };

  const desabonner = store.subscribe(() => {
    const apps = store.getState().apps;
    if (apps === dernierEtat) return;
    dernierEtat = apps;
    planifier();
  });
  const surRedimension = () => planifier(150);
  window.addEventListener("resize", surRedimension);
  planifier(800);

  return () => {
    desabonner();
    window.removeEventListener("resize", surRedimension);
    window.clearTimeout(minuteur);
  };
};

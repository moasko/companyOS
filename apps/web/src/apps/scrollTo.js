// Défilement vers une section, sans toucher au reste.
//
// Deux pièges évités ici :
//
// 1. `Element.scrollIntoView()` fait défiler **tous** les ancêtres
//    défilables pour amener l'élément à l'écran — et `overflow: hidden`
//    n'empêche pas le défilement par programme. Cliquer une entrée de la
//    barre latérale d'une fenêtre faisait donc glisser le bureau entier.
//    On calcule la position dans le conteneur et on ne bouge que lui.
//
// 2. `scrollTo({ behavior: "smooth" })` est ignoré dans certains contextes
//    (navigateurs embarqués, fenêtres qui ne composent pas de frames) : la
//    position ne bouge alors pas du tout. On anime nous-mêmes.

const DUREE = 260;

// Adoucissement classique : départ et arrivée ralentis.
const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export const scrollElementTo = (container, top) => {
  if (!container) return;

  const max = container.scrollHeight - container.clientHeight;
  const cible = Math.max(0, Math.min(top, max));
  const depart = container.scrollTop;
  const delta = cible - depart;

  if (Math.abs(delta) < 1 || prefersReducedMotion()) {
    container.scrollTop = cible;
    return;
  }

  const debut = performance.now();

  const pas = (maintenant) => {
    const avancement = Math.min(1, (maintenant - debut) / DUREE);
    container.scrollTop = depart + delta * easeInOutQuad(avancement);
    if (avancement < 1) requestAnimationFrame(pas);
  };

  requestAnimationFrame(pas);

  // L'animation est un agrément, l'arrivée est le contrat : là où
  // requestAnimationFrame ne se déclenche pas (onglet en arrière-plan,
  // navigateur embarqué qui ne compose pas d'images), on rejoint la cible
  // sans animation. On ne le fait que si rien n'a bougé, pour ne pas
  // contrarier un utilisateur qui aurait repris la main entre-temps.
  setTimeout(() => {
    if (container.scrollTop === depart) container.scrollTop = cible;
  }, 60);
};

export const scrollSectionIntoView = (container, target, offset = 12) => {
  if (!container || !target) return;

  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const top = container.scrollTop + (targetRect.top - containerRect.top) - offset;

  // La marge intérieure du conteneur laisse la première section quelques
  // pixels plus bas que zéro : viser la première section doit ramener tout
  // en haut, pas décaler de 13 px.
  scrollElementTo(container, top < 32 ? 0 : top);
};

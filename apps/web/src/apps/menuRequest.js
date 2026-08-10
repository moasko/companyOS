// Menu contextuel de CompanyOS.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI CE FICHIER REMPLACE LES MENUS DE REDUX
//
// Les menus étaient déclarés en dur dans `src/reducers/menu.js` : une liste
// figée par cible (`desk`, `app`, `task`), avec des noms d'actions Redux en
// chaînes de caractères. Trois conséquences :
//
//   — un menu ne pouvait pas dépendre de ce sur quoi on avait cliqué. « Ouvrir
//     avec la visionneuse 3D » n'a de sens que sur un .glb, « Restaurer » que
//     dans la corbeille : impossible à exprimer dans une liste statique ;
//   — la moitié des entrées ne faisaient rien, faute d'action à brancher, et
//     un menu dont les entrées ne répondent pas est pire que pas de menu ;
//   — chaque écran devait inventer une action Redux globale pour un geste
//     purement local.
//
// Ici, **c'est l'écran qui construit son menu**, au moment du clic droit,
// avec de vraies fonctions. Le composant ne fait que positionner et rendre —
// il ne sait rien des fichiers, des applications ni du bureau.
//
//   import { menuContextuel } from "../../apps/menuRequest";
//
//   onContextMenu={(e) => menuContextuel(e, [
//     { nom: "Ouvrir", icone: "faFolderOpen", action: () => ouvrir(node) },
//     { separateur: true },
//     { nom: "Supprimer", icone: "faTrash", danger: true, action: supprimer },
//   ])}
//
// Une entrée : { nom, icone?, raccourci?, action?, sousMenu?, actif?,
//                coche?, danger?, desactive? }
// ─────────────────────────────────────────────────────────────────────────

let abonne = null;
let compteur = 0;

/// Le composant hôte s'abonne au montage du shell.
export const subscribeMenu = (fn) => {
  abonne = fn;
  return () => {
    abonne = null;
  };
};

/// Ouvre un menu contextuel à la position de l'événement.
///
/// `entrees` peut être un tableau, ou une fonction qui en rend un : la
/// seconde forme sert quand la construction coûte cher — on ne la paie
/// qu'au clic droit, pas à chaque rendu de chaque ligne.
///
/// Rend `false` si le menu n'a pas pu s'ouvrir (aucune entrée), pour que
/// l'appelant puisse laisser le menu natif du navigateur apparaître.
export const menuContextuel = (evenement, entrees, options = {}) => {
  evenement?.preventDefault?.();
  // Sans cela, un clic droit sur un fichier ouvrirait aussi le menu du
  // dossier qui le contient, et le dernier gagnerait.
  evenement?.stopPropagation?.();

  const liste = (typeof entrees === "function" ? entrees() : entrees) || [];
  const utiles = liste.filter(Boolean);
  if (!utiles.length || !abonne) return false;

  compteur += 1;
  abonne({
    id: compteur,
    entrees: utiles,
    x: evenement?.clientX ?? 0,
    y: evenement?.clientY ?? 0,
    ...options,
  });
  return true;
};

/// Ferme le menu ouvert, s'il y en a un.
export const fermerMenu = () => abonne?.(null);

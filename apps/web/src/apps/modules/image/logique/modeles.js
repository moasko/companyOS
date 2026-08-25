// Modèles de départ façon CE.SDK : chaque modèle fabrique une scène
// complète à partir de nos primitives (formes, textes, dégradés, motifs).
// Les identifiants sont régénérés à chaque appel — deux applications du
// même modèle ne partagent jamais un objet.
import { id } from "./constantes.js";

const base = (type, nom, props) => ({
  id: id(),
  type,
  nom,
  rotation: 0,
  opacite: 1,
  visible: true,
  verrouille: false,
  parentId: null,
  children: [],
  sceneId: "",
  ...props,
});

const forme = (nom, props) => base("forme", nom, { forme: "rectangle", contour: "#151515", epaisseur: 0, rayon: 0, degrade: { actif: false, angle: 90, couleurA: "#ffffff", couleurB: "#0d99ff" }, motif: "aucune", ...props });
const texte = (nom, contenu, props) => base("texte", nom, { texte: contenu, police: "Arial", taille: 32, gras: true, italique: false, alignement: "centre", couleur: "#151515", interligne: 1.15, espacement: 0, casse: "aucune", texteContour: { actif: false, couleur: "#000000", epaisseur: 3 }, barre: false, degrade: { actif: false, angle: 90, couleurA: "#f7d774", couleurB: "#a86f1f" }, ...props });

export const MODELES = [
  {
    id: "affiche-formation",
    nom: "Affiche formation",
    description: "Fond dégradé bleu à halftone, panneau d'en-tête à coins libres, grille de cartes colorées et bloc prix — la structure type des affiches d'événement.",
    largeur: 794,
    hauteur: 1123,
    fabriquer: () => [
      forme("Fond", { x: 0, y: 0, largeur: 794, hauteur: 1123, couleur: "#0a1f52", contour: "#0a1f52", degrade: { actif: true, angle: 120, couleurA: "#0a1f52", couleurB: "#1565d8" } }),
      forme("Halftone", { x: 0, y: 0, largeur: 794, hauteur: 1123, couleur: "#7fb2ff", contour: "transparent", motif: "points", opacite: 0.3 }),
      forme("En-tête", { x: 0, y: 0, largeur: 300, hauteur: 170, couleur: "#ffffff", contour: "#ffffff", rayons: [0, 0, 56, 0] }),
      texte("Titre", "FORMATION", { x: 97, y: 210, largeur: 600, hauteur: 90, taille: 72, couleur: "#f7d774", degrade: { actif: true, angle: 90, couleurA: "#fbe7a2", couleurB: "#c9932a" }, espacement: 4 }),
      texte("Sous-titre", "en Marketing Digital & Communication", { x: 97, y: 305, largeur: 600, hauteur: 40, taille: 28, couleur: "#ffffff" }),
      forme("Carte 1", { x: 60, y: 380, largeur: 327, hauteur: 250, couleur: "#ffd400", contour: "#ffd400", rayon: 18 }),
      forme("Carte 2", { x: 407, y: 380, largeur: 327, hauteur: 250, couleur: "#ff3b1f", contour: "#ff3b1f", rayon: 18 }),
      forme("Carte 3", { x: 60, y: 650, largeur: 327, hauteur: 250, couleur: "#ffffff", contour: "#ffffff", rayon: 18 }),
      forme("Carte 4", { x: 407, y: 650, largeur: 327, hauteur: 250, couleur: "#7ed957", contour: "#7ed957", rayon: 18 }),
      forme("Bloc infos", { x: 60, y: 935, largeur: 400, hauteur: 125, couleur: "#0a1f52", contour: "#0a1f52", opacite: 0.78, rayon: 14 }),
      texte("Inclus", "❯ Certificat\n❯ Supports & Logiciels\n❯ Accompagnement", { x: 78, y: 950, largeur: 370, hauteur: 95, taille: 18, gras: false, couleur: "#ffffff", alignement: "gauche" }),
      forme("Carte prix", { x: 480, y: 935, largeur: 150, hauteur: 125, couleur: "#ffd400", contour: "#ffd400", rayon: 12 }),
      texte("Ancien prix", "39$", { x: 490, y: 948, largeur: 130, hauteur: 30, taille: 24, couleur: "#d32f2f", barre: true }),
      texte("Nouveau prix", "20$", { x: 490, y: 984, largeur: 130, hauteur: 60, taille: 46 }),
      forme("Pied", { x: 0, y: 1073, largeur: 794, hauteur: 50, couleur: "#ffffff", contour: "#ffffff" }),
      texte("Date & lieu", "11 & 12 Mai · 9h00 — AUF UNIKIN", { x: 97, y: 1084, largeur: 600, hauteur: 28, taille: 17, couleur: "#0a1f52" }),
    ],
  },
  {
    id: "post-promo",
    nom: "Post promo",
    description: "Carré Instagram au dégradé violet-rose, cercles décoratifs translucides et bouton arrondi — prêt pour une annonce ou un lancement.",
    largeur: 1080,
    hauteur: 1080,
    fabriquer: () => [
      forme("Fond", { x: 0, y: 0, largeur: 1080, hauteur: 1080, couleur: "#7c3aed", contour: "#7c3aed", degrade: { actif: true, angle: 135, couleurA: "#7c3aed", couleurB: "#ec4899" } }),
      forme("Cercle clair", { x: 700, y: -120, largeur: 520, hauteur: 520, forme: "ellipse", couleur: "#ffffff", contour: "transparent", opacite: 0.12 }),
      forme("Cercle bas", { x: -140, y: 700, largeur: 420, hauteur: 420, forme: "ellipse", couleur: "#ffffff", contour: "transparent", opacite: 0.1 }),
      texte("Titre", "SOLDES D'ÉTÉ", { x: 90, y: 340, largeur: 900, hauteur: 120, taille: 96, couleur: "#ffffff", espacement: 2 }),
      texte("Accroche", "-50 % sur tout le site", { x: 90, y: 480, largeur: 900, hauteur: 60, taille: 44, couleur: "#fde047" }),
      forme("Bouton", { x: 340, y: 640, largeur: 400, hauteur: 110, couleur: "#ffffff", contour: "#ffffff", rayon: 55 }),
      texte("Bouton", "En savoir plus", { x: 340, y: 672, largeur: 400, hauteur: 46, taille: 32, couleur: "#7c3aed" }),
      texte("Marque", "@votremarque", { x: 290, y: 950, largeur: 500, hauteur: 36, taille: 24, gras: false, couleur: "#ffffff", opacite: 0.85 }),
    ],
  },
];

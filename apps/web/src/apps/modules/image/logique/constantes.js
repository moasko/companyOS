// Constantes et utilitaires partagés de l'Atelier Image.

export const LARGEUR_INITIALE = 1280;
export const HAUTEUR_INITIALE = 720;

export const filtreNeutre = { luminosite: 100, contraste: 100, saturation: 100, teinte: 0, flou: 0, niveauxGris: 0, sepia: 0 };

export const POLICES = ["Arial", "Verdana", "Georgia", "Times New Roman", "Courier New", "Trebuchet MS", "Impact", "Comic Sans MS"];

export const OUTILS_FORMES = ["rectangle", "ellipse", "frame", "triangle", "etoile", "ligne"];

// Presets de formats canal, à la CE.SDK : un clic adapte la scène au
// média de destination sans toucher aux coordonnées des éléments.
export const FORMATS_PRESETS = [
  { id: "post", nom: "Post Instagram — 1080 × 1080", largeur: 1080, hauteur: 1080 },
  { id: "story", nom: "Story / Reel — 1080 × 1920", largeur: 1080, hauteur: 1920 },
  { id: "linkedin", nom: "Post LinkedIn — 1200 × 627", largeur: 1200, hauteur: 627 },
  { id: "yt", nom: "Miniature YouTube — 1280 × 720", largeur: 1280, hauteur: 720 },
  { id: "a4p", nom: "Affiche A4 portrait — 794 × 1123", largeur: 794, hauteur: 1123 },
  { id: "a4l", nom: "Affiche A4 paysage — 1123 × 794", largeur: 1123, hauteur: 794 },
  { id: "pres", nom: "Présentation — 1920 × 1080", largeur: 1920, hauteur: 1080 },
];

export const FILTRES_REGLAGES = [
  ["luminosite", "Luminosité", 0, 200],
  ["contraste", "Contraste", 0, 200],
  ["saturation", "Saturation", 0, 200],
  ["teinte", "Teinte", 0, 360],
  ["flou", "Flou", 0, 20],
  ["niveauxGris", "Noir et blanc", 0, 100],
  ["sepia", "Sépia", 0, 100],
];

export const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// Les sources d'image sont volumineuses et immuables. L'historique les
// partage entre ses états et ne copie que les propriétés modifiables.
export const copieObjet = (objet) => ({
  ...objet,
  ...(objet.filtres ? { filtres: { ...objet.filtres } } : {}),
  ...(objet.ombre ? { ombre: { ...objet.ombre } } : {}),
  ...(objet.texteContour ? { texteContour: { ...objet.texteContour } } : {}),
  ...(objet.degrade ? { degrade: { ...objet.degrade } } : {}),
  ...(objet.rayons ? { rayons: [...objet.rayons] } : {}),
});

export const copieObjets = (objets) => objets.map(copieObjet);

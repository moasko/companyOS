// Les modèles de facture.
//
// Un modèle décide de la mise en page ; la couleur d'accent et les options
// (logo, signature, montant en lettres) restent au choix de l'utilisateur.
// Chaque modèle est rendu deux fois, à l'identique : à l'écran (Apercu.jsx,
// en HTML) et dans le PDF envoyé au client (pdf.js). Les deux lisent cette
// table — ajouter un modèle, c'est l'ajouter ici puis dans les deux rendus.

export const MODELES = [
  {
    id: "moderne",
    nom: "Moderne",
    description: "En-tête du tableau sombre, numéro en couleur, total mis en avant.",
    couleur: "#C2410C",
  },
  {
    id: "classique",
    nom: "Classique",
    description: "Titre centré, tableau quadrillé, typographie à empattements.",
    couleur: "#1E3A8A",
  },
  {
    id: "minimal",
    nom: "Minimaliste",
    description: "Beaucoup de blanc, de simples filets, le total en grand.",
    couleur: "#111827",
  },
  {
    id: "bandeau",
    nom: "Bandeau",
    description: "Un bandeau de couleur à l'en-tête, aux couleurs de l'entreprise.",
    couleur: "#0F766E",
  },
  {
    id: "elegant",
    nom: "Élégant",
    description: "Liseré vertical, récapitulatif en carte arrondie.",
    couleur: "#6D28D9",
  },
  {
    id: "officiel",
    nom: "Officiel",
    description: "Cadres, identifiants fiscaux (NCC, RCCM) et montant arrêté en lettres.",
    couleur: "#065F46",
  },
];

export const modeleDe = (id) => MODELES.find((m) => m.id === id) || MODELES[0];

/// La couleur effective : celle choisie, sinon celle du modèle.
export const couleurDe = (facture) => facture.couleur || modeleDe(facture.modele).couleur;

/// Les couleurs proposées dans le panneau de design.
export const PALETTE = ["#C2410C", "#B91C1C", "#1E3A8A", "#0067C0", "#0F766E", "#065F46", "#6D28D9", "#BE185D", "#111827"];

/// « #C2410C » → [0.76, 0.25, 0.05] pour le PDF.
export const enRgb = (hex) => {
  const h = String(hex || "#000000").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
};

/// La même couleur, éclaircie vers le blanc (0 = inchangée, 1 = blanc).
export const eclaircir = (hex, part) => {
  const [r, g, b] = enRgb(hex);
  const m = (v) => Math.round((v + (1 - v) * part) * 255);
  return `#${[m(r), m(g), m(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

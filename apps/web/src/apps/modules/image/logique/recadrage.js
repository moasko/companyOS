// Géométrie du recadrage et règles de copie de style. Fonctions pures.

// Convertit le rectangle tracé à l'écran (repère du monde) en zone à
// conserver dans le repère local du calque, rotation annulée autour du
// centre. Renvoie null si la zone est trop petite pour avoir du sens.
export const calculerZoneRecadrage = (calque, depart, arrivee) => {
  const { x, y, largeur, hauteur, rotation = 0 } = calque;
  const ax = Math.max(x, Math.min(depart.x, arrivee.x, x + largeur));
  const ay = Math.max(y, Math.min(depart.y, arrivee.y, y + hauteur));
  const bx = Math.min(x + largeur, Math.max(depart.x, arrivee.x, x));
  const by = Math.min(y + hauteur, Math.max(depart.y, arrivee.y, y));
  if (bx - ax < 8 || by - ay < 8) return null;
  const centreX = x + largeur / 2;
  const centreY = y + hauteur / 2;
  const rad = -rotation * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const versLocal = (px, py) => ({ x: (px - centreX) * cos - (py - centreY) * sin + largeur / 2, y: (px - centreX) * sin + (py - centreY) * cos + hauteur / 2 });
  const coins = [versLocal(ax, ay), versLocal(bx, ay), versLocal(ax, by), versLocal(bx, by)];
  const x0 = Math.max(0, Math.min(...coins.map((coin) => coin.x)));
  const y0 = Math.max(0, Math.min(...coins.map((coin) => coin.y)));
  const w = Math.min(largeur, Math.max(...coins.map((coin) => coin.x))) - x0;
  const h = Math.min(hauteur, Math.max(...coins.map((coin) => coin.y))) - y0;
  if (w < 8 || h < 8) return null;
  return { x: x0, y: y0, largeur: w, hauteur: h };
};

// Le calque recadré garde sa rotation : on replace son nouveau centre pour
// que le contenu visible ne bouge pas d'un pixel à l'écran.
export const positionApresRecadrage = (calque, zone) => {
  const { x, y, largeur, hauteur, rotation = 0 } = calque;
  const centreX = x + largeur / 2;
  const centreY = y + hauteur / 2;
  const rad = rotation * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const qx = zone.x + zone.largeur / 2 - largeur / 2;
  const qy = zone.y + zone.hauteur / 2 - hauteur / 2;
  return {
    x: centreX + qx * cos - qy * sin - ((zone.largeur / 2) * cos - (zone.hauteur / 2) * sin),
    y: centreY + qx * sin + qy * cos - ((zone.largeur / 2) * sin + (zone.hauteur / 2) * cos),
  };
};

// Champs d'apparence propres à chaque type de calque : la source du style.
export const champsSpecifiques = {
  forme: (o) => ({ couleur: o.couleur, contour: o.contour, epaisseur: o.epaisseur, rayon: o.rayon, rayons: o.rayons, degrade: o.degrade, motif: o.motif }),
  frame: (o) => ({ couleur: o.couleur, contour: o.contour, epaisseur: o.epaisseur, rayon: o.rayon, rayons: o.rayons, degrade: o.degrade }),
  texte: (o) => ({ couleur: o.couleur, taille: o.taille, police: o.police, gras: o.gras, italique: o.italique, souligne: o.souligne, alignement: o.alignement, interligne: o.interligne, espacement: o.espacement, casse: o.casse, texteContour: o.texteContour, barre: o.barre, degrade: o.degrade }),
  image: () => ({}),
  plume: (o) => ({ couleur: o.couleur, epaisseur: o.epaisseur, rempli: o.rempli, couleurRempli: o.couleurRempli }),
  dessin: (o) => ({ couleur: o.couleur, epaisseur: o.epaisseur }),
};

// Champs que chaque type accepte à la réception : coller depuis un texte
// sur une image ne transporte que filtres, opacité, fusion et ombre.
export const CHAMPS_APPLICABLES = {
  forme: ["couleur", "contour", "epaisseur", "rayon", "rayons", "degrade", "motif", "opacite", "fusion", "ombre"],
  frame: ["couleur", "contour", "epaisseur", "rayon", "rayons", "degrade", "opacite", "fusion"],
  texte: ["couleur", "taille", "police", "gras", "italique", "souligne", "alignement", "interligne", "espacement", "casse", "texteContour", "barre", "degrade", "opacite", "fusion", "ombre"],
  image: ["filtres", "opacite", "fusion", "ombre"],
  plume: ["couleur", "epaisseur", "rempli", "couleurRempli", "opacite", "fusion", "ombre"],
  dessin: ["couleur", "epaisseur", "opacite", "fusion"],
};

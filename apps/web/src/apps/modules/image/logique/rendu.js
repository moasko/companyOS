// Rendu de l'Atelier Image : fonctions pures partagées par l'affichage DOM
// (SVG/attributs) et l'export canvas. Aucune dépendance au DOM direct.

import { filtreNeutre } from "./constantes.js";

export const filtreCss = (f = filtreNeutre) => `brightness(${f.luminosite}%) contrast(${f.contraste}%) saturate(${f.saturation}%) hue-rotate(${f.teinte || 0}deg) blur(${f.flou}px) grayscale(${f.niveauxGris}%) sepia(${f.sepia}%)`;

export const pointsEtoile = (largeur, hauteur) => {
  const sommets = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const facteur = i % 2 === 0 ? 0.5 : 0.19;
    sommets.push([Math.cos(angle) * largeur * facteur, Math.sin(angle) * hauteur * facteur]);
  }
  return sommets;
};

// Casse appliquée avant affichage comme avant export, pour que les deux
// rendus restent identiques.
export const appliquerCasse = (texte, casse) => {
  const chaine = String(texte ?? "");
  if (casse === "majuscules") return chaine.toUpperCase();
  if (casse === "minuscules") return chaine.toLowerCase();
  return chaine;
};

// Ancres absolues (repère local du calque) d'une forme paramétrique, pour
// la passer en édition de nœuds. null quand la forme reste paramétrique
// (rectangle à rayon réglable, ellipse).
export const geometrieAncres = (objet) => {
  const w = objet.largeur;
  const h = objet.hauteur;
  if (objet.forme === "triangle") return { ferme: true, points: [{ x: w / 2, y: 0 }, { x: w, y: h }, { x: 0, y: h }] };
  if (objet.forme === "etoile") return { ferme: true, points: pointsEtoile(w, h).map(([px, py]) => ({ x: px + w / 2, y: py + h / 2 })) };
  if (objet.forme === "ligne") return { ferme: false, points: [{ x: 0, y: 0 }, { x: w, y: h }] };
  return null;
};

// Rayons des quatre coins (HG, HD, BD, BG) bornés à la demi-dimension —
// fallback sur le rayon unique des calques anciens.
export const rayonsEffectifs = (objet) => {
  const maximum = Math.max(0, Math.min(objet.largeur, objet.hauteur) / 2);
  const base = objet.rayons || [objet.rayon || 0, objet.rayon || 0, objet.rayon || 0, objet.rayon || 0];
  return base.map((valeur) => Math.max(0, Math.min(maximum, valeur || 0)));
};

export const degradeCss = (degrade) => `linear-gradient(${degrade.angle || 0}deg, ${degrade.couleurA}, ${degrade.couleurB})`;

const gradientCanvas = (ctx, degrade, largeur, hauteur) => {
  const angle = ((degrade.angle || 0) - 90) * Math.PI / 180;
  const rayon = Math.max(largeur, hauteur) / 2;
  const gradient = ctx.createLinearGradient(-Math.cos(angle) * rayon, -Math.sin(angle) * rayon, Math.cos(angle) * rayon, Math.sin(angle) * rayon);
  gradient.addColorStop(0, degrade.couleurA);
  gradient.addColorStop(1, degrade.couleurB);
  return gradient;
};

// Style de remplissage d'une forme/frame : couleur pleine, dégradé
// linéaire ou motif de points (halftone d'affiche). Le motif utilise un
// petit canvas-tile répété.
export const remplissageCanvas = (ctx, objet, largeur, hauteur) => {
  if (objet.motif === "points") {
    const tuile = document.createElement("canvas");
    tuile.width = 12;
    tuile.height = 12;
    const c = tuile.getContext("2d");
    c.fillStyle = objet.degrade?.actif ? objet.degrade.couleurA : objet.couleur;
    c.beginPath();
    c.arc(6, 6, 3.4, 0, Math.PI * 2);
    c.fill();
    return ctx.createPattern(tuile, "repeat");
  }
  if (objet.degrade?.actif) return gradientCanvas(ctx, objet.degrade, largeur, hauteur);
  return objet.couleur;
};

export const degradeTexteCanvas = (ctx, objet) => gradientCanvas(ctx, objet.degrade, objet.largeur, objet.hauteur);

let contexteMesure = null;
// Largeur nécessaire pour que le bloc de texte épouse son contenu. Le
// fallback 220 couvre l'exécution hors navigateur (tests).
export const mesurerLargeurTexte = (texte, reglages) => {
  if (typeof document === "undefined") return 220;
  contexteMesure ||= document.createElement("canvas").getContext("2d");
  const { taille = 24, police = "Arial", gras, italique, espacement = 0, casse } = reglages;
  contexteMesure.font = `${italique ? "italic " : ""}${gras ? 700 : 400} ${taille}px ${police}`;
  const lignes = String(texte ?? "").split("\n").map((ligne) => appliquerCasse(ligne, casse));
  const plusLarge = Math.max(...lignes.map((ligne) => contexteMesure.measureText(ligne).width + espacement * Math.max(0, ligne.length - 1)), 10);
  return Math.ceil(plusLarge + taille * 0.6);
};

// Tracé plume : chaque ancre porte des poignées de Bézier (ax/ay entrante,
// bx/by sortante), normalisées comme les points du pinceau. Une ancre sans
// poignées (null) produit un segment droit.
export const cheminPlume = (points, largeur, hauteur, ferme) => {
  if (!points.length) return "";
  const absolu = (pt) => ({ x: pt.px * largeur, y: pt.py * hauteur });
  const premier = absolu(points[0]);
  let d = `M ${premier.x.toFixed(2)} ${premier.y.toFixed(2)}`;
  const segment = (depart, arrivee) => {
    const fin = absolu(arrivee);
    if (depart.bx == null && arrivee.ax == null) return ` L ${fin.x.toFixed(2)} ${fin.y.toFixed(2)}`;
    const c1 = depart.bx == null ? { x: depart.px * largeur, y: depart.py * hauteur } : { x: depart.bx * largeur, y: depart.by * hauteur };
    const c2 = arrivee.ax == null ? fin : { x: arrivee.ax * largeur, y: arrivee.ay * hauteur };
    return ` C ${c1.x.toFixed(2)} ${c1.y.toFixed(2)} ${c2.x.toFixed(2)} ${c2.y.toFixed(2)} ${fin.x.toFixed(2)} ${fin.y.toFixed(2)}`;
  };
  for (let i = 0; i < points.length - 1; i++) d += segment(points[i], points[i + 1]);
  if (ferme && points.length > 2) d += segment(points[points.length - 1], points[0]) + " Z";
  return d;
};

export const dessinerObjet = (ctx, objet, images) => {
  ctx.save();
  ctx.globalAlpha = objet.opacite ?? 1;
  ctx.globalCompositeOperation = objet.fusion || "source-over";
  ctx.translate(objet.x + objet.largeur / 2, objet.y + objet.hauteur / 2);
  ctx.rotate(((objet.rotation || 0) * Math.PI) / 180);
  ctx.scale(objet.retourneX ? -1 : 1, objet.retourneY ? -1 : 1);
  if (objet.ombre?.active) {
    ctx.shadowColor = objet.ombre.couleur;
    ctx.shadowBlur = objet.ombre.flou;
    ctx.shadowOffsetX = objet.ombre.x;
    ctx.shadowOffsetY = objet.ombre.y;
  }
  if (objet.type === "image") {
    const image = images.get(objet.src);
    if (image?.complete) {
      ctx.filter = filtreCss(objet.filtres);
      ctx.drawImage(image, -objet.largeur / 2, -objet.hauteur / 2, objet.largeur, objet.hauteur);
    }
  } else if (objet.type === "dessin") {
    const points = objet.points || [];
    if (points.length > 1) {
      ctx.strokeStyle = objet.couleur;
      ctx.lineWidth = objet.epaisseur;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      points.forEach((pt, index) => {
        const px = -objet.largeur / 2 + pt.px * objet.largeur;
        const py = -objet.hauteur / 2 + pt.py * objet.hauteur;
        if (index) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      });
      ctx.stroke();
    }
  } else if (objet.type === "plume") {
    const points = objet.points || [];
    if (points.length > 1) {
      const absolu = (pt) => ({ x: -objet.largeur / 2 + pt.px * objet.largeur, y: -objet.hauteur / 2 + pt.py * objet.hauteur });
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      const debut = absolu(points[0]);
      ctx.moveTo(debut.x, debut.y);
      const courbe = (depart, arrivee) => {
        const fin = absolu(arrivee);
        const c1 = depart.bx == null ? absolu(depart) : { x: -objet.largeur / 2 + depart.bx * objet.largeur, y: -objet.hauteur / 2 + depart.by * objet.hauteur };
        const c2 = arrivee.ax == null ? fin : { x: -objet.largeur / 2 + arrivee.ax * objet.largeur, y: -objet.hauteur / 2 + arrivee.ay * objet.hauteur };
        ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, fin.x, fin.y);
      };
      for (let i = 0; i < points.length - 1; i++) courbe(points[i], points[i + 1]);
      if (objet.ferme) courbe(points[points.length - 1], points[0]);
      if (objet.rempli) {
        ctx.fillStyle = objet.couleurRempli;
        ctx.fill();
      }
      ctx.strokeStyle = objet.couleur;
      ctx.lineWidth = objet.epaisseur;
      ctx.stroke();
    }
  } else if (objet.type === "texte") {
    // Rendu multiligne : canvas ignore \n dans fillText, on dessine donc
    // chaque ligne à son interligne, centrées verticalement comme en DOM.
    const lignes = appliquerCasse(objet.texte, objet.casse).split("\n");
    const remplissage = objet.degrade?.actif ? degradeTexteCanvas(ctx, objet) : objet.couleur;
    ctx.fillStyle = remplissage;
    ctx.font = `${objet.italique ? "italic " : ""}${objet.gras ? 700 : 400} ${objet.taille}px ${objet.police}`;
    ctx.textAlign = objet.alignement === "gauche" ? "left" : objet.alignement === "droite" ? "right" : "center";
    ctx.textBaseline = "middle";
    if (objet.espacement && "letterSpacing" in ctx) ctx.letterSpacing = `${objet.espacement}px`;
    const ancreX = objet.alignement === "gauche" ? -objet.largeur / 2 : objet.alignement === "droite" ? objet.largeur / 2 : 0;
    const pasLigne = objet.taille * (objet.interligne || 1.15);
    const yDepart = -((lignes.length - 1) * pasLigne) / 2;
    lignes.forEach((ligne, index) => {
      const y = yDepart + index * pasLigne;
      if (objet.texteContour?.actif && objet.texteContour.epaisseur > 0) {
        ctx.lineJoin = "round";
        ctx.strokeStyle = objet.texteContour.couleur;
        // Doubler l'épaisseur garde visible la moitié du trait autour des
        // glyphes une fois le remplissage posé par-dessus.
        ctx.lineWidth = objet.texteContour.epaisseur * 2;
        ctx.strokeText(ligne, ancreX, y, objet.largeur);
      }
      ctx.fillText(ligne, ancreX, y, objet.largeur);
      if (objet.barre || objet.souligne) {
        const largeurTexte = Math.min(ctx.measureText(ligne).width, objet.largeur);
        const departX = objet.alignement === "droite" ? ancreX - largeurTexte : objet.alignement === "gauche" ? ancreX : ancreX - largeurTexte / 2;
        ctx.fillStyle = objet.degrade?.actif ? objet.degrade.couleurB : objet.couleur;
        if (objet.barre) ctx.fillRect(departX, y - Math.max(1, objet.taille * 0.05), largeurTexte, Math.max(1, objet.taille * 0.09));
        else ctx.fillRect(departX, y + objet.taille * 0.42, largeurTexte, Math.max(1, objet.taille * 0.06));
        ctx.fillStyle = remplissage;
      }
    });
    if (objet.espacement && "letterSpacing" in ctx) ctx.letterSpacing = "0px";
  } else {
    ctx.fillStyle = remplissageCanvas(ctx, objet, objet.largeur, objet.hauteur);
    ctx.strokeStyle = objet.contour;
    ctx.lineWidth = objet.epaisseur;
    if (objet.forme === "ligne") {
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-objet.largeur / 2, -objet.hauteur / 2);
      ctx.lineTo(objet.largeur / 2, objet.hauteur / 2);
      ctx.stroke();
    } else if (objet.forme === "triangle") {
      ctx.beginPath();
      ctx.moveTo(0, -objet.hauteur / 2);
      ctx.lineTo(objet.largeur / 2, objet.hauteur / 2);
      ctx.lineTo(-objet.largeur / 2, objet.hauteur / 2);
      ctx.closePath();
      ctx.fill();
      if (objet.epaisseur) ctx.stroke();
    } else if (objet.forme === "etoile") {
      ctx.beginPath();
      pointsEtoile(objet.largeur, objet.hauteur).forEach(([px, py], index) => { if (index) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.closePath();
      ctx.fill();
      if (objet.epaisseur) ctx.stroke();
    } else if (objet.forme === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(0, 0, objet.largeur / 2, objet.hauteur / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      if (objet.epaisseur) ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.roundRect(-objet.largeur / 2, -objet.hauteur / 2, objet.largeur, objet.hauteur, rayonsEffectifs(objet));
      ctx.fill();
      if (objet.epaisseur) ctx.stroke();
    }
  }
  ctx.restore();
};

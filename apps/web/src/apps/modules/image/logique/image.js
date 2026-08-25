// Opérations pixels de l'Atelier Image : détourage d'arrière-plan,
// rognage du contenu visible, auto-contraste. Fonctions pures opérant sur
// des tampons de type ImageData — testables hors navigateur.

export const hexVersRgb = (hex) => {
  const propre = String(hex || "#000000").replace("#", "");
  const complet = propre.length === 3 ? propre.split("").map((c) => c + c).join("") : propre.padEnd(6, "0").slice(0, 6);
  const valeur = Number.parseInt(complet, 16) || 0;
  return { rouge: (valeur >> 16) & 255, vert: (valeur >> 8) & 255, bleu: valeur & 255 };
};

// Détourage : supprime (alpha → 0) les pixels proches d'une couleur cible.
// - distance euclidienne RGB, tolérance en unités de couleur (0..441) ;
// - contigu : propagation en 4-voisins depuis une graine (x, y) qui doit
//   elle-même correspondre à la cible — comportement gomme magique ;
// - adoucissement (0..1) : les pixels proches du seuil voient leur alpha
//   réduit progressivement au lieu d'être coupés net, ce qui évite les
//   franges dures autour des sujets.
// Renvoie le nombre de pixels touchés (0 = rien n'a correspondu).
export const supprimerArrierePlan = ({ donnees, largeur, hauteur }, { rouge, vert, bleu, tolerance = 40, contigue = false, graine = null, adoucissement = 0.35 }) => {
  const data = donnees;
  const tol = Math.max(1, tolerance);
  const seuil = tol * tol * 3;
  const douce = Math.max(0, Math.min(1, adoucissement));
  const bord = seuil * (1 - douce);
  let touches = 0;
  const alphaPour = (i) => {
    const dr = data[i] - rouge;
    const dv = data[i + 1] - vert;
    const db = data[i + 2] - bleu;
    const distance = dr * dr + dv * dv + db * db;
    if (distance > seuil || data[i + 3] === 0) return null;
    if (distance <= bord || douce === 0) return 0;
    const rapport = (distance - bord) / (seuil - bord);
    return Math.round(data[i + 3] * rapport);
  };
  if (!contigue || !graine) {
    for (let i = 0; i < data.length; i += 4) {
      const alpha = alphaPour(i);
      if (alpha === null) continue;
      data[i + 3] = alpha;
      touches++;
    }
    return touches;
  }
  const [gx, gy] = graine;
  if (gx < 0 || gy < 0 || gx >= largeur || gy >= hauteur) return 0;
  const visites = new Uint8Array(largeur * hauteur);
  const pile = [gy * largeur + gx];
  while (pile.length) {
    const index = pile.pop();
    if (visites[index]) continue;
    visites[index] = 1;
    const i = index * 4;
    const alpha = alphaPour(i);
    if (alpha === null) continue;
    data[i + 3] = alpha;
    touches++;
    const x = index % largeur;
    if (x > 0) pile.push(index - 1);
    if (x < largeur - 1) pile.push(index + 1);
    if (index >= largeur) pile.push(index - largeur);
    if (index < largeur * (hauteur - 1)) pile.push(index + largeur);
  }
  return touches;
};

// Boîte englobante du contenu opaque (alpha > 0), utile pour rogner les
// bords vides après un détourage. null si l'image est entièrement
// transparente.
export const bornesContenu = ({ donnees, largeur, hauteur }) => {
  const data = donnees;
  let gauche = largeur;
  let haut = hauteur;
  let droite = -1;
  let bas = -1;
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      if (data[(y * largeur + x) * 4 + 3] > 0) {
        if (x < gauche) gauche = x;
        if (x > droite) droite = x;
        if (y < haut) haut = y;
        if (y > bas) bas = y;
      }
    }
  }
  if (droite < 0) return null;
  return { x: gauche, y: haut, largeur: droite - gauche + 1, hauteur: bas - haut + 1 };
};

// Auto-contraste : étire chaque canal sur [min, max] mesuré sur les pixels
// opaques. Un span trop faible (< 8) est laissé tel quel pour éviter le
// bruit amplifié — renvoie false dans ce cas.
export const etirerContraste = ({ donnees }) => {
  const data = donnees;
  const mins = [255, 255, 255];
  const maxs = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    for (let c = 0; c < 3; c++) {
      if (data[i + c] < mins[c]) mins[c] = data[i + c];
      if (data[i + c] > maxs[c]) maxs[c] = data[i + c];
    }
  }
  const spans = [0, 1, 2].map((c) => maxs[c] - mins[c]);
  if (spans.every((span) => span < 8)) return false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    for (let c = 0; c < 3; c++) {
      const span = spans[c] || 1;
      data[i + c] = Math.round(((data[i + c] - mins[c]) / span) * 255);
    }
  }
  return true;
};

// Pinceau de restauration : copie le disque (cx, cy, rayon) depuis les
// pixels d'origine vers le tampon courant — on repeint ce qui avait été
// détourné. Renvoie le nombre de pixels réellement recopiés.
export const tamponRestauration = (courant, originale, cx, cy, rayon) => {
  const cible = courant.donnees;
  const source = originale.donnees;
  let touches = 0;
  const departY = Math.max(0, cy - rayon);
  const finY = Math.min(courant.hauteur - 1, cy + rayon);
  const departX = Math.max(0, cx - rayon);
  const finX = Math.min(courant.largeur - 1, cx + rayon);
  const rayonCarre = rayon * rayon;
  for (let y = departY; y <= finY; y++) {
    for (let x = departX; x <= finX; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > rayonCarre) continue;
      const i = (y * courant.largeur + x) * 4;
      cible[i] = source[i];
      cible[i + 1] = source[i + 1];
      cible[i + 2] = source[i + 2];
      cible[i + 3] = source[i + 3];
      touches++;
    }
  }
  return touches;
};

// Remplace la transparence par une couleur pleine : les pixels opaques du
// sujet restent intacts, les vides reçoivent le fond.
export const composerFondCouleur = ({ donnees }, { rouge, vert, bleu }) => {
  let touches = 0;
  for (let i = 0; i < donnees.length; i += 4) {
    if (donnees[i + 3] >= 255) continue;
    donnees[i] = rouge;
    donnees[i + 1] = vert;
    donnees[i + 2] = bleu;
    donnees[i + 3] = 255;
    touches++;
  }
  return touches;
};

// Mode portrait : fond (version floutée de l'original) révélé à travers les
// zones détournées ; les pixels semi-transparents du sujet sont fondus.
export const composerFondFlou = ({ donnees }, { donnees: fond }) => {
  let touches = 0;
  for (let i = 0; i < donnees.length; i += 4) {
    const alpha = donnees[i + 3];
    if (alpha >= 255) continue;
    if (alpha === 0) {
      donnees[i] = fond[i];
      donnees[i + 1] = fond[i + 1];
      donnees[i + 2] = fond[i + 2];
    } else {
      donnees[i] = Math.round((donnees[i] * alpha + fond[i] * (255 - alpha)) / 255);
      donnees[i + 1] = Math.round((donnees[i + 1] * alpha + fond[i + 1] * (255 - alpha)) / 255);
      donnees[i + 2] = Math.round((donnees[i + 2] * alpha + fond[i + 2] * (255 - alpha)) / 255);
    }
    donnees[i + 3] = 255;
    touches++;
  }
  return touches;
};

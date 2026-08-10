// Signature — les règles, sans React ni canvas.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUE CETTE APPLICATION APPORTE
//
// Une PME signe tous les jours : devis acceptés, bons de livraison,
// contrats, factures. Jusqu'ici il fallait imprimer, signer, scanner —
// trois étapes pour une paraphe. Cette application garde les signatures
// des dirigeants sous la main et les pose sur les documents du cloud.
//
// Une signature est une liste de **traits**, chaque trait une liste de
// points {x, y} captés au pointeur. On stocke les traits, pas l'image :
// c'est plus léger, rejouable à toute taille sans pixellisation, et
// l'export (SVG, PNG) se régénère à la demande.
// ─────────────────────────────────────────────────────────────────────────

/// Les encres proposées. Le noir pour l'usage courant, le bleu des
/// stylos à bille — certains destinataires exigent une signature « à
/// l'encre bleue » pour distinguer l'original d'une photocopie.
export const ENCRES = [
  { id: "noir", label: "Encre noire", couleur: "#1f2733" },
  { id: "bleu", label: "Encre bleue", couleur: "#1a4fd6" },
];

export const couleurEncre = (id) =>
  (ENCRES.find((e) => e.id === id) || ENCRES[0]).couleur;

// ---------------------------------------------------------------------------
// Géométrie des traits
// ---------------------------------------------------------------------------

/// Chemin SVG d'un trait, lissé : chaque segment vise le milieu du
/// suivant en courbe quadratique. C'est le lissage classique des pads de
/// signature — il gomme le tremblé de la souris sans trahir le geste.
export const cheminDe = (points) => {
  if (!points.length) return "";
  if (points.length === 1) {
    // Un point isolé : un petit cercle, sinon le clic sec ne laisse rien.
    const { x, y } = points[0];
    return `M ${x - 0.1} ${y} L ${x + 0.1} ${y}`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x} ${points[i].y} ${mx} ${my}`;
  }
  const fin = points[points.length - 1];
  d += ` L ${fin.x} ${fin.y}`;
  return d;
};

/// Boîte englobante de tous les traits, ou null si rien n'est dessiné.
export const bornes = (traits) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const trait of traits) {
    for (const p of trait) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
};

/// Recadre les traits sur l'origine, avec une marge : le pad est grand,
/// la signature ne l'est pas — on n'exporte que le geste, pas le vide
/// autour.
export const recadrer = (traits, marge = 10) => {
  const b = bornes(traits);
  if (!b) return { traits: [], largeur: 0, hauteur: 0 };
  const dx = b.minX - marge;
  const dy = b.minY - marge;
  return {
    traits: traits.map((t) =>
      t.map((p) => ({
        x: Math.round((p.x - dx) * 100) / 100,
        y: Math.round((p.y - dy) * 100) / 100,
      })),
    ),
    largeur: Math.ceil(b.maxX - b.minX + marge * 2),
    hauteur: Math.ceil(b.maxY - b.minY + marge * 2),
  };
};

/// Le SVG complet d'une signature recadrée — fond transparent, traits en
/// courbes. C'est la forme d'export de référence ; le PNG s'en déduit.
export const svgDe = (traitsRecadres, largeur, hauteur, { couleur = "#1f2733", epaisseur = 2.5 } = {}) => {
  const chemins = traitsRecadres
    .map(
      (t) =>
        `<path d="${cheminDe(t)}" fill="none" stroke="${couleur}" stroke-width="${epaisseur}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${largeur} ${hauteur}" width="${largeur}" height="${hauteur}">${chemins}</svg>`;
};

/// Ajuste des dimensions dans un gabarit en gardant les proportions —
/// pour poser la signature sur un document sans l'écraser.
export const ajusterDans = (largeur, hauteur, maxL, maxH) => {
  if (!largeur || !hauteur) return { largeur: 0, hauteur: 0 };
  const ratio = Math.min(maxL / largeur, maxH / hauteur, 1);
  return {
    largeur: Math.round(largeur * ratio),
    hauteur: Math.round(hauteur * ratio),
  };
};

/// Vrai si le dessin est trop pauvre pour être une signature : un
/// gribouillis d'un seul point n'engage personne.
export const tropCourte = (traits) => {
  const points = traits.reduce((n, t) => n + t.length, 0);
  return points < 8;
};

/// Nom de fichier sûr pour l'export.
export const nomFichier = (nom, ext = "png") =>
  `signature-${(nom || "sans-nom")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}.${ext}`;

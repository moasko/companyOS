import QRCode from "qrcode";

// Rendu du QR à partir de la matrice de modules plutôt que via
// QRCode.toDataURL : c'est le seul moyen d'obtenir les coins arrondis,
// le logo central et des exports vectoriels réellement identiques
// à l'aperçu affiché.

export const buildMatrix = (text, level) => {
  const qr = QRCode.create(text, { errorCorrectionLevel: level });
  const size = qr.modules.size;
  const data = qr.modules.data;
  return {
    size,
    // true = module sombre
    at: (row, col) => data[row * size + col] === 1,
  };
};

/// Géométrie commune à tous les formats de sortie.
const layout = (matrix, pixels, marginModules) => {
  const total = matrix.size + marginModules * 2;
  const scale = pixels / total;
  return { total, scale, offset: marginModules * scale };
};

/// Dessine le QR sur un canvas. `logo` est un HTMLImageElement ou null.
export const drawToCanvas = (canvas, matrix, options, logo) => {
  const { pixels, margin, dark, light, transparent, rounded } = options;
  const { scale, offset } = layout(matrix, pixels, margin);
  const ctx = canvas.getContext("2d");

  canvas.width = pixels;
  canvas.height = pixels;

  ctx.clearRect(0, 0, pixels, pixels);
  if (!transparent) {
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, pixels, pixels);
  }

  ctx.fillStyle = dark;
  // Le radius est plafonné à la moitié du module : au-delà, les modules
  // voisins se détachent et le code devient illisible.
  const radius = rounded ? scale * 0.42 : 0;

  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (!matrix.at(row, col)) continue;
      const x = offset + col * scale;
      const y = offset + row * scale;

      if (radius > 0) {
        ctx.beginPath();
        ctx.roundRect(x, y, scale, scale, radius);
        ctx.fill();
      } else {
        // +0.5 px pour éviter les liserés clairs entre modules adjacents.
        ctx.fillRect(x, y, scale + 0.5, scale + 0.5);
      }
    }
  }

  if (logo) {
    // Le logo masque des modules : on ne l'autorise qu'avec une correction
    // suffisante, et on le garde sous 22 % de la largeur.
    const box = pixels * 0.22;
    const cx = (pixels - box) / 2;
    const pad = box * 0.1;

    ctx.fillStyle = transparent ? "#ffffff" : light;
    ctx.beginPath();
    ctx.roundRect(cx - pad, cx - pad, box + pad * 2, box + pad * 2, box * 0.18);
    ctx.fill();

    ctx.drawImage(logo, cx, cx, box, box);
  }
};

export const toSvg = (matrix, options) => {
  const { pixels, margin, dark, light, transparent, rounded } = options;
  const { scale, offset } = layout(matrix, pixels, margin);
  const radius = rounded ? scale * 0.42 : 0;

  const parts = [];
  if (!transparent) {
    parts.push(`<rect width="${pixels}" height="${pixels}" fill="${light}"/>`);
  }

  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (!matrix.at(row, col)) continue;
      const x = (offset + col * scale).toFixed(2);
      const y = (offset + row * scale).toFixed(2);
      const s = scale.toFixed(2);
      parts.push(
        radius > 0
          ? `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${radius.toFixed(2)}" fill="${dark}"/>`
          : `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${dark}"/>`,
      );
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 ${pixels} ${pixels}" shape-rendering="crispEdges">${parts.join("")}</svg>`;
};

const hexToRgbUnit = (hex) => {
  const v = hex.replace("#", "");
  const full =
    v.length === 3
      ? v
          .split("")
          .map((c) => c + c)
          .join("")
      : v;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/// PDF vectoriel écrit à la main : le QR n'est qu'une suite de rectangles,
/// une dépendance PDF complète n'apporterait rien ici.
export const toPdf = (matrix, options) => {
  const { pixels, margin, dark, light, transparent } = options;
  const { scale, offset } = layout(matrix, pixels, margin);
  const [dr, dg, db] = hexToRgbUnit(dark);

  const ops = [];
  if (!transparent) {
    const [lr, lg, lb] = hexToRgbUnit(light);
    ops.push(`${lr} ${lg} ${lb} rg`, `0 0 ${pixels} ${pixels} re f`);
  }
  ops.push(`${dr} ${dg} ${db} rg`);

  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (!matrix.at(row, col)) continue;
      const x = offset + col * scale;
      // L'origine PDF est en bas à gauche : on inverse l'axe vertical.
      const y = pixels - offset - (row + 1) * scale;
      ops.push(`${x.toFixed(2)} ${y.toFixed(2)} ${scale.toFixed(2)} ${scale.toFixed(2)} re f`);
    }
  }

  const content = ops.join("\n");
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pixels} ${pixels}]/Contents 4 0 R/Resources<<>>>>`,
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => {
    pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;

  return pdf;
};

/// EPS : même principe, en PostScript.
export const toEps = (matrix, options) => {
  const { pixels, margin, dark, light, transparent } = options;
  const { scale, offset } = layout(matrix, pixels, margin);
  const [dr, dg, db] = hexToRgbUnit(dark);

  const lines = [
    "%!PS-Adobe-3.0 EPSF-3.0",
    `%%BoundingBox: 0 0 ${Math.ceil(pixels)} ${Math.ceil(pixels)}`,
    "%%Creator: CompanyOS",
    "%%EndComments",
    "/m {newpath moveto} bind def",
    "/r {4 2 roll moveto 1 index 0 rlineto 0 exch rlineto neg 0 rlineto closepath fill} bind def",
  ];

  if (!transparent) {
    const [lr, lg, lb] = hexToRgbUnit(light);
    lines.push(`${lr} ${lg} ${lb} setrgbcolor`);
    lines.push(`${pixels} ${pixels} 0 0 r`);
  }
  lines.push(`${dr} ${dg} ${db} setrgbcolor`);

  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (!matrix.at(row, col)) continue;
      const x = offset + col * scale;
      const y = pixels - offset - (row + 1) * scale;
      lines.push(
        `${scale.toFixed(2)} ${scale.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} r`,
      );
    }
  }

  lines.push("showpage", "%%EOF");
  return lines.join("\n");
};

// Génération de la facture en PDF, écrite à la main.
//
// Une facture n'a besoin que de texte et de filets : les polices Helvetica
// font partie des 14 polices standard, donc aucune n'est à embarquer et
// aucune dépendance PDF n'est nécessaire.

// Largeurs Helvetica (millièmes de cadratin) pour les codes 32 à 126.
const W_REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const W_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/// Le PDF est produit octet par octet : les accents français vivent dans
/// la plage Latin-1, qui coïncide avec WinAnsiEncoding. Les rares
/// caractères hors plage sont remplacés plutôt que de casser le fichier.
const WINANSI_EXTRA = {
  // Intl.NumberFormat("fr-FR") sépare les milliers par une espace fine
  // insécable (U+202F), absente de WinAnsi : on la ramène à l'espace
  // insécable ordinaire, sinon les montants s'affichent « 1?070?000 ».
  " ": 0xa0,
  " ": 0xa0,
  " ": 0xa0,
  "€": 0x80,
  "‚": 0x82,
  "ƒ": 0x83,
  "„": 0x84,
  "…": 0x85,
  "‰": 0x89,
  "Š": 0x8a,
  "‹": 0x8b,
  "Œ": 0x8c,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "š": 0x9a,
  "›": 0x9b,
  "œ": 0x9c,
  "Ÿ": 0x9f,
};

const toWinAnsi = (text) =>
  String(text ?? "")
    .split("")
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code < 256) return code;
      return WINANSI_EXTRA[ch] ?? 63; // « ? »
    });

const textWidth = (text, size, bold) => {
  const table = bold ? W_BOLD : W_REGULAR;
  let total = 0;
  for (const code of toWinAnsi(text)) {
    total += code >= 32 && code <= 126 ? table[code - 32] : 556;
  }
  return (total * size) / 1000;
};

/// Échappe pour une chaîne PDF littérale, en octal pour le non-ASCII.
const pdfString = (text) =>
  toWinAnsi(text)
    .map((code) => {
      if (code === 40 || code === 41 || code === 92) return "\\" + String.fromCharCode(code);
      if (code < 32 || code > 126) return "\\" + code.toString(8).padStart(3, "0");
      return String.fromCharCode(code);
    })
    .join("");

/// Tronque un texte pour qu'il tienne dans une largeur donnée.
const clip = (text, size, bold, maxWidth) => {
  let out = String(text ?? "");
  if (textWidth(out, size, bold) <= maxWidth) return out;
  while (out.length > 1 && textWidth(out + "…", size, bold) > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + "…";
};

// --- Construction du flux de contenu ---------------------------------------

class Page {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.ops = [];
  }

  text(str, x, y, { size = 10, bold = false, color = "0 0 0", align = "left", width = 0 } = {}) {
    let tx = x;
    if (align === "right") tx = x - textWidth(str, size, bold);
    else if (align === "center") tx = x + (width - textWidth(str, size, bold)) / 2;

    this.ops.push(
      "BT",
      `${color} rg`,
      `/${bold ? "F2" : "F1"} ${size} Tf`,
      // L'origine PDF est en bas à gauche ; on raisonne depuis le haut.
      `1 0 0 1 ${tx.toFixed(2)} ${(this.height - y).toFixed(2)} Tm`,
      `(${pdfString(str)}) Tj`,
      "ET",
    );
  }

  line(x1, y1, x2, y2, { color = "0.85 0.87 0.9", width = 0.8 } = {}) {
    this.ops.push(
      `${color} RG`,
      `${width} w`,
      `${x1.toFixed(2)} ${(this.height - y1).toFixed(2)} m`,
      `${x2.toFixed(2)} ${(this.height - y2).toFixed(2)} l`,
      "S",
    );
  }

  rect(x, y, w, h, color) {
    this.ops.push(
      `${color} rg`,
      `${x.toFixed(2)} ${(this.height - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`,
    );
  }

  stream() {
    return this.ops.join("\n");
  }
}

const buildPdf = (page) => {
  const content = page.stream();
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${page.width} ${page.height}]/Contents 4 0 R` +
      "/Resources<</Font<</F1 5 0 R/F2 6 0 R>>>>>>",
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>",
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

  // Chaque caractère vaut un octet : les décalages du xref restent justes.
  return new Uint8Array(pdf.length).map((_, i) => pdf.charCodeAt(i) & 0xff);
};

// --- Mise en page de la facture --------------------------------------------

const money = (n, devise) =>
  `${new Intl.NumberFormat("fr-FR").format(Math.round((Number(n) || 0) * 100) / 100)} ${devise}`;

const frDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

/// Produit le PDF d'une facture. `totaux` vient du module pour que le
/// document affiche exactement ce que l'écran montrait.
export const invoiceToPdf = ({ facture, totaux, emetteur, statutLabel, typeLabel }) => {
  const page = new Page(595.28, 841.89); // A4
  const M = 48; // marge
  const right = page.width - M;
  const devise = facture.devise || "XOF";
  const accent = "0.102 0.451 0.910";
  const grey = "0.42 0.46 0.52";

  // En-tête
  page.rect(0, 0, page.width, 6, accent);
  page.text(emetteur.nom, M, 62, { size: 15, bold: true });
  page.text("Espace de travail CompanyOS", M, 78, { size: 8.5, color: grey });

  // Le titre suit le type : un devis présenté comme une facture serait
  // encaissé par erreur, et un avoir facturé une deuxième fois.
  page.text((typeLabel || "FACTURE").toUpperCase(), right, 60, {
    size: 22,
    bold: true,
    align: "right",
    color: accent,
  });
  page.text(`N° ${facture.numero}`, right, 78, { size: 10, align: "right" });
  page.text(statutLabel, right, 93, { size: 8.5, align: "right", color: grey });

  page.line(M, 112, right, 112);

  // Blocs client / dates
  page.text("FACTURÉ À", M, 134, { size: 8, bold: true, color: grey });
  page.text(facture.clientEntreprise || facture.clientNom || "—", M, 150, {
    size: 11,
    bold: true,
  });
  let y = 165;
  if (facture.clientEntreprise && facture.clientNom) {
    page.text(facture.clientNom, M, y, { size: 9.5, color: grey });
    y += 14;
  }
  if (facture.clientEmail) {
    page.text(facture.clientEmail, M, y, { size: 9.5, color: grey });
    y += 14;
  }
  if (facture.clientVille) {
    page.text(facture.clientVille, M, y, { size: 9.5, color: grey });
  }

  const dx = right - 150;
  page.text("DATE D'ÉMISSION", dx, 134, { size: 8, bold: true, color: grey });
  page.text(frDate(facture.date), right, 150, { size: 10, align: "right" });
  page.text("ÉCHÉANCE", dx, 170, { size: 8, bold: true, color: grey });
  page.text(frDate(facture.echeance), right, 186, { size: 10, align: "right" });

  // Tableau des lignes
  let ty = 224;
  const colQte = right - 250;
  const colPu = right - 180;
  const colTva = right - 90;

  page.rect(M, ty - 13, right - M, 22, "0.965 0.973 0.984");
  page.text("DÉSIGNATION", M + 8, ty, { size: 8, bold: true, color: grey });
  page.text("QTÉ", colQte, ty, { size: 8, bold: true, color: grey, align: "right" });
  page.text("PRIX UNIT.", colPu, ty, { size: 8, bold: true, color: grey, align: "right" });
  page.text("TVA", colTva, ty, { size: 8, bold: true, color: grey, align: "right" });
  page.text("TOTAL HT", right - 8, ty, { size: 8, bold: true, color: grey, align: "right" });

  ty += 24;
  for (const ligne of facture.lignes || []) {
    const ht = (Number(ligne.qte) || 0) * (Number(ligne.pu) || 0);
    page.text(clip(ligne.designation || "—", 9.5, false, colQte - M - 20), M + 8, ty, {
      size: 9.5,
    });
    page.text(String(ligne.qte ?? 0), colQte, ty, { size: 9.5, align: "right" });
    page.text(money(ligne.pu, devise), colPu, ty, { size: 9.5, align: "right" });
    page.text(`${Number(ligne.tva) || 0} %`, colTva, ty, { size: 9.5, align: "right" });
    page.text(money(ht, devise), right - 8, ty, { size: 9.5, align: "right" });

    ty += 12;
    page.line(M, ty, right, ty, { color: "0.93 0.94 0.96", width: 0.5 });
    ty += 14;

    // Sécurité : au-delà d'une page on tronque plutôt que de déborder.
    if (ty > page.height - 220) {
      page.text("… lignes suivantes non affichées", M + 8, ty, {
        size: 8.5,
        color: grey,
      });
      ty += 18;
      break;
    }
  }

  // Totaux
  const tx = right - 190;
  ty += 10;
  page.text("Total HT", tx, ty, { size: 9.5, color: grey });
  page.text(money(totaux.ht, devise), right - 8, ty, { size: 9.5, align: "right" });
  ty += 18;
  page.text("TVA", tx, ty, { size: 9.5, color: grey });
  page.text(money(totaux.tva, devise), right - 8, ty, { size: 9.5, align: "right" });
  ty += 10;
  page.line(tx, ty, right, ty);
  ty += 20;
  page.text("TOTAL TTC", tx, ty, { size: 11.5, bold: true });
  page.text(money(totaux.ttc, devise), right - 8, ty, {
    size: 11.5,
    bold: true,
    align: "right",
    color: accent,
  });

  // Notes et pied de page
  if (facture.notes) {
    ty += 40;
    page.text("NOTES", M, ty, { size: 8, bold: true, color: grey });
    ty += 15;
    // Découpe grossière en lignes de ~95 caractères.
    const words = String(facture.notes).split(/\s+/);
    let line = "";
    for (const word of words) {
      if (textWidth(line + " " + word, 9, false) > right - M) {
        page.text(line, M, ty, { size: 9, color: grey });
        ty += 13;
        line = word;
      } else {
        line = line ? line + " " + word : word;
      }
    }
    if (line) page.text(line, M, ty, { size: 9, color: grey });
  }

  page.line(M, page.height - 58, right, page.height - 58);
  page.text(
    `${emetteur.nom} — ${(typeLabel || "facture").toLowerCase()} ${facture.numero} — générée par CompanyOS`,
    M,
    page.height - 42,
    { size: 8, color: grey },
  );

  return new Blob([buildPdf(page)], { type: "application/pdf" });
};

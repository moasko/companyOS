// Outils du générateur de démonstration : dates relatives, hasard
// reproductible, identifiants, PDF minimal.

import { randomBytes } from "node:crypto";

/// Identifiant au format des enregistrements (25 caractères, comme un cuid).
export const id = () => `c${randomBytes(12).toString("hex")}`;

/// Hasard **reproductible** : la même graine donne la même démo, ce qui
/// permet de répéter une présentation à l'identique après réinitialisation.
export const hasard = (graine = 2026) => {
  let a = graine >>> 0;
  const suivant = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    nombre: suivant,
    entier: (min, max) => min + Math.floor(suivant() * (max - min + 1)),
    choix: (liste) => liste[Math.floor(suivant() * liste.length)],
    vrai: (p = 0.5) => suivant() < p,
    melange: (liste) => {
      const l = [...liste];
      for (let i = l.length - 1; i > 0; i--) {
        const j = Math.floor(suivant() * (i + 1));
        [l[i], l[j]] = [l[j], l[i]];
      }
      return l;
    },
  };
};

/// Les dates de la démo se calculent à partir d'aujourd'hui : un tableau
/// de bord ouvert le jour de la présentation est toujours « vivant ».
export const calendrier = (maintenant = new Date()) => {
  const base = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate()));
  const decaler = (n) => new Date(base.getTime() + n * 86400_000);
  const jour = (n = 0) => decaler(n).toISOString().slice(0, 10);
  /// Date et heure (ISO) d'un jour relatif, en heure d'Abidjan (UTC).
  const instant = (n = 0, h = 9, m = 0) => new Date(base.getTime() + n * 86400_000 + (h * 60 + m) * 60_000);
  const mois = (n = 0) => {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + n, 1));
    return d.toISOString().slice(0, 7);
  };
  /// Jour `j` du mois relatif `n` (borné au dernier jour du mois).
  const dansMois = (n, j) => {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + n, 1));
    const dernier = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(j, dernier));
    return d.toISOString().slice(0, 10);
  };
  const ecart = (date) => Math.round((Date.parse(date) - base.getTime()) / 86400_000);
  const jourSemaine = (n) => decaler(n).getUTCDay();
  return { base, jour, instant, mois, dansMois, ecart, jourSemaine, annee: base.getUTCFullYear() };
};

export const arrondi = (n) => Math.round(Number(n) || 0);

// ---------------------------------------------------------------------------
// PDF minimal
// ---------------------------------------------------------------------------

// Un PDF d'une page, texte seul, en Helvetica (WinAnsi : les accents
// français passent). Assez pour que l'aperçu de l'Explorateur et le
// lecteur PDF montrent un vrai document.
const echapper = (s) => String(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

export const pdfTexte = (titre, lignes = []) => {
  const flux = [
    "BT",
    "/F2 18 Tf",
    "56 780 Td",
    `(${echapper(titre)}) Tj`,
    "/F1 11 Tf",
    "0 -30 Td",
    ...lignes.flatMap((l) => [`(${echapper(l)}) Tj`, "0 -17 Td"]),
    "ET",
  ].join("\n");
  const corps = Buffer.from(flux, "latin1");
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  const morceaux = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const positions = [];
  let taille = morceaux[0].length;
  const ajouter = (b) => {
    morceaux.push(b);
    taille += b.length;
  };
  objets.forEach((o, i) => {
    positions.push(taille);
    ajouter(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, "latin1"));
  });
  positions.push(taille);
  ajouter(Buffer.from(`6 0 obj\n<< /Length ${corps.length} >>\nstream\n`, "latin1"));
  ajouter(corps);
  ajouter(Buffer.from("\nendstream\nendobj\n", "latin1"));
  const xref = taille;
  const table = positions.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("");
  ajouter(Buffer.from(`xref\n0 7\n0000000000 65535 f \n${table}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, "latin1"));
  return Buffer.concat(morceaux);
};

/// Une ligne de CSV « à la française » (point-virgule, guillemets si besoin).
export const csv = (lignes) =>
  "﻿" +
  lignes
    .map((l) => l.map((v) => (/[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(";"))
    .join("\r\n");

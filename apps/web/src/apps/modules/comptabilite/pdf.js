// Comptabilité — documents PDF : états financiers, relevé de compte.
//
// Le moteur est celui de la Facturation (Page) et l'assembleur multipage
// celui de l'Éditeur de factures : un seul code pour tous les PDF de
// CompanyOS. Ici, une seule mise en page — un tableau qui se poursuit de
// page en page, avec l'en-tête de l'entreprise et la pagination.

import { Page, clip, textWidth } from "../facturation/pdf";
import { assembler } from "../editeur-factures/pdf";

const L = 595.28;
const H = 841.89;
const M = 40;
const DROITE = L - M;
const GRIS = "0.42 0.45 0.50";
const LIGNE = "0.88 0.89 0.91";
const ENCRE = "0.07 0.09 0.15";
const VERT = "0.016 0.47 0.34";
const FOND_SOUS = "0.97 0.98 0.98";
const FOND_TOTAL = "0.93 0.99 0.96";

const propre = (t) => String(t ?? "").replace(/[  ]/g, " ").replace(/−/g, "-");

/// « 1 234 567 » — les espaces fines ne passent pas en WinAnsi.
export const nombre = (n) =>
  n === "" || n == null
    ? ""
    : propre(Math.round(Number(n) || 0).toLocaleString("fr-FR"));

const dateFr = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

/// Un rapport tabulaire multipage.
///
/// `colonnes` : [{ label, largeur (fraction), align }].
/// `lignes` : [{ cellules: [...], style: "" | "sous" | "total" | "titre" }].
export const rapportPdf = ({ titre, sousTitre = "", entreprise = {}, colonnes, lignes, notes = [] }) => {
  const pages = [];
  const largeurUtile = DROITE - M;
  const xs = [];
  let x = M;
  for (const c of colonnes) {
    xs.push(x);
    x += c.largeur * largeurUtile;
  }
  let page;
  let y;

  const entete = () => {
    page = new Page(L, H);
    pages.push(page);
    page.text(propre(entreprise.raisonSociale || entreprise.nom || "Entreprise"), M, 46, { size: 12, bold: true, color: ENCRE });
    const legal = [entreprise.ncc ? `NCC ${entreprise.ncc}` : "", entreprise.rccm ? `RCCM ${entreprise.rccm}` : ""]
      .filter(Boolean)
      .join(" · ");
    // Deux moitiés : l'identité à gauche, le titre à droite. Chacune est
    // bornée, sans quoi un NCC long passerait sous le sous-titre.
    const moitie = (DROITE - M) / 2 - 10;
    if (legal) page.text(propre(clip(propre(legal), 8, false, moitie)), M, 60, { size: 8, color: GRIS });
    page.text(propre(titre), DROITE, 46, { size: 13, bold: true, align: "right", color: VERT });
    if (sousTitre) page.text(propre(clip(propre(sousTitre), 8.5, false, moitie)), DROITE, 60, { size: 8.5, align: "right", color: GRIS });
    page.line(M, 72, DROITE, 72, { color: LIGNE });
    y = 92;
    colonnes.forEach((c, i) => {
      const w = c.largeur * largeurUtile;
      const tx = c.align === "right" ? xs[i] + w - 4 : xs[i] + 4;
      page.text(propre(c.label), tx, y, { size: 8, bold: true, color: GRIS, align: c.align === "right" ? "right" : "left" });
    });
    y += 8;
    page.line(M, y, DROITE, y, { color: LIGNE });
    y += 14;
  };

  entete();
  for (const l of lignes) {
    const haut = l.style === "titre" ? 22 : 17;
    if (y + haut > H - 60) entete();
    if (l.style === "sous" || l.style === "total") {
      page.rect(M, y - 11.5, largeurUtile, 16, l.style === "total" ? FOND_TOTAL : FOND_SOUS);
    }
    if (l.style === "titre") {
      y += 4;
      page.text(propre(l.cellules[0]), M + 4, y, { size: 9.5, bold: true, color: ENCRE });
      y += haut - 4;
      continue;
    }
    const gras = l.style === "sous" || l.style === "total";
    l.cellules.forEach((cel, i) => {
      const c = colonnes[i];
      if (!c) return;
      const w = c.largeur * largeurUtile - 8;
      const texte = propre(clip(propre(cel), 8.5, gras, w));
      const tx = c.align === "right" ? xs[i] + w + 4 : xs[i] + 4;
      page.text(texte, tx, y, {
        size: 8.5,
        bold: gras,
        color: l.style === "total" ? VERT : ENCRE,
        align: c.align === "right" ? "right" : "left",
      });
    });
    y += haut;
  }

  for (const n of notes) {
    if (y + 16 > H - 60) entete();
    y += 6;
    page.text(propre(clip(n, 8, false, largeurUtile)), M, y, { size: 8, color: GRIS });
    y += 10;
  }

  const genere = `Généré par CompanyOS le ${dateFr(new Date().toISOString().slice(0, 10))}`;
  pages.forEach((p, i) => {
    p.line(M, H - 44, DROITE, H - 44, { color: LIGNE });
    p.text(propre(genere), M, H - 30, { size: 7.5, color: GRIS });
    const pag = `Page ${i + 1} / ${pages.length}`;
    p.text(pag, DROITE - textWidth(pag, 7.5, false), H - 30, { size: 7.5, color: GRIS });
  });

  return assembler(pages);
};

/// Le relevé de compte d'un client ou d'un fournisseur : ses pièces, leur
/// solde courant, et ce qui reste dû.
export const releveDeComptePdf = ({ entreprise, tiers, compte, lignes, au }) => {
  let solde = 0;
  const corps = lignes.map((l) => {
    solde += (Number(l.debit) || 0) - (Number(l.credit) || 0);
    return {
      cellules: [
        dateFr(l.date),
        l.numero || l.piece || "",
        l.libelle || "",
        l.debit ? nombre(l.debit) : "",
        l.credit ? nombre(l.credit) : "",
        nombre(solde),
      ],
    };
  });
  const debiteur = compte.startsWith("41");
  corps.push({
    style: "total",
    cellules: [
      "",
      "",
      debiteur
        ? solde >= 0 ? "Reste dû à ce jour" : "Avance en votre faveur"
        : solde <= 0 ? "Reste à vous régler" : "Avance versée",
      "",
      "",
      nombre(Math.abs(solde)),
    ],
  });
  return rapportPdf({
    titre: "Relevé de compte",
    sousTitre: `${tiers} — compte ${compte} — au ${dateFr(au)}`,
    entreprise,
    colonnes: [
      { label: "Date", largeur: 0.11 },
      { label: "Pièce", largeur: 0.16 },
      { label: "Libellé", largeur: 0.35 },
      { label: "Débit", largeur: 0.12, align: "right" },
      { label: "Crédit", largeur: 0.12, align: "right" },
      { label: "Solde", largeur: 0.14, align: "right" },
    ],
    lignes: corps,
    notes: [
      "Montants en francs CFA. Merci de nous signaler toute différence avec votre propre comptabilité.",
    ],
  });
};

// Paie — le bulletin en PDF.
//
// Toujours en français : c'est la langue légale du bulletin en Côte
// d'Ivoire, quelle que soit la langue de l'écran. Le moteur est celui des
// autres PDF de CompanyOS (Page de la Facturation, assembleur multipage de
// l'Éditeur de factures).

import { Page, clip, textWidth } from "../facturation/pdf";
import { assembler } from "../editeur-factures/pdf";
import { montantEnLettres } from "../editeur-factures/domaine";
import { TEXTES } from "./textes";

const L = 595.28;
const H = 841.89;
const M = 40;
const DROITE = L - M;
const GRIS = "0.42 0.45 0.50";
const LIGNE = "0.88 0.89 0.91";
const ENCRE = "0.07 0.09 0.15";
const ACCENT = "0.26 0.22 0.79";
const FOND = "0.97 0.98 0.98";
const FOND_ACCENT = "0.93 0.95 1";

const fr = TEXTES.fr;
const propre = (t) => String(t ?? "").replace(/[  ]/g, " ").replace(/−/g, "-");
const nb = (n) => (n || n === 0 ? propre(Math.round(Number(n)).toLocaleString("fr-FR")) : "");
const dateFr = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const finDeMois = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

const MODES = { virement: "Virement", mobile: "Mobile Money", especes: "Espèces" };
const SITUATIONS = { celibataire: "Célibataire", marie: "Marié(e)", veuf: "Veuf(ve)" };

const ajuster = (im, maxL, maxH) => {
  const r = Math.min(maxL / im.largeur, maxH / im.hauteur);
  return [im.largeur * r, im.hauteur * r];
};

/// Libellé imprimé d'une rubrique, avec son complément (heures, années).
export const libelleRubrique = (r, t = (k) => fr[k] || k) => {
  const base = t(`rub_${r.libelle}`);
  if (r.libelle === "heuresSup") return `${base} ${r.taux} %`;
  if (r.libelle === "anciennete" && r.ans) return `${base} (${r.ans} ${t("ans")})`;
  if (r.libelle === "absences") return `${base} (${r.base} j)`;
  return base;
};

/// Le bulletin d'un salarié pour un mois.
///
/// `salarie` : la fiche RH (data) ; `saisie` et `calcul` : ceux du bulletin ;
/// `cumuls` : les totaux de l'année jusqu'à ce mois inclus ; `images` :
/// `{ Logo }` préparé par imagesPdf.
export const bulletinPdf = ({ entreprise = {}, salarie = {}, mois, saisie = {}, calcul, cumuls = {}, images = {} }) => {
  const page = new Page(L, H);
  let y = 46;

  // En-tête : l'employeur à gauche, le document à droite.
  let x = M;
  if (images.Logo) {
    const [w, h] = ajuster(images.Logo, 90, 46);
    page.image("Logo", M, 28, w, h);
    x = M + w + 12;
  }
  page.text(propre(entreprise.nom || "Entreprise"), x, y, { size: 12, bold: true, color: ENCRE });
  const lignesEmployeur = [
    [entreprise.adresse, entreprise.ville].filter(Boolean).join(", "),
    [entreprise.ncc ? `NCC ${entreprise.ncc}` : "", entreprise.cnpsEmployeur ? `CNPS ${entreprise.cnpsEmployeur}` : ""].filter(Boolean).join(" · "),
  ].filter(Boolean);
  lignesEmployeur.forEach((l, i) => page.text(propre(clip(propre(l), 8.5, false, 260)), x, y + 13 + i * 11, { size: 8.5, color: GRIS }));
  page.text("BULLETIN DE PAIE", DROITE, y, { size: 14, bold: true, align: "right", color: ACCENT });
  page.text(`Période du ${dateFr(`${mois}-01`)} au ${dateFr(finDeMois(mois))}`, DROITE, y + 14, { size: 9, align: "right", color: ENCRE });
  page.text(propre(`Paiement : ${MODES[saisie.modePaiement] || "Virement"}`), DROITE, y + 26, { size: 8.5, align: "right", color: GRIS });
  y = 96;

  // Le salarié.
  page.rect(M, y, DROITE - M, 56, FOND);
  const ident = [
    ["Salarié", [salarie.prenom, salarie.nom].filter(Boolean).join(" ")],
    ["Matricule", salarie.matricule],
    ["Emploi", salarie.poste],
    ["Entrée", dateFr(salarie.dateEmbauche)],
    ["N° CNPS", salarie.numeroCnps],
    ["Situation", `${SITUATIONS[saisie.situation] || ""}${saisie.enfants ? `, ${saisie.enfants} enfant(s)` : ""}`],
    ["Parts ITS", String(calcul.parts ?? "")],
    ["Ancienneté", calcul.tauxAnciennete ? `${calcul.tauxAnciennete} %` : "—"],
  ];
  const colW = (DROITE - M) / 4;
  ident.forEach(([l, v], i) => {
    const cx = M + 10 + (i % 4) * colW;
    const cy = y + 16 + Math.floor(i / 4) * 24;
    page.text(l, cx, cy, { size: 7, color: GRIS });
    page.text(propre(clip(propre(v || "—"), 9, true, colW - 16)), cx, cy + 10, { size: 9, bold: true, color: ENCRE });
  });
  y += 76;

  // Les rubriques.
  const cols = [
    { l: "N°", w: 0.07 },
    { l: "Rubrique", w: 0.37 },
    { l: "Base", w: 0.12, d: true },
    { l: "Taux", w: 0.08, d: true },
    { l: "Gain", w: 0.12, d: true },
    { l: "Retenue", w: 0.12, d: true },
    { l: "Patronal", w: 0.12, d: true },
  ];
  const xs = [];
  let cx = M;
  for (const c of cols) {
    xs.push(cx);
    cx += c.w * (DROITE - M);
  }
  const cellule = (i, texte, opts = {}) => {
    const c = cols[i];
    const w = c.w * (DROITE - M);
    const t = propre(clip(propre(texte), 8.5, !!opts.bold, w - 8));
    page.text(t, c.d ? xs[i] + w - 4 : xs[i] + 4, y, { size: opts.size || 8.5, bold: !!opts.bold, color: opts.color || ENCRE, align: c.d ? "right" : "left" });
  };
  cols.forEach((c, i) => cellule(i, c.l.toUpperCase(), { size: 7, bold: true, color: GRIS }));
  y += 6;
  page.line(M, y, DROITE, y, { color: LIGNE, width: 1.2 });
  y += 14;
  for (const r of calcul.rubriques || []) {
    if (r.sousTotal) {
      page.rect(M, y - 11, DROITE - M, 16, FOND);
    }
    const base = typeof r.base === "number" && r.libelle !== "absences" && r.libelle !== "heuresSup" && r.libelle !== "cmu" ? nb(r.base) : r.libelle === "heuresSup" ? `${r.base} h` : r.libelle === "cmu" ? `${r.base} pers.` : "";
    cellule(0, r.code);
    cellule(1, libelleRubrique(r), { bold: r.sousTotal });
    cellule(2, base);
    cellule(3, r.taux !== "" && r.taux != null ? `${String(r.taux).replace(".", ",")} %` : "");
    cellule(4, r.gain ? nb(r.gain) : "", { bold: r.sousTotal });
    cellule(5, r.retenue ? nb(r.retenue) : "");
    cellule(6, r.patronal ? nb(r.patronal) : "", { color: GRIS });
    y += 17;
  }
  page.line(M, y - 8, DROITE, y - 8, { color: LIGNE, width: 1.2 });
  const tGain = (calcul.rubriques || []).filter((r) => !r.sousTotal).reduce((s, r) => s + (r.gain || 0), 0);
  const tRet = (calcul.rubriques || []).reduce((s, r) => s + (r.retenue || 0), 0);
  const tPat = (calcul.rubriques || []).reduce((s, r) => s + (r.patronal || 0), 0);
  y += 6;
  cellule(1, "Totaux", { bold: true });
  cellule(4, nb(tGain), { bold: true });
  cellule(5, nb(tRet), { bold: true });
  cellule(6, nb(tPat), { bold: true, color: GRIS });
  y += 28;

  // Cumuls et net à payer.
  const boiteY = y;
  page.rect(M, boiteY, 250, 92, FOND);
  page.text(`CUMULS DE JANVIER À ${new Date(`${mois}-15T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long" }).toUpperCase()}`, M + 10, boiteY + 16, { size: 7, bold: true, color: GRIS });
  const cum = [
    ["Brut imposable", cumuls.brut],
    ["ITS retenu", cumuls.its],
    ["CNPS salarié", cumuls.cnpsSalarie],
    ["Net payé", cumuls.net],
  ];
  cum.forEach(([l, v], i) => {
    const ly = boiteY + 32 + i * 14;
    page.text(l, M + 10, ly, { size: 8.5, color: GRIS });
    page.text(nb(v || 0), M + 240, ly, { size: 8.5, bold: true, align: "right", color: ENCRE });
  });
  const nx = M + 270;
  page.rect(nx, boiteY, DROITE - nx, 92, FOND_ACCENT);
  page.text("NET À PAYER", nx + 14, boiteY + 20, { size: 9, bold: true, color: ACCENT });
  page.text(`${nb(calcul.net)} F CFA`, nx + 14, boiteY + 46, { size: 20, bold: true, color: ACCENT });
  const lettres = propre(montantEnLettres(Math.max(0, calcul.net)));
  const lignesLettres = [];
  let ligne = "";
  for (const mot of lettres.split(" ")) {
    const essai = ligne ? `${ligne} ${mot}` : mot;
    if (textWidth(essai, 8, false) > DROITE - nx - 28 && ligne) {
      lignesLettres.push(ligne);
      ligne = mot;
    } else ligne = essai;
  }
  lignesLettres.push(ligne);
  lignesLettres.slice(0, 2).forEach((l, i) => page.text(l, nx + 14, boiteY + 64 + i * 11, { size: 8, color: ACCENT }));
  y = boiteY + 118;

  page.text(propre(`Coût total employeur ce mois : ${nb(calcul.coutTotal)} F CFA.`), M, y, { size: 8.5, color: GRIS });
  page.text("Pour vous aider à faire valoir vos droits, conservez ce bulletin sans limitation de durée.", M, y + 13, { size: 8.5, color: GRIS });

  page.line(M, H - 44, DROITE, H - 44, { color: LIGNE });
  page.text(propre(`${entreprise.nom || ""} — bulletin de paie ${mois} — généré par CompanyOS`), M, H - 30, { size: 7.5, color: GRIS });

  return assembler([page], images);
};

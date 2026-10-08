// Le PDF d'une facture, dans le modèle choisi.
//
// Le client reçoit la facture telle que l'éditeur la montre : même
// disposition, même couleur, mêmes blocs (échéancier, montant en lettres,
// moyen de paiement, signature). Le moteur PDF est celui de la Facturation
// (un PDF écrit à la main, sans bibliothèque) ; ce fichier y ajoute les
// modèles et la pagination — une facture de quarante lignes tient sur
// plusieurs pages, en-tête de tableau répété.
//
// Les images (logo, cachet, signature) sont intégrées en JPEG, que le PDF
// sait lire tel quel (filtre DCTDecode) : `images.js` les prépare dans le
// navigateur. Sans elles, les initiales remplacent le logo et le nom du
// signataire, en cursive, la signature. Limite assumée : les polices sont
// celles intégrées à tout lecteur PDF (Helvetica).

import { montantDans } from "../../../utils/monnaie";
import { Page, clip, textWidth } from "../facturation/pdf";
import {
  CONDITIONS,
  FREQUENCES,
  chiffres,
  dateLongue,
  initiales,
  libelleTaxe,
  lignesPaiement,
  montantEnLettres,
  montantsEcheancier,
} from "./domaine";
import { couleurDe, eclaircir, enRgb, modeleDe } from "./modeles";
import { ligneLegale } from "../../entreprise/domaine";

const L = 595.28;
const H = 841.89;
const M = 42;
const DROITE = L - M;

const rgb = (hex) => enRgb(hex).map((v) => v.toFixed(3)).join(" ");
const GRIS = "0.42 0.45 0.50";
const GRIS_CLAIR = "0.88 0.89 0.91";
const ENCRE = "0.07 0.09 0.15";
const BLANC = "1 1 1";
const VERT = "0.09 0.55 0.32";

/// Le PDF lit ses textes en WinAnsi : les espaces fines et le signe moins
/// typographique n'y existent pas.
const propre = (t) => String(t ?? "").replace(/[  ]/g, " ").replace(/−/g, "-");

/// Découpe un texte en lignes qui tiennent dans une largeur.
const couper = (texte, taille, largeur, gras = false) => {
  const lignes = [];
  for (const paragraphe of propre(texte).split("\n")) {
    let ligne = "";
    for (const mot of paragraphe.split(/\s+/)) {
      const essai = ligne ? `${ligne} ${mot}` : mot;
      if (textWidth(essai, taille, gras) > largeur && ligne) {
        lignes.push(ligne);
        ligne = mot;
      } else ligne = essai;
    }
    lignes.push(ligne);
  }
  return lignes;
};

/// Les octets d'une image, en chaîne « un caractère = un octet » comme le
/// reste du fichier.
const enChaine = (octets) => {
  let s = "";
  for (let i = 0; i < octets.length; i += 8192) {
    s += String.fromCharCode.apply(null, octets.subarray(i, i + 8192));
  }
  return s;
};

/// Assemble plusieurs pages en un seul fichier PDF. `images` : les JPEG à
/// déclarer, par nom ({ Logo: { octets, largeur, hauteur } }).
const assembler = (pages, images = {}) => {
  const objets = [];
  const ajouter = (corps) => { objets.push(corps); return objets.length; };
  const catalogue = ajouter(null);
  const arbre = ajouter(null);
  const f1 = ajouter("<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>");
  const f2 = ajouter("<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>");
  const xobjets = Object.entries(images).filter(([, im]) => im?.octets?.length).map(([nom, im]) => {
    const n = ajouter(
      `<</Type/XObject/Subtype/Image/Width ${im.largeur}/Height ${im.hauteur}/ColorSpace/DeviceRGB` +
      `/BitsPerComponent 8/Filter/DCTDecode/Length ${im.octets.length}>>\nstream\n${enChaine(im.octets)}\nendstream`,
    );
    return `/${nom} ${n} 0 R`;
  });
  const ressourcesImages = xobjets.length ? `/XObject<<${xobjets.join("")}>>` : "";
  const enfants = [];
  for (const page of pages) {
    const contenu = page.stream();
    const flux = ajouter(`<</Length ${contenu.length}>>\nstream\n${contenu}\nendstream`);
    enfants.push(ajouter(
      `<</Type/Page/Parent ${arbre} 0 R/MediaBox[0 0 ${L} ${H}]/Contents ${flux} 0 R` +
      `/Resources<</Font<</F1 ${f1} 0 R/F2 ${f2} 0 R>>${ressourcesImages}>>>>`,
    ));
  }
  objets[catalogue - 1] = `<</Type/Catalog/Pages ${arbre} 0 R>>`;
  objets[arbre - 1] = `<</Type/Pages/Kids[${enfants.map((n) => `${n} 0 R`).join(" ")}]/Count ${enfants.length}>>`;

  let pdf = "%PDF-1.4\n";
  const positions = [];
  objets.forEach((corps, i) => {
    positions.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${corps}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (const p of positions) pdf += `${String(p).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size ${objets.length + 1}/Root ${catalogue} 0 R>>\nstartxref\n${xref}\n%%EOF`;

  // Les chaînes sont déjà en WinAnsi (un caractère = un octet) : on les
  // écrit octet par octet, sans réencodage UTF-8.
  const octets = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) octets[i] = pdf.charCodeAt(i) & 255;
  return new Blob([octets], { type: "application/pdf" });
};

/// Le PDF de la facture, dans son modèle.
/// Le cadre d'une image ramenée dans une boîte, proportions gardées.
const ajuster = (im, maxL, maxH) => {
  const r = Math.min(maxL / im.largeur, maxH / im.hauteur);
  return [im.largeur * r, im.hauteur * r];
};

export const factureEnPdf = (f, e = {}, images = {}) => {
  const modele = modeleDe(f.modele).id;
  const hex = couleurDe(f);
  const accent = rgb(hex);
  const accentPale = rgb(eclaircir(hex, 0.92));
  const c = chiffres(f);
  const argent = (n) => propre(montantDans(n, f.devise));
  const nom = e.nom || "Votre entreprise";
  const pages = [];
  let page;
  let y;

  const nouvellePage = () => {
    page = new Page(L, H);
    pages.push(page);
    if (modele === "elegant") page.rect(0, 0, 7, H, accent);
    y = M;
  };

  const texte = (t, x, yy, o = {}) => page.text(propre(t), x, yy, o);
  const cadre = (x, yy, w, h, couleur = GRIS_CLAIR) => {
    page.line(x, yy, x + w, yy, { color: couleur });
    page.line(x, yy + h, x + w, yy + h, { color: couleur });
    page.line(x, yy, x, yy + h, { color: couleur });
    page.line(x + w, yy, x + w, yy + h, { color: couleur });
  };
  const logo = (x, yy, taille) => {
    if (f.afficherLogo === false) return 0;
    if (images.Logo) {
      const [l, h] = ajuster(images.Logo, taille * 1.6, taille);
      page.image("Logo", x, yy + (taille - h) / 2, l, h);
      return l + 12;
    }
    page.rect(x, yy, taille, taille, accent);
    texte(initiales(nom), x, yy + taille / 2 + 4.5, { size: taille * 0.36, bold: true, color: BLANC, align: "center", width: taille });
    return taille + 12;
  };

  nouvellePage();

  // ---- En-tête ---------------------------------------------------------------

  const adresse = [e.adresse, [e.ville, e.pays].filter(Boolean).join(", "), [e.email, e.telephone, e.siteWeb].filter(Boolean).join(" · ")].filter(Boolean);
  const fiscal = [e.ncc && `NCC : ${e.ncc}`, e.rccm && `RCCM : ${e.rccm}`].filter(Boolean).join(" · ");

  if (modele === "bandeau") {
    page.rect(0, 0, L, 92, accent);
    const decal = f.afficherLogo === false ? 0 : 40;
    if (decal && images.Logo) {
      page.rect(M - 4, 24, 40, 40, BLANC);
      const [l, h] = ajuster(images.Logo, 34, 34);
      page.image("Logo", M - 4 + (40 - l) / 2, 24 + (40 - h) / 2, l, h);
    } else if (decal) {
      page.rect(M, 28, 32, 32, BLANC);
      texte(initiales(nom), M, 49, { size: 12, bold: true, color: accent, align: "center", width: 32 });
    }
    texte(clip(nom, 18, true, 300), M + decal, 50, { size: 18, bold: true, color: BLANC });
    texte("FACTURE", DROITE, 46, { size: 20, bold: true, color: BLANC, align: "right" });
    texte(`N° ${f.numero || "-"}`, DROITE, 64, { size: 10, color: BLANC, align: "right" });
    y = 116;
    adresse.forEach((l) => { texte(l, M, y, { size: 8.5, color: GRIS }); y += 12; });
  } else if (modele === "classique") {
    texte("FACTURE", 0, 58, { size: 24, bold: true, color: accent, align: "center", width: L });
    texte(`N° ${f.numero || "-"}`, 0, 76, { size: 10, color: GRIS, align: "center", width: L });
    page.line(M, 92, DROITE, 92, { color: accent, width: 1.2 });
    y = 116;
    const decal = logo(M, y - 12, 34);
    texte(nom, M + decal, y, { size: 14, bold: true, color: ENCRE });
    y += 14;
    [...adresse, fiscal].filter(Boolean).forEach((l) => { texte(l, M + decal, y, { size: 8.5, color: GRIS }); y += 12; });
  } else {
    const decal = logo(M, 36, 42);
    texte(nom, M + decal, 52, { size: 16, bold: true, color: ENCRE });
    y = 66;
    const lignes = modele === "officiel" ? [...adresse, fiscal].filter(Boolean) : adresse;
    lignes.forEach((l) => { texte(l, M + decal, y, { size: 8.5, color: GRIS }); y += 12; });
    const couleurTitre = modele === "moderne" || modele === "minimal" ? ENCRE : accent;
    texte("FACTURE", DROITE, 54, { size: modele === "minimal" ? 26 : 20, bold: true, color: couleurTitre, align: "right" });
    texte(`#${f.numero || "-"}`, DROITE, 72, { size: 10, bold: true, color: accent, align: "right" });
    if (modele === "officiel") cadre(M - 8, 26, L - 2 * M + 16, Math.max(y, 84) - 18, accent);
  }

  // ---- Client et dates ----------------------------------------------------------

  y = Math.max(y, 100) + 22;
  if (modele !== "minimal") page.line(M, y - 12, DROITE, y - 12, { color: GRIS_CLAIR });
  const yInfos = y;
  texte("FACTURÉ À", M, y + 4, { size: 7.5, bold: true, color: GRIS });
  y += 20;
  texte(clip(f.clientEntreprise || f.clientNom || "Client", 11.5, true, 260), M, y, { size: 11.5, bold: true, color: ENCRE });
  y += 14;
  [f.clientEntreprise && f.clientNom ? f.clientNom : null, f.clientVille, f.clientEmail, f.clientTelephone]
    .filter(Boolean)
    .forEach((l) => { texte(clip(l, 9, false, 260), M, y, { size: 9, color: GRIS }); y += 12; });

  let yd = yInfos + 4;
  const condition = CONDITIONS.find((x) => x.id === f.conditions)?.label;
  [["Date de facture", dateLongue(f.date)], ["Échéance", dateLongue(f.echeance)], condition && ["Conditions", condition]]
    .filter(Boolean)
    .forEach(([etiquette, valeur]) => {
      texte(etiquette.toUpperCase(), DROITE - 150, yd, { size: 7.5, bold: true, color: GRIS });
      texte(valeur, DROITE, yd, { size: 9.5, color: ENCRE, align: "right" });
      yd += 16;
    });
  y = Math.max(y, yd) + 18;

  // ---- Tableau des articles ---------------------------------------------------

  const COL = { qte: M + 300, pu: M + 390, taxe: M + 445, montant: DROITE - 10 };
  const enteteTableau = () => {
    const styles = {
      moderne: { fond: ENCRE, texte: BLANC },
      bandeau: { fond: accent, texte: BLANC },
      officiel: { fond: accent, texte: BLANC },
      elegant: { fond: accentPale, texte: accent },
      classique: { fond: accentPale, texte: accent },
      minimal: { fond: null, texte: ENCRE },
    }[modele];
    if (styles.fond) page.rect(M, y, DROITE - M, 24, styles.fond);
    else page.line(M, y + 24, DROITE, y + 24, { color: ENCRE, width: 1 });
    const o = { size: 8.5, bold: true, color: styles.texte };
    texte("Article", M + 10, y + 15.5, o);
    texte("Quantité", COL.qte, y + 15.5, { ...o, align: "right" });
    texte("Prix unitaire", COL.pu, y + 15.5, { ...o, align: "right" });
    texte("Taxe", COL.taxe, y + 15.5, { ...o, align: "right" });
    texte("Montant", COL.montant, y + 15.5, { ...o, align: "right" });
    y += 24;
  };
  enteteTableau();

  const articles = f.lignes.filter((l) => String(l.designation || "").trim() || Number(l.pu));
  for (const l of articles) {
    const haut = l.description ? 32 : 24;
    if (y + haut > H - 70) {
      nouvellePage();
      y = M + 10;
      enteteTableau();
    }
    texte(clip(l.designation || "Article", 9.5, true, 240), M + 10, y + 15, { size: 9.5, bold: true, color: ENCRE });
    if (l.description) texte(clip(l.description, 8, false, 240), M + 10, y + 26, { size: 8, color: GRIS });
    const o = { size: 9, color: ENCRE, align: "right" };
    texte(String(Number(l.qte) || 0), COL.qte, y + 15, o);
    texte(argent(l.pu), COL.pu, y + 15, o);
    texte(`${Number(l.tva) || 0} %`, COL.taxe, y + 15, o);
    texte(argent((Number(l.qte) || 0) * (Number(l.pu) || 0)), COL.montant, y + 15, { ...o, bold: true });
    y += haut;
    page.line(M, y, DROITE, y, { color: modele === "classique" || modele === "officiel" ? accentPale : GRIS_CLAIR });
  }

  // ---- Récapitulatif ------------------------------------------------------------

  const echeances = f.mode === "fractionne" ? montantsEcheancier(f.echeancier, c.total) : [];
  const hauteurRecap = 110 + echeances.length * 14 + 90;
  if (y + hauteurRecap > H - 40) { nouvellePage(); y = M + 10; }
  y += 18;
  const yRecap = y;

  const totaux = [
    ["Sous-total", argent(c.sousTotal)],
    [libelleTaxe(c.parTaux), argent(c.tva)],
    [`Remise${Number(f.remise) ? ` (${f.remise} %)` : ""}`, `-${argent(c.remise)}`, VERT],
    ["Livraison", argent(c.livraison)],
  ];
  for (const [etiquette, valeur, couleur] of totaux) {
    texte(etiquette, DROITE - 190, y, { size: 9, color: GRIS });
    texte(valeur, DROITE, y, { size: 9.5, bold: true, color: couleur || ENCRE, align: "right" });
    y += 17;
  }

  let yg = yRecap;
  if (echeances.length) {
    texte("ÉCHÉANCIER DE PAIEMENT", M, yg, { size: 7.5, bold: true, color: GRIS });
    yg += 15;
    for (const x of echeances) {
      texte(clip(`${x.libelle || "Échéance"} · ${Number(x.pourcentage) || 0} %`, 8.5, false, 150), M, yg, { size: 8.5, color: ENCRE });
      texte(dateLongue(x.date), M + 160, yg, { size: 8.5, color: GRIS });
      texte(argent(x.montant), M + 280, yg, { size: 8.5, bold: true, color: ENCRE, align: "right" });
      yg += 14;
    }
  }
  if (f.mode === "recurrente") {
    const freq = FREQUENCES.find((x) => x.id === f.recurrence?.frequence)?.label.toLowerCase() || "chaque mois";
    texte(`Facture récurrente · ${freq}${f.recurrence?.fin ? `, jusqu'au ${dateLongue(f.recurrence.fin)}` : ""}`, M, yg + 4, { size: 8.5, color: accent });
    yg += 18;
  }
  y = Math.max(y, yg) + 8;

  // ---- Total ----------------------------------------------------------------------

  if (modele === "minimal") {
    page.line(M, y, DROITE, y, { color: ENCRE, width: 1 });
    texte("Montant total", M, y + 26, { size: 11, color: GRIS });
    texte(argent(c.total), DROITE, y + 28, { size: 20, bold: true, color: ENCRE, align: "right" });
    y += 44;
  } else {
    const plein = modele === "bandeau" || modele === "officiel";
    page.rect(M, y, DROITE - M, 34, plein ? accent : accentPale);
    texte("Montant total", M + 14, y + 21.5, { size: 10, bold: true, color: plein ? BLANC : ENCRE });
    texte(argent(c.total), DROITE - 14, y + 23, { size: 15, bold: true, color: plein ? BLANC : ENCRE, align: "right" });
    y += 50;
  }

  if (f.montantEnLettres !== false) {
    for (const ligne of couper(`Arrêtée la présente facture à la somme de : ${montantEnLettres(c.total, f.devise)}.`, 8.5, DROITE - M)) {
      texte(ligne, M, y, { size: 8.5, color: ENCRE });
      y += 12;
    }
    y += 6;
  }

  // ---- Pied : paiement, notes, signature -------------------------------------------

  if (y > H - 150) { nouvellePage(); y = M + 10; }
  y += 8;
  const yPied = y;
  texte("Moyen de paiement", M, y, { size: 9, bold: true, color: ENCRE });
  y += 14;
  for (const l of lignesPaiement(f.moyenPaiement, e)) {
    texte(clip(l, 8.5, false, 230), M, y, { size: 8.5, color: GRIS });
    y += 12;
  }

  let yn = yPied;
  const xNotes = M + 270;
  if (f.notes) {
    texte("Notes", xNotes, yn, { size: 9, bold: true, color: ENCRE });
    yn += 14;
    for (const l of couper(f.notes, 8.5, DROITE - xNotes).slice(0, 6)) {
      texte(l, xNotes, yn, { size: 8.5, color: GRIS });
      yn += 12;
    }
  }
  if (f.afficherSignature !== false) {
    const centre = xNotes + 110;
    yn += 10;
    // Le cachet se pose à gauche de la signature : un JPEG n'a pas de
    // transparence, superposés ils se masqueraient l'un l'autre.
    if (images.Cachet) {
      const [l, h] = ajuster(images.Cachet, 74, 74);
      page.image("Cachet", centre - 68 - l, yn - 8, l, h);
    }
    if (images.Signature) {
      const [l, h] = ajuster(images.Signature, 130, 46);
      page.image("Signature", centre - l / 2, yn + 46 - h, l, h);
      yn += 50;
    } else {
      const signe = propre(e.signataire || e.titulaire || nom);
      yn += 30;
      texte(signe, centre - textWidth(signe, 15, true) / 2, yn, { size: 15, bold: true, color: accent });
      yn += 8;
    }
    page.line(xNotes + 40, yn, xNotes + 180, yn, { color: GRIS_CLAIR });
    texte("Signature autorisée", centre - textWidth("Signature autorisée", 8, true) / 2, yn + 13, { size: 8, bold: true, color: ENCRE });
    const qui = [e.signataire, e.fonctionSignataire].filter(Boolean).join(", ");
    if (qui) texte(clip(qui, 8, false, 200), centre - Math.min(200, textWidth(propre(qui), 8, false)) / 2, yn + 25, { size: 8, color: GRIS });
  }

  // ---- Mentions légales, et numéro de page ----------------------------------------

  const mentions = [ligneLegale(e), e.mentions, modele === "officiel" || modele === "classique" ? null : fiscal].filter(Boolean).join(" — ");
  pages.forEach((p, i) => {
    page = p;
    if (mentions) texte(clip(mentions, 7.5, false, L - 2 * M), 0, H - 26, { size: 7.5, color: GRIS, align: "center", width: L });
    if (pages.length > 1) texte(`${f.numero || ""} · page ${i + 1}/${pages.length}`, DROITE, H - 14, { size: 7, color: GRIS, align: "right" });
  });

  return assembler(pages, images);
};

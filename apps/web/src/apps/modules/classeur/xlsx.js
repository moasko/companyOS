// Classeur — lecture et écriture du format .xlsx.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI À LA MAIN
//
// Un `.xlsx` est un zip d'XML, pas un format binaire : SheetJS pèse
// 900 Ko pour lire et écrire ce que nous produisons nous-mêmes en une
// page. L'OS embarque déjà JSZip (le module Présentations s'en sert) —
// c'est tout ce qu'il faut.
//
// On n'écrit ni ne lit *tout* OOXML : on couvre ce que le Classeur sait
// représenter (valeurs, formats de nombre, gras, italique, souligné,
// alignement, couleurs, largeurs de colonnes, plusieurs feuilles). À la
// lecture, ce qu'on ne comprend pas est ignoré plutôt que de faire échouer
// l'ouverture : mieux vaut un classeur sans ses bordures que pas de
// classeur du tout.
//
// LES PIÈGES DU FORMAT, ET CE QU'ON EN FAIT
//
//   • Les chaînes vivent d'ordinaire dans une table partagée
//     (`sharedStrings.xml`). À l'écriture on emploie des chaînes
//     **en ligne** (`t="inlineStr"`) : c'est valide, Excel les lit, et
//     cela supprime un fichier et toute une indirection. À la lecture, en
//     revanche, il faut savoir gérer les deux — les fichiers reçus
//     utilisent presque toujours la table partagée.
//   • Une date Excel est un **nombre** de jours depuis le 1900-01-01, avec
//     un décalage hérité d'un bug de Lotus 1-2-3 : 1900 y est bissextile,
//     ce qu'elle n'est pas. D'où le 25569 de la conversion.
//   • Les références de cellules (`r="B12"`) peuvent sauter des colonnes
//     vides : on ne peut pas se contenter de compter les balises.
// ─────────────────────────────────────────────────────────────────────────

import JSZip from "jszip";
import { estFormule, nomDeFeuilleValide, repereColonne, valeurCalculee, versNombre } from "./domaine";

// Échappe le XML et retire les caractères de contrôle, qui rendraient le
// fichier invalide — Excel refuse alors le classeur entier sans expliquer
// pourquoi. Écrit en boucle plutôt qu'en expression régulière : une plage
// de caractères de contrôle dans une source est illisible et fragile.
const echapper = (valeur) => {
  let out = "";
  for (const c of String(valeur ?? "")) {
    const code = c.codePointAt(0);
    const controle = code < 9 || code === 11 || code === 12 || (code > 13 && code < 32);
    if (controle) continue;
    if (c === "&") out += "&amp;";
    else if (c === "<") out += "&lt;";
    else if (c === ">") out += "&gt;";
    else if (c === '"') out += "&quot;";
    else out += c;
  }
  return out;
};

const EN_TETE = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/// Nos formats de nombre, traduits en codes OOXML. Les identifiants au-delà
/// de 163 sont réservés aux formats personnalisés.
const NUM_FMT = {
  entier: { id: 164, code: "#,##0" },
  nombre: { id: 165, code: "#,##0.00" },
  monnaie: { id: 166, code: '#,##0\\ "F"' },
  pourcent: { id: 167, code: "0.0%" },
  date: { id: 168, code: "dd/mm/yyyy" },
  texte: { id: 49, code: null }, // 49 = @, le format « texte » intégré
};

const couleurXml = (hex) =>
  hex ? ` <color rgb="FF${String(hex).replace("#", "").toUpperCase()}"/>` : "";

/// Rassemble les styles distincts du classeur et rend de quoi écrire
/// `styles.xml`, plus une table style → index.
const collecterStyles = (feuilles) => {
  const cles = new Map(); // clé JSON → index
  const liste = [];

  const cle = (s) =>
    JSON.stringify({
      g: !!s?.gras, i: !!s?.italique, u: !!s?.souligne,
      a: s?.align || "", f: s?.format || "auto",
      ct: s?.couleurTexte || "", cf: s?.couleurFond || "",
    });

  // L'index 0 est le style par défaut, exigé par le format.
  cles.set(cle(null), 0);
  liste.push(null);

  for (const f of feuilles) {
    for (const ligne of f.cellules) {
      for (const c of ligne) {
        if (!c?.s) continue;
        const k = cle(c.s);
        if (!cles.has(k)) {
          cles.set(k, liste.length);
          liste.push(c.s);
        }
      }
    }
  }
  return { cles, liste, indexDe: (s) => cles.get(cle(s)) ?? 0 };
};

const stylesXml = (liste) => {
  const formats = [...new Set(liste.map((s) => s?.format).filter((f) => f && NUM_FMT[f]?.code))];
  const numFmts = formats.length
    ? `<numFmts count="${formats.length}">${formats
        .map((f) => `<numFmt numFmtId="${NUM_FMT[f].id}" formatCode="${echapper(NUM_FMT[f].code)}"/>`)
        .join("")}</numFmts>`
    : "";

  const fonts = liste
    .map(
      (s) =>
        `<font><sz val="11"/><name val="Calibri"/>${s?.gras ? "<b/>" : ""}${
          s?.italique ? "<i/>" : ""
        }${s?.souligne ? "<u/>" : ""}${couleurXml(s?.couleurTexte)}</font>`,
    )
    .join("");

  // Les deux premiers remplissages sont imposés par le format : « aucun »
  // et « gris 125 ». Les nôtres commencent donc à l'indice 2.
  const remplissages = liste.map((s) => s?.couleurFond).filter(Boolean);
  const fills =
    `<fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    remplissages
      .map(
        (c) =>
          `<fill><patternFill patternType="solid"><fgColor rgb="FF${String(c)
            .replace("#", "")
            .toUpperCase()}"/><bgColor indexed="64"/></patternFill></fill>`,
      )
      .join("");

  let remplissageSuivant = 2;
  const xfs = liste
    .map((s, i) => {
      const fmt = s?.format && NUM_FMT[s.format] ? NUM_FMT[s.format].id : 0;
      const fill = s?.couleurFond ? remplissageSuivant++ : 0;
      const align = s?.align
        ? ` applyAlignment="1"><alignment horizontal="${s.align}"/></xf`
        : "/";
      return `<xf numFmtId="${fmt}" fontId="${i}" fillId="${fill}" borderId="0" xfId="0" applyFont="1"${
        fmt ? ' applyNumberFormat="1"' : ""
      }${s?.couleurFond ? ' applyFill="1"' : ""}${align}>`;
    })
    .join("");

  return `${EN_TETE}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
${numFmts}
<fonts count="${liste.length}">${fonts}</fonts>
<fills count="${2 + remplissages.length}">${fills}</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${liste.length}">${xfs}</cellXfs>
</styleSheet>`;
};

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

const feuilleXml = (feuille, indexDe) => {
  const cellules = feuille.cellules;
  const largeurs = Object.entries(feuille.largeurs || {})
    .map(([c, px]) =>
      // La largeur d'Excel se compte en caractères, pas en pixels : le
      // rapport approché est 7 px par caractère plus 5 px de marge.
      `<col min="${Number(c) + 1}" max="${Number(c) + 1}" width="${
        Math.round(((px - 5) / 7) * 100) / 100
      }" customWidth="1"/>`,
    )
    .join("");

  const lignes = cellules
    .map((ligne, i) => {
      const cases = ligne
        .map((cel, j) => {
          const valeur = valeurCalculee(cellules, i, j);
          const style = indexDe(cel?.s);
          if ((valeur === "" || valeur === undefined) && !style) return "";
          const ref = `${repereColonne(j)}${i + 1}`;
          const attrs = `r="${ref}"${style ? ` s="${style}"` : ""}`;
          if (valeur === "" || valeur === undefined) return `<c ${attrs}/>`;

          const n = versNombre(valeur);
          // Un identifiant comme « 00123 » ou un numéro de téléphone doit
          // rester du texte : le convertir en nombre perdrait ses zéros.
          const estVraimentUnNombre =
            n !== null && String(valeur).trim() === String(n) && !/^0\d/.test(String(valeur).trim());

          if (estVraimentUnNombre) {
            // La formule est écrite **avec** son résultat en cache : Excel
            // affiche la valeur sans recalculer, et le calcul reste
            // modifiable.
            const f = estFormule(cel.v)
              ? `<f>${echapper(cel.v.slice(1).replace(/;/g, ","))}</f>`
              : "";
            return `<c ${attrs}>${f}<v>${n}</v></c>`;
          }
          return `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${echapper(valeur)}</t></is></c>`;
        })
        .join("");
      return cases ? `<row r="${i + 1}">${cases}</row>` : "";
    })
    .join("");

  const fige = feuille.figees?.lignes || feuille.figees?.colonnes
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${feuille.figees.lignes || 0}" xSplit="${
        feuille.figees.colonnes || 0
      }" topLeftCell="${repereColonne(feuille.figees.colonnes || 0)}${
        (feuille.figees.lignes || 0) + 1
      }" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`
    : "";

  return `${EN_TETE}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
${fige}
${largeurs ? `<cols>${largeurs}</cols>` : ""}
<sheetData>${lignes}</sheetData>
</worksheet>`;
};

/// Produit le blob `.xlsx` d'un classeur.
export const versXlsx = async (classeur) => {
  const zip = new JSZip();
  const feuilles = classeur.feuilles.length ? classeur.feuilles : [];
  const { liste, indexDe } = collecterStyles(feuilles);

  zip.file(
    "[Content_Types].xml",
    `${EN_TETE}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${feuilles
  .map(
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join("")}
</Types>`,
  );

  zip.file(
    "_rels/.rels",
    `${EN_TETE}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );

  zip.file(
    "xl/workbook.xml",
    `${EN_TETE}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${feuilles
      .map(
        (f, i) =>
          `<sheet name="${echapper(nomDeFeuilleValide(f.nom))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join("")}</sheets>
</workbook>`,
  );

  zip.file(
    "xl/_rels/workbook.xml.rels",
    `${EN_TETE}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${feuilles
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join("")}
<Relationship Id="rId${feuilles.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );

  zip.file("xl/styles.xml", stylesXml(liste));
  feuilles.forEach((f, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, feuilleXml(f, indexDe)));

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    compression: "DEFLATE",
  });
};

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

const refVersIndices = (ref) => {
  const m = /^([A-Z]+)(\d+)$/.exec(String(ref).toUpperCase());
  if (!m) return null;
  let c = 0;
  for (const car of m[1]) c = c * 26 + (car.charCodeAt(0) - 64);
  return { l: Number(m[2]) - 1, c: c - 1 };
};

/// Le nombre de série d'Excel en date ISO.
///
/// L'origine est le 30 décembre 1899 et non le 1er janvier 1900 : Excel
/// traite 1900 comme bissextile — un bug hérité de Lotus 1-2-3, conservé
/// depuis pour compatibilité. 25569 est l'écart avec l'époque Unix.
const serieVersDate = (n) => {
  const ms = (Number(n) - 25569) * 86400 * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? String(n) : d.toISOString().slice(0, 10);
};

const texteDe = (noeud) =>
  noeud ? [...noeud.getElementsByTagName("t")].map((t) => t.textContent).join("") : "";

/// Lit un `.xlsx` et rend un classeur.
export const depuisXlsx = async (blob, titre = "Classeur") => {
  const zip = await JSZip.loadAsync(blob);
  const lire = async (chemin) => {
    const f = zip.file(chemin);
    return f ? f.async("string") : null;
  };
  const xml = (s) => new DOMParser().parseFromString(s, "application/xml");

  const wbTexte = await lire("xl/workbook.xml");
  if (!wbTexte) throw new Error("Ce fichier n'est pas un classeur Excel.");
  const wb = xml(wbTexte);

  // Les relations disent quel fichier porte quelle feuille : l'ordre des
  // `<sheet>` ne suffit pas, un classeur peut avoir sheet3.xml en premier.
  const relsTexte = await lire("xl/_rels/workbook.xml.rels");
  const cibles = new Map();
  if (relsTexte) {
    for (const r of xml(relsTexte).getElementsByTagName("Relationship")) {
      cibles.set(r.getAttribute("Id"), r.getAttribute("Target").replace(/^\/?xl\//, ""));
    }
  }

  // Table des chaînes partagées.
  const ssTexte = await lire("xl/sharedStrings.xml");
  const partagees = ssTexte
    ? [...xml(ssTexte).getElementsByTagName("si")].map((si) => texteDe(si))
    : [];

  // Les styles.
  //
  // On relit ce qu'on sait représenter : format de nombre, gras, italique,
  // souligné, couleur du texte, couleur de fond, alignement. Le reste
  // (bordures, polices, rotations) est ignoré — un classeur sans ses
  // bordures vaut mieux qu'un classeur qui refuse de s'ouvrir.
  //
  // La date mérite une attention particulière : sans elle, une date arrive
  // comme « 45678 » et plus personne ne la reconnaît.
  const stTexte = await lire("xl/styles.xml");
  const styles = new Map(); // index de cellXfs → notre objet de style
  const stylesDate = new Set();

  if (stTexte) {
    const st = xml(stTexte);

    const perso = new Map();
    for (const nf of st.getElementsByTagName("numFmt")) {
      perso.set(nf.getAttribute("numFmtId"), nf.getAttribute("formatCode") || "");
    }

    /// Le code d'un format vers l'un des nôtres. On lit d'abord le code
    /// écrit, pas l'identifiant : un fichier venu d'Excel numérote ses
    /// formats personnalisés comme il veut.
    const formatDe = (id, code) => {
      if (["14", "15", "16", "17", "22"].includes(id) || /[dmy]{2}/i.test(code)) return "date";
      if (id === "9" || id === "10" || code.includes("%")) return "pourcent";
      if (id === "49" || code === "@") return "texte";
      // Un symbole monétaire, ou notre propre code d'export.
      if (/["']\s*[A-Z€$£]/i.test(code) || /€|\$|F CFA|XOF/.test(code)) return "monnaie";
      if (code.includes("0.00") || code.includes("0,00")) return "nombre";
      if (id === "1" || code === "#,##0" || code === "0") return "entier";
      return null;
    };

    const hex = (el) => {
      const rgb = el?.getAttribute("rgb");
      // Les couleurs OOXML s'écrivent AARRGGBB : on jette l'alpha.
      return rgb && rgb.length === 8 ? rgb.slice(2).toUpperCase() : null;
    };

    const polices = [...(st.getElementsByTagName("fonts")[0]?.getElementsByTagName("font") || [])].map(
      (f) => ({
        gras: !!f.getElementsByTagName("b").length,
        italique: !!f.getElementsByTagName("i").length,
        souligne: !!f.getElementsByTagName("u").length,
        couleurTexte: hex(f.getElementsByTagName("color")[0]),
      }),
    );

    const remplissages = [...(st.getElementsByTagName("fills")[0]?.getElementsByTagName("fill") || [])].map(
      (f) => {
        const motif = f.getElementsByTagName("patternFill")[0];
        if (!motif || motif.getAttribute("patternType") !== "solid") return null;
        return hex(motif.getElementsByTagName("fgColor")[0]);
      },
    );

    const xfs = st.getElementsByTagName("cellXfs")[0]?.getElementsByTagName("xf") || [];
    [...xfs].forEach((xf, i) => {
      const id = xf.getAttribute("numFmtId") || "0";
      const code = perso.get(id) || "";
      const s = {};

      const format = formatDe(id, code);
      if (format) s.format = format;
      if (format === "date") stylesDate.add(i);

      const police = polices[Number(xf.getAttribute("fontId") || 0)];
      if (police?.gras) s.gras = true;
      if (police?.italique) s.italique = true;
      if (police?.souligne) s.souligne = true;
      // Le noir est la couleur par défaut : la porter en style ferait
      // grossir le classeur sans rien changer à l'écran.
      if (police?.couleurTexte && police.couleurTexte !== "000000") {
        s.couleurTexte = police.couleurTexte;
      }

      const fond = remplissages[Number(xf.getAttribute("fillId") || 0)];
      if (fond && fond !== "FFFFFF") s.couleurFond = fond;

      const align = xf.getElementsByTagName("alignment")[0]?.getAttribute("horizontal");
      if (align === "center" || align === "right") s.align = align;

      if (Object.keys(s).length) styles.set(i, s);
    });
  }

  const feuilles = [];
  for (const s of wb.getElementsByTagName("sheet")) {
    const nom = s.getAttribute("name") || `Feuille ${feuilles.length + 1}`;
    const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const cible = cibles.get(rid) || `worksheets/sheet${feuilles.length + 1}.xml`;
    const texte = await lire(`xl/${cible}`);
    if (!texte) continue;

    const doc = xml(texte);
    const brut = [];
    let maxL = 0;
    let maxC = 0;

    for (const c of doc.getElementsByTagName("c")) {
      const pos = refVersIndices(c.getAttribute("r"));
      if (!pos) continue;
      const type = c.getAttribute("t");
      const styleIndex = Number(c.getAttribute("s") || 0);
      let valeur = "";

      if (type === "inlineStr") valeur = texteDe(c.getElementsByTagName("is")[0]);
      else if (type === "s") valeur = partagees[Number(c.getElementsByTagName("v")[0]?.textContent)] ?? "";
      else if (type === "str") valeur = c.getElementsByTagName("v")[0]?.textContent ?? "";
      else {
        const v = c.getElementsByTagName("v")[0]?.textContent;
        if (v === undefined) valeur = "";
        else valeur = stylesDate.has(styleIndex) ? serieVersDate(v) : v;
      }

      // Une formule présente dans le fichier reprend sa forme éditable ;
      // Excel sépare les arguments par une virgule, nous par un
      // point-virgule.
      const f = c.getElementsByTagName("f")[0]?.textContent;
      if (f) valeur = `=${f.replace(/,/g, ";")}`;

      if (valeur === "") continue;
      brut.push({ ...pos, valeur, style: styles.get(styleIndex) || null });
      maxL = Math.max(maxL, pos.l);
      maxC = Math.max(maxC, pos.c);
    }

    const L = Math.max(maxL + 1, 20);
    const C = Math.max(maxC + 1, 8);
    const cellules = Array.from({ length: L }, () => Array.from({ length: C }, () => ({ v: "" })));
    for (const b of brut) {
      cellules[b.l][b.c] = b.style ? { v: b.valeur, s: { ...b.style } } : { v: b.valeur };
    }

    const largeurs = {};
    for (const col of doc.getElementsByTagName("col")) {
      const min = Number(col.getAttribute("min")) - 1;
      const max = Number(col.getAttribute("max")) - 1;
      const px = Math.round(Number(col.getAttribute("width") || 10) * 7 + 5);
      for (let j = min; j <= max && j < C; j += 1) largeurs[j] = px;
    }

    feuilles.push({ nom, cellules, largeurs, figees: { lignes: 0, colonnes: 0 } });
  }

  if (!feuilles.length) throw new Error("Ce classeur ne contient aucune feuille lisible.");
  return { titre, feuilles, version: 1 };
};

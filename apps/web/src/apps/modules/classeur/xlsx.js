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
import { estFormule, nomDeFeuilleValide, repereColonne, valeurCalculeeClasseur, versNombre } from "./domaine.js";
import { depuisExcel, versExcel } from "../tableur/formules.js";

const MAX_LIGNES_IMPORTEES = 10000;
const MAX_COLONNES_IMPORTEES = 702; // A → ZZ, capacité actuelle du Classeur

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
      g: !!s?.gras, i: !!s?.italique, u: !!s?.souligne, b: !!s?.barre,
      a: s?.align || "", f: s?.format || "auto",
      ct: s?.couleurTexte || "", cf: s?.couleurFond || "",
      p: s?.police || "", t: Number(s?.taille) || 0, w: !!s?.wrap,
      d: Number.isInteger(s?.decimales) ? s.decimales : null,
      bo: s?.bordures || s?.bordure || null,
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
        `<font><sz val="${Number(s?.taille) || 11}"/><name val="${echapper(s?.police || "Calibri")}"/>${s?.gras ? "<b/>" : ""}${
          s?.italique ? "<i/>" : ""
        }${s?.souligne ? "<u/>" : ""}${s?.barre ? "<strike/>" : ""}${couleurXml(s?.couleurTexte)}</font>`,
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

  const clesBordures = new Map([["", 0]]);
  const listeBordures = [null];
  for (const s of liste) {
    const definition = s?.bordures || (s?.bordure === "all"
      ? Object.fromEntries(["top", "right", "bottom", "left"].map((cote) => [cote, { style: "thin", couleur: "808080" }]))
      : null);
    const cle = definition ? JSON.stringify(definition) : "";
    if (!clesBordures.has(cle)) {
      clesBordures.set(cle, listeBordures.length);
      listeBordures.push(definition);
    }
  }
  const coteXml = (nom, cote) => cote
    ? `<${nom} style="${echapper(cote.style || "thin")}"><color rgb="FF${String(cote.couleur || "808080").replace("#", "").toUpperCase()}"/></${nom}>`
    : `<${nom}/>`;
  const borders = listeBordures.map((bordure) => bordure
    ? `<border>${coteXml("left", bordure.left)}${coteXml("right", bordure.right)}${coteXml("top", bordure.top)}${coteXml("bottom", bordure.bottom)}<diagonal/></border>`
    : "<border><left/><right/><top/><bottom/><diagonal/></border>").join("");

  let remplissageSuivant = 2;
  const xfs = liste
    .map((s, i) => {
      const fmt = s?.format && NUM_FMT[s.format] ? NUM_FMT[s.format].id : 0;
      const fill = s?.couleurFond ? remplissageSuivant++ : 0;
      const definitionBordure = s?.bordures || (s?.bordure === "all"
        ? Object.fromEntries(["top", "right", "bottom", "left"].map((cote) => [cote, { style: "thin", couleur: "808080" }]))
        : null);
      const border = clesBordures.get(definitionBordure ? JSON.stringify(definitionBordure) : "") || 0;
      const align = s?.align || s?.wrap
        ? ` applyAlignment="1"><alignment${s?.align ? ` horizontal="${s.align}"` : ""}${s?.wrap ? ' wrapText="1"' : ""}/></xf`
        : "/";
      return `<xf numFmtId="${fmt}" fontId="${i}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1"${
        fmt ? ' applyNumberFormat="1"' : ""
      }${s?.couleurFond ? ' applyFill="1"' : ""}${border ? ' applyBorder="1"' : ""}${align}>`;
    })
    .join("");

  return `${EN_TETE}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
${numFmts}
<fonts count="${liste.length}">${fonts}</fonts>
<fills count="${2 + remplissages.length}">${fills}</fills>
<borders count="${listeBordures.length}">${borders}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${liste.length}">${xfs}</cellXfs>
</styleSheet>`;
};

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

const liensDeFeuille = (feuille) => feuille.cellules.flatMap((ligne, l) => ligne.flatMap((cel, c) =>
  typeof cel?.href === "string" && cel.href ? [{ l, c, href: cel.href }] : []));
const commentairesDeFeuille = (feuille) => feuille.cellules.flatMap((ligne, l) => ligne.flatMap((cel, c) =>
  typeof cel?.commentaire === "string" && cel.commentaire ? [{ l, c, texte: cel.commentaire }] : []));

const feuilleXml = (feuille, indexDe, classeur, iFeuille) => {
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
  const colonnesMasquees = new Set(feuille.colonnesMasquees || []);
  const colonnesXml = Object.entries(feuille.largeurs || {}).map(([c, px]) => {
    const index = Number(c);
    return `<col min="${index + 1}" max="${index + 1}" width="${
      Math.round(((px - 5) / 7) * 100) / 100
    }" customWidth="1"${colonnesMasquees.has(index) ? ' hidden="1"' : ""}/>`;
  }).join("") + [...colonnesMasquees]
    .filter((c) => feuille.largeurs?.[c] === undefined)
    .map((c) => `<col min="${c + 1}" max="${c + 1}" hidden="1"/>`).join("");

  const lignes = cellules
    .map((ligne, i) => {
      const cases = ligne
        .map((cel, j) => {
          const valeur = valeurCalculeeClasseur(classeur, iFeuille, i, j);
          const formuleSource = cel?.f || (estFormule(cel?.v) ? cel.v : "");
          const style = indexDe(cel?.s);
          if ((valeur === "" || valeur === undefined) && !style && !formuleSource) return "";
          const ref = `${repereColonne(j)}${i + 1}`;
          const attrs = `r="${ref}"${style ? ` s="${style}"` : ""}`;
          // Dans le fichier, une formule s'écrit à l'anglaise (SUM, virgules,
          // point décimal) : c'est Excel qui la remet en français à
          // l'affichage. Écrire « SOMME » donnait #NOM? au premier recalcul.
          // Une formule illisible part sans <f> : sa valeur suffit.
          const formuleExcel = formuleSource ? versExcel(formuleSource) : null;
          const formuleXml = formuleExcel ? `<f>${echapper(formuleExcel)}</f>` : "";
          if (valeur === "" || valeur === undefined) return `<c ${attrs}>${formuleXml}</c>`;
          if (cel?.type === "checkbox") {
            return `<c ${attrs} t="b"><v>${String(cel.v).toUpperCase() === "TRUE" ? 1 : 0}</v></c>`;
          }

          // VRAI / FAUX calculés : de vrais booléens pour Excel.
          if (formuleXml && (valeur === "VRAI" || valeur === "FAUX")) {
            return `<c ${attrs} t="b">${formuleXml}<v>${valeur === "VRAI" ? 1 : 0}</v></c>`;
          }
          // Une date au format Date : le numéro de série qu'Excel attend.
          const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valeur));
          if (iso && cel?.s?.format === "date") {
            const serie = (Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) - Date.UTC(1899, 11, 30)) / 86400000;
            return `<c ${attrs}>${formuleXml}<v>${serie}</v></c>`;
          }

          const n = versNombre(valeur);
          // Un identifiant comme « 00123 » ou un numéro de téléphone doit
          // rester du texte : le convertir en nombre perdrait ses zéros.
          const estVraimentUnNombre =
            n !== null && String(valeur).trim() === String(n) && !/^0\d/.test(String(valeur).trim());

          if (estVraimentUnNombre) {
            // La formule est écrite **avec** son résultat en cache : Excel
            // affiche la valeur sans recalculer, et le calcul reste
            // modifiable.
            return `<c ${attrs}>${formuleXml}<v>${n}</v></c>`;
          }
          if (formuleSource) return `<c ${attrs} t="str">${formuleXml}<v>${echapper(valeur)}</v></c>`;
          return `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${echapper(valeur)}</t></is></c>`;
        })
        .join("");
      const hauteur = feuille.hauteurs?.[i];
      const masquee = feuille.lignesMasquees?.includes(i);
      const attrs = `${hauteur ? ` ht="${Math.round(hauteur * 0.75 * 100) / 100}" customHeight="1"` : ""}${masquee ? ` hidden="1"` : ""}`;
      return cases || hauteur || masquee ? `<row r="${i + 1}"${attrs}>${cases}</row>` : "";
    })
    .join("");

  const fige = feuille.figees?.lignes || feuille.figees?.colonnes
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${feuille.figees.lignes || 0}" xSplit="${
        feuille.figees.colonnes || 0
      }" topLeftCell="${repereColonne(feuille.figees.colonnes || 0)}${
        (feuille.figees.lignes || 0) + 1
      }" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`
    : "";
  const fusions = (feuille.fusions || []).map((f) =>
    `<mergeCell ref="${repereColonne(f.c1)}${f.l1 + 1}:${repereColonne(f.c2)}${f.l2 + 1}"/>`).join("");
  const validations = cellules.flatMap((ligne, l) => ligne.flatMap((cel, c) => {
    if (cel?.validation?.type !== "liste") return [];
    const source = cel.validation.source;
    const formule = source?.feuille && source?.plage
      ? `'${String(source.feuille).replace(/'/g, "''")}'!$${repereColonne(source.plage.c1)}$${source.plage.l1 + 1}:$${repereColonne(source.plage.c2)}$${source.plage.l2 + 1}`
      : cel.validation.options?.length ? `"${cel.validation.options.join(",")}"` : "";
    return formule
      ? [`<dataValidation type="list" allowBlank="1" sqref="${repereColonne(c)}${l + 1}"><formula1>${echapper(formule)}</formula1></dataValidation>`]
      : [];
  })).join("");
  const filtres = feuille.filtres || [];
  const filtreXml = filtres.length ? `<autoFilter ref="${repereColonne(Math.min(...filtres.map((f) => f.c)))}${Math.min(...filtres.map((f) => f.entete)) + 1}:${repereColonne(Math.max(...filtres.map((f) => f.c)))}${Math.max(...filtres.map((f) => f.l2)) + 1}"/>` : "";
  let relationLien = 0;
  const liensXml = liensDeFeuille(feuille).map((lien) => {
    const ref = `${repereColonne(lien.c)}${lien.l + 1}`;
    if (lien.href.startsWith("#")) return `<hyperlink ref="${ref}" location="${echapper(lien.href.slice(1))}"/>`;
    relationLien += 1;
    return `<hyperlink ref="${ref}" r:id="rIdLien${relationLien}"/>`;
  }).join("");
  const aCommentaires = commentairesDeFeuille(feuille).length > 0;

  return `${EN_TETE}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${fige}
${colonnesXml || largeurs ? `<cols>${colonnesXml || largeurs}</cols>` : ""}
<sheetData>${lignes}</sheetData>
${fusions ? `<mergeCells count="${feuille.fusions.length}">${fusions}</mergeCells>` : ""}
${filtreXml}
${validations ? `<dataValidations count="${(validations.match(/<dataValidation /g) || []).length}">${validations}</dataValidations>` : ""}
${liensXml ? `<hyperlinks>${liensXml}</hyperlinks>` : ""}
${aCommentaires ? '<legacyDrawing r:id="rIdCommentairesVml"/>' : ""}
</worksheet>`;
};

const commentairesXml = (commentaires) => `${EN_TETE}
<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<authors><author>CompanyOS</author></authors>
<commentList>${commentaires.map((commentaire) => `<comment ref="${repereColonne(commentaire.c)}${commentaire.l + 1}" authorId="0"><text><t xml:space="preserve">${echapper(commentaire.texte)}</t></text></comment>`).join("")}</commentList>
</comments>`;

const commentairesVml = (commentaires) => `${EN_TETE}
<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>
<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>
${commentaires.map((commentaire, i) => `<v:shape id="_x0000_s${1025 + i}" type="#_x0000_t202" style="position:absolute;visibility:hidden;width:108pt;height:59.25pt;z-index:${i + 1}" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"/></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>${commentaire.c + 1}, 15, ${commentaire.l}, 2, ${commentaire.c + 3}, 15, ${commentaire.l + 4}, 4</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>${commentaire.l}</x:Row><x:Column>${commentaire.c}</x:Column></x:ClientData></v:shape>`).join("")}
</xml>`;

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
<Default Extension="json" ContentType="application/json"/>
${feuilles.some((f) => commentairesDeFeuille(f).length) ? '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>' : ""}
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${feuilles
  .map(
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join("")}
${feuilles.map((f, i) => commentairesDeFeuille(f).length ? `<Override PartName="/xl/comments${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>` : "").join("")}
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
  feuilles.forEach((f, i) => {
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, feuilleXml(f, indexDe, classeur, i));
    const liensExternes = liensDeFeuille(f).filter((lien) => !lien.href.startsWith("#"));
    const commentaires = commentairesDeFeuille(f);
    const relations = [
      ...liensExternes.map((lien, j) => `<Relationship Id="rIdLien${j + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${echapper(lien.href)}" TargetMode="External"/>`),
      ...(commentaires.length ? [
        `<Relationship Id="rIdCommentaires" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments${i + 1}.xml"/>`,
        `<Relationship Id="rIdCommentairesVml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/comments${i + 1}.vml"/>`,
      ] : []),
    ];
    if (relations.length) {
      zip.file(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, `${EN_TETE}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${relations.join("")}
</Relationships>`);
    }
    if (commentaires.length) {
      zip.file(`xl/comments${i + 1}.xml`, commentairesXml(commentaires));
      zip.file(`xl/drawings/comments${i + 1}.vml`, commentairesVml(commentaires));
    }
  });
  // Extension privée non bloquante : Excel ignore cette partie, tandis
  // que CompanyOS peut restaurer les objets que le format de grille XML ne
  // sait pas représenter sans une pile DrawingML complète.
  zip.file("companyos/classeur.json", JSON.stringify({
    version: 1,
    feuilles: feuilles.map((f) => ({
      objets: f.objets || [],
      fusions: f.fusions || [],
      reglesConditionnelles: f.reglesConditionnelles || [],
      hauteurs: f.hauteurs || {},
      filtres: f.filtres || [],
      tableaux: f.tableaux || [],
      lignesMasquees: f.lignesMasquees || [],
      colonnesMasquees: f.colonnesMasquees || [],
      cellules: f.cellules.flatMap((ligne, l) => ligne.flatMap((cel, c) => {
        const meta = {};
        for (const cle of ["type", "href", "commentaire", "image", "alt"]) {
          if (cel?.[cle] !== undefined) meta[cle] = cel[cle];
        }
        if (cel?.validation) meta.validation = cel.validation;
        return Object.keys(meta).length ? [{ l, c, ...meta }] : [];
      })),
    })),
  }));

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

const plageDepuisRef = (ref) => {
  const [a, b = a] = String(ref || "").split(":").map(refVersIndices);
  return a && b
    ? { l1: Math.min(a.l, b.l), c1: Math.min(a.c, b.c), l2: Math.max(a.l, b.l), c2: Math.max(a.c, b.c) }
    : null;
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

// OOXML autorise aussi bien `<sheet>` que `<x:sheet>`. Certains producteurs
// (notamment les bibliothèques Python) préfixent systématiquement toutes les
// balises. `getElementsByTagName("sheet")` ne retrouve alors pas `x:sheet`.
// Une recherche par nom local rend l'import indépendant du préfixe choisi.
const elementsDe = (noeud, nom) => {
  if (!noeud) return [];
  const avecEspaceDeNoms = noeud.getElementsByTagNameNS?.("*", nom);
  return [...(avecEspaceDeNoms?.length ? avecEspaceDeNoms : noeud.getElementsByTagName(nom))];
};

const premierElementDe = (noeud, nom) => elementsDe(noeud, nom)[0];

const texteDe = (noeud) =>
  noeud ? elementsDe(noeud, "t").map((t) => t.textContent).join("") : "";

/// Lit un `.xlsx` et rend un classeur.
export const depuisXlsx = async (blob, titre = "Classeur") => {
  const zip = await JSZip.loadAsync(blob);
  const chemins = Object.keys(zip.files);
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
    for (const r of elementsDe(xml(relsTexte), "Relationship")) {
      cibles.set(r.getAttribute("Id"), r.getAttribute("Target").replace(/^\/?xl\//, ""));
    }
  }

  // Table des chaînes partagées.
  const ssTexte = await lire("xl/sharedStrings.xml");
  const partagees = ssTexte
    ? elementsDe(xml(ssTexte), "si").map((si) => texteDe(si))
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
  const stylesDifferentiels = [];

  if (stTexte) {
    const st = xml(stTexte);

    const perso = new Map();
    for (const nf of elementsDe(st, "numFmt")) {
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
      if (/0[.,]0+/.test(code)) return "nombre";
      if (id === "1" || code === "#,##0" || code === "0") return "entier";
      return null;
    };

    const hex = (el) => {
      const rgb = el?.getAttribute("rgb");
      // Les couleurs OOXML s'écrivent AARRGGBB : on jette l'alpha.
      return rgb && rgb.length === 8 ? rgb.slice(2).toUpperCase() : null;
    };

    const polices = elementsDe(premierElementDe(st, "fonts"), "font").map(
      (f) => ({
        gras: !!elementsDe(f, "b").length,
        italique: !!elementsDe(f, "i").length,
        souligne: !!elementsDe(f, "u").length,
        barre: !!elementsDe(f, "strike").length,
        couleurTexte: hex(premierElementDe(f, "color")),
        police: premierElementDe(f, "name")?.getAttribute("val") || null,
        taille: Number(premierElementDe(f, "sz")?.getAttribute("val")) || null,
      }),
    );

    const remplissages = elementsDe(premierElementDe(st, "fills"), "fill").map(
      (f) => {
        const motif = premierElementDe(f, "patternFill");
        if (!motif || motif.getAttribute("patternType") !== "solid") return null;
        return hex(premierElementDe(motif, "fgColor"));
      },
    );

    const coteBordure = (bordure, cote) => {
      const el = premierElementDe(bordure, cote);
      const style = el?.getAttribute("style");
      if (!style) return null;
      return { style, couleur: hex(premierElementDe(el, "color")) || "CBD5E1" };
    };
    const bordures = elementsDe(premierElementDe(st, "borders"), "border").map((bordure) => {
      const resultat = {};
      for (const cote of ["top", "right", "bottom", "left"]) {
        const valeur = coteBordure(bordure, cote);
        if (valeur) resultat[cote] = valeur;
      }
      return Object.keys(resultat).length ? resultat : null;
    });

    const xfs = elementsDe(premierElementDe(st, "cellXfs"), "xf");
    xfs.forEach((xf, i) => {
      const id = xf.getAttribute("numFmtId") || "0";
      const code = perso.get(id) || "";
      const s = {};

      const format = formatDe(id, code);
      if (format) s.format = format;
      const partieNumerique = String(code).split(";")[0].replace(/"[^"]*"/g, "");
      const decimales = partieNumerique.match(/[.,](0+)/)?.[1]?.length;
      if (decimales !== undefined && format !== "date") s.decimales = decimales;
      if (format === "date") stylesDate.add(i);

      const police = polices[Number(xf.getAttribute("fontId") || 0)];
      if (police?.gras) s.gras = true;
      if (police?.italique) s.italique = true;
      if (police?.souligne) s.souligne = true;
      if (police?.barre) s.barre = true;
      if (police?.police && police.police !== "Calibri") s.police = police.police;
      if (police?.taille && police.taille !== 11) s.taille = police.taille;
      // Le noir est la couleur par défaut : la porter en style ferait
      // grossir le classeur sans rien changer à l'écran.
      if (police?.couleurTexte && police.couleurTexte !== "000000") {
        s.couleurTexte = police.couleurTexte;
      }

      const fond = remplissages[Number(xf.getAttribute("fillId") || 0)];
      if (fond && fond !== "FFFFFF") s.couleurFond = fond;
      const bordure = bordures[Number(xf.getAttribute("borderId") || 0)];
      if (bordure) s.bordures = bordure;

      const alignement = premierElementDe(xf, "alignment");
      const align = alignement?.getAttribute("horizontal");
      if (align === "center" || align === "right") s.align = align;
      if (alignement?.getAttribute("wrapText") === "1") s.wrap = true;

      if (Object.keys(s).length) styles.set(i, s);
    });

    for (const dxf of elementsDe(premierElementDe(st, "dxfs"), "dxf")) {
      const s = {};
      const police = premierElementDe(dxf, "font");
      if (elementsDe(police, "b").length) s.gras = true;
      if (elementsDe(police, "i").length) s.italique = true;
      const couleurTexte = hex(premierElementDe(police, "color"));
      if (couleurTexte) s.couleurTexte = couleurTexte;
      const motif = premierElementDe(premierElementDe(dxf, "fill"), "patternFill");
      const couleurFond = hex(premierElementDe(motif, "fgColor")) || hex(premierElementDe(motif, "bgColor"));
      if (couleurFond) s.couleurFond = couleurFond;
      stylesDifferentiels.push(s);
    }
  }

  const feuilles = [];
  let commentairesImportes = 0;
  const validationsDifferees = [];
  for (const s of elementsDe(wb, "sheet")) {
    const nom = s.getAttribute("name") || `Feuille ${feuilles.length + 1}`;
    const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const cible = cibles.get(rid) || `worksheets/sheet${feuilles.length + 1}.xml`;
    const texte = await lire(`xl/${cible}`);
    if (!texte) continue;

    const doc = xml(texte);
    const brut = [];
    let maxL = 0;
    let maxC = 0;

    for (const c of elementsDe(doc, "c")) {
      const pos = refVersIndices(c.getAttribute("r"));
      if (!pos || pos.l >= MAX_LIGNES_IMPORTEES || pos.c >= MAX_COLONNES_IMPORTEES) continue;
      const type = c.getAttribute("t");
      const styleIndex = Number(c.getAttribute("s") || 0);
      let valeur = "";
      let formule = "";
      let typeCellule = "";

      if (type === "inlineStr") valeur = texteDe(premierElementDe(c, "is"));
      else if (type === "s") valeur = partagees[Number(premierElementDe(c, "v")?.textContent)] ?? "";
      else if (type === "str") valeur = premierElementDe(c, "v")?.textContent ?? "";
      else if (type === "b") {
        valeur = premierElementDe(c, "v")?.textContent === "1" ? "TRUE" : "FALSE";
        typeCellule = "checkbox";
      }
      else {
        const v = premierElementDe(c, "v")?.textContent;
        if (v === undefined) valeur = "";
        else valeur = stylesDate.has(styleIndex) ? serieVersDate(v) : v;
      }

      // Une formule présente dans le fichier reprend sa forme éditable, en
      // français : noms (SUM → SOMME), points-virgules, virgule décimale.
      // La traduction passe par le moteur : remplacer naïvement les
      // virgules abîmait le texte entre guillemets (« "a,b" »).
      const f = premierElementDe(c, "f")?.textContent;
      if (f) formule = depuisExcel(f);

      const style = styles.get(styleIndex) || null;
      // Les cellules vides peuvent porter un fond, une bordure ou une
      // police. Les jeter supprimait les bandeaux et espacements conçus
      // dans Excel (par exemple la ligne bleue sous un grand titre).
      if (valeur === "" && !formule && !style) continue;
      brut.push({ ...pos, valeur, formule, style, typeCellule });
      maxL = Math.max(maxL, pos.l);
      maxC = Math.max(maxC, pos.c);
    }

    const L = Math.max(maxL + 1, 20);
    const C = Math.max(maxC + 1, 8);
    const cellules = Array.from({ length: L }, () => Array.from({ length: C }, () => ({ v: "" })));
    for (const b of brut) {
      cellules[b.l][b.c] = {
        v: b.valeur,
        ...(b.formule ? { f: b.formule } : {}),
        ...(b.typeCellule ? { type: b.typeCellule } : {}),
        ...(b.style ? { s: { ...b.style } } : {}),
      };
    }

    const largeurs = {};
    const colonnesMasquees = [];
    for (const col of elementsDe(doc, "col")) {
      const min = Number(col.getAttribute("min")) - 1;
      const max = Number(col.getAttribute("max")) - 1;
      const px = Math.round(Number(col.getAttribute("width") || 10) * 7 + 5);
      for (let j = min; j <= max && j < C; j += 1) largeurs[j] = px;
      if (col.getAttribute("hidden") === "1") {
        for (let j = min; j <= max && j < C; j += 1) colonnesMasquees.push(j);
      }
    }
    const hauteurs = {};
    const lignesMasquees = [];
    for (const row of elementsDe(doc, "row")) {
      const l = Number(row.getAttribute("r")) - 1;
      if (!Number.isInteger(l) || l < 0 || l >= L) continue;
      const ht = Number(row.getAttribute("ht"));
      if (Number.isFinite(ht) && ht > 0) hauteurs[l] = Math.round((ht / 0.75) * 100) / 100;
      if (row.getAttribute("hidden") === "1") lignesMasquees.push(l);
    }

    const volet = premierElementDe(doc, "pane");
    const figees = volet?.getAttribute("state") === "frozen"
      ? {
          lignes: Math.max(0, Number(volet.getAttribute("ySplit")) || 0),
          colonnes: Math.max(0, Number(volet.getAttribute("xSplit")) || 0),
        }
      : { lignes: 0, colonnes: 0 };

    const fusions = elementsDe(doc, "mergeCell").flatMap((noeud) => {
      const [a, b = a] = String(noeud.getAttribute("ref") || "").split(":").map(refVersIndices);
      return a && b ? [{ l1: Math.min(a.l, b.l), c1: Math.min(a.c, b.c), l2: Math.max(a.l, b.l), c2: Math.max(a.c, b.c) }] : [];
    });
    for (const validation of elementsDe(doc, "dataValidation")) {
      if (validation.getAttribute("type") !== "list") continue;
      const formule = premierElementDe(validation, "formula1")?.textContent || "";
      const destinations = String(validation.getAttribute("sqref") || "").split(/\s+/).map(plageDepuisRef).filter(Boolean);
      const reference = /^=?(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/i.exec(formule.trim());
      if (reference) {
        validationsDifferees.push({
          iFeuille: feuilles.length,
          destinations,
          source: {
            feuille: String(reference[1] || reference[2]).replace(/''/g, "'"),
            plage: plageDepuisRef(`${reference[3]}${reference[4]}:${reference[5]}${reference[6]}`),
          },
        });
        continue;
      }
      const options = formule.replace(/^"|"$/g, "").split(",").map((v) => v.trim()).filter(Boolean).slice(0, 100);
      if (!options.length) continue;
      for (const destination of destinations) {
        for (let l = destination.l1; l <= destination.l2 && l < cellules.length; l += 1) {
          for (let c = destination.c1; c <= destination.c2 && c < cellules[0].length; c += 1) cellules[l][c] = { ...cellules[l][c], validation: { type: "liste", options } };
        }
      }
    }

    // Tables Excel : le style (en-tête et lignes alternées) vit dans une
    // partie séparée, pas dans les styles des cellules. On le matérialise
    // afin que le rendu reste fidèle et éditable dans CompanyOS.
    const tableaux = [];
    const dossierCible = cible.includes("/") ? cible.slice(0, cible.lastIndexOf("/")) : "";
    const nomCible = cible.slice(cible.lastIndexOf("/") + 1);
    const relsFeuilleTexte = await lire(`xl/${dossierCible}/_rels/${nomCible}.rels`);
    const relationsFeuille = new Map();
    const typesRelationsFeuille = new Map();
    if (relsFeuilleTexte) {
      for (const relation of elementsDe(xml(relsFeuilleTexte), "Relationship")) {
        relationsFeuille.set(relation.getAttribute("Id"), relation.getAttribute("Target") || "");
        typesRelationsFeuille.set(relation.getAttribute("Id"), relation.getAttribute("Type") || "");
      }
    }

    const cheminRelation = (cibleBrute) => cibleBrute?.startsWith("/")
      ? cibleBrute.replace(/^\//, "")
      : `xl/${dossierCible}/${cibleBrute}`.replace(/\\/g, "/").replace(/\/[^/]+\/\.\.\//g, "/");
    for (const partie of elementsDe(doc, "tablePart")) {
      const ridTable = partie.getAttribute("r:id") || partie.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      const cibleBrute = relationsFeuille.get(ridTable);
      if (!cibleBrute) continue;
      const cheminTable = cheminRelation(cibleBrute);
      const tableTexte = await lire(cheminTable);
      if (!tableTexte) continue;
      const tableDoc = xml(tableTexte);
      const table = premierElementDe(tableDoc, "table");
      const plage = plageDepuisRef(table?.getAttribute("ref"));
      if (!plage) continue;
      const infoStyle = premierElementDe(table, "tableStyleInfo");
      const style = infoStyle?.getAttribute("name") || "";
      const lignesAlternees = infoStyle?.getAttribute("showRowStripes") === "1";
      tableaux.push({
        nom: table.getAttribute("displayName") || table.getAttribute("name") || "Tableau",
        plage,
        style,
        lignesAlternees,
      });
      const couleurs = /^TableStyleMedium(?:9|10|11|12)$/i.test(style)
        ? { entete: "1F4E78", bande: "D9EAF7", trait: "9CC2E5" }
        : { entete: "2563EB", bande: "BFE3F3", trait: "5B9BD5" };
      for (let l = plage.l1; l <= plage.l2 && l < cellules.length; l += 1) {
        for (let c = plage.c1; c <= plage.c2 && c < cellules[0].length; c += 1) {
          const cel = cellules[l][c] || { v: "" };
          const styleCellule = { ...(cel.s || {}) };
          if (l === plage.l1) {
            if (!styleCellule.couleurFond) styleCellule.couleurFond = couleurs.entete;
            if (!styleCellule.couleurTexte) styleCellule.couleurTexte = "FFFFFF";
            styleCellule.gras = true;
          } else if (lignesAlternees && (l - plage.l1) % 2 === 1 && !styleCellule.couleurFond) {
            styleCellule.couleurFond = couleurs.bande;
          }
          if (!styleCellule.bordures) {
            styleCellule.bordures = { bottom: { style: "thin", couleur: couleurs.trait } };
          }
          cellules[l][c] = { ...cel, s: styleCellule };
        }
      }
    }

    const reglesConditionnelles = [];
    for (const groupe of elementsDe(doc, "conditionalFormatting")) {
      const plages = String(groupe.getAttribute("sqref") || "").split(/\s+/).map(plageDepuisRef).filter(Boolean);
      for (const regle of elementsDe(groupe, "cfRule")) {
        const type = regle.getAttribute("type");
        for (const plage of plages) {
          if (type === "dataBar") {
            const couleur = premierElementDe(premierElementDe(regle, "dataBar"), "color")?.getAttribute("rgb")?.slice(-6) || "16A34A";
            const valeurs = [];
            for (let l = plage.l1; l <= plage.l2 && l < cellules.length; l += 1) {
              for (let c = plage.c1; c <= plage.c2 && c < cellules[0].length; c += 1) {
                const n = Number(cellules[l][c]?.v);
                if (Number.isFinite(n)) valeurs.push(n);
              }
            }
            reglesConditionnelles.push({ type: "barreDonnees", plage, couleur, min: Math.min(...valeurs, 0), max: Math.max(...valeurs, 0) });
          } else if (type === "containsText") {
            const texteRecherche = regle.getAttribute("text") || "";
            const styleRegle = stylesDifferentiels[Number(regle.getAttribute("dxfId"))] || {};
            if (texteRecherche) reglesConditionnelles.push({ type: "contientTexte", plage, texte: texteRecherche, style: styleRegle });
          } else if (type === "cellIs" && regle.getAttribute("operator") === "equal") {
            const valeurRegle = premierElementDe(regle, "formula")?.textContent ?? "";
            const styleRegle = stylesDifferentiels[Number(regle.getAttribute("dxfId"))] || {};
            reglesConditionnelles.push({ type: "egal", plage, valeur: valeurRegle, style: styleRegle });
          }
        }
      }
    }


    // Commentaires modernes (threaded comments) puis commentaires
    // classiques en solution de repli. Les deux peuvent décrire la même
    // cellule : le moderne, plus propre, a priorité.
    const commentaires = new Map();
    for (const [ridRelation, typeRelation] of typesRelationsFeuille) {
      if (!/\/threadedComment$/i.test(typeRelation)) continue;
      const contenu = await lire(cheminRelation(relationsFeuille.get(ridRelation)));
      if (!contenu) continue;
      for (const commentaire of elementsDe(xml(contenu), "threadedComment")) {
        const pos = refVersIndices(commentaire.getAttribute("ref"));
        const texteCommentaire = premierElementDe(commentaire, "text")?.textContent?.trim();
        if (pos && texteCommentaire) commentaires.set(`${pos.l}:${pos.c}`, { ...pos, texte: texteCommentaire });
      }
    }
    for (const [ridRelation, typeRelation] of typesRelationsFeuille) {
      if (!/\/comments$/i.test(typeRelation)) continue;
      const contenu = await lire(cheminRelation(relationsFeuille.get(ridRelation)));
      if (!contenu) continue;
      for (const commentaire of elementsDe(xml(contenu), "comment")) {
        const pos = refVersIndices(commentaire.getAttribute("ref"));
        const cleCommentaire = pos ? `${pos.l}:${pos.c}` : "";
        if (!pos || commentaires.has(cleCommentaire)) continue;
        let texteCommentaire = texteDe(premierElementDe(commentaire, "text")).trim();
        const marqueur = texteCommentaire.lastIndexOf("Comment:");
        if (marqueur >= 0) texteCommentaire = texteCommentaire.slice(marqueur + 8).trim();
        if (texteCommentaire) commentaires.set(cleCommentaire, { ...pos, texte: texteCommentaire });
      }
    }
    for (const commentaire of commentaires.values()) {
      if (commentaire.l >= cellules.length || commentaire.c >= cellules[0].length) continue;
      cellules[commentaire.l][commentaire.c] = {
        ...cellules[commentaire.l][commentaire.c],
        commentaire: commentaire.texte,
      };
      commentairesImportes += 1;
    }

    // Liens externes et internes Excel.
    for (const lien of elementsDe(doc, "hyperlink")) {
      const plageLien = plageDepuisRef(lien.getAttribute("ref"));
      if (!plageLien) continue;
      const ridLien = lien.getAttribute("r:id") || lien.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      const cibleLien = lien.getAttribute("location") || relationsFeuille.get(ridLien);
      if (!cibleLien) continue;
      for (let l = plageLien.l1; l <= plageLien.l2 && l < cellules.length; l += 1) {
        for (let c = plageLien.c1; c <= plageLien.c2 && c < cellules[0].length; c += 1) {
          cellules[l][c] = { ...cellules[l][c], href: cibleLien };
        }
      }
    }

    feuilles.push({ nom, cellules, largeurs, hauteurs, lignesMasquees, colonnesMasquees, figees, fusions, tableaux, reglesConditionnelles });
  }

  for (const validation of validationsDifferees) {
    const feuilleDestination = feuilles[validation.iFeuille];
    const feuilleSource = feuilles.find((f) => f.nom === validation.source.feuille);
    if (!feuilleDestination || !feuilleSource || !validation.source.plage) continue;
    const p = validation.source.plage;
    const options = [];
    for (let l = p.l1; l <= p.l2 && l < feuilleSource.cellules.length; l += 1) {
      for (let c = p.c1; c <= p.c2 && c < feuilleSource.cellules[0].length; c += 1) {
        const valeur = String(feuilleSource.cellules[l][c]?.v ?? "").trim();
        if (valeur && !options.includes(valeur)) options.push(valeur);
      }
    }
    for (const destination of validation.destinations) {
      for (let l = destination.l1; l <= destination.l2 && l < feuilleDestination.cellules.length; l += 1) {
        for (let c = destination.c1; c <= destination.c2 && c < feuilleDestination.cellules[0].length; c += 1) {
          feuilleDestination.cellules[l][c] = {
            ...feuilleDestination.cellules[l][c],
            validation: { type: "liste", options, source: validation.source },
          };
        }
      }
    }
  }

  const metaTexte = await lire("companyos/classeur.json");
  if (metaTexte) {
    try {
      const meta = JSON.parse(metaTexte);
      (Array.isArray(meta?.feuilles) ? meta.feuilles : []).slice(0, feuilles.length).forEach((mf, i) => {
        feuilles[i].objets = (Array.isArray(mf?.objets) ? mf.objets : []).slice(0, 1000)
          .filter((objet) => objet && typeof objet === "object" && typeof objet.id === "string");
        if (Array.isArray(mf?.fusions)) feuilles[i].fusions = mf.fusions.slice(0, 1000);
        if (Array.isArray(mf?.reglesConditionnelles)) feuilles[i].reglesConditionnelles = mf.reglesConditionnelles.slice(0, 1000);
        if (mf?.hauteurs && typeof mf.hauteurs === "object") feuilles[i].hauteurs = mf.hauteurs;
        if (Array.isArray(mf?.filtres)) feuilles[i].filtres = mf.filtres.slice(0, 100);
        if (Array.isArray(mf?.tableaux)) feuilles[i].tableaux = mf.tableaux.slice(0, 100);
        if (Array.isArray(mf?.lignesMasquees)) feuilles[i].lignesMasquees = mf.lignesMasquees.filter(Number.isInteger).slice(0, 10000);
        if (Array.isArray(mf?.colonnesMasquees)) feuilles[i].colonnesMasquees = mf.colonnesMasquees.filter(Number.isInteger).slice(0, 702);
        (Array.isArray(mf?.cellules) ? mf.cellules : []).slice(0, 10000).forEach((mc) => {
          const l = Number(mc?.l);
          const c = Number(mc?.c);
          if (!Number.isInteger(l) || !Number.isInteger(c) || l < 0 || c < 0 || l >= feuilles[i].cellules.length || c >= feuilles[i].cellules[0].length) return;
          const patch = {};
          for (const cle of ["type", "href", "commentaire", "image", "alt"]) {
            if (typeof mc[cle] === "string") patch[cle] = mc[cle];
          }
          if (mc.validation?.type === "liste" && Array.isArray(mc.validation.options)) {
            patch.validation = {
              type: "liste",
              options: mc.validation.options.filter((v) => typeof v === "string").slice(0, 500),
              ...(mc.validation.source?.feuille && mc.validation.source?.plage ? { source: mc.validation.source } : {}),
            };
          }
          feuilles[i].cellules[l][c] = { ...feuilles[i].cellules[l][c], ...patch };
        });
      });
    } catch { /* métadonnées facultatives invalides : la grille reste lisible */ }
  }

  if (!feuilles.length) throw new Error("Ce classeur ne contient aucune feuille lisible.");
  return {
    titre,
    feuilles,
    version: 1,
    rapportImport: {
      feuilles: feuilles.length,
      graphiquesIgnores: chemins.filter((p) => /^xl\/drawings\/charts\/chart\d+\.xml$/i.test(p)).length,
      imagesIgnorees: chemins.filter((p) => /^xl\/media\//i.test(p)).length,
      commentairesImportes,
      commentairesIgnores: 0,
    },
  };
};

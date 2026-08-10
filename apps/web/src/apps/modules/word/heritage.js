// Conversion des anciens documents.
//
// La version précédente du traitement de texte enregistrait ses documents
// en HTML, dans les enregistrements du module (collection « documents »).
// La nouvelle travaille sur de vrais fichiers `.docx` posés dans le cloud.
//
// Ce fichier fait le pont : il convertit le HTML hérité en `.docx`, une
// fois, à l'ouverture. On convertit plutôt que de maintenir deux moteurs —
// et on convertit **à l'ouverture**, pas en masse au premier lancement :
// une migration silencieuse qui tournerait sur tous les documents de tous
// les espaces au démarrage transformerait un bogue de conversion en perte
// générale.
//
// La conversion vise le contenu, pas le pixel : titres, gras, italique,
// souligné, listes, tableaux et images embarquées passent ; les réglages
// fins (interlignes au point près, couleurs de thème) sont abandonnés.
// C'est assumé — l'ancien format n'avait pas de mise en page fiable à
// préserver.

/// Convertit le HTML d'un ancien document en octets `.docx`.
///
/// La bibliothèque `docx` n'est chargée qu'ici, dynamiquement : elle ne
/// sert qu'à cette migration, elle n'a rien à faire dans le paquet
/// principal.
export const convertirHeritage = async (titre, html) => {
  const {
    Document,
    HeadingLevel,
    ImageRun,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = await import("docx");

  const dom = new DOMParser().parseFromString(html || "<p></p>", "text/html");

  const NIVEAUX = {
    h1: HeadingLevel.HEADING_1,
    h2: HeadingLevel.HEADING_2,
    h3: HeadingLevel.HEADING_3,
    h4: HeadingLevel.HEADING_4,
  };

  /// Décode une image en data-URL. Les autres sources sont abandonnées :
  /// l'ancienne version embarquait toujours les images en data-URL.
  const octetsImage = (src) => {
    const m = /^data:image\/(png|jpeg|jpg|gif|bmp);base64,(.+)$/i.exec(src || "");
    if (!m) return null;
    const binaire = atob(m[2]);
    const octets = new Uint8Array(binaire.length);
    for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
    const type = m[1].toLowerCase();
    return { octets, type: type === "jpg" ? "jpeg" : type };
  };

  /// Le contenu en ligne d'un élément, avec l'habillage accumulé en
  /// descendant : un <em> dans un <strong> rend un morceau gras-italique.
  const morceaux = (element, herite = {}) => {
    const out = [];
    for (const noeud of element.childNodes) {
      if (noeud.nodeType === Node.TEXT_NODE) {
        const texte = noeud.nodeValue.replace(/\s+/g, " ");
        if (texte) out.push(new TextRun({ text: texte, ...herite }));
        continue;
      }
      if (noeud.nodeType !== Node.ELEMENT_NODE) continue;

      const balise = noeud.tagName.toLowerCase();
      if (balise === "br") {
        out.push(new TextRun({ break: 1 }));
        continue;
      }
      if (balise === "img") {
        const image = octetsImage(noeud.getAttribute("src"));
        if (image) {
          out.push(
            new ImageRun({
              data: image.octets,
              type: image.type,
              transformation: { width: 440, height: 300 },
            }),
          );
        }
        continue;
      }

      const style = noeud.style || {};
      const suite = {
        ...herite,
        ...(balise === "b" || balise === "strong" || style.fontWeight === "bold"
          ? { bold: true }
          : {}),
        ...(balise === "i" || balise === "em" || style.fontStyle === "italic"
          ? { italics: true }
          : {}),
        ...(balise === "u" || /underline/.test(style.textDecorationLine || "")
          ? { underline: {} }
          : {}),
        ...(balise === "s" || balise === "strike" ? { strike: true } : {}),
        ...(style.color ? { color: cssVersHex(style.color) } : {}),
      };
      out.push(...morceaux(noeud, suite));
    }
    return out;
  };

  /// « rgb(192, 0, 0) » ou « #c00000 » vers l'hexadécimal nu d'OOXML.
  const cssVersHex = (couleur) => {
    const rgb = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(couleur);
    if (rgb) {
      return rgb
        .slice(1, 4)
        .map((n) => Number(n).toString(16).padStart(2, "0"))
        .join("");
    }
    return couleur.replace("#", "");
  };

  /// Un élément de bloc vers un ou plusieurs paragraphes.
  const blocs = (element, contexte = {}) => {
    const balise = element.tagName?.toLowerCase();

    if (NIVEAUX[balise]) {
      return [
        new Paragraph({
          children: morceaux(element),
          heading: NIVEAUX[balise],
          ...contexte,
        }),
      ];
    }
    if (balise === "ul" || balise === "ol") {
      const niveau = contexte.niveau || 0;
      return [...element.children].flatMap((li) => [
        new Paragraph({
          children: morceaux(li),
          bullet: { level: niveau },
        }),
        ...[...li.children]
          .filter((e) => /^(ul|ol)$/i.test(e.tagName))
          .flatMap((sous) => blocs(sous, { niveau: niveau + 1 })),
      ]);
    }
    if (balise === "table") {
      const lignes = [...element.querySelectorAll("tr")];
      if (!lignes.length) return [];
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: lignes.map(
            (tr) =>
              new TableRow({
                children: [...tr.children].map(
                  (cellule) =>
                    new TableCell({ children: [new Paragraph({ children: morceaux(cellule) })] }),
                ),
              }),
          ),
        }),
      ];
    }
    if (balise === "blockquote") {
      return [...element.children].flatMap((e) =>
        blocs(e, { indent: { left: 720 } }),
      );
    }
    if (balise === "div") {
      // L'ancien saut de page, ou un simple conteneur.
      if (element.classList.contains("wdBreak")) {
        return [new Paragraph({ children: [], pageBreakBefore: true })];
      }
      return [...element.children].flatMap((e) => blocs(e, contexte));
    }

    // Paragraphe, ou n'importe quoi d'autre portant du texte.
    const contenu = morceaux(element);
    return contenu.length || balise === "p"
      ? [new Paragraph({ children: contenu, ...contexte })]
      : [];
  };

  const document = new Document({
    title: titre,
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        children: [...dom.body.children].flatMap((e) => blocs(e)),
      },
    ],
  });

  return Packer.toBlob(document);
};

// Le diaporama de départ.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI CE FICHIER EXISTE
//
// `buildBlankPresentationArchive()` ne produit pas un diaporama vierge : il
// produit un **squelette** — thème, masque, onze dispositions, relations —
// avec zéro diapositive. L'éditeur en affiche pourtant une, si bien que
// tout paraît normal ; mais enregistrer aussitôt écrit un fichier sans
// aucune diapositive, que rouvrir affiche « No slides ». Un cul-de-sac
// silencieux : l'utilisateur croit avoir un document, il a une coquille.
//
// On assemble donc nous-mêmes le point de départ : le squelette, plus une
// vraie première diapositive de titre. `handler.save()` attend le tableau
// des diapositives — c'est lui qui écrit `ppt/slides/slide1.xml` et les
// relations qui vont avec.
// ─────────────────────────────────────────────────────────────────────────

export const MIME_PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const MODELES_PRESENTATION = [
  {
    id: "vierge",
    nom: "Présentation vierge",
    description: "Une page de titre sobre, prête à personnaliser.",
    accent: "#2563EB",
    slides: 1,
  },
  {
    id: "pitch",
    nom: "Pitch commercial",
    description: "Problème, solution, chiffres, offre et prochaine étape.",
    accent: "#7C3AED",
    slides: 5,
  },
  {
    id: "rapport",
    nom: "Rapport de direction",
    description: "Synthèse exécutive, indicateurs, analyse et décisions.",
    accent: "#0F766E",
    slides: 5,
  },
  {
    id: "projet",
    nom: "Lancement de projet",
    description: "Vision, jalons, responsabilités, risques et plan d'action.",
    accent: "#EA580C",
    slides: 5,
  },
];

const PALETTES = {
  pitch: {
    fond: "#100F1A",
    surface: "#1D1930",
    texte: "#F7F5FF",
    muted: "#B9B2CF",
    accent: "#8B5CF6",
  },
  rapport: {
    fond: "#F5F7F6",
    surface: "#FFFFFF",
    texte: "#102A27",
    muted: "#5E716E",
    accent: "#0F766E",
  },
  projet: {
    fond: "#FFF8F2",
    surface: "#FFFFFF",
    texte: "#32180B",
    muted: "#805C48",
    accent: "#EA580C",
  },
};

const ajouterEntete = (slide, numero, titre, palette) => {
  slide
    .addText(String(numero).padStart(2, "0"), {
      x: 72,
      y: 48,
      width: 52,
      height: 28,
      fontSize: 13,
      bold: true,
      color: palette.accent,
    })
    .addText(titre, {
      x: 130,
      y: 43,
      width: 930,
      height: 38,
      fontSize: 18,
      bold: true,
      color: palette.texte,
    })
    .addShape("rect", {
      x: 72,
      y: 94,
      width: 1136,
      height: 2,
      fill: { type: "solid", color: palette.accent },
      stroke: { color: palette.accent, width: 0 },
    });
};

const carte = (slide, { x, y, width, height, titre, valeur, texte }, palette) => {
  slide
    .addShape("roundRect", {
      x,
      y,
      width,
      height,
      fill: { type: "solid", color: palette.surface },
      stroke: { color: palette.accent, width: 1, opacity: 0.22 },
      shadow: { color: "#000000", blur: 12, offsetY: 5, opacity: 0.1 },
    })
    .addText(titre, {
      x: x + 24,
      y: y + 22,
      width: width - 48,
      height: 28,
      fontSize: 13,
      bold: true,
      color: palette.muted,
    })
    .addText(valeur, {
      x: x + 24,
      y: y + 66,
      width: width - 48,
      height: 58,
      fontSize: 34,
      bold: true,
      color: palette.texte,
    })
    .addText(texte, {
      x: x + 24,
      y: y + 136,
      width: width - 48,
      height: height - 155,
      fontSize: 13,
      color: palette.muted,
      lineSpacing: 1.15,
    });
};

const diaporamaProfessionnel = async (modele) => {
  const { PresentationBuilder } = await import("pptx-viewer-core");
  const palette = PALETTES[modele] || PALETTES.pitch;
  const { handler, createSlide } = await PresentationBuilder.create({
    title: MODELES_PRESENTATION.find((m) => m.id === modele)?.nom,
    theme: {
      name: "CompanyOS Slides",
      colors: { dk1: palette.texte, lt1: palette.fond, accent1: palette.accent },
      fonts: { majorFont: "Aptos Display", minorFont: "Aptos" },
    },
  });
  const slides = [];

  const cover = createSlide("Blank")
    .setBackground({ type: "solid", color: palette.fond })
    .setTransition({ type: "fade", duration: 650 })
    .addShape("roundRect", {
      x: 72,
      y: 64,
      width: 160,
      height: 38,
      fill: { type: "solid", color: palette.accent },
      stroke: { color: palette.accent, width: 0 },
      text: "COMPANYOS",
      textStyle: {
        color: "#FFFFFF",
        bold: true,
        fontSize: 12,
        alignment: "center",
        verticalAlignment: "middle",
      },
    })
    .addText(
      modele === "pitch"
        ? "Une idée claire.\nUne décision simple."
        : modele === "rapport"
          ? "Rapport de direction\nT3 · 2026"
          : "Lancement du projet\nCap 2027",
      {
        x: 72,
        y: 170,
        width: 940,
        height: 190,
        fontSize: 48,
        bold: true,
        color: palette.texte,
        lineSpacing: 0.95,
      },
    )
    .addText(
      "Remplacez ce sous-titre par la promesse principale de votre présentation.",
      { x: 76, y: 390, width: 760, height: 70, fontSize: 18, color: palette.muted },
    )
    .addShape("roundRect", {
      x: 1000,
      y: 160,
      width: 208,
      height: 390,
      fill: { type: "solid", color: palette.accent, opacity: 0.92 },
      stroke: { color: palette.accent, width: 0 },
    })
    .addText("01\n—\n05", {
      x: 1040,
      y: 255,
      width: 130,
      height: 180,
      fontSize: 34,
      bold: true,
      color: "#FFFFFF",
      alignment: "center",
    })
    .setNotes(
      "Ouvrez avec le résultat attendu, pas avec l'historique. Une phrase suffit pour installer l'enjeu.",
    );
  slides.push(cover.build());

  const synthese = createSlide("Blank")
    .setBackground({ type: "solid", color: palette.fond })
    .setTransition({ type: "fade", duration: 450 });
  ajouterEntete(
    synthese,
    2,
    modele === "pitch"
      ? "Le problème mérite une réponse différente"
      : modele === "rapport"
        ? "Synthèse exécutive"
        : "La vision et le résultat attendu",
    palette,
  );
  carte(
    synthese,
    {
      x: 72,
      y: 145,
      width: 350,
      height: 400,
      titre: "CONSTAT",
      valeur: "3×",
      texte: "Décrivez ici la friction principale et son impact concret sur l'activité.",
    },
    palette,
  );
  carte(
    synthese,
    {
      x: 465,
      y: 145,
      width: 350,
      height: 400,
      titre: "OPPORTUNITÉ",
      valeur: "+42 %",
      texte: "Montrez le potentiel atteignable avec une métrique simple et crédible.",
    },
    palette,
  );
  carte(
    synthese,
    {
      x: 858,
      y: 145,
      width: 350,
      height: 400,
      titre: "DÉCISION",
      valeur: "90 j",
      texte: "Formulez l'engagement attendu et l'horizon de mise en œuvre.",
    },
    palette,
  );
  synthese.setNotes(
    "Reliez chaque chiffre à une source. Supprimez toute carte qui ne contribue pas à la décision.",
  );
  slides.push(synthese.build());

  const chiffres = createSlide("Blank")
    .setBackground({ type: "solid", color: palette.fond })
    .setTransition({ type: "fade", duration: 450 });
  ajouterEntete(
    chiffres,
    3,
    modele === "rapport"
      ? "Les indicateurs qui pilotent la période"
      : "La trajectoire en un regard",
    palette,
  );
  chiffres.addChart(
    "bar",
    {
      categories: ["Point de départ", "Aujourd'hui", "Objectif"],
      series: [{ name: "Indice", values: [38, 67, 92], color: palette.accent }],
      title: "Progression",
      hasLegend: false,
    },
    { x: 72, y: 135, width: 720, height: 430 },
  );
  carte(
    chiffres,
    {
      x: 840,
      y: 160,
      width: 368,
      height: 180,
      titre: "IMPACT",
      valeur: "24 M",
      texte: "Valeur créée ou sécurisée.",
    },
    palette,
  );
  carte(
    chiffres,
    {
      x: 840,
      y: 365,
      width: 368,
      height: 180,
      titre: "CONFIANCE",
      valeur: "87 %",
      texte: "Niveau d'adhésion ou qualité.",
    },
    palette,
  );
  chiffres.setNotes(
    "Commentez l'écart entre aujourd'hui et l'objectif. Le graphique doit porter une seule idée.",
  );
  slides.push(chiffres.build());

  const plan = createSlide("Blank")
    .setBackground({ type: "solid", color: palette.fond })
    .setTransition({ type: "fade", duration: 450 });
  ajouterEntete(
    plan,
    4,
    modele === "projet"
      ? "Trois jalons, des responsabilités nettes"
      : "Le plan d'exécution",
    palette,
  );
  [
    ["01", "Cadrer", "Semaines 1–2", "Objectifs, responsables et mesure de succès."],
    ["02", "Construire", "Semaines 3–8", "Livraison progressive et validation terrain."],
    ["03", "Déployer", "Semaines 9–12", "Adoption, mesure et passage à l'échelle."],
  ].forEach(([n, titre, periode, detail], i) => {
    const x = 72 + i * 393;
    plan.addShape("roundRect", {
      x,
      y: 160,
      width: 350,
      height: 360,
      fill: { type: "solid", color: palette.surface },
      stroke: { color: palette.accent, width: 1, opacity: 0.25 },
    });
    plan.addText(n, {
      x: x + 26,
      y: 188,
      width: 80,
      height: 45,
      fontSize: 28,
      bold: true,
      color: palette.accent,
    });
    plan.addText(titre, {
      x: x + 26,
      y: 260,
      width: 290,
      height: 45,
      fontSize: 25,
      bold: true,
      color: palette.texte,
    });
    plan.addText(periode, {
      x: x + 26,
      y: 322,
      width: 290,
      height: 28,
      fontSize: 13,
      bold: true,
      color: palette.accent,
    });
    plan.addText(detail, {
      x: x + 26,
      y: 380,
      width: 290,
      height: 85,
      fontSize: 15,
      color: palette.muted,
    });
  });
  plan.setNotes(
    "Donnez un propriétaire à chaque étape et annoncez le prochain point de contrôle.",
  );
  slides.push(plan.build());

  const fin = createSlide("Blank")
    .setBackground({ type: "solid", color: palette.accent })
    .setTransition({ type: "fade", duration: 650 });
  fin.addText("La prochaine décision", {
    x: 72,
    y: 80,
    width: 700,
    height: 45,
    fontSize: 16,
    bold: true,
    color: "#FFFFFF",
  });
  fin.addText("Prêts à lancer\nla première étape ?", {
    x: 72,
    y: 190,
    width: 880,
    height: 170,
    fontSize: 48,
    bold: true,
    color: "#FFFFFF",
    lineSpacing: 0.95,
  });
  fin.addShape("roundRect", {
    x: 72,
    y: 430,
    width: 420,
    height: 72,
    fill: { type: "solid", color: "#FFFFFF" },
    stroke: { color: "#FFFFFF", width: 0 },
    text: "Décision attendue · Date · Responsable",
    textStyle: {
      color: palette.accent,
      bold: true,
      fontSize: 15,
      alignment: "center",
      verticalAlignment: "middle",
    },
  });
  fin
    .addText("contact@entreprise.com  ·  companyos", {
      x: 72,
      y: 620,
      width: 700,
      height: 28,
      fontSize: 12,
      color: "#FFFFFF",
    })
    .setNotes(
      "Terminez sur une demande explicite. Laissez l'écran affiché pendant les questions.",
    );
  slides.push(fin.build());

  return new Uint8Array(await handler.save(slides));
};

/// Un diaporama neuf : une diapositive de titre, prête à être remplie.
///
/// Le moteur n'est chargé qu'ici, dynamiquement : il ne sert qu'à la
/// création et n'a pas à peser sur le démarrage de l'OS.
export const diaporamaVierge = async (modele = "vierge") => {
  if (modele !== "vierge") return diaporamaProfessionnel(modele);
  const { PresentationBuilder } = await import("pptx-viewer-core");
  const { handler, createSlide } = await PresentationBuilder.create();

  // La disposition « Title Slide » est celle que PowerPoint ouvre en
  // premier : deux réserves, titre et sous-titre.
  const diapo = createSlide("Title Slide");
  diapo.addText("Cliquez pour ajouter un titre", {
    x: 60,
    y: 250,
    width: 1160,
    height: 120,
  });
  diapo.addText("Cliquez pour ajouter un sous-titre", {
    x: 60,
    y: 390,
    width: 1160,
    height: 70,
  });

  return new Uint8Array(await handler.save([diapo.build()]));
};

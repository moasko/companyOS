import React from "react";

// Pictogrammes système de CompanyOS (barre des tâches, volet latéral,
// boutons de fenêtre, ruban de l'explorateur).
//
// Pourquoi un module et pas des fichiers image
// -------------------------------------------
// Les PNG de public/img/icon/ui/ étaient monochromes mais pas de la même
// couleur : wifi.png est noir, settings.png est blanc. Le thème sombre était
// rattrapé au cas par cas avec `filter: invert(1)`, ce qui inversait aussi
// les icônes déjà claires. Un trait dessiné en `currentColor` hérite de la
// couleur du texte : plus rien à inverser, et le thème clair comme sombre
// fonctionne sans règle CSS supplémentaire.
//
// Grille 24×24, trait 2, extrémités et jonctions arrondies. Les noms sont
// ceux des anciens PNG : le repli sur l'image d'origine reste possible pour
// tout glyphe absent d'ici.

const T = (d, k) => <path key={k} d={d} />;
const HP = (d, k) => <path key={k} d={d} fill="currentColor" stroke="none" />;
const C = (cx, cy, r, k) => (
  <circle key={k} cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
);

const hautParleur = "M4 9.5h3.2L12 5.6v12.8L7.2 14.5H4Z";
const corbeille = "M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7M6.5 7l.9 12.1A2 2 0 0 0 9.4 21h5.2a2 2 0 0 0 2-1.9L17.5 7";

export const GLYPHES_UI = {
  // --- boutons de fenêtre ---
  close: [T("M6.5 6.5l11 11M17.5 6.5l-11 11")],
  minimize: [T("M5 12h14")],
  maximize: [T("M5.5 5.5h13v13h-13z")],
  maxmin: [
    T("M4.5 9.5h10v10h-10z"),
    T("M9.5 9.5V6a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 19.5 6v7a1.5 1.5 0 0 1-1.5 1.5h-3.5"),
  ],

  // --- réseau et connectivité ---
  wifi: [
    T("M2.8 9.3a14 14 0 0 1 18.4 0"),
    T("M6.2 12.9a9 9 0 0 1 11.6 0"),
    T("M9.6 16.5a4 4 0 0 1 4.8 0"),
    C(12, 19.8, 1.4, "d"),
  ],
  bluetooth: [T("M8 7.6 16 16.4 12 19.8V4.2l4 3.4-8 8.8")],
  airplane: [
    T("M12 3c.9 0 1.5.8 1.5 1.9v3.9l7 4v1.9l-7-2v4l2.3 1.5v1.5L12 19l-3.8.7v-1.5l2.3-1.5v-4l-7 2v-1.9l7-4V4.9C10.5 3.8 11.1 3 12 3Z"),
  ],
  network: [
    T("M4 19h16"),
    T("M7 19v-4.5"),
    T("M12 19v-8"),
    T("M17 19V5.5"),
  ],
  connect: [
    T("M3.5 8.5V6.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4"),
    T("M3.5 12.5a6 6 0 0 1 6 6"),
    T("M3.5 16.5a2 2 0 0 1 2 2"),
  ],
  project: [
    T("M3.5 5.5h17v10h-17z"),
    T("M8.5 19.5h7"),
    T("M12 15.5v4"),
  ],
  nearshare: [
    T("M12 4v9"),
    T("M8.5 7.5 12 4l3.5 3.5"),
    T("M4.5 14v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V14"),
  ],
  share: [
    C(6.5, 12, 2.6, "a"),
    C(17, 6.5, 2.6, "b"),
    C(17, 17.5, 2.6, "c"),
    T("M8.9 10.8 14.6 7.8"),
    T("M8.9 13.2l5.7 3"),
  ],
  link: [
    T("M10 13.8a3.6 3.6 0 0 0 5.3.4l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1.5 1.5"),
    T("M14 10.2a3.6 3.6 0 0 0-5.3-.4l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1.5-1.5"),
  ],

  // --- son ---
  audio0: [T(hautParleur), T("M16.5 9.8 21 14.3M21 9.8l-4.5 4.5")],
  audio1: [T(hautParleur)],
  audio2: [T(hautParleur), T("M15.5 9.6a3.5 3.5 0 0 1 0 4.8")],
  audio3: [
    T(hautParleur),
    T("M15.5 9.6a3.5 3.5 0 0 1 0 4.8"),
    T("M18.4 7.2a7.5 7.5 0 0 1 0 9.6"),
  ],

  // --- énergie et affichage ---
  battery: [
    T("M2.5 8.5h16v7h-16z"),
    T("M21 11v2"),
    HP("M4.5 10.5h7v3h-7z", "f"),
  ],
  saver: [
    T("M2.5 8.5h16v7h-16z"),
    T("M21 11v2"),
    T("M8 12h5M10.5 9.5v5"),
  ],
  plug: [
    T("M9 3.5v5.5M15 3.5v5.5"),
    T("M6 9h12v2.5a6 6 0 0 1-12 0Z"),
    T("M12 17.5V21"),
  ],
  power: [T("M12 3.5v8"), T("M7.6 6.6a8 8 0 1 0 8.8 0")],
  brightness: [
    C(12, 12, 3.6, "a"),
    T("M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.5 1.5M16.9 16.9l1.5 1.5M18.4 5.6l-1.5 1.5M7.1 16.9l-1.5 1.5"),
  ],
  sun: [
    C(12, 12, 3.6, "a"),
    T("M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.5 1.5M16.9 16.9l1.5 1.5M18.4 5.6l-1.5 1.5M7.1 16.9l-1.5 1.5"),
  ],
  moon: [T("M20 14.7A8.6 8.6 0 0 1 9.3 4 8.6 8.6 0 1 0 20 14.7Z")],
  nightlight: [
    T("M19.5 14.9A8 8 0 0 1 9.1 4.5 8 8 0 1 0 19.5 14.9Z"),
    C(17.5, 6.5, 1, "a"),
    C(20, 10, 0.8, "b"),
  ],
  display: [T("M3 5h18v11H3z"), T("M8.5 20h7"), T("M12 16v4")],
  tablet: [T("M5.5 3h13v18h-13z"), C(12, 18, 1, "a")],
  keyboard: [
    T("M2.5 6.5h19v11h-19z"),
    T("M8 14h8"),
    C(6.5, 10, 1, "a"),
    C(10, 10, 1, "b"),
    C(13.5, 10, 1, "c"),
    C(17, 10, 1, "d"),
  ],

  // --- système ---
  settings: [
    T("M4 8h16M4 16h16"),
    C(15.5, 8, 2.4, "a"),
    C(9, 16, 2.4, "b"),
  ],
  search: [T("M10.8 4.8a6 6 0 1 1 0 12 6 6 0 0 1 0-12Z"), T("M15.4 15.4 20 20")],
  more: [C(5.5, 12, 1.6, "a"), C(12, 12, 1.6, "b"), C(18.5, 12, 1.6, "c")],
  dash: [T("M6 12h12")],
  sidepane: [T("M3 5h18v14H3z"), T("M15 5v14")],
  personalize: [
    T("M12 20.5a8.5 8.5 0 1 1 8.5-8.5c0 2.2-2 2.6-3.6 2.6h-1.4a2 2 0 0 0-1.3 3.5 1.8 1.8 0 0 1-1.2 2.4Z"),
    C(8, 10, 1.3, "a"),
    C(12, 7.5, 1.3, "b"),
    C(16, 10, 1.3, "c"),
  ],
  update: [
    T("M20 12a8 8 0 1 1-2.6-5.9"),
    T("M20 4v4.5h-4.5"),
  ],
  refresh: [
    T("M20 12a8 8 0 1 1-2.6-5.9"),
    T("M20 4v4.5h-4.5"),
  ],
  shield: [T("M12 3.5 19 6.3v5.2c0 4.4-2.9 7.9-7 9.3-4.1-1.4-7-4.9-7-9.3V6.3Z")],
  trouble: [
    T("M14.5 6.5a4 4 0 0 0 5 5l-8 8a2.5 2.5 0 0 1-3.5-3.5Z"),
    T("M6.5 17.5h.01"),
  ],
  passkey: [
    C(8.5, 9.5, 3.4, "a"),
    T("M11 12l8 8M17 18l1.5 1.5M19 16l1.5 1.5"),
  ],
  pinlock: [
    T("M5.5 10.5h13v10h-13z"),
    T("M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"),
    C(12, 15.5, 1.3, "a"),
  ],
  location: [
    T("M12 21s6.5-6.1 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 14.9 12 21 12 21Z"),
    C(12, 10.3, 2.2, "a"),
  ],
  marker: [T("M6 21V4h11l-2.5 4L17 12H6")],

  // --- explorateur ---
  new: [
    T("M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"),
    T("M12 11.5v5M9.5 14h5"),
  ],
  copy: [T("M9 3.5h11v11"), T("M4 7.5h11v13H4z")],
  cut: [
    C(6.5, 18, 2.6, "a"),
    C(17.5, 18, 2.6, "b"),
    T("M7.6 4 15.6 16.2M16.4 4 8.4 16.2"),
  ],
  paste: [
    T("M6 5.5h12v15H6z"),
    T("M9.5 5.5V4a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 4v1.5"),
    T("M9.5 11h5M9.5 15h5"),
  ],
  rename: [T("M4 20h16"), T("M5 15.5 15.5 5a2.5 2.5 0 0 1 3.5 3.5L8.5 19 4 20Z")],
  dustbin: [T(corbeille)],
  downloads: [
    T("M12 3.5v10"),
    T("M8 10l4 3.5 4-3.5"),
    T("M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2"),
  ],
  view: [
    T("M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"),
    C(12, 12, 2.6, "a"),
  ],
  sort: [T("M4 7h12M4 12h8M4 17h4"), T("M18 8v9M15 14l3 3 3-3")],
  sort0: [T("M4 7h4M4 12h8M4 17h12"), T("M18 17V8M15 11l3-3 3 3")],
  left: [T("M15 5 8 12l7 7")],
  right: [T("M9 5l7 7-7 7")],
  mail: [T("M2.5 6.5h19v11h-19z"), T("M3 7.5l9 6.5 9-6.5")],
  reply: [T("M9.5 5 3 11.5 9.5 18v-3.5c6 0 9 1.5 11 5 0-6.5-2.5-11-11-11Z")],
};

/// Vrai si `nom` a un pictogramme vectoriel.
export const aUnGlypheUi = (nom) =>
  typeof nom === "string" && Object.hasOwn(GLYPHES_UI, nom);

/// Le SVG d'un pictogramme, ou null si le nom est inconnu.
///
/// Le trait est en `currentColor` : la couleur vient de la CSS environnante,
/// il n'y a rien à inverser en thème sombre.
export const GlypheUi = ({ nom, width, height, style }) => {
  const parties = GLYPHES_UI[nom];
  if (!parties) return null;

  return (
    <svg
      viewBox="0 0 24 24"
      width={width || 16}
      height={height || width || 16}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {/* Les fragments sont construits une fois, au chargement du module, et
          la plupart n'ont pas de clé : `T("…")` est appelé sans second
          argument dans presque toute la table. React réclame une clé dès
          qu'un glyphe compte plusieurs traits. On la pose ici plutôt que
          d'en ajouter deux cents à la main — la table est statique, l'indice
          est donc parfaitement stable. */}
      {parties.map((partie, i) =>
        partie.key == null ? React.cloneElement(partie, { key: i }) : partie,
      )}
    </svg>
  );
};

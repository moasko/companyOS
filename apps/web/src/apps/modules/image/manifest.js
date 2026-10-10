// Descriptif de l'application, chargé au démarrage du shell.
//
// Le code de la fenêtre (index.jsx) n'est téléchargé qu'à la première
// ouverture : ce fichier doit rester léger — aucun import de React ni
// des écrans. Voir src/apps/registry.js.

export const manifest = {
  id: "imageEditor",
  slug: "image",
  name: "Atelier Image",
  icon: "photos",
  action: "IMAGEEDITORAPP",
  version: "2.5.0",
  nouveautes: [
    { version: "2.5.0", texte: "Inspiration CE.SDK : presets de formats canal en un clic (Post, Story, LinkedIn, miniature YouTube, A4, présentation), panneau Modèles avec scènes prêtes à personnaliser (affiche formation, post promo) et export PDF multi-pages." },
    { version: "2.0.0", texte: "Expérience moderne : palette de commandes (Ctrl+K), minimap navigable, auto-sauvegarde de session avec restauration, barre d'actions flottante sur la sélection, copie PNG directe dans le presse-papiers et voyage temporel dans l'historique." },
    { version: "1.9.0", texte: "Édition de nœuds façon vecteur : double-clic sur un tracé ou une forme (triangle, étoile et ligne se vectorisent) pour déplacer ancres et poignées, insérer des points sur les segments ou en retirer. Redimensionnement intelligent et interface claire façon Figma : dock à groupes déroulants, sections repliables." },
    { version: "1.8.0", texte: "Texte pro : placement par clic avec l'outil T, édition directe (Entrée valide, Échap quitte, hauteur auto), gras réglable, interligne, espacement des lettres, casses, contour du texte, ajustement de largeur — export multiligne corrigé." },
    { version: "1.7.0", texte: "Refonte de l'interface : menu contextuel au clic droit, notifications toast, écran d'accueil, aide des raccourcis (F1), inspecteur simplifié et architecture interne modularisée." },
    { version: "1.6.0", texte: "Outils pro à la Figma : règles et guides persistants aimantés, double-clic pour éditer un texte sur le canvas, copier/coller le style (Ctrl+Alt+C/V), premier plan/arrière-plan (]/[), navigation calques Tab/Entrée/Échap, zoom sur la sélection (Maj+2), Alt+glisser pour dupliquer, rotation magnétique 15° et mode contours." },
    { version: "1.5.0", texte: "Outil Plume : ancres cliquées, poignées de Bézier symétriques, tracés ouverts ou fermés et remplissables — Entree termine, Retour arrière retire la dernière ancre, Échap annule." },
    { version: "1.4.0", texte: "Triangle, ligne, étoile, pinceau à main levée et recadrage d’image. Filtre Teinte, typographie complète (police, italique, souligné, alignement), export WebP à l’échelle 1–3× ou de la sélection seule, verrouillage depuis la liste des calques." },
    { version: "1.3.0", texte: "Interface de studio inspirée de Figma : pages et calques, inspecteur Design/Prototype/Export et barre d’outils flottante." },
    { version: "1.2.1", texte: "Commandes Figma : zoom sous le curseur, navigation et raccourcis clavier complets." },
    { version: "1.2.0", texte: "Canvas infini, outil Main, zoom jusqu’à 400 % et guides d’alignement intelligents." },
    { version: "1.1.0", texte: "Transformations directes, projets éditables, fusion, ombres, verrouillage et historique optimisé." },
    { version: "1.0.1", texte: "Correction de l’ouverture depuis le Bureau et le menu Démarrer." },
    { version: "1.0.0", texte: "Montage non destructif, calques, texte, formes, filtres et export PNG/JPEG." },
  ],
};

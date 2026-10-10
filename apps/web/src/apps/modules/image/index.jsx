import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { screenToWorld } from "./editor/core/coordinates";
import { createNodeStore, listNodeStore, replaceNodeStore } from "./editor/state/node-store";
import { LARGEUR_INITIALE, HAUTEUR_INITIALE, filtreNeutre, POLICES, OUTILS_FORMES, FILTRES_REGLAGES, FORMATS_PRESETS, id, copieObjet, copieObjets } from "./logique/constantes";
import { MODELES } from "./logique/modeles";
import { modal } from "../../../apps/modalRequest";
import { filtreCss, cheminPlume, dessinerObjet, mesurerLargeurTexte, appliquerCasse, geometrieAncres, rayonsEffectifs, degradeCss } from "./logique/rendu";
import { calculerZoneRecadrage, positionApresRecadrage, champsSpecifiques, CHAMPS_APPLICABLES } from "./logique/recadrage";
import { hexVersRgb, supprimerArrierePlan, bornesContenu, etirerContraste, tamponRestauration, composerFondCouleur, composerFondFlou } from "./logique/image";
import { documentDepuisEtat, documentVersEtat, dupliquerPage, pageDepuisObjets, pageVersObjets, validerDocument } from "./logique/document";
import Toast from "./panneaux/Toast";
import MenuContextuel from "./panneaux/MenuContextuel";
import Aide from "./panneaux/Aide";
import Accueil from "./panneaux/Accueil";
import "./image.scss";
import { manifest as descriptif } from "./manifest";

const ICONES_FORMES = [
  ["rectangle", "faSquare", "Rectangle", "R"],
  ["ellipse", "faCircle", "Ellipse", "O"],
  ["triangle", "faShapes", "Triangle", ""],
  ["ligne", "faSlash", "Ligne", "L"],
  ["etoile", "faStar", "Étoile", "S"],
];
const ICONES_DESSINS = [
  ["pinceau", "faPaintbrush", "Pinceau", "K"],
  ["plume", "faPenNib", "Plume", "P"],
];
const ICONES_IMAGE = [
  ["gomme", "faEraser", "Gomme magique", "G"],
  ["restauration", "faWandMagicSparkles", "Restauration", "E"],
  ["pipette", "faEyeDropper", "Pipette", "I"],
];

// Section repliable de l'inspecteur, façon Figma : un en-tête cliquable
// fait apparaître ou disparaître le contenu du groupe.
function SectionRepliable({ titre, defaut = true, children }) {
  const [ouverte, setOuverte] = useState(defaut);
  return (
    <section className="imgSection">
      <header onClick={() => setOuverte((valeur) => !valeur)}>
        <i className="imgChevron" data-ouvert={ouverte}><Icon fafa="faChevronDown" width={9} /></i>
        <h4>{titre}</h4>
      </header>
      {ouverte ? <div className="imgSectionContenu">{children}</div> : null}
    </section>
  );
}

export const manifest = { ...descriptif, Window: ImageApp };

function ImageApp() {
  const canvas = useRef(null);
  const scene = useRef(null);
  const importeur = useRef(null);
  const importeurProjet = useRef(null);
  const cacheImages = useRef(new Map());
  const glisse = useRef(null);
  const dessinProgramme = useRef(null);
  const pressePapier = useRef(null);
  const presseStyle = useRef(null);
  const canvasSources = useRef(new Map());
  const guideDrag = useRef(null);
  const champNom = useRef(null);
  const minuteToast = useRef(null);
  const aideMiroir = useRef(false);
  const miroirMenuOutils = useRef(false);
  const paletteMiroir = useRef(false);
  const commandes = useRef({});
  const outilAvantEspace = useRef(null);
  const outilPrecedent = useRef("selection");
  const pageInitiale = useRef({ id: id(), nom: "Scène 1", largeur: LARGEUR_INITIALE, hauteur: HAUTEUR_INITIALE, fond: "#ffffff", fondTransparent: true, objets: [], guides: { h: [], v: [] } });
  const [pages, setPages] = useState(() => [pageInitiale.current]);
  const [pageActive, setPageActive] = useState(() => pageInitiale.current.id);
  const [magasinNoeuds, setMagasinNoeuds] = useState(() => createNodeStore([], pageInitiale.current.id));
  const objets = useMemo(() => listNodeStore(magasinNoeuds), [magasinNoeuds]);
  const setObjets = useCallback((action) => setMagasinNoeuds((courant) => {
    const liste = listNodeStore(courant);
    const suivante = typeof action === "function" ? action(liste) : action;
    return replaceNodeStore(courant, suivante);
  }), []);
  const objetsHierarchiques = useMemo(() => {
    const resultat = [];
    const visiter = (identifiant, parentX = 0, parentY = 0, profondeur = 0) => {
      const objet = magasinNoeuds.nodes[identifiant];
      if (!objet) return;
      const monde = { ...objet, x: parentX + objet.x, y: parentY + objet.y, profondeur };
      resultat.push(monde);
      objet.children.forEach((enfant) => visiter(enfant, monde.x, monde.y, profondeur + 1));
    };
    magasinNoeuds.rootIds.forEach((identifiant) => visiter(identifiant));
    return resultat;
  }, [magasinNoeuds]);
  const objetMonde = useCallback((identifiant) => objetsHierarchiques.find((objet) => objet.id === identifiant) || null, [objetsHierarchiques]);
  const [selectionIds, setSelectionIds] = useState([]);
  const selection = selectionIds.at(-1) || null;
  const setSelection = useCallback((identifiant) => setSelectionIds(identifiant ? [identifiant] : []), []);
  const [outil, setOutil] = useState("selection");
  const [ongletGauche, setOngletGauche] = useState("calques");
  const [ongletDroit, setOngletDroit] = useState("design");
  const [fond, setFond] = useState("#ffffff");
  const [fondTransparent, setFondTransparent] = useState(true);
  const [depotActif, setDepotActif] = useState(false);
  const [largeurPlan, setLargeurPlan] = useState(LARGEUR_INITIALE);
  const [hauteurPlan, setHauteurPlan] = useState(HAUTEUR_INITIALE);
  const [zoom, setZoom] = useState(75);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [guides, setGuides] = useState({ x: null, y: null });
  const [marquee, setMarquee] = useState(null);
  const [historique, setHistorique] = useState({ passe: [], futur: [] });
  const [pinceauCouleur, setPinceauCouleur] = useState("#151515");
  const [pinceauEpaisseur, setPinceauEpaisseur] = useState(6);
  const [recadrageRect, setRecadrageRect] = useState(null);
  const [echelleExport, setEchelleExport] = useState(1);
  const [plumeCouleur, setPlumeCouleur] = useState("#151515");
  const [plumeEpaisseur, setPlumeEpaisseur] = useState(4);
  const [plumeRempli, setPlumeRempli] = useState(false);
  const [plumeCouleurRempli, setPlumeCouleurRempli] = useState("#7c6cff");
  const [tracePlume, setTracePlume] = useState(null);
  const [curseurPlume, setCurseurPlume] = useState(null);
  const [reglesVisibles, setReglesVisibles] = useState(false);
  const [guideEnCours, setGuideEnCours] = useState(null);
  const [editionTexteId, setEditionTexteId] = useState(null);
  const [editionNoeudsId, setEditionNoeudsId] = useState(null);
  const [modeContour, setModeContour] = useState(false);
  const [tailleScene, setTailleScene] = useState({ largeur: 0, hauteur: 0 });
  const [toast, setToast] = useState(null);
  const [aideVisible, setAideVisible] = useState(false);
  const [menuContextuel, setMenuContextuel] = useState(null);
  const [menuOutils, setMenuOutils] = useState(null);
  const [renommageId, setRenommageId] = useState(null);
  const [valeurRenommage, setValeurRenommage] = useState("");
  const [paletteOuverte, setPaletteOuverte] = useState(false);
  const [recherchePalette, setRecherchePalette] = useState("");
  const [indexPalette, setIndexPalette] = useState(0);
  const [detourageTolerance, setDetourageTolerance] = useState(40);
  const [detourageAdoucissement, setDetourageAdoucissement] = useState(35);
  const [detourageCouleur, setDetourageCouleur] = useState("#ffffff");
  const [detourageContigue, setDetourageContigue] = useState(false);
  const [restaurationRayon, setRestaurationRayon] = useState(24);
  const [fondRemplacementCouleur, setFondRemplacementCouleur] = useState("#ffffff");
  const [flouFondRayon, setFlouFondRayon] = useState(18);
  const [curseurRestauration, setCurseurRestauration] = useState(null);
  const [nomDesign, setNomDesign] = useState("Sans titre");
  const [statutSauvegarde, setStatutSauvegarde] = useState("enregistre");
  const [renommagePage, setRenommagePage] = useState(null);
  const [valeurRenommagePage, setValeurRenommagePage] = useState("");

  const actif = objets.find((objet) => objet.id === selection) || null;
  const actifMonde = selection ? objetMonde(selection) : null;
  const editionNoeud = editionNoeudsId ? magasinNoeuds.nodes[editionNoeudsId] || null : null;
  const editionMonde = editionNoeud ? objetMonde(editionNoeud.id) : null;
  const selectionMonde = useMemo(() => objetsHierarchiques.filter((objet) => selectionIds.includes(objet.id)), [objetsHierarchiques, selectionIds]);
  const boundsSelection = useMemo(() => {
    if (!selectionMonde.length) return null;
    const x = Math.min(...selectionMonde.map((objet) => objet.x));
    const y = Math.min(...selectionMonde.map((objet) => objet.y));
    const droite = Math.max(...selectionMonde.map((objet) => objet.x + objet.largeur));
    const bas = Math.max(...selectionMonde.map((objet) => objet.y + objet.hauteur));
    return { x, y, largeur: droite - x, hauteur: bas - y };
  }, [selectionMonde]);
  const guidesCourantes = pages.find((page) => page.id === pageActive)?.guides || { h: [], v: [] };
  const majGuides = (transforme) => setPages((liste) => liste.map((page) => page.id === pageActive ? { ...page, guides: transforme(page.guides || { h: [], v: [] }) } : page));
  // L'axe désigne l'orientation du guide créé : « v » = ligne verticale
  // tirée depuis la règle du haut, elle contraint x.
  const demarrerGuide = (event, axe) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    guideDrag.current = { axe, pointerId: event.pointerId };
    setGuideEnCours({ axe, pos: position(event)[axe === "v" ? "x" : "y"] });
  };
  const bougerGuide = (event) => {
    if (!guideDrag.current || guideDrag.current.pointerId !== event.pointerId) return;
    setGuideEnCours({ axe: guideDrag.current.axe, pos: position(event)[guideDrag.current.axe === "v" ? "x" : "y"] });
  };
  const finirGuide = (event) => {
    const drag = guideDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    guideDrag.current = null;
    if (event.currentTarget.hasPointerCapture?.(drag.pointerId)) event.currentTarget.releasePointerCapture(drag.pointerId);
    const pos = position(event)[drag.axe === "v" ? "x" : "y"];
    const limite = drag.axe === "v" ? largeurPlan : hauteurPlan;
    if (pos >= 0 && pos <= limite) majGuides((guides) => ({ ...guides, [drag.axe]: [...guides[drag.axe], Math.round(pos)] }));
    setGuideEnCours(null);
  };
  const effacerGuides = () => {
    majGuides(() => ({ h: [], v: [] }));
    afficherToast("Guides effacés");
  };
  const capturerPage = useCallback(() => ({ id: pageActive, nom: pages.find((page) => page.id === pageActive)?.nom || "Scène", largeur: largeurPlan, hauteur: hauteurPlan, fond, fondTransparent, objets: copieObjets(objets), guides: pages.find((page) => page.id === pageActive)?.guides || { h: [], v: [] } }), [fond, fondTransparent, hauteurPlan, largeurPlan, objets, pageActive, pages]);
  const chargerPage = (page) => {
    setMagasinNoeuds(createNodeStore(copieObjets(page.objets || []), page.id));
    setLargeurPlan(page.largeur || LARGEUR_INITIALE);
    setHauteurPlan(page.hauteur || HAUTEUR_INITIALE);
    setFond(page.fond || "#ffffff");
    setFondTransparent(page.fondTransparent !== false);
    setSelection(null);
    setEditionTexteId(null);
    setEditionNoeudsId(null);
    setMenuContextuel(null);
    setHistorique({ passe: [], futur: [] });
  };
  const changerPage = (identifiant) => {
    if (identifiant === pageActive) return;
    const cible = pages.find((page) => page.id === identifiant);
    if (!cible) return;
    const courante = capturerPage();
    setPages((liste) => liste.map((page) => page.id === pageActive ? courante : page));
    setPageActive(identifiant);
    chargerPage(cible);
  };
  const nouvellePage = () => {
    const courante = capturerPage();
    const nouvelle = { id: id(), nom: `Scène ${pages.length + 1}`, largeur: LARGEUR_INITIALE, hauteur: HAUTEUR_INITIALE, fond: "#ffffff", fondTransparent: true, objets: [], guides: { h: [], v: [] } };
    setPages((liste) => [...liste.map((page) => page.id === pageActive ? courante : page), nouvelle]);
    setPageActive(nouvelle.id);
    chargerPage(nouvelle);
  };
  const supprimerPage = (identifiant) => {
    if (pages.length <= 1) return;
    const restantes = pages.filter((page) => page.id !== identifiant);
    setPages(restantes);
    if (identifiant === pageActive) {
      setPageActive(restantes[0].id);
      chargerPage(restantes[0]);
    }
  };
  const formatActif = FORMATS_PRESETS.find((format) => format.largeur === largeurPlan && format.hauteur === hauteurPlan);
  // Preset canal : la scène change de dimensions, la page courant aussi —
  // l'export multi-pages et la sauvegarde lisent les dims de la page.
  const appliquerFormat = (identifiant) => {
    const format = FORMATS_PRESETS.find((f) => f.id === identifiant);
    if (!format) return;
    setLargeurPlan(format.largeur);
    setHauteurPlan(format.hauteur);
    setPages((liste) => liste.map((page) => page.id === pageActive ? { ...page, largeur: format.largeur, hauteur: format.hauteur } : page));
    afficherToast(`Format « ${format.nom} » appliqué`);
  };
  // Modèle : fabrique une scène complète (identifiants frais) — remplace
  // la scène courante (confirmé) ou s'ajoute comme nouvelle scène.
  const appliquerModele = async (modele, nouvelleScene) => {
    if (!nouvelleScene) {
      const ok = await modal.confirm({
        title: "Appliquer le modèle",
        message: `Remplacer le contenu de « ${pages.find((page) => page.id === pageActive)?.nom || "la scène"} » par « ${modele.nom} » ?`,
        detail: "Le contenu actuel de la scène sera remplacé.",
        confirmLabel: "Remplacer",
        danger: true,
      });
      if (!ok) return;
    }
    const page = { id: id(), nom: modele.nom, largeur: modele.largeur, hauteur: modele.hauteur, fond: "#ffffff", fondTransparent: false, objets: modele.fabriquer(), guides: { h: [], v: [] } };
    if (nouvelleScene) {
      const courante = capturerPage();
      setPages((liste) => [...liste.map((p) => p.id === pageActive ? courante : p), page]);
    } else {
      setPages((liste) => liste.map((p) => p.id === pageActive ? page : p));
    }
    setPageActive(page.id);
    chargerPage(page);
    setHistorique({ passe: [], futur: [] });
    afficherToast(`Modèle « ${modele.nom} » appliqué`);
  };
  // Duplication avec nouveaux identifiants (page + éléments + relations),
  // insérée juste après la source.
  const dupliquerPageAction = (identifiant) => {
    const source = pages.find((page) => page.id === identifiant);
    if (!source) return;
    const base = identifiant === pageActive ? capturerPage() : source;
    const copie = dupliquerPage(pageDepuisObjets(base));
    const runtime = pageVersObjets(copie);
    const index = pages.findIndex((page) => page.id === identifiant);
    const liste = [...pages];
    liste.splice(index + 1, 0, runtime);
    setPages(liste);
    setPageActive(copie.id);
    chargerPage(runtime);
    afficherToast(`« ${copie.name} » dupliquée`);
  };
  const basculerPageCachee = (identifiant) => setPages((liste) => liste.map((page) => page.id === identifiant ? { ...page, cachee: !page.cachee } : page));
  const renommerPage = (identifiant, valeur) => setPages((liste) => liste.map((page) => page.id === identifiant ? { ...page, nom: valeur.trim() || page.nom } : page));

  const modifier = useCallback((transformation, memoriser = true) => {
    setObjets((courants) => {
      const suivants = typeof transformation === "function" ? transformation(courants) : transformation;
      if (memoriser) setHistorique((h) => ({ passe: [...h.passe.slice(-39), copieObjets(courants)], futur: [] }));
      return suivants;
    });
  }, [setObjets]);
  const memoriserReglage = () => setHistorique((h) => ({ passe: [...h.passe.slice(-39), copieObjets(objets)], futur: [] }));

  // Le trait de pinceau stocke ses points normalisés (0..1) dans une boîte
  // qui grandit au fil du geste : redimensionner le calque garde donc les
  // proportions du dessin.
  const majTraitPinceau = (mouvement) => {
    const xs = mouvement.pointsAbs.map((pt) => pt.x);
    const ys = mouvement.pointsAbs.map((pt) => pt.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const largeur = Math.max(1, Math.max(...xs) - minX);
    const hauteur = Math.max(1, Math.max(...ys) - minY);
    const points = mouvement.pointsAbs.map((pt) => ({ px: (pt.x - minX) / largeur, py: (pt.y - minY) / hauteur }));
    setObjets((liste) => liste.map((o) => o.id === mouvement.id ? { ...o, x: minX - mouvement.parentOffset.x, y: minY - mouvement.parentOffset.y, largeur, hauteur, points } : o));
  };

  const supprimerObjetParId = (identifiant) => setObjets((liste) => liste.filter((objet) => objet.id !== identifiant).map((objet) => ({ ...objet, children: objet.children.filter((enfant) => enfant !== identifiant) })));

  // La boîte englobante du tracé couvre aussi les poignées : une courbe qui
  // déborde des ancres ne doit jamais être coupée par le viewBox du SVG.
  const majTracePlume = (traceId, pointsAbs, ferme = false) => {
    if (!pointsAbs.length) return;
    const xs = [];
    const ys = [];
    pointsAbs.forEach((pt) => {
      xs.push(pt.x);
      ys.push(pt.y);
      if (pt.hax != null) { xs.push(pt.hax); ys.push(pt.hay); }
      if (pt.hbx != null) { xs.push(pt.hbx); ys.push(pt.hby); }
    });
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const largeur = Math.max(1, Math.max(...xs) - minX);
    const hauteur = Math.max(1, Math.max(...ys) - minY);
    const points = pointsAbs.map((pt) => ({
      px: (pt.x - minX) / largeur,
      py: (pt.y - minY) / hauteur,
      ax: pt.hax == null ? null : (pt.hax - minX) / largeur,
      ay: pt.hay == null ? null : (pt.hay - minY) / hauteur,
      bx: pt.hbx == null ? null : (pt.hbx - minX) / largeur,
      by: pt.hby == null ? null : (pt.hby - minY) / hauteur,
    }));
    setObjets((liste) => liste.map((o) => o.id === traceId ? { ...o, x: minX, y: minY, largeur, hauteur, points, ferme } : o));
  };
  const terminerPlume = (fermeForcee = false) => {
    const trace = tracePlume;
    if (!trace) return;
    const ferme = trace.ferme || fermeForcee;
    setTracePlume(null);
    setCurseurPlume(null);
    if (trace.pointsAbs.length >= (ferme ? 3 : 2)) {
      majTracePlume(trace.id, trace.pointsAbs, ferme);
      setHistorique((h) => ({ passe: [...h.passe.slice(-39), trace.origine], futur: [] }));
      setSelection(trace.id);
    } else supprimerObjetParId(trace.id);
  };
  const annulerPlume = () => {
    const trace = tracePlume;
    if (!trace) return;
    setTracePlume(null);
    setCurseurPlume(null);
    supprimerObjetParId(trace.id);
  };
  // Réglages appliqués en direct pendant qu'un tracé est en cours.
  const majTraceLive = (champs) => {
    if (!tracePlume) return;
    setObjets((liste) => liste.map((o) => o.id === tracePlume.id ? { ...o, ...champs } : o));
  };

  // Retour utilisateur non bloquant : export, sauvegarde, style…
  const afficherToast = (texte, erreur = false) => {
    clearTimeout(minuteToast.current);
    setToast({ texte, id: id(), erreur });
    minuteToast.current = setTimeout(() => setToast(null), 2600);
  };

  const rendre = useCallback(() => {
    const surface = canvas.current;
    if (!surface) return;
    const ctx = surface.getContext("2d");
    ctx.clearRect(0, 0, largeurPlan, hauteurPlan);
  }, [hauteurPlan, largeurPlan]);

  useEffect(() => {
    let attente = false;
    objets.filter((o) => o.type === "image").forEach((objet) => {
      if (cacheImages.current.has(objet.src)) return;
      const image = new Image();
      image.onload = rendre;
      image.src = objet.src;
      cacheImages.current.set(objet.src, image);
      attente = true;
    });
    if (!attente) {
      cancelAnimationFrame(dessinProgramme.current);
      dessinProgramme.current = requestAnimationFrame(rendre);
    }
    return () => cancelAnimationFrame(dessinProgramme.current);
  }, [objets, fond, rendre]);

  const importer = (fichier, point = null, decalage = 0) => {
    if (!fichier?.type.startsWith("image/")) return;
    const lecteur = new FileReader();
    lecteur.onload = () => {
      const image = new Image();
      image.onload = () => {
        const facteur = Math.min(1, 820 / image.width, 520 / image.height);
        const parent = point ? [...objetsHierarchiques].reverse().find((o) => o.type === "frame" && point.x >= o.x && point.x <= o.x + o.largeur && point.y >= o.y && point.y <= o.y + o.hauteur) : null;
        const mondeX = point ? point.x - image.width * facteur / 2 + decalage : (largeurPlan - image.width * facteur) / 2;
        const mondeY = point ? point.y - image.height * facteur / 2 + decalage : (hauteurPlan - image.height * facteur) / 2;
        const objet = {
          id: id(), type: "image", nom: fichier.name, src: lecteur.result,
          x: mondeX - (parent?.x || 0), y: mondeY - (parent?.y || 0),
          largeur: image.width * facteur, hauteur: image.height * facteur,
          rotation: 0, opacite: 1, visible: true, filtres: { ...filtreNeutre }, parentId: parent?.id || null, children: [], sceneId: pageActive,
        };
        cacheImages.current.set(objet.src, image);
        modifier((liste) => [...liste.map((o) => o.id === parent?.id ? { ...o, children: [...o.children, objet.id] } : o), objet]);
        setSelection(objet.id);
      };
      image.src = lecteur.result;
    };
    lecteur.readAsDataURL(fichier);
  };
  const deposerFichiers = (event) => {
    event.preventDefault();
    setDepotActif(false);
    const point = position(event);
    Array.from(event.dataTransfer?.files || []).filter((fichier) => fichier.type.startsWith("image/")).forEach((fichier, index) => importer(fichier, point, index * 24));
  };
  // Double-clic sur un texte : un textarea superposé, calqué sur le calque
  // (mêmes styles, mêmes pourcentages), hérite donc du zoom du plan.
  const surDoubleClic = (event) => {
    const p = position(event);
    const trouve = [...objetsHierarchiques].reverse().find((o) => o.visible && !o.verrouille && p.x >= o.x && p.x <= o.x + o.largeur && p.y >= o.y && p.y <= o.y + o.hauteur);
    if (!trouve) return;
    setOutil("selection");
    setSelection(trouve.id);
    if (trouve.type === "texte") {
      memoriserReglage();
      ajusterHauteurTexte(trouve.id, trouve.texte);
      setEditionTexteId(trouve.id);
      return;
    }
    if (trouve.type === "plume" || trouve.type === "forme") entrerEditionNoeuds(trouve);
  };
  // Pendant l'édition directe, la hauteur du bloc épouse le nombre de
  // lignes réellement tapées.
  const ajusterHauteurTexte = (identifiant, valeur) => {
    const objet = magasinNoeuds.nodes[identifiant];
    if (!objet || objet.type !== "texte") return;
    const lignes = String(valeur ?? "").split("\n").length;
    const hauteur = Math.max(30, Math.round(lignes * (objet.taille || 24) * (objet.interligne || 1.15)));
    if (hauteur !== objet.hauteur) modifier((liste) => liste.map((o) => o.id === identifiant ? { ...o, hauteur } : o), false);
  };
  const ajusterLargeurTexte = () => {
    if (!actif || actif.type !== "texte") return;
    majActif("largeur", Math.max(40, Math.min(2000, mesurerLargeurTexte(actif.texte, actif))));
  };

  // ---- Édition de nœuds (vecteurs) -------------------------------------
  // Les ancres sont manipulées en coordonnées du monde puis re-normalisées
  // par majTracePlume : le calque garde une boîte toujours juste.
  const ancresAbsolues = (objet, monde) => (objet.points || []).map((pt) => ({
    x: monde.x + pt.px * objet.largeur,
    y: monde.y + pt.py * objet.hauteur,
    ...(pt.ax != null ? { hax: monde.x + pt.ax * objet.largeur, hay: monde.y + pt.ay * objet.hauteur } : {}),
    ...(pt.bx != null ? { hbx: monde.x + pt.bx * objet.largeur, hby: monde.y + pt.by * objet.hauteur } : {}),
  }));
  // Double-clic sur une forme paramétrique la vectorise d'abord : triangle,
  // étoile et ligne deviennent des tracés plume éditables point par point.
  const entrerEditionNoeuds = (cible) => {
    const monde = objetsHierarchiques.find((o) => o.id === cible.id);
    if (!monde) return;
    let objet = magasinNoeuds.nodes[cible.id];
    if (!objet) return;
    if (objet.type === "forme") {
      const geo = geometrieAncres(objet);
      if (!geo) {
        afficherToast("Cette forme reste paramétrique — rayon et proportions se règlent à l'inspecteur.");
        return;
      }
      objet = { ...objet, type: "plume", couleur: objet.contour || "#151515", rempli: geo.ferme, couleurRempli: objet.couleur, ferme: geo.ferme };
      modifier((liste) => liste.map((o) => o.id === objet.id ? objet : o), false);
    }
    if (objet.type !== "plume") return;
    majTracePlume(objet.id, ancresAbsolues(objet, monde), Boolean(objet.ferme));
    setEditionNoeudsId(objet.id);
  };
  const demarrerGesteNoeud = (event, index, role) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const objet = magasinNoeuds.nodes[editionNoeudsId];
    const monde = objetMonde(editionNoeudsId);
    if (!objet || !monde || objet.type !== "plume") return;
    glisse.current = { mode: "ancreEdit", pointerId: event.pointerId, traceId: objet.id, ferme: Boolean(objet.ferme), index, role, pointsAbs: ancresAbsolues(objet, monde), origine: copieObjets(objets) };
  };
  const supprimerAncre = (index) => {
    const objet = magasinNoeuds.nodes[editionNoeudsId];
    const monde = objetMonde(editionNoeudsId);
    if (!objet || !monde || objet.type !== "plume") return;
    const points = ancresAbsolues(objet, monde);
    if (points.length <= (objet.ferme ? 3 : 2)) return;
    points.splice(index, 1);
    majTracePlume(objet.id, points, Boolean(objet.ferme));
  };
  // Insertion au milieu du segment visé ; sur un tracé fermé le dernier
  // segment referme vers l'ancre initiale.
  const ajouterAncre = (index) => {
    const objet = magasinNoeuds.nodes[editionNoeudsId];
    const monde = objetMonde(editionNoeudsId);
    if (!objet || !monde || objet.type !== "plume") return;
    const points = ancresAbsolues(objet, monde);
    const suivant = (index + 1) % points.length;
    const a = points[index];
    const b = points[suivant];
    points.splice(index + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    majTracePlume(objet.id, points, Boolean(objet.ferme));
  };
  // Menu contextuel du canvas : actions sur l'objet visé, ou globales si le
  // clic tombe dans le vide. Les coordonnées sont relatives à la scène.
  const surContextMenu = (event) => {
    event.preventDefault();
    const rect = scene.current?.getBoundingClientRect();
    if (!rect) return;
    const p = position(event);
    const cible = [...objetsHierarchiques].reverse().find((o) => o.visible && !o.verrouille && p.x >= o.x && p.x <= o.x + o.largeur && p.y >= o.y && p.y <= o.y + o.hauteur) || null;
    if (cible && !selectionIds.includes(cible.id)) setSelection(cible.id);
    else if (!cible) setMenuContextuel(null);
    const items = [];
    if (cible) {
      items.push(
        { libelle: "Dupliquer", raccourci: "Ctrl+D", action: dupliquer, disabled: !actif },
        { libelle: "Copier", raccourci: "Ctrl+C", action: commandes.current.copier },
        { libelle: "Copier le style", raccourci: "Ctrl+Alt+C", action: copierStyle },
        { libelle: "Coller le style", raccourci: "Ctrl+Alt+V", action: collerStyle, disabled: !presseStyle.current },
      );
      if (cible.type === "image") items.push({ libelle: "Recadrer", raccourci: "C", action: () => { setSelection(cible.id); setOutil("recadrage"); } });
      if (cible.type === "texte") items.push({ libelle: "Modifier le texte", action: () => { setSelection(cible.id); memoriserReglage(); setEditionTexteId(cible.id); } });
      if (selectionIds.length > 1) items.push({ libelle: "Grouper", raccourci: "Ctrl+G", action: grouperSelection });
      if (cible.type === "group") items.push({ libelle: "Dissocier", raccourci: "Ctrl+Maj+G", action: dissocierGroupe });
      items.push(
        { libelle: "Premier plan", raccourci: "]", action: () => ordreExtreme(false) },
        { libelle: "Arrière-plan", raccourci: "[", action: () => ordreExtreme(true) },
        { libelle: "Supprimer", raccourci: "Suppr", action: supprimer, danger: true },
      );
    } else {
      if (pressePapier.current?.elements?.length) items.push({ libelle: "Coller", raccourci: "Ctrl+V", action: commandes.current.coller });
      items.push(
        { libelle: "Tout sélectionner", raccourci: "Ctrl+A", action: commandes.current.toutSelectionner, disabled: !objets.length },
        { libelle: "Ajuster à l'écran", raccourci: "0", action: ajusterEcran },
      );
      if ((guidesCourantes.h.length || guidesCourantes.v.length)) items.push({ libelle: "Effacer les guides", action: effacerGuides });
      items.push({ libelle: "Nouvelle session vierge", danger: true, action: reinitialiserSession });
    }
    setMenuContextuel({
      x: Math.min(event.clientX - rect.left, rect.width - 210),
      y: Math.min(event.clientY - rect.top, rect.height - Math.min(items.length * 29 + 14, rect.height - 20)),
      items,
    });
  };

  const ajouterTexte = () => {
    const centre = centreCreation();
    const parent = [...objetsHierarchiques].reverse().find((o) => o.type === "frame" && centre.x >= o.x && centre.x <= o.x + o.largeur && centre.y >= o.y && centre.y <= o.y + o.hauteur) || null;
    const objet = { id: id(), type: "texte", nom: "Texte", texte: "Votre texte", x: centre.x - 250 - (parent?.x || 0), y: centre.y - 40 - (parent?.y || 0), largeur: 500, hauteur: 80, taille: 52, police: "Arial", gras: true, couleur: "#151515", rotation: 0, opacite: 1, visible: true, parentId: parent?.id || null, children: [], sceneId: pageActive };
    modifier((liste) => [...liste.map((o) => o.id === parent?.id ? { ...o, children: [...o.children, objet.id] } : o), objet]);
    setSelection(objet.id);
  };
  const majActif = (champ, valeur, memoriser = true) => modifier((liste) => liste.map((o) => o.id === selection ? { ...o, [champ]: valeur } : o), memoriser);
  const majFiltre = (champ, valeur, memoriser = true) => modifier((liste) => liste.map((o) => o.id === selection ? { ...o, filtres: { ...o.filtres, [champ]: valeur } } : o), memoriser);
  const supprimer = () => {
    if (!selectionIds.length) return;
    const ids = new Set(selectionIds);
    const collecter = (identifiant) => magasinNoeuds.nodes[identifiant]?.children.forEach((enfant) => { ids.add(enfant); collecter(enfant); });
    selectionIds.forEach(collecter);
    modifier((liste) => liste.filter((o) => !ids.has(o.id)).map((o) => ({ ...o, children: o.children.filter((enfant) => !ids.has(enfant)) })));
    setSelection(null);
  };
  const deplacerCalque = (pas) => modifier((liste) => {
    const index = liste.findIndex((o) => o.id === selection);
    const cible = Math.max(0, Math.min(liste.length - 1, index + pas));
    if (index < 0 || cible === index) return liste;
    const copieListe = [...liste];
    const [objet] = copieListe.splice(index, 1);
    copieListe.splice(cible, 0, objet);
    return copieListe;
  });
  // Clone un sous-arbre entier dans `branche` et renvoie l'id de la racine
  // clonée. Sert à la duplication classique comme au Alt+glisser.
  const clonerBranche = (branche, identifiant, parentId = null, racine = false) => {
    const source = magasinNoeuds.nodes[identifiant];
    if (!source) return null;
    const nouvelId = id();
    const copie = {
      ...copieObjet(source),
      id: nouvelId,
      parentId,
      children: [],
      nom: racine ? `${source.nom} copie` : source.nom,
      x: source.x + (racine ? 24 : 0),
      y: source.y + (racine ? 24 : 0),
    };
    branche.push(copie);
    copie.children = source.children.map((enfant) => clonerBranche(branche, enfant, nouvelId)).filter(Boolean);
    return nouvelId;
  };
  const dupliquer = () => {
    if (!actif) return;
    const branche = [];
    const nouvelId = clonerBranche(branche, actif.id, actif.parentId, true);
    modifier((liste) => [...liste.map((objet) => objet.id === actif.parentId ? { ...objet, children: [...objet.children, nouvelId] } : objet), ...branche]);
    setSelection(nouvelId);
  };
  const grouperSelection = () => {
    if (selectionIds.length < 2 || !boundsSelection) return;
    const selectionnes = selectionIds.map((identifiant) => magasinNoeuds.nodes[identifiant]).filter(Boolean);
    const parentId = selectionnes[0]?.parentId || null;
    if (selectionnes.some((objet) => objet.parentId !== parentId)) return;
    const parentMonde = parentId ? objetMonde(parentId) : null;
    const group = { id: id(), type: "group", nom: "Groupe", x: boundsSelection.x - (parentMonde?.x || 0), y: boundsSelection.y - (parentMonde?.y || 0), largeur: boundsSelection.largeur, hauteur: boundsSelection.hauteur, rotation: 0, opacite: 1, visible: true, verrouille: false, parentId, children: [...selectionIds], sceneId: pageActive };
    modifier((liste) => [...liste.map((objet) => {
      if (selectionIds.includes(objet.id)) {
        const monde = objetMonde(objet.id);
        return { ...objet, parentId: group.id, x: monde.x - boundsSelection.x, y: monde.y - boundsSelection.y };
      }
      if (objet.id === parentId) return { ...objet, children: [...objet.children.filter((enfant) => !selectionIds.includes(enfant)), group.id] };
      return objet;
    }), group]);
    setSelection(group.id);
  };
  const dissocierGroupe = () => {
    if (!actif || actif.type !== "group") return;
    const enfants = [...actif.children];
    modifier((liste) => liste.filter((objet) => objet.id !== actif.id).map((objet) => {
      if (enfants.includes(objet.id)) return { ...objet, parentId: actif.parentId, x: actif.x + objet.x, y: actif.y + objet.y };
      if (objet.id === actif.parentId) return { ...objet, children: [...objet.children.filter((enfant) => enfant !== actif.id), ...enfants] };
      return objet;
    }));
    setSelectionIds(enfants);
  };
  const alignerSelection = (mode) => {
    if (selectionIds.length < 2 || !boundsSelection) return;
    modifier((liste) => liste.map((objet) => {
      if (!selectionIds.includes(objet.id)) return objet;
      const monde = objetMonde(objet.id);
      let cibleX = monde.x;
      let cibleY = monde.y;
      if (mode === "gauche") cibleX = boundsSelection.x;
      if (mode === "centreH") cibleX = boundsSelection.x + (boundsSelection.largeur - monde.largeur) / 2;
      if (mode === "droite") cibleX = boundsSelection.x + boundsSelection.largeur - monde.largeur;
      if (mode === "haut") cibleY = boundsSelection.y;
      if (mode === "centreV") cibleY = boundsSelection.y + (boundsSelection.hauteur - monde.hauteur) / 2;
      if (mode === "bas") cibleY = boundsSelection.y + boundsSelection.hauteur - monde.hauteur;
      return { ...objet, x: objet.x + cibleX - monde.x, y: objet.y + cibleY - monde.y };
    }));
  };
  const distribuerSelection = (axe) => {
    if (selectionIds.length < 3 || !boundsSelection) return;
    const tries = [...selectionMonde].sort((a, b) => axe === "h" ? a.x - b.x : a.y - b.y);
    const total = tries.reduce((somme, objet) => somme + (axe === "h" ? objet.largeur : objet.hauteur), 0);
    const espace = ((axe === "h" ? boundsSelection.largeur : boundsSelection.hauteur) - total) / (tries.length - 1);
    let curseur = axe === "h" ? boundsSelection.x : boundsSelection.y;
    const cibles = new Map();
    tries.forEach((objet) => { cibles.set(objet.id, curseur); curseur += (axe === "h" ? objet.largeur : objet.hauteur) + espace; });
    modifier((liste) => liste.map((objet) => {
      const monde = objetMonde(objet.id);
      if (!cibles.has(objet.id) || !monde) return objet;
      return axe === "h" ? { ...objet, x: objet.x + cibles.get(objet.id) - monde.x } : { ...objet, y: objet.y + cibles.get(objet.id) - monde.y };
    }));
  };
  // Ordre Z extrême : la liste est l'ordre de peinture, premier élément en
  // arrière. Les objets déplacés gardent leur ordre relatif entre eux.
  const ordreExtreme = (auFond) => {
    if (!selectionIds.length) return;
    modifier((liste) => {
      const deplaces = liste.filter((objet) => selectionIds.includes(objet.id));
      const restants = liste.filter((objet) => !selectionIds.includes(objet.id));
      return auFond ? [...deplaces, ...restants] : [...restants, ...deplaces];
    });
  };
  const zoomSelection = () => {
    if (!boundsSelection) return;
    const rect = scene.current?.getBoundingClientRect();
    if (!rect || rect.width < 200 || rect.height < 200) return;
    const zoomCible = Math.max(10, Math.min(400, Math.min((rect.width - 160) / boundsSelection.largeur, (rect.height - 160) / boundsSelection.hauteur) * 100));
    const echelle = zoomCible / 100;
    setPan({ x: -(boundsSelection.x + boundsSelection.largeur / 2 - largeurPlan / 2) * echelle, y: -(boundsSelection.y + boundsSelection.hauteur / 2 - hauteurPlan / 2) * echelle });
    setZoom(zoomCible);
  };

  // Navigation clavier dans la hiérarchie, à la Figma : Tab circule parmi
  // les frères visibles, Entree descend dans un groupe ou une frame,
  // Échap remonte d'un niveau avant de tout désélectionner.
  const friser = (sens) => {
    const courantId = selectionIds.at(-1);
    const parentId = courantId ? magasinNoeuds.nodes[courantId]?.parentId ?? null : null;
    const ids = objetsHierarchiques.filter((objet) => objet.parentId === parentId && objet.visible !== false && !objet.verrouille).map((objet) => objet.id);
    if (!ids.length) return;
    const index = courantId ? ids.indexOf(courantId) : -1;
    setSelection(index < 0 ? ids[sens > 0 ? 0 : ids.length - 1] : ids[(index + sens + ids.length) % ids.length]);
  };
  const friseEntrer = () => {
    if (!actif?.children.length) return;
    const enfant = [...actif.children].reverse().find((identifiant) => {
      const noeud = magasinNoeuds.nodes[identifiant];
      return noeud && noeud.visible !== false && !noeud.verrouille;
    });
    if (enfant) setSelection(enfant);
  };
  const friseRemonter = () => {
    if (selectionMonde.length === 1 && selectionMonde[0].parentId) setSelection(selectionMonde[0].parentId);
    else { setSelection(null); setOutil("selection"); }
  };

  // Copier/coller le style : les champs par type vivent dans
  // logique/recadrage.js (champsSpecifiques / CHAMPS_APPLICABLES).
  const copierStyle = () => {
    if (!actif) return;
    presseStyle.current = {
      type: actif.type,
      valeurs: {
        opacite: actif.opacite,
        fusion: actif.fusion,
        ombre: actif.ombre ? { ...actif.ombre } : undefined,
        ...(champsSpecifiques[actif.type]?.(actif) || {}),
        ...(actif.filtres ? { filtres: { ...actif.filtres } } : {}),
      },
    };
    afficherToast("Style copié");
  };
  const collerStyle = () => {
    const source = presseStyle.current;
    if (!source || !selectionIds.length) return;
    modifier((liste) => liste.map((objet) => {
      if (!selectionIds.includes(objet.id) || objet.verrouille) return objet;
      const patch = {};
      (CHAMPS_APPLICABLES[objet.type] || []).forEach((champ) => {
        if (source.valeurs[champ] === undefined) return;
        if (champ === "ombre" && source.valeurs.ombre) patch.ombre = { ...source.valeurs.ombre };
        else if (champ === "filtres" && source.valeurs.filtres) patch.filtres = { ...filtreNeutre, ...source.valeurs.filtres };
        else if (champ === "degrade" && source.valeurs.degrade) patch.degrade = { ...source.valeurs.degrade };
        else if (champ === "rayons" && source.valeurs.rayons) patch.rayons = [...source.valeurs.rayons];
        else patch[champ] = source.valeurs[champ];
      });
      return Object.keys(patch).length ? { ...objet, ...patch } : objet;
    }));
    afficherToast("Style appliqué à la sélection");
  };

  const enregistrerProjet = () => {
    const courante = capturerPage();
    const pagesSauvees = pages.map((page) => page.id === pageActive ? courante : page);
    const docDesign = documentDepuisEtat({ nom: nomDesign, pages: pagesSauvees, pageActive });
    const contenu = JSON.stringify({ format: "companyos-design", version: 1, document: docDesign });
    const url = URL.createObjectURL(new Blob([contenu], { type: "application/json" }));
    const lien = document.createElement("a");
    lien.href = url;
    lien.download = `${slugNom()}.codesign`;
    lien.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    afficherToast(`Projet sauvegardé — ${pagesSauvees.length} scène${pagesSauvees.length > 1 ? "s" : ""}`);
  };
  const ouvrirProjet = (fichier) => {
    if (!fichier) return;
    const lecteur = new FileReader();
    lecteur.onload = () => {
      try {
        const projet = JSON.parse(lecteur.result);
        setHistorique((h) => ({ passe: [...h.passe.slice(-39), copieObjets(objets)], futur: [] }));
        let pagesProjet;
        let identifiant;
        if (projet.format === "companyos-design" && validerDocument(projet.document)) {
          const etat = documentVersEtat(projet.document);
          setNomDesign(etat.nom);
          pagesProjet = etat.pages;
          identifiant = etat.pageActive;
        } else if (projet.format === "companyos-image") {
          setNomDesign((fichier.name || "Design").replace(/\.[^.]+$/, ""));
          pagesProjet = Array.isArray(projet.pages) && projet.pages.length ? projet.pages : [{ id: id(), nom: "Scène 1", largeur: projet.largeur, hauteur: projet.hauteur, fond: projet.fond, fondTransparent: projet.fondTransparent, objets: Array.isArray(projet.objets) ? projet.objets : [] }];
          identifiant = pagesProjet.some((page) => page.id === projet.pageActive) ? projet.pageActive : pagesProjet[0].id;
        } else throw new Error("Format invalide");
        const cible = pagesProjet.find((page) => page.id === identifiant) || pagesProjet[0];
        setPages(pagesProjet);
        setPageActive(cible.id);
        chargerPage({ ...cible, largeur: Math.max(64, Math.min(4096, Number(cible.largeur) || LARGEUR_INITIALE)), hauteur: Math.max(64, Math.min(4096, Number(cible.hauteur) || HAUTEUR_INITIALE)) });
        afficherToast(`Design ouvert — ${pagesProjet.length} scène${pagesProjet.length > 1 ? "s" : ""}`);
      } catch {
        afficherToast("Ce fichier n'est pas un projet Atelier Image valide.", true);
      }
    };
    lecteur.readAsText(fichier);
  };

  const annuler = () => setHistorique((h) => {
    if (!h.passe.length) return h;
    const passe = [...h.passe];
    const precedent = passe.pop();
    setObjets(precedent);
    setSelection(null);
    return { passe, futur: [copieObjets(objets), ...h.futur] };
  });
  const retablir = () => setHistorique((h) => {
    if (!h.futur.length) return h;
    const [suivant, ...futur] = h.futur;
    setObjets(suivant);
    setSelection(null);
    return { passe: [...h.passe, copieObjets(objets)], futur };
  });
  // Voyage temporel : le curseur parcourt tous les états connus, passé et
  // futur confondus, sans jamais perdre la pile d'annulation.
  const voyagerDansTemps = (index) => {
    const total = historique.passe.length + historique.futur.length;
    if (index === historique.passe.length || index < 0 || index > total) return;
    let passe;
    let futur;
    let cible;
    if (index < historique.passe.length) {
      passe = historique.passe.slice(0, index);
      futur = [...historique.passe.slice(index + 1), copieObjets(objets), ...historique.futur];
      cible = historique.passe[index];
    } else {
      const rang = index - historique.passe.length;
      cible = historique.futur[rang - 1];
      passe = [...historique.passe, copieObjets(objets), ...historique.futur.slice(0, rang - 1)];
      futur = historique.futur.slice(rang);
    }
    setHistorique({ passe, futur });
    setObjets(cible);
    setSelection(null);
  };

  const position = (event) => {
    const rect = canvas.current.getBoundingClientRect();
    return screenToWorld({ x: event.clientX, y: event.clientY }, { screenOrigin: { x: rect.left, y: rect.top }, worldOrigin: { x: 0, y: 0 }, scaleX: rect.width / largeurPlan, scaleY: rect.height / hauteurPlan });
  };
  // Conversion monde → écran : sert à tous les indicateurs (sélection,
  // guides, marquee, recadrage) pour qu'ils gardent une épaisseur constante
  // quel que soit le zoom, au lieu de se déformer avec le plan.
  const mondeVersEcran = (x, y) => {
    const echelle = zoom / 100;
    return { x: (x - largeurPlan / 2) * echelle + tailleScene.largeur / 2 + pan.x, y: (y - hauteurPlan / 2) * echelle + tailleScene.hauteur / 2 + pan.y };
  };
  const centreCreation = () => {
    const rectCanvas = canvas.current?.getBoundingClientRect();
    const rectScene = scene.current?.getBoundingClientRect();
    if (!rectCanvas || !rectScene || !rectCanvas.width || !rectCanvas.height) return { x: largeurPlan / 2, y: hauteurPlan / 2 };
    return screenToWorld({ x: rectScene.left + rectScene.width / 2, y: rectScene.top + rectScene.height / 2 }, { screenOrigin: { x: rectCanvas.left, y: rectCanvas.top }, worldOrigin: { x: 0, y: 0 }, scaleX: rectCanvas.width / largeurPlan, scaleY: rectCanvas.height / hauteurPlan });
  };
  const appuyer = (event) => {
    setMenuContextuel(null);
    if (event.button === 2) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    // En mode édition de nœuds, un clic hors des poignées clôt l'édition.
    if (editionNoeudsId) {
      if (!event.target.closest?.(".imgNoeudsApercu")) setEditionNoeudsId(null);
      return;
    }
    if (outil === "main" || event.button === 1) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      glisse.current = { mode: "pan", pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, pan: { ...pan } };
      return;
    }
    const p = position(event);
    if (outil === "pinceau") {
      const parent = [...objetsHierarchiques].reverse().find((o) => o.type === "frame" && o.visible !== false && p.x >= o.x && p.x <= o.x + o.largeur && p.y >= o.y && p.y <= o.y + o.hauteur) || null;
      const trait = { id: id(), type: "dessin", nom: "Trait", points: [], x: p.x - (parent?.x || 0), y: p.y - (parent?.y || 0), largeur: 1, hauteur: 1, couleur: pinceauCouleur, epaisseur: pinceauEpaisseur, rotation: 0, opacite: 1, visible: true, parentId: parent?.id || null, children: [], sceneId: pageActive };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setObjets((liste) => [...liste.map((o) => o.id === parent?.id ? { ...o, children: [...o.children, trait.id] } : o), trait]);
      glisse.current = { id: trait.id, pointerId: event.pointerId, mode: "pinceau", pointsAbs: [{ x: p.x, y: p.y }], parentOffset: { x: parent?.x || 0, y: parent?.y || 0 }, origine: copieObjets(objets) };
      return;
    }
    if (outil === "recadrage") {
      if (!actif || actif.type !== "image" || !actifMonde || actif.verrouille) { setOutil("selection"); return; }
      event.currentTarget.setPointerCapture?.(event.pointerId);
      glisse.current = { mode: "recadrage", pointerId: event.pointerId, depart: p, origine: copieObjets(objets) };
      setRecadrageRect({ x: p.x, y: p.y, largeur: 0, hauteur: 0 });
      return;
    }
    if (outil === "gomme") {
      gommeSurImage(p);
      return;
    }
    if (outil === "pipette") {
      pipetteSurImage(p);
      return;
    }
    if (outil === "restauration") {
      const trouve = imageSurvolee(p);
      if (!trouve) {
        afficherToast("Cliquez sur une image détourée pour restaurer ses pixels.", true);
        return;
      }
      event.currentTarget.setPointerCapture?.(event.pointerId);
      glisse.current = { mode: "restauration", pointerId: event.pointerId, traceId: trouve.id, pointsAbs: [{ x: p.x, y: p.y }], origine: copieObjets(objets) };
      return;
    }
    if (outil === "plume") {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      if (!tracePlume) {
        const objet = { id: id(), type: "plume", nom: "Tracé", points: [], ferme: false, x: p.x, y: p.y, largeur: 1, hauteur: 1, couleur: plumeCouleur, contour: plumeCouleur, epaisseur: plumeEpaisseur, rempli: plumeRempli, couleurRempli: plumeCouleurRempli, rotation: 0, opacite: 1, visible: true, parentId: null, children: [], sceneId: pageActive };
        setObjets((liste) => [...liste, objet]);
        setTracePlume({ id: objet.id, pointsAbs: [{ x: p.x, y: p.y }], ferme: false, origine: copieObjets(objets) });
        glisse.current = { mode: "poignee", pointerId: event.pointerId, traceId: objet.id, index: 0, ancre: { x: p.x, y: p.y }, pointsAbs: [{ x: p.x, y: p.y }] };
        return;
      }
      const premier = tracePlume.pointsAbs[0];
      if (tracePlume.pointsAbs.length > 2 && Math.hypot(p.x - premier.x, p.y - premier.y) <= 8 / (zoom / 100)) {
        terminerPlume(true);
        return;
      }
      const pointsSuivants = [...tracePlume.pointsAbs, { x: p.x, y: p.y }];
      setTracePlume((courante) => ({ ...courante, pointsAbs: pointsSuivants }));
      glisse.current = { mode: "poignee", pointerId: event.pointerId, traceId: tracePlume.id, index: pointsSuivants.length - 1, ancre: { x: p.x, y: p.y }, pointsAbs: pointsSuivants };
      return;
    }
    if (outil === "texte") {
      const parent = [...objetsHierarchiques].reverse().find((o) => o.type === "frame" && o.visible !== false && p.x >= o.x && p.x <= o.x + o.largeur && p.y >= o.y && p.y <= o.y + o.hauteur) || null;
      const objet = { id: id(), type: "texte", nom: "Texte", texte: "Votre texte", x: p.x - 150 - (parent?.x || 0), y: p.y - 24 - (parent?.y || 0), largeur: 300, hauteur: 56, taille: 40, police: "Arial", gras: true, couleur: "#151515", interligne: 1.15, espacement: 0, casse: "aucune", texteContour: { actif: false, couleur: "#000000", epaisseur: 3 }, barre: false, degrade: { actif: false, angle: 90, couleurA: "#f7d774", couleurB: "#a86f1f" }, rotation: 0, opacite: 1, visible: true, parentId: parent?.id || null, children: [], sceneId: pageActive };
      modifier((liste) => [...liste.map((o) => o.id === parent?.id ? { ...o, children: [...o.children, objet.id] } : o), objet]);
      setSelection(objet.id);
      setEditionTexteId(objet.id);
      setOutil("selection");
      return;
    }
    if (OUTILS_FORMES.includes(outil)) {
      const estFrame = outil === "frame";
      const estLigne = outil === "ligne";
      const parent = [...objetsHierarchiques].reverse().find((o) => o.type === "frame" && o.visible !== false && p.x >= o.x && p.x <= o.x + o.largeur && p.y >= o.y && p.y <= o.y + o.hauteur) || null;
      const objet = { id: id(), type: estFrame ? "frame" : "forme", forme: estFrame ? "rectangle" : outil, nom: estFrame ? "Frame" : outil === "ellipse" ? "Ellipse" : outil === "triangle" ? "Triangle" : outil === "etoile" ? "Étoile" : estLigne ? "Ligne" : "Rectangle", x: p.x - (parent?.x || 0), y: p.y - (parent?.y || 0), largeur: 1, hauteur: 1, couleur: estFrame ? "#ffffff" : estLigne ? "transparent" : "#D9D9D9", contour: estFrame ? "#0d99ff" : "#151515", epaisseur: estFrame ? 1 : estLigne ? 4 : 2, rayon: 0, degrade: { actif: false, angle: 90, couleurA: "#ffffff", couleurB: "#0d99ff" }, motif: "aucune", rotation: 0, opacite: 1, visible: true, verrouille: false, parentId: parent?.id || null, children: [], sceneId: pageActive, ...(estFrame ? { clipContent: true } : {}) };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setObjets((liste) => [...liste.map((o) => o.id === parent?.id ? { ...o, children: [...o.children, objet.id] } : o), objet]);
      setSelection(objet.id);
      glisse.current = { id: objet.id, pointerId: event.pointerId, mode: "creation", depart: p, parentOffset: { x: parent?.x || 0, y: parent?.y || 0 }, origine: copieObjets(objets), distance: 0, forme: outil };
      return;
    }
    const trouve = [...objetsHierarchiques].reverse().find((o) => o.visible && !o.verrouille && p.x >= o.x && p.x <= o.x + o.largeur && p.y >= o.y && p.y <= o.y + o.hauteur);
    if (event.shiftKey) {
      if (trouve) setSelectionIds((ids) => ids.includes(trouve.id) ? ids.filter((idObjet) => idObjet !== trouve.id) : [...ids, trouve.id]);
      return;
    }
    const idsDrag = trouve && selectionIds.includes(trouve.id) ? selectionIds : trouve ? [trouve.id] : [];
    if (trouve && !selectionIds.includes(trouve.id)) setSelection(trouve.id);
    if (!trouve) {
      setSelection(null);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      glisse.current = { mode: "marquee", pointerId: event.pointerId, depart: p, origineSelection: [], origine: copieObjets(objets), distance: 0 };
      setMarquee({ x: p.x, y: p.y, largeur: 0, hauteur: 0 });
      return;
    }
    if (trouve && !trouve.verrouille) {
      // Le canvas garde les événements jusqu'au relâchement, même si le
      // curseur en sort. Sans capture, un mouvement rapide abandonnait le
      // calque dans un état intermédiaire et le prochain clic le faisait
      // brusquement sauter.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      let idsDeplacement = idsDrag;
      let positionsDepart = idsDrag.map((identifiant) => ({ id: identifiant, objet: copieObjet(magasinNoeuds.nodes[identifiant]) }));
      const branches = [];
      // Alt+glisser duplique d'abord la sélection (racines uniquement),
      // puis déplace les clones : l'historique garde l'état d'avant copie,
      // un seul Annuler efface donc copies et déplacement.
      if (event.altKey) {
        const racines = idsDrag.filter((identifiant) => {
          let courant = magasinNoeuds.nodes[identifiant]?.parentId;
          while (courant) {
            if (idsDrag.includes(courant)) return false;
            courant = magasinNoeuds.nodes[courant]?.parentId;
          }
          return true;
        });
        racines.forEach((racine) => clonerBranche(branches, racine, magasinNoeuds.nodes[racine]?.parentId ?? null, true));
        if (branches.length) {
          idsDeplacement = branches.map((copie) => copie.id);
          positionsDepart = branches.map((copie) => ({ id: copie.id, objet: copieObjet(copie) }));
          setSelectionIds(idsDeplacement);
          setObjets((liste) => [...liste.map((objet) => {
            const attachees = branches.filter((branche) => branche.parentId === objet.id).map((branche) => branche.id);
            return attachees.length ? { ...objet, children: [...objet.children, ...attachees] } : objet;
          }), ...branches]);
        }
      }
      glisse.current = {
        id: trouve.id,
        pointerId: event.pointerId,
        dx: p.x - trouve.x,
        dy: p.y - trouve.y,
        origine: copieObjets(objets),
        ids: idsDeplacement,
        depart: p,
        positions: positionsDepart,
        mode: "deplacement",
      };
    }
  };
  const commencerRedimensionnement = (event, coin) => {
    if (!actif || !actifMonde || actif.verrouille || !boundsSelection) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const idsTransformables = selectionIds.filter((identifiant) => {
      let parentId = magasinNoeuds.nodes[identifiant]?.parentId;
      while (parentId) {
        if (selectionIds.includes(parentId)) return false;
        parentId = magasinNoeuds.nodes[parentId]?.parentId;
      }
      return true;
    });
    glisse.current = {
      id: actif.id,
      pointerId: event.pointerId,
      mode: idsTransformables.length > 1 ? "redimensionnement-multiple" : "redimensionnement",
      coin,
      depart: position(event),
      objet: copieObjet(actif),
      bounds: { ...boundsSelection },
      elements: idsTransformables.map((identifiant) => ({ local: copieObjet(magasinNoeuds.nodes[identifiant]), monde: copieObjet(objetMonde(identifiant)) })),
      origine: copieObjets(objets),
    };
  };
  const commencerRotation = (event) => {
    if (!actif || !actifMonde || actif.verrouille) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const p = position(event);
    const centre = { x: actifMonde.x + actifMonde.largeur / 2, y: actifMonde.y + actifMonde.hauteur / 2 };
    glisse.current = { id: actif.id, pointerId: event.pointerId, mode: "rotation", centre, angleDepart: Math.atan2(p.y - centre.y, p.x - centre.x) * 180 / Math.PI, rotationDepart: actif.rotation || 0, origine: copieObjets(objets) };
  };
  const commencerRayon = (event, cote) => {
    if (!actif || !actifMonde || actif.verrouille || actif.type !== "forme" || actif.forme !== "rectangle") return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    glisse.current = { id: actif.id, pointerId: event.pointerId, mode: "rayon", cote, objet: copieObjet(actifMonde), origine: copieObjets(objets) };
  };
  // Publie un canvas réécrit comme nouveau src du calque : caches, position
  // préservée (rotation incluse), historique, message optionnel.
  const publierSourceImage = (source, monde, surface, zone, origine, message, conserverOriginal = false) => {
    const nouveauSrc = surface.toDataURL("image/png");
    const nouvelleImage = new Image();
    nouvelleImage.src = nouveauSrc;
    cacheImages.current.set(nouveauSrc, nouvelleImage);
    canvasSources.current.set(nouveauSrc, surface);
    canvasSources.current.delete(source.src);
    const calque = { x: monde.x, y: monde.y, largeur: source.largeur, hauteur: source.hauteur, rotation: source.rotation || 0 };
    const suivante = positionApresRecadrage(calque, zone);
    const parent = source.parentId ? objetMonde(source.parentId) : null;
    if (origine) setHistorique((h) => ({ passe: [...h.passe.slice(-39), origine], futur: [] }));
    modifier((liste) => liste.map((o) => o.id === source.id ? { ...o, src: nouveauSrc, ...(conserverOriginal && !o.srcOriginal ? { srcOriginal: o.src } : {}), x: suivante.x - (parent?.x || 0), y: suivante.y - (parent?.y || 0), largeur: zone.largeur, hauteur: zone.hauteur } : o), false);
    if (message) afficherToast(typeof message === "function" ? message() : message);
    return true;
  };
  // Ne conserve de l'image que la zone donnée (repère local du calque).
  const redécouperImage = (sourceId, zone, origine, message) => {
    const source = magasinNoeuds.nodes[sourceId];
    const monde = objetMonde(sourceId);
    if (!source || source.type !== "image" || !monde) return false;
    const image = cacheImages.current.get(source.src);
    if (!image?.complete || !image.naturalWidth) return false;
    const echelleX = image.naturalWidth / source.largeur;
    const echelleY = image.naturalHeight / source.hauteur;
    const surface = document.createElement("canvas");
    surface.width = Math.max(1, Math.round(zone.largeur * echelleX));
    surface.height = Math.max(1, Math.round(zone.hauteur * echelleY));
    surface.getContext("2d").drawImage(image, zone.x * echelleX, zone.y * echelleY, zone.largeur * echelleX, zone.hauteur * echelleY, 0, 0, surface.width, surface.height);
    return publierSourceImage(source, monde, surface, zone, origine, message);
  };
  // Tampon canvas par src : évite de redessiner l'image à chaque opération
  // pixels (détourage, gomme, restauration, fonds).
  const obtenirCanvasSource = (src) => {
    const existant = canvasSources.current.get(src);
    if (existant) return existant;
    const image = cacheImages.current.get(src);
    if (!image?.complete || !image.naturalWidth) return null;
    const surface = document.createElement("canvas");
    surface.width = image.naturalWidth;
    surface.height = image.naturalHeight;
    surface.getContext("2d").drawImage(image, 0, 0);
    canvasSources.current.set(src, surface);
    return surface;
  };
  // Applique une opération pixels (détourage, contraste…) au src courant :
  // tampon mis en cache par src, no-op signalé, original conservé au premier
  // passage pour un retour arrière immédiat sans consommer l'historique.
  const transformerPixelsImage = (sourceId, transformation, message) => {
    const source = magasinNoeuds.nodes[sourceId];
    if (!source || source.type !== "image") {
      afficherToast("Sélectionnez d'abord une image.", true);
      return;
    }
    const surface = obtenirCanvasSource(source.src);
    if (!surface) return;
    const contexte = surface.getContext("2d");
    const empreinte = contexte.getImageData(0, 0, surface.width, surface.height);
    const touches = transformation(empreinte);
    if (!touches) {
      afficherToast("Aucun pixel ne correspond — ajustez la tolérance ou la couleur.", true);
      return;
    }
    contexte.putImageData(empreinte, 0, 0);
    const monde = objetMonde(sourceId);
    publierSourceImage(source, monde, surface, { x: 0, y: 0, largeur: source.largeur, hauteur: source.hauteur }, copieObjets(objets), typeof message === "function" ? () => message(touches) : message, true);
  };
  const detourerCouleur = () => {
    const cible = hexVersRgb(detourageCouleur);
    transformerPixelsImage(selection, (empreinte) => supprimerArrierePlan(empreinte, { ...cible, tolerance: detourageTolerance, contigue: detourageContigue, adoucissement: detourageAdoucissement / 100 }), () => "Arrière-plan supprimé");
  };
  // Gomme magique : le pixel cliqué sert de graine, la suppression se
  // propage aux voisins de même couleur (tolérance courante).
  const gommeSurImage = (point) => {
    const trouve = [...objetsHierarchiques].reverse().find((o) => o.type === "image" && o.visible && !o.verrouille && point.x >= o.x && point.x <= o.x + o.largeur && point.y >= o.y && point.y <= o.y + o.hauteur);
    if (!trouve) {
      afficherToast("Cliquez sur une image pour effacer son arrière-plan.", true);
      return;
    }
    const monde = objetMonde(trouve.id);
    const centreX = monde.x + monde.largeur / 2;
    const centreY = monde.y + monde.hauteur / 2;
    const rad = -(trouve.rotation || 0) * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = point.x - centreX;
    const dy = point.y - centreY;
    const localX = dx * cos - dy * sin + trouve.largeur / 2;
    const localY = dx * sin + dy * cos + trouve.hauteur / 2;
    const image = cacheImages.current.get(trouve.src);
    if (!image?.complete || !image.naturalWidth) return;
    const graine = [Math.max(0, Math.min(image.naturalWidth - 1, Math.floor(localX / trouve.largeur * image.naturalWidth))), Math.max(0, Math.min(image.naturalHeight - 1, Math.floor(localY / trouve.hauteur * image.naturalHeight)))];
    transformerPixelsImage(trouve.id, (empreinte) => {
      const i = (graine[1] * empreinte.width + graine[0]) * 4;
      return supprimerArrierePlan(empreinte, { rouge: empreinte.data[i], vert: empreinte.data[i + 1], bleu: empreinte.data[i + 2], tolerance: detourageTolerance, contigue: true, graine, adoucissement: detourageAdoucissement / 100 });
    }, (touches) => `Gomme magique : ${touches.toLocaleString("fr-FR")} pixels retirés`);
  };
  const rognerBordsVides = () => {
    const sourceId = selection;
    const source = magasinNoeuds.nodes[sourceId];
    if (!source || source.type !== "image") {
      afficherToast("Sélectionnez une image à rogner.", true);
      return;
    }
    const image = cacheImages.current.get(source.src);
    if (!image?.complete || !image.naturalWidth) return;
    const surface = obtenirCanvasSource(source.src);
    if (!surface) return;
    const bornes = bornesContenu(surface.getContext("2d").getImageData(0, 0, surface.width, surface.height));
    if (!bornes) {
      afficherToast("L'image est entièrement transparente.", true);
      return;
    }
    if (bornes.x <= 0 && bornes.y <= 0 && bornes.largeur >= surface.width && bornes.hauteur >= surface.height) {
      afficherToast("Aucun bord vide à rogner.");
      return;
    }
    const zone = {
      x: bornes.x / surface.width * source.largeur,
      y: bornes.y / surface.height * source.hauteur,
      largeur: bornes.largeur / surface.width * source.largeur,
      hauteur: bornes.hauteur / surface.height * source.hauteur,
    };
    redécouperImage(sourceId, zone, copieObjets(objets), "Bords vides rognés");
  };
  const appliquerAutoContraste = () => transformerPixelsImage(selection, (empreinte) => etirerContraste(empreinte) ? 1 : 0, "Contraste automatique appliqué");
  const restaurerOriginal = () => {
    const source = magasinNoeuds.nodes[selection];
    if (!source?.srcOriginal) {
      afficherToast("Aucun original conservé pour cette image.", true);
      return;
    }
    setHistorique((h) => ({ passe: [...h.passe.slice(-39), copieObjets(objets)], futur: [] }));
    modifier((liste) => liste.map((o) => o.id === selection ? { ...o, src: o.srcOriginal, srcOriginal: undefined } : o), false);
    afficherToast("Image d'origine restaurée");
  };
  // Convertit un point du monde en pixel de l'image naturelle (rotation du
  // calque annulée autour de son centre).
  const pointVersPixelImage = (objet, monde, point) => {
    const centreX = monde.x + monde.largeur / 2;
    const centreY = monde.y + monde.hauteur / 2;
    const rad = -(objet.rotation || 0) * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = point.x - centreX;
    const dy = point.y - centreY;
    const localX = dx * cos - dy * sin + objet.largeur / 2;
    const localY = dx * sin + dy * cos + objet.hauteur / 2;
    const image = cacheImages.current.get(objet.src);
    if (!image?.complete || !image.naturalWidth) return null;
    return {
      x: Math.max(0, Math.min(image.naturalWidth - 1, Math.floor(localX / objet.largeur * image.naturalWidth))),
      y: Math.max(0, Math.min(image.naturalHeight - 1, Math.floor(localY / objet.hauteur * image.naturalHeight))),
    };
  };
  const imageSurvolee = (point) => [...objetsHierarchiques].reverse().find((o) => o.type === "image" && o.visible && !o.verrouille && point.x >= o.x && point.x <= o.x + o.largeur && point.y >= o.y && point.y <= o.y + o.hauteur) || null;
  const appliquerRestauration = (mouvement) => {
    const objet = magasinNoeuds.nodes[mouvement.traceId];
    if (!objet?.srcOriginal) {
      afficherToast("Aucun original à restaurer — détouragez d'abord cette image.", true);
      return;
    }
    const monde = objetMonde(mouvement.traceId);
    if (!monde) return;
    transformerPixelsImage(objet.id, (empreinte) => {
      const originale = obtenirCanvasSource(objet.srcOriginal);
      if (!originale) return 0;
      const donneesOrigine = originale.getContext("2d").getImageData(0, 0, originale.width, originale.height);
      const centreX = monde.x + monde.largeur / 2;
      const centreY = monde.y + monde.hauteur / 2;
      const rad = -(objet.rotation || 0) * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const echelleX = originale.width / objet.largeur;
      const echelleY = originale.height / objet.hauteur;
      const rayonPixels = Math.max(1, Math.round(restaurationRayon * (echelleX + echelleY) / 2));
      let touches = 0;
      mouvement.pointsAbs.forEach((pt) => {
        const dx = pt.x - centreX;
        const dy = pt.y - centreY;
        const pixelX = Math.round((dx * cos - dy * sin + objet.largeur / 2) * echelleX);
        const pixelY = Math.round((dx * sin + dy * cos + objet.hauteur / 2) * echelleY);
        touches += tamponRestauration(empreinte, donneesOrigine, pixelX, pixelY, rayonPixels);
      });
      return touches;
    }, (touches) => `Restauration : ${touches.toLocaleString("fr-FR")} pixels repeints`);
  };
  const pipetteSurImage = (point) => {
    const trouve = imageSurvolee(point);
    if (!trouve) {
      afficherToast("Cliquez sur une image pour prélever sa couleur.", true);
      return;
    }
    const monde = objetMonde(trouve.id);
    const pixel = pointVersPixelImage(trouve, monde, point);
    const surface = obtenirCanvasSource(trouve.src);
    if (!pixel || !surface) return;
    const echantillon = surface.getContext("2d").getImageData(pixel.x, pixel.y, 1, 1).data;
    const hex = `#${[echantillon[0], echantillon[1], echantillon[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    setDetourageCouleur(hex);
    afficherToast(`Couleur prélevée : ${hex.toUpperCase()}`);
    setOutil("selection");
  };
  const appliquerFondCouleur = () => {
    transformerPixelsImage(selection, (empreinte) => composerFondCouleur(empreinte, hexVersRgb(fondRemplacementCouleur)), () => "Fond de remplacement appliqué");
  };
  // Mode portrait : l'original flouté sert de fond, révélé par les zones
  // détournées du calque courant.
  const appliquerFlouFond = () => {
    const objet = magasinNoeuds.nodes[selection];
    if (!objet || objet.type !== "image") {
      afficherToast("Sélectionnez une image détournée.", true);
      return;
    }
    if (!objet.srcOriginal) {
      afficherToast("Détouragez d'abord : le flou s'applique à l'arrière-plan d'origine.", true);
      return;
    }
    const originale = obtenirCanvasSource(objet.srcOriginal);
    if (!originale) return;
    const fond = document.createElement("canvas");
    fond.width = originale.width;
    fond.height = originale.height;
    const contexteFond = fond.getContext("2d");
    contexteFond.filter = `blur(${flouFondRayon}px)`;
    contexteFond.drawImage(originale, 0, 0);
    contexteFond.filter = "none";
    const donneesFond = contexteFond.getImageData(0, 0, fond.width, fond.height);
    transformerPixelsImage(selection, (empreinte) => composerFondFlou(empreinte, donneesFond), () => "Flou d'arrière-plan appliqué");
  };
  // Recadrage : la géométrie (zone locale, position préservée) est calculée
  // par logique/recadrage.js ; ici ne reste que le travail canvas et
  // l'historique. Annuler restaure l'ancien src.
  const appliquerRecadrage = (mouvement, point) => {
    const monde = actifMonde;
    const source = magasinNoeuds.nodes[monde?.id];
    if (!source || source.type !== "image") return;
    const calque = { x: monde.x, y: monde.y, largeur: source.largeur, hauteur: source.hauteur, rotation: source.rotation || 0 };
    const zone = calculerZoneRecadrage(calque, mouvement.depart, point);
    if (!zone) return;
    redécouperImage(source.id, zone, mouvement.origine);
  };
  const bouger = (event) => {
    if (outil === "plume" && tracePlume && !glisse.current) setCurseurPlume(position(event));
    if (outil === "restauration" && !glisse.current) setCurseurRestauration(position(event));
    const mouvement = glisse.current;
    if (!mouvement || mouvement.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (mouvement.mode === "pan") {
      setPan({ x: mouvement.pan.x + event.clientX - mouvement.clientX, y: mouvement.pan.y + event.clientY - mouvement.clientY });
      return;
    }
    const p = position(event);
    // Capturer les valeurs avant `setObjets` : React peut exécuter la mise à
    // jour après pointerup, moment où `glisse.current` vaut déjà null.
    if (mouvement.mode === "marquee") {
      const x = Math.min(mouvement.depart.x, p.x);
      const y = Math.min(mouvement.depart.y, p.y);
      const largeur = Math.abs(p.x - mouvement.depart.x);
      const hauteur = Math.abs(p.y - mouvement.depart.y);
      mouvement.distance = Math.max(largeur, hauteur);
      setMarquee({ x, y, largeur, hauteur });
    } else if (mouvement.mode === "pinceau") {
      const dernier = mouvement.pointsAbs.at(-1);
      if (Math.hypot(p.x - dernier.x, p.y - dernier.y) >= 2 / (zoom / 100)) {
        mouvement.pointsAbs.push({ x: p.x, y: p.y });
        majTraitPinceau(mouvement);
      }
    } else if (mouvement.mode === "poignee") {
      // Poignées symétriques : tirer la sortie d'une ancre courbe aussi bien
      // l'entrée que la sortie, comme sur un tracé Bézier classique.
      const vx = p.x - mouvement.ancre.x;
      const vy = p.y - mouvement.ancre.y;
      const points = [...mouvement.pointsAbs];
      points[mouvement.index] = { x: mouvement.ancre.x, y: mouvement.ancre.y, hax: mouvement.ancre.x - vx, hay: mouvement.ancre.y - vy, hbx: mouvement.ancre.x + vx, hby: mouvement.ancre.y + vy };
      mouvement.pointsAbs = points;
      setTracePlume((courante) => courante ? { ...courante, pointsAbs: points } : courante);
      majTracePlume(mouvement.traceId, points, false);
    } else if (mouvement.mode === "ancreEdit") {
      // Déplacer une ancre emmène ses poignées avec elle ; tirer une
      // poignée ne bouge que son côté, les deux restent indépendantes.
      const points = [...mouvement.pointsAbs];
      const pt = { ...points[mouvement.index] };
      if (mouvement.role === "point") {
        const dx = p.x - pt.x;
        const dy = p.y - pt.y;
        pt.x = p.x;
        pt.y = p.y;
        if (pt.hax != null) { pt.hax += dx; pt.hay += dy; }
        if (pt.hbx != null) { pt.hbx += dx; pt.hby += dy; }
      } else if (mouvement.role === "a") {
        pt.hax = p.x;
        pt.hay = p.y;
      } else {
        pt.hbx = p.x;
        pt.hby = p.y;
      }
      points[mouvement.index] = pt;
      mouvement.pointsAbs = points;
      majTracePlume(mouvement.traceId, points, mouvement.ferme);
    } else if (mouvement.mode === "restauration") {
      const dernier = mouvement.pointsAbs.at(-1);
      if (Math.hypot(p.x - dernier.x, p.y - dernier.y) >= 2 / (zoom / 100)) mouvement.pointsAbs.push({ x: p.x, y: p.y });
      setCurseurRestauration(p);
    } else if (mouvement.mode === "recadrage") {
      const monde = actifMonde;
      if (!monde) return;
      const ax = Math.max(monde.x, Math.min(mouvement.depart.x, monde.x + monde.largeur));
      const ay = Math.max(monde.y, Math.min(mouvement.depart.y, monde.y + monde.hauteur));
      const bx = Math.max(monde.x, Math.min(p.x, monde.x + monde.largeur));
      const by = Math.max(monde.y, Math.min(p.y, monde.y + monde.hauteur));
      setRecadrageRect({ x: Math.min(ax, bx), y: Math.min(ay, by), largeur: Math.abs(bx - ax), hauteur: Math.abs(by - ay) });
    } else if (mouvement.mode === "rotation") {
      const angle = Math.atan2(p.y - mouvement.centre.y, p.x - mouvement.centre.x) * 180 / Math.PI;
      let rotation = mouvement.rotationDepart + angle - mouvement.angleDepart;
      if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
      else if (Math.abs(rotation - Math.round(rotation / 15) * 15) <= 2) rotation = Math.round(rotation / 15) * 15;
      setObjets((liste) => liste.map((o) => o.id === mouvement.id ? { ...o, rotation: Math.round(rotation * 10) / 10 } : o));
    } else if (mouvement.mode === "rayon") {
      const original = mouvement.objet;
      const brut = mouvement.cote === "gauche" ? p.x - original.x : original.x + original.largeur - p.x;
      const rayon = Math.max(0, Math.min(brut, original.largeur / 2, original.hauteur / 2));
      setObjets((liste) => liste.map((o) => o.id === mouvement.id ? { ...o, rayon: Math.round(rayon) } : o));
    } else if (mouvement.mode === "creation") {
      let dx = p.x - mouvement.depart.x;
      let dy = p.y - mouvement.depart.y;
      if (event.shiftKey && mouvement.forme === "ligne") {
        const longueur = Math.hypot(dx, dy);
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        dx = Math.cos(angle) * longueur;
        dy = Math.sin(angle) * longueur;
      } else if (event.shiftKey) {
        const taille = Math.max(Math.abs(dx), Math.abs(dy));
        dx = Math.sign(dx || 1) * taille;
        dy = Math.sign(dy || 1) * taille;
      }
      mouvement.distance = Math.max(Math.abs(dx), Math.abs(dy));
      const x = Math.min(mouvement.depart.x, mouvement.depart.x + dx);
      const y = Math.min(mouvement.depart.y, mouvement.depart.y + dy);
      setObjets((liste) => liste.map((o) => o.id === mouvement.id ? { ...o, x: x - mouvement.parentOffset.x, y: y - mouvement.parentOffset.y, largeur: Math.max(1, Math.abs(dx)), hauteur: Math.max(1, Math.abs(dy)) } : o));
    } else if (mouvement.mode === "redimensionnement" || mouvement.mode === "redimensionnement-multiple") {
      const dx = p.x - mouvement.depart.x;
      const dy = p.y - mouvement.depart.y;
      const original = mouvement.mode === "redimensionnement-multiple" ? mouvement.bounds : mouvement.objet;
      const ouest = mouvement.coin.includes("o");
      const est = mouvement.coin.includes("e");
      const nord = mouvement.coin.includes("n");
      const sud = mouvement.coin.includes("s");
      let largeur = ouest || est ? Math.max(12, original.largeur + (ouest ? -dx : dx)) : original.largeur;
      let hauteur = nord || sud ? Math.max(12, original.hauteur + (nord ? -dy : dy)) : original.hauteur;
      if (event.shiftKey && (ouest || est) && (nord || sud)) {
        const ratio = original.largeur / original.hauteur;
        if (largeur / hauteur > ratio) hauteur = largeur / ratio;
        else largeur = hauteur * ratio;
      }
      let x = ouest ? original.x + original.largeur - largeur : original.x;
      let y = nord ? original.y + original.hauteur - hauteur : original.y;
      if (event.altKey) {
        if (ouest || est) { largeur = Math.max(12, original.largeur + Math.abs(largeur - original.largeur) * 2 * Math.sign(largeur - original.largeur)); x = original.x + (original.largeur - largeur) / 2; }
        if (nord || sud) { hauteur = Math.max(12, original.hauteur + Math.abs(hauteur - original.hauteur) * 2 * Math.sign(hauteur - original.hauteur)); y = original.y + (original.hauteur - hauteur) / 2; }
      }
      if (mouvement.mode === "redimensionnement-multiple") {
        const echelleX = largeur / Math.max(1, original.largeur);
        const echelleY = hauteur / Math.max(1, original.hauteur);
        setObjets((liste) => liste.map((objet) => {
          const depart = mouvement.elements.find((element) => element.local.id === objet.id);
          if (!depart) return objet;
          const mondeX = x + (depart.monde.x - original.x) * echelleX;
          const mondeY = y + (depart.monde.y - original.y) * echelleY;
          const patch = {};
          const echelleMoy = (echelleX + echelleY) / 2;
          if (depart.local.type === "texte") patch.taille = Math.max(6, Math.round((depart.local.taille || 24) * echelleX));
          if (depart.local.type === "dessin") patch.epaisseur = Math.max(1, Math.round((depart.local.epaisseur || 4) * echelleMoy));
          return { ...objet, ...patch, x: depart.local.x + mondeX - depart.monde.x, y: depart.local.y + mondeY - depart.monde.y, largeur: Math.max(1, depart.local.largeur * echelleX), hauteur: Math.max(1, depart.local.hauteur * echelleY) };
        }));
      } else {
        // Coins : le texte scale sa taille de police, le trait de pinceau
        // son épaisseur — le redimensionnement reste fidèle à l'objet.
        const coins = (ouest || est) && (nord || sud);
        const sourceLocale = mouvement.objet;
        setObjets((liste) => liste.map((o) => {
          if (o.id !== mouvement.id) return o;
          const patch = { x, y, largeur, hauteur };
          if (coins && sourceLocale.type === "texte") {
            const facteur = largeur / Math.max(1, sourceLocale.largeur);
            patch.taille = Math.max(6, Math.round((sourceLocale.taille || 24) * facteur));
            patch.hauteur = Math.max(20, Math.round(sourceLocale.hauteur * facteur));
          }
          if (coins && sourceLocale.type === "dessin") {
            patch.epaisseur = Math.max(1, Math.round(((sourceLocale.epaisseur || 4) * ((largeur / Math.max(1, sourceLocale.largeur)) + (hauteur / Math.max(1, sourceLocale.hauteur)))) / 2));
          }
          return { ...o, ...patch };
        }));
      }
    } else if (mouvement.mode === "deplacement" && mouvement.ids?.length > 1) {
      const dx = p.x - mouvement.depart.x;
      const dy = p.y - mouvement.depart.y;
      setObjets((liste) => liste.map((objet) => {
        const initiale = mouvement.positions.find((positionInitiale) => positionInitiale.id === objet.id)?.objet;
        return initiale ? { ...objet, x: initiale.x + dx, y: initiale.y + dy } : objet;
      }));
    } else {
      let x = p.x - mouvement.dx;
      let y = p.y - mouvement.dy;
      const objet = objetMonde(mouvement.id);
      if (!objet) return;
      const seuil = 7 / (zoom / 100);
      const ciblesX = [0, largeurPlan / 2, largeurPlan, ...guidesCourantes.v];
      const ciblesY = [0, hauteurPlan / 2, hauteurPlan, ...guidesCourantes.h];
      objetsHierarchiques.filter((o) => o.id !== mouvement.id && o.visible !== false).forEach((o) => {
        ciblesX.push(o.x, o.x + o.largeur / 2, o.x + o.largeur);
        ciblesY.push(o.y, o.y + o.hauteur / 2, o.y + o.hauteur);
      });
      let guideX = null;
      let guideY = null;
      for (const cible of ciblesX) {
        for (const ancre of [0, objet.largeur / 2, objet.largeur]) {
          if (Math.abs(x + ancre - cible) <= seuil) { x = cible - ancre; guideX = cible; break; }
        }
        if (guideX !== null) break;
      }
      for (const cible of ciblesY) {
        for (const ancre of [0, objet.hauteur / 2, objet.hauteur]) {
          if (Math.abs(y + ancre - cible) <= seuil) { y = cible - ancre; guideY = cible; break; }
        }
        if (guideY !== null) break;
      }
      setGuides({ x: guideX, y: guideY });
      const parent = objet.parentId ? objetMonde(objet.parentId) : null;
      mouvement.dernierePosition = { x, y };
      setObjets((liste) => liste.map((o) => o.id === mouvement.id ? { ...o, x: x - (parent?.x || 0), y: y - (parent?.y || 0) } : o));
    }
  };
  const relacher = (event) => {
    const mouvement = glisse.current;
    if (!mouvement || (event && mouvement.pointerId !== event.pointerId)) return;
    if (event?.currentTarget?.hasPointerCapture?.(mouvement.pointerId)) {
      event.currentTarget.releasePointerCapture(mouvement.pointerId);
    }
    if (mouvement.mode === "marquee") {
      if (mouvement.distance >= 3 && marquee) {
        setSelectionIds(objetsHierarchiques.filter((objet) => objet.visible !== false && !objet.verrouille && objet.x < marquee.x + marquee.largeur && objet.x + objet.largeur > marquee.x && objet.y < marquee.y + marquee.hauteur && objet.y + objet.hauteur > marquee.y).map((objet) => objet.id));
      }
      setMarquee(null);
    } else if (mouvement.mode === "creation") {
      if (mouvement.distance < 3) {
        setObjets((liste) => liste.filter((objet) => objet.id !== mouvement.id).map((objet) => ({ ...objet, children: objet.children.filter((enfant) => enfant !== mouvement.id) })));
        setSelection(null);
      } else setHistorique((h) => ({ passe: [...h.passe.slice(-39), mouvement.origine], futur: [] }));
      setOutil("selection");
    } else if (mouvement.mode === "pinceau") {
      if (mouvement.pointsAbs.length < 2) {
        setObjets((liste) => liste.filter((objet) => objet.id !== mouvement.id).map((objet) => ({ ...objet, children: objet.children.filter((enfant) => enfant !== mouvement.id) })));
      } else setHistorique((h) => ({ passe: [...h.passe.slice(-39), mouvement.origine], futur: [] }));
      setOutil("selection");
    } else if (mouvement.mode === "recadrage") {
      appliquerRecadrage(mouvement, event ? position(event) : mouvement.depart);
      setRecadrageRect(null);
    } else if (mouvement.mode === "restauration") {
      appliquerRestauration(mouvement);
      setCurseurRestauration(null);
    } else if (mouvement.mode === "poignee") {
      // L'historique du tracé plume n'est poussé qu'une fois, à sa fin.
    } else if (mouvement.mode !== "pan") {
      if (mouvement.mode === "deplacement" && mouvement.ids?.length === 1 && mouvement.dernierePosition) {
        const deplace = objetMonde(mouvement.id);
        const estDescendant = (candidat) => {
          let courant = magasinNoeuds.nodes[candidat.id];
          while (courant?.parentId) {
            if (courant.parentId === mouvement.id) return true;
            courant = magasinNoeuds.nodes[courant.parentId];
          }
          return false;
        };
        const centre = { x: mouvement.dernierePosition.x + (deplace?.largeur || 0) / 2, y: mouvement.dernierePosition.y + (deplace?.hauteur || 0) / 2 };
        const parent = [...objetsHierarchiques].reverse().find((o) => o.type === "frame" && o.id !== mouvement.id && !estDescendant(o) && centre.x >= o.x && centre.x <= o.x + o.largeur && centre.y >= o.y && centre.y <= o.y + o.hauteur) || null;
        const source = magasinNoeuds.nodes[mouvement.id];
        if (source && source.parentId !== (parent?.id || null)) {
          setObjets((liste) => liste.map((o) => {
            if (o.id === mouvement.id) return { ...o, parentId: parent?.id || null, x: mouvement.dernierePosition.x - (parent?.x || 0), y: mouvement.dernierePosition.y - (parent?.y || 0) };
            const sansEnfant = o.children.filter((enfant) => enfant !== mouvement.id);
            return o.id === parent?.id ? { ...o, children: [...sansEnfant, mouvement.id] } : sansEnfant.length !== o.children.length ? { ...o, children: sansEnfant } : o;
          }));
        }
      }
      setHistorique((h) => ({ passe: [...h.passe.slice(-39), mouvement.origine], futur: [] }));
    }
    setGuides({ x: null, y: null });
    glisse.current = null;
  };

  const surMolette = (event) => {
    setMenuContextuel(null);
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const rect = scene.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = event.clientX - rect.left - rect.width / 2;
      const dy = event.clientY - rect.top - rect.height / 2;
      setZoom((ancien) => {
        const suivant = Math.max(10, Math.min(400, ancien * (event.deltaY < 0 ? 1.1 : 0.9)));
        const ratio = suivant / ancien;
        setPan((p) => ({ x: dx - (dx - p.x) * ratio, y: dy - (dy - p.y) * ratio }));
        return suivant;
      });
    } else {
      setPan((p) => ({ x: p.x - event.deltaX, y: p.y - event.deltaY }));
    }
  };

  // React peut enregistrer `wheel` en mode passif selon le navigateur. Un
  // écouteur natif explicitement non passif garantit que Ctrl+molette reste
  // un zoom du canvas et ne devient jamais un zoom de la page CompanyOS.
  useEffect(() => {
    const element = scene.current;
    if (!element) return undefined;
    const intercepterMolette = (event) => surMolette(event);
    element.addEventListener("wheel", intercepterMolette, { passive: false });
    return () => element.removeEventListener("wheel", intercepterMolette);
  });

  // Quitter l'outil plume termine proprement le tracé en cours.
  useEffect(() => {
    if (outilPrecedent.current === "plume" && outil !== "plume") terminerPlume();
    outilPrecedent.current = outil;
  });

  // Miroir pour les écouteurs clavier enregistrés une seule fois.
  useEffect(() => { aideMiroir.current = aideVisible; }, [aideVisible]);
  useEffect(() => { miroirMenuOutils.current = Boolean(menuOutils); }, [menuOutils]);
  useEffect(() => { paletteMiroir.current = paletteOuverte; }, [paletteOuverte]);
  useEffect(() => () => clearTimeout(minuteToast.current), []);

  // Auto-sauvegarde locale : la session survit au rechargement de la page,
  // avec statut visible (enregistrement… / enregistré / hors ligne).
  useEffect(() => {
    setStatutSauvegarde("enCours");
    const minute = setTimeout(() => {
      try {
        localStorage.setItem("atelier-image-session", JSON.stringify({ v: 2, nomDesign, pageActive, pages }));
        setStatutSauvegarde("enregistre");
      } catch {
        setStatutSauvegarde("horsLigne");
      }
    }, 900);
    return () => clearTimeout(minute);
  }, [nomDesign, pageActive, pages]);
  const reinitialiserSession = () => {
    try { localStorage.removeItem("atelier-image-session"); } catch { /* stockage indisponible */ }
    const vierge = { id: id(), nom: "Scène 1", largeur: LARGEUR_INITIALE, hauteur: HAUTEUR_INITIALE, fond: "#ffffff", fondTransparent: true, objets: [], guides: { h: [], v: [] } };
    setNomDesign("Sans titre");
    setPages([vierge]);
    setPageActive(vierge.id);
    chargerPage(vierge);
    setHistorique({ passe: [], futur: [] });
    afficherToast("Nouvelle session vierge");
  };
  // Restauration unique au montage : on repart de la dernière session.
  const restaurationFaite = useRef(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (restaurationFaite.current) return;
    restaurationFaite.current = true;
    try {
      const brute = localStorage.getItem("atelier-image-session");
      if (!brute) return;
      const session = JSON.parse(brute);
      if (!session || !Array.isArray(session.pages) || !session.pages.length) return;
      if (session.v === 2 && typeof session.nomDesign === "string") setNomDesign(session.nomDesign);
      const identifiant = session.pages.some((page) => page.id === session.pageActive) ? session.pageActive : session.pages[0].id;
      const cible = session.pages.find((page) => page.id === identifiant);
      setPages(session.pages);
      setPageActive(identifiant);
      chargerPage(cible);
      afficherToast("Session précédente restaurée");
    } catch {
      /* session illisible : on repart à vide sans bloquer l'application */
    }
  });

  // Les règles vivent aux bords de la scène : leur largeur/hauteur pilote
  // l'étendue des graduations visibles.
  useEffect(() => {
    const element = scene.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observateur = new ResizeObserver(() => setTailleScene({ largeur: element.clientWidth, hauteur: element.clientHeight }));
    observateur.observe(element);
    return () => observateur.disconnect();
  }, []);

  const graduationsH = useMemo(() => {
    const echelle = zoom / 100;
    const origine = tailleScene.largeur / 2 + pan.x - (largeurPlan * echelle) / 2;
    return { echelle, origine, debut: Math.floor((-origine / echelle) / 50) * 50, fin: Math.ceil(((tailleScene.largeur - origine) / echelle) / 50) * 50 };
  }, [largeurPlan, pan.x, tailleScene.largeur, zoom]);
  const graduationsV = useMemo(() => {
    const echelle = zoom / 100;
    const origine = tailleScene.hauteur / 2 + pan.y - (hauteurPlan * echelle) / 2;
    return { echelle, origine, debut: Math.floor((-origine / echelle) / 50) * 50, fin: Math.ceil(((tailleScene.hauteur - origine) / echelle) / 50) * 50 };
  }, [hauteurPlan, pan.y, tailleScene.hauteur, zoom]);
  const ticksRegles = (debut, fin) => {
    const valeurs = [];
    for (let valeur = debut; valeur <= fin; valeur += 50) valeurs.push(valeur);
    return valeurs;
  };
  // Rectangle de la portion visible du plan, en coordonnées du monde —
  // sert à la minimap et au suivi de navigation.
  const vueMonde = useMemo(() => {
    const echelleVue = zoom / 100;
    const largeurVue = tailleScene.largeur / echelleVue;
    const hauteurVue = tailleScene.hauteur / echelleVue;
    return { x: largeurPlan / 2 - largeurVue / 2 - pan.x / echelleVue, y: hauteurPlan / 2 - hauteurVue / 2 - pan.y / echelleVue, largeur: largeurVue, hauteur: hauteurVue };
  }, [hauteurPlan, largeurPlan, pan.x, pan.y, tailleScene.hauteur, tailleScene.largeur, zoom]);

  const ajusterEcran = () => {
    const rect = scene.current?.getBoundingClientRect();
    if (!rect) return;
    setZoom(Math.max(10, Math.min(100, Math.min((rect.width - 80) / largeurPlan, (rect.height - 80) / hauteurPlan) * 100)));
    setPan({ x: 0, y: 0 });
  };
  // Clic/glissé sur la minimap : le point visé devient le centre de la vue.
  const naviguerMinimap = (event) => {
    const carte = event.currentTarget.querySelector("svg");
    if (!carte) return;
    const rect = carte.getBoundingClientRect();
    const echelleCarte = Math.min(rect.width / largeurPlan, rect.height / hauteurPlan);
    const offsetX = (rect.width - largeurPlan * echelleCarte) / 2;
    const offsetY = (rect.height - hauteurPlan * echelleCarte) / 2;
    const mondeX = (event.clientX - rect.left - offsetX) / echelleCarte;
    const mondeY = (event.clientY - rect.top - offsetY) / echelleCarte;
    const echelleVue = zoom / 100;
    setPan({ x: -(mondeX - largeurPlan / 2) * echelleVue, y: -(mondeY - hauteurPlan / 2) * echelleVue });
  };

  // Presse-papiers interne : capture des sous-arbres complets (un groupe
  // copié garde ses enfants), réutilisable d'une scène à l'autre.
  const copierSelection = () => {
    if (!selectionIds.length) return;
    const racines = selectionIds.filter((identifiant) => {
      let parentId = magasinNoeuds.nodes[identifiant]?.parentId;
      while (parentId) {
        if (selectionIds.includes(parentId)) return false;
        parentId = magasinNoeuds.nodes[parentId]?.parentId;
      }
      return true;
    });
    const sac = [];
    const capturer = (identifiant) => {
      const noeud = magasinNoeuds.nodes[identifiant];
      if (!noeud) return;
      sac.push(copieObjet(noeud));
      noeud.children.forEach(capturer);
    };
    racines.forEach(capturer);
    pressePapier.current = { elements: sac, page: pageActive };
    afficherToast(`${racines.length} élément${racines.length > 1 ? "s" : ""} copié${racines.length > 1 ? "s" : ""}`);
  };
  const collerPressePapier = () => {
    const sac = pressePapier.current?.elements;
    if (!sac?.length) return;
    const correspondances = new Map(sac.map((objet) => [objet.id, id()]));
    const decalage = pressePapier.current.page === pageActive ? 20 : 0;
    const racines = [];
    const nouveaux = sac.map((objet) => {
      const nouvelIdentifiant = correspondances.get(objet.id);
      const parentMappe = objet.parentId ? correspondances.get(objet.parentId) || null : null;
      if (!parentMappe) racines.push(nouvelIdentifiant);
      return { ...copieObjet(objet), id: nouvelIdentifiant, parentId: parentMappe, children: (objet.children || []).map((enfant) => correspondances.get(enfant) || enfant), x: objet.x + decalage, y: objet.y + decalage, sceneId: pageActive };
    });
    modifier((liste) => [...liste, ...nouveaux]);
    setSelectionIds(racines);
  };
  const slugNom = () => (nomDesign || "design").replace(/[^\w\sÀ-ÿ-]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "design";
  // Export de toutes les scènes visibles : chaque page est rendue depuis
  // son propre magasin, sans toucher à la scène active.
  const exporterToutesPages = async () => {
    const courante = capturerPage();
    const visibles = pages.filter((page) => !page.cachee).map((page) => page.id === pageActive ? courante : page);
    if (!visibles.length) return;
    afficherToast(`Export de ${visibles.length} page${visibles.length > 1 ? "s" : ""}…`);
    for (let index = 0; index < visibles.length; index++) {
      const page = visibles[index];
      const surface = await construireExport("image/png", { echelle: echelleExport, page });
      const lien = document.createElement("a");
      const slugPage = (page.nom || `page-${index + 1}`).replace(/[^\w\sÀ-ÿ-]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || `page-${index + 1}`;
      lien.download = `${slugNom()}-${slugPage}.png`;
      lien.href = surface.toDataURL("image/png", 0.94);
      lien.click();
      await new Promise((resoudre) => setTimeout(resoudre, 350));
    }
    afficherToast(`${visibles.length} page${visibles.length > 1 ? "s" : ""} exportée${visibles.length > 1 ? "s" : ""}`);
  };
  // PDF multi-pages : chaque scène visible devient une page au format de
  // sa scène (jsPDF est chargé à la demande pour ne pas alourdir le bundle).
  const exporterPDF = async () => {
    const { jsPDF } = await import("jspdf");
    const courante = capturerPage();
    const visibles = pages.filter((page) => !page.cachee).map((page) => (page.id === pageActive ? courante : page));
    if (!visibles.length) return;
    afficherToast(`Génération du PDF (${visibles.length} page${visibles.length > 1 ? "s" : ""})…`);
    let doc = null;
    for (const page of visibles) {
      const surface = await construireExport("image/png", { echelle: 2, page });
      const orientation = page.largeur >= page.hauteur ? "landscape" : "portrait";
      if (!doc) doc = new jsPDF({ orientation, unit: "px", format: [page.largeur, page.hauteur], compress: true });
      else doc.addPage([page.largeur, page.hauteur], orientation);
      doc.addImage(surface.toDataURL("image/png", 0.94), "PNG", 0, 0, page.largeur, page.hauteur);
    }
    doc.save(`${slugNom()}.pdf`);
    afficherToast("PDF exporté");
  };
  const construireExport = async (type, options = {}) => {
    // Les polices doivent être chargées avant le rendu, sinon les métriques
    // de texte diffèrent entre l'éditeur et l'export.
    try { await document.fonts?.ready; } catch { /* polices indisponibles : fallback système */ }
    const echelle = Math.max(1, Math.min(3, options.echelle || echelleExport));
    const page = options.page || null;
    const magasin = page ? createNodeStore(copieObjets(page.objets || []), page.id) : magasinNoeuds;
    const largeurSource = page?.largeur || largeurPlan;
    const hauteurSource = page?.hauteur || hauteurPlan;
    const fondSource = page ? page.fond || "#ffffff" : fond;
    const transparentSource = page ? page.fondTransparent !== false : fondTransparent;
    const region = !page && options.selection && boundsSelection ? { ...boundsSelection } : { x: 0, y: 0, largeur: largeurSource, hauteur: hauteurSource };
    const surface = document.createElement("canvas");
    surface.width = Math.max(1, Math.round(region.largeur * echelle));
    surface.height = Math.max(1, Math.round(region.hauteur * echelle));
    const ctx = surface.getContext("2d");
    ctx.scale(echelle, echelle);
    if (!options.selection && !transparentSource) {
      ctx.fillStyle = fondSource;
      ctx.fillRect(0, 0, largeurSource, hauteurSource);
    }
    // En export sélection, on ne dessine que les sous-arbres réellement
    // cochés : un enfant choisi individuellement reste visible même si son
    // groupe ne l'est pas.
    const selectionRacines = page ? new Set() : new Set(selectionIds.filter((identifiant) => {
      let parentId = magasinNoeuds.nodes[identifiant]?.parentId;
      while (parentId) {
        if (selectionIds.includes(parentId)) return false;
        parentId = magasinNoeuds.nodes[parentId]?.parentId;
      }
      return true;
    }));
    const dessinerBranche = (identifiant, parentX = 0, parentY = 0, brancheSelectionnee = false) => {
      const objet = magasin.nodes[identifiant];
      if (!objet || objet.visible === false) return;
      const monde = { ...objet, x: parentX + objet.x, y: parentY + objet.y };
      const selectionne = brancheSelectionnee || selectionRacines.has(identifiant);
      if (selectionne && objet.type !== "group") dessinerObjet(ctx, { ...monde, x: monde.x - region.x, y: monde.y - region.y }, cacheImages.current);
      if (objet.type === "frame" && objet.clipContent !== false) {
        ctx.save();
        if (selectionne) {
          ctx.beginPath();
          ctx.roundRect(monde.x - region.x, monde.y - region.y, monde.largeur, monde.hauteur, rayonsEffectifs(monde));
          ctx.clip();
        }
        objet.children.forEach((enfant) => dessinerBranche(enfant, monde.x, monde.y, selectionne));
        ctx.restore();
      } else objet.children.forEach((enfant) => dessinerBranche(enfant, monde.x, monde.y, selectionne));
    };
    magasin.rootIds.forEach((identifiant) => dessinerBranche(identifiant));
    return surface;
  };
  const exporter = async (type, options = {}) => {
    const surface = await construireExport(type, options);
    const echelle = Math.max(1, Math.min(3, options.echelle || echelleExport));
    const extension = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    const base = options.selection ? "montage-selection" : "montage-companyos";
    const lien = document.createElement("a");
    lien.download = `${base}${echelle > 1 ? `@${echelle}x` : ""}.${extension}`;
    lien.href = surface.toDataURL(type, 0.94);
    lien.click();
    afficherToast(`Export ${extension.toUpperCase()}${echelle > 1 ? ` à ${echelle}×` : ""} terminé`);
  };
  const exporterPressePapiers = async () => {
    try {
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") throw new Error("Presse-papiers d'images non disponible");
      const surface = await construireExport("image/png", { echelle: 2 });
      const blob = await new Promise((resoudre, rejeter) => surface.toBlob((b) => b ? resoudre(b) : rejeter(new Error("rendu")), "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      afficherToast("Image copiée dans le presse-papiers");
    } catch {
      afficherToast("Copie impossible — le navigateur refuse l'accès au presse-papiers.", true);
    }
  };

  // Overlay de sélection en coordonnées écran : le cadre, les poignées et
  // le badge gardent leurs dimensions pixel quelle que soit la vue.
  const overlaySelection = useMemo(() => {
    const reference = selectionIds.length > 1 ? boundsSelection : actifMonde;
    if (!reference || !tailleScene.largeur) return null;
    const echelle = zoom / 100;
    const centre = {
      x: (reference.x + reference.largeur / 2 - largeurPlan / 2) * echelle + tailleScene.largeur / 2 + pan.x,
      y: (reference.y + reference.hauteur / 2 - hauteurPlan / 2) * echelle + tailleScene.hauteur / 2 + pan.y,
    };
    return {
      centre,
      largeur: reference.largeur * echelle,
      hauteur: reference.hauteur * echelle,
      rotation: selectionIds.length > 1 ? 0 : reference.rotation || 0,
    };
  }, [actifMonde, boundsSelection, hauteurPlan, largeurPlan, pan.x, pan.y, selectionIds.length, tailleScene.hauteur, tailleScene.largeur, zoom]);

  // Barre d'actions flottante : positionnée en coordonnées écran — elle ne
  // scale pas avec le zoom — et bornée à la scène pour rester visible même
  // quand la sélection approche d'un bord (elle passe sous l'objet si
  // nécessaire au lieu de sortir du cadre).
  const barreFlottante = useMemo(() => {
    if (selectionIds.length !== 1 || !actifMonde || !actif || actif.verrouille || outil !== "selection" || editionTexteId || editionNoeudsId || !tailleScene.largeur) return null;
    const echelle = zoom / 100;
    const x = (actifMonde.x - largeurPlan / 2) * echelle + tailleScene.largeur / 2 + pan.x;
    const y = (actifMonde.y - hauteurPlan / 2) * echelle + tailleScene.hauteur / 2 + pan.y;
    const largeurBarre = 236;
    const gauche = Math.max(8, Math.min(x, tailleScene.largeur - largeurBarre - 8));
    const auDessus = y - 44;
    const haut = auDessus < 8 ? Math.min(y + actifMonde.hauteur * echelle + 10, tailleScene.hauteur - 44) : auDessus;
    return { gauche: Math.round(gauche), haut: Math.round(Math.max(8, haut)) };
  }, [actif, actifMonde, editionNoeudsId, editionTexteId, hauteurPlan, largeurPlan, outil, pan.x, pan.y, selectionIds.length, tailleScene.hauteur, tailleScene.largeur, zoom]);

  commandes.current = {
    annuler,
    retablir,
    supprimer,
    dupliquer,
    ajouterTexte,
    ajouterRectangle: () => setOutil("rectangle"),
    ajouterEllipse: () => setOutil("ellipse"),
    ajouterFrame: () => setOutil("frame"),
    grouper: grouperSelection,
    dissocier: dissocierGroupe,
    copier: copierSelection,
    coller: collerPressePapier,
    couper: () => {
      if (!actif) return;
      copierSelection();
      supprimer();
    },
    deplacer: (dx, dy) => {
      if (!selectionIds.length) return;
      modifier((liste) => liste.map((o) => selectionIds.includes(o.id) && !o.verrouille ? { ...o, x: o.x + dx, y: o.y + dy } : o));
    },
    ajusterEcran,
    toutSelectionner: () => setSelectionIds(objetsHierarchiques.filter((objet) => objet.visible !== false && !objet.verrouille).map((objet) => objet.id)),
    enregistrer: enregistrerProjet,
    premierPlan: () => ordreExtreme(false),
    arrierePlan: () => ordreExtreme(true),
    friseSuivant: () => friser(1),
    frisePrecedent: () => friser(-1),
    friseEntrer,
    friseRemonter,
    copierStyle,
    collerStyle,
    zoomSelection,
    renommer: () => { champNom.current?.focus(); champNom.current?.select?.(); },
    editionNoeudsActive: Boolean(editionNoeud),
    fermerEditionNoeuds: () => setEditionNoeudsId(null),
    plumeActif: Boolean(tracePlume),
    plumeTerminer: () => terminerPlume(),
    plumeAnnuler: annulerPlume,
    plumeReculer: () => {
      if (!tracePlume) return;
      const reste = tracePlume.pointsAbs.slice(0, -1);
      if (!reste.length) {
        annulerPlume();
        return;
      }
      setTracePlume((courante) => courante ? { ...courante, pointsAbs: reste } : courante);
      majTracePlume(tracePlume.id, reste, false);
    },
  };

  // ---- Palette de commandes (Ctrl+K) ------------------------------------
  const ouvrirPalette = () => { setRecherchePalette(""); setIndexPalette(0); setPaletteOuverte(true); };
  const COMMANDES_PALETTE = [
    ...["selection", "main", "frame", "rectangle", "ellipse", "triangle", "ligne", "etoile", "texte", "pinceau", "plume", "gomme", "restauration", "pipette", "recadrage"].map((id) => ({ g: "Outils", l: `Outil ${id[0].toUpperCase()}${id.slice(1)}`, f: () => setOutil(id) })),
    { g: "Édition", l: "Dupliquer la sélection", k: "Ctrl+D", f: dupliquer, desactive: !actif },
    { g: "Édition", l: "Copier", k: "Ctrl+C", f: () => commandes.current.copier(), desactive: !actif },
    { g: "Édition", l: "Coller", k: "Ctrl+V", f: () => commandes.current.coller(), desactive: !pressePapier.current },
    { g: "Édition", l: "Couper", k: "Ctrl+X", f: () => commandes.current.couper(), desactive: !actif },
    { g: "Édition", l: "Supprimer la sélection", k: "Suppr", f: supprimer, desactive: !selectionIds.length },
    { g: "Édition", l: "Tout sélectionner", k: "Ctrl+A", f: () => commandes.current.toutSelectionner(), desactive: !objets.length },
    { g: "Édition", l: "Grouper", k: "Ctrl+G", f: grouperSelection, desactive: selectionIds.length < 2 },
    { g: "Édition", l: "Dissocier", k: "Ctrl+Maj+G", f: dissocierGroupe, desactive: actif?.type !== "group" },
    { g: "Édition", l: "Annuler", k: "Ctrl+Z", f: annuler, desactive: !historique.passe.length },
    { g: "Édition", l: "Rétablir", k: "Ctrl+Maj+Z", f: retablir, desactive: !historique.futur.length },
    { g: "Style", l: "Copier le style", k: "Ctrl+Alt+C", f: copierStyle, desactive: !actif },
    { g: "Style", l: "Coller le style", k: "Ctrl+Alt+V", f: collerStyle, desactive: !presseStyle.current || !selectionIds.length },
    { g: "Disposition", l: "Premier plan", k: "]", f: () => ordreExtreme(false), desactive: !actif },
    { g: "Disposition", l: "Arrière-plan", k: "[", f: () => ordreExtreme(true), desactive: !actif },
    { g: "Disposition", l: "Aligner à gauche", f: () => alignerSelection("gauche"), desactive: selectionIds.length < 2 },
    { g: "Disposition", l: "Centrer horizontalement", f: () => alignerSelection("centreH"), desactive: selectionIds.length < 2 },
    { g: "Disposition", l: "Aligner à droite", f: () => alignerSelection("droite"), desactive: selectionIds.length < 2 },
    { g: "Disposition", l: "Aligner en haut", f: () => alignerSelection("haut"), desactive: selectionIds.length < 2 },
    { g: "Disposition", l: "Centrer verticalement", f: () => alignerSelection("centreV"), desactive: selectionIds.length < 2 },
    { g: "Disposition", l: "Aligner en bas", f: () => alignerSelection("bas"), desactive: selectionIds.length < 2 },
    { g: "Affichage", l: "Ajuster à l'écran", k: "0", f: ajusterEcran },
    { g: "Affichage", l: "Zoom sur la sélection", k: "Maj+2", f: zoomSelection, desactive: !boundsSelection },
    { g: "Affichage", l: "Zoom 100 %", k: "1", f: () => { setZoom(100); setPan({ x: 0, y: 0 }); } },
    { g: "Affichage", l: "Zoom avant", f: () => setZoom((z) => Math.min(400, z * 1.1)) },
    { g: "Affichage", l: "Zoom arrière", f: () => setZoom((z) => Math.max(10, z / 1.1)) },
    { g: "Affichage", l: "Règles et guides", f: () => setReglesVisibles((valeur) => !valeur) },
    { g: "Affichage", l: "Effacer les guides", f: effacerGuides, desactive: !(guidesCourantes.h.length || guidesCourantes.v.length) },
    { g: "Affichage", l: "Contours seulement", f: () => setModeContour((valeur) => !valeur) },
    { g: "Scène", l: "Nouvelle scène", f: nouvellePage },
    { g: "Fichier", l: "Sauvegarder le projet", k: "Ctrl+S", f: enregistrerProjet },
    { g: "Fichier", l: "Ouvrir un projet…", f: () => importeurProjet.current?.click() },
    { g: "Fichier", l: "Nouvelle session vierge", f: reinitialiserSession },
    { g: "Export", l: "Exporter en PNG", f: () => exporter("image/png") },
    { g: "Export", l: "Exporter en WebP", f: () => exporter("image/webp") },
    { g: "Export", l: "Exporter la sélection", f: () => exporter("image/png", { selection: true }), desactive: !selectionIds.length },
    { g: "Export", l: "Copier dans le presse-papiers", f: exporterPressePapiers },
    { g: "Image", l: "Rogner les bords vides", f: rognerBordsVides, desactive: actif?.type !== "image" },
    { g: "Image", l: "Auto-contraste", f: appliquerAutoContraste, desactive: actif?.type !== "image" },
    { g: "Image", l: "Restaurer l'original", f: restaurerOriginal, desactive: actif?.type !== "image" || !actif?.srcOriginal },
    { g: "Aide", l: "Raccourcis clavier", k: "F1", f: () => setAideVisible(true) },
  ];
  const resultatsPalette = COMMANDES_PALETTE.filter((commande) => !recherchePalette || `${commande.g} ${commande.l}`.toLowerCase().includes(recherchePalette.toLowerCase()));

  useEffect(() => {
    const saisie = (cible) => cible?.matches?.("input, textarea, select, [contenteditable='true']");
    const toucheBas = (event) => {
      if (!scene.current?.offsetParent || saisie(event.target)) return;
      if (paletteMiroir.current) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOuverte(false); }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); ouvrirPalette(); return; }
      if (aideMiroir.current) {
        if (event.key === "Escape") setAideVisible(false);
        return;
      }
      if (event.key === "F1" || event.key === "?") { event.preventDefault(); setAideVisible(true); return; }
      if (miroirMenuOutils.current && event.key === "Escape") { setMenuOutils(null); return; }
      const cmd = event.ctrlKey || event.metaKey;
      const touche = event.key.toLowerCase();
      if (event.code === "Space" && !event.repeat) {
        event.preventDefault();
        outilAvantEspace.current = outil;
        setOutil("main");
        return;
      }
      if (commandes.current.editionNoeudsActive) {
        if (event.key === "Escape") { event.preventDefault(); commandes.current.fermerEditionNoeuds(); return; }
        return;
      }
      if (commandes.current.plumeActif) {
        if (event.key === "Enter") { event.preventDefault(); commandes.current.plumeTerminer(); return; }
        if (event.key === "Escape") { event.preventDefault(); commandes.current.plumeAnnuler(); return; }
        if (event.key === "Backspace" || event.key === "Delete") { event.preventDefault(); commandes.current.plumeReculer(); return; }
      }
      if (cmd && touche === "z") { event.preventDefault(); event.shiftKey ? commandes.current.retablir() : commandes.current.annuler(); }
      else if (cmd && touche === "y") { event.preventDefault(); commandes.current.retablir(); }
      else if (cmd && touche === "d") { event.preventDefault(); commandes.current.dupliquer(); }
      else if (cmd && touche === "g") { event.preventDefault(); event.shiftKey ? commandes.current.dissocier() : commandes.current.grouper(); }
      else if (cmd && event.altKey && touche === "c") { event.preventDefault(); commandes.current.copierStyle(); }
      else if (cmd && event.altKey && touche === "v") { event.preventDefault(); commandes.current.collerStyle(); }
      else if (cmd && touche === "c") { event.preventDefault(); commandes.current.copier(); }
      else if (cmd && touche === "v") { event.preventDefault(); commandes.current.coller(); }
      else if (cmd && touche === "x") { event.preventDefault(); commandes.current.couper(); }
      else if (cmd && touche === "a") { event.preventDefault(); commandes.current.toutSelectionner(); }
      else if (cmd && touche === "s") { event.preventDefault(); commandes.current.enregistrer(); }
      else if (cmd && (event.key === "+" || event.key === "=")) { event.preventDefault(); setZoom((z) => Math.min(400, z * 1.1)); }
      else if (cmd && event.key === "-") { event.preventDefault(); setZoom((z) => Math.max(10, z * .9)); }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); commandes.current.supprimer(); }
      else if (event.key === "Escape") { commandes.current.friseRemonter(); setRecadrageRect(null); setEditionTexteId(null); }
      else if (event.key === "Tab") { event.preventDefault(); event.shiftKey ? commandes.current.frisePrecedent() : commandes.current.friseSuivant(); }
      else if (event.key === "Enter") { event.preventDefault(); commandes.current.friseEntrer(); }
      else if (event.key === "F2") { event.preventDefault(); commandes.current.renommer(); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); commandes.current.deplacer(event.shiftKey ? -10 : -1, 0); }
      else if (event.key === "ArrowRight") { event.preventDefault(); commandes.current.deplacer(event.shiftKey ? 10 : 1, 0); }
      else if (event.key === "ArrowUp") { event.preventDefault(); commandes.current.deplacer(0, event.shiftKey ? -10 : -1); }
      else if (event.key === "ArrowDown") { event.preventDefault(); commandes.current.deplacer(0, event.shiftKey ? 10 : 1); }
      else if (!cmd && touche === "]") commandes.current.premierPlan();
      else if (!cmd && touche === "[") commandes.current.arrierePlan();
      else if (!cmd && touche === "v") setOutil("selection");
      else if (!cmd && touche === "h") setOutil("main");
      else if (!cmd && touche === "t") setOutil("texte");
      else if (!cmd && touche === "r") commandes.current.ajouterRectangle();
      else if (!cmd && touche === "o") commandes.current.ajouterEllipse();
      else if (!cmd && touche === "f") commandes.current.ajouterFrame();
      else if (!cmd && touche === "l") setOutil("ligne");
      else if (!cmd && touche === "s") setOutil("etoile");
      else if (!cmd && touche === "k") setOutil("pinceau");
      else if (!cmd && touche === "c") setOutil("recadrage");
      else if (!cmd && touche === "p") setOutil("plume");
      else if (!cmd && touche === "g") setOutil("gomme");
      else if (!cmd && touche === "e") setOutil("restauration");
      else if (!cmd && touche === "i") setOutil("pipette");
      else if (!cmd && event.key === "0") commandes.current.ajusterEcran();
      else if (!cmd && event.key === "1") { setZoom(100); setPan({ x: 0, y: 0 }); }
      else if (!cmd && event.shiftKey && event.key === "2") commandes.current.zoomSelection();
    };
    const toucheHaute = (event) => {
      if (event.code === "Space" && outilAvantEspace.current) {
        setOutil(outilAvantEspace.current);
        outilAvantEspace.current = null;
      }
    };
    window.addEventListener("keydown", toucheBas);
    window.addEventListener("keyup", toucheHaute);
    return () => {
      window.removeEventListener("keydown", toucheBas);
      window.removeEventListener("keyup", toucheHaute);
    };
  }, [outil, setSelection]);

  const rendreNoeud = (objet) => {
    if (!objet || objet.visible === false) return null;
    const ombre = objet.ombre?.active ? `${objet.ombre.x}px ${objet.ombre.y}px ${objet.ombre.flou}px ${objet.ombre.couleur}` : undefined;
    const style = { left: objet.x, top: objet.y, width: objet.largeur, height: objet.hauteur, opacity: objet.opacite ?? 1, transform: `rotate(${objet.rotation || 0}deg) scale(${objet.retourneX ? -1 : 1}, ${objet.retourneY ? -1 : 1})`, mixBlendMode: objet.fusion === "source-over" ? "normal" : objet.fusion, filter: objet.type === "image" ? `${filtreCss(objet.filtres)}${ombre ? ` drop-shadow(${ombre})` : ""}` : undefined, boxShadow: objet.type !== "image" ? ombre : undefined };
    if (objet.type === "frame") return <div className="imgObjetLibre imgObjetFrame" key={objet.id} data-clip={objet.clipContent !== false} style={{ ...style, ...(objet.motif === "points" ? { backgroundImage: `radial-gradient(${objet.degrade?.actif ? objet.degrade.couleurA : objet.couleur} 34%, transparent 37%)`, backgroundSize: "12px 12px" } : { background: objet.degrade?.actif ? degradeCss(objet.degrade) : objet.couleur }), border: `${objet.epaisseur || 0}px solid ${objet.contour}`, borderRadius: `${rayonsEffectifs(objet).join("px ")}px` }}>{objet.children.map((enfant) => rendreNoeud(magasinNoeuds.nodes[enfant]))}</div>;
    if (objet.type === "group") return <div className="imgObjetLibre imgObjetGroupe" key={objet.id} style={style}>{objet.children.map((enfant) => rendreNoeud(magasinNoeuds.nodes[enfant]))}</div>;
    if (objet.type === "image") return <img className="imgObjetLibre" key={objet.id} src={objet.src} alt="" draggable="false" style={style} />;
    if (objet.type === "dessin") return <svg className="imgObjetLibre imgObjetDessin" key={objet.id} viewBox={`0 0 ${objet.largeur} ${objet.hauteur}`} preserveAspectRatio="none" style={style}><polyline points={(objet.points || []).map((pt) => `${pt.px * objet.largeur},${pt.py * objet.hauteur}`).join(" ")} fill="none" stroke={objet.couleur} strokeWidth={objet.epaisseur} strokeLinecap="round" strokeLinejoin="round" /></svg>;
    if (objet.type === "plume") return <svg className="imgObjetLibre imgObjetDessin" key={objet.id} viewBox={`0 0 ${objet.largeur} ${objet.hauteur}`} preserveAspectRatio="none" style={style}><path d={cheminPlume(objet.points || [], objet.largeur, objet.hauteur, objet.ferme)} fill={objet.rempli ? objet.couleurRempli : "none"} stroke={objet.couleur} strokeWidth={objet.epaisseur} strokeLinecap="round" strokeLinejoin="round" /></svg>;
    if (objet.type === "forme" && objet.forme === "ligne") return <svg className="imgObjetLibre imgObjetDessin" key={objet.id} viewBox={`0 0 ${objet.largeur} ${objet.hauteur}`} preserveAspectRatio="none" style={style}><line x1="0" y1="0" x2={objet.largeur} y2={objet.hauteur} stroke={objet.contour} strokeWidth={Math.max(1, objet.epaisseur || 3)} strokeLinecap="round" /></svg>;
    if (objet.type === "texte") return <div className="imgObjetLibre imgObjetTexte" key={objet.id} style={{ ...style, ...(objet.degrade?.actif ? { backgroundImage: degradeCss(objet.degrade), WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" } : { color: objet.couleur }), fontFamily: objet.police, fontSize: objet.taille, fontWeight: objet.gras ? 700 : 400, fontStyle: objet.italique ? "italic" : undefined, lineHeight: objet.interligne || 1.15, letterSpacing: objet.espacement ? `${objet.espacement}px` : undefined, textTransform: objet.casse === "majuscules" ? "uppercase" : objet.casse === "minuscules" ? "lowercase" : undefined, WebkitTextStroke: objet.texteContour?.actif ? `${objet.texteContour.epaisseur}px ${objet.texteContour.couleur}` : undefined, paintOrder: "stroke", textDecoration: objet.souligne ? "underline" : objet.barre ? "line-through" : undefined, justifyContent: objet.alignement === "gauche" ? "flex-start" : objet.alignement === "droite" ? "flex-end" : "center", textAlign: objet.alignement === "gauche" ? "left" : objet.alignement === "droite" ? "right" : "center" }}>{appliquerCasse(objet.texte, objet.casse)}</div>;
    const formePleine = objet.forme === "triangle" || objet.forme === "etoile";
    return <div className="imgObjetLibre imgObjetForme" key={objet.id} data-forme={objet.forme} style={{ ...style, ...(objet.motif === "points" ? { backgroundImage: `radial-gradient(${objet.degrade?.actif ? objet.degrade.couleurA : objet.couleur} 34%, transparent 37%)`, backgroundSize: "12px 12px" } : { background: objet.degrade?.actif ? degradeCss(objet.degrade) : objet.couleur }), border: formePleine ? undefined : `${objet.epaisseur || 0}px solid ${objet.contour}`, borderRadius: objet.forme === "ellipse" ? "50%" : `${rayonsEffectifs(objet).join("px ")}px` }}>{objet.children?.map((enfant) => rendreNoeud(magasinNoeuds.nodes[enfant]))}</div>;
  };

  return (
    <ModuleWindow manifest={manifest} className="imgApp">
      <div className="imgBarre">
        <input ref={importeur} hidden multiple type="file" accept="image/*" onChange={(e) => Array.from(e.target.files || []).forEach(importer)} />
        <input ref={importeurProjet} hidden type="file" accept=".cosimage,application/json" onChange={(e) => ouvrirProjet(e.target.files?.[0])} />
        <span className="imgMarque"><i><Icon fafa="faImages" width={12} /></i> Atelier Image<small>{manifest.version}</small></span>
        <input className="imgNomDesign" value={nomDesign} onChange={(e) => setNomDesign(e.target.value)} aria-label="Nom du design" spellCheck={false} />
        <span className="imgStatut" data-statut={statutSauvegarde} title={{ enCours: "Sauvegarde automatique en cours", enregistre: "Session enregistrée localement", horsLigne: "Stockage local indisponible" }[statutSauvegarde]}><i />{{ enCours: "Enregistrement…", enregistre: "Enregistré", horsLigne: "Hors ligne" }[statutSauvegarde]}</span>
        <button className="imgIcone" title="Ouvrir un projet (.cosimage)" aria-label="Ouvrir un projet" onClick={() => importeurProjet.current?.click()}><Icon fafa="faFolderOpen" width={13} /></button>
        <button className="imgIcone" title="Sauvegarder le projet (Ctrl+S)" aria-label="Sauvegarder le projet" onClick={enregistrerProjet}><Icon fafa="faFloppyDisk" width={13} /></button>
        <span className="imgSeparateur" />
        <button className="imgIcone" title="Annuler (Ctrl+Z)" aria-label="Annuler" disabled={!historique.passe.length} onClick={annuler}><Icon fafa="faRotateLeft" width={13} /></button>
        <button className="imgIcone" title="Rétablir (Ctrl+Shift+Z)" aria-label="Rétablir" disabled={!historique.futur.length} onClick={retablir}><Icon fafa="faRotateRight" width={13} /></button>
        <span className="imgSeparateur" />
        <button className="imgIcone" title="Commandes (Ctrl+K)" aria-label="Palette de commandes" onClick={ouvrirPalette}><Icon fafa="faMagnifyingGlass" width={13} /></button>
        <button className="imgIcone" data-actif={aideVisible} title="Raccourcis clavier (F1)" aria-label="Raccourcis clavier" onClick={() => setAideVisible(true)}><Icon fafa="faCircleQuestion" width={13} /></button>
      </div>

      <div className="imgCorps">
        <aside className="imgOutils">
          <div className="imgPanneauOnglets"><button data-actif={ongletGauche === "calques"} onClick={() => setOngletGauche("calques")}>Calques</button><button data-actif={ongletGauche === "ressources"} onClick={() => setOngletGauche("ressources")}>Modèles</button></div>
          <div className="imgPages"><b>Scènes</b><button title="Nouvelle scène" aria-label="Nouvelle scène" onClick={nouvellePage}><Icon fafa="faPlus" width={11} /></button><div className="imgListePages">{pages.map((page) => (
            <div className="imgPageLigne" key={page.id} data-actif={page.id === pageActive} data-cachee={Boolean(page.cachee)}>
              <button className="imgPageOuvrir" onClick={() => changerPage(page.id)} title={page.cachee ? "Scène masquée à l'export" : undefined}>
                <Icon fafa="faRectangleList" width={11} />
                {renommagePage === page.id ? (
                  <input
                    autoFocus
                    value={valeurRenommagePage}
                    onChange={(e) => setValeurRenommagePage(e.target.value)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onBlur={() => { renommerPage(page.id, valeurRenommagePage); setRenommagePage(null); }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter" || e.key === "Escape") { renommerPage(page.id, valeurRenommagePage); setRenommagePage(null); }
                    }}
                  />
                ) : (
                  <span onDoubleClick={() => { setRenommagePage(page.id); setValeurRenommagePage(page.nom); }} title="Double-clic pour renommer">{page.nom}{page.cachee ? " ·" : ""}</span>
                )}
              </button>
              <span className="imgPageActions">
                <button title="Dupliquer la scène" aria-label={`Dupliquer ${page.nom}`} onClick={() => dupliquerPageAction(page.id)}><Icon fafa="faClone" width={10} /></button>
                <button title={page.cachee ? "Afficher la scène" : "Masquer la scène"} aria-label={page.cachee ? "Afficher" : "Masquer"} onClick={() => basculerPageCachee(page.id)}><Icon fafa={page.cachee ? "faEyeSlash" : "faEye"} width={10} /></button>
                {pages.length > 1 ? <button className="imgPageSupprimer" title={`Supprimer ${page.nom}`} aria-label={`Supprimer ${page.nom}`} onClick={() => supprimerPage(page.id)}><Icon fafa="faTrashCan" width={10} /></button> : null}
              </span>
            </div>
          ))}</div></div>
          <h3>{ongletGauche === "calques" ? "Calques" : "Modèles"} <small>{ongletGauche === "calques" ? objets.length : MODELES.length}</small></h3>
          {ongletGauche === "calques" ? <div className="imgCalques">
            {objetsHierarchiques.map((objet) => (
              <button key={objet.id} data-actif={selectionIds.includes(objet.id)} style={{ paddingLeft: 7 + objet.profondeur * 16 }} onClick={(event) => event.shiftKey ? setSelectionIds((ids) => ids.includes(objet.id) ? ids.filter((identifiant) => identifiant !== objet.id) : [...ids, objet.id]) : setSelection(objet.id)}>
                <span><Icon fafa={objet.type === "group" ? "faObjectGroup" : objet.type === "frame" ? "faBorderAll" : objet.type === "image" ? "faImage" : objet.type === "dessin" ? "faPaintbrush" : objet.type === "plume" ? "faPenNib" : objet.type === "texte" ? "faFont" : objet.forme === "ellipse" ? "faCircle" : objet.forme === "triangle" ? "faShapes" : objet.forme === "etoile" ? "faStar" : objet.forme === "ligne" ? "faSlash" : "faSquare"} width={12} /></span>
                {renommageId === objet.id ? <input
                  autoFocus
                  value={valeurRenommage}
                  onChange={(e) => setValeurRenommage(e.target.value)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onBlur={() => { modifier((liste) => liste.map((o) => o.id === renommageId ? { ...o, nom: valeurRenommage.trim() || o.nom } : o)); setRenommageId(null); }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") { modifier((liste) => liste.map((o) => o.id === renommageId ? { ...o, nom: valeurRenommage.trim() || o.nom } : o)); setRenommageId(null); }
                    if (e.key === "Escape") setRenommageId(null);
                  }}
                /> : <b onDoubleClick={(event) => { event.stopPropagation(); setRenommageId(objet.id); setValeurRenommage(objet.nom); }} title="Double-clic pour renommer">{objet.nom}</b>}
                <i title={objet.visible ? "Masquer" : "Afficher"} onClick={(e) => { e.stopPropagation(); modifier((liste) => liste.map((o) => o.id === objet.id ? { ...o, visible: !o.visible } : o)); }}><Icon fafa={objet.visible ? "faEye" : "faEyeSlash"} width={12} /></i>
                <i className="imgCadenas" data-actif={Boolean(objet.verrouille)} title={objet.verrouille ? "Déverrouiller" : "Verrouiller"} onClick={(e) => { e.stopPropagation(); modifier((liste) => liste.map((o) => o.id === objet.id ? { ...o, verrouille: !o.verrouille } : o)); }}><Icon fafa={objet.verrouille ? "faLock" : "faLockOpen"} width={11} /></i>
              </button>
            ))}
            {!objets.length ? <p>Importez une image ou ajoutez un élément.</p> : null}
          </div> : <div className="imgModeles">
            <p className="imgModelesIntro">Partez d'une structure prête à personnaliser — formes, textes, dégradés et motifs inclus. Vos photos se déposent ensuite par glisser-déposer.</p>
            {MODELES.map((modele) => (
              <div className="imgModele" key={modele.id}>
                <b>{modele.nom}</b>
                <small>{modele.largeur} × {modele.hauteur}</small>
                <p>{modele.description}</p>
                <div className="imgModeleActions">
                  <button onClick={() => appliquerModele(modele, false)}>Remplacer</button>
                  <button onClick={() => appliquerModele(modele, true)}>+ Scène</button>
                </div>
              </div>
            ))}
          </div>}
          {ongletGauche === "calques" ? <div className="imgOrdre">
            <button disabled={!actif} onClick={() => deplacerCalque(1)}>Monter</button>
            <button disabled={!actif} onClick={() => deplacerCalque(-1)}>Descendre</button>
            <button disabled={!actif} onClick={dupliquer}>Dupliquer</button>
            <button disabled={!actif} onClick={supprimer}><Icon fafa="faTrashCan" width={10} /> Supprimer</button>
            <button disabled={selectionIds.length < 2} onClick={grouperSelection}><Icon fafa="faObjectGroup" width={10} /> Grouper</button>
            <button disabled={actif?.type !== "group"} onClick={dissocierGroupe}><Icon fafa="faObjectUngroup" width={10} /> Dissocier</button>
            <button disabled={!actif} title="Premier plan (])" onClick={() => ordreExtreme(false)}><Icon fafa="faAngleUp" width={10} /> Premier plan</button>
            <button disabled={!actif} title="Arrière-plan ([)" onClick={() => ordreExtreme(true)}><Icon fafa="faAngleDown" width={10} /> Arrière-plan</button>
          </div> : null}
        </aside>

        <main
          ref={scene}
          className="imgScene"
          data-outil={outil}
          data-depot={depotActif}
          data-transparent={fondTransparent}
          data-contour={modeContour}
          style={{ backgroundColor: fondTransparent ? undefined : fond }}
          onDragEnter={(event) => { event.preventDefault(); setDepotActif(true); }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDepotActif(true); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDepotActif(false); }}
          onDrop={deposerFichiers}
          onDoubleClick={surDoubleClic}
          onContextMenu={surContextMenu}
          onPointerDown={appuyer}
          onPointerMove={bouger}
          onPointerUp={relacher}
          onPointerCancel={relacher}
        >
          <div className="imgMonde" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
          <div className="imgPlan" style={{ width: largeurPlan, height: hauteurPlan, transform: `translate(-50%, -50%) scale(${zoom / 100})` }}>
            <canvas
              ref={canvas}
              width={largeurPlan}
              height={hauteurPlan}
            />
            {magasinNoeuds.rootIds.map((identifiant) => rendreNoeud(magasinNoeuds.nodes[identifiant]))}
            {tracePlume && curseurPlume ? (() => {
              const dernier = tracePlume.pointsAbs.at(-1);
              const echelleVue = 1 / (zoom / 100);
              return (
                <svg className="imgPlumeApercu" viewBox={`0 0 ${largeurPlan} ${hauteurPlan}`}>
                  <line x1={dernier.x} y1={dernier.y} x2={curseurPlume.x} y2={curseurPlume.y} stroke="#0d99ff" strokeWidth={echelleVue} strokeDasharray={`${4 * echelleVue} ${3 * echelleVue}`} />
                  {tracePlume.pointsAbs.map((pt, index) => <circle key={index} cx={pt.x} cy={pt.y} r={3.5 * echelleVue} fill={index === 0 && tracePlume.pointsAbs.length > 2 ? "#0d99ff" : "#ffffff"} stroke="#0d99ff" strokeWidth={echelleVue} />)}
                </svg>
              );
            })() : null}
            {outil === "restauration" && curseurRestauration ? (() => {
              const echelleVue = 1 / (zoom / 100);
              return (
                <svg className="imgPlumeApercu" viewBox={`0 0 ${largeurPlan} ${hauteurPlan}`}>
                  <circle cx={curseurRestauration.x} cy={curseurRestauration.y} r={restaurationRayon} fill="rgb(13 153 255 / 14%)" stroke="#0d99ff" strokeWidth={echelleVue} strokeDasharray={`${5 * echelleVue} ${3 * echelleVue}`} />
                </svg>
              );
            })() : null}
            {editionNoeud && editionMonde && editionNoeud.type === "plume" ? (() => {
              const echelleVue = 1 / (zoom / 100);
              const points = ancresAbsolues(editionNoeud, editionMonde);
              const segments = points.map((pt, index) => ({ a: pt, b: points[(index + 1) % points.length] })).slice(0, editionNoeud.ferme ? points.length : points.length - 1);
              return (
                <svg className="imgNoeudsApercu" viewBox={`0 0 ${largeurPlan} ${hauteurPlan}`}>
                  {segments.map((segment, index) => <line key={`seg${index}`} x1={segment.a.x} y1={segment.a.y} x2={segment.b.x} y2={segment.b.y} strokeWidth={echelleVue} />)}
                  {segments.map((segment, index) => (
                    <circle key={`plus${index}`} className="imgPointAjout" cx={(segment.a.x + segment.b.x) / 2} cy={(segment.a.y + segment.b.y) / 2} r={4 * echelleVue} strokeDasharray={`${2 * echelleVue} ${2 * echelleVue}`} strokeWidth={echelleVue} onPointerDown={(e) => e.stopPropagation()} onClick={() => ajouterAncre(index)} />
                  ))}
                  {points.map((pt, index) => (
                    <g key={`poig${index}`}>
                      {pt.hax != null ? <line x1={pt.x} y1={pt.y} x2={pt.hax} y2={pt.hay} strokeWidth={echelleVue} /> : null}
                      {pt.hbx != null ? <line x1={pt.x} y1={pt.y} x2={pt.hbx} y2={pt.hby} strokeWidth={echelleVue} /> : null}
                    </g>
                  ))}
                  {points.map((pt, index) => (
                    <g key={`poin${index}`}>
                      {pt.hax != null ? <circle className="imgPoigneeNoeud" cx={pt.hax} cy={pt.hay} r={3.5 * echelleVue} onPointerDown={(e) => demarrerGesteNoeud(e, index, "a")} /> : null}
                      {pt.hbx != null ? <circle className="imgPoigneeNoeud" cx={pt.hbx} cy={pt.hby} r={3.5 * echelleVue} onPointerDown={(e) => demarrerGesteNoeud(e, index, "b")} /> : null}
                      <circle className="imgAncre" cx={pt.x} cy={pt.y} r={5 * echelleVue} strokeWidth={1.5 * echelleVue} onPointerDown={(e) => demarrerGesteNoeud(e, index, "point")} onDoubleClick={() => supprimerAncre(index)} />
                    </g>
                  ))}
                </svg>
              );
            })() : null}
            {editionTexteId && magasinNoeuds.nodes[editionTexteId] ? (() => {
              const objet = magasinNoeuds.nodes[editionTexteId];
              return (
                <textarea
                  className="imgEditeurTexte"
                  autoFocus
                  value={objet.texte || ""}
                  spellCheck={false}
                  onChange={(e) => { majActif("texte", e.target.value, false); ajusterHauteurTexte(editionTexteId, e.target.value); }}
                  onBlur={() => setEditionTexteId(null)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
                      e.preventDefault();
                      setEditionTexteId(null);
                    }
                  }}
                  style={{ left: `${objet.x / largeurPlan * 100}%`, top: `${objet.y / hauteurPlan * 100}%`, width: objet.largeur, height: objet.hauteur, color: objet.couleur, fontFamily: objet.police, fontSize: objet.taille, fontWeight: objet.gras ? 700 : 400, fontStyle: objet.italique ? "italic" : undefined, lineHeight: objet.interligne || 1.15, letterSpacing: objet.espacement ? `${objet.espacement}px` : undefined, textTransform: objet.casse === "majuscules" ? "uppercase" : objet.casse === "minuscules" ? "lowercase" : undefined, WebkitTextStroke: objet.texteContour?.actif ? `${objet.texteContour.epaisseur}px ${objet.texteContour.couleur}` : undefined, paintOrder: "stroke", textAlign: objet.alignement || "center", textDecoration: objet.souligne ? "underline" : undefined }}
                />
              );
            })() : null}
          </div>
          </div>
          {marquee ? (() => {
            const origine = mondeVersEcran(marquee.x, marquee.y);
            const echelle = zoom / 100;
            return <div className="imgMarquee" style={{ left: origine.x, top: origine.y, width: marquee.largeur * echelle, height: marquee.hauteur * echelle }} />;
          })() : null}
          {recadrageRect ? (() => {
            const origine = mondeVersEcran(recadrageRect.x, recadrageRect.y);
            const echelle = zoom / 100;
            return <div className="imgRecadrage" style={{ left: origine.x, top: origine.y, width: recadrageRect.largeur * echelle, height: recadrageRect.hauteur * echelle }}><output>{Math.round(recadrageRect.largeur)} × {Math.round(recadrageRect.hauteur)}</output></div>;
          })() : null}
          {guides.x !== null ? <i className="imgGuide imgGuideV" style={{ left: mondeVersEcran(guides.x, 0).x }} /> : null}
          {guides.y !== null ? <i className="imgGuide imgGuideH" style={{ top: mondeVersEcran(0, guides.y).y }} /> : null}
          {guidesCourantes.v.map((valeur, index) => <i key={`guideV${index}`} className="imgGuidePersist imgGuidePersistV" style={{ left: mondeVersEcran(valeur, 0).x }} />)}
          {guidesCourantes.h.map((valeur, index) => <i key={`guideH${index}`} className="imgGuidePersist imgGuidePersistH" style={{ top: mondeVersEcran(0, valeur).y }} />)}
          {guideEnCours ? (guideEnCours.axe === "v" ? <i className="imgGuidePersist imgGuidePersistV imgGuideNouveau" style={{ left: mondeVersEcran(guideEnCours.pos, 0).x }} /> : <i className="imgGuidePersist imgGuidePersistH imgGuideNouveau" style={{ top: mondeVersEcran(0, guideEnCours.pos).y }} />) : null}
          {overlaySelection ? (
            <div className="imgSelection" data-verrouille={selectionMonde.some((objet) => objet.verrouille)} data-multiple={selectionIds.length > 1} style={{ left: overlaySelection.centre.x, top: overlaySelection.centre.y, width: overlaySelection.largeur, height: overlaySelection.hauteur, transform: `translate(-50%, -50%) rotate(${overlaySelection.rotation}deg)` }}>
              {["no", "n", "ne", "e", "se", "s", "so", "o"].map((coin) => <i
                key={coin}
                data-coin={coin}
                onPointerDown={(e) => commencerRedimensionnement(e, coin)}
              />)}
              {selectionIds.length === 1 ? <><i className="imgRotationTige" /><button className="imgRotationPoignee" title="Faire pivoter" aria-label="Faire pivoter" onPointerDown={commencerRotation} /></> : null}
              {selectionIds.length === 1 && actif.type === "forme" && actif.forme === "rectangle" ? <><button className="imgRayon imgRayonGauche" title="Rayon des angles" aria-label="Modifier le rayon des angles" onPointerDown={(e) => commencerRayon(e, "gauche")} /><button className="imgRayon imgRayonDroite" title="Rayon des angles" aria-label="Modifier le rayon des angles" onPointerDown={(e) => commencerRayon(e, "droite")} /></> : null}
              <output className="imgTailleObjet">{Math.round(selectionIds.length > 1 ? boundsSelection.largeur : actif.largeur)} × {Math.round(selectionIds.length > 1 ? boundsSelection.hauteur : actif.hauteur)}</output>
            </div>
          ) : null}
          {barreFlottante ? (
            <div className="imgBarreFlottante" style={{ left: barreFlottante.gauche, top: barreFlottante.haut }} onPointerDown={(event) => event.stopPropagation()}>
              <button title="Dupliquer (Ctrl+D)" aria-label="Dupliquer" onClick={dupliquer}><Icon fafa="faClone" width={12} /></button>
              <button title="Copier le style (Ctrl+Alt+C)" aria-label="Copier le style" onClick={copierStyle}><Icon fafa="faCopy" width={12} /></button>
              <button title="Coller le style (Ctrl+Alt+V)" aria-label="Coller le style" disabled={!presseStyle.current} onClick={collerStyle}><Icon fafa="faPaste" width={12} /></button>
              <span />
              <button title="Premier plan (])" aria-label="Premier plan" onClick={() => ordreExtreme(false)}><Icon fafa="faAngleUp" width={12} /></button>
              <button title="Arrière-plan ([)" aria-label="Arrière-plan" onClick={() => ordreExtreme(true)}><Icon fafa="faAngleDown" width={12} /></button>
              <button className="imgDangerFlottant" title="Supprimer (Suppr)" aria-label="Supprimer" onClick={supprimer}><Icon fafa="faTrashCan" width={12} /></button>
            </div>
          ) : null}
          {reglesVisibles ? <>
            <div className="imgRegle imgRegleHorizontale" title="Glissez pour créer un guide vertical" onPointerDown={(event) => demarrerGuide(event, "v")} onPointerMove={bougerGuide} onPointerUp={finirGuide} onPointerCancel={finirGuide}>
              <div className="imgRegleRuban" style={{ transform: `translateX(${graduationsH.origine}px)` }}>
                {ticksRegles(graduationsH.debut, graduationsH.fin).map((valeur) => <span key={valeur} data-majeur={valeur % 100 === 0} style={{ left: valeur * graduationsH.echelle }}>{valeur % 100 === 0 ? valeur : ""}</span>)}
              </div>
            </div>
            <div className="imgRegle imgRegleVerticale" title="Glissez pour créer un guide horizontal" onPointerDown={(event) => demarrerGuide(event, "h")} onPointerMove={bougerGuide} onPointerUp={finirGuide} onPointerCancel={finirGuide}>
              <div className="imgRegleRuban" style={{ transform: `translateY(${graduationsV.origine}px)` }}>
                {ticksRegles(graduationsV.debut, graduationsV.fin).map((valeur) => <span key={valeur} data-majeur={valeur % 100 === 0} style={{ top: valeur * graduationsV.echelle }}>{valeur % 100 === 0 ? valeur : ""}</span>)}
              </div>
            </div>
            <button className="imgRegleCoin" title="Effacer tous les guides" onClick={effacerGuides}><Icon fafa="faTrashCan" width={9} /></button>
          </> : null}
          <div className="imgZoom" onPointerDown={(event) => event.stopPropagation()}>
            <button data-actif={reglesVisibles} title="Règles et guides" aria-label="Afficher les règles" onClick={() => setReglesVisibles((valeur) => !valeur)}><Icon fafa="faRulerCombined" width={11} /></button>
            <button title="Dézoomer (Ctrl/Cmd −)" aria-label="Dézoomer" onClick={() => setZoom((z) => Math.max(10, z / 1.1))}><Icon fafa="faMinus" width={11} /></button>
            <button className="imgZoomValeur" title="Ajuster à l’écran (0)" onClick={ajusterEcran}>{Math.round(zoom)}%</button>
            <button title="Zoomer (Ctrl/Cmd +)" aria-label="Zoomer" onClick={() => setZoom((z) => Math.min(400, z * 1.1))}><Icon fafa="faPlus" width={11} /></button>
            <input
              className="imgRangeHisto"
              type="range"
              min="0"
              max={historique.passe.length + historique.futur.length}
              value={historique.passe.length}
              disabled={!(historique.passe.length + historique.futur.length)}
              title="Voyage temporel dans l'historique"
              aria-label="Voyage temporel dans l'historique"
              onChange={(e) => voyagerDansTemps(Number(e.target.value))}
            />
          </div>
          <div className="imgMinimap" style={{ top: reglesVisibles ? 22 : 12 }} title="Minimap — cliquez ou glissez pour naviguer" onPointerDown={(event) => { event.stopPropagation(); naviguerMinimap(event); }} onPointerMove={(event) => { if (event.buttons === 1) { event.stopPropagation(); naviguerMinimap(event); } }}>
            <svg viewBox={`0 0 ${largeurPlan} ${hauteurPlan}`} preserveAspectRatio="xMidYMid meet">
              <rect className="imgMiniPlan" x="0" y="0" width={largeurPlan} height={hauteurPlan} />
              {objetsHierarchiques.map((objet) => objet.visible === false ? null : (
                <rect key={objet.id} className={`imgMiniObjet${selectionIds.includes(objet.id) ? " imgMiniActif" : ""}`} x={objet.x} y={objet.y} width={Math.max(2, objet.largeur)} height={Math.max(2, objet.hauteur)} rx={3} />
              ))}
              <rect className="imgMiniVue" x={vueMonde.x} y={vueMonde.y} width={Math.max(30, vueMonde.largeur)} height={Math.max(30, vueMonde.hauteur)} />
            </svg>
          </div>
          {menuOutils ? <div className="imgVoileMenu" onPointerDown={(event) => { event.stopPropagation(); setMenuOutils(null); }} onWheel={() => setMenuOutils(null)} /> : null}
          <div className="imgOutilsCentre" aria-label="Outils du canvas" onPointerDown={(event) => event.stopPropagation()}>
            <div className="imgGroupeOutils">
              <button data-actif={outil === "selection"} title="Sélection (V)" aria-label="Outil Sélection" onClick={() => setOutil("selection")}><Icon fafa="faArrowPointer" width={14} /></button>
              <button data-actif={outil === "main"} title="Main (H)" aria-label="Outil Main" onClick={() => setOutil("main")}><Icon fafa="faHand" width={14} /></button>
            </div>
            <span className="imgDockSeparateur" />
            <div className="imgGroupeOutils">
              <button title="Importer une image" aria-label="Importer une image" onClick={() => importeur.current?.click()}><Icon fafa="faImage" width={14} /></button>
              <button data-actif={outil === "frame"} title="Frame (F)" aria-label="Dessiner une frame" onClick={() => setOutil("frame")}><Icon fafa="faBorderAll" width={14} /></button>
              {(() => {
                const courante = ICONES_FORMES.find(([id]) => id === outil);
                const [idActif, icone, libelle] = courante || ["rectangle", "faSquare", "Rectangle"];
                return (
                  <span className="imgOutilCompose">
                    <button data-actif={Boolean(courante)} title={`${libelle} — formes`} aria-label={`Forme : ${libelle}`} onClick={() => setOutil(idActif)}><Icon fafa={icone} width={14} /></button>
                    <button className="imgChevronOutil" data-ouvert={menuOutils === "formes"} title="Autres formes" aria-label="Choisir une forme" onClick={() => setMenuOutils((valeur) => valeur === "formes" ? null : "formes")}><Icon fafa="faChevronDown" width={9} /></button>
                    {menuOutils === "formes" ? <div className="imgMenuOutil">
                      {ICONES_FORMES.map(([identifiant, iconeItem, libelleItem, touche]) => (
                        <button key={identifiant} onClick={() => { setOutil(identifiant); setMenuOutils(null); }}>
                          <Icon fafa={iconeItem} width={13} />
                          <span>{libelleItem}</span>
                          {touche ? <small>{touche}</small> : null}
                        </button>
                      ))}
                    </div> : null}
                  </span>
                );
              })()}
              <button data-actif={outil === "texte"} title="Texte (T) — cliquez dans la scène pour placer, Entrée valide" aria-label="Outil texte" onClick={() => setOutil("texte")}><Icon fafa="faFont" width={14} /></button>
              {(() => {
                const courante = ICONES_DESSINS.find(([id]) => id === outil);
                const [idActif, icone, libelle] = courante || ["pinceau", "faPaintbrush", "Pinceau"];
                return (
                  <span className="imgOutilCompose">
                    <button data-actif={Boolean(courante)} title={libelle} aria-label={`Outil ${libelle}`} onClick={() => setOutil(idActif)}><Icon fafa={icone} width={14} /></button>
                    <button className="imgChevronOutil" data-ouvert={menuOutils === "dessin"} title="Pinceau ou plume" aria-label="Choisir un outil de dessin" onClick={() => setMenuOutils((valeur) => valeur === "dessin" ? null : "dessin")}><Icon fafa="faChevronDown" width={9} /></button>
                    {menuOutils === "dessin" ? <div className="imgMenuOutil">
                      {ICONES_DESSINS.map(([identifiant, iconeItem, libelleItem, touche]) => (
                        <button key={identifiant} onClick={() => { setOutil(identifiant); setMenuOutils(null); }}>
                          <Icon fafa={iconeItem} width={13} />
                          <span>{libelleItem}</span>
                          <small>{touche}</small>
                        </button>
                      ))}
                    </div> : null}
                  </span>
                );
              })()}
              {(() => {
                const courante = ICONES_IMAGE.find(([id]) => id === outil);
                const [idActif, icone, libelle] = courante || ["gomme", "faEraser", "Gomme magique"];
                return (
                  <span className="imgOutilCompose">
                    <button data-actif={Boolean(courante)} title={libelle} aria-label={`Outil ${libelle}`} onClick={() => setOutil(idActif)}><Icon fafa={icone} width={14} /></button>
                    <button className="imgChevronOutil" data-ouvert={menuOutils === "image"} title="Outils image : gomme, restauration, pipette" aria-label="Outils d'image" onClick={() => setMenuOutils((valeur) => valeur === "image" ? null : "image")}><Icon fafa="faChevronDown" width={9} /></button>
                    {menuOutils === "image" ? <div className="imgMenuOutil">
                      {ICONES_IMAGE.map(([identifiant, iconeItem, libelleItem, touche]) => (
                        <button key={identifiant} onClick={() => { setOutil(identifiant); setMenuOutils(null); }}>
                          <Icon fafa={iconeItem} width={13} />
                          <span>{libelleItem}</span>
                          <small>{touche}</small>
                        </button>
                      ))}
                    </div> : null}
                  </span>
                );
              })()}
              <button data-actif={outil === "recadrage"} title="Recadrer l'image sélectionnée (C)" aria-label="Recadrer l'image sélectionnée" onClick={() => setOutil("recadrage")}><Icon fafa="faCropSimple" width={14} /></button>
            </div>
            <span className="imgDockSeparateur" />
            <div className="imgGroupeOutils">
              <button data-actif={modeContour} title="Contours seulement" aria-label="Afficher uniquement les contours" onClick={() => setModeContour((valeur) => !valeur)}><Icon fafa="faVectorSquare" width={14} /></button>
            </div>
          </div>
          {depotActif ? <div className="imgDepot"><Icon fafa="faCloudArrowUp" width={28} /><b>Déposez vos images ici</b><span>PNG, JPEG, WebP, GIF ou SVG</span></div> : null}
          {!objets.length && !depotActif ? <Accueil surImporter={() => importeur.current?.click()} surTexte={ajouterTexte} surForme={() => setOutil("rectangle")} surFrame={() => setOutil("frame")} /> : null}
          <MenuContextuel menu={menuContextuel} fermer={() => setMenuContextuel(null)} />
          <Toast toast={toast} />
          <Aide ouvert={aideVisible} fermer={() => setAideVisible(false)} />
          {paletteOuverte ? (
            <div className="imgPalette" onPointerDown={() => setPaletteOuverte(false)}>
              <div className="imgPaletteCarte" onPointerDown={(event) => event.stopPropagation()}>
                <div className="imgPaletteSaisie">
                  <Icon fafa="faMagnifyingGlass" width={13} />
                  <input
                    autoFocus
                    value={recherchePalette}
                    placeholder="Rechercher une commande…"
                    onChange={(e) => { setRecherchePalette(e.target.value); setIndexPalette(0); }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Escape") setPaletteOuverte(false);
                      else if (e.key === "ArrowDown") { e.preventDefault(); setIndexPalette((i) => Math.min(i + 1, resultatsPalette.length - 1)); }
                      else if (e.key === "ArrowUp") { e.preventDefault(); setIndexPalette((i) => Math.max(i - 1, 0)); }
                      else if (e.key === "Enter") {
                        e.preventDefault();
                        const commande = resultatsPalette[Math.min(indexPalette, resultatsPalette.length - 1)];
                        if (commande && !commande.desactive) { commande.f(); setPaletteOuverte(false); }
                      }
                    }}
                  />
                  <kbd>Échap</kbd>
                </div>
                <div className="imgPaletteListe">
                  {resultatsPalette.map((commande, i) => (
                    <button key={`${commande.g}-${commande.l}`} data-actif={i === indexPalette} disabled={commande.desactive} onMouseEnter={() => setIndexPalette(i)} onClick={() => { commande.f(); setPaletteOuverte(false); }}>
                      <small>{commande.g}</small>
                      <span>{commande.l}</span>
                      {commande.k ? <kbd>{commande.k}</kbd> : null}
                    </button>
                  ))}
                  {!resultatsPalette.length ? <p>Aucune commande ne correspond.</p> : null}
                </div>
              </div>
            </div>
          ) : null}
          {aideVisible ? (
            <div className="imgAide" onPointerDown={() => setAideVisible(false)}>
              <div className="imgAideCarte" onPointerDown={(event) => event.stopPropagation()}>
                <header><b>Raccourcis clavier</b><button onClick={() => setAideVisible(false)} aria-label="Fermer"><Icon fafa="faXmark" width={12} /></button></header>
                <div className="imgAideGroupes">
                  <section><h5>Outils</h5>
                    {[["V", "Sélection"], ["H", "Main"], ["F", "Frame"], ["R", "Rectangle"], ["O", "Ellipse"], ["L", "Ligne"], ["S", "Étoile"], ["T", "Texte"], ["K", "Pinceau"], ["P", "Plume"], ["C", "Recadrage"]].map(([touche, libelle]) => <p key={touche}><span>{libelle}</span><kbd>{touche}</kbd></p>)}
                  </section>
                  <section><h5>Édition</h5>
                    {[["Ctrl+Z", "Annuler"], ["Ctrl+Maj+Z", "Rétablir"], ["Ctrl+C / V", "Copier / coller"], ["Ctrl+X", "Couper"], ["Ctrl+D", "Dupliquer"], ["Alt+glisser", "Dupliquer en déplaçant"], ["Ctrl+G", "Grouper"], ["Ctrl+Maj+G", "Dissocier"], ["Ctrl+A", "Tout sélectionner"], ["Ctrl+S", "Sauver le projet"], ["Suppr", "Supprimer"]].map(([touche, libelle]) => <p key={touche}><span>{libelle}</span><kbd>{touche}</kbd></p>)}
                  </section>
                  <section><h5>Style</h5>
                    {[["Ctrl+Alt+C", "Copier le style"], ["Ctrl+Alt+V", "Coller le style"], ["Maj", "Contraindre (carré, 45°, 15°)"]].map(([touche, libelle]) => <p key={touche}><span>{libelle}</span><kbd>{touche}</kbd></p>)}
                  </section>
                  <section><h5>Calques & affichage</h5>
                    {[["Tab", "Calque suivant"], ["Maj+Tab", "Calque précédent"], ["Entrée", "Descendre dans le groupe"], ["Échap", "Remonter / désélectionner"], ["F2", "Renommer"], ["] / [", "Premier / arrière-plan"], ["0", "Ajuster à l'écran"], ["1", "Zoom 100 %"], ["Maj+2", "Zoom sur la sélection"], ["Ctrl+molette", "Zoom"], ["Flèches", "Déplacer (Maj : ×10)"]].map(([touche, libelle]) => <p key={touche}><span>{libelle}</span><kbd>{touche}</kbd></p>)}
                  </section>
                </div>
              </div>
            </div>
          ) : null}
        </main>

        <aside className="imgProprietes">
          <div className="imgPanneauOnglets imgPanneauOngletsDroit"><button data-actif={ongletDroit === "design"} onClick={() => setOngletDroit("design")}>Design</button><button data-actif={ongletDroit === "export"} onClick={() => setOngletDroit("export")}>Export</button></div>
          <h3>{ongletDroit === "export" ? "Exporter" : selectionIds.length > 1 ? `${selectionIds.length} objets` : actif?.nom || "Plan de travail"}</h3>
          {ongletDroit === "export" ? <div className="imgExportPanel"><p>Plan de travail courant ou sélection.</p><label className="imgExportEchelle">Échelle<select value={echelleExport} onChange={(e) => setEchelleExport(Number(e.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={3}>3×</option></select></label><div className="imgExportBoutons"><button onClick={() => exporter("image/png")}>PNG</button><button onClick={() => exporter("image/jpeg")}>JPEG</button><button onClick={() => exporter("image/webp")}>WebP</button></div>              <button disabled={!selectionIds.length} onClick={() => exporter("image/png", { selection: true })}><Icon fafa="faCropSimple" width={11} /> Sélection ({selectionIds.length})</button>
              <button onClick={exporterPressePapiers}><Icon fafa="faClipboard" width={11} /> Presse-papiers (2×)</button>
              <button onClick={exporterToutesPages} title="Les scènes masquées sont ignorées"><Icon fafa="faLayerGroup" width={11} /> Toutes les pages ({pages.filter((page) => !page.cachee).length})</button>
              <button onClick={exporterPDF}><Icon fafa="faFilePdf" width={11} /> PDF (toutes les pages)</button></div> : <>
          {ongletDroit === "design" && outil === "pinceau" ? <div><h4 className="imgTitreSection">Pinceau</h4><label>Couleur<input type="color" value={pinceauCouleur} onChange={(e) => setPinceauCouleur(e.target.value)} /></label><label>Épaisseur <output>{pinceauEpaisseur}px</output><input type="range" min="1" max="40" value={pinceauEpaisseur} onChange={(e) => setPinceauEpaisseur(Number(e.target.value))} /></label></div> : null}
          {ongletDroit === "design" && outil === "plume" ? <div>
            <h4 className="imgTitreSection">Plume</h4>
            <label>Couleur du trait<input type="color" value={plumeCouleur} onChange={(e) => { setPlumeCouleur(e.target.value); majTraceLive({ couleur: e.target.value, contour: e.target.value }); }} /></label>
            <label>Épaisseur <output>{plumeEpaisseur}px</output><input type="range" min="1" max="40" value={plumeEpaisseur} onChange={(e) => { const valeur = Number(e.target.value); setPlumeEpaisseur(valeur); majTraceLive({ epaisseur: valeur }); }} /></label>
            <label className="imgCase">Remplir si fermé<input type="checkbox" checked={plumeRempli} onChange={(e) => { setPlumeRempli(e.target.checked); majTraceLive({ rempli: e.target.checked }); }} /></label>
            {plumeRempli ? <label>Couleur de remplissage<input type="color" value={plumeCouleurRempli} onChange={(e) => { setPlumeCouleurRempli(e.target.value); majTraceLive({ couleurRempli: e.target.value }); }} /></label> : null}
            <div className="imgAstuce"><p>{tracePlume ? "Cliquez : ancre · Tirez : courbe · Cliquez le 1er point : fermer · Entree : terminer · Retour arrière : ancre précédente · Échap : annuler." : "Cliquez pour poser des ancres, tirez pour les courber. Fermez le tracé ou appuyez sur Entree pour le terminer."}</p></div>
          </div> : null}
          {ongletDroit === "design" && outil === "recadrage" ? <div className="imgAstuce"><h4 className="imgTitreSection">Recadrage</h4><p>{actif?.type === "image" ? "Tracez la zone à conserver sur l'image sélectionnée." : "Sélectionnez d'abord une image à recadrer."}</p></div> : null}
          {ongletDroit === "design" && editionNoeud ? <div className="imgAstuce"><h4 className="imgTitreSection">Édition de nœuds</h4><p>Glissez les ancres et leurs poignées · cliquez un ⊕ pour insérer un point · double-cliquez une ancre pour la retirer · Échap termine.</p></div> : null}
          {selectionIds.length > 1 ?<div className="imgMultiSelection"><h4 className="imgTitreSection">Alignement et distribution</h4><div className="imgGrilleAlignement"><button title="Aligner à gauche" onClick={() => alignerSelection("gauche")}><Icon fafa="faAlignLeft" width={11} /></button><button title="Centrer horizontalement" onClick={() => alignerSelection("centreH")}><Icon fafa="faAlignCenter" width={11} /></button><button title="Aligner à droite" onClick={() => alignerSelection("droite")}><Icon fafa="faAlignRight" width={11} /></button><button title="Aligner en haut" onClick={() => alignerSelection("haut")}><Icon fafa="faBars" width={11} /></button><button title="Centrer verticalement" onClick={() => alignerSelection("centreV")}><Icon fafa="faEquals" width={11} /></button><button title="Aligner en bas" onClick={() => alignerSelection("bas")}><Icon fafa="faBars" width={11} /></button><button title="Distribuer horizontalement" disabled={selectionIds.length < 3} onClick={() => distribuerSelection("h")}><Icon fafa="faArrowsLeftRight" width={11} /></button><button title="Distribuer verticalement" disabled={selectionIds.length < 3} onClick={() => distribuerSelection("v")}><Icon fafa="faArrowsUpDown" width={11} /></button></div><button className="imgActionLarge" onClick={grouperSelection}><Icon fafa="faObjectGroup" width={11} /> Grouper la sélection</button></div> : !actif ?               <div className="imgReglagesPlan">
                <h4>Plan de travail</h4>
                <label>Nom de la scène<input value={pages.find((page) => page.id === pageActive)?.nom || ""} onChange={(e) => setPages((liste) => liste.map((page) => page.id === pageActive ? { ...page, nom: e.target.value } : page))} /></label>
                <label>Format<select value={formatActif?.id || ""} onChange={(e) => appliquerFormat(e.target.value)}><option value="">Personnalisé</option>{FORMATS_PRESETS.map((format) => <option key={format.id} value={format.id}>{format.nom}</option>)}</select></label>
                <div className="imgDeux"><label>Largeur<input type="number" min="64" max="4096" value={largeurPlan} onChange={(e) => { const valeur = Math.max(64, Math.min(4096, Number(e.target.value) || 64)); setLargeurPlan(valeur); setPages((liste) => liste.map((page) => page.id === pageActive ? { ...page, largeur: valeur } : page)); }} /></label><label>Hauteur<input type="number" min="64" max="4096" value={hauteurPlan} onChange={(e) => { const valeur = Math.max(64, Math.min(4096, Number(e.target.value) || 64)); setHauteurPlan(valeur); setPages((liste) => liste.map((page) => page.id === pageActive ? { ...page, hauteur: valeur } : page)); }} /></label></div><button onClick={ajusterEcran}>Ajuster dans la fenêtre</button><section className="imgFondScene"><h4>Fond de la scène</h4><label className="imgCase">Transparent<input type="checkbox" checked={fondTransparent} onChange={(e) => setFondTransparent(e.target.checked)} /></label><label data-inactif={fondTransparent}>Couleur<input type="color" value={fond} disabled={fondTransparent} onChange={(e) => setFond(e.target.value)} /><span>{fond.toUpperCase()}</span></label></section></div> : (
            <>
              <label>Nom<input ref={champNom} value={actif.nom} onChange={(e) => majActif("nom", e.target.value)} /></label>
              {actif.type !== "image" ? <h4 className="imgTitreSection">Contenu</h4> : null}
              {actif.type === "texte" ? <>
                <label>Contenu<textarea value={actif.texte} onChange={(e) => { majActif("texte", e.target.value); ajusterHauteurTexte(actif.id, e.target.value); }} /></label>
                <label>Police<select value={actif.police} onChange={(e) => majActif("police", e.target.value)}>{POLICES.map((police) => <option key={police} value={police}>{police}</option>)}</select></label>
                <div className="imgDeux">
                  <label>Taille<input type="number" min="8" max="300" value={actif.taille} onChange={(e) => majActif("taille", Number(e.target.value))} /></label>
                  <label>Couleur<input type="color" value={actif.couleur} onChange={(e) => majActif("couleur", e.target.value)} /></label>
                </div>
                <div className="imgDeux">
                  <label className="imgCase">Gras<input type="checkbox" checked={Boolean(actif.gras)} onChange={(e) => majActif("gras", e.target.checked)} /></label>
                  <label className="imgCase">Italique<input type="checkbox" checked={Boolean(actif.italique)} onChange={(e) => majActif("italique", e.target.checked)} /></label>
                </div>
                <div className="imgDeux">
                  <label className="imgCase">Souligné<input type="checkbox" checked={Boolean(actif.souligne)} onChange={(e) => majActif("souligne", e.target.checked)} /></label>
                  <label>Casse<select value={actif.casse || "aucune"} onChange={(e) => majActif("casse", e.target.value)}><option value="aucune">Aucune</option><option value="majuscules">MAJ</option><option value="minuscules">min</option></select></label>
                </div>
                <div className="imgDeux">
                  <label className="imgCase">Barré<input type="checkbox" checked={Boolean(actif.barre)} onChange={(e) => majActif("barre", e.target.checked)} /></label>
                  <label className="imgCase">Dégradé<input type="checkbox" checked={Boolean(actif.degrade?.actif)} onChange={(e) => majActif("degrade", { angle: 90, couleurA: "#f7d774", couleurB: "#a86f1f", ...(actif.degrade || {}), actif: e.target.checked })} /></label>
                </div>
                {actif.degrade?.actif ? <>
                  <label>Angle du dégradé <output>{actif.degrade.angle || 0}°</output><input type="range" min="0" max="360" value={actif.degrade.angle || 0} onPointerDown={memoriserReglage} onChange={(e) => majActif("degrade", { ...actif.degrade, angle: Number(e.target.value) }, false)} /></label>
                  <div className="imgDeux">
                    <label>Début<input type="color" value={actif.degrade.couleurA} onChange={(e) => majActif("degrade", { ...actif.degrade, couleurA: e.target.value })} /></label>
                    <label>Fin<input type="color" value={actif.degrade.couleurB} onChange={(e) => majActif("degrade", { ...actif.degrade, couleurB: e.target.value })} /></label>
                  </div>
                </> : null}
                <h4 className="imgTitreSection">Mise en page</h4>
                <label>Alignement<select value={actif.alignement || "centre"} onChange={(e) => majActif("alignement", e.target.value)}><option value="gauche">Gauche</option><option value="centre">Centre</option><option value="droite">Droite</option></select></label>
                <div className="imgDeux">
                  <label>Interligne<input type="number" min=".8" max="3" step=".05" value={actif.interligne ?? 1.15} onChange={(e) => majActif("interligne", Math.max(.8, Math.min(3, Number(e.target.value) || 1.15)))} /></label>
                  <label>Espacement<input type="number" min="-2" max="40" value={actif.espacement || 0} onChange={(e) => majActif("espacement", Number(e.target.value))} /></label>
                </div>
                <button onClick={() => { ajusterLargeurTexte(); ajusterHauteurTexte(actif.id, actif.texte); }}>Ajuster au texte</button>
                <h4 className="imgTitreSection">Contour du texte</h4>
                <label className="imgCase">Activé<input type="checkbox" checked={Boolean(actif.texteContour?.actif)} onChange={(e) => majActif("texteContour", { ...(actif.texteContour || { couleur: "#000000", epaisseur: 3 }), actif: e.target.checked })} /></label>
                {actif.texteContour?.actif ? <div className="imgDeux">
                  <label>Couleur<input type="color" value={actif.texteContour.couleur} onChange={(e) => majActif("texteContour", { ...actif.texteContour, couleur: e.target.value })} /></label>
                  <label>Épaisseur<input type="number" min="1" max="12" value={actif.texteContour.epaisseur} onChange={(e) => majActif("texteContour", { ...actif.texteContour, epaisseur: Math.max(1, Number(e.target.value)) })} /></label>
                </div> : null}
              </> : null}
              {actif.type === "forme" ? <>
                <label>Remplissage<input type="color" value={actif.couleur} onChange={(e) => majActif("couleur", e.target.value)} /></label>
                <label>Contour<input type="color" value={actif.contour} onChange={(e) => majActif("contour", e.target.value)} /></label>
                {actif.forme === "rectangle" ? <>
                  {actif.rayons ? <>
                    <div className="imgQuatre">
                      <label title="Rayon haut gauche">HG<input type="number" min="0" value={actif.rayons[0]} onChange={(e) => majActif("rayons", [Number(e.target.value), actif.rayons[1], actif.rayons[2], actif.rayons[3]])} /></label>
                      <label title="Rayon haut droite">HD<input type="number" min="0" value={actif.rayons[1]} onChange={(e) => majActif("rayons", [actif.rayons[0], Number(e.target.value), actif.rayons[2], actif.rayons[3]])} /></label>
                      <label title="Rayon bas droite">BD<input type="number" min="0" value={actif.rayons[2]} onChange={(e) => majActif("rayons", [actif.rayons[0], actif.rayons[1], Number(e.target.value), actif.rayons[3]])} /></label>
                      <label title="Rayon bas gauche">BG<input type="number" min="0" value={actif.rayons[3]} onChange={(e) => majActif("rayons", [actif.rayons[0], actif.rayons[1], actif.rayons[2], Number(e.target.value)])} /></label>
                    </div>
                    <button onClick={() => majActif("rayons", undefined)}>Revenir à un coin unique</button>
                  </> : <>
                    <label>Rayon des angles<input type="number" min="0" max={Math.floor(Math.min(actif.largeur, actif.hauteur) / 2)} value={actif.rayon || 0} onChange={(e) => majActif("rayon", Math.max(0, Number(e.target.value)))} /></label>
                    <button onClick={() => { const valeur = actif.rayon || 0; majActif("rayons", [valeur, valeur, valeur, valeur]); }}>Coins séparés</button>
                  </>}
                </> : null}
                <label className="imgCase">Dégradé<input type="checkbox" checked={Boolean(actif.degrade?.actif)} onChange={(e) => majActif("degrade", { angle: 90, couleurA: "#ffffff", couleurB: "#0d99ff", ...(actif.degrade || {}), actif: e.target.checked })} /></label>
                {actif.degrade?.actif ? <>
                  <label>Angle du dégradé <output>{actif.degrade.angle || 0}°</output><input type="range" min="0" max="360" value={actif.degrade.angle || 0} onPointerDown={memoriserReglage} onChange={(e) => majActif("degrade", { ...actif.degrade, angle: Number(e.target.value) }, false)} /></label>
                  <div className="imgDeux">
                    <label>Début<input type="color" value={actif.degrade.couleurA} onChange={(e) => majActif("degrade", { ...actif.degrade, couleurA: e.target.value })} /></label>
                    <label>Fin<input type="color" value={actif.degrade.couleurB} onChange={(e) => majActif("degrade", { ...actif.degrade, couleurB: e.target.value })} /></label>
                  </div>
                </> : null}
                <label>Motif<select value={actif.motif || "aucune"} onChange={(e) => majActif("motif", e.target.value)}><option value="aucune">Aucun</option><option value="points">Points (halftone)</option></select></label>
              </> : null}
              {actif.type === "frame" ? <>
                <label>Fond<input type="color" value={actif.couleur} onChange={(e) => majActif("couleur", e.target.value)} /></label>
                <label>Contour<input type="color" value={actif.contour} onChange={(e) => majActif("contour", e.target.value)} /></label>
                <label className="imgCase">Dégradé<input type="checkbox" checked={Boolean(actif.degrade?.actif)} onChange={(e) => majActif("degrade", { angle: 90, couleurA: "#ffffff", couleurB: "#0d99ff", ...(actif.degrade || {}), actif: e.target.checked })} /></label>
                {actif.degrade?.actif ? <>
                  <label>Angle du dégradé <output>{actif.degrade.angle || 0}°</output><input type="range" min="0" max="360" value={actif.degrade.angle || 0} onPointerDown={memoriserReglage} onChange={(e) => majActif("degrade", { ...actif.degrade, angle: Number(e.target.value) }, false)} /></label>
                  <div className="imgDeux">
                    <label>Début<input type="color" value={actif.degrade.couleurA} onChange={(e) => majActif("degrade", { ...actif.degrade, couleurA: e.target.value })} /></label>
                    <label>Fin<input type="color" value={actif.degrade.couleurB} onChange={(e) => majActif("degrade", { ...actif.degrade, couleurB: e.target.value })} /></label>
                  </div>
                </> : null}
                <label className="imgCase">Masquer le contenu dépassant<input type="checkbox" checked={actif.clipContent !== false} onChange={(e) => majActif("clipContent", e.target.checked)} /></label>
              </> : null}
              <SectionRepliable titre="Transformation">
                <div className="imgQuatre">
                  <label title="Position X">X<input type="number" value={Math.round(actif.x)} onChange={(e) => majActif("x", Number(e.target.value))} /></label>
                  <label title="Position Y">Y<input type="number" value={Math.round(actif.y)} onChange={(e) => majActif("y", Number(e.target.value))} /></label>
                  <label title="Largeur">L<input type="number" min="1" value={Math.round(actif.largeur)} onChange={(e) => majActif("largeur", Number(e.target.value))} /></label>
                  <label title="Hauteur">H<input type="number" min="1" value={Math.round(actif.hauteur)} onChange={(e) => majActif("hauteur", Number(e.target.value))} /></label>
                </div>
                <label>Rotation <output>{actif.rotation || 0}°</output><input type="range" min="-180" max="180" value={actif.rotation || 0} onPointerDown={memoriserReglage} onChange={(e) => majActif("rotation", Number(e.target.value), false)} /></label>
                <label>Opacité <output>{Math.round((actif.opacite ?? 1) * 100)}%</output><input type="range" min="0" max="1" step=".01" value={actif.opacite ?? 1} onPointerDown={memoriserReglage} onChange={(e) => majActif("opacite", Number(e.target.value), false)} /></label>
              </SectionRepliable>
              <SectionRepliable titre="Apparence">
                <label>Mode de fusion<select value={actif.fusion || "source-over"} onChange={(e) => majActif("fusion", e.target.value)}><option value="source-over">Normal</option><option value="multiply">Produit</option><option value="screen">Écran</option><option value="overlay">Incrustation</option><option value="darken">Assombrir</option><option value="lighten">Éclaircir</option><option value="difference">Différence</option></select></label>
                <div className="imgActionsIcones">
                  <button data-actif={Boolean(actif.retourneX)} title="Miroir horizontal" aria-label="Miroir horizontal" onClick={() => majActif("retourneX", !actif.retourneX)}><Icon fafa="faArrowsLeftRight" width={12} /></button>
                  <button data-actif={Boolean(actif.retourneY)} title="Miroir vertical" aria-label="Miroir vertical" onClick={() => majActif("retourneY", !actif.retourneY)}><Icon fafa="faArrowsUpDown" width={12} /></button>
                  <button title="Copier le style (Ctrl+Alt+C)" aria-label="Copier le style" disabled={!actif} onClick={copierStyle}><Icon fafa="faCopy" width={12} /></button>
                  <button title="Coller le style (Ctrl+Alt+V)" aria-label="Coller le style" onClick={collerStyle}><Icon fafa="faPaste" width={12} /></button>
                </div>
                <SectionRepliable titre="Ombre portée" defaut={false}>
                  <label className="imgCase">Activer<input type="checkbox" checked={Boolean(actif.ombre?.active)} onChange={(e) => majActif("ombre", { ...(actif.ombre || { couleur: "#000000", flou: 16, x: 8, y: 8 }), active: e.target.checked })} /></label>
                  {actif.ombre?.active ? <div className="imgDeux">
                    <label>Couleur<input type="color" value={actif.ombre.couleur} onChange={(e) => majActif("ombre", { ...actif.ombre, couleur: e.target.value })} /></label>
                    <label>Flou<input type="number" min="0" max="100" value={actif.ombre.flou} onChange={(e) => majActif("ombre", { ...actif.ombre, flou: Number(e.target.value) })} /></label>
                    <label>Décalage X<input type="number" value={actif.ombre.x} onChange={(e) => majActif("ombre", { ...actif.ombre, x: Number(e.target.value) })} /></label>
                    <label>Décalage Y<input type="number" value={actif.ombre.y} onChange={(e) => majActif("ombre", { ...actif.ombre, y: Number(e.target.value) })} /></label>
                  </div> : null}
                </SectionRepliable>
              </SectionRepliable>
              {actif.type === "image" ? <SectionRepliable titre="Filtres d'image" defaut={false}>
                {FILTRES_REGLAGES.map(([cle, libelle, min, max]) => <label key={cle}>{libelle}<output>{actif.filtres[cle]}</output><input type="range" min={min} max={max} value={actif.filtres[cle] ?? 0} onPointerDown={memoriserReglage} onChange={(e) => majFiltre(cle, Number(e.target.value), false)} /></label>)}
                <button onClick={() => majActif("filtres", { ...filtreNeutre })}>Réinitialiser les filtres</button>
              </SectionRepliable> : null}
              {actif.type === "image" ? <SectionRepliable titre="Détourage & retouche" defaut={false}>
                <div className="imgDeux">
                  <label>Couleur cible<input type="color" value={detourageCouleur} onChange={(e) => setDetourageCouleur(e.target.value)} /></label>
                  <label className="imgCase">Contiguë<input type="checkbox" checked={detourageContigue} onChange={(e) => setDetourageContigue(e.target.checked)} /></label>
                </div>
                <label>Tolérance <output>{detourageTolerance}</output><input type="range" min="5" max="160" value={detourageTolerance} onChange={(e) => setDetourageTolerance(Number(e.target.value))} /></label>
                <label>Adoucissement <output>{detourageAdoucissement}%</output><input type="range" min="0" max="100" value={detourageAdoucissement} onChange={(e) => setDetourageAdoucissement(Number(e.target.value))} /></label>
                <div className="imgDeux">
                  <button onClick={detourerCouleur}>Supprimer la couleur</button>
                  <button onClick={() => setOutil("gomme")}>Gomme magique</button>
                </div>
                <div className="imgDeux">
                  <button onClick={rognerBordsVides}>Rogner les bords</button>
                  <button onClick={appliquerAutoContraste}>Auto-contraste</button>
                </div>
                <label>Rayon de restauration <output>{restaurationRayon}px</output><input type="range" min="6" max="80" value={restaurationRayon} onChange={(e) => setRestaurationRayon(Number(e.target.value))} /></label>
                <div className="imgDeux">
                  <label>Fond de remplacement<input type="color" value={fondRemplacementCouleur} onChange={(e) => setFondRemplacementCouleur(e.target.value)} /></label>
                  <button onClick={appliquerFondCouleur} disabled={!actif.srcOriginal}>Appliquer le fond</button>
                </div>
                <div className="imgDeux">
                  <label>Flou du fond <output>{flouFondRayon}px</output><input type="range" min="4" max="60" value={flouFondRayon} onChange={(e) => setFlouFondRayon(Number(e.target.value))} /></label>
                  <button onClick={appliquerFlouFond} disabled={!actif.srcOriginal} title="L'original flouté apparaît dans les zones détournées — effet portrait">Mode portrait</button>
                </div>
                <button disabled={!actif.srcOriginal} onClick={restaurerOriginal} title="Restaure l'image telle qu'au premier détourage">Restaurer l'original</button>
                <div className="imgAstuce"><p>Astuce : la gomme magique (G) retire en un clic la zone cliquée ; augmentez l'adoucissement pour éviter les franges.</p></div>
              </SectionRepliable> : null}
            </>
          )}
          </>}
        </aside>
      </div>
    </ModuleWindow>
  );
}

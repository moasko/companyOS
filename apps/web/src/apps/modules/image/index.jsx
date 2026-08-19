import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { screenToWorld } from "./editor/core/coordinates";
import { createNodeStore, listNodeStore, replaceNodeStore } from "./editor/state/node-store";
import "./image.scss";

export const manifest = {
  id: "imageEditor",
  slug: "image",
  name: "Atelier Image",
  icon: "photos",
  action: "IMAGEEDITORAPP",
  version: "1.3.0",
  nouveautes: [
    { version: "1.3.0", texte: "Interface de studio inspirée de Figma : pages et calques, inspecteur Design/Prototype/Export et barre d’outils flottante." },
    { version: "1.2.1", texte: "Commandes Figma : zoom sous le curseur, navigation et raccourcis clavier complets." },
    { version: "1.2.0", texte: "Canvas infini, outil Main, zoom jusqu’à 400 % et guides d’alignement intelligents." },
    { version: "1.1.0", texte: "Transformations directes, projets éditables, fusion, ombres, verrouillage et historique optimisé." },
    { version: "1.0.1", texte: "Correction de l’ouverture depuis le Bureau et le menu Démarrer." },
    { version: "1.0.0", texte: "Montage non destructif, calques, texte, formes, filtres et export PNG/JPEG." },
  ],
  Window: ImageApp,
};

const LARGEUR_INITIALE = 1280;
const HAUTEUR_INITIALE = 720;
const filtreNeutre = { luminosite: 100, contraste: 100, saturation: 100, flou: 0, niveauxGris: 0, sepia: 0 };
const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
// Les sources d'image sont volumineuses et immuables. L'historique les
// partage entre ses états et ne copie que les propriétés modifiables.
const copieObjet = (objet) => ({
  ...objet,
  ...(objet.filtres ? { filtres: { ...objet.filtres } } : {}),
  ...(objet.ombre ? { ombre: { ...objet.ombre } } : {}),
});
const copieObjets = (objets) => objets.map(copieObjet);

function filtreCss(f = filtreNeutre) {
  return `brightness(${f.luminosite}%) contrast(${f.contraste}%) saturate(${f.saturation}%) blur(${f.flou}px) grayscale(${f.niveauxGris}%) sepia(${f.sepia}%)`;
}

function dessinerObjet(ctx, objet, images) {
  ctx.save();
  ctx.globalAlpha = objet.opacite ?? 1;
  ctx.globalCompositeOperation = objet.fusion || "source-over";
  ctx.translate(objet.x + objet.largeur / 2, objet.y + objet.hauteur / 2);
  ctx.rotate(((objet.rotation || 0) * Math.PI) / 180);
  ctx.scale(objet.retourneX ? -1 : 1, objet.retourneY ? -1 : 1);
  if (objet.ombre?.active) {
    ctx.shadowColor = objet.ombre.couleur;
    ctx.shadowBlur = objet.ombre.flou;
    ctx.shadowOffsetX = objet.ombre.x;
    ctx.shadowOffsetY = objet.ombre.y;
  }
  if (objet.type === "image") {
    const image = images.get(objet.src);
    if (image?.complete) {
      ctx.filter = filtreCss(objet.filtres);
      ctx.drawImage(image, -objet.largeur / 2, -objet.hauteur / 2, objet.largeur, objet.hauteur);
    }
  } else if (objet.type === "texte") {
    ctx.fillStyle = objet.couleur;
    ctx.font = `${objet.gras ? 700 : 400} ${objet.taille}px ${objet.police}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(objet.texte, 0, 0, objet.largeur);
  } else {
    ctx.fillStyle = objet.couleur;
    ctx.strokeStyle = objet.contour;
    ctx.lineWidth = objet.epaisseur;
    if (objet.forme === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(0, 0, objet.largeur / 2, objet.hauteur / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      if (objet.epaisseur) ctx.stroke();
    } else {
      const rayon = Math.max(0, Math.min(objet.rayon || 0, objet.largeur / 2, objet.hauteur / 2));
      ctx.beginPath();
      ctx.roundRect(-objet.largeur / 2, -objet.hauteur / 2, objet.largeur, objet.hauteur, rayon);
      ctx.fill();
      if (objet.epaisseur) ctx.stroke();
    }
  }
  ctx.restore();
}

function ImageApp() {
  const canvas = useRef(null);
  const scene = useRef(null);
  const importeur = useRef(null);
  const importeurProjet = useRef(null);
  const cacheImages = useRef(new Map());
  const glisse = useRef(null);
  const dessinProgramme = useRef(null);
  const pressePapier = useRef(null);
  const commandes = useRef({});
  const outilAvantEspace = useRef(null);
  const pageInitiale = useRef({ id: id(), nom: "Scène 1", largeur: LARGEUR_INITIALE, hauteur: HAUTEUR_INITIALE, fond: "#ffffff", fondTransparent: true, objets: [] });
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

  const actif = objets.find((objet) => objet.id === selection) || null;
  const actifMonde = selection ? objetMonde(selection) : null;
  const selectionMonde = useMemo(() => objetsHierarchiques.filter((objet) => selectionIds.includes(objet.id)), [objetsHierarchiques, selectionIds]);
  const boundsSelection = useMemo(() => {
    if (!selectionMonde.length) return null;
    const x = Math.min(...selectionMonde.map((objet) => objet.x));
    const y = Math.min(...selectionMonde.map((objet) => objet.y));
    const droite = Math.max(...selectionMonde.map((objet) => objet.x + objet.largeur));
    const bas = Math.max(...selectionMonde.map((objet) => objet.y + objet.hauteur));
    return { x, y, largeur: droite - x, hauteur: bas - y };
  }, [selectionMonde]);
  const capturerPage = useCallback(() => ({ id: pageActive, nom: pages.find((page) => page.id === pageActive)?.nom || "Scène", largeur: largeurPlan, hauteur: hauteurPlan, fond, fondTransparent, objets: copieObjets(objets) }), [fond, fondTransparent, hauteurPlan, largeurPlan, objets, pageActive, pages]);
  const chargerPage = (page) => {
    setMagasinNoeuds(createNodeStore(copieObjets(page.objets || []), page.id));
    setLargeurPlan(page.largeur || LARGEUR_INITIALE);
    setHauteurPlan(page.hauteur || HAUTEUR_INITIALE);
    setFond(page.fond || "#ffffff");
    setFondTransparent(page.fondTransparent !== false);
    setSelection(null);
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
    const nouvelle = { id: id(), nom: `Scène ${pages.length + 1}`, largeur: LARGEUR_INITIALE, hauteur: HAUTEUR_INITIALE, fond: "#ffffff", fondTransparent: true, objets: [] };
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

  const modifier = useCallback((transformation, memoriser = true) => {
    setObjets((courants) => {
      const suivants = typeof transformation === "function" ? transformation(courants) : transformation;
      if (memoriser) setHistorique((h) => ({ passe: [...h.passe.slice(-39), copieObjets(courants)], futur: [] }));
      return suivants;
    });
  }, [setObjets]);
  const memoriserReglage = () => setHistorique((h) => ({ passe: [...h.passe.slice(-39), copieObjets(objets)], futur: [] }));

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
  const dupliquer = () => {
    if (!actif) return;
    const correspondances = new Map();
    const branche = [];
    const cloner = (identifiant, parentId = null, racine = false) => {
      const source = magasinNoeuds.nodes[identifiant];
      if (!source) return null;
      const nouvelId = id();
      correspondances.set(identifiant, nouvelId);
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
      copie.children = source.children.map((enfant) => cloner(enfant, nouvelId)).filter(Boolean);
      return nouvelId;
    };
    const nouvelId = cloner(actif.id, actif.parentId, true);
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

  const enregistrerProjet = () => {
    const courante = capturerPage();
    const pagesSauvees = pages.map((page) => page.id === pageActive ? courante : page);
    const contenu = JSON.stringify({ format: "companyos-image", version: 2, pageActive, pages: pagesSauvees });
    const url = URL.createObjectURL(new Blob([contenu], { type: "application/json" }));
    const lien = document.createElement("a");
    lien.href = url;
    lien.download = "montage.cosimage";
    lien.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const ouvrirProjet = (fichier) => {
    if (!fichier) return;
    const lecteur = new FileReader();
    lecteur.onload = () => {
      try {
        const projet = JSON.parse(lecteur.result);
        if (projet.format !== "companyos-image") throw new Error("Format invalide");
        setHistorique((h) => ({ passe: [...h.passe.slice(-39), copieObjets(objets)], futur: [] }));
        const pagesProjet = Array.isArray(projet.pages) && projet.pages.length ? projet.pages : [{ id: id(), nom: "Scène 1", largeur: projet.largeur, hauteur: projet.hauteur, fond: projet.fond, fondTransparent: projet.fondTransparent, objets: Array.isArray(projet.objets) ? projet.objets : [] }];
        const identifiant = pagesProjet.some((page) => page.id === projet.pageActive) ? projet.pageActive : pagesProjet[0].id;
        const cible = pagesProjet.find((page) => page.id === identifiant);
        setPages(pagesProjet);
        setPageActive(identifiant);
        chargerPage({ ...cible, largeur: Math.max(64, Math.min(4096, Number(cible.largeur) || LARGEUR_INITIALE)), hauteur: Math.max(64, Math.min(4096, Number(cible.hauteur) || HAUTEUR_INITIALE)) });
      } catch {
        window.alert("Ce fichier n’est pas un projet Atelier Image valide.");
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

  const position = (event) => {
    const rect = canvas.current.getBoundingClientRect();
    return screenToWorld({ x: event.clientX, y: event.clientY }, { screenOrigin: { x: rect.left, y: rect.top }, worldOrigin: { x: 0, y: 0 }, scaleX: rect.width / largeurPlan, scaleY: rect.height / hauteurPlan });
  };
  const centreCreation = () => {
    const rectCanvas = canvas.current?.getBoundingClientRect();
    const rectScene = scene.current?.getBoundingClientRect();
    if (!rectCanvas || !rectScene || !rectCanvas.width || !rectCanvas.height) return { x: largeurPlan / 2, y: hauteurPlan / 2 };
    return screenToWorld({ x: rectScene.left + rectScene.width / 2, y: rectScene.top + rectScene.height / 2 }, { screenOrigin: { x: rectCanvas.left, y: rectCanvas.top }, worldOrigin: { x: 0, y: 0 }, scaleX: rectCanvas.width / largeurPlan, scaleY: rectCanvas.height / hauteurPlan });
  };
  const appuyer = (event) => {
    event.preventDefault();
    if (outil === "main" || event.button === 1) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      glisse.current = { mode: "pan", pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, pan: { ...pan } };
      return;
    }
    const p = position(event);
    if (outil === "rectangle" || outil === "ellipse" || outil === "frame") {
      const estFrame = outil === "frame";
      const parent = [...objetsHierarchiques].reverse().find((o) => o.type === "frame" && o.visible !== false && p.x >= o.x && p.x <= o.x + o.largeur && p.y >= o.y && p.y <= o.y + o.hauteur) || null;
      const objet = { id: id(), type: estFrame ? "frame" : "forme", forme: estFrame ? "rectangle" : outil, nom: estFrame ? "Frame" : outil === "ellipse" ? "Ellipse" : "Rectangle", x: p.x - (parent?.x || 0), y: p.y - (parent?.y || 0), largeur: 1, hauteur: 1, couleur: estFrame ? "#ffffff" : "#D9D9D9", contour: estFrame ? "#7c6cff" : "#151515", epaisseur: estFrame ? 1 : 2, rayon: 0, rotation: 0, opacite: 1, visible: true, verrouille: false, parentId: parent?.id || null, children: [], sceneId: pageActive, ...(estFrame ? { clipContent: true } : {}) };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setObjets((liste) => [...liste.map((o) => o.id === parent?.id ? { ...o, children: [...o.children, objet.id] } : o), objet]);
      setSelection(objet.id);
      glisse.current = { id: objet.id, pointerId: event.pointerId, mode: "creation", depart: p, parentOffset: { x: parent?.x || 0, y: parent?.y || 0 }, origine: copieObjets(objets), distance: 0 };
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
      glisse.current = {
        id: trouve.id,
        pointerId: event.pointerId,
        dx: p.x - trouve.x,
        dy: p.y - trouve.y,
        origine: copieObjets(objets),
        ids: idsDrag,
        depart: p,
        positions: idsDrag.map((identifiant) => ({ id: identifiant, objet: copieObjet(magasinNoeuds.nodes[identifiant]) })),
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
  const bouger = (event) => {
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
    } else if (mouvement.mode === "rotation") {
      const angle = Math.atan2(p.y - mouvement.centre.y, p.x - mouvement.centre.x) * 180 / Math.PI;
      let rotation = mouvement.rotationDepart + angle - mouvement.angleDepart;
      if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
      setObjets((liste) => liste.map((o) => o.id === mouvement.id ? { ...o, rotation: Math.round(rotation * 10) / 10 } : o));
    } else if (mouvement.mode === "rayon") {
      const original = mouvement.objet;
      const brut = mouvement.cote === "gauche" ? p.x - original.x : original.x + original.largeur - p.x;
      const rayon = Math.max(0, Math.min(brut, original.largeur / 2, original.hauteur / 2));
      setObjets((liste) => liste.map((o) => o.id === mouvement.id ? { ...o, rayon: Math.round(rayon) } : o));
    } else if (mouvement.mode === "creation") {
      let dx = p.x - mouvement.depart.x;
      let dy = p.y - mouvement.depart.y;
      if (event.shiftKey) {
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
          return { ...objet, x: depart.local.x + mondeX - depart.monde.x, y: depart.local.y + mondeY - depart.monde.y, largeur: Math.max(1, depart.local.largeur * echelleX), hauteur: Math.max(1, depart.local.hauteur * echelleY) };
        }));
      } else setObjets((liste) => liste.map((o) => o.id === mouvement.id ? { ...o, x, y, largeur, hauteur } : o));
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
      const ciblesX = [0, largeurPlan / 2, largeurPlan];
      const ciblesY = [0, hauteurPlan / 2, hauteurPlan];
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

  const ajusterEcran = () => {
    const rect = scene.current?.getBoundingClientRect();
    if (!rect) return;
    setZoom(Math.max(10, Math.min(100, Math.min((rect.width - 80) / largeurPlan, (rect.height - 80) / hauteurPlan) * 100)));
    setPan({ x: 0, y: 0 });
  };

  const exporter = (type) => {
    const surface = document.createElement("canvas");
    surface.width = largeurPlan;
    surface.height = hauteurPlan;
    const ctx = surface.getContext("2d");
    if (!fondTransparent) {
      ctx.fillStyle = fond;
      ctx.fillRect(0, 0, largeurPlan, hauteurPlan);
    }
    const dessinerBranche = (identifiant, parentX = 0, parentY = 0) => {
      const objet = magasinNoeuds.nodes[identifiant];
      if (!objet || objet.visible === false) return;
      const monde = { ...objet, x: parentX + objet.x, y: parentY + objet.y };
      if (objet.type !== "group") dessinerObjet(ctx, monde, cacheImages.current);
      if (objet.type === "frame" && objet.clipContent !== false) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(monde.x, monde.y, monde.largeur, monde.hauteur, Math.max(0, monde.rayon || 0));
        ctx.clip();
        objet.children.forEach((enfant) => dessinerBranche(enfant, monde.x, monde.y));
        ctx.restore();
      } else objet.children.forEach((enfant) => dessinerBranche(enfant, monde.x, monde.y));
    };
    magasinNoeuds.rootIds.forEach((identifiant) => dessinerBranche(identifiant));
    const lien = document.createElement("a");
    lien.download = `montage-companyos.${type === "image/png" ? "png" : "jpg"}`;
    lien.href = surface.toDataURL(type, 0.94);
    lien.click();
  };

  const cadreSelection = useMemo(() => {
    const reference = selectionIds.length > 1 ? boundsSelection : actifMonde;
    if (!reference) return null;
    return {
      left: `${reference.x / largeurPlan * 100}%`, top: `${reference.y / hauteurPlan * 100}%`,
      width: `${reference.largeur / largeurPlan * 100}%`, height: `${reference.hauteur / hauteurPlan * 100}%`,
      transform: `rotate(${selectionIds.length > 1 ? 0 : reference.rotation || 0}deg)`,
    };
  }, [actifMonde, boundsSelection, hauteurPlan, largeurPlan, selectionIds.length]);

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
    copier: () => { if (actif) pressePapier.current = copieObjet(actif); },
    coller: () => {
      if (!pressePapier.current) return;
      const nouveau = { ...copieObjet(pressePapier.current), id: id(), nom: `${pressePapier.current.nom} copie`, x: pressePapier.current.x + 20, y: pressePapier.current.y + 20 };
      modifier((liste) => [...liste, nouveau]);
      setSelection(nouveau.id);
      pressePapier.current = copieObjet(nouveau);
    },
    deplacer: (dx, dy) => {
      if (!selectionIds.length) return;
      modifier((liste) => liste.map((o) => selectionIds.includes(o.id) && !o.verrouille ? { ...o, x: o.x + dx, y: o.y + dy } : o));
    },
    ajusterEcran,
  };

  useEffect(() => {
    const saisie = (cible) => cible?.matches?.("input, textarea, select, [contenteditable='true']");
    const toucheBas = (event) => {
      if (!scene.current?.offsetParent || saisie(event.target)) return;
      const cmd = event.ctrlKey || event.metaKey;
      const touche = event.key.toLowerCase();
      if (event.code === "Space" && !event.repeat) {
        event.preventDefault();
        outilAvantEspace.current = outil;
        setOutil("main");
        return;
      }
      if (cmd && touche === "z") { event.preventDefault(); event.shiftKey ? commandes.current.retablir() : commandes.current.annuler(); }
      else if (cmd && touche === "y") { event.preventDefault(); commandes.current.retablir(); }
      else if (cmd && touche === "d") { event.preventDefault(); commandes.current.dupliquer(); }
      else if (cmd && touche === "g") { event.preventDefault(); event.shiftKey ? commandes.current.dissocier() : commandes.current.grouper(); }
      else if (cmd && touche === "c") { event.preventDefault(); commandes.current.copier(); }
      else if (cmd && touche === "v") { event.preventDefault(); commandes.current.coller(); }
      else if (cmd && (event.key === "+" || event.key === "=")) { event.preventDefault(); setZoom((z) => Math.min(400, z * 1.1)); }
      else if (cmd && event.key === "-") { event.preventDefault(); setZoom((z) => Math.max(10, z * .9)); }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); commandes.current.supprimer(); }
      else if (event.key === "Escape") { setSelection(null); setOutil("selection"); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); commandes.current.deplacer(event.shiftKey ? -10 : -1, 0); }
      else if (event.key === "ArrowRight") { event.preventDefault(); commandes.current.deplacer(event.shiftKey ? 10 : 1, 0); }
      else if (event.key === "ArrowUp") { event.preventDefault(); commandes.current.deplacer(0, event.shiftKey ? -10 : -1); }
      else if (event.key === "ArrowDown") { event.preventDefault(); commandes.current.deplacer(0, event.shiftKey ? 10 : 1); }
      else if (!cmd && touche === "v") setOutil("selection");
      else if (!cmd && touche === "h") setOutil("main");
      else if (!cmd && touche === "t") commandes.current.ajouterTexte();
      else if (!cmd && touche === "r") commandes.current.ajouterRectangle();
      else if (!cmd && touche === "o") commandes.current.ajouterEllipse();
      else if (!cmd && touche === "f") commandes.current.ajouterFrame();
      else if (!cmd && event.key === "0") commandes.current.ajusterEcran();
      else if (!cmd && event.key === "1") { setZoom(100); setPan({ x: 0, y: 0 }); }
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
    if (objet.type === "frame") return <div className="imgObjetLibre imgObjetFrame" key={objet.id} data-clip={objet.clipContent !== false} style={{ ...style, background: objet.couleur, border: `${objet.epaisseur || 0}px solid ${objet.contour}`, borderRadius: objet.rayon || 0 }}>{objet.children.map((enfant) => rendreNoeud(magasinNoeuds.nodes[enfant]))}</div>;
    if (objet.type === "group") return <div className="imgObjetLibre imgObjetGroupe" key={objet.id} style={style}>{objet.children.map((enfant) => rendreNoeud(magasinNoeuds.nodes[enfant]))}</div>;
    if (objet.type === "image") return <img className="imgObjetLibre" key={objet.id} src={objet.src} alt="" draggable="false" style={style} />;
    if (objet.type === "texte") return <div className="imgObjetLibre imgObjetTexte" key={objet.id} style={{ ...style, color: objet.couleur, fontFamily: objet.police, fontSize: objet.taille, fontWeight: objet.gras ? 700 : 400 }}>{objet.texte}</div>;
    return <div className="imgObjetLibre imgObjetForme" key={objet.id} style={{ ...style, background: objet.couleur, border: `${objet.epaisseur || 0}px solid ${objet.contour}`, borderRadius: objet.forme === "ellipse" ? "50%" : objet.rayon || 0 }}>{objet.children?.map((enfant) => rendreNoeud(magasinNoeuds.nodes[enfant]))}</div>;
  };

  return (
    <ModuleWindow manifest={manifest} className="imgApp">
      <div className="imgBarre">
        <input ref={importeur} hidden multiple type="file" accept="image/*" onChange={(e) => Array.from(e.target.files || []).forEach(importer)} />
        <button onClick={() => importeurProjet.current?.click()}><Icon fafa="faFolderOpen" width={13} /> Ouvrir projet</button>
        <input ref={importeurProjet} hidden type="file" accept=".cosimage,application/json" onChange={(e) => ouvrirProjet(e.target.files?.[0])} />
        <button onClick={enregistrerProjet}><Icon fafa="faFloppyDisk" width={13} /> Sauver projet</button>
        <span className="imgSeparateur" />
        <button onClick={annuler} disabled={!historique.passe.length}><Icon fafa="faRotateLeft" width={13} /> Annuler</button>
        <button onClick={retablir} disabled={!historique.futur.length}><Icon fafa="faRotateRight" width={13} /> Rétablir</button>
      </div>

      <div className="imgCorps">
        <aside className="imgOutils">
          <div className="imgPanneauOnglets"><button data-actif={ongletGauche === "calques"} onClick={() => setOngletGauche("calques")}>Fichier</button><button data-actif={ongletGauche === "ressources"} onClick={() => setOngletGauche("ressources")}>Ressources</button></div>
          <div className="imgPages"><b>Scènes</b><button title="Nouvelle scène" aria-label="Nouvelle scène" onClick={nouvellePage}><Icon fafa="faPlus" width={11} /></button><div className="imgListePages">{pages.map((page) => <div className="imgPageLigne" key={page.id} data-actif={page.id === pageActive}><button className="imgPageOuvrir" onClick={() => changerPage(page.id)}><Icon fafa="faRectangleList" width={11} /><span>{page.nom}</span></button>{pages.length > 1 ? <button className="imgPageSupprimer" title={`Supprimer ${page.nom}`} aria-label={`Supprimer ${page.nom}`} onClick={() => supprimerPage(page.id)}><Icon fafa="faTrashCan" width={10} /></button> : null}</div>)}</div></div>
          <h3>{ongletGauche === "calques" ? "Calques" : "Ressources"} <small>{objets.length}</small></h3>
          {ongletGauche === "calques" ? <div className="imgCalques">
            {objetsHierarchiques.map((objet) => (
              <button key={objet.id} data-actif={selectionIds.includes(objet.id)} style={{ paddingLeft: 7 + objet.profondeur * 16 }} onClick={(event) => event.shiftKey ? setSelectionIds((ids) => ids.includes(objet.id) ? ids.filter((identifiant) => identifiant !== objet.id) : [...ids, objet.id]) : setSelection(objet.id)}>
                <span><Icon fafa={objet.type === "group" ? "faObjectGroup" : objet.type === "frame" ? "faBorderAll" : objet.type === "image" ? "faImage" : objet.type === "texte" ? "faFont" : objet.forme === "ellipse" ? "faCircle" : "faSquare"} width={12} /></span>
                <b>{objet.nom}</b>
                <i title={objet.visible ? "Masquer" : "Afficher"} onClick={(e) => { e.stopPropagation(); modifier((liste) => liste.map((o) => o.id === objet.id ? { ...o, visible: !o.visible } : o)); }}><Icon fafa={objet.visible ? "faEye" : "faEyeSlash"} width={12} /></i>
              </button>
            ))}
            {!objets.length ? <p>Importez une image ou ajoutez un élément.</p> : null}
          </div> : <div className="imgRessources"><b>Composants locaux</b><p>Les styles et composants réutilisables apparaîtront ici.</p></div>}
          {ongletGauche === "calques" ? <div className="imgOrdre">
            <button disabled={!actif} onClick={() => deplacerCalque(1)}>Monter</button>
            <button disabled={!actif} onClick={() => deplacerCalque(-1)}>Descendre</button>
            <button disabled={!actif} onClick={dupliquer}>Dupliquer</button>
            <button disabled={!actif} onClick={supprimer}><Icon fafa="faTrashCan" width={10} /> Supprimer</button>
            <button disabled={selectionIds.length < 2} onClick={grouperSelection}><Icon fafa="faObjectGroup" width={10} /> Grouper</button>
            <button disabled={actif?.type !== "group"} onClick={dissocierGroupe}><Icon fafa="faObjectUngroup" width={10} /> Dissocier</button>
          </div> : null}
        </aside>

        <main
          ref={scene}
          className="imgScene"
          data-outil={outil}
          data-depot={depotActif}
          data-transparent={fondTransparent}
          style={{ backgroundColor: fondTransparent ? undefined : fond }}
          onDragEnter={(event) => { event.preventDefault(); setDepotActif(true); }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDepotActif(true); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDepotActif(false); }}
          onDrop={deposerFichiers}
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
            {cadreSelection ? <div className="imgSelection" data-verrouille={selectionMonde.some((objet) => objet.verrouille)} data-multiple={selectionIds.length > 1} style={cadreSelection}>
              {["no", "n", "ne", "e", "se", "s", "so", "o"].map((coin) => <i
                key={coin}
                data-coin={coin}
                onPointerDown={(e) => commencerRedimensionnement(e, coin)}
              />)}
              {selectionIds.length === 1 ? <><i className="imgRotationTige" /><button className="imgRotationPoignee" title="Faire pivoter" aria-label="Faire pivoter" onPointerDown={commencerRotation} /></> : null}
              {selectionIds.length === 1 && actif.type === "forme" && actif.forme === "rectangle" ? <><button className="imgRayon imgRayonGauche" title="Rayon des angles" aria-label="Modifier le rayon des angles" onPointerDown={(e) => commencerRayon(e, "gauche")} /><button className="imgRayon imgRayonDroite" title="Rayon des angles" aria-label="Modifier le rayon des angles" onPointerDown={(e) => commencerRayon(e, "droite")} /></> : null}
              <output className="imgTailleObjet">{Math.round(selectionIds.length > 1 ? boundsSelection.largeur : actif.largeur)} × {Math.round(selectionIds.length > 1 ? boundsSelection.hauteur : actif.hauteur)}</output>
            </div> : null}
            {marquee ? <div className="imgMarquee" style={{ left: `${marquee.x / largeurPlan * 100}%`, top: `${marquee.y / hauteurPlan * 100}%`, width: `${marquee.largeur / largeurPlan * 100}%`, height: `${marquee.hauteur / hauteurPlan * 100}%` }} /> : null}
            {guides.x !== null ? <i className="imgGuide imgGuideV" style={{ left: `${guides.x / largeurPlan * 100}%` }} /> : null}
            {guides.y !== null ? <i className="imgGuide imgGuideH" style={{ top: `${guides.y / hauteurPlan * 100}%` }} /> : null}
          </div>
          </div>
          <div className="imgZoom" onPointerDown={(event) => event.stopPropagation()}>
            <button title="Dézoomer (Ctrl/Cmd −)" aria-label="Dézoomer" onClick={() => setZoom((z) => Math.max(10, z / 1.1))}><Icon fafa="faMinus" width={11} /></button>
            <button className="imgZoomValeur" title="Ajuster à l’écran (0)" onClick={ajusterEcran}>{Math.round(zoom)}%</button>
            <button title="Zoomer (Ctrl/Cmd +)" aria-label="Zoomer" onClick={() => setZoom((z) => Math.min(400, z * 1.1))}><Icon fafa="faPlus" width={11} /></button>
          </div>
          <div className="imgOutilsCentre" aria-label="Outils du canvas" onPointerDown={(event) => event.stopPropagation()}>
            <div className="imgGroupeOutils">
              <button data-actif={outil === "selection"} title="Sélection (V)" aria-label="Outil Sélection" onClick={() => setOutil("selection")}><Icon fafa="faArrowPointer" width={14} /></button>
              <button data-actif={outil === "main"} title="Main (H)" aria-label="Outil Main" onClick={() => setOutil("main")}><Icon fafa="faHand" width={14} /></button>
            </div>
            <span className="imgDockSeparateur" />
            <div className="imgGroupeOutils">
              <button title="Importer une image" aria-label="Importer une image" onClick={() => importeur.current?.click()}><Icon fafa="faImage" width={14} /></button>
              <button data-actif={outil === "frame"} title="Frame (F)" aria-label="Dessiner une frame" onClick={() => setOutil("frame")}><Icon fafa="faBorderAll" width={14} /></button>
              <button data-actif={outil === "rectangle"} title="Rectangle (R)" aria-label="Dessiner un rectangle" onClick={() => setOutil("rectangle")}><Icon fafa="faSquare" width={14} /></button>
              <button data-actif={outil === "ellipse"} title="Ellipse (O)" aria-label="Dessiner une ellipse" onClick={() => setOutil("ellipse")}><Icon fafa="faCircle" width={14} /></button>
              <button title="Texte (T)" aria-label="Ajouter du texte" onClick={ajouterTexte}><Icon fafa="faFont" width={14} /></button>
            </div>
          </div>
          {depotActif ? <div className="imgDepot"><Icon fafa="faCloudArrowUp" width={28} /><b>Déposez vos images ici</b><span>PNG, JPEG, WebP, GIF ou SVG</span></div> : null}
        </main>

        <aside className="imgProprietes">
          <div className="imgPanneauOnglets imgPanneauOngletsDroit"><button data-actif={ongletDroit === "design"} onClick={() => setOngletDroit("design")}>Design</button><button data-actif={ongletDroit === "prototype"} onClick={() => setOngletDroit("prototype")}>Prototype</button><button data-actif={ongletDroit === "export"} onClick={() => setOngletDroit("export")}>Export</button></div>
          <h3>{ongletDroit === "design" ? (actif?.nom || "Plan de travail") : ongletDroit === "prototype" ? "Interactions" : "Exporter"}</h3>
          {ongletDroit === "prototype" ? <div className="imgVide"><b>Prototype</b><span>Les liaisons entre frames seront ajoutées avec les frames multiples.</span></div> : ongletDroit === "export" ? <div className="imgExportPanel"><p>Exportez le plan de travail courant.</p><button onClick={() => exporter("image/png")}>PNG</button><button onClick={() => exporter("image/jpeg")}>JPEG</button></div> : <>
          {selectionIds.length > 1 ? <div className="imgMultiSelection"><h4>{selectionIds.length} objets sélectionnés</h4><div className="imgDeux"><label>X<input readOnly value={Math.round(boundsSelection.x)} /></label><label>Y<input readOnly value={Math.round(boundsSelection.y)} /></label><label>Largeur<input readOnly value={Math.round(boundsSelection.largeur)} /></label><label>Hauteur<input readOnly value={Math.round(boundsSelection.hauteur)} /></label></div><h4 className="imgTitreSection">Alignement</h4><div className="imgGrilleAlignement"><button title="Aligner à gauche" onClick={() => alignerSelection("gauche")}><Icon fafa="faAlignLeft" width={11} /></button><button title="Centrer horizontalement" onClick={() => alignerSelection("centreH")}><Icon fafa="faAlignCenter" width={11} /></button><button title="Aligner à droite" onClick={() => alignerSelection("droite")}><Icon fafa="faAlignRight" width={11} /></button><button title="Aligner en haut" onClick={() => alignerSelection("haut")}><Icon fafa="faBars" width={11} /></button><button title="Centrer verticalement" onClick={() => alignerSelection("centreV")}><Icon fafa="faEquals" width={11} /></button><button title="Aligner en bas" onClick={() => alignerSelection("bas")}><Icon fafa="faBars" width={11} /></button><button title="Distribuer horizontalement" disabled={selectionIds.length < 3} onClick={() => distribuerSelection("h")}><Icon fafa="faArrowsLeftRight" width={11} /></button><button title="Distribuer verticalement" disabled={selectionIds.length < 3} onClick={() => distribuerSelection("v")}><Icon fafa="faArrowsUpDown" width={11} /></button></div><button className="imgActionLarge" onClick={grouperSelection}><Icon fafa="faObjectGroup" width={11} /> Grouper la sélection</button></div> : !actif ? <div className="imgReglagesPlan"><h4>Plan de travail</h4><label>Nom de la scène<input value={pages.find((page) => page.id === pageActive)?.nom || ""} onChange={(e) => setPages((liste) => liste.map((page) => page.id === pageActive ? { ...page, nom: e.target.value } : page))} /></label><div className="imgDeux"><label>Largeur<input type="number" min="64" max="4096" value={largeurPlan} onChange={(e) => setLargeurPlan(Math.max(64, Math.min(4096, Number(e.target.value) || 64)))} /></label><label>Hauteur<input type="number" min="64" max="4096" value={hauteurPlan} onChange={(e) => setHauteurPlan(Math.max(64, Math.min(4096, Number(e.target.value) || 64)))} /></label></div><button onClick={ajusterEcran}>Ajuster dans la fenêtre</button><p>Chaque scène possède ses propres dimensions, son fond et ses calques. Glissez-déposez des images directement dans la scène active.</p></div> : (
            <>
              <label>Nom<input value={actif.nom} onChange={(e) => majActif("nom", e.target.value)} /></label>
              <label className="imgCase">Verrouiller le calque<input type="checkbox" checked={Boolean(actif.verrouille)} onChange={(e) => majActif("verrouille", e.target.checked)} /></label>
              {actif.type !== "image" ? <h4 className="imgTitreSection">Contenu</h4> : null}
              {actif.type === "texte" ? <>
                <label>Contenu<textarea value={actif.texte} onChange={(e) => majActif("texte", e.target.value)} /></label>
                <label>Taille<input type="number" min="8" max="300" value={actif.taille} onChange={(e) => majActif("taille", Number(e.target.value))} /></label>
                <label>Couleur<input type="color" value={actif.couleur} onChange={(e) => majActif("couleur", e.target.value)} /></label>
              </> : null}
              {actif.type === "forme" ? <>
                <label>Remplissage<input type="color" value={actif.couleur} onChange={(e) => majActif("couleur", e.target.value)} /></label>
                <label>Contour<input type="color" value={actif.contour} onChange={(e) => majActif("contour", e.target.value)} /></label>
                {actif.forme === "rectangle" ? <label>Rayon des angles<input type="number" min="0" max={Math.floor(Math.min(actif.largeur, actif.hauteur) / 2)} value={actif.rayon || 0} onChange={(e) => majActif("rayon", Math.max(0, Number(e.target.value)))} /></label> : null}
              </> : null}
              {actif.type === "frame" ? <><label>Fond<input type="color" value={actif.couleur} onChange={(e) => majActif("couleur", e.target.value)} /></label><label>Contour<input type="color" value={actif.contour} onChange={(e) => majActif("contour", e.target.value)} /></label><label className="imgCase">Masquer le contenu dépassant<input type="checkbox" checked={actif.clipContent !== false} onChange={(e) => majActif("clipContent", e.target.checked)} /></label></> : null}
              <h4 className="imgTitreSection">Position et dimensions</h4>
              <div className="imgDeux">
                <label>X<input type="number" value={Math.round(actif.x)} onChange={(e) => majActif("x", Number(e.target.value))} /></label>
                <label>Y<input type="number" value={Math.round(actif.y)} onChange={(e) => majActif("y", Number(e.target.value))} /></label>
                <label>Largeur<input type="number" min="1" value={Math.round(actif.largeur)} onChange={(e) => majActif("largeur", Number(e.target.value))} /></label>
                <label>Hauteur<input type="number" min="1" value={Math.round(actif.hauteur)} onChange={(e) => majActif("hauteur", Number(e.target.value))} /></label>
              </div>
              <h4 className="imgTitreSection">Apparence</h4>
              <label>Rotation <output>{actif.rotation || 0}°</output><input type="range" min="-180" max="180" value={actif.rotation || 0} onPointerDown={memoriserReglage} onChange={(e) => majActif("rotation", Number(e.target.value), false)} /></label>
              <label>Opacité <output>{Math.round((actif.opacite ?? 1) * 100)}%</output><input type="range" min="0" max="1" step=".01" value={actif.opacite ?? 1} onPointerDown={memoriserReglage} onChange={(e) => majActif("opacite", Number(e.target.value), false)} /></label>
              <label>Mode de fusion<select value={actif.fusion || "source-over"} onChange={(e) => majActif("fusion", e.target.value)}><option value="source-over">Normal</option><option value="multiply">Produit</option><option value="screen">Écran</option><option value="overlay">Incrustation</option><option value="darken">Assombrir</option><option value="lighten">Éclaircir</option><option value="difference">Différence</option></select></label>
              <div className="imgActionsObjet">
                <button onClick={() => majActif("retourneX", !actif.retourneX)}><Icon fafa="faArrowsLeftRight" width={12} /> Miroir horizontal</button>
                <button onClick={() => majActif("retourneY", !actif.retourneY)}><Icon fafa="faArrowsUpDown" width={12} /> Miroir vertical</button>
              </div>
              <div className="imgOmbre">
                <label className="imgCase">Ombre<input type="checkbox" checked={Boolean(actif.ombre?.active)} onChange={(e) => majActif("ombre", { ...(actif.ombre || { couleur: "#000000", flou: 16, x: 8, y: 8 }), active: e.target.checked })} /></label>
                {actif.ombre?.active ? <div className="imgDeux">
                  <label>Couleur<input type="color" value={actif.ombre.couleur} onChange={(e) => majActif("ombre", { ...actif.ombre, couleur: e.target.value })} /></label>
                  <label>Flou<input type="number" min="0" max="100" value={actif.ombre.flou} onChange={(e) => majActif("ombre", { ...actif.ombre, flou: Number(e.target.value) })} /></label>
                  <label>Décalage X<input type="number" value={actif.ombre.x} onChange={(e) => majActif("ombre", { ...actif.ombre, x: Number(e.target.value) })} /></label>
                  <label>Décalage Y<input type="number" value={actif.ombre.y} onChange={(e) => majActif("ombre", { ...actif.ombre, y: Number(e.target.value) })} /></label>
                </div> : null}
              </div>
              {actif.type === "image" ? <div className="imgFiltres">
                <h4>Réglages non destructifs</h4>
                {[['luminosite','Luminosité',0,200],['contraste','Contraste',0,200],['saturation','Saturation',0,200],['flou','Flou',0,20],['niveauxGris','Noir et blanc',0,100],['sepia','Sépia',0,100]].map(([cle, libelle, min, max]) => <label key={cle}>{libelle}<output>{actif.filtres[cle]}</output><input type="range" min={min} max={max} value={actif.filtres[cle]} onPointerDown={memoriserReglage} onChange={(e) => majFiltre(cle, Number(e.target.value), false)} /></label>)}
                <button onClick={() => majActif("filtres", { ...filtreNeutre })}>Réinitialiser les filtres</button>
              </div> : null}
            </>
          )}
          <section className="imgFondScene"><h4>Fond de la scène</h4><label className="imgCase">Transparent<input type="checkbox" checked={fondTransparent} onChange={(e) => setFondTransparent(e.target.checked)} /></label><label data-inactif={fondTransparent}>Couleur<input type="color" value={fond} disabled={fondTransparent} onChange={(e) => setFond(e.target.value)} /><span>{fond.toUpperCase()}</span></label></section>
          </>}
        </aside>
      </div>
    </ModuleWindow>
  );
}

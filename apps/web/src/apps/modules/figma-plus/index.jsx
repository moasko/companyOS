import React, { useEffect, useRef, useState } from "react";
import { Stage, Layer, Rect, Ellipse, Text, Line, Star, Transformer, Group } from "react-konva";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { ouvrirFenetre } from "../../../apps/windows";
import "./figma-plus.scss";

export const manifest = {
  id: "figmaPlus",
  slug: "figma-plus",
  name: "Figma++",
  icon: "paint",
  // Le Bureau ouvre les apps par leur action Redux : indispensable.
  action: "FIGMAPLUSAPP",
  version: "1.3.0",
  nouveautes: [
    { version: "1.3.0", texte: "Fidélité Figma : pages multiples (ajouter, dupliquer, renommer, supprimer), survol bleu sur les objets, Fill/Stroke avec swatch + hex + opacité, effets d'ombre, modes de fusion, outil Main, badge « N sélectionnés » et export depuis le panneau Design." },
  ],
  Window: FigmaPlusApp,
};

const PAGE_W = 1280;
const PAGE_H = 800;
const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const copie = (elements) => elements.map((e) => ({ ...e }));

const nouvelleForme = (outil, monde) => {
  const commun = { id: id(), nom: outil[0].toUpperCase() + outil.slice(1), x: monde.x, y: monde.y, largeur: 1, hauteur: 1, rotation: 0, opacite: 1, visible: true, verrouille: false, remplissage: outil === "texte" ? "#ffffff" : "#d9d9d9", contour: "#151515", epaisseur: 2, fusion: "normal", ombre: { active: false, couleur: "#000000", flou: 12, x: 0, y: 4 } };
  if (outil === "texte") return { ...commun, type: "texte", texte: "Texte", taille: 36, gras: true, italique: false, alignement: "centre", largeur: 260, hauteur: 46, contour: "transparent", epaisseur: 0 };
  if (outil === "ligne") return { ...commun, type: "ligne", nom: "Ligne", remplissage: "transparent", contour: "#ffffff", epaisseur: 3 };
  if (outil === "etoile") return { ...commun, type: "etoile", nom: "Étoile", remplissage: "#ffd400", contour: "#c9932a" };
  if (outil === "ellipse") return { ...commun, type: "ellipse", nom: "Ellipse" };
  return { ...commun, type: "rect", rayon: 0 };
};

const creerPage = (nom) => ({ id: id(), nom, elements: [] });

// Les ellipses et étoiles Konva sont centrées : lecture/écriture par leur
// boîte englobante pour garder un modèle uniforme (coin haut-gauche).
const centreBase = (type) => type === "ellipse" || type === "etoile";

const mesureNode = (node, element) => {
  const largeur = Math.abs(node.scaleX()) * element.largeur;
  const hauteur = Math.abs(node.scaleY()) * element.hauteur;
  let x = node.x();
  let y = node.y();
  if (centreBase(element.type)) { x -= largeur / 2; y -= hauteur / 2; }
  else if (node.scaleX() < 0) x -= largeur;
  if (node.scaleY() < 0) y -= hauteur;
  return { x, y, largeur, hauteur };
};

const lireNode = (node, element) => {
  const mesures = mesureNode(node, element);
  node.scaleX(1);
  node.scaleY(1);
  return { ...mesures, largeur: Math.max(4, mesures.largeur), hauteur: Math.max(4, mesures.hauteur), rotation: Math.round(node.rotation() * 10) / 10, flipX: node.scaleX() < 0, flipY: node.scaleY() < 0 };
};

const intersecte = (element, cadre) =>
  element.x < cadre.x + cadre.largeur &&
  element.x + element.largeur > cadre.x &&
  element.y < cadre.y + cadre.hauteur &&
  element.y + element.hauteur > cadre.y;

const boiteCommune = (elements) => {
  const x = Math.min(...elements.map((e) => e.x));
  const y = Math.min(...elements.map((e) => e.y));
  const droite = Math.max(...elements.map((e) => e.x + e.largeur));
  const bas = Math.max(...elements.map((e) => e.y + e.hauteur));
  return { x, y, largeur: droite - x, hauteur: bas - y };
};

function FigmaPlusApp() {
  const scene = useRef(null);
  const stageRef = useRef(null);
  const calqueRef = useRef(null);
  const transformeur = useRef(null);
  const brouillon = useRef(null);
  const marquee = useRef(null);
  const panning = useRef(null);
  const glisseHisto = useRef(false);
  const glisseAlt = useRef(false);
  const glisseOrigine = useRef(null);
  const espaceRef = useRef(false);
  const pressePapier = useRef(null);
  const importeur = useRef(null);

  const [pages, setPages] = useState(() => [creerPage("Page 1")]);
  const [pageActiveId, setPageActiveId] = useState(() => pages[0].id);
  const [selectionIds, setSelectionIds] = useState([]);
  const [historique, setHistorique] = useState({ passe: [], futur: [] });
  const [outil, setOutil] = useState("select");
  const [zoom, setZoom] = useState(70);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [marqueeRect, setMarqueeRect] = useState(null);
  const [guides, setGuides] = useState({ x: null, y: null });
  const [badge, setBadge] = useState(null);
  const [survolId, setSurvolId] = useState(null);
  const [editionTexteId, setEditionTexteId] = useState(null);
  const [espace, setEspace] = useState(false);
  const [majEnfoncee, setMajEnfoncee] = useState(false);
  const [nomDesign, setNomDesign] = useState("Sans titre");
  const [tailleScene, setTailleScene] = useState({ largeur: 0, hauteur: 0 });
  const [pageFond, setPageFond] = useState("#ffffff");
  const [echelleExport, setEchelleExport] = useState(2);

  const echelle = zoom / 100;
  const pageActive = pages.find((p) => p.id === pageActiveId) || pages[0];
  const elements = pageActive.elements;
  const actif = elements.find((e) => e.id === selectionIds.at(-1)) || null;
  const multi = selectionIds.length > 1;

  // Les mutations d'éléments passent toujours par la page active.
  const setElements = (transformation) => setPages((liste) => liste.map((page) => page.id === pageActiveId ? { ...page, elements: typeof transformation === "function" ? transformation(page.elements) : transformation } : page));

  useEffect(() => {
    const element = scene.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observateur = new ResizeObserver(() => setTailleScene({ largeur: element.clientWidth, hauteur: element.clientHeight }));
    observateur.observe(element);
    return () => observateur.disconnect();
  }, []);

  const pousser = (avant) => setHistorique((h) => ({ passe: [...h.passe.slice(-59), copie(avant)], futur: [] }));
  const modifier = (transformation, memoriser = true) => setElements((courants) => {
    const suivants = typeof transformation === "function" ? transformation(courants) : transformation;
    if (memoriser) pousser(courants);
    return suivants;
  });
  const annuler = () => setHistorique((h) => {
    if (!h.passe.length) return h;
    const passe = [...h.passe];
    const precedent = passe.pop();
    setElements(precedent);
    setSelectionIds([]);
    return { passe, futur: [copie(elements), ...h.futur] };
  });
  const retablir = () => setHistorique((h) => {
    if (!h.futur.length) return h;
    const [suivant, ...futur] = h.futur;
    setElements(suivant);
    setSelectionIds([]);
    return { passe: [...h.passe, copie(elements)], futur };
  });

  const changerPage = (identifiant) => {
    if (identifiant === pageActiveId) return;
    setPageActiveId(identifiant);
    setSelectionIds([]);
    setHistorique({ passe: [], futur: [] });
    setEditionTexteId(null);
  };
  const ajouterPage = () => {
    const page = creerPage(`Page ${pages.length + 1}`);
    setPages((liste) => [...liste, page]);
    changerPage(page.id);
  };
  const dupliquerPage = (identifiant) => {
    const source = pages.find((p) => p.id === identifiant);
    if (!source) return;
    const copiePage = { ...source, id: id(), nom: `${source.nom} copie`, elements: copie(source.elements) };
    const index = pages.findIndex((p) => p.id === identifiant);
    const liste = [...pages];
    liste.splice(index + 1, 0, copiePage);
    setPages(liste);
    changerPage(copiePage.id);
  };
  const supprimerPage = (identifiant) => {
    if (pages.length <= 1) return;
    const restantes = pages.filter((p) => p.id !== identifiant);
    setPages(restantes);
    if (identifiant === pageActiveId) changerPage(restantes[0].id);
  };
  const renommerPage = (identifiant, valeur) => setPages((liste) => liste.map((p) => p.id === identifiant ? { ...p, nom: valeur.trim() || p.nom } : p));
  const [renommagePageId, setRenommagePageId] = useState(null);
  const [valeurRenommagePage, setValeurRenommagePage] = useState("");

  // ---- Sélection & Transformer -------------------------------------------
  useEffect(() => {
    const tr = transformeur.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const noeuds = selectionIds
      .filter((identifiant) => !elements.find((e) => e.id === identifiant)?.verrouille)
      .map((identifiant) => stage.findOne("#" + identifiant))
      .filter(Boolean);
    tr.nodes(noeuds);
    tr.getLayer()?.batchDraw();
  }, [selectionIds, elements, outil]);

  const selectionner = (element, event) => {
    if (outil !== "select") return;
    event.cancelBubble = true;
    if (event.evt.shiftKey) {
      setSelectionIds((ids) => ids.includes(element.id) ? ids.filter((i) => i !== element.id) : [...ids, element.id]);
    } else if (!selectionIds.includes(element.id)) {
      setSelectionIds([element.id]);
    }
  };

  // ---- Magnétisme : bords et centres de la page et des autres objets -----
  const aimente = (element, node) => {
    const seuil = 6 / echelle;
    const boite = { x: node.x(), y: node.y(), largeur: element.largeur, hauteur: element.hauteur };
    const ciblesX = [0, PAGE_W / 2, PAGE_W];
    const ciblesY = [0, PAGE_H / 2, PAGE_H];
    elements.forEach((autre) => {
      if (autre.id === element.id || autre.visible === false) return;
      ciblesX.push(autre.x, autre.x + autre.largeur / 2, autre.x + autre.largeur);
      ciblesY.push(autre.y, autre.y + autre.hauteur / 2, autre.y + autre.hauteur);
    });
    let dx = 0;
    let guideX = null;
    let meilleurX = seuil;
    [boite.x, boite.x + boite.largeur / 2, boite.x + boite.largeur].forEach((ancre) => {
      ciblesX.forEach((cible) => {
        const delta = Math.abs(ancre - cible);
        if (delta <= seuil && delta < meilleurX) { meilleurX = delta; dx = cible - ancre; guideX = cible; }
      });
    });
    let dy = 0;
    let guideY = null;
    let meilleurY = seuil;
    [boite.y, boite.y + boite.hauteur / 2, boite.y + boite.hauteur].forEach((ancre) => {
      ciblesY.forEach((cible) => {
        const delta = Math.abs(ancre - cible);
        if (delta <= seuil && delta < meilleurY) { meilleurY = delta; dy = cible - ancre; guideY = cible; }
      });
    });
    if (dx || dy) node.position({ x: node.x() + dx, y: node.y() + dy });
    setGuides({ x: guideX, y: guideY });
  };

  // ---- Gestes scène --------------------------------------------------------
  const monde = () => {
    const stage = stageRef.current;
    const pos = stage.getPointerPosition();
    return { x: (pos.x - pan.x) / echelle, y: (pos.y - pan.y) / echelle };
  };

  const surBas = (event) => {
    const stage = stageRef.current;
    if (espaceRef.current || outil === "main" || event.evt.button === 1) {
      panning.current = { x: event.evt.clientX, y: event.evt.clientY, pan: { ...pan } };
      event.evt.preventDefault();
      return;
    }
    const pos = monde();
    const surVide = event.target === stage || event.target.name() === "page";
    if (outil === "select") {
      if (surVide) {
        marquee.current = { x: pos.x, y: pos.y };
        setMarqueeRect({ x: pos.x, y: pos.y, largeur: 0, hauteur: 0 });
      }
      return;
    }
    if (surVide) {
      if (outil === "texte") {
        const element = { ...nouvelleForme("texte", pos) };
        pousser(elements);
        setElements((liste) => [...liste, element]);
        setSelectionIds([element.id]);
        setOutil("select");
        return;
      }
      const element = nouvelleForme(outil, pos);
      brouillon.current = { id: element.id, sx: pos.x, sy: pos.y };
      setElements((liste) => [...liste, element]);
      setSelectionIds([element.id]);
    }
  };

  const surBougeSouris = (event) => {
    const stage = stageRef.current;
    if (panning.current) {
      setPan({ x: panning.current.pan.x + (event.evt.clientX - panning.current.x), y: panning.current.pan.y + (event.evt.clientY - panning.current.y) });
      return;
    }
    if (outil === "select" && !glisseHisto.current && !brouillon.current && !marquee.current) {
      const survole = stage.getIntersection(stage.getPointerPosition());
      const identifiant = survole && survole.id && elements.some((e) => e.id === survole.id()) ? survole.id() : null;
      if (identifiant !== survolId) setSurvolId(identifiant);
    }
    if (brouillon.current) {
      const pos = monde();
      const depart = brouillon.current;
      let dx = pos.x - depart.sx;
      let dy = pos.y - depart.sy;
      if (majEnfoncee) {
        if (outil === "ligne") {
          const longueur = Math.hypot(dx, dy);
          const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          dx = Math.cos(angle) * longueur;
          dy = Math.sin(angle) * longueur;
        } else {
          const cote = Math.max(Math.abs(dx), Math.abs(dy));
          dx = Math.sign(dx || 1) * cote;
          dy = Math.sign(dy || 1) * cote;
        }
      }
      setElements((liste) => liste.map((e) => (e.id === depart.id ? { ...e, x: Math.min(depart.sx, depart.sx + dx), y: Math.min(depart.sy, depart.sy + dy), largeur: Math.max(1, Math.abs(dx)), hauteur: Math.max(1, Math.abs(dy)) } : e)));
      return;
    }
    if (marquee.current) {
      const pos = monde();
      const x = Math.min(marquee.current.x, pos.x);
      const y = Math.min(marquee.current.y, pos.y);
      setMarqueeRect({ x, y, largeur: Math.abs(pos.x - marquee.current.x), hauteur: Math.abs(pos.y - marquee.current.y) });
    }
  };

  const surHaut = () => {
    panning.current = null;
    setBadge(null);
    if (brouillon.current) {
      const identifiant = brouillon.current.id;
      brouillon.current = null;
      setElements((liste) => {
        const element = liste.find((e) => e.id === identifiant);
        if (!element) return liste;
        if (element.largeur < 4 && element.hauteur < 4) {
          setSelectionIds([]);
          return liste.filter((e) => e.id !== identifiant);
        }
        pousser(liste.filter((e) => e.id !== identifiant));
        return liste;
      });
      setOutil("select");
      return;
    }
    if (marquee.current) {
      const cadre = marqueeRect;
      marquee.current = null;
      setMarqueeRect(null);
      if (cadre && (cadre.largeur > 2 || cadre.hauteur > 2)) {
        setSelectionIds(elements.filter((e) => e.visible && !e.verrouille && intersecte(e, cadre)).map((e) => e.id));
      }
    }
  };

  const surMolette = (event) => {
    event.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage.getPointerPosition();
    const ancien = zoom / 100;
    const vers = { x: (pointer.x - pan.x) / ancien, y: (pointer.y - pan.y) / ancien };
    const nouveau = Math.max(0.1, Math.min(4, ancien * (event.evt.deltaY > 0 ? 1 / 1.08 : 1.08)));
    setZoom(Math.round(nouveau * 100));
    setPan({ x: pointer.x - vers.x * nouveau, y: pointer.y - vers.y * nouveau });
  };

  // ---- Actions -------------------------------------------------------------
  const racinesSelection = () => {
    const ids = new Set(selectionIds);
    return elements.filter((e) => ids.has(e.id) && !e.verrouille);
  };
  const supprimer = () => {
    const cibles = racinesSelection();
    if (!cibles.length) return;
    const ids = new Set(cibles.map((e) => e.id));
    pousser(elements);
    setElements((liste) => liste.filter((e) => !ids.has(e.id)));
    setSelectionIds([]);
  };
  const dupliquer = () => {
    const cibles = racinesSelection();
    if (!cibles.length) return;
    pousser(elements);
    const clones = cibles.map((e) => ({ ...e, id: id(), x: e.x + 18, y: e.y + 18 }));
    setElements((liste) => [...liste, ...clones]);
    setSelectionIds(clones.map((c) => c.id));
  };
  const copier = () => {
    const cibles = racinesSelection();
    if (!cibles.length) return;
    pressePapier.current = copie(cibles);
  };
  const coller = () => {
    const sac = pressePapier.current;
    if (!sac?.length) return;
    pousser(elements);
    const clones = sac.map((e) => ({ ...e, id: id(), x: e.x + 16, y: e.y + 16 }));
    setElements((liste) => [...liste, ...clones]);
    setSelectionIds(clones.map((c) => c.id));
  };
  const couper = () => {
    if (!racinesSelection().length) return;
    copier();
    supprimer();
  };
  const deplacerNiveau = (pas) => {
    if (selectionIds.length !== 1) return;
    modifier((liste) => {
      const index = liste.findIndex((e) => e.id === selectionIds[0]);
      const cible = Math.max(0, Math.min(liste.length - 1, index + pas));
      if (index < 0 || cible === index) return liste;
      const copieListe = [...liste];
      const [objet] = copieListe.splice(index, 1);
      copieListe.splice(cible, 0, objet);
      return copieListe;
    });
  };
  const ordreExtreme = (auFond) => {
    if (selectionIds.length !== 1) return;
    modifier((liste) => {
      const objet = liste.find((e) => e.id === selectionIds[0]);
      if (!objet) return liste;
      const restants = liste.filter((e) => e.id !== objet.id);
      return auFond ? [objet, ...restants] : [...restants, objet];
    });
  };
  const nudge = (dx, dy) => {
    if (!selectionIds.length) return;
    modifier((liste) => liste.map((e) => selectionIds.includes(e.id) ? { ...e, x: e.x + dx, y: e.y + dy } : e));
  };
  const majSelection = (champ, valeur) => {
    if (!selectionIds.length) return;
    modifier((liste) => liste.map((e) => selectionIds.includes(e.id) ? { ...e, [champ]: valeur } : e));
  };
  const toutSelectionner = () => setSelectionIds(elements.filter((e) => e.visible && !e.verrouille).map((e) => e.id));

  const aligner = (mode) => {
    if (selectionIds.length < 2) return;
    modifier((liste) => {
      const sel = liste.filter((e) => selectionIds.includes(e.id));
      const boite = boiteCommune(sel);
      return liste.map((e) => {
        if (!selectionIds.includes(e.id)) return e;
        if (mode === "gauche") return { ...e, x: boite.x };
        if (mode === "centreH") return { ...e, x: boite.x + (boite.largeur - e.largeur) / 2 };
        if (mode === "droite") return { ...e, x: boite.x + boite.largeur - e.largeur };
        if (mode === "haut") return { ...e, y: boite.y };
        if (mode === "centreV") return { ...e, y: boite.y + (boite.hauteur - e.hauteur) / 2 };
        if (mode === "bas") return { ...e, y: boite.y + boite.hauteur - e.hauteur };
        return e;
      });
    });
  };
  const distribuer = (axe) => {
    if (selectionIds.length < 3) return;
    modifier((liste) => {
      const sel = liste.filter((e) => selectionIds.includes(e.id));
      const tri = [...sel].sort((a, b) => (axe === "h" ? a.x - b.x : a.y - b.y));
      const boite = boiteCommune(sel);
      const total = tri.reduce((somme, e) => somme + (axe === "h" ? e.largeur : e.hauteur), 0);
      const espaceVif = ((axe === "h" ? boite.largeur : boite.hauteur) - total) / (tri.length - 1);
      const positions = new Map();
      let curseur = axe === "h" ? boite.x : boite.y;
      tri.forEach((e) => { positions.set(e.id, curseur); curseur += (axe === "h" ? e.largeur : e.hauteur) + espaceVif; });
      return liste.map((e) => {
        if (!positions.has(e.id)) return e;
        return axe === "h" ? { ...e, x: positions.get(e.id) } : { ...e, y: positions.get(e.id) };
      });
    });
  };

  const ajusterEcran = () => {
    if (!tailleScene.largeur) return;
    setZoom(Math.max(10, Math.min(100, Math.min((tailleScene.largeur - 80) / PAGE_W, (tailleScene.hauteur - 80) / PAGE_H) * 100)));
    setPan({ x: 0, y: 0 });
  };

  const exporterPNG = () => {
    const tr = transformeur.current;
    const sauvegarde = tr.nodes();
    tr.nodes([]);
    calqueRef.current?.batchDraw();
    const url = stageRef.current.toDataURL({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, pixelRatio: echelleExport });
    tr.nodes(sauvegarde);
    tr.getLayer()?.batchDraw();
    const lien = document.createElement("a");
    lien.download = `${(nomDesign || "figma-plus").replace(/\s+/g, "-").toLowerCase()}.png`;
    lien.href = url;
    lien.click();
  };

  const sauverProjet = () => {
    const contenu = JSON.stringify({ format: "companyos-figplus", version: 2, nom: nomDesign, page: { largeur: PAGE_W, hauteur: PAGE_H, fond: pageFond }, pageActiveId, pages });
    const url = URL.createObjectURL(new Blob([contenu], { type: "application/json" }));
    const lien = document.createElement("a");
    lien.href = url;
    lien.download = `${(nomDesign || "design").replace(/\s+/g, "-").toLowerCase()}.figplus`;
    lien.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const ouvrirProjet = async (fichier) => {
    if (!fichier) return;
    try {
      const projet = JSON.parse(await fichier.text());
      const elementsValides = Array.isArray(projet.elements) || Array.isArray(projet.pages);
      if (projet.format !== "companyos-figplus" || !elementsValides) throw new Error("format");
      pousser(elements);
      setNomDesign(projet.nom || "Design importé");
      setPageFond(projet.page?.fond || "#ffffff");
      if (Array.isArray(projet.pages) && projet.pages.length) {
        setPages(projet.pages);
        changerPage(projet.pages.some((p) => p.id === projet.pageActiveId) ? projet.pageActiveId : projet.pages[0].id);
      } else {
        const seule = creerPage("Page 1");
        seule.elements = projet.elements;
        setPages([seule]);
        changerPage(seule.id);
      }
    } catch {
      window.alert("Ce fichier n'est pas un projet Figma++ valide.");
    }
  };

  // ---- Clavier -------------------------------------------------------------
  useEffect(() => {
    const saisie = (cible) => cible?.matches?.("input, textarea, select, [contenteditable='true']");
    const bas = (event) => {
      if (!scene.current?.offsetParent || saisie(event.target)) return;
      if (event.key === "Shift") { setMajEnfoncee(true); return; }
      if (event.code === "Space") { espaceRef.current = true; setEspace(true); event.preventDefault(); return; }
      const cmd = event.ctrlKey || event.metaKey;
      const touche = event.key.toLowerCase();
      if (cmd && touche === "z") { event.preventDefault(); event.shiftKey ? retablir() : annuler(); }
      else if (cmd && touche === "y") { event.preventDefault(); retablir(); }
      else if (cmd && touche === "d") { event.preventDefault(); dupliquer(); }
      else if (cmd && touche === "a") { event.preventDefault(); toutSelectionner(); }
      else if (cmd && touche === "c") { event.preventDefault(); copier(); }
      else if (cmd && touche === "v") { event.preventDefault(); coller(); }
      else if (cmd && touche === "x") { event.preventDefault(); couper(); }
      else if (cmd && event.key === "0") { event.preventDefault(); ajusterEcran(); }
      else if (cmd && event.key === "1") { event.preventDefault(); setZoom(100); setPan({ x: 0, y: 0 }); }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); supprimer(); }
      else if (event.key === "Escape") { setSelectionIds([]); setOutil("select"); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); nudge(event.shiftKey ? -10 : -1, 0); }
      else if (event.key === "ArrowRight") { event.preventDefault(); nudge(event.shiftKey ? 10 : 1, 0); }
      else if (event.key === "ArrowUp") { event.preventDefault(); nudge(0, event.shiftKey ? -10 : -1); }
      else if (event.key === "ArrowDown") { event.preventDefault(); nudge(0, event.shiftKey ? 10 : 1); }
      else if (!cmd && touche === "v") setOutil("select");
      else if (!cmd && touche === "h") setOutil("main");
      else if (!cmd && touche === "r") setOutil("rect");
      else if (!cmd && touche === "o") setOutil("ellipse");
      else if (!cmd && touche === "t") setOutil("texte");
      else if (!cmd && touche === "l") setOutil("ligne");
      else if (!cmd && touche === "s") setOutil("etoile");
    };
    const haut = (event) => {
      if (event.key === "Shift") setMajEnfoncee(false);
      if (event.code === "Space") { espaceRef.current = false; setEspace(false); }
    };
    window.addEventListener("keydown", bas);
    window.addEventListener("keyup", haut);
    return () => {
      window.removeEventListener("keydown", bas);
      window.removeEventListener("keyup", haut);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, selectionIds, outil]);

  // ---- Rendu Konva ----------------------------------------------------------
  const propsCommuns = (element) => ({
    id: element.id,
    x: element.x,
    y: element.y,
    rotation: element.rotation || 0,
    opacity: element.opacite ?? 1,
    visible: element.visible !== false,
    scaleX: element.flipX ? -1 : 1,
    scaleY: element.flipY ? -1 : 1,
    globalCompositeOperation: element.fusion || "normal",
    shadowEnabled: Boolean(element.ombre?.active),
    shadowColor: element.ombre?.couleur,
    shadowBlur: element.ombre?.flou || 0,
    shadowOffsetX: element.ombre?.x || 0,
    shadowOffsetY: element.ombre?.y || 0,
    listening: outil === "select",
    draggable: outil === "select" && !espace && !element.verrouille,
    onMouseDown: (e) => {
      glisseAlt.current = e.evt.altKey;
      glisseOrigine.current = { x: element.x, y: element.y };
      selectionner(element, e);
    },
    onDragStart: () => {
      if (!glisseHisto.current) { pousser(elements); glisseHisto.current = true; }
    },
    onDragMove: (e) => {
      aimente(element, e.target);
      const mesures = mesureNode(e.target, element);
      setBadge({ x: mesures.x, y: mesures.y + mesures.hauteur + 8 / echelle, texte: `${Math.round(mesures.x)}, ${Math.round(mesures.y)}` });
    },
    onDragEnd: (e) => {
      const patch = lireNode(e.target, element);
      glisseHisto.current = false;
      setGuides({ x: null, y: null });
      setBadge(null);
      if (glisseAlt.current) {
        glisseAlt.current = false;
        const origine = glisseOrigine.current;
        modifier((liste) => [...liste.map((el) => (el.id === element.id ? { ...el, x: origine.x, y: origine.y } : el)), { ...element, ...patch, id: id(), nom: `${element.nom} copie` }]);
        return;
      }
      modifier((liste) => liste.map((el) => el.id === element.id ? { ...el, ...patch } : el), false);
    },
    onTransformStart: () => {
      if (!glisseHisto.current) { pousser(elements); glisseHisto.current = true; }
    },
    onTransformMove: (e) => {
      const mesures = mesureNode(e.target, element);
      setBadge({ x: mesures.x + mesures.largeur / 2, y: mesures.y + mesures.hauteur + 8 / echelle, texte: `${Math.round(mesures.largeur)} × ${Math.round(mesures.hauteur)}` });
    },
    onTransformEnd: (e) => {
      const patch = lireNode(e.target, element);
      glisseHisto.current = false;
      setBadge(null);
      modifier((liste) => liste.map((el) => el.id === element.id ? { ...el, ...patch } : el), false);
    },
    onDblClick: () => {
      if (element.type === "texte" && !element.verrouille) {
        setOutil("select");
        setSelectionIds([element.id]);
        setEditionTexteId(element.id);
      }
    },
  });

  const propsOmbre = (element) => (element.ombre?.active ? {
    shadowColor: element.ombre.couleur,
    shadowBlur: element.ombre.flou || 0,
    shadowOffsetX: element.ombre.x || 0,
    shadowOffsetY: element.ombre.y || 0,
  } : {});

  const rendreElement = (element) => {
    const communs = { ...propsCommuns(element), ...propsOmbre(element) };
    const remplissage = element.remplissage;
    if (element.type === "rect") return <Rect {...communs} width={element.largeur} height={element.hauteur} fill={remplissage} stroke={element.epaisseur ? element.contour : undefined} strokeWidth={element.epaisseur || 0} cornerRadius={element.rayon || 0} />;
    if (element.type === "ellipse") return <Ellipse {...communs} x={element.x + element.largeur / 2} y={element.y + element.hauteur / 2} radiusX={element.largeur / 2} radiusY={element.hauteur / 2} fill={remplissage} stroke={element.epaisseur ? element.contour : undefined} strokeWidth={element.epaisseur || 0} />;
    if (element.type === "etoile") { const rayon = Math.min(element.largeur, element.hauteur) / 2; return <Star {...communs} x={element.x + element.largeur / 2} y={element.y + element.hauteur / 2} numPoints={5} innerRadius={rayon * 0.42} outerRadius={rayon} fill={remplissage} stroke={element.epaisseur ? element.contour : undefined} strokeWidth={element.epaisseur || 0} />; }
    if (element.type === "ligne") return <Line {...communs} points={[0, 0, element.largeur, element.hauteur]} stroke={element.contour} strokeWidth={element.epaisseur || 3} lineCap="round" />;
    return <Text {...communs} width={element.largeur} height={element.hauteur} text={element.texte} fontSize={element.taille} fontStyle={`${element.gras ? "bold" : ""}${element.italique ? " italic" : ""}`.trim() || "normal"} fill={remplissage} align={element.alignement || "center"} verticalAlign="middle" />;
  };

  const outils = [
    ["select", "faArrowPointer", "Déplacer (V)"],
    ["main", "faHand", "Main (H)"],
    ["rect", "faSquare", "Rectangle (R)"],
    ["ellipse", "faCircle", "Ellipse (O)"],
    ["ligne", "faSlash", "Ligne (L)"],
    ["etoile", "faStar", "Étoile (S)"],
    ["texte", "faFont", "Texte (T)"],
  ];

  const survole = elements.find((e) => e.id === survolId && !selectionIds.includes(e.id) && e.visible && !e.verrouille) || null;
  const editionTexte = editionTexteId ? elements.find((e) => e.id === editionTexteId) : null;

  return (
    <ModuleWindow manifest={manifest} className="fgApp">
      <div className="fgBarre">
        <button className="fgLogo" title="Boutique d'applications" onClick={() => ouvrirFenetre("store")}><Icon fafa="faFigma" width={13} /></button>
        <div className="fgOutilsGauche">
          {outils.map(([identifiant, icone, titre]) => (
            <button key={identifiant} data-actif={outil === identifiant} title={titre} aria-label={titre} onClick={() => setOutil(identifiant)}><Icon fafa={icone} width={14} /></button>
          ))}
        </div>
        {multi ? (
          <div className="fgNom fgNomTexte">{selectionIds.length} sélectionné{selectionIds.length > 1 ? "s" : ""}</div>
        ) : (
          <input className="fgNom" value={nomDesign} onChange={(e) => setNomDesign(e.target.value)} aria-label="Nom du design" spellCheck={false} />
        )}
        <div className="fgActionsDroite">
          <button onClick={annuler} disabled={!historique.passe.length} title="Annuler (Ctrl+Z)"><Icon fafa="faRotateLeft" width={12} /></button>
          <button onClick={retablir} disabled={!historique.futur.length} title="Rétablir (Ctrl+Maj+Z)"><Icon fafa="faRotateRight" width={12} /></button>
          <span className="fgSep" />
          <button onClick={() => importeur.current?.click()} title="Ouvrir .figplus"><Icon fafa="faFolderOpen" width={12} /></button>
          <input ref={importeur} hidden type="file" accept=".figplus,application/json" onChange={(e) => ouvrirProjet(e.target.files?.[0])} />
          <button onClick={sauverProjet} title="Sauver .figplus"><Icon fafa="faFloppyDisk" width={12} /></button>
          <button className="fgPrimaire" onClick={exporterPNG} title={`Export PNG ×${echelleExport}`}><Icon fafa="faFileExport" width={12} /> Export</button>
        </div>
      </div>

      <div className="fgCorps">
        <aside className="fgCalques">
          <div className="fgPages">
            <div className="fgPagesTete"><span>Pages</span><button title="Nouvelle page" onClick={ajouterPage}><Icon fafa="faPlus" width={10} /></button></div>
            {pages.map((page) => (
              <div key={page.id} className="fgPageLigne" data-actif={page.id === pageActiveId}>
                {renommagePageId === page.id ? (
                  <input
                    className="fgPageInput"
                    autoFocus
                    value={valeurRenommagePage}
                    onChange={(e) => setValeurRenommagePage(e.target.value)}
                    onBlur={() => { renommerPage(page.id, valeurRenommagePage); setRenommagePageId(null); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Escape") { renommerPage(page.id, valeurRenommagePage); setRenommagePageId(null); }
                    }}
                  />
                ) : (
                  <button className="fgPageNom" onClick={() => changerPage(page.id)} onDoubleClick={() => { setRenommagePageId(page.id); setValeurRenommagePage(page.nom); }} title="Double-clic pour renommer">
                    <Icon fafa="faFile" width={10} />
                    <span>{page.nom}</span>
                  </button>
                )}
                <button title="Dupliquer" onClick={() => dupliquerPage(page.id)}><Icon fafa="faClone" width={9} /></button>
                {pages.length > 1 ? <button className="fgPageSuppr" title="Supprimer" onClick={() => supprimerPage(page.id)}><Icon fafa="faTrashCan" width={9} /></button> : null}
              </div>
            ))}
          </div>
          <div className="fgPagesTete fgCalquesTete"><span>Calques</span><small>{elements.length}</small></div>
          <div className="fgListe">
            {[...elements].reverse().map((element) => (
              <div key={element.id} className="fgCalque" data-actif={selectionIds.includes(element.id)} data-verrouille={Boolean(element.verrouille)}>
                <button className="fgCalqueNom" onClick={(e) => selectionner(element, { evt: { shiftKey: e.shiftKey }, cancelBubble: false })}>
                  <Icon fafa={element.verrouille ? "faLock" : element.type === "texte" ? "faFont" : element.type === "ellipse" ? "faCircle" : element.type === "etoile" ? "faStar" : element.type === "ligne" ? "faSlash" : "faSquare"} width={11} />
                  <span>{element.nom}</span>
                </button>
                <button title={element.visible ? "Masquer" : "Afficher"} onClick={() => modifier((liste) => liste.map((el) => el.id === element.id ? { ...el, visible: !el.visible } : el), false)}><Icon fafa={element.visible ? "faEye" : "faEyeSlash"} width={11} /></button>
              </div>
            ))}
            {!elements.length ? <p>Page vide — dessine quelque chose.</p> : null}
          </div>
          <div className="fgCalqueActions">
            <button disabled={selectionIds.length !== 1} onClick={() => deplacerNiveau(1)}>Monter</button>
            <button disabled={selectionIds.length !== 1} onClick={() => deplacerNiveau(-1)}>Descendre</button>
            <button disabled={selectionIds.length !== 1} onClick={() => ordreExtreme(false)}>Premier</button>
            <button disabled={selectionIds.length !== 1} onClick={() => ordreExtreme(true)}>Arrière</button>
            <button disabled={!selectionIds.length} onClick={dupliquer}>Dupliquer</button>
            <button className="fgDanger" disabled={!racinesSelection().length} onClick={supprimer}>Supprimer</button>
          </div>
        </aside>

        <main className={`fgScene${espace || outil === "main" ? " fgPan" : ""}`} ref={scene} data-outil={outil}>
          <Stage
            ref={stageRef}
            width={tailleScene.largeur || 800}
            height={tailleScene.hauteur || 600}
            scaleX={echelle}
            scaleY={echelle}
            x={pan.x}
            y={pan.y}
            onMouseDown={surBas}
            onMouseMove={surBougeSouris}
            onMouseUp={surHaut}
            onMouseLeave={() => setSurvolId(null)}
            onWheel={surMolette}
          >
            <Layer ref={calqueRef}>
              <Rect name="page" x={0} y={0} width={PAGE_W} height={PAGE_H} fill={pageFond} stroke="#d5d9e0" strokeWidth={1 / echelle} shadowColor="rgba(15,23,42,0.16)" shadowBlur={18} shadowOffsetY={4} />
              {elements.filter((e) => e.visible !== false).map(rendreElement)}
              {survole ? <Rect x={survole.x} y={survole.y} width={survole.largeur} height={survole.hauteur} rotation={survole.rotation || 0} stroke="#0d99ff" strokeWidth={1.5 / echelle} listening={false} /> : null}
              {guides.x !== null ? <Line points={[guides.x, 0, guides.x, PAGE_H]} stroke="#f24822" strokeWidth={1 / echelle} listening={false} /> : null}
              {guides.y !== null ? <Line points={[0, guides.y, PAGE_W, guides.y]} stroke="#f24822" strokeWidth={1 / echelle} listening={false} /> : null}
              {marqueeRect ? <Rect x={marqueeRect.x} y={marqueeRect.y} width={marqueeRect.largeur} height={marqueeRect.hauteur} fill="rgb(13 153 255 / 10%)" stroke="#0d99ff" strokeWidth={1 / echelle} listening={false} /> : null}
              {badge ? <Group listening={false}><Rect x={badge.x} y={badge.y} width={badge.texte.length * 7.2 / echelle + 10 / echelle} height={18 / echelle} fill="#0d99ff" cornerRadius={3 / echelle} /><Text x={badge.x} y={badge.y} width={badge.texte.length * 7.2 / echelle + 10 / echelle} height={18 / echelle} text={badge.texte} fontSize={11 / echelle} fill="#ffffff" align="center" verticalAlign="middle" /></Group> : null}
              <Transformer ref={transformeur} rotateEnabled keepRatio={majEnfoncee} anchorSize={8} anchorCornerRadius={2} anchorFill="#ffffff" anchorStroke="#0d99ff" borderStroke="#0d99ff" borderStrokeWidth={1} boundBoxFunc={(vieux, nouveau) => (nouveau.width < 5 || nouveau.height < 5 ? vieux : nouveau)} />
            </Layer>
          </Stage>
          {editionTexte && (() => {
            const styleEdition = {
              left: editionTexte.x * echelle + pan.x,
              top: editionTexte.y * echelle + pan.y,
              width: editionTexte.largeur * echelle,
              height: editionTexte.hauteur * echelle,
              fontSize: editionTexte.taille * echelle,
              fontWeight: editionTexte.gras ? 700 : 400,
              fontStyle: editionTexte.italique ? "italic" : "normal",
              color: editionTexte.remplissage,
              textAlign: editionTexte.alignement || "center",
            };
            return (
              <textarea
                className="fgEditeurTexte"
                autoFocus
                value={editionTexte.texte}
                spellCheck={false}
                style={styleEdition}
                onChange={(e) => majSelection("texte", e.target.value)}
                onBlur={() => setEditionTexteId(null)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); setEditionTexteId(null); }
                }}
              />
            );
          })()}
          <div className="fgZoomPill">
            <button onClick={() => setZoom((z) => Math.max(10, z / 1.1))} title="Zoom arrière"><Icon fafa="faMinus" width={10} /></button>
            <button className="fgZoomValeur" onClick={ajusterEcran} title="Ajuster à l'écran (Ctrl+0)">{Math.round(zoom)}%</button>
            <button onClick={() => setZoom((z) => Math.min(400, z * 1.1))} title="Zoom avant"><Icon fafa="faPlus" width={10} /></button>
          </div>
        </main>

        <aside className="fgInspecteur">
          {multi ? (
            <div className="fgAligner fgAlignerHaut">
              <button title="Aligner à gauche" onClick={() => aligner("gauche")}><Icon fafa="faAlignLeft" width={12} /></button>
              <button title="Centrer horizontalement" onClick={() => aligner("centreH")}><Icon fafa="faAlignCenter" width={12} /></button>
              <button title="Aligner à droite" onClick={() => aligner("droite")}><Icon fafa="faAlignRight" width={12} /></button>
              <button title="Aligner en haut" onClick={() => aligner("haut")}><Icon fafa="faArrowUp" width={12} /></button>
              <button title="Centrer verticalement" onClick={() => aligner("centreV")}><Icon fafa="faArrowsUpDown" width={12} /></button>
              <button title="Aligner en bas" onClick={() => aligner("bas")}><Icon fafa="faArrowDown" width={12} /></button>
              <button title="Distribuer horizontalement" disabled={selectionIds.length < 3} onClick={() => distribuer("h")}><Icon fafa="faArrowsLeftRight" width={12} /></button>
              <button title="Distribuer verticalement" disabled={selectionIds.length < 3} onClick={() => distribuer("v")}><Icon fafa="faArrowsUpDown" width={12} /></button>
            </div>
          ) : null}
          {actif ? (
            <>
              <section className="fgSection">
                <h4>Position</h4>
                <div className="fgDeux">
                  <label className="fgChamp"><span>X</span><input type="number" value={Math.round(actif.x)} onChange={(e) => majSelection("x", Number(e.target.value))} /></label>
                  <label className="fgChamp"><span>Y</span><input type="number" value={Math.round(actif.y)} onChange={(e) => majSelection("y", Number(e.target.value))} /></label>
                  <label className="fgChamp"><span>L</span><input type="number" min="4" value={Math.round(actif.largeur)} onChange={(e) => majSelection("largeur", Math.max(4, Number(e.target.value)))} /></label>
                  <label className="fgChamp"><span>H</span><input type="number" min="4" value={Math.round(actif.hauteur)} onChange={(e) => majSelection("hauteur", Math.max(4, Number(e.target.value)))} /></label>
                </div>
                <div className="fgDeux">
                  <label className="fgChamp"><span>∠</span><input type="number" min="0" max="359" value={actif.rotation || 0} onChange={(e) => majSelection("rotation", Number(e.target.value))} /></label>
                  <label className="fgChamp"><span>Rayon</span><input type="number" min="0" value={actif.rayon || 0} onChange={(e) => majSelection("rayon", Math.max(0, Number(e.target.value)))} disabled={actif.type !== "rect"} /></label>
                </div>
              </section>
              <section className="fgSection">
                <h4>Apparence</h4>
                <div className="fgDeux">
                  <label className="fgChamp"><span>Opac.</span><input type="number" min="0" max="1" step=".05" value={actif.opacite ?? 1} onChange={(e) => majSelection("opacite", Math.max(0, Math.min(1, Number(e.target.value))))} /></label>
                  <label className="fgChamp"><span>Fusion</span>
                    <select value={actif.fusion || "normal"} onChange={(e) => majSelection("fusion", e.target.value)}>
                      <option value="normal">Normal</option><option value="multiply">Produit</option><option value="screen">Écran</option><option value="overlay">Incrustation</option><option value="darken">Assombrir</option><option value="lighten">Éclaircir</option>
                    </select>
                  </label>
                </div>
                {!multi ? (
                  <div className="fgDeux">
                    <label className="fgCase">Miroir H<input type="checkbox" checked={Boolean(actif.flipX)} onChange={(e) => majSelection("flipX", e.target.checked)} /></label>
                    <label className="fgCase">Miroir V<input type="checkbox" checked={Boolean(actif.flipY)} onChange={(e) => majSelection("flipY", e.target.checked)} /></label>
                  </div>
                ) : null}
              </section>
              {actif.type === "texte" ? (
                <section className="fgSection">
                  <h4>Texte</h4>
                  <label className="fgChamp"><span>Contenu</span><textarea value={actif.texte} onChange={(e) => majSelection("texte", e.target.value)} /></label>
                  <div className="fgDeux">
                    <label className="fgChamp"><span>Taille</span><input type="number" min="8" max="300" value={actif.taille} onChange={(e) => majSelection("taille", Number(e.target.value))} /></label>
                    <label className="fgChamp"><span>Aligner</span><select value={actif.alignement || "centre"} onChange={(e) => majSelection("alignement", e.target.value)}><option value="gauche">G</option><option value="centre">C</option><option value="droite">D</option></select></label>
                  </div>
                  <div className="fgTrois">
                    <label className="fgCase">Gras<input type="checkbox" checked={Boolean(actif.gras)} onChange={(e) => majSelection("gras", e.target.checked)} /></label>
                    <label className="fgCase">Italique<input type="checkbox" checked={Boolean(actif.italique)} onChange={(e) => majSelection("italique", e.target.checked)} /></label>
                  </div>
                </section>
              ) : null}
              <section className="fgSection">
                <h4>Remplissage</h4>
                {actif.type !== "ligne" ? (
                  <div className="fgLigneProp">
                    <input type="color" className="fgSwatch" value={actif.remplissage?.startsWith("#") ? actif.remplissage : "#d9d9d9"} onChange={(e) => majSelection("remplissage", e.target.value)} />
                    <input className="fgHex" value={actif.remplissage} onChange={(e) => { const valeur = e.target.value; if (/^#[0-9a-f]{6}$/i.test(valeur)) majSelection("remplissage", valeur); else e.target.value = actif.remplissage; }} spellCheck={false} />
                  </div>
                ) : null}
              </section>
              <section className="fgSection">
                <h4>Bordure</h4>
                <div className="fgLigneProp">
                  <input type="color" className="fgSwatch" value={actif.contour?.startsWith("#") ? actif.contour : "#151515"} onChange={(e) => majSelection("contour", e.target.value)} />
                  <input className="fgHex" value={actif.contour} onChange={(e) => { const valeur = e.target.value; if (/^#[0-9a-f]{6}$/i.test(valeur)) majSelection("contour", valeur); else e.target.value = actif.contour; }} spellCheck={false} />
                  <input type="number" className="fgNombre" min="0" max="40" value={actif.epaisseur || 0} title="Épaisseur" onChange={(e) => majSelection("epaisseur", Math.max(0, Number(e.target.value)))} />
                </div>
              </section>
              <section className="fgSection">
                <h4>Effets</h4>
                <label className="fgCase">Ombre portée<input type="checkbox" checked={Boolean(actif.ombre?.active)} onChange={(e) => majSelection("ombre", { couleur: "#000000", flou: 12, x: 0, y: 4, ...(actif.ombre || {}), active: e.target.checked })} /></label>
                {actif.ombre?.active ? (
                  <div className="fgDeux">
                    <label className="fgChamp"><span>Flou</span><input type="number" min="0" max="80" value={actif.ombre.flou} onChange={(e) => majSelection("ombre", { ...actif.ombre, flou: Math.max(0, Number(e.target.value)) })} /></label>
                    <label className="fgChamp"><span>Y</span><input type="number" value={actif.ombre.y} onChange={(e) => majSelection("ombre", { ...actif.ombre, y: Number(e.target.value) })} /></label>
                    <label className="fgChamp fgColonne"><span>Couleur</span><input type="color" value={actif.ombre.couleur} onChange={(e) => majSelection("ombre", { ...actif.ombre, couleur: e.target.value })} /></label>
                  </div>
                ) : null}
              </section>
              <section className="fgSection">
                <h4>Calque</h4>
                <div className="fgDeux">
                  <label className="fgCase">Verrouiller<input type="checkbox" checked={Boolean(actif.verrouille)} onChange={(e) => majSelection("verrouille", e.target.checked)} /></label>
                  <label className="fgCase">Visible<input type="checkbox" checked={actif.visible !== false} onChange={(e) => majSelection("visible", e.target.checked)} /></label>
                </div>
              </section>
              <section className="fgSection">
                <h4>Export</h4>
                <div className="fgDeux">
                  <label className="fgChamp"><span>Échelle</span>
                    <select value={echelleExport} onChange={(e) => setEchelleExport(Number(e.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={3}>3×</option></select>
                  </label>
                  <button className="fgExportBtn" onClick={exporterPNG}>Exporter PNG</button>
                </div>
              </section>
            </>
          ) : (
            <section className="fgSection">
              <h4>Page</h4>
              <label className="fgChamp"><span>Fond</span><input type="color" value={pageFond} onChange={(e) => setPageFond(e.target.value)} /></label>
              <div className="fgAide">
                <b>Raccourcis</b>
                <span>V déplacer · H main · R O T L S</span>
                <span>Espace + glisser — pan</span>
                <span>Alt + glisser — dupliquer</span>
                <span>Maj — carré / 45° / proportions</span>
                <span>Double-clic — éditer un texte</span>
                <span>Ctrl+C/V/X/D · Ctrl+Z/Y</span>
                <span>Ctrl+0 ajuster · Ctrl+1 — 100 %</span>
                <span>Flèches — nudge (Maj ×10)</span>
              </div>
            </section>
          )}
        </aside>
      </div>
    </ModuleWindow>
  );
}

export default FigmaPlusApp;

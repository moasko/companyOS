// Couche métier du document : création, conversion runtime ↔ modèle typé,
// duplication de page, validation. Fonctions pures, sans DOM.
import type { DesignDocument, DesignElement, DesignPage, Remplissage } from "../types/document.types";

export const nouvelId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const LARGEUR_DEFAUT = 1280;
const HAUTEUR_DEFAUT = 720;

export const creerPage = (nom: string, largeur = LARGEUR_DEFAUT, hauteur = HAUTEUR_DEFAUT): DesignPage => ({
  id: nouvelId(),
  name: nom,
  width: largeur,
  height: hauteur,
  background: { couleur: "#ffffff", transparent: true },
  elements: [],
  guides: { h: [], v: [] },
  hidden: false,
});

export const creerDocument = (nom: string, largeur = LARGEUR_DEFAUT, hauteur = HAUTEUR_DEFAUT): DesignDocument => {
  const page = creerPage("Scène 1", largeur, hauteur);
  const horodatage = new Date().toISOString();
  return {
    id: nouvelId(),
    name: nom,
    version: 1,
    width: largeur,
    height: hauteur,
    unit: "px",
    pages: [page],
    activePageId: page.id,
    createdAt: horodatage,
    updatedAt: horodatage,
  };
};

// ---- Conversions remplissage -------------------------------------------
const remplissageDepuisObjet = (objet: Record<string, any>): Remplissage => {
  if (objet.degrade?.actif) return { type: "degrade", angle: objet.degrade.angle || 0, depuis: objet.degrade.couleurA, vers: objet.degrade.couleurB };
  return { type: "uni", couleur: objet.couleur || "#000000" };
};

const remplissageVersObjet = (remplissage: Remplissage | undefined, defaut: string): Record<string, unknown> => {
  if (!remplissage || remplissage.type === "uni") return { couleur: remplissage?.couleur || defaut, degrade: { actif: false, angle: 90, couleurA: "#ffffff", couleurB: "#0d99ff" } };
  return { couleur: remplissage.depuis, degrade: { actif: true, angle: remplissage.angle, couleurA: remplissage.depuis, couleurB: remplissage.vers } };
};

const ALIGNEMENTS: Record<string, string> = { gauche: "left", centre: "center", droite: "right" };
const ALIGNEMENTS_INVERSE: Record<string, string> = { left: "gauche", center: "centre", right: "droite" };

// Champs runtime recopiés tels quels dans `extras` (pont sans perte).
// `ombre` y voyage volontairement : le type text ne la porte pas, et les
// types image/shape la réécrivent depuis leur champ typé au retour.
const CHAMPS_MAPPEES = new Set(["id", "nom", "type", "x", "y", "largeur", "hauteur", "rotation", "opacite", "visible", "verrouille", "parentId", "children", "sceneId", "forme", "couleur", "degrade", "texte", "police", "taille", "gras", "italique", "alignement", "interligne", "espacement", "souligne", "barre", "casse", "src", "retourneX", "retourneY", "filtres", "contour", "epaisseur", "rayon", "rayons", "motif", "fusion", "clipContent", "points", "ferme", "rempli", "couleurRempli"]);

const extrasDepuis = (objet: Record<string, any>): Record<string, unknown> => {
  const extras: Record<string, unknown> = {};
  for (const cle of Object.keys(objet)) if (!CHAMPS_MAPPEES.has(cle)) extras[cle] = objet[cle];
  return extras;
};

export function objetVersElement(objet: Record<string, any>): DesignElement {
  const base = {
    id: objet.id,
    name: objet.nom || "Élément",
    x: objet.x || 0,
    y: objet.y || 0,
    width: objet.largeur || 1,
    height: objet.hauteur || 1,
    rotation: objet.rotation || 0,
    opacity: objet.opacite ?? 1,
    visible: objet.visible !== false,
    locked: Boolean(objet.verrouille),
    parentId: objet.parentId ?? null,
    children: objet.children || [],
    extras: extrasDepuis(objet),
  };
  if (objet.type === "texte") {
    return { ...base, type: "text", content: objet.texte ?? "", fontFamily: objet.police || "Arial", fontSize: objet.taille || 24, bold: Boolean(objet.gras), italic: Boolean(objet.italique), align: (ALIGNEMENTS[objet.alignement] || "center") as "left" | "center" | "right", fill: remplissageDepuisObjet(objet), lineHeight: objet.interligne || 1.15, letterSpacing: objet.espacement || 0, underline: Boolean(objet.souligne), strike: Boolean(objet.barre), casse: objet.casse || "aucune" };
  }
  if (objet.type === "image") {
    return { ...base, type: "image", src: objet.src || "", fit: "fill" as const, flipX: Boolean(objet.retourneX), flipY: Boolean(objet.retourneY), filters: objet.filtres, shadow: objet.ombre?.active ? { couleur: objet.ombre.couleur, flou: objet.ombre.flou, x: objet.ombre.x, y: objet.ombre.y } : undefined, blendMode: objet.fusion };
  }
  if (objet.type === "forme" && objet.forme === "ligne") {
    return { ...base, type: "line", stroke: objet.contour || "#151515", strokeWidth: objet.epaisseur || 4 };
  }
  if (objet.type === "forme") {
    return { ...base, type: "shape", shape: objet.forme, fill: remplissageDepuisObjet(objet), stroke: objet.contour || "#151515", strokeWidth: objet.epaisseur || 0, cornerRadius: objet.rayon || 0, cornerRadii: objet.rayons, motif: objet.motif || "aucune", shadow: objet.ombre?.active ? { couleur: objet.ombre.couleur, flou: objet.ombre.flou, x: objet.ombre.x, y: objet.ombre.y } : undefined, blendMode: objet.fusion };
  }
  if (objet.type === "plume" || objet.type === "dessin") {
    return { ...base, type: "path", sousType: objet.type, stroke: objet.couleur || "#151515", strokeWidth: objet.epaisseur || 4, points: objet.points || [], ferme: Boolean(objet.ferme), rempli: Boolean(objet.rempli), couleurRempli: objet.couleurRempli };
  }
  return { ...base, type: "group" };
}

export function elementVersObjet(element: DesignElement): Record<string, any> {
  const commun = { id: element.id, nom: element.name, x: element.x, y: element.y, largeur: element.width, hauteur: element.height, rotation: element.rotation, opacite: element.opacity, visible: element.visible, verrouille: element.locked, parentId: element.parentId, children: element.children || [] };
  const extras = (element.extras || {}) as Record<string, any>;
  switch (element.type) {
    case "text": {
      const remplissage = remplissageVersObjet(element.fill, "#151515");
      return { ...extras, ...commun, type: "texte", texte: element.content, police: element.fontFamily, taille: element.fontSize, gras: element.bold, italique: element.italic, alignement: ALIGNEMENTS_INVERSE[element.align] || "centre", ...remplissage, interligne: element.lineHeight, espacement: element.letterSpacing, souligne: element.underline, barre: element.strike, casse: element.casse };
    }
    case "image":
      return { ...extras, ...commun, type: "image", src: element.src, retourneX: element.flipX, retourneY: element.flipY, filtres: element.filters, ombre: element.shadow ? { active: true, ...element.shadow } : undefined, fusion: element.blendMode };
    case "shape": {
      const remplissage = remplissageVersObjet(element.fill, "#D9D9D9");
      return { ...extras, ...commun, type: "forme", forme: element.shape, ...remplissage, contour: element.stroke, epaisseur: element.strokeWidth, rayon: element.cornerRadius, rayons: element.cornerRadii, motif: element.motif, ombre: element.shadow ? { active: true, ...element.shadow } : undefined, fusion: element.blendMode };
    }
    case "line":
      return { ...extras, ...commun, type: "forme", forme: "ligne", couleur: "transparent", contour: element.stroke, epaisseur: element.strokeWidth };
    case "path":
      return { ...extras, ...commun, type: element.sousType, couleur: element.stroke, epaisseur: element.strokeWidth, points: element.points, ferme: element.ferme, rempli: element.rempli, couleurRempli: element.couleurRempli };
    default:
      return { ...extras, ...commun, type: "group" };
  }
}

// ---- Pages & document ----------------------------------------------------
export function pageDepuisObjets(page: Record<string, any>): DesignPage {
  return {
    id: page.id,
    name: page.nom || "Scène",
    width: page.largeur || LARGEUR_DEFAUT,
    height: page.hauteur || HAUTEUR_DEFAUT,
    background: { couleur: page.fond || "#ffffff", transparent: page.fondTransparent !== false },
    elements: (page.objets || []).map(objetVersElement),
    guides: page.guides || { h: [], v: [] },
    hidden: Boolean(page.cachee),
  };
}

export function pageVersObjets(page: DesignPage): Record<string, any> {
  return {
    id: page.id,
    nom: page.name,
    largeur: page.width,
    hauteur: page.height,
    fond: page.background.couleur,
    fondTransparent: page.background.transparent,
    objets: page.elements.map(elementVersObjet),
    guides: page.guides,
    cachee: page.hidden,
  };
}

export function documentDepuisEtat(etat: { nom: string; pages: Record<string, any>[]; pageActive: string }): DesignDocument {
  const horodatage = new Date().toISOString();
  const premiere = etat.pages[0];
  return {
    id: nouvelId(),
    name: etat.nom || "Sans titre",
    version: 1,
    width: premiere?.largeur || LARGEUR_DEFAUT,
    height: premiere?.hauteur || HAUTEUR_DEFAUT,
    unit: "px",
    pages: etat.pages.map(pageDepuisObjets),
    activePageId: etat.pageActive,
    createdAt: horodatage,
    updatedAt: horodatage,
  };
}

export function documentVersEtat(document: DesignDocument): { nom: string; pages: Record<string, any>[]; pageActive: string } {
  return { nom: document.name, pages: document.pages.map(pageVersObjets), pageActive: document.activePageId };
}

// Duplication : nouveaux identifiants partout, relations parent/enfants et
// groupes remappées, rendu strictement identique.
export function dupliquerPage(page: DesignPage): DesignPage {
  const correspondances = new Map<string, string>();
  const copieElements = page.elements.map((element) => {
    const nouvel = structuredClone(element);
    const id = nouvelId();
    correspondances.set(element.id, id);
    return { ...nouvel, id } as DesignElement;
  });
  const relier = (element: DesignElement): DesignElement => ({
    ...element,
    parentId: element.parentId ? correspondances.get(element.parentId) || element.parentId : null,
    children: (element.children || []).map((enfant) => correspondances.get(enfant) || enfant),
    extras: element.extras ? { ...(element.extras as Record<string, any>), groupId: (element.extras as any).groupId ? correspondances.get((element.extras as any).groupId) || (element.extras as any).groupId : undefined } : element.extras,
  });
  return { ...structuredClone(page), id: nouvelId(), name: `${page.name} copie`, elements: copieElements.map(relier) };
}

// Validation défensive : structure minimale attendue, types de base.
export function validerDocument(valeur: unknown): DesignDocument | null {
  if (!valeur || typeof valeur !== "object") return null;
  const doc = valeur as Partial<DesignDocument>;
  if (typeof doc.id !== "string" || typeof doc.name !== "string" || doc.version !== 1) return null;
  if (!Array.isArray(doc.pages) || !doc.pages.length) return null;
  for (const page of doc.pages) {
    if (typeof page?.id !== "string" || !Array.isArray(page.elements)) return null;
    for (const element of page.elements) {
      if (typeof element?.id !== "string" || typeof element.type !== "string") return null;
      if (!["text", "image", "shape", "line", "path", "group"].includes(element.type)) return null;
    }
  }
  if (!doc.pages.some((page) => page.id === doc.activePageId)) return null;
  return doc as DesignDocument;
}

// Apparence personnalisée : fond d'écran et police de l'interface.
//
// Les deux sont des fichiers, donc ils passent par le cloud comme tout le
// reste de l'OS — ils apparaissent dans l'Explorateur et comptent dans le
// quota. Seule la *préférence* (quel fichier utiliser) est locale, rangée
// par espace de travail.

import store from "../reducers";
import { api, getToken } from "../api/client";
import { saveToCloud } from "./cloud";

export const DOSSIER_FONDS = "Fonds d'écran";
export const DOSSIER_POLICES = "Polices";

/// Piles de polices proposées d'office. « Système » laisse le navigateur
/// choisir la police native de la plateforme.
export const POLICES = [
  {
    id: "systeme",
    label: "Système",
    stack:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
  },
  { id: "inter", label: "Inter / Segoe", stack: '"Segoe UI", Inter, system-ui, sans-serif' },
  { id: "humaniste", label: "Humaniste", stack: 'Optima, Candara, "Trebuchet MS", sans-serif' },
  { id: "serif", label: "Serif", stack: 'Georgia, "Times New Roman", serif' },
  { id: "mono", label: "Monospace", stack: 'Consolas, "Cascadia Mono", "Courier New", monospace' },
];

/// L'espace de travail vient de la session, seule source fiable :
/// dépendre de l'état d'apparence créait un ordre d'initialisation où
/// tenantId pouvait être nul, et où toute préférence était silencieusement
/// perdue.
const tenantCourant = () => store.getState().session.tenant?.id || null;

const cle = (tenantId) => `appearance:${tenantId || "anonyme"}`;

export const lirePreferences = (tenantId) => {
  try {
    return JSON.parse(localStorage.getItem(cle(tenantId)) || "{}");
  } catch {
    return {};
  }
};

const ecrirePreferences = (tenantId, prefs) => {
  if (!tenantId) return;
  try {
    localStorage.setItem(cle(tenantId), JSON.stringify(prefs));
  } catch {
    /* quota navigateur plein : l'apparence par défaut reprendra la main */
  }
};

/// Télécharge un fichier du cloud et renvoie une URL d'objet.
const urlDuFichier = async (nodeId) => {
  const res = await fetch(api.downloadUrl(nodeId), {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
};

// --- Police ---------------------------------------------------------------

const NOM_POLICE = "CompanyOSUserFont";

/// Enregistre une police téléversée auprès du navigateur.
const chargerPolice = async (nodeId) => {
  const url = await urlDuFichier(nodeId);
  if (!url) return false;
  try {
    const face = new FontFace(NOM_POLICE, `url(${url})`);
    await face.load();
    document.fonts.add(face);
    return true;
  } catch {
    // Fichier illisible ou format refusé : on ne casse pas l'interface.
    URL.revokeObjectURL(url);
    return false;
  }
};

const appliquerPile = (stack) => {
  document.documentElement.style.setProperty("--ui-font", stack);
};

// --- Application ----------------------------------------------------------

/// Applique les préférences enregistrées. Appelée à l'ouverture de session.
export const appliquerApparence = async (tenantId) => {
  const prefs = lirePreferences(tenantId);
  store.dispatch({ type: "APPEARANCE_SET", payload: { ...prefs, tenantId } });

  // Police
  if (prefs.fontNodeId) {
    const ok = await chargerPolice(prefs.fontNodeId);
    appliquerPile(
      ok
        ? `"${NOM_POLICE}", ${POLICES[0].stack}`
        : prefs.fontStack || POLICES[0].stack,
    );
  } else {
    appliquerPile(prefs.fontStack || POLICES[0].stack);
  }

  // Fond d'écran
  if (prefs.wallNodeId) {
    const url = await urlDuFichier(prefs.wallNodeId);
    store.dispatch({ type: "APPEARANCE_WALL_URL", payload: url });
  } else {
    store.dispatch({ type: "APPEARANCE_WALL_URL", payload: null });
  }
};

/// Remet l'apparence par défaut à la déconnexion.
export const reinitialiserApparence = () => {
  appliquerPile(POLICES[0].stack);
  store.dispatch({ type: "APPEARANCE_RESET" });
};

// --- Actions déclenchées depuis les Paramètres ----------------------------

/// Importe une image comme fond d'écran : elle part dans le cloud puis
/// devient le fond courant.
export const importerFond = async (file) => {
  const node = await saveToCloud(file, file.name, { folder: DOSSIER_FONDS });
  await choisirFond(node.id);
  return node;
};

export const choisirFond = async (nodeId) => {
  const tenantId = tenantCourant();
  const prefs = { ...lirePreferences(tenantId), wallNodeId: nodeId };
  ecrirePreferences(tenantId, prefs);

  const url = nodeId ? await urlDuFichier(nodeId) : null;
  store.dispatch({ type: "APPEARANCE_SET", payload: { ...prefs, tenantId } });
  store.dispatch({ type: "APPEARANCE_WALL_URL", payload: url });
};

export const retirerFond = () => choisirFond(null);

/// Importe un fichier de police et l'applique.
export const importerPolice = async (file) => {
  const node = await saveToCloud(file, file.name, { folder: DOSSIER_POLICES });
  const tenantId = tenantCourant();

  const ok = await chargerPolice(node.id);
  if (!ok) {
    throw new Error("Police illisible — formats acceptés : ttf, otf, woff, woff2");
  }

  const prefs = {
    ...lirePreferences(tenantId),
    fontNodeId: node.id,
    fontName: file.name,
  };
  ecrirePreferences(tenantId, prefs);
  appliquerPile(`"${NOM_POLICE}", ${POLICES[0].stack}`);
  store.dispatch({ type: "APPEARANCE_SET", payload: { ...prefs, tenantId } });
  return node;
};

/// Revient à une pile de polices proposée.
export const choisirPolice = (id) => {
  const tenantId = tenantCourant();
  const police = POLICES.find((p) => p.id === id) || POLICES[0];
  const prefs = {
    ...lirePreferences(tenantId),
    fontStack: police.stack,
    fontId: police.id,
    fontNodeId: null,
    fontName: null,
  };
  ecrirePreferences(tenantId, prefs);
  appliquerPile(police.stack);
  store.dispatch({ type: "APPEARANCE_SET", payload: { ...prefs, tenantId } });
};

/// Liste les images déjà déposées dans le dossier des fonds d'écran.
export const listerFonds = async () => {
  const racine = await api.listFiles(null);
  const dossier = racine.find((n) => n.type === "FOLDER" && n.name === DOSSIER_FONDS);
  if (!dossier) return [];
  const contenu = await api.listFiles(dossier.id);
  return contenu.filter((n) => n.type === "FILE" && n.mimeType?.startsWith("image/"));
};

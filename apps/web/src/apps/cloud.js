// Point de passage unique des fichiers dans CompanyOS.
//
// RÈGLE : tout fichier importé ou produit par une app de l'OS atterrit dans
// le cloud de l'espace de travail, donc dans l'Explorateur. Aucune app ne
// garde ses fichiers pour elle, et aucune ne s'arrête à un téléchargement
// navigateur — sinon le fichier sort du produit : invisible pour les
// collègues et non décompté du quota facturé.
//
//   import { saveToCloud } from "../../cloud";
//   await saveToCloud(blob, "facture.pdf", { folder: "Facturation" });

import store from "../reducers";
import { api } from "../api/client";
import { requestSave } from "./saveRequest";
import { notifier } from "./notifications";

/// Trouve le dossier `name` à la racine du cloud, ou le crée.
export const ensureRootFolder = async (name) => {
  const root = await api.listFiles(null);
  const found = root.find((n) => n.type === "FOLDER" && n.name === name);
  if (found) return found.id;

  try {
    const created = await api.createFolder(name, null);
    return created.id;
  } catch {
    // Course entre deux enregistrements simultanés : on relit.
    const retry = await api.listFiles(null);
    return retry.find((n) => n.type === "FOLDER" && n.name === name)?.id || null;
  }
};

/// Un nom déjà pris dans le dossier renvoie un conflit côté API.
/// On suffixe alors « (2) », « (3) »… comme le ferait un explorateur.
const uniqueName = (name, taken) => {
  if (!taken.has(name)) return name;

  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";

  let i = 2;
  while (taken.has(`${base} (${i})${ext}`)) i += 1;
  return `${base} (${i})${ext}`;
};

/// Écrit réellement le fichier à l'emplacement donné.
const putAt = async (blob, filename, parentId) => {
  const siblings = await api.listFiles(parentId);
  const name = uniqueName(filename, new Set(siblings.map((n) => n.name)));

  const file = new File([blob], name, {
    type: blob.type || "application/octet-stream",
  });

  const node = await api.uploadFile(file, parentId);

  // L'Explorateur se rafraîchit, le quota affiché suit.
  store.dispatch({ type: "CLOUD_TOUCH" });

  // Tout fichier écrit dans le cloud se signale : c'est la trace qui permet
  // de retrouver un export généré par une app sans savoir où il est allé.
  notifier({
    titre: "Fichier enregistré",
    message: `« ${name} » est dans votre cloud.`,
    app: "Explorateur",
    ton: "success",
  });
  try {
    const usage = await api.usage();
    store.dispatch({ type: "SESSION_USAGE", payload: { usedBytes: usage.usedBytes } });
  } catch {
    /* l'affichage du quota se remettra à jour à la prochaine lecture */
  }

  return node;
};

/// Enregistrement direct, sans question : le fichier atterrit dans le
/// dossier du module. Réservé aux écritures automatiques.
export const saveToCloud = async (blob, filename, { folder } = {}) => {
  const parentId = folder ? await ensureRootFolder(folder) : null;
  return putAt(blob, filename, parentId);
};

/// Enregistrement demandé par l'utilisateur : on ouvre le cloud pour qu'il
/// choisisse le dossier et le nom, comme dans l'Explorateur.
/// Renvoie le nœud créé, ou null s'il annule.
export const saveAs = async (blob, filename, { folder } = {}) => {
  const choice = await requestSave(filename, folder);
  if (!choice) return null;
  return putAt(blob, choice.name, choice.parentId);
};

/// Convertit une data-URL (canvas, QR, graphique…) en Blob.
export const dataUrlToBlob = async (dataUrl) => (await fetch(dataUrl)).blob();

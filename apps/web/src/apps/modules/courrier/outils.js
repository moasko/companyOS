// Petits outils de l'app Courrier, sans React.

import { api } from "../../../api/client";
import { nomAffiche } from "@companyos/shared/courrier";

/// Initiales d'une personne : « Awa Koné » → « AK », sinon l'adresse.
export const initiales = ({ nom, email } = {}) => {
  const n = nomAffiche({ nom, email });
  const mots = n.split(/\s+/).filter(Boolean);
  const l = mots.length >= 2 ? mots[0][0] + mots[1][0] : n.slice(0, 2);
  return (l || "?").toUpperCase();
};

/// Couleur stable par adresse (même personne, même pastille).
export const teinte = (email = "") => {
  let h = 0;
  for (const c of String(email).toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 52% 46%)`;
};

/// Dossiers de la messagerie, dans l'ordre du volet.
export const DOSSIERS = [
  { id: "reception", libelle: "Réception", icone: "faInbox" },
  { id: "suivis", libelle: "Suivis", icone: "faStar", vue: true },
  { id: "envoyes", libelle: "Envoyés", icone: "faPaperPlane" },
  { id: "brouillons", libelle: "Brouillons", icone: "faFileLines" },
  { id: "programmes", libelle: "Programmés", icone: "faClock" },
  { id: "archives", libelle: "Archives", icone: "faBoxArchive" },
  { id: "indesirables", libelle: "Indésirables", icone: "faBan" },
  { id: "corbeille", libelle: "Corbeille", icone: "faTrashCan" },
];

/// Raccourcis d'envoi programmé.
export const PROGRAMMATIONS = (maintenant = new Date()) => {
  const a = (jours, heure) => {
    const d = new Date(maintenant);
    d.setDate(d.getDate() + jours);
    d.setHours(heure, 0, 0, 0);
    return d;
  };
  const lundi = (() => {
    const d = new Date(maintenant);
    const ecart = ((8 - d.getDay()) % 7) || 7;
    d.setDate(d.getDate() + ecart);
    d.setHours(8, 0, 0, 0);
    return d;
  })();
  const liste = [
    { libelle: "Demain matin", date: a(1, 8) },
    { libelle: "Demain après-midi", date: a(1, 14) },
    { libelle: "Lundi matin", date: lundi },
  ];
  if (maintenant.getHours() < 16) liste.unshift({ libelle: "Cet après-midi", date: a(0, 17) });
  return liste;
};

export const quand = (d) =>
  new Date(d).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const EMOJIS = "😀 😊 🙂 😉 😍 🤝 👍 👏 🙏 💪 🎉 ✅ ❌ ⚠️ 📎 📅 📌 📞 💡 🔥 🚀 ⭐ ❤️ 😅 🤔 😮 😢 👀 ✍️ 📄".split(" ");

/// Le dossier « Courrier › Pièces envoyées » du Cloud, créé au besoin :
/// un fichier joint depuis l'ordinateur y est d'abord rangé, puis joint.
let dossierEnvoi = null;
export const dossierPiecesEnvoyees = async () => {
  if (dossierEnvoi) return dossierEnvoi;
  const trouverOuCreer = async (parentId, nom) => {
    const liste = await api.listFiles(parentId);
    const d = liste.find((n) => n.type === "FOLDER" && n.name === nom);
    if (d) return d.id;
    try {
      return (await api.createFolder(nom, parentId)).id;
    } catch {
      return (await api.listFiles(parentId)).find((n) => n.type === "FOLDER" && n.name === nom)?.id;
    }
  };
  const racine = await trouverOuCreer(null, "Courrier");
  dossierEnvoi = await trouverOuCreer(racine, "Pièces envoyées");
  return dossierEnvoi;
};

/// Un nœud Cloud minimal pour les visionneuses (Photos, PDF…) à partir
/// d'une pièce jointe.
export const noeudDePiece = (p) => ({ id: p.fsNodeId, name: p.nom, type: "FILE", mimeType: p.type, size: p.taille });

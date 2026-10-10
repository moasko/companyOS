// Règles de l'Explorateur, sans React ni réseau : index de l'arborescence,
// chemins, tri, recherche, libellés. Testées dans test/explorateur.test.js.

export const RACINE = { id: null, name: "Cloud" };

/// L'arborescence à plat (GET /api/files/arborescence) rangée pour les
/// questions que pose l'Explorateur : enfants d'un dossier, parent d'un
/// élément, chemin.
export const indexer = (noeuds = []) => {
  const parId = new Map();
  const enfants = new Map();
  for (const n of noeuds) {
    parId.set(n.id, n);
    const cle = n.parentId ?? null;
    if (!enfants.has(cle)) enfants.set(cle, []);
    enfants.get(cle).push(n);
  }
  return { parId, enfants };
};

export const dossiersDe = (index, parentId) =>
  (index.enfants.get(parentId ?? null) || []).filter((n) => n.type === "FOLDER").sort((a, b) => a.name.localeCompare(b.name, "fr"));

/// Le fil d'Ariane d'un dossier : [Cloud, …ancêtres, dossier].
export const cheminDe = (index, id, racine = RACINE) => {
  const chemin = [];
  const vus = new Set();
  let n = id ? index.parId.get(id) : null;
  while (n && !vus.has(n.id)) {
    vus.add(n.id);
    chemin.unshift({ id: n.id, name: n.name });
    n = n.parentId ? index.parId.get(n.parentId) : null;
  }
  return [racine, ...chemin];
};

/// « Cloud › Documents › 2026 » — l'emplacement d'un élément.
export const emplacementDe = (index, node, racine = RACINE) =>
  cheminDe(index, node.parentId ?? null, racine)
    .map((e) => e.name)
    .join(" › ");

/// `cible` est-il `dossier` lui-même ou l'un de ses descendants ?
/// (déplacer un dossier dans sa propre descendance le détacherait de l'arbre)
export const dansLaDescendance = (index, dossierId, cibleId) => {
  let n = cibleId ? index.parId.get(cibleId) : null;
  const vus = new Set();
  while (n && !vus.has(n.id)) {
    if (n.id === dossierId) return true;
    vus.add(n.id);
    n = n.parentId ? index.parId.get(n.parentId) : null;
  }
  return false;
};

const sansAccents = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/// Recherche par nom dans tout le Cloud, accents et casse ignorés ; les
/// noms qui commencent par la saisie d'abord.
export const rechercher = (noeuds, saisie, limite = 300) => {
  const q = sansAccents(saisie).trim();
  if (!q) return [];
  const mots = q.split(/\s+/);
  return noeuds
    .filter((n) => {
      const nom = sansAccents(n.name);
      return mots.every((m) => nom.includes(m));
    })
    .sort((a, b) => {
      const pa = sansAccents(a.name).startsWith(q) ? 0 : 1;
      const pb = sansAccents(b.name).startsWith(q) ? 0 : 1;
      return pa - pb || a.name.localeCompare(b.name, "fr");
    })
    .slice(0, limite);
};

export const extension = (nom) => {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(nom || ""));
  return m ? m[1].toLowerCase() : "";
};

const TYPES = {
  pdf: "Document PDF",
  doc: "Document Word",
  docx: "Document Word",
  odt: "Document texte",
  txt: "Texte",
  md: "Texte Markdown",
  rtf: "Document RTF",
  xls: "Classeur Excel",
  xlsx: "Classeur Excel",
  ods: "Classeur",
  csv: "Fichier CSV",
  ppt: "Présentation PowerPoint",
  pptx: "Présentation PowerPoint",
  odp: "Présentation",
  png: "Image PNG",
  jpg: "Image JPEG",
  jpeg: "Image JPEG",
  gif: "Image GIF",
  webp: "Image WebP",
  svg: "Image SVG",
  heic: "Photo HEIC",
  mp3: "Audio MP3",
  wav: "Audio WAV",
  m4a: "Audio",
  ogg: "Audio",
  mp4: "Vidéo MP4",
  mov: "Vidéo",
  webm: "Vidéo WebM",
  zip: "Archive ZIP",
  rar: "Archive",
  "7z": "Archive",
  json: "Données JSON",
  xml: "Données XML",
  html: "Page web",
  js: "Code JavaScript",
  py: "Code Python",
};

export const typeLisible = (node) => {
  if (node.type === "FOLDER") return "Dossier";
  const ext = extension(node.name);
  return TYPES[ext] || (ext ? `Fichier ${ext.toUpperCase()}` : "Fichier");
};

export const tailleLisible = (octets) => {
  if (octets == null || octets === "") return "";
  const n = Number(octets);
  if (n < 1024) return `${n} o`;
  const unites = ["Ko", "Mo", "Go", "To"];
  let v = n;
  let u = -1;
  do {
    v /= 1024;
    u += 1;
  } while (v >= 1024 && u < unites.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : 1).replace(".", ",")} ${unites[u]}`;
};

/// « aujourd'hui 14:32 », « hier 09:10 », sinon la date courte.
export const dateLisible = (iso, maintenant = new Date()) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const jour = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(maintenant) - jour(d)) / 86400000);
  const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (ecart === 0) return `aujourd'hui ${heure}`;
  if (ecart === 1) return `hier ${heure}`;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: d.getFullYear() === maintenant.getFullYear() ? undefined : "numeric" });
};

export const CLES_TRI = ["nom", "date", "type", "taille"];

/// Tri : dossiers toujours en tête, puis la clé choisie ; à égalité, le nom.
export const trier = (nodes, { cle = "nom", sens = "asc" } = {}) => {
  const s = sens === "desc" ? -1 : 1;
  const valeur = {
    nom: (n) => n.name,
    date: (n) => new Date(n.updatedAt || 0).getTime(),
    type: (n) => typeLisible(n),
    taille: (n) => Number(n.size || 0),
  }[cle] || ((n) => n.name);
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === "FOLDER" ? -1 : 1;
    const va = valeur(a);
    const vb = valeur(b);
    const c = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "fr", { numeric: true });
    return c * s || a.name.localeCompare(b.name, "fr", { numeric: true });
  });
};

// ---- Réglages personnels (synchronisés entre appareils) --------------------
//
// Une clé de localStorage reprise par src/apps/preferences.js : la vue,
// le tri et les favoris suivent la personne d'un appareil à l'autre.

export const CLE_REGLAGES = "companyos-explorateur";
const DEFAUT = { vue: "grille", tri: { cle: "nom", sens: "asc" }, favoris: [], details: false };

export const lireReglages = (stockage = globalThis.localStorage) => {
  try {
    const brut = JSON.parse(stockage?.getItem(CLE_REGLAGES) || "{}");
    return {
      ...DEFAUT,
      ...brut,
      tri: CLES_TRI.includes(brut?.tri?.cle) ? { cle: brut.tri.cle, sens: brut.tri.sens === "desc" ? "desc" : "asc" } : DEFAUT.tri,
      favoris: Array.isArray(brut.favoris) ? brut.favoris.filter((f) => f && f.id && f.name).slice(0, 50) : [],
    };
  } catch {
    return { ...DEFAUT };
  }
};

export const ecrireReglages = (reglages, stockage = globalThis.localStorage) => {
  try {
    stockage?.setItem(CLE_REGLAGES, JSON.stringify(reglages));
  } catch {
    // Stockage plein ou refusé : le réglage vaut pour la session.
  }
};

/// Fichiers d'un glisser-déposer, dossiers compris (API « entries » des
/// navigateurs) : rend [{ fichier, chemin: ["Dossier", "Sous-dossier"] }].
export const lireDepot = async (dataTransfer) => {
  const items = [...(dataTransfer?.items || [])];
  const entrees = items.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entrees.length) return [...(dataTransfer?.files || [])].map((fichier) => ({ fichier, chemin: [] }));
  const sortie = [];
  const parcourir = async (entree, chemin) => {
    if (entree.isFile) {
      const fichier = await new Promise((ok, ko) => entree.file(ok, ko));
      sortie.push({ fichier, chemin });
    } else if (entree.isDirectory) {
      const lecteur = entree.createReader();
      // readEntries rend les entrées par paquets : on lit jusqu'au bout.
      for (;;) {
        const lot = await new Promise((ok, ko) => lecteur.readEntries(ok, ko));
        if (!lot.length) break;
        for (const e of lot) await parcourir(e, [...chemin, entree.name]);
      }
    }
  };
  for (const e of entrees) await parcourir(e, []);
  return sortie;
};

/// Fichiers choisis avec « Importer un dossier » (webkitRelativePath).
export const lireDossierChoisi = (fichiers) =>
  [...(fichiers || [])].map((fichier) => {
    const morceaux = String(fichier.webkitRelativePath || fichier.name).split("/");
    return { fichier, chemin: morceaux.slice(0, -1) };
  });

/// Tous les descendants d'un dossier (`null` = tout le Cloud).
export const descendants = (index, dossierId) => {
  const sortie = [];
  const pile = [dossierId ?? null];
  const vus = new Set();
  while (pile.length) {
    const id = pile.pop();
    if (vus.has(id)) continue;
    vus.add(id);
    for (const n of index.enfants.get(id) || []) {
      sortie.push(n);
      if (n.type === "FOLDER") pile.push(n.id);
    }
  }
  return sortie;
};

/// Poids et contenu d'un dossier, sous-dossiers compris.
export const contenuDossier = (index, dossierId) =>
  descendants(index, dossierId).reduce(
    (t, n) =>
      n.type === "FOLDER"
        ? { ...t, dossiers: t.dossiers + 1 }
        : { ...t, fichiers: t.fichiers + 1, octets: t.octets + Number(n.size || 0) },
    { octets: 0, fichiers: 0, dossiers: 0 },
  );

/// « Nouveau dossier », sinon « Nouveau dossier (2) », (3)… — l'extension
/// reste à la fin : « Nouveau document (2).txt ».
export const nomUnique = (noms, voulu) => {
  const pris = new Set([...noms].map((n) => String(n).toLowerCase()));
  if (!pris.has(voulu.toLowerCase())) return voulu;
  const ext = extension(voulu);
  const base = ext ? voulu.slice(0, -(ext.length + 1)) : voulu;
  for (let i = 2; i < 10_000; i++) {
    const nom = `${base} (${i})${ext ? `.${ext}` : ""}`;
    if (!pris.has(nom.toLowerCase())) return nom;
  }
  return `${base} ${Date.now()}${ext ? `.${ext}` : ""}`;
};

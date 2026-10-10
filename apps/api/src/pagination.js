/// Lecture page par page des listes de fiches (/api/records/…).
///
/// Une liste n'est plus tronquée en silence à 500 fiches : la réponse dit
/// s'il en reste, et où reprendre (en-tête `X-Next-Cursor`). Le curseur
/// désigne la dernière fiche reçue — (createdAt, id), l'ordre de la liste —
/// et non un numéro de page : une fiche créée entre deux lectures ne fait
/// ni doublon ni trou.
///
/// Ce fichier ne touche pas la base : il valide ce que le client envoie.

export const LIMITE_DEFAUT = 500;
export const LIMITE_MAX = 1000;
const FILTRE_CLES_MAX = 5;
const RECHERCHE_MAX = 100;

export const ENTETE_SUITE = "X-Next-Cursor";

export class ErreurPagination extends Error {}

export const lireLimite = (brut) => {
  if (brut === undefined || brut === "") return LIMITE_DEFAUT;
  const n = Number(brut);
  if (!Number.isInteger(n) || n < 1) throw new ErreurPagination("`limit` doit être un entier positif");
  return Math.min(n, LIMITE_MAX);
};

/// Le curseur est opaque pour le client : base64url de « date|id ». La date
/// est le texte exact renvoyé par PostgreSQL, pour comparer sans
/// conversion de fuseau ni perte de précision.
export const encoderCurseur = (createdAt, id) =>
  Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");

const DATE_PG = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export const lireCurseur = (brut) => {
  if (brut === undefined || brut === "") return null;
  if (typeof brut !== "string" || brut.length > 200) throw new ErreurPagination("Curseur invalide");
  const texte = Buffer.from(brut, "base64url").toString("utf8");
  const i = texte.lastIndexOf("|");
  const createdAt = texte.slice(0, i);
  const id = texte.slice(i + 1);
  if (i < 0 || !DATE_PG.test(createdAt) || !ID.test(id)) throw new ErreurPagination("Curseur invalide");
  return { createdAt, id };
};

/// Recherche plein texte, simple : une sous-chaîne, sans tenir compte de
/// la casse, n'importe où dans la fiche.
export const lireRecherche = (brut) => {
  if (brut === undefined || brut === "") return null;
  if (typeof brut !== "string") throw new ErreurPagination("`q` doit être un texte");
  const q = brut.trim().slice(0, RECHERCHE_MAX);
  if (!q) return null;
  // Les jokers de LIKE sont cherchés pour eux-mêmes.
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
};

/// Filtre d'égalité sur les champs de premier niveau :
///   filter={"etape":"gagne","responsableId":"u1"}
/// Comparaison en texte : 3 et "3" se valent, comme dans un formulaire.
const CLE = /^[A-Za-z0-9_]{1,64}$/;

export const lireFiltre = (brut) => {
  if (brut === undefined || brut === "") return [];
  let objet;
  try {
    objet = typeof brut === "string" ? JSON.parse(brut) : brut;
  } catch {
    throw new ErreurPagination("`filter` doit être un objet JSON");
  }
  if (!objet || typeof objet !== "object" || Array.isArray(objet)) {
    throw new ErreurPagination("`filter` doit être un objet JSON");
  }
  const paires = Object.entries(objet);
  if (paires.length > FILTRE_CLES_MAX) {
    throw new ErreurPagination(`\`filter\` : ${FILTRE_CLES_MAX} champs au plus`);
  }
  return paires.map(([cle, valeur]) => {
    if (!CLE.test(cle)) throw new ErreurPagination(`Champ de filtre invalide : ${cle}`);
    if (valeur === null || !["string", "number", "boolean"].includes(typeof valeur)) {
      throw new ErreurPagination(`Valeur de filtre invalide pour ${cle}`);
    }
    return [cle, String(valeur)];
  });
};

/// Coupe une page au budget d'octets : les fiches volumineuses (classeurs,
/// campagnes) ne doivent pas faire charger des gigaoctets d'un coup. Au
/// moins une fiche part toujours, sinon la lecture n'avancerait plus.
///
/// `lignes` : { id, createdAt, taille } dans l'ordre de la liste, avec une
/// ligne de plus que la limite si la base en avait davantage.
export const couperPage = (lignes, limite, budget) => {
  const gardees = [];
  let total = 0;
  for (const l of lignes.slice(0, limite)) {
    total += Number(l.taille) || 0;
    if (total > budget && gardees.length) break;
    gardees.push(l);
  }
  const reste = lignes.length > gardees.length;
  const derniere = gardees.at(-1);
  return {
    ids: gardees.map((l) => l.id),
    suite: reste && derniere ? encoderCurseur(derniere.createdAt, derniere.id) : null,
  };
};

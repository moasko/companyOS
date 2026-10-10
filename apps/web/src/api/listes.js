// Les listes de fiches (/api/records/…) : lues en entier, page par page,
// et partagées entre les applications le temps de quelques secondes.
//
// Le serveur ne rend plus qu'une page à la fois (voir apps/api/src/
// pagination.js) et dit où reprendre ; ce fichier enchaîne les pages, de
// sorte qu'une application qui demande « les clients » les reçoit tous,
// et non les 500 plus récents comme avant.
//
// Le cache évite le même aller-retour fait trois fois à la suite : le CRM,
// la Facturation et la recherche globale lisent les clients à l'ouverture.
// Deux demandes simultanées n'en font qu'une ; une écriture dans une
// collection oublie aussitôt ce qu'on en savait.
//
// Aucune dépendance au navigateur : testé dans test/listes.test.js.

export const TAILLE_PAGE = 1000;
/// Garde-fou : au-delà, l'application lit trop pour un navigateur et doit
/// passer à la lecture page par page (`api.records.page`).
export const PAGES_MAX = 100;
export const DUREE_CACHE_MS = 10_000;

/// Enchaîne les pages. `lirePage(curseur)` rend { fiches, suite }.
export const lireToutesLesPages = async (lirePage, { pagesMax = PAGES_MAX } = {}) => {
  const fiches = [];
  let curseur = null;
  for (let n = 0; n < pagesMax; n += 1) {
    const page = await lirePage(curseur);
    fiches.push(...page.fiches);
    if (!page.suite || page.suite === curseur) return fiches;
    curseur = page.suite;
  }
  console.warn(`Liste tronquée à ${fiches.length} fiches : passez à la lecture page par page.`);
  return fiches;
};

/// `charger(module, collection, options)` fait la vraie lecture.
export const creerCacheListes = ({ charger, dureeMs = DUREE_CACHE_MS, maintenant = () => Date.now() }) => {
  const entrees = new Map();
  let generation = 0;

  const cle = (module, collection, options) =>
    `${module}/${collection}?${options ? JSON.stringify(options) : ""}`;

  return {
    async lire(module, collection, options) {
      const k = cle(module, collection, options);
      const e = entrees.get(k);
      if (e && (e.enCours || maintenant() - e.le < dureeMs)) {
        // Copie du tableau : un appelant qui trie sa liste ne trie pas
        // celle des autres.
        return [...(await e.promesse)];
      }
      const gen = generation;
      const entree = { le: maintenant(), enCours: true, promesse: null };
      entree.promesse = charger(module, collection, options).then(
        (liste) => {
          entree.enCours = false;
          entree.le = maintenant();
          // Une écriture est passée pendant la lecture : ce résultat est
          // peut-être déjà périmé, on ne le garde pas.
          if (gen !== generation && entrees.get(k) === entree) entrees.delete(k);
          return liste;
        },
        (err) => {
          if (entrees.get(k) === entree) entrees.delete(k);
          throw err;
        },
      );
      entrees.set(k, entree);
      return [...(await entree.promesse)];
    },

    /// Après une écriture : toutes les lectures de cette collection (avec
    /// ou sans filtre) sont à refaire.
    invalider(module, collection) {
      generation += 1;
      const prefixe = `${module}/${collection}?`;
      for (const k of entrees.keys()) if (k.startsWith(prefixe)) entrees.delete(k);
    },

    /// Déconnexion, changement d'espace : rien ne doit survivre.
    vider() {
      generation += 1;
      entrees.clear();
    },
  };
};

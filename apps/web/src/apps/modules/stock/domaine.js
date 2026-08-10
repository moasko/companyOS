// Règles métier du stock, en fonctions pures.
//
// Rien ici ne connaît React ni l'API : on entre des enregistrements, on
// sort des nombres et des arbres. C'est ce qui permet de raisonner sur les
// quantités sans ouvrir l'application.
//
// PRINCIPE CENTRAL — le stock n'est jamais stocké.
//
// Aucun champ « quantité » ne vit sur un article. Le niveau se déduit
// toujours de la somme des mouvements. Un compteur entretenu à la main
// finit par diverger de son historique le jour où une écriture échoue à
// moitié ; une somme, jamais.

export const SENS = {
  entree: { label: "Entrée", signe: 1, icone: "faArrowDown", ton: "ok" },
  sortie: { label: "Sortie", signe: -1, icone: "faArrowUp", ton: "bad" },
  // L'inventaire ne s'ajoute pas : il **impose** le niveau constaté. C'est
  // le seul mouvement qui écrase l'histoire plutôt que de la prolonger,
  // parce qu'un comptage physique fait autorité sur tous les calculs.
  inventaire: { label: "Inventaire", signe: 0, icone: "faClipboardCheck", ton: "info" },
};

export const UNITES = [
  "pièce",
  "kg",
  "g",
  "litre",
  "ml",
  "carton",
  "sac",
  "mètre",
  "paquet",
];

/// Ordre chronologique stable.
///
/// Deux mouvements saisis le même jour n'ont pas d'heure : on départage
/// par la date de création, qui, elle, est à la milliseconde. Sans ce
/// second critère, un inventaire et une sortie du même jour pourraient
/// s'appliquer dans un ordre différent d'un rendu à l'autre — et le stock
/// changerait tout seul à l'écran.
const chronologie = (a, b) => {
  const da = a.data.date || a.createdAt;
  const db = b.data.date || b.createdAt;
  if (da !== db) return da < db ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : 1;
};

/// Niveau de stock de chaque article : { [articleId]: quantité }.
export const niveaux = (mouvements) => {
  const totaux = {};
  for (const m of [...mouvements].sort(chronologie)) {
    const id = m.data.articleId;
    const q = Number(m.data.quantite) || 0;
    if (m.data.sens === "inventaire") totaux[id] = q;
    else totaux[id] = (totaux[id] || 0) + q * (SENS[m.data.sens]?.signe ?? 0);
  }
  return totaux;
};

/// Prix moyen pondéré d'un article.
///
/// On ne valorise pas au dernier prix d'achat : dans une entreprise qui
/// achète le même produit à des prix différents — ce qui est la règle, pas
/// l'exception — le dernier prix donne une valeur de stock fausse dès la
/// deuxième livraison. Le PMP répond à « combien m'a coûté ce que j'ai
/// encore en rayon ».
///
/// Les entrées sans prix saisi retombent sur le prix d'achat de la fiche :
/// mieux vaut une valorisation approchée qu'un stock compté à zéro franc.
export const pmp = (article, mouvements) => {
  let quantite = 0;
  let valeur = 0;

  for (const m of mouvements.filter((x) => x.data.articleId === article.id)) {
    if (m.data.sens !== "entree") continue;
    const q = Number(m.data.quantite) || 0;
    const pu = Number(m.data.prixUnitaire) || Number(article.data.prixAchat) || 0;
    quantite += q;
    valeur += q * pu;
  }

  if (!quantite) return Number(article.data.prixAchat) || 0;
  return valeur / quantite;
};

/// État d'un article, du plus grave au plus banal.
export const etat = (stock, seuil) => {
  const s = Number(stock) || 0;
  const seuilN = Number(seuil) || 0;
  if (s <= 0) return { id: "rupture", label: "Rupture", ton: "bad" };
  if (seuilN && s <= seuilN) return { id: "alerte", label: "Sous le seuil", ton: "warn" };
  return { id: "ok", label: "En stock", ton: "ok" };
};

// ---------------------------------------------------------------------------
// Catégories
// ---------------------------------------------------------------------------
//
// Catégories et sous-catégories sont une seule et même chose : une
// catégorie avec un parent est une sous-catégorie. Deux collections
// séparées auraient interdit un troisième niveau le jour où une entreprise
// en a besoin, et obligé à écrire deux fois chaque traitement.

/// Arbre à partir de la liste plate. Les orphelins — parent supprimé entre
/// deux chargements — remontent à la racine plutôt que de disparaître.
export const arbre = (categories) => {
  const par = new Map(categories.map((c) => [c.id, { ...c, enfants: [] }]));
  const racines = [];

  for (const noeud of par.values()) {
    const parent = noeud.data.parentId ? par.get(noeud.data.parentId) : null;
    if (parent && parent.id !== noeud.id) parent.enfants.push(noeud);
    else racines.push(noeud);
  }

  // Un cycle — A rangée sous B, B rangée sous A — ne produit aucune racine :
  // ses membres se pointent l'un l'autre et l'arbre les perdrait tous les
  // deux. On rattache donc à la racine tout ce qu'aucune racine n'atteint.
  // Une donnée abîmée doit rester visible et corrigeable, pas s'évaporer.
  const atteints = new Set();
  const descendre = (noeud) => {
    if (atteints.has(noeud.id)) return;
    atteints.add(noeud.id);
    noeud.enfants.forEach(descendre);
  };
  racines.forEach(descendre);

  for (const noeud of par.values()) {
    if (atteints.has(noeud.id)) continue;
    const parent = par.get(noeud.data.parentId);
    if (parent) parent.enfants = parent.enfants.filter((e) => e.id !== noeud.id);
    racines.push(noeud);
    descendre(noeud);
  }

  const trier = (liste, vus = new Set()) => {
    liste.sort((a, b) =>
      (a.data.nom || "").localeCompare(b.data.nom || "", "fr", { sensitivity: "base" }),
    );
    liste.forEach((n) => {
      if (vus.has(n.id)) {
        n.enfants = [];
        return;
      }
      vus.add(n.id);
      trier(n.enfants, vus);
    });
    return liste;
  };

  return trier(racines);
};

/// Tous les identifiants d'une branche, la racine comprise. Sélectionner
/// « Alimentaire » doit montrer aussi ce qui est rangé dans « Boissons ».
export const branche = (categories, id) => {
  if (!id) return [];
  const enfantsDe = new Map();
  for (const c of categories) {
    const p = c.data.parentId || "";
    if (!enfantsDe.has(p)) enfantsDe.set(p, []);
    enfantsDe.get(p).push(c.id);
  }

  const sortie = [];
  const pile = [id];
  // Parcours itératif et `vus` : une catégorie mal formée qui se retrouve
  // son propre ancêtre ferait tourner une descente récursive à l'infini.
  const vus = new Set();
  while (pile.length) {
    const courant = pile.pop();
    if (vus.has(courant)) continue;
    vus.add(courant);
    sortie.push(courant);
    pile.push(...(enfantsDe.get(courant) || []));
  }
  return sortie;
};

/// Chemin lisible : « Alimentaire › Boissons › Sodas ».
export const chemin = (categories, id, separateur = " › ") => {
  const par = new Map(categories.map((c) => [c.id, c]));
  const morceaux = [];
  let courant = par.get(id);
  const vus = new Set();
  while (courant && !vus.has(courant.id)) {
    vus.add(courant.id);
    morceaux.unshift(courant.data.nom);
    courant = courant.data.parentId ? par.get(courant.data.parentId) : null;
  }
  return morceaux.join(separateur);
};

/// Empêche de ranger une catégorie sous elle-même ou sous l'une des
/// siennes : le formulaire ne propose donc jamais un parent qui créerait
/// une boucle, plutôt que de la refuser après coup.
export const parentsPossibles = (categories, id) => {
  if (!id) return categories;
  const interdits = new Set(branche(categories, id));
  return categories.filter((c) => !interdits.has(c.id));
};

// ---------------------------------------------------------------------------
// Agrégats
// ---------------------------------------------------------------------------

/// Chiffres de tête : ce qu'on regarde avant tout le reste.
export const statistiques = (articles, mouvements) => {
  const niv = niveaux(mouvements);
  let valeur = 0;
  let alertes = 0;
  let ruptures = 0;

  for (const a of articles) {
    const stock = niv[a.id] || 0;
    valeur += stock * pmp(a, mouvements);
    const e = etat(stock, a.data.seuil);
    if (e.id === "rupture") ruptures += 1;
    else if (e.id === "alerte") alertes += 1;
  }

  return { total: articles.length, valeur, alertes, ruptures, niveaux: niv };
};

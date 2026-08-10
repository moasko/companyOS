// Référentiel de l'espace de travail : produits et clients.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI CE FICHIER EXISTE
//
// Un produit n'appartient pas à l'application Stock. Il appartient à
// l'entreprise : la Facturation le vend, les Achats le commandent, la
// Comptabilité le valorise. Avant, chaque module refaisait
// `api.records.list("stock", "articles")` dans son coin, avec sa propre
// idée de ce qu'est un produit et sa propre liste déroulante.
//
// Résultat : le jour où le catalogue gagne des catégories, des images ou
// des codes-barres, il faut repasser dans tous les modules. Et deux écrans
// affichant le même produit ne l'affichent pas pareil.
//
// Ici, un seul endroit sait ce qu'est un produit, comment le chercher et
// comment le montrer. Les modules demandent, ils ne fouillent pas.
//
//   import { referentiel, choisirProduit } from "../../referentiel";
//
//   const produits = await referentiel.produits();
//   const choix = await choisirProduit();      // sélecteur visuel commun
//   const client = await choisirClient();
//
// Le même raisonnement vaut pour les clients : ils appartiennent au CRM par
// leur écran, mais à l'entreprise par leur usage — la Facturation les
// facture, les Projets leur rattachent des tâches.
// ─────────────────────────────────────────────────────────────────────────

import { api } from "../api/client";
import { niveaux } from "./modules/stock/domaine";

const MODULE = "stock";
const MODULE_CLIENTS = "crm";

let cache = null;
let enCours = null;
const abonnes = new Set();

const vide = () => ({
  produits: [],
  categories: [],
  mouvements: [],
  stocks: {},
  clients: [],
});

/// Charge le référentiel une fois et le garde.
///
/// Les appels simultanés partagent la même requête : quand trois modules
/// s'ouvrent ensemble au démarrage, le catalogue n'est pas téléchargé trois
/// fois. `force` sert après une écriture.
export const chargerReferentiel = async ({ force = false } = {}) => {
  if (cache && !force) return cache;
  if (enCours && !force) return enCours;

  enCours = (async () => {
    try {
      const [produits, categories, mouvements, clients] = await Promise.all([
        api.records.list(MODULE, "articles"),
        api.records.list(MODULE, "categories").catch(() => []),
        api.records.list(MODULE, "mouvements").catch(() => []),
        // Un module qui ne fait que facturer n'a pas à savoir que les
        // clients vivent dans le CRM. S'il n'est pas installé, la liste est
        // simplement vide et la saisie libre reste possible.
        api.records.list(MODULE_CLIENTS, "clients").catch(() => []),
      ]);
      cache = {
        produits,
        categories,
        mouvements,
        clients,
        stocks: niveaux(mouvements),
      };
      abonnes.forEach((fn) => fn(cache));
      return cache;
    } catch {
      // Sans catalogue, un module doit rester utilisable : la Facturation
      // permet toujours de saisir une ligne libre.
      cache = cache || vide();
      return cache;
    } finally {
      enCours = null;
    }
  })();

  return enCours;
};

/// À appeler après toute écriture sur le catalogue — c'est le module Stock
/// qui en a la charge, personne d'autre n'écrit ici.
export const invaliderReferentiel = () => {
  cache = null;
  return chargerReferentiel({ force: true });
};

/// Prévenu à chaque rechargement. Rend la fonction de désabonnement.
export const subscribeReferentiel = (fn) => {
  abonnes.add(fn);
  if (cache) fn(cache);
  return () => abonnes.delete(fn);
};

export const referentiel = {
  produits: async () => (await chargerReferentiel()).produits,
  categories: async () => (await chargerReferentiel()).categories,
  /// Niveau de stock d'un produit, déduit des mouvements.
  stockDe: async (id) => (await chargerReferentiel()).stocks[id] || 0,
  clients: async () => (await chargerReferentiel()).clients,
  /// Lecture synchrone de ce qui est déjà chargé — pour un rendu qui ne
  /// peut pas attendre. Rend un référentiel vide si rien n'est en cache.
  instantane: () => cache || vide(),
};

/// Recherche : référence, désignation, code-barres. Utilisée par le
/// sélecteur et réutilisable par n'importe quel module.
export const filtrerProduits = (produits, requete) => {
  const q = (requete || "").trim().toLowerCase();
  if (!q) return produits;
  return produits.filter((p) =>
    [p.data.reference, p.data.designation, p.data.codeBarre, p.data.marque]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q)),
  );
};

/// Recherche d'un client : nom, entreprise, ville, e-mail, téléphone.
export const filtrerClients = (clients, requete) => {
  const q = (requete || "").trim().toLowerCase();
  if (!q) return clients;
  return clients.filter((c) =>
    [c.data.nom, c.data.entreprise, c.data.ville, c.data.email, c.data.telephone]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q)),
  );
};

// ---------------------------------------------------------------------------
// Sélecteurs
// ---------------------------------------------------------------------------
//
// Défini ailleurs pour ne pas faire dépendre ce fichier de React : un
// module qui veut seulement lire le catalogue ne doit pas embarquer une
// interface. `SelecteurProduit.jsx` s'enregistre au chargement du shell.

const selecteurs = {};

export const enregistrerSelecteur = (nom, fn) => {
  selecteurs[nom] = fn;
};

const ouvrir = async (nom, options) => {
  if (!selecteurs[nom]) {
    console.warn(`Sélecteur « ${nom} » indisponible : le shell n'est pas monté.`);
    return null;
  }
  await chargerReferentiel();
  return selecteurs[nom](options);
};

/// Ouvre le sélecteur visuel et rend le produit choisi, ou `null`.
///
///   const p = await choisirProduit({ titre: "Ajouter une ligne" });
///   if (p) ajouterLigne(p.data.designation, p.data.prixVente);
export const choisirProduit = (options = {}) => ouvrir("produit", options);

/// Ouvre le sélecteur de client et rend le client choisi, ou `null`.
export const choisirClient = (options = {}) => ouvrir("client", options);

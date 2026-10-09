// Centre de notifications de CompanyOS.
//
// Deux natures cohabitent derrière une seule liste :
//
//   locales   — « fichier importé », « QR code généré ». Elles ne
//               concernent que ce poste, disparaissent avec le cache et
//               n'ont aucune raison de traverser le réseau.
//   distantes — « Awa vous a attribué une tâche ». Adressées à une
//               personne, elles vivent sur le serveur et suivent la
//               personne d'un poste à l'autre.
//
// Les applications n'ont pas à connaître la différence :
//
//   notifier({ titre: "Facture créée", message: "2026-004", app: "Facturation" })
//   envoyerA(idMembre, { titre: "Nouvelle tâche", source: "projets",
//                        lien: { app: "projets", params: { carte: id } } })
//
// Le magasin est hors Redux, comme `saveRequest` et `modalRequest`.

import { api, sessionOuverte } from "../api/client";
import { ouvrirFenetre } from "./windows";
import { creerTraducteur } from "../utils/intl";
import { localeEffective } from "../utils/langue";

const CLE = "notifications";
const MAX = 50;
const PERIODE_MS = 20000;

let locales = [];
let distantes = [];
const abonnes = new Set();

try {
  locales = JSON.parse(localStorage.getItem(CLE) || "[]");
} catch {
  locales = [];
}

/// Une notification du serveur, ramenée à la forme que l'affichage connaît.
const adapter = (n) => ({
  id: `srv:${n.id}`,
  distanteId: n.id,
  titre: n.titre,
  message: n.message || "",
  app: n.auteurNom ? `${n.auteurNom} · ${n.source}` : n.source,
  ton: "info",
  lien: n.lien || null,
  date: new Date(n.createdAt).getTime(),
  lue: n.lu,
});

/// La liste telle que la voit l'écran : les deux sources fondues, les plus
/// récentes d'abord.
const fusion = () =>
  [...distantes, ...locales].sort((a, b) => b.date - a.date).slice(0, MAX);

const publier = () => {
  const vue = fusion();
  abonnes.forEach((fn) => fn(vue));
};

const ecrire = () => {
  locales = locales.slice(0, MAX);
  try {
    localStorage.setItem(CLE, JSON.stringify(locales));
  } catch {
    /* quota atteint : l'affichage reste correct, seul le report échoue */
  }
  publier();
};

export const subscribeNotifications = (fn) => {
  abonnes.add(fn);
  fn(fusion());
  return () => abonnes.delete(fn);
};

export const notifications = () => fusion();
export const nonLues = () => fusion().filter((n) => !n.lue).length;

/// Signale un événement **sur ce poste**.
/// `ton` : "info" (défaut) | "success" | "warning" | "error".
export const notifier = ({ titre, message = "", app = "", ton = "info", icone }) => {
  if (!titre) return null;
  const n = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    titre,
    message,
    app,
    ton,
    icone,
    date: Date.now(),
    lue: false,
  };
  locales = [n, ...locales];
  ecrire();
  return n;
};

/// Prévient une ou plusieurs personnes de l'espace de travail.
///
///   a : un identifiant de membre, un tableau d'identifiants, ou "tous"
///
/// `lien` décrit où mène le clic : `{ app: "projets", params: {…} }`.
/// L'application destinataire relit `params` comme elle l'entend — le
/// centre ne sait qu'ouvrir la bonne fenêtre.
export const envoyerA = async (a, { source, titre, message, lien } = {}) => {
  if (!sessionOuverte() || !titre || !source) return null;
  try {
    return await api.envoyerNotification({ a, source, titre, message, lien });
  } catch (err) {
    // Prévenir quelqu'un est secondaire par rapport à l'action qui l'a
    // déclenchée : on ne fait pas échouer la création d'une tâche parce
    // que la notification n'est pas partie.
    console.warn("notification non envoyée :", err.message);
    return null;
  }
};

export const marquerLue = (id) => {
  const distante = distantes.find((n) => n.id === id);
  if (distante) {
    if (distante.lue) return;
    // On affiche le résultat tout de suite et on rattrape en cas d'échec :
    // attendre le serveur ferait clignoter la pastille à chaque clic.
    distantes = distantes.map((n) => (n.id === id ? { ...n, lue: true } : n));
    publier();
    api.lireNotification(distante.distanteId).catch(rafraichir);
    return;
  }

  const n = locales.find((x) => x.id === id);
  if (!n || n.lue) return;
  locales = locales.map((x) => (x.id === id ? { ...x, lue: true } : x));
  ecrire();
};

export const toutMarquerLu = () => {
  if (!fusion().some((n) => !n.lue)) return;
  locales = locales.map((n) => ({ ...n, lue: true }));
  if (distantes.some((n) => !n.lue)) {
    distantes = distantes.map((n) => ({ ...n, lue: true }));
    api.lireToutesNotifications().catch(rafraichir);
  }
  ecrire();
};

export const retirerNotification = (id) => {
  const distante = distantes.find((n) => n.id === id);
  if (distante) {
    distantes = distantes.filter((n) => n.id !== id);
    publier();
    api.supprimerNotification(distante.distanteId).catch(rafraichir);
    return;
  }
  locales = locales.filter((n) => n.id !== id);
  ecrire();
};

export const viderNotifications = () => {
  locales = [];
  if (distantes.length) {
    distantes = [];
    api.viderNotifications().catch(rafraichir);
  }
  ecrire();
};

/// Suit le lien d'une notification : ouvre l'application concernée et lui
/// passe les paramètres par un événement — la fenêtre peut très bien être
/// déjà ouverte sur autre chose.
///
/// Côté application :
///
///   useEffect(() => {
///     const aller = (e) => { if (e.detail.app === "projets") …; };
///     window.addEventListener("companyos:lien", aller);
///     return () => window.removeEventListener("companyos:lien", aller);
///   }, []);
export const suivreLien = (n) => {
  if (!n?.lien?.app) return false;
  ouvrirFenetre(n.lien.app);
  window.dispatchEvent(
    new CustomEvent("companyos:lien", {
      detail: { app: n.lien.app, params: n.lien.params || {} },
    }),
  );
  return true;
};

// ---------------------------------------------------------------------------
// Synchronisation
// ---------------------------------------------------------------------------

let minuteur = null;

const rafraichir = async () => {
  if (!sessionOuverte()) {
    if (distantes.length) {
      distantes = [];
      publier();
    }
    return;
  }
  try {
    const { notifications: liste } = await api.notifications();
    distantes = liste.map(adapter);
    publier();
  } catch {
    /* hors ligne : la liste locale reste affichée telle quelle */
  }
};

/// Démarre la synchronisation. Appelée une fois par `App.jsx`.
///
/// Interrogation périodique plutôt que WebSocket : un espace de travail
/// compte quelques dizaines de personnes, une requête toutes les 20
/// secondes coûte moins qu'une connexion permanente à maintenir. Le jour
/// où cela ne suffira plus, seul ce bloc change.
export const demarrerSyncNotifications = () => {
  if (minuteur) return;
  rafraichir();
  minuteur = setInterval(rafraichir, PERIODE_MS);

  // Revenir sur l'onglet est le moment où l'on regarde ses notifications :
  // autant qu'elles soient à jour avant même le prochain tour.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) rafraichir();
  });
};

/// À appeler après une connexion ou une déconnexion, sans attendre le
/// prochain tour de synchronisation.
export const resynchroniserNotifications = rafraichir;

/// Un horodatage lisible : « à l'instant », « il y a 5 min », puis l'heure.
const DEPUIS = {
  fr: { instant: "à l'instant", min: "il y a {n} min", h: "il y a {n} h" },
  en: { instant: "just now", min: "{n} min ago", h: "{n} h ago" },
};
const tDepuis = creerTraducteur(DEPUIS);

export const depuis = (date) => {
  const s = Math.round((Date.now() - date) / 1000);
  if (s < 45) return tDepuis("instant");
  if (s < 3600) return tDepuis("min", { n: Math.round(s / 60) });
  if (s < 86400) return tDepuis("h", { n: Math.round(s / 3600) });
  return new Date(date).toLocaleDateString(localeEffective(), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

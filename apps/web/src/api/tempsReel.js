// Le flux temps réel du serveur (/api/evenements, Server-Sent Events).
//
// Ce qu'il apporte :
//   - une notification arrive à l'instant, au lieu d'attendre le prochain
//     tour d'interrogation ;
//   - quand un collègue modifie une fiche, le cache des listes l'oublie et
//     les applications qui l'affichent se rechargent (voir `ecoute` dans
//     apps/chargement.jsx) — sans bouton « Actualiser ».
//
// Le flux ne transporte que des identifiants : chaque application relit
// ce qu'elle a le droit de lire, par les routes habituelles.
//
// S'il est indisponible (proxy qui coupe, serveur ancien), rien ne casse :
// les notifications retombent sur l'interrogation périodique.

import { api, BASE_URL, CLIENT_ID, sessionOuverte } from "./client";

export const EVT_FICHES = "companyos:fiches";
export const EVT_NOTIFICATION = "companyos:notification-serveur";
export const EVT_ETAT = "companyos:temps-reel";
export const EVT_CLOUD = "companyos:cloud";

let source = null;
let connecte = false;
let tentative = 0;
let minuteur = null;

const changerEtat = (v) => {
  if (connecte === v) return;
  connecte = v;
  window.dispatchEvent(new CustomEvent(EVT_ETAT, { detail: { connecte: v } }));
};

export const tempsReelConnecte = () => connecte;

const lire = (e) => {
  try {
    return JSON.parse(e.data || "{}");
  } catch {
    return {};
  }
};

const fermer = () => {
  clearTimeout(minuteur);
  minuteur = null;
  if (source) source.close();
  source = null;
  changerEtat(false);
};

const reprendre = () => {
  fermer();
  if (!sessionOuverte()) return;
  // 2 s, 4 s, 8 s… jusqu'à une minute : un serveur qui redémarre n'est pas
  // pris d'assaut par tous les onglets à la fois.
  const delai = Math.min(60_000, 2000 * 2 ** tentative) + Math.random() * 1000;
  tentative += 1;
  minuteur = setTimeout(ouvrir, delai);
};

const ouvrir = () => {
  if (source || typeof EventSource === "undefined" || !sessionOuverte()) return;
  source = new EventSource(`${BASE_URL}/api/evenements`, { withCredentials: true });

  source.addEventListener("pret", () => {
    tentative = 0;
    changerEtat(true);
  });

  source.addEventListener("fiche", (e) => {
    const d = lire(e);
    if (!d.module || !d.collection) return;
    api.records.invalider(d.module, d.collection);
    window.dispatchEvent(new CustomEvent(EVT_FICHES, { detail: { ...d, moi: d.client === CLIENT_ID } }));
  });

  // Un fichier du Cloud a changé ailleurs (autre onglet, collègue). Un
  // import de cent fichiers en annonce cent : on les regroupe.
  let attenteCloud = null;
  source.addEventListener("cloud", (e) => {
    if (lire(e).client === CLIENT_ID) return;
    clearTimeout(attenteCloud);
    attenteCloud = setTimeout(() => window.dispatchEvent(new Event(EVT_CLOUD)), 400);
  });

  source.addEventListener("notification", () => {
    window.dispatchEvent(new Event(EVT_NOTIFICATION));
  });

  // Session révoquée côté serveur : on n'insiste pas.
  source.addEventListener("fin", () => fermer());

  source.onerror = () => {
    // EventSource reprend seul après une coupure (CONNECTING) ; s'il
    // abandonne (CLOSED : 401, 429…), on reprend nous-mêmes, plus tard.
    if (source?.readyState === EventSource.CLOSED) reprendre();
    else changerEtat(false);
  };
};

/// À appeler au démarrage et après chaque connexion / déconnexion.
export const synchroniserTempsReel = () => {
  if (sessionOuverte()) {
    tentative = 0;
    if (!source) ouvrir();
  } else {
    fermer();
  }
};

/// « crm/clients » correspond-il à l'un des motifs (« crm/* », « crm/clients ») ?
export const correspond = (motifs, module, collection) =>
  (motifs || []).some((m) => {
    const [mod, col = "*"] = String(m).split("/");
    return mod === module && (col === "*" || col === collection);
  });

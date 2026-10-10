// Client de l'API CompanyOS — la couche transport, et rien d'autre.
//
// Une fonction par route : elle prend des arguments, elle rend la réponse.
// Pas d'état, pas de rechargement : cela vit dans `queries.js`, qui
// s'appuie sur ce fichier — c'est la séparation qui permet d'appeler l'API
// depuis un endroit qui n'est pas un composant React (un gestionnaire
// d'événement, un module de fond) sans rien casser.
//
// Seule exception : les listes de fiches, lues page par page et partagées
// quelques secondes entre applications — voir `listes.js`.
//
// La session vit dans un cookie `HttpOnly` posé par l'API : aucun script
// de la page ne peut lire le jeton — ni une bibliothèque d'analyse de
// fichier compromise, ni une injection. Chaque appel part avec
// `credentials: "include"` et l'en-tête `X-CompanyOS`, que l'API exige de
// toute écriture faite par cookie (protection CSRF : un site tiers ne peut
// pas l'ajouter sans passer la vérification CORS).
//
// Le navigateur ne garde qu'un **témoin** non secret (« une session a été
// ouverte ici ») pour savoir, au démarrage, s'il faut interroger l'API ou
// montrer la vitrine.

import { creerCacheListes, lireToutesLesPages, TAILLE_PAGE } from "./listes";

export const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const TEMOIN = "companyos-session";

// L'ancien jeton en clair, d'avant le cookie : il ne vaut plus rien côté
// serveur, on ne le laisse pas traîner.
try {
  localStorage.removeItem("companyos-token");
} catch {
  // Stockage indisponible : rien à nettoyer.
}

/// Une session a-t-elle été ouverte dans ce navigateur ? (indice, pas
/// preuve : seule l'API sait si elle est encore valide)
export const sessionOuverte = () => {
  try {
    return localStorage.getItem(TEMOIN) === "1";
  } catch {
    return false;
  }
};
/// Change à chaque connexion ou déconnexion : les caches liés au compte
/// (fiche de l'entreprise…) savent ainsi qu'ils doivent se recharger.
let generation = 0;
export const cleSession = () => (sessionOuverte() ? `s${generation}` : null);

export const noterSession = () => {
  generation += 1;
  listes.vider();
  try {
    localStorage.setItem(TEMOIN, "1");
  } catch {
    // Sans stockage, le démarrage interrogera simplement l'API.
  }
};
export const oublierSession = () => {
  generation += 1;
  listes.vider();
  try {
    localStorage.removeItem(TEMOIN);
  } catch {
    // Rien.
  }
};

/// `fetch` vers l'API avec la session : pour les téléchargements de
/// fichiers et autres lectures qui ne passent pas par `request`.
export const apiFetch = (url, init = {}) =>
  fetch(url, {
    ...init,
    credentials: "include",
    headers: { ...(init.headers || {}), "X-CompanyOS": "1" },
  });

/// Prévient l'interface qu'une session doit configurer sa double
/// authentification avant d'aller plus loin.
const MFA_REQUISE = "companyos:mfa-requise";
export const surMfaRequise = (rappel) => {
  window.addEventListener(MFA_REQUISE, rappel);
  return () => window.removeEventListener(MFA_REQUISE, rappel);
};

/// Identifiant de cet onglet, joint à chaque écriture : le flux temps réel
/// le renvoie avec l'événement qui en découle, et l'onglet sait que c'est
/// sa propre modification (il l'a déjà à l'écran).
export const CLIENT_ID = (() => {
  try {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  } catch {
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
})();

const envoyer = async (path, { method = "GET", body, isForm = false } = {}) => {
  const headers = { "X-CompanyOS": "1", "X-Client-Id": CLIENT_ID };
  if (body && !isForm) headers["Content-Type"] = "application/json";

  const response = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers,
    credentials: "include",
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) return { payload: null, response };

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(payload?.error || `Erreur ${response.status}`);
    // Le code HTTP permet de distinguer une session refusée (401) d'une
    // panne passagère : seul le premier cas doit déconnecter l'utilisateur.
    error.status = response.status;
    if (payload?.sso) error.sso = true;
    if (payload?.mfaAConfigurer) {
      error.mfaAConfigurer = true;
      window.dispatchEvent(new Event(MFA_REQUISE));
    }
    throw error;
  }

  return { payload, response };
};

const request = async (path, options) => (await envoyer(path, options)).payload;

/// Une page d'une liste de fiches. `q` cherche partout dans la fiche,
/// `filter` compare des champs de premier niveau ({ etape: "gagne" }).
const lirePage = async (module, collection, { limit, cursor, q, filter } = {}) => {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  if (q) params.set("q", q);
  if (filter && Object.keys(filter).length) params.set("filter", JSON.stringify(filter));
  const qs = params.toString();
  const { payload, response } = await envoyer(`/records/${module}/${collection}${qs ? `?${qs}` : ""}`);
  return { fiches: payload || [], suite: response.headers.get("X-Next-Cursor") };
};

const listes = creerCacheListes({
  charger: (module, collection, options) =>
    lireToutesLesPages((cursor) => lirePage(module, collection, { ...options, limit: TAILLE_PAGE, cursor })),
});

/// Une réponse de connexion : la session est ouverte (cookie posé).
const connecte = (reponse) => {
  if (reponse && !reponse.mfa) noterSession();
  return reponse;
};

export const api = {
  register: async (data) => connecte(await request("/auth/register", { method: "POST", body: data })),
  /// Rend soit la session ouverte, soit `{ mfa: true, defi }` : il faut
  /// alors le code de l'application d'authentification (`loginMfa`).
  login: async (data) => connecte(await request("/auth/login", { method: "POST", body: data })),
  loginMfa: async (defi, code) =>
    connecte(await request("/auth/login/mfa", { method: "POST", body: { defi, code } })),
  /// Ferme la session côté serveur (le cookie est effacé par la réponse).
  logout: async () => {
    try {
      await request("/auth/logout", { method: "POST", body: {} });
    } finally {
      oublierSession();
    }
  },
  me: () => request("/auth/me"),
  motDePasseOublie: (email) => request("/auth/mot-de-passe/oubli", { method: "POST", body: { email } }),
  reinitialiserMotDePasse: (jeton, motDePasse) =>
    request("/auth/mot-de-passe/reinit", { method: "POST", body: { jeton, motDePasse } }),
  /// Adresse de départ de l'authentification unique : une navigation,
  /// pas un appel (le fournisseur d'identité prend la page).
  configSso: () => request("/auth/sso/config"),
  enregistrerSso: (config) => request("/auth/sso/config", { method: "PUT", body: config }),
  supprimerSso: () => request("/auth/sso/config", { method: "DELETE" }),
  urlSso: (email) => `${BASE_URL}/api/auth/sso/debut?email=${encodeURIComponent(email || "")}`,
  preferences: () => request("/auth/preferences"),
  enregistrerPreferences: (preferences) =>
    request("/auth/preferences", { method: "PUT", body: { preferences } }),

  // Membres de l'espace de travail. Lister est ouvert à tous — assigner une
  // tâche suppose de savoir à qui ; tout le reste exige d'être
  // administrateur, et c'est le serveur qui le vérifie.
  members: () => request("/auth/members"),
  setMemberRole: (id, role) =>
    request(`/auth/members/${id}/role`, { method: "PUT", body: { role } }),
  removeMember: (id) => request(`/auth/members/${id}`, { method: "DELETE" }),
  /// Ferme toutes les sessions d'un membre, sans le retirer de l'espace.
  deconnecterMembre: (id) =>
    request(`/auth/members/${id}/deconnexion`, { method: "POST" }),

  // Invitations : une adresse, un rôle, un code à transmettre.
  invitations: () => request("/auth/invitations"),
  invite: (email, role) =>
    request("/auth/invitations", { method: "POST", body: { email, role } }),
  cancelInvite: (id) => request(`/auth/invitations/${id}`, { method: "DELETE" }),
  /// Rejoindre un espace avec un code — la personne n'a pas encore de compte.
  join: async (code, name, password) =>
    connecte(await request("/auth/join", { method: "POST", body: { code, name, password } })),
  /// Changer de mot de passe ferme les sessions des autres appareils ;
  /// celle-ci reste ouverte.
  updatePassword: (current, next) =>
    request("/auth/password", { method: "PUT", body: { current, next } }),
  /// « Déconnecter mes autres appareils ».
  revoquerSessions: () => request("/auth/sessions/revoquer", { method: "POST", body: {} }),
  /// Sessions ouvertes (appareils, jetons d'outils) et fermeture d'une seule.
  sessions: () => request("/auth/sessions"),
  fermerSession: (id) => request(`/auth/sessions/${id}`, { method: "DELETE" }),
  /// Un jeton pour un outil (serveur MCP…) : rendu une seule fois.
  creerJeton: (libelle) => request("/auth/jetons", { method: "POST", body: { libelle } }),

  // Double authentification.
  mfa: () => request("/auth/mfa"),
  mfaPreparer: () => request("/auth/mfa/preparer", { method: "POST", body: {} }),
  mfaActiver: (code) => request("/auth/mfa/activer", { method: "POST", body: { code } }),
  mfaCodes: (code) => request("/auth/mfa/codes", { method: "POST", body: { code } }),
  mfaDesactiver: (password, code) =>
    request("/auth/mfa/desactiver", { method: "POST", body: { password, code } }),
  mfaObligatoire: (mfaObligatoire) =>
    request("/auth/tenant/securite", { method: "PUT", body: { mfaObligatoire } }),
  reinitialiserMfaMembre: (id) => request(`/auth/members/${id}/mfa`, { method: "DELETE" }),
  updateProfile: (name) => request("/auth/profile", { method: "PUT", body: { name } }),
  /// `avatar` : une data URL déjà redimensionnée, ou null pour revenir aux
  /// initiales. Voir src/apps/image.js.
  updateAvatar: (avatar) => request("/auth/avatar", { method: "PUT", body: { avatar } }),
  updateTenant: (name) => request("/auth/tenant", { method: "PUT", body: { name } }),

  // Notifications internes. Voir src/apps/notifications.js : les apps
  // passent par `notifier` / `envoyerA`, pas directement par ici.
  notifications: () => request("/notifications"),
  envoyerNotification: (payload) =>
    request("/notifications", { method: "POST", body: payload }),
  lireNotification: (id) => request(`/notifications/${id}/lu`, { method: "PUT" }),
  lireToutesNotifications: () => request("/notifications/lu", { method: "PUT" }),
  supprimerNotification: (id) => request(`/notifications/${id}`, { method: "DELETE" }),
  viderNotifications: () => request("/notifications", { method: "DELETE" }),
  // Conformité RGPD (voir apps/api/src/routes/conformite.js).
  urlMesDonnees: () => `${BASE_URL}/api/conformite/mes-donnees`,
  urlExportEspace: () => `${BASE_URL}/api/conformite/export`,
  reglagesConformite: () => request("/conformite/reglages"),
  enregistrerReglagesConformite: (r) => request("/conformite/reglages", { method: "PUT", body: r }),
  declarerDomainePublic: (domaine) => request("/conformite/domaine", { method: "PUT", body: { domaine } }),
  verifierDomainePublic: () => request("/conformite/domaine/verifier", { method: "POST", body: {} }),
  retirerDomainePublic: () => request("/conformite/domaine", { method: "DELETE" }),
  // Versions et liens de partage des fichiers.
  versionsFichier: (id) => request(`/files/${id}/versions`),
  urlVersionFichier: (id, vid) => `${BASE_URL}/api/files/${id}/versions/${vid}/download`,
  restaurerVersionFichier: (id, vid) => request(`/files/${id}/versions/${vid}/restaurer`, { method: "POST", body: {} }),
  partagesFichier: (id) => request(`/files/${id}/partages`),
  partagerFichier: (id, reglages) => request(`/files/${id}/partages`, { method: "POST", body: reglages }),
  revoquerPartage: (pid) => request(`/files/partages/${pid}`, { method: "DELETE" }),
  rechercherPersonne: (valeur) => request("/conformite/personne/recherche", { method: "POST", body: { valeur } }),
  anonymiserPersonne: (valeur) => request("/conformite/personne/anonymiser", { method: "POST", body: { valeur } }),

  // Push : l'appareil est prévenu onglet fermé (voir src/apps/push.js).
  pushCle: () => request("/notifications/push/cle"),
  pushAbonner: (abonnement) => request("/notifications/push", { method: "POST", body: abonnement }),
  pushDesabonner: (endpoint) => request("/notifications/push", { method: "DELETE", body: { endpoint } }),

  // Automatisations entre applications (administrateurs).
  automatisations: {
    list: () => request("/automatisations"),
    create: (a) => request("/automatisations", { method: "POST", body: a }),
    update: (id, a) => request(`/automatisations/${id}`, { method: "PUT", body: a }),
    activer: (id, active) => request(`/automatisations/${id}/active`, { method: "PUT", body: { active } }),
    remove: (id) => request(`/automatisations/${id}`, { method: "DELETE" }),
    historique: (id) => request(`/automatisations/${id}/historique`),
    secret: (id) => request(`/automatisations/${id}/secret`),
    essai: (automatisation, ficheId) => request("/automatisations/essai", { method: "POST", body: { automatisation, ficheId } }),
  },

  // Journal d'activité — administrateurs seulement, le serveur le vérifie.
  audit: ({ action, auteur, avant, limite } = {}) => {
    const q = new URLSearchParams();
    if (action) q.set("action", action);
    if (auteur) q.set("auteur", auteur);
    if (avant) q.set("avant", new Date(avant).toISOString());
    if (limite) q.set("limite", limite);
    return request(`/audit${q.toString() ? `?${q}` : ""}`);
  },
  auditFacettes: () => request("/audit/facettes"),

  // Formule de l'espace : tarifs, formule courante, consommation.
  facturation: () => request("/facturation"),
  changerFormule: (plan) =>
    request("/facturation/formule", { method: "PUT", body: { plan } }),

  // Courrier sortant de l'espace : réglages SMTP (admin) et envoi.
  courrierReglages: () => request("/courrier/reglages"),
  courrierEnregistrerReglages: (data) =>
    request("/courrier/reglages", { method: "PUT", body: data }),
  courrierEnvoyer: (data) => request("/courrier/envoyer", { method: "POST", body: data }),

  // Campagnes — e-mail de test (vrai rendu, membres de l'équipe), pause et
  // reprise d'un envoi, adresse du formulaire d'inscription public.
  campagnesTester: (message, adresses, exemple) =>
    request("/campagnes/test", { method: "POST", body: { message, adresses, exemple } }),
  campagnesPause: (id) => request(`/campagnes/${id}/pause`, { method: "POST", body: {} }),
  campagnesReprendre: (id) => request(`/campagnes/${id}/reprendre`, { method: "POST", body: {} }),
  campagnesFormulaire: () => request("/campagnes/formulaire"),
  regenererFormulaire: () => request("/campagnes/formulaire/regenerer", { method: "POST", body: {} }),

  // Console de l'exploitant du SaaS — réservée aux emails PLATFORM_ADMINS.
  plateforme: () => request("/plateforme"),
  plateformeFormule: (tenantId, plan) =>
    request(`/plateforme/espaces/${tenantId}/formule`, { method: "PUT", body: { plan } }),
  /// Configuration du stockage, côté exploitant. Le secret part en écriture
  /// mais ne revient jamais : la réponse n'en porte que les quatre derniers
  /// caractères.
  /// Suspendre un espace, ou lever sa suspension. Rien n'est supprimé :
  /// les données reviennent telles quelles à la levée.
  plateformeSuspension: (tenantId, suspendu, motif) =>
    request(`/plateforme/espaces/${tenantId}/suspension`, {
      method: "PUT",
      body: { suspendu, motif },
    }),

  /// Les membres d'un espace, vus par l'exploitant. Ni mot de passe ni
  /// empreinte : savoir qui compose l'espace, pas se faire passer pour eux.
  plateformeMembres: (tenantId) => request(`/plateforme/espaces/${tenantId}/membres`),
  plateformeDeconnexion: (tenantId, userId) =>
    request(`/plateforme/espaces/${tenantId}/membres/${userId}/deconnexion`, {
      method: "POST",
    }),
  plateformeRoleMembre: (tenantId, userId, role) =>
    request(`/plateforme/espaces/${tenantId}/membres/${userId}/role`, {
      method: "PUT",
      body: { role },
    }),

  plateformeStockageLire: () => request("/plateforme/stockage"),
  /// Santé de la plateforme : sauvegardes et erreurs.
  plateformeSante: () => request("/plateforme/sante"),
  plateformeSauvegarder: (type) =>
    request("/plateforme/sauvegardes", { method: "POST", body: { type } }),
  plateformeErreurResolue: (id, resolue) =>
    request(`/plateforme/erreurs/${id}`, { method: "PUT", body: { resolue } }),
  plateformeStockageTest: (config) =>
    request("/plateforme/stockage/test", { method: "POST", body: config }),
  plateformeStockage: (config) =>
    request("/plateforme/stockage", { method: "PUT", body: config }),

  catalog: () => request("/apps/catalog"),
  installedApps: () => request("/apps/installed"),
  /// `version` est celle que le shell livre : c'est lui qui porte le code,
  /// donc lui qui sait ce qu'il vient d'installer.
  installApp: (slug, version) =>
    request(`/apps/${slug}/install`, { method: "POST", body: { version } }),
  /// Enregistre une mise à jour appliquée sur une app déjà installée.
  /// À ne pas confondre avec `updateApp`, qui modifie la définition d'une
  /// application du Studio.
  appliquerMiseAJour: (slug, version) =>
    request(`/apps/${slug}/install`, { method: "PUT", body: { version } }),
  uninstallApp: (slug) => request(`/apps/${slug}/install`, { method: "DELETE" }),
  /// Qui peut ouvrir une application : `{ mode: "membres" | "admins" |
  /// "selection", membres?: [userId] }`. Réservé aux administrateurs.
  setAppAccess: (slug, acces) =>
    request(`/apps/${slug}/acces`, { method: "PUT", body: acces }),

  // Applications créées dans le Studio, propres à l'espace de travail.
  myApps: () => request("/apps/mine"),
  createApp: (data) => request("/apps", { method: "POST", body: data }),
  updateApp: (slug, data) => request(`/apps/${slug}`, { method: "PUT", body: data }),
  deleteApp: (slug) => request(`/apps/${slug}`, { method: "DELETE" }),

  // Le web, vu par le serveur. La page ne peut faire ni l'un ni l'autre
  // elle-même : la politique d'origine lui interdit de lire un autre
  // domaine, et un cadre refusé ne lui dit pas pourquoi. Voir
  // apps/api/src/routes/web.js.
  web: {
    /// Ce qu'il y a au bout de l'adresse : page ou fichier, encadrable ou
    /// non, et pourquoi pas.
    inspecter: (url) => request("/web/inspecter", { method: "POST", body: { url } }),
    /// Rapporte le contenu dans le cloud de l'espace de travail.
    telecharger: (url, parentId = null) =>
      request("/web/telecharger", { method: "POST", body: { url, parentId } }),
  },

  usage: () => request("/files/usage"),
  /// Tous les nœuds de l'espace, à plat — pour l'éditeur de code, qui
  /// cherche au lieu de naviguer. Voir GET /api/files/arborescence.
  arborescence: () => request("/files/arborescence"),

  listFiles: (parentId) =>
    request(`/files${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ""}`),
  createFolder: (name, parentId = null) =>
    request("/files/folder", { method: "POST", body: { name, parentId } }),
  /// Renommer et/ou déplacer. `parentId: null` remonte à la racine ;
  /// omettre un champ le laisse tel quel.
  renameNode: (id, name) => request(`/files/${id}`, { method: "PATCH", body: { name } }),
  moveNode: (id, parentId) =>
    request(`/files/${id}`, { method: "PATCH", body: { parentId } }),

  /// Met à la corbeille — réversible pendant 30 jours.
  deleteNode: (id) => request(`/files/${id}`, { method: "DELETE" }),

  // Corbeille. `listTrash` ne renvoie que ce qui a été supprimé
  // explicitement : les descendants partis avec un dossier n'y figurent pas.
  listTrash: () => request("/files/trash"),
  restoreNode: (id) => request(`/files/${id}/restore`, { method: "POST" }),
  /// Suppression définitive, sans retour possible.
  purgeNode: (id) => request(`/files/trash/${id}`, { method: "DELETE" }),
  emptyTrash: () => request("/files/trash", { method: "DELETE" }),

  uploadFile: (file, parentId = null) => {
    const form = new FormData();
    if (parentId) form.append("parentId", parentId);
    form.append("file", file);
    return request("/files/upload", { method: "POST", body: form, isForm: true });
  },

  /// Remplace le contenu d'un fichier en gardant son identité — c'est
  /// l'« enregistrer » des applications qui travaillent sur un fichier du
  /// cloud, par opposition à `uploadFile` qui en crée un nouveau.
  updateFileContent: (id, file, expectedUpdatedAt) => {
    const form = new FormData();
    // Verrou optimiste : le serveur refuse l'écriture si une autre fenêtre
    // a enregistré le fichier depuis la version que l'éditeur a ouverte.
    if (expectedUpdatedAt) form.append("expectedUpdatedAt", expectedUpdatedAt);
    // Le champ de version doit précéder le flux : Fastify rend les champs
    // multipart disponibles dans l'ordre où ils arrivent.
    form.append("file", file);
    return request(`/files/${id}/content`, { method: "PUT", body: form, isForm: true });
  },

  downloadUrl: (id) => `${BASE_URL}/api/files/${id}/download`,

  /// Lien de lecture en flux, utilisable directement dans une balise
  /// <video> ou <audio> : le navigateur y fait ses requêtes par plages,
  /// donc démarrage immédiat et déplacement possible dans la timeline.
  streamUrl: async (id) => {
    const { url } = await request(`/files/${id}/link`, { method: "POST" });
    return `${BASE_URL}${url}`;
  },

  // Données génériques des modules : chaque app range ses enregistrements
  // dans des collections nommées, sans migration côté serveur.
  records: {
    /// Toute la collection (toutes les pages), servie depuis le cache
    /// partagé si une autre application vient de la lire.
    /// `options` : { q, filter } — filtrés par le serveur.
    list: (module, collection, options) => listes.lire(module, collection, options),
    /// Une seule page, pour les écrans qui affichent au fil du défilement.
    /// Rend { fiches, suite } ; `suite` se repasse en `cursor`.
    page: (module, collection, options) => lirePage(module, collection, options),
    create: async (module, collection, data) => {
      try {
        return await request(`/records/${module}/${collection}`, { method: "POST", body: { data } });
      } finally {
        listes.invalider(module, collection);
      }
    },
    update: async (module, collection, id, data, updatedAt) => {
      try {
        return await request(`/records/${module}/${collection}/${id}`, {
          method: "PUT",
          body: { data, ...(updatedAt ? { updatedAt } : {}) },
        });
      } finally {
        listes.invalider(module, collection);
      }
    },
    remove: async (module, collection, id) => {
      try {
        return await request(`/records/${module}/${collection}/${id}`, { method: "DELETE" });
      } finally {
        listes.invalider(module, collection);
      }
    },
    /// Historique d'une fiche (états précédents) et fiches supprimées.
    historique: (module, collection, id) => request(`/records/${module}/${collection}/${id}/historique`),
    corbeille: (module, collection) => request(`/records/${module}/${collection}/corbeille/liste`),
    restaurer: async (module, collection, id, versionId) => {
      try {
        return await request(`/records/${module}/${collection}/${id}/historique/${versionId}/restaurer`, {
          method: "POST",
          body: {},
        });
      } finally {
        listes.invalider(module, collection);
      }
    },
    /// Une écriture faite hors de `api.records` (import, moteur serveur
    /// déclenché à la main) : oublier ce qu'on savait de la collection.
    invalider: (module, collection) => listes.invalider(module, collection),
  },
};

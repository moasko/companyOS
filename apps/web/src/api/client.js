// Client de l'API CompanyOS — la couche transport, et rien d'autre.
//
// Une fonction par route : elle prend des arguments, elle rend la réponse.
// Pas de cache, pas d'état, pas de rechargement. Tout cela vit dans
// `queries.js`, qui s'appuie sur ce fichier — c'est la séparation qui
// permet d'appeler l'API depuis un endroit qui n'est pas un composant
// React (un gestionnaire d'événement, un module de fond) sans rien casser.
//
// Le jeton est conservé dans localStorage et rejoué à chaque appel.
//
// ⚠ Le jour où l'API et le shell partageront une origine, ce choix devra
// être revu : un jeton dans localStorage est lisible par tout script qui
// s'exécute sur l'origine, et l'application analyse des fichiers
// utilisateur (docx, pptx, pdf) avec des bibliothèques tierces. Un cookie
// `HttpOnly` est la vraie réponse ; il demande une protection CSRF en
// contrepartie.

export const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const TOKEN_KEY = "companyos-token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

const request = async (path, { method = "GET", body, isForm = false } = {}) => {
  const headers = {};
  const token = getToken();

  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isForm) headers["Content-Type"] = "application/json";

  const response = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(payload?.error || `Erreur ${response.status}`);
    // Le code HTTP permet de distinguer un jeton refusé (401) d'une panne
    // passagère : seul le premier cas doit déconnecter l'utilisateur.
    error.status = response.status;
    throw error;
  }

  return payload;
};

export const api = {
  register: (data) => request("/auth/register", { method: "POST", body: data }),
  login: (data) => request("/auth/login", { method: "POST", body: data }),
  me: () => request("/auth/me"),

  // Membres de l'espace de travail. Lister est ouvert à tous — assigner une
  // tâche suppose de savoir à qui ; tout le reste exige d'être
  // administrateur, et c'est le serveur qui le vérifie.
  members: () => request("/auth/members"),
  setMemberRole: (id, role) =>
    request(`/auth/members/${id}/role`, { method: "PUT", body: { role } }),
  removeMember: (id) => request(`/auth/members/${id}`, { method: "DELETE" }),

  // Invitations : une adresse, un rôle, un code à transmettre.
  invitations: () => request("/auth/invitations"),
  invite: (email, role) =>
    request("/auth/invitations", { method: "POST", body: { email, role } }),
  cancelInvite: (id) => request(`/auth/invitations/${id}`, { method: "DELETE" }),
  /// Rejoindre un espace avec un code — la personne n'a pas encore de compte.
  join: (code, name, password) =>
    request("/auth/join", { method: "POST", body: { code, name, password } }),
  updatePassword: (current, next) =>
    request("/auth/password", { method: "PUT", body: { current, next } }),
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
  courrierEnvoyer: (data) =>
    request("/courrier/envoyer", { method: "POST", body: data }),

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
  plateformeRoleMembre: (tenantId, userId, role) =>
    request(`/plateforme/espaces/${tenantId}/membres/${userId}/role`, {
      method: "PUT",
      body: { role },
    }),

  plateformeStockageLire: () => request("/plateforme/stockage"),
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
  updateFileContent: (id, file) => {
    const form = new FormData();
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
    list: (module, collection) => request(`/records/${module}/${collection}`),
    create: (module, collection, data) =>
      request(`/records/${module}/${collection}`, { method: "POST", body: { data } }),
    update: (module, collection, id, data) =>
      request(`/records/${module}/${collection}/${id}`, { method: "PUT", body: { data } }),
    remove: (module, collection, id) =>
      request(`/records/${module}/${collection}/${id}`, { method: "DELETE" }),
  },
};

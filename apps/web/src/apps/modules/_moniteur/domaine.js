// Moniteur du système — les règles, sans React.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI CE FICHIER REMPLACE UN MENSONGE
//
// Le « gestionnaire de tâches » hérité de Win11React affichait une liste de
// processus avec des colonnes CPU, mémoire, disque, réseau — toutes tirées
// au hasard par `Math.random()`. Des chiffres qui changent à chaque rendu
// et ne mesurent rien. Un outil de supervision qui ment est pire qu'absent :
// il donne l'illusion d'un contrôle qu'on n'a pas.
//
// Une page web n'a d'ailleurs pas accès au vrai CPU de la machine. Ce
// qu'elle peut mesurer honnêtement, c'est l'état de **l'OS lui-même** : les
// fenêtres ouvertes, la mémoire du navigateur quand il la donne, le
// stockage de l'espace de travail. C'est ce que ce fichier calcule — rien
// qu'il ne puisse prouver.
// ─────────────────────────────────────────────────────────────────────────

/// Les fenêtres réellement ouvertes, à partir de l'état Redux des apps.
///
/// `state.apps` mêle des entrées de fenêtre et des scalaires (`hz`, un
/// compteur de z-index). On ne garde que ce qui est une fenêtre — repérable
/// à son `id` — et parmi elles, celles qui ne sont pas masquées.
export const fenetresOuvertes = (apps = {}) => {
  const out = [];
  for (const [cle, valeur] of Object.entries(apps)) {
    if (!valeur || typeof valeur !== "object" || !valeur.id) continue;
    if (valeur.hide) continue;
    out.push({
      id: cle,
      nom: valeur.name || cle,
      icone: valeur.icon || cle,
      // Une fenêtre agrandie occupe tout l'écran ; c'est l'information
      // qu'un utilisateur cherche quand il vient « fermer ce qui rame ».
      agrandie: !!valeur.max,
      premierPlan: valeur.z,
    });
  }
  // La plus haute dans la pile d'abord : c'est celle qu'on regarde.
  return out.sort((a, b) => (b.premierPlan || 0) - (a.premierPlan || 0));
};

/// Mémoire du tas JavaScript, quand le navigateur la communique.
///
/// `performance.memory` n'existe que sur les moteurs Chromium, et ne
/// mesure que le tas de l'onglet — pas la machine. On le présente donc pour
/// ce qu'il est : la mémoire de CompanyOS, pas celle de l'ordinateur. Absent
/// ailleurs, auquel cas on ne montre rien plutôt qu'un zéro trompeur.
export const memoire = (perf = globalThis.performance) => {
  const m = perf?.memory;
  if (!m || !m.usedJSHeapSize) return null;
  return {
    utilisee: m.usedJSHeapSize,
    limite: m.jsHeapSizeLimit || 0,
    part: m.jsHeapSizeLimit ? m.usedJSHeapSize / m.jsHeapSizeLimit : 0,
  };
};

/// Part d'un quota utilisée, bornée à [0, 1]. Un dépassement (quota réduit
/// après coup) ne doit pas produire une barre qui déborde.
export const part = (utilise, total) => {
  const u = Number(utilise) || 0;
  const t = Number(total) || 0;
  if (t <= 0) return 0;
  return Math.min(1, Math.max(0, u / t));
};

const UNITES = ["o", "Ko", "Mo", "Go", "To"];

/// Taille lisible. Les octets viennent du serveur en `BigInt` sérialisé
/// (une chaîne) : on les ramène en nombre avant tout calcul.
export const octets = (valeur) => {
  let n = Number(valeur) || 0;
  if (n < 1) return "0 o";
  let i = 0;
  while (n >= 1024 && i < UNITES.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${UNITES[i]}`;
};

/// Depuis combien de temps la session est ouverte, en clair.
export const depuis = (debutIso, maintenant = Date.now()) => {
  if (!debutIso) return "";
  const ms = maintenant - new Date(debutIso).getTime();
  if (ms < 0 || Number.isNaN(ms)) return "";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60} min`;
  const j = Math.floor(h / 24);
  return `${j} j ${h % 24} h`;
};

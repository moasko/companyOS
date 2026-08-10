// Versions des applications, et mises à jour disponibles.
//
// ─────────────────────────────────────────────────────────────────────────
// QUI SAIT QUOI
//
// Deux versions cohabitent, et les confondre rend le sujet incompréhensible :
//
//   la version **livrée**   — celle du manifeste, dans le code du shell.
//                             C'est ce que la personne a réellement sous la
//                             main, puisque c'est le code qui s'exécute.
//   la version **installée** — celle que le serveur a enregistrée pour cet
//                             espace de travail, au dernier
//                             installer/mettre à jour.
//
// Une mise à jour disponible, c'est l'écart entre les deux. Le shell est
// donc la source de vérité de ce qui existe, et le serveur la mémoire de ce
// que l'espace a accepté.
//
// À QUOI SERT « METTRE À JOUR » PUISQUE LE CODE EST DÉJÀ LÀ
//
// À faire tourner la **migration de données** du module, et à en garder la
// trace. Quand le Stock gagne des catégories ou la Facturation un type de
// document, les fiches déjà saisies n'ont pas les nouveaux champs. Un
// module peut donc exporter :
//
//   export const migrer = async (depuis) => { … }
//
// appelée une seule fois, avec la version d'où l'on vient. C'est le seul
// endroit de l'OS où une reprise de données a lieu, et elle est tracée au
// journal d'activité.
// ─────────────────────────────────────────────────────────────────────────

/// Compare deux versions sémantiques. Rend un nombre négatif si `a` est
/// antérieure à `b`, zéro si elles sont égales.
///
/// Comparaison numérique segment par segment, jamais alphabétique : en
/// texte, « 1.10.0 » passe avant « 1.9.0 », ce qui masquerait exactement
/// les mises à jour qu'on cherche à signaler.
export const comparerVersions = (a, b) => {
  const decouper = (v) =>
    String(v || "0")
      .split(/[.\-+]/)
      .map((x) => parseInt(x, 10))
      .map((x) => (Number.isFinite(x) ? x : 0));

  const va = decouper(a);
  const vb = decouper(b);
  const n = Math.max(va.length, vb.length);

  for (let i = 0; i < n; i += 1) {
    const d = (va[i] || 0) - (vb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
};

/// Version livrée par le shell pour une application du catalogue.
///
/// Les applications du Studio n'ont pas de manifeste — elles sont décrites
/// en base et exécutées par le moteur générique : c'est donc la version du
/// catalogue qui fait foi pour elles.
export const versionLivree = (app, moduleParSlug) =>
  moduleParSlug[app.slug]?.version || app.version || "1.0.0";

/// Une mise à jour est-elle disponible pour cette application installée ?
///
/// Il faut une version enregistrée pour répondre. Sans elle, on ne sait pas
/// d'où l'on vient : annoncer une mise à jour serait deviner. La première
/// version d'une installation antérieure à ce mécanisme est donc adoptée en
/// silence — voir `adopterVersions` — et les vraies mises à jour ne sont
/// signalées qu'ensuite.
///
/// Crier au loup a un coût : une Boutique qui affiche treize mises à jour
/// dont aucune n'en est une apprend à l'utilisateur à ignorer la pastille.
export const miseAJourDisponible = (app, moduleParSlug) => {
  if (!app.installed || !app.installedVersion) return false;
  return comparerVersions(versionLivree(app, moduleParSlug), app.installedVersion) > 0;
};

/// Applications installées dont la version n'a jamais été enregistrée.
export const sansVersion = (catalogue) =>
  catalogue.filter((a) => a.installed && !a.installedVersion);

/// Les nouveautés à annoncer : celles des versions strictement postérieures
/// à ce qui est installé. Inutile de rappeler ce que la personne a déjà.
export const nouveautesDepuis = (app, moduleParSlug) => {
  const notes = moduleParSlug[app.slug]?.nouveautes || [];
  if (!app.installedVersion) return notes;
  return notes.filter(
    (n) => comparerVersions(n.version, app.installedVersion) > 0,
  );
};

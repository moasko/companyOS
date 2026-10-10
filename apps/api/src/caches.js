import { abonner, publier } from "./evenements.js";

/// Les caches en mémoire de l'API, recensés pour la console de l'exploitant.
///
/// Chaque module qui garde une copie en mémoire (réglages d'un espace,
/// règles d'automatisation, clés d'un fournisseur SSO…) la déclare ici :
/// un nom, ce qu'elle contient, combien d'entrées, et comment la vider.
/// La console peut alors la montrer et la vider — sans redémarrer l'API.
///
/// Plusieurs instances servent la plateforme : vider ne touche pas que
/// celle qui reçoit la requête. L'ordre passe par le bus d'événements
/// (LISTEN/NOTIFY) et chaque instance vide sa propre copie.
///
/// Aucun cache déclaré ici n'est une source de vérité : tout se relit en
/// base à la demande suivante. Vider coûte quelques requêtes, jamais une
/// donnée.

const registre = new Map(); // nom → { libelle, description, taille, vider }

/// Déclare un cache. `taille()` rend un nombre d'entrées, `vider()` peut
/// être asynchrone (relire une liste en base, par exemple).
export const declarerCache = (nom, { libelle, description, taille, vider }) => {
  registre.set(nom, { libelle, description, taille, vider });
};

export const nomsCaches = () => [...registre.keys()];

const tailleDe = (def) => {
  try {
    return Math.max(0, Number(def.taille()) || 0);
  } catch {
    return 0;
  }
};

/// L'état des caches de **cette** instance.
export const etatCaches = () =>
  [...registre].map(([nom, def]) => ({
    nom,
    libelle: def.libelle,
    description: def.description,
    entrees: tailleDe(def),
  }));

/// Vide les caches nommés (tous si `noms` est vide) sur cette instance.
/// Rend le nombre d'entrées libérées.
export const viderCachesLocaux = async (noms = []) => {
  const cibles = noms.length ? noms.filter((n) => registre.has(n)) : nomsCaches();
  let entrees = 0;
  for (const nom of cibles) {
    const def = registre.get(nom);
    entrees += tailleDe(def);
    try {
      await def.vider();
    } catch {
      // Un cache qui refuse de se vider se rechargera à son échéance.
    }
  }
  return { caches: cibles, entrees };
};

/// Vide les caches sur **toutes** les instances. `navigateurs` demande en
/// plus aux navigateurs connectés d'oublier leurs listes et de relire.
export const viderCaches = async ({ noms = [], navigateurs = false } = {}) => {
  const valides = noms.filter((n) => registre.has(n));
  const resultat = await viderCachesLocaux(valides);
  await publier({ type: "caches", noms: valides, navigateurs: !!navigateurs, le: Date.now() });
  return resultat;
};

let desabonner = null;
/// Écoute les ordres de vidage venus des autres instances. L'instance
/// émettrice reçoit aussi le sien : vider deux fois est sans effet.
export const demarrerCaches = () => {
  if (desabonner) return;
  desabonner = abonner((evt) => {
    if (evt?.type === "caches") viderCachesLocaux(Array.isArray(evt.noms) ? evt.noms : []).catch(() => {});
  });
};

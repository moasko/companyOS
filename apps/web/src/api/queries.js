// La couche de données du shell — TanStack Query au-dessus de `client.js`.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI
//
// Chaque module métier faisait la même chose à la main : un `useState` pour
// la liste, un `useState` pour le chargement, un `useEffect` qui appelle
// `api.records.list`, et après chaque écriture un rechargement complet.
// Multiplié par quarante modules, cela donne quarante implémentations du
// même cache — dont aucune ne partage rien avec les autres.
//
// Conséquences concrètes, visibles à l'usage :
//   - ouvrir Facturation puis Comptabilité rechargeait deux fois la même
//     liste de factures, parce que les deux modules ont chacun leur état ;
//   - créer un client dans le CRM ne le faisait pas apparaître dans le
//     sélecteur de Facturation resté ouvert dans une autre fenêtre ;
//   - une erreur réseau laissait une liste vide sans distinction possible
//     entre « pas encore chargé », « vide » et « en panne ».
//
// TanStack Query donne un cache unique, partagé par toutes les fenêtres de
// l'OS, avec l'invalidation comme seul mécanisme de synchronisation.
//
// ─────────────────────────────────────────────────────────────────────────
// CONVENTION DE CLÉS
//
// Une clé décrit une ressource, du plus général au plus précis :
//
//   ["records", module, collection]   la liste des fiches d'une collection
//   ["files", parentId]               le contenu d'un dossier
//   ["membres"]                       les membres de l'espace
//
// L'invalidation suit la même hiérarchie : invalider `["records", "crm"]`
// invalide toutes les collections du CRM, `["records"]` invalide toutes
// les données métier. C'est ce qui permet à une écriture dans un module de
// rafraîchir un autre module sans que les deux se connaissent.
// ─────────────────────────────────────────────────────────────────────────

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "./client";

export const cles = {
  records: (module, collection) =>
    [
      "records",
      ...(module ? [module] : []),
      ...(collection ? [collection] : []),
    ],
  fichiers: (parentId = null) => ["files", parentId],
  corbeille: () => ["files", "corbeille"],
  usage: () => ["usage"],
  membres: () => ["membres"],
  notifications: () => ["notifications"],
  appsInstallees: () => ["apps", "installees"],
  catalogue: () => ["apps", "catalogue"],
};

// ---------------------------------------------------------------------------
// Données métier
// ---------------------------------------------------------------------------

/// Les fiches d'une collection. Remplace le trio
/// `useState` + `useState(chargement)` + `useEffect` de chaque module.
///
/// `actif` permet de ne pas charger tant qu'on n'en a pas besoin — une
/// fenêtre d'app repliée, un onglet non ouvert.
export const useRecords = (module, collection, { actif = true } = {}) =>
  useQuery({
    queryKey: cles.records(module, collection),
    queryFn: () => api.records.list(module, collection),
    enabled: Boolean(actif && module && collection),
  });

/// Les trois écritures partagent leur invalidation : après une écriture,
/// **toute** la collection est marquée périmée. Recharger une liste de
/// quelques centaines de fiches coûte moins cher qu'un bug de cohérence,
/// et l'utilisateur ne voit rien puisque l'ancienne donnée reste affichée
/// pendant le rechargement.
const useEcritureRecords = (module, collection, action) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: cles.records(module, collection) }),
  });
};

export const useCreerRecord = (module, collection) =>
  useEcritureRecords(module, collection, (data) =>
    api.records.create(module, collection, data),
  );

export const useModifierRecord = (module, collection) =>
  useEcritureRecords(module, collection, ({ id, data }) =>
    api.records.update(module, collection, id, data),
  );

export const useSupprimerRecord = (module, collection) =>
  useEcritureRecords(module, collection, (id) =>
    api.records.remove(module, collection, id),
  );

// ---------------------------------------------------------------------------
// Fichiers
// ---------------------------------------------------------------------------

export const useFichiers = (parentId = null) =>
  useQuery({
    queryKey: cles.fichiers(parentId),
    queryFn: () => api.listFiles(parentId),
  });

export const useCorbeille = () =>
  useQuery({ queryKey: cles.corbeille(), queryFn: () => api.listTrash() });

/// La consommation de l'espace. Rafraîchie plus souvent que le reste :
/// c'est la seule donnée qui bouge sans que l'utilisateur ait rien fait
/// dans cette fenêtre — un collègue qui importe un fichier la change.
export const useUsage = () =>
  useQuery({
    queryKey: cles.usage(),
    queryFn: () => api.usage(),
    staleTime: 30_000,
  });

/// Toute écriture sur les fichiers touche deux choses : le dossier
/// concerné et le quota. Ce hook centralise l'invalidation des deux, pour
/// qu'aucun appelant n'oublie le second — c'était le cas de la corbeille,
/// dont le vidage libérait de la place sans que la jauge bouge.
export const useInvaliderFichiers = () => {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: ["files"] });
    client.invalidateQueries({ queryKey: cles.usage() });
  };
};

// ---------------------------------------------------------------------------
// Espace de travail
// ---------------------------------------------------------------------------

/// Les membres changent rarement, et beaucoup d'écrans en ont besoin
/// (assigner une tâche, choisir un responsable, afficher un avatar).
/// Cinq minutes de fraîcheur évitent une requête par ouverture de fenêtre.
export const useMembres = () =>
  useQuery({
    queryKey: cles.membres(),
    queryFn: () => api.members(),
    staleTime: 5 * 60_000,
  });

export const useNotifications = () =>
  useQuery({
    queryKey: cles.notifications(),
    queryFn: () => api.notifications(),
    // Les notifications arrivent d'ailleurs — d'un collègue, d'un moteur
    // de fond. Sans interrogation périodique, elles n'apparaîtraient qu'au
    // prochain rechargement de la page, ce qui, sur un OS qu'on laisse
    // ouvert toute la journée, veut dire jamais.
    refetchInterval: 60_000,
  });

export const useAppsInstallees = () =>
  useQuery({
    queryKey: cles.appsInstallees(),
    queryFn: () => api.installedApps(),
    staleTime: 5 * 60_000,
  });

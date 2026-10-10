// Vider les caches de ce navigateur.
//
// Appelé de deux façons :
//   - sur ordre de l'exploitant (console Plateforme), relayé par le flux
//     temps réel à tous les navigateurs ouverts — après une correction de
//     données en base, typiquement, pour que personne ne garde une copie
//     périmée ;
//   - depuis la console elle-même, pour son propre navigateur.
//
// Ce qui est oublié : les listes de fiches partagées entre apps, le
// référentiel (clients, articles…), le cache de requêtes. Les fenêtres
// ouvertes relisent aussitôt. Ce qui est gardé : la session, les
// préférences (thème, langue, devise), les brouillons — rien de cela n'est
// un cache.
//
// Le service worker est invité à vérifier s'il existe une version plus
// récente de l'application : c'est ce qu'on attend d'un « vider le cache »
// après un déploiement.

import { api } from "./client";
import { invaliderReferentiel } from "../apps/referentiel";
import { EVT_FICHES } from "./tempsReel";

export const EVT_CACHES_VIDES = "companyos:caches-vides";

export const viderCachesNavigateur = async (queryClient) => {
  api.records.viderTout();
  invaliderReferentiel();
  if (queryClient) await queryClient.invalidateQueries().catch(() => {});

  // Les caches d'exécution (pas la préinstallation, qui fait marcher le
  // mode hors ligne et se renouvelle avec chaque version).
  let supprimes = 0;
  try {
    if (typeof caches !== "undefined") {
      for (const nom of await caches.keys()) {
        if (/precache/i.test(nom)) continue;
        if (await caches.delete(nom)) supprimes += 1;
      }
    }
  } catch {
    // Stockage inaccessible (navigation privée) : rien à vider.
  }
  try {
    const inscriptions = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(inscriptions.map((r) => r.update().catch(() => {})));
  } catch {
    // Pas de service worker : rien à mettre à jour.
  }

  // Toutes les fenêtres qui écoutent des collections relisent.
  window.dispatchEvent(new CustomEvent(EVT_FICHES, { detail: { module: "*", collection: "*" } }));
  window.dispatchEvent(new Event(EVT_CACHES_VIDES));
  return { supprimes };
};

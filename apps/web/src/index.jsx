import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import store from "./reducers";
import { installerRapportErreurs } from "./utils/rapportErreurs";
import { registerSW } from "virtual:pwa-register";
import { EVT_CLOUD } from "./api/tempsReel";

// Les erreurs du navigateur partent au journal de la plateforme — voir
// src/utils/rapportErreurs.js.
installerRapportErreurs();

// Mise à jour après un déploiement.
//
// Le service worker sert l'OS depuis son cache, ce qui le rend rapide et
// utilisable hors ligne — mais avec l'enregistrement injecté par défaut, la
// version déployée ne s'affichait qu'au **deuxième** rechargement : la
// première visite servait encore l'ancienne interface pendant que la
// nouvelle s'installait en coulisse. « Je déploie et je ne vois rien »,
// sauf à recharger deux fois.
//
// `immediate` installe la nouvelle version dès l'ouverture, et la page se
// recharge une fois, d'elle-même, quand elle prend la main — en pratique
// dans les premières secondes, avant qu'on ait commencé à travailler. Pas
// de vérification périodique ensuite : un rechargement au milieu d'une
// saisie ferait plus de tort que d'attendre la prochaine ouverture.
registerSW({ immediate: true });

// Un fichier du Cloud a changé dans un autre onglet ou chez un collègue :
// l'Explorateur, le bureau et la corbeille relisent (voir reducers/cloud.js).
window.addEventListener(EVT_CLOUD, () => store.dispatch({ type: "CLOUD_TOUCH" }));

// Deux gestionnaires d'état, et c'est voulu :
//
//   Redux         l'état de l'OS lui-même — fenêtres ouvertes, position,
//                 thème, fond d'écran, menu Démarrer. Rien à voir avec le
//                 serveur : c'est de l'état local, synchrone, qu'on ne
//                 recharge pas.
//   React Query   tout ce qui vient de l'API. Ce n'est pas de l'état, c'est
//                 un cache : il a une fraîcheur, il peut échouer, et deux
//                 fenêtres qui affichent la même liste doivent voir la même
//                 chose. Voir src/api/queries.js.
//
// La confusion entre les deux est ce qui produisait quarante copies de la
// même liste de factures, une par module qui en avait besoin.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Les données de gestion changent à l'échelle de la minute, pas de la
      // seconde. Recharger à chaque prise de focus faisait clignoter les
      // listes dès qu'on passait d'une fenêtre de l'OS à une autre.
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      // Une seule reprise : au-delà, l'erreur est réelle et il vaut mieux
      // la montrer que faire attendre devant un écran vide.
      retry: 1,
    },
  },
});

const root = createRoot(document.getElementById("root"));

root.render(
  <Suspense
    fallback={
      <div id="sus-fallback">
        <h1>Loading</h1>
      </div>
    }
  >
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <App />
      </Provider>
    </QueryClientProvider>
  </Suspense>,
);

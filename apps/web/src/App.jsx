import { useEffect, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useDispatch, useSelector } from "react-redux";
import "./i18nextConf";
import { appliquerLangue } from "./utils/langue";
import "./index.css";
import "./utils/scroll.scss";
import "./utils/mobile.scss";

import { BandPane, CalnWid, DesktopApp, SidePane, StartMenu } from "./components/start";
import Taskbar from "./components/taskbar";
import { Background, BootScreen, LockScreen } from "./containers/background";

import { loadSettings } from "./actions";
import * as Applications from "./containers/applications";
import { modulesTous } from "./apps/registry";
import { SavePicker } from "./apps/SavePicker";
import { ModalHost } from "./apps/ModalHost";
import { HoteSelecteurProduit } from "./apps/SelecteurProduit";
import { HoteSelecteurClient } from "./apps/SelecteurClient";
import { HoteMenuContextuel } from "./apps/MenuContextuel";
import { ecouterLesCopies } from "./apps/clipboard";
import { intercepterMailto } from "./apps/mailto";
import { demarrerSyncNotifications } from "./apps/notifications";
import { CustomApp } from "./apps/CustomApp";
import { CustomWebApp } from "./apps/CustomWebApp";
import { syncInstalledModules, detachAllModules, attachSystemModules } from "./apps/sync";
import { appliquerApparence, reinitialiserApparence } from "./apps/appearance";
import { api, getToken, clearToken } from "./api/client";
import { demarrerPreferences, arreterPreferences } from "./apps/preferences";

/// Monte une application à sa première ouverture, et pas avant.
///
/// Toutes les fenêtres étaient rendues dès le démarrage, simplement
/// masquées : les effets de *tous* les modules tournaient donc en
/// permanence — chargements réseau compris — y compris pour les
/// applications qu'on n'ouvre jamais de la journée. À six modules ça ne se
/// voyait pas ; à quarante, si.
///
/// Une fois ouverte, l'application reste montée : fermer une fenêtre ne
/// doit pas jeter ce qu'elle contient, un document à moitié rédigé ou un
/// formulaire rempli. On économise le démarrage, pas la mémoire.
function AppMontee({ mod }) {
  const cle = mod.id || mod.icon;
  const cachee = useSelector((state) => state.apps[cle]?.hide !== false);
  const [montee, setMontee] = useState(false);

  useEffect(() => {
    if (!cachee) setMontee(true);
  }, [cachee]);

  if (!montee) return null;
  const Fenetre = mod.Window;
  return <Fenetre />;
}

function ErrorFallback({ error, resetErrorBoundary }) {
  return (
    <div className="crashScreen">
      <div className="crashCont">
        <h1>:(</h1>
        <h2>
          CompanyOS a rencontré un problème et doit redémarrer la session. Vos données
          ouvertes ne sont pas perdues.
        </h2>
        <div className="stopcode">
          <h4>Code d'arrêt</h4>
          <pre>{error.message}</pre>
          <button onClick={resetErrorBoundary}>Redémarrer la session</button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const apps = useSelector((state) => state.apps);
  const wall = useSelector((state) => state.wallpaper);
  const session = useSelector((state) => state.session);
  const customApps = useSelector((state) => state.customApps);
  const dispatch = useDispatch();

  const afterMath = (event) => {
    var ess = [
      ["START", "STARTHID"],
      ["BAND", "BANDHIDE"],
      ["PANE", "PANEHIDE"],
      ["CALN", "CALNHIDE"],
      ["MENU", "MENUHIDE"],
    ];

    var actionType = "";
    try {
      actionType = event.target.dataset.action || "";
    } catch {
      // Une préférence locale corrompue ne doit pas empêcher le démarrage.
    }

    var actionType0 = getComputedStyle(event.target).getPropertyValue("--prefix");

    ess.forEach((item, i) => {
      if (!actionType.startsWith(item[0]) && !actionType0.startsWith(item[0])) {
        dispatch({
          type: item[1],
        });
      }
    });
  };

  // Clic droit : on referme ce qui est ouvert (menu Démarrer, volets), et
  // on supprime le menu natif du navigateur. Le menu contextuel de l'OS,
  // lui, est construit par l'écran qui reçoit le clic — voir
  // `src/apps/menuRequest.js`. Rien de global n'a besoin de savoir sur quoi
  // on a cliqué, ce qui était toute la faiblesse de l'ancien système.
  window.oncontextmenu = (e) => {
    afterMath(e);
    e.preventDefault();
  };

  window.onclick = afterMath;

  // Historique du presse-papiers : on écoute les copies faites partout dans
  // l'OS. L'historique reste local au navigateur — voir src/apps/clipboard.js.
  useEffect(() => ecouterLesCopies(), []);

  // Les liens mailto: de toute l'interface ouvrent le Courrier.
  useEffect(() => intercepterMailto(), []);

  // Notifications de l'espace de travail. La synchronisation démarre une
  // fois pour toutes : sans session elle ne fait rien, et la connexion la
  // relance d'elle-même — voir src/apps/notifications.js.
  useEffect(() => demarrerSyncNotifications(), []);

  // Garde-fou du glisser-déposer.
  //
  // Sans cela, lâcher un fichier ailleurs que sur une zone de dépôt fait ce
  // que fait un navigateur par défaut : il ouvre le fichier, donc il quitte
  // CompanyOS. Déposer une vidéo à côté de l'Explorateur remplaçait l'OS
  // par la vidéo. On neutralise le comportement natif au niveau de la
  // fenêtre ; les zones de dépôt réelles ont déjà traité l'événement quand
  // il arrive ici, leur fonctionnement n'est pas touché.
  useEffect(() => {
    const bloquer = (e) => e.preventDefault();
    window.addEventListener("dragover", bloquer);
    window.addEventListener("drop", bloquer);
    return () => {
      window.removeEventListener("dragover", bloquer);
      window.removeEventListener("drop", bloquer);
    };
  }, []);

  window.onload = (e) => {
    dispatch({ type: "WALLBOOTED" });
  };

  // Restauration de session : un jeton valide en localStorage remet
  // l'espace de travail et ses modules en place, écran verrouillé ou non.
  // Les applications système existent avant toute session : elles font
  // partie du socle, pas du catalogue d'un espace de travail.
  useEffect(() => {
    attachSystemModules();
    // La langue effective (réglage épinglé ou détection du navigateur)
    // s'applique dès le démarrage — voir src/utils/langue.js.
    appliquerLangue();
  }, []);

  useEffect(() => {
    const boot = async () => {
      if (!getToken()) {
        // Un visiteur sans compte arrive sur la vitrine, pas sur un écran
        // de connexion nu. La landing ramène ici avec `?connexion` pour
        // s'inscrire ou entrer — et quiconque a déjà un jeton ne voit
        // jamais ce détour.
        if (!window.location.search.includes("connexion")) {
          window.location.replace("landing.html");
          return;
        }
        dispatch({ type: "SESSION_CLEAR" });
        return;
      }
      try {
        const me = await api.me();
        dispatch({ type: "SESSION_SET", payload: me });
        dispatch({
          type: "STNGSETV",
          payload: { path: "person.name", value: me.user.name },
        });
        await syncInstalledModules();
        await appliquerApparence(me.tenant.id);
        await demarrerPreferences(me.tenant.id);
      } catch (err) {
        // API injoignable : on garde le jeton, la session repartira au
        // prochain chargement. Seul un 401 signifie un jeton mort.
        if (err.status === 401) clearToken();
        dispatch({ type: "SESSION_CLEAR" });
        detachAllModules();
        arreterPreferences();
        reinitialiserApparence();
      }
    };
    boot();
  }, []);

  // Sans session, pas de bureau : on revient à l'écran de connexion.
  useEffect(() => {
    if (session.status === "anonymous" && !wall.locked) {
      dispatch({ type: "WALLALOCK" });
    }
  }, [session.status, wall.locked]);

  useEffect(() => {
    if (!window.onstart) {
      loadSettings();
      window.onstart = setTimeout(() => {
        // console.log("prematurely loading ( ﾉ ﾟｰﾟ)ﾉ");
        dispatch({ type: "WALLBOOTED" });
      }, 5000);
    }
  });

  return (
    <div className="App">
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        {!wall.booted ? <BootScreen dir={wall.dir} /> : null}
        {wall.locked ? <LockScreen dir={wall.dir} /> : null}
        <div className="appwrap">
          <Background />
          <div className="desktop">
            <DesktopApp />
            {Object.keys(Applications).map((key, idx) => {
              var WinApp = Applications[key];
              return <WinApp key={idx} />;
            })}
            {/* Applications : `ModuleWindow` ne rend rien tant que le module
                n'est pas monté dans le shell. Les modules système le sont
                toujours, les modules métier seulement une fois installés. */}
            {modulesTous.map((mod) => (
              <AppMontee key={mod.id || mod.slug || mod.icon} mod={mod} />
            ))}
            {/* Applications créées dans le Studio : pas de code, une
                définition rendue par le moteur générique. Deux genres —
                une app de données (collections et fiches) ou une app
                « site web » (une adresse présentée comme une app). */}
            {customApps.map((app) =>
              app.definition?.genre === "web" ? (
                <CustomWebApp key={app.slug} app={app} />
              ) : (
                <CustomApp key={app.slug} app={app} />
              ),
            )}
            <StartMenu />
            <BandPane />
            <SidePane />
            <CalnWid />
          </div>
          <Taskbar />
          <SavePicker />
          <ModalHost />
          {/* Branche `choisirProduit()` : le catalogue devient accessible
              depuis n'importe quel module, pas seulement depuis Stock. */}
          <HoteSelecteurProduit />
          <HoteSelecteurClient />
          <HoteMenuContextuel />
        </div>
      </ErrorBoundary>
    </div>
  );
}

export default App;

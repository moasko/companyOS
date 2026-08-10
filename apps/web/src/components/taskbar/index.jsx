import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Icon } from "../../utils/general";
import { changeTheme } from "../../actions";
import {
  depuis,
  marquerLue,
  nonLues,
  retirerNotification,
  subscribeNotifications,
  suivreLien,
  toutMarquerLu,
  viderNotifications,
} from "../../apps/notifications";
import { modal } from "../../apps/modalRequest";
import { menuContextuel } from "../../apps/menuRequest";
import { ouvrirFenetre } from "../../apps/windows";
import { fuseauEffectif } from "../../utils/heure";
import { localeEffective } from "../../utils/langue";
import { useTraduction } from "../../utils/intl";
import "./taskbar.scss";

const TEXTES = {
  fr: {
    effacerTitre: "Effacer les notifications",
    effacerMsg: "Toutes vos notifications seront supprimées, sur tous vos appareils.",
    effacer: "Effacer",
    notifications: "Notifications",
    toutLu: "Tout marquer comme lu",
    aucune: "Aucune notification.",
    aligner: "Aligner les icônes",
    aGauche: "À gauche",
    auCentre: "Au centre",
    gestionnaire: "Gestionnaire des tâches",
    parametresBarre: "Paramètres de la barre des tâches",
    afficherBureau: "Afficher le bureau",
    quitterPleinEcran: "Quitter le plein écran",
    pleinEcran: "Plein écran",
    themeClair: "Passer en thème clair",
    themeSombre: "Passer en thème sombre",
    nonConnecte: "Non connecté",
  },
  en: {
    effacerTitre: "Clear notifications",
    effacerMsg: "All your notifications will be deleted, on all your devices.",
    effacer: "Clear",
    notifications: "Notifications",
    toutLu: "Mark all as read",
    aucune: "No notifications.",
    aligner: "Align icons",
    aGauche: "Left",
    auCentre: "Center",
    gestionnaire: "Task manager",
    parametresBarre: "Taskbar settings",
    afficherBureau: "Show the desktop",
    quitterPleinEcran: "Exit full screen",
    pleinEcran: "Full screen",
    themeClair: "Switch to light theme",
    themeSombre: "Switch to dark theme",
    nonConnecte: "Not signed in",
  },
};

/// Volet des notifications, ouvert depuis la barre des tâches.
/// Effacer la pile n'est plus un geste local depuis que les notifications
/// vivent sur le serveur : elle disparaît de tous les postes, sans retour
/// possible. Un clic à côté du bouton ne doit pas suffire.
const effacerTout = async (t) => {
  const ok = await modal.confirm({
    title: t("effacerTitre"),
    message: t("effacerMsg"),
    confirmLabel: t("effacer"),
    danger: true,
  });
  if (ok) viderNotifications();
};

const VoletNotifications = ({ liste, onFermer }) => {
  const t = useTraduction(TEXTES);
  return (
  <div className="tbVolet" onClick={(e) => e.stopPropagation()}>
    <div className="tbVoletTete">
      <span>{t("notifications")}</span>
      {liste.length ? (
        <>
          <span className="tbVoletLien" onClick={toutMarquerLu}>
            {t("toutLu")}
          </span>
          <span className="tbVoletLien" onClick={() => effacerTout(t)}>
            {t("effacer")}
          </span>
        </>
      ) : null}
      <Icon fafa="faXmark" width={11} onClick={onFermer} />
    </div>

    <div className="tbVoletCorps cosScroll">
      {!liste.length ? (
        <div className="tbVoletVide">
          <Icon fafa="faBellSlash" width={22} />
          <span>{t("aucune")}</span>
        </div>
      ) : (
        liste.map((n) => (
          <div
            key={n.id}
            className="tbNotif"
            data-ton={n.ton}
            data-lue={n.lue ? "true" : "false"}
            data-lien={n.lien ? "true" : "false"}
            onClick={() => {
              marquerLue(n.id);
              // Une notification qui mène quelque part y mène : cliquer
              // « Awa vous a attribué une tâche » doit ouvrir la tâche,
              // pas seulement éteindre la pastille.
              if (suivreLien(n)) onFermer();
            }}
          >
            <div className="tbNotifTete">
              <span className="tbNotifTitre">{n.titre}</span>
              <Icon
                fafa="faXmark"
                width={9}
                onClick={(e) => {
                  e.stopPropagation();
                  retirerNotification(n.id);
                }}
              />
            </div>
            {n.message ? <div className="tbNotifTexte">{n.message}</div> : null}
            <div className="tbNotifPied">
              {n.app ? `${n.app} · ` : ""}
              {depuis(n.date)}
            </div>
          </div>
        ))
      )}
    </div>
  </div>
  );
};

const Taskbar = () => {
  const t = useTraduction(TEXTES);
  const tasks = useSelector((state) => {
    return state.taskbar;
  });
  const session = useSelector((state) => state.session);
  // Deux défauts dans la version d'origine, tous deux réels :
  //
  //   1. `{ ...state.apps }` est une copie **de surface** : `tmpApps[icon]`
  //      est le même objet que dans le store. Poser `.task = true` écrivait
  //      donc dans l'état Redux depuis un sélecteur, hors de tout réducteur,
  //      et le drapeau n'était jamais remis à false.
  //   2. Un sélecteur qui rend un nouvel objet à chaque appel force un rendu
  //      de toute la barre des tâches à **chaque** action, quelle qu'elle
  //      soit — et il y en a beaucoup, ne serait-ce que le sondage des
  //      notifications.
  //
  // On sélectionne donc les tranches brutes, et on dérive à part.
  const appsBrutes = useSelector((state) => state.apps);

  const apps = useMemo(() => {
    const derive = {};
    for (const [cle, valeur] of Object.entries(appsBrutes)) {
      // `hz` est le compteur de plans, pas une application.
      derive[cle] = cle === "hz" ? valeur : { ...valeur, task: false };
    }
    for (const t of tasks.apps) {
      if (derive[t.icon]) derive[t.icon].task = true;
    }
    return derive;
  }, [appsBrutes, tasks.apps]);

  // Fenêtres ouvertes hors des épinglées, dans l'ordre où on les a
  // ouvertes. Trier sur ce rang — et non sur l'ordre des clés de l'état,
  // qui suit l'attachement des modules — fixe la place de chaque icône :
  // une fenêtre qui s'ouvre arrive en fin de rangée et n'en bouge plus.
  const ouvertes = useMemo(
    () =>
      Object.entries(apps)
        .filter(
          ([cle, a]) =>
            cle !== "hz" &&
            cle !== "undefined" &&
            a &&
            typeof a === "object" &&
            !a.task &&
            !a.hide,
        )
        .sort((a, b) => (a[1].ouvert || 0) - (b[1].ouvert || 0)),
    [apps],
  );
  const dispatch = useDispatch();
  const theme = useSelector((state) => state.setting.person.theme);

  // ---- Boutons système de la barre des tâches -----------------------------

  const [pleinEcran, setPleinEcran] = useState(!!document.fullscreenElement);
  const [notifs, setNotifs] = useState([]);
  const [voletOuvert, setVoletOuvert] = useState(false);

  useEffect(() => subscribeNotifications(setNotifs), []);

  // L'état plein écran peut aussi changer sans nous — touche F11, Échap :
  // on écoute l'événement plutôt que de supposer.
  useEffect(() => {
    const suivre = () => setPleinEcran(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", suivre);
    return () => document.removeEventListener("fullscreenchange", suivre);
  }, []);

  // Un clic ailleurs referme le volet.
  useEffect(() => {
    if (!voletOuvert) return;
    const fermer = () => setVoletOuvert(false);
    window.addEventListener("click", fermer);
    return () => window.removeEventListener("click", fermer);
  }, [voletOuvert]);

  const basculerPleinEcran = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const compteurNonLues = notifs.filter((n) => !n.lue).length;

  const showPrev = (event) => {
    var ele = event.target;
    while (ele && ele.getAttribute("value") == null) {
      ele = ele.parentElement;
    }

    var appPrev = ele.getAttribute("value");
    var xpos = window.scrollX + ele.getBoundingClientRect().left;

    var offsetx = Math.round((xpos * 10000) / window.innerWidth) / 100;

    dispatch({
      type: "TASKPSHOW",
      payload: {
        app: appPrev,
        pos: offsetx,
      },
    });
  };

  const hidePrev = () => {
    dispatch({ type: "TASKPHIDE" });
  };

  const clickDispatch = (event) => {
    var action = {
      type: event.target.dataset.action,
      payload: event.target.dataset.payload,
    };

    if (action.type) {
      dispatch(action);
    }
  };

  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="taskbar">
      <div className="taskcont">
        <div
          className="tasksCont"
          data-side={tasks.align}
          onContextMenu={(e) =>
            menuContextuel(e, [
              {
                nom: t("aligner"),
                icone: "faAlignCenter",
                sousMenu: [
                  {
                    nom: t("aGauche"),
                    coche: tasks.align === "left",
                    action: () => dispatch({ type: "TASKLEF" }),
                  },
                  {
                    nom: t("auCentre"),
                    coche: tasks.align === "center",
                    action: () => dispatch({ type: "TASKCEN" }),
                  },
                ],
              },
              { separateur: true },
              {
                nom: t("gestionnaire"),
                icone: "faChartLine",
                action: () => ouvrirFenetre("taskmanager"),
              },
              {
                nom: t("parametresBarre"),
                icone: "faGear",
                action: () => ouvrirFenetre("settings"),
              },
              { separateur: true },
              {
                nom: t("afficherBureau"),
                icone: "faDesktop",
                action: () => dispatch({ type: "SHOWDSK" }),
              },
            ])
          }
        >
          <div className="tsbar" onMouseOut={hidePrev}>
            <Icon
              className="tsIcon"
              src="/img/asset/logo.svg"
              ext
              width={24}
              click="STARTOGG"
            />
            {tasks.search ? (
              <Icon
                click="STARTSRC"
                className="tsIcon searchIcon"
                src="search"
                width={24}
              />
            ) : null}
            {tasks.apps.map((task) => {
              var isHidden = apps[task.icon].hide;
              var isActive = apps[task.icon].z == apps.hz;
              return (
                <div
                  key={task.icon}
                  onMouseOver={(!isActive && !isHidden && showPrev) || null}
                  value={task.icon}
                >
                  <Icon
                    className="tsIcon"
                    width={24}
                    open={isHidden ? null : true}
                    click={task.action}
                    active={isActive}
                    payload="togg"
                    src={task.icon}
                  />
                </div>
              );
            })}
            {ouvertes.map(([cle, app]) => {
              const isActive = app.z == apps.hz;
              return (
                <div
                  key={cle}
                  onMouseOver={(!isActive && showPrev) || null}
                  value={app.icon}
                >
                  <Icon
                    className="tsIcon"
                    width={24}
                    active={isActive}
                    click={app.action}
                    payload="togg"
                    open="true"
                    src={app.icon}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div className="taskright">
          <div
            className="px-2 prtclk handcr hvlight flex"
            onClick={clickDispatch}
            data-action="BANDTOGG"
          >
            <Icon fafa="faChevronUp" width={10} />
          </div>

          {/* Boutons système : plein écran, thème, notifications. */}
          <div
            className="tbBouton"
            title={pleinEcran ? t("quitterPleinEcran") : t("pleinEcran")}
            onClick={basculerPleinEcran}
          >
            <Icon fafa={pleinEcran ? "faCompress" : "faExpand"} width={12} />
          </div>

          <div
            className="tbBouton"
            title={theme === "dark" ? t("themeClair") : t("themeSombre")}
            onClick={changeTheme}
          >
            <Icon fafa={theme === "dark" ? "faSun" : "faMoon"} width={12} />
          </div>

          <div className="tbBoutonNotif">
            <div
              className="tbBouton"
              data-actif={voletOuvert ? "true" : "false"}
              title={t("notifications")}
              onClick={(e) => {
                e.stopPropagation();
                setVoletOuvert((v) => !v);
              }}
            >
              <Icon fafa={compteurNonLues ? "faBell" : "faBellSlash"} width={12} />
              {compteurNonLues ? (
                <span className="tbPastille">
                  {compteurNonLues > 9 ? "9+" : compteurNonLues}
                </span>
              ) : null}
            </div>
            {voletOuvert ? (
              <VoletNotifications liste={notifs} onFermer={() => setVoletOuvert(false)} />
            ) : null}
          </div>
          {/* Indicateur de session : ouvre le volet rapide (thème,
              stockage, compte). Un OS web n'a ni wifi, ni son, ni batterie
              à exposer — le navigateur s'en occupe. */}
          <div
            className="prtclk handcr my-1 px-2 hvlight flex items-center rounded taskSession"
            onClick={clickDispatch}
            data-action="PANETOGG"
          >
            <Icon fafa="faUser" width={11} />
            <span className="taskSessionName">
              {session.tenant?.name || t("nonConnecte")}
            </span>
          </div>

          <div
            className="taskDate m-1 handcr prtclk rounded hvlight"
            onClick={clickDispatch}
            data-action="CALNTOGG"
          >
            <div>
              {time.toLocaleTimeString(localeEffective(), {
                hour: "numeric",
                minute: "numeric",
                timeZone: fuseauEffectif(),
              })}
            </div>
            <div>
              {time.toLocaleDateString(localeEffective(), {
                year: "2-digit",
                month: "2-digit",
                day: "numeric",
                timeZone: fuseauEffectif(),
              })}
            </div>
          </div>
          <Icon className="graybd my-4" ui width={6} click="SHOWDSK" pr />
        </div>
      </div>
    </div>
  );
};

export default Taskbar;

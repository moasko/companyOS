import { useEffect, useMemo, useRef, useState } from "react";
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
import { activerPush, desactiverPush, etatPush } from "../../apps/push";
import { modal } from "../../apps/modalRequest";
import { menuContextuel } from "../../apps/menuRequest";
import { fermerFenetre, ouvrirFenetre, reduireFenetre } from "../../apps/windows";
import { useNomApp } from "../../utils/nomsApps";
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
    pushTitre: "Sur cet appareil",
    pushActif: "Vous êtes prévenu même CompanyOS fermé.",
    pushInactif: "Être prévenu même CompanyOS fermé.",
    pushRefuse: "Bloquées dans les réglages du navigateur.",
    pushActiver: "Activer",
    pushDesactiver: "Désactiver",
    ouvrir: "Ouvrir",
    premierPlan: "Mettre au premier plan",
    reduire: "Réduire",
    fermer: "Fermer la fenêtre",
    epingler: "Épingler à la barre des tâches",
    desepingler: "Détacher de la barre des tâches",
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
    pushTitre: "On this device",
    pushActif: "You're notified even when CompanyOS is closed.",
    pushInactif: "Get notified even when CompanyOS is closed.",
    pushRefuse: "Blocked in your browser settings.",
    pushActiver: "Turn on",
    pushDesactiver: "Turn off",
    ouvrir: "Open",
    premierPlan: "Bring to front",
    reduire: "Minimize",
    fermer: "Close window",
    epingler: "Pin to taskbar",
    desepingler: "Unpin from taskbar",
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

/// Le push sur cet appareil : s'affiche seulement si le navigateur sait
/// le recevoir (et que le service worker est là — pas en développement).
const ReglagePush = ({ t }) => {
  const [etat, setEtat] = useState(null);
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(false);
  useEffect(() => {
    let vivant = true;
    etatPush().then((e) => vivant && setEtat(e));
    return () => {
      vivant = false;
    };
  }, []);
  if (!etat || etat === "indisponible") return null;
  const basculer = async () => {
    setOccupe(true);
    setErreur("");
    try {
      setEtat(etat === "actif" ? await desactiverPush() : await activerPush());
    } catch (e) {
      setErreur(e.message);
      setEtat(await etatPush());
    } finally {
      setOccupe(false);
    }
  };
  return (
    <div className="tbPush">
      <Icon fafa={etat === "actif" ? "faBell" : "faBellSlash"} width={14} />
      <div className="tbPushTexte">
        <strong>{t("pushTitre")}</strong>
        <span>{erreur || t(etat === "actif" ? "pushActif" : etat === "refuse" ? "pushRefuse" : "pushInactif")}</span>
      </div>
      {etat !== "refuse" ? (
        <button type="button" className="tbPushBouton" disabled={occupe} onClick={basculer}>
          {t(etat === "actif" ? "pushDesactiver" : "pushActiver")}
        </button>
      ) : null}
    </div>
  );
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
    <ReglagePush t={t} />
  </div>
  );
};

const Taskbar = () => {
  const t = useTraduction(TEXTES);
  const tasks = useSelector((state) => {
    return state.taskbar;
  });
  const session = useSelector((state) => state.session);
  // On sélectionne les tranches brutes et on dérive à part : un sélecteur
  // qui rend un nouvel objet à chaque appel repeindrait toute la barre à
  // chaque action Redux.
  const apps = useSelector((state) => state.apps);
  const nomApp = useNomApp();

  const estFenetre = (cle, a) => cle !== "hz" && cle !== "undefined" && a && typeof a === "object";

  // Épinglées : dans l'ordre choisi. Une app désinstallée depuis disparaît
  // de la barre sans la casser (elle plantait sur `apps[...]` indéfini).
  const epinglees = useMemo(
    () => tasks.epingles.filter((cle) => estFenetre(cle, apps[cle])).map((cle) => [cle, apps[cle]]),
    [apps, tasks.epingles],
  );

  // Fenêtres ouvertes hors des épinglées, dans l'ordre où on les a
  // ouvertes. Trier sur ce rang — et non sur l'ordre des clés de l'état,
  // qui suit l'attachement des modules — fixe la place de chaque icône :
  // une fenêtre qui s'ouvre arrive en fin de rangée et n'en bouge plus.
  const ouvertes = useMemo(
    () =>
      Object.entries(apps)
        .filter(([cle, a]) => estFenetre(cle, a) && !a.hide && !tasks.epingles.includes(cle))
        .sort((a, b) => (a[1].ouvert || 0) - (b[1].ouvert || 0)),
    [apps, tasks.epingles],
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
    const surTouche = (e) => e.key === "Escape" && fermer();
    window.addEventListener("click", fermer);
    window.addEventListener("keydown", surTouche);
    return () => {
      window.removeEventListener("click", fermer);
      window.removeEventListener("keydown", surTouche);
    };
  }, [voletOuvert]);

  const basculerPleinEcran = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const compteurNonLues = notifs.filter((n) => !n.lue).length;

  // ---- Icônes des applications ---------------------------------------------

  /// Menu d'une icône : ce qu'on peut faire de cette application-là,
  /// plutôt que le menu général de la barre qu'on obtenait partout.
  const menuIcone = (cle, app) => (e) => {
    const ouverte = !app.hide;
    const active = ouverte && app.max && app.z == apps.hz;
    const epinglee = tasks.epingles.includes(cle);
    menuContextuel(e, [
      { titre: nomApp(app) },
      !ouverte
        ? { nom: t("ouvrir"), icone: "faArrowUpRightFromSquare", action: () => ouvrirFenetre(cle) }
        : active
          ? { nom: t("reduire"), icone: "faWindowMinimize", action: () => reduireFenetre(cle) }
          : { nom: t("premierPlan"), icone: "faWindowRestore", action: () => ouvrirFenetre(cle) },
      {
        nom: epinglee ? t("desepingler") : t("epingler"),
        icone: "faThumbtack",
        action: () => dispatch({ type: epinglee ? "TASKUNPIN" : "TASKPIN", payload: cle }),
      },
      ouverte && { separateur: true },
      ouverte && { nom: t("fermer"), icone: "faXmark", action: () => fermerFenetre(cle) },
    ]);
  };

  // Glisser une icône épinglée la déplace dans la rangée ; glisser une
  // fenêtre ouverte parmi les épinglées l'épingle à cet endroit.
  // Une référence plutôt qu'un état : `dragover` arrive avant que React
  // ait repeint après `dragstart`, et un état lu là serait encore vide.
  const glissee = useRef(null);
  const deposerSur = (cible) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cle = glissee.current;
    glissee.current = null;
    if (!cle || cle === cible) return;
    const sans = tasks.epingles.filter((c) => c !== cle);
    const i = cible ? sans.indexOf(cible) : sans.length;
    const ordre = [...sans.slice(0, i < 0 ? sans.length : i), cle, ...sans.slice(i < 0 ? sans.length : i)];
    if (!tasks.epingles.includes(cle)) dispatch({ type: "TASKPIN", payload: cle });
    dispatch({ type: "TASKORDER", payload: ordre });
  };

  const proprietesIcone = (cle, app) => ({
    key: cle,
    value: app.icon,
    title: nomApp(app),
    draggable: true,
    onContextMenu: menuIcone(cle, app),
    onDragStart: (e) => {
      glissee.current = cle;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", cle);
    },
    onDragEnd: () => {
      glissee.current = null;
    },
    onDragOver: (e) => glissee.current && e.preventDefault(),
    onDrop: deposerSur(tasks.epingles.includes(cle) ? cle : null),
    // Clic du milieu sur une fenêtre ouverte : la fermer, comme un onglet.
    onAuxClick: (e) => {
      if (e.button === 1 && !app.hide) {
        e.preventDefault();
        fermerFenetre(cle);
      }
    },
  });

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

  // L'horloge n'affiche que les minutes : un rendu de toute la barre par
  // seconde ne servait à rien. On se cale sur le début de chaque minute.
  useEffect(() => {
    let minuteur;
    const programmer = () => {
      const maintenant = new Date();
      setTime(maintenant);
      minuteur = setTimeout(programmer, 60_000 - (maintenant.getSeconds() * 1000 + maintenant.getMilliseconds()) + 50);
    };
    programmer();
    // Retour sur l'onglet après une veille : l'heure est remise à jour tout
    // de suite plutôt qu'à la minute suivante.
    const surRetour = () => document.visibilityState === "visible" && setTime(new Date());
    document.addEventListener("visibilitychange", surRetour);
    return () => {
      clearTimeout(minuteur);
      document.removeEventListener("visibilitychange", surRetour);
    };
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
          <div className="tsbar" onDragOver={(e) => glissee.current && e.preventDefault()} onDrop={deposerSur(null)}>
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
            {[...epinglees, ...ouvertes].map(([cle, app]) => {
              const { key, ...props } = proprietesIcone(cle, app);
              const isActive = !app.hide && app.max && app.z == apps.hz;
              return (
                <div key={key} {...props}>
                  <Icon
                    className="tsIcon"
                    width={24}
                    open={app.hide ? null : true}
                    click={app.action}
                    active={isActive}
                    payload="togg"
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

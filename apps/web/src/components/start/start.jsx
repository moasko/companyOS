import React, { useEffect, useMemo, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { Icon } from "../../utils/general";
import { Avatar } from "../../apps/Avatar";
import { menuContextuel } from "../../apps/menuRequest";
import { ouvrirFenetre } from "../../apps/windows";
import { clearToken } from "../../api/client";
import { detachAllModules } from "../../apps/sync";
import { reinitialiserApparence } from "../../apps/appearance";
import { resynchroniserNotifications } from "../../apps/notifications";
import { creerTraducteur, useLangue, useTraduction } from "../../utils/intl";
import { useNomApp } from "../../utils/nomsApps";
import { CommandCenter } from "./CommandCenter";

const TEXTES = {
  fr: {
    ajoutRecent: "Ajouté récemment",
    instant: "À l'instant",
    roleOwner: "Propriétaire",
    roleAdmin: "Administrateur",
    roleMember: "Membre",
    compte: "Compte",
    monCompte: "Mon compte",
    espace: "Espace de travail",
    verrouiller: "Verrouiller",
    deconnexion: "Se déconnecter",
    redemarrer: "Redémarrer",
    arreter: "Arrêter",
    epinglees: "Épinglées",
    toutesLesApps: "Toutes les apps",
    recommande: "Recommandé",
    plus: "Plus",
    retour: "Retour",
    rechercher: "Rechercher",
    tabTout: "Tout",
    tabApps: "Applications",
    tabDocuments: "Documents",
    tabWeb: "Web",
    tabPlus: "Plus",
    meilleurResultat: "Meilleur résultat",
    appsPrincipales: "Applications principales",
    application: "Application",
    app: "App",
    ouvrir: "Ouvrir",
    marcheArret: "Marche/Arrêt",
  },
  en: {
    ajoutRecent: "Recently added",
    instant: "Just now",
    roleOwner: "Owner",
    roleAdmin: "Administrator",
    roleMember: "Member",
    compte: "Account",
    monCompte: "My account",
    espace: "Workspace",
    verrouiller: "Lock",
    deconnexion: "Sign out",
    redemarrer: "Restart",
    arreter: "Shut down",
    epinglees: "Pinned",
    toutesLesApps: "All apps",
    recommande: "Recommended",
    plus: "More",
    retour: "Back",
    rechercher: "Search",
    tabTout: "All",
    tabApps: "Apps",
    tabDocuments: "Documents",
    tabWeb: "Web",
    tabPlus: "More",
    meilleurResultat: "Best match",
    appsPrincipales: "Top apps",
    application: "Application",
    app: "App",
    ouvrir: "Open",
    marcheArret: "Power",
  },
};
const tStatique = creerTraducteur(TEXTES);

/// « Ajouté récemment », « il y a 5 min »… à partir d'un nombre de minutes.
/// Calculé à chaque affichage : l'ancienne version écrasait le nombre par
/// son libellé dans le store, ce qui figeait l'affichage pour la session.
const libelleUtilisation = (minutes) => {
  if (minutes == null) return "";
  if (minutes < 0) return tStatique("ajoutRecent");
  if (minutes < 10) return tStatique("instant");
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h`;
};

export const StartMenu = () => {
  const { align } = useSelector((state) => state.taskbar);
  // Ce sélecteur écrivait dans le store à chaque rendu, de trois façons :
  //
  //   — `arr.pnApps.push(…)` ajoutait des cases vides **dans le tableau du
  //     store**, faute de copie ;
  //   — `arr.rcApps[i].lastUsed = "À l'instant"` remplaçait un nombre de
  //     minutes par du texte, **définitivement** : la donnée d'origine était
  //     perdue au premier rendu, et le libellé se figeait pour la session ;
  //   — `arr.contApps = …` rangeait des données dérivées dans l'état.
  //
  // Tout cela se calcule ici, à partir des tranches brutes, sans y toucher.
  const menu = useSelector((state) => state.startmenu);
  const appsBrutes = useSelector((state) => state.apps);

  const t = useTraduction(TEXTES);
  const nomApp = useNomApp();
  const langue = useLangue();

  const start = useMemo(() => {
    // Cases vides pour compléter la dernière rangée de six.
    const manquantes = (6 - (menu.pnApps.length % 6)) % 6;
    const pnApps = [
      ...menu.pnApps,
      ...Array.from({ length: manquantes }, () => ({ empty: true })),
    ];

    const rcApps = menu.rcApps.map((app) => ({
      ...app,
      // Calculé à l'affichage, jamais écrit : le nombre de minutes reste
      // intact et le libellé se met à jour tout seul.
      derniereUtilisation: libelleUtilisation(app.lastUsed),
    }));

    // Le classement suit le nom **affiché** : en anglais, « Leave » se
    // range à L, pas au C de « Congés ». La langue est donc une
    // dépendance du calcul, au même titre que la liste des apps.
    const toutes = Object.keys(appsBrutes)
      .filter((x) => x !== "hz")
      .map((cle) => appsBrutes[cle])
      .sort((a, b) => nomApp(a).localeCompare(nomApp(b), langue));

    // 27 cases : une par lettre, plus une pour tout ce qui ne commence pas
    // par une lettre.
    const parLettre = Array.from({ length: 27 }, () => []);
    for (const app of toutes) {
      const code = nomApp(app).trim().toUpperCase().charCodeAt(0);
      parLettre[code > 64 && code < 91 ? code - 64 : 0].push(app);
    }

    return { ...menu, pnApps, rcApps, contApps: parLettre, allApps: toutes };
  }, [menu, appsBrutes, nomApp, langue]);

  const dispatch = useDispatch();
  const [centreCle, setCentreCle] = useState(0);

  const session = useSelector((state) => state.session);

  /// Fermer le menu Démarrer avant d'agir : sinon il reste ouvert par-dessus
  /// la fenêtre qu'on vient de demander.
  const fermerDemarrer = () => dispatch({ type: "STARTHID" });

  const menuProfil = () => {
    const roles = {
      OWNER: t("roleOwner"),
      ADMIN: t("roleAdmin"),
      MEMBER: t("roleMember"),
    };
    const connecte = session.status === "authenticated";

    return [
      connecte && { titre: roles[session.user.role] || t("compte") },
      {
        nom: t("monCompte"),
        icone: "faUser",
        desactive: !connecte,
        action: () => {
          fermerDemarrer();
          ouvrirFenetre("settings");
        },
      },
      {
        nom: t("espace"),
        icone: "faBuilding",
        desactive: !connecte,
        action: () => {
          fermerDemarrer();
          ouvrirFenetre("settings");
        },
      },
      { separateur: true },
      {
        nom: t("verrouiller"),
        icone: "faLock",
        raccourci: "Win+L",
        action: () => {
          fermerDemarrer();
          dispatch({ type: "WALLALOCK" });
        },
      },
      {
        nom: t("deconnexion"),
        icone: "faRightFromBracket",
        desactive: !connecte,
        danger: true,
        action: () => {
          fermerDemarrer();
          // Même séquence que « Changer de compte » sur l'écran de
          // verrouillage : jeton, session, modules, apparence, notifications.
          // En oublier un laisse des morceaux de l'espace précédent à
          // l'écran après la déconnexion.
          clearToken();
          dispatch({ type: "SESSION_CLEAR" });
          detachAllModules();
          reinitialiserApparence();
          resynchroniserNotifications();
          dispatch({ type: "WALLALOCK" });
        },
      },
    ];
  };

  const menuAlimentation = () => [
    {
      nom: t("verrouiller"),
      icone: "faLock",
      action: () => {
        fermerDemarrer();
        dispatch({ type: "WALLALOCK" });
      },
    },
    { separateur: true },
    {
      nom: t("redemarrer"),
      icone: "faRotateRight",
      action: () => {
        fermerDemarrer();
        dispatch({ type: "WALLRESTART" });
      },
    },
    {
      nom: t("arreter"),
      icone: "faPowerOff",
      danger: true,
      action: () => {
        fermerDemarrer();
        dispatch({ type: "WALLSHUTDN" });
      },
    },
  ];

  const clickDispatch = (event) => {
    var action = {
      type: event.target.dataset.action,
      payload: event.target.dataset.payload,
    };

    if (action.type) {
      dispatch(action);
    }

    if (action.type && action.payload == "full") {
      dispatch({
        type: "STARTHID",
      });
    }

    if (action.type == "STARTALPHA") {
      var target = document.getElementById("char" + action.payload);
      if (target) {
        target.parentNode.scrollTop = target.offsetTop;
      } else {
        const premiereLettre = document.getElementById("charA");
        if (premiereLettre) premiereLettre.parentNode.scrollTop = 0;
      }
    }
  };

  // Ctrl/⌘ + K devient le geste universel pour atteindre n'importe quelle
  // ressource de l'espace de travail. Il fonctionne même quand le bouton de
  // recherche est masqué dans les réglages de la barre des tâches.
  useEffect(() => {
    const clavier = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        dispatch({ type: "STARTSRC_OPEN" });
      }
    };
    window.addEventListener("keydown", clavier);
    return () => window.removeEventListener("keydown", clavier);
  }, [dispatch]);

  useEffect(() => {
    if (!start.hide && !start.menu) setCentreCle((cle) => cle + 1);
  }, [start.hide, start.menu]);

  const userName = useSelector((state) => state.setting.person.name);
  // La photo vient de la session, pas des réglages : elle appartient au
  // compte et suit la personne d'un poste à l'autre.
  const user = useSelector((state) => state.session.user);

  return (
    <div
      className="startMenu dpShad"
      data-hide={start.hide}
      style={{ "--prefix": "START" }}
      data-align={align}
    >
      {start.menu ? (
        <>
          <div className="stmenu" data-allapps={start.showAll}>
            <div className="menuUp">
              <div className="pinnedApps">
                <div className="stAcbar">
                  <div className="gpname">{t("epinglees")}</div>
                  <div
                    className="gpbtn prtclk"
                    onClick={clickDispatch}
                    data-action="STARTALL"
                  >
                    <div>{t("toutesLesApps")}</div>
                    <Icon fafa="faChevronRight" width={8} />
                  </div>
                </div>
                <div className="pnApps">
                  {start.pnApps.map((app, i) => {
                    return app.empty ? (
                      <div key={i} className="pnApp pnEmpty"></div>
                    ) : (
                      <div
                        key={i}
                        className="prtclk pnApp"
                        value={app.action != null}
                        onClick={clickDispatch}
                        data-action={app.action}
                        data-payload={app.payload || "full"}
                      >
                        <Icon className="pnIcon" src={app.icon} width={32} />
                        <div className="appName">{nomApp(app)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="recApps cosScroll">
                <div className="stAcbar">
                  <div className="gpname">{t("recommande")}</div>
                  <div className="gpbtn none">
                    <div>{t("plus")}</div>
                    <Icon fafa="faChevronRight" width={8} />
                  </div>
                </div>
                <div className="reApps">
                  {start.rcApps.slice(0, 6).map((app, i) => {
                    return app.name ? (
                      <div
                        key={i}
                        className="rnApp"
                        value={app.action != null}
                        onClick={clickDispatch}
                        data-action={app.action}
                        data-payload={app.payload || "full"}
                      >
                        <Icon className="pnIcon" src={app.icon} width={32} />
                        <div className="acInfo">
                          <div className="appName">{nomApp(app)}</div>
                          <div className="timeUsed">{app.derniereUtilisation}</div>
                        </div>
                      </div>
                    ) : null;
                  })}
                </div>
              </div>
            </div>
          </div>
          <div className="allCont" data-allapps={start.showAll}>
            <div className="appCont">
              <div className="stAcbar">
                <div className="gpname">{t("toutesLesApps")}</div>
                <div
                  className="gpbtn prtclk"
                  onClick={clickDispatch}
                  data-action="STARTALL"
                >
                  <Icon className="chevLeft" fafa="faChevronLeft" width={8} />
                  <div>{t("retour")}</div>
                </div>
              </div>
              <div className="allApps cosScroll" data-alpha={start.alpha}>
                {start.contApps.map((ldx, i) => {
                  if (ldx.length == 0) return null;

                  var tpApps = [];
                  tpApps.push(
                    <div
                      key={i}
                      className="allApp prtclk"
                      data-action="STARTALPHA"
                      onClick={clickDispatch}
                      id={`char${i == 0 ? "#" : String.fromCharCode(i + 64)}`}
                    >
                      <div className="ltName">
                        {i == 0 ? "#" : String.fromCharCode(i + 64)}
                      </div>
                    </div>,
                  );

                  ldx.forEach((app, j) => {
                    tpApps.push(
                      <div
                        key={app.name}
                        className="allApp prtclk"
                        onClick={clickDispatch}
                        data-action={app.action}
                        data-payload={app.payload || "full"}
                      >
                        <Icon className="pnIcon" src={app.icon} width={24} />
                        <div className="appName">{nomApp(app)}</div>
                      </div>,
                    );
                  });

                  return tpApps;
                })}
              </div>
              <div className="alphaBox" data-alpha={start.alpha}>
                <div className="alphaCont">
                  <div className="dullApp allApp">
                    <div className="ltName">&</div>
                  </div>
                  {start.contApps.map((ldx, i) => {
                    return (
                      <div
                        key={i}
                        className={ldx.length == 0 ? "dullApp allApp" : "allApp prtclk"}
                        data-action="STARTALPHA"
                        onClick={ldx.length == 0 ? null : clickDispatch}
                        data-payload={i == 0 ? "#" : String.fromCharCode(i + 64)}
                      >
                        <div className="ltName">
                          {i == 0 ? "#" : String.fromCharCode(i + 64)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
          <div className="menuBar">
            {/* Le profil est enfin cliquable : il portait déjà le curseur
                main, mais aucun geste ne lui était attaché. */}
            <div
              className="profile handcr"
              onClick={(e) => menuContextuel(e, menuProfil())}
            >
              <Avatar user={user} nom={userName} taille={26} />
              <div className="usName">{userName}</div>
            </div>

            {/* L'alimentation passe par le menu commun de l'OS. C'était un
                popover écrit à la main, avec ses propres SVG et son propre
                état Redux (`STARTPWC`) : trois façons de faire un menu dans
                le même produit, dont deux à maintenir pour rien. */}
            <div
              className="powerMenu handcr"
              title={t("marcheArret")}
              onClick={(e) => menuContextuel(e, menuAlimentation())}
            >
              <Icon fafa="faPowerOff" width={16} />
            </div>
          </div>
        </>
      ) : (
        !start.hide && (
          <CommandCenter
            key={centreCle}
            apps={start.allApps}
            nomApp={nomApp}
            fermer={() => dispatch({ type: "STARTHID" })}
          />
        )
      )}
    </div>
  );
};

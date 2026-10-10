import React, { useEffect, useMemo, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { Icon } from "../../utils/general";
import { Avatar } from "../../apps/Avatar";
import { menuContextuel } from "../../apps/menuRequest";
import { ouvrirFenetre } from "../../apps/windows";
import { api } from "../../api/client";
import { detachAllModules } from "../../apps/sync";
import { reinitialiserApparence } from "../../apps/appearance";
import { resynchroniserNotifications } from "../../apps/notifications";
import { creerTraducteur, useLangue, useTraduction } from "../../utils/intl";
import { useNomApp } from "../../utils/nomsApps";
import { CommandCenter } from "./CommandCenter";
import { modulesSysteme } from "../../apps/registry";
import { cleApp } from "../../reducers/apps";
import icones from "../../utils/apps";

/// Les applications du socle qui restent épinglées après les apps métier.
const SOCLE_EPINGLE = ["Explorateur de fichiers", "Paramètres", "Boutique"];
/// Les fenêtres du shell lui-même (Paramètres, Explorateur, Calculatrice…) :
/// elles ne sont pas des « applications installées ».
const NOMS_SHELL = new Set(icones.map((a) => a.name));
/// Les visionneuses (photos, PDF, vidéo…) : montées pour ouvrir les
/// fichiers, jamais proposées comme des applications.
const IDS_SYSTEME = new Set(modulesSysteme.map(cleApp));
/// Outils d'administration parmi elles (Automatisations) : épinglés pour
/// les administrateurs, qui sinon ne les trouvaient que dans « Toutes les
/// apps ».
const IDS_ADMIN = new Set(modulesSysteme.filter((m) => m.admin).map(cleApp));
const MAX_EPINGLEES = 18;

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
    epinglerBarre: "Épingler à la barre des tâches",
    desepinglerBarre: "Détacher de la barre des tâches",
    toutesLesApps: "Toutes les apps",
    recommande: "Récents",
    aucunRecent: "Les applications que vous ouvrez apparaîtront ici.",
    ouverteRecemment: "Ouverte récemment",
    ouverteMaintenant: "Ouverte",
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
    epinglerBarre: "Pin to taskbar",
    desepinglerBarre: "Unpin from taskbar",
    toutesLesApps: "All apps",
    recommande: "Recent",
    aucunRecent: "Apps you open will show up here.",
    ouverteRecemment: "Recently opened",
    ouverteMaintenant: "Open",
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

export const StartMenu = () => {
  const { align, epingles: epinglesBarre } = useSelector((state) => state.taskbar);
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
  const role = useSelector((state) => state.session.user?.role);
  const estAdmin = role === "OWNER" || role === "ADMIN";

  const t = useTraduction(TEXTES);
  const nomApp = useNomApp();
  const langue = useLangue();

  const start = useMemo(() => {
    const fenetres = Object.entries(appsBrutes)
      .filter(([id, app]) => id !== "hz" && app?.action)
      .map(([, app]) => app);
    const parNom = (a, b) => nomApp(a).localeCompare(nomApp(b), langue);

    // Épinglées : les applications **installées** de l'espace d'abord — la
    // Facturation, les Congés, les RH —, puis l'Explorateur, les Paramètres
    // et la Boutique. La liste figée d'origine épinglait la Calculatrice et
    // le Gestionnaire de tâches, et aucune des applications pour lesquelles
    // on paie l'abonnement.
    const metier = fenetres
      .filter((a) => (!IDS_SYSTEME.has(a.id) || (estAdmin && IDS_ADMIN.has(a.id))) && !NOMS_SHELL.has(a.name))
      .sort(parNom);
    const socle = SOCLE_EPINGLE.map((nom) => fenetres.find((a) => a.name === nom)).filter(
      Boolean,
    );
    const epinglees = [...metier, ...socle].slice(0, MAX_EPINGLEES);
    // Cases vides pour compléter la dernière rangée de six.
    const manquantes = (6 - (epinglees.length % 6)) % 6;
    const pnApps = [
      ...epinglees,
      ...Array.from({ length: manquantes }, () => ({ empty: true })),
    ];

    // Récents : les fenêtres réellement ouvertes pendant la session, de la
    // plus récente à la plus ancienne. « Recommandé » recopiait jusqu'ici
    // la liste épinglée, mot pour mot.
    const rcApps = fenetres
      .filter((a) => a.ouvert && (!IDS_SYSTEME.has(a.id) || IDS_ADMIN.has(a.id)))
      .sort((a, b) => b.ouvert - a.ouvert)
      .slice(0, 6)
      .map((app) => ({
        ...app,
        derniereUtilisation: app.hide ? tStatique("ouverteRecemment") : tStatique("ouverteMaintenant"),
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
  }, [menu, appsBrutes, nomApp, langue, estAdmin]);

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
          // Fermée côté serveur : un cookie copié ne servirait plus à rien.
          api.logout().catch(() => {});
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

  /// Clic droit sur une application du menu : l'ouvrir, ou l'épingler à
  /// la barre des tâches.
  const menuAppli = (app) => (e) => {
    const cle = app.id || app.icon;
    if (!app.action || !cle) return;
    const epinglee = epinglesBarre.includes(cle);
    menuContextuel(e, [
      { nom: t("ouvrir"), icone: "faArrowUpRightFromSquare", action: () => dispatch({ type: app.action, payload: app.payload || "full" }) },
      { separateur: true },
      {
        nom: epinglee ? t("desepinglerBarre") : t("epinglerBarre"),
        icone: "faThumbtack",
        action: () => dispatch({ type: epinglee ? "TASKUNPIN" : "TASKPIN", payload: cle }),
      },
    ]);
  };

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

  // Échap referme le menu, comme partout ailleurs.
  useEffect(() => {
    if (start.hide) return undefined;
    const fermer = (event) => {
      if (event.key === "Escape") dispatch({ type: "STARTHID" });
    };
    window.addEventListener("keydown", fermer);
    return () => window.removeEventListener("keydown", fermer);
  }, [start.hide, dispatch]);

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
                        onContextMenu={menuAppli(app)}
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
                  {!start.rcApps.length ? (
                    <div className="reVide">{t("aucunRecent")}</div>
                  ) : null}
                  {start.rcApps.slice(0, 6).map((app, i) => {
                    return app.name ? (
                      <div
                        key={i}
                        className="rnApp"
                        value={app.action != null}
                        onClick={clickDispatch}
                        onContextMenu={menuAppli(app)}
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
                        onContextMenu={menuAppli(app)}
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

import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import * as Actions from "../../actions";
import { getTreeValue } from "../../actions";
import { Icon } from "../../utils/general";
import { GRID } from "../../reducers/deskLayout";
import { api } from "../../api/client";
import { ensureRootFolder } from "../../apps/cloud";
import { applicationManquante, ouvrirFichier } from "../../apps/openRequest";
import { moduleById, modulesSysteme } from "../../apps/registry";
import { ouvrirCorbeille } from "../../apps/explorerRequest";
import { modal } from "../../apps/modalRequest";
import { menuContextuel } from "../../apps/menuRequest";
import { familleDe } from "../../apps/fileTypes";
import { ouvrirDossier } from "../../apps/explorerRequest";
import { ouvrirFenetre } from "../../apps/windows";
import {
  FileThumb,
  oublierApercu,
} from "../../containers/applications/apps/assets/FileThumb";
import { useTraduction } from "../../utils/intl";
import { useNomApp } from "../../utils/nomsApps";
import { localeEffective } from "../../utils/langue";
import { Calendrier } from "./Calendrier";
import "./searchpane.scss";
import "./sidepane.scss";
import "./startmenu.scss";

export * from "./start";

const TEXTES = {
  fr: {
    supprimerDossier: "Supprimer le dossier",
    supprimerFichier: "Supprimer le fichier",
    corbeilleQuestion: "Mettre « {nom} » à la corbeille ?",
    corbeilleDetailDossier:
      "Le dossier et tout ce qu'il contient partent avec lui. Récupérable pendant 30 jours.",
    corbeilleDetailFichier: "Récupérable pendant 30 jours depuis la corbeille.",
    mettreCorbeille: "Mettre à la corbeille",
    suppressionImpossible: "Suppression impossible",
    renommerDossier: "Renommer le dossier",
    renommerFichier: "Renommer le fichier",
    nouveauNom: "Nouveau nom",
    renommer: "Renommer",
    renommageImpossible: "Renommage impossible",
    nouveauDossier: "Nouveau dossier",
    nomDuDossier: "Nom du dossier",
    creer: "Créer",
    creationImpossible: "Création impossible",
    affichage: "Affichage",
    grandesIcones: "Grandes icônes",
    icnMoyennes: "Icônes moyennes",
    petitesIcones: "Petites icônes",
    afficherIcones: "Afficher les icônes",
    trierPar: "Trier par",
    nomTri: "Nom",
    taille: "Taille",
    date: "Date",
    actualiser: "Actualiser",
    reorganiser: "Réorganiser les icônes",
    fondSuivant: "Fond d'écran suivant",
    personnaliser: "Personnaliser",
    ouvrir: "Ouvrir",
    viderCorbeille: "Vider la corbeille",
    retirerBureau: "Retirer du bureau",
    epinglerBarre: "Épingler à la barre des tâches",
    desepinglerBarre: "Détacher de la barre des tâches",
    ouvrirExplorateur: "Ouvrir dans l'Explorateur",
    ouvrirAvec: "Ouvrir avec {app}",
    telecharger: "Télécharger",
    voirExplorateur: "Voir dans l'Explorateur",
    viderQuestion: "Supprimer définitivement tout ce qu'elle contient ?",
    viderDetail: "Cette action est irréversible et libère l'espace de stockage.",
    vider: "Vider",
    viderImpossible: "Impossible de vider",
    deposez: "Déposez vos fichiers sur le bureau",
    envoi: "Envoi de « {nom} » — {n} sur {total}",
    stockage: "Stockage",
    nonConnecte: "Non connecté",
    appManquante: "{app} n'est pas installée",
    appManquanteAide:
      "Ce fichier s'ouvre avec cette application. Installez-la depuis la Boutique, puis réessayez.",
    typeInconnu: "Aucune application pour ce type de fichier",
    typeInconnuAide: "Ouvrez-le depuis l'Explorateur pour le télécharger.",
  },
  en: {
    supprimerDossier: "Delete folder",
    supprimerFichier: "Delete file",
    corbeilleQuestion: "Move “{nom}” to the recycle bin?",
    corbeilleDetailDossier:
      "The folder and everything inside goes with it. Recoverable for 30 days.",
    corbeilleDetailFichier: "Recoverable for 30 days from the recycle bin.",
    mettreCorbeille: "Move to recycle bin",
    suppressionImpossible: "Could not delete",
    renommerDossier: "Rename folder",
    renommerFichier: "Rename file",
    nouveauNom: "New name",
    renommer: "Rename",
    renommageImpossible: "Could not rename",
    nouveauDossier: "New folder",
    nomDuDossier: "Folder name",
    creer: "Create",
    creationImpossible: "Could not create",
    affichage: "View",
    grandesIcones: "Large icons",
    icnMoyennes: "Medium icons",
    petitesIcones: "Small icons",
    afficherIcones: "Show icons",
    trierPar: "Sort by",
    nomTri: "Name",
    taille: "Size",
    date: "Date",
    actualiser: "Refresh",
    reorganiser: "Rearrange icons",
    fondSuivant: "Next wallpaper",
    personnaliser: "Personalize",
    ouvrir: "Open",
    viderCorbeille: "Empty recycle bin",
    retirerBureau: "Remove from desktop",
    epinglerBarre: "Pin to taskbar",
    desepinglerBarre: "Unpin from taskbar",
    ouvrirExplorateur: "Open in Explorer",
    ouvrirAvec: "Open with {app}",
    telecharger: "Download",
    voirExplorateur: "Show in Explorer",
    viderQuestion: "Permanently delete everything it contains?",
    viderDetail: "This cannot be undone and frees up storage space.",
    vider: "Empty",
    viderImpossible: "Could not empty",
    deposez: "Drop your files on the desktop",
    envoi: "Uploading “{nom}” — {n} of {total}",
    stockage: "Storage",
    nonConnecte: "Not signed in",
    appManquante: "{app} is not installed",
    appManquanteAide:
      "This file opens with that application. Install it from the Store, then try again.",
    typeInconnu: "No application for this file type",
    typeInconnuAide: "Open it from the Explorer to download it.",
  },
};

export const DesktopApp = () => {
  // Sélectionner brut, dériver dans un `useMemo` : un sélecteur qui construit
  // un objet renvoie une référence neuve à chaque passage du store, et
  // react-redux le signale — « Selector returned a different result when
  // called with the same parameters » — parce que cela rerend le bureau à
  // chaque action, y compris celles qui ne le concernent pas.
  const bureau = useSelector((state) => state.desktop);
  const epinglesBarre = useSelector((state) => state.taskbar.epingles);
  const t = useTraduction(TEXTES);
  const nomApp = useNomApp();

  // Les outils d'administration (Automatisations) n'ont pas d'icône de
  // bureau par défaut : les administrateurs ne les trouvaient que par la
  // recherche ou « Toutes les apps ». Ils apparaissent ici, comme sur
  // l'écran d'accueil du téléphone (Lanceur.jsx).
  const role = useSelector((state) => state.session.user?.role);
  const estAdmin = role === "OWNER" || role === "ADMIN";

  const deskApps = useMemo(() => {
    const outils = estAdmin
      ? modulesSysteme
          .filter((m) => m.admin && !bureau.apps.some((b) => b.action === m.action || b.name === m.name))
          .map((m) => ({ id: m.id, name: m.name, icon: m.icon, action: m.action, type: "app" }))
      : [];
    const apps = [...bureau.apps, ...outils];
    if (bureau.sort === "name") {
      apps.sort((a, b) => (a.name || "").localeCompare(b.name || "", "fr"));
    }
    // « Taille » et « Date » restent à faire : le tri hérité du projet
    // d'origine comparait des caractères pris à des positions calculées, ce
    // qui donnait un ordre arbitraire. Mieux vaut l'ordre d'ajout qu'un
    // classement qui a l'air d'en être un sans l'être.
    return { ...bureau, apps };
  }, [bureau, estAdmin]);

  const dispatch = useDispatch();

  const layout = useSelector((state) => state.deskLayout.positions);
  const tenantId = useSelector((state) => state.session.tenant?.id || null);
  const contRef = React.useRef(null);
  // Icône en cours de déplacement : { name, x, y }
  const [drag, setDrag] = useState(null);
  // Vrai dès que le pointeur a bougé assez pour que ce soit un glisser :
  // sert à annuler le clic d'ouverture qui suivrait.
  const moved = React.useRef(false);

  useEffect(() => {
    dispatch({ type: "DESKLAYOUT_LOAD", payload: tenantId });
  }, [tenantId]);

  // ---- Fichiers posés sur le bureau ---------------------------------------
  //
  // Le bureau n'est pas qu'un lanceur d'applications : c'est aussi un
  // dossier. Celui-ci s'appelle « Bureau » et vit à la racine du cloud de
  // l'espace de travail, donc il est visible dans l'Explorateur et compte
  // dans le quota comme n'importe quel autre dossier.

  const session = useSelector((state) => state.session);
  const cloudVersion = useSelector((state) => state.cloud.version);
  const [fichiers, setFichiers] = useState([]);
  const [corbeillePleine, setCorbeillePleine] = useState(false);
  const [depot, setDepot] = useState(false);
  const [envoi, setEnvoi] = useState(null);

  const chargerBureau = async () => {
    if (session.status !== "authenticated") {
      setFichiers([]);
      return setCorbeillePleine(false);
    }
    try {
      const [racine, corbeille] = await Promise.all([
        api.listFiles(null),
        api.listTrash().catch(() => []),
      ]);
      const bureau = racine.find((n) => n.type === "FOLDER" && n.name === "Bureau");
      // Pas de dossier « Bureau » : rien à afficher, et surtout on n'en
      // crée pas un vide de force — il naîtra au premier fichier déposé.
      setFichiers(bureau ? await api.listFiles(bureau.id) : []);
      // L'icône de la corbeille dit si elle contient quelque chose.
      setCorbeillePleine(corbeille.length > 0);
    } catch {
      setFichiers([]);
    }
  };

  useEffect(() => {
    chargerBureau();
  }, [session.status, tenantId, cloudVersion]);

  const deposer = async (e) => {
    e.preventDefault();
    setDepot(false);
    const liste = [...(e.dataTransfer?.files || [])];
    if (!liste.length || session.status !== "authenticated") return;

    const bureau = await ensureRootFolder("Bureau");
    for (let i = 0; i < liste.length; i++) {
      setEnvoi({ fait: i, total: liste.length, nom: liste[i].name });
      try {
        await api.uploadFile(liste[i], bureau);
      } catch {
        /* un échec ne doit pas interrompre les suivants */
      }
    }
    setEnvoi(null);
    // L'Explorateur suit, le quota affiché aussi.
    dispatch({ type: "CLOUD_TOUCH" });
  };

  const ouvrir = (node) => {
    // Un dossier posé sur le bureau ouvre l'Explorateur dessus.
    if (node.type === "FOLDER") {
      return dispatch({ type: "EXPLORER", payload: "full" });
    }
    if (ouvrirFichier(node, fichiers)) return;

    // L'OS sait lire ce fichier mais l'application n'est pas installée :
    // on le dit, au lieu de laisser le double-clic sans effet.
    const manquante = applicationManquante(node);
    if (manquante) {
      return modal.alert({
        title: t("appManquante", { app: moduleById[manquante.app]?.name || manquante.label }),
        message: t("appManquanteAide"),
      });
    }
    modal.alert({ title: t("typeInconnu"), message: t("typeInconnuAide") });
  };

  /// Suppression d'un élément du bureau : il part à la corbeille, comme
  /// depuis l'Explorateur — récupérable pendant 30 jours.
  const supprimer = async (node) => {
    const ok = await modal.confirm({
      title: node.type === "FOLDER" ? t("supprimerDossier") : t("supprimerFichier"),
      message: t("corbeilleQuestion", { nom: node.name }),
      detail:
        node.type === "FOLDER"
          ? t("corbeilleDetailDossier")
          : t("corbeilleDetailFichier"),
      confirmLabel: t("mettreCorbeille"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteNode(node.id);
      oublierApercu(node.id);
      dispatch({ type: "CLOUD_TOUCH" });
    } catch (err) {
      await modal.alert({
        title: t("suppressionImpossible"),
        message: err.message,
        tone: "error",
      });
    }
  };

  /// Renommer un élément du bureau.
  const renommer = async (node) => {
    const nom = await modal.prompt({
      title: node.type === "FOLDER" ? t("renommerDossier") : t("renommerFichier"),
      label: t("nouveauNom"),
      value: node.name,
      confirmLabel: t("renommer"),
    });
    if (!nom || nom === node.name) return;
    try {
      await api.renameNode(node.id, nom);
      dispatch({ type: "CLOUD_TOUCH" });
    } catch (err) {
      await modal.alert({ title: t("renommageImpossible"), message: err.message, tone: "error" });
    }
  };

  const telecharger = (node) => {
    // Passe par un lien : le jeton d'authentification voyage dans l'URL
    // signée, une balise <a> ne sait pas poser d'en-tête.
    api.streamUrl(node.id).then((url) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = node.name;
      a.click();
    });
  };

  const nouveauDossier = async () => {
    const nom = await modal.prompt({
      title: t("nouveauDossier"),
      label: t("nomDuDossier"),
      placeholder: "Documents",
      confirmLabel: t("creer"),
    });
    if (!nom) return;
    try {
      const bureau = await ensureRootFolder("Bureau");
      await api.createFolder(nom, bureau);
      dispatch({ type: "CLOUD_TOUCH" });
    } catch (err) {
      await modal.alert({ title: t("creationImpossible"), message: err.message, tone: "error" });
    }
  };

  // ---- Menus contextuels --------------------------------------------------
  //
  // Construits ici, au clic droit, à partir de l'élément visé : le bureau
  // est le seul à savoir si c'est une application, un fichier, un dossier ou
  // le vide. Le composant de menu, lui, ne fait que les afficher.

  const menuFond = (e) =>
    menuContextuel(e, [
      {
        nom: t("affichage"),
        icone: "faTableCellsLarge",
        sousMenu: [
          { nom: t("grandesIcones"), action: () => Actions.changeIconSize("large"), coche: deskApps.size >= 1.5 },
          { nom: t("icnMoyennes"), action: () => Actions.changeIconSize("medium"), coche: deskApps.size > 1 && deskApps.size < 1.5 },
          { nom: t("petitesIcones"), action: () => Actions.changeIconSize("small"), coche: deskApps.size <= 1 },
          { separateur: true },
          {
            nom: t("afficherIcones"),
            coche: !deskApps.hide,
            action: () => Actions.deskHide(),
          },
        ],
      },
      {
        nom: t("trierPar"),
        icone: "faArrowDownAZ",
        sousMenu: [
          { nom: t("nomTri"), action: () => Actions.changeSort("name"), coche: deskApps.sort === "name" },
          { nom: t("taille"), action: () => Actions.changeSort("size"), coche: deskApps.sort === "size" },
          { nom: t("date"), action: () => Actions.changeSort("date"), coche: deskApps.sort === "date" },
        ],
      },
      { nom: t("actualiser"), icone: "faRotate", raccourci: "F5", action: chargerBureau },
      { separateur: true },
      { nom: t("nouveauDossier"), icone: "faFolderPlus", action: nouveauDossier },
      { nom: t("reorganiser"), icone: "faBorderAll", action: () => dispatch({ type: "DESKLAYOUT_RESET" }) },
      { separateur: true },
      { nom: t("fondSuivant"), icone: "faImage", action: () => dispatch({ type: "WALLNEXT" }) },
      { nom: t("personnaliser"), icone: "faPalette", action: () => ouvrirFenetre("settings") },
    ]);

  const menuApplication = (app, estCorbeille) => (e) =>
    menuContextuel(e, [
      {
        nom: t("ouvrir"),
        icone: "faArrowUpRightFromSquare",
        action: () =>
          estCorbeille ? ouvrirCorbeille() : dispatch({ type: app.action, payload: "full" }),
      },
      { separateur: true },
      ...(estCorbeille
        ? [
            {
              nom: t("viderCorbeille"),
              icone: "faFireFlameSimple",
              danger: true,
              desactive: !corbeillePleine,
              action: viderCorbeille,
            },
          ]
        : [
            {
              nom: epinglesBarre.includes(app.id || app.icon) ? t("desepinglerBarre") : t("epinglerBarre"),
              icone: "faThumbtack",
              action: () =>
                dispatch({
                  type: epinglesBarre.includes(app.id || app.icon) ? "TASKUNPIN" : "TASKPIN",
                  payload: app.id || app.icon,
                }),
            },
            {
              nom: t("retirerBureau"),
              icone: "faEyeSlash",
              desactive: true,
            },
          ]),
      { separateur: true },
      { nom: t("reorganiser"), icone: "faBorderAll", action: () => dispatch({ type: "DESKLAYOUT_RESET" }) },
    ]);

  const menuFichier = (node) => (e) => {
    const famille = familleDe(node);
    return menuContextuel(e, [
      {
        nom: node.type === "FOLDER" ? t("ouvrirExplorateur") : t("ouvrir"),
        icone: node.type === "FOLDER" ? "faFolderOpen" : "faArrowUpRightFromSquare",
        action: () => ouvrir(node),
      },
      // On ne propose « Ouvrir avec » que si une application sait le lire :
      // une entrée qui échoue apprend à se méfier du menu entier.
      famille && {
        nom: t("ouvrirAvec", { app: famille.label }),
        image: famille.icone,
        action: () => ouvrirFichier(node, fichiers),
      },
      { separateur: true },
      { nom: t("renommer"), icone: "faPen", raccourci: "F2", action: () => renommer(node) },
      node.type === "FILE" && {
        nom: t("telecharger"),
        icone: "faDownload",
        action: () => telecharger(node),
      },
      {
        nom: t("voirExplorateur"),
        icone: "faFolderTree",
        action: () => ouvrirDossier(node.parentId),
      },
      { separateur: true },
      {
        nom: t("mettreCorbeille"),
        icone: "faTrashCan",
        raccourci: "Suppr",
        danger: true,
        action: () => supprimer(node),
      },
    ]);
  };

  /// Vider la corbeille depuis le bureau — irréversible, donc confirmé.
  const viderCorbeille = async () => {
    const ok = await modal.confirm({
      title: t("viderCorbeille"),
      message: t("viderQuestion"),
      detail: t("viderDetail"),
      confirmLabel: t("vider"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.emptyTrash();
      dispatch({ type: "CLOUD_TOUCH" });
    } catch (err) {
      await modal.alert({ title: t("viderImpossible"), message: err.message, tone: "error" });
    }
  };

  // Le pas de la grille suit la taille des icônes, sinon des icônes
  // agrandies se chevauchent.
  const echelle = deskApps.size || 1;
  const pas = {
    x: Math.round(GRID.x * echelle),
    y: Math.round(GRID.y * echelle),
    top: GRID.top,
    left: GRID.left,
  };

  /// Nombre de lignes par colonne, d'après la hauteur disponible.
  const lignesParColonne = () => {
    const hauteur =
      (contRef.current?.clientHeight || window.innerHeight - 48) - pas.top;
    return Math.max(1, Math.floor(hauteur / pas.y));
  };

  /// Case (colonne:ligne) d'une position en pixels — pour comparer des
  /// emplacements sans être trahi par un écart d'arrondi.
  const caseDe = (p) =>
    `${Math.round((p.x - pas.left) / pas.x)}:${Math.round((p.y - pas.top) / pas.y)}`;

  // Positions de toutes les icônes, calculées d'un seul tenant.
  //
  // Les icônes épinglées (déplacées à la main) gardent leur place. Les
  // autres coulent dans les cases restées libres, colonnes de haut en bas,
  // dans l'ordre du bureau — en sautant les cases occupées. C'est ce saut
  // qui rend la disposition stable : installer une application ou déposer
  // un fichier n'écrase plus une icône rangée, et ne décale plus les
  // voisines que d'une case libre, jamais sur quelqu'un.
  const positions = useMemo(() => {
    const jetons = [
      ...deskApps.apps.map((a) => a.name),
      ...fichiers.map((n) => `fichier:${n.id}`),
    ];
    const parColonne = lignesParColonne();
    const occupees = new Set();
    for (const nom of jetons) {
      if (layout[nom]) occupees.add(caseDe(layout[nom]));
    }
    const map = {};
    let cellule = 0;
    for (const nom of jetons) {
      if (layout[nom]) {
        map[nom] = layout[nom];
        continue;
      }
      while (
        occupees.has(
          `${Math.floor(cellule / parColonne)}:${cellule % parColonne}`,
        )
      ) {
        cellule += 1;
      }
      const col = Math.floor(cellule / parColonne);
      const ligne = cellule % parColonne;
      map[nom] = { x: pas.left + col * pas.x, y: pas.top + ligne * pas.y };
      occupees.add(`${col}:${ligne}`);
      cellule += 1;
    }
    return map;
  }, [deskApps.apps, fichiers, layout, pas.x, pas.y]);

  const positionDe = (app) =>
    positions[app.name] || { x: pas.left, y: pas.top };

  const onPointerDown = (app, index) => (e) => {
    // Bouton droit réservé au menu contextuel.
    if (e.button !== 0) return;

    const depart = positionDe(app, index);
    const origine = { x: e.clientX, y: e.clientY };
    moved.current = false;

    // Surtout pas de setPointerCapture : la capture redirige le clic de fin
    // de geste vers ce conteneur, il n'atteint donc plus l'icône et l'app
    // ne s'ouvre plus. Les écouteurs sur window suffisent à suivre le
    // pointeur, y compris hors de l'icône.

    const onMove = (ev) => {
      const dx = ev.clientX - origine.x;
      const dy = ev.clientY - origine.y;
      // Seuil : en deçà, c'est un clic, pas un déplacement. Tant qu'il
      // n'est pas franchi on ne rend rien, pour ne pas perturber le clic.
      if (!moved.current && Math.abs(dx) + Math.abs(dy) < 5) return;
      moved.current = true;
      setDrag({ name: app.name, x: depart.x + dx, y: depart.y + dy });
    };

    const onUp = (ev) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);

      if (moved.current) {
        const cont = contRef.current;
        const dx = ev.clientX - origine.x;
        const dy = ev.clientY - origine.y;
        // Aimantation sur la grille, en restant dans le bureau.
        const parColonne = lignesParColonne();
        const maxCol = Math.max(
          0,
          Math.floor(
            ((cont?.clientWidth || window.innerWidth) - pas.left - pas.x) / pas.x,
          ),
        );
        let col = Math.min(
          maxCol,
          Math.max(0, Math.round((depart.x + dx - pas.left) / pas.x)),
        );
        let ligne = Math.min(
          parColonne - 1,
          Math.max(0, Math.round((depart.y + dy - pas.top) / pas.y)),
        );
        // Une case n'accueille qu'une icône : si celle visée est prise, on
        // glisse à la première case libre qui suit — jamais l'une sur
        // l'autre.
        const occupees = new Set(
          Object.entries(positions)
            .filter(([nom]) => nom !== app.name)
            .map(([, p]) => caseDe(p)),
        );
        while (occupees.has(`${col}:${ligne}`)) {
          ligne += 1;
          if (ligne >= parColonne) {
            ligne = 0;
            col += 1;
          }
        }
        dispatch({
          type: "DESKLAYOUT_SET",
          payload: {
            name: app.name,
            x: pas.left + col * pas.x,
            y: pas.top + ligne * pas.y,
          },
        });
      }

      setDrag(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  /// Après un déplacement, le clic de fin de geste ne doit pas ouvrir l'app.
  const onClickCapture = (e) => {
    if (moved.current) {
      e.stopPropagation();
      e.preventDefault();
      moved.current = false;
    }
  };

  return (
    <div
      className="desktopCont"
      ref={contRef}
      style={{ "--dskScale": echelle }}
      data-depot={depot ? "true" : "false"}
      onDragOver={(e) => {
        e.preventDefault();
        setDepot(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDepot(false);
      }}
      onDrop={deposer}
      onContextMenu={menuFond}
    >
      {!deskApps.hide &&
        deskApps.apps.map((app, i) => {
          const base = positionDe(app, i);
          const pos = drag && drag.name === app.name ? drag : base;
          // La Corbeille n'a pas de fenêtre à elle : elle n'a donc aucune
          // action dans le catalogue, et cliquer dessus ne faisait rien.
          // Elle ouvre l'Explorateur sur la vue corbeille, et son icône
          // dit si elle contient quelque chose.
          const estCorbeille = app.name === "Corbeille";
          return (
            // to allow it to be focusable (:focus)
            <div
              key={app.name}
              className="dskApp"
              tabIndex={0}
              data-dragging={drag?.name === app.name}
              style={{ left: pos.x, top: pos.y }}
              onPointerDown={onPointerDown(app, i)}
              onClickCapture={onClickCapture}
              onDoubleClick={estCorbeille ? ouvrirCorbeille : undefined}
              onContextMenu={menuApplication(app, estCorbeille)}
            >
              <Icon
                click={estCorbeille ? null : app.action}
                onClick={estCorbeille ? ouvrirCorbeille : undefined}
                className="dskIcon prtclk"
                src={
                  estCorbeille
                    ? corbeillePleine
                      ? "bin1"
                      : "bin0"
                    : app.icon
                }
                payload={app.payload || "full"}
                pr
                width={Math.round(deskApps.size * 36)}
                menu="app"
              />
              <div className="appName">{nomApp(app)}</div>
            </div>
          );
        })}

      {/* Fichiers du dossier « Bureau », posés après les applications et
          déplaçables comme elles. La clé de disposition est préfixée pour
          ne jamais entrer en collision avec un nom d'application. */}
      {!deskApps.hide &&
        fichiers.map((node, i) => {
          const jeton = { name: `fichier:${node.id}` };
          const index = deskApps.apps.length + i;
          const base = positionDe(jeton, index);
          const pos = drag && drag.name === jeton.name ? drag : base;
          return (
            <div
              key={node.id}
              className="dskApp dskFichier"
              tabIndex={0}
              title={node.name}
              data-dragging={drag?.name === jeton.name}
              style={{ left: pos.x, top: pos.y }}
              onPointerDown={onPointerDown(jeton, index)}
              onClickCapture={onClickCapture}
              onDoubleClick={() => ouvrir(node)}
              onContextMenu={menuFichier(node)}
              onKeyDown={(e) => {
                if (e.key === "Delete") supprimer(node);
                if (e.key === "Enter") ouvrir(node);
                if (e.key === "F2") renommer(node);
              }}
            >
              <div
                className="dskIcon dskThumb"
                style={{ width: Math.round(deskApps.size * 36) }}
              >
                <FileThumb node={node} />
              </div>
              <div className="appName">{node.name}</div>
              <div
                className="dskSuppr"
                title={t("mettreCorbeille")}
                // Le clic ne doit ni sélectionner ni ouvrir la case.
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  supprimer(node);
                }}
              >
                <Icon fafa="faXmark" width={10} />
              </div>
            </div>
          );
        })}

      {depot ? (
        <div className="dskDepot">
          <Icon fafa="faCloudArrowUp" width={24} />
          <span>{t("deposez")}</span>
        </div>
      ) : null}

      {envoi ? (
        <div className="dskEnvoi">
          {t("envoi", { nom: envoi.nom, n: envoi.fait + 1, total: envoi.total })}
        </div>
      ) : null}
    </div>
  );
};

export const BandPane = () => {
  const sidepane = useSelector((state) => state.sidepane);

  return (
    <div
      className="bandpane dpShad"
      data-hide={sidepane.banhide}
      style={{ "--prefix": "BAND" }}
    >
      <div className="bandContainer">
        <Icon
          className="hvlight"
          width={17}
          click="CALCUAPP"
          payload="togg"
          open="true"
          src="calculator"
        />
        <Icon
          className="hvlight"
          width={17}
          click="NOTEPAD"
          payload="togg"
          src="notepad"
        />
      </div>
    </div>
  );
};

const formatBytes = (bytes) => {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
};

/// Volet rapide : ce qu'un OS web contrôle vraiment — le thème, le
/// stockage de l'espace de travail et la session. Pas de Wi-Fi, de
/// Bluetooth, de batterie ni de luminosité : le navigateur les gère.
export const SidePane = () => {
  const t = useTraduction(TEXTES);
  const sidepane = useSelector((state) => state.sidepane);
  const setting = useSelector((state) => state.setting);
  const session = useSelector((state) => state.session);
  const [pnstates, setPnstate] = useState([]);
  const dispatch = useDispatch();

  const clickDispatch = (event) => {
    var action = {
      type: event.target.dataset.action,
      payload: event.target.dataset.payload,
    };

    if (action.type) {
      if (action.type != action.type.toUpperCase()) {
        Actions[action.type](action.payload);
      } else dispatch(action);
    }
  };

  useEffect(() => {
    var tmp = [];
    for (var i = 0; i < sidepane.quicks.length; i++) {
      var val = getTreeValue(setting, sidepane.quicks[i].state);
      if (sidepane.quicks[i].name == "Thème") val = val == "dark";
      tmp.push(val);
    }

    setPnstate(tmp);
  }, [setting, sidepane]);

  const quota = session.tenant?.quota;
  const used = session.tenant?.usedBytes;
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0;

  return (
    <div
      className="sidePane dpShad"
      data-hide={sidepane.hide}
      style={{ "--prefix": "PANE" }}
    >
      <div className="quickSettings p-5 pb-4">
        <div className="qkCont">
          {sidepane.quicks.map((qk, idx) => {
            return (
              <div key={idx} className="qkGrp">
                <div
                  className="qkbtn handcr prtclk"
                  onClick={clickDispatch}
                  data-action={qk.action}
                  data-payload={qk.payload || qk.state}
                  data-state={pnstates[idx]}
                >
                  <Icon
                    className="quickIcon"
                    ui={qk.ui}
                    src={qk.src}
                    width={14}
                    invert={pnstates[idx] ? true : null}
                  />
                </div>
                <div className="qktext">{qk.name}</div>
              </div>
            );
          })}
        </div>
        {session.status === "authenticated" ? (
          <div className="paneStorage">
            <div className="paneStorageHead">
              <span>{t("stockage")}</span>
              <span>
                {formatBytes(used)} / {formatBytes(quota)}
              </span>
            </div>
            <div className="paneStorageBar">
              <div className="paneStorageFill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : null}
      </div>
      <div className="p-1 bottomBar">
        {session.status === "authenticated" ? (
          <div className="paneAccount px-3">
            <div className="paneUser">{session.user.name}</div>
            <div className="paneTenant">{session.tenant.name}</div>
          </div>
        ) : (
          <div className="paneAccount px-3">
            <div className="paneTenant">{t("nonConnecte")}</div>
          </div>
        )}
      </div>
    </div>
  );
};

export const CalnWid = () => {
  const sidepane = useSelector((state) => state.sidepane);

  const [collapse, setCollapse] = useState("");

  const collapseToggler = () => {
    collapse === "" ? setCollapse("collapse") : setCollapse("");
  };

  return (
    <div
      className={`calnpane ${collapse} dpShad`}
      data-hide={sidepane.calhide}
      style={{ "--prefix": "CALN" }}
    >
      <div className="topBar pl-4 text-sm">
        <div className="date">
          {new Date().toLocaleDateString(localeEffective(), {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </div>
        <div className="collapser p-2 m-4 rounded" onClick={collapseToggler}>
          {collapse === "" ? (
            <Icon fafa="faChevronDown" />
          ) : (
            <Icon fafa="faChevronUp" />
          )}
        </div>
      </div>
      <Calendrier />
    </div>
  );
};

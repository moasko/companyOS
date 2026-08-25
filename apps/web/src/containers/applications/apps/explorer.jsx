import React, { useState, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Icon, Image, ToolBar } from "../../../utils/general";
import { useNomApp } from "../../../utils/nomsApps";
import { api, getToken } from "../../../api/client";
import { FileThumb, oublierApercu } from "./assets/FileThumb";
import { modal } from "../../../apps/modalRequest";
import { applicationManquante, ouvrirFichier } from "../../../apps/openRequest";
import { consommerDemande } from "../../../apps/explorerRequest";
import { menuContextuel } from "../../../apps/menuRequest";
import { familleDe } from "../../../apps/fileTypes";
import { moduleBySlug, syncInstalledModules } from "../../../apps/sync";
import { moduleById } from "../../../apps/registry";
import { versionLivree } from "../../../apps/versions";
import "./assets/fileexpo.scss";

// L'Explorateur est le poste de pilotage du cloud CompanyOS : même
// habillage que l'explorateur Windows, mais chaque dossier et chaque
// fichier vit dans l'espace de stockage du tenant, servi par l'API.

const formatBytes = (bytes) => {
  if (bytes == null) return "";
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

export const Explorer = () => {
  const nomApp = useNomApp();
  const dispatch = useDispatch();
  const wnapp = useSelector((state) => state.apps.explorer);
  const session = useSelector((state) => state.session);
  // Incrémenté dès qu'une app écrit un fichier dans le cloud.
  const cloudVersion = useSelector((state) => state.cloud.version);

  // Fil de navigation : [{id:null, name:"Cloud"}, ...dossiers ouverts]
  const [path, setPath] = useState([{ id: null, name: "Cloud" }]);
  // Historique pour les flèches précédent / suivant.
  const [hist, setHist] = useState([[{ id: null, name: "Cloud" }]]);
  const [hid, setHid] = useState(0);
  const [nodes, setNodes] = useState([]);
  const [rootFolders, setRootFolders] = useState([]);
  const [usage, setUsage] = useState(null);
  // Sélection multiple : une liste d'ids, plus l'élément d'ancrage sur
  // lequel Maj+clic construit sa plage.
  const [selection, setSelection] = useState([]);
  const [anchor, setAnchor] = useState(null);
  // Vue « Corbeille » : le contenu ne vient plus du dossier courant.
  const [trash, setTrash] = useState(false);
  const [searchtxt, setShText] = useState("");
  const [view, setView] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Avancement d'un import multiple : { fait, total, nom }
  const [progres, setProgres] = useState(null);
  const [survolDepot, setSurvolDepot] = useState(false);
  const fileInput = useRef(null);

  const current = path[path.length - 1];

  const refresh = async () => {
    if (session.status !== "authenticated") return;
    try {
      const [list, use] = await Promise.all([
        trash ? api.listTrash() : api.listFiles(current.id),
        api.usage(),
      ]);
      setNodes(list);
      setUsage(use);
      // Le volet latéral garde l'arborescence vivante, même en corbeille.
      if (!trash && current.id == null) {
        setRootFolders(list.filter((n) => n.type === "FOLDER"));
      }
      setError("");
    } catch (err) {
      setError(err.message || "Cloud indisponible");
    }
  };

  useEffect(() => {
    if (!wnapp.hide) refresh();
  }, [wnapp.hide, session.status, current.id, cloudVersion, trash]);

  const viderSelection = () => {
    setSelection([]);
    setAnchor(null);
  };

  // Navigation : chaque déplacement alimente l'historique.
  const navigate = (newPath) => {
    const next = [...hist.slice(0, hid + 1), newPath];
    setHist(next);
    setHid(next.length - 1);
    setPath(newPath);
    setTrash(false);
    viderSelection();
    setShText("");
  };

  /// La corbeille n'est pas un dossier : elle sort du fil de navigation.
  const ouvrirCorbeille = () => {
    setTrash(true);
    viderSelection();
    setShText("");
  };

  // Ouverture demandée de l'extérieur — l'icône Corbeille du bureau, par
  // exemple, qui doit amener directement sur la vue corbeille.
  //
  // On vient chercher la demande à chaque fois que la fenêtre s'affiche,
  // plutôt que de compter sur un abonnement : celui-ci supposait que
  // l'Explorateur écoutait à l'instant précis où l'on parlait, ce qui n'est
  // pas garanti — il se réabonne à chaque navigation, et une demande
  // tombant dans cet intervalle était perdue.
  useEffect(() => {
    if (wnapp.hide) return;
    const vue = consommerDemande();
    if (vue === "corbeille") ouvrirCorbeille();
    else if (vue === "cloud") navigate([{ id: null, name: "Cloud" }]);
    else if (vue?.vue === "dossier") {
      // On ne connaît que l'identifiant : le fil d'Ariane se réduit donc à
      // « Cloud › ce dossier ». Reconstituer le chemin complet demanderait
      // de remonter les parents un par un, pour un gain nul — la barre de
      // navigation reste utilisable.
      api
        .listFiles(null)
        .then((racine) => {
          const dossier = racine.find((n) => n.id === vue.id);
          navigate([
            { id: null, name: "Cloud" },
            { id: vue.id, name: dossier?.name || "Dossier" },
          ]);
        })
        .catch(() => navigate([{ id: null, name: "Cloud" }]));
    }
  }, [wnapp.hide, wnapp.z]);

  const goPrev = () => {
    if (trash) return setTrash(false);
    if (hid > 0) {
      setHid(hid - 1);
      setPath(hist[hid - 1]);
      viderSelection();
    }
  };

  const goNext = () => {
    if (hid + 1 < hist.length) {
      setHid(hid + 1);
      setPath(hist[hid + 1]);
      viderSelection();
    }
  };

  const goUp = () => {
    if (path.length > 1) navigate(path.slice(0, -1));
  };

  /// Double-clic : on entre dans un dossier, sinon on ouvre le fichier
  /// dans l'application associée à son type — Photos, Musique, Vidéo…
  /// Les associations vivent dans src/apps/fileTypes.js ; l'Explorateur
  /// n'a pas à connaître les visionneuses.
  ///
  /// Le contenu du dossier part avec : la visionneuse s'en sert pour
  /// feuilleter les images ou enchaîner les morceaux.
  const openNode = async (node) => {
    if (node.type === "FOLDER") {
      navigate([...path, { id: node.id, name: node.name }]);
      return;
    }
    if (ouvrirFichier(node, nodes)) return;

    // L'OS sait lire ce fichier, mais l'application n'est pas installée
    // dans cet espace. Le télécharger serait absurde — on propose de
    // l'installer, et le fichier s'ouvre dans la foulée.
    const manquante = applicationManquante(node);
    if (manquante) return proposerInstallation(node, manquante);

    // Personne ne sait lire ce type : le téléchargement reste la sortie
    // honnête, plutôt qu'un clic sans effet.
    download(node);
  };

  const proposerInstallation = async (node, famille) => {
    const mod = moduleById[famille.app];
    const slug = mod?.slug;
    if (!slug) return download(node);

    const ok = await modal.confirm({
      title: `Installer ${mod.name} ?`,
      message: `« ${node.name} » s'ouvre avec ${mod.name}, qui n'est pas encore installé dans cet espace de travail.`,
      detail: "L'installation est immédiate et réversible depuis la Boutique.",
      confirmLabel: "Installer et ouvrir",
    });
    if (!ok) return;

    try {
      const catalogue = await api.catalog();
      const entree = catalogue.find((a) => a.slug === slug);
      await api.installApp(slug, versionLivree(entree || { slug }, moduleBySlug));
      await syncInstalledModules();
      // La fenêtre existe désormais : la seconde tentative aboutit.
      if (!ouvrirFichier(node, nodes)) download(node);
    } catch (err) {
      modal.alert({
        title: "Installation impossible",
        message: err.message,
        detail: "Seul un administrateur de l'espace peut installer une application.",
        tone: "error",
      });
    }
  };

  const download = async (node) => {
    try {
      const res = await fetch(api.downloadUrl(node.id), {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error("Téléchargement impossible");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = node.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };

  const createFolder = async () => {
    const name = await modal.prompt({
      title: "Nouveau dossier",
      label: "Nom du dossier",
      placeholder: "Sans titre",
      confirmLabel: "Créer",
    });
    if (!name) return;
    try {
      await api.createFolder(name.trim(), current.id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  /// Import : n'importe quel type et autant de fichiers qu'on veut —
  /// images, audio, vidéo, documents. Les envois se font l'un après
  /// l'autre : en parallèle, le contrôle de quota côté serveur lirait un
  /// compteur déjà périmé et laisserait passer un dépassement.
  const importer = async (fichiers) => {
    const liste = [...(fichiers || [])];
    if (!liste.length || busy) return;

    setBusy(true);
    setError("");
    const echecs = [];

    for (let i = 0; i < liste.length; i++) {
      setProgres({ fait: i, total: liste.length, nom: liste[i].name });
      try {
        await api.uploadFile(liste[i], trash ? null : current.id);
      } catch (err) {
        echecs.push(`${liste[i].name} — ${err.message}`);
      }
    }

    setProgres(null);
    setBusy(false);
    await refresh();

    if (echecs.length) {
      await modal.alert({
        title: echecs.length === liste.length ? "Import impossible" : "Import partiel",
        message: `${liste.length - echecs.length} fichier(s) importé(s) sur ${liste.length}.`,
        detail: echecs.join("\n"),
        tone: "warning",
      });
    }
  };

  const upload = async (e) => {
    const fichiers = e.target.files;
    await importer(fichiers);
    e.target.value = "";
  };

  /// Glisser-déposer depuis le bureau de l'utilisateur.
  const surDepot = async (e) => {
    e.preventDefault();
    setSurvolDepot(false);
    if (trash) return;
    await importer(e.dataTransfer?.files);
  };

  /// Ce que la sélection désigne, dans l'ordre affiché.
  const visibles = nodes.filter((n) =>
    n.name.toLowerCase().includes(searchtxt.toLowerCase()),
  );
  const selectedNodes = visibles.filter((n) => selection.includes(n.id));
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;

  /// Clic simple : sélection unique. Ctrl/⌘ : ajoute ou retire. Maj :
  /// étend depuis le dernier élément cliqué jusqu'à celui-ci.
  const cliquer = (e, node, index) => {
    e.stopPropagation();

    if (e.shiftKey && anchor != null) {
      const depart = visibles.findIndex((n) => n.id === anchor);
      if (depart >= 0) {
        const [a, b] = depart < index ? [depart, index] : [index, depart];
        setSelection(visibles.slice(a, b + 1).map((n) => n.id));
        return;
      }
    }

    if (e.ctrlKey || e.metaKey) {
      setSelection((s) =>
        s.includes(node.id) ? s.filter((id) => id !== node.id) : [...s, node.id],
      );
      setAnchor(node.id);
      return;
    }

    setSelection([node.id]);
    setAnchor(node.id);

    // Un clic simple sur un fichier l'ouvre, tout de suite, dans son
    // application. Attendre un double-clic n'apporte rien ici : un
    // explorateur de fichiers sert avant tout à ouvrir, et le geste doit
    // être immédiat.
    //
    // Les dossiers gardent le double-clic : les sélectionner d'un clic
    // reste nécessaire pour les renommer, les déplacer ou les supprimer
    // depuis la barre d'outils — entrer dedans à chaque effleurement
    // rendrait ces gestes impossibles.
    //
    // Les clics avec Ctrl ou Maj sont sortis plus haut : ils composent une
    // sélection et ne doivent jamais ouvrir.
    if (!trash && node.type === "FILE") openNode(node);
  };

  /// Résumé d'une sélection, pour les messages de confirmation.
  const decrire = (liste) => {
    if (liste.length === 1) return `« ${liste[0].name} »`;
    const dossiers = liste.filter((n) => n.type === "FOLDER").length;
    const fichiers = liste.length - dossiers;
    const bouts = [];
    if (dossiers) bouts.push(`${dossiers} dossier${dossiers > 1 ? "s" : ""}`);
    if (fichiers) bouts.push(`${fichiers} fichier${fichiers > 1 ? "s" : ""}`);
    return bouts.join(" et ");
  };

  /// Applique une opération à toute la sélection, en s'arrêtant à la
  /// première erreur — mais en rafraîchissant quand même ce qui a été fait.
  /// Les cibles sont passées explicitement : le menu contextuel construit
  /// ses actions avant que `setSelection` du clic droit ne soit appliqué,
  /// lire l'état ici verrait l'ancienne sélection — vide — et ferait un
  /// no-op silencieux.
  const surSelection = async (cibles, operation) => {
    try {
      for (const node of cibles) await operation(node);
      viderSelection();
    } catch (err) {
      setError(err.message);
    } finally {
      await refresh();
      // Le bureau et l'icône de la corbeille suivent : ils lisent le même
      // cloud, ils doivent voir le même état.
      dispatch({ type: "CLOUD_TOUCH" });
    }
  };

  const removeSelected = async (cibles = selectedNodes) => {
    if (!cibles.length) return;
    const contientDossier = cibles.some((n) => n.type === "FOLDER");
    const ok = await modal.confirm({
      title: "Mettre à la corbeille",
      message: `Mettre ${decrire(cibles)} à la corbeille ?`,
      detail: contientDossier
        ? "Le contenu des dossiers part avec eux. Récupérable pendant 30 jours depuis la corbeille."
        : "Récupérable pendant 30 jours depuis la corbeille.",
      confirmLabel: "Mettre à la corbeille",
      danger: true,
    });
    if (!ok) return;
    await surSelection(cibles, async (node) => {
      await api.deleteNode(node.id);
      // La vignette en cache pointerait vers un fichier disparu.
      oublierApercu(node.id);
    });
  };

  const restaurer = async (cibles = selectedNodes) => {
    if (!cibles.length) return;
    let renommes = 0;
    let remontes = 0;
    await surSelection(cibles, async (node) => {
      const r = await api.restoreNode(node.id);
      if (r.renommé) renommes += 1;
      if (r.remontéÀLaRacine) remontes += 1;
    });
    // Une restauration n'est pas toujours à l'identique : il faut le dire.
    if (renommes || remontes) {
      const bouts = [];
      if (renommes)
        bouts.push(
          `${renommes} élément(s) renommé(s) — le nom d'origine était repris`,
        );
      if (remontes)
        bouts.push(
          `${remontes} élément(s) replacé(s) à la racine — leur dossier d'origine n'existe plus`,
        );
      await modal.alert({
        title: "Restauration terminée",
        message: bouts.join("\n"),
        tone: "warning",
      });
    }
  };

  const supprimerDefinitivement = async (cibles = selectedNodes) => {
    if (!cibles.length) return;
    const ok = await modal.confirm({
      title: "Supprimer définitivement",
      message: `Supprimer définitivement ${decrire(cibles)} ?`,
      detail: "Cette action est irréversible : les fichiers seront effacés du stockage.",
      confirmLabel: "Supprimer définitivement",
      danger: true,
    });
    if (!ok) return;
    await surSelection(cibles, (node) => api.purgeNode(node.id));
  };

  const viderCorbeille = async () => {
    if (!nodes.length) return;
    const ok = await modal.confirm({
      title: "Vider la corbeille",
      message: `Supprimer définitivement ${decrire(nodes)} ?`,
      detail: "Cette action est irréversible : les fichiers seront effacés du stockage.",
      confirmLabel: "Vider la corbeille",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.emptyTrash();
      viderSelection();
    } catch (err) {
      setError(err.message);
    } finally {
      await refresh();
      dispatch({ type: "CLOUD_TOUCH" });
    }
  };

  /// Renommer l'élément sélectionné.
  const renommer = async (node) => {
    const cible = node || selectedNode;
    if (!cible) return;
    const nom = await modal.prompt({
      title: cible.type === "FOLDER" ? "Renommer le dossier" : "Renommer le fichier",
      label: "Nouveau nom",
      value: cible.name,
      confirmLabel: "Renommer",
    });
    if (!nom || nom === cible.name) return;
    try {
      await api.renameNode(cible.id, nom);
      await refresh();
      dispatch({ type: "CLOUD_TOUCH" });
    } catch (err) {
      setError(err.message);
    }
  };

  // ---- Menus contextuels --------------------------------------------------
  //
  // Construits au clic droit, à partir de ce qui est visé et de l'endroit
  // où l'on se trouve : la corbeille ne propose pas les mêmes gestes qu'un
  // dossier, et une sélection multiple n'a pas de « Renommer ».

  const menuVide = (e) =>
    menuContextuel(e, [
      trash
        ? {
            nom: "Vider la corbeille",
            icone: "faFireFlameSimple",
            danger: true,
            desactive: !nodes.length,
            action: viderCorbeille,
          }
        : { nom: "Nouveau dossier", icone: "faFolderPlus", action: createFolder },
      !trash && { nom: "Importer des fichiers…", icone: "faFileArrowUp", action: () => fileInput.current?.click() },
      { separateur: true },
      { nom: "Actualiser", icone: "faRotate", raccourci: "F5", action: refresh },
      !trash && {
        nom: "Tout sélectionner",
        icone: "faObjectGroup",
        raccourci: "Ctrl+A",
        desactive: !visibles.length,
        action: () => setSelection(visibles.map((n) => n.id)),
      },
      { separateur: true },
      { nom: "Corbeille", icone: "faTrashCan", coche: trash, action: ouvrirCorbeille },
    ]);

  const menuElement = (node, index) => (e) => {
    // Clic droit hors sélection : on sélectionne d'abord la cible, sinon le
    // menu agirait sur des éléments que l'utilisateur ne regarde plus.
    const dansSelection = selection.includes(node.id);
    if (!dansSelection) {
      setSelection([node.id]);
      setAnchor(node.id);
    }
    const cibles = dansSelection ? selectedNodes : [node];
    const seul = cibles.length === 1;
    const famille = familleDe(node);

    return menuContextuel(e, [
      trash
        ? {
            nom: `Restaurer ${seul ? "" : `(${cibles.length})`}`.trim(),
            icone: "faTrashArrowUp",
            action: () => restaurer(cibles),
          }
        : {
            nom: node.type === "FOLDER" ? "Ouvrir" : "Ouvrir",
            icone: node.type === "FOLDER" ? "faFolderOpen" : "faArrowUpRightFromSquare",
            desactive: !seul,
            action: () => openNode(node),
          },
      !trash &&
        seul &&
        famille &&
        node.type === "FILE" && {
          nom: `Ouvrir avec ${famille.label}`,
          image: famille.icone,
          action: () => ouvrirFichier(node, nodes),
        },
      { separateur: true },
      !trash && {
        nom: "Renommer",
        icone: "faPen",
        raccourci: "F2",
        desactive: !seul,
        action: () => renommer(node),
      },
      !trash &&
        node.type === "FILE" && {
          nom: "Télécharger",
          icone: "faDownload",
          desactive: !seul,
          action: () => download(node),
        },
      { separateur: true },
      trash
        ? {
            nom: "Supprimer définitivement",
            icone: "faFireFlameSimple",
            danger: true,
            action: () => supprimerDefinitivement(cibles),
          }
        : {
            nom: `Mettre à la corbeille${seul ? "" : ` (${cibles.length})`}`,
            icone: "faTrashCan",
            raccourci: "Suppr",
            danger: true,
            action: () => removeSelected(cibles),
          },
    ]);
  };

  const handleKey = (e) => {
    if (e.key == "Backspace") goPrev();
    if (e.key == "Delete" && selection.length) {
      trash ? supprimerDefinitivement() : removeSelected();
    }
    // Ctrl+A : tout ce qui est affiché, filtre de recherche compris.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelection(visibles.map((n) => n.id));
    }
  };

  return (
    <div
      className="msfiles floatTab dpShad"
      data-size={wnapp.size}
      data-max={wnapp.max}
      style={{
        ...(wnapp.size == "cstm" ? wnapp.dim : null),
        zIndex: wnapp.z,
      }}
      data-hide={wnapp.hide}
      id={wnapp.icon + "App"}
    >
      <ToolBar
        app={wnapp.action}
        icon={wnapp.icon}
        size={wnapp.size}
        name={`${nomApp("explorer")} — Cloud`}
      />
      <div className="windowScreen flex flex-col">
        {/* Ruban : mêmes classes, actions réelles */}
        {/* Le ruban change de métier en corbeille : on n'y crée rien, on
            restaure ou on efface pour de bon. */}
        <div className="msribbon flex">
          {trash ? (
            <div className="ribsec">
              <div
                className="drdwcont flex handcr prtclk"
                data-off={!selectedNodes.length}
                onClick={restaurer}
              >
                <Icon fafa="faTrashArrowUp" width={16} margin="0 6px" />
                <span>Restaurer</span>
              </div>
              <div
                className="drdwcont flex handcr prtclk"
                data-off={!selectedNodes.length}
                onClick={() => supprimerDefinitivement()}
              >
                <Icon fafa="faFireFlameCurved" width={16} margin="0 6px" />
                <span>Supprimer définitivement</span>
              </div>
              <div
                className="drdwcont flex handcr prtclk"
                data-off={!nodes.length}
                onClick={viderCorbeille}
              >
                <Icon fafa="faBroom" width={16} margin="0 6px" />
                <span>Vider la corbeille</span>
              </div>
            </div>
          ) : (
            <>
              <div className="ribsec">
                <div className="drdwcont flex handcr prtclk" onClick={createFolder}>
                  <Icon src="new" ui width={18} margin="0 6px" />
                  <span>Nouveau dossier</span>
                </div>
                <div
                  className="drdwcont flex handcr prtclk"
                  onClick={() => fileInput.current?.click()}
                >
                  <Icon src="paste" ui width={18} margin="0 6px" />
                  <span>
                    {progres
                      ? `Envoi ${progres.fait + 1}/${progres.total}…`
                      : busy
                        ? "Envoi…"
                        : "Importer"}
                  </span>
                </div>
                {/* Aucun filtre de type : images, audio, vidéo, documents,
                    archives — le cloud accepte tout, les visionneuses
                    s'occupent de ce qu'elles savent lire. */}
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  className="none"
                  onChange={upload}
                />
              </div>
              <div className="ribsec">
                <div
                  className="drdwcont flex handcr prtclk"
                  data-off={!selectedNode || selectedNode.type !== "FILE"}
                  onClick={() => selectedNode?.type === "FILE" && download(selectedNode)}
                >
                  <Icon src="copy" ui width={18} margin="0 6px" />
                  <span>Télécharger</span>
                </div>
                <div
                  className="drdwcont flex handcr prtclk"
                  data-off={!selectedNodes.length}
                  onClick={() => removeSelected()}
                >
                  <Icon src="cut" ui width={18} margin="0 6px" />
                  <span>
                    Supprimer
                    {selectedNodes.length > 1 ? ` (${selectedNodes.length})` : ""}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="restWindow flex-grow flex flex-col">
          <div className="sec1">
            <Icon
              className={"navIcon hvtheme" + (hid == 0 ? " disableIt" : "")}
              fafa="faArrowLeft"
              width={14}
              onClick={goPrev}
              pr
            />
            <Icon
              className={
                "navIcon hvtheme" + (hid + 1 == hist.length ? " disableIt" : "")
              }
              fafa="faArrowRight"
              width={14}
              onClick={goNext}
              pr
            />
            <Icon
              className={"navIcon hvtheme" + (path.length == 1 ? " disableIt" : "")}
              fafa="faArrowUp"
              width={14}
              onClick={goUp}
              pr
            />
            <div className="path-bar noscroll" tabIndex="-1">
              <div className="dirfbox h-full flex">
                {trash ? (
                  <div className="dirCont flex items-center">
                    <div className="dncont" tabIndex="-1">
                      Corbeille
                    </div>
                    <Icon className="dirchev" fafa="faChevronRight" width={8} />
                  </div>
                ) : null}
                {(trash ? [] : path).map((step, i) => (
                  <div key={step.id || "root"} className="dirCont flex items-center">
                    <div
                      className="dncont"
                      tabIndex="-1"
                      onClick={() => navigate(path.slice(0, i + 1))}
                    >
                      {step.name}
                    </div>
                    <Icon className="dirchev" fafa="faChevronRight" width={8} />
                  </div>
                ))}
              </div>
            </div>
            <div className="srchbar">
              <Icon className="searchIcon" src="search" width={12} />
              {/* Pas de texte indicatif : l'icône loupe suffit à dire à quoi
                  sert le champ, et un « Rechercher » gris permanent donne
                  l'impression qu'il reste toujours quelque chose d'écrit. */}
              <input
                type="text"
                onChange={(e) => setShText(e.target.value)}
                value={searchtxt}
              />
            </div>
          </div>
          <div className="sec2">
            {/* Volet latéral : accès rapide au cloud du tenant */}
            <div className="navpane cosScroll">
              <div className="extcont">
                <div className="dropdownmenu">
                  <div className="droptitle">
                    <Icon className="arrUi" fafa="faChevronDown" width={10} />
                    <div
                      className="navtitle flex prtclk"
                      onClick={() => navigate([{ id: null, name: "Cloud" }])}
                    >
                      <Icon className="mr-1" src="win/onedrive-sm" width={16} />
                      <span>{session.tenant?.name || "Cloud"}</span>
                    </div>
                    <Icon className="pinUi" fafa="faThumbtack" width={11} />
                  </div>
                  <div className="dropcontent">
                    {rootFolders.map((folder) => (
                      <div key={folder.id} className="dropdownmenu">
                        <div className="droptitle">
                          <Icon className="arrUi opacity-0" fafa="faCircle" width={10} />
                          <div
                            className="navtitle flex prtclk"
                            onClick={() =>
                              navigate([
                                { id: null, name: "Cloud" },
                                { id: folder.id, name: folder.name },
                              ])
                            }
                          >
                            <Icon className="mr-1" src="win/folder-sm" width={16} />
                            <span>{folder.name}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="dropdownmenu">
                  <div className="droptitle">
                    <Icon className="arrUi opacity-0" fafa="faCircle" width={10} />
                    <div
                      className="navtitle flex prtclk"
                      data-active={trash}
                      onClick={ouvrirCorbeille}
                    >
                      <Icon className="mr-1" fafa="faTrashCan" width={14} />
                      <span>Corbeille</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div
              className="contentarea"
              onClick={viderSelection}
              onKeyDown={handleKey}
              tabIndex="-1"
              data-depot={survolDepot ? "true" : "false"}
              onDragOver={(e) => {
                if (trash) return;
                e.preventDefault();
                setSurvolDepot(true);
              }}
              onDragLeave={(e) => {
                // `dragleave` se déclenche aussi en passant d'un enfant à
                // l'autre : on ne retire le voile qu'en sortant vraiment.
                if (!e.currentTarget.contains(e.relatedTarget)) setSurvolDepot(false);
              }}
              onDrop={surDepot}
            >
              {survolDepot ? (
                <div className="dropVoile">
                  <Icon fafa="faCloudArrowUp" width={26} />
                  <span>Déposez vos fichiers dans « {current.name} »</span>
                </div>
              ) : null}
              {progres ? (
                <div className="dropProgres">
                  Envoi de « {progres.nom} » — {progres.fait + 1} sur {progres.total}
                </div>
              ) : null}
              {session.status !== "authenticated" ? (
                <span className="text-xs mx-auto my-4">
                  Connectez-vous pour accéder au cloud.
                </span>
              ) : (
                <div className="contentwrap cosScroll" onContextMenu={menuVide}>
                  {error ? (
                    <span className="text-xs mx-auto my-2" style={{ color: "#e66" }}>
                      {error}
                    </span>
                  ) : null}
                  <div className="gridshow" data-size={view == 1 ? "lg" : "md"}>
                    {visibles.map((node, index) => (
                      <div
                        key={node.id}
                        className="conticon hvtheme flex flex-col items-center prtclk"
                        data-id={node.id}
                        data-focus={selection.includes(node.id)}
                        onClick={(e) => cliquer(e, node, index)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          // Le fichier s'est déjà ouvert au premier clic :
                          // seul le dossier attend ici son double-clic.
                          // En corbeille, rien ne s'ouvre — on restaure
                          // d'abord.
                          if (!trash && node.type === "FOLDER") openNode(node);
                        }}
                        onContextMenu={menuElement(node, index)}
                      >
                        <FileThumb node={node} />
                        <span>{node.name}</span>
                      </div>
                    ))}
                  </div>
                  {visibles.length == 0 && !error ? (
                    <span className="text-xs mx-auto">
                      {trash
                        ? "La corbeille est vide."
                        : searchtxt
                          ? "Aucun élément ne correspond."
                          : "Ce dossier est vide."}
                    </span>
                  ) : null}
                </div>
              )}
            </div>
          </div>
          {/* La visionneuse d'images intégrée a laissé la place à
              l'application Photos, qui sait aussi feuilleter le dossier,
              zoomer et pivoter. */}

          <div className="sec3">
            <div className="item-count text-xs">
              {nodes.length} élément{nodes.length > 1 ? "s" : ""}
              {usage
                ? ` — ${formatBytes(usage.usedBytes)} sur ${formatBytes(usage.quota)}`
                : ""}
            </div>
            <div className="view-opts flex">
              <Icon
                className="viewicon hvtheme p-1"
                onClick={() => setView(5)}
                open={view == 5}
                fafa="faList"
                width={14}
                pr
              />
              <Icon
                className="viewicon hvtheme p-1"
                onClick={() => setView(1)}
                open={view == 1}
                fafa="faTableCellsLarge"
                width={14}
                pr
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

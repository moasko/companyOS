import React, { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Icon, ToolBar } from "../../../../utils/general";
import { useNomApp } from "../../../../utils/nomsApps";
import { useTelephone } from "../../../../utils/telephone";
import { api, apiFetch } from "../../../../api/client";
import { oublierApercu } from "../assets/FileThumb";
import { modal } from "../../../../apps/modalRequest";
import { applicationManquante, ouvrirFichier } from "../../../../apps/openRequest";
import { consommerDemande } from "../../../../apps/explorerRequest";
import { ouvrirPartage, ouvrirVersions } from "../../../../apps/fichiersAvances";
import { menuContextuel } from "../../../../apps/menuRequest";
import { familleDe } from "../../../../apps/fileTypes";
import { moduleBySlug, syncInstalledModules } from "../../../../apps/sync";
import { moduleById } from "../../../../apps/registry";
import { versionLivree } from "../../../../apps/versions";
import {
  RACINE,
  cheminDe,
  dansLaDescendance,
  descendants,
  ecrireReglages,
  indexer,
  lireDepot,
  lireDossierChoisi,
  lireReglages,
  nomUnique,
  rechercher,
  tailleLisible,
  trier,
} from "../../../../apps/explorateur";
import { Volet } from "./Volet";
import { Contenu } from "./Contenu";
import { PanneauDetails } from "./PanneauDetails";
import { choisirDossier, demanderConflit } from "./Dialogues";
import "../assets/fileexpo.scss";
import "./explorateur.scss";

// L'Explorateur est le poste de pilotage du cloud CompanyOS : l'habillage
// de l'explorateur Windows, et ses gestes — arbre dépliable, vue détails
// triable, volet de détails, couper / copier / coller, glisser-déposer,
// renommage en place, raccourcis clavier, recherche dans tout le Cloud,
// import de dossiers entiers, archive ZIP. Chaque dossier et chaque
// fichier vit dans l'espace de stockage du tenant, servi par l'API.
//
// Les règles sans React (chemins, tri, recherche, libellés, réglages)
// vivent dans src/apps/explorateur.js, testées à part.

/// Type MIME des éléments glissés depuis l'Explorateur lui-même — à ne pas
/// confondre avec des fichiers venus du poste (« Files »).
const MIME_INTERNE = "application/x-companyos-fichiers";

const LIEU_CLOUD = { type: "dossier", id: null };
const memeLieu = (a, b) => a.type === b.type && (a.id ?? null) === (b.id ?? null);

const decrire = (liste) => {
  if (liste.length === 1) return `« ${liste[0].name} »`;
  const dossiers = liste.filter((n) => n.type === "FOLDER").length;
  const fichiers = liste.length - dossiers;
  const bouts = [];
  if (dossiers) bouts.push(`${dossiers} dossier${dossiers > 1 ? "s" : ""}`);
  if (fichiers) bouts.push(`${fichiers} fichier${fichiers > 1 ? "s" : ""}`);
  return bouts.join(" et ");
};

const enregistrerBlob = (blob, nom) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

const estInterne = (e) => [...(e.dataTransfer?.types || [])].includes(MIME_INTERNE);
const contientFichiers = (e) => [...(e.dataTransfer?.types || [])].includes("Files");

/// Bouton du ruban : icône et libellé (le libellé se masque sur téléphone).
const Bouton = ({ icone, libelle, onClick, off, actif, titre, raccourci, compact }) => (
  <button
    type="button"
    className="expRuban"
    data-compact={compact ? "true" : undefined}
    data-off={off ? "true" : undefined}
    data-actif={actif ? "true" : undefined}
    disabled={off}
    title={[titre || libelle, raccourci && `(${raccourci})`].filter(Boolean).join(" ")}
    onClick={onClick}
  >
    <Icon fafa={icone} width={14} />
    <span>{libelle}</span>
  </button>
);

export const Explorer = () => {
  const nomApp = useNomApp();
  const dispatch = useDispatch();
  const wnapp = useSelector((state) => state.apps.explorer);
  const session = useSelector((state) => state.session);
  // Incrémenté dès qu'une app écrit un fichier dans le cloud.
  const cloudVersion = useSelector((state) => state.cloud.version);
  const telephone = useTelephone();

  // Historique de navigation : des « lieux » — un dossier, la corbeille,
  // les récents, les favoris.
  const [hist, setHist] = useState([LIEU_CLOUD]);
  const [hid, setHid] = useState(0);
  const lieu = hist[hid] || LIEU_CLOUD;

  const [nodes, setNodes] = useState([]);
  const [arbre, setArbre] = useState([]);
  const [usage, setUsage] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  // Sélection : des ids ; l'ancre sert à Maj+clic, le « courant » au clavier.
  const [selection, setSelection] = useState([]);
  const [ancre, setAncre] = useState(null);
  const [courant, setCourant] = useState(null);
  const [edition, setEdition] = useState(null);
  const [presse, setPresse] = useState(null); // { mode: "couper" | "copier", ids }
  const [saisie, setSaisie] = useState("");
  const [triForce, setTriForce] = useState(false);
  const [reglages, setReglagesEtat] = useState(lireReglages);
  const [deplie, setDeplie] = useState(() => new Set(["racine"]));
  const [voletOuvert, setVoletOuvert] = useState(false);
  // Opération en cours (import, archive, copie) : { texte, fait?, total? }
  const [occupation, setOccupation] = useState(null);
  const [cibleDepot, setCibleDepot] = useState(undefined);

  const fichierInput = useRef(null);
  const dossierInput = useRef(null);
  const zoneRef = useRef(null);
  const grilleRef = useRef(null);
  const rechercheRef = useRef(null);
  const glisses = useRef(null);

  const index = useMemo(() => indexer(arbre), [arbre]);
  const dossierId = lieu.type === "dossier" ? lieu.id ?? null : null;

  const reglagesAJour = (patch) =>
    setReglagesEtat((r) => {
      const suivant = { ...r, ...patch };
      ecrireReglages(suivant);
      return suivant;
    });

  // ---- Chargement -----------------------------------------------------------

  // Chaque chargement porte un numéro : une réponse partie avant une
  // écriture (donc périmée) n'écrase jamais l'état mis à jour entre-temps.
  const generation = useRef(0);

  const charger = async () => {
    if (session.status !== "authenticated") return;
    const numero = ++generation.current;
    try {
      const [liste, use, tout] = await Promise.all([
        lieu.type === "corbeille"
          ? api.listTrash()
          : lieu.type === "recents"
            ? api.recents()
            : lieu.type === "dossier"
              ? api.listFiles(dossierId)
              : Promise.resolve([]),
        api.usage(),
        api.arborescence(),
      ]);
      if (numero !== generation.current) return;
      setNodes(liste || []);
      setUsage(use);
      setArbre(tout?.noeuds || []);
      setErreur("");
    } catch (err) {
      if (numero === generation.current) setErreur(err.message || "Cloud indisponible");
    } finally {
      setChargement(false);
    }
  };

  // ---- Mises à jour locales -------------------------------------------------
  //
  // Une action se voit **tout de suite** : la liste et l'arbre sont modifiés
  // sur place, puis le serveur confirme en arrière-plan. En cas d'échec, le
  // rechargement qui suit remet l'état réel.

  const patchLocal = (id, patch) => {
    generation.current += 1;
    const maj = (l) => l.map((n) => (n.id === id ? { ...n, ...patch } : n));
    setNodes(maj);
    setArbre(maj);
  };

  const retirerLocal = (ids) => {
    generation.current += 1;
    const partis = new Set(ids);
    for (const id of ids) for (const d of descendants(index, id)) partis.add(d.id);
    setNodes((l) => l.filter((n) => !partis.has(n.id)));
    setArbre((l) => l.filter((n) => !partis.has(n.id)));
  };

  const ajouterLocal = (noeuds) => {
    const liste = (Array.isArray(noeuds) ? noeuds : [noeuds]).filter((n) => n?.id);
    if (!liste.length) return;
    generation.current += 1;
    const fusion = (l, aAjouter) => {
      const ids = new Set(aAjouter.map((n) => n.id));
      return [...l.filter((n) => !ids.has(n.id)), ...aAjouter];
    };
    setArbre((l) => fusion(l, liste));
    if (lieu.type === "dossier") setNodes((l) => fusion(l, liste.filter((n) => (n.parentId ?? null) === dossierId)));
  };

  const deplacerLocal = (ids, cible) => {
    generation.current += 1;
    const bouges = new Set(ids);
    setArbre((l) => l.map((n) => (bouges.has(n.id) ? { ...n, parentId: cible ?? null } : n)));
    if (lieu.type === "dossier") {
      setNodes((l) => {
        const restants = l.filter((n) => !bouges.has(n.id));
        if ((cible ?? null) !== dossierId) return restants;
        const arrivants = ids.map((id) => index.parId.get(id)).filter(Boolean).map((n) => ({ ...n, parentId: cible ?? null }));
        return [...restants, ...arrivants];
      });
    }
  };

  /// Après une écriture : le serveur est relu en arrière-plan, et le
  /// bureau, la corbeille et les autres fenêtres suivent — ils lisent le
  /// même cloud (CLOUD_TOUCH relance aussi le chargement ci-dessous).
  const apresEcriture = () => {
    dispatch({ type: "CLOUD_TOUCH" });
  };

  useEffect(() => {
    if (!wnapp.hide) charger();
  }, [wnapp.hide, session.status, lieu.type, dossierId, cloudVersion]);

  // Le dossier ouvert a disparu (supprimé ailleurs) : retour au Cloud.
  useEffect(() => {
    if (dossierId && arbre.length && !index.parId.has(dossierId)) aller(LIEU_CLOUD);
  }, [index]);

  // L'arbre suit la navigation : le chemin du dossier ouvert est déplié.
  useEffect(() => {
    if (!dossierId) return;
    const ancetres = cheminDe(index, dossierId)
      .slice(1, -1)
      .map((e) => e.id);
    if (ancetres.every((id) => deplie.has(id))) return;
    setDeplie((s) => new Set([...s, "racine", ...ancetres]));
  }, [dossierId, index]);

  // ---- Navigation -----------------------------------------------------------

  const viderSelection = () => {
    setSelection([]);
    setAncre(null);
  };

  const aller = (nouveau) => {
    setEdition(null);
    setSaisie("");
    setTriForce(false);
    setVoletOuvert(false);
    viderSelection();
    setCourant(null);
    if (memeLieu(nouveau, lieu)) return;
    const suite = [...hist.slice(0, hid + 1), nouveau];
    setHist(suite);
    setHid(suite.length - 1);
  };

  const deplacerHistorique = (pas) => {
    const cible = hid + pas;
    if (cible < 0 || cible >= hist.length) return;
    setHid(cible);
    setEdition(null);
    setSaisie("");
    viderSelection();
  };

  const remonter = () => {
    if (lieu.type !== "dossier") return aller(LIEU_CLOUD);
    if (!dossierId) return;
    aller({ type: "dossier", id: index.parId.get(dossierId)?.parentId ?? null });
  };

  // Ouverture demandée de l'extérieur — l'icône Corbeille du bureau, un
  // « Afficher dans l'Explorateur »… La demande est déposée puis consommée
  // à chaque affichage de la fenêtre (voir src/apps/explorerRequest.js).
  useEffect(() => {
    if (wnapp.hide) return;
    const vue = consommerDemande();
    if (vue === "corbeille") aller({ type: "corbeille" });
    else if (vue === "cloud") aller(LIEU_CLOUD);
    else if (vue?.vue === "dossier") aller({ type: "dossier", id: vue.id });
  }, [wnapp.hide, wnapp.z]);

  const basculer = (id) =>
    setDeplie((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // ---- Ce qui est affiché ---------------------------------------------------

  const recherche = saisie.trim();
  const rechercheGlobale = !!recherche && lieu.type === "dossier";
  const favoris = reglages.favoris.map((f) => index.parId.get(f.id)).filter(Boolean);

  const elements = useMemo(() => {
    if (rechercheGlobale) {
      // Dans le dossier ouvert et tous ses sous-dossiers, par pertinence.
      const trouves = rechercher(descendants(index, dossierId), recherche);
      return triForce ? trier(trouves, reglages.tri) : trouves;
    }
    let base = lieu.type === "favoris" ? reglages.favoris.map((f) => index.parId.get(f.id)).filter(Boolean) : nodes;
    if (recherche) base = rechercher(base, recherche, 5000);
    if (lieu.type === "recents" && !triForce) return base;
    return trier(base, reglages.tri);
  }, [nodes, index, lieu, dossierId, recherche, rechercheGlobale, reglages.tri, reglages.favoris, triForce]);

  const avecEmplacement = rechercheGlobale || lieu.type === "recents" || lieu.type === "favoris";
  const ensembleSelection = useMemo(() => new Set(selection), [selection]);
  const selectionnes = elements.filter((n) => ensembleSelection.has(n.id));
  const seul = selectionnes.length === 1 ? selectionnes[0] : null;
  const coupes = useMemo(() => new Set(presse?.mode === "couper" ? presse.ids : []), [presse]);
  const enCorbeille = lieu.type === "corbeille";
  const peutEcrire = lieu.type === "dossier";
  const vue = reglages.vue;

  const nomLieu =
    lieu.type === "corbeille"
      ? "Corbeille"
      : lieu.type === "recents"
        ? "Récents"
        : lieu.type === "favoris"
          ? "Favoris"
          : dossierId
            ? index.parId.get(dossierId)?.name || "Dossier"
            : session.tenant?.name || RACINE.name;

  const noeudPar = (id) => elements.find((n) => n.id === id) || nodes.find((n) => n.id === id) || index.parId.get(id);

  // ---- Ouvrir, télécharger --------------------------------------------------

  const download = async (node) => {
    try {
      const res = await apiFetch(api.downloadUrl(node.id), {});
      if (!res.ok) throw new Error("Téléchargement impossible");
      enregistrerBlob(await res.blob(), node.name);
    } catch (err) {
      setErreur(err.message);
    }
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
      if (!ouvrirFichier(node, elements)) download(node);
    } catch (err) {
      modal.alert({
        title: "Installation impossible",
        message: err.message,
        detail: "Seul un administrateur de l'espace peut installer une application.",
        tone: "error",
      });
    }
  };

  /// Un dossier : on y entre. Un fichier : l'application associée à son
  /// type l'ouvre (src/apps/fileTypes.js), avec ses voisins pour feuilleter.
  /// Personne ne sait le lire : téléchargement.
  const ouvrir = (node) => {
    if (enCorbeille) return;
    if (node.type === "FOLDER") return aller({ type: "dossier", id: node.id });
    if (ouvrirFichier(node, elements.filter((n) => n.parentId === node.parentId))) return;
    const manquante = applicationManquante(node);
    if (manquante) return proposerInstallation(node, manquante);
    download(node);
  };

  /// Un fichier seul part tel quel ; plusieurs éléments ou un dossier
  /// partent en une archive ZIP construite au fil de l'eau par le serveur.
  const telecharger = async (cibles = selectionnes) => {
    if (!cibles.length) return;
    if (cibles.length === 1 && cibles[0].type === "FILE") return download(cibles[0]);
    const nom = cibles.length === 1 ? `${cibles[0].name}.zip` : `${nomLieu}.zip`;
    setOccupation({ texte: "Préparation de l'archive…" });
    try {
      enregistrerBlob(await api.zipFichiers(cibles.map((n) => n.id)), nom);
    } catch (err) {
      modal.alert({ title: "Archive impossible", message: err.message, tone: "error" });
    } finally {
      setOccupation(null);
    }
  };

  const afficherEmplacement = (node) => {
    aller({ type: "dossier", id: node.parentId ?? null });
    // La sélection est posée après la navigation (qui la vide).
    setTimeout(() => {
      setSelection([node.id]);
      setAncre(node.id);
      setCourant(node.id);
    }, 0);
  };

  // ---- Créer, renommer ------------------------------------------------------

  const nomsIci = () => nodes.map((n) => n.name);

  /// « Nouveau dossier » est créé tout de suite, sous un nom libre, puis
  /// proposé au renommage — comme partout ailleurs.
  const creerDossier = async () => {
    if (!peutEcrire) return;
    try {
      const d = await api.createFolder(nomUnique(nomsIci(), "Nouveau dossier"), dossierId);
      ajouterLocal(d);
      apresEcriture();
      setSelection([d.id]);
      setAncre(d.id);
      setCourant(d.id);
      setEdition(d.id);
    } catch (err) {
      setErreur(err.message);
    }
  };

  const creerTexte = async () => {
    if (!peutEcrire) return;
    try {
      const nom = nomUnique(nomsIci(), "Nouveau document.txt");
      const f = await api.uploadFile(new File([""], nom, { type: "text/plain" }), dossierId);
      ajouterLocal(f);
      apresEcriture();
      setSelection([f.id]);
      setAncre(f.id);
      setCourant(f.id);
      setEdition(f.id);
    } catch (err) {
      setErreur(err.message);
    }
  };

  const renommer = async (node, saisi) => {
    setEdition(null);
    const nom = String(saisi || "").trim();
    if (!nom || nom === node.name) return;
    // Le nouveau nom s'affiche aussitôt ; le serveur confirme derrière.
    patchLocal(node.id, { name: nom });
    zoneRef.current?.focus();
    try {
      await api.renameNode(node.id, nom);
    } catch (err) {
      await modal.alert({ title: "Renommage impossible", message: err.message, tone: "error" });
    } finally {
      apresEcriture();
    }
  };

  const commencerRenommage = (node = seul) => {
    if (!node || enCorbeille) return;
    setSelection([node.id]);
    setEdition(node.id);
  };

  // ---- Corbeille ------------------------------------------------------------

  /// Applique une opération à chaque cible. Les cibles quittent la vue
  /// tout de suite ; à la première erreur on s'arrête, et le rechargement
  /// remet en place ce qui n'a pas été fait.
  const surCibles = async (cibles, operation) => {
    retirerLocal(cibles.map((n) => n.id));
    viderSelection();
    try {
      for (const node of cibles) await operation(node);
    } catch (err) {
      setErreur(err.message);
    } finally {
      apresEcriture();
    }
  };

  const mettreALaCorbeille = async (cibles = selectionnes) => {
    if (!cibles.length) return;
    const ok = await modal.confirm({
      title: "Mettre à la corbeille",
      message: `Mettre ${decrire(cibles)} à la corbeille ?`,
      detail: cibles.some((n) => n.type === "FOLDER")
        ? "Le contenu des dossiers part avec eux. Récupérable pendant 30 jours depuis la corbeille."
        : "Récupérable pendant 30 jours depuis la corbeille.",
      confirmLabel: "Mettre à la corbeille",
      danger: true,
    });
    if (!ok) return;
    await surCibles(cibles, async (node) => {
      await api.deleteNode(node.id);
      oublierApercu(node.id);
    });
    setPresse((p) => (p && p.ids.some((id) => cibles.some((c) => c.id === id)) ? null : p));
  };

  const restaurer = async (cibles = selectionnes) => {
    if (!cibles.length) return;
    let renommes = 0;
    let remontes = 0;
    await surCibles(cibles, async (node) => {
      const r = await api.restoreNode(node.id);
      if (r.renommé) renommes += 1;
      if (r.remontéÀLaRacine) remontes += 1;
    });
    // Une restauration n'est pas toujours à l'identique : il faut le dire.
    if (renommes || remontes) {
      const bouts = [];
      if (renommes) bouts.push(`${renommes} élément(s) renommé(s) — le nom d'origine était repris`);
      if (remontes) bouts.push(`${remontes} élément(s) replacé(s) à la racine — leur dossier d'origine n'existe plus`);
      await modal.alert({ title: "Restauration terminée", message: bouts.join("\n"), tone: "warning" });
    }
  };

  const supprimerDefinitivement = async (cibles = selectionnes) => {
    if (!cibles.length) return;
    const ok = await modal.confirm({
      title: "Supprimer définitivement",
      message: `Supprimer définitivement ${decrire(cibles)} ?`,
      detail: "Cette action est irréversible : les fichiers seront effacés du stockage.",
      confirmLabel: "Supprimer définitivement",
      danger: true,
    });
    if (!ok) return;
    await surCibles(cibles, (node) => api.purgeNode(node.id));
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
    generation.current += 1;
    setNodes([]);
    viderSelection();
    try {
      await api.emptyTrash();
    } catch (err) {
      setErreur(err.message);
    } finally {
      apresEcriture();
    }
  };

  // ---- Déplacer, copier, presse-papiers -------------------------------------

  const deplacer = async (ids, cible) => {
    const echecs = [];
    let faits = 0;
    const valides = [];
    for (const id of ids) {
      const node = noeudPar(id);
      if (!node || (node.parentId ?? null) === (cible ?? null)) continue;
      if (node.type === "FOLDER" && dansLaDescendance(index, node.id, cible)) {
        echecs.push(`${node.name} — un dossier ne peut pas aller dans lui-même`);
        continue;
      }
      valides.push(node);
    }
    // Les éléments changent de place à l'écran sans attendre le serveur.
    deplacerLocal(valides.map((n) => n.id), cible);
    for (const node of valides) {
      try {
        await api.moveNode(node.id, cible ?? null);
        faits += 1;
      } catch (err) {
        echecs.push(`${node.name} — ${err.message}`);
      }
    }
    if (valides.length) apresEcriture();
    if (echecs.length) {
      await modal.alert({
        title: faits ? "Déplacement partiel" : "Déplacement impossible",
        message: `${faits} élément(s) déplacé(s) sur ${ids.length}.`,
        detail: echecs.join("\n"),
        tone: "warning",
      });
    }
    return faits;
  };

  const copier = async (ids, cible) => {
    setOccupation({ texte: `Copie de ${ids.length} élément${ids.length > 1 ? "s" : ""}…` });
    try {
      ajouterLocal(await api.copierFichiers(ids, cible ?? null));
      apresEcriture();
    } catch (err) {
      await modal.alert({ title: "Copie impossible", message: err.message, tone: "error" });
    } finally {
      setOccupation(null);
    }
  };

  const mettreDansPresse = (mode, cibles = selectionnes) => {
    if (!cibles.length || enCorbeille) return;
    setPresse({ mode, ids: cibles.map((n) => n.id) });
  };

  const coller = async (cible = dossierId) => {
    if (!presse || !peutEcrire) return;
    if (presse.mode === "couper") {
      await deplacer(presse.ids, cible);
      setPresse(null);
    } else {
      await copier(presse.ids, cible);
    }
  };

  const versDossier = async (mode, cibles = selectionnes) => {
    if (!cibles.length) return;
    const choix = await choisirDossier({
      titre: mode === "copier" ? `Copier ${decrire(cibles)} vers…` : `Déplacer ${decrire(cibles)} vers…`,
      libelle: mode === "copier" ? "Copier ici" : "Déplacer ici",
      index,
      depart: cibles[0].parentId ?? null,
      exclus: mode === "deplacer" ? cibles.filter((n) => n.type === "FOLDER").map((n) => n.id) : [],
    });
    if (!choix) return;
    if (mode === "copier") await copier(cibles.map((n) => n.id), choix.id);
    else await deplacer(cibles.map((n) => n.id), choix.id);
  };

  // ---- Favoris --------------------------------------------------------------

  const estFavori = (node) => reglages.favoris.some((f) => f.id === node.id);
  const basculerFavori = (node) =>
    reglagesAJour({
      favoris: estFavori(node)
        ? reglages.favoris.filter((f) => f.id !== node.id)
        : [...reglages.favoris, { id: node.id, name: node.name, type: node.type }].slice(-50),
    });

  // ---- Import ---------------------------------------------------------------

  /// Importe des fichiers, dossiers compris (`chemin` : sous-dossiers à
  /// recréer). Un envoi à la fois : en parallèle, le contrôle de quota côté
  /// serveur lirait un compteur déjà périmé. Un nom déjà pris se tranche
  /// avec l'utilisateur : remplacer (nouvelle version), garder les deux ou
  /// ignorer — une fois, ou pour tous les conflits suivants.
  const importer = async (entrees, cible = dossierId) => {
    if (!entrees.length || occupation) return;
    const echecs = [];
    let faits = 0;
    let pourTous = null;
    // Contenu des dossiers de destination, lu une fois puis tenu à jour.
    const contenus = new Map();
    const contenuDe = async (parentId) => {
      const cle = parentId ?? "racine";
      if (!contenus.has(cle)) contenus.set(cle, await api.listFiles(parentId));
      return contenus.get(cle);
    };
    const dossiersCrees = new Map();
    const dossierPour = async (chemin) => {
      let parent = cible ?? null;
      for (let i = 0; i < chemin.length; i++) {
        const cle = chemin.slice(0, i + 1).join("/");
        if (dossiersCrees.has(cle)) {
          parent = dossiersCrees.get(cle);
          continue;
        }
        const contenu = await contenuDe(parent);
        let d = contenu.find((n) => n.type === "FOLDER" && n.name === chemin[i]);
        if (!d) {
          d = await api.createFolder(chemin[i], parent);
          contenu.push(d);
          ajouterLocal(d);
        }
        dossiersCrees.set(cle, d.id);
        parent = d.id;
      }
      return parent;
    };

    const dossierNom = (id) => (id ? index.parId.get(id)?.name || "Dossier" : session.tenant?.name || RACINE.name);

    for (let i = 0; i < entrees.length; i++) {
      const { fichier, chemin } = entrees[i];
      setOccupation({ texte: `Envoi de « ${fichier.name} »`, fait: i, total: entrees.length });
      try {
        const parent = await dossierPour(chemin);
        const contenu = await contenuDe(parent);
        const existant = contenu.find((n) => n.name === fichier.name);
        let choix = "nouveau";
        if (existant) {
          if (pourTous) choix = pourTous;
          else {
            const restants = entrees.slice(i + 1).length;
            const r = await demanderConflit({
              nom: fichier.name,
              dossier: dossierNom(parent),
              restants,
              remplacable: existant.type === "FILE",
            });
            if (!r) break;
            choix = r.choix;
            if (r.pourTous) pourTous = r.choix;
          }
          if (choix === "remplacer" && existant.type !== "FILE") choix = "garder";
        }
        if (choix === "ignorer") continue;
        if (choix === "remplacer") {
          await api.updateFileContent(existant.id, fichier);
          oublierApercu(existant.id);
        } else {
          const cree = await api.uploadFile(fichier, parent, choix === "garder" ? { conflit: "renommer" } : {});
          if (cree) {
            contenu.push(cree);
            // Le fichier apparaît dès qu'il est arrivé, sans attendre la fin du lot.
            ajouterLocal(cree);
          }
        }
        faits += 1;
      } catch (err) {
        echecs.push(`${[...chemin, fichier.name].join("/")} — ${err.message}`);
      }
    }

    setOccupation(null);
    apresEcriture();
    if (echecs.length) {
      await modal.alert({
        title: faits ? "Import partiel" : "Import impossible",
        message: `${faits} fichier(s) importé(s) sur ${entrees.length}.`,
        detail: echecs.join("\n"),
        tone: "warning",
      });
    }
  };

  const surChoixFichiers = async (e) => {
    const entrees = [...(e.target.files || [])].map((fichier) => ({ fichier, chemin: [] }));
    e.target.value = "";
    await importer(entrees);
  };

  const surChoixDossier = async (e) => {
    const entrees = lireDossierChoisi(e.target.files);
    e.target.value = "";
    await importer(entrees);
  };

  // ---- Glisser-déposer ------------------------------------------------------
  //
  // Deux sortes de dépôts : des fichiers du poste (import, dossiers
  // compris) et des éléments glissés depuis l'Explorateur (déplacement ;
  // copie si Ctrl est enfoncé au moment du dépôt).

  const debutGlisse = (e, node) => {
    if (enCorbeille) return e.preventDefault();
    const ids = ensembleSelection.has(node.id) ? selectionnes.map((n) => n.id) : [node.id];
    if (!ensembleSelection.has(node.id)) {
      setSelection([node.id]);
      setAncre(node.id);
    }
    glisses.current = ids;
    e.dataTransfer.setData(MIME_INTERNE, JSON.stringify(ids));
    e.dataTransfer.setData("text/plain", ids.map((id) => noeudPar(id)?.name).join("\n"));
    e.dataTransfer.effectAllowed = "copyMove";
  };

  const finGlisse = () => {
    glisses.current = null;
    setCibleDepot(undefined);
  };

  /// Propriétés de dépôt d'une cible. `cle` sert au surlignage.
  const proprietesDepot = (cle, { accepte, deposer }) => ({
    "data-cible": cibleDepot === cle ? "true" : undefined,
    onDragOver: (e) => {
      if (!accepte(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = estInterne(e) ? (e.ctrlKey || e.altKey ? "copy" : "move") : "copy";
      if (cibleDepot !== cle) setCibleDepot(cle);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setCibleDepot((c) => (c === cle ? undefined : c));
    },
    onDrop: (e) => {
      if (!accepte(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setCibleDepot(undefined);
      deposer(e);
    },
  });

  const deposerDans = (e, cible) => {
    if (estInterne(e)) {
      const ids = glisses.current || JSON.parse(e.dataTransfer.getData(MIME_INTERNE) || "[]");
      glisses.current = null;
      if (!ids.length) return;
      if (e.ctrlKey || e.altKey) copier(ids, cible);
      else deplacer(ids, cible);
      return;
    }
    // Lu tout de suite : le navigateur vide `dataTransfer` après l'événement.
    lireDepot(e.dataTransfer).then((entrees) => importer(entrees, cible));
  };

  const depotDossier = (id) =>
    proprietesDepot(id ?? "racine", {
      accepte: (e) => {
        if (contientFichiers(e)) return true;
        if (!estInterne(e)) return false;
        // Un élément ne se dépose pas sur lui-même.
        return !(glisses.current || []).includes(id);
      },
      deposer: (e) => deposerDans(e, id ?? null),
    });

  const depotCorbeille = proprietesDepot("corbeille", {
    accepte: estInterne,
    deposer: () => {
      const cibles = (glisses.current || []).map(noeudPar).filter(Boolean);
      glisses.current = null;
      mettreALaCorbeille(cibles);
    },
  });

  const depotIci = peutEcrire
    ? proprietesDepot("ici", { accepte: (e) => contientFichiers(e) || estInterne(e), deposer: (e) => deposerDans(e, dossierId) })
    : {};

  // ---- Sélection à la souris ------------------------------------------------

  /// Clic : sélection unique. Ctrl/⌘ : ajoute ou retire. Maj : étend
  /// depuis l'ancre. Un clic simple sur un fichier l'ouvre aussitôt dans
  /// son application — un explorateur sert avant tout à ouvrir ; les
  /// dossiers gardent le double-clic, pour pouvoir les sélectionner (sur
  /// téléphone, un toucher suffit : pas de double-tape).
  const cliquer = (e, node, i) => {
    e.stopPropagation();
    if (edition) return;
    setCourant(node.id);
    if (e.shiftKey && ancre != null) {
      const depart = elements.findIndex((n) => n.id === ancre);
      if (depart >= 0) {
        const [a, b] = depart < i ? [depart, i] : [i, depart];
        setSelection(elements.slice(a, b + 1).map((n) => n.id));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelection((s) => (s.includes(node.id) ? s.filter((id) => id !== node.id) : [...s, node.id]));
      setAncre(node.id);
      return;
    }
    setSelection([node.id]);
    setAncre(node.id);
    if (enCorbeille) return;
    if (node.type === "FILE" || telephone) ouvrir(node);
  };

  const doubleCliquer = (e, node) => {
    e.stopPropagation();
    if (!enCorbeille && node.type === "FOLDER" && !telephone) ouvrir(node);
  };

  // ---- Menus ----------------------------------------------------------------

  const menuNouveau = [
    { nom: "Dossier", icone: "faFolderPlus", raccourci: "Ctrl+Maj+N", action: creerDossier },
    { nom: "Document texte", icone: "faFileLines", action: creerTexte },
  ];
  const menuImporter = [
    { nom: "Des fichiers…", icone: "faFileArrowUp", action: () => fichierInput.current?.click() },
    { nom: "Un dossier…", icone: "faFolderOpen", action: () => dossierInput.current?.click() },
  ];
  const menuTri = [
    ...[
      ["nom", "Nom"],
      ["date", "Date de modification"],
      ["type", "Type"],
      ["taille", "Taille"],
    ].map(([cle, nom]) => ({
      nom,
      coche: reglages.tri.cle === cle,
      action: () => {
        setTriForce(true);
        reglagesAJour({ tri: { ...reglages.tri, cle } });
      },
    })),
    { separateur: true },
    { nom: "Croissant", coche: reglages.tri.sens === "asc", action: () => (setTriForce(true), reglagesAJour({ tri: { ...reglages.tri, sens: "asc" } })) },
    { nom: "Décroissant", coche: reglages.tri.sens === "desc", action: () => (setTriForce(true), reglagesAJour({ tri: { ...reglages.tri, sens: "desc" } })) },
  ];
  const menuVue = [
    { nom: "Grandes icônes", icone: "faTableCellsLarge", coche: vue === "grille", action: () => reglagesAJour({ vue: "grille" }) },
    { nom: "Petites icônes", icone: "faTableCells", coche: vue === "petites", action: () => reglagesAJour({ vue: "petites" }) },
    { nom: "Détails", icone: "faList", coche: vue === "details", action: () => reglagesAJour({ vue: "details" }) },
    { separateur: true },
    { nom: "Volet de détails", icone: "faTableColumns", coche: reglages.details, action: () => reglagesAJour({ details: !reglages.details }) },
  ];

  const changerTri = (cle) => {
    setTriForce(true);
    reglagesAJour({ tri: { cle, sens: reglages.tri.cle === cle && reglages.tri.sens === "asc" ? "desc" : "asc" } });
  };

  const menuVide = (e) =>
    menuContextuel(e, [
      enCorbeille
        ? { nom: "Vider la corbeille", icone: "faFireFlameSimple", danger: true, desactive: !nodes.length, action: viderCorbeille }
        : peutEcrire && { nom: "Nouveau", icone: "faPlus", sousMenu: menuNouveau },
      peutEcrire && { nom: "Importer", icone: "faFileArrowUp", sousMenu: menuImporter },
      peutEcrire && { nom: "Coller", icone: "faPaste", raccourci: "Ctrl+V", desactive: !presse, action: () => coller() },
      { separateur: true },
      { nom: "Affichage", icone: "faEye", sousMenu: menuVue },
      { nom: "Trier par", icone: "faArrowDownWideShort", sousMenu: menuTri },
      { nom: "Actualiser", icone: "faRotate", raccourci: "F5", action: charger },
      { separateur: true },
      {
        nom: "Tout sélectionner",
        icone: "faObjectGroup",
        raccourci: "Ctrl+A",
        desactive: !elements.length,
        action: () => setSelection(elements.map((n) => n.id)),
      },
      dossierId && { nom: estFavori({ id: dossierId }) ? "Retirer des favoris" : "Ajouter aux favoris", icone: "faStar", action: () => basculerFavori(index.parId.get(dossierId)) },
    ]);

  const menuElement = (node) => (e) => {
    // Clic droit hors sélection : on sélectionne d'abord la cible, sinon le
    // menu agirait sur des éléments que l'utilisateur ne regarde plus. Les
    // cibles sont passées explicitement : `setSelection` n'est pas encore
    // appliqué quand le menu se construit.
    const dans = ensembleSelection.has(node.id);
    if (!dans) {
      setSelection([node.id]);
      setAncre(node.id);
    }
    setCourant(node.id);
    const cibles = dans ? selectionnes : [node];
    const un = cibles.length === 1;
    const famille = familleDe(node);
    const n = un ? "" : ` (${cibles.length})`;

    if (enCorbeille) {
      return menuContextuel(e, [
        { nom: `Restaurer${n}`, icone: "faTrashArrowUp", action: () => restaurer(cibles) },
        { separateur: true },
        { nom: `Supprimer définitivement${n}`, icone: "faFireFlameSimple", danger: true, action: () => supprimerDefinitivement(cibles) },
      ]);
    }

    return menuContextuel(e, [
      { nom: "Ouvrir", icone: node.type === "FOLDER" ? "faFolderOpen" : "faArrowUpRightFromSquare", desactive: !un, action: () => ouvrir(node) },
      un && famille && node.type === "FILE" && { nom: `Ouvrir avec ${famille.label}`, image: famille.icone, action: () => ouvrirFichier(node, elements) },
      un && avecEmplacement && { nom: "Ouvrir l'emplacement", icone: "faFolderTree", action: () => afficherEmplacement(node) },
      { separateur: true },
      { nom: "Couper", icone: "faScissors", raccourci: "Ctrl+X", action: () => mettreDansPresse("couper", cibles) },
      { nom: "Copier", icone: "faCopy", raccourci: "Ctrl+C", action: () => mettreDansPresse("copier", cibles) },
      un && node.type === "FOLDER" && presse && { nom: "Coller dans ce dossier", icone: "faPaste", action: () => coller(node.id) },
      { nom: "Déplacer vers…", icone: "faFolderTree", action: () => versDossier("deplacer", cibles) },
      { nom: "Copier vers…", icone: "faClone", action: () => versDossier("copier", cibles) },
      { separateur: true },
      { nom: "Renommer", icone: "faPen", raccourci: "F2", desactive: !un, action: () => commencerRenommage(node) },
      {
        nom: un && node.type === "FILE" ? "Télécharger" : "Télécharger (ZIP)",
        icone: un && node.type === "FILE" ? "faDownload" : "faFileZipper",
        action: () => telecharger(cibles),
      },
      un && node.type === "FILE" && { nom: "Partager un lien…", icone: "faLink", action: () => ouvrirPartage(node) },
      un && node.type === "FILE" && { nom: "Versions…", icone: "faClockRotateLeft", action: () => ouvrirVersions(node, { onRestaure: charger }) },
      un && { nom: estFavori(node) ? "Retirer des favoris" : "Ajouter aux favoris", icone: "faStar", action: () => basculerFavori(node) },
      { separateur: true },
      { nom: `Mettre à la corbeille${n}`, icone: "faTrashCan", raccourci: "Suppr", danger: true, action: () => mettreALaCorbeille(cibles) },
    ]);
  };

  const menuDossierVolet = (d) => (e) =>
    menuContextuel(e, [
      { nom: "Ouvrir", icone: "faFolderOpen", action: () => aller({ type: "dossier", id: d.id }) },
      presse && { nom: "Coller dans ce dossier", icone: "faPaste", action: () => coller(d.id) },
      { nom: estFavori(d) ? "Retirer des favoris" : "Ajouter aux favoris", icone: "faStar", action: () => basculerFavori(d) },
      { nom: "Télécharger (ZIP)", icone: "faFileZipper", action: () => telecharger([d]) },
    ]);

  const menuFavori = (e, f) =>
    menuContextuel(e, [{ nom: "Retirer des favoris", icone: "faStar", action: () => basculerFavori(f) }]);

  const ouvrirMenu = (items) => (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    menuContextuel({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 2 }, items);
  };

  // ---- Clavier --------------------------------------------------------------

  /// Nombre de colonnes de la grille affichée : les éléments alignés sur
  /// la première ligne.
  const colonnes = () => {
    if (vue === "details" || telephone) return 1;
    const items = grilleRef.current?.querySelectorAll("[data-id]") || [];
    if (!items.length) return 1;
    const haut = items[0].offsetTop;
    let n = 0;
    for (const it of items) {
      if (it.offsetTop !== haut) break;
      n += 1;
    }
    return Math.max(1, n);
  };

  const allerA = (i, etendre) => {
    if (!elements.length) return;
    const j = Math.max(0, Math.min(elements.length - 1, i));
    const node = elements[j];
    setCourant(node.id);
    if (etendre && ancre != null) {
      const depart = elements.findIndex((n) => n.id === ancre);
      const [a, b] = depart < j ? [depart, j] : [j, depart];
      setSelection(elements.slice(a, b + 1).map((n) => n.id));
    } else {
      setSelection([node.id]);
      setAncre(node.id);
    }
    grilleRef.current?.querySelector(`[data-id="${CSS.escape(node.id)}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const surTouche = (e) => {
    if (edition || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const touche = e.key.toLowerCase();
    const pos = elements.findIndex((n) => n.id === courant);
    const fait = () => e.preventDefault();

    if (e.altKey && e.key === "ArrowLeft") return fait(), deplacerHistorique(-1);
    if (e.altKey && e.key === "ArrowRight") return fait(), deplacerHistorique(1);
    if (e.altKey && e.key === "ArrowUp") return fait(), remonter();
    if (e.key === "Backspace") return fait(), deplacerHistorique(-1);
    if (e.key === "F5") return fait(), charger();
    if (ctrl && touche === "f") return fait(), rechercheRef.current?.focus();
    if (ctrl && e.shiftKey && touche === "n") return fait(), creerDossier();
    if (ctrl && touche === "a") return fait(), setSelection(elements.map((n) => n.id));
    if (ctrl && touche === "c") return fait(), mettreDansPresse("copier");
    if (ctrl && touche === "x") return fait(), mettreDansPresse("couper");
    if (ctrl && touche === "v") return fait(), coller();
    if (e.key === "Escape") return presse ? setPresse(null) : viderSelection();
    if (e.key === "F2") return fait(), commencerRenommage();
    if (e.key === "Delete") {
      fait();
      return enCorbeille ? supprimerDefinitivement() : mettreALaCorbeille();
    }
    if (e.key === "Enter") {
      fait();
      if (seul) ouvrir(seul);
      else if (selectionnes.length > 1 && selectionnes.every((n) => n.type === "FILE")) selectionnes.forEach(ouvrir);
      return;
    }
    const pas = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: colonnes(), ArrowUp: -colonnes() }[e.key];
    if (pas) {
      fait();
      return allerA(pos < 0 ? 0 : pos + pas, e.shiftKey);
    }
    if (e.key === "Home") return fait(), allerA(0, e.shiftKey);
    if (e.key === "End") return fait(), allerA(elements.length - 1, e.shiftKey);
    // Frappe directe : saute au premier élément qui commence par la lettre.
    if (!ctrl && !e.altKey && e.key.length === 1 && /\S/.test(e.key)) {
      const apres = [...elements.slice(pos + 1), ...elements.slice(0, pos + 1)];
      const trouve = apres.find((n) => n.name.toLowerCase().startsWith(touche));
      if (trouve) allerA(elements.indexOf(trouve), false);
    }
  };

  // ---- Rendu ----------------------------------------------------------------

  const fil = lieu.type === "dossier" ? cheminDe(index, dossierId, { id: null, name: session.tenant?.name || RACINE.name }) : [{ id: lieu.type, name: nomLieu }];
  const octetsSelection = selectionnes.reduce((t, n) => t + (n.type === "FILE" ? Number(n.size || 0) : 0), 0);

  const vide = !chargement && !elements.length && !erreur;

  return (
    <div
      className="msfiles floatTab dpShad"
      data-size={wnapp.size}
      data-cascade={wnapp.cascade || 0}
      data-max={wnapp.max}
      style={{ ...(wnapp.size == "cstm" ? wnapp.dim : null), zIndex: wnapp.z }}
      data-hide={wnapp.hide}
      id={wnapp.icon + "App"}
    >
      <ToolBar app={wnapp.action} icon={wnapp.icon} size={wnapp.size} name={`${nomApp("explorer")} — ${nomLieu}`} />
      <div className="windowScreen flex flex-col expFenetre" data-telephone={telephone}>
        {/* Ruban : les gestes du lieu courant. */}
        <div className="expRubans">
          {enCorbeille ? (
            <>
              <Bouton icone="faTrashArrowUp" libelle="Restaurer" off={!selectionnes.length} onClick={() => restaurer()} />
              <Bouton icone="faFireFlameCurved" libelle="Supprimer définitivement" off={!selectionnes.length} onClick={() => supprimerDefinitivement()} />
              <Bouton icone="faBroom" libelle="Vider la corbeille" off={!nodes.length} onClick={viderCorbeille} />
            </>
          ) : (
            <>
              <Bouton icone="faPlus" libelle="Nouveau" off={!peutEcrire} onClick={ouvrirMenu(menuNouveau)} />
              <Bouton icone="faFileArrowUp" libelle="Importer" off={!peutEcrire || !!occupation} onClick={ouvrirMenu(menuImporter)} />
              <span className="expRubanSep" />
              <Bouton icone="faScissors" libelle="Couper" compact titre="Couper" raccourci="Ctrl+X" off={!selectionnes.length} onClick={() => mettreDansPresse("couper")} />
              <Bouton icone="faCopy" libelle="Copier" compact raccourci="Ctrl+C" off={!selectionnes.length} onClick={() => mettreDansPresse("copier")} />
              <Bouton icone="faPaste" libelle="Coller" compact raccourci="Ctrl+V" off={!presse || !peutEcrire} onClick={() => coller()} />
              <Bouton icone="faPen" libelle="Renommer" compact raccourci="F2" off={!seul} onClick={() => commencerRenommage()} />
              <Bouton icone="faLink" libelle="Partager" compact off={!seul || seul.type !== "FILE"} onClick={() => ouvrirPartage(seul)} />
              <Bouton icone="faDownload" libelle="Télécharger" off={!selectionnes.length} onClick={() => telecharger()} />
              <Bouton icone="faTrashCan" libelle="Supprimer" compact raccourci="Suppr" off={!selectionnes.length} onClick={() => mettreALaCorbeille()} />
            </>
          )}
          <span className="expRubanEspace" />
          <Bouton icone="faArrowDownWideShort" libelle="Trier" compact onClick={ouvrirMenu(menuTri)} />
          <Bouton icone="faEye" libelle="Affichage" compact onClick={ouvrirMenu(menuVue)} />
          {!telephone ? (
            <Bouton
              icone="faTableColumns"
              libelle="Détails" compact
              titre="Volet de détails"
              actif={reglages.details}
              onClick={() => reglagesAJour({ details: !reglages.details })}
            />
          ) : null}
        </div>

        <div className="restWindow flex-grow flex flex-col">
          <div className="sec1 expBarre">
            {telephone ? (
              <Icon className="navIcon hvtheme" fafa="faBars" width={14} onClick={() => setVoletOuvert((v) => !v)} pr />
            ) : null}
            <Icon className={"navIcon hvtheme" + (hid == 0 ? " disableIt" : "")} fafa="faArrowLeft" width={14} onClick={() => deplacerHistorique(-1)} pr />
            {!telephone ? (
              <Icon
                className={"navIcon hvtheme" + (hid + 1 >= hist.length ? " disableIt" : "")}
                fafa="faArrowRight"
                width={14}
                onClick={() => deplacerHistorique(1)}
                pr
              />
            ) : null}
            <Icon
              className={"navIcon hvtheme" + (lieu.type === "dossier" && !dossierId ? " disableIt" : "")}
              fafa="faArrowUp"
              width={14}
              onClick={remonter}
              pr
            />
            <div className="path-bar noscroll expFil" tabIndex="-1">
              <div className="dirfbox h-full flex">
                {fil.map((etape, i) => (
                  <div key={etape.id || "racine"} className="dirCont flex items-center">
                    <div
                      className="dncont"
                      tabIndex="-1"
                      onClick={() => lieu.type === "dossier" && aller({ type: "dossier", id: etape.id ?? null })}
                      {...(lieu.type === "dossier" && i < fil.length - 1 ? depotDossier(etape.id ?? null) : {})}
                    >
                      {etape.name}
                    </div>
                    <Icon className="dirchev" fafa="faChevronRight" width={8} />
                  </div>
                ))}
              </div>
            </div>
            <div className="srchbar expRecherche">
              <Icon className="searchIcon" src="search" width={12} />
              {/* Pas de texte indicatif : l'icône loupe dit à quoi sert le
                  champ. La recherche couvre le dossier ouvert et tous ses
                  sous-dossiers. */}
              <input
                ref={rechercheRef}
                type="search"
                aria-label={`Rechercher dans « ${nomLieu} » et ses sous-dossiers`}
                title={`Rechercher dans « ${nomLieu} » et ses sous-dossiers (Ctrl+F)`}
                onChange={(e) => {
                  setSaisie(e.target.value);
                  viderSelection();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSaisie("");
                  if (e.key === "Enter" || e.key === "ArrowDown") {
                    e.preventDefault();
                    zoneRef.current?.focus();
                    allerA(0, false);
                  }
                }}
                value={saisie}
              />
            </div>
          </div>

          <div className="sec2 expCorps">
            {telephone && voletOuvert ? <div className="expVoile" onClick={() => setVoletOuvert(false)} /> : null}
            <div className="expVoletHote" data-ouvert={voletOuvert}>
              <Volet
                index={index}
                lieu={lieu}
                favoris={favoris}
                deplie={deplie}
                basculer={basculer}
                aller={aller}
                nomEspace={session.tenant?.name}
                depotDossier={depotDossier}
                depotCorbeille={depotCorbeille}
                menuDossier={menuDossierVolet}
                retirerFavori={menuFavori}
                ouvrirNoeud={ouvrir}
              />
            </div>
            <div
              ref={zoneRef}
              className="contentarea"
              onClick={() => !edition && viderSelection()}
              onKeyDown={surTouche}
              tabIndex="-1"
              data-depot={cibleDepot === "ici" ? "true" : "false"}
              {...depotIci}
            >
              {cibleDepot === "ici" ? (
                <div className="dropVoile">
                  <Icon fafa="faCloudArrowUp" width={26} />
                  <span>Déposer dans « {nomLieu} »</span>
                </div>
              ) : null}
              {occupation ? (
                <div className="dropProgres">
                  {occupation.texte}
                  {occupation.total ? ` — ${occupation.fait + 1} sur ${occupation.total}` : ""}
                </div>
              ) : null}
              {session.status !== "authenticated" ? (
                <span className="text-xs mx-auto my-4">Connectez-vous pour accéder au cloud.</span>
              ) : (
                <div className="contentwrap cosScroll expDefile" onContextMenu={menuVide}>
                  {erreur ? (
                    <div className="expErreur" role="alert">
                      {erreur}
                      <button type="button" onClick={() => setErreur("")} aria-label="Masquer">
                        <Icon fafa="faXmark" width={10} />
                      </button>
                    </div>
                  ) : null}
                  {rechercheGlobale ? (
                    <div className="expBandeau">
                      {elements.length} résultat{elements.length > 1 ? "s" : ""} pour « {recherche} » dans « {nomLieu} » et ses sous-dossiers
                    </div>
                  ) : null}
                  <Contenu
                    elements={elements}
                    vue={vue}
                    telephone={telephone}
                    tri={reglages.tri}
                    changerTri={changerTri}
                    avecEmplacement={avecEmplacement}
                    index={index}
                    selection={ensembleSelection}
                    focus={courant}
                    coupes={coupes}
                    edition={edition}
                    renommer={renommer}
                    annulerEdition={() => {
                      setEdition(null);
                      zoneRef.current?.focus();
                    }}
                    cliquer={cliquer}
                    doubleCliquer={doubleCliquer}
                    menuElement={menuElement}
                    debutGlisse={debutGlisse}
                    finGlisse={finGlisse}
                    depotDossier={depotDossier}
                    grilleRef={grilleRef}
                  />
                  {vide ? (
                    <div className="expVide">
                      {enCorbeille
                        ? "La corbeille est vide."
                        : recherche
                          ? "Aucun élément ne correspond."
                          : lieu.type === "favoris"
                            ? "Aucun favori. Clic droit sur un dossier › « Ajouter aux favoris »."
                            : lieu.type === "recents"
                              ? "Aucun fichier récent."
                              : "Ce dossier est vide. Glissez-y des fichiers ou des dossiers depuis votre poste."}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            {reglages.details && !telephone ? (
              <PanneauDetails
                selection={selectionnes}
                lieuNom={nomLieu}
                nbElements={elements.length}
                index={index}
                fermer={() => reglagesAJour({ details: false })}
                actions={{
                  ouvrir,
                  telecharger,
                  partager: ouvrirPartage,
                  versions: (node) => ouvrirVersions(node, { onRestaure: charger }),
                }}
              />
            ) : null}
          </div>

          <div className="sec3">
            <div className="item-count text-xs">
              {elements.length} élément{elements.length > 1 ? "s" : ""}
              {selectionnes.length
                ? ` — ${selectionnes.length} sélectionné${selectionnes.length > 1 ? "s" : ""}${octetsSelection ? ` (${tailleLisible(octetsSelection)})` : ""}`
                : ""}
              {presse ? ` — ${presse.ids.length} ${presse.mode === "couper" ? "à déplacer" : "à copier"}` : ""}
            </div>
            {usage && !telephone ? (
              <div className="expQuota text-xs" title="Espace de stockage utilisé">
                <span className="expQuotaBarre">
                  <span style={{ width: `${Math.min(100, (usage.usedBytes / Math.max(1, usage.quota)) * 100)}%` }} />
                </span>
                {tailleLisible(usage.usedBytes)} sur {tailleLisible(usage.quota)}
              </div>
            ) : null}
            <div className="view-opts flex">
              <button type="button" className="viewicon hvtheme expVueBtn" data-open={vue == "details"} aria-label="Vue détails" title="Détails" onClick={() => reglagesAJour({ vue: "details" })}>
                <Icon fafa="faList" width={13} />
              </button>
              <button type="button" className="viewicon hvtheme expVueBtn" data-open={vue != "details"} aria-label="Vue icônes" title="Grandes icônes" onClick={() => reglagesAJour({ vue: "grille" })}>
                <Icon fafa="faTableCellsLarge" width={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
      {/* Aucun filtre de type : le cloud accepte tout, les visionneuses
          s'occupent de ce qu'elles savent lire. */}
      <input ref={fichierInput} type="file" multiple className="none" onChange={surChoixFichiers} />
      <input ref={dossierInput} type="file" multiple webkitdirectory="" className="none" onChange={surChoixDossier} />
    </div>
  );
};

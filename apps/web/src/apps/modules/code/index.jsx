import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { api } from "../../../api/client";
import { useTraduction } from "../../../utils/intl";
import { subscribeVisionneuse } from "../../openRequest";
import { modal } from "../../modalRequest";
import { charger, THEME_CLAIR, THEME_SOMBRE } from "./monaco";
import { formatable } from "./formatage";
import {
  OCTETS_MAX,
  estTexteLisible,
  fermer,
  langageDe,
  majContenu,
  marquerEnregistre,
  modifie,
  ouvrir,
  statistiques,
  indexerChemins,
  filtrer,
  THEMES,
  problemeDeNom,
  nomLibre,
  construireArbre,
  lignesVisibles,
  cheminOuvert,
} from "./domaine";
import "./code.scss";

// ---------------------------------------------------------------------------
// CODE — l'éditeur de VS Code, sur les fichiers du cloud
//
// Pourquoi ce n'est pas vscode.dev encadré : ce site répond
// `frame-ancestors 'none'`, il refuse tout iframe. On embarque donc Monaco,
// qui **est** l'éditeur de VS Code, et on le branche sur l'Explorateur.
//
// Ce que ça change à l'usage : les fichiers ne sont pas sur le poste de
// quelqu'un, ils sont dans l'espace de travail. Un collègue ouvre le même
// fichier depuis sa machine, sans rien installer.
// ---------------------------------------------------------------------------

const TEXTES = {
  fr: {
    fichiers: "Fichiers",
    aucunFichier: "Aucun fichier texte dans ce dossier.",
    racine: "Espace de travail",
    bienvenueTitre: "Ouvrez un fichier pour commencer",
    bienvenueTexte:
      "Choisissez un fichier à gauche, ou cliquez sur un fichier de code dans l'Explorateur.",
    enregistrer: "Enregistrer",
    enregistre: "Enregistré",
    chargement: "Chargement de l'éditeur…",
    trop: "Fichier trop volumineux pour l'éditeur ({taille}).",
    binaire: "Ce fichier n'est pas du texte : l'ouvrir ici l'abîmerait.",
    fermerModifie: "« {nom} » a des modifications non enregistrées.",
    fermerQuand: "Fermer sans enregistrer ?",
    fermerSans: "Fermer sans enregistrer",
    annuler: "Annuler",
    echecLecture: "Lecture impossible.",
    echecEcriture: "Enregistrement impossible.",
    lignes: "{n} lignes",
    remonter: "Dossier parent",
    rafraichir: "Rafraîchir",
    ouvrirRapide: "Ouvrir un fichier",
    ouvrirRapidePlaceholder: "Nom du fichier… (Ctrl+P)",
    aucunResultat: "Aucun fichier ne correspond.",
    echecEditeur: "L'éditeur n'a pas pu se charger.",
    nouveauFichier: "Nouveau fichier",
    nouveauDossier: "Nouveau dossier",
    renommer: "Renommer",
    supprimer: "Supprimer",
    supprimerTitre: "Mettre à la corbeille ?",
    supprimerMsg: "« {nom} » ira à la corbeille. Vous pourrez l'en sortir pendant 30 jours.",
    supprimerOui: "Mettre à la corbeille",
    nomRefuse: "Ce nom ne convient pas",
    "nom.vide": "Un nom est nécessaire.",
    "nom.reserve": "« . » et « .. » désignent des dossiers, pas des fichiers.",
    "nom.separateur": "Un nom ne peut pas contenir / ni \ : ce sont des séparateurs de chemin.",
    "nom.caractere": "Ces caractères sont interdits : < > : \" | ? *",
    "nom.long": "255 caractères au maximum.",
    "nom.existe": "Ce nom est déjà pris dans ce dossier.",
    echecCreation: "Création impossible.",
    echecRenommage: "Renommage impossible.",
    echecSuppression: "Suppression impossible.",
    theme: "Thème",
    "theme.auto": "Suivre l'OS",
    "theme.vs": "Clair",
    "theme.vs-dark": "Sombre",
    "theme.hc-light": "Contraste élevé, clair",
    "theme.hc-black": "Contraste élevé, sombre",
    formatage: "Formater",
    formatageInfo:
      "Mettre le fichier en forme à chaque enregistrement (Prettier). Shift+Alt+F le fait à la demande.",
  },
  en: {
    fichiers: "Files",
    aucunFichier: "No text file in this folder.",
    racine: "Workspace",
    bienvenueTitre: "Open a file to get started",
    bienvenueTexte: "Pick a file on the left, or click a code file in the Explorer.",
    enregistrer: "Save",
    enregistre: "Saved",
    chargement: "Loading the editor…",
    trop: "File too large for the editor ({taille}).",
    binaire: "This file is not text: opening it here would corrupt it.",
    fermerModifie: "“{nom}” has unsaved changes.",
    fermerQuand: "Close without saving?",
    fermerSans: "Close without saving",
    annuler: "Cancel",
    echecLecture: "Could not read the file.",
    echecEcriture: "Could not save.",
    lignes: "{n} lines",
    remonter: "Parent folder",
    rafraichir: "Refresh",
    ouvrirRapide: "Open a file",
    ouvrirRapidePlaceholder: "File name… (Ctrl+P)",
    aucunResultat: "No file matches.",
    echecEditeur: "The editor failed to load.",
    nouveauFichier: "New file",
    nouveauDossier: "New folder",
    renommer: "Rename",
    supprimer: "Delete",
    supprimerTitre: "Move to trash?",
    supprimerMsg: "“{nom}” will go to the trash. You can restore it for 30 days.",
    supprimerOui: "Move to trash",
    nomRefuse: "That name will not do",
    "nom.vide": "A name is required.",
    "nom.reserve": "“.” and “..” refer to folders, not files.",
    "nom.separateur": "A name cannot contain / or \ : those are path separators.",
    "nom.caractere": "These characters are not allowed: < > : \" | ? *",
    "nom.long": "255 characters at most.",
    "nom.existe": "That name is already taken in this folder.",
    echecCreation: "Could not create.",
    echecRenommage: "Could not rename.",
    echecSuppression: "Could not delete.",
    theme: "Theme",
    "theme.auto": "Follow the OS",
    "theme.vs": "Light",
    "theme.vs-dark": "Dark",
    "theme.hc-light": "High contrast, light",
    "theme.hc-black": "High contrast, dark",
    formatage: "Format",
    formatageInfo:
      "Format the file on every save (Prettier). Shift+Alt+F does it on demand.",
  },
};

export const manifest = {
  id: "code",
  slug: "code",
  name: "Code",
  icon: "code",
  action: "CODEAPP",
  Window: CodeApp,
};

const poids = (octets) => {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / 1024 / 1024).toFixed(1)} Mo`;
};

function CodeApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const theme = useSelector((state) => state.setting?.person?.theme);
  const t = useTraduction(TEXTES);

  const [onglets, setOnglets] = useState([]);
  const [actif, setActif] = useState(null);
  const [dossier, setDossier] = useState({ id: null, nom: "" });
  const [pret, setPret] = useState(false);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  // Retenu d'une session à l'autre : c'est une préférence de personne, pas
  // un réglage de fichier.
  const [formatageAuto, setFormatageAuto] = useState(
    () => localStorage.getItem("companyos-code-formatage") === "1",
  );
  useEffect(() => {
    localStorage.setItem("companyos-code-formatage", formatageAuto ? "1" : "0");
  }, [formatageAuto]);

  // Ouverture rapide : l'index de tout l'espace, chargé une fois.
  const [index, setIndex] = useState([]);
  const [noeuds, setNoeuds] = useState([]);
  const [deplies, setDeplies] = useState(() => new Set());
  const [palette, setPalette] = useState(null); // null = fermée
  const [choix, setChoix] = useState(0);
  const champPalette = useRef(null);

  // Thème de la zone d'édition. « auto » suit le mode clair/sombre de l'OS ;
  // les autres sont ceux de VS Code, y compris les deux à contraste élevé.
  const [themeCode, setThemeCode] = useState(
    () => localStorage.getItem("companyos-code-theme") || "auto",
  );
  useEffect(() => {
    localStorage.setItem("companyos-code-theme", themeCode);
  }, [themeCode]);

  // Menu contextuel de l'arborescence : { x, y, node }.
  const [menu, setMenu] = useState(null);

  const hote = useRef(null);
  const editeur = useRef(null);
  const monacoRef = useRef(null);
  const modeles = useRef(new Map());
  // Le rendu ne voit pas l'état à jour depuis un écouteur clavier posé une
  // seule fois : on garde une référence vivante pour l'enregistrement.
  const vif = useRef({ onglets: [], actif: null });
  vif.current = { onglets, actif };

  const ongletActif = onglets.find((o) => o.id === actif) || null;

  // --- Monaco ---------------------------------------------------------------

  useEffect(() => {
    if (!wnapp || wnapp.hide) return undefined;
    let vivant = true;

    charger().then((monaco) => {
      if (!vivant || !hote.current || editeur.current) return;
      monacoRef.current = monaco;
      editeur.current = monaco.editor.create(hote.current, {
        automaticLayout: true,
        fontSize: 13,
        fontFamily: "'Cascadia Code', 'Consolas', 'Fira Code', monospace",
        minimap: { enabled: true, renderCharacters: false },
        scrollBeyondLastLine: false,
        renderWhitespace: "selection",
        tabSize: 2,
        // Les deux confforts qu'on remarque surtout quand ils manquent.
        bracketPairColorization: { enabled: true },
        smoothScrolling: true,
      });

      editeur.current.onDidChangeModelContent(() => {
        const { actif: id } = vif.current;
        if (!id) return;
        const texte = editeur.current.getValue();
        setOnglets((liste) => majContenu(liste, id, texte));
      });

      // Ctrl+S / Cmd+S : le seul raccourci qu'on tape sans y penser.
      editeur.current.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
        () => enregistrerRef.current(),
      );

      setPret(true);
    })
      .catch((e) => {
        // Sans ce garde, un échec de chargement de Monaco laissait une
        // fenêtre entièrement vide et muette : la promesse était rejetée
        // dans le vide, `pret` restait faux, et rien n'expliquait rien.
        // Un outil qui tombe doit le dire.
        console.error("Chargement de l'éditeur impossible :", e);
        if (vivant) setErreur(`${t("echecEditeur")} ${e.message}`);
      });

    return () => {
      vivant = false;
    };
  }, [wnapp?.hide]);

  // Défaire à la fermeture de la fenêtre : Monaco garde des modèles et des
  // workers vivants, qui s'accumuleraient à chaque ouverture.
  useEffect(
    () => () => {
      for (const modele of modeles.current.values()) modele.dispose();
      modeles.current.clear();
      editeur.current?.dispose();
      editeur.current = null;
    },
    [],
  );

  // Le thème suit celui de l'OS, comme le reste des fenêtres.
  useEffect(() => {
    if (!pret || !monacoRef.current) return;
    const sombre = document.body.dataset.theme === "dark" || theme === "dark";
    const choisi = themeCode === "auto" ? (sombre ? THEME_SOMBRE : THEME_CLAIR) : themeCode;
    monacoRef.current.editor.setTheme(choisi);
  }, [pret, theme, themeCode]);

  // Un modèle Monaco par onglet : c'est lui qui porte l'historique
  // d'annulation et la position du curseur. Sans cela, changer d'onglet
  // remettrait le curseur en haut et effacerait les Ctrl+Z.
  useEffect(() => {
    if (!pret || !editeur.current || !monacoRef.current) return;
    if (!ongletActif) {
      editeur.current.setModel(null);
      return;
    }
    let modele = modeles.current.get(ongletActif.id);
    if (!modele) {
      modele = monacoRef.current.editor.createModel(
        ongletActif.contenu,
        ongletActif.langage,
      );
      modeles.current.set(ongletActif.id, modele);
    }
    if (editeur.current.getModel() !== modele) {
      editeur.current.setModel(modele);
      editeur.current.focus();
    }
  }, [pret, actif, ongletActif?.id]);

  // --- Arborescence ---------------------------------------------------------

  // Les entrées du dossier ciblé, dérivées de l'arborescence déjà chargée :
  // il n'y a plus de second appel à tenir d'accord avec le premier.
  const entrees = noeuds.filter((n) => (n.parentId || null) === (dossier.id || null));

  // L'index de l'espace entier, pour l'ouverture rapide. Une seule requête,
  // rafraîchie à chaque ouverture de la fenêtre : un fichier ajouté depuis
  // l'Explorateur pendant qu'on code doit finir par apparaître.
  useEffect(() => {
    if (!wnapp || wnapp.hide || session.status !== "authenticated") return;
    api
      .arborescence()
      .then((r) => {
        setNoeuds(r.noeuds || []);
        setIndex(indexerChemins(r.noeuds || []));
      })
      .catch(() => {
        setNoeuds([]);
        setIndex([]);
      });
  }, [wnapp?.hide, session.status]);

  // Ctrl+P — le raccourci est posé sur la fenêtre et non sur l'éditeur :
  // il doit répondre même quand le curseur est dans l'arborescence.
  useEffect(() => {
    if (!wnapp || wnapp.hide) return undefined;
    const surTouche = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPalette("");
        setChoix(0);
      }
    };
    const racine = hote.current?.closest(".codeApp");
    racine?.addEventListener("keydown", surTouche);
    return () => racine?.removeEventListener("keydown", surTouche);
  }, [wnapp?.hide, pret]);

  useEffect(() => {
    if (palette !== null) champPalette.current?.focus();
  }, [palette]);

  // --- Ouverture ------------------------------------------------------------

  const ouvrirNode = useCallback(
    async (node) => {
      setErreur("");
      if (onglets.some((o) => o.id === node.id)) {
        setActif(node.id);
        return;
      }
      if (Number(node.size) > OCTETS_MAX) {
        setErreur(t("trop", { taille: poids(Number(node.size)) }));
        return;
      }
      setEnCours(true);
      try {
        const url = await api.streamUrl(node.id);
        const octets = new Uint8Array(await (await fetch(url)).arrayBuffer());
        if (!estTexteLisible(octets)) {
          setErreur(t("binaire"));
          return;
        }
        const texte = new TextDecoder("utf-8").decode(octets);
        const suite = ouvrir(onglets, node, texte);
        setOnglets(suite.onglets);
        setActif(suite.actif);
      } catch {
        setErreur(t("echecLecture"));
      } finally {
        setEnCours(false);
      }
    },
    [onglets, t],
  );

  // Un clic sur un fichier de code dans l'Explorateur arrive ici.
  useEffect(
    () => subscribeVisionneuse(manifest.action, (charge) => {
      if (charge?.node) ouvrirNode(charge.node);
    }),
    [ouvrirNode],
  );

  // --- Créer, renommer, supprimer -------------------------------------------
  //
  // Tout passe par l'API de l'Explorateur : ce sont les mêmes fichiers, vus
  // d'une autre fenêtre. Un dossier créé ici apparaît là-bas, et
  // réciproquement — il n'y a pas deux arborescences à tenir d'accord.

  /// Recharge le dossier courant **et** l'index de l'ouverture rapide.
  /// Oublier le second laissait Ctrl+P proposer des fichiers supprimés.
  const rafraichirTout = useCallback(() => {
    api
      .arborescence()
      .then((r) => {
        setNoeuds(r.noeuds || []);
        setIndex(indexerChemins(r.noeuds || []));
      })
      .catch(() => {});
  }, []);

  /// Demande un nom, en refusant ceux qui ne peuvent pas en être un.
  /// La boucle est volontaire : on repose la question avec le motif du
  /// refus plutôt que d'abandonner la création.
  const demanderNom = useCallback(
    async (titre, propose) => {
      const pris = entrees.map((e) => e.name);
      let valeur = nomLibre(propose, pris);
      for (let essai = 0; essai < 5; essai += 1) {
        const saisi = await modal.prompt({ title: titre, value: valeur });
        if (saisi === null) return null;
        const souci = problemeDeNom(saisi, pris);
        if (!souci) return saisi.trim();
        await modal.alert({ title: t("nomRefuse"), message: t(`nom.${souci}`), tone: "error" });
        valeur = saisi;
      }
      return null;
    },
    [entrees, t],
  );

  const creerFichier = useCallback(async () => {
    const nom = await demanderNom(t("nouveauFichier"), "sans-titre.js");
    if (!nom) return;
    setEnCours(true);
    try {
      // Un fichier vide, créé par le même chemin que n'importe quel envoi :
      // il hérite ainsi du quota, du journal et de la destination de
      // stockage de l'espace, sans code particulier.
      const node = await api.uploadFile(new File([""], nom, { type: "text/plain" }), dossier.id);
      rafraichirTout();
      ouvrirNode(node);
    } catch {
      setErreur(t("echecCreation"));
    } finally {
      setEnCours(false);
    }
  }, [demanderNom, dossier.id, rafraichirTout, ouvrirNode, t]);

  const creerDossier = useCallback(async () => {
    const nom = await demanderNom(t("nouveauDossier"), "nouveau-dossier");
    if (!nom) return;
    try {
      await api.createFolder(nom, dossier.id);
      rafraichirTout();
    } catch {
      setErreur(t("echecCreation"));
    }
  }, [demanderNom, dossier.id, rafraichirTout, t]);

  const renommer = useCallback(
    async (node) => {
      const autres = entrees.filter((e) => e.id !== node.id).map((e) => e.name);
      const saisi = await modal.prompt({ title: t("renommer"), value: node.name });
      if (saisi === null || saisi.trim() === node.name) return;
      const souci = problemeDeNom(saisi, autres);
      if (souci) {
        await modal.alert({ title: t("nomRefuse"), message: t(`nom.${souci}`), tone: "error" });
        return;
      }
      try {
        await api.renameNode(node.id, saisi.trim());
        // L'onglet ouvert porte l'ancien nom : le corriger évite
        // d'enregistrer sous un nom qui n'existe plus.
        setOnglets((l) =>
          l.map((o) => (o.id === node.id ? { ...o, nom: saisi.trim(), langage: langageDe(saisi) } : o)),
        );
        rafraichirTout();
      } catch {
        setErreur(t("echecRenommage"));
      }
    },
    [entrees, rafraichirTout, t],
  );

  const supprimer = useCallback(
    async (node) => {
      const ok = await modal.confirm({
        title: t("supprimerTitre"),
        message: t("supprimerMsg", { nom: node.name }),
        confirmLabel: t("supprimerOui"),
        danger: true,
      });
      if (!ok) return;
      try {
        await api.deleteNode(node.id);
        // L'onglet correspondant part avec : garder ouvert un fichier
        // supprimé mène à un enregistrement qui échoue sans qu'on comprenne.
        modeles.current.get(node.id)?.dispose();
        modeles.current.delete(node.id);
        setOnglets((l) => l.filter((o) => o.id !== node.id));
        setActif((a) => (a === node.id ? null : a));
        rafraichirTout();
      } catch {
        setErreur(t("echecSuppression"));
      }
    },
    [rafraichirTout, t],
  );

  // --- Enregistrement -------------------------------------------------------

  const enregistrer = useCallback(async () => {
    const { onglets: liste, actif: id } = vif.current;
    const onglet = liste.find((o) => o.id === id);
    if (!onglet || !modifie(onglet)) return;
    setEnCours(true);
    setErreur("");
    try {
      // Formater d'abord, enregistrer ensuite — sinon on écrit la version
      // non formatée puis on rouvre un fichier « modifié » aussitôt.
      //
      // L'option est éteinte par défaut, comme dans VS Code : reformater
      // sans prévenir un fichier qu'on venait corriger d'une ligne produit
      // un diff de trois cents lignes, et fait perdre la confiance.
      let contenu = onglet.contenu;
      if (formatageAuto && editeur.current && formatable(onglet.langage)) {
        await editeur.current.getAction("editor.action.formatDocument")?.run();
        contenu = editeur.current.getValue();
        setOnglets((l) => majContenu(l, onglet.id, contenu));
      }

      const fichier = new File([contenu], onglet.nom, {
        type: "text/plain;charset=utf-8",
      });
      await api.updateFileContent(onglet.id, fichier);
      setOnglets((l) => marquerEnregistre(l, onglet.id));
    } catch {
      setErreur(t("echecEcriture"));
    } finally {
      setEnCours(false);
    }
  }, [t, formatageAuto]);

  // L'écouteur Ctrl+S est posé une fois, à la création de l'éditeur : il
  // capturerait la première version de `enregistrer`. Cette référence lui
  // donne toujours la version courante.
  const enregistrerRef = useRef(enregistrer);
  enregistrerRef.current = enregistrer;

  const fermerOnglet = useCallback(
    async (id) => {
      const onglet = onglets.find((o) => o.id === id);
      if (onglet && modifie(onglet)) {
        const ok = await modal.confirm({
          title: t("fermerQuand"),
          message: t("fermerModifie", { nom: onglet.nom }),
          confirmLabel: t("fermerSans"),
          danger: true,
        });
        if (!ok) return;
      }
      modeles.current.get(id)?.dispose();
      modeles.current.delete(id);
      const suite = fermer(onglets, id, actif);
      setOnglets(suite.onglets);
      setActif(suite.actif);
    },
    [onglets, actif, t],
  );

  // --- Rendu ----------------------------------------------------------------

  const stats = statistiques(ongletActif?.contenu || "");
  const dossiers = entrees.filter((n) => n.type === "FOLDER");
  const fichiers = entrees.filter((n) => n.type === "FILE");

  return (
    <ModuleWindow manifest={manifest} className="codeApp">
      <div className="codeCorps">
        <aside className="codeLateral">
          <div className="codeLateralTete">
            <span>{t("fichiers")}</span>
            <span className="codeOutils">
              <button
                type="button"
                className="codeIconeBtn"
                onClick={creerFichier}
                title={t("nouveauFichier")}
                aria-label={t("nouveauFichier")}
              >
                ＋
              </button>
              <button
                type="button"
                className="codeIconeBtn"
                onClick={creerDossier}
                title={t("nouveauDossier")}
                aria-label={t("nouveauDossier")}
              >
                ⊞
              </button>
              <button
                type="button"
                className="codeIconeBtn"
                onClick={rafraichirTout}
                title={t("rafraichir")}
                aria-label={t("rafraichir")}
              >
                ⟳
              </button>
            </span>
          </div>

          <ul className="codeArbre">
            {lignesVisibles(construireArbre(noeuds), deplies).map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className="codeEntree"
                  data-actif={n.id === actif}
                  style={{ paddingLeft: 8 + n.profondeur * 12 }}
                  onClick={() => {
                    if (n.type === "FOLDER") {
                      // Le dossier cliqué devient la cible des créations :
                      // « nouveau fichier » doit atterrir là où on regarde.
                      setDossier({ id: n.id, nom: n.name });
                      setDeplies((d) => {
                        const s2 = new Set(d);
                        if (s2.has(n.id)) s2.delete(n.id);
                        else s2.add(n.id);
                        return s2;
                      });
                    } else {
                      ouvrirNode(n);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, node: n });
                  }}
                >
                  {n.type === "FOLDER" ? (
                    <span className="codeChevron" data-ouvert={n.ouvert} aria-hidden="true">
                      ›
                    </span>
                  ) : (
                    <span className="codeChevron" aria-hidden="true" />
                  )}
                  <span
                    className="codePuce"
                    data-genre={n.type === "FOLDER" ? "dossier" : langageDe(n.name)}
                  />
                  {n.name}
                </button>
              </li>
            ))}
            {!noeuds.length && <li className="codeVide">{t("aucunFichier")}</li>}
          </ul>
        </aside>

        <section className="codeZone">
          <div className="codeOnglets" role="tablist">
            {onglets.map((o) => (
              <div
                key={o.id}
                className="codeOnglet"
                data-actif={o.id === actif}
                role="tab"
                aria-selected={o.id === actif}
              >
                <button type="button" onClick={() => setActif(o.id)}>
                  {o.nom}
                  {modifie(o) && <i className="codePastille" aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  className="codeFermer"
                  onClick={() => fermerOnglet(o.id)}
                  aria-label={`${t("annuler")} ${o.nom}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {erreur && <p className="codeErreur">{erreur}</p>}

          <div className="codeEditeurEnveloppe" data-vide={!ongletActif}>
            <div ref={hote} className="codeEditeur" />
            {!ongletActif && (
              <div className="codeAccueil">
                <h2>{t("bienvenueTitre")}</h2>
                <p>{t("bienvenueTexte")}</p>
                {!pret && <p className="codeDiscret">{t("chargement")}</p>}
              </div>
            )}
          </div>

          {menu && (
            <div className="codeMenuFond" onClick={() => setMenu(null)} role="presentation">
              <ul
                className="codeMenu"
                style={{ left: menu.x, top: menu.y }}
                onClick={(e) => e.stopPropagation()}
              >
                <li>
                  <button type="button" onClick={() => { const n = menu.node; setMenu(null); renommer(n); }}>
                    {t("renommer")}
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className="codeDanger"
                    onClick={() => { const n = menu.node; setMenu(null); supprimer(n); }}
                  >
                    {t("supprimer")}
                  </button>
                </li>
              </ul>
            </div>
          )}

          {palette !== null && (
            <div
              className="codePaletteFond"
              onClick={() => setPalette(null)}
              role="presentation"
            >
              <div
                className="codePalette"
                role="dialog"
                aria-modal="true"
                aria-label={t("ouvrirRapide")}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  ref={champPalette}
                  type="text"
                  value={palette}
                  placeholder={t("ouvrirRapidePlaceholder")}
                  onChange={(e) => {
                    setPalette(e.target.value);
                    setChoix(0);
                  }}
                  onKeyDown={(e) => {
                    const liste = filtrer(index, palette);
                    if (e.key === "Escape") { setPalette(null); return; }
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setChoix((c) => Math.min(c + 1, liste.length - 1));
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setChoix((c) => Math.max(c - 1, 0));
                    }
                    if (e.key === "Enter" && liste[choix]) {
                      e.preventDefault();
                      setPalette(null);
                      ouvrirNode({ id: liste[choix].id, name: liste[choix].nom, size: liste[choix].size });
                    }
                  }}
                />
                <ul>
                  {filtrer(index, palette).map((e, i) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        data-choisi={i === choix}
                        onMouseOver={() => setChoix(i)}
                        onClick={() => {
                          setPalette(null);
                          ouvrirNode({ id: e.id, name: e.nom, size: e.size });
                        }}
                      >
                        <span className="codePuce" data-genre={e.langage} />
                        <b>{e.nom}</b>
                        <small>{e.chemin}</small>
                      </button>
                    </li>
                  ))}
                  {!filtrer(index, palette).length && (
                    <li className="codeVide">{t("aucunResultat")}</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          <footer className="codeBarreEtat">
            <span>{ongletActif ? ongletActif.langage : ""}</span>
            <span>{ongletActif ? t("lignes", { n: stats.lignes }) : ""}</span>
            <span>{ongletActif ? stats.finDeLigne : ""}</span>
            {ongletActif && formatable(ongletActif.langage) && (
              <button
                type="button"
                className="codeBascule"
                data-actif={formatageAuto}
                aria-pressed={formatageAuto}
                onClick={() => setFormatageAuto((v) => !v)}
                title={t("formatageInfo")}
              >
                {t("formatage")}
              </button>
            )}
            <span className="codeEspace" />
            <label className="codeTheme">
              <span className="codeInvisible">{t("theme")}</span>
              <select value={themeCode} onChange={(e) => setThemeCode(e.target.value)}>
                {THEMES.map((th) => (
                  <option key={th.id} value={th.id}>
                    {t(`theme.${th.id}`)}
                  </option>
                ))}
              </select>
            </label>
            {ongletActif && (
              <button
                type="button"
                className="codeEnregistrer"
                onClick={enregistrer}
                disabled={!modifie(ongletActif) || enCours}
              >
                {modifie(ongletActif) ? t("enregistrer") : t("enregistre")}
              </button>
            )}
          </footer>
        </section>
      </div>
    </ModuleWindow>
  );
}

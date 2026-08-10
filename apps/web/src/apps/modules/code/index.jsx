import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { api } from "../../../api/client";
import { useTraduction } from "../../../utils/intl";
import { subscribeVisionneuse } from "../../openRequest";
import { modal } from "../../modalRequest";
import { charger } from "./monaco";
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
  const [entrees, setEntrees] = useState([]);
  const [pret, setPret] = useState(false);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);

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
    monacoRef.current.editor.setTheme(sombre ? "cos-sombre" : "cos-clair");
  }, [pret, theme]);

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

  const lireDossier = useCallback(
    (id) => {
      api
        .listFiles(id)
        .then((liste) => setEntrees(liste))
        .catch(() => setEntrees([]));
    },
    [],
  );

  useEffect(() => {
    if (!wnapp || wnapp.hide || session.status !== "authenticated") return;
    lireDossier(dossier.id);
  }, [wnapp?.hide, session.status, dossier.id, lireDossier]);

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

  // --- Enregistrement -------------------------------------------------------

  const enregistrer = useCallback(async () => {
    const { onglets: liste, actif: id } = vif.current;
    const onglet = liste.find((o) => o.id === id);
    if (!onglet || !modifie(onglet)) return;
    setEnCours(true);
    setErreur("");
    try {
      const fichier = new File([onglet.contenu], onglet.nom, {
        type: "text/plain;charset=utf-8",
      });
      await api.updateFileContent(onglet.id, fichier);
      setOnglets((l) => marquerEnregistre(l, onglet.id));
    } catch {
      setErreur(t("echecEcriture"));
    } finally {
      setEnCours(false);
    }
  }, [t]);

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
            <button
              type="button"
              className="codeIconeBtn"
              onClick={() => lireDossier(dossier.id)}
              title={t("rafraichir")}
              aria-label={t("rafraichir")}
            >
              ⟳
            </button>
          </div>

          <div className="codeChemin">
            {dossier.id ? (
              <button type="button" onClick={() => setDossier({ id: null, nom: "" })}>
                ← {t("racine")}
              </button>
            ) : (
              <span>{t("racine")}</span>
            )}
          </div>

          <ul className="codeArbre">
            {dossiers.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="codeEntree"
                  onClick={() => setDossier({ id: d.id, nom: d.name })}
                >
                  <span className="codePuce" data-genre="dossier" />
                  {d.name}
                </button>
              </li>
            ))}
            {fichiers.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className="codeEntree"
                  data-actif={f.id === actif}
                  onClick={() => ouvrirNode(f)}
                >
                  <span className="codePuce" data-genre={langageDe(f.name)} />
                  {f.name}
                </button>
              </li>
            ))}
            {!dossiers.length && !fichiers.length && (
              <li className="codeVide">{t("aucunFichier")}</li>
            )}
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

          <footer className="codeBarreEtat">
            <span>{ongletActif ? ongletActif.langage : ""}</span>
            <span>{ongletActif ? t("lignes", { n: stats.lignes }) : ""}</span>
            <span>{ongletActif ? stats.finDeLigne : ""}</span>
            <span className="codeEspace" />
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

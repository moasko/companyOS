// Classeur — le tableur de CompanyOS.
//
// ─────────────────────────────────────────────────────────────────────────
// SA PLACE À CÔTÉ DU TABLEUR CSV
//
// Le Tableur CSV est un outil de fichier : ouvrir un .csv reçu, le
// corriger, le renvoyer. Le Classeur est un document de travail : des
// feuilles, des cellules mises en forme, des formats de nombre, et une
// existence propre dans l'espace de travail. Il lit et écrit du `.xlsx`.
//
// CE QUI VIENT DE react-spreadsheet
//
// Sa grille tient dans une `Matrix<CellBase>` — un tableau à deux
// dimensions d'**objets** cellule plutôt que de chaînes. C'est l'idée
// qu'on lui reprend : une cellule qui n'est qu'une chaîne ne peut pas être
// grasse. Son API est aussi une leçon de retenue (data, onChange,
// columnLabels, DataViewer, DataEditor) : quelques accessoires clairs
// plutôt qu'une configuration à cinquante entrées.
//
// Ce qu'on ne lui reprend pas : elle rend toute la grille, sans
// virtualisation, ce que ses auteurs assument pour de petits tableaux. Un
// classeur d'entreprise n'a pas ce luxe — le nôtre est virtualisé, comme
// le Tableur CSV.
//
// Le moteur de formules est celui du Tableur CSV, importé. Deux moteurs
// divergeraient au premier correctif.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { menuContextuel } from "../../menuRequest";
import { saveAs } from "../../cloud";
import { subscribeVisionneuse } from "../../openRequest";
import { notifier } from "../../notifications";
import { Contenu, useChargement } from "../../chargement";
import { useDevise, useLangue, useTraduction } from "../../../utils/intl";
import * as D from "./domaine";
import { depuisXlsx, versXlsx } from "./xlsx";
import { depuisXls, estXls } from "./xls";
import "./classeur.scss";

export const manifest = {
  id: "classeur",
  slug: "classeur",
  name: "Classeur",
  icon: "classeur",
  action: "CLASSEURAPP",
  Window: ClasseurApp,
};

const HAUTEUR_LIGNE = 26;
const LARGEUR_NUMEROTATION = 34;
// A…Z, AA…ZZ. Les colonnes vides restent virtuelles : elles n'alourdissent
// le document que lorsqu'une valeur ou un style y est réellement saisi.
const COLONNES_AFFICHEES = 702;
const CELLULE_VIDE_AFFICHEE = Object.freeze({ v: "" });
const MARGE = 6;
const BDD_BROUILLONS = "companyos-classeur-brouillons";

const magasinBrouillons = () => new Promise((resolve, reject) => {
  const requete = indexedDB.open(BDD_BROUILLONS, 1);
  requete.onupgradeneeded = () => {
    if (!requete.result.objectStoreNames.contains("brouillons")) {
      requete.result.createObjectStore("brouillons", { keyPath: "cle" });
    }
  };
  requete.onsuccess = () => resolve(requete.result);
  requete.onerror = () => reject(requete.error);
});

const operationBrouillon = async (mode, action) => {
  const bdd = await magasinBrouillons();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = bdd.transaction("brouillons", mode);
      const requete = action(transaction.objectStore("brouillons"));
      requete.onsuccess = () => resolve(requete.result);
      requete.onerror = () => reject(requete.error);
    });
  } finally {
    bdd.close();
  }
};

const lireBrouillon = (cle) => operationBrouillon("readonly", (m) => m.get(cle));
const ecrireBrouillon = (brouillon) => operationBrouillon("readwrite", (m) => m.put(brouillon));
const effacerBrouillon = (cle) => operationBrouillon("readwrite", (m) => m.delete(cle));

const cssBordure = (bordure) => {
  if (!bordure) return undefined;
  const epaisseur = ["medium", "thick", "double"].includes(bordure.style) ? 2 : 1;
  const type = bordure.style === "dashed" || bordure.style === "dashDot" ? "dashed"
    : bordure.style === "dotted" ? "dotted"
      : bordure.style === "double" ? "double" : "solid";
  return `${epaisseur}px ${type} #${bordure.couleur || "CBD5E1"}`;
};

function MiniGraphique({ objet, cellules, classeur, iFeuille }) {
  const p = objet?.plage;
  if (!p) return null;
  const matrice = [];
  for (let l = p.l1; l <= p.l2; l += 1) {
    const ligne = [];
    for (let c = p.c1; c <= p.c2; c += 1) {
      ligne.push(classeur ? D.valeurCalculeeClasseur(classeur, iFeuille, l, c) : D.valeurCalculee(cellules, l, c));
    }
    matrice.push(ligne);
  }
  const versN = (v) => Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  const avecEntete = matrice.length > 1 && matrice[0].slice(1).some((v) => !Number.isFinite(versN(v)));
  const debut = avecEntete ? 1 : 0;
  const largeur = Math.max(1, matrice[0]?.length || 1);
  const categories = matrice.slice(debut).map((ligne, i) => largeur > 1 ? String(ligne[0] || i + 1) : String(i + 1));
  const palette = objet.palette || ["#5B6CFF", "#00A6A6", "#F59E0B", "#E85AAD", "#34A853", "#8B5CF6"];
  const series = Array.from({ length: largeur > 1 ? largeur - 1 : 1 }, (_, j) => ({
    nom: avecEntete ? String(matrice[0][largeur > 1 ? j + 1 : j] || `Série ${j + 1}`) : `Série ${j + 1}`,
    valeurs: matrice.slice(debut).map((ligne) => {
      const n = versN(ligne[largeur > 1 ? j + 1 : j]);
      return Number.isFinite(n) ? n : 0;
    }),
    couleur: palette[j % palette.length],
  })).slice(0, 6);
  const valeurs = series.flatMap((s) => s.valeurs);
  const max = Math.max(1, ...valeurs);
  const min = Math.min(0, ...valeurs);
  const amplitude = Math.max(1, max - min);
  if (!valeurs.length) return <span className="clsObjetVide">Sélectionnez des nombres</span>;

  const titre = objet.titre || (objet.graphique === "secteurs" ? "Répartition" : "Analyse des données");
  const legende = objet.legende !== false;

  if (objet.graphique === "courbe") {
    return (
      <div className="clsGraphiquePro">
        <b className="clsGraphiqueTitre">{titre}</b>
        <svg className="clsMiniGraphique" viewBox="0 0 320 170" preserveAspectRatio="none">
          {[0, 1, 2, 3, 4].map((i) => <line key={i} x1="38" x2="306" y1={24 + i * 28} y2={24 + i * 28} className="clsGraphGrid" />)}
          <line x1="38" x2="38" y1="20" y2="140" className="clsGraphAxe" />
          <line x1="38" x2="306" y1="140" y2="140" className="clsGraphAxe" />
          {series.map((serie, si) => {
            const points = serie.valeurs.map((v, i) => `${42 + i * (258 / Math.max(1, serie.valeurs.length - 1))},${136 - ((v - min) / amplitude) * 108}`).join(" ");
            return <g key={si}><polyline points={points} fill="none" stroke={serie.couleur} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />{serie.valeurs.map((v, i) => <circle key={i} cx={42 + i * (258 / Math.max(1, serie.valeurs.length - 1))} cy={136 - ((v - min) / amplitude) * 108} r="3.5" fill="#fff" stroke={serie.couleur} strokeWidth="2" />)}</g>;
          })}
          {categories.slice(0, 8).map((cat, i) => <text key={i} x={42 + i * (258 / Math.max(1, Math.min(8, categories.length) - 1))} y="158" textAnchor="middle" className="clsGraphLabel">{cat.slice(0, 8)}</text>)}
        </svg>
        {legende ? <span className="clsGraphLegende">{series.map((s) => <i key={s.nom}><em style={{ background: s.couleur }} />{s.nom}</i>)}</span> : null}
      </div>
    );
  }
  if (objet.graphique === "secteurs") {
    const donnees = series[0].valeurs.map((v, i) => ({ valeur: Math.abs(v), nom: categories[i] || `${i + 1}`, couleur: palette[i % palette.length] })).filter((x) => x.valeur > 0);
    const total = donnees.reduce((a, b) => a + b.valeur, 0) || 1;
    let cumul = 0;
    return (
      <div className="clsGraphiquePro">
        <b className="clsGraphiqueTitre">{titre}</b>
        <div className="clsSecteurCorps">
          <svg className="clsGraphiqueSecteur" viewBox="0 0 120 120">
            {donnees.map((part, i) => { const debutPart = cumul; const taille = (part.valeur / total) * 100; cumul += taille; return <circle key={i} cx="60" cy="60" r="42" fill="none" stroke={part.couleur} strokeWidth="24" pathLength="100" strokeDasharray={`${taille} ${100 - taille}`} strokeDashoffset={-debutPart} transform="rotate(-90 60 60)" />; })}
            <text x="60" y="57" textAnchor="middle" className="clsSecteurTotal">Total</text>
            <text x="60" y="72" textAnchor="middle" className="clsSecteurValeur">{total.toLocaleString("fr")}</text>
          </svg>
          {legende ? <span className="clsGraphLegende clsGraphLegendeVerticale">{donnees.slice(0, 8).map((part) => <i key={part.nom}><em style={{ background: part.couleur }} />{part.nom} <small>{Math.round(part.valeur / total * 100)} %</small></i>)}</span> : null}
        </div>
      </div>
    );
  }
  return <div className="clsGraphiquePro"><b className="clsGraphiqueTitre">{titre}</b><span className="clsMiniBarres">{series[0].valeurs.map((v, i) => <i key={i} title={`${categories[i]} : ${v}`} style={{ height: `${Math.max(3, ((v - min) / amplitude) * 100)}%`, background: palette[i % palette.length] }} />)}</span></div>;
}

const TEXTES = {
  fr: {
    verrou: "Connectez-vous pour ouvrir un classeur.",
    mesClasseurs: "Mes classeurs",
    nouveau: "Nouveau classeur",
    importer: "Importer un fichier Excel",
    xlsLu: "Ancien format Excel lu",
    xlsLuAide: "Les valeurs ont été reprises. L'enregistrement produira un .xlsx.",
    pasUnClasseur: "Ce fichier n'est pas un classeur Excel lisible.",
    pasUnClasseurAide:
      "Les formats reconnus sont .xlsx et .xls. Un fichier renommé, protégé par mot de passe ou incomplet ne peut pas être ouvert.",
    aucun: "Aucun classeur",
    aucunAide: "Créez-en un, ou importez un fichier Excel existant.",
    ouvrirListe: "Mes classeurs",
    enregistrer: "Enregistrer",
    exporter: "Exporter en .xlsx",
    renommer: "Renommer",
    supprimer: "Supprimer",
    modifie: "Modifié",
    annuler: "Annuler",
    retablir: "Rétablir",
    // Mise en forme
    gras: "Gras",
    italique: "Italique",
    souligne: "Souligné",
    barre: "Barré",
    augmenterPolice: "Augmenter la taille",
    reduirePolice: "Réduire la taille",
    alignGauche: "Aligner à gauche",
    alignCentre: "Centrer",
    alignDroite: "Aligner à droite",
    couleurTexte: "Couleur du texte",
    couleurFond: "Couleur de fond",
    format: "Format",
    effacerStyle: "Effacer la mise en forme",
    // Feuilles
    nouvelleFeuille: "Nouvelle feuille",
    renommerFeuille: "Renommer la feuille",
    dupliquerFeuille: "Dupliquer la feuille",
    supprimerFeuille: "Supprimer la feuille",
    derniereFeuille: "Un classeur garde au moins une feuille.",
    // Lignes et colonnes
    insererLigneAvant: "Insérer une ligne au-dessus",
    insererLigneApres: "Insérer une ligne en dessous",
    supprimerLigne: "Supprimer la ligne",
    insererColAvant: "Insérer une colonne à gauche",
    insererColApres: "Insérer une colonne à droite",
    supprimerCol: "Supprimer la colonne",
    ajusterCol: "Ajuster à la largeur du contenu",
    // Messages
    titreClasseur: "Titre du classeur",
    nomFeuille: "Nom de la feuille",
    supprimerTitre: "Supprimer « {nom} » ?",
    supprimerMsg: "Le classeur et ses feuilles seront perdus.",
    enregistre: "Classeur enregistré",
    exporte: "Classeur exporté",
    erreurEnregistrement: "Enregistrement impossible",
    erreurImport: "Import impossible",
    erreurExport: "Export impossible",
    abandonTitre: "Abandonner les modifications ?",
    abandonMsg: "« {nom} » n'est pas enregistré.",
    abandonOui: "Abandonner",
    cellule: "Cellule",
    somme: "Somme",
    moyenne: "moyenne",
    nbCellules: "{n} cellules",
    aide: "Flèches pour se déplacer · Entrée ou F2 pour corriger · Ctrl+B gras · Ctrl+C / Ctrl+V · Ctrl+D recopie",
    copierN: "Copier {n} cellule(s)",
    collerIci: "Coller ici",
    viderCellules: "Vider les cellules",
    remplirBas: "Recopier vers le bas",
    supprimerLignesN: "Supprimer {n} ligne(s)",
    formulePlaceholder: "Valeur, ou =SOMME(A1:A10)",
    accueil: "Accueil",
    insertion: "Insertion",
    donnees: "Données",
    formules: "Formules",
    revision: "Révision",
    affichage: "Affichage",
    afficherClasseurs: "Afficher les classeurs",
    masquerClasseurs: "Masquer les classeurs",
    insererLigne: "Insérer une ligne",
    insererColonne: "Insérer une colonne",
    vider: "Effacer",
    zoom: "Zoom",
    sommeAuto: "Somme automatique",
    moyenneAuto: "Moyenne automatique",
    nombreAuto: "Compter les nombres",
    minimumAuto: "Minimum",
    maximumAuto: "Maximum",
    retirerDoublons: "Supprimer les doublons",
    surlignerDoublons: "Surligner les doublons",
    figerSelection: "Figer à la sélection",
    triCroissant: "Trier A → Z",
    triDecroissant: "Trier Z → A",
    rechercher: "Rechercher",
    remplacer: "Remplacer tout",
    rechercheValeur: "Texte à rechercher",
    remplacementValeur: "Remplacer par",
    introuvable: "Aucun résultat",
    figerLigne: "Figer la première ligne",
    figerColonne: "Figer la première colonne",
    libererVolets: "Libérer les volets",
    renvoyerLigne: "Renvoyer à la ligne",
    formatMonnaie: "Format monétaire",
    formatPourcent: "Format pourcentage",
    formatNombre: "Format numérique",
    // Disposition façon Excel
    fichier: "Fichier",
    classeurVierge: "Classeur vierge",
    ouvrirExcel: "Ouvrir un fichier Excel",
    ouvrirExcelMenu: "Ouvrir un fichier Excel (.xlsx, .xls)…",
    exporterMenu: "Exporter une copie (.xlsx)…",
    imprimer: "Imprimer…",
    rienAImprimer: "La feuille est vide : il n'y a rien à imprimer.",
    recents: "Récents",
    aucunRecent: "Aucun classeur pour l'instant. Ce que vous créez ici est rangé dans l'espace de travail, et s'exporte en vrai fichier Excel quand vous voulez.",
    bonjour: "Bonjour",
    fermer: "Fermer",
    feuillesN: "{n} feuille(s)",
    etatEnregistrement: "Enregistrement…",
    etatNonEnregistre: "Non enregistré",
    etatModifie: "Modifications non enregistrées",
    etatEnregistre: "Enregistré",
    etatEnregistreDetail: "Enregistré dans l'espace de travail",
    etatMoyenne: "Moyenne",
    etatNombre: "Nombre",
    etatSomme: "Somme",
    zoomArriere: "Zoom arrière",
    zoomAvant: "Zoom avant",
    zoom100: "Revenir à 100 %",
  },
  en: {
    verrou: "Sign in to open a workbook.",
    mesClasseurs: "My workbooks",
    nouveau: "New workbook",
    importer: "Import an Excel file",
    xlsLu: "Legacy Excel format read",
    xlsLuAide: "Values were imported. Saving will produce an .xlsx.",
    pasUnClasseur: "This file is not a readable Excel workbook.",
    pasUnClasseurAide:
      "Supported formats are .xlsx and .xls. A renamed, password-protected or incomplete file cannot be opened.",
    aucun: "No workbook",
    aucunAide: "Create one, or import an existing Excel file.",
    ouvrirListe: "My workbooks",
    enregistrer: "Save",
    exporter: "Export as .xlsx",
    renommer: "Rename",
    supprimer: "Delete",
    modifie: "Modified",
    annuler: "Undo",
    retablir: "Redo",
    gras: "Bold",
    italique: "Italic",
    souligne: "Underline",
    barre: "Strikethrough",
    augmenterPolice: "Increase font size",
    reduirePolice: "Decrease font size",
    alignGauche: "Align left",
    alignCentre: "Center",
    alignDroite: "Align right",
    couleurTexte: "Text colour",
    couleurFond: "Fill colour",
    format: "Format",
    effacerStyle: "Clear formatting",
    nouvelleFeuille: "New sheet",
    renommerFeuille: "Rename sheet",
    dupliquerFeuille: "Duplicate sheet",
    supprimerFeuille: "Delete sheet",
    derniereFeuille: "A workbook keeps at least one sheet.",
    insererLigneAvant: "Insert row above",
    insererLigneApres: "Insert row below",
    supprimerLigne: "Delete row",
    insererColAvant: "Insert column left",
    insererColApres: "Insert column right",
    supprimerCol: "Delete column",
    ajusterCol: "Fit to content",
    titreClasseur: "Workbook title",
    nomFeuille: "Sheet name",
    supprimerTitre: "Delete “{nom}”?",
    supprimerMsg: "The workbook and its sheets will be lost.",
    enregistre: "Workbook saved",
    exporte: "Workbook exported",
    erreurEnregistrement: "Could not save",
    erreurImport: "Could not import",
    erreurExport: "Could not export",
    abandonTitre: "Discard changes?",
    abandonMsg: "“{nom}” is not saved.",
    abandonOui: "Discard",
    cellule: "Cell",
    somme: "Sum",
    moyenne: "average",
    nbCellules: "{n} cells",
    aide: "Arrows to move · Enter or F2 to edit · Ctrl+B bold · Ctrl+C / Ctrl+V · Ctrl+D fills down",
    copierN: "Copy {n} cell(s)",
    collerIci: "Paste here",
    viderCellules: "Clear cells",
    remplirBas: "Fill down",
    supprimerLignesN: "Delete {n} row(s)",
    formulePlaceholder: "Value, or =SUM(A1:A10)",
    accueil: "Home",
    insertion: "Insert",
    donnees: "Data",
    formules: "Formulas",
    revision: "Review",
    affichage: "View",
    afficherClasseurs: "Show workbooks",
    masquerClasseurs: "Hide workbooks",
    insererLigne: "Insert row",
    insererColonne: "Insert column",
    vider: "Clear",
    zoom: "Zoom",
    sommeAuto: "AutoSum",
    moyenneAuto: "Auto average",
    nombreAuto: "Count numbers",
    minimumAuto: "Minimum",
    maximumAuto: "Maximum",
    retirerDoublons: "Remove duplicates",
    surlignerDoublons: "Highlight duplicates",
    figerSelection: "Freeze at selection",
    triCroissant: "Sort A → Z",
    triDecroissant: "Sort Z → A",
    rechercher: "Find",
    remplacer: "Replace all",
    rechercheValeur: "Text to find",
    remplacementValeur: "Replace with",
    introuvable: "No result",
    figerLigne: "Freeze top row",
    figerColonne: "Freeze first column",
    libererVolets: "Unfreeze panes",
    renvoyerLigne: "Wrap text",
    formatMonnaie: "Currency format",
    formatPourcent: "Percentage format",
    formatNombre: "Number format",
    fichier: "File",
    classeurVierge: "Blank workbook",
    ouvrirExcel: "Open an Excel file",
    ouvrirExcelMenu: "Open an Excel file (.xlsx, .xls)…",
    exporterMenu: "Export a copy (.xlsx)…",
    imprimer: "Print…",
    rienAImprimer: "The sheet is empty: there is nothing to print.",
    recents: "Recent",
    aucunRecent: "No workbook yet. What you create here is kept in the workspace, and exports to a real Excel file whenever you want.",
    bonjour: "Hello",
    fermer: "Close",
    feuillesN: "{n} sheet(s)",
    etatEnregistrement: "Saving…",
    etatNonEnregistre: "Not saved",
    etatModifie: "Unsaved changes",
    etatEnregistre: "Saved",
    etatEnregistreDetail: "Saved in the workspace",
    etatMoyenne: "Average",
    etatNombre: "Count",
    etatSomme: "Sum",
    zoomArriere: "Zoom out",
    zoomAvant: "Zoom in",
    zoom100: "Back to 100%",
  },
};

const COULEURS = [
  "", "D93025", "E8710A", "F9AB00", "188038", "1A73E8", "6F42C1", "5F6368", "111111",
];
const FONDS = [
  "", "FCE8E6", "FEF7E0", "E6F4EA", "E8F0FE", "F3E8FD", "F1F3F4", "FFF3CD",
];

const ONGLETS_RUBAN = ["accueil", "insertion", "formules", "donnees", "revision", "affichage"];
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;

/// Le menu Fichier, comme dans Excel et dans le Traitement de texte : tout
/// ce qui concerne le classeur en tant que fichier, dans une liste qu'on
/// referme d'un clic ou d'Échap.
function MenuFichier({ t, actions }) {
  const [ouvertMenu, setOuvertMenu] = useState(false);
  const racine = useRef(null);

  useEffect(() => {
    if (!ouvertMenu) return undefined;
    const fermer = (e) => {
      if (e.type === "keydown" ? e.key === "Escape" : !racine.current?.contains(e.target)) {
        setOuvertMenu(false);
      }
    };
    document.addEventListener("mousedown", fermer);
    document.addEventListener("keydown", fermer);
    return () => {
      document.removeEventListener("mousedown", fermer);
      document.removeEventListener("keydown", fermer);
    };
  }, [ouvertMenu]);

  const entrees = [
    { icone: "faFileCirclePlus", libelle: t("nouveau"), action: actions.nouveau },
    { icone: "faFolderOpen", libelle: t("ouvrirExcelMenu"), action: actions.ouvrir },
    { icone: "faFolder", libelle: t("mesClasseurs"), action: actions.classeurs },
    null,
    { icone: "faFloppyDisk", libelle: t("enregistrer"), raccourci: "Ctrl+S", action: actions.enregistrer },
    { icone: "faFileExport", libelle: t("exporterMenu"), action: actions.exporter },
    { icone: "faPrint", libelle: t("imprimer"), raccourci: "Ctrl+P", action: actions.imprimer },
  ];

  return (
    <div className="clsFichier" ref={racine}>
      <button
        type="button"
        className="clsOngletRuban clsOngletFichier"
        aria-haspopup="menu"
        aria-expanded={ouvertMenu}
        onClick={() => setOuvertMenu((v) => !v)}
      >
        {t("fichier")}
      </button>
      {ouvertMenu ? (
        <div className="clsMenuFichier" role="menu">
          {entrees.map((e, i) =>
            e ? (
              <button
                key={e.libelle}
                type="button"
                role="menuitem"
                disabled={!e.action}
                onClick={() => { setOuvertMenu(false); e.action?.(); }}
              >
                <Icon fafa={e.icone} width={13} />
                <span>{e.libelle}</span>
                {e.raccourci ? <kbd>{e.raccourci}</kbd> : null}
              </button>
            ) : (
              <hr key={`sep-${i}`} />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function ClasseurApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const t = useTraduction(TEXTES);
  const langue = useLangue();
  const { code: codeDevise } = useDevise();
  const devise = codeDevise === "EUR" ? "€" : codeDevise === "USD" ? "$" : "F";

  const [liste, setListe] = useState([]);
  const [fiche, setFiche] = useState(null); // enregistrement serveur
  const [classeur, setClasseur] = useState(null);
  const [iFeuille, setIFeuille] = useState(0);
  const [modifie, setModifie] = useState(false);
  const [historique, setHistorique] = useState({ passe: [], futur: [] });

  const [sel, setSel] = useState({ l: 0, c: 0, l2: 0, c2: 0 });
  const [edition, setEdition] = useState(null);
  const [defilement, setDefilement] = useState(0);
  const [defilementX, setDefilementX] = useState(0);
  const [hauteurVue, setHauteurVue] = useState(400);
  const [largeurVue, setLargeurVue] = useState(900);
  const [redim, setRedim] = useState(null);
  const [redimLigne, setRedimLigne] = useState(null);
  /// Vrai tant que le bouton reste enfoncé après un clic sur une cellule :
  /// c'est ce qui permet de balayer une plage à la souris.
  const [glisse, setGlisse] = useState(false);
  const [recopie, setRecopie] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const [ruban, setRuban] = useState("accueil");
  // Le tiroir « Mes classeurs » ne prend aucune largeur tant qu'on travaille.
  const [voletVisible, setVoletVisible] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [objetSelectionne, setObjetSelectionne] = useState(null);
  const [objetInteraction, setObjetInteraction] = useState(null);

  const grilleRef = useRef(null);
  const fichierRef = useRef(null);
  const imageRef = useRef(null);
  const selectionBougeeRef = useRef(false);
  const classeurRef = useRef(classeur);
  const etatEnregistreRef = useRef(null);
  const pressePapierInterneRef = useRef(null);
  const rechercherCelluleRef = useRef(null);
  const recuperationVerifieeRef = useRef(false);
  const erreurBrouillonSignaleeRef = useRef(false);
  classeurRef.current = classeur;

  const cleBrouillon = useMemo(() => {
    const utilisateur = session.user?.id || session.userId || session.id || "local";
    return `classeur:${utilisateur}`;
  }, [session.user?.id, session.userId, session.id]);

  const charger = useCallback(async () => {
    setListe(await api.records.list(manifest.slug, "classeurs"));
  }, []);
  const etat = useChargement(ouvert, charger);

  useEffect(() => {
    if (!modifie) return undefined;
    const proteger = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", proteger);
    return () => window.removeEventListener("beforeunload", proteger);
  }, [modifie]);

  const feuille = classeur?.feuilles[iFeuille] || null;
  const cellules = useMemo(() => feuille?.cellules || [], [feuille?.cellules]);
  const nbL = cellules.length;
  const nbC = feuille ? Math.max(cellules[0]?.length || 0, COLONNES_AFFICHEES) : 0;

  // ---- Modification --------------------------------------------------------

  const appliquer = useCallback(
    (nouvellesCellules, patchFeuille = null) => {
      const precedent = classeurRef.current;
      if (!precedent) return;
      const suivant = {
        ...precedent,
        feuilles: precedent.feuilles.map((f, i) =>
          i !== iFeuille ? f : { ...f, ...(patchFeuille || {}), cellules: nouvellesCellules || f.cellules },
        ),
      };
      classeurRef.current = suivant;
      setHistorique((h) => D.empiler(h, precedent));
      setClasseur(suivant);
      setModifie(suivant !== etatEnregistreRef.current);
    },
    [iFeuille],
  );

  const majClasseur = useCallback(
    (patch) => {
      const precedent = classeurRef.current;
      if (!precedent) return;
      const suivant = { ...precedent, ...patch };
      classeurRef.current = suivant;
      setHistorique((h) => D.empiler(h, precedent));
      setClasseur(suivant);
      setModifie(suivant !== etatEnregistreRef.current);
    },
    [],
  );

  const faireAnnuler = () => {
    const { historique: h, etat: e } = D.annuler(historique, classeur);
    setHistorique(h);
    classeurRef.current = e;
    setClasseur(e);
    setIFeuille((i) => Math.min(i, (e?.feuilles.length || 1) - 1));
    setModifie(e !== etatEnregistreRef.current);
  };
  const faireRetablir = () => {
    const { historique: h, etat: e } = D.retablir(historique, classeur);
    setHistorique(h);
    classeurRef.current = e;
    setClasseur(e);
    setModifie(e !== etatEnregistreRef.current);
  };

  // ---- Ouverture, enregistrement -------------------------------------------

  const confirmerAbandon = useCallback(async () => {
    if (!modifie) return true;
    return modal.confirm({
      title: t("abandonTitre"),
      message: t("abandonMsg", { nom: classeur?.titre || "—" }),
      confirmLabel: t("abandonOui"),
      danger: true,
    });
  }, [modifie, classeur, t]);

  const monter = (donnees, enregistrement) => {
    classeurRef.current = donnees;
    etatEnregistreRef.current = enregistrement ? donnees : null;
    setClasseur(donnees);
    setFiche(enregistrement);
    setIFeuille(0);
    setSel({ l: 0, c: 0, l2: 0, c2: 0 });
    setHistorique({ passe: [], futur: [] });
    setModifie(false);
    setDefilement(0);
    if (grilleRef.current) grilleRef.current.scrollTop = 0;
  };

  useEffect(() => {
    if (!ouvert || recuperationVerifieeRef.current) return;
    recuperationVerifieeRef.current = true;
    let annule = false;
    lireBrouillon(cleBrouillon).then(async (brouillon) => {
      if (annule || !brouillon?.classeur) return;
      const restaurer = await modal.confirm({
        title: langue === "en" ? "Recover unsaved workbook" : "Récupérer le classeur non enregistré",
        message: langue === "en"
          ? `An automatic draft from ${new Date(brouillon.date).toLocaleString()} was found.`
          : `Un brouillon automatique du ${new Date(brouillon.date).toLocaleString("fr-FR")} a été retrouvé.`,
        confirmLabel: langue === "en" ? "Recover" : "Récupérer",
      });
      if (!restaurer || annule) {
        if (!restaurer) await effacerBrouillon(cleBrouillon);
        return;
      }
      monter(brouillon.classeur, brouillon.fiche || null);
      setModifie(true);
      notifier({
        titre: langue === "en" ? "Workbook recovered" : "Classeur récupéré",
        message: brouillon.classeur.titre,
        app: manifest.name,
        ton: "success",
      });
    }).catch(() => {});
    return () => { annule = true; };
  }, [ouvert, cleBrouillon, langue]);

  useEffect(() => {
    if (!ouvert || !classeur || !modifie) return undefined;
    const minuteur = window.setTimeout(() => {
      ecrireBrouillon({
        cle: cleBrouillon,
        date: Date.now(),
        classeur,
        fiche: fiche ? { id: fiche.id, updatedAt: fiche.updatedAt, data: classeur } : null,
      }).catch(() => {
        if (erreurBrouillonSignaleeRef.current) return;
        erreurBrouillonSignaleeRef.current = true;
        notifier({
          titre: langue === "en" ? "Automatic draft unavailable" : "Brouillon automatique indisponible",
          message: langue === "en" ? "Save the workbook manually." : "Enregistrez le classeur manuellement.",
          app: manifest.name,
          ton: "warning",
        });
      });
    }, 900);
    return () => window.clearTimeout(minuteur);
  }, [ouvert, classeur, modifie, fiche, cleBrouillon, langue]);

  const ouvrirFiche = async (rec) => {
    if (!(await confirmerAbandon())) return;
    monter(rec.data, rec);
  };

  const nouveau = async () => {
    if (!(await confirmerAbandon())) return;
    monter(D.classeurVide(t("nouveau")), null);
    setModifie(true);
  };

  const enregistrer = async () => {
    if (!classeur) return;
    setOccupe(true);
    try {
      const rec = fiche
        ? await api.records.update(manifest.slug, "classeurs", fiche.id, classeur, fiche.updatedAt)
        : await api.records.create(manifest.slug, "classeurs", classeur);
      setFiche(rec || { id: fiche?.id, data: classeur });
      etatEnregistreRef.current = classeur;
      setModifie(false);
      await effacerBrouillon(cleBrouillon).catch(() => {});
      await etat.rafraichir();
      notifier({ titre: t("enregistre"), message: classeur.titre, app: manifest.name, ton: "success" });
    } catch (e) {
      modal.alert({ title: t("erreurEnregistrement"), message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const exporter = async () => {
    if (!classeur) return;
    setOccupe(true);
    try {
      const blob = await versXlsx(classeur);
      const nom = `${(classeur.titre || "classeur").replace(/[\\/:*?"<>|]/g, "")}.xlsx`;
      const noeud = await saveAs(blob, nom, { folder: "Classeurs" });
      if (noeud) notifier({ titre: t("exporte"), message: noeud.name, app: manifest.name, ton: "success" });
    } catch (e) {
      modal.alert({ title: t("erreurExport"), message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const importer = async (f) => {
    if (!f) return;
    if (!(await confirmerAbandon())) return;
    setOccupe(true);
    try {
      // On reconnaît le format à ses premiers octets, pas à son
      // extension : un « .xls » est souvent un .xlsx mal nommé, et
      // l'inverse arrive aussi. On en lit plus que la signature — se
      // caler au plus juste avait déjà coûté un bug.
      const debut = new Uint8Array(await f.slice(0, 16).arrayBuffer());
      const titre = f.name.replace(/\.xlsx?$/i, "");
      const donnees = estXls(debut) ? await depuisXls(f, titre) : await depuisXlsx(f, titre);
      monter(donnees, null);
      setModifie(true);
      const rapport = donnees.rapportImport;
      const nonPrisEnCharge = (rapport?.graphiquesIgnores || 0) + (rapport?.imagesIgnorees || 0) + (rapport?.commentairesIgnores || 0);
      if (nonPrisEnCharge) {
        const details = [
          rapport.graphiquesIgnores ? `${rapport.graphiquesIgnores} ${langue === "en" ? "chart(s)" : "graphique(s)"}` : "",
          rapport.imagesIgnorees ? `${rapport.imagesIgnorees} image(s)` : "",
          rapport.commentairesIgnores ? `${rapport.commentairesIgnores} ${langue === "en" ? "comment(s)" : "commentaire(s)"}` : "",
        ].filter(Boolean).join(", ");
        notifier({
          titre: langue === "en" ? "Workbook opened with limitations" : "Classeur ouvert avec limitations",
          message: langue === "en" ? `Not imported yet: ${details}.` : `Pas encore importés : ${details}.`,
          app: manifest.name,
          ton: "warning",
        });
      }
      // Le .xls ne se réécrit pas : enregistrer produira du .xlsx. Le dire
      // tout de suite évite la surprise au moment de l'export.
      if (estXls(debut)) {
        notifier({ titre: t("xlsLu"), message: t("xlsLuAide"), app: manifest.name });
      }
    } catch (e) {
      // JSZip annonce « Can't find end of central directory » avec un lien
      // vers sa documentation : c'est le message d'une bibliothèque à son
      // développeur, pas d'un logiciel à son utilisateur.
      const pasUnZip = /central directory|not a zip/i.test(e.message || "");
      modal.alert({
        title: t("erreurImport"),
        message: pasUnZip ? t("pasUnClasseur") : e.message,
        detail: pasUnZip ? t("pasUnClasseurAide") : undefined,
        tone: "error",
      });
    } finally {
      setOccupe(false);
    }
  };

  /// Un `.xlsx` posé dans le cloud s'ouvre ici d'un clic depuis
  /// l'Explorateur, via l'association de types.
  const importerRef = useRef(importer);
  importerRef.current = importer;
  useEffect(
    () =>
      subscribeVisionneuse(manifest.action, async (charge) => {
        if (!charge?.node) return;
        try {
          const url = await api.streamUrl(charge.node.id);
          const rep = await fetch(url);
          if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
          const blob = await rep.blob();
          blob.name = charge.node.name;
          await importerRef.current(new File([blob], charge.node.name));
        } catch (e) {
          modal.alert({ title: t("erreurImport"), message: e.message, tone: "error" });
        }
      }),
    [],
  );

  const supprimer = async (rec) => {
    const ok = await modal.confirm({
      title: t("supprimerTitre", { nom: rec.data.titre }),
      message: t("supprimerMsg"),
      confirmLabel: t("supprimer"),
      danger: true,
    });
    if (!ok) return;
    await api.records.remove(manifest.slug, "classeurs", rec.id);
    if (fiche?.id === rec.id) { setClasseur(null); setFiche(null); }
    await etat.rafraichir();
  };

  // ---- Mise en forme -------------------------------------------------------

  const styler = (patch, bascule = false) => {
    const colonnesReelles = Math.max(1, cellules[0]?.length || 1);
    const selectionStyle = sel.c === 0 && sel.c2 === nbC - 1
      ? { ...sel, c2: colonnesReelles - 1 }
      : sel;
    const colonnesNecessaires = Math.min(COLONNES_AFFICHEES, Math.max(selectionStyle.c, selectionStyle.c2) + 1);
    let patchFeuille = null;
    if (patch.wrap) {
      const p = D.normaliser(selectionStyle);
      const hauteurs = { ...(feuille.hauteurs || {}) };
      for (let l = p.l1; l <= p.l2; l += 1) hauteurs[l] = Math.max(hauteurs[l] || HAUTEUR_LIGNE, 52);
      patchFeuille = { hauteurs };
    }
    appliquer(D.styler(D.agrandir(cellules, nbL, colonnesNecessaires), selectionStyle, patch, bascule), patchFeuille);
  };

  // ---- Clavier -------------------------------------------------------------

  const ligneEstMasquee = useCallback((l) => {
    if (feuille?.lignesMasquees?.includes(l)) return true;
    return (feuille?.filtres || []).some((filtre) => {
      if (l <= filtre.entete || l > filtre.l2) return false;
      const valeur = String(D.valeurCalculeeClasseur(classeur, iFeuille, l, filtre.c) ?? "").toLocaleLowerCase(langue);
      return !valeur.includes(String(filtre.valeur || "").toLocaleLowerCase(langue));
    });
  }, [feuille?.lignesMasquees, feuille?.filtres, classeur, iFeuille, langue]);

  const positionLigne = useCallback((l) => {
    let y = 0;
    for (let i = 0; i < l; i += 1) y += ligneEstMasquee(i) ? 0 : (feuille?.hauteurs?.[i] || HAUTEUR_LIGNE) * (zoom / 100);
    return y;
  }, [feuille?.hauteurs, ligneEstMasquee, zoom]);

  const suivre = useCallback((l) => {
    const el = grilleRef.current;
    if (!el) return;
    const hauteurLigne = (feuille?.hauteurs?.[l] || HAUTEUR_LIGNE) * (zoom / 100);
    const haut = positionLigne(l);
    if (haut < el.scrollTop) el.scrollTop = haut;
    else if (haut + hauteurLigne > el.scrollTop + el.clientHeight - hauteurLigne * 2) {
      el.scrollTop = haut - el.clientHeight + hauteurLigne * 3;
    }
  }, [zoom, feuille?.hauteurs, positionLigne]);

  const deplacer = useCallback(
    (dl, dc, etendre = false) => {
      setSel((s) => {
        const l = Math.max(0, Math.min(nbL - 1, (etendre ? s.l2 : s.l) + dl));
        const c = Math.max(0, Math.min(nbC - 1, (etendre ? s.c2 : s.c) + dc));
        suivre(l);
        return etendre ? { ...s, l2: l, c2: c } : { l, c, l2: l, c2: c };
      });
    },
    [nbL, nbC, suivre],
  );

  const copier = useCallback(async () => {
    const p = D.normaliser(sel);
    const texte = D.versTSV(cellules, sel, devise);
    pressePapierInterneRef.current = {
      texte,
      cellules: cellules.slice(p.l1, p.l2 + 1).map((ligne) =>
        ligne.slice(p.c1, p.c2 + 1).map((cel) => ({ ...cel, s: cel.s ? { ...cel.s } : undefined }))),
    };
    try {
      if (window.ClipboardItem && navigator.clipboard.write) {
        const echapperHtml = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        const html = `<table>${pressePapierInterneRef.current.cellules.map((ligne) => `<tr>${ligne.map((cel) => {
          const s = cel.s || {};
          const style = [s.gras ? "font-weight:700" : "", s.italique ? "font-style:italic" : "", s.couleurTexte ? `color:#${s.couleurTexte}` : "", s.couleurFond ? `background:#${s.couleurFond}` : ""].filter(Boolean).join(";");
          return `<td style="${style}">${echapperHtml(cel.f || cel.v || "")}</td>`;
        }).join("")}</tr>`).join("")}</table>`;
        await navigator.clipboard.write([new window.ClipboardItem({
          "text/plain": new Blob([texte], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        })]);
      } else await navigator.clipboard.writeText(texte);
    } catch { /* refus du presse-papiers : sans conséquence */ }
  }, [cellules, sel, devise]);

  const coller = useCallback(async () => {
    try {
      const texte = await navigator.clipboard.readText();
      if (!texte) return;
      const interne = pressePapierInterneRef.current;
      if (interne?.texte === texte && interne.cellules?.length) {
        const l0 = Math.min(sel.l, sel.l2);
        const c0 = Math.min(sel.c, sel.c2);
        const lignes = interne.cellules.length;
        const colonnes = Math.max(...interne.cellules.map((ligne) => ligne.length));
        const agrandies = D.agrandir(cellules, l0 + lignes, c0 + colonnes);
        const resultat = agrandies.map((ligne, l) => ligne.map((cel, c) => {
          const source = interne.cellules[l - l0]?.[c - c0];
          return source ? { ...source, s: source.s ? { ...source.s } : undefined } : cel;
        }));
        appliquer(resultat);
      } else appliquer(D.collerTSV(cellules, texte, Math.min(sel.l, sel.l2), Math.min(sel.c, sel.c2)));
    } catch { /* idem */ }
  }, [cellules, sel, appliquer]);

  const couper = useCallback(async () => {
    await copier();
    appliquer(D.vider(cellules, sel));
  }, [copier, appliquer, cellules, sel]);

  const auClavier = useCallback(
    (e) => {
      if (!classeur || edition) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl) {
        const k = e.key.toLowerCase();
        const raccourcis = {
          z: faireAnnuler, y: faireRetablir, c: copier, x: couper, v: coller,
          b: () => styler({ gras: true }, true),
          i: () => styler({ italique: true }, true),
          u: () => styler({ souligne: true }, true),
          d: () => appliquer(D.remplirVersLeBas(cellules, sel)),
          a: () => setSel({ l: 0, c: 0, l2: nbL - 1, c2: nbC - 1 }),
          f: () => rechercherCelluleRef.current?.(),
        };
        if (raccourcis[k]) { e.preventDefault(); raccourcis[k](); }
        return;
      }
      switch (e.key) {
        case "ArrowUp": e.preventDefault(); return deplacer(-1, 0, e.shiftKey);
        case "ArrowDown": e.preventDefault(); return deplacer(1, 0, e.shiftKey);
        case "ArrowLeft": e.preventDefault(); return deplacer(0, -1, e.shiftKey);
        case "ArrowRight": e.preventDefault(); return deplacer(0, 1, e.shiftKey);
        case "PageUp": e.preventDefault(); return deplacer(-15, 0, e.shiftKey);
        case "PageDown": e.preventDefault(); return deplacer(15, 0, e.shiftKey);
        case "Home": e.preventDefault(); return setSel((s) => ({ ...s, c: 0, c2: 0 }));
        case "End": e.preventDefault(); return setSel((s) => ({ ...s, c: nbC - 1, c2: nbC - 1 }));
        case "Tab": e.preventDefault(); return deplacer(0, e.shiftKey ? -1 : 1);
        case "Enter":
        case "F2":
          e.preventDefault();
          return setEdition({ l: sel.l, c: sel.c, valeur: cellules[sel.l]?.[sel.c]?.f || cellules[sel.l]?.[sel.c]?.v || "" });
        case "Delete":
        case "Backspace":
          e.preventDefault();
          return appliquer(D.vider(cellules, sel));
        default:
          break;
      }
      if (e.key.length === 1 && !e.altKey) {
        e.preventDefault();
        setEdition({ l: sel.l, c: sel.c, valeur: e.key });
      }
    },
    [classeur, edition, sel, cellules, nbL, nbC, deplacer, copier, couper, coller, appliquer, styler,
     faireAnnuler, faireRetablir],
  );

  const validerEdition = (valeur, avancer) => {
    const celluleEditee = edition ? cellules[edition.l]?.[edition.c] : null;
    const sourceActuelle = celluleEditee?.f || celluleEditee?.v || "";
    if (edition && valeur !== sourceActuelle) {
      // Saisir sous la dernière ligne agrandit la feuille : on ne bute pas
      // sur une limite arbitraire au milieu d'un travail.
      const agrandie = D.agrandir(cellules, edition.l + 2, edition.c + 1);
      appliquer(D.poser(
        agrandie,
        edition.l,
        edition.c,
        D.estFormule(valeur) ? { v: "", f: valeur } : { v: valeur, f: undefined },
      ));
    }
    setEdition(null);
    if (avancer) deplacer(1, 0);
    grilleRef.current?.focus();
  };

  // ---- Virtualisation et redimensionnement ---------------------------------

  useEffect(() => {
    const el = grilleRef.current;
    if (!el) return undefined;
    const mesurer = () => {
      setHauteurVue(el.clientHeight || 400);
      setLargeurVue(el.clientWidth || 900);
    };
    mesurer();
    const obs = new ResizeObserver(mesurer);
    obs.observe(el);
    return () => obs.disconnect();
  }, [classeur, iFeuille]);

  useEffect(() => {
    if (!redim) return undefined;
    const bouger = (e) => {
      const px = Math.max(60, redim.l0 + (e.clientX - redim.x0) / (zoom / 100));
      setClasseur((c) => ({
        ...c,
        feuilles: c.feuilles.map((f, i) =>
          i !== iFeuille ? f : { ...f, largeurs: { ...f.largeurs, [redim.c]: px } },
        ),
      }));
      setModifie(true);
    };
    const lacher = () => setRedim(null);
    document.addEventListener("mousemove", bouger);
    document.addEventListener("mouseup", lacher);
    return () => {
      document.removeEventListener("mousemove", bouger);
      document.removeEventListener("mouseup", lacher);
    };
  }, [redim, iFeuille, zoom]);

  useEffect(() => {
    if (!redimLigne) return undefined;
    const bouger = (e) => {
      const px = Math.max(18, redimLigne.h0 + (e.clientY - redimLigne.y0) / (zoom / 100));
      setClasseur((c) => {
        const suivant = {
          ...c,
          feuilles: c.feuilles.map((f, i) =>
          i !== iFeuille ? f : { ...f, hauteurs: { ...(f.hauteurs || {}), [redimLigne.l]: px } },
          ),
        };
        classeurRef.current = suivant;
        return suivant;
      });
      setModifie(true);
    };
    const lacher = () => setRedimLigne(null);
    document.addEventListener("mousemove", bouger);
    document.addEventListener("mouseup", lacher);
    return () => {
      document.removeEventListener("mousemove", bouger);
      document.removeEventListener("mouseup", lacher);
    };
  }, [redimLigne, iFeuille, zoom]);

  useEffect(() => {
    if (!objetInteraction) return undefined;
    const bouger = (e) => {
      const dx = (e.clientX - objetInteraction.x0) / (zoom / 100);
      const dy = (e.clientY - objetInteraction.y0) / (zoom / 100);
      setClasseur((courant) => ({
        ...courant,
        feuilles: courant.feuilles.map((f, i) => i !== iFeuille ? f : {
          ...f,
          objets: (f.objets || []).map((objet) => {
            if (objet.id !== objetInteraction.id) return objet;
            if (objetInteraction.mode === "rotation") {
              const angle = Math.atan2(e.clientY - objetInteraction.centreY, e.clientX - objetInteraction.centreX) * 180 / Math.PI;
              return { ...objet, rotation: Math.round(objetInteraction.rotation + angle - objetInteraction.angle0) };
            }
            if (objetInteraction.mode === "taille") return {
              ...objet,
              largeur: Math.max(48, objetInteraction.largeur + dx),
              hauteur: Math.max(32, objetInteraction.hauteur + dy),
            };
            return {
              ...objet,
              ...(objetInteraction.ancre
                ? { ancre: { ...objetInteraction.ancre, dx: objetInteraction.ancre.dx + dx, dy: objetInteraction.ancre.dy + dy } }
                : { x: Math.max(LARGEUR_NUMEROTATION, objetInteraction.x + dx), y: Math.max(24, objetInteraction.y + dy) }),
            };
          }),
        }),
      }));
      setModifie(true);
    };
    const terminer = () => setObjetInteraction(null);
    document.addEventListener("mousemove", bouger);
    document.addEventListener("mouseup", terminer);
    return () => {
      document.removeEventListener("mousemove", bouger);
      document.removeEventListener("mouseup", terminer);
    };
  }, [objetInteraction, iFeuille, zoom]);

  // Le balayage s'arrête où que le bouton soit relâché, même hors grille.
  useEffect(() => {
    if (!glisse) return undefined;
    const lacher = () => setGlisse(false);
    document.addEventListener("mouseup", lacher);
    return () => document.removeEventListener("mouseup", lacher);
  }, [glisse]);

  useEffect(() => {
    if (!recopie) return undefined;
    const terminer = () => {
      const source = recopie.source;
      const cible = recopie.cible;
      appliquer(D.recopierAvecPoignee(cellules, source, cible));
      const p = D.normaliser(source);
      setSel({
        l: Math.min(p.l1, cible.l), c: Math.min(p.c1, cible.c),
        l2: Math.max(p.l2, cible.l), c2: Math.max(p.c2, cible.c),
      });
      setRecopie(null);
      grilleRef.current?.focus();
    };
    document.addEventListener("mouseup", terminer, { once: true });
    return () => document.removeEventListener("mouseup", terminer);
  }, [recopie, cellules, appliquer]);

  const facteurZoom = zoom / 100;
  const hauteurEnteteAffichee = 24 * facteurZoom;
  const geometrieLignes = useMemo(() => {
    const positions = [0];
    for (let l = 0; l < nbL; l += 1) {
      const hauteur = ligneEstMasquee(l) ? 0 : (feuille?.hauteurs?.[l] || HAUTEUR_LIGNE) * facteurZoom;
      positions.push(positions[l] + hauteur);
    }
    const chercher = (y) => {
      let bas = 0;
      let haut = nbL;
      while (bas < haut) {
        const milieu = Math.floor((bas + haut) / 2);
        if (positions[milieu + 1] < y) bas = milieu + 1;
        else haut = milieu;
      }
      return Math.min(nbL, bas);
    };
    return { positions, debut: Math.max(0, chercher(defilement) - MARGE), fin: Math.min(nbL, chercher(defilement + hauteurVue) + MARGE + 1) };
  }, [nbL, feuille?.hauteurs, facteurZoom, defilement, hauteurVue, ligneEstMasquee]);
  const debut = geometrieLignes.debut;
  const fin = geometrieLignes.fin;
  const largeurColonneAffichee = Math.min(
    D.LARGEUR_DEFAUT,
    Math.max(22, Math.floor((largeurVue - LARGEUR_NUMEROTATION - 6) / 26 / (zoom / 100))),
  );

  // Virtualisation horizontale : la feuille va jusqu'à ZZ, mais seules les
  // colonnes dans le viewport (plus une marge) existent dans le DOM.
  const geometrieColonnes = useMemo(() => {
    const facteur = facteurZoom;
    const masquees = new Set(feuille?.colonnesMasquees || []);
    const positions = [0];
    for (let c = 0; c < nbC; c += 1) {
      positions.push(positions[c] + (masquees.has(c) ? 0 : (feuille?.largeurs?.[c] || largeurColonneAffichee) * facteur));
    }
    const margePx = largeurColonneAffichee * facteur * 3;
    const gauche = Math.max(0, defilementX - margePx);
    const droite = defilementX + largeurVue + margePx;
    let premier = 0;
    while (premier < nbC - 1 && positions[premier + 1] < gauche) premier += 1;
    let dernier = premier;
    while (dernier < nbC - 1 && positions[dernier] < droite) dernier += 1;
    const figees = Math.min(feuille?.figees?.colonnes || 0, premier);
    const fixes = Array.from({ length: figees }, (_, c) => c).filter((c) => !masquees.has(c));
    const visibles = Array.from({ length: dernier - premier + 1 }, (_, i) => premier + i)
      .filter((c) => c >= figees && !masquees.has(c));
    return {
      positions,
      fixes,
      visibles,
      espaceGauche: Math.max(0, positions[premier] - positions[figees]),
      espaceDroite: Math.max(0, positions[nbC] - positions[dernier + 1]),
    };
  }, [nbC, feuille?.largeurs, feuille?.colonnesMasquees, feuille?.figees?.colonnes, facteurZoom, defilementX, largeurVue, largeurColonneAffichee]);

  const colonnesRendues = [
    ...geometrieColonnes.fixes,
    ...(geometrieColonnes.espaceGauche > 0 ? [null] : []),
    ...geometrieColonnes.visibles,
  ];

  const resume = useMemo(
    () => (cellules.length
      ? D.resume(cellules, sel, (l, c) => D.valeurCalculeeClasseur(classeur, iFeuille, l, c))
      : null),
    [cellules, sel, classeur, iFeuille],
  );
  const celluleActive = cellules[sel.l]?.[sel.c];
  const sourceCelluleActive = celluleActive?.f || celluleActive?.v || "";

  const selectionVisuelle = recopie
    ? {
        l: Math.min(sel.l, sel.l2, recopie.cible.l),
        c: Math.min(sel.c, sel.c2, recopie.cible.c),
        l2: Math.max(sel.l, sel.l2, recopie.cible.l),
        c2: Math.max(sel.c, sel.c2, recopie.cible.c),
      }
    : sel;

  const dansSel = (l, c) => {
    const p = D.normaliser(selectionVisuelle);
    return l >= p.l1 && l <= p.l2 && c >= p.c1 && c <= p.c2;
  };

  const decalerAncres = (axe, index, delta) => (feuille.objets || []).map((objet) => {
    if (!objet.ancre || objet.ancre[axe] < index) return objet;
    return { ...objet, ancre: { ...objet.ancre, [axe]: Math.max(0, objet.ancre[axe] + delta) } };
  });
  const insererLigneStructure = (index) => appliquer(D.insererLigne(cellules, index), { objets: decalerAncres("l", index, 1) });
  const supprimerLigneStructure = (index) => appliquer(D.supprimerLigne(cellules, index), { objets: decalerAncres("l", index + 1, -1) });
  const insererColonneStructure = (index) => appliquer(D.insererColonne(cellules, index), { objets: decalerAncres("c", index, 1) });
  const supprimerColonneStructure = (index) => appliquer(D.supprimerColonne(cellules, index), { objets: decalerAncres("c", index + 1, -1) });

  /// La sélection lisible depuis un gestionnaire d'événement : un menu
  /// contextuel bâti sur une closure de rendu annoncerait la sélection
  /// d'avant. Voir la même précaution dans le Tableur CSV.
  const selRef = useRef(sel);
  selRef.current = sel;

  // ---- Menus ---------------------------------------------------------------

  const menuColonne = (c) => (e) =>
    menuContextuel(e, [
      { nom: t("insererColAvant"), icone: "faTableColumns", action: () => insererColonneStructure(c) },
      { nom: t("insererColApres"), icone: "faTableColumns", action: () => insererColonneStructure(c + 1) },
      {
        nom: t("ajusterCol"),
        icone: "faLeftRight",
        action: () => {
          const max = Math.max(
            ...cellules.slice(0, 200).map((l) => String(D.valeurCalculeeClasseur(classeur, iFeuille, cellules.indexOf(l), c) ?? "").length),
            4,
          );
          appliquer(null, { largeurs: { ...feuille.largeurs, [c]: Math.min(400, 24 + max * 7.5) } });
        },
      },
      { separateur: true },
      { nom: t("supprimerCol"), icone: "faTrashCan", danger: true, desactive: nbC <= 1, action: () => supprimerColonneStructure(c) },
    ]);

  const menuLigne = (l) => (e) =>
    menuContextuel(e, [
      { nom: t("insererLigneAvant"), icone: "faPlus", action: () => insererLigneStructure(l) },
      { nom: t("insererLigneApres"), icone: "faPlus", action: () => insererLigneStructure(l + 1) },
      { separateur: true },
      { nom: t("supprimerLigne"), icone: "faTrashCan", danger: true, desactive: nbL <= 1, action: () => supprimerLigneStructure(l) },
    ]);

  const menuFeuille = (i) => (e) =>
    menuContextuel(e, [
      {
        nom: t("renommerFeuille"),
        icone: "faPen",
        action: async () => {
          const v = await modal.prompt({
            title: t("renommerFeuille"), label: t("nomFeuille"),
            value: classeur.feuilles[i].nom, confirmLabel: t("renommer"),
          });
          if (v) majClasseur({ feuilles: classeur.feuilles.map((f, j) => (j === i ? { ...f, nom: v } : f)) });
        },
      },
      {
        nom: t("dupliquerFeuille"),
        icone: "faClone",
        action: () => {
          const copie = JSON.parse(JSON.stringify(classeur.feuilles[i]));
          copie.nom = D.nomLibre(classeur.feuilles, copie.nom);
          const feuilles = [...classeur.feuilles];
          feuilles.splice(i + 1, 0, copie);
          majClasseur({ feuilles });
          setIFeuille(i + 1);
        },
      },
      { separateur: true },
      {
        nom: t("supprimerFeuille"),
        icone: "faTrashCan",
        danger: true,
        desactive: classeur.feuilles.length <= 1,
        action: () => {
          if (classeur.feuilles.length <= 1) {
            return modal.alert({ title: t("supprimerFeuille"), message: t("derniereFeuille") });
          }
          majClasseur({ feuilles: classeur.feuilles.filter((_, j) => j !== i) });
          setIFeuille((x) => Math.max(0, Math.min(x, classeur.feuilles.length - 2)));
        },
      },
    ]);

  /// Menu d'une cellule. Le clic droit conserve la sélection en cours si on
  /// vise dedans : on prépare une plage, on la met en forme ou on la copie,
  /// et la perdre au dernier geste serait exaspérant.
  const menuCellule = (l, c) => (e) => {
    const courante = selRef.current;
    const p0 = D.normaliser(courante);
    const dedans = l >= p0.l1 && l <= p0.l2 && c >= p0.c1 && c <= p0.c2;
    const cible = dedans ? courante : { l, c, l2: l, c2: c };
    if (!dedans) setSel(cible);
    const p = D.normaliser(cible);
    const combien = (p.l2 - p.l1 + 1) * (p.c2 - p.c1 + 1);

    menuContextuel(e, [
      { nom: t("copierN", { n: combien }), icone: "faCopy", action: copier },
      { nom: t("collerIci"), icone: "faPaste", action: coller },
      { nom: t("viderCellules"), icone: "faEraser", action: () => appliquer(D.vider(cellules, cible)) },
      { separateur: true },
      { nom: t("gras"), icone: "faBold", coche: !!celluleActive?.s?.gras,
        action: () => appliquer(D.styler(cellules, cible, { gras: true }, true)) },
      { nom: t("italique"), icone: "faItalic", coche: !!celluleActive?.s?.italique,
        action: () => appliquer(D.styler(cellules, cible, { italique: true }, true)) },
      {
        nom: t("format"),
        icone: "faHashtag",
        sousMenu: D.FORMATS.map((f) => ({
          nom: f.nom[langue] || f.nom.fr,
          coche: (celluleActive?.s?.format || "auto") === f.id,
          action: () => appliquer(D.styler(cellules, cible, { format: f.id })),
        })),
      },
      { nom: t("effacerStyle"), icone: "faBan",
        action: () => appliquer(D.styler(cellules, cible, {
          gras: false, italique: false, souligne: false,
          align: "", format: "auto", couleurTexte: "", couleurFond: "",
          police: "", taille: 0, wrap: false,
        })) },
      { separateur: true },
      { nom: t("remplirBas"), icone: "faArrowDown", desactive: p.l1 === p.l2,
        action: () => appliquer(D.remplirVersLeBas(cellules, cible)) },
      { separateur: true },
      { nom: t("insererLigneAvant"), icone: "faPlus", action: () => insererLigneStructure(p.l1) },
      { nom: t("supprimerLignesN", { n: p.l2 - p.l1 + 1 }), icone: "faTrashCan", danger: true,
        desactive: nbL <= 1,
        action: () => {
          let g = cellules;
          for (let i = p.l2; i >= p.l1; i -= 1) g = D.supprimerLigne(g, i);
          const compte = p.l2 - p.l1 + 1;
          appliquer(g, { objets: (feuille.objets || []).map((objet) => {
            if (!objet.ancre || objet.ancre.l < p.l1) return objet;
            const l = objet.ancre.l <= p.l2 ? p.l1 : objet.ancre.l - compte;
            return { ...objet, ancre: { ...objet.ancre, l: Math.max(0, l) } };
          }) });
        } },
    ]);
  };

  const menuFormat = (e) =>
    menuContextuel(
      e,
      D.FORMATS.map((f) => ({
        nom: f.nom[langue] || f.nom.fr,
        coche: (celluleActive?.s?.format || "auto") === f.id,
        action: () => styler({ format: f.id }),
      })),
    );

  const menuCouleur = (cle) => (e) =>
    menuContextuel(
      e,
      (cle === "couleurTexte" ? COULEURS : FONDS).map((c) => ({
        nom: c ? `#${c}` : t("effacerStyle"),
        icone: c ? "faSquare" : "faBan",
        action: () => styler({ [cle]: c }),
      })),
    );

  const rechercherCellule = async () => {
    const terme = await modal.prompt({
      title: t("rechercher"),
      label: t("rechercheValeur"),
      confirmLabel: t("rechercher"),
    });
    if (!terme) return;
    const position = D.trouver(cellules, terme, { l: sel.l, c: sel.c });
    if (!position) {
      modal.alert({ title: t("rechercher"), message: t("introuvable") });
      return;
    }
    setSel({ ...position, l2: position.l, c2: position.c });
    suivre(position.l);
    grilleRef.current?.focus();
  };
  rechercherCelluleRef.current = rechercherCellule;

  const remplacerCellules = async () => {
    const terme = await modal.prompt({
      title: t("remplacer"),
      label: t("rechercheValeur"),
      confirmLabel: langue === "en" ? "Continue" : "Continuer",
    });
    if (!terme) return;
    const remplacement = await modal.prompt({
      title: t("remplacer"),
      label: t("remplacementValeur"),
      confirmLabel: t("remplacer"),
    });
    if (remplacement === null || remplacement === undefined) return;
    appliquer(D.remplacerTout(cellules, terme, remplacement));
  };

  // ---- Insertion ---------------------------------------------------------

  const ajouterObjet = (objet) => {
    const id = `objet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    appliquer(null, {
      objets: [...(feuille.objets || []), {
        id, ancre: { l: sel.l, c: sel.c, dx: 8, dy: 4 },
        largeur: 180, hauteur: 110, z: (feuille.objets || []).length + 1, ...objet,
      }],
    });
    setObjetSelectionne(id);
  };

  const modifierObjet = (id, patch) => appliquer(null, {
    objets: (feuille.objets || []).map((objet) => objet.id === id ? { ...objet, ...patch } : objet),
  });

  const editerTitreGraphique = async (objet) => {
    const titre = await modal.prompt({
      title: "Modifier le graphique",
      label: "Titre du graphique",
      value: objet.titre || "",
      confirmLabel: "Appliquer",
    });
    if (titre === null || titre === undefined) return;
    modifierObjet(objet.id, { titre });
  };

  const insererTableau = () => {
    const p = D.normaliser(sel);
    let resultat = D.styler(cellules, sel, { couleurFond: "F3F6FA" });
    resultat = D.styler(resultat, { l: p.l1, c: p.c1, l2: p.l1, c2: p.c2 }, {
      gras: true, couleurFond: "E8F0FE", couleurTexte: "174EA6",
    });
    appliquer(resultat);
  };

  const insererCase = () => {
    const p = D.normaliser(sel);
    const agrandies = D.agrandir(cellules, p.l2 + 1, p.c2 + 1);
    appliquer(agrandies.map((ligne, l) => ligne.map((cel, c) =>
      l >= p.l1 && l <= p.l2 && c >= p.c1 && c <= p.c2
        ? { ...cel, v: cel.v === "TRUE" ? "TRUE" : "FALSE", type: "checkbox", f: undefined }
        : cel)));
  };

  const insererTexte = async (type = "texte") => {
    const valeur = await modal.prompt({
      title: type === "forme" ? "Insérer une forme" : "Insérer une zone de texte",
      label: type === "forme" ? "Texte de la forme" : "Texte",
      confirmLabel: "Insérer",
    });
    if (valeur === null || valeur === undefined) return;
    ajouterObjet({
      type, texte: valeur, largeur: type === "forme" ? 140 : 220, hauteur: type === "forme" ? 90 : 100,
      ...(type === "forme" ? {
        forme: "arrondi", remplissage: "#DBE8FF", contour: "#174EA6",
        couleurTexte: "#174EA6", epaisseur: 2, tailleTexte: 14, rotation: 0,
      } : {}),
    });
  };

  const insererLien = async () => {
    const href = await modal.prompt({ title: "Insérer un lien", label: "Adresse URL", confirmLabel: "Insérer" });
    if (!href) return;
    const libelle = await modal.prompt({ title: "Texte du lien", label: "Texte affiché", confirmLabel: "Insérer" });
    appliquer(D.poser(cellules, sel.l, sel.c, {
      v: libelle || href, f: undefined, href,
      s: { ...(celluleActive?.s || {}), couleurTexte: "1155CC", souligne: true },
    }));
  };

  const insererCommentaire = async () => {
    const commentaire = await modal.prompt({ title: "Nouveau commentaire", label: "Commentaire", confirmLabel: "Ajouter" });
    if (!commentaire) return;
    appliquer(D.poser(cellules, sel.l, sel.c, { commentaire }));
  };

  const insererImage = (fichier) => {
    if (!fichier || !fichier.type.startsWith("image/")) return;
    const lecteur = new FileReader();
    lecteur.onload = () => ajouterObjet({ type: "image", image: String(lecteur.result), alt: fichier.name, largeur: 220, hauteur: 160 });
    lecteur.readAsDataURL(fichier);
  };

  const insererGraphique = (type) => {
    const p = D.normaliser(sel);
    ajouterObjet({ type: "graphique", graphique: type, plage: p, largeur: 280, hauteur: 170 });
  };

  const insererFormulaire = () => {
    const p = D.normaliser(sel);
    const entetes = cellules[p.l1]?.slice(p.c1, p.c2 + 1).map((c, i) => c.v || `Champ ${i + 1}`) || [];
    const nom = D.nomLibre(classeur.feuilles, langue === "en" ? "Form" : "Formulaire");
    const nouvelle = D.feuilleVide(nom);
    entetes.forEach((entete, i) => {
      nouvelle.cellules[i][0] = { v: entete, s: { gras: true, couleurFond: "E8F0FE" } };
      nouvelle.cellules[i][1] = { v: "" };
    });
    majClasseur({ feuilles: [...classeur.feuilles, nouvelle] });
    setIFeuille(classeur.feuilles.length);
  };

  const insererTableauCroise = () => {
    const p = D.normaliser(sel);
    const nom = D.nomLibre(classeur.feuilles, langue === "en" ? "Pivot" : "Tableau croisé");
    const nouvelle = D.feuilleVide(nom);
    const titreCategorie = String(cellules[p.l1]?.[p.c1]?.v || (langue === "en" ? "Category" : "Catégorie"));
    const titreValeur = String(cellules[p.l1]?.[Math.min(p.c1 + 1, p.c2)]?.v || (langue === "en" ? "Value" : "Valeur"));
    const groupes = new Map();
    for (let l = p.l1 + 1; l <= p.l2; l += 1) {
      const categorie = String(D.valeurCalculeeClasseur(classeur, iFeuille, l, p.c1) || (langue === "en" ? "Empty" : "Vide"));
      const brut = D.valeurCalculeeClasseur(classeur, iFeuille, l, Math.min(p.c1 + 1, p.c2));
      const nombre = Number(String(brut).replace(/\s/g, "").replace(",", "."));
      const courant = groupes.get(categorie) || { somme: 0, compte: 0 };
      courant.somme += Number.isFinite(nombre) ? nombre : 0;
      courant.compte += 1;
      groupes.set(categorie, courant);
    }
    [titreCategorie, `${langue === "en" ? "Sum" : "Somme"} — ${titreValeur}`, langue === "en" ? "Count" : "Nombre"].forEach((v, c) => {
      nouvelle.cellules[0][c] = { v, s: { gras: true, couleurFond: "E8F0FE", couleurTexte: "174EA6" } };
    });
    [...groupes.entries()].forEach(([categorie, valeurs], i) => {
      nouvelle.cellules[i + 1][0] = { v: categorie };
      nouvelle.cellules[i + 1][1] = { v: String(valeurs.somme), s: { format: "nombre" } };
      nouvelle.cellules[i + 1][2] = { v: String(valeurs.compte), s: { format: "nombre" } };
    });
    majClasseur({ feuilles: [...classeur.feuilles, nouvelle] });
    setIFeuille(classeur.feuilles.length);
  };

  const supprimerInsertion = () => {
    if (objetSelectionne) {
      appliquer(null, { objets: (feuille.objets || []).filter((objet) => objet.id !== objetSelectionne) });
      setObjetSelectionne(null);
      return;
    }
    const cel = cellules[sel.l]?.[sel.c];
    if (!cel) return;
    const nettoyee = {
      ...cel,
      type: undefined,
      image: undefined,
      alt: undefined,
      href: undefined,
      commentaire: undefined,
      objet: undefined,
    };
    // Une case à cocher porte une valeur technique ; elle redevient vide.
    if (cel.type === "checkbox") nettoyee.v = "";
    appliquer(D.poser(cellules, sel.l, sel.c, nettoyee));
  };

  const fusionnerSelection = () => {
    const p = D.normaliser(sel);
    if (p.l1 === p.l2 && p.c1 === p.c2) return;
    const fusions = (feuille.fusions || []).filter((f) =>
      f.l2 < p.l1 || f.l1 > p.l2 || f.c2 < p.c1 || f.c1 > p.c2);
    const valeur = cellules[p.l1]?.[p.c1] || { v: "" };
    let resultat = cellules;
    for (let l = p.l1; l <= p.l2; l += 1) {
      for (let c = p.c1; c <= p.c2; c += 1) {
        if (l !== p.l1 || c !== p.c1) resultat = D.poser(resultat, l, c, { v: "", f: undefined });
      }
    }
    resultat = D.poser(resultat, p.l1, p.c1, valeur);
    appliquer(resultat, { fusions: [...fusions, p] });
  };

  const defusionnerSelection = () => {
    const p = D.normaliser(sel);
    appliquer(null, { fusions: (feuille.fusions || []).filter((f) =>
      f.l2 < p.l1 || f.l1 > p.l2 || f.c2 < p.c1 || f.c1 > p.c2) });
  };

  const appliquerValidationListe = async () => {
    const saisie = await modal.prompt({
      title: langue === "en" ? "Data validation" : "Validation des données",
      label: langue === "en" ? "Allowed values, separated by commas" : "Valeurs autorisées, séparées par des virgules",
      confirmLabel: langue === "en" ? "Apply" : "Appliquer",
    });
    if (!saisie) return;
    const options = saisie.split(",").map((v) => v.trim()).filter(Boolean).slice(0, 100);
    if (!options.length) return;
    const p = D.normaliser(sel);
    const resultat = cellules.map((ligne, l) => ligne.map((cel, c) =>
      l >= p.l1 && l <= p.l2 && c >= p.c1 && c <= p.c2
        ? { ...cel, validation: { type: "liste", options } }
        : cel));
    appliquer(resultat);
  };

  const ajouterRegleConditionnelle = async () => {
    const seuil = await modal.prompt({
      title: langue === "en" ? "Conditional formatting" : "Mise en forme conditionnelle",
      label: langue === "en" ? "Highlight values greater than" : "Mettre en évidence les valeurs supérieures à",
      confirmLabel: langue === "en" ? "Apply" : "Appliquer",
    });
    if (seuil === null || seuil === undefined || !Number.isFinite(Number(String(seuil).replace(",", ".")))) return;
    appliquer(null, {
      reglesConditionnelles: [...(feuille.reglesConditionnelles || []), {
        id: `regle-${Date.now()}`,
        plage: D.normaliser(sel),
        operateur: "superieur",
        valeur: Number(String(seuil).replace(",", ".")),
        style: { couleurFond: "FCE8E6", couleurTexte: "C5221F", gras: true },
      }],
    });
  };

  const filtrerSelection = async () => {
    const p = D.normaliser(sel);
    const valeur = await modal.prompt({
      title: langue === "en" ? "Filter" : "Filtrer",
      label: langue === "en" ? "Text to keep in this column" : "Texte à conserver dans cette colonne",
      confirmLabel: langue === "en" ? "Filter" : "Filtrer",
    });
    if (valeur === null || valeur === undefined) return;
    const filtre = { c: p.c1, entete: p.l1, l2: Math.max(p.l2, nbL - 1), valeur };
    appliquer(null, { filtres: [...(feuille.filtres || []).filter((f) => f.c !== filtre.c), filtre] });
  };

  const retirerFiltres = () => appliquer(null, { filtres: [] });

  const masquerLignesSelectionnees = () => {
    const p = D.normaliser(sel);
    const ensemble = new Set(feuille.lignesMasquees || []);
    for (let l = p.l1; l <= p.l2; l += 1) ensemble.add(l);
    appliquer(null, { lignesMasquees: [...ensemble].sort((a, b) => a - b) });
  };

  const afficherToutesLesLignes = () => appliquer(null, { lignesMasquees: [] });

  const figer = (type) => {
    const actuelles = feuille.figees || { lignes: 0, colonnes: 0 };
    appliquer(null, {
      figees:
        type === "aucun"
          ? { lignes: 0, colonnes: 0 }
          : {
              ...actuelles,
              [type === "ligne" ? "lignes" : "colonnes"]:
                actuelles[type === "ligne" ? "lignes" : "colonnes"] ? 0 : 1,
            },
    });
  };

  const gaucheColonne = (c) => {
    let gauche = LARGEUR_NUMEROTATION;
    for (let i = 0; i < c; i += 1) gauche += feuille.largeurs?.[i] || largeurColonneAffichee;
    return gauche * (zoom / 100);
  };

  // ---- Impression -----------------------------------------------------------

  /// Imprime la feuille active, et elle seule : la grille à l'écran est
  /// virtualisée (seules les lignes visibles existent), on reconstruit donc
  /// un tableau propre à partir des données, sur la plage réellement remplie.
  const imprimer = () => {
    const actuel = classeurRef.current;
    const f = actuel?.feuilles[iFeuille];
    if (!f) return;
    const lignes = f.cellules || [];
    let derL = -1;
    let derC = -1;
    lignes.forEach((ligne, l) => (ligne || []).forEach((cel, c) => {
      if (cel && ((cel.v !== "" && cel.v != null) || cel.f || cel.s?.couleurFond)) {
        derL = Math.max(derL, l);
        derC = Math.max(derC, c);
      }
    }));
    if (derL < 0) {
      modal.alert({ title: t("imprimer").replace("…", ""), message: t("rienAImprimer") });
      return;
    }
    const echapper = (x) => String(x ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[ch]);
    const fusions = f.fusions || [];
    const masquees = new Set(f.lignesMasquees || []);
    let corps = "";
    for (let l = 0; l <= derL; l += 1) {
      if (masquees.has(l)) continue;
      let ligneHtml = "";
      for (let c = 0; c <= derC; c += 1) {
        const fusion = fusions.find((x) => l >= x.l1 && l <= x.l2 && c >= x.c1 && c <= x.c2);
        if (fusion && (l !== fusion.l1 || c !== fusion.c1)) continue;
        const st = lignes[l]?.[c]?.s || {};
        const brute = D.valeurCalculeeClasseur(actuel, iFeuille, l, c);
        const nombre = brute !== "" && brute != null && Number.isFinite(Number(brute));
        const decor = [st.souligne && "underline", st.barre && "line-through"].filter(Boolean).join(" ");
        const style = [
          st.gras && "font-weight:700",
          st.italique && "font-style:italic",
          decor && `text-decoration:${decor}`,
          (st.align || (nombre ? "right" : "")) && `text-align:${st.align || "right"}`,
          st.couleurTexte && `color:#${st.couleurTexte}`,
          st.couleurFond && `background:#${st.couleurFond}`,
          st.taille && `font-size:${Number(st.taille)}pt`,
          st.police && `font-family:${String(st.police).replace(/[^\w -]/g, "")},Arial,sans-serif`,
          st.wrap && "white-space:normal",
          f.largeurs?.[c] && `min-width:${Number(f.largeurs[c])}px`,
        ].filter(Boolean).join(";");
        const etendue = fusion ? ` colspan="${fusion.c2 - fusion.c1 + 1}" rowspan="${fusion.l2 - fusion.l1 + 1}"` : "";
        ligneHtml += `<td${etendue}${style ? ` style="${style}"` : ""}>${echapper(D.valeurAfficheeClasseur(actuel, iFeuille, l, c, devise))}</td>`;
      }
      corps += `<tr>${ligneHtml}</tr>`;
    }
    const titre = `${echapper(actuel.titre)} — ${echapper(f.nom)}`;
    const cadre = document.createElement("iframe");
    cadre.setAttribute("aria-hidden", "true");
    Object.assign(cadre.style, { position: "fixed", width: "0", height: "0", border: "0" });
    document.body.appendChild(cadre);
    const doc = cadre.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${titre}</title><style>
      @page { margin: 12mm; }
      body { margin: 0; color: #000; font: 10pt Calibri, Carlito, Arial, sans-serif; }
      h1 { margin: 0 0 8pt; font-size: 11pt; font-weight: 600; }
      table { border-collapse: collapse; }
      td { padding: 2pt 5pt; border: 0.5pt solid #bfbfbf; white-space: nowrap; vertical-align: bottom; }
      tr { break-inside: avoid; }
    </style></head><body><h1>${titre}</h1><table>${corps}</table></body></html>`);
    doc.close();
    setTimeout(() => {
      cadre.contentWindow.focus();
      cadre.contentWindow.print();
      setTimeout(() => cadre.remove(), 1000);
    }, 250);
  };

  /// Ctrl+S et Ctrl+P, d'où que vienne la frappe dans la fenêtre — grille,
  /// barre de formule ou titre. Écouté sur la fenêtre du classeur et non sur
  /// tout le document : un Ctrl+S tapé dans une autre application ne doit
  /// pas enregistrer ce classeur-ci.
  const raccourcisFenetre = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !classeurRef.current) return;
    const k = e.key.toLowerCase();
    if (k === "s") {
      e.preventDefault();
      enregistrer();
    } else if (k === "p") {
      e.preventDefault();
      imprimer();
    }
  };

  // ---- Rendu ---------------------------------------------------------------

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="clsApp">
        <div className="clsVerrou">{t("verrou")}</div>
      </ModuleWindow>
    );
  }

  /// L'état d'enregistrement, en un mot, collé au titre — comme dans Excel.
  const etatDoc = occupe
    ? { texte: t("etatEnregistrement"), ton: "neutre" }
    : modifie
      ? { texte: fiche ? t("etatModifie") : t("etatNonEnregistre"), ton: "modifie" }
      : { texte: t("etatEnregistre"), ton: "ok", detail: t("etatEnregistreDetail") };

  const actionsFichier = {
    nouveau,
    ouvrir: () => fichierRef.current?.click(),
    classeurs: () => setVoletVisible(true),
    enregistrer: classeur ? enregistrer : null,
    exporter: classeur ? exporter : null,
    imprimer: classeur ? imprimer : null,
  };

  /// Les classeurs du plus récent au plus ancien : les « Récents » d'Excel.
  const recents = [...liste].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  const quandModifie = (iso) =>
    iso
      ? new Date(iso).toLocaleDateString(langue === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "short", year: "numeric" })
      : "";
  const prenom = (session.user?.name || "").split(" ")[0];
  const reglerZoom = (valeur) => setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(valeur / 10) * 10)));

  return (
    <ModuleWindow manifest={manifest} className="clsApp">
      <div className="clsShell" onKeyDown={raccourcisFenetre}>
        <input
          ref={fichierRef}
          type="file"
          accept=".xlsx,.xls"
          hidden
          onChange={(e) => { importer(e.target.files?.[0]); e.target.value = ""; }}
        />
        <input
          ref={imageRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => { insererImage(e.target.files?.[0]); e.target.value = ""; }}
        />

        {/* Le tiroir des classeurs, ouvert depuis Fichier → Mes classeurs :
            il glisse au-dessus de la feuille au lieu de lui voler sa largeur. */}
        <aside className="clsLateral cosScroll" data-ouvert={voletVisible} aria-hidden={!voletVisible}>
          <div className="clsLateralTete">
            <b>{t("mesClasseurs")}</b>
            <button type="button" className="clsIcone" title={t("fermer")} onClick={() => setVoletVisible(false)}>
              <Icon fafa="faAnglesLeft" width={12} />
            </button>
          </div>
          <Contenu
            etat={etat}
            vide={!liste.length}
            lignes={3}
            rendreVide={() => <p className="clsLateralVide">{t("aucunAide")}</p>}
          >
            <ul className="clsListe">
              {recents.map((rec) => (
                <li
                  key={rec.id}
                  data-actif={fiche?.id === rec.id}
                  onClick={() => { setVoletVisible(false); ouvrirFiche(rec); }}
                >
                  <Icon fafa="faTableCells" width={12} />
                  <span>{rec.data.titre}</span>
                  <span
                    className="clsSuppr handcr"
                    title={t("supprimer")}
                    onClick={(e) => { e.stopPropagation(); supprimer(rec); }}
                  >
                    <Icon fafa="faXmark" width={10} />
                  </span>
                </li>
              ))}
            </ul>
          </Contenu>
        </aside>

        <div className="clsCentre" onMouseDown={() => { if (voletVisible) setVoletVisible(false); }}>
          {!classeur ? (
            // L'accueil d'Excel : créer, ouvrir, reprendre un classeur récent.
            <div className="clsAccueil cosScroll">
              <div className="clsAccueilCorps">
                <h2>{t("bonjour")}{prenom ? `, ${prenom}` : ""}</h2>

                <div className="clsAccueilNouveau">
                  <button type="button" className="clsTuile" onClick={nouveau}>
                    <span className="clsTuileFeuille clsTuileVierge" aria-hidden="true">
                      <Icon fafa="faPlus" width={16} />
                    </span>
                    <span>{t("classeurVierge")}</span>
                  </button>
                  <button type="button" className="clsTuile" disabled={occupe} onClick={() => fichierRef.current?.click()}>
                    <span className="clsTuileFeuille clsTuileOuvrir" aria-hidden="true">
                      <Icon fafa="faFolderOpen" width={18} />
                    </span>
                    <span>{t("ouvrirExcel")}</span>
                  </button>
                </div>

                <div className="clsAccueilSection">{t("recents")}</div>
                <Contenu
                  etat={etat}
                  vide={!recents.length}
                  lignes={4}
                  rendreVide={() => <p className="clsAccueilVide">{t("aucunRecent")}</p>}
                >
                  <div className="clsRecents" role="list">
                    {recents.map((rec) => (
                      <div key={rec.id} role="listitem" className="clsRecent">
                        <button type="button" className="clsRecentOuvrir" onClick={() => ouvrirFiche(rec)}>
                          <Icon fafa="faTableCells" width={14} />
                          <span className="clsRecentNom">{rec.data.titre}</span>
                          <span className="clsRecentInfo">{t("feuillesN", { n: rec.data.feuilles?.length || 1 })}</span>
                          <span className="clsRecentDate">{quandModifie(rec.updatedAt)}</span>
                        </button>
                        <button
                          type="button"
                          className="clsRecentSuppr"
                          title={t("supprimer")}
                          aria-label={`${t("supprimer")} « ${rec.data.titre} »`}
                          onClick={() => supprimer(rec)}
                        >
                          <Icon fafa="faTrashCan" width={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                </Contenu>
              </div>
            </div>
          ) : (
            <>
              {/* Une seule ligne d'en-tête : Fichier et les onglets, le titre
                  avec son état, Enregistrer. */}
              <header className="clsEntete">
                <div className="clsOngletsRuban" role="tablist" aria-label="Ruban du classeur">
                  <MenuFichier t={t} actions={actionsFichier} />
                  {ONGLETS_RUBAN.map((onglet) => (
                    <button
                      type="button"
                      role="tab"
                      key={onglet}
                      className="clsOngletRuban"
                      aria-selected={ruban === onglet}
                      onClick={() => setRuban(onglet)}
                    >
                      {t(onglet)}
                    </button>
                  ))}
                </div>

                <div className="clsTitreZone">
                  <input
                    className="clsTitre"
                    value={classeur.titre}
                    // La largeur suit le nom : l'état reste collé au titre.
                    size={Math.min(40, Math.max(8, (classeur.titre || "").length + 1))}
                    aria-label={t("titreClasseur")}
                    title={t("renommer")}
                    onFocus={() => setHistorique((h) => D.empiler(h, classeurRef.current))}
                    onChange={(e) => {
                      const suivant = { ...classeurRef.current, titre: e.target.value };
                      classeurRef.current = suivant;
                      setClasseur(suivant);
                      setModifie(suivant !== etatEnregistreRef.current);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Escape") {
                        e.preventDefault();
                        grilleRef.current?.focus();
                      }
                    }}
                  />
                  <span className="clsEtatDoc" data-ton={etatDoc.ton} title={etatDoc.detail}>
                    {etatDoc.texte}
                  </span>
                </div>

                <div className="clsEnteteActions">
                  <button
                    type="button"
                    className="clsBoutonEnregistrer"
                    title={`${t("enregistrer")} (Ctrl+S)`}
                    disabled={occupe || !modifie}
                    onClick={enregistrer}
                  >
                    <Icon fafa="faFloppyDisk" width={12} />
                    <span>{t("enregistrer")}</span>
                  </button>
                </div>
              </header>

              <div className="clsBarre" data-ruban={ruban}>
                {ruban === "accueil" ? (
                  <>
                    <div className="clsGroupe">
                      <button className="clsIcone" title={t("annuler")} disabled={!historique.passe.length} onClick={faireAnnuler}><Icon fafa="faRotateLeft" width={12} /></button>
                      <button className="clsIcone" title={t("retablir")} disabled={!historique.futur.length} onClick={faireRetablir}><Icon fafa="faRotateRight" width={12} /></button>
                      <button className="clsIcone" title={t("copierN", { n: 1 })} data-secondaire="1" onClick={copier}><Icon fafa="faCopy" width={12} /></button>
                      <button className="clsIcone" title={t("collerIci")} data-secondaire="1" onClick={coller}><Icon fafa="faPaste" width={12} /></button>
                    </div>
                    <div className="clsGroupe">
                      <select
                        className="clsRubanSelect clsPolice"
                        value={celluleActive?.s?.police || "Arial"}
                        aria-label="Police"
                        onChange={(e) => styler({ police: e.target.value })}
                      >
                        <option>Arial</option>
                        <option>Calibri</option>
                        <option>Georgia</option>
                        <option>Verdana</option>
                        <option>Courier New</option>
                      </select>
                      <select
                        className="clsRubanSelect clsTaillePolice"
                        value={String(celluleActive?.s?.taille || 12)}
                        aria-label="Taille de police"
                        onChange={(e) => styler({ taille: Number(e.target.value) })}
                      >
                        {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32].map((taille) => <option key={taille}>{taille}</option>)}
                      </select>
                      <button className="clsIcone" title={t("augmenterPolice")} data-secondaire="1" onClick={() => styler({ taille: Math.min(72, Number(celluleActive?.s?.taille || 12) + 1) })}>A<sup>+</sup></button>
                      <button className="clsIcone" title={t("reduirePolice")} data-secondaire="1" onClick={() => styler({ taille: Math.max(6, Number(celluleActive?.s?.taille || 12) - 1) })}>A<sup>−</sup></button>
                      <button className="clsIcone" data-on={celluleActive?.s?.gras} title={t("gras")} onClick={() => styler({ gras: true }, true)}><b>B</b></button>
                      <button className="clsIcone" data-on={celluleActive?.s?.italique} title={t("italique")} onClick={() => styler({ italique: true }, true)}><i>I</i></button>
                      <button className="clsIcone" data-on={celluleActive?.s?.souligne} title={t("souligne")} onClick={() => styler({ souligne: true }, true)}><u>U</u></button>
                      <button className="clsIcone" data-on={celluleActive?.s?.barre} title={t("barre")} data-secondaire="1" onClick={() => styler({ barre: true }, true)}><s>ab</s></button>
                    </div>
                    <div className="clsGroupe">
                      <button className="clsIcone" title={t("alignGauche")} onClick={() => styler({ align: "" })}><Icon fafa="faAlignLeft" width={12} /></button>
                      <button className="clsIcone" title={t("alignCentre")} onClick={() => styler({ align: "center" })}><Icon fafa="faAlignCenter" width={12} /></button>
                      <button className="clsIcone" title={t("alignDroite")} onClick={() => styler({ align: "right" })}><Icon fafa="faAlignRight" width={12} /></button>
                      <button className="clsIcone" data-on={celluleActive?.s?.wrap} title={t("renvoyerLigne")} data-secondaire="2" onClick={() => styler({ wrap: true }, true)}><Icon fafa="faArrowTurnDown" width={12} /></button>
                      <button className="clsIcone" title={langue === "en" ? "All borders" : "Toutes les bordures"} data-secondaire="2" onClick={() => styler({ bordure: "all" })}><Icon fafa="faBorderAll" width={12} /></button>
                      <button className="clsIcone" title={langue === "en" ? "Merge cells" : "Fusionner les cellules"} data-secondaire="2" onClick={fusionnerSelection}><Icon fafa="faObjectGroup" width={12} /></button>
                      <button className="clsIcone" title={langue === "en" ? "Unmerge cells" : "Défusionner"} data-secondaire="1" onClick={defusionnerSelection}><Icon fafa="faObjectUngroup" width={12} /></button>
                    </div>
                    <div className="clsGroupe">
                      <button className="clsIcone" title={t("couleurTexte")} onClick={menuCouleur("couleurTexte")}><Icon fafa="faPalette" width={12} /></button>
                      <button className="clsIcone" title={t("couleurFond")} onClick={menuCouleur("couleurFond")}><Icon fafa="faFillDrip" width={12} /></button>
                      <button className="clsIcone" title={t("formatMonnaie")} onClick={() => styler({ format: "monnaie" })}>{devise}</button>
                      <button className="clsIcone" title={t("formatPourcent")} data-secondaire="2" onClick={() => styler({ format: "pourcent" })}>%</button>
                      <button className="clsIcone" title={t("formatNombre")} data-secondaire="1" onClick={() => styler({ format: "nombre" })}>.00</button>
                      <button className="clsIcone clsLarge" title={t("format")} onClick={menuFormat}>
                        <Icon fafa="faHashtag" width={11} />
                        <span>{(D.FORMATS.find((f) => f.id === (celluleActive?.s?.format || "auto")) || D.FORMATS[0]).nom[langue] || "Auto"}</span>
                      </button>
                    </div>
                    <div className="clsGroupe" data-secondaire="1">
                      <button className="clsIcone" title={t("effacerStyle")} onClick={() => styler({
                        gras: false, italique: false, souligne: false, barre: false,
                        align: "", format: "auto", couleurTexte: "", couleurFond: "",
                        police: "", taille: 0, wrap: false,
                      })}><Icon fafa="faEraser" width={12} /></button>
                    </div>
                  </>
                ) : null}
                {ruban === "insertion" ? (
                  <>
                    <button title="Tableau croisé" className="clsRibbonAction" onClick={insererTableauCroise}><Icon fafa="faTableList" width={15} /><span>Tableau croisé</span></button>
                    <button title="Tableau" className="clsRibbonAction" onClick={insererTableau}><Icon fafa="faTableCells" width={15} /><span>Tableau</span></button>
                    <button title="Formulaire" className="clsRibbonAction" onClick={insererFormulaire}><Icon fafa="faRectangleList" width={15} /><span>Formulaire</span></button>
                    <button title="Image" className="clsRibbonAction" onClick={() => imageRef.current?.click()}><Icon fafa="faImage" width={15} /><span>Image</span></button>
                    <button title="Forme" className="clsRibbonAction" onClick={() => insererTexte("forme")}><Icon fafa="faShapes" width={15} /><span>Forme</span></button>
                    <button title="Case à cocher" className="clsRibbonAction" onClick={insererCase}><Icon fafa="faSquareCheck" width={15} /><span>Case à cocher</span></button>
                    <div className="clsGroupe clsGraphiques">
                      <button title="Colonnes" className="clsRibbonAction" onClick={() => insererGraphique("colonnes")}><Icon fafa="faChartColumn" width={15} /><span>Colonnes</span></button>
                      <button title="Courbe" className="clsRibbonAction" onClick={() => insererGraphique("courbe")}><Icon fafa="faChartLine" width={15} /><span>Courbe</span></button>
                      <button title="Secteurs" className="clsRibbonAction" onClick={() => insererGraphique("secteurs")}><Icon fafa="faChartPie" width={15} /><span>Secteurs</span></button>
                    </div>
                    <button title="Lien" className="clsRibbonAction" onClick={insererLien}><Icon fafa="faLink" width={15} /><span>Lien</span></button>
                    <button title="Commentaire" className="clsRibbonAction" onClick={insererCommentaire}><Icon fafa="faCommentMedical" width={15} /><span>Commentaire</span></button>
                    <button title="Zone de texte" className="clsRibbonAction" onClick={() => insererTexte("texte")}><Icon fafa="faFont" width={15} /><span>Zone de texte</span></button>
                    <button
                      title="Supprimer l’insertion"
                      className="clsRibbonAction clsActionDanger"
                      disabled={!objetSelectionne && !celluleActive?.type && !celluleActive?.href && !celluleActive?.commentaire && !celluleActive?.objet}
                      onClick={supprimerInsertion}
                    ><Icon fafa="faTrashCan" width={15} /><span>Supprimer l’insertion</span></button>
                  </>
                ) : null}
                {ruban === "donnees" ? (
                  <>
                    <button title={t("sommeAuto")} className="clsRibbonAction" onClick={() => appliquer(D.sommeAutomatique(cellules, sel))}><span className="clsFonctionSigle">Σ</span><span>{t("sommeAuto")}</span></button>
                    <button title={t("triCroissant")} className="clsRibbonAction" onClick={() => appliquer(D.trierPlage(cellules, sel, "asc"))}><Icon fafa="faArrowDownAZ" width={15} /><span>{t("triCroissant")}</span></button>
                    <button title={t("triDecroissant")} className="clsRibbonAction" onClick={() => appliquer(D.trierPlage(cellules, sel, "desc"))}><Icon fafa="faArrowDownZA" width={15} /><span>{t("triDecroissant")}</span></button>
                    <button title={t("rechercher")} className="clsRibbonAction" onClick={rechercherCellule}><Icon fafa="faMagnifyingGlass" width={15} /><span>{t("rechercher")}</span></button>
                    <button title={t("remplacer")} className="clsRibbonAction" onClick={remplacerCellules}><Icon fafa="faRightLeft" width={15} /><span>{t("remplacer")}</span></button>
                    <button title={t("remplirBas")} className="clsRibbonAction" onClick={() => appliquer(D.remplirVersLeBas(cellules, sel))}><Icon fafa="faArrowDown" width={15} /><span>{t("remplirBas")}</span></button>
                    <button title={t("vider")} className="clsRibbonAction" onClick={() => appliquer(D.vider(cellules, sel))}><Icon fafa="faEraser" width={15} /><span>{t("vider")}</span></button>
                    <button title={t("retirerDoublons")} className="clsRibbonAction" onClick={() => appliquer(D.retirerDoublonsPlage(cellules, sel))}><Icon fafa="faClone" width={15} /><span>{t("retirerDoublons")}</span></button>
                    <button title={t("surlignerDoublons")} className="clsRibbonAction" onClick={() => appliquer(D.surlignerDoublons(cellules, sel))}><Icon fafa="faHighlighter" width={15} /><span>{t("surlignerDoublons")}</span></button>
                    <button title={langue === "en" ? "Data validation" : "Validation"} className="clsRibbonAction" onClick={appliquerValidationListe}><Icon fafa="faListCheck" width={15} /><span>{langue === "en" ? "Data validation" : "Validation"}</span></button>
                    <button title={langue === "en" ? "Conditional format" : "Format conditionnel"} className="clsRibbonAction" onClick={ajouterRegleConditionnelle}><Icon fafa="faWandMagicSparkles" width={15} /><span>{langue === "en" ? "Conditional format" : "Format conditionnel"}</span></button>
                    <button title={langue === "en" ? "Filter" : "Filtrer"} className="clsRibbonAction" onClick={filtrerSelection}><Icon fafa="faFilter" width={15} /><span>{langue === "en" ? "Filter" : "Filtrer"}</span></button>
                    <button title={langue === "en" ? "Clear filters" : "Effacer les filtres"} className="clsRibbonAction" disabled={!feuille.filtres?.length} onClick={retirerFiltres}><Icon fafa="faFilterCircleXmark" width={15} /><span>{langue === "en" ? "Clear filters" : "Effacer les filtres"}</span></button>
                    <button title={t("importer")} className="clsRibbonAction" onClick={() => fichierRef.current?.click()}><Icon fafa="faFileImport" width={15} /><span>{t("importer")}</span></button>
                  </>
                ) : null}
                {ruban === "formules" ? (
                  <>
                    <button title={t("sommeAuto")} className="clsRibbonAction" onClick={() => appliquer(D.sommeAutomatique(cellules, sel))}><span className="clsFonctionSigle">Σ</span><span>{t("sommeAuto")}</span></button>
                    <button title={t("moyenneAuto")} className="clsRibbonAction" onClick={() => appliquer(D.agregatAutomatique(cellules, sel, "MOYENNE"))}><span className="clsFonctionSigle">x̄</span><span>{t("moyenneAuto")}</span></button>
                    <button title={t("nombreAuto")} className="clsRibbonAction" onClick={() => appliquer(D.agregatAutomatique(cellules, sel, "NB"))}><span className="clsFonctionSigle">#</span><span>{t("nombreAuto")}</span></button>
                    <button title={t("minimumAuto")} className="clsRibbonAction" onClick={() => appliquer(D.agregatAutomatique(cellules, sel, "MIN"))}><span className="clsFonctionSigle">↓</span><span>{t("minimumAuto")}</span></button>
                    <button title={t("maximumAuto")} className="clsRibbonAction" onClick={() => appliquer(D.agregatAutomatique(cellules, sel, "MAX"))}><span className="clsFonctionSigle">↑</span><span>{t("maximumAuto")}</span></button>
                    {D.FORMATS.filter((format) => format.id !== "auto").map((format) => (
                      <button key={format.id} className="clsRibbonAction" onClick={() => styler({ format: format.id })}>
                        <Icon fafa="faHashtag" width={13} /><span>{format.nom[langue] || format.nom.fr}</span>
                      </button>
                    ))}
                  </>
                ) : null}
                {ruban === "revision" ? (
                  <>
                    <button title={t("rechercher")} className="clsRibbonAction" onClick={rechercherCellule}><Icon fafa="faMagnifyingGlass" width={15} /><span>{t("rechercher")}</span></button>
                    <button title={t("remplacer")} className="clsRibbonAction" onClick={remplacerCellules}><Icon fafa="faRightLeft" width={15} /><span>{t("remplacer")}</span></button>
                    <button title={t("copierN", { n: (Math.abs(sel.l2 - sel.l) + 1) * (Math.abs(sel.c2 - sel.c) + 1) })} className="clsRibbonAction" onClick={copier}><Icon fafa="faCopy" width={15} /><span>{t("copierN", { n: (Math.abs(sel.l2 - sel.l) + 1) * (Math.abs(sel.c2 - sel.c) + 1) })}</span></button>
                  </>
                ) : null}
                {ruban === "affichage" ? (
                  <>
                    <button title={t("mesClasseurs")} className="clsRibbonAction" onClick={() => setVoletVisible(true)}><Icon fafa="faFolderOpen" width={15} /><span>{t("mesClasseurs")}</span></button>
                    <button title={t("figerLigne")} className="clsRibbonAction" data-on={feuille.figees?.lignes > 0} onClick={() => figer("ligne")}><Icon fafa="faGripLines" width={15} /><span>{t("figerLigne")}</span></button>
                    <button title={t("figerColonne")} className="clsRibbonAction" data-on={feuille.figees?.colonnes > 0} onClick={() => figer("colonne")}><Icon fafa="faGripLinesVertical" width={15} /><span>{t("figerColonne")}</span></button>
                    <button title={t("figerSelection")} className="clsRibbonAction" onClick={() => appliquer(null, { figees: { lignes: sel.l, colonnes: sel.c } })}><Icon fafa="faThumbtack" width={15} /><span>{t("figerSelection")}</span></button>
                    <button title={t("libererVolets")} className="clsRibbonAction" onClick={() => figer("aucun")}><Icon fafa="faUnlock" width={15} /><span>{t("libererVolets")}</span></button>
                    <button title={langue === "en" ? "Hide rows" : "Masquer les lignes"} className="clsRibbonAction" onClick={masquerLignesSelectionnees}><Icon fafa="faEyeSlash" width={15} /><span>{langue === "en" ? "Hide rows" : "Masquer les lignes"}</span></button>
                    <button title={langue === "en" ? "Show all rows" : "Afficher les lignes"} className="clsRibbonAction" disabled={!feuille.lignesMasquees?.length} onClick={afficherToutesLesLignes}><Icon fafa="faEye" width={15} /><span>{langue === "en" ? "Show all rows" : "Afficher les lignes"}</span></button>
                  </>
                ) : null}
              </div>

              <div className="clsFormule">
                <span className="clsRef">{D.repereColonne(sel.c)}{sel.l + 1}</span>
                <span className="clsFx" aria-hidden="true">fx</span>
                <input
                  key={`${iFeuille}:${sel.l}:${sel.c}:${sourceCelluleActive}`}
                  defaultValue={sourceCelluleActive}
                  placeholder={t("formulePlaceholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const valeur = e.currentTarget.value;
                      appliquer(D.poser(
                        cellules,
                        sel.l,
                        sel.c,
                        D.estFormule(valeur) ? { v: "", f: valeur } : { v: valeur, f: undefined },
                      ));
                      grilleRef.current?.focus();
                    }
                    if (e.key === "Escape") grilleRef.current?.focus();
                  }}
                />
              </div>

              <div
                className="clsGrille"
                style={{
                  "--cls-zoom": zoom / 100,
                  "--cls-col-width": `${largeurColonneAffichee}px`,
                }}
                ref={grilleRef}
                tabIndex={0}
                onKeyDown={auClavier}
                onScroll={(e) => {
                  setDefilement(e.currentTarget.scrollTop);
                  setDefilementX(e.currentTarget.scrollLeft);
                }}
              >
                <div className="clsObjets" aria-label="Objets flottants">
                  {(feuille.objets || []).map((objet) => (
                    <div
                      key={objet.id}
                      className={`clsObjet clsObjet-${objet.type}`}
                      data-selectionne={objetSelectionne === objet.id || undefined}
                      style={{
                        left: objet.ancre
                          ? LARGEUR_NUMEROTATION + (geometrieColonnes.positions[objet.ancre.c] || 0) + objet.ancre.dx * facteurZoom
                          : objet.x * facteurZoom,
                        top: objet.ancre
                          ? hauteurEnteteAffichee + geometrieLignes.positions[objet.ancre.l] + objet.ancre.dy * facteurZoom
                          : objet.y * facteurZoom,
                        width: objet.largeur,
                        height: objet.hauteur,
                        transform: `scale(${facteurZoom})`,
                        transformOrigin: "top left",
                        zIndex: 20 + (objet.z || 0),
                      }}
                      role="group"
                      tabIndex={0}
                      aria-label={objet.alt || objet.texte || `Graphique ${objet.graphique || ""}`}
                      onMouseDown={(e) => {
                        if (e.button !== 0 || e.target.closest(".clsObjetPoignee")) return;
                        e.preventDefault();
                        e.stopPropagation();
                        e.currentTarget.focus();
                        setObjetSelectionne(objet.id);
                        setObjetInteraction({
                          id: objet.id, mode: "deplacement", x0: e.clientX, y0: e.clientY,
                          x: objet.x, y: objet.y,
                          ancre: objet.ancre ? { ...objet.ancre, dx: objet.ancre.dx || 0, dy: objet.ancre.dy || 0 } : null,
                        });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Delete" || e.key === "Backspace") {
                          e.preventDefault();
                          appliquer(null, { objets: (feuille.objets || []).filter((x) => x.id !== objet.id) });
                          setObjetSelectionne(null);
                        }
                        if (e.key === "Escape") setObjetSelectionne(null);
                      }}
                    >
                      {objet.type === "image" ? <img src={objet.image} alt={objet.alt || ""} draggable="false" style={{ transform: `rotate(${objet.rotation || 0}deg)` }} /> : null}
                      {objet.type === "graphique" ? <MiniGraphique objet={objet} cellules={cellules} classeur={classeur} iFeuille={iFeuille} /> : null}
                      {objet.type === "forme" ? (
                        <div
                          className="clsObjetForme"
                          data-forme={objet.forme || "arrondi"}
                          style={{
                            "--forme-remplissage": objet.remplissage || "#DBE8FF",
                            "--forme-contour": objet.contour || "#174EA6",
                            "--forme-texte": objet.couleurTexte || "#174EA6",
                            "--forme-epaisseur": `${objet.epaisseur || 2}px`,
                            fontSize: objet.tailleTexte ? `${objet.tailleTexte}px` : undefined,
                            transform: `rotate(${(objet.rotation || 0) + (objet.forme === "losange" ? 45 : 0)}deg)`,
                          }}
                        >{objet.texte}</div>
                      ) : null}
                      {objet.type === "texte" ? <div className="clsObjetTexte">{objet.texte}</div> : null}
                      {objetSelectionne === objet.id ? (
                        <>
                          {objet.type === "graphique" ? (
                            <div className="clsGraphiqueOutils" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                              <button type="button" title="Graphique en colonnes" data-actif={(objet.graphique === "colonnes") || undefined} onClick={() => modifierObjet(objet.id, { graphique: "colonnes" })}><Icon fafa="faChartColumn" width={12} /></button>
                              <button type="button" title="Graphique en courbe" data-actif={(objet.graphique === "courbe") || undefined} onClick={() => modifierObjet(objet.id, { graphique: "courbe" })}><Icon fafa="faChartLine" width={12} /></button>
                              <button type="button" title="Graphique en secteurs" data-actif={(objet.graphique === "secteurs") || undefined} onClick={() => modifierObjet(objet.id, { graphique: "secteurs" })}><Icon fafa="faChartPie" width={12} /></button>
                              <button type="button" title="Modifier le titre" onClick={() => editerTitreGraphique(objet)}><Icon fafa="faPen" width={12} /></button>
                              <button type="button" title="Afficher ou masquer la légende" data-actif={(objet.legende !== false) || undefined} onClick={() => modifierObjet(objet.id, { legende: objet.legende === false })}><Icon fafa="faList" width={12} /></button>
                              <button type="button" title="Changer les couleurs" onClick={() => modifierObjet(objet.id, {
                                palette: objet.palette?.[0] === "#E85AAD"
                                  ? ["#5B6CFF", "#00A6A6", "#F59E0B", "#E85AAD", "#34A853", "#8B5CF6"]
                                  : ["#E85AAD", "#8B5CF6", "#3B82F6", "#06B6D4", "#10B981", "#F59E0B"],
                              })}><Icon fafa="faPalette" width={12} /></button>
                            </div>
                          ) : null}
                          {objet.type === "forme" ? (
                            <div className="clsGraphiqueOutils clsFormeOutils" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                              <button type="button" title="Changer la forme" onClick={() => {
                                const formes = ["arrondi", "rectangle", "ellipse", "losange"];
                                modifierObjet(objet.id, { forme: formes[(formes.indexOf(objet.forme || "arrondi") + 1) % formes.length] });
                              }}><Icon fafa="faShapes" width={12} /></button>
                              <label className="clsCouleurObjet" title="Couleur de remplissage"><Icon fafa="faFillDrip" width={11} /><input type="color" value={objet.remplissage === "transparent" ? "#ffffff" : (objet.remplissage || "#DBE8FF")} onChange={(e) => modifierObjet(objet.id, { remplissage: e.target.value })} /></label>
                              <label className="clsCouleurObjet" title="Couleur du contour"><Icon fafa="faBorderAll" width={11} /><input type="color" value={objet.contour === "transparent" ? "#ffffff" : (objet.contour || "#174EA6")} onChange={(e) => modifierObjet(objet.id, { contour: e.target.value })} /></label>
                              <label className="clsCouleurObjet" title="Couleur du texte"><Icon fafa="faFont" width={11} /><input type="color" value={objet.couleurTexte || "#174EA6"} onChange={(e) => modifierObjet(objet.id, { couleurTexte: e.target.value })} /></label>
                              <button type="button" title="Couleur de remplissage" onClick={() => {
                                const couleurs = ["#DBE8FF", "#E6F4EA", "#FEF7E0", "#FCE8E6", "#F3E8FD", "transparent"];
                                modifierObjet(objet.id, { remplissage: couleurs[(couleurs.indexOf(objet.remplissage || "#DBE8FF") + 1) % couleurs.length] });
                              }}><Icon fafa="faFillDrip" width={12} /></button>
                              <button type="button" title="Couleur du contour" onClick={() => {
                                const couleurs = ["#174EA6", "#137333", "#B06000", "#C5221F", "#7627BB", "transparent"];
                                modifierObjet(objet.id, { contour: couleurs[(couleurs.indexOf(objet.contour || "#174EA6") + 1) % couleurs.length] });
                              }}><Icon fafa="faBorderAll" width={12} /></button>
                              <button type="button" title="Couleur du texte" onClick={() => {
                                const couleurs = ["#174EA6", "#202124", "#FFFFFF", "#C5221F", "#137333", "#7627BB"];
                                modifierObjet(objet.id, { couleurTexte: couleurs[(couleurs.indexOf(objet.couleurTexte || "#174EA6") + 1) % couleurs.length] });
                              }}><Icon fafa="faFont" width={12} /></button>
                              <button type="button" title="Contour plus fin" onClick={() => modifierObjet(objet.id, { epaisseur: Math.max(0, (objet.epaisseur || 2) - 1) })}>−</button>
                              <button type="button" title="Contour plus épais" onClick={() => modifierObjet(objet.id, { epaisseur: Math.min(12, (objet.epaisseur || 2) + 1) })}>+</button>
                              <button type="button" title="Texte plus petit" onClick={() => modifierObjet(objet.id, { tailleTexte: Math.max(8, (objet.tailleTexte || 14) - 1) })}>A−</button>
                              <button type="button" title="Texte plus grand" onClick={() => modifierObjet(objet.id, { tailleTexte: Math.min(72, (objet.tailleTexte || 14) + 1) })}>A+</button>
                              <button type="button" title="Rotation à gauche" onClick={() => modifierObjet(objet.id, { rotation: (objet.rotation || 0) - 15 })}><Icon fafa="faRotateLeft" width={12} /></button>
                              <button type="button" title="Rotation à droite" onClick={() => modifierObjet(objet.id, { rotation: (objet.rotation || 0) + 15 })}><Icon fafa="faRotateRight" width={12} /></button>
                              <button type="button" title="Mettre au premier plan" onClick={() => modifierObjet(objet.id, { z: Math.max(0, ...(feuille.objets || []).map((x) => x.z || 0)) + 1 })}><Icon fafa="faArrowUp" width={12} /></button>
                              <button type="button" title="Mettre à l’arrière-plan" onClick={() => modifierObjet(objet.id, { z: Math.min(0, ...(feuille.objets || []).map((x) => x.z || 0)) - 1 })}><Icon fafa="faArrowDown" width={12} /></button>
                            </div>
                          ) : null}
                          {objet.type === "forme" || objet.type === "image" ? <button
                            type="button"
                            className="clsObjetRotation"
                            aria-label="Faire pivoter"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const rect = e.currentTarget.parentElement.getBoundingClientRect();
                              const centreX = rect.left + rect.width / 2;
                              const centreY = rect.top + rect.height / 2;
                              setObjetInteraction({
                                id: objet.id, mode: "rotation", centreX, centreY,
                                angle0: Math.atan2(e.clientY - centreY, e.clientX - centreX) * 180 / Math.PI,
                                rotation: objet.rotation || 0,
                              });
                            }}
                          /> : null}
                          <button
                            type="button"
                            className="clsObjetPoignee"
                            aria-label="Redimensionner"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setObjetInteraction({
                                id: objet.id, mode: "taille", x0: e.clientX, y0: e.clientY,
                                largeur: objet.largeur, hauteur: objet.hauteur,
                              });
                            }}
                          />
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
                <table role="grid" aria-rowcount={nbL} aria-colcount={nbC} aria-multiselectable="true">
                  <thead>
                    <tr>
                      <th
                        className="clsNum clsToutSelectionner"
                        title={langue === "en" ? "Select all" : "Tout sélectionner"}
                        data-actif={sel.l === 0 && sel.c === 0 && sel.l2 === nbL - 1 && sel.c2 === nbC - 1}
                        onClick={() => {
                          setSel({ l: 0, c: 0, l2: nbL - 1, c2: nbC - 1 });
                          grilleRef.current?.focus();
                        }}
                      />
                      {geometrieColonnes.fixes.map((c) => (
                        <th
                          key={c}
                          data-filtre={(feuille.filtres || []).some((f) => f.c === c) || undefined}
                          style={{
                            ...(feuille.largeurs?.[c]
                              ? {
                                  width: `calc(${feuille.largeurs[c]}px * var(--cls-zoom, 1))`,
                                  minWidth: `calc(${feuille.largeurs[c]}px * var(--cls-zoom, 1))`,
                                }
                              : {}),
                            ...(c < (feuille.figees?.colonnes || 0)
                              ? { left: gaucheColonne(c), zIndex: 4 }
                              : {}),
                          }}
                          data-actif={c >= Math.min(sel.c, sel.c2) && c <= Math.max(sel.c, sel.c2)}
                          onClick={(e) => {
                            setSel((actuelle) => e.shiftKey
                              ? { l: 0, c: actuelle.c, l2: nbL - 1, c2: c }
                              : { l: 0, c, l2: nbL - 1, c2: c });
                            grilleRef.current?.focus();
                          }}
                          onContextMenu={menuColonne(c)}
                        >
                          {D.repereColonne(c)}
                          <span
                            className="clsPoignee"
                            onClick={(e) => e.stopPropagation()}
                            onContextMenu={(e) => e.stopPropagation()}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setRedim({ c, x0: e.clientX, l0: feuille.largeurs?.[c] || e.currentTarget.parentElement.offsetWidth });
                            }}
                          />
                        </th>
                      ))}
                      {geometrieColonnes.espaceGauche > 0 ? (
                        <th className="clsColSpacer" style={{ width: geometrieColonnes.espaceGauche, minWidth: geometrieColonnes.espaceGauche }} />
                      ) : null}
                      {geometrieColonnes.visibles.map((c) => (
                        <th
                          key={c}
                          data-filtre={(feuille.filtres || []).some((f) => f.c === c) || undefined}
                          style={feuille.largeurs?.[c]
                            ? {
                                width: `calc(${feuille.largeurs[c]}px * var(--cls-zoom, 1))`,
                                minWidth: `calc(${feuille.largeurs[c]}px * var(--cls-zoom, 1))`,
                              }
                            : undefined}
                          data-actif={c >= Math.min(sel.c, sel.c2) && c <= Math.max(sel.c, sel.c2)}
                          onClick={(e) => {
                            setSel((actuelle) => e.shiftKey
                              ? { l: 0, c: actuelle.c, l2: nbL - 1, c2: c }
                              : { l: 0, c, l2: nbL - 1, c2: c });
                            grilleRef.current?.focus();
                          }}
                          onContextMenu={menuColonne(c)}
                        >
                          {D.repereColonne(c)}
                          <span
                            className="clsPoignee"
                            onClick={(e) => e.stopPropagation()}
                            onContextMenu={(e) => e.stopPropagation()}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setRedim({ c, x0: e.clientX, l0: feuille.largeurs?.[c] || e.currentTarget.parentElement.offsetWidth / (zoom / 100) });
                            }}
                          />
                        </th>
                      ))}
                      {geometrieColonnes.espaceDroite > 0 ? (
                        <th className="clsColSpacer" style={{ width: geometrieColonnes.espaceDroite, minWidth: geometrieColonnes.espaceDroite }} />
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {debut > 0 ? <tr style={{ height: geometrieLignes.positions[debut] }}><td colSpan={colonnesRendues.length + 3} /></tr> : null}
                    {cellules.slice(debut, fin).map((ligne, i) => {
                      const l = debut + i;
                      return (
                        <tr key={l} style={{ height: ligneEstMasquee(l) ? 0 : (feuille.hauteurs?.[l] || HAUTEUR_LIGNE) * facteurZoom, display: ligneEstMasquee(l) ? "none" : undefined }}>
                          <th className="clsNum" data-actif={l >= Math.min(sel.l, sel.l2) && l <= Math.max(sel.l, sel.l2)}
                              onClick={(e) => {
                                setSel((actuelle) => e.shiftKey
                                  ? { l: actuelle.l, c: 0, l2: l, c2: nbC - 1 }
                                  : { l, c: 0, l2: l, c2: nbC - 1 });
                                grilleRef.current?.focus();
                              }}
                              onContextMenu={menuLigne(l)}>
                            {l + 1}
                            <span
                              className="clsPoigneeLigne"
                              onClick={(e) => e.stopPropagation()}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setHistorique((h) => D.empiler(h, classeurRef.current));
                                setRedimLigne({ l, y0: e.clientY, h0: feuille.hauteurs?.[l] || HAUTEUR_LIGNE });
                              }}
                            />
                          </th>
                          {colonnesRendues.map((c) => {
                            if (c === null) {
                              return <td key="spacer-left" className="clsColSpacer" style={{ width: geometrieColonnes.espaceGauche, minWidth: geometrieColonnes.espaceGauche }} />;
                            }
                            const cel = ligne[c] || CELLULE_VIDE_AFFICHEE;
                            const fusion = (feuille.fusions || []).find((f) => l >= f.l1 && l <= f.l2 && c >= f.c1 && c <= f.c2);
                            if (fusion && (l !== fusion.l1 || c !== fusion.c1)) return null;
                            const enEdition = edition?.l === l && edition?.c === c;
                            const affichee = D.valeurAfficheeClasseur(classeur, iFeuille, l, c, devise);
                            const regle = (feuille.reglesConditionnelles || []).find((r) => {
                              const p = r.plage;
                              if (!p || l < p.l1 || l > p.l2 || c < p.c1 || c > p.c2) return false;
                              if (r.type === "barreDonnees") return true;
                              if (r.type === "contientTexte") {
                                return String(D.valeurCalculeeClasseur(classeur, iFeuille, l, c)).toLocaleLowerCase(langue)
                                  .includes(String(r.texte || "").toLocaleLowerCase(langue));
                              }
                              if (r.type === "egal") {
                                return String(D.valeurCalculeeClasseur(classeur, iFeuille, l, c)).toLocaleUpperCase(langue)
                                  === String(r.valeur ?? "").toLocaleUpperCase(langue);
                              }
                              const n = Number(String(D.valeurCalculeeClasseur(classeur, iFeuille, l, c)).replace(",", "."));
                              return r.operateur === "superieur" && Number.isFinite(n) && n > r.valeur;
                            });
                            const s = { ...(cel?.s || {}), ...(regle?.style || {}) };
                            const optionsListe = cel.validation?.type === "liste"
                              ? D.optionsValidation(classeur, cel.validation)
                              : [];
                            const valeurBarre = regle?.type === "barreDonnees" ? Number(cel?.v) : NaN;
                            const amplitudeBarre = (regle?.max || 0) - (regle?.min || 0);
                            const pourcentageBarre = Number.isFinite(valeurBarre) && amplitudeBarre > 0
                              ? Math.max(0, Math.min(100, ((valeurBarre - regle.min) / amplitudeBarre) * 100))
                              : 0;
                            const plage = D.normaliser(selectionVisuelle);
                            const selectionnee = dansSel(l, c);
                            return (
                              <td
                                key={c}
                                role="gridcell"
                                colSpan={fusion ? fusion.c2 - fusion.c1 + 1 : undefined}
                                rowSpan={fusion ? fusion.l2 - fusion.l1 + 1 : undefined}
                                aria-rowindex={l + 1}
                                aria-colindex={c + 1}
                                aria-selected={selectionnee}
                                style={{
                                  ...(feuille.largeurs?.[c]
                                    ? {
                                        width: `calc(${feuille.largeurs[c]}px * var(--cls-zoom, 1))`,
                                        minWidth: `calc(${feuille.largeurs[c]}px * var(--cls-zoom, 1))`,
                                      }
                                    : {}),
                                  position:
                                    l < (feuille.figees?.lignes || 0) ||
                                    c < (feuille.figees?.colonnes || 0)
                                      ? "sticky"
                                      : undefined,
                                  top: l < (feuille.figees?.lignes || 0)
                                    ? hauteurEnteteAffichee + geometrieLignes.positions[l]
                                    : undefined,
                                  left: c < (feuille.figees?.colonnes || 0)
                                    ? gaucheColonne(c)
                                    : undefined,
                                  zIndex:
                                    l < (feuille.figees?.lignes || 0) &&
                                    c < (feuille.figees?.colonnes || 0)
                                      ? 5
                                      : l < (feuille.figees?.lignes || 0) ||
                                          c < (feuille.figees?.colonnes || 0)
                                        ? 4
                                        : undefined,
                                  fontWeight: s.gras ? 700 : undefined,
                                  fontStyle: s.italique ? "italic" : undefined,
                                  fontFamily: s.police
                                    ? `"${String(s.police).replace(/"/g, "")}", Calibri, Carlito, Arial, sans-serif`
                                    : undefined,
                                  // OOXML et le ruban Excel expriment la
                                  // taille en points typographiques. En la
                                  // rendant en pixels, 10 pt devenait 10 px
                                  // au lieu d'environ 13,3 px et paraissait
                                  // nettement trop petit.
                                  fontSize: s.taille ? `${s.taille}pt` : undefined,
                                  textDecoration: s.souligne ? "underline" : undefined,
                                  textDecorationLine: [s.souligne ? "underline" : "", s.barre ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
                                  textAlign: s.align || undefined,
                                  whiteSpace: s.wrap ? "normal" : undefined,
                                  color: s.couleurTexte ? `#${s.couleurTexte}` : undefined,
                                  border: s.bordure === "all" ? "1px solid color-mix(in srgb, var(--app-text) 55%, transparent)" : undefined,
                                  borderTop: cssBordure(s.bordures?.top),
                                  borderRight: cssBordure(s.bordures?.right),
                                  borderBottom: cssBordure(s.bordures?.bottom),
                                  borderLeft: cssBordure(s.bordures?.left),
                                  background: s.couleurFond
                                    ? `#${s.couleurFond}`
                                    : l < (feuille.figees?.lignes || 0) ||
                                        c < (feuille.figees?.colonnes || 0)
                                      ? "var(--app-champ)"
                                      : undefined,
                                  backgroundImage: regle?.type === "barreDonnees" && pourcentageBarre > 0
                                    ? `linear-gradient(90deg, #${regle.couleur}66 ${pourcentageBarre}%, transparent ${pourcentageBarre}%)`
                                    : undefined,
                                }}
                                data-sel={selectionnee || undefined}
                                data-active={(l === sel.l && c === sel.c) || undefined}
                                data-editing={enEdition || undefined}
                                data-sel-top={(selectionnee && l === plage.l1) || undefined}
                                data-sel-bottom={(selectionnee && l === plage.l2) || undefined}
                                data-sel-left={(selectionnee && c === plage.c1) || undefined}
                                data-sel-right={(selectionnee && c === plage.c2) || undefined}
                                data-formule={(!!cel?.f || D.estFormule(cel?.v)) || undefined}
                                data-erreur={String(affichee).startsWith("#") || undefined}
                                onMouseDown={(e) => {
                                  // Le clic droit ne déplace rien : c'est le
                                  // menu qui décide, en respectant la
                                  // sélection déjà faite.
                                  if (e.button === 2) return;
                                  if (e.shiftKey) return setSel((x) => ({ ...x, l2: l, c2: c }));
                                  selectionBougeeRef.current = false;
                                  setSel({ l, c, l2: l, c2: c });
                                  setObjetSelectionne(null);
                                  setGlisse(true);
                                  grilleRef.current?.focus();
                                }}
                                // `onMouseOver` et non `onMouseEnter` : le
                                // second est synthétisé par React depuis
                                // les paires mouseout/mouseover, le premier
                                // suit l'événement natif.
                                onMouseOver={() => {
                                  if (recopie) {
                                    setRecopie((courante) => ({ ...courante, cible: { l, c } }));
                                    return;
                                  }
                                  if (glisse) {
                                    selectionBougeeRef.current = true;
                                    setSel((x) => ({ ...x, l2: l, c2: c }));
                                  }
                                }}
                                onContextMenu={menuCellule(l, c)}
                              onDoubleClick={(e) => {
                                if (!e.shiftKey && !selectionBougeeRef.current) setEdition({ l, c, valeur: cel?.f || cel?.v || "" });
                              }}
                              >
                                {enEdition ? (
                                  <input
                                    autoFocus
                                    defaultValue={edition.valeur}
                                    onFocus={(e) => {
                                      // Un double-clic/F2 sert à poursuivre la saisie :
                                      // sélectionner tout le texte ferait disparaître
                                      // l'ancienne valeur à la première touche.
                                      //
                                      // Le curseur est placé tout de suite, et non à
                                      // l'image suivante : sinon les lettres tapées
                                      // entre-temps (saisie rapide, lecteur de codes-
                                      // barres) étaient suivies d'un retour du curseur
                                      // en arrière — « Riz » devenait « Rzi ».
                                      const champ = e.currentTarget;
                                      champ.setSelectionRange(champ.value.length, champ.value.length);
                                    }}
                                    onBlur={(e) => validerEdition(e.target.value, false)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") { e.preventDefault(); validerEdition(e.currentTarget.value, true); }
                                      if (e.key === "Tab") { e.preventDefault(); validerEdition(e.currentTarget.value, false); deplacer(0, 1); }
                                      if (e.key === "Escape") { e.preventDefault(); setEdition(null); grilleRef.current?.focus(); }
                                    }}
                                  />
                                ) : cel.type === "checkbox" ? (
                                  <button
                                    type="button"
                                    className="clsCaseCellule"
                                    aria-label={cel.v === "TRUE" ? "Décocher" : "Cocher"}
                                    aria-pressed={cel.v === "TRUE"}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      appliquer(D.poser(cellules, l, c, { v: cel.v === "TRUE" ? "FALSE" : "TRUE" }));
                                    }}
                                  ><Icon fafa={cel.v === "TRUE" ? "faSquareCheck" : "faSquare"} width={14} /></button>
                                ) : cel.validation?.type === "liste" ? (
                                  <select
                                    className="clsValidationCellule"
                                    value={cel.v || ""}
                                    aria-label={langue === "en" ? "Allowed value" : "Valeur autorisée"}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onChange={(e) => appliquer(D.poser(cellules, l, c, { v: e.target.value, f: undefined }))}
                                  >
                                    <option value="" />
                                    {optionsListe.map((option) => <option key={option}>{option}</option>)}
                                  </select>
                                ) : cel.href ? (
                                  <a className="clsLienCellule" href={cel.href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{affichee}</a>
                                ) : (
                                  <span className={cel.type === "forme" ? "clsFormeCellule" : undefined}>{affichee}</span>
                                )}
                                {cel.commentaire ? <i className="clsCommentaireCellule" title={cel.commentaire} aria-label={`Commentaire : ${cel.commentaire}`} /> : null}
                                {!enEdition && l === D.normaliser(sel).l2 && c === D.normaliser(sel).c2 ? (
                                  <button
                                    type="button"
                                    className="clsPoigneeRecopie"
                                    title={langue === "en" ? "Drag to fill" : "Faire glisser pour recopier"}
                                    aria-label={langue === "en" ? "Fill handle" : "Poignée de recopie"}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setGlisse(false);
                                      setRecopie({ source: { ...sel }, cible: { l, c } });
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                ) : null}
                              </td>
                            );
                          })}
                          {geometrieColonnes.espaceDroite > 0 ? (
                            <td className="clsColSpacer" style={{ width: geometrieColonnes.espaceDroite, minWidth: geometrieColonnes.espaceDroite }} />
                          ) : null}
                        </tr>
                      );
                    })}
                    {fin < nbL ? <tr style={{ height: geometrieLignes.positions[nbL] - geometrieLignes.positions[fin] }}><td colSpan={colonnesRendues.length + 3} /></tr> : null}
                  </tbody>
                </table>
              </div>

              {/* Barre d'état d'Excel : les feuilles à gauche, le calcul rapide de
                  la sélection et le zoom à droite. */}
              <footer className="clsBarreEtat">
                <div className="clsOnglets">
                  {classeur.feuilles.map((f, i) => (
                    <button
                      key={i}
                      type="button"
                      className="clsOnglet"
                      data-actif={i === iFeuille}
                      onClick={() => { setIFeuille(i); setSel({ l: 0, c: 0, l2: 0, c2: 0 }); }}
                      onContextMenu={menuFeuille(i)}
                    >
                      {f.nom}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="clsOnglet clsPlus"
                    title={t("nouvelleFeuille")}
                    aria-label={t("nouvelleFeuille")}
                    onClick={() => {
                      majClasseur({ feuilles: [...classeur.feuilles, D.feuilleVide(D.nomLibre(classeur.feuilles))] });
                      setIFeuille(classeur.feuilles.length);
                    }}
                  >
                    <Icon fafa="faPlus" width={10} />
                  </button>
                </div>
                <span className="clsEspace" />
                {/* Comme Excel : « Nombre » compte les cellules remplies ;
                    moyenne et somme n'apparaissent qu'avec des nombres. */}
                {resume?.remplies ? (
                  <span className="clsResume">
                    {resume.n ? <span>{t("etatMoyenne")} : {(Math.round(resume.moyenne * 100) / 100).toLocaleString("fr-FR")}</span> : null}
                    <span>{t("etatNombre")} : {resume.remplies}</span>
                    {resume.n ? <span>{t("etatSomme")} : <b>{resume.somme.toLocaleString("fr-FR")}</b></span> : null}
                  </span>
                ) : null}
                <div className="clsZoom" aria-label={t("zoom")}>
                  <button type="button" title={t("zoomArriere")} onClick={() => reglerZoom(zoom - 10)}>
                    <Icon fafa="faMinus" width={9} />
                  </button>
                  <input
                    type="range"
                    min={ZOOM_MIN}
                    max={ZOOM_MAX}
                    step={10}
                    value={zoom}
                    aria-label={t("zoom")}
                    onChange={(e) => reglerZoom(Number(e.target.value))}
                  />
                  <button type="button" title={t("zoomAvant")} onClick={() => reglerZoom(zoom + 10)}>
                    <Icon fafa="faPlus" width={9} />
                  </button>
                  <button type="button" className="clsZoomValeur" title={t("zoom100")} onClick={() => setZoom(100)}>
                    {zoom} %
                  </button>
                </div>
              </footer>
            </>
          )}
        </div>
      </div>
    </ModuleWindow>
  );
}

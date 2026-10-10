// Tableur CSV — lire, corriger et comprendre un fichier de données.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUE CETTE APPLICATION APPORTE
//
// Un CSV arrive de partout : l'export de la banque, le fichier du
// fournisseur, la liste de clients d'un ancien logiciel. Jusqu'ici
// CompanyOS savait en produire mais pas en ouvrir : il fallait passer par
// Excel, corriger là-bas, réenregistrer, et espérer que les accents
// survivent.
//
// CE QUI A ÉTÉ PRIS AUX MEILLEURS OUTILS DU DOMAINE
//
// L'application a été conçue en regardant ce dont vit quelqu'un qui
// manipule des CSV toute la journée — VisiData, Modern CSV, Tad, Excel :
//
//   • **Le clavier d'abord.** Flèches pour se déplacer, Entrée pour
//     descendre, Tabulation pour aller à droite, taper remplace la
//     cellule, F2 la corrige, Échap annule. Un tableur où il faut
//     double-cliquer chaque cellule est refusé par quiconque saisit des
//     données : la navigation au clavier n'est pas un raffinement, c'est
//     la condition d'usage.
//   • **La table de fréquences** (le geste signature de VisiData) : sur
//     une colonne inconnue, elle révèle d'un coup les catégories réelles
//     et les fautes de saisie — « Abidjan » et « abidjan » côte à côte.
//   • **Le presse-papiers en TSV**, le format que s'échangent Excel,
//     Sheets et LibreOffice : copier ici et coller là-bas arrive en
//     colonnes, pas dans une seule cellule.
//   • **L'encodage deviné, et rattrapable.** C'est la panne n° 1 des
//     fichiers hérités : un export Windows-1252 lu en UTF-8, et « Côte
//     d'Ivoire » devient « CÃ´te d'Ivoire ». L'application détecte,
//     signale, et propose de réparer.
//   • **Le défilement virtualisé**, comme les visionneuses qui tiennent
//     des millions de lignes : seules les lignes visibles sont dans le
//     DOM.
//
// Les règles d'analyse, d'écriture et de décodage sont dans domaine.js,
// éprouvées seules (75 vérifications).
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { menuContextuel } from "../../menuRequest";
import { saveAs, saveToCloud } from "../../cloud";
import { subscribeVisionneuse } from "../../openRequest";
import { notifier } from "../../notifications";
import { Bouton, Vide } from "../../ui";
import { useTraduction } from "../../../utils/intl";
import * as D from "./domaine";
import "./tableur.scss";
import { manifest as descriptif } from "./manifest";

export const manifest = { ...descriptif, Window: TableurApp };

const DOSSIER = "Tableurs";
const HAUTEUR_LIGNE = 28;
const MARGE_VIRTUELLE = 8;
const TAILLE_MAX = 25 * 1024 * 1024;

const octets = (o) =>
  o >= 1024 ** 2 ? `${Math.round(o / 1024 ** 2)} Mo` : `${Math.round(o / 1024)} Ko`;

const TEXTES = {
  fr: {
    verrou: "Connectez-vous pour ouvrir un fichier CSV.",
    accueilTitre: "Aucun fichier ouvert",
    accueilAide:
      "Déposez un fichier CSV ici, ouvrez-en un depuis l'Explorateur, ou partez d'une grille vierge.",
    ouvrir: "Ouvrir",
    nouveau: "Nouvelle grille",
    enregistrer: "Enregistrer",
    enregistrerSous: "Enregistrer sous",
    annuler: "Annuler (Ctrl+Z)",
    retablir: "Rétablir (Ctrl+Y)",
    rechercher: "Rechercher",
    remplacerPar: "Remplacer par",
    remplacer: "Tout remplacer",
    outils: "Outils",
    separateur: "Séparateur",
    finDeLigne: "Fin de ligne",
    encodage: "Encodage",
    premiereLigneEnTete: "1re ligne = en-têtes",
    lignes: "{n} ligne(s)",
    colonnes: "{n} colonne(s)",
    filtrees: "{n} sur {total}",
    modifie: "Modifié",
    cellule: "Cellule",
    // Encodage
    encodageSuspect: "Accents probablement abîmés",
    encodageSuspectAide:
      "Le fichier contient des suites comme « Ã© » : il a été converti à tort en amont. La réparation retrouve les accents d'origine.",
    reparer: "Réparer les accents",
    reparees: "Accents réparés",
    riposteInutile: "Rien à réparer dans ce fichier.",
    // Menus
    trierCroissant: "Trier de A à Z",
    trierDecroissant: "Trier de Z à A",
    frequences: "Compter les valeurs",
    insererAvant: "Insérer une colonne avant",
    insererApres: "Insérer une colonne après",
    renommerColonne: "Renommer la colonne",
    supprimerColonne: "Supprimer la colonne",
    nouveauNom: "Nouveau nom",
    insererLigneAvant: "Insérer une ligne au-dessus",
    insererLigneApres: "Insérer une ligne en dessous",
    supprimerLigne: "Supprimer la ligne",
    nettoyerEspaces: "Supprimer les espaces en bordure",
    retirerVides: "Supprimer les lignes vides",
    retirerDoublons: "Supprimer les doublons",
    ajouterLigne: "Ajouter une ligne",
    ajouterColonne: "Ajouter une colonne",
    // Panneau fréquences
    freqTitre: "Valeurs de « {col} »",
    freqDistinctes: "{n} valeur(s) distincte(s)",
    freqVides: "{n} vide(s)",
    freqTronquee: "50 plus fréquentes affichées",
    filtrerSurCette: "Filtrer sur cette valeur",
    fermer: "Fermer",
    // Messages
    abandonTitre: "Abandonner les modifications ?",
    abandonMsg: "« {nom} » a été modifié et n'est pas enregistré.",
    abandonOui: "Abandonner",
    ouvertureImpossible: "Ouverture impossible",
    enregistrementImpossible: "Enregistrement impossible",
    enregistre: "Fichier enregistré",
    tropGros: "Ce fichier dépasse {max} : trop volumineux pour être édité ici.",
    remplaceN: "{n} remplacement(s)",
    doublonsRetires: "{n} doublon(s) retiré(s)",
    videsRetirees: "{n} ligne(s) vide(s) retirée(s)",
    rienARetirer: "Rien à retirer.",
    copie: "{n} cellule(s) copiée(s)",
    colle: "Collé",
    collageRefuse: "Le presse-papiers est vide ou inaccessible.",
    // Types
    "type.nombre": "nombre",
    "type.texte": "texte",
    "type.date": "date",
    "type.vide": "vide",
    deposer: "Déposez le fichier CSV",
    aide: "Flèches pour se déplacer · Entrée ou F2 pour corriger · Ctrl+C / Ctrl+V · Ctrl+D recopie vers le bas",
    redimensionner: "Tirer pour élargir · double-clic pour ajuster",
    copier: "Copier {n} cellule(s)",
    collerIci: "Coller ici",
    viderCellules: "Vider les cellules",
    remplirBas: "Recopier vers le bas",
    supprimerLignes: "Supprimer {n} ligne(s)",
    formulePlaceholder: "Valeur, ou =SOMME(A1:A10)",
    raccourcis: "Raccourcis et formules",
    somme: "Somme",
    moyenneCourte: "moyenne",
    nbCellules: "{n} cellules",
    rcDeplacer: "Se déplacer d'une cellule",
    rcEtendre: "Étendre la sélection",
    rcMultiple: "Ajouter une zone à la sélection",
    rcCorriger: "Corriger la cellule",
    rcTaper: "Taper une lettre",
    rcRemplacer: "Remplacer la cellule et saisir",
    rcDroite: "Cellule suivante à droite",
    rcCopier: "Copier / coller (compatible Excel)",
    rcRemplir: "Recopier vers le bas",
    rcAnnuler: "Annuler / rétablir",
    rcEnregistrer: "Enregistrer",
    rcVider: "Vider les cellules choisies",
    rcBords: "Début / fin de ligne",
    formulesAide:
      "Une cellule qui commence par « = » est une formule. Noms français ou anglais, plages A1:A20, et les fonctions du métier : TVA, TTC, HT, REMISE, POURCENT.",
  },
  en: {
    verrou: "Sign in to open a CSV file.",
    accueilTitre: "No file open",
    accueilAide:
      "Drop a CSV file here, open one from the Explorer, or start from a blank grid.",
    ouvrir: "Open",
    nouveau: "New grid",
    enregistrer: "Save",
    enregistrerSous: "Save as",
    annuler: "Undo (Ctrl+Z)",
    retablir: "Redo (Ctrl+Y)",
    rechercher: "Search",
    remplacerPar: "Replace with",
    remplacer: "Replace all",
    outils: "Tools",
    separateur: "Delimiter",
    finDeLigne: "Line ending",
    encodage: "Encoding",
    premiereLigneEnTete: "1st row = headers",
    lignes: "{n} row(s)",
    colonnes: "{n} column(s)",
    filtrees: "{n} of {total}",
    modifie: "Modified",
    cellule: "Cell",
    encodageSuspect: "Accents likely damaged",
    encodageSuspectAide:
      "The file contains sequences like “Ã©”: it was wrongly converted upstream. Repairing restores the original accents.",
    reparer: "Repair accents",
    reparees: "Accents repaired",
    riposteInutile: "Nothing to repair in this file.",
    trierCroissant: "Sort A to Z",
    trierDecroissant: "Sort Z to A",
    frequences: "Count values",
    insererAvant: "Insert column before",
    insererApres: "Insert column after",
    renommerColonne: "Rename column",
    supprimerColonne: "Delete column",
    nouveauNom: "New name",
    insererLigneAvant: "Insert row above",
    insererLigneApres: "Insert row below",
    supprimerLigne: "Delete row",
    nettoyerEspaces: "Trim surrounding spaces",
    retirerVides: "Remove empty rows",
    retirerDoublons: "Remove duplicates",
    ajouterLigne: "Add a row",
    ajouterColonne: "Add a column",
    freqTitre: "Values of “{col}”",
    freqDistinctes: "{n} distinct value(s)",
    freqVides: "{n} empty",
    freqTronquee: "Showing the 50 most frequent",
    filtrerSurCette: "Filter on this value",
    fermer: "Close",
    abandonTitre: "Discard changes?",
    abandonMsg: "“{nom}” has been modified and is not saved.",
    abandonOui: "Discard",
    ouvertureImpossible: "Could not open",
    enregistrementImpossible: "Could not save",
    enregistre: "File saved",
    tropGros: "This file is over {max}: too large to edit here.",
    remplaceN: "{n} replacement(s)",
    doublonsRetires: "{n} duplicate(s) removed",
    videsRetirees: "{n} empty row(s) removed",
    rienARetirer: "Nothing to remove.",
    copie: "{n} cell(s) copied",
    colle: "Pasted",
    collageRefuse: "The clipboard is empty or unavailable.",
    "type.nombre": "number",
    "type.texte": "text",
    "type.date": "date",
    "type.vide": "empty",
    deposer: "Drop the CSV file",
    aide: "Arrows to move · Enter or F2 to edit · Ctrl+C / Ctrl+V · Ctrl+D fills down",
    redimensionner: "Drag to widen · double-click to fit",
    copier: "Copy {n} cell(s)",
    collerIci: "Paste here",
    viderCellules: "Clear cells",
    remplirBas: "Fill down",
    supprimerLignes: "Delete {n} row(s)",
    formulePlaceholder: "Value, or =SUM(A1:A10)",
    raccourcis: "Shortcuts and formulas",
    somme: "Sum",
    moyenneCourte: "average",
    nbCellules: "{n} cells",
    rcDeplacer: "Move one cell",
    rcEtendre: "Extend the selection",
    rcMultiple: "Add a range to the selection",
    rcCorriger: "Edit the cell",
    rcTaper: "Type a letter",
    rcRemplacer: "Replace the cell and type",
    rcDroite: "Next cell to the right",
    rcCopier: "Copy / paste (Excel-compatible)",
    rcRemplir: "Fill down",
    rcAnnuler: "Undo / redo",
    rcEnregistrer: "Save",
    rcVider: "Clear the selected cells",
    rcBords: "Start / end of row",
    formulesAide:
      "A cell starting with “=” is a formula. French or English names, A1:A20 ranges, and the business functions: VAT, GROSS, NET, DISCOUNT, PERCENT.",
  },
};

function TableurApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const t = useTraduction(TEXTES);

  // Document
  const [grille, setGrille] = useState(null);
  const [octetsSource, setOctetsSource] = useState(null); // pour re-décoder
  const [fichier, setFichier] = useState(null);
  const [nom, setNom] = useState("");
  const [separateur, setSeparateur] = useState(";");
  const [finDeLigne, setFinDeLigne] = useState("crlf");
  const [encodage, setEncodage] = useState("utf-8");
  const [suspect, setSuspect] = useState(false);
  const [avecEnTete, setAvecEnTete] = useState(true);
  const [modifie, setModifie] = useState(false);
  const [historique, setHistorique] = useState({ passe: [], futur: [] });

  // Interface
  const [sel, setSel] = useState({ l: 0, c: 0, l2: 0, c2: 0 });
  /// Sélections **additionnelles**, ajoutées au Ctrl+clic. La sélection
  /// courante (`sel`) reste à part : c'est elle que le clavier déplace.
  const [plages, setPlages] = useState([]);
  const [largeurs, setLargeurs] = useState({}); // { indexColonne: px }
  const [redim, setRedim] = useState(null); // { c, x0, l0 }
  /// Vrai tant que le bouton reste enfoncé après un clic sur une cellule :
  /// c'est ce qui permet de balayer une plage à la souris.
  const [glisse, setGlisse] = useState(false);
  const [aide, setAide] = useState(false);
  const [edition, setEdition] = useState(null); // { l, c, valeur }
  const [recherche, setRecherche] = useState("");
  const [remplacement, setRemplacement] = useState("");
  const [freqCol, setFreqCol] = useState(null);
  const [depot, setDepot] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [defilement, setDefilement] = useState(0);
  const [hauteurVue, setHauteurVue] = useState(400);

  const grilleRef = useRef(null);
  const fichierRef = useRef(null);

  // ---- Découpage en-tête / corps ------------------------------------------

  const largeur = grille?.[0]?.length || 0;
  const enTetes = useMemo(() => {
    if (!grille) return [];
    return avecEnTete && grille.length
      ? grille[0].map((v, i) => String(v).trim() || D.repereColonne(i))
      : Array.from({ length: largeur }, (_, i) => D.repereColonne(i));
  }, [grille, avecEnTete, largeur]);

  const corps = useMemo(
    () => (grille ? (avecEnTete ? grille.slice(1) : grille) : []),
    [grille, avecEnTete],
  );
  const decalage = avecEnTete ? 1 : 0;

  const visibles = useMemo(() => D.chercher(corps, recherche), [corps, recherche]);

  /// Les valeurs **affichées** : une formule montre son résultat, jamais
  /// son texte. Recalculé seulement s'il y a des formules — sur un fichier
  /// ordinaire, ce passage ne coûte rien.
  const affichees = useMemo(
    () => (D.contientFormules(corps) ? D.calculerTout(corps) : corps),
    [corps],
  );
  const profils = useMemo(() => D.profiler(affichees, largeur), [affichees, largeur]);
  const freq = useMemo(
    () => (freqCol === null ? null : D.frequences(corps, freqCol)),
    [corps, freqCol],
  );

  // ---- Modification avec historique ---------------------------------------

  const appliquer = useCallback(
    (suivante) => {
      setHistorique((h) => D.empiler(h, grille));
      setGrille(suivante);
      setModifie(true);
    },
    [grille],
  );

  const majCorps = useCallback(
    (nouveauCorps) => appliquer(avecEnTete && grille ? [grille[0], ...nouveauCorps] : nouveauCorps),
    [appliquer, avecEnTete, grille],
  );

  const faireAnnuler = useCallback(() => {
    const { historique: h, etat } = D.annuler(historique, grille);
    setHistorique(h);
    setGrille(etat);
    setModifie(true);
  }, [historique, grille]);

  const faireRetablir = useCallback(() => {
    const { historique: h, etat } = D.retablir(historique, grille);
    setHistorique(h);
    setGrille(etat);
    setModifie(true);
  }, [historique, grille]);

  // ---- Ouverture ----------------------------------------------------------

  const confirmerAbandon = useCallback(async () => {
    if (!modifie) return true;
    return modal.confirm({
      title: t("abandonTitre"),
      message: t("abandonMsg", { nom: nom || "—" }),
      confirmLabel: t("abandonOui"),
      danger: true,
    });
  }, [modifie, nom, t]);

  const monter = useCallback((texte, nomFichier, noeud, brut, enc, susp) => {
    const r = D.analyser(texte);
    setGrille(r.grille.length ? r.grille : [D.ligneVide(3)]);
    setSeparateur(r.separateur);
    setFinDeLigne(r.finDeLigne);
    setAvecEnTete(D.semblEnTete(r.grille));
    setNom(nomFichier);
    setFichier(noeud);
    setOctetsSource(brut);
    setEncodage(enc);
    setSuspect(susp);
    setModifie(false);
    setHistorique({ passe: [], futur: [] });
    setSel({ l: 0, c: 0, l2: 0, c2: 0 });
    setFreqCol(null);
    setRecherche("");
    setDefilement(0);
    if (grilleRef.current) grilleRef.current.scrollTop = 0;
  }, []);

  const ouvrirBlob = useCallback(
    async (blob, nomFichier, noeud = null) => {
      if (blob.size > TAILLE_MAX) {
        return modal.alert({
          title: t("ouvertureImpossible"),
          message: t("tropGros", { max: octets(TAILLE_MAX) }),
          tone: "error",
        });
      }
      const brut = new Uint8Array(await blob.arrayBuffer());
      const { texte, encodage: enc, suspect: susp } = D.decoder(brut);
      monter(texte, nomFichier, noeud, brut, enc, susp);
    },
    [monter, t],
  );

  /// Changer d'encodage relit les **octets d'origine** : décoder à
  /// nouveau le texte déjà décodé ne rattraperait rien.
  const changerEncodage = (enc) => {
    if (!octetsSource) return;
    setEncodage(enc);
    const r = D.analyser(D.decoderAvec(octetsSource, enc));
    setHistorique((h) => D.empiler(h, grille));
    setGrille(r.grille);
    setSuspect(false);
  };

  const reparerAccents = () => {
    const repare = grille.map((l) => l.map((c) => D.reparerMojibake(String(c ?? ""))));
    if (JSON.stringify(repare) === JSON.stringify(grille)) {
      return notifier({ titre: t("riposteInutile"), app: manifest.name });
    }
    appliquer(repare);
    setSuspect(false);
    notifier({ titre: t("reparees"), app: manifest.name, ton: "success" });
  };

  const ouvrirNoeud = useCallback(
    async (node) => {
      if (!(await confirmerAbandon())) return;
      try {
        const url = await api.streamUrl(node.id);
        const rep = await fetch(url);
        if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
        await ouvrirBlob(await rep.blob(), node.name, node);
      } catch (e) {
        modal.alert({ title: t("ouvertureImpossible"), message: e.message, tone: "error" });
      }
    },
    [confirmerAbandon, ouvrirBlob, t],
  );

  const ouvrirNoeudRef = useRef(ouvrirNoeud);
  ouvrirNoeudRef.current = ouvrirNoeud;
  useEffect(
    () =>
      subscribeVisionneuse(manifest.action, (charge) => {
        if (charge?.node) ouvrirNoeudRef.current(charge.node);
      }),
    [],
  );

  const choisirFichier = async (f) => {
    if (!f) return;
    if (!(await confirmerAbandon())) return;
    try {
      await ouvrirBlob(f, f.name);
    } catch (e) {
      modal.alert({ title: t("ouvertureImpossible"), message: e.message, tone: "error" });
    }
  };

  const nouveau = async () => {
    if (!(await confirmerAbandon())) return;
    monter("", "sans-titre.csv", null, null, "utf-8", false);
    setGrille([["A", "B", "C"], D.ligneVide(3), D.ligneVide(3)]);
    setAvecEnTete(true);
  };

  // ---- Enregistrement -----------------------------------------------------

  /// Le fichier écrit porte les **résultats**, pas les formules.
  ///
  /// Deux raisons. Le CSV ne connaît pas la notion de formule : un
  /// destinataire lirait « =A1*2 » comme du texte. Et surtout, un champ
  /// commençant par « = » est le vecteur classique d'injection de formule
  /// — ouvert dans un tableur, il s'exécute. On n'expédie pas ça à un
  /// comptable ou à une banque.
  const contenu = () => {
    if (!grille) return "";
    const corpsCalcule = D.contientFormules(corps) ? D.calculerTout(corps) : corps;
    const sortie = avecEnTete ? [grille[0], ...corpsCalcule] : corpsCalcule;
    return D.ecrire(sortie, { separateur, finDeLigne, bom: true });
  };

  const enregistrer = async () => {
    if (!grille) return;
    setOccupe(true);
    try {
      const blob = new Blob([contenu()], { type: "text/csv;charset=utf-8" });
      if (fichier) {
        const maj = await api.updateFileContent(
          fichier.id,
          new File([blob], nom, { type: "text/csv" }),
          fichier.updatedAt,
        );
        setFichier(maj);
      } else {
        const noeud = await saveToCloud(blob, nom || "sans-titre.csv", { folder: DOSSIER });
        setFichier(noeud);
        setNom(noeud.name);
      }
      setModifie(false);
      notifier({ titre: t("enregistre"), message: nom, app: manifest.name, ton: "success" });
    } catch (e) {
      modal.alert({ title: t("enregistrementImpossible"), message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  useEffect(() => {
    if (!modifie) return undefined;
    const proteger = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", proteger);
    return () => window.removeEventListener("beforeunload", proteger);
  }, [modifie]);

  const enregistrerSous = async () => {
    if (!grille) return;
    setOccupe(true);
    try {
      const blob = new Blob([contenu()], { type: "text/csv;charset=utf-8" });
      const noeud = await saveAs(blob, nom || "sans-titre.csv", { folder: DOSSIER });
      if (noeud) {
        setFichier(noeud);
        setNom(noeud.name);
        setModifie(false);
        notifier({ titre: t("enregistre"), message: noeud.name, app: manifest.name, ton: "success" });
      }
    } catch (e) {
      modal.alert({ title: t("enregistrementImpossible"), message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  // ---- Sélection et clavier ------------------------------------------------

  const nbLignes = visibles.length;

  /// Amène la cellule choisie dans le cadre : sans cela, la navigation au
  /// clavier sort de l'écran dès la vingtième ligne, la virtualisation ne
  /// rendant que ce qui est visible.
  const suivreSelection = useCallback((rang) => {
    const el = grilleRef.current;
    if (!el) return;
    const haut = rang * HAUTEUR_LIGNE;
    const bas = haut + HAUTEUR_LIGNE;
    const vueHaut = el.scrollTop;
    const vueBas = vueHaut + el.clientHeight - HAUTEUR_LIGNE * 2;
    if (haut < vueHaut) el.scrollTop = haut;
    else if (bas > vueBas) el.scrollTop = bas - el.clientHeight + HAUTEUR_LIGNE * 2;
  }, []);

  const deplacer = useCallback(
    (dl, dc, etendre = false) => {
      setSel((s) => {
        const l = Math.max(0, Math.min(nbLignes - 1, (etendre ? s.l2 : s.l) + dl));
        const c = Math.max(0, Math.min(largeur - 1, (etendre ? s.c2 : s.c) + dc));
        suivreSelection(l);
        return etendre ? { ...s, l2: l, c2: c } : { l, c, l2: l, c2: c };
      });
    },
    [nbLignes, largeur, suivreSelection],
  );

  /// Les indices d'une sélection, ramenés aux indices de la **grille**
  /// (en-tête compris) et à travers le filtre de recherche.
  /// `s` permet de passer une sélection **explicite** : après un
  /// `setSel`, l'état n'est pas encore rafraîchi dans la closure, et lire
  /// `sel` donnerait la plage d'avant — un menu contextuel construit là
  /// annoncerait « copier 9 cellules » pour une seule cellule visée.
  const plageGrille = useCallback(
    (s = sel) => {
      const l1 = (visibles[Math.min(s.l, s.l2)] ?? 0) + decalage;
      const l2 = (visibles[Math.max(s.l, s.l2)] ?? 0) + decalage;
      return { l1, c1: Math.min(s.c, s.c2), l2, c2: Math.max(s.c, s.c2) };
    },
    [sel, visibles, decalage],
  );

  const copier = useCallback(async (selection) => {
    const p = plageGrille(selection);
    const texte = D.versTSV(grille, p);
    try {
      await navigator.clipboard.writeText(texte);
      const n = (Math.abs(p.l2 - p.l1) + 1) * (Math.abs(p.c2 - p.c1) + 1);
      notifier({ titre: t("copie", { n }), app: manifest.name });
    } catch {
      /* le presse-papiers peut être refusé : on n'insiste pas */
    }
  }, [grille, plageGrille, t]);

  const collerDepuisPressePapiers = useCallback(async (selection) => {
    try {
      const texte = await navigator.clipboard.readText();
      if (!texte) throw new Error("vide");
      const p = plageGrille(selection);
      appliquer(D.coller(grille, D.depuisTSV(texte), p.l1, p.c1));
      notifier({ titre: t("colle"), app: manifest.name, ton: "success" });
    } catch {
      notifier({ titre: t("collageRefuse"), app: manifest.name, ton: "warning" });
    }
  }, [grille, plageGrille, appliquer, t]);

  const auClavier = useCallback(
    (e) => {
      if (!grille || edition) return;
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl) {
        const k = e.key.toLowerCase();
        if (k === "z") { e.preventDefault(); return faireAnnuler(); }
        if (k === "y") { e.preventDefault(); return faireRetablir(); }
        if (k === "c") { e.preventDefault(); return copier(); }
        if (k === "v") { e.preventDefault(); return collerDepuisPressePapiers(); }
        if (k === "d") { e.preventDefault(); return appliquer(D.remplirVersLeBas(grille, plageGrille())); }
        if (k === "s") { e.preventDefault(); return enregistrer(); }
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
        case "End": e.preventDefault(); return setSel((s) => ({ ...s, c: largeur - 1, c2: largeur - 1 }));
        case "Tab": e.preventDefault(); return deplacer(0, e.shiftKey ? -1 : 1);
        case "Enter":
        case "F2": {
          e.preventDefault();
          const rang = visibles[sel.l];
          if (rang !== undefined) setEdition({ l: rang, c: sel.c, valeur: corps[rang][sel.c] });
          return;
        }
        case "Delete":
        case "Backspace": {
          e.preventDefault();
          const p = plageGrille();
          let g = grille;
          for (let i = p.l1; i <= p.l2; i += 1)
            for (let j = p.c1; j <= p.c2; j += 1) g = D.poserCellule(g, i, j, "");
          return appliquer(g);
        }
        default:
          break;
      }

      // Taper une lettre remplace la cellule et ouvre la saisie — le
      // réflexe d'un tableur, et ce qui rend la saisie continue possible.
      if (e.key.length === 1 && !e.altKey) {
        const rang = visibles[sel.l];
        if (rang !== undefined) {
          e.preventDefault();
          setEdition({ l: rang, c: sel.c, valeur: e.key });
        }
      }
    },
    [grille, edition, sel, visibles, corps, largeur, deplacer, faireAnnuler, faireRetablir,
     copier, collerDepuisPressePapiers, appliquer, plageGrille, enregistrer],
  );

  const validerEdition = (valeur, avancer) => {
    if (edition && valeur !== corps[edition.l]?.[edition.c]) {
      appliquer(D.poserCellule(grille, edition.l + decalage, edition.c, valeur));
    }
    setEdition(null);
    if (avancer) deplacer(1, 0);
    grilleRef.current?.focus();
  };

  // ---- Menus contextuels --------------------------------------------------

  const menuColonne = (c) => (e) =>
    menuContextuel(e, [
      { nom: t("trierCroissant"), icone: "faArrowDownAZ", action: () => majCorps(D.trier(corps, c, true)) },
      { nom: t("trierDecroissant"), icone: "faArrowUpAZ", action: () => majCorps(D.trier(corps, c, false)) },
      { nom: t("frequences"), icone: "faChartSimple", action: () => setFreqCol(c) },
      { separateur: true },
      { nom: t("insererAvant"), icone: "faTableColumns", action: () => appliquer(D.insererColonne(grille, c)) },
      { nom: t("insererApres"), icone: "faTableColumns", action: () => appliquer(D.insererColonne(grille, c + 1)) },
      ...(avecEnTete
        ? [{
            nom: t("renommerColonne"),
            icone: "faPen",
            action: async () => {
              const v = await modal.prompt({
                title: t("renommerColonne"),
                label: t("nouveauNom"),
                value: enTetes[c],
                confirmLabel: t("renommerColonne"),
              });
              if (v) appliquer(D.poserCellule(grille, 0, c, v));
            },
          }]
        : []),
      { separateur: true },
      {
        nom: t("supprimerColonne"),
        icone: "faTrashCan",
        danger: true,
        desactive: largeur <= 1,
        action: () => appliquer(D.supprimerColonne(grille, c)),
      },
    ]);

  const menuLigne = (rang) => (e) => {
    const i = rang + decalage;
    menuContextuel(e, [
      { nom: t("insererLigneAvant"), icone: "faPlus", action: () => appliquer(D.insererLigne(grille, i, largeur)) },
      { nom: t("insererLigneApres"), icone: "faPlus", action: () => appliquer(D.insererLigne(grille, i + 1, largeur)) },
      { separateur: true },
      { nom: t("supprimerLigne"), icone: "faTrashCan", danger: true, action: () => appliquer(D.supprimerLigne(grille, i)) },
    ]);
  };

  /// Menu d'une cellule. Le clic droit **conserve** la sélection en cours
  /// si on vise dedans — on prépare une plage puis on la copie, et la
  /// perdre au dernier geste serait exaspérant. Viser hors de la plage
  /// sélectionne d'abord la cellule visée, comme partout ailleurs.
  const menuCellule = (indexVisible, c, rang) => (e) => {
    const courante = selRef.current;
    const dedans = dansUne(courante, indexVisible, c);
    const cible = dedans ? courante : { l: indexVisible, c, l2: indexVisible, c2: c };
    if (!dedans) setSel(cible);

    const p = plageGrille(cible);
    const combien = (Math.abs(p.l2 - p.l1) + 1) * (Math.abs(p.c2 - p.c1) + 1);

    menuContextuel(e, [
      { nom: t("copier", { n: combien }), icone: "faCopy", action: () => copier(cible) },
      { nom: t("collerIci"), icone: "faPaste", action: () => collerDepuisPressePapiers(cible) },
      { nom: t("viderCellules"), icone: "faEraser", action: () => {
          let g = grille;
          for (let i = p.l1; i <= p.l2; i += 1)
            for (let j = p.c1; j <= p.c2; j += 1) g = D.poserCellule(g, i, j, "");
          appliquer(g);
        } },
      { separateur: true },
      { nom: t("remplirBas"), icone: "faArrowDown", desactive: p.l1 === p.l2,
        action: () => appliquer(D.remplirVersLeBas(grille, p)) },
      { separateur: true },
      { nom: t("insererLigneAvant"), icone: "faPlus",
        action: () => appliquer(D.insererLigne(grille, p.l1, largeur)) },
      { nom: t("supprimerLignes", { n: p.l2 - p.l1 + 1 }), icone: "faTrashCan", danger: true,
        action: () => {
          let g = grille;
          for (let i = p.l2; i >= p.l1; i -= 1) g = D.supprimerLigne(g, i);
          appliquer(g);
        } },
      { separateur: true },
      { nom: t("frequences"), icone: "faChartSimple", action: () => setFreqCol(c) },
    ]);
  };

  const menuOutils = (e) =>
    menuContextuel(e, [
      { nom: t("nettoyerEspaces"), icone: "faBroom", action: () => appliquer(D.nettoyerEspaces(grille)) },
      {
        nom: t("retirerVides"),
        icone: "faEraser",
        action: () => {
          const net = D.retirerLignesVides(corps);
          const n = corps.length - net.length;
          if (!n) return notifier({ titre: t("rienARetirer"), app: manifest.name });
          majCorps(net);
          notifier({ titre: t("videsRetirees", { n }), app: manifest.name, ton: "success" });
        },
      },
      {
        nom: t("retirerDoublons"),
        icone: "faClone",
        action: () => {
          const { lignes, retires } = D.retirerDoublons(corps);
          if (!retires) return notifier({ titre: t("rienARetirer"), app: manifest.name });
          majCorps(lignes);
          notifier({ titre: t("doublonsRetires", { n: retires }), app: manifest.name, ton: "success" });
        },
      },
      { separateur: true },
      { nom: t("ajouterLigne"), icone: "faPlus", action: () => appliquer([...grille, D.ligneVide(largeur)]) },
      { nom: t("ajouterColonne"), icone: "faPlus", action: () => appliquer(D.insererColonne(grille, largeur)) },
    ]);

  const faireRemplacer = () => {
    if (!recherche) return;
    const { grille: g, n } = D.remplacer(grille, recherche, remplacement);
    if (!n) return notifier({ titre: t("remplaceN", { n: 0 }), app: manifest.name });
    appliquer(g);
    notifier({ titre: t("remplaceN", { n }), app: manifest.name, ton: "success" });
  };

  // ---- Virtualisation -----------------------------------------------------

  useEffect(() => {
    const el = grilleRef.current;
    if (!el) return undefined;
    const mesurer = () => setHauteurVue(el.clientHeight || 400);
    mesurer();
    const obs = new ResizeObserver(mesurer);
    obs.observe(el);
    return () => obs.disconnect();
  }, [grille]);

  const debut = Math.max(0, Math.floor(defilement / HAUTEUR_LIGNE) - MARGE_VIRTUELLE);
  const fin = Math.min(nbLignes, Math.ceil((defilement + hauteurVue) / HAUTEUR_LIGNE) + MARGE_VIRTUELLE);
  const fenetre = visibles.slice(debut, fin);

  /// La sélection, lisible depuis n'importe quel gestionnaire d'événement.
  ///
  /// Un menu contextuel se construit à partir d'une fonction créée au
  /// rendu : si la sélection a changé depuis, la closure porte l'ancienne
  /// et le menu annonce « copier 1 cellule » alors que neuf sont
  /// sélectionnées. Une référence, elle, porte toujours la valeur du
  /// moment.
  const selRef = useRef(sel);
  selRef.current = sel;

  const dansUne = (p, rang, c) =>
    rang >= Math.min(p.l, p.l2) && rang <= Math.max(p.l, p.l2) &&
    c >= Math.min(p.c, p.c2) && c <= Math.max(p.c, p.c2);

  const dansSelection = (rang, c) =>
    dansUne(sel, rang, c) || plages.some((p) => dansUne(p, rang, c));

  /// Somme, moyenne et compte de tout ce qui est sélectionné — la barre
  /// d'état d'un tableur, qu'on regarde plus souvent qu'on ne l'avoue.
  const resumeSelection = useMemo(() => {
    const nombres = [];
    let cellules = 0;
    for (const p of [sel, ...plages]) {
      for (let l = Math.min(p.l, p.l2); l <= Math.max(p.l, p.l2); l += 1) {
        for (let c = Math.min(p.c, p.c2); c <= Math.max(p.c, p.c2); c += 1) {
          const rang = visibles[l];
          if (rang === undefined) continue;
          cellules += 1;
          const v = D.versNombre(affichees[rang]?.[c]);
          if (v !== null) nombres.push(v);
        }
      }
    }
    if (cellules < 2 || !nombres.length) return null;
    const somme = nombres.reduce((s, n) => s + n, 0);
    return { cellules, n: nombres.length, somme, moyenne: somme / nombres.length };
  }, [sel, plages, visibles, affichees]);

  // ---- Redimensionnement des colonnes -------------------------------------

  /// La largeur se règle à la souris, comme partout ailleurs. On écoute au
  /// niveau du document : le pointeur sort forcément de la poignée, large
  /// de quelques pixels, dès qu'on tire un peu vite.
  useEffect(() => {
    if (!redim) return undefined;
    const bouger = (e) => {
      const px = Math.max(60, redim.l0 + (e.clientX - redim.x0));
      setLargeurs((w) => ({ ...w, [redim.c]: px }));
    };
    const lacher = () => setRedim(null);
    document.addEventListener("mousemove", bouger);
    document.addEventListener("mouseup", lacher);
    return () => {
      document.removeEventListener("mousemove", bouger);
      document.removeEventListener("mouseup", lacher);
    };
  }, [redim]);

  /// Le balayage s'arrête où que le bouton soit relâché — y compris hors
  /// de la grille, ce qui arrive dès qu'on tire un peu vite.
  useEffect(() => {
    if (!glisse) return undefined;
    const lacher = () => setGlisse(false);
    document.addEventListener("mouseup", lacher);
    return () => document.removeEventListener("mouseup", lacher);
  }, [glisse]);

  /// Double-cliquer la poignée ajuste la colonne à son contenu.
  const ajusterColonne = (c) => {
    const echantillon = affichees.slice(0, 200).map((l) => String(l[c] ?? "").length);
    const max = Math.max(String(enTetes[c] ?? "").length, ...echantillon, 4);
    setLargeurs((w) => ({ ...w, [c]: Math.min(420, 28 + max * 7.2) }));
  };

  // ---- Rendu --------------------------------------------------------------

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="tblApp">
        <div className="tblVerrou">{t("verrou")}</div>
      </ModuleWindow>
    );
  }

  return (
    <ModuleWindow manifest={manifest} className="tblApp">
      <div
        className="tblShell"
        onDragOver={(e) => { e.preventDefault(); setDepot(true); }}
        onDragLeave={() => setDepot(false)}
        onDrop={(e) => { e.preventDefault(); setDepot(false); choisirFichier(e.dataTransfer?.files?.[0]); }}
      >
        <input
          ref={fichierRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          hidden
          onChange={(e) => { choisirFichier(e.target.files?.[0]); e.target.value = ""; }}
        />

        <div className="tblBarre">
          <Bouton variante="secondaire" icone="faFolderOpen" onClick={() => fichierRef.current?.click()}>
            {t("ouvrir")}
          </Bouton>
          <Bouton variante="secondaire" icone="faFileCirclePlus" onClick={nouveau}>
            {t("nouveau")}
          </Bouton>

          {grille ? (
            <>
              <span className="tblSep" />
              <button className="tblIcone" title={t("annuler")} disabled={!historique.passe.length} onClick={faireAnnuler}>
                <Icon fafa="faRotateLeft" width={13} />
              </button>
              <button className="tblIcone" title={t("retablir")} disabled={!historique.futur.length} onClick={faireRetablir}>
                <Icon fafa="faRotateRight" width={13} />
              </button>
              <button className="tblIcone" title={t("outils")} onClick={menuOutils}>
                <Icon fafa="faWandMagicSparkles" width={13} />
              </button>

              <span className="tblSep" />
              <div className="tblChercher">
                <Icon fafa="faMagnifyingGlass" width={11} />
                <input value={recherche} placeholder={t("rechercher")} onChange={(e) => setRecherche(e.target.value)} />
              </div>
              <input
                className="tblRemplacer"
                value={remplacement}
                placeholder={t("remplacerPar")}
                onChange={(e) => setRemplacement(e.target.value)}
              />
              <button className="tblIcone" title={t("remplacer")} disabled={!recherche} onClick={faireRemplacer}>
                <Icon fafa="faRightLeft" width={13} />
              </button>

              <span className="tblEspace" />
              <Bouton icone="faFloppyDisk" off={occupe || !modifie} onClick={enregistrer}>
                {t("enregistrer")}
              </Bouton>
              <button className="tblIcone" title={t("enregistrerSous")} onClick={enregistrerSous}>
                <Icon fafa="faFileExport" width={13} />
              </button>
            </>
          ) : null}
        </div>

        {grille ? (
          <>
            {suspect ? (
              <div className="tblAlerte">
                <Icon fafa="faTriangleExclamation" width={14} />
                <div>
                  <b>{t("encodageSuspect")}</b>
                  <span>{t("encodageSuspectAide")}</span>
                </div>
                <Bouton variante="secondaire" icone="faWandMagicSparkles" onClick={reparerAccents}>
                  {t("reparer")}
                </Bouton>
              </div>
            ) : null}

            <div className="tblReglages">
              <label>
                {t("separateur")}
                <select value={separateur} onChange={(e) => { setSeparateur(e.target.value); setModifie(true); }}>
                  {D.SEPARATEURS.map((s) => <option key={s.car} value={s.car}>{s.nom}</option>)}
                </select>
              </label>
              <label>
                {t("encodage")}
                <select value={encodage} onChange={(e) => changerEncodage(e.target.value)} disabled={!octetsSource}>
                  {D.ENCODAGES.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
                </select>
              </label>
              <label>
                {t("finDeLigne")}
                <select value={finDeLigne} onChange={(e) => { setFinDeLigne(e.target.value); setModifie(true); }}>
                  {D.FINS_DE_LIGNE.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
                </select>
              </label>
              <label className="tblCase">
                <input type="checkbox" checked={avecEnTete} onChange={(e) => setAvecEnTete(e.target.checked)} />
                {t("premiereLigneEnTete")}
              </label>
              <span className="tblEspace" />
              <span className="tblCompte">
                {recherche ? t("filtrees", { n: nbLignes, total: corps.length }) : t("lignes", { n: corps.length })}
                {" · "}{t("colonnes", { n: largeur })}
                {" · "}{t("cellule")} {D.repereColonne(sel.c)}{sel.l + 1}
                {modifie ? <em className="tblModifie"> · {t("modifie")}</em> : null}
              </span>
            </div>

            {/* Barre de formule : elle montre le **contenu réel** de la
                cellule active — « =SOMME(A1:A9) » et non son résultat —
                et permet de le corriger sans entrer dans la grille. */}
            <div className="tblFormule">
              <span className="tblRefActive">
                {D.repereColonne(sel.c)}{(visibles[sel.l] ?? 0) + 1}
              </span>
              <Icon fafa="faFunction" width={11} />
              <input
                key={`${sel.l}:${sel.c}:${visibles[sel.l]}`}
                defaultValue={corps[visibles[sel.l]]?.[sel.c] ?? ""}
                placeholder={t("formulePlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const rang = visibles[sel.l];
                    if (rang !== undefined) {
                      appliquer(D.poserCellule(grille, rang + decalage, sel.c, e.currentTarget.value));
                    }
                    grilleRef.current?.focus();
                  }
                  if (e.key === "Escape") grilleRef.current?.focus();
                }}
              />
              <button className="tblIcone" title={t("raccourcis")} onClick={() => setAide((v) => !v)}>
                <Icon fafa="faKeyboard" width={13} />
              </button>
            </div>

            <div className="tblZone">
              <div
                className="tblGrille"
                ref={grilleRef}
                tabIndex={0}
                onKeyDown={auClavier}
                onScroll={(e) => setDefilement(e.currentTarget.scrollTop)}
              >
                <table>
                  <thead>
                    <tr>
                      <th className="tblNum" />
                      {enTetes.map((h, c) => (
                        <th
                          key={c}
                          style={largeurs[c] ? { width: largeurs[c], minWidth: largeurs[c], maxWidth: largeurs[c] } : undefined}
                          data-actif={c >= Math.min(sel.c, sel.c2) && c <= Math.max(sel.c, sel.c2)}
                          onClick={menuColonne(c)}
                          onContextMenu={menuColonne(c)}
                          title={h}
                        >
                          <span className="tblRepere">{D.repereColonne(c)}</span>
                          <span className="tblNomCol">{h}</span>
                          <span className="tblType" data-type={profils[c]?.type}>
                            {t(`type.${profils[c]?.type || "vide"}`)}
                          </span>
                          {/* Poignée de largeur. Elle arrête la propagation :
                              tirer une colonne ne doit pas ouvrir son menu. */}
                          <span
                            className="tblPoignee"
                            title={t("redimensionner")}
                            onClick={(e) => e.stopPropagation()}
                            onContextMenu={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => { e.stopPropagation(); ajusterColonne(c); }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setRedim({
                                c,
                                x0: e.clientX,
                                l0: largeurs[c] || e.currentTarget.parentElement.offsetWidth,
                              });
                            }}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {debut > 0 ? (
                      <tr style={{ height: debut * HAUTEUR_LIGNE }}><td colSpan={largeur + 1} /></tr>
                    ) : null}
                    {fenetre.map((rang, i) => {
                      const indexVisible = debut + i;
                      return (
                        <tr key={rang}>
                          <th className="tblNum" onClick={menuLigne(rang)} onContextMenu={menuLigne(rang)}>
                            {rang + 1}
                          </th>
                          {corps[rang].map((valeur, c) => {
                            const enEdition = edition && edition.l === rang && edition.c === c;
                            const affichee = affichees[rang]?.[c] ?? valeur;
                            const formule = D.estFormule(valeur);
                            return (
                              <td
                                key={c}
                                style={largeurs[c] ? { width: largeurs[c], minWidth: largeurs[c], maxWidth: largeurs[c] } : undefined}
                                data-num={profils[c]?.type === "nombre" || undefined}
                                data-sel={dansSelection(indexVisible, c) || undefined}
                                data-formule={formule || undefined}
                                data-erreur={String(affichee).startsWith("#") || undefined}
                                onMouseDown={(e) => {
                                  // Le clic droit ne déplace rien : c'est
                                  // le menu qui décide, en respectant la
                                  // sélection déjà faite.
                                  if (e.button === 2) return;
                                  // Ctrl+clic ajoute une zone au lieu de
                                  // remplacer : on compare deux paquets de
                                  // lignes éloignés sans les rapprocher.
                                  if (e.ctrlKey || e.metaKey) {
                                    setPlages((p) => [...p, sel]);
                                  } else if (e.shiftKey) {
                                    return setSel((s) => ({ ...s, l2: indexVisible, c2: c }));
                                  } else {
                                    setPlages([]);
                                  }
                                  setSel({ l: indexVisible, c, l2: indexVisible, c2: c });
                                  setGlisse(true);
                                  grilleRef.current?.focus();
                                }}
                                // Balayage : tant que le bouton est tenu,
                                // survoler une cellule étend la plage.
                                //
                                // `onMouseOver` et non `onMouseEnter` :
                                // React *synthétise* le second à partir
                                // des paires mouseout/mouseover, alors que
                                // le premier suit l'événement natif — plus
                                // direct, et plus sûr.
                                onMouseOver={() => {
                                  if (glisse) setSel((s) => ({ ...s, l2: indexVisible, c2: c }));
                                }}
                                onContextMenu={menuCellule(indexVisible, c, rang)}
                                onDoubleClick={() => setEdition({ l: rang, c, valeur })}
                              >
                                {enEdition ? (
                                  <input
                                    autoFocus
                                    defaultValue={edition.valeur}
                                    onFocus={(e) => e.currentTarget.select()}
                                    onBlur={(e) => validerEdition(e.target.value, false)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") { e.preventDefault(); validerEdition(e.currentTarget.value, true); }
                                      if (e.key === "Tab") { e.preventDefault(); validerEdition(e.currentTarget.value, false); deplacer(0, 1); }
                                      if (e.key === "Escape") { e.preventDefault(); setEdition(null); grilleRef.current?.focus(); }
                                    }}
                                  />
                                ) : (
                                  <span>{affichee}</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    {fin < nbLignes ? (
                      <tr style={{ height: (nbLignes - fin) * HAUTEUR_LIGNE }}><td colSpan={largeur + 1} /></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {freq ? (
                <aside className="tblFreq">
                  <header>
                    <b>{t("freqTitre", { col: enTetes[freqCol] })}</b>
                    <span className="tblFermer handcr" onClick={() => setFreqCol(null)} title={t("fermer")}>
                      <Icon fafa="faXmark" width={11} />
                    </span>
                  </header>
                  <p className="tblFreqInfo">
                    {t("freqDistinctes", { n: freq.distinctes })}
                    {freq.vides ? ` · ${t("freqVides", { n: freq.vides })}` : ""}
                  </p>
                  <ul>
                    {freq.valeurs.map((v) => (
                      <li key={v.valeur} onClick={() => setRecherche(v.valeur)} title={t("filtrerSurCette")}>
                        <span className="tblFreqVal">{v.valeur}</span>
                        <span className="tblFreqBarre">
                          <i style={{ width: `${v.part}%` }} />
                        </span>
                        <span className="tblFreqN">{v.n}</span>
                      </li>
                    ))}
                  </ul>
                  {freq.tronquee ? <p className="tblFreqInfo">{t("freqTronquee")}</p> : null}
                </aside>
              ) : null}
            </div>

            <p className="tblAide">
              {resumeSelection ? (
                <b className="tblResume">
                  {t("somme")} {resumeSelection.somme.toLocaleString("fr-FR")}
                  {" · "}{t("moyenneCourte")} {(Math.round(resumeSelection.moyenne * 100) / 100).toLocaleString("fr-FR")}
                  {" · "}{t("nbCellules", { n: resumeSelection.cellules })}
                </b>
              ) : (
                t("aide")
              )}
            </p>

            {aide ? (
              <div className="tblRaccourcis" onClick={() => setAide(false)}>
                <div className="tblRaccourcisBoite" onClick={(e) => e.stopPropagation()}>
                  <header>
                    <b>{t("raccourcis")}</b>
                    <span className="tblFermer handcr" onClick={() => setAide(false)}>
                      <Icon fafa="faXmark" width={11} />
                    </span>
                  </header>
                  <dl>
                    {[
                      ["↑ ↓ ← →", t("rcDeplacer")],
                      ["Maj + ↑↓←→", t("rcEtendre")],
                      ["Ctrl + clic", t("rcMultiple")],
                      ["Entrée · F2", t("rcCorriger")],
                      [t("rcTaper"), t("rcRemplacer")],
                      ["Tab", t("rcDroite")],
                      ["Ctrl + C / V", t("rcCopier")],
                      ["Ctrl + D", t("rcRemplir")],
                      ["Ctrl + Z / Y", t("rcAnnuler")],
                      ["Ctrl + S", t("rcEnregistrer")],
                      ["Suppr", t("rcVider")],
                      ["Début · Fin", t("rcBords")],
                    ].map(([k, v]) => (
                      <React.Fragment key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                  <p className="tblFreqInfo">{t("formulesAide")}</p>
                  <code className="tblExemples">
                    =SOMME(A1:A20) · =MOYENNE(B2:B50) · =TTC(C2;18) · =ARRONDI(A1*1,18;0)
                  </code>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <Vide icone="faTable" titre={t("accueilTitre")} aide={t("accueilAide")}>
            <Bouton icone="faFolderOpen" onClick={() => fichierRef.current?.click()}>
              {t("ouvrir")}
            </Bouton>
          </Vide>
        )}

        {depot ? (
          <div className="tblDepot">
            <Icon fafa="faFileCsv" width={26} />
            <span>{t("deposer")}</span>
          </div>
        ) : null}
      </div>
    </ModuleWindow>
  );
}

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
import { Bouton, Vide } from "../../ui";
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
const MARGE = 6;

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
  },
};

const COULEURS = [
  "", "D93025", "E8710A", "F9AB00", "188038", "1A73E8", "6F42C1", "5F6368", "111111",
];
const FONDS = [
  "", "FCE8E6", "FEF7E0", "E6F4EA", "E8F0FE", "F3E8FD", "F1F3F4", "FFF3CD",
];

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
  const [hauteurVue, setHauteurVue] = useState(400);
  const [redim, setRedim] = useState(null);
  /// Vrai tant que le bouton reste enfoncé après un clic sur une cellule :
  /// c'est ce qui permet de balayer une plage à la souris.
  const [glisse, setGlisse] = useState(false);
  const [occupe, setOccupe] = useState(false);

  const grilleRef = useRef(null);
  const fichierRef = useRef(null);

  const charger = useCallback(async () => {
    setListe(await api.records.list(manifest.slug, "classeurs"));
  }, []);
  const etat = useChargement(ouvert, charger);

  const feuille = classeur?.feuilles[iFeuille] || null;
  const cellules = feuille?.cellules || [];
  const nbL = cellules.length;
  const nbC = cellules[0]?.length || 0;

  // ---- Modification --------------------------------------------------------

  const appliquer = useCallback(
    (nouvellesCellules, patchFeuille = null) => {
      setHistorique((h) => D.empiler(h, classeur));
      setClasseur((c) => ({
        ...c,
        feuilles: c.feuilles.map((f, i) =>
          i !== iFeuille ? f : { ...f, ...(patchFeuille || {}), cellules: nouvellesCellules || f.cellules },
        ),
      }));
      setModifie(true);
    },
    [classeur, iFeuille],
  );

  const majClasseur = useCallback(
    (patch) => {
      setHistorique((h) => D.empiler(h, classeur));
      setClasseur((c) => ({ ...c, ...patch }));
      setModifie(true);
    },
    [classeur],
  );

  const faireAnnuler = () => {
    const { historique: h, etat: e } = D.annuler(historique, classeur);
    setHistorique(h);
    setClasseur(e);
    setIFeuille((i) => Math.min(i, (e?.feuilles.length || 1) - 1));
    setModifie(true);
  };
  const faireRetablir = () => {
    const { historique: h, etat: e } = D.retablir(historique, classeur);
    setHistorique(h);
    setClasseur(e);
    setModifie(true);
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
    setClasseur(donnees);
    setFiche(enregistrement);
    setIFeuille(0);
    setSel({ l: 0, c: 0, l2: 0, c2: 0 });
    setHistorique({ passe: [], futur: [] });
    setModifie(false);
    setDefilement(0);
    if (grilleRef.current) grilleRef.current.scrollTop = 0;
  };

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
        ? await api.records.update(manifest.slug, "classeurs", fiche.id, classeur)
        : await api.records.create(manifest.slug, "classeurs", classeur);
      setFiche(rec || { id: fiche?.id, data: classeur });
      setModifie(false);
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

  const styler = (patch, bascule = false) => appliquer(D.styler(cellules, sel, patch, bascule));

  // ---- Clavier -------------------------------------------------------------

  const suivre = useCallback((l) => {
    const el = grilleRef.current;
    if (!el) return;
    const haut = l * HAUTEUR_LIGNE;
    if (haut < el.scrollTop) el.scrollTop = haut;
    else if (haut + HAUTEUR_LIGNE > el.scrollTop + el.clientHeight - HAUTEUR_LIGNE * 2) {
      el.scrollTop = haut - el.clientHeight + HAUTEUR_LIGNE * 3;
    }
  }, []);

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
    try {
      await navigator.clipboard.writeText(D.versTSV(cellules, sel, devise));
    } catch { /* refus du presse-papiers : sans conséquence */ }
  }, [cellules, sel, devise]);

  const coller = useCallback(async () => {
    try {
      const texte = await navigator.clipboard.readText();
      if (texte) appliquer(D.collerTSV(cellules, texte, Math.min(sel.l, sel.l2), Math.min(sel.c, sel.c2)));
    } catch { /* idem */ }
  }, [cellules, sel, appliquer]);

  const auClavier = useCallback(
    (e) => {
      if (!classeur || edition) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl) {
        const k = e.key.toLowerCase();
        const raccourcis = {
          z: faireAnnuler, y: faireRetablir, c: copier, v: coller,
          s: enregistrer,
          b: () => styler({ gras: true }, true),
          i: () => styler({ italique: true }, true),
          u: () => styler({ souligne: true }, true),
          d: () => appliquer(D.remplirVersLeBas(cellules, sel)),
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
          return setEdition({ l: sel.l, c: sel.c, valeur: cellules[sel.l]?.[sel.c]?.v ?? "" });
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
    [classeur, edition, sel, cellules, nbC, deplacer, copier, coller, appliquer, styler,
     faireAnnuler, faireRetablir, enregistrer],
  );

  const validerEdition = (valeur, avancer) => {
    if (edition && valeur !== cellules[edition.l]?.[edition.c]?.v) {
      // Saisir sous la dernière ligne agrandit la feuille : on ne bute pas
      // sur une limite arbitraire au milieu d'un travail.
      const agrandie = D.agrandir(cellules, edition.l + 2, edition.c + 1);
      appliquer(D.poser(agrandie, edition.l, edition.c, { v: valeur }));
    }
    setEdition(null);
    if (avancer) deplacer(1, 0);
    grilleRef.current?.focus();
  };

  // ---- Virtualisation et redimensionnement ---------------------------------

  useEffect(() => {
    const el = grilleRef.current;
    if (!el) return undefined;
    const mesurer = () => setHauteurVue(el.clientHeight || 400);
    mesurer();
    const obs = new ResizeObserver(mesurer);
    obs.observe(el);
    return () => obs.disconnect();
  }, [classeur, iFeuille]);

  useEffect(() => {
    if (!redim) return undefined;
    const bouger = (e) => {
      const px = Math.max(60, redim.l0 + (e.clientX - redim.x0));
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
  }, [redim, iFeuille]);

  // Le balayage s'arrête où que le bouton soit relâché, même hors grille.
  useEffect(() => {
    if (!glisse) return undefined;
    const lacher = () => setGlisse(false);
    document.addEventListener("mouseup", lacher);
    return () => document.removeEventListener("mouseup", lacher);
  }, [glisse]);

  const debut = Math.max(0, Math.floor(defilement / HAUTEUR_LIGNE) - MARGE);
  const fin = Math.min(nbL, Math.ceil((defilement + hauteurVue) / HAUTEUR_LIGNE) + MARGE);

  const resume = useMemo(() => (cellules.length ? D.resume(cellules, sel) : null), [cellules, sel]);
  const celluleActive = cellules[sel.l]?.[sel.c];

  const dansSel = (l, c) => {
    const p = D.normaliser(sel);
    return l >= p.l1 && l <= p.l2 && c >= p.c1 && c <= p.c2;
  };

  /// La sélection lisible depuis un gestionnaire d'événement : un menu
  /// contextuel bâti sur une closure de rendu annoncerait la sélection
  /// d'avant. Voir la même précaution dans le Tableur CSV.
  const selRef = useRef(sel);
  selRef.current = sel;

  // ---- Menus ---------------------------------------------------------------

  const menuColonne = (c) => (e) =>
    menuContextuel(e, [
      { nom: t("insererColAvant"), icone: "faTableColumns", action: () => appliquer(D.insererColonne(cellules, c)) },
      { nom: t("insererColApres"), icone: "faTableColumns", action: () => appliquer(D.insererColonne(cellules, c + 1)) },
      {
        nom: t("ajusterCol"),
        icone: "faLeftRight",
        action: () => {
          const max = Math.max(
            ...cellules.slice(0, 200).map((l) => String(D.valeurCalculee(cellules, cellules.indexOf(l), c) ?? "").length),
            4,
          );
          appliquer(null, { largeurs: { ...feuille.largeurs, [c]: Math.min(400, 24 + max * 7.5) } });
        },
      },
      { separateur: true },
      { nom: t("supprimerCol"), icone: "faTrashCan", danger: true, desactive: nbC <= 1, action: () => appliquer(D.supprimerColonne(cellules, c)) },
    ]);

  const menuLigne = (l) => (e) =>
    menuContextuel(e, [
      { nom: t("insererLigneAvant"), icone: "faPlus", action: () => appliquer(D.insererLigne(cellules, l)) },
      { nom: t("insererLigneApres"), icone: "faPlus", action: () => appliquer(D.insererLigne(cellules, l + 1)) },
      { separateur: true },
      { nom: t("supprimerLigne"), icone: "faTrashCan", danger: true, desactive: nbL <= 1, action: () => appliquer(D.supprimerLigne(cellules, l)) },
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
        })) },
      { separateur: true },
      { nom: t("remplirBas"), icone: "faArrowDown", desactive: p.l1 === p.l2,
        action: () => appliquer(D.remplirVersLeBas(cellules, cible)) },
      { separateur: true },
      { nom: t("insererLigneAvant"), icone: "faPlus", action: () => appliquer(D.insererLigne(cellules, p.l1)) },
      { nom: t("supprimerLignesN", { n: p.l2 - p.l1 + 1 }), icone: "faTrashCan", danger: true,
        desactive: nbL <= 1,
        action: () => {
          let g = cellules;
          for (let i = p.l2; i >= p.l1; i -= 1) g = D.supprimerLigne(g, i);
          appliquer(g);
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

  // ---- Rendu ---------------------------------------------------------------

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="clsApp">
        <div className="clsVerrou">{t("verrou")}</div>
      </ModuleWindow>
    );
  }

  return (
    <ModuleWindow manifest={manifest} className="clsApp">
      <div className="clsShell">
        <input
          ref={fichierRef}
          type="file"
          accept=".xlsx,.xls"
          hidden
          onChange={(e) => { importer(e.target.files?.[0]); e.target.value = ""; }}
        />

        <aside className="clsLateral cosScroll">
          <div className="clsLateralTete">
            <b>{t("mesClasseurs")}</b>
          </div>
          <Bouton icone="faFileCirclePlus" onClick={nouveau}>{t("nouveau")}</Bouton>
          <Bouton variante="secondaire" icone="faFileImport" off={occupe} onClick={() => fichierRef.current?.click()}>
            {t("importer")}
          </Bouton>
          <Contenu etat={etat} vide={false} lignes={3}>
            <ul className="clsListe">
              {liste.map((rec) => (
                <li
                  key={rec.id}
                  data-actif={fiche?.id === rec.id}
                  onClick={() => ouvrirFiche(rec)}
                >
                  <Icon fafa="faTableCells" width={12} />
                  <span>{rec.data.titre}</span>
                  <span
                    className="clsSuppr handcr"
                    onClick={(e) => { e.stopPropagation(); supprimer(rec); }}
                  >
                    <Icon fafa="faXmark" width={10} />
                  </span>
                </li>
              ))}
            </ul>
          </Contenu>
        </aside>

        <div className="clsCentre">
          {!classeur ? (
            <Vide icone="faTableCells" titre={t("aucun")} aide={t("aucunAide")}>
              <Bouton icone="faFileCirclePlus" onClick={nouveau}>{t("nouveau")}</Bouton>
            </Vide>
          ) : (
            <>
              <div className="clsBarre">
                <input
                  className="clsTitre"
                  value={classeur.titre}
                  onChange={(e) => setClasseur((c) => ({ ...c, titre: e.target.value })) || setModifie(true)}
                />
                <span className="clsSep" />
                <button className="clsIcone" title={t("annuler")} disabled={!historique.passe.length} onClick={faireAnnuler}>
                  <Icon fafa="faRotateLeft" width={12} />
                </button>
                <button className="clsIcone" title={t("retablir")} disabled={!historique.futur.length} onClick={faireRetablir}>
                  <Icon fafa="faRotateRight" width={12} />
                </button>
                <span className="clsSep" />
                <button className="clsIcone" data-on={celluleActive?.s?.gras} title={t("gras")} onClick={() => styler({ gras: true }, true)}><b>B</b></button>
                <button className="clsIcone" data-on={celluleActive?.s?.italique} title={t("italique")} onClick={() => styler({ italique: true }, true)}><i>I</i></button>
                <button className="clsIcone" data-on={celluleActive?.s?.souligne} title={t("souligne")} onClick={() => styler({ souligne: true }, true)}><u>U</u></button>
                <span className="clsSep" />
                <button className="clsIcone" title={t("alignGauche")} onClick={() => styler({ align: "" })}><Icon fafa="faAlignLeft" width={12} /></button>
                <button className="clsIcone" title={t("alignCentre")} onClick={() => styler({ align: "center" })}><Icon fafa="faAlignCenter" width={12} /></button>
                <button className="clsIcone" title={t("alignDroite")} onClick={() => styler({ align: "right" })}><Icon fafa="faAlignRight" width={12} /></button>
                <span className="clsSep" />
                <button className="clsIcone" title={t("couleurTexte")} onClick={menuCouleur("couleurTexte")}><Icon fafa="faPalette" width={12} /></button>
                <button className="clsIcone" title={t("couleurFond")} onClick={menuCouleur("couleurFond")}><Icon fafa="faFillDrip" width={12} /></button>
                <button className="clsIcone clsLarge" title={t("format")} onClick={menuFormat}>
                  <Icon fafa="faHashtag" width={11} />
                  <span>{(D.FORMATS.find((f) => f.id === (celluleActive?.s?.format || "auto")) || D.FORMATS[0]).nom[langue] || "Auto"}</span>
                </button>

                <span className="clsEspace" />
                <Bouton icone="faFloppyDisk" off={occupe || !modifie} onClick={enregistrer}>{t("enregistrer")}</Bouton>
                <button className="clsIcone" title={t("exporter")} disabled={occupe} onClick={exporter}>
                  <Icon fafa="faFileExport" width={12} />
                </button>
              </div>

              <div className="clsFormule">
                <span className="clsRef">{D.repereColonne(sel.c)}{sel.l + 1}</span>
                <Icon fafa="faFunction" width={11} />
                <input
                  key={`${iFeuille}:${sel.l}:${sel.c}`}
                  defaultValue={celluleActive?.v ?? ""}
                  placeholder={t("formulePlaceholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      appliquer(D.poser(cellules, sel.l, sel.c, { v: e.currentTarget.value }));
                      grilleRef.current?.focus();
                    }
                    if (e.key === "Escape") grilleRef.current?.focus();
                  }}
                />
              </div>

              <div
                className="clsGrille"
                ref={grilleRef}
                tabIndex={0}
                onKeyDown={auClavier}
                onScroll={(e) => setDefilement(e.currentTarget.scrollTop)}
              >
                <table>
                  <thead>
                    <tr>
                      <th className="clsNum" />
                      {Array.from({ length: nbC }, (_, c) => (
                        <th
                          key={c}
                          style={feuille.largeurs?.[c] ? { width: feuille.largeurs[c], minWidth: feuille.largeurs[c] } : undefined}
                          data-actif={c >= Math.min(sel.c, sel.c2) && c <= Math.max(sel.c, sel.c2)}
                          onClick={menuColonne(c)}
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
                    </tr>
                  </thead>
                  <tbody>
                    {debut > 0 ? <tr style={{ height: debut * HAUTEUR_LIGNE }}><td colSpan={nbC + 1} /></tr> : null}
                    {cellules.slice(debut, fin).map((ligne, i) => {
                      const l = debut + i;
                      return (
                        <tr key={l}>
                          <th className="clsNum" data-actif={l >= Math.min(sel.l, sel.l2) && l <= Math.max(sel.l, sel.l2)}
                              onClick={menuLigne(l)} onContextMenu={menuLigne(l)}>
                            {l + 1}
                          </th>
                          {ligne.map((cel, c) => {
                            const enEdition = edition?.l === l && edition?.c === c;
                            const affichee = D.valeurAffichee(cellules, l, c, devise);
                            const s = cel?.s || {};
                            return (
                              <td
                                key={c}
                                style={{
                                  ...(feuille.largeurs?.[c] ? { width: feuille.largeurs[c], minWidth: feuille.largeurs[c] } : {}),
                                  fontWeight: s.gras ? 700 : undefined,
                                  fontStyle: s.italique ? "italic" : undefined,
                                  textDecoration: s.souligne ? "underline" : undefined,
                                  textAlign: s.align || undefined,
                                  color: s.couleurTexte ? `#${s.couleurTexte}` : undefined,
                                  background: s.couleurFond ? `#${s.couleurFond}` : undefined,
                                }}
                                data-sel={dansSel(l, c) || undefined}
                                data-formule={D.estFormule(cel?.v) || undefined}
                                data-erreur={String(affichee).startsWith("#") || undefined}
                                onMouseDown={(e) => {
                                  // Le clic droit ne déplace rien : c'est le
                                  // menu qui décide, en respectant la
                                  // sélection déjà faite.
                                  if (e.button === 2) return;
                                  if (e.shiftKey) return setSel((x) => ({ ...x, l2: l, c2: c }));
                                  setSel({ l, c, l2: l, c2: c });
                                  setGlisse(true);
                                  grilleRef.current?.focus();
                                }}
                                // `onMouseOver` et non `onMouseEnter` : le
                                // second est synthétisé par React depuis
                                // les paires mouseout/mouseover, le premier
                                // suit l'événement natif.
                                onMouseOver={() => {
                                  if (glisse) setSel((x) => ({ ...x, l2: l, c2: c }));
                                }}
                                onContextMenu={menuCellule(l, c)}
                                onDoubleClick={() => setEdition({ l, c, valeur: cel?.v ?? "" })}
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
                    {fin < nbL ? <tr style={{ height: (nbL - fin) * HAUTEUR_LIGNE }}><td colSpan={nbC + 1} /></tr> : null}
                  </tbody>
                </table>
              </div>

              <div className="clsOnglets">
                {classeur.feuilles.map((f, i) => (
                  <button
                    key={i}
                    className="clsOnglet"
                    data-actif={i === iFeuille}
                    onClick={() => { setIFeuille(i); setSel({ l: 0, c: 0, l2: 0, c2: 0 }); }}
                    onContextMenu={menuFeuille(i)}
                  >
                    {f.nom}
                  </button>
                ))}
                <button
                  className="clsOnglet clsPlus"
                  title={t("nouvelleFeuille")}
                  onClick={() => {
                    majClasseur({ feuilles: [...classeur.feuilles, D.feuilleVide(D.nomLibre(classeur.feuilles))] });
                    setIFeuille(classeur.feuilles.length);
                  }}
                >
                  <Icon fafa="faPlus" width={10} />
                </button>
                <span className="clsEspace" />
                <span className="clsEtat">
                  {t("cellule")} {D.repereColonne(sel.c)}{sel.l + 1}
                  {resume?.n ? (
                    <>
                      {" · "}<b>{t("somme")} {resume.somme.toLocaleString("fr-FR")}</b>
                      {" · "}{t("moyenne")} {(Math.round(resume.moyenne * 100) / 100).toLocaleString("fr-FR")}
                      {" · "}{t("nbCellules", { n: resume.total })}
                    </>
                  ) : null}
                  {modifie ? <em className="clsModifie"> · {t("modifie")}</em> : null}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </ModuleWindow>
  );
}

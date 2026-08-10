import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { saveAs, saveToCloud } from "../../cloud";
import { modal } from "../../modalRequest";
import { envoyerA } from "../../notifications";
import { choisirImage, redimensionnerImage } from "../../image";
import { invaliderReferentiel } from "../../referentiel";
import { useChargement } from "../../chargement";
import {
  SENS,
  arbre,
  branche,
  chemin,
  etat,
  niveaux,
  parentsPossibles,
  pmp,
  qty,
  statistiques,
  today,
} from "./domaine";
import { Analyse } from "./vues/Analyse";
import { BarreLaterale } from "./vues/BarreLaterale";
import { Catalogue } from "./vues/Catalogue";
import { FicheArticle } from "./vues/FicheArticle";
import { FormulaireFournisseur } from "./vues/FormulaireFournisseur";
import { Fournisseurs } from "./vues/Fournisseurs";
import { Mouvements } from "./vues/Mouvements";
import "./stock.scss";

// Gestion de stock.
//
// Trois collections, un seul référentiel d'entreprise :
//
//   categories   arborescence libre — une sous-catégorie est une catégorie
//                qui a un parent, sur autant de niveaux que nécessaire
//   articles     le produit : identité, image, prix, seuil, fournisseur
//   mouvements   entrées, sorties, inventaires — le stock en est la somme
//
// Le catalogue n'appartient pas à cette application : la Facturation et les
// modules à venir le lisent par `src/apps/referentiel.js`. Toute écriture
// ici doit donc invalider ce référentiel, sinon les autres écrans
// travaillent sur un catalogue périmé.
//
// Ce fichier tient l'état, les écritures et l'assemblage ; chaque écran est
// dans `vues/`, et les règles de calcul dans `domaine.js`.

const ARTICLE_VIDE = {
  reference: "",
  designation: "",
  description: "",
  marque: "",
  codeBarre: "",
  categorieId: "",
  unite: "pièce",
  prixAchat: 0,
  prixVente: 0,
  tva: 18,
  seuil: 5,
  emplacement: "",
  fournisseurId: "",
  vignette: "",
  imageNodeId: "",
};

const FOURNISSEUR_VIDE = {
  nom: "",
  contact: "",
  telephone: "",
  email: "",
  ville: "",
};

import { montant as money } from "../../../utils/monnaie";

// La vignette voyage dans l'enregistrement (limite serveur : 64 Ko de JSON).
// À 180 px et qualité 0,7, une photo pèse 8 à 12 Ko : elle tient largement,
// s'affiche sans requête supplémentaire, et la grille reste instantanée même
// avec trois cents produits. L'original, lui, part dans l'Explorateur.
const VIGNETTE_COTE = 180;
const VIGNETTE_QUALITE = 0.7;
const VIGNETTE_MAX = 40000;

export const manifest = {
  id: "stock",
  slug: "stock",
  version: "2.0.0",
  /// Annoncé dans la Boutique quand une mise à jour est disponible.
  /// Seules les entrées postérieures à la version installée sont montrées.
  nouveautes: [
    { version: "2.0.0", texte: "Catégories et sous-catégories, images de produits, fournisseurs, inventaire, valorisation au prix moyen pondéré." },
    { version: "1.1.0", texte: "Alerte au franchissement du seuil de stock." },
  ],
  name: "Stock",
  icon: "excel",
  action: "STOCKAPP",
  Window: StockApp,
};

function StockApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id || manifest.icon]);
  const session = useSelector((state) => state.session);

  const [articles, setArticles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [mouvements, setMouvements] = useState([]);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [membres, setMembres] = useState([]);

  const [vue, setVue] = useState("catalogue");
  const [categorieActive, setCategorieActive] = useState(null);
  const [requete, setRequete] = useState("");
  const [filtreEtat, setFiltreEtat] = useState("tous");
  const [tri, setTri] = useState("designation");
  const [affichage, setAffichage] = useState("grille");

  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [onglet, setOnglet] = useState("fiche");
  const [mvt, setMvt] = useState({
    sens: "entree",
    quantite: "",
    prixUnitaire: "",
    motif: "",
    date: today(),
  });

  const [fournisseurDraft, setFournisseurDraft] = useState(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 3500);
  };

  const ouvert = wnapp && !wnapp.hide && session.status === "authenticated";

  // ---- Chargement ---------------------------------------------------------

  const charger = async () => {
    const [a, c, m, f, gens] = await Promise.all([
      api.records.list(manifest.slug, "articles"),
      api.records.list(manifest.slug, "categories").catch(() => []),
      api.records.list(manifest.slug, "mouvements"),
      api.records.list(manifest.slug, "fournisseurs").catch(() => []),
      // Pour savoir qui prévenir en cas de stock bas.
      api.members().catch(() => []),
    ]);
    setArticles(a);
    setCategories(c);
    setMouvements(m);
    setFournisseurs(f);
    setMembres(gens);
  };

  const chargement = useChargement(ouvert, charger);

  /// Après toute écriture : on relit, et on prévient le reste de l'OS que
  /// le catalogue a bougé — la Facturation ouverte à côté doit le voir.
  ///
  /// Rechargement **silencieux** : l'écran a déjà son contenu, le remplacer
  /// par un squelette après chaque enregistrement ferait clignoter la page
  /// pour rien.
  const rafraichir = async () => {
    await chargement.rafraichir();
    invaliderReferentiel();
  };

  // ---- Arrivée depuis une notification ------------------------------------

  const lienEnAttente = React.useRef(null);

  useEffect(() => {
    const aller = (e) => {
      if (e.detail?.app !== manifest.id) return;
      lienEnAttente.current = e.detail.params?.article || null;
      appliquerLien();
    };
    window.addEventListener("companyos:lien", aller);
    return () => window.removeEventListener("companyos:lien", aller);
  }, [articles]);

  const appliquerLien = () => {
    const vise = lienEnAttente.current;
    if (!vise) return;
    const article = articles.find((a) => a.id === vise);
    if (!article) return; // pas encore chargé : on retentera après `charger()`
    lienEnAttente.current = null;
    setVue("catalogue");
    setCategorieActive(null);
    ouvrirArticle(article);
  };

  useEffect(appliquerLien, [articles]);

  // ---- Dérivés ------------------------------------------------------------

  const stocks = useMemo(() => niveaux(mouvements), [mouvements]);
  const racines = useMemo(() => arbre(categories), [categories]);
  const stats = useMemo(() => statistiques(articles, mouvements), [articles, mouvements]);

  const categorieDe = (id) => categories.find((c) => c.id === id);
  const fournisseurDe = (id) => fournisseurs.find((f) => f.id === id);
  const selected = articles.find((a) => a.id === selectedId) || null;
  const catActive = categorieDe(categorieActive);

  /// Nombre de produits d'une catégorie, sous-catégories comprises : un
  /// compte qui ignore les branches filles fait croire à un rayon vide.
  const compteCategorie = (id) => {
    const dans = new Set(branche(categories, id));
    return articles.filter((a) => dans.has(a.data.categorieId)).length;
  };

  const visibles = useMemo(() => {
    const q = requete.trim().toLowerCase();
    const dans =
      categorieActive && categorieActive !== "__sans__"
        ? new Set(branche(categories, categorieActive))
        : null;

    const liste = articles.filter((a) => {
      if (categorieActive === "__sans__" && a.data.categorieId) return false;
      if (dans && !dans.has(a.data.categorieId)) return false;
      if (filtreEtat !== "tous" && etat(stocks[a.id], a.data.seuil).id !== filtreEtat)
        return false;
      if (!q) return true;
      return [a.data.reference, a.data.designation, a.data.codeBarre, a.data.marque]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });

    const cle = {
      designation: (a) => (a.data.designation || "").toLowerCase(),
      stock: (a) => stocks[a.id] || 0,
      valeur: (a) => -(stocks[a.id] || 0) * pmp(a, mouvements),
      recent: (a) => -new Date(a.createdAt).getTime(),
    }[tri];

    return [...liste].sort((a, b) => {
      const va = cle(a);
      const vb = cle(b);
      return typeof va === "string" ? va.localeCompare(vb, "fr") : va - vb;
    });
  }, [
    articles,
    categories,
    categorieActive,
    requete,
    filtreEtat,
    tri,
    stocks,
    mouvements,
  ]);

  const mouvementsArticle = useMemo(
    () =>
      mouvements
        .filter((m) => m.data.articleId === selectedId)
        .sort((a, b) => (a.data.date < b.data.date ? 1 : -1)),
    [mouvements, selectedId],
  );

  // ---- Produits -----------------------------------------------------------

  const ouvrirArticle = (record) => {
    setSelectedId(record.id);
    setDraft({ ...ARTICLE_VIDE, ...record.data });
    setOnglet("fiche");
  };

  /// ART-001, ART-002… en repartant du plus grand numéro déjà pris, jamais
  /// du nombre d'articles : après une suppression, compter les articles
  /// redonnerait une référence déjà utilisée.
  const prochaineReference = () => {
    const max = articles.reduce((acc, a) => {
      const n = /^ART-(\d+)$/.exec(a.data.reference || "");
      return n ? Math.max(acc, Number(n[1])) : acc;
    }, 0);
    return `ART-${String(max + 1).padStart(3, "0")}`;
  };

  const nouvelArticle = () => {
    setSelectedId(null);
    setDraft({
      ...ARTICLE_VIDE,
      // Pré-rempli avec la catégorie ouverte : on ajoute presque toujours
      // un produit dans le rayon qu'on est en train de regarder.
      categorieId: categorieActive && categorieActive !== "__sans__" ? categorieActive : "",
      reference: prochaineReference(),
    });
    setOnglet("fiche");
  };

  const champ = (cle) => (e) => {
    const brut = e.target.value;
    const valeur = ["prixAchat", "prixVente", "seuil", "tva"].includes(cle)
      ? Number(brut) || 0
      : brut;
    setDraft((d) => ({ ...d, [cle]: valeur }));
  };

  const enregistrerArticle = async () => {
    if (!draft?.designation.trim()) {
      flash("La désignation est obligatoire");
      return;
    }

    // Une référence en double casse les recherches, les imports et les
    // inventaires : on la refuse à la saisie plutôt que de laisser deux
    // produits se confondre pendant des mois.
    const ref = draft.reference.trim();
    if (
      ref &&
      articles.some(
        (a) =>
          a.id !== selectedId &&
          (a.data.reference || "").toLowerCase() === ref.toLowerCase(),
      )
    ) {
      flash(`La référence « ${ref} » est déjà prise`);
      return;
    }

    setBusy(true);
    try {
      const donnees = { ...draft, reference: ref };
      if (selectedId) {
        await api.records.update(manifest.slug, "articles", selectedId, donnees);
        flash("Produit mis à jour");
      } else {
        const cree = await api.records.create(manifest.slug, "articles", donnees);
        setSelectedId(cree.id);
        flash("Produit créé");
      }
      await rafraichir();
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const supprimerArticle = async () => {
    if (!selectedId) return;
    const lies = mouvements.filter((m) => m.data.articleId === selectedId).length;

    const ok = await modal.confirm({
      title: "Supprimer le produit",
      message: `Supprimer « ${draft.designation} » ?`,
      detail: lies
        ? `Ses ${lies} mouvement${lies > 1 ? "s" : ""} de stock partiront avec lui. Il n'y a pas de corbeille pour les données métier.`
        : "Il n'y a pas de corbeille pour les données métier.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      // Les mouvements d'abord : interrompu au milieu, on préfère un
      // produit sans historique à un historique sans produit — invisible à
      // l'écran, donc impossible à nettoyer.
      for (const m of mouvements.filter((x) => x.data.articleId === selectedId)) {
        await api.records.remove(manifest.slug, "mouvements", m.id);
      }
      await api.records.remove(manifest.slug, "articles", selectedId);
      setSelectedId(null);
      setDraft(null);
      await rafraichir();
      flash("Produit supprimé");
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Image --------------------------------------------------------------

  const changerImage = async () => {
    const fichier = await choisirImage();
    if (!fichier) return;

    setBusy(true);
    try {
      const vignette = await redimensionnerImage(fichier, {
        cote: VIGNETTE_COTE,
        qualite: VIGNETTE_QUALITE,
      });
      if (vignette.length > VIGNETTE_MAX) {
        flash("Image trop lourde après réduction — essayez une autre photo");
        return;
      }

      // L'original part dans l'Explorateur : c'est la règle de l'OS, tout
      // fichier importé doit y être retrouvable. La vignette, elle, reste
      // dans la fiche pour que la grille s'affiche sans requête.
      let imageNodeId = draft.imageNodeId;
      try {
        const node = await saveToCloud(
          fichier,
          `${draft.reference || "produit"}-${fichier.name}`,
          { folder: "Stock" },
        );
        imageNodeId = node?.id || imageNodeId;
      } catch {
        /* l'original n'a pas pu être archivé : la vignette suffit à
           l'usage courant, inutile de bloquer la saisie pour autant */
      }

      setDraft((d) => ({ ...d, vignette, imageNodeId }));
      flash("Image prête — enregistrez le produit");
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const retirerImage = () => setDraft((d) => ({ ...d, vignette: "", imageNodeId: "" }));

  // ---- Mouvements ---------------------------------------------------------

  const ajouterMouvement = async () => {
    if (!selectedId) return;
    const q = Number(mvt.quantite);
    if (!Number.isFinite(q) || q < 0) {
      flash("Quantité invalide");
      return;
    }
    if (mvt.sens !== "inventaire" && q <= 0) {
      flash("Indiquez une quantité positive");
      return;
    }

    const avant = stocks[selectedId] || 0;
    if (mvt.sens === "sortie" && q > avant) {
      flash(`Stock insuffisant : ${qty(avant)} ${draft.unite} disponible`);
      return;
    }

    setBusy(true);
    try {
      await api.records.create(manifest.slug, "mouvements", {
        articleId: selectedId,
        sens: mvt.sens,
        quantite: q,
        prixUnitaire: Number(mvt.prixUnitaire) || 0,
        motif: mvt.motif.trim(),
        date: mvt.date || today(),
      });
      alerterSurSeuil(avant, mvt.sens === "inventaire" ? q : avant - q);
      setMvt({ sens: "entree", quantite: "", prixUnitaire: "", motif: "", date: today() });
      await rafraichir();
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const supprimerMouvement = async (m) => {
    const ok = await modal.confirm({
      title: "Supprimer le mouvement",
      message: `${SENS[m.data.sens]?.label} de ${qty(m.data.quantite)} du ${m.data.date} ?`,
      detail: "Le niveau de stock sera recalculé sans lui.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.records.remove(manifest.slug, "mouvements", m.id);
      await rafraichir();
    } catch (err) {
      flash(err.message);
    }
  };

  /// Prévient les responsables au **franchissement** du seuil.
  ///
  /// Au franchissement seulement : alerter à chaque sortie sous le seuil
  /// enverrait dix messages pour le même produit dans la journée, et plus
  /// personne ne les lirait. C'est le passage qui est une nouvelle.
  const alerterSurSeuil = (avant, apres) => {
    const article = articles.find((a) => a.id === selectedId);
    const seuil = Number(article?.data.seuil) || 0;
    if (!article || !seuil) return;
    if (avant <= seuil || apres > seuil) return;

    // Aux administrateurs : c'est à eux de racheter. L'auteur du mouvement
    // vient de le faire, il n'a pas besoin qu'on le lui raconte.
    const cibles = membres
      .filter((m) => ["OWNER", "ADMIN"].includes(m.role) && m.id !== session.user?.id)
      .map((m) => m.id);
    if (!cibles.length) return;

    envoyerA(cibles, {
      source: manifest.slug,
      titre: `Stock bas : ${article.data.designation}`,
      message: `${qty(apres)} ${article.data.unite} restant · seuil ${qty(seuil)}`,
      lien: { app: manifest.id, params: { article: selectedId } },
    });
  };

  // ---- Catégories ---------------------------------------------------------

  const editerCategorie = async (noeud) => {
    const nom = await modal.prompt({
      title: noeud ? "Renommer la catégorie" : "Nouvelle catégorie",
      label: "Nom",
      placeholder: "Boissons",
      value: noeud?.data.nom || "",
      confirmLabel: noeud ? "Renommer" : "Créer",
    });
    if (!nom) return;

    try {
      if (noeud) {
        await api.records.update(manifest.slug, "categories", noeud.id, {
          ...noeud.data,
          nom,
        });
      } else {
        // Créée dans la catégorie ouverte : c'est ainsi qu'on obtient une
        // sous-catégorie sans avoir à expliquer ce qu'est un parent.
        await api.records.create(manifest.slug, "categories", {
          nom,
          parentId: catActive ? categorieActive : null,
        });
      }
      await rafraichir();
    } catch (err) {
      flash(err.message);
    }
  };

  const supprimerCategorie = async () => {
    if (!catActive) return;

    const dans = new Set(branche(categories, categorieActive));
    const produits = articles.filter((a) => dans.has(a.data.categorieId)).length;
    const sousCat = dans.size - 1;

    const ok = await modal.confirm({
      title: "Supprimer la catégorie",
      message: `Supprimer « ${catActive.data.nom} » ?`,
      detail:
        sousCat || produits
          ? `${sousCat} sous-catégorie${sousCat > 1 ? "s" : ""} et ${produits} produit${produits > 1 ? "s" : ""} concerné${produits > 1 ? "s" : ""} : les sous-catégories sont supprimées, les produits passent en « sans catégorie ». Aucun produit n'est supprimé.`
          : undefined,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      // Les produits sont détachés, jamais supprimés : mal ranger un
      // produit ne doit pas pouvoir le faire disparaître du catalogue.
      for (const a of articles.filter((x) => dans.has(x.data.categorieId))) {
        await api.records.update(manifest.slug, "articles", a.id, {
          ...a.data,
          categorieId: "",
        });
      }
      for (const id of dans) {
        await api.records.remove(manifest.slug, "categories", id);
      }
      setCategorieActive(null);
      await rafraichir();
      flash("Catégorie supprimée");
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const rangerCategorie = async () => {
    if (!catActive) return;

    // `parentsPossibles` écarte la catégorie et sa descendance : on ne
    // propose jamais un parent qui créerait une boucle, plutôt que de
    // refuser le choix après coup.
    const possibles = parentsPossibles(categories, catActive.id);

    const choix = await modal.open({
      title: `Ranger « ${catActive.data.nom} »`,
      render: ({ close }) => (
        <div className="stkChoix">
          <div className="stkChoixLigne handcr" onClick={() => close({ id: null })}>
            À la racine
          </div>
          {possibles.map((c) => (
            <div
              key={c.id}
              className="stkChoixLigne handcr"
              onClick={() => close({ id: c.id })}
            >
              {chemin(categories, c.id)}
            </div>
          ))}
        </div>
      ),
    });
    if (!choix) return;

    try {
      await api.records.update(manifest.slug, "categories", catActive.id, {
        ...catActive.data,
        parentId: choix.id,
      });
      await rafraichir();
    } catch (err) {
      flash(err.message);
    }
  };

  // ---- Fournisseurs -------------------------------------------------------

  const enregistrerFournisseur = async () => {
    if (!fournisseurDraft?.nom.trim()) {
      flash("Le nom du fournisseur est obligatoire");
      return;
    }
    setBusy(true);
    try {
      const { id, ...donnees } = fournisseurDraft;
      if (id) await api.records.update(manifest.slug, "fournisseurs", id, donnees);
      else await api.records.create(manifest.slug, "fournisseurs", donnees);
      setFournisseurDraft(null);
      await rafraichir();
      flash("Fournisseur enregistré");
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const supprimerFournisseur = async (f) => {
    const lies = articles.filter((a) => a.data.fournisseurId === f.id).length;
    const ok = await modal.confirm({
      title: "Supprimer le fournisseur",
      message: `Supprimer « ${f.data.nom} » ?`,
      detail: lies
        ? `${lies} produit${lies > 1 ? "s y sont rattachés" : " y est rattaché"} — ${lies > 1 ? "ils resteront" : "il restera"} au catalogue, sans fournisseur.`
        : undefined,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.records.remove(manifest.slug, "fournisseurs", f.id);
      await rafraichir();
    } catch (err) {
      flash(err.message);
    }
  };

  // ---- Export -------------------------------------------------------------

  const exporterInventaire = async () => {
    const lignes = [
      [
        "Référence",
        "Désignation",
        "Catégorie",
        "Fournisseur",
        "Unité",
        "Stock",
        "Seuil",
        "PMP",
        "Valeur",
        "Prix de vente",
        "État",
      ],
      ...visibles.map((a) => {
        const stock = stocks[a.id] || 0;
        const cout = pmp(a, mouvements);
        return [
          a.data.reference,
          a.data.designation,
          chemin(categories, a.data.categorieId),
          fournisseurDe(a.data.fournisseurId)?.data.nom || "",
          a.data.unite,
          stock,
          a.data.seuil,
          Math.round(cout),
          Math.round(stock * cout),
          a.data.prixVente,
          etat(stock, a.data.seuil).label,
        ];
      }),
    ];

    // BOM UTF-8 et point-virgule : sans les deux, Excel en configuration
    // française ouvre le fichier en une seule colonne, accents cassés.
    const csv =
      "﻿" +
      lignes
        .map((l) => l.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";"))
        .join("\r\n");

    const node = await saveAs(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      "inventaire.csv",
      { folder: "Stock" },
    );
    if (node) flash(`« ${node.name} » enregistré dans l'Explorateur`);
  };

  // ---- Rendu --------------------------------------------------------------

  return (
    <ModuleWindow manifest={manifest} className="stkApp">
      {session.status !== "authenticated" ? (
        <div className="stkLocked">
          <Icon fafa="faLock" width={22} />
          <span>Connectez-vous pour gérer votre stock.</span>
        </div>
      ) : (
        <div className="stkShell">
          {/* ---------- Barre latérale ---------- */}
          <BarreLaterale
            vue={vue}
            setVue={setVue}
            articles={articles}
            racines={racines}
            categorieActive={categorieActive}
            setCategorieActive={setCategorieActive}
            catActive={catActive}
            compteCategorie={compteCategorie}
            editerCategorie={editerCategorie}
            rangerCategorie={rangerCategorie}
            supprimerCategorie={supprimerCategorie}
          />

          {/* ---------- Contenu ---------- */}
          <main className="stkMain">
            <div className="stkStats">
              <div className="stkStat">
                <span className="stkStatVal">{stats.total}</span>
                <span className="stkStatLbl">produits</span>
              </div>
              <div className="stkStat">
                <span className="stkStatVal">{money(stats.valeur)}</span>
                <span className="stkStatLbl">valeur du stock</span>
              </div>
              <div
                className="stkStat handcr"
                data-ton="warn"
                onClick={() => {
                  setVue("catalogue");
                  setFiltreEtat("alerte");
                }}
              >
                <span className="stkStatVal">{stats.alertes}</span>
                <span className="stkStatLbl">sous le seuil</span>
              </div>
              <div
                className="stkStat handcr"
                data-ton="bad"
                onClick={() => {
                  setVue("catalogue");
                  setFiltreEtat("rupture");
                }}
              >
                <span className="stkStatVal">{stats.ruptures}</span>
                <span className="stkStatLbl">en rupture</span>
              </div>
            </div>

            {vue === "catalogue" ? (
              <Catalogue
                requete={requete}
                setRequete={setRequete}
                filtreEtat={filtreEtat}
                setFiltreEtat={setFiltreEtat}
                tri={tri}
                setTri={setTri}
                affichage={affichage}
                setAffichage={setAffichage}
                nouvelArticle={nouvelArticle}
                exporterInventaire={exporterInventaire}
                chargement={chargement}
                visibles={visibles}
                articles={articles}
                categories={categories}
                categorieDe={categorieDe}
                stocks={stocks}
                mouvements={mouvements}
                selectedId={selectedId}
                ouvrirArticle={ouvrirArticle}
              />
            ) : null}

            {vue === "mouvements" ? (
              <Mouvements
                mouvements={mouvements}
                articles={articles}
                setVue={setVue}
                ouvrirArticle={ouvrirArticle}
              />
            ) : null}

            {vue === "fournisseurs" ? (
              <Fournisseurs
                fournisseurs={fournisseurs}
                articles={articles}
                nouveauFournisseur={() => setFournisseurDraft({ ...FOURNISSEUR_VIDE })}
                setFournisseurDraft={setFournisseurDraft}
                supprimerFournisseur={supprimerFournisseur}
              />
            ) : null}

            {vue === "analyse" ? (
              <Analyse
                racines={racines}
                categories={categories}
                articles={articles}
                stocks={stocks}
                mouvements={mouvements}
                fournisseurDe={fournisseurDe}
                setVue={setVue}
                ouvrirArticle={ouvrirArticle}
              />
            ) : null}
          </main>

          {/* ---------- Panneau ---------- */}
          <aside className="stkPanneau cosScroll">
            {fournisseurDraft ? (
              <FormulaireFournisseur
                fournisseurDraft={fournisseurDraft}
                setFournisseurDraft={setFournisseurDraft}
                busy={busy}
                enregistrerFournisseur={enregistrerFournisseur}
              />
            ) : !draft ? (
              <div className="stkPanVide">
                <Icon fafa="faHandPointer" width={20} />
                <span>
                  Sélectionnez un produit pour voir sa fiche, son stock et son
                  historique.
                </span>
              </div>
            ) : (
              <FicheArticle
                draft={draft}
                selected={selected}
                selectedId={selectedId}
                categories={categories}
                fournisseurs={fournisseurs}
                stocks={stocks}
                mouvements={mouvements}
                mouvementsArticle={mouvementsArticle}
                onglet={onglet}
                setOnglet={setOnglet}
                champ={champ}
                mvt={mvt}
                setMvt={setMvt}
                busy={busy}
                changerImage={changerImage}
                retirerImage={retirerImage}
                enregistrerArticle={enregistrerArticle}
                supprimerArticle={supprimerArticle}
                ajouterMouvement={ajouterMouvement}
                supprimerMouvement={supprimerMouvement}
              />
            )}
          </aside>

          {notice ? <div className="stkNotice">{notice}</div> : null}
        </div>
      )}
    </ModuleWindow>
  );
}

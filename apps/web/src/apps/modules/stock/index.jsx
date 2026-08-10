import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { saveAs, saveToCloud } from "../../cloud";
import { modal } from "../../modalRequest";
import { envoyerA } from "../../notifications";
import { Auteur } from "../../Auteur";
import { choisirImage, redimensionnerImage } from "../../image";
import { invaliderReferentiel } from "../../referentiel";
import { Contenu, useChargement } from "../../chargement";
import {
  SENS,
  UNITES,
  arbre,
  branche,
  chemin,
  etat,
  niveaux,
  parentsPossibles,
  pmp,
  statistiques,
} from "./domaine";
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

const VUES = [
  { id: "catalogue", label: "Catalogue", icone: "faBoxesStacked" },
  { id: "mouvements", label: "Mouvements", icone: "faRightLeft" },
  { id: "fournisseurs", label: "Fournisseurs", icone: "faTruckField" },
  { id: "analyse", label: "Analyse", icone: "faChartColumn" },
];

const ETATS = [
  { id: "tous", label: "Tous les états" },
  { id: "alerte", label: "Sous le seuil" },
  { id: "rupture", label: "Rupture" },
];

const TRIS = [
  { id: "designation", label: "Nom (A→Z)" },
  { id: "stock", label: "Stock croissant" },
  { id: "valeur", label: "Valeur décroissante" },
  { id: "recent", label: "Ajout récent" },
];

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

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const qty = (n) => nf.format(Number(n) || 0);
const today = () => new Date().toISOString().slice(0, 10);

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

/// Une branche de l'arbre des catégories, dans la barre latérale.
const BrancheCategorie = ({
  noeud,
  actif,
  compte,
  onChoisir,
  onEditer,
  profondeur = 0,
}) => {
  const [ouvert, setOuvert] = useState(profondeur < 1);

  return (
    <>
      <div
        className="stkCat handcr"
        data-actif={noeud.id === actif}
        style={{ paddingLeft: 8 + profondeur * 13 }}
        onClick={() => onChoisir(noeud.id)}
      >
        <span
          className="stkCatChevron"
          onClick={(e) => {
            if (!noeud.enfants.length) return;
            e.stopPropagation();
            setOuvert((o) => !o);
          }}
        >
          {noeud.enfants.length ? (
            <Icon fafa={ouvert ? "faChevronDown" : "faChevronRight"} width={8} />
          ) : null}
        </span>
        <span className="stkCatNom">{noeud.data.nom}</span>
        <span className="stkCatCompte">{compte(noeud.id)}</span>
        <span
          className="stkCatEdit"
          title="Renommer"
          onClick={(e) => {
            e.stopPropagation();
            onEditer(noeud);
          }}
        >
          <Icon fafa="faPen" width={8} />
        </span>
      </div>
      {ouvert
        ? noeud.enfants.map((enfant) => (
            <BrancheCategorie
              key={enfant.id}
              noeud={enfant}
              actif={actif}
              compte={compte}
              onChoisir={onChoisir}
              onEditer={onEditer}
              profondeur={profondeur + 1}
            />
          ))
        : null}
    </>
  );
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
          <aside className="stkNav cosScroll">
            {VUES.map((v) => (
              <div
                key={v.id}
                className="stkNavItem handcr"
                data-actif={vue === v.id}
                onClick={() => setVue(v.id)}
              >
                <Icon fafa={v.icone} width={13} />
                <span>{v.label}</span>
              </div>
            ))}

            {vue === "catalogue" ? (
              <>
                <div className="stkNavTitre">
                  <span>Catégories</span>
                  <span
                    className="stkNavPlus handcr"
                    title={
                      catActive
                        ? `Nouvelle sous-catégorie dans « ${catActive.data.nom} »`
                        : "Nouvelle catégorie"
                    }
                    onClick={() => editerCategorie(null)}
                  >
                    <Icon fafa="faPlus" width={9} />
                  </span>
                </div>

                <div
                  className="stkCat handcr"
                  data-actif={categorieActive === null}
                  onClick={() => setCategorieActive(null)}
                >
                  <span className="stkCatChevron" />
                  <span className="stkCatNom">Tout le catalogue</span>
                  <span className="stkCatCompte">{articles.length}</span>
                </div>

                {racines.map((n) => (
                  <BrancheCategorie
                    key={n.id}
                    noeud={n}
                    actif={categorieActive}
                    compte={compteCategorie}
                    onChoisir={setCategorieActive}
                    onEditer={editerCategorie}
                  />
                ))}

                {articles.some((a) => !a.data.categorieId) ? (
                  <div
                    className="stkCat handcr"
                    data-actif={categorieActive === "__sans__"}
                    onClick={() => setCategorieActive("__sans__")}
                  >
                    <span className="stkCatChevron" />
                    <span className="stkCatNom stkMuted">Sans catégorie</span>
                    <span className="stkCatCompte">
                      {articles.filter((a) => !a.data.categorieId).length}
                    </span>
                  </div>
                ) : null}

                {catActive ? (
                  <div className="stkCatActions">
                    <span className="handcr" onClick={rangerCategorie}>
                      Ranger ailleurs
                    </span>
                    <span className="handcr stkDanger" onClick={supprimerCategorie}>
                      Supprimer
                    </span>
                  </div>
                ) : null}
              </>
            ) : null}
          </aside>

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
              <>
                <div className="stkBarre">
                  <div className="stkRecherche">
                    <Icon fafa="faMagnifyingGlass" width={11} />
                    <input
                      type="text"
                      placeholder="Référence, désignation, code-barres…"
                      value={requete}
                      onChange={(e) => setRequete(e.target.value)}
                    />
                    {requete ? (
                      <Icon fafa="faXmark" width={10} onClick={() => setRequete("")} />
                    ) : null}
                  </div>

                  <select
                    value={filtreEtat}
                    onChange={(e) => setFiltreEtat(e.target.value)}
                  >
                    {ETATS.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </select>

                  <select value={tri} onChange={(e) => setTri(e.target.value)}>
                    {TRIS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>

                  <div className="stkVues">
                    <span
                      className="handcr"
                      data-actif={affichage === "grille"}
                      title="Grille"
                      onClick={() => setAffichage("grille")}
                    >
                      <Icon fafa="faTableCellsLarge" width={11} />
                    </span>
                    <span
                      className="handcr"
                      data-actif={affichage === "liste"}
                      title="Liste"
                      onClick={() => setAffichage("liste")}
                    >
                      <Icon fafa="faList" width={11} />
                    </span>
                  </div>

                  <div className="stkPrimary handcr" onClick={nouvelArticle}>
                    <Icon fafa="faPlus" width={10} />
                    <span>Nouveau produit</span>
                  </div>
                  <div className="stkBtnGhost handcr" onClick={exporterInventaire}>
                    Export
                  </div>
                </div>

                {/* Tant que rien n'est chargé, on montre un squelette et non
                    « Votre catalogue est vide » : cette phrase serait fausse,
                    et pousse à recréer des produits qui existent déjà. */}
                {chargement.initial || chargement.erreur ? (
                  <Contenu
                    etat={chargement}
                    vide={false}
                    squelette={affichage === "grille" ? "grille" : "liste"}
                    lignes={affichage === "grille" ? 10 : 7}
                  />
                ) : !visibles.length ? (
                  <div className="stkVide">
                    <Icon fafa="faBoxOpen" width={26} />
                    <span>
                      {articles.length
                        ? "Aucun produit ne correspond à ces filtres."
                        : "Votre catalogue est vide."}
                    </span>
                    {!articles.length ? (
                      <div className="stkPrimary handcr" onClick={nouvelArticle}>
                        Créer le premier produit
                      </div>
                    ) : null}
                  </div>
                ) : affichage === "grille" ? (
                  <div className="stkGrille cosScroll">
                    {visibles.map((a) => {
                      const stock = stocks[a.id] || 0;
                      const e = etat(stock, a.data.seuil);
                      return (
                        <div
                          key={a.id}
                          className="stkCarte handcr"
                          data-actif={a.id === selectedId}
                          onClick={() => ouvrirArticle(a)}
                        >
                          <div className="stkCarteImg">
                            {a.data.vignette ? (
                              <img src={a.data.vignette} alt="" />
                            ) : (
                              <Icon fafa="faBox" width={22} />
                            )}
                            <span className="stkPastille" data-ton={e.ton}>
                              {qty(stock)}
                            </span>
                          </div>
                          <div className="stkCarteNom">{a.data.designation}</div>
                          <div className="stkCarteMeta">
                            {[
                              a.data.reference,
                              categorieDe(a.data.categorieId)?.data.nom,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </div>
                          <div className="stkCartePrix">{money(a.data.prixVente)}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="stkTable cosScroll">
                    <div className="stkTr stkTrArt stkTh">
                      <span />
                      <span>Produit</span>
                      <span>Catégorie</span>
                      <span className="stkTdNum">Stock</span>
                      <span className="stkTdNum">Seuil</span>
                      <span className="stkTdNum">Valeur</span>
                      <span>État</span>
                    </div>
                    {visibles.map((a) => {
                      const stock = stocks[a.id] || 0;
                      const e = etat(stock, a.data.seuil);
                      return (
                        <div
                          key={a.id}
                          className="stkTr stkTrArt handcr"
                          data-actif={a.id === selectedId}
                          onClick={() => ouvrirArticle(a)}
                        >
                          <span className="stkTdImg">
                            {a.data.vignette ? (
                              <img src={a.data.vignette} alt="" />
                            ) : (
                              <Icon fafa="faBox" width={11} />
                            )}
                          </span>
                          <span className="stkTdNom">
                            <strong>{a.data.designation}</strong>
                            <em>{a.data.reference}</em>
                          </span>
                          <span className="stkMuted">
                            {chemin(categories, a.data.categorieId) || "—"}
                          </span>
                          <span className="stkTdNum">
                            {qty(stock)} {a.data.unite}
                          </span>
                          <span className="stkTdNum stkMuted">{qty(a.data.seuil)}</span>
                          <span className="stkTdNum">
                            {money(stock * pmp(a, mouvements))}
                          </span>
                          <span>
                            <span className="stkTag" data-ton={e.ton}>
                              {e.label}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : null}

            {vue === "mouvements" ? (
              !mouvements.length ? (
                <div className="stkVide">
                  <Icon fafa="faRightLeft" width={24} />
                  <span>Aucun mouvement enregistré.</span>
                </div>
              ) : (
                <div className="stkTable cosScroll">
                  <div className="stkTr stkTrMvt stkTh">
                    <span>Date</span>
                    <span>Produit</span>
                    <span>Type</span>
                    <span className="stkTdNum">Quantité</span>
                    <span>Motif</span>
                    <span>Par</span>
                  </div>
                  {[...mouvements]
                    .sort((a, b) => (a.data.date < b.data.date ? 1 : -1))
                    .slice(0, 300)
                    .map((m) => {
                      const art = articles.find((a) => a.id === m.data.articleId);
                      const s = SENS[m.data.sens] || SENS.entree;
                      return (
                        <div key={m.id} className="stkTr stkTrMvt">
                          <span className="stkMuted">{m.data.date}</span>
                          <span
                            className="stkLien handcr"
                            onClick={() => {
                              if (!art) return;
                              setVue("catalogue");
                              ouvrirArticle(art);
                            }}
                          >
                            {art?.data.designation || "produit supprimé"}
                          </span>
                          <span className="stkSens" data-ton={s.ton}>
                            <Icon fafa={s.icone} width={9} />
                            {s.label}
                          </span>
                          <span className="stkTdNum">{qty(m.data.quantite)}</span>
                          <span className="stkMuted">{m.data.motif || "—"}</span>
                          <span className="stkMuted">{m.auteur?.name || "—"}</span>
                        </div>
                      );
                    })}
                </div>
              )
            ) : null}

            {vue === "fournisseurs" ? (
              <>
                <div className="stkBarre">
                  <div
                    className="stkPrimary handcr"
                    onClick={() => setFournisseurDraft({ ...FOURNISSEUR_VIDE })}
                  >
                    <Icon fafa="faPlus" width={10} />
                    <span>Nouveau fournisseur</span>
                  </div>
                </div>

                {!fournisseurs.length ? (
                  <div className="stkVide">
                    <Icon fafa="faTruckField" width={24} />
                    <span>Aucun fournisseur enregistré.</span>
                  </div>
                ) : (
                  <div className="stkTable cosScroll">
                    {fournisseurs.map((f) => (
                      <div key={f.id} className="stkTr stkTrFrn">
                        <span
                          className="stkTdNom handcr"
                          onClick={() => setFournisseurDraft({ id: f.id, ...f.data })}
                        >
                          <strong>{f.data.nom}</strong>
                          <em>{f.data.ville}</em>
                        </span>
                        <span className="stkMuted">{f.data.contact || "—"}</span>
                        <span className="stkMuted">{f.data.telephone || "—"}</span>
                        <span className="stkTdNum stkMuted">
                          {articles.filter((a) => a.data.fournisseurId === f.id).length}{" "}
                          produits
                        </span>
                        <span
                          className="stkRetirer handcr"
                          onClick={() => supprimerFournisseur(f)}
                        >
                          <Icon fafa="faTrash" width={10} />
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : null}

            {vue === "analyse" ? (
              <div className="stkAnalyse cosScroll">
                <div className="stkSousTitre">Valeur par catégorie</div>
                {(() => {
                  const parCat = racines.map((n) => {
                    const dans = new Set(branche(categories, n.id));
                    return {
                      nom: n.data.nom,
                      valeur: articles
                        .filter((a) => dans.has(a.data.categorieId))
                        .reduce((s, a) => s + (stocks[a.id] || 0) * pmp(a, mouvements), 0),
                    };
                  });
                  const sans = articles
                    .filter((a) => !a.data.categorieId)
                    .reduce((s, a) => s + (stocks[a.id] || 0) * pmp(a, mouvements), 0);
                  if (sans) parCat.push({ nom: "Sans catégorie", valeur: sans });

                  if (!parCat.length)
                    return <div className="stkEmptyBox">Aucun produit à valoriser.</div>;

                  const max = Math.max(1, ...parCat.map((c) => c.valeur));
                  return parCat
                    .sort((a, b) => b.valeur - a.valeur)
                    .map((c) => (
                      <div key={c.nom} className="stkJauge">
                        <span className="stkJaugeNom">{c.nom}</span>
                        <span className="stkJaugeFond">
                          <span
                            className="stkJaugeVal"
                            style={{ width: `${(c.valeur / max) * 100}%` }}
                          />
                        </span>
                        <span className="stkJaugeChiffre">{money(c.valeur)}</span>
                      </div>
                    ));
                })()}

                <div className="stkSousTitre">À réapprovisionner</div>
                {(() => {
                  const bas = articles
                    .filter((a) => etat(stocks[a.id], a.data.seuil).id !== "ok")
                    .sort((a, b) => (stocks[a.id] || 0) - (stocks[b.id] || 0));

                  if (!bas.length)
                    return (
                      <div className="stkEmptyBox">
                        Aucun produit sous son seuil. Tout est en ordre.
                      </div>
                    );

                  return bas.map((a) => {
                    const e = etat(stocks[a.id], a.data.seuil);
                    return (
                      <div
                        key={a.id}
                        className="stkAlerte handcr"
                        onClick={() => {
                          setVue("catalogue");
                          ouvrirArticle(a);
                        }}
                      >
                        <span className="stkTag" data-ton={e.ton}>
                          {e.label}
                        </span>
                        <span className="stkAlerteNom">{a.data.designation}</span>
                        <span className="stkMuted">
                          {qty(stocks[a.id] || 0)} / seuil {qty(a.data.seuil)}
                        </span>
                        <span className="stkMuted">
                          {fournisseurDe(a.data.fournisseurId)?.data.nom ||
                            "sans fournisseur"}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : null}
          </main>

          {/* ---------- Panneau ---------- */}
          <aside className="stkPanneau cosScroll">
            {fournisseurDraft ? (
              <>
                <div className="stkPanTitre">
                  {fournisseurDraft.id ? "Fournisseur" : "Nouveau fournisseur"}
                </div>
                {[
                  ["nom", "Nom"],
                  ["contact", "Contact"],
                  ["telephone", "Téléphone"],
                  ["email", "E-mail"],
                  ["ville", "Ville"],
                ].map(([cle, label]) => (
                  <label key={cle} className="stkField">
                    <span className="stkLabel">{label}</span>
                    <input
                      type="text"
                      value={fournisseurDraft[cle] || ""}
                      onChange={(e) =>
                        setFournisseurDraft((d) => ({ ...d, [cle]: e.target.value }))
                      }
                    />
                  </label>
                ))}
                <div className="stkFormActions">
                  <div
                    className="stkPrimary handcr"
                    data-off={busy}
                    onClick={enregistrerFournisseur}
                  >
                    Enregistrer
                  </div>
                  <div
                    className="stkBtnGhost handcr"
                    onClick={() => setFournisseurDraft(null)}
                  >
                    Annuler
                  </div>
                </div>
              </>
            ) : !draft ? (
              <div className="stkPanVide">
                <Icon fafa="faHandPointer" width={20} />
                <span>
                  Sélectionnez un produit pour voir sa fiche, son stock et son
                  historique.
                </span>
              </div>
            ) : (
              <>
                <div className="stkPhoto">
                  {draft.vignette ? (
                    <img src={draft.vignette} alt={draft.designation} />
                  ) : (
                    <Icon fafa="faImage" width={26} />
                  )}
                </div>
                <div className="stkPhotoActions">
                  <span className="handcr" onClick={changerImage}>
                    {draft.vignette ? "Changer l'image" : "Ajouter une image"}
                  </span>
                  {draft.vignette ? (
                    <span className="handcr stkDanger" onClick={retirerImage}>
                      Retirer
                    </span>
                  ) : null}
                </div>

                {selectedId ? (
                  <div className="stkStockGros">
                    <span
                      className="stkStockVal"
                      data-ton={etat(stocks[selectedId], draft.seuil).ton}
                    >
                      {qty(stocks[selectedId] || 0)}
                    </span>
                    <span className="stkStockUnite">{draft.unite} en stock</span>
                  </div>
                ) : null}

                <div className="stkOnglets">
                  {[
                    ["fiche", "Fiche"],
                    ["stock", "Stock"],
                    ["historique", "Historique"],
                  ].map(([id, label]) => (
                    <span
                      key={id}
                      className="handcr"
                      data-actif={onglet === id}
                      onClick={() => setOnglet(id)}
                    >
                      {label}
                    </span>
                  ))}
                </div>

                {onglet === "fiche" ? (
                  <>
                    <label className="stkField">
                      <span className="stkLabel">Désignation *</span>
                      <input
                        type="text"
                        value={draft.designation}
                        onChange={champ("designation")}
                      />
                    </label>

                    <div className="stkDeux">
                      <label className="stkField">
                        <span className="stkLabel">Référence</span>
                        <input
                          type="text"
                          value={draft.reference}
                          onChange={champ("reference")}
                        />
                      </label>
                      <label className="stkField">
                        <span className="stkLabel">Code-barres</span>
                        <input
                          type="text"
                          value={draft.codeBarre}
                          onChange={champ("codeBarre")}
                        />
                      </label>
                    </div>

                    <label className="stkField">
                      <span className="stkLabel">Catégorie</span>
                      <select value={draft.categorieId} onChange={champ("categorieId")}>
                        <option value="">Sans catégorie</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {chemin(categories, c.id)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="stkDeux">
                      <label className="stkField">
                        <span className="stkLabel">Marque</span>
                        <input
                          type="text"
                          value={draft.marque}
                          onChange={champ("marque")}
                        />
                      </label>
                      <label className="stkField">
                        <span className="stkLabel">Unité</span>
                        <select value={draft.unite} onChange={champ("unite")}>
                          {UNITES.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="stkDeux">
                      <label className="stkField">
                        <span className="stkLabel">Prix d'achat</span>
                        <input
                          type="number"
                          value={draft.prixAchat}
                          onChange={champ("prixAchat")}
                        />
                      </label>
                      <label className="stkField">
                        <span className="stkLabel">Prix de vente</span>
                        <input
                          type="number"
                          value={draft.prixVente}
                          onChange={champ("prixVente")}
                        />
                      </label>
                    </div>

                    {/* La marge se calcule, elle ne se saisit pas. L'afficher
                        en direct évite de découvrir en fin de mois qu'un
                        produit était vendu à perte. */}
                    {draft.prixVente > 0 ? (
                      <div
                        className="stkMarge"
                        data-negatif={draft.prixVente <= draft.prixAchat}
                      >
                        Marge {money(draft.prixVente - draft.prixAchat)} ·{" "}
                        {Math.round(
                          ((draft.prixVente - draft.prixAchat) / draft.prixVente) * 100,
                        )}
                        %
                      </div>
                    ) : null}

                    <div className="stkDeux">
                      <label className="stkField">
                        <span className="stkLabel">Seuil d'alerte</span>
                        <input
                          type="number"
                          value={draft.seuil}
                          onChange={champ("seuil")}
                        />
                      </label>
                      <label className="stkField">
                        <span className="stkLabel">TVA %</span>
                        <input type="number" value={draft.tva} onChange={champ("tva")} />
                      </label>
                    </div>

                    <label className="stkField">
                      <span className="stkLabel">Fournisseur</span>
                      <select
                        value={draft.fournisseurId}
                        onChange={champ("fournisseurId")}
                      >
                        <option value="">Aucun</option>
                        {fournisseurs.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.data.nom}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="stkField">
                      <span className="stkLabel">Emplacement</span>
                      <input
                        type="text"
                        placeholder="Allée B, étagère 3"
                        value={draft.emplacement}
                        onChange={champ("emplacement")}
                      />
                    </label>

                    <label className="stkField">
                      <span className="stkLabel">Description</span>
                      <textarea
                        rows={3}
                        value={draft.description}
                        onChange={champ("description")}
                      />
                    </label>

                    {selected ? <Auteur record={selected} /> : null}

                    <div className="stkFormActions">
                      <div
                        className="stkPrimary handcr"
                        data-off={busy}
                        onClick={enregistrerArticle}
                      >
                        <Icon fafa="faFloppyDisk" width={11} />
                        <span>{busy ? "…" : "Enregistrer"}</span>
                      </div>
                      {selectedId ? (
                        <div
                          className="stkBtnGhost stkDanger handcr"
                          onClick={supprimerArticle}
                        >
                          Supprimer
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}

                {onglet === "stock" ? (
                  !selectedId ? (
                    <div className="stkEmptyBox">
                      Enregistrez le produit avant d'entrer des mouvements.
                    </div>
                  ) : (
                    <>
                      <div className="stkSens3">
                        {Object.entries(SENS).map(([id, s]) => (
                          <span
                            key={id}
                            className="handcr"
                            data-actif={mvt.sens === id}
                            data-ton={s.ton}
                            onClick={() => setMvt((m) => ({ ...m, sens: id }))}
                          >
                            <Icon fafa={s.icone} width={10} />
                            {s.label}
                          </span>
                        ))}
                      </div>

                      {mvt.sens === "inventaire" ? (
                        <div className="stkNote">
                          L'inventaire ne s'ajoute pas au stock : il le remplace par la
                          quantité réellement comptée.
                        </div>
                      ) : null}

                      <div className="stkDeux">
                        <label className="stkField">
                          <span className="stkLabel">
                            {mvt.sens === "inventaire" ? "Quantité comptée" : "Quantité"}
                          </span>
                          <input
                            type="number"
                            value={mvt.quantite}
                            onChange={(e) =>
                              setMvt((m) => ({ ...m, quantite: e.target.value }))
                            }
                          />
                        </label>
                        <label className="stkField">
                          <span className="stkLabel">Date</span>
                          <input
                            type="date"
                            value={mvt.date}
                            onChange={(e) =>
                              setMvt((m) => ({ ...m, date: e.target.value }))
                            }
                          />
                        </label>
                      </div>

                      {mvt.sens === "entree" ? (
                        <label className="stkField">
                          <span className="stkLabel">Prix d'achat unitaire</span>
                          <input
                            type="number"
                            placeholder={String(draft.prixAchat || 0)}
                            value={mvt.prixUnitaire}
                            onChange={(e) =>
                              setMvt((m) => ({ ...m, prixUnitaire: e.target.value }))
                            }
                          />
                        </label>
                      ) : null}

                      <label className="stkField">
                        <span className="stkLabel">Motif</span>
                        <input
                          type="text"
                          placeholder="Livraison, vente, casse…"
                          value={mvt.motif}
                          onChange={(e) =>
                            setMvt((m) => ({ ...m, motif: e.target.value }))
                          }
                        />
                      </label>

                      <div className="stkFormActions">
                        <div
                          className="stkPrimary handcr"
                          data-off={busy}
                          onClick={ajouterMouvement}
                        >
                          Enregistrer le mouvement
                        </div>
                      </div>

                      <div className="stkRecap">
                        <span>Prix moyen pondéré</span>
                        <strong>{selected ? money(pmp(selected, mouvements)) : "—"}</strong>
                      </div>
                      <div className="stkRecap">
                        <span>Valeur du stock</span>
                        <strong>
                          {selected
                            ? money((stocks[selectedId] || 0) * pmp(selected, mouvements))
                            : "—"}
                        </strong>
                      </div>
                    </>
                  )
                ) : null}

                {onglet === "historique" ? (
                  !mouvementsArticle.length ? (
                    <div className="stkEmptyBox">Aucun mouvement pour ce produit.</div>
                  ) : (
                    <div className="stkHisto">
                      {mouvementsArticle.map((m) => {
                        const s = SENS[m.data.sens] || SENS.entree;
                        return (
                          <div key={m.id} className="stkHistoLigne">
                            <span className="stkSens" data-ton={s.ton}>
                              <Icon fafa={s.icone} width={9} />
                            </span>
                            <div className="stkHistoInfo">
                              <div className="stkHistoTitre">
                                {s.label} · {qty(m.data.quantite)} {draft.unite}
                              </div>
                              <div className="stkHistoMeta">
                                {[m.data.date, m.data.motif, m.auteur?.name]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            </div>
                            <span
                              className="stkRetirer handcr"
                              onClick={() => supprimerMouvement(m)}
                            >
                              <Icon fafa="faXmark" width={10} />
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : null}
              </>
            )}
          </aside>

          {notice ? <div className="stkNotice">{notice}</div> : null}
        </div>
      )}
    </ModuleWindow>
  );
}

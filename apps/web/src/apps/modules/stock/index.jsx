// Gestion de stock.
//
// ─────────────────────────────────────────────────────────────────────────
// LE MODÈLE
//
// La rigueur d'Odoo, la simplicité de Sortly :
//
//   - plusieurs **entrepôts** et leurs emplacements, des transferts entre
//     eux ;
//   - des **lots** avec date de péremption, sortis « premier périmé,
//     premier sorti » ;
//   - un **point de commande** calculé sur les ventes réelles, le délai du
//     fournisseur et un stock de sécurité, qui prépare les commandes des
//     Achats ;
//   - un **inventaire tournant** guidé par le classement ABC, dont les
//     écarts partent à la Comptabilité ;
//   - un **mode scan** pour le téléphone ou le lecteur de code-barres, et
//     des étiquettes à imprimer.
//
// TROIS COLLECTIONS DE TOUJOURS, ET QUATRE NOUVELLES
//
//   categories, articles, mouvements, fournisseurs   — inchangées : la
//     Facturation, la Caisse et les Achats les lisent par le référentiel ;
//   entrepots     les lieux de stockage et leurs emplacements ;
//   inventaires   les comptages, ouverts puis validés.
//
// Le stock n'est jamais stocké : il se déduit des mouvements (domaine.js).
// Un mouvement porte désormais son entrepôt, son lot, sa péremption, son
// origine ; les anciens, qui n'en ont pas, tombent dans l'entrepôt
// principal. Rien n'est migré.
//
// LES AUTRES APPLICATIONS
//
//   Caisse        chaque ticket sort ses articles (déjà en place) ;
//   Achats        chaque réception entre ses articles ; le
//                 réapprovisionnement crée ici leurs commandes ;
//   Facturation   les devis acceptés et les factures non livrées
//                 réservent le stock ; la livraison se constate ici ;
//   Comptabilité  les écarts d'inventaire lui sont proposés (6031 / 311) ;
//   Cloud         images des articles, exports, étiquettes, feuilles de
//                 comptage.
//
// La langue de l'écran suit celle du système (français ou anglais).
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { envoyerA } from "../../notifications";
import { invaliderReferentiel } from "../../referentiel";
import { etatFenetre, ouvrirFenetre } from "../../windows";
import { useEntreprise } from "../../entreprise";
import { Contenu, useChargement } from "../../chargement";
import { useDevise, useLangue, useTraduction } from "../../../utils/intl";
import { LANGUES } from "../../../utils/langue";
import { prochainNumero as numeroCommande } from "../achats/domaine";
import { arbre, niveaux, niveauxParEntrepot, pmp } from "./domaine";
import * as R from "./regles";
import { TEXTES } from "./textes";
import { Ctx } from "./commun";
import { Tableau } from "./vues/Tableau";
import { Articles } from "./vues/Articles";
import { Article } from "./vues/Article";
import { Reappro } from "./vues/Reappro";
import { Mouvements } from "./vues/Mouvements";
import { Livraisons } from "./vues/Livraisons";
import { Inventaires } from "./vues/Inventaires";
import { Scan } from "./vues/Scan";
import { Analyse } from "./vues/Analyse";
import { Categories, Fournisseurs } from "./vues/Referentiels";
import { Entrepots, Etiquettes } from "./vues/Reglages";
import "./stock.scss";
import { manifest as descriptif } from "./manifest";

export const manifest = { ...descriptif, Window: StockApp };

const NAV = [
  { groupe: "grpSuivre" },
  { id: "tableau", label: "navTableau", icone: "faChartPie", badge: "taches" },
  { groupe: "grpCatalogue" },
  { id: "articles", label: "navArticles", icone: "faBoxesStacked" },
  { id: "categories", label: "navCategories", icone: "faFolderTree" },
  { id: "fournisseurs", label: "navFournisseurs", icone: "faTruck" },
  { groupe: "grpOperations" },
  { id: "mouvements", label: "navMouvements", icone: "faRightLeft" },
  { id: "livraisons", label: "navLivraisons", icone: "faDolly", badge: "livraisons" },
  { id: "reappro", label: "navReappro", icone: "faCartArrowDown", badge: "reappro" },
  { id: "inventaires", label: "navInventaires", icone: "faClipboardCheck" },
  { id: "scan", label: "navScan", icone: "faBarcode" },
  { groupe: "grpAnalyser" },
  { id: "analyse", label: "navAnalyse", icone: "faChartColumn" },
  { groupe: "grpReglages" },
  { id: "entrepots", label: "navEntrepots", icone: "faWarehouse" },
  { id: "etiquettes", label: "navEtiquettes", icone: "faTags" },
];

const VUES = {
  tableau: Tableau,
  articles: Articles,
  article: Article,
  reappro: Reappro,
  mouvements: Mouvements,
  livraisons: Livraisons,
  inventaires: Inventaires,
  scan: Scan,
  analyse: Analyse,
  categories: Categories,
  fournisseurs: Fournisseurs,
  entrepots: Entrepots,
  etiquettes: Etiquettes,
};

function StockApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id || manifest.icon]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const t = useTraduction(TEXTES);
  const langue = useLangue();
  const { montant } = useDevise();
  const nf = useMemo(() => new Intl.NumberFormat(langue === "en" ? "en-US" : "fr-FR", { maximumFractionDigits: 2 }), [langue]);
  const q = useCallback((x) => nf.format(Number(x) || 0), [nf]);

  const [section, setSection] = useState("tableau");
  const [intention, setIntention] = useState(null);
  const [entrepotActif, setEntrepotActif] = useState("*");
  const [occupe, setOccupe] = useState(false);
  const [d, setD] = useState({
    articles: [],
    categories: [],
    mouvements: [],
    fournisseurs: [],
    entrepots: [],
    inventaires: [],
    documents: [],
    commandes: [],
    receptions: [],
    membres: [],
  });

  const charger = useCallback(async () => {
    const liste = (m, c) => api.records.list(m, c).catch(() => []);
    const [articles, categories, mouvements, fournisseurs, entrepots, inventaires, documents, commandes, receptions, membres] = await Promise.all([
      api.records.list(manifest.slug, "articles"),
      liste(manifest.slug, "categories"),
      api.records.list(manifest.slug, "mouvements"),
      liste(manifest.slug, "fournisseurs"),
      liste(manifest.slug, "entrepots"),
      liste(manifest.slug, "inventaires"),
      // Les autres applications peuvent ne pas être installées : le stock
      // reste utilisable, simplement sans réservations ni commandes.
      liste("facturation", "factures"),
      liste("achats", "commandes"),
      liste("achats", "receptions"),
      api.members().catch(() => []),
    ]);
    setD({ articles, categories, mouvements, fournisseurs, entrepots, inventaires, documents, commandes, receptions, membres });
  }, []);
  // Rechargement en direct quand un collègue modifie ces collections.
  const etat = useChargement(ouvert, charger, { ecoute: ["stock/*", "achats/*"] });
  const { entreprise } = useEntreprise(ouvert);

  /// Après toute écriture : on relit, et on prévient le reste de l'OS que
  /// le catalogue a bougé — la Facturation et la Caisse ouvertes à côté
  /// doivent le voir.
  const rafraichir = async () => {
    await etat.rafraichir();
    invaliderReferentiel();
  };

  const { articles, mouvements, documents, commandes, receptions, fournisseurs, categories, inventaires } = d;
  const entrepots = useMemo(() => R.listeEntrepots(d.entrepots), [d.entrepots]);
  const parEntrepot = useMemo(() => niveauxParEntrepot(mouvements), [mouvements]);
  const stocks = useMemo(() => niveaux(mouvements), [mouvements]);
  const couts = useMemo(() => new Map(articles.map((a) => [a.id, pmp(a, mouvements)])), [articles, mouvements]);
  const stockIci = useCallback((articleId) => R.stockDans(parEntrepot, articleId, entrepotActif), [parEntrepot, entrepotActif]);
  const reserves = useMemo(() => R.reservations(documents, mouvements), [documents, mouvements]);
  const enCommande = useMemo(() => R.quantitesEnCommande(commandes, receptions), [commandes, receptions]);
  const suggestions = useMemo(() => R.aReapprovisionner({ articles, mouvements, reserves, enCommande }), [articles, mouvements, reserves, enCommande]);
  const aLivrer = useMemo(() => R.facturesALivrer(documents, mouvements), [documents, mouvements]);
  const abc = useMemo(() => R.classesABC(articles, mouvements), [articles, mouvements]);
  const racines = useMemo(() => arbre(categories), [categories]);

  const nomFournisseur = useCallback((id) => fournisseurs.find((f) => f.id === id)?.data.nom || "", [fournisseurs]);
  const nomEntrepot = useCallback((id) => entrepots.find((e) => e.id === (id || ""))?.nom || entrepots[0]?.nom || "", [entrepots]);

  // ---- Actions ------------------------------------------------------------

  const tache = async (fn) => {
    setOccupe(true);
    try {
      return await fn();
    } catch (e) {
      modal.alert({ title: t("appNom"), message: e.message, tone: "error" });
      return null;
    } finally {
      setOccupe(false);
    }
  };

  /// Prévient les administrateurs au **franchissement** du point de
  /// commande — au passage seulement : alerter à chaque sortie sous le
  /// seuil enverrait dix messages pour le même produit dans la journée.
  const alerter = (avant, apres) => {
    const cibles = d.membres.filter((m) => ["OWNER", "ADMIN"].includes(m.role) && m.id !== session.user?.id).map((m) => m.id);
    if (!cibles.length) return;
    for (const a of articles) {
      const point = R.pointDeCommande(a, 0) || Number(a.data.seuil) || 0;
      if (!point) continue;
      const x = avant[a.id] || 0;
      const y = apres[a.id] || 0;
      if (x > point && y <= point) {
        envoyerA(cibles, {
          source: manifest.slug,
          titre: t("alerteTitre", { article: a.data.designation }),
          message: t("alerteMessage", { q: q(y), unite: a.data.unite || "", seuil: q(point) }),
          lien: { app: manifest.id, params: { article: a.id } },
        });
      }
    }
  };

  /// Enregistre des mouvements, puis relit. Le seul chemin d'écriture des
  /// quantités : c'est ici que se vérifient le stock suffisant et l'alerte.
  const enregistrerMouvements = (liste, { verifier = true } = {}) =>
    tache(async () => {
      if (verifier) {
        for (const m of liste) {
          if (m.sens !== "sortie" && m.sens !== "transfert") continue;
          const ou = m.sens === "transfert" ? m.de || "" : m.entrepotId || "";
          const dispo = R.stockDans(parEntrepot, m.articleId, ou);
          if (m.quantite > dispo) {
            const a = articles.find((x) => x.id === m.articleId);
            const ok = await modal.confirm({
              title: t("insuffisantTitre"),
              message: t("insuffisantMessage", { article: a?.data.designation || "", dispo: q(dispo), demande: q(m.quantite) }),
              confirmLabel: t("continuer"),
              danger: true,
            });
            if (!ok) return false;
          }
        }
      }
      const avant = { ...stocks };
      const ajouts = [];
      for (const m of liste) {
        const rec = await api.records.create(manifest.slug, "mouvements", { date: R.aujourdhui(), ...m });
        ajouts.push(rec);
      }
      alerter(avant, niveaux([...mouvements, ...ajouts]));
      await rafraichir();
      return true;
    });

  const supprimerMouvement = async (m) => {
    const ok = await modal.confirm({
      title: t("supprimerMvtTitre"),
      message: t("supprimerMvtMessage", { date: m.data.date, q: q(m.data.quantite) }),
      detail: t("supprimerMvtDetail"),
      confirmLabel: t("supprimer"),
      danger: true,
    });
    if (!ok) return;
    await tache(async () => {
      await api.records.remove(manifest.slug, "mouvements", m.id);
      await rafraichir();
    });
  };

  const enregistrerRecord = (collection, id, data) =>
    tache(async () => {
      const r = id
        ? await api.records.update(manifest.slug, collection, id, data)
        : await api.records.create(manifest.slug, collection, data);
      await rafraichir();
      return r;
    });

  const supprimerRecord = (collection, id) =>
    tache(async () => {
      await api.records.remove(manifest.slug, collection, id);
      await rafraichir();
      return true;
    });

  /// Les commandes des Achats, une par fournisseur, en brouillon : rien ne
  /// part chez le fournisseur sans relecture dans l'app Achats.
  const creerCommandes = (groupes) =>
    tache(async () => {
      let existantes = [...commandes];
      const creees = [];
      for (const g of groupes) {
        const data = {
          numero: numeroCommande(existantes),
          date: R.aujourdhui(),
          fournisseurId: g.fournisseurId,
          statut: "brouillon",
          lignes: R.lignesDeCommande(g.lignes),
          note: t("noteCommande"),
        };
        const rec = await api.records.create("achats", "commandes", data);
        existantes = [...existantes, rec];
        creees.push(rec);
      }
      await rafraichir();
      return creees;
    });

  /// Ouvre une autre application, si elle est installée.
  const ouvrirApp = (id) => {
    if (etatFenetre(id)) ouvrirFenetre(id);
    else modal.alert({ title: t("appNom"), message: t("appAbsente", { app: id }) });
  };

  const aller = (s, opts = null) => {
    setSection(s);
    setIntention(opts);
  };

  // Une notification ou une autre app peut ouvrir un article.
  useEffect(() => {
    const suivre = (e) => {
      if (e.detail?.app !== manifest.id) return;
      const p = e.detail.params || {};
      if (p.article) aller("article", { id: p.article });
      else if (p.section && VUES[p.section]) aller(p.section, p);
    };
    window.addEventListener("companyos:lien", suivre);
    return () => window.removeEventListener("companyos:lien", suivre);
  }, []);

  const taches = useMemo(() => {
    const perimes = R.lotsAPerimer(articles, mouvements);
    const dor = R.dormants(articles, mouvements);
    const compter = R.aCompter(articles.filter((a) => (stocks[a.id] || 0) > 0), mouvements, abc.classes).filter((a) => abc.classes[a.id] === "A");
    const commandesARecevoir = commandes.filter((c) => !["brouillon", "annulee", "recue"].includes(c.data.statut));
    return { perimes, dormants: dor, compter, commandesARecevoir };
  }, [articles, mouvements, stocks, abc, commandes]);

  const badges = {
    taches: suggestions.length + aLivrer.length + taches.perimes.length,
    livraisons: aLivrer.length,
    reappro: suggestions.length,
  };

  const valeur = {
    t,
    langue,
    q,
    m: montant,
    date: (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(langue === "en" ? "en-US" : "fr-FR", { day: "numeric", month: "short", year: "numeric" }) : ""),
    // Données
    articles,
    categories,
    racines,
    mouvements,
    fournisseurs,
    entrepots,
    entrepotsRecords: d.entrepots,
    inventaires,
    documents,
    commandes,
    receptions,
    stocks,
    parEntrepot,
    stockIci,
    couts,
    reserves,
    enCommande,
    suggestions,
    aLivrer,
    abc,
    taches,
    entrepotActif,
    setEntrepotActif,
    nomFournisseur,
    nomEntrepot,
    occupe,
    intention,
    session,
    peutAdministrer: ["OWNER", "ADMIN"].includes(session.user?.role),
    // Actions
    aller,
    tache,
    rafraichir,
    enregistrerMouvements,
    supprimerMouvement,
    enregistrerRecord,
    supprimerRecord,
    creerCommandes,
    ouvrirApp,
    entreprise,
  };

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="stoApp">
        <div className="stoVerrou">
          <Icon fafa="faLock" width={22} />
          <span>{t("verrou")}</span>
        </div>
      </ModuleWindow>
    );
  }

  const Vue = VUES[section] || Tableau;
  const sectionNav = section === "article" ? "articles" : section;

  return (
    <ModuleWindow manifest={manifest} className="stoApp">
      <Ctx.Provider value={valeur}>
        <div className="stoShell" lang={langue}>
          <aside className="stoNav cosScroll" aria-label={t("appNom")}>
            <div className="stoMarque">
              <b>{t("appNom")}</b>
              <span>{t("entrepotsCompte", { n: entrepots.length })}</span>
            </div>
            <label className="stoChampNav">
              <span>{t("entrepot")}</span>
              <select value={entrepotActif} onChange={(e) => setEntrepotActif(e.target.value)}>
                <option value="*">{t("tousEntrepots")}</option>
                {entrepots.map((e) => (
                  <option key={e.id || "principal"} value={e.id}>{e.nom}</option>
                ))}
              </select>
            </label>
            <nav>
              {NAV.map((n) =>
                n.groupe ? (
                  <div key={n.groupe} className="stoNavGroupe">{t(n.groupe)}</div>
                ) : (
                  <button
                    key={n.id}
                    type="button"
                    className="stoNavItem"
                    aria-current={sectionNav === n.id ? "page" : undefined}
                    onClick={() => aller(n.id)}
                  >
                    <Icon fafa={n.icone} width={13} />
                    <span>{t(n.label)}</span>
                    {n.badge && badges[n.badge] ? <em className="stoPastille">{badges[n.badge]}</em> : null}
                  </button>
                ),
              )}
            </nav>
            <div className="stoLangue">
              <span>{t("langueAuto")}</span>
              <b>{LANGUES.find((l) => l.code === langue)?.nom || langue}</b>
            </div>
          </aside>
          <main className="stoPage cosScroll">
            <Contenu etat={etat} vide={false} lignes={8}>
              <Vue key={`${section}-${intention?.id || ""}`} />
            </Contenu>
          </main>
        </div>
      </Ctx.Provider>
    </ModuleWindow>
  );
}

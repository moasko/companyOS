// Stock — le catalogue.

import React, { useMemo, useState } from "react";
import { branche, chemin, etat } from "../domaine";
import { Bouton, Carte, Entete, Etiquette, Vignette, csvDe, ranger, useS } from "../commun";

const FILTRES = ["tous", "rupture", "alerte", "ok", "dormant"];

export const Articles = () => {
  const s = useS();
  const { t, q, m, articles, categories, stockIci, reserves, couts, abc, suggestions, taches, intention, aller, nomFournisseur } = s;
  const [recherche, setRecherche] = useState(intention?.recherche || "");
  const [filtre, setFiltre] = useState(intention?.filtre || "tous");
  const [categorie, setCategorie] = useState(intention?.categorieId || "");
  const [tri, setTri] = useState("designation");
  const [archives, setArchives] = useState(false);

  const aCommander = useMemo(() => new Set(suggestions.map((x) => x.article.id)), [suggestions]);
  const dormants = useMemo(() => new Set(taches.dormants.map((x) => x.article.id)), [taches.dormants]);

  const etatDe = (a) => {
    const st = stockIci(a.id);
    if (st <= 0) return "rupture";
    if (aCommander.has(a.id) || etat(st, a.data.seuil).id === "alerte") return "alerte";
    return "ok";
  };

  const visibles = useMemo(() => {
    const r = recherche.trim().toLowerCase();
    const dans = categorie === "__sans__" ? null : categorie ? new Set(branche(categories, categorie)) : null;
    const liste = articles.filter((a) => {
      if (!archives && a.data.archive) return false;
      if (categorie === "__sans__" && a.data.categorieId) return false;
      if (dans && !dans.has(a.data.categorieId)) return false;
      if (filtre === "dormant" && !dormants.has(a.id)) return false;
      if (!["tous", "dormant"].includes(filtre) && etatDe(a) !== filtre) return false;
      if (!r) return true;
      return [a.data.reference, a.data.designation, a.data.codeBarre, a.data.marque].filter(Boolean).some((x) => String(x).toLowerCase().includes(r));
    });
    const cle = {
      designation: (a) => (a.data.designation || "").toLowerCase(),
      stock: (a) => stockIci(a.id),
      valeur: (a) => -Math.max(0, stockIci(a.id)) * (couts.get(a.id) || 0),
      classe: (a) => abc.classes[a.id] || "C",
    }[tri];
    return [...liste].sort((x, y) => {
      const a = cle(x);
      const b = cle(y);
      return typeof a === "string" ? a.localeCompare(b, "fr") : a - b;
    });
  }, [articles, categories, categorie, filtre, recherche, tri, archives, stockIci, couts, abc, dormants]); // eslint-disable-line react-hooks/exhaustive-deps

  const exporter = () => {
    const lignes = [
      [t("reference"), t("designation"), t("categorie"), t("fournisseur"), t("unite"), t("enStock"), t("reserve"), t("pmp"), t("valeur"), t("prixVente"), t("classe"), t("etat")],
      ...visibles.map((a) => {
        const st = stockIci(a.id);
        return [a.data.reference, a.data.designation, chemin(categories, a.data.categorieId), nomFournisseur(a.data.fournisseurId), a.data.unite, st, reserves[a.id] || 0, Math.round(couts.get(a.id) || 0), Math.round(st * (couts.get(a.id) || 0)), a.data.prixVente, abc.classes[a.id] || "C", t(`etat_${etatDe(a)}`)];
      }),
    ];
    return ranger(new Blob([csvDe(lignes)], { type: "text/csv;charset=utf-8" }), "stock.csv", t);
  };

  return (
    <div className="stoVue">
      <Entete titre={t("navArticles")} sous={t("sousArticles", { n: visibles.length, total: articles.length })}>
        <input className="stoRecherche" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder={t("rechercheArticle")} aria-label={t("rechercheArticle")} />
        <Bouton icone="faFileCsv" onClick={exporter}>{t("exporter")}</Bouton>
        <Bouton icone="faTags" onClick={() => aller("etiquettes", { ids: visibles.map((a) => a.id) })}>{t("navEtiquettes")}</Bouton>
        <Bouton variante="principal" icone="faPlus" onClick={() => aller("article", { id: "nouveau", categorieId: categorie && categorie !== "__sans__" ? categorie : "" })}>{t("nouvelArticle")}</Bouton>
      </Entete>
      <div className="stoConteneur">
        <div className="stoFiltres">
          {FILTRES.map((f) => (
            <button key={f} type="button" aria-pressed={filtre === f} onClick={() => setFiltre(f)}>{t(`filtre_${f}`)}</button>
          ))}
          <select value={categorie} onChange={(e) => setCategorie(e.target.value)} aria-label={t("categorie")}>
            <option value="">{t("toutesCategories")}</option>
            <option value="__sans__">{t("sansCategorie")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{chemin(categories, c.id)}</option>
            ))}
          </select>
          <select value={tri} onChange={(e) => setTri(e.target.value)} aria-label={t("trier")}>
            {["designation", "stock", "valeur", "classe"].map((k) => (
              <option key={k} value={k}>{t(`tri_${k}`)}</option>
            ))}
          </select>
          <label className="stoCase">
            <input type="checkbox" checked={archives} onChange={(e) => setArchives(e.target.checked)} />
            <span>{t("voirArchives")}</span>
          </label>
        </div>

        <Carte>
          {visibles.length ? (
            <div className="stoTableau" role="table">
              <div className="stoLigneT stoEnteteT stoColsArticles" role="row">
                <span />
                <span>{t("article")}</span>
                <span>{t("categorie")}</span>
                <span>{t("classe")}</span>
                <span className="stoMt">{t("enStock")}</span>
                <span className="stoMt">{t("disponible")}</span>
                <span className="stoMt">{t("valeur")}</span>
                <span>{t("etat")}</span>
              </div>
              {visibles.map((a) => {
                const st = stockIci(a.id);
                const e = etatDe(a);
                return (
                  <button type="button" key={a.id} className="stoLigneT stoColsArticles" role="row" onClick={() => aller("article", { id: a.id })}>
                    <Vignette article={a} taille={36} />
                    <span className="stoQui">
                      <b className="stoEllipse">{a.data.designation}</b>
                      <small className="stoDoux">{[a.data.reference, a.data.marque].filter(Boolean).join(" · ")}</small>
                    </span>
                    <span className="stoEllipse stoDoux">{chemin(categories, a.data.categorieId) || "—"}</span>
                    <span><b className="stoClasse" data-classe={abc.classes[a.id] || "C"}>{abc.classes[a.id] || "C"}</b></span>
                    <b className="stoMt">{q(st)} <small className="stoDoux">{a.data.unite}</small></b>
                    <span className="stoMt">{q(st - (reserves[a.id] || 0))}</span>
                    <span className="stoMt">{m(Math.max(0, st) * (couts.get(a.id) || 0))}</span>
                    <span><Etiquette ton={e}>{t(`etat_${e}`)}</Etiquette>{a.data.archive ? <Etiquette>{t("archive")}</Etiquette> : null}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="stoRien">{articles.length ? t("aucunResultat") : t("catalogueVide")}</p>
          )}
        </Carte>
      </div>
    </div>
  );
};

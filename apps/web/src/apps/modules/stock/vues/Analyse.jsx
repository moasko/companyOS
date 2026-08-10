// L'analyse : où dort l'argent, et ce qu'il faut racheter.
//
// Les deux blocs se recalculent à chaque rendu plutôt que d'être mémorisés :
// ils ne portent que sur les catégories racines et sur les articles sous
// leur seuil, deux listes courtes même dans un gros catalogue.

import React from "react";
import { montant as money } from "../../../../utils/monnaie";
import { branche, etat, pmp, qty } from "../domaine";

export const Analyse = ({
  racines,
  categories,
  articles,
  stocks,
  mouvements,
  fournisseurDe,
  setVue,
  ouvrirArticle,
}) => (
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
);

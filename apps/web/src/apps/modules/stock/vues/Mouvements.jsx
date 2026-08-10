// Le journal des mouvements, toutes catégories confondues.
//
// On n'en montre que les trois cents plus récents : au-delà, la page devient
// illisible et lente, et l'historique complet d'un produit se lit dans sa
// fiche.

import React from "react";
import { Icon } from "../../../../utils/general";
import { SENS, qty } from "../domaine";

export const Mouvements = ({ mouvements, articles, setVue, ouvrirArticle }) =>
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
  );

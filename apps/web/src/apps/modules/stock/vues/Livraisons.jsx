// Stock — livraisons : les factures émises dont la marchandise n'est pas
// encore sortie. Livrer, c'est créer leurs sorties (origine `facture:<id>`),
// ce qui les retire d'ici et libère la réservation.

import React, { useMemo, useState } from "react";
import { sortiesDeFacture } from "../regles";
import { Bouton, Carte, Entete, Etiquette, useS } from "../commun";

export const Livraisons = () => {
  const s = useS();
  const { t, q, m, date, aLivrer, articles, entrepots, entrepotActif, parEntrepot, enregistrerMouvements, ouvrirApp, occupe } = s;
  const [ou, setOu] = useState(entrepotActif !== "*" ? entrepotActif : entrepots[0]?.id ?? "");
  const parId = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);

  const livrer = async (doc) => {
    await enregistrerMouvements(sortiesDeFacture(doc, ou));
  };

  return (
    <div className="stoVue">
      <Entete titre={t("navLivraisons")} sous={t("sousLivraisons", { n: aLivrer.length })}>
        <label className="stoChampTete">
          <span>{t("livrerDepuis")}</span>
          <select value={ou} onChange={(e) => setOu(e.target.value)}>
            {entrepots.map((e) => <option key={e.id || "p"} value={e.id}>{e.nom}</option>)}
          </select>
        </label>
        <Bouton icone="faFileInvoice" onClick={() => ouvrirApp("facturation")}>{t("ouvrirFacturation")}</Bouton>
      </Entete>
      <div className="stoConteneur">
        <div className="stoEncadre">
          <b>{t("livraisonsComment")}</b>
          <span>{t("livraisonsExplication")}</span>
        </div>
        {!aLivrer.length ? (
          <Carte>
            <p className="stoRien">{t("rienALivrer")}</p>
          </Carte>
        ) : (
          aLivrer.map((doc) => {
            const lignes = (doc.data.lignes || []).filter((l) => l.articleId);
            const manque = lignes.some((l) => (parEntrepot[l.articleId]?.[ou] || 0) < Number(l.qte || l.quantite));
            return (
              <Carte
                key={doc.id}
                titre={[doc.data.numero || t("facture"), doc.data.clientEntreprise || doc.data.clientNom].filter(Boolean).join(" · ")}
                aide={t("factureDu", { date: date(doc.data.date) })}
                actions={
                  <>
                    {manque ? <Etiquette ton="alerte">{t("stockInsuffisant")}</Etiquette> : null}
                    <Bouton variante="principal" icone="faDolly" disabled={occupe} onClick={() => livrer(doc)}>{t("livrer")}</Bouton>
                  </>
                }
              >
                <div className="stoTableau" role="table">
                  <div className="stoLigneT stoEnteteT stoColsLivraison" role="row">
                    <span>{t("article")}</span>
                    <span className="stoMt">{t("quantite")}</span>
                    <span className="stoMt">{t("enStock")}</span>
                    <span className="stoMt">{t("montant")}</span>
                  </div>
                  {lignes.map((l, i) => {
                    const a = parId.get(l.articleId);
                    const qte = Number(l.qte || l.quantite);
                    const dispo = parEntrepot[l.articleId]?.[ou] || 0;
                    return (
                      <div key={`${l.articleId}-${i}`} className="stoLigneT stoColsLivraison" role="row">
                        <span className="stoEllipse">{a?.data.designation || l.designation}</span>
                        <b className="stoMt">{q(qte)}</b>
                        <span className="stoMt" data-ton={dispo < qte ? "rouge" : ""}>{q(dispo)}</span>
                        <span className="stoMt stoDoux">{m(qte * (Number(l.pu) || 0))}</span>
                      </div>
                    );
                  })}
                </div>
              </Carte>
            );
          })
        )}
      </div>
    </div>
  );
};

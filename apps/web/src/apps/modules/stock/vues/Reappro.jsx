// Stock — réapprovisionnement : les suggestions, groupées par fournisseur,
// deviennent des commandes en brouillon dans les Achats.

import React, { useMemo, useState } from "react";
import { modal } from "../../../modalRequest";
import { parFournisseur } from "../regles";
import { Bouton, Carte, Entete, Etiquette, Vignette, nombre, useS } from "../commun";

export const Reappro = () => {
  const s = useS();
  const { t, q, m, suggestions, nomFournisseur, aller, creerCommandes, ouvrirApp, occupe } = s;
  // Quantités modifiées et lignes décochées, par article.
  const [qtes, setQtes] = useState({});
  const [exclus, setExclus] = useState(() => new Set());

  const lignes = useMemo(
    () =>
      suggestions.map((x) => {
        const qte = qtes[x.article.id] !== undefined ? nombre(qtes[x.article.id]) : x.qte;
        return { ...x, qte, montant: Math.round(qte * x.pu) };
      }),
    [suggestions, qtes],
  );
  const groupes = useMemo(() => parFournisseur(lignes.filter((x) => !exclus.has(x.article.id) && x.qte > 0)), [lignes, exclus]);
  const tousGroupes = useMemo(() => parFournisseur(lignes), [lignes]);
  const sansFournisseur = groupes.find((g) => !g.fournisseurId);
  const aCreer = groupes.filter((g) => g.fournisseurId);
  const total = aCreer.reduce((x, g) => x + g.total, 0);

  const basculer = (id) =>
    setExclus((e) => {
      const n = new Set(e);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const creer = async () => {
    const creees = await creerCommandes(aCreer);
    if (!creees) return;
    setQtes({});
    const ok = await modal.confirm({
      title: t("commandesCreees", { n: creees.length }),
      message: t("commandesCreeesD", { numeros: creees.map((c) => c.data.numero).join(", ") }),
      confirmLabel: t("ouvrirAchats"),
      cancelLabel: t("fermer"),
    });
    if (ok) ouvrirApp("achats");
  };

  return (
    <div className="stoVue">
      <Entete titre={t("navReappro")} sous={t("sousReappro", { n: suggestions.length, f: tousGroupes.filter((g) => g.fournisseurId).length })}>
        <Bouton variante="principal" icone="faCartArrowDown" disabled={!aCreer.length || occupe} onClick={creer}>
          {t("creerCommandes", { n: aCreer.length })}
        </Bouton>
      </Entete>
      <div className="stoConteneur">
        <div className="stoEncadre">
          <b>{t("reapproComment")}</b>
          <span>{t("reapproExplication")}</span>
        </div>

        {!suggestions.length ? (
          <Carte>
            <p className="stoRien">{t("rienACommander")}</p>
          </Carte>
        ) : (
          tousGroupes.map((g) => (
            <Carte
              key={g.fournisseurId || "aucun"}
              titre={g.fournisseurId ? nomFournisseur(g.fournisseurId) : t("sansFournisseur")}
              aide={g.fournisseurId ? t("groupeAide", { n: g.lignes.length, montant: m(g.lignes.filter((x) => !exclus.has(x.article.id)).reduce((a, b) => a + b.montant, 0)) }) : t("sansFournisseurAide")}
              ton={g.fournisseurId ? "" : "orange"}
            >
              <div className="stoTableau" role="table">
                <div className="stoLigneT stoEnteteT stoColsReappro" role="row">
                  <span />
                  <span>{t("article")}</span>
                  <span className="stoMt">{t("disponible")}</span>
                  <span className="stoMt">{t("enCommande")}</span>
                  <span className="stoMt">{t("consoJour")}</span>
                  <span className="stoMt">{t("pointCommande")}</span>
                  <span className="stoMt">{t("aCommander")}</span>
                  <span className="stoMt">{t("montant")}</span>
                </div>
                {g.lignes.map((x) => (
                  <div key={x.article.id} className="stoLigneT stoColsReappro" role="row" data-off={exclus.has(x.article.id) || undefined}>
                    <input type="checkbox" checked={!exclus.has(x.article.id)} onChange={() => basculer(x.article.id)} aria-label={x.article.data.designation} disabled={!g.fournisseurId} />
                    <button type="button" className="stoQui stoQuiLien" onClick={() => aller("article", { id: x.article.id })}>
                      <Vignette article={x.article} taille={30} />
                      <span>
                        <b className="stoEllipse">{x.article.data.designation}</b>
                        <small className="stoDoux">
                          {x.rupture ? <Etiquette ton="rupture">{t("etat_rupture")}</Etiquette> : null}
                          {x.couverture != null ? t("couvertureJours", { n: Math.round(x.couverture) }) : t("sansVentes")}
                        </small>
                      </span>
                    </button>
                    <span className="stoMt">{q(x.dispo)}</span>
                    <span className="stoMt stoDoux">{x.enCommande ? q(x.enCommande) : "—"}</span>
                    <span className="stoMt stoDoux">{x.conso ? q(Math.round(x.conso * 10) / 10) : "—"}</span>
                    <span className="stoMt">{q(x.point)}</span>
                    <span className="stoMt">
                      <input
                        className="stoQte"
                        inputMode="decimal"
                        value={qtes[x.article.id] ?? String(suggestions.find((y) => y.article.id === x.article.id)?.qte ?? "")}
                        onChange={(e) => setQtes((v) => ({ ...v, [x.article.id]: e.target.value }))}
                        aria-label={t("aCommander")}
                        disabled={!g.fournisseurId}
                      />
                    </span>
                    <b className="stoMt">{m(x.montant)}</b>
                  </div>
                ))}
              </div>
              {!g.fournisseurId ? (
                <p className="stoAide">{t("choisirFournisseur")}</p>
              ) : null}
            </Carte>
          ))
        )}

        {aCreer.length ? (
          <div className="stoPied">
            <span>{t("totalCommandes", { n: aCreer.length, montant: m(total) })}</span>
            {sansFournisseur ? <span className="stoDoux">{t("lignesIgnorees", { n: sansFournisseur.lignes.length })}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

// Stock — l'historique complet des mouvements.

import React, { useMemo, useState } from "react";
import { Icon } from "../../../../utils/general";
import { Bouton, Carte, Entete, Etiquette, csvDe, ranger, useS } from "../commun";
import { saisirMouvement } from "./FormMouvement";

const TYPES = ["tous", "entree", "sortie", "transfert", "inventaire"];
const PAR_PAGE = 100;

export const Mouvements = () => {
  const s = useS();
  const { t, q, date, articles, mouvements, entrepotActif, nomEntrepot, aller, peutAdministrer, supprimerMouvement } = s;
  const [type, setType] = useState("tous");
  const [recherche, setRecherche] = useState("");
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");
  const [limite, setLimite] = useState(PAR_PAGE);
  const parId = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);

  const visibles = useMemo(() => {
    const r = recherche.trim().toLowerCase();
    return [...mouvements]
      .filter((x) => type === "tous" || x.data.sens === type)
      .filter((x) => entrepotActif === "*" || [x.data.entrepotId || "", x.data.de || "", x.data.vers || ""].includes(entrepotActif))
      .filter((x) => (!du || x.data.date >= du) && (!au || x.data.date <= au))
      .filter((x) => {
        if (!r) return true;
        const a = parId.get(x.data.articleId);
        return [a?.data.designation, a?.data.reference, x.data.motif, x.data.lot].filter(Boolean).some((v) => String(v).toLowerCase().includes(r));
      })
      .sort((a, b) => String(b.data.date).localeCompare(String(a.data.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [mouvements, type, entrepotActif, du, au, recherche, parId]);

  const lieu = (x) =>
    x.data.sens === "transfert"
      ? `${nomEntrepot(x.data.de)} → ${nomEntrepot(x.data.vers)}`
      : [nomEntrepot(x.data.entrepotId), x.data.emplacement].filter(Boolean).join(" · ");

  const exporter = () =>
    ranger(
      new Blob(
        [
          csvDe([
            [t("date"), t("reference"), t("designation"), t("type"), t("quantite"), t("lieu"), t("lot"), t("peremption"), t("prixUnitaire"), t("motif"), t("origine")],
            ...visibles.map((x) => {
              const a = parId.get(x.data.articleId);
              return [x.data.date, a?.data.reference, a?.data.designation, t(`sens_${x.data.sens}`), x.data.quantite, lieu(x), x.data.lot, x.data.peremption, x.data.prixUnitaire, x.data.motif, x.data.origine];
            }),
          ]),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
      "mouvements.csv",
      t,
    );

  return (
    <div className="stoVue">
      <Entete titre={t("navMouvements")} sous={t("sousMouvements", { n: visibles.length })}>
        <input className="stoRecherche" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder={t("rechercheMouvement")} aria-label={t("rechercheMouvement")} />
        <Bouton icone="faFileCsv" onClick={exporter} disabled={!visibles.length}>{t("exporter")}</Bouton>
        <Bouton variante="principal" icone="faPlus" onClick={() => saisirMouvement(s)}>{t("nouveauMouvement")}</Bouton>
      </Entete>
      <div className="stoConteneur">
        <div className="stoFiltres">
          {TYPES.map((k) => (
            <button key={k} type="button" aria-pressed={type === k} onClick={() => setType(k)}>
              {k === "tous" ? t("filtre_tous") : t(`sens_${k}`)}
            </button>
          ))}
          <label className="stoPeriode">
            <span>{t("du")}</span>
            <input type="date" value={du} onChange={(e) => setDu(e.target.value)} />
          </label>
          <label className="stoPeriode">
            <span>{t("au")}</span>
            <input type="date" value={au} onChange={(e) => setAu(e.target.value)} />
          </label>
        </div>
        <Carte>
          <div className="stoTableau" role="table">
            <div className="stoLigneT stoEnteteT stoColsHisto" role="row">
              <span>{t("date")}</span>
              <span>{t("article")}</span>
              <span>{t("type")}</span>
              <span className="stoMt">{t("quantite")}</span>
              <span>{t("lieu")}</span>
              <span>{t("lot")}</span>
              <span>{t("motif")}</span>
              <span />
            </div>
            {visibles.slice(0, limite).map((x) => {
              const a = parId.get(x.data.articleId);
              const signe = x.data.sens === "entree" ? "+ " : x.data.sens === "sortie" ? "− " : x.data.sens === "inventaire" ? "= " : "";
              return (
                <div key={x.id} className="stoLigneT stoColsHisto" role="row">
                  <span className="stoDoux">{date(x.data.date)}</span>
                  <button type="button" className="stoLienTexte stoEllipse" onClick={() => a && aller("article", { id: a.id })}>
                    {a?.data.designation || t("articleSupprime")}
                  </button>
                  <span><Etiquette ton={x.data.sens}>{t(`sens_${x.data.sens}`)}</Etiquette></span>
                  <b className="stoMt" data-sens={x.data.sens}>{signe}{q(x.data.quantite)}</b>
                  <span className="stoEllipse stoDoux">{lieu(x)}</span>
                  <span className="stoEllipse stoDoux">{x.data.lot || "—"}</span>
                  <span className="stoEllipse stoDoux" title={x.data.origine || ""}>{x.data.motif || "—"}</span>
                  <span>
                    {peutAdministrer && !x.data.origine ? (
                      <button type="button" className="stoIcone" onClick={() => supprimerMouvement(x)} aria-label={t("supprimer")} title={t("supprimer")}>
                        <Icon fafa="faTrash" width={11} />
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })}
            {!visibles.length ? <p className="stoRien">{t("aucunMouvement")}</p> : null}
          </div>
          {visibles.length > limite ? (
            <div className="stoPlus">
              <Bouton onClick={() => setLimite((l) => l + PAR_PAGE)}>{t("voirPlus", { n: visibles.length - limite })}</Bouton>
            </div>
          ) : null}
        </Carte>
      </div>
    </div>
  );
};

// Stock — analyse : où dort l'argent, ce qui tourne, ce qui ne bouge plus.

import React, { useMemo } from "react";
import { rapportPdf } from "../../comptabilite/pdf";
import { branche } from "../domaine";
import { syntheseEntrepots } from "../regles";
import { Bouton, Carte, Entete, Kpi, csvDe, ranger, useS } from "../commun";

const Barres = ({ lignes, m }) => {
  const max = Math.max(1, ...lignes.map((l) => l.valeur));
  return (
    <ul className="stoBarres">
      {lignes.map((l) => (
        <li key={l.cle}>
          <span className="stoEllipse">{l.nom}</span>
          <span className="stoPiste"><span style={{ width: `${Math.round((l.valeur / max) * 100)}%` }} /></span>
          <b className="stoMt">{m(l.valeur)}</b>
        </li>
      ))}
    </ul>
  );
};

export const Analyse = () => {
  const s = useS();
  const { t, q, m, date, articles, categories, racines, mouvements, stocks, couts, entrepots, abc, taches, aller, entreprise, tache } = s;
  const actifs = articles.filter((a) => !a.data.archive);
  const valeurDe = (a) => Math.max(0, stocks[a.id] || 0) * (couts.get(a.id) || 0);
  const total = actifs.reduce((x, a) => x + valeurDe(a), 0);

  const parCategorie = useMemo(() => {
    const out = racines.map((n) => {
      const dans = new Set(branche(categories, n.id));
      return { cle: n.id, nom: n.data.nom, valeur: actifs.filter((a) => dans.has(a.data.categorieId)).reduce((x, a) => x + valeurDe(a), 0) };
    });
    const sans = actifs.filter((a) => !a.data.categorieId || !categories.some((c) => c.id === a.data.categorieId)).reduce((x, a) => x + valeurDe(a), 0);
    if (sans) out.push({ cle: "sans", nom: t("sansCategorie"), valeur: sans });
    return out.filter((x) => x.valeur > 0).sort((a, b) => b.valeur - a.valeur);
  }, [racines, categories, actifs, stocks, couts]); // eslint-disable-line react-hooks/exhaustive-deps

  const parEntrepot = useMemo(
    () => syntheseEntrepots(entrepots, actifs, mouvements).map((e) => ({ cle: e.id || "p", nom: e.nom, valeur: e.valeur })),
    [entrepots, actifs, mouvements],
  );

  const top = useMemo(() => [...actifs].sort((a, b) => valeurDe(b) - valeurDe(a)).slice(0, 10), [actifs, stocks, couts]); // eslint-disable-line react-hooks/exhaustive-deps
  const valeurDormante = taches.dormants.reduce((x, y) => x + y.valeur, 0);

  const exporterCsv = () =>
    ranger(
      new Blob(
        [
          csvDe([
            [t("reference"), t("designation"), t("classe"), t("enStock"), t("pmp"), t("valeur"), t("dormant")],
            ...actifs.map((a) => [a.data.reference, a.data.designation, abc.classes[a.id] || "C", stocks[a.id] || 0, Math.round(couts.get(a.id) || 0), Math.round(valeurDe(a)), taches.dormants.some((d) => d.article.id === a.id) ? "1" : ""]),
          ]),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
      "valorisation-stock.csv",
      t,
    );

  const exporterPdf = () =>
    tache(() => {
      const lignes = [];
      lignes.push({ cellules: [t("parCategorie")], style: "titre" });
      for (const c of parCategorie) lignes.push({ cellules: [c.nom, "", "", m(c.valeur)] });
      lignes.push({ cellules: [t("parEntrepot")], style: "titre" });
      for (const e of parEntrepot) lignes.push({ cellules: [e.nom, "", "", m(e.valeur)] });
      lignes.push({ cellules: [t("detailArticles")], style: "titre" });
      for (const a of [...actifs].sort((x, y) => valeurDe(y) - valeurDe(x))) {
        if (!valeurDe(a)) continue;
        lignes.push({ cellules: [`${a.data.reference || ""} ${a.data.designation}`.trim(), q(stocks[a.id] || 0), m(couts.get(a.id) || 0), m(valeurDe(a))] });
      }
      lignes.push({ cellules: [t("total"), "", "", m(total)], style: "total" });
      const blob = rapportPdf({
        titre: t("valorisationTitre"),
        sousTitre: t("auDate", { date: date(new Date().toISOString().slice(0, 10)) }),
        entreprise,
        colonnes: [
          { label: t("article"), largeur: 0.52 },
          { label: t("quantite"), largeur: 0.14, align: "right" },
          { label: t("pmp"), largeur: 0.16, align: "right" },
          { label: t("valeur"), largeur: 0.18, align: "right" },
        ],
        lignes,
        notes: [t("valorisationNote")],
      });
      return ranger(blob, "valorisation-stock.pdf", t);
    });

  return (
    <div className="stoVue">
      <Entete titre={t("navAnalyse")} sous={t("sousAnalyse")}>
        <Bouton icone="faFileCsv" onClick={exporterCsv}>{t("exporter")}</Bouton>
        <Bouton icone="faFilePdf" onClick={exporterPdf}>{t("valorisationPdf")}</Bouton>
      </Entete>
      <div className="stoConteneur">
        <section className="stoKpis">
          <Kpi label={t("kValeur")} valeur={m(total)} aide={t("kValeurD")} />
          <Kpi label={t("classeA")} valeur={String(abc.resume.A.n)} aide={t("abcLigne", { n: abc.resume.A.n, p: Math.round(abc.resume.A.part * 100) })} />
          <Kpi label={t("kDormants")} valeur={m(valeurDormante)} aide={t("articlesN", { n: taches.dormants.length })} ton={taches.dormants.length ? "orange" : ""} />
          <Kpi label={t("kReferences")} valeur={String(actifs.length)} aide={t("enStockN", { n: actifs.filter((a) => (stocks[a.id] || 0) > 0).length })} />
        </section>
        <div className="stoGrille stoGrilleEgale">
          <Carte titre={t("parCategorie")}>
            {parCategorie.length ? <Barres lignes={parCategorie} m={m} /> : <p className="stoRien">{t("rienAValoriser")}</p>}
          </Carte>
          <Carte titre={t("parEntrepot")}>
            <Barres lignes={parEntrepot} m={m} />
          </Carte>
        </div>
        <div className="stoGrille stoGrilleEgale">
          <Carte titre={t("topValeur")}>
            <div className="stoTableau" role="table">
              {top.map((a) => (
                <button type="button" key={a.id} className="stoLigneT stoColsTop" role="row" onClick={() => aller("article", { id: a.id })}>
                  <b className="stoClasse" data-classe={abc.classes[a.id] || "C"}>{abc.classes[a.id] || "C"}</b>
                  <span className="stoEllipse">{a.data.designation}</span>
                  <span className="stoMt stoDoux">{q(stocks[a.id] || 0)}</span>
                  <b className="stoMt">{m(valeurDe(a))}</b>
                </button>
              ))}
            </div>
          </Carte>
          <Carte titre={t("dormantsTitre")} aide={t("dormantsAide")}>
            {taches.dormants.length ? (
              <div className="stoTableau" role="table">
                {taches.dormants.map((d) => (
                  <button type="button" key={d.article.id} className="stoLigneT stoColsTop" role="row" onClick={() => aller("article", { id: d.article.id })}>
                    <span />
                    <span className="stoQui">
                      <b className="stoEllipse">{d.article.data.designation}</b>
                      <small className="stoDoux">{d.depuis ? t("derniereSortie", { date: date(d.depuis) }) : t("jamaisSorti")}</small>
                    </span>
                    <span className="stoMt stoDoux">{q(d.stock)}</span>
                    <b className="stoMt">{m(d.valeur)}</b>
                  </button>
                ))}
              </div>
            ) : (
              <p className="stoRien">{t("aucunDormant")}</p>
            )}
          </Carte>
        </div>
      </div>
    </div>
  );
};

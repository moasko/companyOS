// Stock — tableau de bord et « À faire ».

import React, { useMemo, useState } from "react";
import { Icon } from "../../../../utils/general";
import { SENS } from "../domaine";
import { parCode, syntheseEntrepots } from "../regles";
import { Bouton, Carte, Entete, Etiquette, Kpi, Puce, useS } from "../commun";
import { saisirMouvement } from "./FormMouvement";

export const Tableau = () => {
  const s = useS();
  const { t, q, m, date, articles, mouvements, stockIci, couts, suggestions, aLivrer, taches, abc, entrepots, entrepotActif, nomEntrepot, aller } = s;
  const [recherche, setRecherche] = useState("");

  const actifs = articles.filter((a) => !a.data.archive);
  const valeur = useMemo(() => actifs.reduce((t2, a) => t2 + Math.max(0, stockIci(a.id)) * (couts.get(a.id) || 0), 0), [actifs, stockIci, couts]);
  const ruptures = actifs.filter((a) => stockIci(a.id) <= 0);
  const syntheses = useMemo(() => syntheseEntrepots(entrepots, actifs, mouvements), [entrepots, actifs, mouvements]);
  const totalCommande = suggestions.reduce((x, y) => x + y.montant, 0);
  const valeurPerimes = taches.perimes.reduce((x, y) => x + y.valeur, 0);

  const derniers = useMemo(
    () =>
      [...mouvements]
        .filter((x) => entrepotActif === "*" || [x.data.entrepotId || "", x.data.de || "", x.data.vers || ""].includes(entrepotActif) )
        .sort((a, b) => String(b.data.date).localeCompare(String(a.data.date)) || String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 8),
    [mouvements, entrepotActif],
  );
  const parId = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);

  const liste = [
    suggestions.length && {
      id: "reappro", n: suggestions.length, ton: "accent",
      titre: t("tReappro", { n: suggestions.length }),
      detail: t("tReapproD", { montant: m(totalCommande) }),
      action: t("preparerCommandes"), aller: () => aller("reappro"),
    },
    aLivrer.length && {
      id: "livraisons", n: aLivrer.length, ton: "bleu",
      titre: t("tLivrer", { n: aLivrer.length }),
      detail: aLivrer.slice(0, 3).map((x) => x.data.numero).join(", "),
      action: t("livrer"), aller: () => aller("livraisons"),
    },
    taches.perimes.length && {
      id: "perimes", n: taches.perimes.length, ton: "orange",
      titre: t("tPerimes", { n: taches.perimes.length }),
      detail: taches.perimes.slice(0, 2).map((x) => `${x.article.data.designation} ${x.lot} (${date(x.peremption)})`).join(", "),
      action: t("voirLots"), aller: () => aller("article", { id: taches.perimes[0].article.id }),
    },
    taches.commandesARecevoir.length && {
      id: "receptions", n: taches.commandesARecevoir.length, ton: "bleu",
      titre: t("tReceptions", { n: taches.commandesARecevoir.length }),
      detail: taches.commandesARecevoir.slice(0, 3).map((c) => c.data.numero).join(", "),
      action: t("ouvrirAchats"), aller: () => s.ouvrirApp?.("achats"),
    },
    taches.compter.length && {
      id: "compter", n: "A", ton: "",
      titre: t("tCompter", { n: taches.compter.length }),
      detail: t("tCompterD"),
      action: t("compter"), aller: () => aller("inventaires", { nouveau: true }),
    },
    taches.dormants.length && {
      id: "dormants", n: taches.dormants.length, ton: "",
      titre: t("tDormants", { n: taches.dormants.length }),
      detail: t("tDormantsD", { montant: m(taches.dormants.reduce((x, y) => x + y.valeur, 0)) }),
      action: t("examiner"), aller: () => aller("analyse"),
    },
  ].filter(Boolean);

  const chercher = (e) => {
    e.preventDefault();
    const a = parCode(articles, recherche) || articles.find((x) => (x.data.designation || "").toLowerCase().includes(recherche.trim().toLowerCase()));
    if (a) aller("article", { id: a.id });
    else aller("articles", { recherche });
  };

  return (
    <div className="stoVue">
      <Entete titre={t("navTableau")} sous={t("sousTableau", { n: actifs.length, m: mouvements.length })}>
        <form onSubmit={chercher} className="stoRechercheForm">
          <input className="stoRecherche" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder={t("rechercheArticle")} aria-label={t("rechercheArticle")} />
        </form>
        <Bouton icone="faBarcode" onClick={() => aller("scan")}>{t("navScan")}</Bouton>
        <Bouton variante="principal" icone="faPlus" onClick={() => saisirMouvement(s)}>{t("nouveauMouvement")}</Bouton>
      </Entete>

      <div className="stoConteneur">
        <section className="stoKpis">
          <Kpi label={t("kValeur")} valeur={m(valeur)} aide={entrepotActif === "*" ? t("kValeurD") : nomEntrepot(entrepotActif)} onClick={() => aller("analyse")} />
          <Kpi label={t("kRupture")} valeur={String(ruptures.length)} aide={ruptures.slice(0, 3).map((a) => a.data.designation).join(", ") || t("aucune")} ton={ruptures.length ? "rouge" : ""} onClick={() => aller("articles", { filtre: "rupture" })} />
          <Kpi label={t("kPoint")} valeur={String(suggestions.length)} aide={suggestions.length ? t("kPointD", { montant: m(totalCommande) }) : t("aucun")} ton={suggestions.length ? "orange" : ""} onClick={() => aller("reappro")} />
          <Kpi label={t("kPerimes")} valeur={String(taches.perimes.length)} aide={taches.perimes.length ? t("kPerimesD", { montant: m(valeurPerimes) }) : t("aucun")} ton={taches.perimes.length ? "orange" : ""} />
        </section>

        <div className="stoGrille">
          <div className="stoLarge">
            <Carte titre={t("aFaire", { n: liste.length })} aide={t("parUrgence")}>
              {liste.length ? (
                <ul className="stoTaches">
                  {liste.map((x) => (
                    <li key={x.id}>
                      <Puce ton={x.ton}>{x.n}</Puce>
                      <span>
                        <b>{x.titre}</b>
                        <small>{x.detail}</small>
                      </span>
                      <Bouton onClick={x.aller}>{x.action}</Bouton>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="stoRien stoRienOk"><Icon fafa="faCircleCheck" width={14} /> {t("rienAFaire")}</div>
              )}
            </Carte>

            <Carte titre={t("derniersMouvements")} actions={<button type="button" className="stoLien" onClick={() => aller("mouvements")}>{t("toutHistorique")}</button>}>
              <div className="stoTableau" role="table">
                <div className="stoLigneT stoEnteteT stoColsMvt" role="row">
                  <span>{t("date")}</span><span>{t("article")}</span><span>{t("type")}</span><span className="stoMt">{t("quantite")}</span><span>{t("lieu")}</span><span>{t("origine")}</span>
                </div>
                {derniers.map((x) => {
                  const a = parId.get(x.data.articleId);
                  const signe = x.data.sens === "entree" ? "+ " : x.data.sens === "sortie" ? "− " : "";
                  return (
                    <button type="button" key={x.id} className="stoLigneT stoColsMvt" role="row" onClick={() => a && aller("article", { id: a.id })}>
                      <span className="stoDoux">{date(x.data.date)}</span>
                      <b className="stoEllipse">{a?.data.designation || "—"}</b>
                      <span><Etiquette ton={x.data.sens}>{t(`sens_${x.data.sens}`) || SENS[x.data.sens]?.label}</Etiquette></span>
                      <b className="stoMt" data-sens={x.data.sens}>{signe}{q(x.data.quantite)}</b>
                      <span className="stoEllipse stoDoux">
                        {x.data.sens === "transfert" ? `${nomEntrepot(x.data.de)} → ${nomEntrepot(x.data.vers)}` : [nomEntrepot(x.data.entrepotId), x.data.emplacement].filter(Boolean).join(" · ")}
                      </span>
                      <span className="stoEllipse stoDoux">{x.data.motif || "—"}</span>
                    </button>
                  );
                })}
                {!derniers.length ? <p className="stoRien">{t("aucunMouvement")}</p> : null}
              </div>
            </Carte>
          </div>

          <aside className="stoColonne">
            <Carte titre={t("navEntrepots")} actions={<button type="button" className="stoLien" onClick={() => saisirMouvement(s, { sens: "transfert" })}>{t("transferer")}</button>}>
              <ul className="stoEntrepots">
                {syntheses.map((e) => (
                  <li key={e.id || "p"}>
                    <span><b>{e.nom}</b><b className="stoMt">{m(e.valeur)}</b></span>
                    <small>{t("entrepotDetail", { n: e.references, e: (e.emplacements || []).length })}</small>
                    <span className="stoPiste"><span style={{ width: `${Math.round((e.valeur / Math.max(1, ...syntheses.map((x) => x.valeur))) * 100)}%` }} /></span>
                  </li>
                ))}
              </ul>
            </Carte>
            <Carte titre={t("abcTitre")} aide={t("abcAide")}>
              <ul className="stoAbc">
                {["A", "B", "C"].map((k) => (
                  <li key={k}>
                    <b className="stoClasse" data-classe={k}>{k}</b>
                    <span className="stoPiste"><span data-classe={k} style={{ width: `${Math.round(abc.resume[k].part * 100)}%` }} /></span>
                    <small>{t("abcLigne", { n: abc.resume[k].n, p: Math.round(abc.resume[k].part * 100) })}</small>
                  </li>
                ))}
              </ul>
            </Carte>
          </aside>
        </div>
      </div>
    </div>
  );
};

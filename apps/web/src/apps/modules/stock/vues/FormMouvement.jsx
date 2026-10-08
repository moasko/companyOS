// Stock — saisir un mouvement : entrée, sortie ou transfert.
//
// La boîte s'affiche hors de la fenêtre, donc hors du contexte de l'app :
// elle reçoit tout ce qu'il lui faut en props (`s`, l'instantané du
// contexte au moment de l'ouverture).

import React, { useState } from "react";
import { modal } from "../../../modalRequest";
import { Bouton, nombre } from "../commun";
import { aujourdhui, lotsEnStock, parCode } from "../regles";

const FormMouvement = ({ s, initial, close }) => {
  const { t, q, articles, entrepots, stocks, mouvements, couts } = s;
  const premier = entrepots[0]?.id ?? "";
  const [v, setV] = useState({
    sens: initial.sens || "entree",
    articleId: initial.articleId || "",
    recherche: "",
    quantite: "",
    entrepotId: s.entrepotActif !== "*" ? s.entrepotActif : premier,
    de: s.entrepotActif !== "*" ? s.entrepotActif : premier,
    vers: entrepots.find((e) => e.id !== (s.entrepotActif !== "*" ? s.entrepotActif : premier))?.id ?? premier,
    emplacement: "",
    lot: "",
    peremption: "",
    prixUnitaire: "",
    motif: "",
    date: aujourdhui(),
  });
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const article = articles.find((a) => a.id === v.articleId);
  const entrepot = entrepots.find((e) => e.id === (v.sens === "transfert" ? v.de : v.entrepotId));
  const emplacements = (entrepots.find((e) => e.id === (v.sens === "transfert" ? v.vers : v.entrepotId))?.emplacements || []);
  const lots = article ? lotsEnStock(article.id, mouvements, stocks[article.id] || 0) : [];
  const quantite = nombre(v.quantite);
  const ok = article && quantite > 0 && (v.sens !== "transfert" || v.de !== v.vers);

  const valider = () => {
    const base = { articleId: article.id, sens: v.sens, quantite, date: v.date, motif: v.motif.trim() };
    if (v.sens === "transfert") {
      close({ ...base, de: v.de, vers: v.vers, emplacement: v.emplacement });
      return;
    }
    const m = { ...base, entrepotId: v.entrepotId };
    if (v.emplacement) m.emplacement = v.emplacement;
    if (v.sens === "entree") {
      if (v.lot.trim()) m.lot = v.lot.trim();
      if (v.peremption) m.peremption = v.peremption;
      if (v.prixUnitaire) m.prixUnitaire = nombre(v.prixUnitaire);
    } else if (v.lot) m.lot = v.lot;
    close(m);
  };

  return (
    <div className="stoForm">
      <div className="stoSegments" role="group" aria-label={t("type")}>
        {["entree", "sortie", "transfert"].map((k) => (
          <button key={k} type="button" aria-pressed={v.sens === k} onClick={() => setV((x) => ({ ...x, sens: k }))}>
            {t(`sens_${k}`)}
          </button>
        ))}
      </div>

      <label>
        <span>{t("article")}</span>
        {initial.articleId ? (
          <b className="stoFixe">{article?.data.designation}</b>
        ) : (
          <>
            <input
              autoFocus
              list="sto-articles"
              value={v.recherche}
              placeholder={t("rechercheArticle")}
              onChange={(e) => {
                const val = e.target.value;
                const trouve = parCode(articles, val) || articles.find((a) => `${a.data.reference} — ${a.data.designation}` === val);
                setV((x) => ({ ...x, recherche: val, articleId: trouve?.id || "" }));
              }}
            />
            <datalist id="sto-articles">
              {articles.map((a) => (
                <option key={a.id} value={`${a.data.reference} — ${a.data.designation}`} />
              ))}
            </datalist>
          </>
        )}
        {article ? (
          <small>
            {t("enStockPartout", { q: q(stocks[article.id] || 0), unite: article.data.unite || "" })}
            {entrepot ? ` · ${entrepot.nom} : ${q(s.parEntrepot[article.id]?.[entrepot.id] || 0)}` : ""}
          </small>
        ) : null}
      </label>

      <div className="stoDeux">
        <label>
          <span>{t("quantite")}</span>
          <input inputMode="decimal" value={v.quantite} onChange={set("quantite")} placeholder="0" />
        </label>
        <label>
          <span>{t("date")}</span>
          <input type="date" value={v.date} onChange={set("date")} />
        </label>
      </div>

      {v.sens === "transfert" ? (
        <div className="stoDeux">
          <label>
            <span>{t("de")}</span>
            <select value={v.de} onChange={set("de")}>
              {entrepots.map((e) => <option key={e.id || "p"} value={e.id}>{e.nom}</option>)}
            </select>
          </label>
          <label>
            <span>{t("vers")}</span>
            <select value={v.vers} onChange={set("vers")}>
              {entrepots.map((e) => <option key={e.id || "p"} value={e.id}>{e.nom}</option>)}
            </select>
          </label>
        </div>
      ) : (
        <label>
          <span>{t("entrepot")}</span>
          <select value={v.entrepotId} onChange={set("entrepotId")}>
            {entrepots.map((e) => <option key={e.id || "p"} value={e.id}>{e.nom}</option>)}
          </select>
        </label>
      )}
      {v.sens === "transfert" && entrepots.length < 2 ? <p className="stoAide">{t("transfertUnSeul")}</p> : null}

      {emplacements.length ? (
        <label>
          <span>{t("emplacement")}</span>
          <select value={v.emplacement} onChange={set("emplacement")}>
            <option value="">—</option>
            {emplacements.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
      ) : null}

      {v.sens === "entree" ? (
        <>
          <div className="stoDeux">
            <label>
              <span>{t("lot")}{article?.data.suiviLot ? " *" : ""}</span>
              <input value={v.lot} onChange={set("lot")} placeholder="L2510" />
            </label>
            <label>
              <span>{t("peremption")}</span>
              <input type="date" value={v.peremption} onChange={set("peremption")} />
            </label>
          </div>
          <label>
            <span>{t("prixUnitaire")}</span>
            <input inputMode="decimal" value={v.prixUnitaire} onChange={set("prixUnitaire")} placeholder={article ? String(Math.round(couts.get(article.id) || 0)) : ""} />
          </label>
        </>
      ) : v.sens === "sortie" && lots.filter((l) => l.lot).length ? (
        <label>
          <span>{t("lot")}</span>
          <select value={v.lot} onChange={set("lot")}>
            <option value="">{t("lotAuto")}</option>
            {lots.filter((l) => l.lot).map((l) => (
              <option key={l.lot} value={l.lot}>{l.lot} · {q(l.qte)}{l.peremption ? ` · ${l.peremption}` : ""}</option>
            ))}
          </select>
        </label>
      ) : null}

      <label>
        <span>{t("motif")}</span>
        <input value={v.motif} onChange={set("motif")} placeholder={t(`motifExemple_${v.sens}`)} />
      </label>

      <div className="stoActionsForm">
        <Bouton onClick={() => close(null)}>{t("annuler")}</Bouton>
        <Bouton variante="principal" disabled={!ok || (v.sens === "entree" && article?.data.suiviLot && !v.lot.trim())} onClick={valider}>
          {t("enregistrer")}
        </Bouton>
      </div>
    </div>
  );
};

/// Ouvre la saisie et enregistre le mouvement validé.
export const saisirMouvement = async (s, initial = {}) => {
  const m = await modal.open({
    title: s.t("nouveauMouvement"),
    render: ({ close }) => <FormMouvement s={s} initial={initial} close={close} />,
  });
  if (m) await s.enregistrerMouvements([m]);
};

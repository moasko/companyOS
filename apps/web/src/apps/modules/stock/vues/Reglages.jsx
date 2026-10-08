// Stock — réglages : les entrepôts et leurs emplacements, les étiquettes
// code-barres à imprimer.

import React, { useMemo, useState } from "react";
import { Icon } from "../../../../utils/general";
import { modal } from "../../../modalRequest";
import { Page, clip, textWidth } from "../../facturation/pdf";
import { assembler } from "../../editeur-factures/pdf";
import { barresCode39, syntheseEntrepots } from "../regles";
import { Bouton, Carte, Entete, Etiquette, nombre, ranger, useS } from "../commun";

// ---------------------------------------------------------------------------
// Entrepôts
// ---------------------------------------------------------------------------

const FormEntrepot = ({ t, initial, close }) => {
  const [v, setV] = useState({ nom: "", code: "", adresse: "", ...initial, emplacements: (initial.emplacements || []).join("\n") });
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const valider = () =>
    close({
      nom: v.nom.trim(),
      code: v.code.trim().toUpperCase(),
      adresse: v.adresse.trim(),
      emplacements: [...new Set(v.emplacements.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean))],
    });
  return (
    <div className="stoForm">
      <div className="stoDeux">
        <label>
          <span>{t("nom")}</span>
          <input autoFocus value={v.nom} onChange={set("nom")} placeholder={t("exempleEntrepot")} />
        </label>
        <label>
          <span>{t("code")}</span>
          <input value={v.code} onChange={set("code")} placeholder="YOP" maxLength={6} />
        </label>
      </div>
      <label>
        <span>{t("adresse")}</span>
        <input value={v.adresse} onChange={set("adresse")} />
      </label>
      <label>
        <span>{t("emplacements")}</span>
        <textarea rows={5} value={v.emplacements} onChange={set("emplacements")} placeholder={"A1-01\nA1-02\nB2-01"} />
        <small>{t("emplacementsAide")}</small>
      </label>
      <div className="stoActionsForm">
        <Bouton onClick={() => close(null)}>{t("annuler")}</Bouton>
        <Bouton variante="principal" disabled={!v.nom.trim()} onClick={valider}>{t("enregistrer")}</Bouton>
      </div>
    </div>
  );
};

export const Entrepots = () => {
  const s = useS();
  const { t, m, entrepots, articles, mouvements, parEntrepot, enregistrerRecord, supprimerRecord, setEntrepotActif, aller } = s;
  const syntheses = useMemo(() => syntheseEntrepots(entrepots, articles, mouvements), [entrepots, articles, mouvements]);

  const editer = async (e) => {
    const data = await modal.open({
      title: e ? e.nom : t("nouvelEntrepot"),
      render: ({ close }) => <FormEntrepot t={t} initial={e || {}} close={close} />,
    });
    if (!data) return;
    if (e?.principal) await enregistrerRecord("entrepots", e.recordId, { ...data, principal: true });
    else await enregistrerRecord("entrepots", e?.recordId || null, data);
  };

  const supprimer = async (e) => {
    const plein = articles.some((a) => (parEntrepot[a.id]?.[e.id] || 0) !== 0);
    if (plein) {
      modal.alert({ title: t("supprimerEntrepot"), message: t("entrepotNonVide", { nom: e.nom }) });
      return;
    }
    const ok = await modal.confirm({ title: t("supprimerEntrepot"), message: t("supprimerEntrepotMessage", { nom: e.nom }), confirmLabel: t("supprimer"), danger: true });
    if (ok) await supprimerRecord("entrepots", e.recordId);
  };

  return (
    <div className="stoVue">
      <Entete titre={t("navEntrepots")} sous={t("sousEntrepots", { n: entrepots.length })}>
        <Bouton variante="principal" icone="faPlus" onClick={() => editer(null)}>{t("nouvelEntrepot")}</Bouton>
      </Entete>
      <div className="stoConteneur">
        <div className="stoCartesEntrepots">
          {syntheses.map((e) => (
            <Carte
              key={e.id || "p"}
              titre={e.nom}
              aide={[e.code, e.adresse].filter(Boolean).join(" · ")}
              actions={
                <>
                  {e.principal ? <Etiquette>{t("principal")}</Etiquette> : null}
                  <button type="button" className="stoIcone" aria-label={t("modifier")} title={t("modifier")} onClick={() => editer(e)}><Icon fafa="faPen" width={11} /></button>
                  {!e.principal ? (
                    <button type="button" className="stoIcone" aria-label={t("supprimer")} title={t("supprimer")} onClick={() => supprimer(e)}><Icon fafa="faTrash" width={11} /></button>
                  ) : null}
                </>
              }
            >
              <div className="stoChiffres">
                <span><small>{t("valeur")}</small><b>{m(e.valeur)}</b></span>
                <span><small>{t("navArticles")}</small><b>{e.references}</b></span>
                <span><small>{t("emplacements")}</small><b>{(e.emplacements || []).length}</b></span>
              </div>
              {(e.emplacements || []).length ? (
                <div className="stoPuces">
                  {e.emplacements.slice(0, 18).map((x) => <span key={x} className="stoChip">{x}</span>)}
                  {e.emplacements.length > 18 ? <span className="stoChip">+{e.emplacements.length - 18}</span> : null}
                </div>
              ) : (
                <p className="stoAide">{t("sansEmplacement")}</p>
              )}
              <button
                type="button"
                className="stoLien"
                onClick={() => {
                  setEntrepotActif(e.id);
                  aller("articles");
                }}
              >
                {t("voirStockEntrepot")}
              </button>
            </Carte>
          ))}
        </div>
        <div className="stoEncadre">
          <b>{t("entrepotsComment")}</b>
          <span>{t("entrepotsExplication")}</span>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Étiquettes
// ---------------------------------------------------------------------------

// Planche A4 de 3 × 8 étiquettes de 70 × 37 mm, le format le plus courant.
const L = 595.28;
const H = 841.89;
const COLS = 3;
const RANGS = 8;
const LE = L / COLS;
const HE = H / RANGS;
const MARGE = 12;

const propre = (x) => String(x ?? "").replace(/[  ]/g, " ");

/// Le PDF des étiquettes : chaque article autant de fois que demandé.
export const etiquettesPdf = (liste, { prix, m }) => {
  const pages = [];
  let page = null;
  let i = 0;
  for (const { article, copies } of liste) {
    for (let c = 0; c < copies; c += 1) {
      if (i % (COLS * RANGS) === 0) {
        page = new Page(L, H);
        pages.push(page);
      }
      const k = i % (COLS * RANGS);
      const x = (k % COLS) * LE + MARGE;
      const y = Math.floor(k / COLS) * HE + MARGE;
      const larg = LE - 2 * MARGE;
      const d = article.data;
      page.text(propre(clip(propre(d.designation), 9, true, larg)), x, y + 9, { size: 9, bold: true, color: "0.07 0.09 0.15" });
      const ligne2 = [d.reference, prix && d.prixVente ? m(d.prixVente) : ""].filter(Boolean).join("  ·  ");
      if (ligne2) page.text(propre(clip(propre(ligne2), 7.5, false, larg)), x, y + 20, { size: 7.5, color: "0.42 0.45 0.50" });
      const code = barresCode39(d.codeBarre || d.reference || "");
      if (code.texte) {
        const module = Math.min(1.3, larg / code.largeur);
        const ox = x + (larg - code.largeur * module) / 2;
        for (const b of code.barres) page.rect(ox + b.x * module, y + 26, b.largeur * module, 34, "0 0 0");
        page.text(code.texte, x + larg / 2 - textWidth(code.texte, 7.5, false) / 2, y + 70, { size: 7.5, color: "0.07 0.09 0.15" });
      }
      i += 1;
    }
  }
  return assembler(pages);
};

export const Etiquettes = () => {
  const s = useS();
  const { t, m, articles, intention, tache } = s;
  const [choix, setChoix] = useState(() => Object.fromEntries((intention?.ids || []).map((id) => [id, 1])));
  const [recherche, setRecherche] = useState("");
  const [prix, setPrix] = useState(true);
  const actifs = articles.filter((a) => !a.data.archive);
  const r = recherche.trim().toLowerCase();
  const visibles = actifs.filter((a) => !r || [a.data.designation, a.data.reference, a.data.codeBarre].filter(Boolean).some((x) => String(x).toLowerCase().includes(r)));
  const selection = actifs.filter((a) => choix[a.id] > 0).map((a) => ({ article: a, copies: nombre(choix[a.id]) }));
  const total = selection.reduce((x, y) => x + y.copies, 0);
  const sansCode = selection.filter((x) => !barresCode39(x.article.data.codeBarre || x.article.data.reference || "").texte).length;

  const generer = () =>
    tache(() => ranger(etiquettesPdf(selection, { prix, m }), `etiquettes-${new Date().toISOString().slice(0, 10)}.pdf`, t));

  return (
    <div className="stoVue">
      <Entete titre={t("navEtiquettes")} sous={t("sousEtiquettes", { n: total, p: Math.ceil(total / (COLS * RANGS)) })}>
        <input className="stoRecherche" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder={t("rechercheArticle")} aria-label={t("rechercheArticle")} />
        <Bouton variante="principal" icone="faFilePdf" disabled={!total} onClick={generer}>{t("genererEtiquettes")}</Bouton>
      </Entete>
      <div className="stoConteneur">
        <div className="stoFiltres">
          <button type="button" onClick={() => setChoix(Object.fromEntries(visibles.map((a) => [a.id, choix[a.id] || 1])))}>{t("toutCocher")}</button>
          <button type="button" onClick={() => setChoix({})}>{t("toutDecocher")}</button>
          <label className="stoCase">
            <input type="checkbox" checked={prix} onChange={(e) => setPrix(e.target.checked)} />
            <span>{t("afficherPrix")}</span>
          </label>
          <span className="stoDoux">{t("formatPlanche")}</span>
        </div>
        {sansCode ? <p className="stoAide">{t("sansCodeBarre", { n: sansCode })}</p> : null}
        <Carte>
          <div className="stoTableau" role="table">
            <div className="stoLigneT stoEnteteT stoColsEtiq" role="row">
              <span />
              <span>{t("article")}</span>
              <span>{t("codeBarre")}</span>
              <span className="stoMt">{t("copies")}</span>
            </div>
            {visibles.map((a) => (
              <div key={a.id} className="stoLigneT stoColsEtiq" role="row">
                <input
                  type="checkbox"
                  checked={choix[a.id] > 0}
                  onChange={(e) => setChoix((c) => ({ ...c, [a.id]: e.target.checked ? 1 : 0 }))}
                  aria-label={a.data.designation}
                />
                <span className="stoQui">
                  <b className="stoEllipse">{a.data.designation}</b>
                  <small className="stoDoux">{a.data.reference}</small>
                </span>
                <span className="stoCode">{a.data.codeBarre || a.data.reference || "—"}</span>
                <span className="stoMt">
                  <input className="stoQte" inputMode="numeric" value={choix[a.id] || ""} onChange={(e) => setChoix((c) => ({ ...c, [a.id]: Math.max(0, Math.round(nombre(e.target.value))) }))} aria-label={t("copies")} />
                </span>
              </div>
            ))}
            {!visibles.length ? <p className="stoRien">{t("aucunResultat")}</p> : null}
          </div>
        </Carte>
      </div>
    </div>
  );
};

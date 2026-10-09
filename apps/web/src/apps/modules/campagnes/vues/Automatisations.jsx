// Campagnes — les automatisations : la liste et les recettes, puis le
// scénario d'une automatisation (déclencheur, attente, condition, e-mail),
// ses réglages, son message et les personnes qui y sont.

import React, { useState } from "react";
import { Icon } from "../../../../utils/general";
import { modal } from "../../../modalRequest";
import * as D from "@companyos/shared/campagnes";
import { Bouton, Carte, Entete, Etiquette, Kpi, Onglets, useC } from "../commun";
import { EditeurBlocs, choisirAdressesTest } from "./EditeurBlocs";

const ICONES_RECETTES = {
  bienvenue: "faHandshake",
  devis: "faFileSignature",
  merci: "faHeart",
  livraison: "faTruck",
  endormi: "faBed",
  anniversaire: "faCakeCandles",
};

export const Automatisations = () => {
  const s = useC();
  const { t, n, pct, langue, automatisations, aller, peutEcrire, enregistrerAuto } = s;

  const creer = async (recette) => {
    const r = await enregistrerAuto(null, D.automatisationDe(recette, langue, t(`recette_${recette}`)));
    if (r) aller("automatisation", { id: r.id });
  };

  return (
    <div className="cmpVue">
      <Entete titre={t("navAutomatisations")} sous={t("sousAutos", { n: automatisations.filter((a) => a.data.actif).length })} />
      <div className="cmpConteneur">
        {automatisations.length ? (
          <Carte titre={t("vosAutos")}>
            <div className="cmpTableau" role="table">
              <div className="cmpLigneT cmpEnteteT cmpColsAutos" role="row">
                <span>{t("automatisation")}</span><span>{t("statut")}</span><span className="cmpMt">{t("enCours")}</span><span className="cmpMt">{t("envoyes")}</span><span className="cmpMt">{t("ouverture")}</span><span className="cmpMt">{t("sortis")}</span>
              </div>
              {automatisations.map((a) => {
                const st = D.statistiquesAuto(a.data);
                return (
                  <button type="button" key={a.id} className="cmpLigneT cmpColsAutos" role="row" onClick={() => aller("automatisation", { id: a.id })}>
                    <span className="cmpQui cmpQuiIcone">
                      <span className="cmpIconeRonde"><Icon fafa={ICONES_RECETTES[a.data.recette] || "faBolt"} width={13} /></span>
                      <span><b className="cmpEllipse">{a.data.nom}</b><small className="cmpDoux">{t(`recetteD_${a.data.recette}`)}</small></span>
                    </span>
                    <span>{a.data.actif ? <Etiquette ton="vert">{t("active")}</Etiquette> : <Etiquette>{t("enPause")}</Etiquette>}</span>
                    <span className="cmpMt">{n(st.attente)}</span>
                    <span className="cmpMt">{n(st.envoyes)}</span>
                    <span className="cmpMt">{st.envoyes ? pct(st.tauxOuverture) : "—"}</span>
                    <span className="cmpMt">{n(st.sortis)}</span>
                  </button>
                );
              })}
            </div>
          </Carte>
        ) : null}

        <Carte titre={t("recettes")} aide={t("recettesAide")}>
          <div className="cmpRecettes">
            {D.RECETTES.map((r) => {
              const deja = automatisations.filter((a) => a.data.recette === r.id).length;
              return (
                <div key={r.id} className="cmpRecette">
                  <span className="cmpIconeRonde"><Icon fafa={ICONES_RECETTES[r.id]} width={15} /></span>
                  <b>{t(`recette_${r.id}`)}</b>
                  <small>{t(`recetteD_${r.id}`)}</small>
                  <span className="cmpRecetteSource"><Etiquette ton="bleu">{t(`source_${r.source}`)}</Etiquette>{deja ? <Etiquette>{t("dejaN", { n: deja })}</Etiquette> : null}</span>
                  <Bouton disabled={!peutEcrire} onClick={() => creer(r.id)}>{t("utiliser")}</Bouton>
                </div>
              );
            })}
          </div>
          <p className="cmpAide">{t("relancesFactures")}</p>
        </Carte>
      </div>
    </div>
  );
};

export const Automatisation = () => {
  const s = useC();
  const { t, n, pct, dateCourte, heure, automatisations, intention, peutEcrire, occupe, enregistrerAuto, supprimerAuto, tester, membres, session } = s;
  const fiche = automatisations.find((a) => a.id === intention?.id);
  const [a, setA] = useState(() => ({ ...(fiche?.data || {}) }));
  const [modifie, setModifie] = useState(false);
  const [onglet, setOnglet] = useState("scenario");
  if (!fiche) {
    return (
      <div className="cmpVue">
        <Entete titre={t("navAutomatisations")} retour={{ section: "automatisations", label: t("navAutomatisations") }} />
        <div className="cmpConteneur"><p className="cmpRien">{t("autoIntrouvable")}</p></div>
      </div>
    );
  }
  const recette = D.recetteDe(a.recette);
  const st = D.statistiquesAuto(fiche.data);
  const maj = (patch) => { setModifie(true); setA((x) => ({ ...x, ...patch })); };
  const majRegles = (patch) => maj({ regles: { ...(a.regles || {}), ...patch } });

  const enregistrer = async () => {
    const r = await enregistrerAuto(fiche.id, a);
    if (r) setModifie(false);
  };

  const basculer = async () => {
    const activer = !fiche.data.actif;
    if (activer && !(await modal.confirm({ title: t("activerTitre"), message: t("activerMessage", { nom: a.nom }), detail: t("activerDetail"), confirmLabel: t("activer") }))) return;
    const r = await enregistrerAuto(fiche.id, { ...a, actif: activer, activeLe: activer ? new Date().toISOString() : fiche.data.activeLe });
    if (r) { setA((x) => ({ ...x, actif: activer, activeLe: r.data.activeLe })); setModifie(false); }
  };

  const envoyerTest = async () => {
    const adresses = await choisirAdressesTest({ t, membres, session });
    if (adresses?.length) await tester({ ...a, extraTest: { numero: "DEV-2026-0141", annees: "2", derniereFacture: "" } }, adresses, null);
  };

  const inscrits = [...(fiche.data.inscrits || [])].reverse();
  const extra = { numero: "DEV-2026-0141", annees: "2" };
  const variablesExtra = ["devis", "merci", "livraison"].includes(a.recette) ? ["numero"] : a.recette === "anniversaire" ? ["annees"] : [];

  const etapes = [
    { type: "declencheur", ton: "bleu", titre: t(`decl_${a.recette}`), detail: t(`source_${recette?.source || "crm"}`), stat: t("nEntres", { n: n(st.entres) }) },
    { type: "attendre", ton: "", titre: Number(a.delaiJours) ? t("nJours", { n: a.delaiJours }) : t("immediatement"), detail: a.regles?.joursOuvres !== false ? t("puisCreneau") : t("sansCreneau") },
    ...(recette?.sortie ? [{ type: "condition", ton: "orange", titre: t(`cond_${a.recette}`), detail: a.regles?.sortie !== false ? t("condSortie") : t("condIgnoree"), stat: t("nSortis", { n: n(st.sortis) }) }] : []),
    { type: "email", ton: "noir", titre: `« ${a.sujet || t("objetVide")} »`, detail: t("emailDetail"), stat: `${t("nEnvoyes", { n: n(st.envoyes) })}\n${st.envoyes ? t("pctOuverts", { p: pct(st.tauxOuverture) }) : ""}` },
  ];

  return (
    <div className="cmpVue cmpVueEditeur">
      <Entete titre={a.nom} sous={fiche.data.actif ? t("activeDepuis", { date: dateCourte(fiche.data.activeLe) }) : t("inactive")} retour={{ section: "automatisations", label: t("navAutomatisations") }}>
        <Onglets label={t("vue")} valeur={onglet} onChoisir={setOnglet} options={[{ id: "scenario", label: t("scenario") }, { id: "message", label: t("message") }, { id: "personnes", label: t("personnes"), nb: st.entres }]} />
        <Bouton icone="faEnvelopeOpenText" disabled={occupe || !peutEcrire} onClick={envoyerTest}>{t("envoyerTest")}</Bouton>
        {peutEcrire ? <button type="button" className="cmpIcone" aria-label={t("supprimer")} title={t("supprimer")} onClick={() => supprimerAuto(fiche)}><Icon fafa="faTrashCan" width={12} /></button> : null}
        <Bouton disabled={!modifie || occupe || !peutEcrire} onClick={enregistrer}>{modifie ? t("enregistrer") : t("enregistre")}</Bouton>
        <Bouton variante={fiche.data.actif ? "secondaire" : "principal"} icone={fiche.data.actif ? "faPause" : "faPlay"} disabled={occupe || !peutEcrire || !a.sujet} onClick={basculer}>{fiche.data.actif ? t("mettrePause") : t("activer")}</Bouton>
      </Entete>

      {onglet === "message" ? (
        <EditeurBlocs message={a} onChange={maj} variables={variablesExtra} extra={extra} />
      ) : onglet === "personnes" ? (
        <div className="cmpConteneur">
          <Carte titre={t("personnes")} aide={t("personnesAide")}>
            <div className="cmpTableau" role="table">
              <div className="cmpLigneT cmpEnteteT cmpColsInscrits" role="row"><span>{t("contact")}</span><span>{t("entreeLe")}</span><span>{t("statut")}</span><span>{t("activite")}</span></div>
              {inscrits.slice(0, 200).map((i) => (
                <div key={i.cle} className="cmpLigneT cmpColsInscrits" role="row">
                  <span className="cmpQui"><b className="cmpEllipse">{i.nom}</b><small className="cmpDoux cmpEllipse">{[i.email, i.extra?.numero].filter(Boolean).join(" · ")}</small></span>
                  <span className="cmpDoux">{dateCourte(i.entreLe)}</span>
                  <span>{i.statut === "attente" ? <Etiquette ton="bleu">{t("prevuLe", { date: `${dateCourte(i.prevuLe)} ${heure(i.prevuLe)}` })}</Etiquette> : i.statut === "envoye" ? <Etiquette ton="vert">{t("envoyeLe", { date: dateCourte(i.envoyeLe) })}</Etiquette> : i.statut === "sorti" ? <Etiquette>{t("sorti")}</Etiquette> : <Etiquette ton="rouge">{t("echec")}</Etiquette>}</span>
                  <span className="cmpDoux">{[i.ouvert ? t("ouvert") : "", i.clique ? t("clique") : "", i.desinscrit ? t("desinscrit") : "", i.erreur && i.statut !== "envoye" ? i.erreur : ""].filter(Boolean).join(" · ") || "—"}</span>
                </div>
              ))}
              {!inscrits.length ? <p className="cmpRien">{fiche.data.actif ? t("personneEncore") : t("activerPourCommencer")}</p> : null}
            </div>
          </Carte>
        </div>
      ) : (
        <div className="cmpConteneur">
          <div className="cmpGrille">
            <div className="cmpLarge">
              <Carte titre={t("scenario")}>
                <div className="cmpScenario">
                  {etapes.map((e, i) => (
                    <React.Fragment key={e.type}>
                      {i ? <span className="cmpFleche" aria-hidden="true" /> : null}
                      <div className="cmpEtapeScenario" data-ton={e.ton}>
                        <span className="cmpEtapeType">{t(`etapeScenario_${e.type}`)}</span>
                        <span className="cmpEtapeTexte"><b>{e.titre}</b><small>{e.detail}</small></span>
                        {e.stat ? <small className="cmpEtapeStat">{e.stat}</small> : null}
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </Carte>
            </div>
            <aside className="cmpColonne">
              <section className="cmpKpis cmpKpis2">
                <Kpi label={t("envoyes")} valeur={n(st.envoyes)} />
                <Kpi label={t("ouverture")} valeur={st.envoyes ? pct(st.tauxOuverture) : "—"} />
                <Kpi label={t("clics")} valeur={st.envoyes ? pct(st.tauxClic) : "—"} />
                <Kpi label={t("enCours")} valeur={n(st.attente)} />
              </section>
              <Carte titre={t("reglages")}>
                <label className="cmpChamp">
                  <span>{t("nomAuto")}</span>
                  <input value={a.nom || ""} onChange={(e) => maj({ nom: e.target.value })} />
                </label>
                <label className="cmpChamp">
                  <span>{t("delaiAvantEnvoi")}</span>
                  <select value={a.delaiJours ?? 0} onChange={(e) => maj({ delaiJours: Number(e.target.value) })}>
                    {[0, 1, 2, 3, 5, 7, 10, 14, 30].map((j) => <option key={j} value={j}>{j ? t("nJours", { n: j }) : t("immediatement")}</option>)}
                  </select>
                </label>
                <label className="cmpCase"><input type="checkbox" checked={a.regles?.joursOuvres !== false} onChange={(e) => majRegles({ joursOuvres: e.target.checked })} /><span>{t("regleOuvres")}</span></label>
                {recette?.sortie ? <label className="cmpCase"><input type="checkbox" checked={a.regles?.sortie !== false} onChange={(e) => majRegles({ sortie: e.target.checked })} /><span>{t(`regleSortie_${a.recette}`)}</span></label> : null}
                <p className="cmpAide">{t("regleUneFois")}</p>
              </Carte>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
};

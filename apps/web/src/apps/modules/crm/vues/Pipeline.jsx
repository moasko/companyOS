// Pipeline : les affaires par étape. Chaque carte dit ce qui compte —
// montant, compte, prochaine activité, et si elle stagne.
//
// Sur ordinateur, on glisse les cartes d'une colonne à l'autre ; sur
// téléphone (et au clavier), chaque carte a son menu « Déplacer vers… ».

import React, { useMemo, useState } from "react";
import { montant } from "../../../../utils/monnaie";
import { ETAPES, ETAPES_OUVERTES, nomDe, valeurPonderee } from "../domaine";
import { abrege, dateCourte, Initiales, Jauge, Pastille, TON_ETAPE, Vide } from "../commun";

const COLONNES = [...ETAPES_OUVERTES, "gagnee"];

const CarteAffaire = ({ t, o, client, resp, stag, prochaine, onOuvrir, onDeplacer, glisser, maintenant }) => (
  <article
    className="crmDeal"
    data-stagne={stag?.stagne ? "1" : undefined}
    draggable={Boolean(glisser)}
    onDragStart={(e) => {
      e.dataTransfer.setData("text/plain", o.id);
      e.dataTransfer.effectAllowed = "move";
    }}
  >
    <button type="button" className="crmDealCorps" onClick={() => onOuvrir(o)}>
      <span className="crmDealHaut">
        <strong>{o.data.libelle}</strong>
        <strong>{abrege(o.data.montant)}</strong>
      </span>
      <span className="crmMuted">{nomDe(client)}</span>
    </button>
    <div className="crmDealPied" data-ton={prochaine?.enRetard ? "bad" : !prochaine ? "warn" : undefined}>
      <span className="crmDealNext">
        {prochaine
          ? `${prochaine.enRetard ? `⚠ ${t("retardJ", { n: Math.round((new Date(maintenant) - new Date(prochaine.activite.data.echeance)) / 86400000) })} · ` : `${dateCourte(prochaine.activite.data.echeance)} · `}${prochaine.activite.data.resume}`
          : o.data.etape === "gagnee"
            ? dateCourte(o.data.dateCloture)
            : stag?.stagne
              ? t("joursSansActivite", { n: stag.jours })
              : t("sansActivite")}
      </span>
      {resp ? <Initiales nom={resp.name} taille={22} /> : null}
    </div>
    <label className="crmDealDeplacer">
      <span className="crmSr">{t("deplacerVers")}</span>
      <select value="" onChange={(e) => e.target.value && onDeplacer(o, e.target.value)} aria-label={t("deplacerVers")}>
        <option value="">{t("deplacerVers")}</option>
        {Object.keys(ETAPES).filter((x) => x !== o.data.etape).map((x) => (
          <option key={x} value={x}>{t(`etape_${x}`)}</option>
        ))}
      </select>
    </label>
  </article>
);

export const Pipeline = ({ t, d, ctx, actions, clientDe, membreDe, objectif, prev, telephone, moi, maintenant }) => {
  const [responsable, setResponsable] = useState("");
  const [stagneSeul, setStagneSeul] = useState(false);
  const [mode, setMode] = useState("tableau");
  const [etapeMobile, setEtapeMobile] = useState("contact");
  const [survol, setSurvol] = useState(null);

  const moisCourant = maintenant.slice(0, 7);
  const affaires = useMemo(
    () =>
      d.opportunites.filter((o) => {
        if (responsable && o.data.responsableId !== responsable) return false;
        if (stagneSeul && !ctx.stag[o.id]?.stagne) return false;
        if (o.data.etape === "gagnee") return (o.data.dateCloture || o.data.etapeLe || "").slice(0, 7) === moisCourant;
        return ETAPES_OUVERTES.includes(o.data.etape);
      }),
    [d.opportunites, responsable, stagneSeul, ctx.stag, moisCourant],
  );

  const parEtape = (e) =>
    affaires
      .filter((o) => o.data.etape === e)
      .sort((a, b) => (ctx.stag[b.id]?.stagne ? 1 : 0) - (ctx.stag[a.id]?.stagne ? 1 : 0) || (Number(b.data.montant) || 0) - (Number(a.data.montant) || 0));

  const ouvertes = affaires.filter((o) => ETAPES_OUVERTES.includes(o.data.etape));
  const totalOuvert = ouvertes.reduce((s, o) => s + (Number(o.data.montant) || 0), 0);
  const totalPondere = ouvertes.reduce((s, o) => s + valeurPonderee(o), 0);
  const mois = prev[0] || { gagne: 0, engage: 0 };

  const deposer = (e, etape) => {
    e.preventDefault();
    setSurvol(null);
    const id = e.dataTransfer.getData("text/plain");
    const o = d.opportunites.find((x) => x.id === id);
    if (o) actions.changerEtape(o, etape);
  };

  const carte = (o) => (
    <CarteAffaire
      key={o.id}
      t={t}
      o={o}
      client={clientDe(o.data.clientId)}
      resp={membreDe(o.data.responsableId)}
      stag={ctx.stag[o.id]}
      prochaine={ctx.prochaine[o.id]}
      onOuvrir={actions.editerAffaire}
      onDeplacer={actions.changerEtape}
      glisser={!telephone}
      maintenant={maintenant}
    />
  );

  const colonnesAffichees = telephone ? [etapeMobile] : COLONNES;

  return (
    <div className="crmPage crmPagePipeline">
      <header className="crmEntete">
        <h1>{t("navPipeline")}</h1>
        <div className="crmFiltres">
          <label className="crmChoix">
            <span className="crmSr">{t("filtreResponsable")}</span>
            <select value={responsable} onChange={(e) => setResponsable(e.target.value)} aria-label={t("filtreResponsable")}>
              <option value="">{t("filtreResponsable")} : {t("tous")}</option>
              <option value={moi}>{t("moi")}</option>
              {d.membres.filter((m) => m.id !== moi).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <button type="button" className="crmPuce" data-on={stagneSeul ? "bad" : undefined} onClick={() => setStagneSeul((x) => !x)}>
            {t("seulementStagne")}
          </button>
          {!telephone ? (
            <div className="crmSegment" role="group">
              <button type="button" data-on={mode === "tableau" ? "1" : undefined} onClick={() => setMode("tableau")}>{t("tableau")}</button>
              <button type="button" data-on={mode === "liste" ? "1" : undefined} onClick={() => setMode("liste")}>{t("liste")}</button>
            </div>
          ) : null}
          <button type="button" className="crmBtn crmBtnPrimaire" onClick={() => actions.editerAffaire()}>{t("nouvelleAffaire")}</button>
        </div>
      </header>

      <section className="crmBandeau">
        <div><span className="crmMuted">{t("ouvert")}</span> <strong>{montant(totalOuvert)}</strong></div>
        <div><span className="crmMuted">{t("pondere")}</span> <strong>{montant(totalPondere)}</strong></div>
        <div><span className="crmMuted">{t("engage")}</span> <strong>{montant(mois.engage)}</strong></div>
        <div className="crmBandeauObjectif">
          <span className="crmMuted">{t("objectif")}</span>
          <Jauge pct={objectif.pct || 0} pct2={objectif.pctEngage} />
          <span className="crmMuted crmPetit">
            {t("gagne")} {abrege(objectif.gagne)}{objectif.objectif ? ` / ${abrege(objectif.objectif)}` : ""}
          </span>
        </div>
      </section>

      {telephone ? (
        <div className="crmOngletsEtapes" role="tablist">
          {COLONNES.map((e) => (
            <button key={e} type="button" role="tab" aria-selected={etapeMobile === e} data-on={etapeMobile === e ? "1" : undefined} onClick={() => setEtapeMobile(e)}>
              {t(`etape_${e}`)} <span>{parEtape(e).length}</span>
            </button>
          ))}
        </div>
      ) : null}

      {mode === "liste" && !telephone ? (
        <div className="crmTableBoite">
          <table className="crmTable">
            <thead>
              <tr>
                <th>{t("colAffaire")}</th><th>{t("colCompte")}</th><th>{t("colEtape")}</th>
                <th className="crmNum">{t("colMontant")}</th><th>{t("colCloture")}</th><th>{t("colProchaine")}</th><th>{t("colResponsable")}</th>
              </tr>
            </thead>
            <tbody>
              {affaires.map((o) => {
                const p = ctx.prochaine[o.id];
                return (
                  <tr key={o.id} data-stagne={ctx.stag[o.id]?.stagne ? "1" : undefined} onClick={() => actions.editerAffaire(o)} className="handcr">
                    <td><strong>{o.data.libelle}</strong></td>
                    <td>{nomDe(clientDe(o.data.clientId))}</td>
                    <td><Pastille ton={TON_ETAPE[o.data.etape]}>{t(`etape_${o.data.etape}`)}</Pastille></td>
                    <td className="crmNum">{montant(o.data.montant)}</td>
                    <td>{dateCourte(o.data.dateCloture)}</td>
                    <td className={p?.enRetard ? "crmRouge" : ""}>{p ? `${dateCourte(p.activite.data.echeance)} · ${p.activite.data.resume}` : ctx.stag[o.id]?.stagne ? t("joursSansActivite", { n: ctx.stag[o.id].jours }) : "—"}</td>
                    <td>{membreDe(o.data.responsableId)?.name || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!affaires.length ? <Vide>{t("aucuneAffaire")}</Vide> : null}
        </div>
      ) : (
        <section className="crmKanban" data-colonnes={colonnesAffichees.length}>
          {colonnesAffichees.map((e) => {
            const liste = parEtape(e);
            const somme = liste.reduce((s, o) => s + (Number(o.data.montant) || 0), 0);
            const pond = liste.reduce((s, o) => s + valeurPonderee(o), 0);
            return (
              <div
                key={e}
                className="crmCol"
                data-survol={survol === e ? "1" : undefined}
                data-gagnee={e === "gagnee" ? "1" : undefined}
                onDragOver={(ev) => { ev.preventDefault(); setSurvol(e); }}
                onDragLeave={() => setSurvol((s) => (s === e ? null : s))}
                onDrop={(ev) => deposer(ev, e)}
              >
                <div className="crmColTete">
                  <div className="crmColTitre">
                    <span>{t(`etape_${e}`)}</span>
                    <Pastille>{liste.length}</Pastille>
                    <span className="crmMuted crmPetit">{ETAPES[e].probabilite} %</span>
                  </div>
                  <span className="crmMuted crmPetit">{abrege(somme)}{e !== "gagnee" ? ` · ${t("pondereCourt", { montant: abrege(pond) })}` : ""}</span>
                </div>
                <div className="crmColCartes">
                  {liste.map(carte)}
                  {!liste.length ? <div className="crmColVide">{t("aucuneAffaire")}</div> : null}
                </div>
              </div>
            );
          })}
          {!telephone ? (
            <div
              className="crmCol crmColPerdue"
              data-survol={survol === "perdue" ? "1" : undefined}
              onDragOver={(ev) => { ev.preventDefault(); setSurvol("perdue"); }}
              onDragLeave={() => setSurvol((s) => (s === "perdue" ? null : s))}
              onDrop={(ev) => deposer(ev, "perdue")}
            >
              <span>{t("etape_perdue")}</span>
            </div>
          ) : null}
        </section>
      )}

      <footer className="crmLegende">
        <span><i className="crmTemoin" /> {t("legendeStagne", { n: 14 })}</span>
        <span>{t("legendeGagne")}</span>
        <span>{t("legendePerdue")}</span>
      </footer>
    </div>
  );
};

// Leads : les prospects à qualifier, notés et expliqués. Les inscrits du
// formulaire des Campagnes arrivent ici d'eux-mêmes ; un lead qualifié
// devient une affaire du pipeline.

import React, { useEffect, useMemo, useState } from "react";
import { Icon } from "../../../../utils/general";
import { nomDe } from "../domaine";
import { doublons, niveauScore, SOURCES, signauxCampagnes } from "../regles";
import { dateCourte, Initiales, Pastille, Vide } from "../commun";

const TON_SOURCE = { formulaire: "orange", campagne: "violet", recommandation: "ok", salon: "info", import: "idle" };
const COULEUR = { chaud: "var(--crm-green)", tiede: "var(--crm-amber)", froid: "var(--crm-muted)" };

const Score = ({ score }) => (
  <span className="crmScore">
    <span className="crmScorePiste"><span style={{ width: `${score}%`, background: COULEUR[niveauScore(score)] }} /></span>
    <strong>{score}</strong>
  </span>
);

export const Leads = ({ t, d, ctx, actions, membreDe, telephone }) => {
  const [source, setSource] = useState("");
  const [chauds, setChauds] = useState(false);
  const [libres, setLibres] = useState(false);
  const [choisi, setChoisi] = useState(null);
  const [besoin, setBesoin] = useState("");
  const [montantEstime, setMontantEstime] = useState("");
  const [responsable, setResponsable] = useState("");

  const liste = useMemo(
    () =>
      ctx.leads.filter(
        (l) =>
          (!source || (l.client.data.source || "autre") === source) &&
          (!chauds || l.score >= 50) &&
          (!libres || !l.client.data.responsableId),
      ),
    [ctx.leads, source, chauds, libres],
  );

  const lead = ctx.leads.find((l) => l.client.id === choisi) || null;
  useEffect(() => {
    if (!lead) return;
    setBesoin(lead.client.data.besoin || "");
    setMontantEstime(lead.client.data.montantEstime || "");
    setResponsable(lead.client.data.responsableId || "");
  }, [choisi]); // eslint-disable-line react-hooks/exhaustive-deps

  const proches = useMemo(() => (lead ? doublons(lead.client, d.clients) : []), [lead, d.clients]);

  const panneau = lead ? (
    <aside className="crmCarte crmLeadPanneau">
      {telephone ? (
        <button type="button" className="crmRetour" onClick={() => setChoisi(null)}>
          <Icon fafa="faChevronLeft" width={10} /> {t("retour")}
        </button>
      ) : null}
      <div className="crmLeadTete">
        <h2>{lead.client.data.nom || nomDe(lead.client)}</h2>
        <Pastille ton={niveauScore(lead.score) === "chaud" ? "ok" : niveauScore(lead.score) === "tiede" ? "warn" : "idle"}>{t("colScore")} {lead.score}</Pastille>
        <p className="crmSous">{[lead.client.data.entreprise, lead.client.data.telephone, lead.client.data.email].filter(Boolean).join(" · ")}</p>
      </div>
      <div className="crmLeadBloc">
        <h3>{t("pourquoiScore")}</h3>
        <ul className="crmRaisons">
          {lead.raisons.map((r) => (
            <li key={r.cle}><span>{t(`r_${r.cle}`, r)}</span><strong>+{r.points}</strong></li>
          ))}
        </ul>
      </div>
      {proches.length ? (
        <div className="crmLeadBloc">
          <h3>{t("doublonPossible")}</h3>
          <div className="crmAlerte">
            {t("doublonDetail", { nom: nomDe(proches[0].client), raisons: proches[0].raisons.map((x) => t(`raison_${x}`)).join(", ") })}
            <button type="button" className="crmLien" onClick={() => actions.ouvrirCompte(proches[0].client.id)}>{t("ouvrirExistant")}</button>
          </div>
        </div>
      ) : null}
      <div className="crmLeadBloc crmLeadForm">
        <h3>{t("qualifier")}</h3>
        <label className="crmChamp"><span>{t("besoin")}</span><input value={besoin} onChange={(e) => setBesoin(e.target.value)} /></label>
        <label className="crmChamp"><span>{t("montantEstime")}</span><input type="number" min="0" step="1000" value={montantEstime} onChange={(e) => setMontantEstime(e.target.value)} /></label>
        <label className="crmChamp">
          <span>{t("attribuer")}</span>
          <select value={responsable} onChange={(e) => setResponsable(e.target.value)}>
            <option value="">{t("nonAttribue")}</option>
            {d.membres.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <div className="crmLeadBoutons">
          <button
            type="button"
            className="crmBtn crmBtnPrimaire"
            onClick={async () => {
              await actions.convertirLead(lead.client, { besoin, montant: montantEstime, responsableId: responsable });
              setChoisi(null);
            }}
          >
            {t("convertir")}
          </button>
          <button type="button" className="crmBtn" onClick={async () => { await actions.ecarterLead(lead.client); setChoisi(null); }}>{t("ecarter")}</button>
          <button type="button" className="crmBtn" onClick={() => actions.ouvrirCompte(lead.client.id)}>{t("navComptes")}</button>
        </div>
      </div>
    </aside>
  ) : (
    !telephone && <aside className="crmCarte crmLeadPanneau"><Vide icone="faHandPointer">{t("selectionnerLead")}</Vide></aside>
  );

  if (telephone && lead) return <div className="crmPage">{panneau}</div>;

  return (
    <div className="crmPage crmPageLeads">
      <div className="crmLeadsListe">
        <header className="crmEntete">
          <div>
            <h1>{t("navLeads")}</h1>
            <p className="crmSous">{t("nbLeads", { n: ctx.leads.length })}</p>
          </div>
          <div className="crmFiltres">
            <select className="crmChoix" value={source} onChange={(e) => setSource(e.target.value)} aria-label={t("filtreSource")}>
              <option value="">{t("filtreSource")} : {t("tous")}</option>
              {SOURCES.map((s) => <option key={s} value={s}>{t(`source_${s}`)}</option>)}
            </select>
            <button type="button" className="crmPuce" data-on={chauds ? "1" : undefined} onClick={() => setChauds((x) => !x)}>{t("filtreChauds")}</button>
            <button type="button" className="crmPuce" data-on={libres ? "1" : undefined} onClick={() => setLibres((x) => !x)}>{t("nonAttribues")}</button>
            <button type="button" className="crmBtn crmBtnPrimaire" onClick={() => actions.editerCompte(null, { statut: "prospect" })}>{t("nouveau")}</button>
          </div>
        </header>
        {!liste.length ? (
          <Vide icone="faBolt">{t("aucunLead")}</Vide>
        ) : telephone ? (
          <ul className="crmCartesListe">
            {liste.map((l) => (
              <li key={l.client.id}>
                <button type="button" className="crmCarteCompte" onClick={() => setChoisi(l.client.id)}>
                  <Initiales nom={nomDe(l.client)} taille={40} />
                  <span className="crmCarteCompteCorps">
                    <strong>{l.client.data.nom || nomDe(l.client)}</strong>
                    <span className="crmMuted">{l.client.data.entreprise}</span>
                    <span><Pastille ton={TON_SOURCE[l.client.data.source] || "idle"}>{t(`source_${l.client.data.source || "autre"}`)}</Pastille></span>
                  </span>
                  <Score score={l.score} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="crmTableBoite">
            <table className="crmTable">
              <thead>
                <tr><th>{t("colLead")}</th><th>{t("filtreSource")}</th><th>{t("colScore")}</th><th>{t("colSignaux")}</th><th>{t("colResponsable")}</th><th>{t("colRecu")}</th></tr>
              </thead>
              <tbody>
                {liste.map((l) => {
                  const s = signauxCampagnes(l.client.id, d.campagnes);
                  return (
                    <tr key={l.client.id} className="handcr" data-choisi={choisi === l.client.id ? "1" : undefined} onClick={() => setChoisi(l.client.id)}>
                      <td><strong>{l.client.data.nom || nomDe(l.client)}</strong><span className="crmMuted crmPetit crmBloc">{l.client.data.entreprise}</span></td>
                      <td><Pastille ton={TON_SOURCE[l.client.data.source] || "idle"}>{t(`source_${l.client.data.source || "autre"}`)}</Pastille></td>
                      <td><Score score={l.score} /></td>
                      <td className="crmMuted crmPetit">{[s.clics ? t("r_clics", { n: s.clics }) : "", s.ouvertures ? t("r_ouvertures", { n: s.ouvertures }) : "", l.client.data.besoin].filter(Boolean).join(" · ") || "—"}</td>
                      <td>{membreDe(l.client.data.responsableId)?.name || <span className="crmMuted">{t("nonAttribue")}</span>}</td>
                      <td className="crmMuted crmPetit">{dateCourte(l.client.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!telephone ? panneau : null}
    </div>
  );
};

// L'analyse : le pipeline par étape, le taux de transformation, et les
// clients qu'on n'a pas appelés depuis trop longtemps.

import React from "react";
import { montant as money } from "../../../../utils/monnaie";
import { nomDe } from "../domaine";

export const Analyse = ({
  pipeTotal,
  etapes,
  transformation,
  dormants,
  membreDe,
  setVue,
  ouvrirClient,
}) => (
  <div className="crmAnalyse cosScroll">
    <div className="crmSousTitre">Pipeline par étape</div>
    {!pipeTotal ? (
      <div className="crmEmptyBox">Aucune affaire en cours.</div>
    ) : (
      etapes.map((e) => (
        <div key={e.id} className="crmJauge">
          <span className="crmJaugeNom">{e.label}</span>
          <span className="crmJaugeFond">
            <span
              className="crmJaugeVal"
              style={{
                width: `${(e.montant / Math.max(1, ...etapes.map((x) => x.montant))) * 100}%`,
              }}
            />
          </span>
          <span className="crmJaugeChiffre">
            {money(e.montant)}
            <em> → {money(e.pondere)}</em>
          </span>
        </div>
      ))
    )}

    <div className="crmSousTitre">Transformation</div>
    {!transformation ? (
      <div className="crmEmptyBox">
        Aucune affaire close : le taux se calcule sur les affaires
        gagnées et perdues, pas sur celles en cours.
      </div>
    ) : (
      <div className="crmCartes">
        <div className="crmCarteStat">
          <span className="crmCarteVal">{transformation.taux} %</span>
          <span className="crmCarteLbl">affaires gagnées</span>
        </div>
        <div className="crmCarteStat">
          <span className="crmCarteVal">
            {money(transformation.montantGagne)}
          </span>
          <span className="crmCarteLbl">
            {transformation.gagnees} gagnées · {transformation.perdues} perdues
          </span>
        </div>
      </div>
    )}

    <div className="crmSousTitre">Clients à rappeler</div>
    {!dormants.length ? (
      <div className="crmEmptyBox">
        Tout le portefeuille a été contacté récemment.
      </div>
    ) : (
      dormants.slice(0, 12).map(({ client: c, jours }) => (
        <div
          key={c.id}
          className="crmDormant handcr"
          onClick={() => {
            setVue("portefeuille");
            ouvrirClient(c);
          }}
        >
          <span className="crmTag" data-ton={jours === null ? "bad" : "warn"}>
            {jours === null ? "jamais" : `${jours} j`}
          </span>
          <span className="crmDormantNom">{nomDe(c)}</span>
          <span className="crmMuted">{c.data.ville || "—"}</span>
          <span className="crmMuted">
            {membreDe(c.data.responsableId)?.name || "sans responsable"}
          </span>
        </div>
      ))
    )}
  </div>
);

// L'analyse : ce qui arrive à échéance, et comment l'effectif se répartit.
//
// Les contrats à échéance sont en premier parce que c'est le seul bloc qui
// appelle une action — les deux autres se regardent.

import React from "react";
import { montant as money } from "../../../../utils/monnaie";
import {
  TYPES_CONTRAT,
  nomComplet,
  parAnciennete,
  parDepartement,
} from "../domaine";

export const Analyse = ({
  echeances,
  salaries,
  setVue,
  setFiltreStatut,
  ouvrirSalarie,
}) => (
  <div className="rhAnalyse cosScroll">
    <div className="rhSousTitre">Contrats à échéance — 60 jours</div>
    {!echeances.length ? (
      <div className="rhEmptyBox">
        Aucun contrat à durée déterminée n'arrive à terme.
      </div>
    ) : (
      echeances.map(({ salarie: s, jours }) => (
        <div
          key={s.id}
          className="rhAlerte handcr"
          onClick={() => {
            setVue("personnel");
            setFiltreStatut("tous");
            ouvrirSalarie(s);
          }}
        >
          <span className="rhTag" data-ton={jours <= 15 ? "bad" : "warn"}>
            {jours < 0 ? `dépassé de ${-jours} j` : `dans ${jours} j`}
          </span>
          <span className="rhAlerteNom">{nomComplet(s)}</span>
          <span className="rhMuted">
            {TYPES_CONTRAT[s.data.typeContrat]?.label} · fin {s.data.dateFin}
          </span>
          <span className="rhMuted">{s.data.poste || "—"}</span>
        </div>
      ))
    )}

    <div className="rhSousTitre">Effectif par département</div>
    {(() => {
      const liste = parDepartement(salaries);
      if (!liste.length)
        return <div className="rhEmptyBox">Aucun salarié actif.</div>;
      const max = Math.max(1, ...liste.map((d) => d.effectif));
      return liste.map((d) => (
        <div key={d.nom} className="rhJauge">
          <span className="rhJaugeNom">{d.nom}</span>
          <span className="rhJaugeFond">
            <span
              className="rhJaugeVal"
              style={{ width: `${(d.effectif / max) * 100}%` }}
            />
          </span>
          <span className="rhJaugeChiffre">
            {d.effectif}
            <em> · {money(d.masse)}</em>
          </span>
        </div>
      ));
    })()}

    <div className="rhSousTitre">Ancienneté</div>
    {(() => {
      const tranches = parAnciennete(salaries);
      const max = Math.max(1, ...tranches.map((t) => t.effectif));
      if (!tranches.some((t) => t.effectif))
        return <div className="rhEmptyBox">Aucun salarié actif.</div>;
      return tranches.map((t) => (
        <div key={t.id} className="rhJauge">
          <span className="rhJaugeNom">{t.label}</span>
          <span className="rhJaugeFond">
            <span
              className="rhJaugeVal"
              style={{ width: `${(t.effectif / max) * 100}%` }}
            />
          </span>
          <span className="rhJaugeChiffre">{t.effectif}</span>
        </div>
      ));
    })()}
  </div>
);

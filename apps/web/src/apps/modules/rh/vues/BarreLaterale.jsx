// La barre latérale des RH : le choix de la vue, puis les filtres de statut
// quand on regarde le personnel.
//
// La pastille sur « Congés & absences » compte les demandes non tranchées :
// c'est la seule chose du module qui attend une décision de quelqu'un, elle
// doit se voir sans ouvrir l'écran.

import React from "react";
import { Icon } from "../../../../utils/general";
import { STATUTS } from "../domaine";

const VUES = [
  { id: "personnel", label: "Personnel", icone: "faUsers" },
  { id: "absences", label: "Congés & absences", icone: "faUmbrellaBeach" },
  { id: "analyse", label: "Analyse", icone: "faChartColumn" },
  { id: "reglages", label: "Réglages", icone: "faSliders" },
];

export const BarreLaterale = ({
  vue,
  setVue,
  enAttente,
  salaries,
  filtreStatut,
  setFiltreStatut,
  nouveauSalarie,
  exporterPersonnel,
}) => (
  <aside className="rhNav cosScroll">
    {VUES.map((v) => (
      <div
        key={v.id}
        className="rhNavItem handcr"
        data-actif={vue === v.id}
        onClick={() => setVue(v.id)}
      >
        <Icon fafa={v.icone} width={13} />
        <span>{v.label}</span>
        {v.id === "absences" && enAttente.length ? (
          <span className="rhPastille">{enAttente.length}</span>
        ) : null}
      </div>
    ))}

    {vue === "personnel" ? (
      <>
        <div className="rhNavTitre">Statut</div>
        {[["tous", "Tous"], ...Object.entries(STATUTS).map(([id, s]) => [id, s.label])].map(
          ([id, label]) => (
            <div
              key={id}
              className="rhFiltre handcr"
              data-actif={filtreStatut === id}
              onClick={() => setFiltreStatut(id)}
            >
              <span>{label}</span>
              <span className="rhFiltreCompte">
                {id === "tous"
                  ? salaries.length
                  : salaries.filter((s) => s.data.statut === id).length}
              </span>
            </div>
          ),
        )}

        <div className="rhNavTitre">Personnel</div>
        <div className="rhNavItem handcr" onClick={nouveauSalarie}>
          <Icon fafa="faUserPlus" width={12} />
          <span>Nouveau dossier</span>
        </div>
        <div className="rhNavItem handcr" onClick={exporterPersonnel}>
          <Icon fafa="faFileCsv" width={12} />
          <span>Exporter</span>
        </div>
      </>
    ) : null}
  </aside>
);

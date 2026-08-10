// La barre latérale du CRM : le choix de la vue, puis les filtres de statut
// et les actions du portefeuille quand c'est lui qu'on regarde.
//
// La pastille sur « À faire » compte les relances en retard : c'est la
// seule chose du module qui se dégrade toute seule avec le temps, elle doit
// se voir sans ouvrir l'écran.

import React from "react";
import { Icon } from "../../../../utils/general";
import { STATUTS } from "../domaine";

const VUES = [
  { id: "portefeuille", label: "Portefeuille", icone: "faUsers" },
  { id: "pipeline", label: "Pipeline", icone: "faFilter" },
  { id: "agenda", label: "À faire", icone: "faListCheck" },
  { id: "analyse", label: "Analyse", icone: "faChartColumn" },
];

export const BarreLaterale = ({
  vue,
  setVue,
  enRetard,
  clients,
  filtreStatut,
  setFiltreStatut,
  nouveauClient,
  exporterPortefeuille,
}) => (
  <aside className="crmNav cosScroll">
    {VUES.map((v) => (
      <div
        key={v.id}
        className="crmNavItem handcr"
        data-actif={vue === v.id}
        onClick={() => setVue(v.id)}
      >
        <Icon fafa={v.icone} width={13} />
        <span>{v.label}</span>
        {v.id === "agenda" && enRetard ? (
          <span className="crmPastille">{enRetard}</span>
        ) : null}
      </div>
    ))}

    {vue === "portefeuille" ? (
      <>
        <div className="crmNavTitre">Statut</div>
        {[["tous", "Tous"], ...Object.entries(STATUTS).map(([id, s]) => [id, s.label])].map(
          ([id, label]) => (
            <div
              key={id}
              className="crmFiltre handcr"
              data-actif={filtreStatut === id}
              onClick={() => setFiltreStatut(id)}
            >
              <span>{label}</span>
              <span className="crmFiltreCompte">
                {id === "tous"
                  ? clients.length
                  : clients.filter((c) => c.data.statut === id).length}
              </span>
            </div>
          ),
        )}

        <div className="crmNavTitre">Portefeuille</div>
        <div className="crmNavItem handcr" onClick={nouveauClient}>
          <Icon fafa="faUserPlus" width={12} />
          <span>Nouveau client</span>
        </div>
        <div className="crmNavItem handcr" onClick={exporterPortefeuille}>
          <Icon fafa="faFileCsv" width={12} />
          <span>Exporter</span>
        </div>
      </>
    ) : null}
  </aside>
);

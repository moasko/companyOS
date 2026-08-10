// « À faire » : les relances des quinze prochains jours, les retards en
// tête. C'est l'écran sur lequel on ouvre le module le matin.

import React from "react";
import { Icon } from "../../../../utils/general";
import { nomDe } from "../domaine";

export const Agenda = ({
  taches,
  clientDe,
  basculerTache,
  setVue,
  ouvrirClient,
}) => (
  <div className="crmAgenda cosScroll">
    {!taches.length ? (
      <div className="crmVide">
        <Icon fafa="faListCheck" width={24} />
        <span>Rien à relancer dans les quinze jours.</span>
      </div>
    ) : (
      taches.map(({ activite: a, enRetard: tard, aujourdhui }) => {
        const c = clientDe(a.data.clientId);
        return (
          <div
            key={a.id}
            className="crmTache"
            data-retard={tard}
            data-aujourdhui={aujourdhui}
          >
            <span
              className="crmCase handcr"
              onClick={() => basculerTache(a)}
              title="Marquer comme faite"
            >
              <Icon fafa="faCheck" width={9} />
            </span>
            <div className="crmTacheInfo">
              <div className="crmTacheTitre">{a.data.resume}</div>
              <div className="crmTacheMeta">
                {a.data.echeance}
                {tard ? " · en retard" : aujourdhui ? " · aujourd'hui" : ""}
              </div>
            </div>
            <span
              className="crmLien handcr"
              onClick={() => {
                if (!c) return;
                setVue("portefeuille");
                ouvrirClient(c);
              }}
            >
              {c ? nomDe(c) : "client supprimé"}
            </span>
          </div>
        );
      })
    )}
  </div>
);

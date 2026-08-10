// Le pipeline commercial : une colonne par étape, les affaires dedans, et
// le glisser-déposer d'une colonne à l'autre pour faire avancer un dossier.
//
// Les deux étapes closes — gagnée et perdue — sont ajoutées après les
// étapes ouvertes : on doit pouvoir y déposer une affaire, mais elles ne
// font pas partie du pipeline au sens des chiffres.

import React from "react";
import { montant as money } from "../../../../utils/monnaie";
import { ETAPES, ETAPES_OUVERTES } from "../domaine";
import { CarteAffaire } from "./CarteAffaire";

export const Pipeline = ({
  opportunites,
  clientDe,
  oppOuverte,
  ouvrirAffaire,
  marquerGlisse,
  deposerAffaire,
}) => (
  <div className="crmPipeline cosScroll">
    {ETAPES_OUVERTES.concat(["gagnee", "perdue"]).map((id) => {
      const e = ETAPES[id];
      const liste = opportunites.filter((o) => o.data.etape === id);
      const montant = liste.reduce(
        (s, o) => s + (Number(o.data.montant) || 0),
        0,
      );
      return (
        <div
          key={id}
          className="crmColonne"
          onDragOver={(e2) => e2.preventDefault()}
          onDrop={(e2) => {
            e2.preventDefault();
            deposerAffaire(id);
          }}
        >
          <div className="crmColonneTete" data-ton={e.ton}>
            <span className="crmColonneNom">{e.label}</span>
            <span className="crmColonneCompte">{liste.length}</span>
          </div>
          <div className="crmColonneMontant">{money(montant)}</div>
          {liste.map((o) => (
            <CarteAffaire
              key={o.id}
              opp={o}
              client={clientDe(o.data.clientId)}
              actif={oppOuverte?.id === o.id}
              onOuvrir={ouvrirAffaire}
              onGlisser={marquerGlisse}
            />
          ))}
          {!liste.length ? (
            <div className="crmColonneVide">Déposez une affaire ici</div>
          ) : null}
        </div>
      );
    })}
  </div>
);

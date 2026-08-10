// La carte d'une affaire, telle qu'elle apparaît dans une colonne du
// pipeline.

import React from "react";
import { montant as money } from "../../../../utils/monnaie";
import { nomDe } from "../domaine";

/// Carte d'affaire du pipeline.
///
/// Définie **hors** du composant parent et mémorisée : déclarée à
/// l'intérieur, React en ferait un type nouveau à chaque rendu, démonterait
/// puis remonterait chaque carte, et détruirait le nœud en cours de
/// glissement au premier `dragover` — le glisser-déposer serait cassé.
export const CarteAffaire = React.memo(function CarteAffaire({
  opp,
  client,
  actif,
  onOuvrir,
  onGlisser,
}) {
  return (
    <div
      className="crmAffaire handcr"
      data-actif={actif}
      draggable
      onDragStart={(e) => {
        // Sans `setData`, le navigateur n'initie tout simplement pas le
        // glissement — il ne suffit pas de poser `draggable`.
        e.dataTransfer.setData("text/plain", opp.id);
        e.dataTransfer.effectAllowed = "move";
        onGlisser(opp.id);
      }}
      onClick={() => onOuvrir(opp)}
    >
      <div className="crmAffaireNom">{opp.data.libelle || "Sans libellé"}</div>
      <div className="crmAffaireClient">{client ? nomDe(client) : "—"}</div>
      <div className="crmAffairePied">
        <span className="crmAffaireMontant">{money(opp.data.montant)}</span>
        {opp.data.dateCloture ? (
          <span className="crmAffaireDate">{opp.data.dateCloture}</span>
        ) : null}
      </div>
    </div>
  );
});

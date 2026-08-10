// Les cartes du tableau en liste : le même contenu que la planche, mis à
// plat pour être lu ligne à ligne — colonne, échéance, assigné, client.

import React from "react";
import {
  avancementChecklist,
  formatEcheance,
  statutEcheance,
} from "../board";

export const Liste = ({
  cartesVisibles,
  colonnes,
  stats,
  membreDe,
  clientDe,
  setCarteOuverte,
}) => (
  <div className="pjListe cosScroll">
    <table>
      <thead>
        <tr>
          <th>Carte</th>
          <th>Colonne</th>
          <th>Échéance</th>
          <th>Assigné</th>
          <th>Client</th>
          <th>Check-list</th>
        </tr>
      </thead>
      <tbody>
        {cartesVisibles.map((c) => {
          const av = avancementChecklist(c.data.checklist);
          const terminee = c.data.colonneId === stats.colonneTerminee;
          return (
            <tr key={c.id} onClick={() => setCarteOuverte(c)}>
              <td className="pjListeTitre">{c.data.titre}</td>
              <td>
                {colonnes.find((x) => x.id === c.data.colonneId)?.titre}
              </td>
              <td>
                {c.data.echeance ? (
                  <span
                    className="pjEcheance"
                    data-etat={statutEcheance(c.data.echeance, terminee)}
                  >
                    {formatEcheance(c.data.echeance)}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td>{membreDe(c.data.assigneId)?.name || "—"}</td>
              <td>
                {clientDe(c.data.liens?.clientId)?.data.entreprise ||
                  clientDe(c.data.liens?.clientId)?.data.nom ||
                  "—"}
              </td>
              <td>{av ? `${av.faits}/${av.total}` : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    {!cartesVisibles.length ? (
      <div className="pjVide">Aucune carte à afficher.</div>
    ) : null}
  </div>
);

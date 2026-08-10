// L'échéancier : les cartes regroupées par urgence, du retard au lointain,
// et pour finir celles qui n'ont pas de date.

import React from "react";
import { formatEcheance, statutEcheance } from "../board";

export const Echeancier = ({
  cartesVisibles,
  colonnes,
  stats,
  membreDe,
  initiales,
  setCarteOuverte,
}) => (
  <div className="pjEcheancier cosScroll">
    {["retard", "aujourdhui", "bientot", "lointain", null].map((etat) => {
      const groupe = cartesVisibles.filter((c) => {
        const terminee = c.data.colonneId === stats.colonneTerminee;
        const s = statutEcheance(c.data.echeance, terminee);
        return etat === null ? !c.data.echeance : s === etat;
      });
      if (!groupe.length) return null;
      const titres = {
        retard: "En retard",
        aujourdhui: "Aujourd'hui",
        bientot: "Dans les 3 jours",
        lointain: "Plus tard",
        null: "Sans échéance",
      };
      return (
        <div className="pjGroupe" key={etat || "sans"}>
          <div className="pjGroupeTitre" data-etat={etat}>
            {titres[etat === null ? "null" : etat]}
            <span className="pjCompte">{groupe.length}</span>
          </div>
          {groupe.map((c) => (
            <div
              className="pjLigne"
              key={c.id}
              onClick={() => setCarteOuverte(c)}
            >
              <span className="pjLigneTitre">{c.data.titre}</span>
              <span className="pjLigneCol">
                {colonnes.find((x) => x.id === c.data.colonneId)?.titre}
              </span>
              {c.data.echeance ? (
                <span className="pjLigneDate">
                  {formatEcheance(c.data.echeance)}
                </span>
              ) : null}
              {membreDe(c.data.assigneId) ? (
                <span className="pjAvatar">
                  {initiales(membreDe(c.data.assigneId).name)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      );
    })}
    {!cartesVisibles.length ? (
      <div className="pjVide">Aucune carte à afficher.</div>
    ) : null}
  </div>
);

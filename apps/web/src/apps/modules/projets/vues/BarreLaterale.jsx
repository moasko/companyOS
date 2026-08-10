// Le rail des tableaux : la liste de tous les tableaux de l'espace de
// travail, avec le nombre de cartes de chacun, et de quoi en créer un.
//
// Changer de tableau efface les filtres : ils ont été posés pour le
// tableau qu'on quitte, et les garder ferait croire l'arrivée vide.

import React from "react";
import { Icon } from "../../../../utils/general";
import { FILTRE_VIDE } from "../board";

export const BarreLaterale = ({
  tableaux,
  tableauId,
  setTableauId,
  setFiltre,
  cartes,
  creerTableau,
}) => (
  <div className="pjRail cosScroll">
    <div className="pjRailTitre">Tableaux</div>
    {tableaux.map((t) => (
      <div
        key={t.id}
        className="pjRailItem"
        data-actif={t.id === tableauId ? "true" : "false"}
        onClick={() => {
          setTableauId(t.id);
          setFiltre(FILTRE_VIDE);
        }}
      >
        <span
          className="pjPuce"
          style={{ background: t.data.couleur }}
        />
        <span className="pjRailNom">{t.data.nom}</span>
        <span className="pjCompte">
          {cartes.filter((c) => c.data.tableauId === t.id).length}
        </span>
      </div>
    ))}
    <div className="pjRailAjout" onClick={creerTableau}>
      <Icon fafa="faPlus" width={10} /> Nouveau tableau
    </div>
  </div>
);

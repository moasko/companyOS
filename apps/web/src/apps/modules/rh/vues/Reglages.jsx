// Les réglages de congés : taux d'acquisition, jours ouvrables, jours fériés.
//
// L'écran explique longuement d'où viennent les valeurs par défaut, parce
// qu'un solde de congés faux se découvre sur une paie — et qu'il vaut mieux
// que l'utilisateur sache qu'il peut, et parfois doit, les changer.

import React from "react";
import { Icon } from "../../../../utils/general";

export const Reglages = ({ reglages, setReglages, busy, enregistrerReglages }) => (
  <div className="rhAnalyse cosScroll">
    <div className="rhSousTitre">Congés payés</div>
    <div className="rhNote">
      Ces valeurs servent à calculer les soldes. Elles suivent
      l'usage le plus répandu en Afrique de l'Ouest — deux jours et
      deux dixièmes acquis par mois de service, dimanche seul
      chômé. Une convention collective ou un accord d'entreprise
      peut en décider autrement : ajustez-les, le module ne dit pas
      le droit, il calcule.
    </div>

    <div className="rhDeux">
      <label className="rhField">
        <span className="rhLabel">Jours acquis par mois</span>
        <input
          type="number"
          step="0.1"
          value={reglages.acquisParMois}
          onChange={(e) =>
            setReglages((r) => ({
              ...r,
              acquisParMois: Number(e.target.value) || 0,
            }))
          }
        />
      </label>
      <label className="rhField">
        <span className="rhLabel">Soit par an</span>
        <div className="rhReadonly">
          {Math.round(reglages.acquisParMois * 12 * 10) / 10} jours
        </div>
      </label>
    </div>

    <div className="rhField">
      <span className="rhLabel">Jours ouvrables de la semaine</span>
      <div className="rhJours">
        {["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"].map((j, i) => (
          <span
            key={j}
            className="handcr"
            data-actif={reglages.joursOuvres.includes(i)}
            onClick={() =>
              setReglages((r) => ({
                ...r,
                joursOuvres: r.joursOuvres.includes(i)
                  ? r.joursOuvres.filter((x) => x !== i)
                  : [...r.joursOuvres, i].sort(),
              }))
            }
          >
            {j}
          </span>
        ))}
      </div>
    </div>

    <label className="rhField">
      <span className="rhLabel">
        Jours fériés — une date AAAA-MM-JJ par ligne
      </span>
      <textarea
        rows={5}
        placeholder="2026-08-07"
        value={(reglages.feries || []).join("\n")}
        onChange={(e) =>
          setReglages((r) => ({
            ...r,
            feries: e.target.value
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean),
          }))
        }
      />
    </label>
    <div className="rhNote">
      Volontairement vide au départ : les fériés changent chaque
      année et selon le pays. En inventer serait pire que de ne
      rien mettre — un congé mal compté se voit sur une paie.
    </div>

    <div className="rhFormActions">
      <div
        className="rhPrimary handcr"
        data-off={busy}
        onClick={enregistrerReglages}
      >
        <Icon fafa="faFloppyDisk" width={11} />
        <span>{busy ? "…" : "Enregistrer"}</span>
      </div>
    </div>
  </div>
);

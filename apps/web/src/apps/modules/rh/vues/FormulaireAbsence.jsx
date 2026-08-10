// La saisie d'une absence, dans le panneau de droite.
//
// Le nombre de jours ouvrables se met à jour pendant la saisie : c'est ce
// qui sera décompté du solde, autant le montrer avant d'enregistrer.

import React from "react";
import { ETATS_DEMANDE, TYPES_ABSENCE, joursOuvrables, nomComplet } from "../domaine";

export const FormulaireAbsence = ({
  absOuverte,
  setAbsOuverte,
  salaries,
  reglages,
  busy,
  enregistrerAbsence,
}) => (
  <>
    <div className="rhPanTitre">
      {absOuverte.id ? "Absence" : "Nouvelle absence"}
    </div>

    <label className="rhField">
      <span className="rhLabel">Salarié</span>
      <select
        value={absOuverte.salarieId}
        onChange={(e) =>
          setAbsOuverte((a) => ({ ...a, salarieId: e.target.value }))
        }
      >
        <option value="">—</option>
        {salaries
          .filter((s) => s.data.statut !== "sorti")
          .map((s) => (
            <option key={s.id} value={s.id}>
              {nomComplet(s)}
            </option>
          ))}
      </select>
    </label>

    <label className="rhField">
      <span className="rhLabel">Type</span>
      <select
        value={absOuverte.type}
        onChange={(e) =>
          setAbsOuverte((a) => ({ ...a, type: e.target.value }))
        }
      >
        {Object.entries(TYPES_ABSENCE).map(([id, t]) => (
          <option key={id} value={id}>
            {t.label}
            {t.decompte ? " (décompté)" : ""}
          </option>
        ))}
      </select>
    </label>

    <div className="rhDeux">
      <label className="rhField">
        <span className="rhLabel">Du</span>
        <input
          type="date"
          value={absOuverte.du}
          onChange={(e) =>
            setAbsOuverte((a) => ({ ...a, du: e.target.value }))
          }
        />
      </label>
      <label className="rhField">
        <span className="rhLabel">Au</span>
        <input
          type="date"
          value={absOuverte.au}
          onChange={(e) =>
            setAbsOuverte((a) => ({ ...a, au: e.target.value }))
          }
        />
      </label>
    </div>

    <div className="rhRecap">
      <span>Jours ouvrables</span>
      <strong>{joursOuvrables(absOuverte.du, absOuverte.au, reglages)}</strong>
    </div>

    <label className="rhField">
      <span className="rhLabel">Motif</span>
      <input
        type="text"
        value={absOuverte.motif}
        onChange={(e) =>
          setAbsOuverte((a) => ({ ...a, motif: e.target.value }))
        }
      />
    </label>

    <label className="rhField">
      <span className="rhLabel">État</span>
      <select
        value={absOuverte.etat}
        onChange={(e) =>
          setAbsOuverte((a) => ({ ...a, etat: e.target.value }))
        }
      >
        {Object.entries(ETATS_DEMANDE).map(([id, e]) => (
          <option key={id} value={id}>
            {e.label}
          </option>
        ))}
      </select>
    </label>

    <div className="rhFormActions">
      <div
        className="rhPrimary handcr"
        data-off={busy}
        onClick={enregistrerAbsence}
      >
        Enregistrer
      </div>
      <div className="rhBtnGhost handcr" onClick={() => setAbsOuverte(null)}>
        Fermer
      </div>
    </div>
  </>
);

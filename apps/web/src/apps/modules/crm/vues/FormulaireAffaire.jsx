// Le formulaire d'une affaire, dans le panneau de droite : celle qu'on
// vient de créer depuis une fiche client, ou celle qu'on a ouverte depuis
// le pipeline.
//
// La valeur pondérée est affichée pendant la saisie : c'est ce chiffre-là
// qui remonte dans le pipeline, autant qu'il ne soit pas une surprise.

import React from "react";
import { montant as money } from "../../../../utils/monnaie";
import { ETAPES, nomDe, valeurPonderee } from "../domaine";

export const FormulaireAffaire = ({
  oppOuverte,
  setOppOuverte,
  clients,
  busy,
  enregistrerAffaire,
  supprimerAffaire,
}) => (
  <>
    <div className="crmPanTitre">
      {oppOuverte.id ? "Affaire" : "Nouvelle affaire"}
    </div>

    <label className="crmField">
      <span className="crmLabel">Libellé</span>
      <input
        type="text"
        value={oppOuverte.libelle}
        onChange={(e) =>
          setOppOuverte((o) => ({ ...o, libelle: e.target.value }))
        }
      />
    </label>

    <label className="crmField">
      <span className="crmLabel">Client</span>
      <select
        value={oppOuverte.clientId}
        onChange={(e) =>
          setOppOuverte((o) => ({ ...o, clientId: e.target.value }))
        }
      >
        <option value="">—</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {nomDe(c)}
          </option>
        ))}
      </select>
    </label>

    <div className="crmDeux">
      <label className="crmField">
        <span className="crmLabel">Montant</span>
        <input
          type="number"
          value={oppOuverte.montant}
          onChange={(e) =>
            setOppOuverte((o) => ({ ...o, montant: e.target.value }))
          }
        />
      </label>
      <label className="crmField">
        <span className="crmLabel">Clôture prévue</span>
        <input
          type="date"
          value={oppOuverte.dateCloture || ""}
          onChange={(e) =>
            setOppOuverte((o) => ({ ...o, dateCloture: e.target.value }))
          }
        />
      </label>
    </div>

    <label className="crmField">
      <span className="crmLabel">Étape</span>
      <select
        value={oppOuverte.etape}
        onChange={(e) =>
          setOppOuverte((o) => ({ ...o, etape: e.target.value }))
        }
      >
        {Object.entries(ETAPES).map(([id, e]) => (
          <option key={id} value={id}>
            {e.label}
          </option>
        ))}
      </select>
    </label>

    <label className="crmField">
      <span className="crmLabel">
        Probabilité % — vide : celle de l'étape (
        {ETAPES[oppOuverte.etape]?.probabilite} %)
      </span>
      <input
        type="number"
        placeholder={String(ETAPES[oppOuverte.etape]?.probabilite ?? "")}
        value={oppOuverte.probabilite ?? ""}
        onChange={(e) =>
          setOppOuverte((o) => ({ ...o, probabilite: e.target.value }))
        }
      />
    </label>

    <div className="crmRecap">
      <span>Valeur pondérée</span>
      <strong>{money(valeurPonderee({ data: oppOuverte }))}</strong>
    </div>

    <label className="crmField">
      <span className="crmLabel">Notes</span>
      <textarea
        rows={3}
        value={oppOuverte.notes || ""}
        onChange={(e) =>
          setOppOuverte((o) => ({ ...o, notes: e.target.value }))
        }
      />
    </label>

    <div className="crmFormActions">
      <div
        className="crmPrimary handcr"
        data-off={busy}
        onClick={enregistrerAffaire}
      >
        Enregistrer
      </div>
      <div className="crmBtnGhost handcr" onClick={() => setOppOuverte(null)}>
        Fermer
      </div>
      {oppOuverte.id ? (
        <div
          className="crmBtnGhost crmDanger handcr"
          onClick={() => supprimerAffaire({ id: oppOuverte.id, ...oppOuverte })}
        >
          Supprimer
        </div>
      ) : null}
    </div>
  </>
);

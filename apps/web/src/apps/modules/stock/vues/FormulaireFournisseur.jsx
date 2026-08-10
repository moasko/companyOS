// Le formulaire d'un fournisseur, dans le panneau de droite.
//
// Il prend la place de la fiche produit tant qu'il est ouvert : un
// fournisseur se saisit en cinq champs, cela ne justifiait pas un écran à
// part.

import React from "react";

export const FormulaireFournisseur = ({
  fournisseurDraft,
  setFournisseurDraft,
  busy,
  enregistrerFournisseur,
}) => (
  <>
    <div className="stkPanTitre">
      {fournisseurDraft.id ? "Fournisseur" : "Nouveau fournisseur"}
    </div>
    {[
      ["nom", "Nom"],
      ["contact", "Contact"],
      ["telephone", "Téléphone"],
      ["email", "E-mail"],
      ["ville", "Ville"],
    ].map(([cle, label]) => (
      <label key={cle} className="stkField">
        <span className="stkLabel">{label}</span>
        <input
          type="text"
          value={fournisseurDraft[cle] || ""}
          onChange={(e) =>
            setFournisseurDraft((d) => ({ ...d, [cle]: e.target.value }))
          }
        />
      </label>
    ))}
    <div className="stkFormActions">
      <div
        className="stkPrimary handcr"
        data-off={busy}
        onClick={enregistrerFournisseur}
      >
        Enregistrer
      </div>
      <div
        className="stkBtnGhost handcr"
        onClick={() => setFournisseurDraft(null)}
      >
        Annuler
      </div>
    </div>
  </>
);

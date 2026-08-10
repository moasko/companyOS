// La liste des fournisseurs. Le formulaire, lui, s'ouvre dans le panneau de
// droite (`FormulaireFournisseur.jsx`) : cliquer une ligne l'y charge.

import React from "react";
import { Icon } from "../../../../utils/general";

export const Fournisseurs = ({
  fournisseurs,
  articles,
  nouveauFournisseur,
  setFournisseurDraft,
  supprimerFournisseur,
}) => (
  <>
    <div className="stkBarre">
      <div className="stkPrimary handcr" onClick={nouveauFournisseur}>
        <Icon fafa="faPlus" width={10} />
        <span>Nouveau fournisseur</span>
      </div>
    </div>

    {!fournisseurs.length ? (
      <div className="stkVide">
        <Icon fafa="faTruckField" width={24} />
        <span>Aucun fournisseur enregistré.</span>
      </div>
    ) : (
      <div className="stkTable cosScroll">
        {fournisseurs.map((f) => (
          <div key={f.id} className="stkTr stkTrFrn">
            <span
              className="stkTdNom handcr"
              onClick={() => setFournisseurDraft({ id: f.id, ...f.data })}
            >
              <strong>{f.data.nom}</strong>
              <em>{f.data.ville}</em>
            </span>
            <span className="stkMuted">{f.data.contact || "—"}</span>
            <span className="stkMuted">{f.data.telephone || "—"}</span>
            <span className="stkTdNum stkMuted">
              {articles.filter((a) => a.data.fournisseurId === f.id).length}{" "}
              produits
            </span>
            <span
              className="stkRetirer handcr"
              onClick={() => supprimerFournisseur(f)}
            >
              <Icon fafa="faTrash" width={10} />
            </span>
          </div>
        ))}
      </div>
    )}
  </>
);

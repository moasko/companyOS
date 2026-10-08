import React from "react";
import { FicheEntreprise } from "../../../../apps/entreprise/FicheEntreprise";

/// Fiche de l'entreprise : l'identité que toutes les applications
/// reprennent sur leurs documents (factures, devis, bons de commande…).
export const SectionEntreprise = ({ section }) => (
  <section className="setSection" data-hidden={section !== "entreprise"}>
    <h2>Fiche de l'entreprise</h2>
    <p className="setHint">
      Raison sociale, identifiants fiscaux, coordonnées bancaires, logo, cachet et signature —
      saisis une fois, repris sur tous vos documents.
    </p>
    {section === "entreprise" ? <FicheEntreprise /> : null}
  </section>
);

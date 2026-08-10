import React from "react";
import { Row, formatBytes } from "./commun";

export const SectionFormule = ({
  section,
  fact,
  prixDe,
  estProprietaire,
  busy,
  changerFormule,
}) => (
  <section className="setSection" data-hidden={section !== "formule"}>
    <h2>Formule et tarifs</h2>
    <p className="setHint">
      Ce que votre espace consomme, et ce que chaque formule offre
    </p>

    {fact ? (
      <>
        <div className="setFormules">
          {fact.formules.map((f) => {
            const actuelle = f.id === fact.actuelle;
            return (
              <div
                key={f.id}
                className="setFormule"
                data-actuelle={actuelle ? "true" : "false"}
              >
                {actuelle ? (
                  <div className="setFormuleBadge">Votre formule</div>
                ) : null}
                <div className="setFormuleNom">{f.nom}</div>
                <div className="setFormulePrix">{prixDe(f)}</div>
                <p className="setFormuleResume">{f.resume}</p>
                <ul className="setFormuleListe">
                  {f.avantages.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
                {actuelle ? null : estProprietaire ? (
                  <div
                    className="setPrimary handcr setFormuleAction"
                    data-off={busy}
                    onClick={() => changerFormule(f)}
                  >
                    {f.prixMois &&
                    fact.formules.findIndex((x) => x.id === fact.actuelle) <
                      fact.formules.findIndex((x) => x.id === f.id)
                      ? "Passer à cette formule"
                      : "Choisir cette formule"}
                  </div>
                ) : (
                  <div className="setFormuleNote">
                    Seul le propriétaire de l'espace peut changer de
                    formule.
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <Row
          title="Consommation actuelle"
          desc={`${fact.usage.utilisateurs} utilisateur${
            fact.usage.utilisateurs > 1 ? "s" : ""
          } · ${formatBytes(fact.usage.usedBytes)} sur ${formatBytes(
            fact.usage.quota,
          )} de stockage`}
        />
        <p className="setHint">
          Rétrograder n'est possible que si la consommation tient
          dans la formule visée — rien n'est jamais coupé d'office.
          Le règlement se fait par Mobile Money ou virement, sur
          facture.
        </p>
      </>
    ) : (
      <p className="setHint">Tarifs indisponibles pour le moment.</p>
    )}
  </section>
);

import React from "react";
import { Row, VERSION } from "./commun";

export const SectionAPropos = ({ section }) => (
  <section className="setSection" data-hidden={section !== "apropos"}>
    <h2>À propos</h2>
    <p className="setHint">CompanyOS {VERSION}</p>

    <div className="setAbout">
      <p>
        CompanyOS est un système d'exploitation web : un bureau unique
        qui réunit les applications de gestion de l'entreprise et les
        fait communiquer entre elles.
      </p>
      <p>
        Chaque espace de travail dispose de son propre stockage, de son
        catalogue d'applications et de ses données, sans jamais croiser
        ceux des autres clients.
      </p>
    </div>

    <Row title="Version" desc={`CompanyOS ${VERSION}`} />
    <Row
      title="Navigateur"
      desc={`${navigator.language} · ${
        navigator.hardwareConcurrency || "?"
      } cœurs`}
    />
    <Row
      title="Interface"
      desc="Fondée sur le projet libre win11React (Creative Commons)"
    />
  </section>
);

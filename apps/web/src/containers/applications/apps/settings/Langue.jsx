import React from "react";
import {
  FUSEAUX,
  fuseauDetecte,
  fuseauEffectif,
  heureDans,
} from "../../../../utils/heure";
import { DEVISES, deviseDetectee, montant } from "../../../../utils/monnaie";
import { LANGUES, langueDetectee } from "../../../../utils/langue";
import { Row } from "./commun";

export const SectionLangue = ({
  section,
  langue,
  appliquerLangueChoisie,
  devise,
  appliquerDevise,
  fuseau,
  appliquerFuseau,
}) => (
  <section className="setSection" data-hidden={section !== "langue"}>
    <h2>Langue et région</h2>
    <p className="setHint">Affichage du shell et des applications</p>

    {/* La langue pilote i18next : les surfaces traduites (le
        module Présentations, les chaînes extraites au fil de
        l'eau) suivent immédiatement ; le shell historique reste
        en français en attendant son extraction. */}
    <Row
      title="Langue d'affichage"
      desc={
        langue === "auto"
          ? `Automatique — ${
              langueDetectee() === "fr" ? "français" : "anglais"
            } détecté depuis le navigateur`
          : "Épinglée — retenue sur ce poste"
      }
    >
      <select
        className="setRole"
        value={langue}
        onChange={(e) => appliquerLangueChoisie(e.target.value)}
      >
        <option value="auto">
          Automatique ({langueDetectee() === "fr" ? "Français" : "English"})
        </option>
        {LANGUES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.nom}
          </option>
        ))}
      </select>
    </Row>

    <Row
      title="Devise d'affichage"
      desc={
        (devise === "auto" ? deviseDetectee() : devise) === "XOF"
          ? "Franc CFA — la monnaie des données"
          : `Conversion indicative à l'écran — ${montant(15000)} pour 15 000 F. Les données restent en franc CFA.`
      }
    >
      <select
        className="setRole"
        value={devise}
        onChange={(e) => appliquerDevise(e.target.value)}
      >
        <option value="auto">
          Automatique ({deviseDetectee()} selon le fuseau)
        </option>
        {DEVISES.map((d) => (
          <option key={d.code} value={d.code}>
            {d.nom} ({d.symbole})
          </option>
        ))}
      </select>
    </Row>

    <Row
      title="Format de date et d'heure"
      desc={`Français (France) — ${new Date().toLocaleDateString(
        "fr-FR",
      )} · ${new Date().toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      })}`}
    />

    <Row
      title="Fuseau horaire"
      desc={
        fuseau === "auto"
          ? `Automatique — ${fuseauDetecte()} détecté par le navigateur · il est ${heureDans(
              fuseauEffectif(),
            )}`
          : `Épinglé — il est ${heureDans(fuseauEffectif())}`
      }
    >
      <select
        className="setRole"
        value={fuseau}
        onChange={(e) => appliquerFuseau(e.target.value)}
      >
        <option value="auto">
          Automatique ({fuseauDetecte()})
        </option>
        {FUSEAUX.map((z) => (
          <option key={z} value={z}>
            {z.replace("_", " ")} — {heureDans(z)}
          </option>
        ))}
      </select>
    </Row>
  </section>
);

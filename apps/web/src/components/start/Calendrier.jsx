// Le calendrier du volet latéral.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI CE FICHIER EXISTE
//
// Il remplace `public/dycalendar.js` — une bibliothèque de 2016, vendorisée
// dans le dossier public, chargée en balise <script> globale à chaque page,
// non maintenue, et qui construisait sa grille à coups d'`innerHTML`. Elle
// n'était utilisée que par ce volet.
//
// Trois problèmes qu'elle posait et que ce composant n'a pas :
//   - elle s'exécutait pour tout le monde, y compris pour qui n'ouvre jamais
//     le volet ;
//   - elle écrivait dans le DOM en dehors de React, ce qui obligeait
//     `CalnWid` à un `useEffect` sans dépendances qui se redessinait à
//     chaque rendu ;
//   - ses noms de mois et de jours étaient en anglais, réglés par des
//     options maison, alors que le reste de l'OS utilise `Intl`.
// ─────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { localeEffective } from "../../utils/langue";

/// Lundi = 0. `getDay()` compte à partir de dimanche, ce qui décale la
/// grille d'un jour dans toutes les locales européennes.
const indexLundi = (date) => (date.getDay() + 6) % 7;

const memeJour = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/// Les 42 cases de la grille : les jours du mois, précédés de la fin du
/// mois précédent et suivis du début du suivant. Six semaines pleines,
/// toujours — une grille dont la hauteur change d'un mois à l'autre fait
/// sauter le volet.
const grilleDe = (annee, mois) => {
  const premier = new Date(annee, mois, 1);
  const debut = new Date(annee, mois, 1 - indexLundi(premier));

  return Array.from({ length: 42 }, (_, i) => {
    const jour = new Date(debut.getFullYear(), debut.getMonth(), debut.getDate() + i);
    return { date: jour, horsMois: jour.getMonth() !== mois };
  });
};

export const Calendrier = () => {
  const locale = localeEffective();
  const aujourdhui = useMemo(() => new Date(), []);
  const [curseur, setCurseur] = useState(
    () => new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), 1),
  );

  const decaler = (mois) =>
    setCurseur((c) => new Date(c.getFullYear(), c.getMonth() + mois, 1));

  const jours = useMemo(
    () => grilleDe(curseur.getFullYear(), curseur.getMonth()),
    [curseur],
  );

  // Les initiales des jours viennent d'`Intl`, pas d'une liste en dur :
  // elles suivent la langue de l'OS. On part d'un lundi connu (4 mars 2024)
  // pour que l'ordre corresponde à celui de la grille.
  const entetes = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { weekday: "short" });
    return Array.from({ length: 7 }, (_, i) =>
      format.format(new Date(2024, 2, 4 + i)),
    );
  }, [locale]);

  const titre = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(curseur);

  return (
    <div className="calendrier">
      <div className="calendrier-entete">
        <button
          type="button"
          className="calendrier-nav"
          onClick={() => decaler(-1)}
          aria-label="Mois précédent"
        >
          ‹
        </button>
        <button
          type="button"
          className="calendrier-titre"
          onClick={() =>
            setCurseur(new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), 1))
          }
          title="Revenir au mois courant"
        >
          {titre}
        </button>
        <button
          type="button"
          className="calendrier-nav"
          onClick={() => decaler(1)}
          aria-label="Mois suivant"
        >
          ›
        </button>
      </div>

      <div className="calendrier-jours" role="grid">
        {entetes.map((jour) => (
          <div key={jour} className="calendrier-jour-entete" role="columnheader">
            {jour}
          </div>
        ))}
        {jours.map(({ date, horsMois }) => (
          <div
            key={date.toISOString()}
            role="gridcell"
            className="calendrier-case"
            data-hors-mois={horsMois || undefined}
            data-aujourdhui={memeJour(date, aujourdhui) || undefined}
          >
            {date.getDate()}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Calendrier;

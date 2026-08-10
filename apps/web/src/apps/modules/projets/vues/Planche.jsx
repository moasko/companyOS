// La planche : les colonnes du tableau, leurs cartes, et le composeur de
// carte au pied de chaque colonne.
//
// Les cartes reçues sont déjà filtrées par `index.jsx` ; ce fichier les
// répartit dans les colonnes et met en scène le glisser-déposer — la fente
// qui montre où la carte va tomber, et le dépôt lui-même.

import React from "react";
import { Icon } from "../../../../utils/general";
import { cartesDe, filtreActif } from "../board";
import { Carte } from "./Carte";

export const Planche = ({
  molettePlanche,
  bordPendantGlisser,
  colonnes,
  cartesVisibles,
  cible,
  setCible,
  deposer,
  renommerColonne,
  supprimerColonne,
  stats,
  membreDe,
  clientDe,
  glisse,
  initiales,
  debutGlisser,
  finGlisser,
  survolCible,
  setCarteOuverte,
  filtre,
  composeur,
  setComposeur,
  saisie,
  setSaisie,
  ajouterCarte,
  ajouterColonne,
}) => (
  <div
    className="pjPlanche cosScroll"
    onWheel={molettePlanche}
    onDragOver={bordPendantGlisser}
  >
    {colonnes.map((col) => {
      const dedans = cartesDe(cartesVisibles, col.id);
      return (
        <div
          className="pjColonne"
          key={col.id}
          data-cible={cible?.colonneId === col.id ? "true" : "false"}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            // Survol du vide d'une colonne : la carte ira à la fin.
            if (!e.target.closest(".pjCarte")) {
              setCible({ colonneId: col.id, position: dedans.length });
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            deposer(
              col.id,
              cible?.colonneId === col.id ? cible.position : dedans.length
            );
          }}
        >
          <div className="pjColonneTete">
            <span
              className="pjColonneTitre"
              onClick={() => renommerColonne(col)}
            >
              {col.titre}
            </span>
            <span className="pjCompte">{dedans.length}</span>
            <Icon
              className="pjColonneSuppr"
              fafa="faXmark"
              width={10}
              onClick={() => supprimerColonne(col)}
            />
          </div>

          <div className="pjCartes cosScroll">
            {dedans.map((carte, i) => (
              <React.Fragment key={carte.id}>
                {cible?.colonneId === col.id && cible.position === i ? (
                  <div className="pjFente" />
                ) : null}
                <Carte
                  carte={carte}
                  index={i}
                  colonneId={col.id}
                  terminee={col.id === stats.colonneTerminee}
                  membre={membreDe(carte.data.assigneId)}
                  client={clientDe(carte.data.liens?.clientId)}
                  glissee={glisse?.carteId === carte.id}
                  initiales={initiales}
                  onGlisserDebut={debutGlisser}
                  onGlisserFin={finGlisser}
                  onSurvol={survolCible}
                  onDepot={deposer}
                  onOuvrir={setCarteOuverte}
                />
              </React.Fragment>
            ))}
            {cible?.colonneId === col.id &&
            cible.position >= dedans.length ? (
              <div className="pjFente" />
            ) : null}
            {!dedans.length && cible?.colonneId !== col.id ? (
              <div className="pjColonneVide">
                {filtreActif(filtre)
                  ? "Aucune carte ne correspond"
                  : "Rien ici"}
              </div>
            ) : null}
          </div>

          {composeur === col.id ? (
            <div className="pjComposeur">
              <textarea
                autoFocus
                rows={2}
                value={saisie}
                placeholder="Titre de la carte…"
                onChange={(e) => setSaisie(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ajouterCarte(col.id);
                  }
                  if (e.key === "Escape") setComposeur(null);
                }}
              />
              <div className="pjComposeurActions">
                <button
                  className="pjPrimaire"
                  onClick={() => ajouterCarte(col.id)}
                >
                  Ajouter
                </button>
                <Icon
                  fafa="faXmark"
                  width={12}
                  onClick={() => setComposeur(null)}
                />
              </div>
            </div>
          ) : (
            <div
              className="pjAjout"
              onClick={() => {
                setComposeur(col.id);
                setSaisie("");
              }}
            >
              <Icon fafa="faPlus" width={10} /> Ajouter une carte
            </div>
          )}
        </div>
      );
    })}

    <div className="pjColonneNeuve" onClick={ajouterColonne}>
      <Icon fafa="faPlus" width={11} /> Ajouter une colonne
    </div>
  </div>
);

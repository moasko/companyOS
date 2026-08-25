// Modale des raccourcis clavier : la référence vivante de l'application.
// Se ferme au clic sur le fond, sur la croix ou avec Échap.

import { Icon } from "../../../../utils/general";

const GROUPES = [
  {
    titre: "Outils",
    raccourcis: [
      ["V", "Sélection"], ["H", "Main"], ["F", "Frame"], ["R", "Rectangle"], ["O", "Ellipse"],
      ["L", "Ligne"], ["S", "Étoile"], ["T", "Texte"], ["K", "Pinceau"], ["P", "Plume"], ["C", "Recadrage"],
    ],
  },
  {
    titre: "Édition",
    raccourcis: [
      ["Ctrl+Z", "Annuler"], ["Ctrl+Maj+Z", "Rétablir"], ["Ctrl+C / V", "Copier / coller"], ["Ctrl+X", "Couper"],
      ["Ctrl+D", "Dupliquer"], ["Alt+glisser", "Dupliquer en déplaçant"], ["Double-clic", "Éditer texte ou nœuds"], ["Ctrl+G", "Grouper"],
      ["Ctrl+Maj+G", "Dissocier"], ["Ctrl+A", "Tout sélectionner"], ["Ctrl+S", "Sauver le projet"], ["Suppr", "Supprimer"],
    ],
  },
  {
    titre: "Style",
    raccourcis: [
      ["Ctrl+Alt+C", "Copier le style"], ["Ctrl+Alt+V", "Coller le style"], ["Maj", "Contraindre (carré, 45°, 15°)"],
    ],
  },
  {
    titre: "Calques & affichage",
    raccourcis: [
      ["Tab", "Calque suivant"], ["Maj+Tab", "Calque précédent"], ["Entrée", "Descendre dans le groupe"],
      ["Échap", "Remonter / désélectionner"], ["F2", "Renommer"], ["] / [", "Premier / arrière-plan"],
      ["0", "Ajuster à l'écran"], ["1", "Zoom 100 %"], ["Maj+2", "Zoom sur la sélection"],
      ["Ctrl+molette", "Zoom"], ["Flèches", "Déplacer (Maj : ×10)"],
    ],
  },
];

export default function Aide({ ouvert, fermer }) {
  if (!ouvert) return null;
  return (
    <div className="imgAide" onPointerDown={fermer}>
      <div className="imgAideCarte" onPointerDown={(event) => event.stopPropagation()}>
        <header>
          <b>Raccourcis clavier</b>
          <button onClick={fermer} aria-label="Fermer"><Icon fafa="faXmark" width={12} /></button>
        </header>
        <div className="imgAideGroupes">
          {GROUPES.map((groupe) => (
            <section key={groupe.titre}>
              <h5>{groupe.titre}</h5>
              {groupe.raccourcis.map(([touche, libelle]) => (
                <p key={touche}><span>{libelle}</span><kbd>{touche}</kbd></p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

// Écran d'accueil affiché tant que la scène est vide : actions rapides et
// invitation au glisser-déposer.

import { Icon } from "../../../../utils/general";

export default function Accueil({ surImporter, surTexte, surForme, surFrame }) {
  return (
    <div className="imgAccueil" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
      <div className="imgAccueilLogo"><Icon fafa="faImages" width={26} /></div>
      <b>Bienvenue dans l'Atelier Image</b>
      <p>Glissez vos images directement dans la scène, ou démarrez avec :</p>
      <div className="imgAccueilActions">
        <button onClick={surImporter}><Icon fafa="faImage" width={13} /> Importer</button>
        <button onClick={surTexte}><Icon fafa="faFont" width={13} /> Texte</button>
        <button onClick={surForme}><Icon fafa="faSquare" width={13} /> Rectangle</button>
        <button onClick={surFrame}><Icon fafa="faBorderAll" width={13} /> Frame</button>
      </div>
      <small>Astuce : F1 affiche tous les raccourcis clavier.</small>
    </div>
  );
}

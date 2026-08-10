// Hôte du menu contextuel — voir menuRequest.js.
//
// Monté une fois par le shell. Il ne connaît ni les fichiers, ni le bureau,
// ni les applications : on lui donne une liste d'entrées avec des fonctions,
// il les place à l'écran et les rend. Toute la logique métier reste chez
// celui qui a construit le menu.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../utils/general";
import { subscribeMenu } from "./menuRequest";
import "./menu-contextuel.scss";

const MARGE = 8;

/// Place un panneau à côté d'un point sans qu'il sorte de l'écran.
///
/// Un menu ouvert près du bord droit doit s'ouvrir vers la gauche, et près
/// du bas remonter : sinon la moitié des entrées est inatteignable, ce qui
/// arrive tout le temps dans un coin d'écran.
const placer = (x, y, largeur, hauteur) => {
  const l = window.innerWidth;
  const h = window.innerHeight;

  let gauche = x;
  let haut = y;

  if (x + largeur + MARGE > l) gauche = Math.max(MARGE, x - largeur);
  if (y + hauteur + MARGE > h) haut = Math.max(MARGE, h - hauteur - MARGE);

  return { left: gauche, top: haut };
};

const Panneau = ({ entrees, x, y, onFermer, profondeur = 0 }) => {
  const boite = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y, visibility: "hidden" });
  const [ouvertIdx, setOuvertIdx] = useState(null);
  const [survol, setSurvol] = useState(-1);

  // Mesure puis place, avant peinture : calculer la position après un rendu
  // visible ferait sauter le menu sous les yeux de l'utilisateur.
  useLayoutEffect(() => {
    const el = boite.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: hh } = el;
    setPos({ ...placer(x, y, w, hh), visibility: "visible" });
  }, [x, y, entrees]);

  const activables = entrees
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !e.separateur && !e.desactive);

  const declencher = (entree) => {
    if (entree.desactive || entree.separateur) return;
    if (entree.sousMenu) return;
    // On ferme d'abord : une action qui ouvre une boîte de dialogue laisserait
    // sinon le menu par-dessus, et il resterait à l'écran.
    onFermer();
    entree.action?.();
  };

  const surTouche = useCallback(
    (e) => {
      if (!activables.length) return;
      const rang = activables.findIndex(({ i }) => i === survol);

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const pas = e.key === "ArrowDown" ? 1 : -1;
        const suivant = (rang + pas + activables.length) % activables.length;
        setSurvol(activables[suivant < 0 ? activables.length - 1 : suivant].i);
      } else if (e.key === "Enter" && survol >= 0) {
        e.preventDefault();
        declencher(entrees[survol]);
      }
    },
    [activables, survol, entrees],
  );

  useEffect(() => {
    if (profondeur > 0) return;
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [surTouche, profondeur]);

  return (
    <div
      ref={boite}
      className="cosMenu"
      style={pos}
      // Le clic droit dans le menu ne doit pas rouvrir le menu de ce qui est
      // dessous : sans cela, viser une entrée finit par empiler des menus.
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      {entrees.map((entree, i) =>
        entree.separateur ? (
          <div key={`s${i}`} className="cosMenuTrait" />
        ) : entree.titre ? (
          <div key={`t${i}`} className="cosMenuTitre">
            {entree.titre}
          </div>
        ) : (
          <div
            key={i}
            className="cosMenuItem"
            data-desactive={entree.desactive ? "true" : undefined}
            data-danger={entree.danger ? "true" : undefined}
            data-survol={survol === i ? "true" : undefined}
            onMouseEnter={() => {
              setSurvol(i);
              setOuvertIdx(entree.sousMenu ? i : null);
            }}
            onClick={() => declencher(entree)}
          >
            <span className="cosMenuIcone">
              {entree.coche ? (
                <Icon fafa="faCheck" width={10} />
              ) : entree.icone ? (
                <Icon fafa={entree.icone} width={13} />
              ) : entree.image ? (
                <Icon src={entree.image} width={15} />
              ) : null}
            </span>

            <span className="cosMenuNom">{entree.nom}</span>

            {entree.raccourci ? (
              <span className="cosMenuRaccourci">{entree.raccourci}</span>
            ) : null}

            {entree.sousMenu ? (
              <span className="cosMenuFleche">
                <Icon fafa="faChevronRight" width={9} />
              </span>
            ) : null}

            {entree.sousMenu && ouvertIdx === i ? (
              <SousPanneau
                entrees={entree.sousMenu}
                parent={boite}
                onFermer={onFermer}
                profondeur={profondeur + 1}
              />
            ) : null}
          </div>
        ),
      )}
    </div>
  );
};

/// Un sous-menu se place à droite de son parent, à hauteur de l'entrée qui
/// l'ouvre. On lit la position réelle plutôt que de la calculer : les menus
/// défilent, se replacent, et une position devinée finit toujours décalée.
///
/// Rendu dans un **portail**, à la racine de la couche des menus, et non à
/// l'intérieur du panneau parent. Un panneau animé établit un bloc
/// conteneur pour ses descendants en `position: fixed` : imbriqué, le
/// sous-menu se plaçait par rapport à son parent et non à l'écran — il
/// apparaissait à 600 px en bas à droite de l'entrée visée.
const SousPanneau = ({ entrees, onFermer, profondeur }) => {
  const ancre = useRef(null);
  const [point, setPoint] = useState(null);

  useLayoutEffect(() => {
    const r = ancre.current?.parentElement?.getBoundingClientRect();
    if (r) setPoint({ x: r.right - 4, y: r.top - 4 });
  }, []);

  return (
    <span ref={ancre} className="cosMenuAncre">
      {point
        ? createPortal(
            <Panneau
              entrees={entrees}
              x={point.x}
              y={point.y}
              onFermer={onFermer}
              profondeur={profondeur}
            />,
            document.querySelector(".cosMenuFond") || document.body,
          )
        : null}
    </span>
  );
};

export const HoteMenuContextuel = () => {
  const [demande, setDemande] = useState(null);

  useEffect(() => subscribeMenu(setDemande), []);

  const fermer = useCallback(() => setDemande(null), []);

  useEffect(() => {
    if (!demande) return;

    const surEchap = (e) => e.key === "Escape" && fermer();
    // Le défilement et le redimensionnement déplacent ce sur quoi on a
    // cliqué : un menu qui reste accroché au vide désigne autre chose que
    // ce que l'utilisateur croit.
    window.addEventListener("keydown", surEchap);
    window.addEventListener("resize", fermer);
    window.addEventListener("blur", fermer);
    window.addEventListener("wheel", fermer, { passive: true });

    return () => {
      window.removeEventListener("keydown", surEchap);
      window.removeEventListener("resize", fermer);
      window.removeEventListener("blur", fermer);
      window.removeEventListener("wheel", fermer);
    };
  }, [demande, fermer]);

  if (!demande) return null;

  return (
    <div
      className="cosMenuFond"
      onClick={fermer}
      onContextMenu={(e) => {
        // Un second clic droit ferme le menu courant et laisse la cible
        // en dessous ouvrir le sien au clic suivant.
        e.preventDefault();
        fermer();
      }}
    >
      <Panneau
        key={demande.id}
        entrees={demande.entrees}
        x={demande.x}
        y={demande.y}
        onFermer={fermer}
      />
    </div>
  );
};

export default HoteMenuContextuel;

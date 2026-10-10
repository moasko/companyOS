import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../../../../utils/general";
import { FileThumb } from "../assets/FileThumb";
import { dateLisible, emplacementDe, extension, tailleLisible, typeLisible } from "../../../../apps/explorateur";

// Ce que montre la zone de contenu : grille d'icônes, vue détails triable,
// ou liste tactile sur téléphone. Toute la logique (sélection, ouverture,
// glisser-déposer, renommage) vient de l'Explorateur par les props.

/// Champ de renommage en place. Le nom est présélectionné sans son
/// extension, comme partout ailleurs : on retape rarement le « .pdf ».
const Renommage = ({ node, valider, annuler }) => {
  const ref = useRef(null);
  const [valeur, setValeur] = useState(node.name);
  const fini = useRef(false);

  useEffect(() => {
    const champ = ref.current;
    if (!champ) return;
    champ.focus();
    const ext = node.type === "FILE" ? extension(node.name) : "";
    champ.setSelectionRange(0, ext ? node.name.length - ext.length - 1 : node.name.length);
  }, [node.id]);

  const terminer = (garder) => {
    if (fini.current) return;
    fini.current = true;
    if (garder) valider(node, valeur);
    else annuler();
  };

  return (
    <input
      ref={ref}
      className="expRenommage"
      value={valeur}
      maxLength={255}
      aria-label="Nouveau nom"
      onChange={(e) => setValeur(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") terminer(true);
        if (e.key === "Escape") terminer(false);
      }}
      onBlur={() => terminer(true)}
    />
  );
};

const Badges = ({ node }) =>
  node.nbPartages > 0 ? (
    <span className="expBadge" title={`Partagé par lien public (${node.nbPartages})`}>
      <Icon fafa="faLink" width={9} />
    </span>
  ) : null;

const COLONNES = [
  { cle: "nom", libelle: "Nom" },
  { cle: "date", libelle: "Modifié" },
  { cle: "type", libelle: "Type" },
  { cle: "taille", libelle: "Taille" },
];

export const Contenu = ({
  elements,
  vue,
  telephone,
  tri,
  changerTri,
  avecEmplacement,
  index,
  selection,
  focus,
  coupes,
  edition,
  renommer,
  annulerEdition,
  cliquer,
  doubleCliquer,
  menuElement,
  debutGlisse,
  finGlisse,
  depotDossier,
  grilleRef,
}) => {
  const proprietes = (node, i) => ({
    "data-id": node.id,
    "data-focus": selection.has(node.id),
    "data-courant": focus === node.id,
    "data-coupe": coupes.has(node.id),
    draggable: edition !== node.id,
    onClick: (e) => cliquer(e, node, i),
    onDoubleClick: (e) => doubleCliquer(e, node),
    onContextMenu: menuElement(node),
    onDragStart: (e) => debutGlisse(e, node),
    onDragEnd: finGlisse,
    ...(node.type === "FOLDER" ? depotDossier(node.id) : {}),
  });

  const nom = (node) =>
    edition === node.id ? (
      <Renommage node={node} valider={renommer} annuler={annulerEdition} />
    ) : (
      <span className="expNom" title={node.name}>
        {node.name}
      </span>
    );

  if (telephone) {
    return (
      <div className="expListeMobile" ref={grilleRef} role="list">
        {elements.map((node, i) => (
          <div key={node.id} className="expLigneMobile" role="listitem" {...proprietes(node, i)}>
            <FileThumb node={node} />
            <div className="expLigneTexte">
              {nom(node)}
              <small>
                {avecEmplacement ? `${emplacementDe(index, node)} · ` : ""}
                {node.type === "FOLDER" ? "Dossier" : `${dateLisible(node.updatedAt)} · ${tailleLisible(node.size)}`}
              </small>
            </div>
            <Badges node={node} />
            <button
              type="button"
              className="expPlus"
              aria-label={`Actions pour ${node.name}`}
              onClick={(e) => {
                e.stopPropagation();
                menuElement(node)(e);
              }}
            >
              <Icon fafa="faEllipsisVertical" width={12} />
            </button>
          </div>
        ))}
      </div>
    );
  }

  if (vue === "details") {
    const colonnes = avecEmplacement ? [...COLONNES, { cle: null, libelle: "Emplacement" }] : COLONNES;
    return (
      <div className="expDetails" role="grid" aria-multiselectable="true" ref={grilleRef}>
        <div className="expDetTete" role="row" data-emplacement={avecEmplacement}>
          {colonnes.map((c) => (
            <button
              key={c.libelle}
              type="button"
              role="columnheader"
              className="expDetCol"
              data-tri={c.cle && tri.cle === c.cle ? tri.sens : undefined}
              disabled={!c.cle}
              onClick={(e) => {
                e.stopPropagation();
                if (c.cle) changerTri(c.cle);
              }}
            >
              {c.libelle}
              {c.cle && tri.cle === c.cle ? <Icon fafa={tri.sens === "asc" ? "faChevronUp" : "faChevronDown"} width={8} /> : null}
            </button>
          ))}
        </div>
        {elements.map((node, i) => (
          <div key={node.id} className="expDetLigne" role="row" data-emplacement={avecEmplacement} {...proprietes(node, i)}>
            <span className="expDetNom" role="gridcell">
              <span className="expPetit">
                <FileThumb node={node} apercu={false} />
              </span>
              {nom(node)}
              <Badges node={node} />
            </span>
            <span role="gridcell">{dateLisible(node.updatedAt)}</span>
            <span role="gridcell">{typeLisible(node)}</span>
            <span role="gridcell" className="expDetTaille">
              {node.type === "FILE" ? tailleLisible(node.size) : ""}
            </span>
            {avecEmplacement ? (
              <span role="gridcell" className="expDetOu" title={emplacementDe(index, node)}>
                {emplacementDe(index, node)}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="gridshow expGrille" data-size={vue === "petites" ? "md" : "lg"} ref={grilleRef}>
      {elements.map((node, i) => (
        <div key={node.id} className="conticon hvtheme flex flex-col items-center prtclk" {...proprietes(node, i)}>
          <div className="expVignette">
            <FileThumb node={node} />
            <Badges node={node} />
          </div>
          {nom(node)}
        </div>
      ))}
    </div>
  );
};

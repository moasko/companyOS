import React from "react";
import { Icon } from "../../../../utils/general";
import { dossiersDe } from "../../../../apps/explorateur";

// Volet de navigation : accès rapide (Récents, Favoris), l'arbre du Cloud
// déplié à la demande, la corbeille. Chaque dossier de l'arbre accepte un
// dépôt — fichiers du poste ou éléments glissés depuis la zone de contenu.

const Ligne = ({ niveau = 0, actif, chevron, icone, image, libelle, onClick, onContextMenu, depot, titre }) => (
  <div
    className="expVLigne"
    data-actif={!!actif}
    style={{ paddingLeft: 6 + niveau * 14 }}
    onClick={onClick}
    onContextMenu={onContextMenu}
    title={titre || libelle}
    {...(depot || {})}
  >
    {chevron === undefined ? <span className="expChev" data-vide="true" /> : chevron}
    {image ? (
      <img src={image} alt="" width={16} height={16} draggable={false} />
    ) : (
      <Icon {...icone} width={icone?.width || 14} />
    )}
    <span className="expVNom">{libelle}</span>
  </div>
);

const Branche = ({ index, parentId, niveau, lieu, deplie, basculer, aller, depotDossier, menuDossier }) =>
  dossiersDe(index, parentId).map((d) => {
    const aEnfants = dossiersDe(index, d.id).length > 0;
    const ouvert = deplie.has(d.id);
    return (
      <React.Fragment key={d.id}>
        <Ligne
          niveau={niveau}
          actif={lieu.type === "dossier" && lieu.id === d.id}
          chevron={
            <span
              className="expChev"
              data-vide={!aEnfants}
              onClick={(e) => {
                e.stopPropagation();
                if (aEnfants) basculer(d.id);
              }}
            >
              <Icon fafa={ouvert ? "faChevronDown" : "faChevronRight"} width={8} />
            </span>
          }
          image="img/icon/cos/fichiers/dossier.svg"
          libelle={d.name}
          onClick={() => aller({ type: "dossier", id: d.id })}
          onContextMenu={menuDossier(d)}
          depot={depotDossier(d.id)}
        />
        {ouvert && aEnfants ? (
          <Branche
            index={index}
            parentId={d.id}
            niveau={niveau + 1}
            lieu={lieu}
            deplie={deplie}
            basculer={basculer}
            aller={aller}
            depotDossier={depotDossier}
            menuDossier={menuDossier}
          />
        ) : null}
      </React.Fragment>
    );
  });

export const Volet = ({
  index,
  lieu,
  favoris,
  deplie,
  basculer,
  aller,
  nomEspace,
  depotDossier,
  depotCorbeille,
  menuDossier,
  retirerFavori,
  ouvrirNoeud,
}) => {
  const racineOuverte = deplie.has("racine");
  return (
    <nav className="expVolet cosScroll" aria-label="Navigation du Cloud">
      <div className="expVTitre">Accès rapide</div>
      <Ligne
        actif={lieu.type === "recents"}
        icone={{ fafa: "faClock" }}
        libelle="Récents"
        onClick={() => aller({ type: "recents" })}
      />
      <Ligne
        actif={lieu.type === "favoris"}
        icone={{ fafa: "faStar" }}
        libelle="Favoris"
        onClick={() => aller({ type: "favoris" })}
      />
      {favoris.map((f) => (
        <Ligne
          key={f.id}
          niveau={1}
          actif={lieu.type === "dossier" && lieu.id === f.id}
          image={f.type === "FOLDER" ? "img/icon/cos/fichiers/dossier.svg" : undefined}
          icone={{ fafa: "faFile" }}
          libelle={f.name}
          onClick={() => (f.type === "FOLDER" ? aller({ type: "dossier", id: f.id }) : ouvrirNoeud(f))}
          onContextMenu={(e) => retirerFavori(e, f)}
          depot={f.type === "FOLDER" ? depotDossier(f.id) : undefined}
        />
      ))}

      <div className="expVTitre">Cloud</div>
      <Ligne
        actif={lieu.type === "dossier" && !lieu.id}
        chevron={
          <span
            className="expChev"
            onClick={(e) => {
              e.stopPropagation();
              basculer("racine");
            }}
          >
            <Icon fafa={racineOuverte ? "faChevronDown" : "faChevronRight"} width={8} />
          </span>
        }
        icone={{ src: "win/onedrive-sm", width: 16 }}
        libelle={nomEspace || "Cloud"}
        onClick={() => aller({ type: "dossier", id: null })}
        depot={depotDossier(null)}
      />
      {racineOuverte ? (
        <Branche
          index={index}
          parentId={null}
          niveau={1}
          lieu={lieu}
          deplie={deplie}
          basculer={basculer}
          aller={aller}
          depotDossier={depotDossier}
          menuDossier={menuDossier}
        />
      ) : null}

      <div className="expVSep" />
      <Ligne
        actif={lieu.type === "corbeille"}
        icone={{ fafa: "faTrashCan" }}
        libelle="Corbeille"
        onClick={() => aller({ type: "corbeille" })}
        depot={depotCorbeille}
      />
    </nav>
  );
};

// La barre latérale du Stock : le choix de la vue, puis l'arbre des
// catégories quand on est dans le catalogue.
//
// Elle ne détient aucun état de données : l'arbre lui arrive déjà construit
// par `domaine.js`, et chaque action remonte à `index.jsx`, seul endroit qui
// écrit. Seul le pliage d'une branche est local — c'est du confort de
// lecture, pas une donnée.

import React, { useState } from "react";
import { Icon } from "../../../../utils/general";

const VUES = [
  { id: "catalogue", label: "Catalogue", icone: "faBoxesStacked" },
  { id: "mouvements", label: "Mouvements", icone: "faRightLeft" },
  { id: "fournisseurs", label: "Fournisseurs", icone: "faTruckField" },
  { id: "analyse", label: "Analyse", icone: "faChartColumn" },
];

/// Une branche de l'arbre des catégories, dans la barre latérale.
const BrancheCategorie = ({
  noeud,
  actif,
  compte,
  onChoisir,
  onEditer,
  profondeur = 0,
}) => {
  const [ouvert, setOuvert] = useState(profondeur < 1);

  return (
    <>
      <div
        className="stkCat handcr"
        data-actif={noeud.id === actif}
        style={{ paddingLeft: 8 + profondeur * 13 }}
        onClick={() => onChoisir(noeud.id)}
      >
        <span
          className="stkCatChevron"
          onClick={(e) => {
            if (!noeud.enfants.length) return;
            e.stopPropagation();
            setOuvert((o) => !o);
          }}
        >
          {noeud.enfants.length ? (
            <Icon fafa={ouvert ? "faChevronDown" : "faChevronRight"} width={8} />
          ) : null}
        </span>
        <span className="stkCatNom">{noeud.data.nom}</span>
        <span className="stkCatCompte">{compte(noeud.id)}</span>
        <span
          className="stkCatEdit"
          title="Renommer"
          onClick={(e) => {
            e.stopPropagation();
            onEditer(noeud);
          }}
        >
          <Icon fafa="faPen" width={8} />
        </span>
      </div>
      {ouvert
        ? noeud.enfants.map((enfant) => (
            <BrancheCategorie
              key={enfant.id}
              noeud={enfant}
              actif={actif}
              compte={compte}
              onChoisir={onChoisir}
              onEditer={onEditer}
              profondeur={profondeur + 1}
            />
          ))
        : null}
    </>
  );
};

export const BarreLaterale = ({
  vue,
  setVue,
  articles,
  racines,
  categorieActive,
  setCategorieActive,
  catActive,
  compteCategorie,
  editerCategorie,
  rangerCategorie,
  supprimerCategorie,
}) => (
  <aside className="stkNav cosScroll">
    {VUES.map((v) => (
      <div
        key={v.id}
        className="stkNavItem handcr"
        data-actif={vue === v.id}
        onClick={() => setVue(v.id)}
      >
        <Icon fafa={v.icone} width={13} />
        <span>{v.label}</span>
      </div>
    ))}

    {vue === "catalogue" ? (
      <>
        <div className="stkNavTitre">
          <span>Catégories</span>
          <span
            className="stkNavPlus handcr"
            title={
              catActive
                ? `Nouvelle sous-catégorie dans « ${catActive.data.nom} »`
                : "Nouvelle catégorie"
            }
            onClick={() => editerCategorie(null)}
          >
            <Icon fafa="faPlus" width={9} />
          </span>
        </div>

        <div
          className="stkCat handcr"
          data-actif={categorieActive === null}
          onClick={() => setCategorieActive(null)}
        >
          <span className="stkCatChevron" />
          <span className="stkCatNom">Tout le catalogue</span>
          <span className="stkCatCompte">{articles.length}</span>
        </div>

        {racines.map((n) => (
          <BrancheCategorie
            key={n.id}
            noeud={n}
            actif={categorieActive}
            compte={compteCategorie}
            onChoisir={setCategorieActive}
            onEditer={editerCategorie}
          />
        ))}

        {articles.some((a) => !a.data.categorieId) ? (
          <div
            className="stkCat handcr"
            data-actif={categorieActive === "__sans__"}
            onClick={() => setCategorieActive("__sans__")}
          >
            <span className="stkCatChevron" />
            <span className="stkCatNom stkMuted">Sans catégorie</span>
            <span className="stkCatCompte">
              {articles.filter((a) => !a.data.categorieId).length}
            </span>
          </div>
        ) : null}

        {catActive ? (
          <div className="stkCatActions">
            <span className="handcr" onClick={rangerCategorie}>
              Ranger ailleurs
            </span>
            <span className="handcr stkDanger" onClick={supprimerCategorie}>
              Supprimer
            </span>
          </div>
        ) : null}
      </>
    ) : null}
  </aside>
);

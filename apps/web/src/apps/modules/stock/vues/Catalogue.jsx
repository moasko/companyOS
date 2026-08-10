// Le catalogue : la barre de recherche et de filtres, puis les produits en
// grille ou en liste.
//
// Les deux affichages montrent les mêmes produits déjà filtrés et triés par
// `index.jsx` : ce fichier ne décide de rien, il met en page.

import React from "react";
import { Icon } from "../../../../utils/general";
import { montant as money } from "../../../../utils/monnaie";
import { Contenu } from "../../../chargement";
import { chemin, etat, pmp, qty } from "../domaine";

const ETATS = [
  { id: "tous", label: "Tous les états" },
  { id: "alerte", label: "Sous le seuil" },
  { id: "rupture", label: "Rupture" },
];

const TRIS = [
  { id: "designation", label: "Nom (A→Z)" },
  { id: "stock", label: "Stock croissant" },
  { id: "valeur", label: "Valeur décroissante" },
  { id: "recent", label: "Ajout récent" },
];

export const Catalogue = ({
  requete,
  setRequete,
  filtreEtat,
  setFiltreEtat,
  tri,
  setTri,
  affichage,
  setAffichage,
  nouvelArticle,
  exporterInventaire,
  chargement,
  visibles,
  articles,
  categories,
  categorieDe,
  stocks,
  mouvements,
  selectedId,
  ouvrirArticle,
}) => (
  <>
    <div className="stkBarre">
      <div className="stkRecherche">
        <Icon fafa="faMagnifyingGlass" width={11} />
        <input
          type="text"
          placeholder="Référence, désignation, code-barres…"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
        />
        {requete ? (
          <Icon fafa="faXmark" width={10} onClick={() => setRequete("")} />
        ) : null}
      </div>

      <select
        value={filtreEtat}
        onChange={(e) => setFiltreEtat(e.target.value)}
      >
        {ETATS.map((e) => (
          <option key={e.id} value={e.id}>
            {e.label}
          </option>
        ))}
      </select>

      <select value={tri} onChange={(e) => setTri(e.target.value)}>
        {TRIS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>

      <div className="stkVues">
        <span
          className="handcr"
          data-actif={affichage === "grille"}
          title="Grille"
          onClick={() => setAffichage("grille")}
        >
          <Icon fafa="faTableCellsLarge" width={11} />
        </span>
        <span
          className="handcr"
          data-actif={affichage === "liste"}
          title="Liste"
          onClick={() => setAffichage("liste")}
        >
          <Icon fafa="faList" width={11} />
        </span>
      </div>

      <div className="stkPrimary handcr" onClick={nouvelArticle}>
        <Icon fafa="faPlus" width={10} />
        <span>Nouveau produit</span>
      </div>
      <div className="stkBtnGhost handcr" onClick={exporterInventaire}>
        Export
      </div>
    </div>

    {/* Tant que rien n'est chargé, on montre un squelette et non
        « Votre catalogue est vide » : cette phrase serait fausse,
        et pousse à recréer des produits qui existent déjà. */}
    {chargement.initial || chargement.erreur ? (
      <Contenu
        etat={chargement}
        vide={false}
        squelette={affichage === "grille" ? "grille" : "liste"}
        lignes={affichage === "grille" ? 10 : 7}
      />
    ) : !visibles.length ? (
      <div className="stkVide">
        <Icon fafa="faBoxOpen" width={26} />
        <span>
          {articles.length
            ? "Aucun produit ne correspond à ces filtres."
            : "Votre catalogue est vide."}
        </span>
        {!articles.length ? (
          <div className="stkPrimary handcr" onClick={nouvelArticle}>
            Créer le premier produit
          </div>
        ) : null}
      </div>
    ) : affichage === "grille" ? (
      <div className="stkGrille cosScroll">
        {visibles.map((a) => {
          const stock = stocks[a.id] || 0;
          const e = etat(stock, a.data.seuil);
          return (
            <div
              key={a.id}
              className="stkCarte handcr"
              data-actif={a.id === selectedId}
              onClick={() => ouvrirArticle(a)}
            >
              <div className="stkCarteImg">
                {a.data.vignette ? (
                  <img src={a.data.vignette} alt="" />
                ) : (
                  <Icon fafa="faBox" width={22} />
                )}
                <span className="stkPastille" data-ton={e.ton}>
                  {qty(stock)}
                </span>
              </div>
              <div className="stkCarteNom">{a.data.designation}</div>
              <div className="stkCarteMeta">
                {[
                  a.data.reference,
                  categorieDe(a.data.categorieId)?.data.nom,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </div>
              <div className="stkCartePrix">{money(a.data.prixVente)}</div>
            </div>
          );
        })}
      </div>
    ) : (
      <div className="stkTable cosScroll">
        <div className="stkTr stkTrArt stkTh">
          <span />
          <span>Produit</span>
          <span>Catégorie</span>
          <span className="stkTdNum">Stock</span>
          <span className="stkTdNum">Seuil</span>
          <span className="stkTdNum">Valeur</span>
          <span>État</span>
        </div>
        {visibles.map((a) => {
          const stock = stocks[a.id] || 0;
          const e = etat(stock, a.data.seuil);
          return (
            <div
              key={a.id}
              className="stkTr stkTrArt handcr"
              data-actif={a.id === selectedId}
              onClick={() => ouvrirArticle(a)}
            >
              <span className="stkTdImg">
                {a.data.vignette ? (
                  <img src={a.data.vignette} alt="" />
                ) : (
                  <Icon fafa="faBox" width={11} />
                )}
              </span>
              <span className="stkTdNom">
                <strong>{a.data.designation}</strong>
                <em>{a.data.reference}</em>
              </span>
              <span className="stkMuted">
                {chemin(categories, a.data.categorieId) || "—"}
              </span>
              <span className="stkTdNum">
                {qty(stock)} {a.data.unite}
              </span>
              <span className="stkTdNum stkMuted">{qty(a.data.seuil)}</span>
              <span className="stkTdNum">
                {money(stock * pmp(a, mouvements))}
              </span>
              <span>
                <span className="stkTag" data-ton={e.ton}>
                  {e.label}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    )}
  </>
);

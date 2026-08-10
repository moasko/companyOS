// Sélecteur de produit — le même dans toute l'entreprise.
//
// Facturation, Achats, Devis : partout où il faut désigner un produit, on
// ouvre celui-ci. Une liste déroulante de trois cents références n'est pas
// utilisable ; ici on cherche, on filtre par catégorie, et on reconnaît le
// produit à son image.
//
//   const p = await choisirProduit();
//   if (p) ajouterLigne(p);
//
// Le composant s'enregistre auprès du référentiel au montage du shell : les
// modules n'ont donc rien à importer d'autre que `choisirProduit`.

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../utils/general";
import { modal } from "./modalRequest";
import {
  chargerReferentiel,
  enregistrerSelecteur,
  filtrerProduits,
} from "./referentiel";
import { arbre, chemin, branche, etat } from "./modules/stock/domaine";
import "./selecteur.scss";

import { montant as money } from "../utils/monnaie";

/// Une branche de l'arbre des catégories, repliable.
const Branche = ({ noeud, actif, onChoisir, profondeur = 0 }) => {
  const [ouvert, setOuvert] = useState(profondeur === 0);
  const aDesEnfants = noeud.enfants.length > 0;

  return (
    <>
      <div
        className="selCat handcr"
        data-actif={noeud.id === actif}
        style={{ paddingLeft: 10 + profondeur * 14 }}
        onClick={() => onChoisir(noeud.id)}
      >
        {aDesEnfants ? (
          <span
            className="selCatChevron"
            onClick={(e) => {
              e.stopPropagation();
              setOuvert((o) => !o);
            }}
          >
            <Icon fafa={ouvert ? "faChevronDown" : "faChevronRight"} width={8} />
          </span>
        ) : (
          <span className="selCatChevron" />
        )}
        <span className="selCatNom">{noeud.data.nom}</span>
      </div>
      {ouvert
        ? noeud.enfants.map((e) => (
            <Branche
              key={e.id}
              noeud={e}
              actif={actif}
              onChoisir={onChoisir}
              profondeur={profondeur + 1}
            />
          ))
        : null}
    </>
  );
};

const Selecteur = ({ titre, close }) => {
  const [donnees, setDonnees] = useState(null);
  const [requete, setRequete] = useState("");
  const [categorie, setCategorie] = useState(null);

  useEffect(() => {
    let vivant = true;
    chargerReferentiel().then((d) => vivant && setDonnees(d));
    return () => {
      vivant = false;
    };
  }, []);

  const categories = donnees?.categories || [];
  const racines = useMemo(() => arbre(categories), [categories]);

  const visibles = useMemo(() => {
    if (!donnees) return [];
    const dansLaBranche = categorie ? new Set(branche(categories, categorie)) : null;
    return filtrerProduits(donnees.produits, requete).filter(
      (p) => !dansLaBranche || dansLaBranche.has(p.data.categorieId),
    );
  }, [donnees, requete, categorie, categories]);

  return (
    <div className="selProduit">
      <div className="selTete">
        <span className="selTitre">{titre || "Choisir un produit"}</span>
        <Icon fafa="faXmark" width={12} onClick={() => close(null)} />
      </div>

      <div className="selBarre">
        <Icon fafa="faMagnifyingGlass" width={11} />
        <input
          type="text"
          autoFocus
          placeholder="Référence, désignation ou code-barres…"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          // Entrée sur un résultat unique : le geste attendu quand on scanne
          // ou qu'on tape une référence exacte.
          onKeyDown={(e) => {
            if (e.key === "Enter" && visibles.length === 1) close(visibles[0]);
            if (e.key === "Escape") close(null);
          }}
        />
      </div>

      <div className="selCorps">
        <aside className="selArbre cosScroll">
          <div
            className="selCat handcr"
            data-actif={categorie === null}
            onClick={() => setCategorie(null)}
          >
            <span className="selCatChevron" />
            <span className="selCatNom">Tout le catalogue</span>
          </div>
          {racines.map((n) => (
            <Branche key={n.id} noeud={n} actif={categorie} onChoisir={setCategorie} />
          ))}
        </aside>

        <div className="selGrille cosScroll">
          {!donnees ? (
            <div className="selVide">Chargement du catalogue…</div>
          ) : !visibles.length ? (
            <div className="selVide">
              <Icon fafa="faBoxOpen" width={22} />
              <span>
                {donnees.produits.length
                  ? "Aucun produit pour cette recherche."
                  : "Le catalogue est vide. Ajoutez des produits depuis l'application Stock."}
              </span>
            </div>
          ) : (
            visibles.map((p) => {
              const stock = donnees.stocks[p.id] || 0;
              const e = etat(stock, p.data.seuil);
              return (
                <div key={p.id} className="selCarte handcr" onClick={() => close(p)}>
                  <div className="selVignette">
                    {p.data.vignette ? (
                      <img src={p.data.vignette} alt="" />
                    ) : (
                      <Icon fafa="faBox" width={18} />
                    )}
                  </div>
                  <div className="selInfo">
                    <div className="selNom">{p.data.designation}</div>
                    <div className="selMeta">
                      {[p.data.reference, chemin(categories, p.data.categorieId)]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                  </div>
                  <div className="selDroite">
                    <div className="selPrix">{money(p.data.prixVente)}</div>
                    {/* Le stock est montré à la sélection : facturer ce
                        qu'on n'a pas se décide en connaissance de cause. */}
                    <div className="selStock" data-ton={e.ton}>
                      {nf.format(stock)} {p.data.unite}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

/// Monté une fois par le shell. Ne rend rien : il branche seulement le
/// sélecteur sur le référentiel.
export const HoteSelecteurProduit = () => {
  useEffect(() => {
    enregistrerSelecteur("produit", (options) =>
      modal.open({
        // Le sélecteur porte sa propre mise en page : la boîte ne doit rien
        // ajouter autour, ni titre ni boutons.
        nu: true,
        render: ({ close }) => <Selecteur {...options} close={close} />,
      }),
    );
    return () => enregistrerSelecteur("produit", null);
  }, []);

  return null;
};

export default HoteSelecteurProduit;

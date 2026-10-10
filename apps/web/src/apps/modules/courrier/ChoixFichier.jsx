import React, { useEffect, useState } from "react";
import { api } from "../../../api/client";
import { Icon } from "../../../utils/general";
import { iconeDeFichier } from "../../iconesFichiers";
import { Bouton } from "../../ui";

/// Choix de pièces jointes dans le Cloud : les fichiers, dossiers parcourus
/// sur trois niveaux, avec une recherche. Un clic coche, le bouton du bas
/// joint le tout, dans la limite des places libres.
export const ChoixFichier = ({ dejaPris = [], placesLibres = 10, onValider }) => {
  const [fichiers, setFichiers] = useState(null);
  const [coches, setCoches] = useState([]);
  const [recherche, setRecherche] = useState("");

  useEffect(() => {
    let vivant = true;
    (async () => {
      // L'arborescence entière d'un coup, quand l'API la propose.
      const arbre = await api.arborescence().catch(() => null);
      if (arbre?.noeuds) {
        const parId = new Map(arbre.noeuds.map((n) => [n.id, n]));
        const chemin = (n) => {
          const morceaux = [];
          let p = n.parentId ? parId.get(n.parentId) : null;
          while (p && morceaux.length < 6) {
            morceaux.unshift(p.name);
            p = p.parentId ? parId.get(p.parentId) : null;
          }
          return morceaux.join(" / ");
        };
        const liste = arbre.noeuds.filter((n) => n.type === "FILE").map((n) => ({ ...n, chemin: chemin(n) }));
        liste.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
        if (vivant) setFichiers(liste);
        return;
      }
      if (vivant) setFichiers([]);
    })();
    return () => {
      vivant = false;
    };
  }, []);

  const basculer = (f) =>
    setCoches((c) => {
      if (c.some((x) => x.id === f.id)) return c.filter((x) => x.id !== f.id);
      return c.length < placesLibres ? [...c, f] : c;
    });

  if (fichiers === null) return <div className="crrChoixVide">Lecture du Cloud…</div>;
  if (!fichiers.length) return <div className="crrChoixVide">Aucun fichier dans le Cloud.</div>;

  const q = recherche.trim().toLowerCase();
  const visibles = (q ? fichiers.filter((f) => `${f.name} ${f.chemin}`.toLowerCase().includes(q)) : fichiers).slice(0, 300);

  return (
    <div className="crrChoixCadre">
      <label className="crrChoixRecherche">
        <Icon fafa="faMagnifyingGlass" width={11} />
        <input autoFocus value={recherche} placeholder="Rechercher un fichier" onChange={(e) => setRecherche(e.target.value)} />
      </label>
      <div className="crrChoix cosScroll">
        {visibles.map((f) => {
          const pris = dejaPris.includes(f.id);
          const coche = coches.some((x) => x.id === f.id);
          return (
            <button type="button" key={f.id} className="crrChoixLigne" data-coche={coche} data-pris={pris} disabled={pris} onClick={() => basculer(f)}>
              <span className="crrChoixCase">{coche || pris ? <Icon fafa="faCheck" width={10} /> : null}</span>
              <img src={`img/icon/cos/${iconeDeFichier(f)}.svg`} alt="" width={22} />
              <span className="crrChoixTexte">
                <span className="crrChoixNom">{f.name}</span>
                <span className="crrChoixChemin">{pris ? "Déjà jointe" : f.chemin || "Racine du Cloud"}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="crrChoixPied">
        <span>
          {coches.length
            ? `${coches.length} fichier${coches.length > 1 ? "s" : ""} sélectionné${coches.length > 1 ? "s" : ""}`
            : `Jusqu'à ${placesLibres} fichier${placesLibres > 1 ? "s" : ""}`}
        </span>
        <Bouton icone="faPaperclip" off={!coches.length} onClick={() => onValider(coches)}>
          Joindre
        </Bouton>
      </div>
    </div>
  );
};

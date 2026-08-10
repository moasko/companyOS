// Le panneau de droite d'un produit : sa photo, son stock, et trois onglets
// — la fiche, la saisie d'un mouvement, l'historique.
//
// Tout y est piloté depuis `index.jsx` : ce fichier n'écrit rien lui-même,
// il ne fait qu'afficher `draft` et rendre la main aux actions du module.

import React from "react";
import { Icon } from "../../../../utils/general";
import { montant as money } from "../../../../utils/monnaie";
import { Auteur } from "../../../Auteur";
import { SENS, UNITES, chemin, etat, pmp, qty } from "../domaine";

export const FicheArticle = ({
  draft,
  selected,
  selectedId,
  categories,
  fournisseurs,
  stocks,
  mouvements,
  mouvementsArticle,
  onglet,
  setOnglet,
  champ,
  mvt,
  setMvt,
  busy,
  changerImage,
  retirerImage,
  enregistrerArticle,
  supprimerArticle,
  ajouterMouvement,
  supprimerMouvement,
}) => (
  <>
    <div className="stkPhoto">
      {draft.vignette ? (
        <img src={draft.vignette} alt={draft.designation} />
      ) : (
        <Icon fafa="faImage" width={26} />
      )}
    </div>
    <div className="stkPhotoActions">
      <span className="handcr" onClick={changerImage}>
        {draft.vignette ? "Changer l'image" : "Ajouter une image"}
      </span>
      {draft.vignette ? (
        <span className="handcr stkDanger" onClick={retirerImage}>
          Retirer
        </span>
      ) : null}
    </div>

    {selectedId ? (
      <div className="stkStockGros">
        <span
          className="stkStockVal"
          data-ton={etat(stocks[selectedId], draft.seuil).ton}
        >
          {qty(stocks[selectedId] || 0)}
        </span>
        <span className="stkStockUnite">{draft.unite} en stock</span>
      </div>
    ) : null}

    <div className="stkOnglets">
      {[
        ["fiche", "Fiche"],
        ["stock", "Stock"],
        ["historique", "Historique"],
      ].map(([id, label]) => (
        <span
          key={id}
          className="handcr"
          data-actif={onglet === id}
          onClick={() => setOnglet(id)}
        >
          {label}
        </span>
      ))}
    </div>

    {onglet === "fiche" ? (
      <>
        <label className="stkField">
          <span className="stkLabel">Désignation *</span>
          <input
            type="text"
            value={draft.designation}
            onChange={champ("designation")}
          />
        </label>

        <div className="stkDeux">
          <label className="stkField">
            <span className="stkLabel">Référence</span>
            <input
              type="text"
              value={draft.reference}
              onChange={champ("reference")}
            />
          </label>
          <label className="stkField">
            <span className="stkLabel">Code-barres</span>
            <input
              type="text"
              value={draft.codeBarre}
              onChange={champ("codeBarre")}
            />
          </label>
        </div>

        <label className="stkField">
          <span className="stkLabel">Catégorie</span>
          <select value={draft.categorieId} onChange={champ("categorieId")}>
            <option value="">Sans catégorie</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {chemin(categories, c.id)}
              </option>
            ))}
          </select>
        </label>

        <div className="stkDeux">
          <label className="stkField">
            <span className="stkLabel">Marque</span>
            <input
              type="text"
              value={draft.marque}
              onChange={champ("marque")}
            />
          </label>
          <label className="stkField">
            <span className="stkLabel">Unité</span>
            <select value={draft.unite} onChange={champ("unite")}>
              {UNITES.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="stkDeux">
          <label className="stkField">
            <span className="stkLabel">Prix d'achat</span>
            <input
              type="number"
              value={draft.prixAchat}
              onChange={champ("prixAchat")}
            />
          </label>
          <label className="stkField">
            <span className="stkLabel">Prix de vente</span>
            <input
              type="number"
              value={draft.prixVente}
              onChange={champ("prixVente")}
            />
          </label>
        </div>

        {/* La marge se calcule, elle ne se saisit pas. L'afficher
            en direct évite de découvrir en fin de mois qu'un
            produit était vendu à perte. */}
        {draft.prixVente > 0 ? (
          <div
            className="stkMarge"
            data-negatif={draft.prixVente <= draft.prixAchat}
          >
            Marge {money(draft.prixVente - draft.prixAchat)} ·{" "}
            {Math.round(
              ((draft.prixVente - draft.prixAchat) / draft.prixVente) * 100,
            )}
            %
          </div>
        ) : null}

        <div className="stkDeux">
          <label className="stkField">
            <span className="stkLabel">Seuil d'alerte</span>
            <input
              type="number"
              value={draft.seuil}
              onChange={champ("seuil")}
            />
          </label>
          <label className="stkField">
            <span className="stkLabel">TVA %</span>
            <input type="number" value={draft.tva} onChange={champ("tva")} />
          </label>
        </div>

        <label className="stkField">
          <span className="stkLabel">Fournisseur</span>
          <select
            value={draft.fournisseurId}
            onChange={champ("fournisseurId")}
          >
            <option value="">Aucun</option>
            {fournisseurs.map((f) => (
              <option key={f.id} value={f.id}>
                {f.data.nom}
              </option>
            ))}
          </select>
        </label>

        <label className="stkField">
          <span className="stkLabel">Emplacement</span>
          <input
            type="text"
            placeholder="Allée B, étagère 3"
            value={draft.emplacement}
            onChange={champ("emplacement")}
          />
        </label>

        <label className="stkField">
          <span className="stkLabel">Description</span>
          <textarea
            rows={3}
            value={draft.description}
            onChange={champ("description")}
          />
        </label>

        {selected ? <Auteur record={selected} /> : null}

        <div className="stkFormActions">
          <div
            className="stkPrimary handcr"
            data-off={busy}
            onClick={enregistrerArticle}
          >
            <Icon fafa="faFloppyDisk" width={11} />
            <span>{busy ? "…" : "Enregistrer"}</span>
          </div>
          {selectedId ? (
            <div
              className="stkBtnGhost stkDanger handcr"
              onClick={supprimerArticle}
            >
              Supprimer
            </div>
          ) : null}
        </div>
      </>
    ) : null}

    {onglet === "stock" ? (
      !selectedId ? (
        <div className="stkEmptyBox">
          Enregistrez le produit avant d'entrer des mouvements.
        </div>
      ) : (
        <>
          <div className="stkSens3">
            {Object.entries(SENS).map(([id, s]) => (
              <span
                key={id}
                className="handcr"
                data-actif={mvt.sens === id}
                data-ton={s.ton}
                onClick={() => setMvt((m) => ({ ...m, sens: id }))}
              >
                <Icon fafa={s.icone} width={10} />
                {s.label}
              </span>
            ))}
          </div>

          {mvt.sens === "inventaire" ? (
            <div className="stkNote">
              L'inventaire ne s'ajoute pas au stock : il le remplace par la
              quantité réellement comptée.
            </div>
          ) : null}

          <div className="stkDeux">
            <label className="stkField">
              <span className="stkLabel">
                {mvt.sens === "inventaire" ? "Quantité comptée" : "Quantité"}
              </span>
              <input
                type="number"
                value={mvt.quantite}
                onChange={(e) =>
                  setMvt((m) => ({ ...m, quantite: e.target.value }))
                }
              />
            </label>
            <label className="stkField">
              <span className="stkLabel">Date</span>
              <input
                type="date"
                value={mvt.date}
                onChange={(e) =>
                  setMvt((m) => ({ ...m, date: e.target.value }))
                }
              />
            </label>
          </div>

          {mvt.sens === "entree" ? (
            <label className="stkField">
              <span className="stkLabel">Prix d'achat unitaire</span>
              <input
                type="number"
                placeholder={String(draft.prixAchat || 0)}
                value={mvt.prixUnitaire}
                onChange={(e) =>
                  setMvt((m) => ({ ...m, prixUnitaire: e.target.value }))
                }
              />
            </label>
          ) : null}

          <label className="stkField">
            <span className="stkLabel">Motif</span>
            <input
              type="text"
              placeholder="Livraison, vente, casse…"
              value={mvt.motif}
              onChange={(e) =>
                setMvt((m) => ({ ...m, motif: e.target.value }))
              }
            />
          </label>

          <div className="stkFormActions">
            <div
              className="stkPrimary handcr"
              data-off={busy}
              onClick={ajouterMouvement}
            >
              Enregistrer le mouvement
            </div>
          </div>

          <div className="stkRecap">
            <span>Prix moyen pondéré</span>
            <strong>{selected ? money(pmp(selected, mouvements)) : "—"}</strong>
          </div>
          <div className="stkRecap">
            <span>Valeur du stock</span>
            <strong>
              {selected
                ? money((stocks[selectedId] || 0) * pmp(selected, mouvements))
                : "—"}
            </strong>
          </div>
        </>
      )
    ) : null}

    {onglet === "historique" ? (
      !mouvementsArticle.length ? (
        <div className="stkEmptyBox">Aucun mouvement pour ce produit.</div>
      ) : (
        <div className="stkHisto">
          {mouvementsArticle.map((m) => {
            const s = SENS[m.data.sens] || SENS.entree;
            return (
              <div key={m.id} className="stkHistoLigne">
                <span className="stkSens" data-ton={s.ton}>
                  <Icon fafa={s.icone} width={9} />
                </span>
                <div className="stkHistoInfo">
                  <div className="stkHistoTitre">
                    {s.label} · {qty(m.data.quantite)} {draft.unite}
                  </div>
                  <div className="stkHistoMeta">
                    {[m.data.date, m.data.motif, m.auteur?.name]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <span
                  className="stkRetirer handcr"
                  onClick={() => supprimerMouvement(m)}
                >
                  <Icon fafa="faXmark" width={10} />
                </span>
              </div>
            );
          })}
        </div>
      )
    ) : null}
  </>
);

// Le panneau d'une carte : tout ce qu'elle porte, en un seul écran —
// étiquettes, échéance, assigné, description, rattachements aux autres
// modules, pièces jointes, check-list et commentaires.
//
// Chaque modification part immédiatement dans `majCarte` : il n'y a pas de
// bouton « Enregistrer », et donc pas de brouillon à perdre en fermant.

import React from "react";
import { Icon } from "../../../../utils/general";
import { ouvrirFichier } from "../../../openRequest";
import {
  ETIQUETTES,
  avancementChecklist,
  deplacerDansListe,
  idCourt,
} from "../board";

export const PanneauCarte = ({
  carteOuverte,
  setCarteOuverte,
  majCarte,
  supprimerCarte,
  membres,
  clients,
  factures,
  factureDe,
  creerFacture,
  busy,
  pieceInput,
  joindreFichier,
  glisseTache,
  setGlisseTache,
  cibleTache,
  setCibleTache,
  initiales,
  session,
}) => (
  <div className="pjPanneauFond" onClick={() => setCarteOuverte(null)}>
    <div className="pjPanneau" onClick={(e) => e.stopPropagation()}>
      <div className="pjPanneauTete">
        <input
          className="pjPanneauTitre"
          value={carteOuverte.data.titre}
          onChange={(e) => majCarte(carteOuverte, { titre: e.target.value })}
        />
        <Icon
          fafa="faXmark"
          width={13}
          onClick={() => setCarteOuverte(null)}
        />
      </div>

      <div className="pjPanneauCorps cosScroll">
        <div className="pjChamp">
          <label>Étiquettes</label>
          <div className="pjChoixEtiquettes">
            {ETIQUETTES.map((e) => {
              const actif = (carteOuverte.data.etiquettes || []).includes(
                e.id
              );
              return (
                <span
                  key={e.id}
                  className="pjPastille"
                  data-actif={actif ? "true" : "false"}
                  style={{ background: e.couleur }}
                  onClick={() => {
                    const liste = carteOuverte.data.etiquettes || [];
                    majCarte(carteOuverte, {
                      etiquettes: actif
                        ? liste.filter((x) => x !== e.id)
                        : [...liste, e.id],
                    });
                  }}
                >
                  {e.nom}
                </span>
              );
            })}
          </div>
        </div>

        <div className="pjDeuxColonnes">
          <div className="pjChamp">
            <label>Échéance</label>
            <input
              type="date"
              value={carteOuverte.data.echeance?.slice(0, 10) || ""}
              onChange={(e) =>
                majCarte(carteOuverte, { echeance: e.target.value || null })
              }
            />
          </div>
          <div className="pjChamp">
            <label>Assigné à</label>
            <select
              value={carteOuverte.data.assigneId || ""}
              onChange={(e) =>
                majCarte(carteOuverte, { assigneId: e.target.value || null })
              }
            >
              <option value="">Personne</option>
              {membres.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="pjChamp">
          <label>Description</label>
          <textarea
            rows={4}
            value={carteOuverte.data.description || ""}
            placeholder="Ce qu'il y a à faire, le contexte, les décisions…"
            onChange={(e) =>
              majCarte(carteOuverte, { description: e.target.value })
            }
          />
        </div>

        {/* Liens vers les autres modules — le cœur de l'intégration. */}
        <div className="pjSection">
          <div className="pjSectionTitre">
            <Icon fafa="faLink" width={11} /> Rattachements
          </div>
          <div className="pjDeuxColonnes">
            <div className="pjChamp">
              <label>Client (CRM)</label>
              <select
                value={carteOuverte.data.liens?.clientId || ""}
                onChange={(e) =>
                  majCarte(carteOuverte, {
                    liens: {
                      ...carteOuverte.data.liens,
                      clientId: e.target.value || null,
                    },
                  })
                }
              >
                <option value="">Aucun</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.data.entreprise || c.data.nom}
                  </option>
                ))}
              </select>
              {!clients.length ? (
                <span className="pjAide">
                  Installez le CRM pour rattacher un client.
                </span>
              ) : null}
            </div>

            <div className="pjChamp">
              <label>Facture</label>
              <select
                value={carteOuverte.data.liens?.factureId || ""}
                onChange={(e) =>
                  majCarte(carteOuverte, {
                    liens: {
                      ...carteOuverte.data.liens,
                      factureId: e.target.value || null,
                    },
                  })
                }
              >
                <option value="">Aucune</option>
                {factures.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.data.numero}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {carteOuverte.data.liens?.clientId &&
          !carteOuverte.data.liens?.factureId ? (
            <button className="pjSecondaire" onClick={creerFacture}>
              <Icon fafa="faFileInvoice" width={11} /> Créer une facture pour
              ce client
            </button>
          ) : null}
          {carteOuverte.data.liens?.factureId ? (
            <div className="pjRattache">
              <Icon fafa="faFileInvoice" width={11} />
              Facture{" "}
              {factureDe(carteOuverte.data.liens.factureId)?.data.numero} —
              gérée dans le module Facturation
            </div>
          ) : null}
        </div>

        {/* Pièces jointes : elles vivent dans le cloud, pas dans la carte. */}
        <div className="pjSection">
          <div className="pjSectionTitre">
            <Icon fafa="faPaperclip" width={11} /> Pièces jointes
          </div>
          {(carteOuverte.data.pieces || []).map((p) => (
            <div className="pjPiece" key={p.id}>
              <Icon fafa="faFile" width={11} />
              <span
                className="pjPieceNom"
                onClick={() => ouvrirFichier(p, carteOuverte.data.pieces)}
              >
                {p.name}
              </span>
              <Icon
                fafa="faXmark"
                width={10}
                onClick={() =>
                  majCarte(carteOuverte, {
                    pieces: carteOuverte.data.pieces.filter(
                      (x) => x.id !== p.id
                    ),
                  })
                }
              />
            </div>
          ))}
          <button
            className="pjSecondaire"
            data-off={busy}
            onClick={() => pieceInput.current?.click()}
          >
            <Icon fafa="faPlus" width={10} />{" "}
            {busy ? "Envoi…" : "Joindre un fichier"}
          </button>
          <input
            ref={pieceInput}
            type="file"
            className="pjCache"
            onChange={joindreFichier}
          />
          <span className="pjAide">
            Les pièces jointes sont enregistrées dans le dossier « Projets »
            du cloud et s'ouvrent dans les visionneuses de l'OS.
          </span>
        </div>

        {/* Check-list */}
        <div className="pjSection">
          <div className="pjSectionTitre">
            <Icon fafa="faSquareCheck" width={11} /> Check-list
            {avancementChecklist(carteOuverte.data.checklist) ? (
              <span className="pjCompte">
                {avancementChecklist(carteOuverte.data.checklist).faits}/
                {avancementChecklist(carteOuverte.data.checklist).total}
              </span>
            ) : null}
          </div>
          {/* Les tâches se réordonnent au glisser-déposer : l'ordre d'une
              check-list porte du sens, c'est souvent la marche à suivre. */}
          {(carteOuverte.data.checklist || []).map((item, i) => (
            <React.Fragment key={item.id}>
              {cibleTache === i ? <div className="pjFenteTache" /> : null}
              <div
                className="pjTache"
                draggable
                data-glissee={glisseTache === item.id ? "true" : "false"}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", item.id);
                  e.dataTransfer.effectAllowed = "move";
                  setGlisseTache(item.id);
                }}
                onDragEnd={() => {
                  setGlisseTache(null);
                  setCibleTache(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const r = e.currentTarget.getBoundingClientRect();
                  setCibleTache(
                    i + (e.clientY > r.top + r.height / 2 ? 1 : 0)
                  );
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (glisseTache != null && cibleTache != null) {
                    majCarte(carteOuverte, {
                      checklist: deplacerDansListe(
                        carteOuverte.data.checklist,
                        glisseTache,
                        cibleTache
                      ),
                    });
                  }
                  setGlisseTache(null);
                  setCibleTache(null);
                }}
              >
                <Icon className="pjPoignee" fafa="faGripVertical" width={9} />
                <input
                  type="checkbox"
                  checked={item.fait}
                  onChange={() =>
                    majCarte(carteOuverte, {
                      checklist: carteOuverte.data.checklist.map((x) =>
                        x.id === item.id ? { ...x, fait: !x.fait } : x
                      ),
                    })
                  }
                />
                <span data-fait={item.fait ? "true" : "false"}>
                  {item.texte}
                </span>
                <Icon
                  fafa="faXmark"
                  width={9}
                  onClick={() =>
                    majCarte(carteOuverte, {
                      checklist: carteOuverte.data.checklist.filter(
                        (x) => x.id !== item.id
                      ),
                    })
                  }
                />
              </div>
            </React.Fragment>
          ))}
          {cibleTache === (carteOuverte.data.checklist || []).length ? (
            <div className="pjFenteTache" />
          ) : null}
          <input
            className="pjAjoutLigne"
            placeholder="Ajouter une tâche puis Entrée…"
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !e.target.value.trim()) return;
              majCarte(carteOuverte, {
                checklist: [
                  ...(carteOuverte.data.checklist || []),
                  {
                    id: idCourt(),
                    texte: e.target.value.trim(),
                    fait: false,
                  },
                ],
              });
              e.target.value = "";
            }}
          />
        </div>

        {/* Commentaires */}
        <div className="pjSection">
          <div className="pjSectionTitre">
            <Icon fafa="faComment" width={11} /> Commentaires
          </div>
          {(carteOuverte.data.commentaires || []).map((c) => (
            <div className="pjCommentaire" key={c.id}>
              <span className="pjAvatar">{initiales(c.auteur)}</span>
              <div>
                <div className="pjCommentaireTete">
                  <b>{c.auteur}</b>
                  <em>{new Date(c.date).toLocaleString("fr-FR")}</em>
                </div>
                <div className="pjCommentaireTexte">{c.texte}</div>
              </div>
            </div>
          ))}
          <input
            className="pjAjoutLigne"
            placeholder="Écrire un commentaire puis Entrée…"
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !e.target.value.trim()) return;
              majCarte(carteOuverte, {
                commentaires: [
                  ...(carteOuverte.data.commentaires || []),
                  {
                    id: idCourt(),
                    auteur: session.user?.name || "Moi",
                    texte: e.target.value.trim(),
                    date: new Date().toISOString(),
                  },
                ],
              });
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="pjPanneauPied">
        <button
          className="pjDanger"
          onClick={() => supprimerCarte(carteOuverte)}
        >
          <Icon fafa="faTrashCan" width={11} /> Supprimer la carte
        </button>
      </div>
    </div>
  </div>
);

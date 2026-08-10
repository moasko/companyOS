// La fiche d'un client : son identité, ses chiffres, et trois onglets —
// les coordonnées, ses affaires, et l'historique de la relation.
//
// L'onglet « Suivi » n'est pas un journal qu'on remplit après coup : la
// saisie est en haut, la chronologie dessous, pour que noter un appel qui
// vient d'avoir lieu prenne trois secondes.

import React from "react";
import { Icon } from "../../../../utils/general";
import { montant as money } from "../../../../utils/monnaie";
import { Auteur } from "../../../Auteur";
import {
  ACTIVITES,
  ETAPES,
  ETAPES_OUVERTES,
  STATUTS,
  initiale,
  today,
} from "../domaine";

export const FicheClient = ({
  draft,
  selected,
  selectedId,
  caClient,
  affairesClient,
  onglet,
  setOnglet,
  champ,
  membres,
  busy,
  enregistrerClient,
  supprimerClient,
  nouvelleAffaire,
  ouvrirAffaire,
  activite,
  setActivite,
  ajouterActivite,
  timeline,
  basculerTache,
  supprimerActivite,
}) => (
  <>
    <div className="crmPanTete">
      <span className="crmGrandeInitiale">{initiale({ data: draft })}</span>
      <div className="crmPanInfo">
        <div className="crmPanNom">
          {draft.entreprise || draft.nom || "Nouveau client"}
        </div>
        <div className="crmPanMeta">
          {[draft.entreprise ? draft.nom : null, draft.ville]
            .filter(Boolean)
            .join(" · ") || "—"}
        </div>
      </div>
    </div>

    {selectedId ? (
      <div className="crmResume">
        <div>
          <span className="crmResumeLbl">Chiffre d'affaires</span>
          <strong>{money(caClient)}</strong>
        </div>
        <div>
          <span className="crmResumeLbl">Affaires ouvertes</span>
          <strong>
            {
              affairesClient.filter((o) =>
                ETAPES_OUVERTES.includes(o.data.etape),
              ).length
            }
          </strong>
        </div>
      </div>
    ) : null}

    <div className="crmOnglets">
      {[
        ["fiche", "Fiche"],
        ["affaires", "Affaires"],
        ["suivi", "Suivi"],
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
        <div className="crmDeux">
          <label className="crmField">
            <span className="crmLabel">Entreprise</span>
            <input
              type="text"
              value={draft.entreprise}
              onChange={champ("entreprise")}
            />
          </label>
          <label className="crmField">
            <span className="crmLabel">Contact</span>
            <input type="text" value={draft.nom} onChange={champ("nom")} />
          </label>
        </div>

        <div className="crmDeux">
          <label className="crmField">
            <span className="crmLabel">Téléphone</span>
            <input
              type="text"
              value={draft.telephone}
              onChange={champ("telephone")}
            />
          </label>
          <label className="crmField">
            <span className="crmLabel">E-mail</span>
            <input type="text" value={draft.email} onChange={champ("email")} />
          </label>
        </div>

        <div className="crmDeux">
          <label className="crmField">
            <span className="crmLabel">Ville</span>
            <input type="text" value={draft.ville} onChange={champ("ville")} />
          </label>
          <label className="crmField">
            <span className="crmLabel">Secteur</span>
            <input
              type="text"
              placeholder="Distribution, BTP…"
              value={draft.secteur}
              onChange={champ("secteur")}
            />
          </label>
        </div>

        <label className="crmField">
          <span className="crmLabel">Adresse</span>
          <input
            type="text"
            placeholder="Cocody, rue des Jardins"
            value={draft.adresse}
            onChange={champ("adresse")}
          />
        </label>

        <div className="crmDeux">
          <label className="crmField">
            <span className="crmLabel">Statut</span>
            <select value={draft.statut} onChange={champ("statut")}>
              {Object.entries(STATUTS).map(([id, s]) => (
                <option key={id} value={id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="crmField">
            <span className="crmLabel">Suivi par</span>
            <select
              value={draft.responsableId || ""}
              onChange={champ("responsableId")}
            >
              <option value="">Personne</option>
              {membres.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="crmField">
          <span className="crmLabel">Notes</span>
          <textarea rows={3} value={draft.notes} onChange={champ("notes")} />
        </label>

        {selected ? <Auteur record={selected} /> : null}

        <div className="crmFormActions">
          <div
            className="crmPrimary handcr"
            data-off={busy}
            onClick={enregistrerClient}
          >
            <Icon fafa="faFloppyDisk" width={11} />
            <span>{busy ? "…" : "Enregistrer"}</span>
          </div>
          {selectedId ? (
            <div
              className="crmBtnGhost crmDanger handcr"
              onClick={supprimerClient}
            >
              Supprimer
            </div>
          ) : null}
        </div>
      </>
    ) : null}

    {onglet === "affaires" ? (
      !selectedId ? (
        <div className="crmEmptyBox">
          Enregistrez la fiche avant d'ajouter des affaires.
        </div>
      ) : (
        <>
          <div className="crmFormActions">
            <div className="crmPrimary handcr" onClick={nouvelleAffaire}>
              <Icon fafa="faPlus" width={10} />
              <span>Nouvelle affaire</span>
            </div>
          </div>

          {!affairesClient.length ? (
            <div className="crmEmptyBox">Aucune affaire pour ce client.</div>
          ) : (
            affairesClient.map((o) => {
              const e = ETAPES[o.data.etape] || ETAPES.contact;
              return (
                <div
                  key={o.id}
                  className="crmAffaireLigne handcr"
                  onClick={() => ouvrirAffaire(o)}
                >
                  <div className="crmAffaireInfo">
                    <div className="crmAffaireTitre">{o.data.libelle}</div>
                    <div className="crmAffaireMeta">
                      {money(o.data.montant)}
                      {o.data.dateCloture ? ` · ${o.data.dateCloture}` : ""}
                    </div>
                  </div>
                  <span className="crmTag" data-ton={e.ton}>
                    {e.label}
                  </span>
                </div>
              );
            })
          )}
        </>
      )
    ) : null}

    {onglet === "suivi" ? (
      !selectedId ? (
        <div className="crmEmptyBox">
          Enregistrez la fiche avant de noter un échange.
        </div>
      ) : (
        <>
          <div className="crmTypes">
            {Object.entries(ACTIVITES).map(([id, a]) => (
              <span
                key={id}
                className="handcr"
                data-actif={activite.type === id}
                onClick={() => setActivite((v) => ({ ...v, type: id }))}
                title={a.label}
              >
                <Icon fafa={a.icone} width={11} />
              </span>
            ))}
          </div>

          <label className="crmField">
            <span className="crmLabel">
              {activite.type === "tache" ? "Quoi faire" : "Ce qui s'est dit"}
            </span>
            <input
              type="text"
              placeholder={
                activite.type === "tache"
                  ? "Rappeler pour le devis"
                  : "Relance devis, rappelle vendredi"
              }
              value={activite.resume}
              onChange={(e) =>
                setActivite((v) => ({ ...v, resume: e.target.value }))
              }
            />
          </label>

          <div className="crmDeux">
            <label className="crmField">
              <span className="crmLabel">Date</span>
              <input
                type="date"
                value={activite.date}
                onChange={(e) =>
                  setActivite((v) => ({ ...v, date: e.target.value }))
                }
              />
            </label>
            {activite.type === "tache" ? (
              <label className="crmField">
                <span className="crmLabel">À faire le</span>
                <input
                  type="date"
                  value={activite.echeance || today()}
                  onChange={(e) =>
                    setActivite((v) => ({ ...v, echeance: e.target.value }))
                  }
                />
              </label>
            ) : (
              <div />
            )}
          </div>

          <div className="crmFormActions">
            <div
              className="crmPrimary handcr"
              data-off={busy}
              onClick={ajouterActivite}
            >
              Ajouter au suivi
            </div>
          </div>

          {!timeline.length ? (
            <div className="crmEmptyBox">
              Aucun échange enregistré. Notez le premier appel : c'est ce qui
              fait la différence six mois plus tard.
            </div>
          ) : (
            <div className="crmTimeline">
              {timeline.map((ev) => {
                if (ev.genre === "opportunite") {
                  const e = ETAPES[ev.record.data.etape] || ETAPES.contact;
                  return (
                    <div key={ev.id} className="crmEvent">
                      <span className="crmEventIcone" data-ton={e.ton}>
                        <Icon fafa="faBriefcase" width={9} />
                      </span>
                      <div className="crmEventInfo">
                        <div className="crmEventTitre">
                          {ev.record.data.libelle} ·{" "}
                          {money(ev.record.data.montant)}
                        </div>
                        <div className="crmEventMeta">
                          {e.label} · {ev.date}
                        </div>
                      </div>
                    </div>
                  );
                }

                const a = ev.record;
                const t = ACTIVITES[a.data.type] || ACTIVITES.note;
                const tache = a.data.type === "tache";
                return (
                  <div key={ev.id} className="crmEvent" data-fait={a.data.fait}>
                    <span
                      className="crmEventIcone handcr"
                      data-ton={t.ton}
                      onClick={() => tache && basculerTache(a)}
                      title={tache ? "Marquer comme faite" : t.label}
                    >
                      <Icon
                        fafa={tache && a.data.fait ? "faCheck" : t.icone}
                        width={9}
                      />
                    </span>
                    <div className="crmEventInfo">
                      <div className="crmEventTitre">{a.data.resume}</div>
                      <div className="crmEventMeta">
                        {[
                          t.label,
                          tache ? `à faire le ${a.data.echeance}` : a.data.date,
                          a.auteur?.name,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    <span
                      className="crmRetirer handcr"
                      onClick={() => supprimerActivite(a)}
                    >
                      <Icon fafa="faXmark" width={10} />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )
    ) : null}
  </>
);

// Le dossier d'un salarié, dans le panneau de droite : son identité en
// tête, son solde de congés, puis trois onglets — la fiche, le contrat, les
// absences.
//
// Le solde et l'ancienneté sont affichés dès la tête du panneau : ce sont
// les deux chiffres qu'on vient chercher en ouvrant un dossier.

import React from "react";
import { Icon } from "../../../../utils/general";
import { Auteur } from "../../../Auteur";
import { Avatar } from "../../../Avatar";
import {
  ETATS_DEMANDE,
  STATUTS,
  TYPES_ABSENCE,
  TYPES_CONTRAT,
  ancienneteTexte,
  joursOuvrables,
  nomComplet,
} from "../domaine";

export const FicheSalarie = ({
  draft,
  selected,
  selectedId,
  salaries,
  membres,
  reglages,
  solde,
  absencesSalarie,
  onglet,
  setOnglet,
  champ,
  busy,
  changerPhoto,
  enregistrerSalarie,
  supprimerSalarie,
  nouvelleAbsence,
}) => (
  <>
    <div className="rhPanTete">
      <div className="rhPhoto">
        <Avatar
          user={{ avatar: draft.photo, name: nomComplet({ data: draft }) }}
          taille={54}
        />
        <span
          className="rhPhotoBtn handcr"
          title="Changer la photo"
          onClick={changerPhoto}
        >
          <Icon fafa="faCamera" width={9} />
        </span>
      </div>
      <div className="rhPanInfo">
        <div className="rhPanNom">
          {nomComplet({ data: draft }) || "Nouveau dossier"}
        </div>
        <div className="rhPanMeta">
          {[draft.poste, draft.matricule].filter(Boolean).join(" · ") || "—"}
        </div>
      </div>
    </div>

    {selectedId && solde ? (
      <div className="rhResume">
        <div>
          <span className="rhResumeLbl">Solde de congés</span>
          <strong data-ton={solde.solde < 0 ? "bad" : "ok"}>
            {solde.solde} j
          </strong>
        </div>
        <div>
          <span className="rhResumeLbl">Ancienneté</span>
          <strong>{ancienneteTexte(draft.dateEmbauche)}</strong>
        </div>
      </div>
    ) : null}

    <div className="rhOnglets">
      {[
        ["fiche", "Fiche"],
        ["contrat", "Contrat"],
        ["absences", "Absences"],
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
        <div className="rhDeux">
          <label className="rhField">
            <span className="rhLabel">Nom *</span>
            <input type="text" value={draft.nom} onChange={champ("nom")} />
          </label>
          <label className="rhField">
            <span className="rhLabel">Prénom</span>
            <input
              type="text"
              value={draft.prenom}
              onChange={champ("prenom")}
            />
          </label>
        </div>

        <div className="rhDeux">
          <label className="rhField">
            <span className="rhLabel">Matricule</span>
            <input
              type="text"
              value={draft.matricule}
              onChange={champ("matricule")}
            />
          </label>
          <label className="rhField">
            <span className="rhLabel">Date de naissance</span>
            <input
              type="date"
              value={draft.dateNaissance}
              onChange={champ("dateNaissance")}
            />
          </label>
        </div>

        <div className="rhDeux">
          <label className="rhField">
            <span className="rhLabel">Téléphone</span>
            <input
              type="text"
              value={draft.telephone}
              onChange={champ("telephone")}
            />
          </label>
          <label className="rhField">
            <span className="rhLabel">E-mail</span>
            <input type="text" value={draft.email} onChange={champ("email")} />
          </label>
        </div>

        <div className="rhDeux">
          <label className="rhField">
            <span className="rhLabel">Ville</span>
            <input type="text" value={draft.ville} onChange={champ("ville")} />
          </label>
          <label className="rhField">
            <span className="rhLabel">Sexe</span>
            <select value={draft.sexe} onChange={champ("sexe")}>
              <option value="">Non précisé</option>
              <option value="F">Féminin</option>
              <option value="M">Masculin</option>
            </select>
          </label>
        </div>

        <label className="rhField">
          <span className="rhLabel">Adresse</span>
          <input
            type="text"
            value={draft.adresse}
            onChange={champ("adresse")}
          />
        </label>

        <label className="rhField">
          <span className="rhLabel">
            Compte CompanyOS — pour recevoir les décisions de congé
          </span>
          <select value={draft.userId} onChange={champ("userId")}>
            <option value="">Aucun</option>
            {membres.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} — {m.email}
              </option>
            ))}
          </select>
        </label>

        <label className="rhField">
          <span className="rhLabel">Notes</span>
          <textarea rows={3} value={draft.notes} onChange={champ("notes")} />
        </label>

        {selected ? <Auteur record={selected} /> : null}

        <div className="rhFormActions">
          <div
            className="rhPrimary handcr"
            data-off={busy}
            onClick={enregistrerSalarie}
          >
            <Icon fafa="faFloppyDisk" width={11} />
            <span>{busy ? "…" : "Enregistrer"}</span>
          </div>
          {selectedId ? (
            <div
              className="rhBtnGhost rhDanger handcr"
              onClick={supprimerSalarie}
            >
              Supprimer
            </div>
          ) : null}
        </div>
      </>
    ) : null}

    {onglet === "contrat" ? (
      <>
        <label className="rhField">
          <span className="rhLabel">Poste</span>
          <input type="text" value={draft.poste} onChange={champ("poste")} />
        </label>

        <label className="rhField">
          <span className="rhLabel">Département</span>
          <input
            type="text"
            list="rhDepartements"
            value={draft.departement}
            onChange={champ("departement")}
          />
          {/* Une liste de suggestions plutôt qu'un référentiel :
              trois départements ne méritent pas un écran de
              gestion, mais taper « Ventes » puis « ventes »
              casserait tous les regroupements. */}
          <datalist id="rhDepartements">
            {[...new Set(salaries.map((s) => s.data.departement).filter(Boolean))].map(
              (d) => (
                <option key={d} value={d} />
              ),
            )}
          </datalist>
        </label>

        <div className="rhDeux">
          <label className="rhField">
            <span className="rhLabel">Type de contrat</span>
            <select value={draft.typeContrat} onChange={champ("typeContrat")}>
              {Object.entries(TYPES_CONTRAT).map(([id, c]) => (
                <option key={id} value={id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="rhField">
            <span className="rhLabel">Statut</span>
            <select value={draft.statut} onChange={champ("statut")}>
              {Object.entries(STATUTS).map(([id, s]) => (
                <option key={id} value={id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="rhDeux">
          <label className="rhField">
            <span className="rhLabel">Date d'embauche</span>
            <input
              type="date"
              value={draft.dateEmbauche}
              onChange={champ("dateEmbauche")}
            />
          </label>
          <label className="rhField">
            <span className="rhLabel">
              Fin de contrat
              {TYPES_CONTRAT[draft.typeContrat]?.duree ? " *" : ""}
            </span>
            <input
              type="date"
              value={draft.dateFin}
              disabled={!TYPES_CONTRAT[draft.typeContrat]?.duree}
              onChange={champ("dateFin")}
            />
          </label>
        </div>

        <div className="rhDeux">
          <label className="rhField">
            <span className="rhLabel">Salaire de base</span>
            <input
              type="number"
              value={draft.salaireBase}
              onChange={champ("salaireBase")}
            />
          </label>
          <label className="rhField">
            <span className="rhLabel">Report de congés (jours)</span>
            <input
              type="number"
              step="0.5"
              value={draft.reportConges}
              onChange={champ("reportConges")}
            />
          </label>
        </div>

        <div className="rhDeux">
          <label className="rhField">
            <span className="rhLabel">N° CNPS</span>
            <input
              type="text"
              value={draft.numeroCnps}
              onChange={champ("numeroCnps")}
            />
          </label>
          <label className="rhField">
            <span className="rhLabel">Compte de paiement</span>
            <input
              type="text"
              placeholder="Banque ou Mobile Money"
              value={draft.banque}
              onChange={champ("banque")}
            />
          </label>
        </div>

        {solde ? (
          <>
            <div className="rhRecap">
              <span>Congés acquis</span>
              <strong>{solde.acquis} j</strong>
            </div>
            <div className="rhRecap">
              <span>Pris</span>
              <strong>{solde.pris} j</strong>
            </div>
            {solde.enAttente ? (
              <div className="rhRecap">
                <span>Demandés, non tranchés</span>
                <strong>{solde.enAttente} j</strong>
              </div>
            ) : null}
            <div className="rhRecap rhRecapFort">
              <span>Solde</span>
              <strong data-ton={solde.solde < 0 ? "bad" : "ok"}>
                {solde.solde} j
              </strong>
            </div>
          </>
        ) : null}

        <div className="rhFormActions">
          <div
            className="rhPrimary handcr"
            data-off={busy}
            onClick={enregistrerSalarie}
          >
            <Icon fafa="faFloppyDisk" width={11} />
            <span>{busy ? "…" : "Enregistrer"}</span>
          </div>
        </div>
      </>
    ) : null}

    {onglet === "absences" ? (
      !selectedId ? (
        <div className="rhEmptyBox">
          Enregistrez le dossier avant de saisir une absence.
        </div>
      ) : (
        <>
          <div className="rhFormActions">
            <div
              className="rhPrimary handcr"
              onClick={() => nouvelleAbsence(selectedId)}
            >
              <Icon fafa="faPlus" width={10} />
              <span>Nouvelle absence</span>
            </div>
          </div>

          {!absencesSalarie.length ? (
            <div className="rhEmptyBox">Aucune absence enregistrée.</div>
          ) : (
            <div className="rhHisto">
              {absencesSalarie.map((a) => {
                const t = TYPES_ABSENCE[a.data.type] || TYPES_ABSENCE.conge;
                const e = ETATS_DEMANDE[a.data.etat] || ETATS_DEMANDE.demande;
                return (
                  <div key={a.id} className="rhHistoLigne">
                    <span className="rhHistoIcone" data-ton={t.ton}>
                      <Icon fafa={t.icone} width={9} />
                    </span>
                    <div className="rhHistoInfo">
                      <div className="rhHistoTitre">
                        {t.label} ·{" "}
                        {joursOuvrables(a.data.du, a.data.au, reglages)} j
                      </div>
                      <div className="rhHistoMeta">
                        {a.data.du} → {a.data.au}
                        {a.data.motif ? ` · ${a.data.motif}` : ""}
                      </div>
                    </div>
                    <span className="rhTag" data-ton={e.ton}>
                      {e.label}
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

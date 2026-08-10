// La liste du personnel : recherche, puis un tableau où chaque ligne est un
// dossier.
//
// Le solde de congés et l'ancienneté sont recalculés à l'affichage plutôt
// que stockés : un solde figé dans l'enregistrement vieillirait d'un jour
// par jour sans que personne ne le voie.

import React from "react";
import { Icon } from "../../../../utils/general";
import { montant as money } from "../../../../utils/monnaie";
import { Avatar } from "../../../Avatar";
import { Contenu } from "../../../chargement";
import {
  STATUTS,
  TYPES_CONTRAT,
  ancienneteTexte,
  nomComplet,
  soldeConges,
} from "../domaine";

export const Personnel = ({
  requete,
  setRequete,
  nouveauSalarie,
  etat,
  salaries,
  visibles,
  absences,
  reglages,
  absentsDuJour,
  selectedId,
  ouvrirSalarie,
}) => (
  <>
    <div className="rhBarre">
      <div className="rhRecherche">
        <Icon fafa="faMagnifyingGlass" width={11} />
        <input
          type="text"
          placeholder="Nom, matricule, poste, département…"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
        />
        {requete ? (
          <Icon fafa="faXmark" width={10} onClick={() => setRequete("")} />
        ) : null}
      </div>
      <div className="rhPrimary handcr" onClick={nouveauSalarie}>
        <Icon fafa="faPlus" width={10} />
        <span>Nouveau dossier</span>
      </div>
    </div>

    {etat.initial || etat.erreur ? (
      <Contenu etat={etat} vide={false} lignes={7} />
    ) : !visibles.length ? (
      <div className="rhVide">
        <Icon fafa="faUsers" width={26} />
        <span>
          {salaries.length
            ? "Aucun salarié pour ce filtre."
            : "Aucun dossier du personnel."}
        </span>
        {!salaries.length ? (
          <div className="rhPrimary handcr" onClick={nouveauSalarie}>
            Créer le premier dossier
          </div>
        ) : null}
      </div>
    ) : (
      <div className="rhTable cosScroll">
        <div className="rhTr rhTrSal rhTh">
          <span />
          <span>Salarié</span>
          <span>Poste</span>
          <span>Contrat</span>
          <span>Ancienneté</span>
          <span className="rhNum">Salaire</span>
          <span className="rhNum">Congés</span>
          <span>Statut</span>
        </div>
        {visibles.map((s) => {
          const so = soldeConges(s, absences, reglages);
          const st = STATUTS[s.data.statut] || STATUTS.actif;
          const c = TYPES_CONTRAT[s.data.typeContrat];
          const absent = absentsDuJour.some((a) => a.salarie.id === s.id);
          return (
            <div
              key={s.id}
              className="rhTr rhTrSal handcr"
              data-actif={s.id === selectedId}
              onClick={() => ouvrirSalarie(s)}
            >
              <Avatar
                user={{ avatar: s.data.photo, name: nomComplet(s) }}
                taille={28}
              />
              <span className="rhTdNom">
                <strong>
                  {nomComplet(s)}
                  {absent ? <em className="rhEstAbsent"> · absent</em> : null}
                </strong>
                <em>{s.data.matricule}</em>
              </span>
              <span className="rhMuted">{s.data.poste || "—"}</span>
              <span className="rhMuted">
                {c?.label}
                {c?.duree && s.data.dateFin ? ` · ${s.data.dateFin}` : ""}
              </span>
              <span className="rhMuted">
                {ancienneteTexte(s.data.dateEmbauche)}
              </span>
              <span className="rhNum">{money(s.data.salaireBase)}</span>
              <span className="rhNum" data-alerte={so.solde < 0}>
                {so.solde} j
              </span>
              <span>
                <span className="rhTag" data-ton={st.ton}>
                  {st.label}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    )}
  </>
);

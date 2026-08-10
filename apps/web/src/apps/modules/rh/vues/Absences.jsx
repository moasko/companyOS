// Congés et absences, dans l'ordre où on s'en occupe : ce qui attend une
// décision, qui manque aujourd'hui, puis l'historique.
//
// L'historique s'arrête à deux cents lignes : au-delà, la page devient
// illisible, et l'historique d'une personne se lit dans son dossier.

import React from "react";
import { Icon } from "../../../../utils/general";
import { Avatar } from "../../../Avatar";
import {
  ETATS_DEMANDE,
  TYPES_ABSENCE,
  joursOuvrables,
  nomComplet,
  soldeConges,
} from "../domaine";

export const Absences = ({
  absences,
  enAttente,
  absentsDuJour,
  reglages,
  busy,
  selectedId,
  salarieDe,
  nouvelleAbsence,
  deciderAbsence,
  supprimerAbsence,
  setVue,
  setFiltreStatut,
  ouvrirSalarie,
}) => (
  <>
    <div className="rhBarre">
      <div
        className="rhPrimary handcr"
        onClick={() => nouvelleAbsence(selectedId)}
      >
        <Icon fafa="faPlus" width={10} />
        <span>Nouvelle absence</span>
      </div>
    </div>

    {enAttente.length ? (
      <>
        <div className="rhSousTitre">
          À décider — {enAttente.length} demande
          {enAttente.length > 1 ? "s" : ""}
        </div>
        {enAttente.map((a) => {
          const s = salarieDe(a.data.salarieId);
          const t = TYPES_ABSENCE[a.data.type] || TYPES_ABSENCE.conge;
          const jours = joursOuvrables(a.data.du, a.data.au, reglages);
          const so = s ? soldeConges(s, absences, reglages) : null;
          return (
            <div key={a.id} className="rhDemande">
              <Avatar
                user={{ avatar: s?.data.photo, name: nomComplet(s) }}
                taille={30}
              />
              <div className="rhDemandeInfo">
                <div className="rhDemandeNom">
                  {nomComplet(s)} — {t.label}
                </div>
                <div className="rhDemandeMeta">
                  Du {a.data.du} au {a.data.au} · {jours} jour
                  {jours > 1 ? "s" : ""} ouvrable{jours > 1 ? "s" : ""}
                  {a.data.motif ? ` · ${a.data.motif}` : ""}
                </div>
                {/* Le solde restant si la demande est accordée :
                    approuver sans le voir, c'est créer les
                    dépassements qu'on découvre en fin d'année. */}
                {t.decompte && so ? (
                  <div
                    className="rhDemandeSolde"
                    data-alerte={so.solde - jours < 0}
                  >
                    Solde après accord : {Math.round((so.solde - jours) * 10) / 10} j
                    {so.solde - jours < 0 ? " — dépassement" : ""}
                  </div>
                ) : null}
              </div>
              <div className="rhDemandeActions">
                <div
                  className="rhBtnGhost handcr"
                  data-off={busy}
                  onClick={() => deciderAbsence(a, "approuve")}
                >
                  Approuver
                </div>
                <div
                  className="rhBtnGhost rhDanger handcr"
                  data-off={busy}
                  onClick={() => deciderAbsence(a, "refuse")}
                >
                  Refuser
                </div>
              </div>
            </div>
          );
        })}
      </>
    ) : null}

    <div className="rhSousTitre">Absents aujourd'hui</div>
    {!absentsDuJour.length ? (
      <div className="rhEmptyBox">Tout le monde est présent.</div>
    ) : (
      absentsDuJour.map(({ absence, salarie }) => {
        const t = TYPES_ABSENCE[absence.data.type] || TYPES_ABSENCE.conge;
        return (
          <div
            key={absence.id}
            className="rhAbsent handcr"
            onClick={() => {
              setVue("personnel");
              setFiltreStatut("tous");
              ouvrirSalarie(salarie);
            }}
          >
            <span className="rhTag" data-ton={t.ton}>
              {t.label}
            </span>
            <span className="rhAbsentNom">{nomComplet(salarie)}</span>
            <span className="rhMuted">
              jusqu'au {absence.data.au}
            </span>
          </div>
        );
      })
    )}

    <div className="rhSousTitre">Historique</div>
    {!absences.length ? (
      <div className="rhEmptyBox">Aucune absence enregistrée.</div>
    ) : (
      <div className="rhTable cosScroll">
        <div className="rhTr rhTrAbs rhTh">
          <span>Salarié</span>
          <span>Type</span>
          <span>Du</span>
          <span>Au</span>
          <span className="rhNum">Jours</span>
          <span>État</span>
          <span />
        </div>
        {[...absences]
          .sort((a, b) => (a.data.du < b.data.du ? 1 : -1))
          .slice(0, 200)
          .map((a) => {
            const t = TYPES_ABSENCE[a.data.type] || TYPES_ABSENCE.conge;
            const e = ETATS_DEMANDE[a.data.etat] || ETATS_DEMANDE.demande;
            return (
              <div key={a.id} className="rhTr rhTrAbs">
                <span className="rhMuted">
                  {nomComplet(salarieDe(a.data.salarieId))}
                </span>
                <span className="rhSens" data-ton={t.ton}>
                  <Icon fafa={t.icone} width={9} />
                  {t.label}
                </span>
                <span className="rhMuted">{a.data.du}</span>
                <span className="rhMuted">{a.data.au}</span>
                <span className="rhNum">
                  {joursOuvrables(a.data.du, a.data.au, reglages)}
                </span>
                <span>
                  <span className="rhTag" data-ton={e.ton}>
                    {e.label}
                  </span>
                </span>
                <span
                  className="rhRetirer handcr"
                  onClick={() => supprimerAbsence(a)}
                >
                  <Icon fafa="faXmark" width={10} />
                </span>
              </div>
            );
          })}
      </div>
    )}
  </>
);

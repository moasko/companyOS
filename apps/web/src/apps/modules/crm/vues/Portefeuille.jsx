// Le portefeuille : la recherche, puis le fichier client en tableau.
//
// Les colonnes qui comptent ne sont pas l'adresse et le téléphone, mais le
// dernier contact et la prochaine action : c'est ce qui dit si un dossier
// avance ou s'il est en train de s'éteindre.

import React from "react";
import { Icon } from "../../../../utils/general";
import { montant as money } from "../../../../utils/monnaie";
import { Avatar } from "../../../Avatar";
import { Contenu } from "../../../chargement";
import {
  STATUTS,
  initiale,
  jourssansContact,
  nomDe,
  prochaineAction,
  today,
} from "../domaine";

export const Portefeuille = ({
  requete,
  setRequete,
  nouveauClient,
  etat,
  visibles,
  clients,
  activites,
  selectedId,
  ouvrirClient,
  membreDe,
  caParClient,
}) => (
  <>
    <div className="crmBarre">
      <div className="crmRecherche">
        <Icon fafa="faMagnifyingGlass" width={11} />
        <input
          type="text"
          placeholder="Nom, entreprise, ville, téléphone…"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
        />
        {requete ? (
          <Icon fafa="faXmark" width={10} onClick={() => setRequete("")} />
        ) : null}
      </div>
      <div className="crmPrimary handcr" onClick={nouveauClient}>
        <Icon fafa="faPlus" width={10} />
        <span>Nouveau client</span>
      </div>
    </div>

    {etat.initial || etat.erreur ? (
      <Contenu etat={etat} vide={false} lignes={7} />
    ) : !visibles.length ? (
      <div className="crmVide">
        <Icon fafa="faUsers" width={26} />
        <span>
          {clients.length
            ? "Aucun client ne correspond à ce filtre."
            : "Votre portefeuille est vide."}
        </span>
        {!clients.length ? (
          <div className="crmPrimary handcr" onClick={nouveauClient}>
            Créer la première fiche
          </div>
        ) : null}
      </div>
    ) : (
      <div className="crmTable cosScroll">
        <div className="crmTr crmTrClient crmTh">
          <span />
          <span>Client</span>
          <span>Ville</span>
          <span>Suivi par</span>
          <span>Dernier contact</span>
          <span>Prochaine action</span>
          <span className="crmNum">CA</span>
          <span>Statut</span>
        </div>
        {visibles.map((c) => {
          const jours = jourssansContact(c.id, activites);
          const prochaine = prochaineAction(c.id, activites);
          const s = STATUTS[c.data.statut] || STATUTS.prospect;
          const retard =
            prochaine && prochaine.data.echeance < today();
          return (
            <div
              key={c.id}
              className="crmTr crmTrClient handcr"
              data-actif={c.id === selectedId}
              onClick={() => ouvrirClient(c)}
            >
              <span className="crmInitiale">{initiale(c)}</span>
              <span className="crmTdNom">
                <strong>{nomDe(c)}</strong>
                <em>{c.data.entreprise ? c.data.nom : c.data.email}</em>
              </span>
              <span className="crmMuted">{c.data.ville || "—"}</span>
              <span className="crmResp">
                {membreDe(c.data.responsableId) ? (
                  <Avatar user={membreDe(c.data.responsableId)} taille={22} />
                ) : (
                  <em className="crmMuted">personne</em>
                )}
              </span>
              {/* « Jamais contacté » n'est pas une absence de
                  donnée : c'est le signal le plus fort du
                  tableau, il doit se voir comme tel. */}
              <span
                className="crmMuted"
                data-alerte={jours === null || jours > 60}
              >
                {jours === null ? "jamais" : `il y a ${jours} j`}
              </span>
              <span className="crmMuted" data-alerte={retard}>
                {prochaine
                  ? `${prochaine.data.echeance} · ${prochaine.data.resume}`
                  : "—"}
              </span>
              <span className="crmNum">
                {caParClient[c.id] ? money(caParClient[c.id]) : "—"}
              </span>
              <span>
                <span className="crmTag" data-ton={s.ton}>
                  {s.label}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    )}
  </>
);

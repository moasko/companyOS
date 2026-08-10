import React from "react";
import { Icon } from "../../../../utils/general";
import { ROLES, formatBytes } from "./commun";

/// Traduction des verbes techniques du journal. Une action inconnue —
/// parce qu'un module récent en a introduit une — s'affiche telle quelle
/// plutôt que de disparaître : mieux vaut « stock.transfert » qu'un vide.
const ACTIONS = {
  "espace.creation": ["a créé l'espace de travail", "faBuilding"],
  "espace.formule": ["a changé la formule de l'espace", "faCreditCard"],
  "courrier.envoi": ["a envoyé un courriel à", "faPaperPlane"],
  "courrier.reglages": ["a modifié le relais SMTP", "faEnvelope"],
  "courrier.relance": ["relance automatique envoyée à", "faBell"],
  "espace.renommage": ["a renommé l'espace", "faPen"],
  "session.connexion": ["s'est connecté", "faRightToBracket"],
  "compte.motdepasse": ["a changé son mot de passe", "faKey"],
  "compte.renommage": ["a changé son nom", "faPen"],
  "compte.photo": ["a changé sa photo", "faCamera"],
  "compte.photo.retrait": ["a retiré sa photo", "faCamera"],
  "invitation.envoi": ["a invité", "faEnvelope"],
  "invitation.annulation": ["a annulé l'invitation de", "faXmark"],
  "membre.arrivee": ["a rejoint l'espace", "faUserPlus"],
  "membre.role": ["a changé le rôle de", "faUserShield"],
  "membre.retrait": ["a retiré", "faUserMinus"],
  "app.installation": ["a installé", "faDownload"],
  "app.desinstallation": ["a désinstallé", "faTrash"],
  "app.miseajour": ["a mis à jour", "faCircleArrowUp"],
  "studio.creation": ["a créé l'application", "faWandMagicSparkles"],
  "studio.modification": ["a modifié l'application", "faWandMagicSparkles"],
  "studio.suppression": ["a supprimé l'application", "faTrash"],
  "dossier.creation": ["a créé le dossier", "faFolderPlus"],
  "fichier.import": ["a importé", "faFileArrowUp"],
  "fichier.renommage": ["a renommé", "faPen"],
  "fichier.deplacement": ["a déplacé", "faRightLeft"],
  "fichier.corbeille": ["a mis à la corbeille", "faTrashCan"],
  "fichier.restauration": ["a restauré", "faTrashArrowUp"],
  "fichier.suppression": ["a supprimé définitivement", "faFireFlameSimple"],
  "corbeille.vidage": ["a vidé la corbeille", "faFireFlameSimple"],
};

/// Le contexte d'une entrée, en une phrase. Rien n'est indispensable ici :
/// une entrée sans détails reste parfaitement lisible.
const contexte = (e) => {
  const d = e.details || {};
  if (e.action === "membre.role") return `${d.avant} → ${d.apres}`;
  if (e.action === "membre.retrait") return `${d.nom || ""} (${d.role || ""})`;
  if (e.action === "invitation.envoi") return ROLES[d.role] || d.role;
  if (e.action === "fichier.import" && d.octets) return formatBytes(d.octets);
  if (e.action === "fichier.corbeille" && d.elements > 1) return `${d.elements} éléments`;
  if (e.action === "corbeille.vidage") return `${d.elements || 0} éléments`;
  if (e.action === "espace.renommage" && d.avant) return `avant : ${d.avant}`;
  return "";
};

/// Un horodatage complet : le journal sert à établir des faits, pas à
/// donner une impression — « il y a 3 h » n'a jamais réglé un litige.
const horodatage = (iso) =>
  new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export const SectionJournal = ({
  section,
  peutGerer,
  filtre,
  setFiltre,
  facettes,
  journal,
  journalFini,
  chargerJournal,
}) => (
  <section className="setSection" data-hidden={section !== "journal"}>
    <h2>Journal d'activité</h2>
    <p className="setHint">
      Qui a fait quoi dans l'espace de travail, et quand
    </p>

    {!peutGerer ? (
      <div className="setEmptyBox">
        Seuls les administrateurs de l'espace peuvent consulter le
        journal.
      </div>
    ) : (
      <>
        <div className="setFiltres">
          <select
            className="setRole"
            value={filtre.action}
            onChange={(e) => setFiltre({ ...filtre, action: e.target.value })}
          >
            <option value="">Toutes les actions</option>
            {facettes.actions.map((a) => (
              <option key={a.action} value={a.action}>
                {(ACTIONS[a.action]?.[0] || a.action)} ({a.total})
              </option>
            ))}
          </select>
          <select
            className="setRole"
            value={filtre.auteur}
            onChange={(e) => setFiltre({ ...filtre, auteur: e.target.value })}
          >
            <option value="">Tout le monde</option>
            {facettes.auteurs.map((a) => (
              <option key={a.email} value={a.email}>
                {a.nom} ({a.total})
              </option>
            ))}
          </select>
          <Icon
            className="setRetirer"
            fafa="faRotate"
            width={12}
            title="Rafraîchir"
            onClick={() => chargerJournal()}
          />
        </div>

        {!journal.length ? (
          <div className="setEmptyBox">
            Aucune activité pour ce filtre.
          </div>
        ) : (
          <div className="setMembres">
            {journal.map((e) => {
              const [libelle, icone] = ACTIONS[e.action] || [e.action, "faCircleDot"];
              const ctx = contexte(e);
              return (
                <div className="setMembre" key={e.id}>
                  <span className="setAvatar setAvatarJournal">
                    <Icon fafa={icone} width={11} />
                  </span>
                  <div className="setMembreInfo">
                    <div className="setMembreNom">
                      <strong>{e.userName}</strong> {libelle}
                      {e.cible ? <em> {e.cible}</em> : null}
                    </div>
                    <div className="setMembreMail">
                      {horodatage(e.createdAt)}
                      {ctx ? ` · ${ctx}` : ""}
                      {e.ip ? ` · ${e.ip}` : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {journal.length && !journalFini ? (
          <div
            className="setBtn setBtnGhost"
            onClick={() => chargerJournal({ suite: true })}
          >
            Charger les entrées plus anciennes
          </div>
        ) : null}

        <p className="setHint mt-3">
          Le journal ne peut être ni modifié ni effacé, y compris
          par le propriétaire de l'espace.
        </p>
      </>
    )}
  </section>
);

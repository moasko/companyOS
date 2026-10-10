import React from "react";
import { Icon } from "../../../../utils/general";
import { FileThumb } from "../assets/FileThumb";
import { contenuDossier, emplacementDe, tailleLisible, typeLisible } from "../../../../apps/explorateur";

// Volet de détails, à droite : ce qu'on sait de la sélection sans avoir à
// l'ouvrir — aperçu, type, poids, dates, emplacement, partages, versions.

const Ligne = ({ libelle, children }) =>
  children || children === 0 ? (
    <div className="expPDLigne">
      <dt>{libelle}</dt>
      <dd>{children}</dd>
    </div>
  ) : null;

const dateComplete = (iso) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "";

const resumeContenu = ({ fichiers, dossiers }) => {
  const bouts = [];
  if (dossiers) bouts.push(`${dossiers} dossier${dossiers > 1 ? "s" : ""}`);
  if (fichiers) bouts.push(`${fichiers} fichier${fichiers > 1 ? "s" : ""}`);
  return bouts.join(", ") || "vide";
};

export const PanneauDetails = ({ selection, lieuNom, nbElements, index, actions, fermer }) => {
  const seul = selection.length === 1 ? selection[0] : null;
  const contenu = seul?.type === "FOLDER" ? contenuDossier(index, seul.id) : null;
  const octetsSelection = selection.reduce(
    (t, n) => t + (n.type === "FOLDER" ? contenuDossier(index, n.id).octets : Number(n.size || 0)),
    0,
  );

  return (
    <aside className="expPanneau cosScroll" aria-label="Détails">
      <button type="button" className="expPDFermer" aria-label="Fermer le volet de détails" onClick={fermer}>
        <Icon fafa="faXmark" width={11} />
      </button>
      {seul ? (
        <>
          <div className="expPDApercu">
            <FileThumb node={seul} />
          </div>
          <h3 className="expPDNom">{seul.name}</h3>
          <div className="expPDType">{typeLisible(seul)}</div>
          <div className="expPDActions">
            <button type="button" onClick={() => actions.ouvrir(seul)}>
              <Icon fafa={seul.type === "FOLDER" ? "faFolderOpen" : "faArrowUpRightFromSquare"} width={11} />
              Ouvrir
            </button>
            <button type="button" onClick={() => actions.telecharger([seul])}>
              <Icon fafa="faDownload" width={11} />
              Télécharger
            </button>
            {seul.type === "FILE" ? (
              <button type="button" onClick={() => actions.partager(seul)}>
                <Icon fafa="faLink" width={11} />
                Partager
              </button>
            ) : null}
          </div>
          <dl className="expPDListe">
            <Ligne libelle="Taille">{seul.type === "FILE" ? tailleLisible(seul.size) : tailleLisible(contenu.octets)}</Ligne>
            {contenu ? <Ligne libelle="Contenu">{resumeContenu(contenu)}</Ligne> : null}
            <Ligne libelle="Emplacement">{emplacementDe(index, seul)}</Ligne>
            <Ligne libelle="Modifié">{dateComplete(seul.updatedAt)}</Ligne>
            <Ligne libelle="Créé">{dateComplete(seul.createdAt)}</Ligne>
            {seul.type === "FILE" && seul.nbVersions != null ? (
              <Ligne libelle="Versions">
                <button type="button" className="expPDLien" onClick={() => actions.versions(seul)}>
                  {seul.nbVersions ? `${seul.nbVersions} précédente${seul.nbVersions > 1 ? "s" : ""}` : "aucune précédente"}
                </button>
              </Ligne>
            ) : null}
            {seul.type === "FILE" && seul.nbPartages != null ? (
              <Ligne libelle="Liens publics">
                <button type="button" className="expPDLien" onClick={() => actions.partager(seul)}>
                  {seul.nbPartages ? `${seul.nbPartages} actif${seul.nbPartages > 1 ? "s" : ""}` : "aucun"}
                </button>
              </Ligne>
            ) : null}
          </dl>
        </>
      ) : selection.length > 1 ? (
        <>
          <div className="expPDApercu expPDMulti">
            <Icon fafa="faLayerGroup" width={34} />
          </div>
          <h3 className="expPDNom">{selection.length} éléments sélectionnés</h3>
          <dl className="expPDListe">
            <Ligne libelle="Taille totale">{tailleLisible(octetsSelection)}</Ligne>
            <Ligne libelle="Contenu">
              {resumeContenu({
                dossiers: selection.filter((n) => n.type === "FOLDER").length,
                fichiers: selection.filter((n) => n.type === "FILE").length,
              })}
            </Ligne>
          </dl>
          <div className="expPDActions">
            <button type="button" onClick={() => actions.telecharger(selection)}>
              <Icon fafa="faFileZipper" width={11} />
              Télécharger (ZIP)
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="expPDApercu expPDMulti">
            <img src="img/icon/cos/fichiers/dossier.svg" alt="" width={64} height={64} draggable={false} />
          </div>
          <h3 className="expPDNom">{lieuNom}</h3>
          <div className="expPDType">
            {nbElements} élément{nbElements > 1 ? "s" : ""}
          </div>
          <p className="expPDAide">Sélectionnez un fichier ou un dossier pour en voir les détails.</p>
        </>
      )}
    </aside>
  );
};

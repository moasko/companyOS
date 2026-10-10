import React, { useState } from "react";
import { Icon } from "../../../../utils/general";
import { modal } from "../../../../apps/modalRequest";
import { RACINE, cheminDe, dansLaDescendance, dossiersDe } from "../../../../apps/explorateur";

// Boîtes de l'Explorateur : « Déplacer vers… / Copier vers… » et le choix
// à faire quand un fichier importé porte le nom d'un fichier existant.

const BrancheChoix = ({ index, parentId, niveau, choisi, setChoisi, deplie, basculer, interdit }) =>
  dossiersDe(index, parentId).map((d) => {
    const enfants = dossiersDe(index, d.id).length > 0;
    const ouvert = deplie.has(d.id);
    const bloque = interdit(d.id);
    return (
      <React.Fragment key={d.id}>
        <div
          className="expChoixLigne"
          data-choisi={choisi === d.id}
          data-off={bloque}
          style={{ paddingLeft: 8 + niveau * 16 }}
          onClick={() => !bloque && setChoisi(d.id)}
          onDoubleClick={() => enfants && basculer(d.id)}
        >
          <span
            className="expChev"
            data-vide={!enfants}
            onClick={(e) => {
              e.stopPropagation();
              if (enfants) basculer(d.id);
            }}
          >
            <Icon fafa={ouvert ? "faChevronDown" : "faChevronRight"} width={8} />
          </span>
          <img src="img/icon/cos/fichiers/dossier.svg" alt="" width={16} height={16} draggable={false} />
          <span className="expChoixNom">{d.name}</span>
        </div>
        {ouvert ? (
          <BrancheChoix
            index={index}
            parentId={d.id}
            niveau={niveau + 1}
            choisi={choisi}
            setChoisi={setChoisi}
            deplie={deplie}
            basculer={basculer}
            interdit={interdit}
          />
        ) : null}
      </React.Fragment>
    );
  });

const ChoixDossier = ({ index, depart, exclus, libelle, close }) => {
  const [choisi, setChoisi] = useState(depart ?? null);
  // Le chemin du dossier de départ est déplié d'office.
  const [deplie, setDeplie] = useState(() => new Set(cheminDe(index, depart).map((e) => e.id).filter(Boolean)));
  const basculer = (id) =>
    setDeplie((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // Un dossier ne va ni en lui-même ni dans sa propre descendance.
  const interdit = (id) => exclus.some((x) => dansLaDescendance(index, x, id));

  return (
    <div className="expChoix">
      <div className="expChoixArbre cosScroll">
        <div className="expChoixLigne" data-choisi={choisi === null} onClick={() => setChoisi(null)}>
          <span className="expChev" data-vide="true" />
          <Icon src="win/onedrive-sm" width={16} />
          <span className="expChoixNom">{RACINE.name}</span>
        </div>
        <BrancheChoix
          index={index}
          parentId={null}
          niveau={1}
          choisi={choisi}
          setChoisi={setChoisi}
          deplie={deplie}
          basculer={basculer}
          interdit={interdit}
        />
      </div>
      <div className="expChoixPied">
        <span className="expChoixOu">
          {cheminDe(index, choisi)
            .map((e) => e.name)
            .join(" › ")}
        </span>
        <button type="button" className="hstBouton" onClick={() => close(null)}>
          Annuler
        </button>
        <button type="button" className="hstBouton expPrincipal" onClick={() => close({ id: choisi })}>
          {libelle}
        </button>
      </div>
    </div>
  );
};

/// Rend `{ id }` (id `null` = racine du Cloud), ou `null` si annulé.
export const choisirDossier = ({ titre, libelle, index, depart = null, exclus = [] }) =>
  modal.open({
    title: titre,
    nu: true,
    render: ({ close }) => <ChoixDossier index={index} depart={depart} exclus={exclus} libelle={libelle} close={close} />,
  });

const ChoixConflit = ({ nom, dossier, restants, remplacable, close }) => {
  const [pourTous, setPourTous] = useState(false);
  const choisir = (choix) => close({ choix, pourTous });
  return (
    <div className="expConflit">
      <p>
        « <strong>{nom}</strong> » existe déjà dans « {dossier} ».
      </p>
      <div className="expConflitChoix">
        {remplacable ? (
          <button type="button" onClick={() => choisir("remplacer")}>
            <Icon fafa="faRightLeft" width={14} />
            <span>
              <strong>Remplacer</strong>
              <small>Le fichier existant devient une version précédente, récupérable.</small>
            </span>
          </button>
        ) : null}
        <button type="button" onClick={() => choisir("garder")}>
          <Icon fafa="faClone" width={14} />
          <span>
            <strong>Garder les deux</strong>
            <small>Le nouveau fichier est renommé, par exemple « {nom.replace(/(\.[^.]+)?$/, " (2)$1")} ».</small>
          </span>
        </button>
        <button type="button" onClick={() => choisir("ignorer")}>
          <Icon fafa="faForward" width={14} />
          <span>
            <strong>Ignorer ce fichier</strong>
            <small>Le fichier existant reste tel quel.</small>
          </span>
        </button>
      </div>
      {restants > 0 ? (
        <label className="expConflitTous">
          <input type="checkbox" checked={pourTous} onChange={(e) => setPourTous(e.target.checked)} />
          Faire de même pour les {restants} autre{restants > 1 ? "s" : ""} conflit{restants > 1 ? "s" : ""}
        </label>
      ) : null}
      <div className="expChoixPied">
        <button type="button" className="hstBouton" onClick={() => close(null)}>
          Arrêter l'import
        </button>
      </div>
    </div>
  );
};

/// Rend `{ choix: "remplacer" | "garder" | "ignorer", pourTous }`, ou
/// `null` si l'utilisateur arrête l'import.
export const demanderConflit = ({ nom, dossier, restants, remplacable = true }) =>
  modal.open({
    title: "Ce nom est déjà pris",
    nu: true,
    render: ({ close }) => (
      <ChoixConflit nom={nom} dossier={dossier} restants={restants} remplacable={remplacable} close={close} />
    ),
  });

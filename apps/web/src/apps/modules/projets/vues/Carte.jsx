// Rendu d'une carte du tableau.
//
// La carte ne décide de rien : elle affiche ce qu'on lui passe et remonte
// les gestes du glisser-déposer à `index.jsx`, qui tient l'état.

import React from "react";
import { Icon } from "../../../../utils/general";
import {
  avancementChecklist,
  etiquetteDe,
  formatEcheance,
  statutEcheance,
} from "../board";

/// Carte du tableau.
///
/// Défini au niveau du module, et surtout PAS à l'intérieur de
/// `ProjetsApp` : un composant déclaré dans le corps d'un autre est vu
/// comme un type neuf à chaque rendu, donc React démonte et remonte
/// toutes les cartes. Pendant un glisser — où l'état change à chaque
/// mouvement — le nœud tiré était détruit aussitôt et le navigateur
/// annulait le déplacement.
export const Carte = React.memo(function Carte({
  carte,
  index,
  colonneId,
  terminee,
  membre,
  client,
  glissee,
  initiales,
  onGlisserDebut,
  onGlisserFin,
  onSurvol,
  onDepot,
  onOuvrir,
}) {
  const d = carte.data;
  const av = avancementChecklist(d.checklist);
  const ech = statutEcheance(d.echeance, terminee);

  return (
    <div
      className="pjCarte"
      draggable
      data-glissee={glissee ? "true" : "false"}
      onDragStart={(e) => {
        // Sans `setData`, le navigateur n'initie tout simplement pas le
        // glisser : c'est ce qui donne l'impression que les cartes sont
        // collées. Le contenu importe peu, sa présence est obligatoire.
        e.dataTransfer.setData("text/plain", carte.id);
        e.dataTransfer.effectAllowed = "move";
        onGlisserDebut(carte, colonneId);
      }}
      onDragEnd={onGlisserFin}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const r = e.currentTarget.getBoundingClientRect();
        const apres = e.clientY > r.top + r.height / 2;
        onSurvol(colonneId, index + (apres ? 1 : 0));
      }}
      onDrop={(e) => {
        // La carte est elle-même une cible : déposer sur une carte doit
        // insérer à côté d'elle, pas retomber sur la colonne entière.
        e.preventDefault();
        e.stopPropagation();
        onDepot(colonneId, index);
      }}
      onClick={() => onOuvrir(carte)}
    >
      {(d.etiquettes || []).length ? (
        <div className="pjEtiquettes">
          {d.etiquettes.map((id) => {
            const e = etiquetteDe(id);
            return e ? (
              <span
                key={id}
                className="pjEtiquette"
                style={{ background: e.couleur }}
                title={e.nom}
              />
            ) : null;
          })}
        </div>
      ) : null}

      <div className="pjCarteTitre">{d.titre}</div>

      {client ? (
        <div className="pjCarteClient">
          <Icon fafa="faBuilding" width={9} />
          {client.data.entreprise || client.data.nom}
        </div>
      ) : null}

      <div className="pjCartePied">
        {d.echeance ? (
          <span className="pjEcheance" data-etat={ech}>
            <Icon fafa="faClock" width={9} />
            {formatEcheance(d.echeance)}
          </span>
        ) : null}
        {d.description ? (
          <span className="pjIndice" title="Cette carte a une description">
            <Icon fafa="faAlignLeft" width={9} />
          </span>
        ) : null}
        {av ? (
          <span
            className="pjIndice"
            data-complet={av.complet ? "true" : "false"}
          >
            <Icon fafa="faSquareCheck" width={9} />
            {av.faits}/{av.total}
          </span>
        ) : null}
        {(d.commentaires || []).length ? (
          <span className="pjIndice">
            <Icon fafa="faComment" width={9} />
            {d.commentaires.length}
          </span>
        ) : null}
        {(d.pieces || []).length ? (
          <span className="pjIndice">
            <Icon fafa="faPaperclip" width={9} />
            {d.pieces.length}
          </span>
        ) : null}
        {membre ? (
          <span className="pjAvatar" title={membre.name}>
            {initiales(membre.name)}
          </span>
        ) : null}
      </div>
    </div>
  );
});

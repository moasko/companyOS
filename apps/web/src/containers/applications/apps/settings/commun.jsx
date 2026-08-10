import React, { useEffect, useState } from "react";
import { Icon } from "../../../../utils/general";
import { chargerApercu } from "../assets/FileThumb";

// Briques partagées par plusieurs rubriques des Paramètres : les contrôles
// répétés d'un écran à l'autre et les tables de libellés qu'ils affichent.

export const VERSION = "0.1.0";

export const formatBytes = (bytes) => {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
};

/// Rôles, tels qu'on les nomme à l'écran. Ce ne sont pas des libellés
/// décoratifs : le serveur applique exactement cette hiérarchie — voir
/// `exigerRole` dans server/src/auth.js.
///
///   Propriétaire   — tout, y compris renommer l'espace et céder les clés
///   Administrateur — gère les membres et les applications installées
///   Membre         — utilise les applications installées
export const ROLES = { OWNER: "Propriétaire", ADMIN: "Administrateur", MEMBER: "Membre" };
export const PLANS = { FREE: "Gratuit", PRO: "Pro", ENTERPRISE: "Entreprise" };

/// Vignette d'un fond d'écran importé.
///
/// Défini au niveau du module, et non dans le composant des Paramètres :
/// déclaré à l'intérieur, React en ferait un type nouveau à chaque rendu,
/// démonterait la vignette et relancerait le téléchargement de l'image à
/// chaque frappe ailleurs dans la page.
export const ApercuFond = ({ node, actif, onChoisir, onSupprimer }) => {
  const [url, setUrl] = useState(null);
  const [echec, setEchec] = useState(false);

  useEffect(() => {
    let vivant = true;
    chargerApercu(node).then((u) => {
      if (!vivant) return;
      if (u) setUrl(u);
      else setEchec(true);
    });
    return () => {
      vivant = false;
    };
  }, [node.id]);

  return (
    <div className="setWallCase" data-actif={actif}>
      {url ? (
        <img
          className="setWall"
          data-actif={actif}
          src={url}
          alt={node.name}
          title={node.name}
          onClick={onChoisir}
        />
      ) : (
        // Un cadre de la même taille pendant le chargement : sans lui, la
        // grille se réorganise sous les yeux à mesure que les images
        // arrivent, et on clique sur autre chose que ce qu'on visait.
        <div className="setWall setWallVide" onClick={echec ? undefined : onChoisir}>
          <Icon fafa={echec ? "faTriangleExclamation" : "faImage"} width={16} />
        </div>
      )}
      <div className="setWallPied">
        <span className="setWallNom" title={node.name}>
          {node.name}
        </span>
        {actif ? <span className="setWallActif">Actif</span> : null}
      </div>
      <span
        className="setWallSuppr handcr"
        title="Supprimer ce fond"
        onClick={onSupprimer}
      >
        <Icon fafa="faXmark" width={9} />
      </span>
    </div>
  );
};

/// Interrupteur réutilisé partout dans la page.
export const Toggle = ({ on, onClick }) => (
  <div className="setToggle handcr" data-on={on} onClick={onClick}>
    <span />
  </div>
);

/// Ligne de réglage : libellé, explication, contrôle à droite.
export const Row = ({ title, desc, children }) => (
  <div className="setRow">
    <div className="setRowText">
      <div className="setRowTitle">{title}</div>
      {desc ? <div className="setRowDesc">{desc}</div> : null}
    </div>
    <div className="setRowCtrl">{children}</div>
  </div>
);

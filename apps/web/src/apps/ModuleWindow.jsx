import React from "react";
import { useSelector } from "react-redux";
import { ToolBar } from "../utils/general";
import { useNomApp } from "../utils/nomsApps";

/// Chrome de fenêtre commun à tous les modules CompanyOS.
/// Un module n'a qu'à écrire son contenu :
///
///   <ModuleWindow manifest={manifest} className="monApp">
///     ...contenu...
///   </ModuleWindow>
///
/// La fenêtre (déplacement, réduire/agrandir/fermer, z-index) est gérée ici.
export const ModuleWindow = ({ manifest, className = "", children }) => {
  // L'état de fenêtre est indexé par l'identifiant de l'application, pas
  // par son icône : deux apps peuvent partager la même image.
  const wnapp = useSelector((state) => state.apps[manifest.id || manifest.icon]);
  // Le titre suit la langue de l'OS ; le nom du manifeste reste l'identité.
  const nomApp = useNomApp();

  // Module non installé : l'état n'existe pas, la fenêtre non plus.
  //
  // Le montage à la demande, lui, se décide plus haut : voir `AppMontee`
  // dans src/App.jsx. Ici il serait sans effet — le composant du module
  // englobe cette fenêtre, ses effets tournent donc avant d'arriver ici.
  if (!wnapp) return null;

  return (
    <div
      className={`${className} moduleWin floatTab dpShad`}
      data-size={wnapp.size}
      data-max={wnapp.max}
      style={{
        ...(wnapp.size == "cstm" ? wnapp.dim : null),
        zIndex: wnapp.z,
      }}
      data-hide={wnapp.hide}
      id={wnapp.icon + "App"}
    >
      <ToolBar
        app={wnapp.action}
        icon={wnapp.icon}
        size={wnapp.size}
        name={nomApp(manifest)}
      />
      <div className="windowScreen flex flex-col" data-dock="true">
        <div className="restWindow flex-grow flex flex-col">{children}</div>
      </div>
    </div>
  );
};

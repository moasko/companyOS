// L'éditeur de présentations, isolé dans son propre morceau de paquet.
//
// `pptx-react-viewer` embarque le moteur OOXML de PowerPoint : rendu des
// 16 types d'éléments, graphiques, animations, transitions, mode
// présentateur. Comme l'éditeur `.docx` et three.js, il n'a rien à faire
// dans le paquet principal — ce fichier est chargé par `React.lazy`, et
// Vite en fait un morceau qui ne se télécharge qu'à la première ouverture
// d'une présentation.

import React, { forwardRef } from "react";
import { PowerPointViewer } from "pptx-react-viewer";
import { translationsEn } from "pptx-react-viewer/i18n";
import i18n from "../../../i18nextConf";
import { traductionsFr } from "./fr";
import "pptx-react-viewer/styles";

// Le moteur ne crée pas d'instance i18next : il appelle `useTranslation()`
// et lit donc celle de l'OS. Sans catalogue, toute son interface s'affiche
// en clés brutes — « pptx.titleBar.autoSave » au lieu d'un libellé.
//
// Un bundle par langue résolue (voir src/utils/langue.js) :
//
//   - « en » : l'anglais complet livré par la bibliothèque ;
//   - « fr » : ce même anglais comme filet, puis nos chaînes françaises
//     par-dessus.
//
// Le repli français est donc **par clé** : une entrée que nous n'avons pas
// traduite prend sa version anglaise au lieu de disparaître. Voir fr.js
// pour ce qui est couvert et pourquoi.
//
// L'enregistrement se fait ici, dans le morceau chargé à la demande : ces
// milliers d'entrées n'ont pas à peser au démarrage de l'OS.
//
// `false, true` = ne pas fusionner en profondeur, mais écraser : les clés
// sont plates et pointées, la fusion profonde les découperait en arbre.
i18n.addResourceBundle("en", "translation", translationsEn, false, true);
i18n.addResourceBundle("fr", "translation", translationsEn, false, true);
i18n.addResourceBundle("fr", "translation", traductionsFr, false, true);

/// Boutons masqués. `share` et `broadcast` supposent un serveur de
/// collaboration Yjs et un canal de diffusion que CompanyOS n'a pas :
/// les laisser afficherait des commandes qui échouent. `record` demande
/// un accès micro/caméra qui n'a pas sa place dans une première version.
///
/// La liste est courte à dessein : tout le reste — insertion, dessin,
/// transitions, animations, mode présentation, export — fonctionne.
const MASQUES = ["share", "broadcast", "record"];

const Editeur = forwardRef(function Editeur(
  { octets, nom, sombre, auteur, surOuverture, surModification },
  ref,
) {
  return (
    // Le conteneur est le point d'ancrage stable de la feuille de style :
    // le moteur habille tout son intérieur avec des classes utilitaires
    // générées, sur lesquelles on ne peut rien parier.
    <div className="pptMoteur">
      <PowerPointViewer
        ref={ref}
        content={octets}
        fileName={nom}
        // Lecture *et* création : c'est la même surface, l'édition n'est
        // qu'un interrupteur. Sans elle, l'app ne serait qu'une visionneuse.
        canEdit
        authorName={auteur}
        defaultLocale="fr"
        defaultThemeKey={sombre ? "vermilionDark" : "vermilionLight"}
        hiddenActions={MASQUES}
        // Fichier → Ouvrir passe par le cloud de l'espace, jamais par le
        // disque de la machine. Il n'y a pas de crochet équivalent pour
        // « Enregistrer » : c'est la barre de CompanyOS qui s'en charge, en
        // lisant les octets par `ref.getContent()` — voir index.jsx.
        onOpenFile={surOuverture}
        onDirtyChange={surModification}
      />
    </div>
  );
});

export default Editeur;

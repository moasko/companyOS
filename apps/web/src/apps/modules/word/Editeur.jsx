// L'éditeur `.docx`, composé pièce par pièce.
//
// La bibliothèque livre un hôte tout-en-un (`<DocxEditor>`) avec sa propre
// barre de titre, son logo et son cadre — une application dans
// l'application. Ici on ne prend que les pièces : menus, barre d'outils,
// surface de pages. La fenêtre, le titre du document et l'état
// d'enregistrement appartiennent à CompanyOS, qui les affiche à sa façon
// (voir index.jsx) — l'éditeur s'incruste, il ne s'installe pas.
//
// Ce fichier reste chargé par `React.lazy` : le moteur OOXML et sa mise en
// forme WebAssembly ne se téléchargent qu'à la première ouverture d'un
// document.

import React, { forwardRef, useImperativeHandle, useRef } from "react";
import {
  DocxEditorContent,
  DocxEditorContextMenu,
  DocxEditorHyperLink,
  DocxEditorMenu,
  DocxEditorNavigation,
  DocxEditorRoot,
  DocxEditorToolbar,
  DocxEditorViewport,
  LocaleProvider,
} from "@docx-editor.dev/react";
import { fr } from "@docx-editor.dev/i18n";
import "@docx-editor.dev/core/styles/editor.css";

const Editeur = forwardRef(function Editeur(
  { octets, sombre, surSauvegarde, surOuverture, surModification },
  ref,
) {
  // L'instance d'éditeur arrive par `onReady` : `Root` ne rend aucun DOM
  // et n'expose pas de ref. C'est elle qui sait sérialiser le document.
  const editeur = useRef(null);

  useImperativeHandle(ref, () => ({
    save: () => editeur.current?.save() ?? Promise.resolve(null),
    focus: () => editeur.current?.focus?.(),
  }));

  return (
    // Le chrome parle la langue du catalogue fourni ici.
    <LocaleProvider i18n={fr}>
      {/* `docx-editor` porte les jetons de style de la bibliothèque, et
          `dark` sa déclinaison sombre — on suit le thème de l'OS. Le thème
          n'habille que l'écran : le fichier reste noir sur blanc. */}
      <div className={`wdEditeur docx-editor${sombre ? " dark" : ""}`}>
        <DocxEditorRoot
          document={octets}
          mode="edit"
          locale="fr"
          onReady={(instance) => {
            editeur.current = instance;
          }}
          onChange={surModification}
        >
          {/* Fichier → Enregistrer / Ouvrir passent par CompanyOS : le
              document vit dans le cloud de l'espace, pas sur la machine. */}
          <DocxEditorMenu onSave={surSauvegarde} onOpen={surOuverture} />
          <DocxEditorToolbar onSave={surSauvegarde} />
          <DocxEditorViewport>
            <DocxEditorNavigation />
            <DocxEditorContent />
            <DocxEditorHyperLink />
            <DocxEditorContextMenu />
          </DocxEditorViewport>
        </DocxEditorRoot>
      </div>
    </LocaleProvider>
  );
});

export default Editeur;

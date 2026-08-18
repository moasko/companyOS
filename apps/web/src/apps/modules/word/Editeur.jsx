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

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  DocxEditorContent,
  DocxEditorContextMenu,
  DocxEditorHyperLink,
  DocxEditorNavigation,
  DocxEditorRoot,
  DocxEditorToolbar,
  DocxEditorViewport,
  ImageInsertProvider,
  LocaleProvider,
  useEditorEvent,
  useEditorCommand,
  useEditorState,
} from "@docx-editor.dev/react";
import { fr } from "@docx-editor.dev/i18n";
import "@docx-editor.dev/core/styles/editor.css";

function Surveillance({ surErreur }) {
  useEditorEvent("error", (erreur) => {
    const message = erreur?.message || erreur?.detail || String(erreur || "Erreur inconnue");
    surErreur?.(message);
  });
  return null;
}

// Le moteur rend le cadre de sélection dans un portail, à côté de la surface
// paginée. Ses coordonnées sont toutefois exprimées depuis cette surface. On
// aligne donc l'origine du portail sur la page réelle (qui est centrée dans le
// viewport), puis on le resynchronise lorsque le document ou le zoom change.
function SynchronisationOverlayImage({ hote }) {
  useEffect(() => {
    const racine = hote.current;
    if (!racine) return undefined;

    let observateurTaille;
    let surfaceObservee;
    let animation;

    const aligner = () => {
      animation = undefined;
      const montage = racine.querySelector(".docx-content-mount");
      const surface = racine.querySelector(".docx-paginated-surface");
      const overlay = racine.querySelector(".docx-image-selection-overlay");
      if (!montage || !surface || !overlay) return;

      const cadreMontage = montage.getBoundingClientRect();
      const cadreSurface = surface.getBoundingClientRect();
      overlay.style.left = `${cadreSurface.left - cadreMontage.left}px`;
      overlay.style.top = `${cadreSurface.top - cadreMontage.top}px`;
      overlay.style.width = `${cadreSurface.width}px`;
      overlay.style.height = `${cadreSurface.height}px`;

      if (surfaceObservee !== surface) {
        if (surfaceObservee) observateurTaille?.unobserve(surfaceObservee);
        surfaceObservee = surface;
        observateurTaille?.observe(surface);
      }
    };

    const programmer = () => {
      if (animation === undefined) animation = requestAnimationFrame(aligner);
    };
    const mutations = new MutationObserver(programmer);
    mutations.observe(racine, { childList: true, subtree: true });
    observateurTaille = new ResizeObserver(programmer);
    observateurTaille.observe(racine);
    window.addEventListener("resize", programmer);
    programmer();

    return () => {
      mutations.disconnect();
      observateurTaille.disconnect();
      window.removeEventListener("resize", programmer);
      if (animation !== undefined) cancelAnimationFrame(animation);
    };
  }, [hote]);

  return null;
}

function BoutonImage({ commande, symbole, libelle }) {
  const action = useEditorCommand(commande);
  return (
    <button
      type="button"
      className="docx-toolbar__button wdCommandeImage"
      disabled={!action.isEnabled}
      title={action.disabledReason || libelle}
      aria-label={libelle}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action.execute}
    >
      <span aria-hidden="true">{symbole}</span>
      <small>{libelle}</small>
    </button>
  );
}

function Ruban({ surSauvegarde }) {
  const imageSelectionnee = useEditorState((etat) => Boolean(etat.image));
  const [onglet, setOnglet] = useState("accueil");

  useEffect(() => {
    if (imageSelectionnee) setOnglet("image");
    else if (onglet === "image") setOnglet("accueil");
  }, [imageSelectionnee, onglet]);

  return (
    <>
      <div className="wdRubanOnglets" role="tablist" aria-label="Ruban du document">
        <button type="button" role="tab" aria-selected={onglet === "accueil"} onClick={() => setOnglet("accueil")}>Accueil</button>
        <button type="button" role="tab" aria-selected={onglet === "insertion"} onClick={() => setOnglet("insertion")}>Insertion</button>
        {imageSelectionnee ? (
          <button className="wdOngletContextuel" type="button" role="tab" aria-selected={onglet === "image"} onClick={() => setOnglet("image")}>Image</button>
        ) : null}
      </div>

      {onglet === "accueil" ? (
        <DocxEditorToolbar onSave={surSauvegarde} overflow={false} />
      ) : onglet === "image" && imageSelectionnee ? (
        <DocxEditorToolbar preset={false} className="wdRubanImage">
          <div className="wdInsertionGroupe" data-groupe="Image">
            <DocxEditorToolbar.ImageInsert />
            <DocxEditorToolbar.ImageProperties />
          </div>
          <div className="wdInsertionGroupe" data-groupe="Disposition">
            <DocxEditorToolbar.ImageWrap />
          </div>
          <div className="wdInsertionGroupe" data-groupe="Transformer">
            <BoutonImage commande={{ type: "transformImage", action: "rotateCCW" }} symbole="↶" libelle="Gauche" />
            <BoutonImage commande={{ type: "transformImage", action: "rotateCW" }} symbole="↷" libelle="Droite" />
            <BoutonImage commande={{ type: "transformImage", action: "flipH" }} symbole="↔" libelle="Miroir" />
            <BoutonImage commande={{ type: "deleteImage" }} symbole="×" libelle="Supprimer" />
          </div>
        </DocxEditorToolbar>
      ) : (
        <DocxEditorToolbar preset={false} className="wdRubanInsertion">
          <div className="wdInsertionGroupe" data-groupe="Pages">
            <DocxEditorToolbar.Button slot="insert.pageBreak" />
            <DocxEditorToolbar.Button slot="insert.sectionBreakNextPage" />
            <DocxEditorToolbar.Button slot="insert.sectionBreakContinuous" />
          </div>
          <div className="wdInsertionGroupe" data-groupe="Tableaux"><DocxEditorToolbar.TableInsert /></div>
          <div className="wdInsertionGroupe" data-groupe="Illustrations"><DocxEditorToolbar.ImageInsert /></div>
          <div className="wdInsertionGroupe" data-groupe="Liens"><DocxEditorToolbar.Link /></div>
          <div className="wdInsertionGroupe" data-groupe="Références">
            <DocxEditorToolbar.Button slot="insert.toc" />
            <DocxEditorToolbar.Button slot="insert.footnote" />
            <DocxEditorToolbar.Button slot="insert.endnote" />
          </div>
          <div className="wdInsertionGroupe" data-groupe="En-tête et pied">
            <DocxEditorToolbar.Button slot="insert.pageNumber" />
            <DocxEditorToolbar.Button slot="insert.totalPages" />
            <DocxEditorToolbar.Button slot="insert.pageXofY" />
          </div>
          <div className="wdInsertionGroupe" data-groupe="Révision"><DocxEditorToolbar.Comments /></div>
        </DocxEditorToolbar>
      )}
    </>
  );
}

const Editeur = forwardRef(function Editeur(
  { octets, sombre, surSauvegarde, surModification, surErreur },
  ref,
) {
  // L'instance d'éditeur arrive par `onReady` : `Root` ne rend aucun DOM
    // et n'expose pas de ref. C'est elle qui sait sérialiser le document.
  const editeur = useRef(null);
  const hote = useRef(null);

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
      <div ref={hote} className={`wdEditeur docx-editor${sombre ? " dark" : ""}`}>
        <DocxEditorRoot
          document={octets}
          mode="edit"
          locale="fr"
          onReady={(instance) => {
            editeur.current = instance;
          }}
          onChange={surModification}
          onFontError={(erreur) => surErreur?.(erreur?.message || "Police du document indisponible")}
        >
          <Surveillance surErreur={surErreur} />
          <SynchronisationOverlayImage hote={hote} />
          {/* Le fournisseur partage un unique sélecteur de fichiers entre
              Insertion → Image et le bouton du ruban. Sans lui, la commande
              est visible mais ne peut matériellement ouvrir aucun fichier. */}
          <ImageInsertProvider>
            <Ruban surSauvegarde={surSauvegarde} />
            <DocxEditorViewport>
              <DocxEditorNavigation />
              <DocxEditorContent />
              <DocxEditorHyperLink />
              <DocxEditorContextMenu />
            </DocxEditorViewport>
          </ImageInsertProvider>
        </DocxEditorRoot>
      </div>
    </LocaleProvider>
  );
});

export default Editeur;

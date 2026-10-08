// L'éditeur `.docx`, composé pièce par pièce.
//
// La bibliothèque livre un hôte tout-en-un (`<DocxEditor>`) avec sa propre
// barre de titre, son logo et son cadre — une application dans
// l'application. Ici on ne prend que les pièces : barre d'outils, surface
// de pages, menus contextuels. Le chrome autour — en-tête, menu Fichier,
// onglets, barre d'état — appartient à CompanyOS.
//
// ─────────────────────────────────────────────────────────────────────────
// LA DISPOSITION : CELLE DE WORD
//
// Tout ce qui n'est pas la page lui vole de la hauteur. D'où :
//
//   - **une seule ligne d'en-tête** : menu Fichier, onglets, titre du
//     document et son état, bouton Enregistrer. Ouvrir, Télécharger et la
//     liste des documents vivent dans le menu Fichier, où Word les range ;
//   - **un ruban d'une ligne**, sans libellés de groupe : ce qui ne tient
//     pas passe dans le menu « ⋯ » de la bibliothèque au lieu d'ajouter une
//     deuxième ligne ;
//   - **une barre d'état** en bas : la page courante à gauche, le zoom à
//     droite — sa place dans Word, plutôt qu'au milieu du ruban ;
//   - **une feuille blanche**, quel que soit le thème. Le thème sombre
//     habille l'interface, pas le document : ce qu'on écrit doit ressembler
//     à ce qu'on imprimera.
// ─────────────────────────────────────────────────────────────────────────
//
// Ce fichier reste chargé par `React.lazy` : le moteur OOXML et sa mise en
// forme WebAssembly ne se téléchargent qu'à la première ouverture d'un
// document.

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
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
  useDocxEditor,
  useEditorCommand,
  useEditorEvent,
  useEditorState,
} from "@docx-editor.dev/react";
import { fr } from "@docx-editor.dev/i18n";
import "@docx-editor.dev/core/styles/editor.css";
import { Icon } from "../../../utils/general";

const T = DocxEditorToolbar;

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

function BoutonImage({ commande, icone, libelle }) {
  const action = useEditorCommand(commande);
  return (
    <button
      type="button"
      className="docx-toolbar__button"
      disabled={!action.isEnabled}
      title={action.disabledReason || libelle}
      aria-label={libelle}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action.execute}
    >
      <Icon fafa={icone} width={13} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Menu Fichier
// ---------------------------------------------------------------------------

/// Le menu Fichier : tout ce qui concerne le document en tant que fichier.
/// Une liste déroulante plutôt qu'un écran plein — on revient au texte
/// d'un clic ou d'Échap.
function MenuFichier({ actions }) {
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef(null);

  useEffect(() => {
    if (!ouvert) return undefined;
    const fermer = (e) => {
      if (e.type === "keydown" ? e.key === "Escape" : !racine.current?.contains(e.target)) {
        setOuvert(false);
      }
    };
    document.addEventListener("mousedown", fermer);
    document.addEventListener("keydown", fermer);
    return () => {
      document.removeEventListener("mousedown", fermer);
      document.removeEventListener("keydown", fermer);
    };
  }, [ouvert]);

  const choisir = (fn) => () => {
    setOuvert(false);
    fn?.();
  };

  const ENTREES = [
    { icone: "faFileCirclePlus", libelle: "Nouveau document", action: actions.nouveau },
    { icone: "faFolderOpen", libelle: "Ouvrir un fichier .docx…", action: actions.ouvrir },
    { icone: "faFolder", libelle: "Documents de l'espace", action: actions.documents },
    null,
    {
      icone: "faFloppyDisk",
      libelle: "Enregistrer",
      raccourci: "Ctrl+S",
      action: actions.enregistrer,
    },
    { icone: "faDownload", libelle: "Télécharger une copie (.docx)", action: actions.telecharger },
    { icone: "faPrint", libelle: "Imprimer…", raccourci: "Ctrl+P", action: actions.imprimer },
  ];

  return (
    <div className="wdFichier" ref={racine}>
      <button
        type="button"
        className="wdOnglet wdOngletFichier"
        aria-haspopup="menu"
        aria-expanded={ouvert}
        onClick={() => setOuvert((v) => !v)}
      >
        Fichier
      </button>
      {ouvert ? (
        <div className="wdMenuFichier" role="menu">
          {ENTREES.map((e, i) =>
            e ? (
              <button key={e.libelle} type="button" role="menuitem" onClick={choisir(e.action)}>
                <Icon fafa={e.icone} width={13} />
                <span>{e.libelle}</span>
                {e.raccourci ? <kbd>{e.raccourci}</kbd> : null}
              </button>
            ) : (
              <hr key={`sep-${i}`} />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// En-tête et ruban
// ---------------------------------------------------------------------------

const ONGLETS = [
  { id: "accueil", libelle: "Accueil" },
  { id: "insertion", libelle: "Insertion" },
  { id: "revision", libelle: "Révision" },
];

function Chrome({ document: doc, actions }) {
  const imageSelectionnee = useEditorState((etat) => Boolean(etat.image));
  const [onglet, setOnglet] = useState("accueil");

  // L'onglet contextuel Image s'ouvre quand on clique une image, et se
  // referme avec elle — comme « Format de l'image » dans Word.
  useEffect(() => {
    if (imageSelectionnee) setOnglet("image");
    else setOnglet((o) => (o === "image" ? "accueil" : o));
  }, [imageSelectionnee]);

  return (
    <>
      <header className="wdEntete">
        <div className="wdOnglets" role="tablist" aria-label="Ruban du document">
          <MenuFichier actions={actions} />
          {ONGLETS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="tab"
              className="wdOnglet"
              aria-selected={onglet === o.id}
              onClick={() => setOnglet(o.id)}
            >
              {o.libelle}
            </button>
          ))}
          {imageSelectionnee ? (
            <button
              type="button"
              role="tab"
              className="wdOnglet wdOngletContextuel"
              aria-selected={onglet === "image"}
              onClick={() => setOnglet("image")}
            >
              Image
            </button>
          ) : null}
        </div>

        <div className="wdTitreZone">
          <input
            className="wdTitreDoc"
            value={doc.titre}
            // La largeur suit le nom : l'état d'enregistrement reste collé
            // au titre, comme dans Word, au lieu de flotter au loin.
            size={Math.min(40, Math.max(8, doc.titre.length + 1))}
            aria-label="Nom du document"
            title="Renommer le document"
            onChange={(e) => doc.setTitre(e.target.value)}
            onBlur={(e) => doc.surTitre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.target.blur();
            }}
          />
          <span className="wdEtatDoc" data-ton={doc.etat.ton} title={doc.etat.detail}>
            {doc.etat.texte}
          </span>
        </div>

        <div className="wdEnteteActions">
          <button
            type="button"
            className="wdBoutonEnregistrer"
            title="Enregistrer (Ctrl+S)"
            disabled={doc.enregistrement}
            onClick={actions.enregistrer}
          >
            <Icon fafa="faFloppyDisk" width={12} />
            <span>Enregistrer</span>
          </button>
        </div>
      </header>

      {onglet === "accueil" ? (
        <DocxEditorToolbar preset={false} className="wdRuban">
          <T.Undo />
          <T.Redo />
          <T.Separator />
          <T.StylePicker />
          <T.Separator />
          <T.FontFamily />
          <T.FontSize />
          <T.Separator />
          <T.Bold />
          <T.Italic />
          <T.Underline />
          <T.Strike />
          <T.Superscript />
          <T.Subscript />
          <T.FontColor />
          <T.Highlight />
          <T.Separator />
          <T.Alignment />
          <T.LineSpacing />
          <T.BulletList />
          <T.NumberedList />
          <T.Outdent />
          <T.Indent />
          <T.Separator />
          <T.Link />
          <T.ClearFormatting />
        </DocxEditorToolbar>
      ) : onglet === "insertion" ? (
        <DocxEditorToolbar preset={false} className="wdRuban wdRubanTexte">
          <T.TableInsert />
          <T.ImageInsert />
          <T.Link />
          <T.Separator />
          <T.Button slot="insert.pageBreak" />
          <T.Button slot="insert.sectionBreakNextPage" />
          <T.Button slot="insert.sectionBreakContinuous" />
          <T.Separator />
          <T.Button slot="insert.pageNumber" />
          <T.Button slot="insert.pageXofY" />
          <T.Button slot="insert.totalPages" />
          <T.Separator />
          <T.Button slot="insert.toc" />
          <T.Button slot="insert.footnote" />
          <T.Button slot="insert.endnote" />
        </DocxEditorToolbar>
      ) : onglet === "revision" ? (
        <DocxEditorToolbar preset={false} className="wdRuban wdRubanTexte">
          <T.Comments />
          <T.Separator />
          <T.EditingMode />
        </DocxEditorToolbar>
      ) : (
        <DocxEditorToolbar preset={false} className="wdRuban wdRubanTexte wdRubanImage">
          <T.ImageProperties />
          <T.ImageWrap />
          <T.ImageAltText />
          <T.Separator />
          <BoutonImage
            commande={{ type: "transformImage", action: "rotateCCW" }}
            icone="faRotateLeft"
            libelle="Faire pivoter à gauche"
          />
          <BoutonImage
            commande={{ type: "transformImage", action: "rotateCW" }}
            icone="faRotateRight"
            libelle="Faire pivoter à droite"
          />
          <BoutonImage
            commande={{ type: "transformImage", action: "flipH" }}
            icone="faLeftRight"
            libelle="Retourner horizontalement"
          />
          <T.Separator />
          <BoutonImage commande={{ type: "deleteImage" }} icone="faTrashCan" libelle="Supprimer l'image" />
        </DocxEditorToolbar>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Barre d'état
// ---------------------------------------------------------------------------

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const PAS = 0.1;

/// La barre d'état de Word : où l'on est dans le document, et à quelle
/// échelle on le regarde.
function BarreEtat() {
  const editeur = useDocxEditor();
  const page = useEditorState(
    (s) => s.page,
    (a, b) => a?.current === b?.current && a?.total === b?.total,
  );
  const zoom = useEditorState((s) => s.zoom) || 1;

  const regler = (valeur) => {
    const borne = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, valeur));
    editeur?.setZoom?.(Math.round(borne * 100) / 100);
  };

  return (
    <footer className="wdBarreEtat">
      <span>
        {page?.total ? `Page ${page.current || 1} sur ${page.total}` : "Page 1 sur 1"}
      </span>
      <span className="wdBarreEtatEspace" />
      <div className="wdZoom">
        <button type="button" title="Zoom arrière" onClick={() => regler(zoom - PAS)}>
          <Icon fafa="faMinus" width={9} />
        </button>
        <input
          type="range"
          min={ZOOM_MIN * 100}
          max={ZOOM_MAX * 100}
          step={5}
          value={Math.round(zoom * 100)}
          aria-label="Zoom"
          onChange={(e) => regler(Number(e.target.value) / 100)}
        />
        <button type="button" title="Zoom avant" onClick={() => regler(zoom + PAS)}>
          <Icon fafa="faPlus" width={9} />
        </button>
        <button
          type="button"
          className="wdZoomValeur"
          title="Revenir à 100 %"
          onClick={() => regler(1)}
        >
          {Math.round(zoom * 100)} %
        </button>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// L'éditeur
// ---------------------------------------------------------------------------

const Editeur = forwardRef(function Editeur(
  { octets, sombre, document: doc, actions, surModification, surErreur },
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
          `dark` sa déclinaison sombre — on suit le thème de l'OS pour
          l'interface. La feuille, elle, reste blanche (voir word.scss). */}
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
            <Chrome document={doc} actions={actions} />
            <DocxEditorViewport>
              <DocxEditorNavigation />
              <DocxEditorContent />
              <DocxEditorHyperLink />
              <DocxEditorContextMenu />
            </DocxEditorViewport>
            <BarreEtat />
          </ImageInsertProvider>
        </DocxEditorRoot>
      </div>
    </LocaleProvider>
  );
});

export default Editeur;

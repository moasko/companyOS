// Le diaporama de départ.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI CE FICHIER EXISTE
//
// `buildBlankPresentationArchive()` ne produit pas un diaporama vierge : il
// produit un **squelette** — thème, masque, onze dispositions, relations —
// avec zéro diapositive. L'éditeur en affiche pourtant une, si bien que
// tout paraît normal ; mais enregistrer aussitôt écrit un fichier sans
// aucune diapositive, que rouvrir affiche « No slides ». Un cul-de-sac
// silencieux : l'utilisateur croit avoir un document, il a une coquille.
//
// On assemble donc nous-mêmes le point de départ : le squelette, plus une
// vraie première diapositive de titre. `handler.save()` attend le tableau
// des diapositives — c'est lui qui écrit `ppt/slides/slide1.xml` et les
// relations qui vont avec.
// ─────────────────────────────────────────────────────────────────────────

export const MIME_PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/// Un diaporama neuf : une diapositive de titre, prête à être remplie.
///
/// Le moteur n'est chargé qu'ici, dynamiquement : il ne sert qu'à la
/// création et n'a pas à peser sur le démarrage de l'OS.
export const diaporamaVierge = async () => {
  const { PresentationBuilder } = await import("pptx-viewer-core");
  const { handler, createSlide } = await PresentationBuilder.create();

  // La disposition « Title Slide » est celle que PowerPoint ouvre en
  // premier : deux réserves, titre et sous-titre.
  const diapo = createSlide("Title Slide");
  diapo.addText("Cliquez pour ajouter un titre", {
    x: 60,
    y: 250,
    width: 1160,
    height: 120,
  });
  diapo.addText("Cliquez pour ajouter un sous-titre", {
    x: 60,
    y: 390,
    width: 1160,
    height: 70,
  });

  return new Uint8Array(await handler.save([diapo.build()]));
};

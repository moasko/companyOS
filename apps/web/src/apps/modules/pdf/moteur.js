// Moteur de rendu PDF, isolé du composant.
//
// pdf.js (`pdfjs-dist`) est la bibliothèque de Mozilla, celle qui fait
// tourner le lecteur intégré de Firefox. On l'utilise en mode « document »
// plutôt qu'avec sa visionneuse toute faite : le rendu se fait dans nos
// propres canvas, et l'habillage reste celui de CompanyOS.
//
// Elle sait demander le fichier **par plages d'octets**. Combinée au point
// de diffusion ajouté côté serveur (voir server/src/routes/files.js), la
// première page s'affiche sans attendre le téléchargement complet — ce qui
// compte pour un contrat de deux cents pages.

import * as pdfjs from "pdfjs-dist";
import travailleurUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Le décodage tourne dans un worker : sans cela, une page lourde fige
// l'interface de tout l'OS le temps du rendu.
pdfjs.GlobalWorkerOptions.workerSrc = travailleurUrl;

/// Ouvre un document. `url` doit accepter les requêtes par plages ; sinon
/// pdf.js retombe tout seul sur un téléchargement complet.
export const ouvrirDocument = (url) =>
  pdfjs.getDocument({
    url,
    // Sans cela, pdf.js réclame des polices et des images de secours à un
    // CDN externe — inacceptable dans un OS qui doit tourner sur un réseau
    // fermé. On préfère un rendu dégradé à une dépendance réseau cachée.
    disableFontFace: false,
    isEvalSupported: false,
  }).promise;

/// Dessine une page dans un canvas, à l'échelle demandée.
///
/// `onTache` reçoit la tâche de rendu **dès sa création**, avant toute
/// attente : c'est ce qui permet à l'appelant de l'annuler si un second
/// rendu démarre entre-temps. pdf.js refuse deux rendus simultanés sur la
/// même toile, et cela arrive dès qu'on tourne les pages vite — ou
/// simplement en développement, où React invoque les effets deux fois.
///
/// Renvoie les dimensions obtenues, ou null si le rendu a été annulé.
export const dessinerPage = async (
  doc,
  numero,
  canvas,
  echelle,
  rotation = 0,
  onTache,
) => {
  const page = await doc.getPage(numero);
  const vue = page.getViewport({ scale: echelle, rotation });

  // Le canvas est dimensionné en pixels réels de l'écran : sur un écran à
  // forte densité, s'en tenir aux pixels CSS donne un texte flou.
  const densite = window.devicePixelRatio || 1;
  canvas.width = Math.floor(vue.width * densite);
  canvas.height = Math.floor(vue.height * densite);
  canvas.style.width = `${Math.floor(vue.width)}px`;
  canvas.style.height = `${Math.floor(vue.height)}px`;

  const tache = page.render({
    canvasContext: canvas.getContext("2d"),
    viewport: vue,
    transform: densite !== 1 ? [densite, 0, 0, densite, 0, 0] : null,
  });
  onTache?.(tache);

  try {
    await tache.promise;
  } catch (err) {
    // « RenderingCancelledException » : l'utilisateur a tourné la page
    // avant la fin du rendu. Ce n'est pas une erreur.
    if (err?.name === "RenderingCancelledException") return null;
    throw err;
  }

  return { largeur: vue.width, hauteur: vue.height, tache };
};

/// Échelle qui fait tenir la page dans la largeur ou dans la fenêtre.
export const echellePour = async (doc, numero, mode, cadre) => {
  const page = await doc.getPage(numero);
  const base = page.getViewport({ scale: 1 });
  const marge = 48;

  if (mode === "largeur") {
    return (cadre.largeur - marge) / base.width;
  }
  return Math.min(
    (cadre.largeur - marge) / base.width,
    (cadre.hauteur - marge) / base.height,
  );
};

/// Texte d'une page, pour la recherche.
export const texteDePage = async (doc, numero) => {
  const page = await doc.getPage(numero);
  const contenu = await page.getTextContent();
  return contenu.items.map((i) => i.str).join(" ");
};

/// Cherche un mot dans tout le document et renvoie les numéros de page.
/// Le balayage est séquentiel et peut être interrompu : sur un gros
/// document, on veut pouvoir changer d'avis sans attendre la fin.
export const chercherDansDocument = async (doc, requete, surAvancee) => {
  const q = requete.trim().toLowerCase();
  if (!q) return [];

  const trouvees = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const texte = (await texteDePage(doc, n)).toLowerCase();
    if (texte.includes(q)) trouvees.push(n);
    if (surAvancee && surAvancee(n, trouvees) === false) break;
  }
  return trouvees;
};

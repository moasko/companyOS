// Redimensionnement d'image dans le navigateur.
//
// Une photo de téléphone fait 4 à 8 Mo. Elle est affichée en 32 pixels dans
// une liste de membres : l'envoyer telle quelle ferait payer à chaque écran
// le chargement d'une image mille fois trop grande. On la ramène donc à sa
// taille utile **avant** de quitter le poste.

/// Réduit une image à `cote` pixels de côté, recadrée au centre, et rend une
/// data URL JPEG. Le carré est imposé : tous les avatars de l'OS sont ronds,
/// une image non carrée serait déformée ou rognée au hasard.
export const redimensionnerImage = (fichier, { cote = 256, qualite = 0.85 } = {}) =>
  new Promise((resolve, reject) => {
    if (!fichier?.type?.startsWith("image/")) {
      reject(new Error("Ce fichier n'est pas une image."));
      return;
    }

    const url = URL.createObjectURL(fichier);
    const img = new Image();

    img.onload = () => {
      // Libéré dans les deux issues : sans cela, chaque essai laisse
      // l'image entière en mémoire jusqu'au rechargement de la page.
      URL.revokeObjectURL(url);

      const source = Math.min(img.width, img.height);
      const x = (img.width - source) / 2;
      const y = (img.height - source) / 2;

      const canvas = document.createElement("canvas");
      canvas.width = cote;
      canvas.height = cote;

      const ctx = canvas.getContext("2d");
      // Sans fond, le JPEG rendrait noires les zones transparentes d'un PNG.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cote, cote);
      ctx.drawImage(img, x, y, source, source, 0, 0, cote, cote);

      resolve(canvas.toDataURL("image/jpeg", qualite));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image illisible."));
    };

    img.src = url;
  });

/// Ouvre le sélecteur de fichiers du système et rend le fichier choisi,
/// ou null si l'utilisateur referme la boîte.
export const choisirImage = () =>
  new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => resolve(input.files?.[0] || null);
    // `cancel` n'est pas émis par tous les navigateurs : la promesse peut
    // rester en attente si l'utilisateur annule. Ce n'est pas grave — rien
    // n'en dépend au-delà du gestionnaire qui l'attend.
    input.oncancel = () => resolve(null);
    input.click();
  });

/// Charge une image depuis un fichier, un blob, une data URL ou une URL.
const chargerImage = (source) =>
  new Promise((resolve, reject) => {
    const url = source instanceof Blob ? URL.createObjectURL(source) : source;
    const img = new Image();
    const liberer = () => { if (source instanceof Blob) URL.revokeObjectURL(url); };
    img.onload = () => { liberer(); resolve(img); };
    img.onerror = () => { liberer(); reject(new Error("Ce fichier n'est pas une image lisible.")); };
    img.src = url;
  });

/// Réduit une image **sans la recadrer** (logo, cachet, signature) : son
/// plus grand côté est ramené à `max` pixels. Le JPEG est posé sur fond
/// blanc — c'est le format qu'un PDF sait intégrer tel quel.
/// `agrandir` : pour une image vectorielle (une signature SVG), qui gagne à
/// être rendue plus grande que sa taille nominale.
export const reduireImage = async (source, { max = 320, format = "image/jpeg", qualite = 0.88, agrandir = false } = {}) => {
  if (source instanceof Blob && source.type && !source.type.startsWith("image/")) {
    throw new Error("Ce fichier n'est pas une image.");
  }
  const img = await chargerImage(source);
  const largeurSource = img.naturalWidth || img.width || max;
  const hauteurSource = img.naturalHeight || img.height || max;
  const rapport = max / Math.max(largeurSource, hauteurSource);
  const echelle = agrandir ? rapport : Math.min(1, rapport);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(largeurSource * echelle));
  canvas.height = Math.max(1, Math.round(hauteurSource * echelle));
  const ctx = canvas.getContext("2d");
  if (format === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { url: canvas.toDataURL(format, qualite), largeur: canvas.width, hauteur: canvas.height };
};

/// Les octets d'une data URL (base64).
export const octetsDe = (dataUrl) => {
  const binaire = atob(String(dataUrl).split(",")[1] || "");
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
  return octets;
};

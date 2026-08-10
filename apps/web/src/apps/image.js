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

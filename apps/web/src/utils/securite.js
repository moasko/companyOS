// Petits garde-fous partagés par les apps du shell.

/// Échappe un texte destiné à du HTML écrit à la main (`document.write`,
/// gabarits d'impression). Un nom de fichier comme
/// `</title><img src=x onerror=…>` s'exécutait sinon avec les droits du
/// shell — jeton de session compris.
export const echapperHtml = (texte) =>
  String(texte ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

/// Une adresse qu'on peut mettre dans un `href` ouvert par l'utilisateur :
/// http(s) et mailto uniquement. `javascript:` (venu d'un .xlsx importé,
/// par exemple) exécuterait du code au clic.
export const lienSur = (url) => /^(https?:|mailto:)/i.test(String(url ?? "").trim());

// Vue de lecture — afficher une page qui refuse d'être encadrée.
//
// ─────────────────────────────────────────────────────────────────────────
// LE PROBLÈME
//
// La grande majorité des sites envoient `X-Frame-Options` ou
// `frame-ancestors` : Google, Le Monde, les banques, presque tout. Un
// navigateur intégré qui se contente d'un cadre n'affiche donc à peu près
// rien, et expliquer poliment le refus ne le rend pas plus utile.
//
// LA SORTIE
//
// Ces en-têtes disent au navigateur : « n'affiche pas *ma* réponse dans le
// cadre d'un autre site ». Ils portent sur la réponse du site distant. Si
// c'est **notre** serveur qui sert le document, l'en-tête du site ne
// s'applique plus : le cadre affiche une page de notre origine.
//
// CE QU'IL FAUT ACCEPTER
//
// C'est une vue de lecture, pas la page réelle :
//
//   - les scripts sont retirés. Un site rendu entièrement côté client
//     n'affichera donc que sa coquille — c'est le prix, et il est annoncé
//     à l'écran plutôt que subi ;
//   - les images et les feuilles de style se chargent depuis le site, via
//     une balise <base>, donc la mise en page tient le plus souvent ;
//   - la navigation reste dedans : chaque lien est réécrit vers notre
//     serveur, sinon le premier clic ramènerait au cadre refusé.
//
// POURQUOI CHEERIO ET PAS DES EXPRESSIONS RÉGULIÈRES
//
// Le HTML réel n'est pas régulier. Un `>` dans une valeur d'attribut, une
// balise jamais fermée, un `<a>` à l'intérieur d'un commentaire : chacun
// de ces cas fait dérailler une réécriture par motif, et sur une page de
// 900 Ko il y en a toujours un. Cheerio s'appuie sur le même analyseur que
// les navigateurs (parse5) — il lit ce que le navigateur lira.
//
// CE QUI NE SE NÉGOCIE PAS
//
// Le document est servi depuis notre origine. Un cadre qui l'afficherait
// avec `allow-same-origin` pourrait lire le localStorage de CompanyOS,
// donc le jeton de session. Le cadre côté client **doit** rester sans
// `allow-same-origin` ni `allow-scripts` — voir l'appel dans le module
// Navigateur. Retirer les scripts ici est la seconde barrière, pas la
// première.
// ─────────────────────────────────────────────────────────────────────────

import * as cheerio from "cheerio";

/// Au-delà, ce n'est plus une page à lire.
export const HTML_MAX = 4 * 1024 * 1024;

/// Encodages que Node sait décoder, sous les noms qu'annoncent les sites.
const ENCODAGES = {
  "utf-8": "utf8",
  utf8: "utf8",
  "iso-8859-1": "latin1",
  "iso-8859-15": "latin1",
  "windows-1252": "latin1",
  ascii: "utf8",
};

/// Décode le corps selon le jeu de caractères annoncé. Se tromper ici
/// remplace tous les accents par des losanges — sur un site français, la
/// page devient illisible.
export const decoder = (buffer, contentType) => {
  const trouve = String(contentType || "")
    .toLowerCase()
    .match(/charset=["']?([\w-]+)/);
  return buffer.toString(ENCODAGES[trouve?.[1]] || "utf8");
};

/// Réécrit le document pour qu'il s'affiche chez nous.
///
/// `lien(url)` reçoit une adresse absolue et rend celle par laquelle elle
/// doit passer. C'est l'appelant qui la fabrique, parce que lui seul sait
/// signer un jeton.
export const preparer = (html, base, lien) => {
  const $ = cheerio.load(html);

  // 1. Les scripts partent. Ils ne s'exécuteraient pas de toute façon — le
  //    cadre est sans `allow-scripts` — mais les laisser ferait télécharger
  //    des mégaoctets pour rien.
  $("script").remove();

  // 2. La politique de sécurité du document est celle du site distant.
  //    Servie depuis notre origine, elle bloquerait ses propres feuilles
  //    de style — la page arriverait nue. Un rafraîchissement automatique,
  //    lui, sortirait de la vue.
  $("meta").each((_, el) => {
    const equiv = String($(el).attr("http-equiv") || "").toLowerCase();
    if (equiv === "content-security-policy" || equiv === "refresh") $(el).remove();
  });

  // 3. Les liens. Sans réécriture, le premier clic quitte notre origine et
  //    retombe sur le refus de cadre — la vue de lecture ne servirait
  //    qu'une seule page.
  $("a[href]").each((_, el) => {
    const cible = String($(el).attr("href") || "").trim();
    // Les ancres internes, `mailto:`, `tel:` et consorts restent tels
    // quels : les réécrire casserait ce qui marche déjà.
    if (!cible || cible.startsWith("#")) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(cible) && !/^https?:/i.test(cible)) return;

    try {
      $(el).attr("href", lien(new URL(cible, base).href));
      // Une cible `_blank` sortirait du cadre au premier clic.
      $(el).removeAttr("target");
    } catch {
      // Adresse que même l'analyseur d'URL refuse : on la laisse morte
      // plutôt que d'en fabriquer une fausse.
    }
  });

  // 4. Les formulaires ne peuvent pas fonctionner : leur cible est un autre
  //    domaine, et le cadre ne peut pas l'atteindre. Les neutraliser vaut
  //    mieux qu'un bouton qui mène à une page blanche.
  $("form").removeAttr("action");

  // 5. La balise <base> résout les adresses relatives — images, feuilles
  //    de style, polices — vers le site d'origine. C'est elle qui fait que
  //    la page ressemble encore à elle-même.
  const tete = $("head");
  if (tete.length) tete.prepend(`<base href="${base}">`);
  else $.root().prepend(`<base href="${base}">`);

  return $.html();
};

// PostCSS.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI TAILWIND EST SOUS CONDITION
//
// Vite fait passer **toutes** les feuilles importées par PostCSS, y compris
// celles des bibliothèques, déjà compilées. Or plusieurs d'entre elles
// utilisent `@layer base` — une couche parfaitement valide en CSS natif.
// Tailwind v3, lui, croit reconnaître une de ses propres couches et refuse
// de continuer faute de `@tailwind base`, que nous ne chargeons pas
// volontairement : son preflight remettrait à plat titres, listes et
// boutons de tout l'OS (voir src/index.css).
//
// L'erreur arrêtait la construction sur `pptx-react-viewer`.
//
// Filtrer par `ctx.file` dans la configuration ne marche pas : Vite la lit
// une fois pour toutes, pas par fichier. Le filtre doit donc vivre dans un
// greffon, seul endroit où le fichier courant est connu.
//
// Le critère retenu est la présence d'une directive `@tailwind` plutôt
// qu'un chemin : c'est exactement la condition qui rend Tailwind utile, et
// une seule feuille du projet en contient (src/index.css).
// ─────────────────────────────────────────────────────────────────────────

const postcss = require("postcss");
const tailwindcss = require("tailwindcss");
const autoprefixer = require("autoprefixer");

const tailwindSiDemande = {
  postcssPlugin: "tailwind-si-demande",
  async Once(root, { result }) {
    let demande = false;
    root.walkAtRules("tailwind", () => {
      demande = true;
    });
    if (!demande) return;

    const rendu = await postcss([tailwindcss()]).process(root.toString(), {
      from: result.opts.from,
    });
    root.removeAll();
    root.append(rendu.root.nodes);
  },
};

module.exports = {
  plugins: [tailwindSiDemande, autoprefixer],
};

// Chargement de Monaco — le moteur d'édition de VS Code.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI CE FICHIER EXISTE SÉPARÉMENT
//
// Monaco pèse plusieurs mégaoctets. Importé depuis `index.jsx`, il partirait
// dans le lot de démarrage de l'OS et retarderait l'écran de connexion pour
// tout le monde, y compris pour les neuf utilisateurs sur dix qui n'ouvriront
// jamais l'éditeur de code.
//
// Isolé ici, il devient un morceau à part que Vite ne charge qu'au premier
// `await charger()` — c'est-à-dire à la première ouverture de la fenêtre.
//
// LES « WORKERS »
//
// Monaco fait l'analyse syntaxique dans des fils d'exécution séparés : sans
// eux, la coloration et l'autocomplétion figent l'interface sur un gros
// fichier. Vite les empaquette via le suffixe `?worker`, et Monaco les
// réclame par un nom de langage à travers la variable globale
// `MonacoEnvironment`.
//
// Seuls quatre sont embarqués — JSON, CSS, HTML, TypeScript — plus le
// worker générique qui sert tous les autres langages. Ce sont ceux qui
// apportent une vraie analyse ; les autres n'ont que la coloration, qui se
// fait dans le fil principal et ne coûte rien.
// ─────────────────────────────────────────────────────────────────────────

import { brancherFormatage } from "./formatage";

let promesse = null;

/// Charge Monaco une seule fois et rend le module.
///
/// Les appels concurrents — deux fenêtres ouvertes en même temps — partagent
/// la même promesse : sans cela, on téléchargerait le paquet deux fois et on
/// installerait deux jeux de workers.
export const charger = () => {
  if (promesse) return promesse;

  promesse = (async () => {
    const [
      monaco,
      { default: WorkerEditeur },
      { default: WorkerJson },
      { default: WorkerCss },
      { default: WorkerHtml },
      { default: WorkerTs },
    ] = await Promise.all([
      // `editor.main.js` et non « monaco-editor » tout court : depuis la
      // 0.56, l'entrée par défaut du paquet est un index qui enregistre
      // **tous** les langages et embarque une couche LSP. Celle-ci est
      // l'entrée classique — l'éditeur et la coloration, sans le reste.
      import("monaco-editor/editor/editor.main.js"),
      import("monaco-editor/editor/editor.worker.js?worker"),
      import("monaco-editor/language/json/json.worker.js?worker"),
      import("monaco-editor/language/css/css.worker.js?worker"),
      import("monaco-editor/language/html/html.worker.js?worker"),
      import("monaco-editor/language/typescript/ts.worker.js?worker"),
    ]);

    self.MonacoEnvironment = {
      getWorker(_id, langage) {
        if (langage === "json") return new WorkerJson();
        if (langage === "css" || langage === "scss" || langage === "less") return new WorkerCss();
        if (langage === "html" || langage === "handlebars" || langage === "razor") return new WorkerHtml();
        if (langage === "typescript" || langage === "javascript") return new WorkerTs();
        return new WorkerEditeur();
      },
    };

    // Le contrôle de types de TypeScript est coupé. Ici on ouvre **un**
    // fichier détaché de son projet : sans le reste des sources ni les
    // paquets installés, chaque import se souligne en rouge et chaque
    // variable devient « introuvable ». Un tapis d'erreurs fausses apprend
    // vite à ignorer les vraies. La coloration, le pliage, la sélection
    // multiple et le formatage, eux, restent entiers.
    // `monaco.languages.typescript` **n'existe pas** dans toutes les
    // distributions : l'entrée classique de la 0.56 ne l'embarque pas.
    // Écrit sans précaution, cet accès levait une exception qui rejetait
    // tout le chargement — et l'éditeur n'était alors jamais créé, laissant
    // une fenêtre entièrement vide. Un réglage de confort ne doit jamais
    // pouvoir emporter l'outil qu'il agrémente.
    const ts = monaco.languages?.typescript;
    if (ts) {
      for (const defauts of [ts.typescriptDefaults, ts.javascriptDefaults]) {
        defauts?.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
      }
    }

    definirThemes(monaco);
    brancherFormatage(monaco);

    // Emmet : « ul>li*3 » puis Tab donne la liste complète. C'est
    // l'abréviation qui fait gagner le plus de temps en HTML et en CSS, et
    // son absence se remarque immédiatement quand on a l'habitude.
    //
    // Chargé à part et sans bloquer : si le paquet manque, l'éditeur doit
    // continuer de fonctionner — on perd une commodité, pas l'outil.
    import("emmet-monaco-es")
      .then(({ emmetHTML, emmetCSS, emmetJSX }) => {
        emmetHTML(monaco, ["html", "xml", "markdown"]);
        emmetCSS(monaco, ["css", "scss", "less"]);
        emmetJSX(monaco, ["javascript", "typescript"]);
      })
      .catch((e) => console.warn("Emmet indisponible :", e.message));

    return monaco;
  })();

  return promesse;
};

/// Les thèmes de VS Code, tels quels.
///
/// J'avais d'abord peint l'éditeur aux couleurs de l'OS — crème et canard.
/// C'était une erreur de jugement : on n'ouvre pas un éditeur de code en
/// attendant la charte d'un logiciel de gestion, on l'ouvre en attendant
/// **VS Code**. La coloration syntaxique de `vs` et `vs-dark` est celle que
/// l'œil d'un développeur lit sans réapprendre, et elle vient avec Monaco.
///
/// Ce qui reste aux couleurs de la maison, c'est le pourtour : arborescence,
/// onglets, barre d'état. La zone d'édition, elle, appartient à VS Code.
const definirThemes = (monaco) => {
  // Rien à définir : `vs` et `vs-dark` sont fournis. La fonction est
  // conservée pour garder un seul endroit où le thème se décide.
  void monaco;
};

export const THEME_CLAIR = "vs";
export const THEME_SOMBRE = "vs-dark";

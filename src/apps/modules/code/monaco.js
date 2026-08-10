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
    for (const langage of [
      monaco.languages.typescript.typescriptDefaults,
      monaco.languages.typescript.javascriptDefaults,
    ]) {
      langage.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
    }

    definirThemes(monaco);
    return monaco;
  })();

  return promesse;
};

/// Deux thèmes aux couleurs de CompanyOS plutôt que ceux de VS Code.
///
/// L'éditeur occupe toute la fenêtre : un fond gris-bleu Microsoft au
/// milieu d'un OS crème et canard se voit immédiatement. Les couleurs de
/// syntaxe, elles, restent proches de celles de VS Code — c'est ce que
/// l'œil d'un développeur sait lire sans réapprendre.
const definirThemes = (monaco) => {
  monaco.editor.defineTheme("cos-clair", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6d7d84", fontStyle: "italic" },
      { token: "keyword", foreground: "057378" },
      { token: "string", foreground: "9a5b16" },
      { token: "number", foreground: "8a4fbd" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editorLineNumber.foreground": "#a8b4b8",
      "editorLineNumber.activeForeground": "#057378",
      "editor.lineHighlightBackground": "#f0f2f1",
      "editorCursor.foreground": "#057378",
      "editor.selectionBackground": "#c9e9eb",
    },
  });

  monaco.editor.defineTheme("cos-sombre", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "7d8f96", fontStyle: "italic" },
      { token: "keyword", foreground: "56c8cf" },
      { token: "string", foreground: "e0a45e" },
      { token: "number", foreground: "c99bf0" },
    ],
    colors: {
      "editor.background": "#0d1b1e",
      "editorLineNumber.foreground": "#4a5f65",
      "editorLineNumber.activeForeground": "#0aafb7",
      "editor.lineHighlightBackground": "#12262a",
      "editorCursor.foreground": "#0aafb7",
      "editor.selectionBackground": "#1d4a50",
    },
  });
};

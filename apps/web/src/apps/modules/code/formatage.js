// Formatage du code — Prettier, branché dans Monaco.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI C'EST LA PREMIÈRE CHOSE À AJOUTER
//
// Après « enregistrer », « formater » est le geste le plus répété de la
// journée. Sans lui, on aligne à la main, on discute d'espaces en revue de
// code, et un fichier passé d'un éditeur à l'autre revient avec des
// indentations mélangées. Prettier tranche : il n'y a plus de débat, il y a
// une sortie.
//
// COMMENT C'EST BRANCHÉ
//
// Pas par un bouton maison, mais par un `DocumentFormattingEditProvider`
// enregistré auprès de Monaco. Conséquence : **Shift+Alt+F fonctionne**,
// « Format Document » apparaît dans la palette de commandes (F1) et dans le
// menu contextuel, et le formatage à l'enregistrement passe par le même
// chemin. On se branche sur les habitudes existantes au lieu d'en inventer.
//
// LE CHARGEMENT EST PARESSEUX, ET PAR LANGAGE
//
// Prettier et ses greffons pèsent lourd. On ne charge que le greffon du
// langage réellement formaté : ouvrir un fichier YAML ne télécharge pas
// l'analyseur TypeScript. Chaque greffon n'est téléchargé qu'une fois.
// ─────────────────────────────────────────────────────────────────────────

/// Le parseur Prettier de chaque langage Monaco, et les greffons à charger.
///
/// `estree` accompagne systématiquement babel et typescript : c'est lui qui
/// sait ré-imprimer l'arbre, les autres ne font que l'analyse.
const PARSEURS = {
  javascript: { parser: "babel", greffons: ["babel", "estree"] },
  typescript: { parser: "typescript", greffons: ["typescript", "estree"] },
  json: { parser: "json", greffons: ["babel", "estree"] },
  html: { parser: "html", greffons: ["html"] },
  xml: null, // Prettier ne sait pas : mieux vaut ne rien proposer que mal faire.
  css: { parser: "css", greffons: ["postcss"] },
  scss: { parser: "scss", greffons: ["postcss"] },
  less: { parser: "less", greffons: ["postcss"] },
  markdown: { parser: "markdown", greffons: ["markdown"] },
  yaml: { parser: "yaml", greffons: ["yaml"] },
};

export const formatable = (langage) => !!PARSEURS[langage];

const cacheGreffons = new Map();

const chargerGreffon = (nom) => {
  if (cacheGreffons.has(nom)) return cacheGreffons.get(nom);
  // Les chemins sont écrits en clair, un par un : un `import` avec une
  // variable empêcherait Vite de découper le paquet et embarquerait tous
  // les greffons dans le même morceau.
  const p = (() => {
    switch (nom) {
      case "babel": return import("prettier/plugins/babel.mjs");
      case "estree": return import("prettier/plugins/estree.mjs");
      case "typescript": return import("prettier/plugins/typescript.mjs");
      case "html": return import("prettier/plugins/html.mjs");
      case "postcss": return import("prettier/plugins/postcss.mjs");
      case "markdown": return import("prettier/plugins/markdown.mjs");
      case "yaml": return import("prettier/plugins/yaml.mjs");
      default: return Promise.reject(new Error(`Greffon inconnu : ${nom}`));
    }
  })().then((m) => m.default ?? m);
  cacheGreffons.set(nom, p);
  return p;
};

let prettierPromesse = null;
const chargerPrettier = () => {
  if (!prettierPromesse) prettierPromesse = import("prettier/standalone.mjs");
  return prettierPromesse;
};

/// Formate un texte. Rend `null` si le langage n'est pas géré, et **relaie
/// l'erreur** si le code est syntaxiquement faux.
///
/// Ce second cas compte : un fichier qu'on n'arrive pas à formater est
/// presque toujours un fichier cassé, et le dire vaut mieux que de rendre
/// le texte inchangé en laissant croire qu'il était déjà propre.
export const formater = async (texte, langage, options = {}) => {
  const regle = PARSEURS[langage];
  if (!regle) return null;

  const [prettier, ...greffons] = await Promise.all([
    chargerPrettier(),
    ...regle.greffons.map(chargerGreffon),
  ]);

  return prettier.format(texte, {
    parser: regle.parser,
    plugins: greffons,
    // Les réglages de la maison, alignés sur .prettierrc.json du dépôt.
    printWidth: 100,
    tabWidth: 2,
    semi: true,
    singleQuote: false,
    ...options,
  });
};

/// Branche Prettier dans Monaco pour tous les langages qu'il sait traiter.
///
/// À n'appeler qu'une fois : Monaco empile les fournisseurs, et deux
/// formateurs enregistrés pour le même langage font apparaître un choix
/// « Formater avec… » que personne n'a demandé.
let branche = false;

export const brancherFormatage = (monaco) => {
  if (branche) return;
  branche = true;

  for (const langage of Object.keys(PARSEURS)) {
    if (!PARSEURS[langage]) continue;
    monaco.languages.registerDocumentFormattingEditProvider(langage, {
      async provideDocumentFormattingEdits(modele) {
        try {
          const propre = await formater(modele.getValue(), langage);
          if (propre === null) return [];
          return [{ range: modele.getFullModelRange(), text: propre }];
        } catch (erreur) {
          // Monaco avale les exceptions d'un fournisseur : sans cette
          // trace, un fichier au code invalide donnerait un Shift+Alt+F
          // qui ne fait rien, sans la moindre explication.
          console.warn("Formatage impossible :", erreur.message);
          return [];
        }
      },
    });
  }
};

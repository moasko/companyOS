// Configuration ESLint — format « flat », un seul fichier pour le monorepo.
//
// Le parti pris : signaler ce qui casse, taire ce qui relève du style.
// Le formatage est le travail de Prettier ; une règle de lint qui se
// dispute avec lui ne produit que du bruit, et du bruit dans un lint
// signifie qu'on cesse de le lire.

import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/build/**",
      "**/dist/**",
      "apps/api/storage/**",
      "apps/api/prisma/migrations/**",
      "apps/web/public/**",
    ],
  },

  js.configs.recommended,

  // ------------------------------------------------------------------
  // Le shell
  // ------------------------------------------------------------------
  {
    files: ["apps/web/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "18.3" } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // React 17+ : plus besoin d'importer React pour écrire du JSX.
      "react/react-in-jsx-scope": "off",
      // Le projet n'utilise pas PropTypes et n'a pas de TypeScript : cette
      // règle ne signalerait que du bruit sur 40 modules.
      "react/prop-types": "off",
      // Les apostrophes françaises dans le JSX sont volontaires et lisibles.
      "react/no-unescaped-entities": "off",

      // Une variable inutilisée est presque toujours un reste de
      // refactorisation. Les arguments préfixés d'un `_` sont exemptés :
      // c'est la façon habituelle de dire « je sais, je n'en veux pas ».
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Le shell historique utilise encore des `var` redéclarés dans une
      // même fonction. C'est légal en JavaScript et ne doit pas masquer les
      // erreurs réellement bloquantes pendant sa migration progressive.
      "no-redeclare": "off",
      // Ces expressions servent précisément à retirer les caractères de
      // contrôle de fichiers importés et de sorties du terminal.
      "no-control-regex": "off",
      // Plusieurs parseurs métier reconnaissent explicitement l'espace
      // insécable, courant dans les nombres copiés depuis Excel.
      "no-irregular-whitespace": "off",
    },
  },

  // ------------------------------------------------------------------
  // L'API et le paquet partagé
  // ------------------------------------------------------------------
  {
    files: [
      "apps/api/**/*.js",
      "apps/mcp/**/*.js",
      "packages/shared/**/*.js",
      // Les bancs d'essai tournent sous Node, comme le serveur.
      "experiments/**/*.{js,mjs}",
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.es2021 },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Sur le serveur, un `console.log` oublié finit dans les journaux de
      // production. `console.error` et `console.warn` restent permis :
      // c'est ainsi que les moteurs de fond signalent un échec.
      "no-console": ["warn", { allow: ["error", "warn"] }],
      "no-control-regex": "off",
    },
  },

  // ------------------------------------------------------------------
  // Le paquet partagé : les contraintes qui font qu'il reste partageable
  // ------------------------------------------------------------------
  {
    files: ["packages/shared/**/*.js"],
    languageOptions: { globals: {} },
    rules: {
      // Ce code s'exécute des deux côtés. Toucher au DOM ou à une API du
      // navigateur le casserait côté serveur — silencieusement, au moment
      // d'un envoi de mail, c'est-à-dire au pire moment.
      "no-restricted-globals": [
        "error",
        { name: "window", message: "packages/shared s'exécute aussi côté serveur." },
        { name: "document", message: "packages/shared s'exécute aussi côté serveur." },
        {
          name: "localStorage",
          message: "packages/shared s'exécute aussi côté serveur.",
        },
      ],
    },
  },
];

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/// La politique de sécurité du contenu, posée aussi **dans la page** au
/// build. nginx l'envoie en en-tête (voir nginx.conf) ; mais servi par un
/// autre hébergeur (le fichier `_redirects` en prévoit un), le shell
/// partait sans aucune CSP — et la moindre injection devenait un vol de
/// session. La balise `<meta>` ne couvre pas `frame-ancestors` : cette
/// directive reste du ressort de l'en-tête.
///
/// Uniquement au build : en développement, Vite injecte des scripts en
/// ligne (rafraîchissement à chaud) que cette politique bloquerait.
const cspEnPage = (mode) => {
  const brute = loadEnv(mode, dirname(fileURLToPath(import.meta.url)), "VITE_").VITE_API_URL || "";
  let api = "";
  try {
    api = brute ? new URL(brute).origin : "";
  } catch {
    api = "";
  }
  const politique = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${api} https://api.producthunt.com`,
    `media-src 'self' blob: ${api}`,
    "font-src 'self' data:",
    `connect-src 'self' ${api}`,
    "worker-src 'self' blob:",
    "frame-src https:",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
  ]
    .map((d) => d.replace(/\s+/g, " ").trim())
    .join("; ");
  return {
    name: "companyos-csp",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: politique }, injectTo: "head-prepend" },
    ],
  };
};

const config = ({ mode }) => {
  return defineConfig({
    plugins: [
      react(),
      cspEnPage(mode),
      VitePWA({
        registerType: "autoUpdate",
        workbox: {
          // Les moteurs d'édition (Word, PowerPoint, 3D) sont gros et
          // chargés à la demande : les préinstaller dans le cache du
          // service worker ferait télécharger une dizaine de mégaoctets à
          // tout visiteur, y compris à qui n'ouvrira jamais ces apps. Ils
          // se mettront en cache d'eux-mêmes à la première utilisation.
          //
          // Monaco (l'éditeur de VS Code, app Code) suit la même règle, et
          // ses analyseurs de langage sont les plus gros fichiers du
          // projet — celui de TypeScript pèse à lui seul 7 Mo.
          globIgnores: [
            "**/Editeur-*.js",
            "**/three.module-*.js",
            "**/*.worker-*.js",
            "**/monaco-*.js",
            "**/editor.main-*.js",
          ],
          // Le plafond par défaut est de 2 Mio, et le lot commun le dépasse
          // de peu (~2,1 Mio). Or celui-là, contrairement aux moteurs
          // ci-dessus, **doit** être préinstallé : c'est le cœur de l'OS,
          // celui sans lequel il n'y a pas de mode hors ligne du tout.
          //
          // Relever le plafond ne fait pas rentrer les gros fichiers dans
          // le cache : ils en sont écartés par leur nom, juste au-dessus.
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          // Réception et clic des notifications push (onglet fermé).
          importScripts: ["push-sw.js"],
        },
      }),
    ],

    base: "",

    resolve: {
      alias: {
        // Chemins absolus depuis la racine du shell : `@/apps/modules/crm`
        // plutôt que `../../../apps/modules/crm`. Les modules métier sont
        // imbriqués sur quatre niveaux, les chemins relatifs y devenaient
        // illisibles et cassaient au moindre déplacement de fichier.
        "@": resolve(dirname(fileURLToPath(import.meta.url)), "src"),
      },
    },

    server: {
      watch: {
        // Le stockage des fichiers de l'API vit dans `apps/api/storage/`.
        // Sans cette exclusion, chaque fichier importé dans le cloud y
        // atterrit, le watcher le voit et ordonne un rechargement complet
        // de la page — l'import en cours est coupé et l'OS redémarre.
        // C'était très visible à l'import d'une vidéo, dont l'écriture dure
        // assez longtemps pour être toujours interrompue.
        ignored: ["**/apps/api/**"],
      },
    },
    define: {
      "process.env.NODE_ENV": `"${mode}"`,
    },
    // Même raison que `build.target` ci-dessous, mais pour le serveur de
    // développement : le pré-empaquetage des dépendances a sa propre cible.
    optimizeDeps: {
      // `esnext` et pas `es2022` : pdf.js compte sur l'ordre d'évaluation
      // natif des champs de classe — transformé, il plante au chargement
      // (« Cannot set properties of undefined, _isSameOrigin »).
      esbuildOptions: { target: "esnext" },
    },
    build: {
      outDir: "build",
      // L'éditeur .docx écrit des littéraux BigInt (`123n`), que la cible
      // par défaut interdit à cause de safari13. es2022 est couvert par
      // tous les navigateurs qui savent faire tourner l'OS de toute façon.
      target: "es2022",
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            // Les moteurs lourds sont importés dynamiquement (three pour
            // la 3D, l'éditeur .docx, la conversion d'anciens documents) :
            // ils gardent chacun leur morceau, téléchargé à la première
            // utilisation. Les forcer dans « vendor » — l'ancien réglage —
            // les faisait télécharger par tout le monde au démarrage.
            if (
              // canvg, dompurify et compagnie sont les dépendances de
              // jspdf : elles suivent le même régime que lui — chargées à
              // la première génération de PDF, pas au démarrage.
              /node_modules[\\/](three|@docx-editor\.dev|@radix-ui|harfbuzzjs|emf-converter|docx|pdfjs-dist|pptx-react-viewer|pptx-viewer-core|pptx-viewer-mcp|jspdf|jszip|html2canvas-pro|ai|@ai-sdk|canvg|dompurify|rgbcolor|raf|performance-now|stackblur-canvas|svg-pathdata|core-js|monaco-editor|prettier|emmet-monaco-es)[\\/]/.test(
                id,
              )
            ) {
              return undefined;
            }
            if (id.includes("node_modules")) return "vendor";
            return undefined;
          },
        },
      },
    },
  });
};

export default config;

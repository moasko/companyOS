// Descriptif de l'application, chargé au démarrage du shell.
//
// Le code de la fenêtre (index.jsx) n'est téléchargé qu'à la première
// ouverture : ce fichier doit rester léger — aucun import de React ni
// des écrans. Voir src/apps/registry.js.

export const manifest = {
  id: "mcp",
  slug: "mcp",
  name: "MCP Center",
  icon: "terminal",
  action: "MCPAPP",
  version: "1.0.0",
  notes: [{ version: "1.0.0", texte: "Console MCP, configuration et diagnostic." }],
};

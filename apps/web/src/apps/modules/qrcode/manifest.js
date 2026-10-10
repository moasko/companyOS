// Descriptif de l'application, chargé au démarrage du shell.
//
// Le code de la fenêtre (index.jsx) n'est téléchargé qu'à la première
// ouverture : ce fichier doit rester léger — aucun import de React ni
// des écrans. Voir src/apps/registry.js.

export const manifest = {
  slug: "qrcode",
  version: "1.1.0",
  /// Annoncé dans la Boutique quand une mise à jour est disponible.
  /// Seules les entrées postérieures à la version installée sont montrées.
  nouveautes: [
    { version: "1.1.0", texte: "L'historique montre qui a généré chaque code." },
  ],
  name: "Générateur de QR Code Avancé",
  icon: "qrcode",
  action: "QRCODEAPP",
};

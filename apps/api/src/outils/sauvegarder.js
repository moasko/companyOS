// Sauvegarde immédiate, depuis le serveur : `companyos sauvegarde`.
//
//   node src/outils/sauvegarder.js            base + fichiers
//   node src/outils/sauvegarder.js --base     la base seulement
//
// Mêmes archives, même vérification et même suivi que les sauvegardes
// automatiques de la nuit : elles apparaissent dans la console Plateforme
// (déclencheur « manuelle ») et dans le volume des sauvegardes.

import { prisma } from "../db.js";
import { sauvegarderBase, sauvegarderFichiers } from "../sauvegardes.js";

const lignes = [await sauvegarderBase("manuelle")];
if (!process.argv.includes("--base")) lignes.push(await sauvegarderFichiers("manuelle"));

for (const l of lignes) {
  process.stdout.write(`${l.type}\t${l.fichier}\t${l.octets} octets\n`);
}
await prisma.$disconnect();

// Restaure une sauvegarde dans sa base : `companyos restaurer <fichier>`.
//
//   base-<date>.dump          → la base principale
//   base-<slug>-<date>.dump   → la base de l'entreprise <slug>
//
// Lancé API arrêtée (la commande companyos s'en charge) : personne n'écrit
// pendant que la base est remplacée.

import { spawn } from "node:child_process";
import path from "node:path";
import { env } from "../env.js";
import { deconnecterTout, principal, urlDeBase } from "../db.js";
import { adressePgDump } from "../sauvegardes.js";

const nom = path.basename(process.argv[2] || "");
const m = /^base-(?:([a-z0-9-]+)-)?\d{4}-\d{2}-\d{2}T\d{2}-\d{2}\.dump$/.exec(nom);
if (!m) {
  console.error("Usage : node src/outils/restaurer.js base-….dump (voir companyos sauvegardes)");
  process.exit(1);
}
let url = env.databaseUrl;
if (m[1]) {
  const b = await principal.baseEspace.findUnique({ where: { slug: m[1] } });
  if (!b) {
    console.error(`Aucune entreprise « ${m[1]} » sur ce serveur.`);
    process.exit(1);
  }
  url = urlDeBase(b.nomBase, env.databaseUrl);
}
await deconnecterTout();

const code = await new Promise((resolve) => {
  const p = spawn(
    "pg_restore",
    ["--clean", "--if-exists", "--no-owner", "--no-privileges", `--dbname=${adressePgDump(url)}`, path.join(env.sauvegardeDossier, nom)],
    { stdio: "inherit" },
  );
  p.on("close", resolve);
});
// pg_restore sort en 1 pour de simples avertissements (objets absents…).
console.warn(code === 0 ? `Restauré : ${nom}` : `Restauré avec des avertissements (code ${code}) : ${nom}`);

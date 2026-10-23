// Entreprises du serveur, chacune dans sa propre base :
//
//   node src/outils/entreprise.js liste
//   node src/outils/entreprise.js creer --nom "Filiale Sud" --email dg@filiale.ci [--admin "Nom"] [--slug filiale-sud] [--json]
//   node src/outils/entreprise.js supprimer <slug> --confirmer
//
// (sur le serveur : companyos entreprise …)

import { randomBytes } from "node:crypto";
import { hashPassword, normaliserEmail } from "../auth.js";
import { deconnecterTout, listerBases } from "../db.js";
import { creerEntreprise, supprimerEntreprise } from "../entreprises.js";
import { env } from "../env.js";

const option = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const json = process.argv.includes("--json");
const [action, arg] = process.argv.slice(2);
const adresse = (slug) => (env.domaine ? `https://${slug}.${env.domaine}` : slug);

try {
  if (action === "liste") {
    const bases = await listerBases();
    if (json) process.stdout.write(`${JSON.stringify(bases)}\n`);
    else if (!bases.length) console.warn("Aucune entreprise supplémentaire : seule l'entreprise principale existe.");
    else for (const b of bases) console.warn(`${b.slug.padEnd(24)} ${b.nom.padEnd(30)} ${adresse(b.slug)}  (base ${b.nomBase})`);
  } else if (action === "creer") {
    const nom = option("nom");
    const email = normaliserEmail(option("email") || "");
    if (!nom || !email) throw new Error('Usage : creer --nom "Nom" --email adresse [--admin "Nom affiché"] [--slug sous-domaine]');
    const motDePasse = randomBytes(18).toString("base64url");
    const { base } = await creerEntreprise({ nom, slug: option("slug"), email, nomAdmin: option("admin") || "Administrateur", passwordHash: await hashPassword(motDePasse) });
    if (json) process.stdout.write(`${JSON.stringify({ slug: base.slug, adresse: adresse(base.slug), email, motDePasse })}\n`);
    else console.warn(`\n  Entreprise   : ${nom}\n  Adresse      : ${adresse(base.slug)}\n  Identifiant  : ${email}\n  Mot de passe : ${motDePasse}\n\n  (affiché une seule fois — à changer à la première connexion)`);
  } else if (action === "supprimer") {
    if (!arg || !process.argv.includes("--confirmer")) throw new Error("Usage : supprimer <slug> --confirmer (irréversible : la base est supprimée)");
    const b = await supprimerEntreprise(arg);
    console.warn(`Entreprise « ${b.nom} » supprimée (base ${b.nomBase}).`);
  } else {
    throw new Error("Actions : liste | creer | supprimer");
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await deconnecterTout();
}

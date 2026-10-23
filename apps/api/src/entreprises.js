// Une base par entreprise : création, mise à niveau, suppression.
//
// Ajouter une entreprise au serveur, c'est :
//   1. créer sa base PostgreSQL (cos_<slug>) sur le même serveur ;
//   2. y appliquer les migrations et le catalogue d'applications, exactement
//      comme pour la base principale ;
//   3. y créer l'espace et son propriétaire ;
//   4. l'inscrire au registre (bases_espaces) : son sous-domaine
//      <slug>.<DOMAINE> répond aussitôt, et Caddy obtient son certificat au
//      premier accès.
//
// Ses données, ses comptes, ses fichiers (rangés par identifiant d'espace)
// et sa configuration ne partagent rien avec les autres entreprises.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NOM_BASE, dansBase, listerBases, prisma, principal, urlDeBase } from "./db.js";
import { creerEspace, slugify } from "./espaces.js";

const RACINE_API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/// Sous-domaines qu'une entreprise ne peut pas prendre.
const RESERVES = new Set(["www", "api", "app", "admin", "console", "mail", "smtp", "imap", "ftp", "static", "cdn", "status"]);

const lancer = (commande, args, envSup) =>
  new Promise((resolve, reject) => {
    const p = spawn(commande, args, { cwd: RACINE_API, env: { ...process.env, ...envSup }, stdio: ["ignore", "pipe", "pipe"] });
    let sortie = "";
    p.stdout.on("data", (d) => (sortie += d));
    p.stderr.on("data", (d) => (sortie += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(sortie) : reject(new Error(`${commande} ${args.join(" ")} : ${sortie.trim().split("\n").slice(-3).join(" ")}`))));
  });

/// Migrations puis catalogue d'applications, sur une base donnée. Les deux
/// sont rejouables sans risque : c'est aussi la mise à niveau au démarrage.
export const mettreANiveau = async (nomBase) => {
  const env = { DATABASE_URL: urlDeBase(nomBase) };
  await lancer("npx", ["prisma", "migrate", "deploy"], env);
  await lancer("node", ["prisma/seed.js"], env);
};

/// Un sous-domaine libre, dérivé du nom de l'entreprise.
export const slugLibre = async (nom, souhaite) => {
  const base = slugify(souhaite || nom).slice(0, 40).replace(/-$/, "") || "entreprise";
  const pris = async (s) =>
    RESERVES.has(s) || !!(await principal.baseEspace.findUnique({ where: { slug: s } })) || !!(await principal.tenant.findUnique({ where: { slug: s } }));
  if (!(await pris(base))) return base;
  for (let i = 2; i < 100; i++) if (!(await pris(`${base}-${i}`))) return `${base}-${i}`;
  throw new Error("Aucun sous-domaine libre pour ce nom.");
};

/// Crée une entreprise dans sa propre base. `passwordHash` est déjà calculé.
export const creerEntreprise = async ({ nom, slug: souhaite, email, nomAdmin, passwordHash }) => {
  const slug = await slugLibre(nom, souhaite);
  const nomBase = `cos_${slug.replace(/-/g, "_")}`.slice(0, 50);
  if (!NOM_BASE.test(nomBase)) throw new Error(`Nom de base invalide : ${nomBase}`);

  // Le nom est validé ci-dessus : seules lettres, chiffres et soulignés
  // arrivent dans la commande SQL.
  const existe = await principal.$queryRaw`SELECT 1 FROM pg_database WHERE datname = ${nomBase}`;
  if (!existe.length) await principal.$executeRawUnsafe(`CREATE DATABASE "${nomBase}"`);

  await mettreANiveau(nomBase);

  const base = { slug, nomBase, nom };
  const { tenant, user } = await dansBase(base, async () => {
    const r = await creerEspace({ company: nom, name: nomAdmin, email, passwordHash });
    // L'espace prend le sous-domaine retenu (base vierge : aucun conflit).
    if (r.tenant.slug !== slug) r.tenant = await prisma.tenant.update({ where: { id: r.tenant.id }, data: { slug } });
    return r;
  });

  const ligne = await principal.baseEspace.create({ data: { slug, nomBase, tenantId: tenant.id, nom } });
  return { base: ligne, tenant, user };
};

/// Met à niveau toutes les bases d'entreprise (au démarrage du conteneur).
export const mettreAniveauToutes = async (journal = console) => {
  for (const b of await listerBases()) {
    try {
      await mettreANiveau(b.nomBase);
      journal.warn(`Base ${b.nomBase} (${b.slug}) : à jour.`);
    } catch (e) {
      journal.error(`Base ${b.nomBase} (${b.slug}) : mise à niveau impossible — ${e.message}`);
    }
  }
};

/// Retire une entreprise : sa base est supprimée, son sous-domaine libéré.
/// Irréversible — la console et la commande demandent une confirmation, et
/// une sauvegarde est faite juste avant (voir l'outil en ligne de commande).
export const supprimerEntreprise = async (slug) => {
  const b = await principal.baseEspace.findUnique({ where: { slug } });
  if (!b) throw new Error(`Entreprise inconnue : ${slug}`);
  if (!NOM_BASE.test(b.nomBase)) throw new Error(`Nom de base invalide : ${b.nomBase}`);
  await principal.baseEspace.delete({ where: { slug } });
  await principal.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${b.nomBase}" WITH (FORCE)`);
  return b;
};

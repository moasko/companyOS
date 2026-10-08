import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { chargerConfig } from "./storage.js";
import { creerPiloteS3 } from "./stockage-s3.js";
import { consigner } from "./erreurs.js";

/// Sauvegardes automatiques de la plateforme.
///
/// ─────────────────────────────────────────────────────────────────────────
/// CE QUI EST SAUVEGARDÉ
///
///   - **La base, chaque jour** (`pg_dump`, format custom). Elle contient
///     tout ce que les clients saisissent : factures, écritures, bulletins,
///     stock, CRM. C'est la sauvegarde qui compte.
///   - **Le stockage local, chaque semaine** (archive tar.gz) — les fichiers
///     du cloud, quand ils vivent sur le disque du serveur. Un stockage S3
///     a ses propres garanties de durabilité et n'est pas archivé ici.
///
/// UNE SAUVEGARDE N'EN EST UNE QUE SI…
///
///   - **elle se relit** : chaque copie de la base est relue par
///     `pg_restore --list` ; une archive tronquée est marquée en échec ;
///   - **elle n'est pas sur le même disque** : quand la plateforme a un
///     stockage objet configuré, la copie de la base y est envoyée. Une
///     sauvegarde sur le disque qu'elle protège disparaît avec lui ;
///   - **son échec se voit** : chaque tentative laisse une ligne
///     (table `sauvegardes`), un échec est consigné au journal des erreurs
///     — et signalé par courriel aux exploitants.
///
/// La restauration est décrite dans DEPLOIEMENT.md.
/// ─────────────────────────────────────────────────────────────────────────

const JOUR = 24 * 3600_000;

/// L'adresse de la base telle que `pg_dump` l'accepte. Prisma ajoute à
/// l'URL des paramètres qui lui sont propres (`schema`, `connection_limit`…)
/// et que libpq refuse : « invalid URI query parameter ».
export const adressePgDump = (url) => {
  const u = new URL(url);
  for (const p of [
    "schema",
    "connection_limit",
    "pool_timeout",
    "pgbouncer",
    "socket_timeout",
    "statement_cache_size",
  ]) {
    u.searchParams.delete(p);
  }
  return u.toString();
};

/// Lance une commande, rend sa sortie standard ; rejette avec la sortie
/// d'erreur si elle échoue.
const executer = (commande, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(commande, args, { stdio: ["ignore", "pipe", "pipe"] });
    let sortie = "";
    let erreurs = "";
    p.stdout.on("data", (d) => (sortie += d));
    p.stderr.on("data", (d) => (erreurs += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0
        ? resolve(sortie)
        : reject(new Error(`${commande} : ${erreurs.trim().slice(0, 800) || `code ${code}`}`)),
    );
  });

const empreinte = (fichier) =>
  new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(fichier)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });

const horodatage = (d = new Date()) => d.toISOString().slice(0, 16).replace(/:/g, "-");

const cleHorsSite = (config, nom) => `${config.s3.prefix || ""}_sauvegardes/${nom}`;

/// Le pilote du stockage objet de la plateforme, s'il est utilisable.
const piloteHorsSite = async () => {
  const config = await chargerConfig();
  return config.utilisable ? { config, pilote: creerPiloteS3(config.s3) } : null;
};

/// Une tentative de sauvegarde, de bout en bout : la ligne de suivi est
/// ouverte d'abord, fermée quoi qu'il arrive.
const tenter = async (type, declencheur, travail) => {
  const ligne = await prisma.sauvegarde.create({ data: { type, declencheur } });
  try {
    const resultat = await travail();
    return await prisma.sauvegarde.update({
      where: { id: ligne.id },
      data: { ...resultat, statut: "ok", fin: new Date() },
    });
  } catch (e) {
    await prisma.sauvegarde.update({
      where: { id: ligne.id },
      data: { statut: "echec", erreur: String(e.message).slice(0, 1000), fin: new Date() },
    });
    await consigner({
      source: "api",
      message: `Sauvegarde ${type} en échec : ${e.message}`,
      pile: e.stack,
      url: `sauvegarde/${type}`,
    });
    throw e;
  }
};

/// Sauvegarde la base. Rend la ligne de suivi.
export const sauvegarderBase = (declencheur = "auto") =>
  tenter("base", declencheur, async () => {
    await fs.mkdir(env.sauvegardeDossier, { recursive: true });
    const nom = `base-${horodatage()}.dump`;
    const fichier = path.join(env.sauvegardeDossier, nom);

    await executer("pg_dump", [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      `--file=${fichier}`,
      `--dbname=${adressePgDump(env.databaseUrl)}`,
    ]);

    // Relire l'archive : sa table des matières doit au moins contenir la
    // table des espaces. Un fichier tronqué ou vide échoue ici.
    const toc = await executer("pg_restore", ["--list", fichier]);
    if (!/TABLE DATA \S+ tenants /.test(toc)) {
      throw new Error("L'archive produite ne contient pas les données attendues.");
    }

    const { size } = await fs.stat(fichier);
    const sha256 = await empreinte(fichier);

    let horsSite = false;
    const distant = await piloteHorsSite();
    if (distant) {
      await distant.pilote.put(cleHorsSite(distant.config, nom), createReadStream(fichier));
      horsSite = true;
    }

    return { fichier: nom, octets: BigInt(size), sha256, verifiee: true, horsSite };
  });

/// Archive le stockage local. Sans objet quand les fichiers sont sur S3.
export const sauvegarderFichiers = (declencheur = "auto") =>
  tenter("fichiers", declencheur, async () => {
    await fs.mkdir(env.sauvegardeDossier, { recursive: true });
    const nom = `fichiers-${horodatage()}.tar.gz`;
    const fichier = path.join(env.sauvegardeDossier, nom);
    const source = path.resolve(env.storageLocalPath);
    await fs.mkdir(source, { recursive: true });

    await executer("tar", ["-czf", fichier, "-C", source, "."]);
    // Relire l'archive en entier : gzip vérifie son empreinte au passage.
    await executer("tar", ["-tzf", fichier]);

    const { size } = await fs.stat(fichier);
    return {
      fichier: nom,
      octets: BigInt(size),
      sha256: await empreinte(fichier),
      verifiee: true,
    };
  });

/// Supprime les copies au-delà de la durée de conservation — sur le
/// disque, et hors site pour celles qui y avaient été envoyées.
export const purger = async () => {
  const maintenant = Date.now();
  const limites = {
    base: new Date(maintenant - env.sauvegardeRetentionJours * JOUR),
    fichiers: new Date(maintenant - env.sauvegardeFichiersSemaines * 7 * JOUR),
  };
  const anciennes = await prisma.sauvegarde.findMany({
    where: {
      OR: Object.entries(limites).map(([type, avant]) => ({ type, debut: { lt: avant } })),
      fichier: { not: null },
    },
  });
  if (!anciennes.length) return 0;

  const distant = await piloteHorsSite().catch(() => null);
  for (const s of anciennes) {
    await fs.rm(path.join(env.sauvegardeDossier, s.fichier), { force: true });
    if (s.horsSite && distant) {
      await distant.pilote.remove(cleHorsSite(distant.config, s.fichier)).catch(() => {});
    }
  }
  // L'historique garde la ligne — il dit qu'une sauvegarde a eu lieu —
  // mais plus le fichier.
  await prisma.sauvegarde.updateMany({
    where: { id: { in: anciennes.map((s) => s.id) } },
    data: { fichier: null },
  });
  return anciennes.length;
};

/// Une sauvegarde de ce type est-elle due ?
///
/// Due si la dernière réussie a plus d'une période, et qu'on a passé
/// l'heure prévue — ou, quoi qu'il en soit, si elle a plus d'une période
/// et demie : un serveur arrêté à l'heure prévue ne doit pas sauter un
/// jour.
export const estDue = (derniere, periode, heure, maintenant = new Date()) => {
  if (!derniere) return true;
  const age = maintenant - new Date(derniere);
  if (age > periode * 1.5) return true;
  return age > periode - 3600_000 && maintenant.getUTCHours() >= heure;
};

const derniereReussie = async (type) =>
  (
    await prisma.sauvegarde.findFirst({
      where: { type, statut: "ok" },
      orderBy: { debut: "desc" },
      select: { debut: true },
    })
  )?.debut || null;

let enCours = false;

/// Un passage du moteur : ferme les tentatives orphelines, lance ce qui est
/// dû, purge.
export const passage = async () => {
  if (enCours) return;
  enCours = true;
  try {
    // Une tentative « en cours » depuis trois heures est morte avec un
    // redémarrage : elle passe en échec, sinon elle mentirait pour toujours.
    await prisma.sauvegarde.updateMany({
      where: { statut: "en_cours", debut: { lt: new Date(Date.now() - 3 * 3600_000) } },
      data: { statut: "echec", erreur: "Interrompue (redémarrage du serveur ?)", fin: new Date() },
    });

    if (estDue(await derniereReussie("base"), JOUR, env.sauvegardeHeure)) {
      await sauvegarderBase("auto").catch(() => {});
    }
    if (
      env.storageDriver === "local" &&
      estDue(await derniereReussie("fichiers"), 7 * JOUR, env.sauvegardeHeure)
    ) {
      await sauvegarderFichiers("auto").catch(() => {});
    }
    await purger();
  } catch (e) {
    console.error("Moteur de sauvegarde :", e.message);
  } finally {
    enCours = false;
  }
};

/// Démarre le moteur : un premier passage cinq minutes après le démarrage
/// (laisser l'API se stabiliser), puis toutes les quinze minutes.
export const demarrerSauvegardes = async () => {
  if (!env.sauvegardeActive) return;
  try {
    await executer("pg_dump", ["--version"]);
  } catch {
    console.warn(
      "Sauvegardes automatiques inactives : pg_dump est introuvable sur ce serveur.",
    );
    return;
  }
  setTimeout(passage, 5 * 60_000).unref();
  setInterval(passage, 15 * 60_000).unref();
};

/// Le chemin local d'une sauvegarde, s'il existe encore — pour le
/// téléchargement depuis la console.
export const cheminLocal = async (nom) => {
  if (!nom || nom.includes("/") || nom.includes("..")) return null;
  const chemin = path.join(env.sauvegardeDossier, nom);
  try {
    await fs.access(chemin);
    return chemin;
  } catch {
    return null;
  }
};

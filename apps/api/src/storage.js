// Stockage des fichiers : où vont les octets.
//
// ─────────────────────────────────────────────────────────────────────────
// DEUX DESTINATIONS, ET AUCUNE MIGRATION À MENER
//
// L'exploitant choisit depuis la console Plateforme où atterrissent les
// fichiers : le disque du serveur, ou un stockage objet compatible S3
// (Amazon, Cloudflare R2, Wasabi, ou un NAS auto-hébergé sous MinIO).
//
// Le point important est ailleurs : **chaque fichier retient sa
// destination** (`FsNode.storage`). Basculer le SaaS vers S3 n'envoie donc
// rien nulle part — les nouveaux fichiers partent chez le fournisseur, les
// anciens continuent d'être lus depuis le disque. Il n'y a pas de fenêtre
// pendant laquelle les fichiers seraient introuvables, pas de migration
// qui peut échouer à mi-chemin, et revenir en arrière est tout aussi
// anodin.
//
// C'est le contraire du réglage global qui réécrit le chemin de tout le
// monde : celui-là perd des fichiers dès la première coupure réseau.
// ─────────────────────────────────────────────────────────────────────────

import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { env } from "./env.js";
import { prisma } from "./db.js";
import { chiffrer, dechiffrer } from "./chiffrement.js";
import { creerPiloteS3 } from "./stockage-s3.js";

/// Réduit un nom de fichier à quelque chose qui ne peut désigner qu'un
/// fichier, jamais un chemin.
///
/// Sans cela, téléverser un fichier nommé « ../../../../etc/passwd »
/// produisait une clé qui **sortait du dossier de stockage** :
/// `join("tenant", "uuid-../../../x")` se réduit à `../x`. N'importe quel
/// utilisateur authentifié pouvait donc écrire où le serveur a le droit
/// d'écrire. Le nom affiché à l'écran, lui, reste celui d'origine — il
/// vient de la base, pas du disque.
const nomSansChemin = (nom) => {
  let propre = String(nom || "fichier");
  // Séparateurs des deux familles de systèmes, et octet nul.
  propre = propre.replace(/[/\\]+/g, "_").replace(/\u0000/g, "");
  // « .. » ne désigne plus rien une fois les séparateurs partis, mais on
  // retire aussi les points de tête : un nom qui commence par un point est
  // caché sous Unix, et « . » seul n'est pas un nom.
  propre = propre.replace(/^\.+/, "").slice(0, 180);
  return propre || "fichier";
};

/// Vérifie qu'une clé reste bien à l'intérieur du dossier de stockage.
///
/// Seconde barrière, volontairement redondante avec `nomSansChemin` : une
/// clé peut aussi venir de la base — écrite par une version antérieure du
/// code, ou par une route qu'on aura oublié de nettoyer. Le jour où l'une
/// d'elles passe, elle échoue ici au lieu de lire ou d'effacer un fichier
/// du serveur.
const cheminSur = (key) => {
  const racine = resolve(env.storageLocalPath);
  const cible = resolve(racine, String(key || ""));
  if (cible !== racine && !cible.startsWith(racine + sep)) {
    throw new Error("Chemin de stockage hors du dossier autorisé.");
  }
  return cible;
};

/// Pilote disque local — la destination par défaut, et le repli si la
/// configuration objet est absente ou illisible.
const piloteLocal = {
  nom: "local",

  buildKey(tenantId, filename) {
    return join(tenantId, `${randomUUID()}-${nomSansChemin(filename)}`);
  },

  async put(key, stream) {
    const target = cheminSur(key);
    await mkdir(dirname(target), { recursive: true });
    await pipeline(stream, createWriteStream(target));
    const { size } = await stat(target);
    return size;
  },

  read(key) {
    return createReadStream(cheminSur(key));
  },

  /// Lecture d'une tranche d'octets, bornes comprises. C'est ce qui permet
  /// à une balise <video> de démarrer sans attendre le fichier entier et
  /// de se déplacer dans la timeline.
  readRange(key, start, end) {
    return createReadStream(cheminSur(key), { start, end });
  },

  async remove(key) {
    await rm(cheminSur(key), { force: true });
  },

  async tester() {
    const key = `_verification/${randomUUID()}.txt`;
    const cible = resolve(env.storageLocalPath, key);
    await mkdir(dirname(cible), { recursive: true });
    await pipeline(
      (async function* () { yield Buffer.from("companyos"); })(),
      createWriteStream(cible),
    );
    await rm(cible, { force: true });
    return true;
  },
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// La configuration vit en base pour être modifiable sans redéploiement :
/// un exploitant qui change de fournisseur ne doit pas avoir à éditer un
/// fichier d'environnement et à relancer le serveur.
///
/// Elle est mise en cache : chaque téléversement la lirait sinon.
let cache = null;

export const invaliderCacheStockage = () => {
  cache = null;
};

const CHAMPS_S3 = ["endpoint", "region", "bucket", "accessKey", "prefix"];

export const chargerConfig = async () => {
  if (cache) return cache;

  let ligne = null;
  try {
    ligne = await prisma.platformConfig.findUnique({ where: { id: "global" } });
  } catch {
    // La table n'existe pas encore (migration non appliquée) : on
    // fonctionne sur le disque local, comme avant.
    ligne = null;
  }

  const brut = ligne?.s3 || null;
  const s3 = brut
    ? { ...brut, secretKey: dechiffrer(brut.secretKey), pathStyle: brut.pathStyle !== false }
    : null;

  // Un secret illisible — clé de chiffrement changée — vaut « non
  // configuré » : mieux vaut retomber sur le disque que d'écrire dans le
  // vide en croyant que tout va bien.
  const utilisable = s3 && s3.endpoint && s3.bucket && s3.accessKey && s3.secretKey;

  cache = {
    stockage: ligne?.stockage === "s3" && utilisable ? "s3" : "local",
    demande: ligne?.stockage || "local",
    s3,
    utilisable: !!utilisable,
    secretIllisible: !!(brut?.secretKey && !s3?.secretKey),
  };
  return cache;
};

/// Enregistre la configuration. Le secret n'est réécrit que s'il est
/// fourni : l'écran ne le renvoie jamais en clair, donc le laisser vide
/// signifie « garde celui d'avant ».
export const enregistrerConfig = async ({ stockage, s3 }) => {
  const existant = await prisma.platformConfig.findUnique({ where: { id: "global" } });
  const ancien = existant?.s3 || {};

  const nouveau = s3
    ? {
        ...Object.fromEntries(CHAMPS_S3.map((c) => [c, s3[c] ?? ancien[c] ?? ""])),
        pathStyle: s3.pathStyle !== undefined ? !!s3.pathStyle : ancien.pathStyle !== false,
        secretKey: s3.secretKey ? chiffrer(s3.secretKey) : ancien.secretKey || null,
      }
    : ancien;

  await prisma.platformConfig.upsert({
    where: { id: "global" },
    create: { id: "global", stockage: stockage || "local", s3: nouveau },
    update: { stockage: stockage || "local", s3: nouveau },
  });

  invaliderCacheStockage();
  return chargerConfig();
};

// ---------------------------------------------------------------------------
// Choix du pilote
// ---------------------------------------------------------------------------

/// Le pilote où écrire les **nouveaux** fichiers.
export const piloteEcriture = async () => {
  const config = await chargerConfig();
  return config.stockage === "s3" ? creerPiloteS3(config.s3) : piloteLocal;
};

/// Le pilote d'un fichier **déjà écrit**, d'après ce qu'il a retenu.
///
/// Un fichier posé sur S3 se relit sur S3 même si l'exploitant est revenu
/// au disque entre-temps — c'est tout l'intérêt de retenir la destination.
export const piloteLecture = async (nom) => {
  if (nom !== "s3") return piloteLocal;
  const config = await chargerConfig();
  if (!config.utilisable) {
    throw new Error(
      "Ce fichier est sur le stockage objet, dont la configuration est absente ou illisible.",
    );
  }
  return creerPiloteS3(config.s3);
};

/// Essaie une configuration **sans l'enregistrer** : l'exploitant doit
/// pouvoir vérifier ses identifiants avant de basculer la plateforme.
export const testerConfig = async ({ stockage, s3 }) => {
  if (stockage !== "s3") return piloteLocal.tester();

  const existant = await prisma.platformConfig.findUnique({ where: { id: "global" } });
  const secret = s3?.secretKey || dechiffrer(existant?.s3?.secretKey);
  if (!secret) throw new Error("La clé secrète est absente.");

  return creerPiloteS3({
    endpoint: s3.endpoint,
    region: s3.region || "auto",
    bucket: s3.bucket,
    accessKey: s3.accessKey,
    secretKey: secret,
    prefix: s3.prefix || "",
    pathStyle: s3.pathStyle !== false,
  }).tester();
};

/// Compatibilité : le code existant importe `storage` et l'utilise
/// directement. Il continue de fonctionner sur le disque local ; les
/// routes migrées passent par `piloteEcriture` / `piloteLecture`.
export const storage = piloteLocal;

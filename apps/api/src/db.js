import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "@prisma/client";

/// Une base par entreprise.
///
/// La base de DATABASE_URL est la **base principale** : celle de la première
/// entreprise du serveur (servie sur le domaine nu), et le registre des
/// autres (table `bases_espaces`). Chaque entreprise ajoutée ensuite a sa
/// propre base PostgreSQL, avec le même schéma, sur le même serveur, et son
/// sous-domaine (<slug>.<DOMAINE>).
///
/// Le code n'a pas à savoir dans quelle base il écrit : `prisma` est un
/// aiguillage. Pendant une requête, il désigne la base de l'entreprise de
/// l'adresse visitée (voir `index.js`) ; dans une tâche de fond, celle que
/// `pourChaqueBase` lui donne ; ailleurs, la base principale. Le filtre
/// `tenantId` des requêtes reste en place : une seconde barrière.
///
/// Ce qui est propre au serveur et non à une entreprise (blocages d'adresses
/// IP, suivi des sauvegardes, journal des erreurs, réglages de la console)
/// s'écrit toujours dans la base principale, via `principal`.

export const principal = new PrismaClient();

const contexte = new AsyncLocalStorage();
const clients = new Map(); // nom de base → PrismaClient

/// L'adresse de connexion d'une autre base du même serveur.
export const urlDeBase = (nomBase, source = process.env.DATABASE_URL) => {
  const u = new URL(source);
  u.pathname = `/${nomBase}`;
  // Une entreprise de plus ne doit pas multiplier les connexions sans fin.
  if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", "5");
  return u.toString();
};

/// Le nom d'une base est passé à `CREATE DATABASE` : lettres, chiffres et
/// soulignés seulement, jamais une valeur venue d'un formulaire telle quelle.
export const NOM_BASE = /^[a-z][a-z0-9_]{2,50}$/;

const clientDe = (nomBase) => {
  if (!NOM_BASE.test(nomBase)) throw new Error(`Nom de base invalide : ${nomBase}`);
  let c = clients.get(nomBase);
  if (!c) {
    c = new PrismaClient({ datasources: { db: { url: urlDeBase(nomBase) } } });
    clients.set(nomBase, c);
  }
  return c;
};

/// Le client de la base courante (requête ou tâche de fond), sinon la
/// principale.
const courant = () => contexte.getStore()?.client ?? principal;

export const prisma = new Proxy(
  {},
  {
    get(_cible, prop) {
      const c = courant();
      const v = c[prop];
      return typeof v === "function" ? v.bind(c) : v;
    },
  },
);

/// L'entreprise dont on traite la requête ou la tâche : `null` pour la
/// base principale.
export const baseCourante = () => contexte.getStore()?.base ?? null;

/// Exécute `fn` dans la base d'une entreprise (`null` : la principale).
export const dansBase = (base, fn) => contexte.run(base ? { base, client: clientDe(base.nomBase) } : {}, fn);

/// Les entreprises qui ont leur propre base.
export const listerBases = () => principal.baseEspace.findMany({ orderBy: { creeLe: "asc" } });

/// Fait tourner une tâche de fond sur chaque base : la principale, puis
/// chaque entreprise. Une base en panne ne prive pas les autres.
export const pourChaqueBase = async (fn) => {
  await Promise.resolve(dansBase(null, () => fn(null))).catch((e) => console.error("Tâche (base principale) :", e.message));
  let bases = [];
  try {
    bases = await listerBases();
  } catch {
    // Registre absent (migration pas encore appliquée) : la principale suffit.
  }
  for (const b of bases) {
    await Promise.resolve(dansBase(b, () => fn(b))).catch((e) => console.error(`Tâche (${b.slug}) :`, e.message));
  }
};

/// Ferme toutes les connexions (arrêt du serveur, fin d'un script).
export const deconnecterTout = async () => {
  await Promise.all([principal.$disconnect(), ...[...clients.values()].map((c) => c.$disconnect())]);
};

/// Les BigInt (quota, taille) ne passent pas JSON.stringify tels quels.
/// On les sérialise en Number : au-delà de 9 Po on aura d'autres soucis.
export const serialize = (value) =>
  JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? Number(v) : v)),
  );

import { readFileSync } from "node:fs";
import { prisma } from "./db.js";
import { busActif, INSTANCE } from "./evenements.js";
import { OUBLI_MS } from "./etatPartage.js";
import { DUREE_CORBEILLE_JOURS } from "./versions.js";

/// La maintenance de la plateforme : l'état du serveur qui répond, et le
/// ménage des données périmées.
///
/// Le ménage tourne déjà tout seul (toutes les dix minutes pour l'état
/// partagé, chaque jour pour la détection). Le bouton de la console sert
/// après un incident — une attaque qui a rempli les tables de signaux, une
/// migration — quand on veut repartir propre sans attendre.

const JOUR = 86400_000;
/// Une session expirée ou révoquée reste lisible un mois dans « Mes
/// sessions » : c'est la trace d'une connexion, utile après un incident.
const SESSIONS_GARDEES_MS = 30 * JOUR;

const lireVersion = () => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version || null;
  } catch {
    return null;
  }
};
const VERSION = lireVersion();
const DEMARRE_LE = new Date();

/// Supprime ce qui a fait son temps. Rend le nombre de lignes par table.
export const purgerDonneesExpirees = async () => {
  const maintenant = Date.now();
  const avant = (ms) => new Date(maintenant - ms);
  const [jetons, verrous, sessions, signaux, blocages, versions] = await Promise.all([
    prisma.jetonUrl.deleteMany({ where: { expireLe: { lt: new Date(maintenant) } } }),
    prisma.verrouConnexion.deleteMany({ where: { dernier: { lt: avant(OUBLI_MS) } } }),
    prisma.session.deleteMany({
      where: {
        OR: [
          { expireLe: { lt: avant(SESSIONS_GARDEES_MS) } },
          { revoqueLe: { lt: avant(SESSIONS_GARDEES_MS) } },
        ],
      },
    }),
    prisma.signalSecurite.deleteMany({ where: { creeLe: { lt: avant(JOUR) } } }),
    prisma.ipBloquee.deleteMany({ where: { jusqua: { lt: avant(30 * JOUR) } } }),
    prisma.versionFiche.deleteMany({ where: { creeLe: { lt: avant(DUREE_CORBEILLE_JOURS * JOUR) } } }),
  ]);
  const lignes = {
    jetons: jetons.count,
    verrous: verrous.count,
    sessions: sessions.count,
    signaux: signaux.count,
    blocages: blocages.count,
    versions: versions.count,
  };
  return { lignes, total: Object.values(lignes).reduce((s, n) => s + n, 0) };
};

/// Ce qu'une purge supprimerait, sans rien supprimer.
export const compterDonneesExpirees = async () => {
  const maintenant = Date.now();
  const avant = (ms) => new Date(maintenant - ms);
  const [jetons, verrous, sessions, signaux, blocages, versions] = await Promise.all([
    prisma.jetonUrl.count({ where: { expireLe: { lt: new Date(maintenant) } } }),
    prisma.verrouConnexion.count({ where: { dernier: { lt: avant(OUBLI_MS) } } }),
    prisma.session.count({
      where: {
        OR: [
          { expireLe: { lt: avant(SESSIONS_GARDEES_MS) } },
          { revoqueLe: { lt: avant(SESSIONS_GARDEES_MS) } },
        ],
      },
    }),
    prisma.signalSecurite.count({ where: { creeLe: { lt: avant(JOUR) } } }),
    prisma.ipBloquee.count({ where: { jusqua: { lt: avant(30 * JOUR) } } }),
    prisma.versionFiche.count({ where: { creeLe: { lt: avant(DUREE_CORBEILLE_JOURS * JOUR) } } }),
  ]);
  const lignes = { jetons, verrous, sessions, signaux, blocages, versions };
  return { lignes, total: Object.values(lignes).reduce((s, n) => s + n, 0) };
};

/// L'instance qui répond : version, mémoire, base, bus.
export const etatServeur = async () => {
  const debut = process.hrtime.bigint();
  let latenceBase = null;
  let tailleBase = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    latenceBase = Number(process.hrtime.bigint() - debut) / 1e6;
    const [ligne] = await prisma.$queryRaw`SELECT pg_database_size(current_database())::bigint AS taille`;
    tailleBase = ligne?.taille ?? null;
  } catch {
    // Base injoignable : la console le montre (latence absente).
  }
  const [sessionsActives, personnes7j] = await Promise.all([
    prisma.session.count({ where: { revoqueLe: null, expireLe: { gt: new Date() } } }).catch(() => null),
    prisma.session
      .groupBy({ by: ["userId"], where: { vuLe: { gt: new Date(Date.now() - 7 * JOUR) } } })
      .then((l) => l.length)
      .catch(() => null),
  ]);
  const memoire = process.memoryUsage();
  return {
    instance: INSTANCE,
    version: VERSION,
    node: process.version,
    environnement: process.env.NODE_ENV || "development",
    demarreLe: DEMARRE_LE,
    dureeSecondes: Math.round(process.uptime()),
    memoire: { rss: memoire.rss, tas: memoire.heapUsed, tasTotal: memoire.heapTotal },
    bus: busActif(),
    base: { latenceMs: latenceBase, taille: tailleBase },
    sessionsActives,
    personnes7j,
  };
};

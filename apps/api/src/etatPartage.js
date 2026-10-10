import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db.js";

/// L'état que plusieurs instances de l'API doivent partager.
///
/// Il vivait dans des Map du processus : derrière un répartiteur de charge,
/// un lien de lecture vidéo créé par un serveur était refusé par le voisin,
/// et un attaquant qui tombait à chaque essai sur un serveur différent
/// voyait son compteur d'échecs repartir de zéro. Tout est désormais en
/// base — PostgreSQL est déjà le point commun de toutes les instances.

// ---------------------------------------------------------------------------
// Jetons d'URL
// ---------------------------------------------------------------------------
//
// Un jeton **opaque** (aléatoire, sans contenu) associé à une seule cible
// et à une échéance. La base ne garde que son empreinte : une copie de la
// table ne donne aucun lien utilisable.

const empreinte = (jeton) => createHash("sha256").update(jeton).digest("hex");
const nouveauJeton = () => randomBytes(16).toString("hex");

/// Plusieurs jetons d'un coup (une page web réécrit des centaines de
/// liens) : une seule requête.
export const creerJetons = async (type, tenantId, cibles, dureeMs) => {
  if (!cibles.length) return [];
  const expireLe = new Date(Date.now() + dureeMs);
  const jetons = cibles.map(() => nouveauJeton());
  await prisma.jetonUrl.createMany({
    data: jetons.map((jeton, i) => ({ empreinte: empreinte(jeton), type, tenantId, cible: cibles[i], expireLe })),
  });
  return jetons;
};

export const creerJeton = async (type, tenantId, cible, dureeMs) =>
  (await creerJetons(type, tenantId, [cible], dureeMs))[0];

/// { tenantId, cible } ou null (inconnu, échu, ou d'un autre type).
export const lireJeton = async (type, jeton) => {
  if (typeof jeton !== "string" || !/^[a-f0-9]{32}$/.test(jeton)) return null;
  const ligne = await prisma.jetonUrl.findUnique({ where: { empreinte: empreinte(jeton) } });
  if (!ligne || ligne.type !== type || ligne.expireLe.getTime() < Date.now()) return null;
  return { tenantId: ligne.tenantId, cible: ligne.cible };
};

/// Lit **et détruit** un jeton : pour ce qui ne doit servir qu'une fois
/// (réinitialisation de mot de passe, retour d'authentification unique).
/// La suppression est la vérification : deux requêtes simultanées avec le
/// même jeton, une seule l'obtient.
export const consommerJeton = async (type, jeton) => {
  if (typeof jeton !== "string" || !/^[a-f0-9]{32}$/.test(jeton)) return null;
  const e = empreinte(jeton);
  const ligne = await prisma.jetonUrl.findUnique({ where: { empreinte: e } });
  if (!ligne || ligne.type !== type || ligne.expireLe.getTime() < Date.now()) return null;
  const { count } = await prisma.jetonUrl.deleteMany({ where: { empreinte: e } });
  return count ? { tenantId: ligne.tenantId, cible: ligne.cible } : null;
};

/// Supprime tous les jetons d'un type pour une cible (ex. les liens de
/// réinitialisation encore valides d'un compte dont le mot de passe vient
/// de changer).
export const revoquerJetons = (type, cible) => prisma.jetonUrl.deleteMany({ where: { type, cible } });

export const compterJetons = (type, cible) =>
  prisma.jetonUrl.count({ where: { type, cible, expireLe: { gt: new Date() } } });

// ---------------------------------------------------------------------------
// Verrou de connexion par compte
// ---------------------------------------------------------------------------
//
// Après 5 échecs, chaque nouvel échec double l'attente (1 min, 2, 4…
// plafonnée à 15 min). Une heure sans échec efface tout. Les calculs de
// temps sont faits par la base : les horloges des serveurs peuvent
// différer, celle de PostgreSQL est la même pour tous.

export const ECHECS_AVANT_VERROU = 5;
export const VERROU_MAX_MS = 15 * 60 * 1000;
export const OUBLI_MS = 60 * 60 * 1000;

/// Millisecondes d'attente restantes avant un nouvel essai (0 : libre).
export const verrouDe = async (cle) => {
  const [ligne] = await prisma.$queryRaw`
    SELECT GREATEST(0, EXTRACT(EPOCH FROM ("jusqua" - now())) * 1000)::bigint AS attente
    FROM verrous_connexion
    WHERE cle = ${cle} AND "jusqua" IS NOT NULL
      AND "dernier" > now() - make_interval(secs => ${OUBLI_MS / 1000})`;
  return ligne ? Number(ligne.attente) : 0;
};

/// Délai du verrou après `n` échecs consécutifs.
export const dureeVerrou = (n) =>
  n < ECHECS_AVANT_VERROU ? 0 : Math.min(VERROU_MAX_MS, 60_000 * 2 ** (n - ECHECS_AVANT_VERROU));

/// Un échec de plus, compté de façon atomique : deux essais simultanés sur
/// deux serveurs comptent bien pour deux.
export const noterEchec = async (cle) => {
  const [{ echecs }] = await prisma.$queryRaw`
    INSERT INTO verrous_connexion (cle, echecs, dernier)
    VALUES (${cle}, 1, now())
    ON CONFLICT (cle) DO UPDATE SET
      echecs = CASE
        WHEN verrous_connexion."dernier" <= now() - make_interval(secs => ${OUBLI_MS / 1000}) THEN 1
        ELSE verrous_connexion.echecs + 1
      END,
      "jusqua" = CASE
        WHEN verrous_connexion."dernier" <= now() - make_interval(secs => ${OUBLI_MS / 1000}) THEN NULL
        ELSE verrous_connexion."jusqua"
      END,
      "dernier" = now()
    RETURNING echecs`;
  const duree = dureeVerrou(echecs);
  if (duree) {
    await prisma.$executeRaw`
      UPDATE verrous_connexion SET "jusqua" = now() + make_interval(secs => ${duree / 1000})
      WHERE cle = ${cle}`;
  }
  return echecs;
};

export const effacerEchecs = (cle) => prisma.verrouConnexion.deleteMany({ where: { cle } });

// ---------------------------------------------------------------------------
// Ménage
// ---------------------------------------------------------------------------

export const purgerEtatPartage = async () => {
  // L'historique des fiches se purge au même rythme (voir src/versions.js).
  await import("./versions.js").then((m) => m.purgerVersions()).catch(() => {});
  await prisma.jetonUrl.deleteMany({ where: { expireLe: { lt: new Date() } } });
  await prisma.verrouConnexion.deleteMany({ where: { dernier: { lt: new Date(Date.now() - OUBLI_MS) } } });
};

let minuteur = null;
export const demarrerPurgeEtatPartage = () => {
  if (minuteur) return;
  minuteur = setInterval(() => purgerEtatPartage().catch(() => {}), 10 * 60 * 1000);
  minuteur.unref();
};

import webpush from "web-push";
import { prisma } from "./db.js";
import { chiffrer, dechiffrer } from "./chiffrement.js";

/// Notifications push : l'appareil est prévenu même onglet fermé.
///
/// Le navigateur fournit une adresse (« endpoint ») chez le service de
/// push de son éditeur ; le serveur y poste un message chiffré que seul cet
/// appareil sait lire. Les clés VAPID identifient notre serveur auprès de
/// ces services.
///
/// Clés : `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` si l'environnement les
/// fournit, sinon générées au premier besoin et rangées en base, la clé
/// privée chiffrée (src/chiffrement.js). Toutes les instances partagent
/// ainsi les mêmes clés — un abonnement créé via l'une reste valable pour
/// l'autre.

/// Seuls les grands services de push sont acceptés. L'adresse vient du
/// navigateur, donc du client : sans cette liste, n'importe qui ferait
/// poster notre serveur vers une adresse de son choix (réseau interne
/// compris).
const SERVICES = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

export const endpointAccepte = (endpoint) => {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && !u.username && SERVICES.some((r) => r.test(u.hostname));
  } catch {
    return false;
  }
};

const CLE_VAPID = "push.vapid";
const SUJET = process.env.VAPID_SUBJECT || "mailto:support@companyos.fr";
let cles = null;

/// { publicKey, privateKey } — créées une seule fois pour toute la plateforme.
export const clesVapid = async () => {
  if (cles) return cles;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cles = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    return cles;
  }
  const lire = async () => {
    const ligne = await prisma.parametreSysteme.findUnique({ where: { cle: CLE_VAPID } });
    const privateKey = ligne && dechiffrer(ligne.valeur?.prive);
    return privateKey ? { publicKey: ligne.valeur.public, privateKey } : null;
  };
  cles = await lire();
  if (cles) return cles;
  const neuves = webpush.generateVAPIDKeys();
  // Deux instances qui démarrent ensemble : la première écrit, la seconde
  // relit ce que la première a écrit.
  await prisma.parametreSysteme
    .create({ data: { cle: CLE_VAPID, valeur: { public: neuves.publicKey, prive: chiffrer(neuves.privateKey) } } })
    .catch(() => {});
  cles = await lire();
  return cles;
};

/// Ce que reçoit le service worker : de quoi afficher et où aller au clic.
export const chargeNotification = (n) =>
  JSON.stringify({
    id: n.id || null,
    titre: String(n.titre || "").slice(0, 140),
    message: String(n.message || "").slice(0, 300),
    source: n.source || null,
    lien: n.lien || null,
  });

/// Envoie à tous les appareils de ces personnes. Ne lève jamais.
/// `envoyer` est injectable pour les tests.
export const pousser = async (userIds, notification, { envoyer = webpush.sendNotification } = {}) => {
  if (!userIds.length) return { envoyes: 0 };
  let abonnements;
  try {
    abonnements = await prisma.abonnementPush.findMany({ where: { userId: { in: userIds } } });
  } catch {
    return { envoyes: 0 };
  }
  if (!abonnements.length) return { envoyes: 0 };
  const vapid = await clesVapid().catch(() => null);
  if (!vapid) return { envoyes: 0 };

  const charge = chargeNotification(notification);
  let envoyes = 0;
  await Promise.all(
    abonnements.map(async (a) => {
      if (!endpointAccepte(a.endpoint)) return;
      try {
        await envoyer({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, charge, {
          vapidDetails: { subject: SUJET, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
          TTL: 6 * 60 * 60,
          urgency: "normal",
          timeout: 10_000,
        });
        envoyes += 1;
      } catch (err) {
        // 404 / 410 : l'appareil s'est désabonné (ou a été réinitialisé).
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await prisma.abonnementPush.deleteMany({ where: { id: a.id } }).catch(() => {});
        }
      }
    }),
  );
  return { envoyes };
};

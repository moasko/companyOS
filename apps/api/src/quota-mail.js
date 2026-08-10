// Plafond d'envoi de courriels, par espace de travail et par 24 h.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI
//
// Trois chemins font partir un courriel depuis CompanyOS :
//
//   - l'app Courrier      (routes/courrier.js — envoi manuel)
//   - le moteur de campagnes (campagnes.js — envoi de masse programmé)
//   - les relances de factures (relances.js — envoi automatique)
//
// Tous les trois aboutissent au même relais SMTP, avec le nom de
// l'entreprise en expéditeur, et engagent la réputation SPF/DKIM du
// domaine — celui du client quand il a configuré son relais, celui de la
// plateforme sinon.
//
// Le compte à rebours est **commun aux trois** : le tenir par chemin
// permettrait d'additionner les trois plafonds, et c'est justement quand
// quelqu'un abuse qu'il empruntera les trois. Il est aussi tenu **par
// espace** et pas par utilisateur : ce qu'on protège, c'est la réputation
// d'un domaine, qui est une propriété de l'espace.
//
// Ce n'est pas une protection contre un attaquant patient — 500 messages
// par jour suffisent à nuire si on s'y prend bien. C'est une limite de
// dégât : le temps qu'on remarque l'anomalie dans le journal, elle est
// bornée, l'IP n'est pas encore sur liste noire, et les autres espaces
// continuent de recevoir leurs factures.
// ─────────────────────────────────────────────────────────────────────────

import { prisma } from "./db.js";
import { env } from "./env.js";

/// Le jour courant en UTC, au format AAAA-MM-JJ.
///
/// UTC et pas l'heure locale du serveur : un changement de fuseau ou
/// d'heure d'été ne doit pas offrir un second quota dans la même journée,
/// ni en supprimer un.
const jourCourant = () => new Date().toISOString().slice(0, 10);

/// Ce qu'il reste à envoyer aujourd'hui pour cet espace.
///
/// Sert à décider **avant** de préparer un lot : inutile de rendre 200
/// destinataires, de composer 200 messages et de les remettre au relais un
/// par un pour découvrir au 3ᵉ qu'on est au plafond.
export const resteAEnvoyer = async (tenantId) => {
  const ligne = await prisma.mailCompteur.findUnique({
    where: { tenantId_jour: { tenantId, jour: jourCourant() } },
  });
  return Math.max(0, env.mailQuotaJour - (ligne?.envoyes ?? 0));
};

/// Enregistre `nombre` envois réussis. Rend le total du jour après coup.
///
/// L'`upsert` sur la contrainte unique `(tenantId, jour)` rend l'opération
/// atomique côté base : deux envois concurrents ne peuvent pas lire le
/// même compteur et écrire chacun « +1 » sur la même valeur. C'est la
/// raison d'être de l'index unique de la migration.
///
/// On ne compte que ce qui est **effectivement parti** : un relais mal
/// configuré épuiserait sinon le quota d'un espace sans qu'un seul message
/// n'arrive, et l'administrateur chercherait longtemps.
export const compterEnvois = async (tenantId, nombre = 1) => {
  if (nombre <= 0) return 0;
  const ligne = await prisma.mailCompteur.upsert({
    where: { tenantId_jour: { tenantId, jour: jourCourant() } },
    create: { tenantId, jour: jourCourant(), envoyes: nombre },
    update: { envoyes: { increment: nombre } },
  });
  return ligne.envoyes;
};

/// Vrai si l'espace a encore le droit d'envoyer `nombre` messages.
export const peutEnvoyer = async (tenantId, nombre = 1) =>
  (await resteAEnvoyer(tenantId)) >= nombre;

/// Le message à montrer quand le plafond est atteint. Il dit quoi faire :
/// « réessayez » sans horizon est la pire réponse possible pour quelqu'un
/// qui a une facture à envoyer.
export const messageQuotaAtteint = () =>
  `Cet espace a atteint son plafond de ${env.mailQuotaJour} courriels sur 24 heures. ` +
  `Les envois reprennent demain. Si ce plafond ne correspond pas à votre usage, ` +
  `l'exploitant de la plateforme peut le relever.`;

/// Purge les compteurs de plus de 90 jours.
///
/// Une ligne par espace et par jour, c'est peu — mais rien ne les efface
/// sans cela, et une table qui ne fait que croître finit par se remarquer.
/// Trois mois suffisent à constater un pic après coup.
export const purgerCompteurs = async () => {
  const limite = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const { count } = await prisma.mailCompteur.deleteMany({
    where: { jour: { lt: limite } },
  });
  return count;
};

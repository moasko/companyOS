import { prisma } from "./db.js";
import { publierNotification } from "./evenements.js";
import { pousser } from "./push.js";

/// Le seul chemin pour créer des notifications côté serveur : la route
/// d'envoi, les règles des apps du Studio, les automatisations. Il range
/// en base, prévient les navigateurs ouverts (bus d'événements) et les
/// appareils abonnés au push.
///
/// `userIds` doivent déjà appartenir à `tenantId` : c'est à l'appelant de
/// les avoir choisis dans l'espace.
export const notifier = async (tenantId, userIds, { auteurId = null, auteurNom = null, source, titre, message = null, lien = null }) => {
  const cibles = [...new Set(userIds)].filter(Boolean);
  if (!cibles.length) return 0;
  await prisma.notification.createMany({
    data: cibles.map((userId) => ({
      tenantId,
      userId,
      auteurId,
      auteurNom,
      source,
      titre,
      message: message || null,
      lien: lien ?? undefined,
    })),
  });
  for (const userId of cibles) publierNotification({ tenantId, userId });
  // Le push part en arrière-plan : la requête qui notifie n'attend pas
  // les services de Google ou d'Apple.
  pousser(cibles, { titre, message, source, lien }).catch(() => {});
  return cibles.length;
};

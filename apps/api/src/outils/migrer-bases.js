// Au démarrage du conteneur, après la base principale : migrations et
// catalogue de chaque base d'entreprise (voir src/entreprises.js).
// Une base en échec est signalée sans empêcher l'API de démarrer.
//
// Serveur auto-hébergé : les espaces créés avant que le mode existe (ou par
// une ancienne version) quittent les formules payantes — formule
// Entreprise (utilisateurs illimités), quota borné par le disque.

import { deconnecterTout, pourChaqueBase, prisma } from "../db.js";
import { mettreAniveauToutes } from "../entreprises.js";
import { env } from "../env.js";
import { QUOTA_AUTO_HEBERGE } from "../espaces.js";

await mettreAniveauToutes();

if (env.autoHeberge) {
  await pourChaqueBase(async (base) => {
    const quota = env.defaultTenantQuota ?? QUOTA_AUTO_HEBERGE;
    const { count } = await prisma.tenant.updateMany({
      where: { OR: [{ plan: { not: "ENTERPRISE" } }, { quota: { lt: quota } }] },
      data: { plan: "ENTERPRISE", quota },
    });
    if (count) console.warn(`${base?.slug ?? "Base principale"} : ${count} espace(s) passé(s) sans formule (serveur auto-hébergé).`);
  });
}

await deconnecterTout();

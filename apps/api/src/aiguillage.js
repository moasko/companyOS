// Aiguillage des requêtes vers la base de leur entreprise (voir db.js).
//
//   <DOMAINE> et www.<DOMAINE>   → base principale (première entreprise)
//   <slug>.<DOMAINE>             → base de l'entreprise <slug> ; inconnue : 404
//   domaine personnalisé déclaré → base de l'entreprise qui l'a déclaré
//   tout autre nom (IP, localhost, serveur sans DOMAINE) → base principale

import { dansBase, principal } from "./db.js";
import { env } from "./env.js";

const DUREE_MS = 30_000;
const cache = new Map(); // nom d'hôte → { base, le }

export const oublierAiguillage = () => cache.clear();

/// La base d'un nom d'hôte : `null` (principale), une ligne du registre, ou
/// `undefined` quand le sous-domaine ne correspond à aucune entreprise.
export const baseDuNom = async (hote) => {
  const h = String(hote || "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const c = cache.get(h);
  if (c && Date.now() - c.le < DUREE_MS) return c.base;
  let base = null;
  if (env.domaine && h !== env.domaine && h !== `www.${env.domaine}`) {
    if (h.endsWith(`.${env.domaine}`)) {
      const slug = h.slice(0, -(env.domaine.length + 1));
      base = (!slug.includes(".") && (await principal.baseEspace.findUnique({ where: { slug } }))) || undefined;
    } else {
      base = (await principal.baseEspace.findUnique({ where: { domaine: h } }).catch(() => null)) || null;
    }
  }
  if (cache.size > 1000) cache.clear();
  cache.set(h, { base, le: Date.now() });
  return base;
};

/// Crochet `onRequest` : le reste de la requête (crochets suivants et
/// gestionnaire) s'exécute dans la base de l'entreprise visée.
export const aiguillerRequete = (request, reply, done) => {
  baseDuNom(request.hostname).then(
    (base) => {
      if (base === undefined) {
        reply.code(404).send({ error: "Aucune entreprise à cette adresse sur ce serveur." });
        return;
      }
      dansBase(base, done);
    },
    (e) => done(e),
  );
};

/// Un espace d'une base d'entreprise déclare (ou retire) son domaine
/// personnalisé : le registre le retient pour aiguiller ce nom vers sa base.
/// Sans effet pour la base principale (son domaine reste dans `tenants`).
export const noterDomaineEntreprise = async (base, domaine) => {
  if (!base) return;
  await principal.baseEspace.update({ where: { slug: base.slug }, data: { domaine } });
  oublierAiguillage();
};

/// Ce domaine est-il déjà pris par une autre entreprise du serveur ?
export const domaineDejaPris = async (domaine, base) => {
  const ailleurs = await principal.baseEspace.findUnique({ where: { domaine } });
  if (ailleurs && ailleurs.slug !== base?.slug) return true;
  if (base) return !!(await principal.tenant.findFirst({ where: { domainePublic: domaine }, select: { id: true } }));
  return false;
};

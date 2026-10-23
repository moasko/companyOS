import { prisma, principal } from "../db.js";
import { env } from "../env.js";
import { preuveDomaine } from "../espacePublic.js";

/// Le proxy HTTPS (Caddy, installé par install.sh) obtient ses certificats
/// à la demande, au premier accès à un nom. Avant chaque demande il pose la
/// question ici : sans ce filtre, n'importe qui pourrait pointer mille noms
/// vers le serveur et lui faire épuiser son quota Let's Encrypt.
///
/// Autorisés : le domaine du serveur, son `www.`, le sous-domaine d'une
/// entreprise qui a sa base (<slug>.<domaine>, voir src/db.js) et le domaine
/// personnalisé déclaré par un espace.
export const domaineAutorise = async (nom) => {
  const d = String(nom || "").trim().toLowerCase().replace(/\.$/, "");
  if (!d || d.length > 253 || !/^[a-z0-9.-]+$/.test(d)) return false;
  if (env.domaine && (d === env.domaine || d === `www.${env.domaine}`)) return true;
  if (env.domaine && d.endsWith(`.${env.domaine}`)) {
    const slug = d.slice(0, -(env.domaine.length + 1));
    return !slug.includes(".") && !!(await principal.baseEspace.findUnique({ where: { slug }, select: { slug: true } }));
  }
  if (await principal.baseEspace.findUnique({ where: { domaine: d }, select: { slug: true } })) return true;
  return !!(await principal.tenant.findFirst({ where: { domainePublic: d }, select: { id: true } }));
};

/// Routes publiques diverses : /api/public/…
///
/// /verification/:espace — appelée par le serveur lui-même, par le domaine
/// personnalisé qu'un espace veut utiliser (voir src/espacePublic.js). Elle
/// ne répond que si ce domaine est bien celui que l'espace a déclaré : un
/// domaine qui pointe déjà vers la plateforme ne peut pas être revendiqué
/// par un autre espace.
export default async function publicsRoutes(app) {
  /// Ce que l'écran de connexion doit savoir du serveur avant toute session.
  app.get("/serveur", async () => ({ inscriptionOuverte: env.inscriptionOuverte, domaine: env.domaine || null }));

  /// Question du proxy HTTPS : « puis-je demander un certificat pour ce nom ? »
  /// (`?domain=` est le paramètre fixé par Caddy). 200 = oui, 404 = non.
  app.get("/tls", async (request, reply) => {
    if (await domaineAutorise(request.query?.domain)) return { ok: true };
    return reply.code(404).send({ error: "Domaine inconnu" });
  });

  app.get("/verification/:espace", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const hote = String(request.hostname || "").split(":")[0].toLowerCase();
    const t = await prisma.tenant.findUnique({ where: { id: String(request.params.espace) }, select: { domainePublic: true } });
    if (!t?.domainePublic || t.domainePublic !== hote) return reply.code(404).send({ error: "Introuvable" });
    return { companyos: true, preuve: preuveDomaine(request.params.espace, hote) };
  });
}

import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { abonner, publier } from "./evenements.js";
import { lireJsonExterne } from "./web.js";
import { declarerCache } from "./caches.js";

/// Les liens publics d'un espace : sous quelle adresse ils partent, et le
/// « sel » du lien de son formulaire d'inscription.
///
/// Domaine personnalisé : un espace peut faire partir ses liens publics
/// (partage de fichiers, formulaire, désinscription, suivi des campagnes)
/// sous son propre nom — `liens.entreprise.ci` plutôt que l'adresse de la
/// plateforme. Le domaine pointe (CNAME) vers l'API ; il n'est utilisé
/// qu'après une **vérification** : le serveur s'appelle lui-même par ce
/// domaine, en https, et doit y trouver une preuve que lui seul sait
/// calculer. Sur ce domaine, seules les routes publiques répondent (voir
/// `filtrerDomainePublic`).

const DOMAINE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const DUREE_CACHE_MS = 60_000;

export const baseDefaut = () => (env.apiPublique || `http://localhost:${env.port}`).replace(/\/+$/, "");

export const normaliserDomaine = (brut) => {
  const d = String(brut || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  return DOMAINE.test(d) ? d : null;
};

// ---- Cache par espace, et liste des domaines vérifiés ----------------------

const cache = new Map(); // tenantId → { le, valeur }
let domaines = { le: 0, ensemble: new Set() };

declarerCache("espaces-publics", {
  libelle: "Pages et liens publics",
  description: "Domaine vérifié et clé de formulaire de chaque espace, et la liste des domaines personnalisés.",
  taille: () => cache.size + domaines.ensemble.size,
  vider: () => {
    cache.clear();
    domaines = { le: 0, ensemble: new Set() };
  },
});

export const invaliderEspacePublic = (tenantId) => {
  cache.delete(tenantId);
  domaines.le = 0;
  publier({ type: "espace-public", t: tenantId });
};

let desabonner = null;
export const demarrerEspacePublic = () => {
  if (desabonner) return;
  desabonner = abonner((evt) => {
    if (evt?.type !== "espace-public") return;
    cache.delete(evt.t);
    domaines.le = 0;
  });
};

const reglagesDe = async (tenantId) => {
  const c = cache.get(tenantId);
  if (c && Date.now() - c.le < DUREE_CACHE_MS) return c.valeur;
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { selFormulaire: true, domainePublic: true, domainePublicVerifie: true },
  });
  const valeur = {
    sel: t?.selFormulaire || null,
    domaine: t?.domainePublic && t.domainePublicVerifie ? t.domainePublic : null,
  };
  cache.set(tenantId, { le: Date.now(), valeur });
  if (cache.size > 20_000) cache.clear();
  return valeur;
};

/// L'adresse de base des liens publics de cet espace.
export const basePublique = async (tenantId) => {
  if (!tenantId) return baseDefaut();
  const { domaine } = await reglagesDe(tenantId).catch(() => ({}));
  return domaine ? `https://${domaine}` : baseDefaut();
};

export const selFormulaire = async (tenantId) => (await reglagesDe(tenantId).catch(() => ({}))).sel || null;

/// « Régénérer » : nouveau sel, l'ancien lien cesse aussitôt de valoir.
export const regenererSelFormulaire = async (tenantId) => {
  await prisma.tenant.update({ where: { id: tenantId }, data: { selFormulaire: randomBytes(9).toString("base64url") } });
  invaliderEspacePublic(tenantId);
};

/// Domaines personnalisés vérifiés, toutes espaces confondues.
const domainesVerifies = async () => {
  if (Date.now() - domaines.le < DUREE_CACHE_MS) return domaines.ensemble;
  const lignes = await prisma.tenant.findMany({
    where: { domainePublic: { not: null }, domainePublicVerifie: { not: null } },
    select: { domainePublic: true },
  });
  domaines = { le: Date.now(), ensemble: new Set(lignes.map((l) => l.domainePublic)) };
  return domaines.ensemble;
};

/// Préfixes servis sur un domaine personnalisé : les pages et ressources
/// publiques, rien d'autre. L'espace de travail, les fichiers privés et
/// l'authentification ne répondent que sur l'adresse de la plateforme.
const PUBLICS = [
  "/api/public/",
  "/api/campagnes/inscription",
  "/api/campagnes/desinscription",
  "/api/campagnes/clic",
  "/api/campagnes/ouverture",
  "/api/campagnes/logo",
  "/api/campagnes/image",
];

export const routePublique = (url) => PUBLICS.some((p) => String(url || "").startsWith(p));

/// Crochet `onRequest` : sur un domaine personnalisé, tout ce qui n'est pas
/// public répond 404, comme si la route n'existait pas.
export const filtrerDomainePublic = async (request, reply) => {
  const hote = String(request.hostname || "").split(":")[0].toLowerCase();
  if (!hote || !hote.includes(".")) return;
  if (routePublique(request.raw.url)) return;
  if ((await domainesVerifies().catch(() => new Set())).has(hote)) {
    return reply.code(404).send({ error: "Introuvable" });
  }
};

// ---- Vérification ---------------------------------------------------------

/// La preuve qu'une requête arrivée par `domaine` a bien atteint notre
/// serveur : HMAC du domaine et de l'espace avec le secret du serveur.
export const preuveDomaine = (tenantId, domaine) =>
  createHmac("sha256", env.jwtSecret).update(`domaine-public.${tenantId}.${domaine}`).digest("hex").slice(0, 32);

/// Appelle `https://<domaine>/api/public/verification/<espace>` et compare
/// la preuve. Lève avec un message lisible si quelque chose manque (DNS,
/// certificat, mauvaise cible).
export const verifierDomaine = async (tenantId, domaine) => {
  let r;
  try {
    r = await lireJsonExterne(`https://${domaine}/api/public/verification/${encodeURIComponent(tenantId)}`);
  } catch (err) {
    throw new Error(
      `Le domaine ne répond pas encore en https (${err.message}). Vérifiez l'enregistrement DNS et le certificat.`,
    );
  }
  if (r?.companyos !== true || r.preuve !== preuveDomaine(tenantId, domaine)) {
    throw new Error("Le domaine répond, mais pas avec ce serveur CompanyOS. Vérifiez la cible de l'enregistrement CNAME.");
  }
};

// Création de l'espace de démonstration, depuis le serveur.
//
//   npm run demo --workspace @companyos/api
//   npm run demo --workspace @companyos/api -- --email demo@companyos.fr --mot-de-passe "…"
//   npm run demo --workspace @companyos/api -- --reinitialiser
//   (dans le conteneur : node src/demo/index.js --reinitialiser)
//
// Crée l'espace « Akwaba Distribution », son équipe de six comptes, installe
// toutes les applications et les remplit (voir construire.js). Tous les
// comptes de la démo partagent le même mot de passe, affiché une seule fois :
// on peut ainsi se connecter en caissière ou en commerciale pendant une
// présentation pour montrer les droits.
//
// --reinitialiser efface l'espace de démo existant (repéré par l'adresse du
// propriétaire) et le recrée à l'identique, daté d'aujourd'hui. Par
// sécurité, il refuse d'effacer un espace qui ne porte pas le nom de la démo.

import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { prisma } from "../db.js";
import { hashPassword, normaliserEmail } from "../auth.js";
import { creerEspace } from "../espaces.js";
import { formuleDe } from "../formules.js";
import { consommerQuota, ecrireOuNettoyer, piloteEcriture, piloteLecture } from "../storage.js";
import { typeNeutralise } from "../mimetype.js";
import { construireDemo, emailMembre, ENTREPRISE, EQUIPE } from "./construire.js";

const option = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : defaut;
};
const drapeau = (nom) => process.argv.includes(`--${nom}`);

const email = normaliserEmail(option("email", "demo@companyos.fr"));
const motDePasse = option("mot-de-passe", null) || randomBytes(12).toString("base64url");
const reinitialiser = drapeau("reinitialiser");

if (!email) {
  console.error("Adresse invalide. Usage : node src/demo/index.js [--email demo@exemple.ci] [--mot-de-passe …] [--reinitialiser]");
  process.exit(1);
}
if (motDePasse.length < 10) {
  console.error("Le mot de passe de la démo doit faire au moins 10 caractères.");
  process.exit(1);
}

/// Efface un espace et tout ce qui lui appartient, fichiers compris. Les
/// tables sans suppression en cascade sont vidées à la main.
const effacerEspace = async (tenantId) => {
  const noeuds = await prisma.fsNode.findMany({ where: { tenantId, type: "FILE", storageKey: { not: null } }, select: { storage: true, storageKey: true } });
  for (const n of noeuds) {
    try {
      const pilote = await piloteLecture(n.storage, tenantId);
      await pilote.remove(n.storageKey);
    } catch {
      // Un fichier déjà absent du stockage n'empêche pas l'effacement.
    }
  }
  const parTenant = { where: { tenantId } };
  const boites = await prisma.boiteCourriel.findMany({ ...parTenant, select: { id: true } });
  const automatisations = await prisma.automatisation.findMany({ ...parTenant, select: { id: true } });
  await prisma.$transaction([
    prisma.courriel.deleteMany(parTenant),
    prisma.boiteCourriel.deleteMany({ where: { id: { in: boites.map((b) => b.id) } } }),
    prisma.executionAutomatisation.deleteMany({ where: { automatisationId: { in: automatisations.map((a) => a.id) } } }),
    prisma.versionFiche.deleteMany(parTenant),
    prisma.versionFichier.deleteMany(parTenant),
    prisma.lienPartage.deleteMany(parTenant),
    prisma.jetonUrl.deleteMany(parTenant),
    prisma.abonnementPush.deleteMany(parTenant),
    prisma.erreurApp.deleteMany(parTenant),
    prisma.alerteSecurite.deleteMany(parTenant),
    prisma.signalSecurite.deleteMany(parTenant),
    prisma.tenant.delete({ where: { id: tenantId } }),
  ]);
};

/// Range un fichier dans le Cloud de l'espace, avec l'identifiant choisi
/// par le générateur (les fiches qui le citent le connaissent déjà).
const ranger = async (tenantId, ownerId, parentId, f) => {
  const pilote = await piloteEcriture(tenantId);
  const cle = pilote.buildKey(tenantId, f.nom);
  const taille = await ecrireOuNettoyer(pilote, cle, Readable.from(f.contenu));
  await prisma.$transaction(async (tx) => {
    await tx.fsNode.create({
      data: { id: f.id, tenantId, ownerId, parentId, name: f.nom, type: "FILE", size: BigInt(taille), mimeType: typeNeutralise(f.type), storageKey: cle, storage: pilote.nom },
    });
    await consommerQuota(tx, tenantId, taille);
  });
  return taille;
};

const debut = Date.now();
const existant = await prisma.user.findUnique({ where: { email }, include: { tenant: true } });
if (existant) {
  if (!reinitialiser) {
    console.error(`Un compte ${email} existe déjà (espace « ${existant.tenant.name} »). Relancez avec --reinitialiser pour recréer la démo.`);
    process.exit(1);
  }
  if (existant.tenant.name !== ENTREPRISE) {
    console.error(`L'espace de ${email} s'appelle « ${existant.tenant.name} », pas « ${ENTREPRISE} » : ce n'est pas une démo, il ne sera pas effacé.`);
    process.exit(1);
  }
  await effacerEspace(existant.tenantId);
  console.warn("Ancienne démo effacée.");
}

// Les adresses de l'équipe sont fictives ; un reste d'une démo effacée à la
// main ne doit pas bloquer la création.
const autresEmails = EQUIPE.slice(1).map(emailMembre);
const pris = await prisma.user.findMany({ where: { email: { in: autresEmails } }, include: { tenant: true } });
for (const u of pris) {
  if (u.tenant.name !== ENTREPRISE) {
    console.error(`L'adresse ${u.email} est déjà utilisée par l'espace « ${u.tenant.name} ». Démo non créée.`);
    process.exit(1);
  }
  await effacerEspace(u.tenantId);
}

const passwordHash = await hashPassword(motDePasse);
const proprio = EQUIPE[0];
const { tenant, user } = await creerEspace({ company: ENTREPRISE, name: `${proprio.prenom} ${proprio.nom}`, email, passwordHash });
const formule = formuleDe("ENTERPRISE");
await prisma.tenant.update({ where: { id: tenant.id }, data: { plan: "ENTERPRISE", quota: BigInt(formule.quota) } });

const membres = { [proprio.cle]: { id: user.id, email, name: user.name } };
for (const m of EQUIPE.slice(1)) {
  const u = await prisma.user.create({ data: { tenantId: tenant.id, email: emailMembre(m), name: `${m.prenom} ${m.nom}`, passwordHash, role: m.role } });
  membres[m.cle] = { id: u.id, email: u.email, name: u.name };
}
// Koffi n'a pas de compte : ses fiches sont au nom de la commerciale.
membres.koffi = null;

// Toutes les applications du catalogue (la console Plateforme exceptée).
const catalogue = await prisma.app.findMany({ where: { tenantId: null, published: true, slug: { not: "plateforme" } } });
const deja = new Set((await prisma.installation.findMany({ where: { tenantId: tenant.id }, select: { appId: true } })).map((i) => i.appId));
await prisma.installation.createMany({
  data: catalogue.filter((a) => !deja.has(a.id)).map((a) => ({ tenantId: tenant.id, userId: user.id, appId: a.id, version: a.version || null })),
});

const d = construireDemo({ tenantId: tenant.id, membres: Object.fromEntries(Object.entries(membres).filter(([, v]) => v)) });

// Fichiers du Cloud, rangés par dossier (créé au besoin à la racine).
const dossiers = new Map((await prisma.fsNode.findMany({ where: { tenantId: tenant.id, parentId: null, type: "FOLDER" } })).map((n) => [n.name, n.id]));
const tailles = new Map();
for (const f of d.fichiers) {
  if (!dossiers.has(f.dossier)) {
    const n = await prisma.fsNode.create({ data: { tenantId: tenant.id, ownerId: user.id, parentId: null, name: f.dossier, type: "FOLDER" } });
    dossiers.set(f.dossier, n.id);
  }
  tailles.set(f.id, await ranger(tenant.id, user.id, dossiers.get(f.dossier), f));
}
// Les justificatifs connaissent maintenant leur taille.
for (const r of d.records) {
  const j = r.data?.justificatif;
  if (j?.id && tailles.has(j.id)) j.size = tailles.get(j.id);
}

for (let i = 0; i < d.records.length; i += 500) {
  await prisma.record.createMany({ data: d.records.slice(i, i + 500) });
}
await prisma.courriel.createMany({ data: d.courriels });
await prisma.notification.createMany({ data: d.notifications });
await prisma.automatisation.createMany({ data: d.automatisations });

const parApp = d.records.reduce((m, r) => m.set(r.module, (m.get(r.module) || 0) + 1), new Map());
console.warn(`\nEspace « ${ENTREPRISE} » créé en ${Math.round((Date.now() - debut) / 1000)} s :`);
console.warn(`  ${catalogue.length} applications, ${d.records.length} fiches, ${d.fichiers.length} fichiers, ${d.courriels.length} courriels`);
console.warn(`  ${[...parApp].map(([m, n]) => `${m} ${n}`).join(" · ")}`);
console.warn("\nComptes (même mot de passe pour tous) :");
for (const m of EQUIPE) console.warn(`  ${m.prenom} ${m.nom}`.padEnd(22) + `${m.poste}`.padEnd(26) + membres[m.cle].email);
console.warn(`\n  Mot de passe : ${motDePasse}\n`);
console.warn("Relancez avec --reinitialiser avant chaque présentation : les dates suivent le jour même.");

await prisma.$disconnect();

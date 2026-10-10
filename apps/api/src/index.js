import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { env } from "./env.js";
import { prisma } from "./db.js";
import { idDuJeton } from "./auth.js";
import authRoutes from "./routes/auth.js";
import appRoutes from "./routes/apps.js";
import fileRoutes from "./routes/files.js";
import recordRoutes from "./routes/records.js";
import auditRoutes from "./routes/audit.js";
import notificationRoutes from "./routes/notifications.js";
import webRoutes from "./routes/web.js";
import billingRoutes from "./routes/billing.js";
import courrierRoutes from "./routes/courrier.js";
import { demarrerRelances } from "./relances.js";
import campagnesRoutes from "./routes/campagnes.js";
import espaceRoutes from "./routes/espace.js";
import plateformeRoutes from "./routes/plateforme.js";
import { demarrerCampagnes } from "./campagnes.js";
import erreursRoutes from "./routes/erreurs.js";
import { consigner, gestionnaireErreurs } from "./erreurs.js";
import { demarrerSauvegardes } from "./sauvegardes.js";
import { demarrerPurgeEtatPartage } from "./etatPartage.js";
import { arreterBus, demarrerBus } from "./evenements.js";
import { demarrerMoteurAutomatisations } from "./moteurAutomatisations.js";
import evenementRoutes from "./routes/evenements.js";
import automatisationRoutes from "./routes/automatisations.js";
import conformiteRoutes from "./routes/conformite.js";
import partagesPublicsRoutes from "./routes/partagesPublics.js";
import ssoRoutes from "./routes/sso.js";
import publicsRoutes from "./routes/publics.js";
import { demarrerEspacePublic, filtrerDomainePublic } from "./espacePublic.js";
import { demarrerCaches } from "./caches.js";
import { arreterDetection, demarrerDetection, filtrerIntrusions, observerReponse } from "./detection.js";
import { plateformeSecuriteRoutes, securiteRoutes } from "./routes/securite.js";
import { arreterEnvoisProgrammes, demarrerEnvoisProgrammes } from "./courriels.js";
import { arreterSynchroCourriel, demarrerSynchroCourriel } from "./courrielsSync.js";

const app = Fastify({
  logger: true,
  // Derrière le reverse-proxy de production, `request.ip` vaut sinon
  // l'adresse du proxy : la limitation de débit compterait toutes les
  // requêtes du monde comme venant d'une seule IP, et le journal d'audit
  // enregistrerait la même adresse pour tout le monde. Avec ce réglage,
  // Fastify lit `X-Forwarded-For` **lui-même**, en ne faisant confiance
  // qu'aux relais déclarés et situés sur le réseau privé — ce qui empêche
  // un client de maquiller son adresse en envoyant l'en-tête à la main.
  // Voir src/reseau.js.
  trustProxy: env.trustProxy,
});

// En-têtes de sécurité par défaut sur toutes les réponses de l'API.
//
// `contentSecurityPolicy: false` : l'API renvoie du JSON, pour lequel une
// CSP n'a pas de sens — et les deux routes qui servent vraiment du HTML
// (`/api/web/voir`, les pages de campagne) posent leur propre politique,
// bien plus stricte que ce qu'un réglage global permettrait.
//
// `crossOriginResourcePolicy: false` : le shell vit sur un autre domaine
// que l'API et doit pouvoir afficher les images et les vidéos servies par
// `/api/files`. Le contrôle d'accès reste porté par le jeton, pas par
// l'en-tête.
// Détection d'intrusion — voir src/detection.js. En premier : une adresse
// bloquée ne va pas plus loin, pas même jusqu'à la limitation de débit.
app.addHook("onRequest", filtrerIntrusions);
app.addHook("onResponse", observerReponse);
// Domaines personnalisés des espaces (liens publics) : seules les routes
// publiques y répondent — voir src/espacePublic.js.
app.addHook("onRequest", filtrerDomainePublic);

await app.register(helmet, {
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false,
});

// Limitation de débit.
//
// Le plafond global est large : il ne sert qu'à écrêter l'abus grossier.
// Les routes qui coûtent cher ou qui gardent un secret — connexion,
// inscription, acceptation d'invitation, envoi de courriel, récupération
// d'URL distante — posent le leur, bien plus bas, à leur déclaration.
//
// Sans cela, `bcrypt` à 12 tours n'est qu'un ralentisseur face au bourrage
// d'identifiants, et rien n'empêche d'essayer des codes d'invitation en
// boucle.
await app.register(rateLimit, {
  global: true,
  max: 600,
  timeWindow: "1 minute",
  // La clé est l'IP, sauf pour une requête authentifiée : deux personnes
  // derrière le même NAT d'entreprise ne doivent pas se gêner.
  //
  // Le compte se lit dans le jeton et non dans `request.user` : ce plugin
  // passe en `onRequest`, avant `authenticate`, et `request.user` y valait
  // toujours `undefined` — toute une entreprise partageait alors un seul
  // compteur, celui de son IP.
  keyGenerator: (request) => {
    const id = idDuJeton(request);
    return id ? `compte:${id}` : request.ip;
  },
  addHeaders: { "retry-after": true },
  // `statusCode: 429` est **obligatoire** ici. Sans lui, @fastify/rate-limit
  // lève l'objet renvoyé comme une erreur ordinaire, que le gestionnaire de
  // Fastify sérialise alors en **500** : la limite se déclenchait bien —
  // requêtes bloquées, en-tête Retry-After correct — mais sous un code
  // « erreur serveur » qui trompe le client et les sondes de supervision, et
  // empêche le front d'afficher « trop de tentatives » plutôt qu'une panne.
  // Trouvé en testant l'application déployée : 8 connexions en 401, puis des
  // 500 au lieu des 429 attendus.
  errorResponseBuilder: (_request, contexte) => ({
    statusCode: 429,
    error: "Too Many Requests",
    message: `Trop de requêtes. Réessayez dans ${Math.ceil(contexte.ttl / 1000)} secondes.`,
  }),
});

await app.register(cors, {
  origin: env.corsOrigin,
  credentials: true,
  // Sans cela, le navigateur cache les en-têtes de plage au code de la
  // page : la lecture en flux marche, mais rien côté client ne peut lire
  // la taille ni la position du morceau reçu.
  exposedHeaders: ["Content-Range", "Accept-Ranges", "Content-Length", "X-Next-Cursor"],
});
await app.register(multipart, {
  limits: { fileSize: env.uploadMaxOctets },
});

// Les 5xx sont consignées au journal des erreurs et leur détail n'est plus
// renvoyé au client — voir src/erreurs.js.
app.setErrorHandler(gestionnaireErreurs);

// Une promesse rejetée sans gestionnaire, hors de toute requête — dans un
// moteur de fond, typiquement — finirait sinon dans les seuls journaux du
// conteneur.
process.on("unhandledRejection", (raison) => {
  app.log.error({ err: raison }, "promesse rejetée sans gestionnaire");
  consigner({
    source: "api",
    message: raison?.message || String(raison),
    pile: raison?.stack,
    url: "processus",
  });
});

app.get("/health", async () => ({ status: "ok" }));

await app.register(authRoutes, { prefix: "/api/auth" });
await app.register(appRoutes, { prefix: "/api/apps" });
await app.register(fileRoutes, { prefix: "/api/files" });
await app.register(recordRoutes, { prefix: "/api/records" });
await app.register(auditRoutes, { prefix: "/api/audit" });
await app.register(notificationRoutes, { prefix: "/api/notifications" });
await app.register(webRoutes, { prefix: "/api/web" });
await app.register(billingRoutes, { prefix: "/api/facturation" });
await app.register(courrierRoutes, { prefix: "/api/courrier" });
await app.register(campagnesRoutes, { prefix: "/api/campagnes" });
await app.register(espaceRoutes, { prefix: "/api/espace" });
await app.register(plateformeRoutes, { prefix: "/api/plateforme" });
await app.register(erreursRoutes, { prefix: "/api/erreurs" });
await app.register(evenementRoutes, { prefix: "/api/evenements" });
await app.register(automatisationRoutes, { prefix: "/api/automatisations" });
await app.register(conformiteRoutes, { prefix: "/api/conformite" });
await app.register(partagesPublicsRoutes, { prefix: "/api/public/partages" });
await app.register(ssoRoutes, { prefix: "/api/auth/sso" });
await app.register(publicsRoutes, { prefix: "/api/public" });
await app.register(securiteRoutes, { prefix: "/api/securite" });
await app.register(plateformeSecuriteRoutes, { prefix: "/api/plateforme/securite" });

/// Dit, dans les journaux du conteneur, si chaque adresse de
/// PLATFORM_ADMINS a bien un compte qui lui ouvrira la console. « Je suis
/// admin et je n'ai pas accès » se diagnostiquait jusqu'ici à l'aveugle.
const diagnostiquerExploitants = async () => {
  if (!env.plateformeAdmins.length) {
    app.log.warn("PLATFORM_ADMINS est vide : personne n'a accès à la console Plateforme.");
    return;
  }
  for (const email of env.plateformeAdmins) {
    try {
      const exact = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (exact) {
        app.log.info(`Exploitant ${email} : compte trouvé, console accessible.`);
        continue;
      }
      const approchant = await prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { email: true },
      });
      app.log.warn(
        approchant
          ? `Exploitant ${email} : le compte existe sous « ${approchant.email} » (casse différente) — la console lui est refusée. Corrigez l'adresse du compte en minuscules.`
          : `Exploitant ${email} : aucun compte. Créez-le avec « node src/exploitant.js ${email} ».`,
      );
    } catch (e) {
      app.log.warn(`Diagnostic des exploitants impossible : ${e.message}`);
    }
  }
};

const shutdown = async () => {
  await app.close();
  arreterDetection();
  arreterSynchroCourriel();
  arreterEnvoisProgrammes();
  await arreterBus();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await app.listen({ port: env.port, host: "0.0.0.0" });
  // Le moteur de relances de factures — voir src/relances.js.
  demarrerRelances();
  // Le moteur d'envoi des campagnes — voir src/campagnes.js.
  demarrerCampagnes();
  // Les sauvegardes de la base et des fichiers — voir src/sauvegardes.js.
  demarrerSauvegardes();
  // Jetons d'URL échus et vieux compteurs d'échecs — voir src/etatPartage.js.
  demarrerPurgeEtatPartage();
  // Le bus temps réel entre instances (LISTEN/NOTIFY) et les
  // automatisations entre apps — voir src/evenements.js.
  await demarrerBus();
  demarrerMoteurAutomatisations();
  demarrerEspacePublic();
  demarrerCaches();
  demarrerDetection();
  // La messagerie : relève IMAP des boîtes reliées et envois programmés —
  // voir src/courrielsSync.js et src/courriels.js.
  demarrerSynchroCourriel();
  demarrerEnvoisProgrammes();
  diagnostiquerExploitants();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}


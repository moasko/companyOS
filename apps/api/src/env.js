import "dotenv/config";

const required = (key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Variable d'environnement manquante : ${key}. Copiez apps/api/.env.example vers apps/api/.env.`,
    );
  }
  return value;
};

const enProduction = process.env.NODE_ENV === "production";

/// Le secret qui signe les sessions. Un secret court ou laissé à sa valeur
/// d'exemple se devine hors ligne à partir d'un seul jeton intercepté — et
/// avec lui on signe un jeton au nom de n'importe quel compte, exploitant
/// compris. En production, le serveur refuse donc de démarrer plutôt que
/// de tourner avec.
const SECRETS_D_EXEMPLE = ["changez-moi-en-production", "changeme", "secret"];
const secretJwt = () => {
  const s = required("JWT_SECRET");
  if (enProduction && (s.length < 32 || SECRETS_D_EXEMPLE.includes(s))) {
    throw new Error(
      "JWT_SECRET trop faible : au moins 32 caractères aléatoires en production " +
        "(node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\").",
    );
  }
  return s;
};

export const env = {
  production: enProduction,
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: secretJwt(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  port: Number(process.env.PORT || 4000),
  // Les adresses du shell autorisées à appeler l'API, séparées par des
  // virgules. Comparées à l'identique par le navigateur : une barre finale
  // (`https://app.companyos.fr/`) suffisait à refuser toute connexion avec
  // un simple « Failed to fetch ». Elle est donc retirée ici. Plusieurs
  // adresses servent pendant un changement de domaine, le temps que tout le
  // monde ait quitté l'ancienne.
  corsOrigin: (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean),
  storageDriver: process.env.STORAGE_DRIVER || "local",
  storageLocalPath: process.env.STORAGE_LOCAL_PATH || "./storage",
  // Quota d'un nouvel espace, en octets. Vide = celui de la formule
  // Découverte, ce qui est le cas normal : un espace gratuit qui recevait
  // 5 Go là où sa formule en annonce 2 se voyait raboter à 2 Go au premier
  // changement de formule, sans comprendre pourquoi. À ne renseigner que
  // pour une offre de lancement délibérée.
  defaultTenantQuota: process.env.DEFAULT_TENANT_QUOTA
    ? BigInt(process.env.DEFAULT_TENANT_QUOTA)
    : null,

  // Nombre de sauts de reverse-proxy à qui faire confiance pour lire
  // l'adresse du client dans `X-Forwarded-For`. 0 = aucun (développement,
  // le serveur est joint directement). 1 = un proxy devant, le cas normal
  // en production. Ne jamais mettre `true` : cela reviendrait à croire
  // n'importe quel client qui envoie l'en-tête lui-même, ce qui permet de
  // maquiller son adresse dans le journal d'audit et de contourner la
  // limitation de débit.
  trustProxy: Number(process.env.TRUST_PROXY || 0),

  // Taille maximale d'un fichier importé. 512 Mo était la valeur d'origine,
  // mais le pilote S3 assemble l'objet en mémoire avant de l'envoyer :
  // quatre imports simultanés à cette taille suffisaient à faire sortir le
  // processus par manque de mémoire, et le conteneur emportait tous les
  // espaces avec lui.
  uploadMaxOctets: Number(process.env.UPLOAD_MAX_OCTETS || 128 * 1024 * 1024),

  // Plafond d'envoi de courriels par espace et par 24 h — tous chemins
  // confondus (Courrier, campagnes, relances de factures). Sans lui, un
  // seul compte membre suffit à transformer la plateforme en relais de
  // spam, avec la réputation SPF/DKIM du domaine en garantie.
  mailQuotaJour: Number(process.env.MAIL_QUOTA_JOUR || 500),

  // Relais SMTP sortant — facultatif. Sans SMTP_HOST, aucun mail ne part
  // et les invitations fonctionnent par code, comme toujours.
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  mailFrom: process.env.MAIL_FROM || "CompanyOS <no-reply@localhost>",
  // L'adresse publique du front, glissée dans les mails pour que le
  // destinataire sache où aller. En pratique : la même que CORS_ORIGIN.
  urlPublique: (process.env.PUBLIC_URL || process.env.CORS_ORIGIN || "")
    .split(",")[0]
    .trim()
    .replace(/\/+$/, ""),
  // L'adresse publique de l'API — les liens de désinscription des
  // campagnes pointent dessus.
  apiPublique: process.env.PUBLIC_API_URL || "",

  // Les exploitants de la plateforme : les adresses email autorisées à
  // ouvrir la console Plateforme (tous les espaces, toutes les formules).
  // Au-dessus des rôles d'espace — un OWNER ne voit que son entreprise,
  // l'exploitant voit le SaaS.
  plateformeAdmins: (process.env.PLATFORM_ADMINS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  // Sauvegardes automatiques — voir src/sauvegardes.js.
  //   SAUVEGARDE_ACTIVE=false   les coupe (un environnement de test, par
  //                             exemple) ; actives partout ailleurs.
  //   SAUVEGARDE_HEURE          heure UTC de la sauvegarde quotidienne de
  //                             la base (2 h : 2 h à Abidjan).
  //   SAUVEGARDE_RETENTION_JOURS combien de copies quotidiennes garder.
  //   SAUVEGARDE_FICHIERS_SEMAINES combien d'archives hebdomadaires du
  //                             stockage local garder.
  sauvegardeActive: process.env.SAUVEGARDE_ACTIVE !== "false",
  sauvegardeDossier: process.env.SAUVEGARDE_DOSSIER || "./sauvegardes",
  sauvegardeHeure: Number(process.env.SAUVEGARDE_HEURE ?? 2),
  sauvegardeRetentionJours: Number(process.env.SAUVEGARDE_RETENTION_JOURS || 14),
  sauvegardeFichiersSemaines: Number(process.env.SAUVEGARDE_FICHIERS_SEMAINES || 4),
};

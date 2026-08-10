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

export const env = {
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  port: Number(process.env.PORT || 4000),
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  storageDriver: process.env.STORAGE_DRIVER || "local",
  storageLocalPath: process.env.STORAGE_LOCAL_PATH || "./storage",
  defaultTenantQuota: BigInt(
    process.env.DEFAULT_TENANT_QUOTA || 5 * 1024 * 1024 * 1024,
  ),

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
  urlPublique: process.env.PUBLIC_URL || process.env.CORS_ORIGIN || "",
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
};

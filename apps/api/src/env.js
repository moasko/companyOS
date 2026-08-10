import "dotenv/config";

const required = (key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Variable d'environnement manquante : ${key}. Copiez server/.env.example vers server/.env.`,
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

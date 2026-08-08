import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { env } from "./env.js";
import { prisma } from "./db.js";
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
import { demarrerCampagnes } from "./campagnes.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: env.corsOrigin,
  credentials: true,
  // Sans cela, le navigateur cache les en-têtes de plage au code de la
  // page : la lecture en flux marche, mais rien côté client ne peut lire
  // la taille ni la position du morceau reçu.
  exposedHeaders: ["Content-Range", "Accept-Ranges", "Content-Length"],
});
await app.register(multipart, {
  limits: { fileSize: 512 * 1024 * 1024 }, // 512 Mo par fichier
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

const shutdown = async () => {
  await app.close();
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
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

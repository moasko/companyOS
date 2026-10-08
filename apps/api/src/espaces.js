import { prisma } from "./db.js";
import { env } from "./env.js";
import { formuleDe } from "./formules.js";

/// Création d'un espace de travail et de son propriétaire.
///
/// Partagée par l'inscription (`POST /api/auth/register`) et par la
/// commande d'exploitation `npm run exploitant` : un espace créé par l'une
/// ou l'autre doit être identique — mêmes dossiers, mêmes applications du
/// socle — sans quoi le second chemin finit par diverger en silence.

export const slugify = (value) =>
  value
    // NFD sépare les accents en diacritiques, que l'on retire ensuite.
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/// Crée l'espace, son propriétaire, ses dossiers de départ et installe les
/// applications du socle — le tout en une transaction, pour ne jamais
/// laisser un tenant à moitié construit.
///
/// `email` doit déjà être normalisé et `passwordHash` déjà calculé : cette
/// fonction ne décide ni de l'identité ni du secret.
export const creerEspace = async ({ company, name, email, passwordHash }) => {
  let slug = slugify(company) || "espace";
  if (await prisma.tenant.findUnique({ where: { slug } })) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 7)}`;
  }

  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: company,
        slug,
        // Un espace naît en formule Découverte : son quota est celui de la
        // formule, sauf offre de lancement décidée par l'exploitant.
        quota: env.defaultTenantQuota ?? BigInt(formuleDe("FREE").quota),
      },
    });

    const user = await tx.user.create({
      data: { tenantId: tenant.id, email, name, passwordHash, role: "OWNER" },
    });

    // Dossiers de départ de l'espace utilisateur.
    await tx.fsNode.createMany({
      data: ["Documents", "Images", "Partagé"].map((folder) => ({
        tenantId: tenant.id,
        ownerId: user.id,
        parentId: null,
        name: folder,
        type: "FOLDER",
      })),
    });

    // Les apps du socle sont installées d'office.
    const coreApps = await tx.app.findMany({ where: { isCore: true } });
    if (coreApps.length) {
      await tx.installation.createMany({
        data: coreApps.map((a) => ({
          tenantId: tenant.id,
          userId: user.id,
          appId: a.id,
        })),
      });
    }

    return { user, tenant };
  });
};

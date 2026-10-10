import { prisma } from "./db.js";

/// Historique des fiches : l'état d'avant, à chaque modification et
/// suppression (voir le modèle VersionFiche).
///
/// Limites, pour que l'historique ne mange pas la base :
///   - 50 versions par fiche, les plus anciennes partent ;
///   - pas de version au-delà de 512 Ko (un classeur de 8 Mo sauvegardé
///     toutes les trente secondes remplirait la base en une journée) ;
///   - les fiches supprimées restent récupérables 180 jours.

export const VERSIONS_PAR_FICHE = 50;
export const TAILLE_VERSION_MAX = 512 * 1024;
export const DUREE_CORBEILLE_JOURS = 180;

export const noterVersion = async ({ tenantId, record, action, auteur }) => {
  if (!record?.data) return;
  if (Buffer.byteLength(JSON.stringify(record.data), "utf8") > TAILLE_VERSION_MAX) return;
  await prisma.versionFiche.create({
    data: {
      tenantId,
      recordId: record.id,
      module: record.module,
      collection: record.collection,
      data: record.data,
      action,
      proprietaireId: record.userId || null,
      auteurId: auteur?.id || null,
      auteurNom: auteur?.name || null,
    },
  });
  // Purge de temps en temps plutôt qu'à chaque écriture.
  if (Math.random() < 0.1) await purgerFiche(tenantId, record.id).catch(() => {});
};

const purgerFiche = async (tenantId, recordId) => {
  const seuil = await prisma.versionFiche.findFirst({
    where: { tenantId, recordId },
    orderBy: { creeLe: "desc" },
    skip: VERSIONS_PAR_FICHE,
    select: { creeLe: true },
  });
  if (seuil) await prisma.versionFiche.deleteMany({ where: { tenantId, recordId, creeLe: { lte: seuil.creeLe } } });
};

/// Ménage périodique : historique des fiches supprimées depuis plus de
/// 180 jours.
export const purgerVersions = () =>
  prisma.versionFiche.deleteMany({
    where: { creeLe: { lt: new Date(Date.now() - DUREE_CORBEILLE_JOURS * 86400_000) } },
  });

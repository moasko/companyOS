import { PrismaClient } from "@prisma/client";

/// Réparation des migrations en échec, avant `prisma migrate deploy`.
///
/// ─────────────────────────────────────────────────────────────────────────
/// LE PROBLÈME
///
/// Une migration qui échoue en production reste marquée « en échec » dans
/// la table `_prisma_migrations`. Tant qu'elle y est, `migrate deploy`
/// refuse tout (erreur P3009) : l'API ne démarre plus, le conteneur
/// redémarre en boucle, et on ne peut même pas y ouvrir un terminal pour
/// lancer `prisma migrate resolve`.
///
/// Cas réel : `ADD COLUMN "acces"` en échec parce que la colonne existait
/// déjà (base modifiée hors migrations, par un `prisma db push`).
///
/// LA RÉPONSE
///
/// Les migrations listées dans REJOUABLES sont écrites pour pouvoir être
/// rejouées sans danger (IF NOT EXISTS, mises à jour idempotentes). Si
/// l'une d'elles est en échec, ce script fait ce que ferait
/// `prisma migrate resolve --rolled-back` : il la marque comme annulée, et
/// `migrate deploy` la rejoue juste après.
///
/// Toute autre migration en échec est laissée telle quelle : la rejouer
/// à l'aveugle pourrait appliquer deux fois une transformation de données.
/// Le script affiche alors l'erreur d'origine et la marche à suivre, et
/// `migrate deploy` échoue comme avant.
///
/// Dans tous les cas, l'erreur d'origine est affichée dans les journaux :
/// c'est elle qui dit ce qui s'est passé.
/// ─────────────────────────────────────────────────────────────────────────

/// À n'allonger qu'avec des migrations relues pour être rejouables.
const REJOUABLES = [
  "20261008120000_version_session",
  "20261008150000_acces_applications",
  "20261008170000_sante",
  "20261008180000_emails_minuscules",
  "20261009120000_sessions_mfa",
  "20261010120000_etat_partage",
  "20261010150000_automatisations_push",
  "20261010180000_versions_fiches",
  "20261010200000_fichiers_versions_partages",
  "20261010210000_sso",
];

const prisma = new PrismaClient();

const reparer = async () => {
  // Base neuve : pas encore de table de suivi, rien à réparer.
  const [{ existe }] = await prisma.$queryRaw`
    SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS existe`;
  if (!existe) return;

  const enEchec = await prisma.$queryRaw`
    SELECT id, migration_name, logs, started_at
    FROM "_prisma_migrations"
    WHERE finished_at IS NULL AND rolled_back_at IS NULL
    ORDER BY started_at`;

  for (const m of enEchec) {
    const erreur = String(m.logs || "(aucun détail enregistré)").trim().slice(0, 2000);
    console.warn(`Migration en échec : ${m.migration_name} (démarrée le ${m.started_at?.toISOString?.() ?? m.started_at})`);
    console.warn(`  Erreur d'origine : ${erreur}`);

    if (REJOUABLES.includes(m.migration_name)) {
      await prisma.$executeRaw`
        UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE id = ${m.id}`;
      console.warn("  → rejouable sans danger : marquée annulée, migrate deploy va la rejouer.");
    } else {
      console.error(
        "  → non rejouable automatiquement. Après avoir corrigé la base à la main :\n" +
          `    npx prisma migrate resolve --rolled-back ${m.migration_name}   (si rien n'a été appliqué)\n` +
          `    npx prisma migrate resolve --applied ${m.migration_name}       (si elle a été appliquée à la main)`,
      );
    }
  }
};

try {
  await reparer();
} catch (e) {
  // Ne jamais bloquer le démarrage sur la réparation elle-même :
  // `migrate deploy` dira ce qui ne va pas.
  console.error("Vérification des migrations impossible :", e.message);
} finally {
  await prisma.$disconnect();
}

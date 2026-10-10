-- Rejouable (IF NOT EXISTS) : voir prisma/reparer-migrations.js.
-- Historique des fiches : état avant chaque modification ou suppression.
CREATE TABLE IF NOT EXISTS "versions_fiches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "action" TEXT NOT NULL,
    "proprietaireId" TEXT,
    "auteurId" TEXT,
    "auteurNom" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "versions_fiches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "versions_fiches_tenantId_recordId_creeLe_idx" ON "versions_fiches"("tenantId", "recordId", "creeLe");
CREATE INDEX IF NOT EXISTS "versions_fiches_tenantId_module_collection_action_creeLe_idx" ON "versions_fiches"("tenantId", "module", "collection", "action", "creeLe");

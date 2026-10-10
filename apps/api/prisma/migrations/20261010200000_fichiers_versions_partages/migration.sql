-- Rejouable (IF NOT EXISTS) : voir prisma/reparer-migrations.js.
-- Versions des fichiers remplacés et liens de partage publics.

-- CreateTable
CREATE TABLE IF NOT EXISTS "versions_fichiers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storage" TEXT NOT NULL DEFAULT 'local',
    "size" BIGINT NOT NULL DEFAULT 0,
    "mimeType" TEXT,
    "auteurId" TEXT,
    "auteurNom" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "versions_fichiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liens_partage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "empreinte" TEXT NOT NULL,
    "creeParId" TEXT,
    "creeParNom" TEXT,
    "expireLe" TIMESTAMP(3) NOT NULL,
    "motDePasseHash" TEXT,
    "maxTelechargements" INTEGER,
    "telechargements" INTEGER NOT NULL DEFAULT 0,
    "dernierAcces" TIMESTAMP(3),
    "revoqueLe" TIMESTAMP(3),
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liens_partage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "versions_fichiers_nodeId_creeLe_idx" ON "versions_fichiers"("nodeId", "creeLe");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "liens_partage_empreinte_key" ON "liens_partage"("empreinte");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liens_partage_nodeId_idx" ON "liens_partage"("nodeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liens_partage_tenantId_idx" ON "liens_partage"("tenantId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "versions_fichiers" ADD CONSTRAINT "versions_fichiers_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "fs_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "liens_partage" ADD CONSTRAINT "liens_partage_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "fs_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "partagePublic" BOOLEAN NOT NULL DEFAULT true;

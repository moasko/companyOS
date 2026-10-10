-- Rejouable (IF NOT EXISTS) : voir prisma/reparer-migrations.js.
-- Automatisations entre applications (règles et historique), abonnements
-- aux notifications push, réglages de la plateforme (clés VAPID).

-- CreateTable
CREATE TABLE IF NOT EXISTS "automatisations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "definition" JSONB NOT NULL,
    "module" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "evenement" TEXT NOT NULL,
    "recette" TEXT,
    "creeParId" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "derniereExecution" TIMESTAMP(3),
    "executions" INTEGER NOT NULL DEFAULT 0,
    "echecs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "automatisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "executions_automatisations" (
    "id" TEXT NOT NULL,
    "automatisationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "statut" TEXT NOT NULL,
    "evenement" JSONB NOT NULL,
    "resultats" JSONB NOT NULL,
    "dureeMs" INTEGER NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "executions_automatisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "abonnements_push" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "agent" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vuLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abonnements_push_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "parametres_systeme" (
    "cle" TEXT NOT NULL,
    "valeur" JSONB NOT NULL,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parametres_systeme_pkey" PRIMARY KEY ("cle")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "automatisations_tenantId_module_collection_idx" ON "automatisations"("tenantId", "module", "collection");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "executions_automatisations_automatisationId_creeLe_idx" ON "executions_automatisations"("automatisationId", "creeLe");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "executions_automatisations_tenantId_creeLe_idx" ON "executions_automatisations"("tenantId", "creeLe");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "abonnements_push_endpoint_key" ON "abonnements_push"("endpoint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "abonnements_push_userId_idx" ON "abonnements_push"("userId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "automatisations" ADD CONSTRAINT "automatisations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "executions_automatisations" ADD CONSTRAINT "executions_automatisations_automatisationId_fkey" FOREIGN KEY ("automatisationId") REFERENCES "automatisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "abonnements_push" ADD CONSTRAINT "abonnements_push_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


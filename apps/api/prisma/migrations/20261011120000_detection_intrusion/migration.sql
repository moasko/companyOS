-- Rejouable (IF NOT EXISTS) : voir prisma/reparer-migrations.js.
-- Détection d'intrusion : alertes, signaux bruts, adresses bloquées.
CREATE TABLE IF NOT EXISTS "alertes_securite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "email" TEXT,
    "type" TEXT NOT NULL,
    "gravite" TEXT NOT NULL,
    "ip" TEXT,
    "agent" TEXT,
    "details" JSONB,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "traiteLe" TIMESTAMP(3),
    "traitePar" TEXT,
    CONSTRAINT "alertes_securite_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "alertes_securite_tenantId_creeLe_idx" ON "alertes_securite"("tenantId", "creeLe");
CREATE INDEX IF NOT EXISTS "alertes_securite_creeLe_idx" ON "alertes_securite"("creeLe");
CREATE INDEX IF NOT EXISTS "alertes_securite_ip_creeLe_idx" ON "alertes_securite"("ip", "creeLe");

CREATE TABLE IF NOT EXISTS "signaux_securite" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ip" TEXT,
    "cle" TEXT,
    "tenantId" TEXT,
    "existe" BOOLEAN NOT NULL DEFAULT true,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "signaux_securite_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "signaux_securite_type_cle_creeLe_idx" ON "signaux_securite"("type", "cle", "creeLe");
CREATE INDEX IF NOT EXISTS "signaux_securite_type_ip_creeLe_idx" ON "signaux_securite"("type", "ip", "creeLe");
CREATE INDEX IF NOT EXISTS "signaux_securite_creeLe_idx" ON "signaux_securite"("creeLe");

CREATE TABLE IF NOT EXISTS "ips_bloquees" (
    "ip" TEXT NOT NULL,
    "motif" TEXT NOT NULL,
    "jusqua" TIMESTAMP(3) NOT NULL,
    "manuel" BOOLEAN NOT NULL DEFAULT false,
    "parEmail" TEXT,
    "recidives" INTEGER NOT NULL DEFAULT 0,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ips_bloquees_pkey" PRIMARY KEY ("ip")
);
CREATE INDEX IF NOT EXISTS "ips_bloquees_jusqua_idx" ON "ips_bloquees"("jusqua");

-- Rejouable (IF NOT EXISTS) : voir prisma/reparer-migrations.js.
-- L'état qui vivait dans la mémoire du processus passe en base, pour que
-- plusieurs instances de l'API puissent servir le même espace : jetons
-- d'URL (lecture en flux, vue web) et verrou de connexion par compte.
-- Plus l'index de la lecture page par page des fiches.

CREATE TABLE IF NOT EXISTS "jetons_url" (
    "empreinte" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cible" TEXT NOT NULL,
    "expireLe" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "jetons_url_pkey" PRIMARY KEY ("empreinte")
);
CREATE INDEX IF NOT EXISTS "jetons_url_expireLe_idx" ON "jetons_url"("expireLe");

CREATE TABLE IF NOT EXISTS "verrous_connexion" (
    "cle" TEXT NOT NULL,
    "echecs" INTEGER NOT NULL DEFAULT 0,
    "dernier" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jusqua" TIMESTAMP(3),
    CONSTRAINT "verrous_connexion_pkey" PRIMARY KEY ("cle")
);
CREATE INDEX IF NOT EXISTS "verrous_connexion_dernier_idx" ON "verrous_connexion"("dernier");

CREATE INDEX IF NOT EXISTS "records_tenantId_module_collection_createdAt_id_idx"
    ON "records"("tenantId", "module", "collection", "createdAt" DESC, "id" DESC);

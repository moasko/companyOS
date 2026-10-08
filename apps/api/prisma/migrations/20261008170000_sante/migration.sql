-- Rejouable (IF NOT EXISTS) : voir prisma/reparer-migrations.js.
-- Santé de la plateforme : historique des sauvegardes et journal des
-- erreurs, lus par la console de l'exploitant.

CREATE TABLE IF NOT EXISTS "sauvegardes" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "declencheur" TEXT NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'en_cours',
    "fichier" TEXT,
    "octets" BIGINT,
    "sha256" TEXT,
    "verifiee" BOOLEAN NOT NULL DEFAULT false,
    "horsSite" BOOLEAN NOT NULL DEFAULT false,
    "erreur" TEXT,
    "debut" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fin" TIMESTAMP(3),

    CONSTRAINT "sauvegardes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sauvegardes_type_debut_idx" ON "sauvegardes"("type", "debut");

CREATE TABLE IF NOT EXISTS "erreurs" (
    "id" TEXT NOT NULL,
    "empreinte" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "pile" TEXT,
    "url" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "tenantId" TEXT,
    "userId" TEXT,
    "details" JSONB,
    "resolue" BOOLEAN NOT NULL DEFAULT false,
    "premiere" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "derniere" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erreurs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "erreurs_empreinte_key" ON "erreurs"("empreinte");
CREATE INDEX IF NOT EXISTS "erreurs_resolue_derniere_idx" ON "erreurs"("resolue", "derniere");

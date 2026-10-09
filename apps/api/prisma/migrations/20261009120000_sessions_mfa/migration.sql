-- Rejouable (IF NOT EXISTS) : voir prisma/reparer-migrations.js.
-- Sessions côté serveur (cookie HttpOnly, révocation appareil par appareil)
-- et double authentification TOTP.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totpSecret" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totpActif" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totpDernierPas" INTEGER;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "codesSecours" JSONB;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "mfaObligatoire" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'navigateur',
    "libelle" TEXT,
    "ip" TEXT,
    "agent" TEXT,
    "mfa" BOOLEAN NOT NULL DEFAULT false,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vuLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expireLe" TIMESTAMP(3) NOT NULL,
    "revoqueLe" TIMESTAMP(3),
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "sessions_userId_idx" ON "sessions"("userId");
DO $$ BEGIN
  ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

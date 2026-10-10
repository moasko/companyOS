-- Rejouable (IF NOT EXISTS) : voir prisma/reparer-migrations.js.
-- Authentification unique (OpenID Connect) par espace.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "sso" JSONB;

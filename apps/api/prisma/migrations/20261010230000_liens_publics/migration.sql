-- Rejouable (IF NOT EXISTS) : voir prisma/reparer-migrations.js.
-- Lien du formulaire régénérable et domaine personnalisé des liens publics.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "selFormulaire" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "domainePublic" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "domainePublicVerifie" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_domainePublic_key" ON "tenants"("domainePublic");

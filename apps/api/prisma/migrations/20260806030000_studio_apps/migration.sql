-- Applications créées depuis le Studio.
--
-- Une app porte désormais un tenantId : null pour le catalogue global,
-- renseigné pour une application propre à un espace de travail. L'unicité
-- du slug passe donc de globale à (tenantId, slug), afin que deux clients
-- puissent nommer leurs applications librement sans se gêner.

ALTER TYPE "AppKind" ADD VALUE 'CUSTOM';

ALTER TABLE "apps"
  ADD COLUMN "tenantId"   TEXT,
  ADD COLUMN "definition" JSONB,
  ADD COLUMN "published"  BOOLEAN NOT NULL DEFAULT true;

DROP INDEX "apps_slug_key";

CREATE UNIQUE INDEX "apps_tenantId_slug_key" ON "apps"("tenantId", "slug");
CREATE INDEX "apps_tenantId_idx" ON "apps"("tenantId");

ALTER TABLE "apps"
  ADD CONSTRAINT "apps_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

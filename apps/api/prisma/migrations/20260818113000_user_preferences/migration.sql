-- Préférences personnelles du shell, synchronisées entre les appareils.
-- Le JSON reste volontairement distinct des réglages d'espace : deux membres
-- d'une même entreprise peuvent organiser leur bureau différemment.
ALTER TABLE "users"
ADD COLUMN "preferences" JSONB NOT NULL DEFAULT '{}';

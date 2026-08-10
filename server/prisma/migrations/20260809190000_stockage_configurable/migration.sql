-- Stockage configurable depuis la console Plateforme.
--
-- Migration **purement additive** : une colonne avec valeur par défaut et
-- une table neuve. Rien n'est supprimé, rien n'est réécrit, et les lignes
-- existantes prennent « local » — ce qui est exactement où leurs octets se
-- trouvent déjà.

-- Où vivent les octets de ce fichier. C'est ce champ qui permet de changer
-- la destination du SaaS sans migrer quoi que ce soit : les anciens
-- fichiers gardent la leur et restent lisibles.
ALTER TABLE "fs_nodes" ADD COLUMN "storage" TEXT NOT NULL DEFAULT 'local';

-- Réglages de la plateforme, une seule ligne (id = 'global').
CREATE TABLE "platform_config" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "stockage" TEXT NOT NULL DEFAULT 'local',
    "s3" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_config_pkey" PRIMARY KEY ("id")
);

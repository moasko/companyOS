-- Stockage propre à un espace de travail.
--
-- Purement additive : deux colonnes avec une valeur par défaut. Les espaces
-- existants prennent « plateforme », c'est-à-dire exactement le comportement
-- qu'ils avaient — leurs fichiers ne bougent pas d'un octet.
--
-- Rappel du principe posé par la migration précédente : c'est `FsNode.storage`
-- qui retient, fichier par fichier, où ses octets sont réellement partis.
-- Changer ce réglage n'affecte donc que les fichiers à venir, et il n'y a
-- aucune migration de données à mener — ni à l'aller, ni au retour.
ALTER TABLE "tenants" ADD COLUMN "stockage" TEXT NOT NULL DEFAULT 'plateforme';
ALTER TABLE "tenants" ADD COLUMN "stockageS3" JSONB;

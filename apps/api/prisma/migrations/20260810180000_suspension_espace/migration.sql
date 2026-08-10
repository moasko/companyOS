-- Suspension d'un espace de travail.
--
-- Purement additive, et neutre au démarrage : `suspendu` vaut faux pour
-- tous les espaces existants, c'est-à-dire exactement leur état actuel.
--
-- Aucune donnée n'est touchée par une suspension : c'est une porte fermée,
-- pas un effacement. La levée rend l'espace tel qu'il était.
ALTER TABLE "tenants" ADD COLUMN "suspendu" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN "suspenduLe" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "motifSuspension" TEXT;

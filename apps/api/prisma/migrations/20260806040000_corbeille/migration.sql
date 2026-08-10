-- Corbeille du cloud.
--
-- Supprimer devient réversible : `deletedAt` marque la mise à la corbeille,
-- `trashId` regroupe tout un sous-arbre supprimé d'un seul geste (chaque
-- descendant porte l'id de l'élément que l'utilisateur a réellement
-- supprimé). La corbeille n'affiche que les entrées où `trashId = id`.
--
-- Les octets restent stockés et comptés dans le quota jusqu'au vidage :
-- c'est la vérité, l'espace est bien toujours occupé.

ALTER TABLE "fs_nodes"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "trashId"   TEXT;

-- L'unicité du nom ne doit valoir qu'entre éléments vivants : sans cela,
-- un fichier à la corbeille continuerait de réserver son nom et on ne
-- pourrait pas recréer « rapport.pdf » après l'avoir supprimé.
--
-- Postgres ne sait faire ça qu'avec un index partiel, que Prisma ne peut
-- pas décrire dans le schéma — d'où la création manuelle ici.
-- `COALESCE` au passage : l'ancien index laissait passer les doublons à la
-- racine, où `parentId` est NULL — et Postgres considère deux NULL comme
-- distincts. Deux dossiers « Documents » pouvaient donc coexister à la
-- racine d'un même espace de travail.
DROP INDEX IF EXISTS "fs_nodes_tenantId_parentId_name_key";

CREATE UNIQUE INDEX "fs_nodes_vivants_nom_unique"
  ON "fs_nodes" ("tenantId", (COALESCE("parentId", '')), "name")
  WHERE "deletedAt" IS NULL;

CREATE INDEX "fs_nodes_tenantId_trashId_idx" ON "fs_nodes" ("tenantId", "trashId");

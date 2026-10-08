-- Rejouable (IF NOT EXISTS) : voir prisma/reparer-migrations.js.
-- Version des sessions : l'incrémenter rend caducs tous les jetons déjà
-- émis pour le compte (changement de mot de passe, déconnexion de tous les
-- appareils, intervention de l'exploitant).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;

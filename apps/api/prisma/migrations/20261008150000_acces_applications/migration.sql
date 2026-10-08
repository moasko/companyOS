-- Rejouable (IF NOT EXISTS) : voir prisma/reparer-migrations.js.
-- Accès par application : qui, dans l'espace, peut ouvrir une application
-- installée. NULL = la règle par défaut de l'application (src/acces.js).
ALTER TABLE "installations" ADD COLUMN IF NOT EXISTS "acces" JSONB;

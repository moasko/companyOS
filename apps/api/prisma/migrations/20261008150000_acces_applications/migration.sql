-- Accès par application : qui, dans l'espace, peut ouvrir une application
-- installée. NULL = la règle par défaut de l'application (src/acces.js).
ALTER TABLE "installations" ADD COLUMN "acces" JSONB;

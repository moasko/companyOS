-- Rejouable (IF NOT EXISTS, reprise idempotente) : voir prisma/reparer-migrations.js.
-- Courrier : boîtes IMAP, courriels (reçus, envoyés, brouillons), fils.
CREATE TABLE IF NOT EXISTS "boites_courriel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "nom" TEXT NOT NULL,
    "adresse" TEXT NOT NULL,
    "imap" JSONB NOT NULL,
    "smtp" JSONB,
    "signature" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "uidValidite" BIGINT,
    "dernierUid" INTEGER NOT NULL DEFAULT 0,
    "derniereSynchro" TIMESTAMP(3),
    "syncJusqua" TIMESTAMP(3),
    "erreur" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "boites_courriel_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "boites_courriel_tenantId_idx" ON "boites_courriel"("tenantId");

CREATE TABLE IF NOT EXISTS "courriels" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "boiteId" TEXT,
    "dossier" TEXT NOT NULL,
    "filId" TEXT NOT NULL,
    "messageId" TEXT,
    "inReplyTo" TEXT,
    "references" JSONB,
    "uid" INTEGER,
    "deNom" TEXT,
    "deEmail" TEXT,
    "a" JSONB NOT NULL,
    "cc" JSONB,
    "cci" JSONB,
    "sujet" TEXT NOT NULL DEFAULT '',
    "texte" TEXT NOT NULL DEFAULT '',
    "html" TEXT,
    "extrait" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lu" BOOLEAN NOT NULL DEFAULT false,
    "suivi" BOOLEAN NOT NULL DEFAULT false,
    "etiquettes" JSONB,
    "pieces" JSONB,
    "statut" TEXT NOT NULL,
    "erreur" TEXT,
    "envoiLe" TIMESTAMP(3),
    "userId" TEXT,
    "liens" JSONB,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "courriels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "courriels_boiteId_uid_key" ON "courriels"("boiteId", "uid");
CREATE INDEX IF NOT EXISTS "courriels_tenantId_dossier_date_idx" ON "courriels"("tenantId", "dossier", "date" DESC);
CREATE INDEX IF NOT EXISTS "courriels_tenantId_filId_idx" ON "courriels"("tenantId", "filId");
CREATE INDEX IF NOT EXISTS "courriels_tenantId_messageId_idx" ON "courriels"("tenantId", "messageId");
CREATE INDEX IF NOT EXISTS "courriels_tenantId_deEmail_idx" ON "courriels"("tenantId", "deEmail");
CREATE INDEX IF NOT EXISTS "courriels_statut_envoiLe_idx" ON "courriels"("statut", "envoiLe");
DO $$ BEGIN
  ALTER TABLE "courriels" ADD CONSTRAINT "courriels_boiteId_fkey" FOREIGN KEY ("boiteId") REFERENCES "boites_courriel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Reprise de l'historique : les envois et brouillons rangés jusqu'ici
-- dans les fiches génériques de l'app (records courrier/envois et
-- courrier/brouillons). L'identifiant de la fiche est repris : rejouer la
-- migration ne duplique rien.
INSERT INTO "courriels" ("id", "tenantId", "dossier", "filId", "a", "cc", "sujet", "texte", "extrait", "date", "lu", "statut", "erreur", "userId", "pieces", "creeLe", "modifieLe")
SELECT r."id", r."tenantId", 'envoyes', r."id",
       COALESCE((SELECT jsonb_agg(jsonb_build_object('email', trim(x))) FROM unnest(string_to_array(COALESCE(r."data"->>'a', ''), ',')) AS x WHERE trim(x) <> ''), '[]'::jsonb),
       (SELECT jsonb_agg(jsonb_build_object('email', trim(x))) FROM unnest(string_to_array(COALESCE(r."data"->>'cc', ''), ',')) AS x WHERE trim(x) <> ''),
       COALESCE(r."data"->>'sujet', ''),
       COALESCE(r."data"->>'texte', r."data"->>'extrait', ''),
       left(COALESCE(r."data"->>'extrait', r."data"->>'texte', ''), 200),
       COALESCE(NULLIF(r."data"->>'date', '')::timestamptz, r."createdAt"),
       true,
       CASE WHEN r."data"->>'envoye' = 'false' THEN 'echec' ELSE 'envoye' END,
       r."data"->>'erreur',
       r."userId",
       (SELECT jsonb_agg(jsonb_build_object('nom', p)) FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(r."data"->'pieces') = 'array' THEN r."data"->'pieces' ELSE '[]'::jsonb END) AS p),
       r."createdAt", r."updatedAt"
FROM "records" r
WHERE r."module" = 'courrier' AND r."collection" = 'envois'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "courriels" ("id", "tenantId", "dossier", "filId", "a", "cc", "sujet", "texte", "extrait", "date", "lu", "statut", "userId", "creeLe", "modifieLe")
SELECT r."id", r."tenantId", 'brouillons', r."id",
       COALESCE((SELECT jsonb_agg(jsonb_build_object('email', trim(x))) FROM unnest(string_to_array(COALESCE(r."data"->>'a', ''), ',')) AS x WHERE trim(x) <> ''), '[]'::jsonb),
       (SELECT jsonb_agg(jsonb_build_object('email', trim(x))) FROM unnest(string_to_array(COALESCE(r."data"->>'cc', ''), ',')) AS x WHERE trim(x) <> ''),
       COALESCE(r."data"->>'sujet', ''),
       COALESCE(r."data"->>'texte', ''),
       left(COALESCE(r."data"->>'texte', ''), 200),
       COALESCE(NULLIF(r."data"->>'date', '')::timestamptz, r."updatedAt"),
       true, 'brouillon', r."userId", r."createdAt", r."updatedAt"
FROM "records" r
WHERE r."module" = 'courrier' AND r."collection" = 'brouillons'
ON CONFLICT ("id") DO NOTHING;

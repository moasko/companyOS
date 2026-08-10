-- Compteur d'envois de courriels, par espace et par jour.
--
-- Les trois chemins qui font partir un mail (app Courrier, moteur de
-- campagnes, relances de factures) s'appuient sur le même relais SMTP et la
-- même réputation de domaine. Ce compteur leur impose un plafond commun :
-- le compter par chemin permettrait d'additionner les trois.

CREATE TABLE "mail_compteurs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "jour" TEXT NOT NULL,
    "envoyes" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_compteurs_pkey" PRIMARY KEY ("id")
);

-- Une seule ligne par espace et par jour : c'est cette contrainte qui rend
-- l'incrément atomique possible (upsert), et donc le plafond fiable quand
-- plusieurs envois partent en même temps.
CREATE UNIQUE INDEX "mail_compteurs_tenant_id_jour_key"
    ON "mail_compteurs"("tenant_id", "jour");

ALTER TABLE "mail_compteurs"
    ADD CONSTRAINT "mail_compteurs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

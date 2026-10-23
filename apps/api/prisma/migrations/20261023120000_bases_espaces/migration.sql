-- Une base par entreprise : le registre des bases (dans la base principale).
CREATE TABLE "bases_espaces" (
    "slug" TEXT NOT NULL,
    "nomBase" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "domaine" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bases_espaces_pkey" PRIMARY KEY ("slug")
);
CREATE UNIQUE INDEX "bases_espaces_nomBase_key" ON "bases_espaces"("nomBase");
CREATE UNIQUE INDEX "bases_espaces_tenantId_key" ON "bases_espaces"("tenantId");
CREATE UNIQUE INDEX "bases_espaces_domaine_key" ON "bases_espaces"("domaine");

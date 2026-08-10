-- Invitations : faire entrer quelqu'un dans un espace de travail.
--
-- Il n'y a pas de service d'envoi d'e-mail dans CompanyOS, et il ne faut
-- pas en supposer un : beaucoup d'équipes travaillent avec une connexion
-- intermittente. Une invitation produit donc un **code** que l'inviteur
-- transmet comme il veut — de vive voix, par message, par téléphone.
--
-- Le code est stocké tel quel : il ne vaut que pour un espace, un rôle et
-- une durée limitée, et il devient inutilisable dès qu'il est accepté.
-- Le hacher empêcherait de le réafficher à l'inviteur qui l'a perdu, ce
-- qui est le cas d'usage courant.

CREATE TABLE "invitations" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "email"       TEXT NOT NULL,
    "role"        "Role" NOT NULL DEFAULT 'MEMBER',
    "code"        TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt"   TIMESTAMP(3) NOT NULL,
    "acceptedAt"  TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invitations_code_key" ON "invitations"("code");
CREATE INDEX "invitations_tenantId_idx" ON "invitations"("tenantId");

-- Une seule invitation en attente par adresse et par espace : sans cela,
-- inviter deux fois la même personne créerait deux codes valides, dont
-- l'un resterait actif après l'arrivée de l'intéressé.
CREATE UNIQUE INDEX "invitations_en_attente_unique"
  ON "invitations" ("tenantId", "email")
  WHERE "acceptedAt" IS NULL;

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Adresses e-mail en minuscules.
--
-- Avant la normalisation à l'inscription, une adresse était stockée telle
-- que saisie : « Moasko.dev@gmail.com ». Le contrôle d'exploitant compare
-- désormais l'adresse à l'identique (minuscules), et refusait donc la
-- console à un exploitant légitime dont le compte avait une majuscule.
--
-- On ne touche pas aux adresses qui entreraient en collision avec un
-- compte existant (« VOUS@x » à côté de « vous@x ») : c'est précisément le
-- doublon que la normalisation empêche de créer, et le fusionner en
-- silence attribuerait un compte à la mauvaise personne.
UPDATE "users" AS u
SET "email" = lower(u."email")
WHERE u."email" <> lower(u."email")
  AND NOT EXISTS (
    SELECT 1 FROM "users" AS autre
    WHERE autre."id" <> u."id" AND lower(autre."email") = lower(u."email")
  );

UPDATE "invitations"
SET "email" = lower("email")
WHERE "email" <> lower("email");

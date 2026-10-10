// Droit à l'effacement : l'anonymisation d'une personne dans une fiche.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://test@localhost:1/test";
process.env.JWT_SECRET ||= "secret-de-test";

const { anonymiserDonnees, ANONYME } = await import("../src/routes/conformite.js");

test("une fiche qui décrit la personne perd ses champs personnels", () => {
  const { data, change } = anonymiserDonnees(
    { nom: "Awa Koné", email: "Awa.Kone@exemple.ci", telephone: "0707", statut: "actif", montant: 120, secteur: "Santé" },
    "awa.kone@exemple.ci",
  );
  assert.equal(change, true);
  assert.equal(data.nom, ANONYME);
  assert.equal(data.email, ANONYME);
  assert.equal(data.telephone, ANONYME);
  assert.equal(data.statut, "actif", "les données métier restent");
  assert.equal(data.montant, 120);
  assert.equal(data.secteur, "Santé");
});

test("une simple mention est remplacée sans toucher au reste", () => {
  const { data, change } = anonymiserDonnees(
    { nom: "Pharmacie du Plateau", notes: "Contact : awa.kone@exemple.ci (comptabilité)" },
    "awa.kone@exemple.ci",
  );
  assert.equal(change, true);
  assert.equal(data.nom, "Pharmacie du Plateau");
  assert.equal(data.notes, `Contact : ${ANONYME} (comptabilité)`);
});

test("les sous-objets (destinataires d'une campagne) sont traités un par un", () => {
  const { data } = anonymiserDonnees(
    {
      sujet: "Promo",
      destinataires: [
        { email: "awa.kone@exemple.ci", nom: "Awa", ouvert: true },
        { email: "yao@exemple.ci", nom: "Yao", ouvert: false },
      ],
    },
    "awa.kone@exemple.ci",
  );
  assert.equal(data.sujet, "Promo");
  assert.deepEqual(data.destinataires[0], { email: ANONYME, nom: ANONYME, ouvert: true });
  assert.deepEqual(data.destinataires[1], { email: "yao@exemple.ci", nom: "Yao", ouvert: false });
});

test("rien à changer : la fiche est rendue telle quelle", () => {
  const { change } = anonymiserDonnees({ nom: "X" }, "awa.kone@exemple.ci");
  assert.equal(change, false);
});

test("les caractères spéciaux de la valeur ne sont pas interprétés", () => {
  const { data } = anonymiserDonnees({ notes: "tel +225 (07) 07 07" }, "+225 (07) 07 07");
  assert.equal(data.notes, `tel ${ANONYME}`);
});

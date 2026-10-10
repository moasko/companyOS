// Les règles d'accès aux applications, sans base de données.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://test@localhost:1/test";
process.env.JWT_SECRET ||= "secret-de-test";

const acces = await import("../src/acces.js");

const membre = { id: "m1", role: "MEMBER" };
const admin = { id: "a1", role: "ADMIN" };

test("la Paie et les RH sont fermées par défaut, le reste ouvert", () => {
  assert.equal(acces.regleDe("paie", null).mode, "admins");
  assert.equal(acces.regleDe("rh", { acces: null }).mode, "admins");
  assert.equal(acces.regleDe("facturation", null).mode, "membres");
  assert.equal(acces.regleDe("paie", { acces: { mode: "membres" } }).mode, "membres");
});

test("les administrateurs passent toujours", () => {
  assert.equal(acces.autoriseSelon(admin, { mode: "admins" }), true);
  assert.equal(acces.autoriseSelon(admin, { mode: "selection", membres: [] }), true);
  assert.equal(acces.autoriseSelon({ id: "o", role: "OWNER" }, { mode: "admins" }), true);
});

test("un membre selon la règle", () => {
  assert.equal(acces.autoriseSelon(membre, { mode: "membres" }), true);
  assert.equal(acces.autoriseSelon(membre, { mode: "admins" }), false);
  assert.equal(acces.autoriseSelon(membre, { mode: "selection", membres: ["m1"] }), true);
  assert.equal(acces.autoriseSelon(membre, { mode: "selection", membres: ["x"] }), false);
  assert.equal(acces.autoriseSelon(undefined, { mode: "admins" }), false);
});

test("l'annuaire ne garde pas les données sensibles d'un salarié", () => {
  const fiche = {
    id: "s1",
    data: {
      nom: "Koné",
      prenom: "Awa",
      email: "awa@konan.ci",
      dateEmbauche: "2024-01-15",
      salaireBase: 450000,
      banque: "SGCI",
      numeroCnps: "CN-1",
      adresse: "Cocody",
      dateNaissance: "1990-01-01",
      notes: "confidentiel",
    },
  };
  const vue = acces.enAnnuaire(fiche);
  assert.deepEqual(Object.keys(vue.data).sort(), ["dateEmbauche", "email", "nom", "prenom"]);
  assert.equal(vue.id, "s1");
});

test("les collections partagées des RH", () => {
  const sal = { module: "rh", collection: "salaries" };
  const abs = { module: "rh", collection: "absences" };
  const bul = { module: "paie", collection: "bulletins" };
  assert.equal(acces.lecturePartagee(sal), "annuaire");
  assert.equal(acces.lecturePartagee(abs), "libre");
  assert.equal(acces.lecturePartagee(bul), null);

  assert.equal(acces.creationPartagee(abs, { etat: "demande" }), true);
  assert.equal(acces.creationPartagee(abs, { etat: "approuve" }), false);
  assert.equal(acces.creationPartagee(sal, { etat: "demande" }), false);

  const demande = { userId: "m1", data: { etat: "demande" } };
  assert.equal(acces.suppressionPartagee(abs, demande, membre), true);
  assert.equal(acces.suppressionPartagee(abs, { ...demande, userId: "x" }, membre), false);
  assert.equal(
    acces.suppressionPartagee(abs, { userId: "m1", data: { etat: "approuve" } }, membre),
    false,
  );
});

test("écriture : lecture seule possible, jamais pour un administrateur", () => {
  const regle = (ecriture) => ({ mode: "membres", ...(ecriture ? { ecriture } : {}) });
  assert.equal(acces.ecritureSelon(membre, regle()), true, "par défaut, qui lit écrit");
  assert.equal(acces.ecritureSelon(membre, regle({ mode: "tous" })), true);
  assert.equal(acces.ecritureSelon(membre, regle({ mode: "admins" })), false);
  assert.equal(acces.ecritureSelon(admin, regle({ mode: "admins" })), true);
  assert.equal(acces.ecritureSelon(membre, regle({ mode: "selection", membres: ["m1"] })), true);
  assert.equal(acces.ecritureSelon(membre, regle({ mode: "selection", membres: ["x"] })), false);
  // Sans accès, pas d'écriture, quelle que soit la règle d'écriture.
  assert.equal(acces.ecritureSelon(membre, { mode: "admins", ecriture: { mode: "tous" } }), false);
});

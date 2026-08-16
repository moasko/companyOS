import test from "node:test";
import assert from "node:assert/strict";

import {
  SCHEMA_VERSION,
  normaliser,
  problemes,
} from "../src/apps/modules/studio/domaine.js";

test("normaliser conserve les réglages visuels du Studio", () => {
  const definition = normaliser({
    collections: [
      {
        key: "clients",
        label: "Clients",
        vue: { mode: "cartes", carte: ["nom", "email"] },
        fields: [
          {
            key: "nom",
            label: "Nom",
            type: "texte",
            largeur: "plein",
            section: "Coordonnées",
          },
          { key: "email", label: "E-mail", type: "email" },
        ],
      },
    ],
  });

  assert.equal(definition.schemaVersion, SCHEMA_VERSION);
  assert.equal(definition.genre, "donnees");
  assert.deepEqual(definition.collections[0].vue, {
    mode: "cartes",
    carte: ["nom", "email"],
  });
  assert.equal(definition.collections[0].fields[0].largeur, "plein");
  assert.equal(definition.collections[0].fields[0].section, "Coordonnées");
});

test("normaliser retire un widget dont la référence a disparu", () => {
  const definition = normaliser({
    collections: [
      {
        key: "clients",
        label: "Clients",
        fields: [{ key: "nom", label: "Nom", type: "texte" }],
      },
    ],
    accueil: [
      { type: "compteur", collection: "clients", titre: "Clients" },
      { type: "somme", collection: "clients", champ: "montant", titre: "Total" },
    ],
  });

  assert.deepEqual(definition.accueil, [
    { type: "compteur", collection: "clients", titre: "Clients" },
  ]);
});

test("la validation détecte les relations et formules cassées", () => {
  const erreurs = problemes({
    name: "Suivi",
    slug: "suivi",
    definition: {
      collections: [
        {
          key: "taches",
          label: "Tâches",
          fields: [
            { key: "client", label: "Client", type: "relation", cible: "inconnue" },
            { key: "total", label: "Total", type: "calcul", formule: "prix * quantite" },
          ],
        },
      ],
    },
  });

  assert.equal(
    erreurs.some((erreur) => erreur.includes("collection qui n'existe pas")),
    true,
  );
  assert.equal(
    erreurs.some((erreur) => erreur.includes("prix")),
    true,
  );
});

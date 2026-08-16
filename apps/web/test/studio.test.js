import test from "node:test";
import assert from "node:assert/strict";

import {
  SCHEMA_VERSION,
  appliquerAutomatisations,
  normaliser,
  problemes,
  sectionPourProbleme,
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

test("normaliser conserve une interface composée et sécurise ses propriétés", () => {
  const definition = normaliser({
    collections: [
      {
        key: "clients",
        label: "Clients",
        fields: [{ key: "nom", label: "Nom", type: "texte" }],
      },
    ],
    pages: [
      {
        id: "accueil",
        nom: "Accueil",
        composants: [
          {
            id: "kpis",
            type: "section",
            label: "Indicateurs",
            style: { direction: "grille", colonnes: 3, gap: 18 },
          },
          {
            id: "total-clients",
            type: "compteur",
            label: "Total clients",
            collection: "clients",
            parentId: "kpis",
            style: { largeur: "50", padding: 200, alignement: "centre", fond: "accent" },
            responsive: {
              tablet: { largeur: "100" },
              mobile: { largeur: "100", masque: true, padding: 8 },
            },
          },
          {
            id: "ouvrir-clients",
            type: "bouton",
            label: "Voir les clients",
            action: { type: "collection", cible: "clients" },
          },
          { id: "script", type: "javascript", label: "Interdit" },
        ],
      },
    ],
  });

  assert.equal(definition.pages[0].composants.length, 3);
  assert.equal(definition.pages[0].composants[1].parentId, "kpis");
  assert.deepEqual(definition.pages[0].composants[1].style, {
    largeur: "50",
    padding: 64,
    alignement: "centre",
    fond: "accent",
  });
  assert.deepEqual(definition.pages[0].composants[1].responsive.mobile, {
    largeur: "100",
    padding: 8,
    masque: true,
  });
  assert.deepEqual(definition.pages[0].composants[2].action, {
    type: "collection",
    cible: "clients",
  });
});

test("le moteur no-code applique les règles sans exécuter de script", () => {
  const resultat = appliquerAutomatisations(
    {
      automatisations: [
        {
          nom: "Priorité grands comptes",
          active: true,
          collection: "opportunites",
          declencheur: "creation",
          conditions: [{ champ: "montant", operateur: "superieur", valeur: 1000000 }],
          actions: [{ type: "definir", champ: "priorite", valeur: "Haute" }],
        },
      ],
    },
    "opportunites",
    "creation",
    { montant: 2500000, priorite: "Normale" },
  );
  assert.equal(resultat.valeurs.priorite, "Haute");
  assert.deepEqual(resultat.declenchees, ["Priorité grands comptes"]);
});

test("une règle no-code peut préparer une notification contrôlée", () => {
  const resultat = appliquerAutomatisations(
    {
      automatisations: [
        {
          nom: "Alerte validation",
          collection: "demandes",
          declencheur: "modification",
          conditions: [{ champ: "statut", operateur: "egal", valeur: "Validée" }],
          actions: [
            {
              type: "notifier",
              titre: "Demande validée",
              message: "Le traitement peut commencer.",
            },
          ],
        },
      ],
    },
    "demandes",
    "modification",
    { statut: "Validée" },
  );
  assert.deepEqual(resultat.notifications, [
    { titre: "Demande validée", message: "Le traitement peut commencer." },
  ]);
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

test("une erreur de publication renvoie vers l'écran qui peut la corriger", () => {
  assert.equal(sectionPourProbleme("Donnez un nom à l'application."), "identite");
  assert.equal(sectionPourProbleme("L'adresse doit commencer par https://."), "adresse");
  assert.equal(sectionPourProbleme("La formule de Total n'est pas valide."), "donnees");
});

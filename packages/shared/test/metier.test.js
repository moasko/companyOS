import test from "node:test";
import assert from "node:assert/strict";

import { audienceDe, htmlDe, resumeDe } from "../src/campagnes.js";
import {
  adresseValide,
  adressesDe,
  appliquerModele,
  pretAEnvoyer,
} from "../src/courrier.js";
import { etatPaiement, prochainNumero, totalLigne, totaux } from "../src/facturation.js";

test("calcule les remises et la TVA par ligne", () => {
  const document = {
    remiseGlobale: 10,
    lignes: [
      { qte: 2, pu: 100, remise: 5, tva: 18 },
      { qte: 1, pu: 50, remise: 0, tva: 0 },
    ],
  };

  assert.equal(totalLigne(document.lignes[0]), 190);
  assert.deepEqual(totaux(document), {
    brut: 240,
    abattement: 24,
    ht: 216,
    tva: 30.78,
    ttc: 246.78,
    parTaux: [
      { taux: 0, base: 45, montant: 0 },
      { taux: 18, base: 171, montant: 30.78 },
    ],
  });
});

test("déduit correctement une facture partiellement payée", () => {
  const facture = {
    id: "fac-1",
    data: {
      type: "facture",
      statut: "envoye",
      echeance: "2026-08-01",
      lignes: [{ qte: 1, pu: 100, tva: 0 }],
    },
  };
  const reglements = [{ data: { documentId: "fac-1", montant: 40 } }];

  assert.deepEqual(etatPaiement(facture, reglements, "2026-08-16"), {
    id: "partielle",
    label: "Payée à 40 %",
    ton: "warn",
    reste: 60,
    paye: 40,
  });
});

test("la numérotation repart du plus grand numéro existant", () => {
  const documents = [
    { data: { numero: "FAC-2026-0001" } },
    { data: { numero: "FAC-2026-0007" } },
    { data: { numero: "DEV-2026-0099" } },
  ];
  assert.equal(prochainNumero(documents, "facture", 2026), "FAC-2026-0008");
});

test("normalise les destinataires et refuse un courrier incomplet", () => {
  assert.equal(adresseValide("contact@example.com"), true);
  assert.equal(adresseValide("contact@example"), false);
  assert.deepEqual(adressesDe(" A@example.com; a@example.com, b@example.org "), [
    "A@example.com",
    "b@example.org",
  ]);
  assert.equal(
    pretAEnvoyer({ a: "a@example.com", sujet: "Bonjour", texte: "Texte" }),
    true,
  );
  assert.equal(
    pretAEnvoyer({ a: "adresse invalide", sujet: "Bonjour", texte: "Texte" }),
    false,
  );
  assert.equal(appliquerModele("Bonjour {{ client }}", { client: "Awa" }), "Bonjour Awa");
});

test("filtre et déduplique l'audience sans tenir compte de la casse", () => {
  const clients = [
    { id: "1", data: { email: "A@EXAMPLE.COM", ville: "Abidjan" } },
    { id: "2", data: { email: "a@example.com", ville: "Abidjan" } },
    { id: "3", data: { email: "b@example.com", ville: "Bouaké" } },
    {
      id: "4",
      data: { email: "c@example.com", ville: "Abidjan", emailDesinscrit: true },
    },
  ];
  assert.deepEqual(
    audienceDe(clients, { ville: "abidjan" }).map((c) => c.id),
    ["1"],
  );
});

test("échappe le contenu HTML et bloque les URL dangereuses des campagnes", () => {
  const rendu = htmlDe(
    {
      texte: '<img src=x onerror="alert(1)">',
      couleur: '" onmouseover="alert(1)',
      cta: { label: "Cliquer <ici>", url: "" },
    },
    {
      entreprise: '<script>alert("x")</script>',
      lienCta: "javascript:alert(1)",
      pixel: "data:text/html,attaque",
    },
  );

  assert.equal(rendu.includes("<script>"), false);
  assert.equal(rendu.includes('<img src=x onerror="alert(1)">'), false);
  assert.equal(rendu.includes("javascript:"), false);
  assert.equal(rendu.includes("data:text/html"), false);
  assert.equal(rendu.includes("background:#e8590c"), true);
});

test("résume la progression d'une campagne", () => {
  assert.deepEqual(
    resumeDe([
      { statut: "envoye", ouvert: true, clique: true },
      { statut: "envoye" },
      { statut: "echec" },
      { statut: "attente" },
    ]),
    {
      total: 4,
      envoyes: 2,
      echecs: 1,
      attente: 1,
      ouverts: 1,
      cliques: 1,
      rebonds: 0,
      desinscrits: 0,
      tauxOuverture: 50,
      tauxClic: 50,
      pourcent: 75,
    },
  );
});

// Espace de démonstration : les données construites sont cohérentes
// (sans base de données — construireDemo ne fait que préparer les lignes).

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://test@localhost:1/test";
process.env.JWT_SECRET ||= "secret-de-test";

const { construireDemo, EQUIPE } = await import("../src/demo/construire.js");
const { totaux } = await import("@companyos/shared/facturation");

const membres = Object.fromEntries(EQUIPE.map((m, i) => [m.cle, { id: `u${i}`, email: `${m.cle}@test.ci`, name: `${m.prenom} ${m.nom}` }]));
const d = construireDemo({ tenantId: "t1", membres, maintenant: new Date("2026-10-17T10:00:00Z") });
const de = (module, collection) => d.records.filter((r) => r.module === module && r.collection === collection);

test("chaque application a des données", () => {
  for (const m of ["crm", "facturation", "stock", "caisse", "comptabilite", "rh", "paie", "achats", "frais", "agenda", "projets", "campagnes", "classeur", "notepad", "entreprise", "signature"]) {
    assert.ok(d.records.some((r) => r.module === m), m);
  }
  assert.ok(d.courriels.length > 5);
  assert.ok(d.fichiers.length > 10);
  assert.ok(d.automatisations.length >= 4);
});

test("toutes les écritures comptables sont équilibrées et numérotées sans doublon", () => {
  const ecr = de("comptabilite", "ecritures");
  for (const e of ecr) {
    const solde = e.data.lignes.reduce((s, l) => s + l.debit - l.credit, 0);
    assert.ok(Math.abs(solde) <= 1, `${e.data.libelle} : ${solde}`);
  }
  const numeros = ecr.map((e) => e.data.numero);
  assert.equal(new Set(numeros).size, numeros.length);
  // Trésorerie positive : la démo n'affiche pas une entreprise en faillite.
  const tresorerie = ecr.flatMap((e) => e.data.lignes).filter((l) => l.compte.startsWith("5")).reduce((s, l) => s + l.debit - l.credit, 0);
  assert.ok(tresorerie > 0);
});

test("le stock n'est jamais négatif et une rupture est montrée", () => {
  const mv = de("stock", "mouvements").sort((a, b) => a.data.date.localeCompare(b.data.date) || a.createdAt - b.createdAt);
  const finals = [];
  for (const a of de("stock", "articles")) {
    let s = 0;
    for (const m of mv.filter((x) => x.data.articleId === a.id)) {
      const x = m.data;
      if (x.sens === "entree") s += x.quantite;
      else if (x.sens === "sortie") s -= x.quantite;
      else if (x.sens === "inventaire") s = x.quantite;
      assert.ok(s >= 0, `${a.data.reference} négatif le ${x.date}`);
    }
    finals.push(s);
  }
  assert.ok(finals.includes(0));
});

test("factures : tous les états sont représentés et les règlements ne dépassent pas le dû", () => {
  const factures = de("facturation", "factures");
  const statuts = new Set(factures.map((f) => `${f.data.type}:${f.data.statut}`));
  for (const s of ["facture:envoye", "facture:brouillon", "facture:annule", "devis:accepte", "devis:refuse", "avoir:envoye"]) assert.ok(statuts.has(s), s);
  for (const f of factures) {
    const paye = de("facturation", "reglements").filter((r) => r.data.documentId === f.id).reduce((s, r) => s + r.data.montant, 0);
    assert.ok(paye <= Math.round(totaux(f.data).ttc) + 1, f.data.numero);
  }
});

test("aucune donnée ne déclenche d'envoi réel", () => {
  for (const c of de("campagnes", "campagnes")) assert.ok(["terminee", "brouillon"].includes(c.data.statut));
  for (const a of de("campagnes", "automatisations")) assert.equal(a.data.actif, false);
});

test("les bulletins de paie sont complets", () => {
  const b = de("paie", "bulletins");
  assert.ok(b.length >= 20);
  for (const x of b) assert.ok(x.data.calcul.net > 0 && x.data.calcul.rubriques.length > 3);
});

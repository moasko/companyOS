import test from "node:test";
import assert from "node:assert/strict";
import {
  cheminDe,
  contenuDossier,
  descendants,
  nomUnique,
  dansLaDescendance,
  dateLisible,
  dossiersDe,
  emplacementDe,
  indexer,
  lireDossierChoisi,
  lireReglages,
  rechercher,
  tailleLisible,
  trier,
  typeLisible,
} from "../src/apps/explorateur.js";

const noeuds = [
  { id: "d1", name: "Documents", type: "FOLDER", parentId: null },
  { id: "d2", name: "2026", type: "FOLDER", parentId: "d1" },
  { id: "d3", name: "Archives", type: "FOLDER", parentId: null },
  { id: "f1", name: "Contrat signé.pdf", type: "FILE", parentId: "d2", size: 2048, updatedAt: "2026-10-09T10:00:00Z" },
  { id: "f2", name: "budget.xlsx", type: "FILE", parentId: "d1", size: 10, updatedAt: "2026-10-10T08:00:00Z" },
  { id: "f3", name: "contrat-type.docx", type: "FILE", parentId: null, size: 500, updatedAt: "2026-01-01T00:00:00Z" },
];
const index = indexer(noeuds);

test("chemin et emplacement", () => {
  assert.deepEqual(cheminDe(index, "d2").map((e) => e.name), ["Cloud", "Documents", "2026"]);
  assert.deepEqual(cheminDe(index, null).map((e) => e.name), ["Cloud"]);
  assert.equal(emplacementDe(index, noeuds[3]), "Cloud › Documents › 2026");
  assert.deepEqual(dossiersDe(index, null).map((d) => d.name), ["Archives", "Documents"]);
});

test("un dossier ne va pas dans sa descendance", () => {
  assert.equal(dansLaDescendance(index, "d1", "d2"), true);
  assert.equal(dansLaDescendance(index, "d1", "d1"), true);
  assert.equal(dansLaDescendance(index, "d2", "d1"), false);
  assert.equal(dansLaDescendance(index, "d1", null), false);
});

test("recherche : accents et casse ignorés, débuts de nom d'abord", () => {
  assert.deepEqual(rechercher(noeuds, "CONTRAT").map((n) => n.id), ["f1", "f3"]);
  assert.deepEqual(rechercher(noeuds, "contrat signe").map((n) => n.id), ["f1"]);
  assert.deepEqual(rechercher(noeuds, "  "), []);
});

test("tri : dossiers en tête, puis la clé", () => {
  const liste = noeuds.filter((n) => n.parentId === null || n.parentId === "d1");
  assert.deepEqual(trier(liste).map((n) => n.id), ["d2", "d3", "d1", "f2", "f3"]);
  assert.deepEqual(trier(liste, { cle: "taille", sens: "desc" }).filter((n) => n.type === "FILE").map((n) => n.id), ["f3", "f2"]);
  assert.deepEqual(trier(liste, { cle: "date", sens: "desc" }).filter((n) => n.type === "FILE").map((n) => n.id), ["f2", "f3"]);
  assert.equal(trier(liste)[0].type, "FOLDER");
  assert.deepEqual(trier([{ name: "fichier 10", type: "FILE" }, { name: "fichier 2", type: "FILE" }]).map((n) => n.name), ["fichier 2", "fichier 10"]);
});

test("libellés", () => {
  assert.equal(typeLisible(noeuds[3]), "Document PDF");
  assert.equal(typeLisible({ type: "FILE", name: "x.abc" }), "Fichier ABC");
  assert.equal(typeLisible(noeuds[0]), "Dossier");
  assert.equal(tailleLisible(512), "512 o");
  assert.equal(tailleLisible(2048), "2,0 Ko");
  assert.equal(tailleLisible(5 * 1024 ** 3), "5,0 Go");
  const maintenant = new Date("2026-10-10T12:00:00");
  assert.match(dateLisible("2026-10-10T08:30:00", maintenant), /^aujourd'hui/);
  assert.match(dateLisible("2026-10-09T08:30:00", maintenant), /^hier/);
});

test("réglages : valeurs sûres même si le stockage est abîmé", () => {
  const faux = (v) => ({ getItem: () => v });
  assert.equal(lireReglages(faux("pas du json")).vue, "grille");
  const r = lireReglages(faux(JSON.stringify({ vue: "liste", tri: { cle: "pirate" }, favoris: [{ id: "d1", name: "Documents" }, { bidon: 1 }] })));
  assert.equal(r.vue, "liste");
  assert.equal(r.tri.cle, "nom");
  assert.deepEqual(r.favoris, [{ id: "d1", name: "Documents" }]);
});

test("import de dossier : chemins relatifs", () => {
  const r = lireDossierChoisi([{ name: "a.txt", webkitRelativePath: "Projet/src/a.txt" }, { name: "b.txt", webkitRelativePath: "" }]);
  assert.deepEqual(r.map((x) => x.chemin), [["Projet", "src"], []]);
});

test("descendants, contenu d'un dossier et nom libre", () => {
  const index = indexer(noeuds);
  const ids = descendants(index, "d1").map((n) => n.id).sort();
  assert.ok(ids.includes("d2"));
  assert.ok(!ids.includes("d1"));
  assert.equal(descendants(index, null).length, noeuds.length);
  const c = contenuDossier(index, "d1");
  assert.equal(c.dossiers + c.fichiers, ids.length);
  assert.equal(nomUnique(["Nouveau dossier"], "Nouveau dossier"), "Nouveau dossier (2)");
  assert.equal(nomUnique(["a.txt", "A (2).txt"], "a.txt"), "a (3).txt");
  assert.equal(nomUnique([], "libre"), "libre");
});

import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";

import {
  feuilleVide,
  remplacerTout,
  sommeAutomatique,
  trouver,
  trierPlage,
  repereColonne,
  recopierAvecPoignee,
  agregatAutomatique,
  retirerDoublonsPlage,
  surlignerDoublons,
  styler,
  valeurAffichee,
  valeurCalculeeClasseur,
  optionsValidation,
  resume,
} from "../src/apps/modules/classeur/domaine.js";
import { versXlsx } from "../src/apps/modules/classeur/xlsx.js";

const grille = (valeurs) => valeurs.map((ligne) => ligne.map((v) => ({ v: String(v) })));

test("la somme automatique agrandit la feuille sans écraser la sélection", () => {
  const cellules = grille([["10"], ["20"]]);
  const resultat = sommeAutomatique(cellules, { l: 0, c: 0, l2: 1, c2: 0 });
  assert.equal(resultat.length, 3);
  assert.equal(resultat[1][0].v, "20");
  assert.equal(resultat[2][0].v, "=SOMME(A1:A2)");
});

test("le tri conserve ensemble les cellules de chaque ligne", () => {
  const resultat = trierPlage(grille([["Zoé", "3"], ["Alice", "1"], ["Marc", "2"]]), {
    l: 0, c: 0, l2: 2, c2: 1,
  });
  assert.deepEqual(resultat.map((ligne) => ligne.map((c) => c.v)), [
    ["Alice", "1"], ["Marc", "2"], ["Zoé", "3"],
  ]);
});

test("rechercher repart après la cellule active et remplacer ignore la casse", () => {
  const cellules = grille([["Client Alpha", "alpha"], ["Client Beta", ""]]);
  assert.deepEqual(trouver(cellules, "client", { l: 0, c: 0 }), { l: 1, c: 0 });
  assert.deepEqual(
    remplacerTout(cellules, "alpha", "Gamma").map((ligne) => ligne.map((c) => c.v)),
    [["Client Gamma", "Gamma"], ["Client Beta", ""]],
  );
});

test("une nouvelle feuille démarre avec les volets libérés", () => {
  assert.deepEqual(feuilleVide().figees, { lignes: 0, colonnes: 0 });
});

test("les repères de colonnes progressent de A à ZZ", () => {
  assert.equal(repereColonne(0), "A");
  assert.equal(repereColonne(25), "Z");
  assert.equal(repereColonne(26), "AA");
  assert.equal(repereColonne(701), "ZZ");
});

test("la poignée prolonge une série numérique", () => {
  const resultat = recopierAvecPoignee(grille([["10"], ["20"], [""]]), {
    l: 0, c: 0, l2: 1, c2: 0,
  }, { l: 2, c: 0 });
  assert.equal(resultat[2][0].v, "30");
});

test("la poignée décale les références relatives mais conserve les absolues", () => {
  const cellules = grille([["1", "=A1+$A$1"], ["", ""]]);
  const resultat = recopierAvecPoignee(cellules, { l: 0, c: 1, l2: 0, c2: 1 }, { l: 1, c: 1 });
  assert.equal(resultat[1][1].f, "=A2+$A$1");
});

test("les agrégats rapides génèrent les formules attendues", () => {
  const resultat = agregatAutomatique(grille([["2"], ["4"]]), {
    l: 0, c: 0, l2: 1, c2: 0,
  }, "MOYENNE");
  assert.equal(resultat[2][0].v, "=MOYENNE(A1:A2)");
});

test("la suppression des doublons compacte uniquement la plage", () => {
  const resultat = retirerDoublonsPlage(grille([
    ["A", "1", "hors"], ["A", "1", "reste"], ["B", "2", "ici"],
  ]), { l: 0, c: 0, l2: 2, c2: 1 });
  assert.deepEqual(resultat.map((ligne) => ligne.map((c) => c.v)), [
    ["A", "1", "hors"], ["B", "2", "reste"], ["", "", "ici"],
  ]);
});

test("la mise en évidence marque toutes les occurrences dupliquées", () => {
  const resultat = surlignerDoublons(grille([["Alpha"], ["alpha"], ["Beta"]]), {
    l: 0, c: 0, l2: 2, c2: 0,
  });
  assert.equal(resultat[0][0].s.couleurFond, "FCE8E6");
  assert.equal(resultat[1][0].s.couleurFond, "FCE8E6");
  assert.equal(resultat[2][0].s, undefined);
});

test("une formule importée utilise son résultat Excel mis en cache", () => {
  const cellules = [[{ v: "42", f: "=SOMME(A2:A10)" }]];
  assert.equal(valeurAffichee(cellules, 0, 0, "€"), "42");
});

test("une formule recalcule une référence absolue vers la feuille Paramètres", () => {
  const ventes = feuilleVide("Ventes", 2, 2);
  const parametres = feuilleVide("Paramètres", 2, 6);
  parametres.cellules[0][5] = { v: "0.18" };
  ventes.cellules[0][0] = { v: "0", f: "=1000*'Paramètres'!$F$1" };
  ventes.cellules[0][1] = { v: "0", f: "=A1*2" };
  const classeur = { titre: "Test", feuilles: [ventes, parametres] };

  assert.equal(valeurCalculeeClasseur(classeur, 0, 0, 0), "180");
  assert.equal(valeurCalculeeClasseur(classeur, 0, 0, 1), "360");
  parametres.cellules[0][5] = { v: "0.2" };
  assert.equal(valeurCalculeeClasseur(classeur, 0, 0, 1), "400");
});

test("une validation de liste suit une plage de la feuille Paramètres", () => {
  const saisie = feuilleVide("Saisie", 2, 2);
  const parametres = feuilleVide("Paramètres", 6, 3);
  parametres.cellules[3][2] = { v: "Espèces" };
  parametres.cellules[4][2] = { v: "Wave" };
  const validation = {
    type: "liste",
    options: [],
    source: { feuille: "Paramètres", plage: { l1: 3, c1: 2, l2: 5, c2: 2 } },
  };
  const classeur = { feuilles: [saisie, parametres] };
  assert.deepEqual(optionsValidation(classeur, validation), ["Espèces", "Wave"]);
  parametres.cellules[5][2] = { v: "Carte" };
  assert.deepEqual(optionsValidation(classeur, validation), ["Espèces", "Wave", "Carte"]);
});

test("effacer le style conserve la formule et son résultat Excel", () => {
  const cellules = [[{ v: "42", f: "=SOMME(A2:A3)", s: { gras: true } }]];
  const resultat = styler(cellules, { l: 0, c: 0, l2: 0, c2: 0 }, { gras: false });

  assert.equal(resultat[0][0].v, "42");
  assert.equal(resultat[0][0].f, "=SOMME(A2:A3)");
  assert.equal(resultat[0][0].s, undefined);
});

test("l’export Excel conserve les fusions, validations et métadonnées CompanyOS", async () => {
  const feuille = feuilleVide("Données", 3, 3);
  feuille.fusions = [{ l1: 0, c1: 0, l2: 0, c2: 1 }];
  feuille.cellules[1][0] = { v: "Oui", validation: { type: "liste", options: ["Oui", "Non"] } };
  feuille.cellules[1][1] = { v: "TRUE", type: "checkbox", s: { bordures: { bottom: { style: "thin", couleur: "2563EB" } } } };
  feuille.cellules[0][2] = { v: "Documentation", href: "https://example.com/a?x=1&y=2", commentaire: "À vérifier" };
  feuille.objets = [{ id: "objet-1", type: "forme", ancre: { l: 1, c: 1, dx: 0, dy: 0 } }];
  feuille.hauteurs = { 1: 52 };
  feuille.lignesMasquees = [2];
  feuille.colonnesMasquees = [2];
  feuille.filtres = [{ c: 0, entete: 0, l2: 2, valeur: "Oui" }];
  const blob = await versXlsx({ titre: "Test", feuilles: [feuille] });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  const meta = JSON.parse(await zip.file("companyos/classeur.json").async("string"));
  const rels = await zip.file("xl/worksheets/_rels/sheet1.xml.rels").async("string");
  const commentaires = await zip.file("xl/comments1.xml").async("string");

  assert.match(xml, /<mergeCell ref="A1:B1"\/>/);
  assert.match(xml, /<dataValidation type="list"/);
  assert.match(xml, /<c r="B2" s="\d+" t="b"><v>1<\/v><\/c>/);
  assert.match(xml, /<hyperlink ref="C1" r:id="rIdLien1"\/>/);
  assert.match(xml, /<legacyDrawing r:id="rIdCommentairesVml"\/>/);
  assert.match(rels, /Target="https:\/\/example\.com\/a\?x=1&amp;y=2"/);
  assert.match(commentaires, /<comment ref="C1" authorId="0">/);
  assert.match(commentaires, /À vérifier/);
  assert.match(xml, /ht="39" customHeight="1"/);
  assert.match(xml, /hidden="1"/);
  assert.match(xml, /<col min="3" max="3" hidden="1"\/>/);
  assert.match(xml, /<autoFilter ref="A1:A3"\/>/);
  assert.equal(meta.feuilles[0].objets[0].id, "objet-1");
  assert.equal(meta.feuilles[0].cellules.find((c) => c.l === 1 && c.c === 1).type, "checkbox");
});

test("la barre d'état ignore les cellules vides, comme Excel", () => {
  const cellules = grille([["10"], [""], ["20"], ["texte"]]);
  const r = resume(cellules, { l: 0, c: 0, l2: 3, c2: 0 });
  assert.equal(r.remplies, 3);
  assert.equal(r.n, 2);
  assert.equal(r.somme, 30);
  assert.equal(r.moyenne, 15);
});

test("une formule sans valeur stockée est bien calculée (barre d'état, export)", () => {
  const cellules = [[{ v: "2" }, { v: "3" }, { f: "=A1*B1" }]];
  const r = resume(cellules, { l: 0, c: 0, l2: 0, c2: 2 });
  assert.equal(r.remplies, 3);
  assert.equal(r.somme, 11);
});

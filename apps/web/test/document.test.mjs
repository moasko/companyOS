import test from "node:test";
import assert from "node:assert/strict";
import { creerDocument, creerPage, documentDepuisEtat, documentVersEtat, dupliquerPage, elementVersObjet, nouvelId, objetVersElement, pageDepuisObjets, validerDocument } from "../src/apps/modules/image/logique/document.ts";

test("creerDocument produit un document d'une page valide", () => {
  const doc = creerDocument("Affiche promo", 1080, 1350);
  assert.equal(doc.name, "Affiche promo");
  assert.equal(doc.version, 1);
  assert.equal(doc.pages.length, 1);
  assert.equal(doc.activePageId, doc.pages[0].id);
  assert.equal(doc.pages[0].width, 1080);
  assert.ok(validerDocument(doc));
});

test("les identifiants générés sont uniques", () => {
  const ensemble = new Set(Array.from({ length: 200 }, () => nouvelId()));
  assert.equal(ensemble.size, 200);
});

test("un texte passe du runtime au modèle et revient sans perte", () => {
  const objet = {
    id: "t1", type: "texte", nom: "Titre", texte: "FORMATION", x: 10, y: 20, largeur: 500, hauteur: 80,
    police: "Impact", taille: 64, gras: true, italique: false, alignement: "centre",
    couleur: "#f7d774", degrade: { actif: true, angle: 90, couleurA: "#f7d774", couleurB: "#a86f1f" },
    interligne: 1.2, espacement: 2, casse: "majuscules", souligne: false, barre: false,
    texteContour: { actif: true, couleur: "#000", epaisseur: 2 }, opacite: 1, visible: true,
    parentId: null, children: [], ombre: { active: true, couleur: "#000", flou: 8, x: 2, y: 2 },
  };
  const element = objetVersElement(objet);
  assert.equal(element.type, "text");
  const retour = elementVersObjet(element);
  assert.equal(retour.texte, "FORMATION");
  assert.equal(retour.police, "Impact");
  assert.equal(retour.taille, 64);
  assert.equal(retour.gras, true);
  assert.equal(retour.alignement, "centre");
  assert.deepEqual(retour.degrade, objet.degrade);
  assert.deepEqual(retour.texteContour, objet.texteContour);
  assert.deepEqual(retour.ombre, objet.ombre);
  assert.equal(retour.interligne, 1.2);
  assert.equal(retour.casse, "majuscules");
});

test("une forme à rayons multiples et motif survit au round-trip", () => {
  const objet = { id: "f1", type: "forme", forme: "rectangle", nom: "Panneau", x: 0, y: 0, largeur: 400, hauteur: 300, couleur: "#fff", contour: "#ccc", epaisseur: 1, rayon: 12, rayons: [0, 0, 48, 0], degrade: { actif: false, angle: 90, couleurA: "#fff", couleurB: "#0d99ff" }, motif: "points", opacite: 1, visible: true, parentId: null, children: [] };
  const element = objetVersElement(objet);
  assert.equal(element.type, "shape");
  const retour = elementVersObjet(element);
  assert.deepEqual(retour.rayons, [0, 0, 48, 0]);
  assert.equal(retour.motif, "points");
  assert.equal(retour.degrade.actif, false);
});

test("une image garde ses extras (srcOriginal) au round-trip", () => {
  const objet = { id: "i1", type: "image", nom: "Photo", src: "data:image/png;base64,AAA", srcOriginal: "data:image/png;base64,ORIG", x: 0, y: 0, largeur: 100, hauteur: 100, retourneX: true, filtres: { luminosite: 110, contraste: 100, saturation: 90, teinte: 0, flou: 0, niveauxGris: 0, sepia: 0 }, opacite: 1, visible: true, parentId: null, children: [] };
  const retour = elementVersObjet(objetVersElement(objet));
  assert.equal(retour.src, objet.src);
  assert.equal(retour.srcOriginal, objet.srcOriginal);
  assert.equal(retour.retourneX, true);
  assert.deepEqual(retour.filtres, objet.filtres);
});

test("dupliquerPage régénère tous les identifiants et remappe les relations", () => {
  const page = creerPage("Scène", 800, 600);
  const groupe = { id: "g1", type: "group", nom: "Groupe", x: 0, y: 0, largeur: 10, hauteur: 10, rotation: 0, opacite: 1, visible: true, verrouille: false, parentId: null, children: ["e1"] };
  const enfant = { id: "e1", type: "forme", forme: "ellipse", nom: "Pastille", x: 5, y: 5, largeur: 20, hauteur: 20, couleur: "#0d99ff", contour: "#000", epaisseur: 0, rayon: 0, rotation: 0, opacite: 1, visible: true, verrouille: false, parentId: "g1", children: [] };
  page.elements = [objetVersElement(groupe), objetVersElement(enfant)];
  const copie = dupliquerPage(page);
  assert.notEqual(copie.id, page.id);
  assert.equal(copie.name, "Scène copie");
  const ids = copie.elements.map((e) => e.id);
  assert.ok(!ids.includes("g1") && !ids.includes("e1"));
  const [groupeCopie, enfantCopie] = copie.elements;
  assert.equal(enfantCopie.parentId, groupeCopie.id);
  assert.deepEqual(groupeCopie.children, [enfantCopie.id]);
});

test("documentDepuisEtat et documentVersEtat forment un aller-retour", () => {
  const pages = [
    { id: "p1", nom: "Une", largeur: 800, hauteur: 600, fond: "#fff", fondTransparent: false, objets: [{ id: "a", type: "forme", forme: "rectangle", nom: "R", x: 1, y: 2, largeur: 30, hauteur: 40, couleur: "#eee", contour: "#000", epaisseur: 1, rayon: 4, rotation: 0, opacite: 1, visible: true, parentId: null, children: [] }], guides: { h: [10], v: [] } },
    { id: "p2", nom: "Deux", largeur: 800, hauteur: 600, fond: "#fff", fondTransparent: true, objets: [], guides: { h: [], v: [] }, cachee: true },
  ];
  const doc = documentDepuisEtat({ nom: "Doc", pages, pageActive: "p2" });
  assert.ok(validerDocument(doc));
  const etat = documentVersEtat(doc);
  assert.equal(etat.nom, "Doc");
  assert.equal(etat.pageActive, "p2");
  assert.equal(etat.pages[1].cachee, true);
  assert.deepEqual(etat.pages[0].guides, { h: [10], v: [] });
  assert.equal(etat.pages[0].objets[0].rayon, 4);
});

test("pageDepuisObjets mappe le masquage et le fond", () => {
  const page = pageDepuisObjets({ id: "p9", nom: "Brouillon", largeur: 500, hauteur: 500, fond: "#123456", fondTransparent: false, objets: [], guides: { h: [], v: [] }, cachee: true });
  assert.equal(page.hidden, true);
  assert.deepEqual(page.background, { couleur: "#123456", transparent: false });
});

test("validerDocument refuse les structures incomplètes", () => {
  assert.equal(validerDocument(null), null);
  assert.equal(validerDocument({}), null);
  assert.equal(validerDocument({ id: "d", name: "n", version: 1, pages: [] }), null);
  const doc = creerDocument("ok");
  doc.activePageId = "inconnu";
  assert.equal(validerDocument(doc), null);
});

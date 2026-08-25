import test from "node:test";
import assert from "node:assert/strict";
import { filtreCss, cheminPlume, pointsEtoile, geometrieAncres, rayonsEffectifs, degradeCss } from "../src/apps/modules/image/logique/rendu.js";
import { hexVersRgb, supprimerArrierePlan, bornesContenu, etirerContraste, tamponRestauration, composerFondCouleur, composerFondFlou } from "../src/apps/modules/image/logique/image.js";
import { MODELES } from "../src/apps/modules/image/logique/modeles.js";
import { calculerZoneRecadrage, positionApresRecadrage, CHAMPS_APPLICABLES, champsSpecifiques } from "../src/apps/modules/image/logique/recadrage.js";
import { copieObjet, filtreNeutre, OUTILS_FORMES, FILTRES_REGLAGES } from "../src/apps/modules/image/logique/constantes.js";

test("le filtre CSS par défaut est neutre", () => {
  assert.equal(filtreCss(), "brightness(100%) contrast(100%) saturate(100%) hue-rotate(0deg) blur(0px) grayscale(0%) sepia(0%)");
});

test("la teinte accepte les calques anciens sans propriété teinte", () => {
  const ancien = { luminosite: 120, contraste: 100, saturation: 90, flou: 2, niveauxGris: 0, sepia: 0 };
  assert.match(filtreCss(ancien), /hue-rotate\(0deg\)/);
  assert.match(filtreCss({ ...ancien, teinte: 180 }), /hue-rotate\(180deg\)/);
});

test("l'étoile produit dix sommets, pointe vers le haut", () => {
  const points = pointsEtoile(100, 80);
  assert.equal(points.length, 10);
  assert.deepEqual(points[0].map(Math.round), [0, -40]);
  const rayon = (p) => Math.hypot(p[0], p[1]);
  assert.ok(rayon(points[1]) < rayon(points[0]));
  assert.ok(points[1][1] < 0);
});

test("le chemin plume trace des droites sans poignées", () => {
  const d = cheminPlume([{ px: 0, py: 0 }, { px: 1, py: 1 }], 100, 50, false);
  assert.equal(d, "M 0.00 0.00 L 100.00 50.00");
});

test("le chemin plume produit des cubiques avec poignées et ferme par Z", () => {
  const ancres = [
    { px: 0, py: 0, bx: 0.5, by: 0 },
    { px: 1, py: 1, ax: 0.5, ay: 1 },
  ];
  const ouvert = cheminPlume(ancres, 100, 100, false);
  assert.match(ouvert, /^M 0\.00 0\.00 C 50\.00 0\.00 50\.00 100\.00 100\.00 100\.00$/);
  const ferme = cheminPlume([...ancres, { px: 0, py: 1 }], 100, 100, true);
  assert.ok(ferme.endsWith(" Z"));
  // Seul le segment aux poignées est une cubique ; la fermeture ajoute le
  // retour vers l'ancre initiale suivi du marqueur Z.
  assert.equal((ferme.match(/ C /g) || []).length + (ferme.startsWith("M ") ? ferme.split("C").length - 2 : 0), 1);
  assert.ok(/L [\d.]+ [\d.]+ Z$/.test(ferme));
});

test("la zone de recadrage borne le rectangle au calque et exige 8 px", () => {
  const calque = { x: 100, y: 100, largeur: 200, hauteur: 100, rotation: 0 };
  const zone = calculerZoneRecadrage(calque, { x: 150, y: 130 }, { x: 400, y: 160 });
  assert.deepEqual(zone, { x: 50, y: 30, largeur: 150, hauteur: 30 });
  assert.equal(calculerZoneRecadrage(calque, { x: 110, y: 110 }, { x: 114, y: 118 }), null);
});

test("sans rotation, une zone centrée garde le calque sur place", () => {
  const calque = { x: 0, y: 0, largeur: 200, hauteur: 100 };
  const zone = { x: 50, y: 25, largeur: 100, hauteur: 50 };
  const suite = positionApresRecadrage(calque, zone);
  assert.equal(Math.round(suite.x), 50);
  assert.equal(Math.round(suite.y), 25);
});

test("la position après recadrage compense la rotation du calque", () => {
  const calque = { x: 0, y: 0, largeur: 100, hauteur: 100, rotation: 90 };
  // Zone décentrée à droite (qx=+20) : après rotation de 90°, ce décalage
  // devient +20 sur Y ; le nouveau centre attendu est (60, 60).
  const zone = { x: 60, y: 40, largeur: 20, hauteur: 20 };
  const suite = positionApresRecadrage(calque, zone);
  assert.equal(Math.round(suite.x * 1000) / 1000, 60);
  assert.equal(Math.round(suite.y * 1000) / 1000, 60);
});

test("une image n'accepte jamais de champs typographiques collés", () => {
  const source = { couleur: "#123456", taille: 42, police: "Arial" };
  const valeurs = { ...champsSpecifiques.texte(source), opacite: 0.5 };
  const applicables = CHAMPS_APPLICABLES.image;
  assert.equal(applicables.includes("police"), false);
  assert.equal(applicables.includes("taille"), false);
  assert.ok(applicables.includes("filtres"));
  void valeurs;
});

test("copieObjet isole les filtres entre deux états d'historique", () => {
  const objet = { id: "a", filtres: { ...filtreNeutre } };
  const copie = copieObjet(objet);
  copie.filtres.luminosite = 5;
  assert.equal(objet.filtres.luminosite, 100);
});

test("les constantes restent cohérentes avec l'inspecteur", () => {
  assert.equal(FILTRES_REGLAGES.length, 7);
  assert.ok(OUTILS_FORMES.includes("triangle") && OUTILS_FORMES.includes("ligne"));
});

test("la vectorisation couvre triangle, étoile et ligne, pas les formes paramétriques", () => {
  const triangle = geometrieAncres({ forme: "triangle", largeur: 60, hauteur: 40 });
  assert.equal(triangle.ferme, true);
  assert.equal(triangle.points.length, 3);
  const etoile = geometrieAncres({ forme: "etoile", largeur: 100, hauteur: 100 });
  assert.equal(etoile.ferme, true);
  assert.equal(etoile.points.length, 10);
  const ligne = geometrieAncres({ forme: "ligne", largeur: 80, hauteur: 20 });
  assert.equal(ligne.ferme, false);
  assert.deepEqual(ligne.points, [{ x: 0, y: 0 }, { x: 80, y: 20 }]);
  assert.equal(geometrieAncres({ forme: "rectangle", largeur: 10, hauteur: 10 }), null);
  assert.equal(geometrieAncres({ forme: "ellipse", largeur: 10, hauteur: 10 }), null);
});

const empreinte = (pixels, largeur) => ({ donnees: new Uint8ClampedArray(pixels), largeur, hauteur: pixels.length / (largeur * 4) });

test("hexVersRgb gère les formats courts et longs", () => {
  assert.deepEqual(hexVersRgb("#ff8000"), { rouge: 255, vert: 128, bleu: 0 });
  assert.deepEqual(hexVersRgb("#f80"), { rouge: 255, vert: 136, bleu: 0 });
  assert.deepEqual(hexVersRgb(""), { rouge: 0, vert: 0, bleu: 0 });
});

test("le détourage global respecte la tolérance et adoucit les bords", () => {
  // Deux pixels blancs pleins, un gris clair (proche), un rouge lointain.
  const pixels = [
    255, 255, 255, 255, 255, 255, 255, 255,
    250, 250, 250, 255, 255, 0, 0, 255,
  ];
  const image = empreinte(pixels, 2);
  const touches = supprimerArrierePlan(image, { rouge: 255, vert: 255, bleu: 255, tolerance: 30, adoucissement: 0 });
  assert.equal(touches, 3);
  assert.equal(image.donnees[3], 0);
  assert.equal(image.donnees[7], 0);
  assert.equal(image.donnees[11], 0);
  assert.equal(image.donnees[15], 255);
});

test("l'adoucissement réduit l'alpha au lieu de couper net", () => {
  const image = empreinte([240, 240, 240, 255], 1);
  supprimerArrierePlan(image, { rouge: 255, vert: 255, bleu: 255, tolerance: 60, adoucissement: 1 });
  assert.ok(image.donnees[3] > 0 && image.donnees[3] < 255);
});

test("le mode contigu ne traverse pas une barrière de couleur", () => {
  // Ligne : blanc, blanc, rouge, blanc — la graine à gauche ne doit pas
  // atteindre le blanc de droite à travers le rouge.
  const image = empreinte([
    255, 255, 255, 255, 255, 255, 255, 255,
    255, 0, 0, 255, 255, 255, 255, 255,
  ], 4);
  const touches = supprimerArrierePlan(image, { rouge: 255, vert: 255, bleu: 255, tolerance: 10, contigue: true, graine: [0, 0], adoucissement: 0 });
  assert.equal(touches, 2);
  assert.equal(image.donnees[15], 255);
});

test("bornesContenu encadre les pixels opaques", () => {
  const image = empreinte([
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 10, 20, 30, 255, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 40, 50, 60, 200,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ], 3);
  assert.deepEqual(bornesContenu(image), { x: 1, y: 1, largeur: 2, hauteur: 2 });
  assert.equal(bornesContenu(empreinte(new Array(16).fill(0), 2)), null);
});

test("l'auto-contraste étire les canaux et refuse les spans nuls", () => {
  const plate = empreinte([120, 120, 120, 255, 120, 120, 120, 255], 2);
  assert.equal(etirerContraste(plate), false);
  const image = empreinte([50, 50, 50, 255, 100, 100, 100, 255], 2);
  assert.equal(etirerContraste(image), true);
  assert.equal(image.donnees[0], 0);
  assert.equal(image.donnees[4], 255);
});

test("les rayons par coin sont bornés et retombent sur le rayon unique", () => {
  assert.deepEqual(rayonsEffectifs({ largeur: 100, hauteur: 40, rayon: 60 }), [20, 20, 20, 20]);
  assert.deepEqual(rayonsEffectifs({ largeur: 100, hauteur: 40, rayons: [50, 0, 30, -5] }), [20, 0, 20, 0]);
  assert.deepEqual(rayonsEffectifs({ largeur: 80, hauteur: 80 }), [0, 0, 0, 0]);
});

test("chaque modèle fabrique une scène complète à identifiants frais", () => {
  assert.ok(MODELES.length >= 2);
  for (const modele of MODELES) {
    assert.ok(modele.largeur > 0 && modele.hauteur > 0);
    const objets = modele.fabriquer();
    assert.ok(objets.length >= 5, `${modele.nom} doit contenir au moins 5 objets`);
    const ids = new Set(objets.map((o) => o.id));
    assert.equal(ids.size, objets.length, "les identifiants doivent être uniques");
    for (const objet of objets) {
      assert.ok(objet.type && objet.nom, "type et nom requis");
      assert.ok(Number.isFinite(objet.x) && Number.isFinite(objet.y));
      assert.ok(objet.largeur > 0 && objet.hauteur > 0);
      assert.equal(objet.parentId, null);
    }
    // Deux fabrications successives ne partagent aucun objet.
    const seconde = modele.fabriquer();
    assert.ok(!objets.some((o) => seconde.some((p) => p.id === o.id)));
  }
});

test("le dégradé CSS suit l'angle et les deux couleurs", () => {
  assert.equal(degradeCss({ angle: 45, couleurA: "#fff", couleurB: "#000" }), "linear-gradient(45deg, #fff, #000)");
  assert.equal(degradeCss({ couleurA: "#a", couleurB: "#b" }), "linear-gradient(0deg, #a, #b)");
});

test("le tampon de restauration copie un disque borné depuis l'original", () => {
  const courant = empreinte(new Array(36).fill(0), 3);
  const originale = empreinte([
    200, 200, 200, 255, 210, 210, 210, 255, 220, 220, 220, 255,
    230, 230, 230, 255, 240, 240, 240, 255, 250, 250, 250, 255,
    10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255,
  ], 3);
  const touches = tamponRestauration(courant, originale, 1, 1, 1);
  assert.equal(touches, 5);
  assert.equal(courant.donnees[0], 0);
  assert.equal(courant.donnees[16], 240);
  assert.equal(courant.donnees[28], 20);
});

test("le fond de remplacement ne touche que la transparence", () => {
  const image = empreinte([
    255, 0, 0, 255, 0, 0, 0, 0,
    0, 0, 0, 128, 0, 255, 0, 255,
  ], 2);
  composerFondCouleur(image, { rouge: 1, vert: 2, bleu: 3 });
  assert.deepEqual([image.donnees[0], image.donnees[3]], [255, 255]);
  assert.deepEqual([image.donnees[4], image.donnees[7]], [1, 255]);
  assert.deepEqual([image.donnees[12], image.donnees[15]], [0, 255]);
});

test("le fond flou fond les pixels semi-transparents et remplit les vides", () => {
  const image = empreinte([
    255, 0, 0, 255, 0, 0, 0, 0,
    100, 100, 100, 128, 0, 0, 0, 0,
  ], 2);
  const fond = empreinte([
    10, 10, 10, 255, 20, 20, 20, 255,
    30, 30, 30, 255, 40, 40, 40, 255,
  ], 2);
  composerFondFlou(image, fond);
  assert.equal(image.donnees[3], 255);
  assert.equal(image.donnees[4], 20);
  assert.equal(image.donnees[8], Math.round((100 * 128 + 30 * 127) / 255));
  assert.equal(image.donnees[12], 40);
});

import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";

import { depuisExcel, evaluerFormule, versExcel } from "../src/apps/modules/tableur/formules.js";
import { calculer } from "../src/apps/modules/tableur/domaine.js";
import { feuilleVide, formater, valeurCalculeeClasseur } from "../src/apps/modules/classeur/domaine.js";
import { versXlsx } from "../src/apps/modules/classeur/xlsx.js";

/// Une feuille de test : A1… en lignes de texte, comme les cellules du
/// Classeur (tout est stocké en texte).
const feuille = (lignes) => {
  const cellules = lignes.map((l) => l.map((v) => String(v)));
  const lire = (l, c) => {
    const v = cellules[l]?.[c];
    return typeof v === "string" && v.startsWith("=") ? calculer(cellules, l, c) : v;
  };
  return (formule) => evaluerFormule(formule, {
    cellule: (nom, l, c) => (nom ? "#REF!" : lire(l, c)),
    dimensions: () => ({ lignes: cellules.length, colonnes: Math.max(...cellules.map((l) => l.length)) }),
  });
};

const ventes = feuille([
  ["Produit", "Qté", "Prix", "Statut", "Date"],
  ["Riz 25 kg", "12", "12000", "Payé", "2026-10-01"],
  ["Huile 5 L", "8", "6500", "En retard", "2026-10-05"],
  ["Sucre 1 kg", "30", "900", "Payé", "2026-09-20"],
  ["Riz 50 kg", "", "22000", "", ""],
]);

test("opérations, priorités et parenthèses", () => {
  assert.equal(ventes("=1+2*3"), "7");
  assert.equal(ventes("=(1+2)*3"), "9");
  assert.equal(ventes("=2^3^2"), "64");
  assert.equal(ventes("=-2^2"), "4");
  assert.equal(ventes("=50%*B2"), "6");
  assert.equal(ventes("=0,1+0,2"), "0.3");
});

test("la virgule décimale à la française, la virgule séparatrice à l'anglaise", () => {
  assert.equal(ventes("=B2*1,18"), "14.16");
  assert.equal(ventes("=ARRONDI(1,456;2)"), "1.46");
  assert.equal(ventes("=ROUND(1.456,2)"), "1.46");
  assert.equal(ventes("=MAX(1,2)"), "2");
  assert.equal(ventes("=SOMME(1,5;2,5)"), "4");
});

test("comparaisons, texte et concaténation", () => {
  assert.equal(ventes("=B2>10"), "VRAI");
  assert.equal(ventes('=A2="riz 25 KG"'), "VRAI");
  assert.equal(ventes('=A2&" — "&D2'), "Riz 25 kg — Payé");
  assert.equal(ventes('="Total : "&SOMME(B2:B4)'), "Total : 50");
  assert.equal(ventes('="a""b"'), 'a"b');
});

test("SI, ET, OU, SIERREUR, SI.CONDITIONS", () => {
  assert.equal(ventes('=SI(B2>10;"gros";"petit")'), "gros");
  assert.equal(ventes('=IF(B3>10,"big","small")'), "small");
  assert.equal(ventes("=SI(B2>100;1)"), "FAUX");
  assert.equal(ventes("=ET(B2>10;C2>1000)"), "VRAI");
  assert.equal(ventes("=OU(B3>10;C3>10000)"), "FAUX");
  assert.equal(ventes("=SIERREUR(B2/0;0)"), "0");
  assert.equal(ventes("=SIERREUR(RECHERCHEV(\"Mil\";A2:C5;3;FAUX);\"inconnu\")"), "inconnu");
  assert.equal(ventes('=SI.CONDITIONS(B4>20;"A";B4>10;"B";VRAI;"C")'), "A");
  // SI n'évalue que la branche retenue : la division par zéro est ignorée.
  assert.equal(ventes("=SI(VRAI;1;1/0)"), "1");
});

test("agrégats conditionnels", () => {
  assert.equal(ventes('=SOMME.SI(D2:D5;"Payé";B2:B5)'), "42");
  assert.equal(ventes('=SOMME.SI(B2:B5;">10")'), "42");
  assert.equal(ventes('=NB.SI(D2:D5;"Payé")'), "2");
  assert.equal(ventes('=NB.SI(A2:A5;"Riz*")'), "2");
  assert.equal(ventes('=NB.SI(D2:D5;"")'), "1");
  assert.equal(ventes('=NB.SI(D2:D5;"<>Payé")'), "2");
  assert.equal(ventes('=SOMME.SI.ENS(C2:C5;D2:D5;"Payé";B2:B5;">=20")'), "900");
  assert.equal(ventes('=NB.SI.ENS(D2:D5;"Payé";C2:C5;">5000")'), "1");
  assert.equal(ventes('=MOYENNE.SI(D2:D5;"Payé";B2:B5)'), "21");
  assert.equal(ventes('=SUMIF(D2:D5,"Payé",B2:B5)'), "42");
  assert.equal(ventes("=SOMMEPROD(B2:B4;C2:C4)"), "223000");
});

test("colonnes entières et agrégats qui ignorent texte et vides", () => {
  assert.equal(ventes("=SOMME(B:B)"), "50");
  assert.equal(ventes("=NB(B:B)"), "3");
  assert.equal(ventes("=NBVAL(D:D)"), "4");
  assert.equal(ventes("=MOYENNE(B2:B5)"), "16.6666666667");
});

test("recherches", () => {
  assert.equal(ventes('=RECHERCHEV("Huile 5 L";A2:C5;3;FAUX)'), "6500");
  assert.equal(ventes('=RECHERCHEV("huile*";A2:C5;2;0)'), "8");
  assert.equal(ventes('=RECHERCHEV("Mil";A2:C5;3;FAUX)'), "#N/A");
  assert.equal(ventes('=RECHERCHEV("Riz";A2:C5;9;FAUX)'), "#REF!");
  assert.equal(ventes('=RECHERCHEX("Sucre 1 kg";A2:A5;C2:C5)'), "900");
  assert.equal(ventes('=RECHERCHEX("Mil";A2:A5;C2:C5;"absent")'), "absent");
  assert.equal(ventes('=EQUIV("Sucre 1 kg";A2:A5;0)'), "3");
  assert.equal(ventes("=INDEX(A2:C5;2;3)"), "6500");
  assert.equal(ventes('=INDEX(C2:C5;EQUIV("Riz 50 kg";A2:A5;0))'), "22000");
  // Recherche approchée (barème) : la plus grande valeur inférieure ou égale.
  const bareme = feuille([["0", "0"], ["50000", "5"], ["100000", "10"]]);
  assert.equal(bareme("=RECHERCHEV(75000;A1:B3;2)"), "5");
  assert.equal(bareme("=RECHERCHEV(100000;A1:B3;2;VRAI)"), "10");
});

test("fonctions de texte", () => {
  assert.equal(ventes("=GAUCHE(A2;3)"), "Riz");
  assert.equal(ventes("=DROITE(A2;5)"), "25 kg");
  assert.equal(ventes("=STXT(A2;5;2)"), "25");
  assert.equal(ventes("=NBCAR(A2)"), "9");
  assert.equal(ventes("=MAJUSCULE(A2)"), "RIZ 25 KG");
  assert.equal(ventes('=NOMPROPRE("aMINATA koné")'), "Aminata Koné");
  assert.equal(ventes('=SUPPRESPACE("  a   b ")'), "a b");
  assert.equal(ventes('=SUBSTITUE(A2;"kg";"Kg")'), "Riz 25 Kg");
  assert.equal(ventes('=TROUVE("25";A2)'), "5");
  assert.equal(ventes('=CHERCHE("KG";A2)'), "8");
  assert.equal(ventes('=JOINDRE.TEXTE(", ";VRAI;A2:A4)'), "Riz 25 kg, Huile 5 L, Sucre 1 kg");
  assert.equal(ventes('=CONCATENER(A3;" (";B3;")")'), "Huile 5 L (8)");
  assert.equal(ventes('=TEXTE(C2;"# ##0")'), "12 000");
  assert.equal(ventes('=TEXTE(0,185;"0,0 %")'), "18,5 %");
  assert.equal(ventes('=TEXTE(E2;"jj/mm/aaaa")'), "01/10/2026");
  assert.equal(ventes('=TEXTE(E2;"mmmm aaaa")'), "octobre 2026");
  assert.equal(ventes('=CNUM("12 000,5")'), "12000.5");
});

test("dates : calcul, extraction, échéances", () => {
  assert.equal(ventes("=DATE(2026;10;8)"), "2026-10-08");
  assert.equal(ventes("=E2+30"), "2026-10-31");
  assert.equal(ventes("=E3-E2"), "4");
  assert.equal(ventes("=ANNEE(E2)"), "2026");
  assert.equal(ventes("=MOIS(E2)"), "10");
  assert.equal(ventes("=JOUR(E3)"), "5");
  assert.equal(ventes("=JOURSEM(E2;2)"), "4"); // jeudi
  assert.equal(ventes("=FIN.MOIS(E2;0)"), "2026-10-31");
  assert.equal(ventes("=FIN.MOIS(E2;1)"), "2026-11-30");
  assert.equal(ventes("=MOIS.DECALER(DATE(2026;1;31);1)"), "2026-02-28");
  assert.equal(ventes('=DATEDIF(DATE(2020;3;15);DATE(2026;10;8);"A")'), "6");
  assert.equal(ventes("=NB.JOURS.OUVRES(DATE(2026;10;5);DATE(2026;10;16))"), "10");
  assert.equal(ventes("=SERIE.JOUR.OUVRE(DATE(2026;10;9);1)"), "2026-10-12");
  assert.match(ventes("=AUJOURDHUI()"), /^\d{4}-\d{2}-\d{2}$/);
});

test("erreurs : codes d'Excel, propagation, nom inconnu", () => {
  assert.equal(ventes("=1/0"), "#DIV/0!");
  assert.equal(ventes("=A2*2"), "#VALEUR!");
  assert.equal(ventes("=INCONNUE(1)"), "#NOM?");
  assert.equal(ventes("=1+"), "#ERREUR");
  assert.equal(ventes("=SOMME(1/0;2)"), "#DIV/0!");
  assert.equal(ventes("=RACINE(-1)"), "#NOMBRE!");
});

test("le classeur lit les autres feuilles, plages comprises", () => {
  const saisie = feuilleVide("Saisie", 2, 2);
  const tarifs = feuilleVide("Tarifs 2026", 3, 2);
  tarifs.cellules[0] = [{ v: "Riz" }, { v: "12000" }];
  tarifs.cellules[1] = [{ v: "Huile" }, { v: "6500" }];
  tarifs.cellules[2] = [{ v: "Sucre" }, { v: "900" }];
  saisie.cellules[0][0] = { v: "Huile" };
  saisie.cellules[0][1] = { v: "", f: "=RECHERCHEV(A1;'Tarifs 2026'!A1:B3;2;FAUX)*2" };
  saisie.cellules[1][0] = { v: "", f: "=SOMME('Tarifs 2026'!B:B)" };
  const classeur = { titre: "t", feuilles: [saisie, tarifs] };
  assert.equal(valeurCalculeeClasseur(classeur, 0, 0, 1), "13000");
  assert.equal(valeurCalculeeClasseur(classeur, 0, 1, 0), "19400");
});

test("une date s'affiche à la française en format automatique", () => {
  assert.equal(formater("2026-10-08"), "08/10/2026");
});

test("traduction vers le fichier Excel : noms anglais, virgules, _xlfn", () => {
  assert.equal(versExcel("=SOMME(A1:A3;1,5)"), "SUM(A1:A3,1.5)");
  assert.equal(versExcel('=SI(A1>10;"a,b";FAUX)'), 'IF(A1>10,"a,b",FALSE)');
  assert.equal(versExcel("=RECHERCHEX(A1;B:B;C:C)"), "_xlfn.XLOOKUP(A1,B:B,C:C)");
  assert.equal(versExcel("=NB.SI.ENS(A1:A9;\">5\")"), 'COUNTIFS(A1:A9,">5")');
  assert.equal(versExcel("='Mes ventes'!$B$2*2"), "'Mes ventes'!$B$2*2");
  // Les fonctions métier deviennent le calcul qu'elles font.
  assert.equal(versExcel("=TTC(A1)"), "((A1)*(1+(18)/100))");
  assert.equal(versExcel("=TVA(A1;9)"), "((A1)*(9)/100)");
  assert.equal(versExcel("=1+"), null);
});

test("traduction depuis le fichier Excel : la formule redevient française", () => {
  assert.equal(depuisExcel("SUM(A1:A3,1.5)"), "=SOMME(A1:A3;1,5)");
  assert.equal(depuisExcel('IF(A1>10,"a,b",B1)'), '=SI(A1>10;"a,b";B1)');
  assert.equal(depuisExcel("_xlfn.XLOOKUP(A1,B:B,C:C)"), "=RECHERCHEX(A1;B:B;C:C)");
  assert.equal(depuisExcel("VLOOKUP(A2,Tarifs!$A$1:$B$9,2,FALSE)"), "=RECHERCHEV(A2;Tarifs!$A$1:$B$9;2;FAUX)");
  // Une référence structurée n'est pas comprise : la formule reste telle quelle.
  assert.equal(depuisExcel("SUM(Tableau1[Montant])"), "=SUM(Tableau1[Montant])");
});

test("l'export .xlsx écrit des formules qu'Excel comprend", async () => {
  const f = feuilleVide("Ventes", 2, 3);
  f.cellules[0] = [{ v: "10" }, { v: "20" }, { v: "", f: "=SOMME(A1:B1)" }];
  f.cellules[1] = [{ v: "", f: '=SI(C1>25;"ok";"non")' }, { v: "", f: "=C1>25" }, { v: "", f: "=TTC(C1)" }];
  const blob = await versXlsx({ titre: "Test", feuilles: [f] });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(xml, /<f>SUM\(A1:B1\)<\/f><v>30<\/v>/);
  assert.match(xml, /<f>IF\(C1&gt;25,&quot;ok&quot;,&quot;non&quot;\)<\/f>/);
  assert.match(xml, /t="b"><f>C1&gt;25<\/f><v>1<\/v>/);
  assert.match(xml, /<f>\(\(C1\)\*\(1\+\(18\)\/100\)\)<\/f>/);
  assert.doesNotMatch(xml, /SOMME|SI\(/);
});


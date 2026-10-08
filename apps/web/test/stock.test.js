import test from "node:test";
import assert from "node:assert/strict";

import { niveaux, niveauxParEntrepot, pmp } from "../src/apps/modules/stock/domaine.js";
import {
  aCompter,
  aReapprovisionner,
  barresCode39,
  classesABC,
  consommations,
  dormants,
  ecartsInventaire,
  ecritureInventaire,
  facturesALivrer,
  lignesDeCommande,
  listeEntrepots,
  lotsAPerimer,
  lotsEnStock,
  mouvementsInventaire,
  parCode,
  parFournisseur,
  pointDeCommande,
  prochainNumero,
  quantitesEnCommande,
  reservations,
  sortiesDeFacture,
  syntheseEntrepots,
} from "../src/apps/modules/stock/regles.js";

let n = 0;
const M = (data) => ({ id: `m${(n += 1)}`, createdAt: `2026-01-01T00:00:${String(n).padStart(2, "0")}`, data });
const A = (id, data = {}) => ({ id, createdAt: "2026-01-01", data: { designation: id, prixAchat: 100, ...data } });

test("niveaux par entrepôt : entrées, sorties, transferts, inventaires", () => {
  const ms = [
    M({ articleId: "a", sens: "entree", quantite: 10, date: "2026-09-01" }),
    M({ articleId: "a", sens: "entree", quantite: 5, entrepotId: "Y", date: "2026-09-02" }),
    M({ articleId: "a", sens: "transfert", quantite: 3, de: "Y", vers: "", date: "2026-09-03" }),
    M({ articleId: "a", sens: "sortie", quantite: 4, entrepotId: "", date: "2026-09-04" }),
    M({ articleId: "a", sens: "inventaire", quantite: 1, entrepotId: "Y", date: "2026-09-05" }),
  ];
  assert.deepEqual(niveauxParEntrepot(ms).a, { "": 9, Y: 1 });
  assert.equal(niveaux(ms).a, 10);
  // Un inventaire d'avant les entrepôts remet tout à plat.
  assert.equal(niveaux([...ms, M({ articleId: "a", sens: "inventaire", quantite: 7, date: "2026-09-06" })]).a, 7);
  // Le transfert n'entre pas dans le prix moyen.
  assert.equal(pmp(A("a"), ms), 100);
});

test("entrepôt principal implicite et synthèse", () => {
  assert.deepEqual(listeEntrepots([]).map((e) => e.id), [""]);
  // Le principal renommé garde l'identifiant vide ; les autres, le leur.
  const l = listeEntrepots([
    { id: "w2", data: { nom: "Dépôt Yopougon" } },
    { id: "w1", data: { nom: "Magasin Plateau", principal: true } },
  ]);
  assert.deepEqual(l.map((e) => [e.id, e.nom]), [["", "Magasin Plateau"], ["w2", "Dépôt Yopougon"]]);
  assert.equal(l[0].recordId, "w1");
  const ms = [M({ articleId: "a", sens: "entree", quantite: 10, prixUnitaire: 50, date: "2026-09-01" })];
  const s = syntheseEntrepots(listeEntrepots([]), [A("a")], ms);
  assert.equal(s[0].valeur, 500);
  assert.equal(s[0].references, 1);
});

test("consommation, point de commande et réapprovisionnement", () => {
  const ms = [M({ articleId: "a", sens: "entree", quantite: 100, date: "2026-09-01" })];
  for (let i = 0; i < 30; i += 1) ms.push(M({ articleId: "a", sens: "sortie", quantite: 3, date: `2026-09-${String(i + 1).padStart(2, "0")}` }));
  ms.push(M({ articleId: "a", sens: "transfert", quantite: 50, de: "", vers: "Y", date: "2026-09-20" }));
  const c = consommations(ms, { jusqua: "2026-09-30" });
  assert.equal(c.a, 3);
  const art = A("a", { delaiFournisseur: 5, stockSecurite: 6, qteCommande: 24, fournisseurId: "F1" });
  assert.equal(pointDeCommande(art, 3), 21);
  const r = aReapprovisionner({ articles: [art, A("b", { seuil: 2 })], mouvements: ms, jusqua: "2026-09-30" });
  assert.equal(r.length, 2); // a : 10 en stock < 21 ; b : 0 ≤ seuil 2
  const ra = r.find((x) => x.article.id === "a");
  assert.equal(ra.stock, 10);
  assert.equal(ra.qte % 24, 0);
  assert.ok(ra.qte >= 21 * 2 - 10);
  assert.equal(ra.couverture, 3);
  // Déjà commandé : plus rien à suggérer.
  assert.equal(aReapprovisionner({ articles: [art], mouvements: ms, enCommande: { a: 100 }, jusqua: "2026-09-30" }).length, 0);
  // Réservé : le disponible baisse.
  assert.equal(aReapprovisionner({ articles: [art], mouvements: ms, reserves: { a: 5 }, jusqua: "2026-09-30" })[0].dispo, 5);
  const g = parFournisseur(r);
  assert.equal(g[0].fournisseurId, "F1");
  assert.deepEqual(Object.keys(lignesDeCommande(g[0].lignes)[0]), ["articleId", "designation", "qte", "pu", "tva"]);
});

test("réservations et livraisons des factures", () => {
  const docs = [
    { id: "d1", data: { type: "devis", statut: "accepte", lignes: [{ articleId: "a", qte: 2 }] } },
    { id: "d2", data: { type: "devis", statut: "envoye", lignes: [{ articleId: "a", qte: 9 }] } },
    { id: "f1", data: { type: "facture", statut: "envoye", numero: "FAC-1", lignes: [{ articleId: "a", qte: 3 }, { designation: "libre", qte: 1 }] } },
    { id: "f2", data: { type: "facture", statut: "brouillon", lignes: [{ articleId: "a", qte: 7 }] } },
  ];
  assert.deepEqual(reservations(docs, []), { a: 5 });
  assert.equal(facturesALivrer(docs, []).length, 1);
  const s = sortiesDeFacture(docs[2], "Y");
  assert.equal(s.length, 1);
  assert.equal(s[0].origine, "facture:f1");
  const livre = [M(s[0])];
  assert.equal(facturesALivrer(docs, livre).length, 0);
  assert.deepEqual(reservations(docs, livre), { a: 2 });
});

test("quantités en commande chez les fournisseurs", () => {
  const commandes = [
    { id: "c1", data: { statut: "envoyee", lignes: [{ articleId: "a", qte: 10 }] } },
    { id: "c2", data: { statut: "brouillon", lignes: [{ articleId: "a", qte: 50 }] } },
    { id: "c3", data: { statut: "annulee", lignes: [{ articleId: "a", qte: 99 }] } },
  ];
  const receptions = [{ id: "r1", data: { commandeId: "c1", lignes: [{ articleId: "a", qte: 4 }] } }];
  // Le brouillon compte (sinon le réapprovisionnement le reproposerait).
  assert.deepEqual(quantitesEnCommande(commandes, receptions), { a: 56 });
});

test("lots : le stock restant est dans les lots qui périment le plus tard", () => {
  const ms = [
    M({ articleId: "a", sens: "entree", quantite: 24, lot: "L1", peremption: "2026-10-12", date: "2026-09-01" }),
    M({ articleId: "a", sens: "entree", quantite: 48, lot: "L2", peremption: "2026-11-20", date: "2026-09-10" }),
    M({ articleId: "a", sens: "entree", quantite: 240, lot: "L3", peremption: "2027-03-14", date: "2026-10-07" }),
    M({ articleId: "a", sens: "sortie", quantite: 30, date: "2026-10-07" }),
  ];
  const l = lotsEnStock("a", ms, 282, "2026-10-08");
  assert.deepEqual(l.map((x) => [x.lot, x.qte]), [["L2", 42], ["L3", 240]]);
  assert.equal(l[0].jours, 43);
  const p = lotsAPerimer([A("a")], ms, { jours: 60, jusqua: "2026-10-08" });
  assert.equal(p.length, 1);
  assert.equal(p[0].lot, "L2");
});

test("classement ABC, dormants et articles à compter", () => {
  const arts = [A("a"), A("b"), A("c"), A("d")];
  const ms = [
    ...arts.map((a) => M({ articleId: a.id, sens: "entree", quantite: 100, date: "2026-01-02" })),
    M({ articleId: "a", sens: "sortie", quantite: 80, date: "2026-09-10" }),
    M({ articleId: "b", sens: "sortie", quantite: 15, date: "2026-09-10" }),
    M({ articleId: "c", sens: "sortie", quantite: 5, date: "2026-09-10" }),
  ];
  const abc = classesABC(arts, ms, { jusqua: "2026-09-30" });
  assert.equal(abc.classes.a, "A");
  assert.equal(abc.classes.b, "B");
  assert.equal(abc.classes.c, "C");
  assert.equal(abc.classes.d, "C");
  assert.deepEqual(dormants(arts, ms, { jusqua: "2026-09-30" }).map((x) => x.article.id), ["d"]);
  const compte = [...ms, M({ articleId: "a", sens: "inventaire", entrepotId: "", quantite: 20, date: "2026-09-28" })];
  assert.ok(!aCompter(arts, compte, abc.classes, { jusqua: "2026-09-30" }).some((x) => x.id === "a"));
  assert.ok(aCompter(arts, compte, abc.classes, { jusqua: "2026-10-10" }).some((x) => x.id === "a"));
});

test("inventaire : écarts valorisés, mouvements et écriture", () => {
  const arts = [A("a"), A("b")];
  const ms = arts.map((a) => M({ articleId: a.id, sens: "entree", quantite: 10, prixUnitaire: 650, date: "2026-09-01" }));
  const lignes = [{ articleId: "a", attendu: 10, compte: 7, cause: "Casse" }, { articleId: "b", attendu: 10, compte: null }];
  const e = ecartsInventaire(lignes, arts, ms);
  assert.equal(e.comptes, 1);
  assert.equal(e.avecEcart, 1);
  assert.equal(e.valeur, -1950);
  const inv = { numero: "INV-0001", entrepotId: "Y", lignes };
  const mv = mouvementsInventaire(inv, "i1");
  assert.equal(mv.length, 1);
  assert.equal(mv[0].quantite, 7);
  assert.equal(mv[0].entrepotId, "Y");
  const ecr = ecritureInventaire(inv, "i1", e.valeur);
  assert.deepEqual(ecr.lignes, [{ compte: "6031", debit: 1950, credit: 0 }, { compte: "311", debit: 0, credit: 1950 }]);
  assert.equal(ecritureInventaire(inv, "i1", 0), null);
  assert.equal(prochainNumero([{ data: { numero: "INV-0007" } }], "INV"), "INV-0008");
});

test("code-barres : recherche et code 39", () => {
  const arts = [A("a", { codeBarre: "6111 2450 0217", reference: "LAI-397" })];
  assert.equal(parCode(arts, "611124500217").id, "a");
  assert.equal(parCode(arts, "lai-397").id, "a");
  assert.equal(parCode(arts, "x"), null);
  const c = barresCode39("Lai-397");
  assert.equal(c.texte, "LAI-397");
  // 9 caractères (avec les deux étoiles) × (5 barres) = 45 barres.
  assert.equal(c.barres.length, 45);
  // Chaque caractère : 6 étroits + 3 larges (×3) = 15 modules, + 1 d'espace.
  assert.equal(c.largeur, 9 * 16 - 1);
});

test("textes : français et anglais complets, aucune clé utilisée ne manque", async () => {
  const { TEXTES } = await import("../src/apps/modules/stock/textes.js");
  const fs = await import("node:fs");
  const fr = Object.keys(TEXTES.fr);
  const en = Object.keys(TEXTES.en);
  assert.deepEqual(fr.filter((k) => !TEXTES.en[k]), []);
  assert.deepEqual(en.filter((k) => !TEXTES.fr[k]), []);
  const racine = new URL("../src/apps/modules/stock/", import.meta.url);
  const fichiers = ["index.jsx", "commun.jsx", ...fs.readdirSync(new URL("vues/", racine)).map((f) => `vues/${f}`)];
  const utilisees = new Set();
  for (const f of fichiers) {
    const src = fs.readFileSync(new URL(f, racine), "utf8");
    for (const m of src.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) utilisees.add(m[1]);
  }
  // Les clés composées : chaque valeur possible doit exister.
  const composees = {
    sens_: ["entree", "sortie", "transfert", "inventaire"],
    etat_: ["rupture", "alerte", "ok"],
    filtre_: ["tous", "rupture", "alerte", "ok", "dormant"],
    tri_: ["designation", "stock", "valeur", "classe"],
    onglet_: ["vue", "fiche", "historique"],
    motifExemple_: ["entree", "sortie", "transfert"],
    cause_: ["casse", "vol", "erreur", "peremption", "autre"],
    filtreInv_: ["tous", "aCompter", "ecarts"],
    mode_: ["entree", "sortie", "transfert", "compter"],
    portee_: ["aCompter", "categorie", "tout"],
    statut_: ["ouvert", "valide"],
    validerScan_: ["entree", "sortie", "transfert", "compter"],
  };
  for (const [p, vs] of Object.entries(composees)) for (const v of vs) utilisees.add(p + v);
  assert.deepEqual([...utilisees].filter((k) => !TEXTES.fr[k]), []);
});

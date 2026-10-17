import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../src/livraisons.js";

test("transitions : une livraison livrée ne revient pas en arrière, un échec se reprogramme", () => {
  assert.ok(L.peutPasser("a_planifier", "planifiee"));
  assert.ok(L.peutPasser("echec", "a_planifier"));
  assert.ok(!L.peutPasser("livree", "a_planifier"));
  const d = L.passer({ statut: "planifiee", tourneeId: "t1", ordre: 2 }, "a_planifier", { par: "Aïcha" });
  assert.equal(d.tourneeId, "");
  assert.equal(d.historique.at(-1).par, "Aïcha");
  assert.throws(() => L.passer({ statut: "livree" }, "en_route"), /ne peut pas passer/);
});

test("numérotation : le plus grand numéro + 1, par année", () => {
  const fiches = [{ data: { numero: "LIV-2026-0007" } }, { data: { numero: "LIV-2025-0099" } }, { data: { numero: "x" } }];
  assert.equal(L.prochainNumero(fiches, "LIV", 2026), "LIV-2026-0008");
  assert.equal(L.prochainNumero([], "TRN", 2026), "TRN-2026-0001");
});

test("ordre de passage : pas d'aller-retour Yopougon ↔ Cocody, urgences d'abord", () => {
  const l = (id, commune, priorite = "normale") => ({ id, data: { commune, priorite } });
  const ordre = L.ordonnerArrets([l("a", "Yopougon"), l("b", "Cocody"), l("c", "Yopougon"), l("d", "Riviera"), l("u", "Abobo", "urgente")]).map((x) => x.id);
  assert.equal(ordre[0], "u");
  const iy = [ordre.indexOf("a"), ordre.indexOf("c")].sort();
  assert.equal(iy[1] - iy[0], 1, "les deux arrêts de Yopougon se suivent");
  const est = L.estimerTournee(ordre.map((id) => ({ data: { commune: { a: "Yopougon", b: "Cocody", c: "Yopougon", d: "Riviera", u: "Abobo" }[id] } })));
  assert.ok(est.km > 10 && est.minutes > 40);
});

test("GPS : extrait d'un lien Google Maps", () => {
  assert.deepEqual(L.gpsDepuisTexte("https://maps.google.com/?q=5.3612,-3.9874"), { lat: 5.3612, lng: -3.9874 });
  assert.deepEqual(L.gpsDepuisTexte("https://www.google.com/maps/@5.30214,-4.01022,17z"), { lat: 5.30214, lng: -4.01022 });
  assert.equal(L.gpsDepuisTexte("derrière la pharmacie"), null);
});

test("WhatsApp : numéro ivoirien et message", () => {
  assert.equal(L.numeroInternational("07 07 26 48 00"), "2250707264800");
  assert.equal(L.numeroInternational("+225 05 11 22 33 44"), "2250511223344");
  const msg = L.messageClient({ contact: "Paul Ahoussou", numero: "LIV-2026-0003" }, "en_route", { entreprise: "Akwaba", livreur: "Fatou", telLivreur: "0700000000" });
  assert.match(msg, /Paul, votre commande LIV-2026-0003 est en route avec Fatou/);
  assert.match(L.lienWhatsApp("0707264800", "Bonjour"), /^https:\/\/wa\.me\/2250707264800\?text=Bonjour$/);
});

test("indicateurs du jour et retard", () => {
  const jour = "2026-10-17";
  const ls = [
    { data: { date: jour, statut: "livree", encaissement: { montant: 5000 } } },
    { data: { date: jour, statut: "echec" } },
    { data: { date: jour, statut: "planifiee", montantAEncaisser: 12000, creneau: { fin: "10:00" } } },
    { data: { date: jour, statut: "a_planifier" } },
    { data: { date: "2026-10-18", statut: "a_planifier" } },
  ];
  const k = L.indicateurs(ls, jour, new Date("2026-10-17T11:00:00Z"));
  assert.equal(k.total, 4);
  assert.equal(k.tauxReussite, 50);
  assert.equal(k.aEncaisser, 12000);
  assert.equal(k.encaisse, 5000);
  assert.equal(k.enRetard, 1);
});

test("facture → livraison → sorties de stock et règlement", () => {
  const facture = { id: "f1", data: { type: "facture", statut: "envoye", numero: "FAC-2026-0001", clientId: "c1", clientNom: "Paul", clientEntreprise: "Hôtel", clientTelephone: "0707", clientVille: "Abidjan — Cocody", remiseGlobale: 0, lignes: [{ designation: "Riz", qte: 2, pu: 10000, tva: 18, remise: 0, articleId: "a1" }, { designation: "Frais de livraison", qte: 1, pu: 2000, tva: 0, livraison: true }] } };
  const reglements = [{ data: { documentId: "f1", montant: 3600 } }];
  const liv = L.depuisFacture(facture, { reglements });
  assert.equal(liv.commune, "Cocody");
  assert.equal(liv.colis.length, 1);
  assert.equal(liv.montantAEncaisser, 23600 + 2000 - 3600);
  assert.equal(L.facturesALivrer([facture], { livraisons: [{ data: { factureId: "f1", statut: "planifiee" } }] }).length, 0);
  assert.equal(L.facturesALivrer([facture], { livraisons: [{ data: { factureId: "f1", statut: "echec" } }] }).length, 1);
  const sorties = L.sortiesStock({ id: "l1", data: { numero: "LIV-1" } }, { facture });
  assert.equal(sorties[0].origine, "facture:f1");
  assert.equal(L.sortiesStock({ id: "l1", data: {} }, { facture, mouvements: [{ data: { origine: "facture:f1" } }] }).length, 0);
  const r = L.reglementDe({ id: "l1", data: { factureId: "f1", numero: "LIV-1", encaissement: { montant: 22000, moyen: "wave", reference: "W123", le: "2026-10-17T10:00:00Z" } } });
  assert.equal(r.moyen, "Mobile Money");
  assert.equal(r.date, "2026-10-17");
  assert.match(r.reference, /Wave — W123/);
});

test("véhicule : alertes d'échéance", () => {
  const a = L.alertesVehicule({ assuranceFin: "2026-10-01", visiteFin: "2026-11-01" }, "2026-10-17");
  assert.equal(a[0].ton, "danger");
  assert.equal(a[1].ton, "attention");
});

test("facture : les frais de livraison ne sont pas des colis", () => {
  const facture = { id: "f2", data: { type: "facture", statut: "envoye", numero: "FAC-2", lignes: [{ designation: "Riz 25 kg", qte: 2, pu: 15000, tva: 18, articleId: "a1" }, { designation: "Frais de livraison", qte: 1, pu: 2000, tva: 18 }] } };
  const liv = L.depuisFacture(facture, {});
  assert.deepEqual(liv.colis.map((x) => x.designation), ["Riz 25 kg"]);
  assert.equal(L.messageClient({ data: { contact: "Aya", montantAEncaisser: 25000 } }, "planifiee", { gabarits: { planifiee: "{client} : {montant}" } }), "Aya : 25 000 F");
});

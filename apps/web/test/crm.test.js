import test from "node:test";
import assert from "node:assert/strict";

import {
  analyserSaisie,
  appliquerVue,
  chronologieUnifiee,
  derniereActivite,
  doublons,
  echeanceDans,
  estEngagee,
  estLead,
  joursOuvresRestants,
  normaliserTelephone,
  performance,
  previsions,
  prochaineActivite,
  progressionObjectif,
  santeCompte,
  scoreLead,
  stagnation,
  ventesCompte,
} from "../src/apps/modules/crm/regles.js";
import { TEXTES } from "../src/apps/modules/crm/textes.js";

const opp = (id, data, extra = {}) => ({ id, data, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z", ...extra });
const act = (id, data) => ({ id, data });
const AUJ = "2026-10-09"; // un vendredi

test("une affaire sans activité depuis le seuil stagne", () => {
  const o = opp("o1", { clientId: "c1", etape: "devis", etapeLe: "2026-09-20" });
  assert.deepEqual(stagnation(o, [], { maintenant: AUJ }), { jours: 19, stagne: true, seuil: 14 });
  const appel = act("a1", { clientId: "c1", type: "appel", date: "2026-10-05" });
  assert.equal(stagnation(o, [appel], { maintenant: AUJ }).stagne, false);
  // Une tâche non faite n'est pas une activité.
  const tache = act("a2", { clientId: "c1", type: "tache", echeance: "2026-10-20", date: "2026-10-08", fait: false });
  assert.equal(derniereActivite(o, [tache]), "2026-09-20");
  // Le seuil se règle par étape, et une affaire close ne stagne jamais.
  assert.equal(stagnation(o, [], { maintenant: AUJ, seuils: { devis: 30 } }).stagne, false);
  assert.equal(stagnation(opp("o2", { etape: "gagnee" }), [], { maintenant: AUJ }).stagne, false);
});

test("une activité d'une autre affaire du même compte ne compte pas", () => {
  const o = opp("o1", { clientId: "c1", etape: "devis", etapeLe: "2026-09-01" });
  const autre = act("a1", { clientId: "c1", opportuniteId: "o9", type: "appel", date: "2026-10-08" });
  assert.equal(stagnation(o, [autre], { maintenant: AUJ }).stagne, true);
});

test("prochaine activité : la tâche non faite la plus proche, et son retard", () => {
  const o = opp("o1", { clientId: "c1", etape: "devis" });
  const r = prochaineActivite(o, [
    act("t1", { clientId: "c1", type: "tache", echeance: "2026-10-15" }),
    act("t2", { opportuniteId: "o1", type: "tache", echeance: "2026-10-06" }),
    act("t3", { clientId: "c1", type: "tache", echeance: "2026-10-01", fait: true }),
  ], AUJ);
  assert.equal(r.activite.id, "t2");
  assert.equal(r.enRetard, true);
  assert.equal(prochaineActivite(o, [], AUJ), null);
});

test("prévisions : gagné, engagé et pondéré ne se mélangent pas", () => {
  const opps = [
    opp("g", { etape: "gagnee", montant: 1000, dateCloture: "2026-10-02" }),
    opp("n", { etape: "negociation", montant: 2000, dateCloture: "2026-10-20" }),
    opp("q", { etape: "qualifie", montant: 1000, dateCloture: "2026-11-15" }),
    opp("r", { etape: "devis", montant: 500, dateCloture: "2026-08-01" }), // en retard → mois courant
    opp("p", { etape: "perdue", montant: 9000, dateCloture: "2026-10-03" }),
  ];
  const [oct, nov] = previsions(opps, { maintenant: AUJ, mois: 2 });
  assert.equal(oct.gagne, 1000);
  assert.equal(oct.engage, 2000);
  assert.equal(oct.pondere, 2000 * 0.75 + 500 * 0.5);
  assert.equal(nov.pondere, 300);
  assert.equal(estEngagee(opp("x", { etape: "devis", probabilite: 80 })), true);
});

test("objectif du mois et jours ouvrés restants", () => {
  assert.equal(joursOuvresRestants("2026-10-09"), 16); // 9 → 31 oct., hors week-ends
  const p = progressionObjectif(
    [opp("g", { etape: "gagnee", montant: 7400, dateCloture: "2026-10-01", responsableId: "u1" }),
     opp("h", { etape: "gagnee", montant: 5000, dateCloture: "2026-10-01", responsableId: "u2" })],
    10000,
    { maintenant: AUJ, responsableId: "u1" },
  );
  assert.equal(p.pct, 74);
  assert.equal(p.gagne, 7400);
});

test("performance : taux de gain, cycle, motifs de perte, sources", () => {
  const clients = [{ id: "c1", data: { source: "formulaire" } }, { id: "c2", data: { source: "salon" } }];
  const p = performance([
    opp("a", { clientId: "c1", etape: "gagnee", montant: 100, dateCloture: "2026-09-21" }),
    opp("b", { clientId: "c2", etape: "perdue", motifPerte: "prix", dateCloture: "2026-09-25" }),
    opp("c", { clientId: "c2", etape: "perdue", motifPerte: "prix", dateCloture: "2026-09-28" }),
    opp("d", { clientId: "c1", etape: "gagnee", montant: 50, dateCloture: "2025-01-01" }), // hors période
  ], clients, { maintenant: AUJ, jours: 90 });
  assert.equal(p.taux, 33);
  assert.equal(p.cycleMoyen, 20);
  assert.deepEqual(p.motifs, [{ motif: "prix", nombre: 2 }]);
  assert.equal(p.sources[0].source, "formulaire");
});

test("un lead : prospect non qualifié, sans affaire", () => {
  const c = { id: "c1", data: { statut: "prospect" } };
  assert.equal(estLead(c, []), true);
  assert.equal(estLead(c, [opp("o", { clientId: "c1", etape: "contact" })]), false);
  assert.equal(estLead({ id: "c1", data: { statut: "prospect", qualifie: true } }, []), false);
  assert.equal(estLead({ id: "c1", data: { statut: "actif" } }, []), false);
});

test("le score d'un lead s'explique point par point", () => {
  const c = { id: "c1", data: { source: "formulaire", email: "a@b.ci", telephone: "0708", secteur: "Restauration" } };
  const campagnes = [{ data: { destinataires: [{ clientId: "c1", ouvert: true, clique: true }, { clientId: "c2", clique: true }] } }];
  const { score, raisons } = scoreLead(c, { campagnes, secteursCibles: ["restauration"], maintenant: AUJ });
  assert.equal(score, 25 + 10 + 2 + 6 + 6 + 15);
  assert.equal(raisons[0].cle, "formulaire");
  assert.ok(raisons.some((r) => r.cle === "secteur"));
  assert.equal(scoreLead({ id: "x", data: {} }).score, 0);
});

test("doublons : même e-mail, même téléphone (avec ou sans +225), même nom", () => {
  const clients = [
    { id: "a", data: { entreprise: "Café de Bouaké SARL", telephone: "+225 07 08 09 10 11" } },
    { id: "b", data: { entreprise: "Autre", email: "Contact@Exemple.ci" } },
  ];
  assert.equal(normaliserTelephone("+225 07 08 09 10 11"), normaliserTelephone("0708091011").slice(-8));
  const r = doublons({ data: { entreprise: "cafe de bouake", telephone: "07 08 09 10 11" } }, clients);
  assert.equal(r[0].client.id, "a");
  assert.deepEqual(r[0].raisons.sort(), ["nom", "telephone"]);
  assert.equal(doublons({ data: { email: "contact@exemple.ci" } }, clients)[0].client.id, "b");
  // Une fiche n'est pas son propre doublon.
  assert.equal(doublons(clients[0], clients).length, 0);
});

test("ventes d'un compte et santé", () => {
  const documents = [
    { id: "f1", data: { clientId: "c1", type: "facture", statut: "emise", date: "2026-06-01", echeance: "2026-07-01", ttc: 1000 } },
    { id: "f2", data: { clientId: "c1", type: "facture", statut: "emise", date: "2026-09-01", echeance: "2026-09-15", ttc: 500 } },
    { id: "f0", data: { clientId: "c1", type: "facture", statut: "emise", date: "2025-06-01", ttc: 1000 } },
    { id: "d1", data: { clientId: "c1", type: "devis", statut: "emis", date: "2026-09-01", ttc: 9999 } },
  ];
  const reglements = [{ data: { documentId: "f1", date: "2026-07-10", montant: 1000 } }];
  const etat = (doc) => {
    const paye = reglements.filter((r) => r.data.documentId === doc.id).reduce((s, r) => s + r.data.montant, 0);
    const reste = doc.data.ttc - paye;
    if (reste <= 0) return { id: "payee" };
    return doc.data.echeance < AUJ ? { id: "retard", reste } : { id: "impayee", reste };
  };
  const v = ventesCompte("c1", documents, reglements, { totauxDe: (d) => ({ ttc: d.ttc }), etatPaiement: etat, maintenant: AUJ });
  assert.equal(v.ca12, 1500);
  assert.equal(v.evolution, 50);
  assert.equal(v.echu, 500);
  assert.equal(v.delaiMoyen, 39);
  const s = santeCompte({ ventes: v, joursSansContact: 10, affairesOuvertes: 1 });
  assert.equal(s.score, 50 + 15 + 10 + 15 + 10 - 20);
  assert.equal(santeCompte({ ventes: null, joursSansContact: 200 }).niveau, "risque");
});

test("saisie rapide : la date fait la relance", () => {
  assert.equal(echeanceDans("rappeler demain", AUJ), "2026-10-10");
  assert.equal(echeanceDans("relancer mardi", AUJ), "2026-10-13");
  assert.equal(echeanceDans("vendredi", AUJ), "2026-10-16"); // le prochain, pas aujourd'hui
  assert.equal(echeanceDans("dans 3 jours", AUJ), "2026-10-12");
  assert.equal(echeanceDans("dans 2 semaines", AUJ), "2026-10-23");
  assert.equal(echeanceDans("le 5", AUJ), "2026-11-05");
  assert.equal(echeanceDans("le 20", AUJ), "2026-10-20");
  assert.equal(echeanceDans("12/01", AUJ), "2027-01-12");
  assert.equal(echeanceDans("call back tomorrow", AUJ), "2026-10-10");
  assert.equal(echeanceDans("rien de prévu", AUJ), null);
  assert.deepEqual(analyserSaisie("Rappeler M. Kouadio mardi", AUJ), { type: "tache", resume: "Rappeler M. Kouadio mardi", echeance: "2026-10-13", date: AUJ });
  assert.equal(analyserSaisie("Appel avec le gérant, OK pour 5 %", AUJ).type, "appel");
  assert.equal(analyserSaisie("RDV sur site, démo réussie", AUJ).type, "reunion");
  assert.equal(analyserSaisie("Le client préfère WhatsApp", AUJ).type, "note");
});

test("chronologie unifiée : CRM, factures, paiements, courriels, campagnes, projets", () => {
  const client = { id: "c1", data: { email: "jean@gib.ci" } };
  const ev = chronologieUnifiee({
    client,
    activites: [act("a", { clientId: "c1", type: "appel", date: "2026-10-06" }), act("t", { clientId: "c1", type: "tache", echeance: "2026-10-20" })],
    opportunites: [opp("o", { clientId: "c1", etape: "devis", etapeLe: "2026-10-02" })],
    documents: [{ id: "f", data: { clientId: "c1", type: "facture", statut: "emise", date: "2026-09-28" } }, { id: "b", data: { clientId: "c1", statut: "brouillon", date: "2026-10-08" } }],
    reglements: [{ id: "r", data: { documentId: "f", date: "2026-10-01", montant: 10 } }],
    envois: [{ id: "e", data: { a: "Jean@GIB.ci", date: "2026-09-30" } }],
    campagnes: [{ id: "k", data: { destinataires: [{ clientId: "c1", clique: true, cliqueLe: "2026-09-18" }] } }],
    cartes: [{ id: "p", data: { liens: { clientId: "c1" } }, updatedAt: "2026-09-12T08:00:00Z" }],
  });
  assert.deepEqual(ev.map((e) => e.famille), ["echange", "affaire", "paiement", "courriel", "vente", "campagne", "projet"]);
});

test("vues enregistrées", () => {
  const clients = [
    { id: "a", data: { statut: "actif", ville: "Abidjan", etiquettes: ["VIP"] } },
    { id: "b", data: { statut: "actif", ville: "Bouaké" } },
  ];
  assert.deepEqual(appliquerVue(clients, { ville: "abidjan" }).map((c) => c.id), ["a"]);
  assert.deepEqual(appliquerVue(clients, { caMin: 100 }, { ca: { a: 50, b: 200 } }).map((c) => c.id), ["b"]);
  assert.deepEqual(appliquerVue(clients, { sansContact: 60 }, { joursSansContact: { a: 10, b: null } }).map((c) => c.id), ["b"]);
});

test("textes : chaque clé française existe en anglais", () => {
  const manquantes = Object.keys(TEXTES.fr).filter((k) => !(k in TEXTES.en));
  assert.deepEqual(manquantes, []);
});

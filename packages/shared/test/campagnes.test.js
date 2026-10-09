import test from "node:test";
import assert from "node:assert/strict";

import {
  analyseObjet,
  audienceDe,
  contexteAudience,
  csvDe,
  dupliquer,
  htmlDe,
  libelleDuree,
  normaliserFiltres,
  ouverturesParHeure,
  reessayerEchecs,
  relanceDe,
  santeDe,
  segmenter,
  statistiquesGlobales,
  verificationsLancement,
} from "../src/campagnes.js";

const client = (id, data) => ({ id, data: { statut: "actif", ...data } });
const clients = [
  client("a", { nom: "Aya", entreprise: "Koné Distribution", email: "aya@kone.ci", ville: "Abidjan", secteur: "Commerce" }),
  client("b", { nom: "Yao", email: "yao@yao.ci", ville: "Bouaké", secteur: "BTP" }),
  client("c", { nom: "Sans mail", email: "", ville: "Abidjan" }),
  client("d", { nom: "Parti", email: "parti@x.ci", ville: "Abidjan", emailDesinscrit: true }),
  client("e", { nom: "Doublon", email: "AYA@kone.ci", ville: "Abidjan" }),
  client("f", { nom: "Prospect", email: "p@p.ci", ville: "Abidjan", statut: "prospect" }),
];

test("anciens filtres : ville unique et statut « client » deviennent le format courant", () => {
  assert.deepEqual(normaliserFiltres({ statut: "client", ville: "Abidjan", secteur: "" }), {
    statut: "actif", villes: ["Abidjan"], secteurs: [], etiquettes: [], achatMois: 0, repos: 0, ids: null,
  });
  // Le statut « client » ne correspondait à aucune fiche du CRM : il
  // retrouve désormais les clients actifs.
  assert.equal(audienceDe(clients, { statut: "client" }).length, 2);
});

test("segment : critères, adresses invalides, désinscrits, doublons et exclusions", () => {
  const s = segmenter(clients, { statut: "actif", villes: ["Abidjan"] }, { exclus: [] });
  assert.equal(s.correspondants.length, 4);
  assert.equal(s.sansEmail, 1);
  assert.equal(s.desinscrits, 1);
  assert.equal(s.doublons, 1);
  assert.deepEqual(s.retenus.map((c) => c.id), ["a"]);
  assert.equal(segmenter(clients, { villes: ["Abidjan"] }, { exclus: ["a"] }).exclus, 1);
  assert.deepEqual(audienceDe(clients, { ids: ["b", "f"] }).map((c) => c.id), ["b", "f"]);
  assert.deepEqual(audienceDe(clients, { secteurs: ["btp"] }).map((c) => c.id), ["b"]);
});

test("segment : achat récent (Facturation) et repos après une campagne", () => {
  const contexte = contexteAudience({
    factures: [
      { data: { type: "facture", statut: "envoye", clientId: "a", date: "2026-09-20" } },
      { data: { type: "facture", statut: "brouillon", clientId: "b", date: "2026-10-01" } },
    ],
    campagnes: [{ data: { termineeLe: "2026-10-06T09:00:00Z", destinataires: [{ clientId: "b", statut: "envoye", envoyeLe: "2026-10-06T08:00:00Z" }] } }],
  });
  const maintenant = "2026-10-08T10:00:00Z";
  assert.deepEqual(audienceDe(clients, { achatMois: 3 }, { contexte, maintenant }).map((c) => c.id), ["a"]);
  const s = segmenter(clients, { repos: 7 }, { contexte, maintenant });
  assert.equal(s.auRepos, 1);
  assert.ok(!s.retenus.some((c) => c.id === "b"));
});

test("santé du fichier", () => {
  assert.deepEqual(santeDe(clients), { total: 6, joignables: 4, sansEmail: 1, desinscrits: 1, rebonds: 0, aConfirmer: 0 });
});

test("aide à la rédaction : objet et durée d'envoi", () => {
  assert.equal(analyseObjet("").ton, "vide");
  assert.equal(analyseObjet("Aya, -15 % sur vos fournitures de rentrée").ton, "ok");
  assert.equal(analyseObjet("GRATUIT POUR TOUS").ton, "attention");
  assert.equal(libelleDuree(312), "environ 29 minutes");
  assert.equal(libelleDuree(5), "environ une minute");
  const v = verificationsLancement({ nom: "X", sujet: "", texte: "t", cta: { label: "Voir", url: "ftp://x" } }, 3);
  assert.equal(v.find((x) => x.id === "sujet").ok, false);
  assert.equal(v.find((x) => x.id === "cta").ok, false);
});

test("courrier : texte d'aperçu, logo et pied légal, toujours échappés", () => {
  const html = htmlDe(
    { texte: "Bonjour", apercu: "<b>promo</b>", couleur: "#c2410c" },
    { entreprise: "Konan", logo: "https://api/logo", pied: "Konan · Abidjan · NCC 1" },
  );
  assert.match(html, /display:none[^>]*>&lt;b&gt;promo&lt;\/b&gt;/);
  assert.match(html, /<img src="https:\/\/api\/logo"/);
  assert.match(html, /NCC 1/);
  assert.doesNotMatch(htmlDe({ texte: "x" }, { logo: "javascript:alert(1)" }), /javascript:/);
});

const terminee = {
  nom: "Rentrée",
  sujet: "S",
  texte: "T",
  cta: { label: "Voir", url: "https://x.ci" },
  statut: "terminee",
  envoyerLe: "2026-10-02T08:30:00Z",
  termineeLe: "2026-10-02T09:00:00Z",
  filtres: { statut: "actif", ville: "Abidjan" },
  destinataires: [
    { clientId: "a", nom: "Aya; et cie", email: "a@a.ci", statut: "envoye", ouvert: true, ouvertLe: "2026-10-02T09:10:00Z", clique: true },
    { clientId: "b", nom: "Yao", email: "b@b.ci", statut: "envoye" },
    { clientId: "c", nom: "C", email: "c@c.ci", statut: "echec", erreur: "boîte pleine" },
  ],
};

test("après l'envoi : relance, copie, nouvel essai", () => {
  const r = relanceDe(terminee);
  assert.deepEqual(r.filtres.ids, ["b"]);
  assert.equal(r.relanceDe, "Rentrée");
  assert.equal(r.statut, "brouillon");
  const d = dupliquer(terminee);
  assert.deepEqual(d.destinataires, []);
  assert.deepEqual(d.filtres.villes, ["Abidjan"]);
  const e = reessayerEchecs(terminee);
  assert.equal(e.statut, "programmee");
  assert.equal(e.destinataires[2].statut, "attente");
  assert.equal(e.destinataires[0].statut, "envoye");
});

test("ouvertures par heure, CSV et statistiques d'ensemble", () => {
  const { cases } = ouverturesParHeure(terminee);
  assert.equal(cases.length, 24);
  assert.equal(cases[1].n, 1);
  const csv = csvDe(terminee).split("\r\n");
  assert.equal(csv.length, 4);
  assert.ok(csv[1].startsWith('"Aya; et cie"'));
  const s = statistiquesGlobales([{ data: terminee }], 30, "2026-10-08T00:00:00Z");
  assert.equal(s.envoyes, 2);
  assert.equal(s.tauxOuverture, 50);
  assert.equal(s.tauxClic, 50);
});

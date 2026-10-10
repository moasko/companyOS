import test from "node:test";
import assert from "node:assert/strict";

import {
  automatisationDe,
  blocVide,
  classerErreur,
  clicsParLien,
  decisionAB,
  deplacerBloc,
  devinerColonnes,
  echeances,
  engagementDe,
  htmlDe,
  inscrire,
  liensDe,
  lireCsv,
  personnaliser,
  planImport,
  prochainCreneau,
  repartirAB,
  segmenter,
  sujetPour,
  texteDe,
  variablesPour,
  ventesAttribuees,
} from "../src/campagnes.js";

const campagneBlocs = {
  sujet: "Promo {{prenom}}",
  couleur: "#c2410c",
  langue: "fr",
  blocs: [
    { id: "1", type: "titre", texte: "La rentrée au frais" },
    {
      id: "2",
      type: "texte",
      texte:
        "Bonjour {{prenom}},\n\nVoir **le catalogue** : [ici](https://konan.ci/catalogue).\n\n- pose offerte\n- garantie 2 ans",
    },
    {
      id: "3",
      type: "image",
      url: "https://konan.ci/promo.jpg",
      alt: "Promo",
      lien: "https://konan.ci/promo",
    },
    {
      id: "4",
      type: "bouton",
      label: "Je demande mon devis",
      url: "https://konan.ci/devis",
    },
    { id: "5", type: "bouton", label: "", url: "https://konan.ci/oublie" },
    {
      id: "6",
      type: "reseaux",
      whatsapp: "+225 07 00 00 00 00",
      site: "javascript:alert(1)",
    },
    { id: "7", type: "promo", code: "RENTREE20", texte: "Valable 15 jours" },
  ],
};

test("liens : numérotés dans l'ordre du rendu, les liens non dessinés et dangereux écartés", () => {
  const l = liensDe(campagneBlocs);
  assert.deepEqual(
    l.map((x) => x.url),
    [
      "https://konan.ci/catalogue",
      "https://konan.ci/promo",
      "https://konan.ci/devis",
      "https://wa.me/2250700000000",
    ],
  );
  const html = htmlDe(campagneBlocs, { lien: (i) => `https://suivi/${i}` });
  for (let i = 0; i < l.length; i += 1) assert.ok(html.includes(`https://suivi/${i}`));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("oublie"));
  // La version texte reprend les mêmes numéros.
  const txt = texteDe(campagneBlocs, { lien: (i) => `https://suivi/${i}` });
  assert.ok(txt.includes("ici (https://suivi/0)"));
  assert.ok(txt.includes("Je demande mon devis : https://suivi/2"));
  assert.ok(txt.includes("WhatsApp : https://suivi/3"));
});

test("rendu : texte riche échappé, listes, code promo, pied dans la langue du message", () => {
  const html = htmlDe(
    {
      ...campagneBlocs,
      blocs: [
        ...campagneBlocs.blocs,
        { id: "8", type: "texte", texte: "<script>x</script> **gras**" },
      ],
    },
    { entreprise: "Konan SARL", lienDesinscription: "https://x/d" },
  );
  assert.ok(html.includes("<b>le catalogue</b>"));
  assert.ok(html.includes("<li>pose offerte</li>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("RENTREE20"));
  assert.ok(html.includes("Se désinscrire"));
  assert.ok(
    htmlDe(
      { ...campagneBlocs, langue: "en" },
      { lienDesinscription: "https://x/d" },
    ).includes("Unsubscribe"),
  );
  // Couleur invalide : la couleur par défaut, jamais la valeur brute.
  assert.ok(
    !htmlDe({ ...campagneBlocs, couleur: '"><img src=x>' }).includes("<img src=x>"),
  );
});

test("ancien format : texte + bouton rendus comme avant, le bouton est le lien n° 0", () => {
  const ancienne = {
    sujet: "x",
    texte: "Bonjour",
    cta: { label: "Voir", url: "https://a.ci" },
  };
  assert.deepEqual(
    liensDe(ancienne).map((l) => l.url),
    ["https://a.ci"],
  );
  assert.ok(
    htmlDe(ancienne, { lienCta: "https://suivi/clic" }).includes("https://suivi/clic"),
  );
});

test("personnalisation : objet et textes, jamais les adresses", () => {
  const v = variablesPour(
    { nom: "Koné Distribution", contact: "Awa Koné", ville: "Abidjan" },
    "Konan",
  );
  assert.equal(v.prenom, "Awa");
  const p = personnaliser(
    {
      ...campagneBlocs,
      blocs: [
        {
          id: "x",
          type: "bouton",
          label: "Pour {{prenom}}",
          url: "https://a.ci/{{prenom}}",
        },
      ],
    },
    v,
  );
  assert.equal(p.sujet, "Promo Awa");
  assert.equal(p.blocs[0].label, "Pour Awa");
  assert.equal(p.blocs[0].url, "https://a.ci/{{prenom}}");
});

test("blocs : nouveau, déplacé", () => {
  const a = blocVide("titre");
  const b = blocVide("texte", { langue: "en" });
  assert.match(b.texte, /Hello/);
  assert.deepEqual(
    deplacerBloc([a, b], b.id, -1).map((x) => x.id),
    [b.id, a.id],
  );
  assert.deepEqual(
    deplacerBloc([a, b], a.id, -1).map((x) => x.id),
    [a.id, b.id],
  );
});

test("A/B : échantillon partagé, décision après le délai au meilleur taux d'ouverture", () => {
  const dests = Array.from({ length: 50 }, (_, i) => ({
    clientId: `c${i}`,
    statut: "attente",
  }));
  const r = repartirAB(dests, { actif: true, part: 20 }, () => 0.5);
  assert.equal(r.filter((d) => d.variante === "A").length, 5);
  assert.equal(r.filter((d) => d.variante === "B").length, 5);
  assert.equal(r.filter((d) => d.statut === "reserve").length, 40);
  const envoye = (d, ouvert) => ({
    ...d,
    statut: "envoye",
    envoyeLe: "2026-10-09T08:00:00Z",
    ouvert,
  });
  const c = {
    sujet: "A",
    statut: "envoi",
    ab: { actif: true, sujetB: "B", heures: 4 },
    destinataires: r.map((d, i) =>
      d.variante === "A" ? envoye(d, i < 2) : d.variante === "B" ? envoye(d, true) : d,
    ),
  };
  assert.equal(decisionAB(c, "2026-10-09T10:00:00Z"), null);
  const apres = decisionAB(c, "2026-10-09T12:30:00Z");
  assert.equal(apres.ab.gagnant, "B");
  assert.equal(
    apres.destinataires.filter((d) => d.statut === "attente" && d.variante === "B")
      .length,
    40,
  );
  assert.equal(sujetPour(apres, { variante: "B" }), "B");
  // Un destinataire du test en réessai ne bloque pas la décision.
  const enReessai = {
    ...c,
    destinataires: c.destinataires.map((d, i) =>
      i === 0 ? { ...d, statut: "attente", essais: 1 } : d,
    ),
  };
  assert.ok(decisionAB(enReessai, "2026-10-09T12:30:00Z"));
  assert.equal(
    decisionAB(
      {
        ...c,
        destinataires: c.destinataires.map((d, i) =>
          i === 0 ? { ...d, statut: "attente" } : d,
        ),
      },
      "2026-10-09T12:30:00Z",
    ),
    null,
  );
  assert.equal(sujetPour(apres, { variante: "A" }), "A");
});

test("rebonds : définitif, temporaire, ou faute du relais", () => {
  assert.equal(
    classerErreur("550 5.1.1 <x@y.ci>: Recipient address rejected: User unknown"),
    "definitif",
  );
  assert.equal(classerErreur("452 4.2.2 Mailbox full"), "temporaire");
  assert.equal(classerErreur("connect ECONNREFUSED 127.0.0.1:587"), null);
});

test("ventes attribuées : factures du client dans les 7 jours après son clic", () => {
  const c = {
    destinataires: [
      { clientId: "a", cliqueLe: "2026-10-01T10:00:00Z" },
      { clientId: "b" },
    ],
  };
  const factures = [
    {
      id: "f1",
      data: {
        type: "facture",
        statut: "envoye",
        clientId: "a",
        date: "2026-10-03",
        numero: "F1",
        lignes: [{ qte: 2, pu: 1000, tva: 18 }],
      },
    },
    {
      id: "f2",
      data: {
        type: "facture",
        statut: "envoye",
        clientId: "a",
        date: "2026-10-20",
        lignes: [{ qte: 1, pu: 1000 }],
      },
    },
    {
      id: "f3",
      data: {
        type: "facture",
        statut: "envoye",
        clientId: "b",
        date: "2026-10-02",
        lignes: [{ qte: 1, pu: 1000 }],
      },
    },
  ];
  const v = ventesAttribuees(c, factures);
  assert.deepEqual(
    v.map((x) => [x.numero, x.montant, x.joursApres]),
    [["F1", 2360, 2]],
  );
});

test("clics par lien et engagement", () => {
  const c = {
    destinataires: [
      { statut: "envoye", clique: true, liens: [0, 2, 2] },
      { statut: "envoye", clique: true, liens: [2] },
    ],
  };
  assert.deepEqual(clicsParLien(c, 3), [1, 0, 2]);
  const e = engagementDe([
    {
      data: {
        destinataires: [
          { clientId: "a", statut: "envoye", ouvert: true, clique: true },
          { clientId: "b", statut: "envoye" },
        ],
      },
    },
  ]);
  assert.equal(e.a.score, 5);
  assert.equal(e.b.score, 0);
});

test("segment : étiquettes, rebonds et inscriptions non confirmées", () => {
  const clients = [
    { id: "a", data: { statut: "actif", email: "a@a.ci", etiquettes: ["salon"] } },
    { id: "b", data: { statut: "actif", email: "b@b.ci", etiquettes: ["VIP"] } },
    {
      id: "c",
      data: {
        statut: "actif",
        email: "c@c.ci",
        etiquettes: ["salon"],
        emailRebond: true,
      },
    },
    {
      id: "d",
      data: {
        statut: "actif",
        email: "d@d.ci",
        etiquettes: ["Salon"],
        emailAConfirmer: true,
      },
    },
  ];
  const s = segmenter(clients, { etiquettes: ["SALON"] });
  assert.deepEqual(
    s.retenus.map((c) => c.id),
    ["a"],
  );
  assert.equal(s.rebonds, 1);
  assert.equal(s.aConfirmer, 1);
});

test("import CSV : séparateur, guillemets, colonnes devinées, plan sans réabonner personne", () => {
  const csv =
    '﻿Société;Nom contact;Mail;Commune\n"Koné; Distribution";Awa;AWA@kone.ci;Cocody\nPharma;Dr Yao;yao@ph.ci;Plateau\nX;;pas-un-mail;\nDoublon;;awa@kone.ci;\nParti;;parti@x.ci;\n';
  const { entetes, lignes, separateur } = lireCsv(csv);
  assert.equal(separateur, ";");
  assert.equal(lignes[0][0], "Koné; Distribution");
  const colonnes = devinerColonnes(entetes);
  assert.deepEqual(colonnes, ["entreprise", "nom", "email", "ville"]);
  const clients = [
    { id: "y", data: { email: "yao@ph.ci", nom: "Yao", ville: "" } },
    { id: "p", data: { email: "parti@x.ci", emailDesinscrit: true } },
  ];
  const plan = planImport({
    lignes,
    colonnes,
    clients,
    etiquettes: ["salon"],
    consentement: { source: "salon", le: "2026-10-09" },
  });
  assert.equal(plan.nouveaux.length, 1);
  assert.equal(plan.nouveaux[0].email, "awa@kone.ci");
  assert.deepEqual(plan.nouveaux[0].etiquettes, ["salon"]);
  assert.equal(plan.misAJour.length, 1);
  assert.equal(plan.misAJour[0].data.ville, "Plateau");
  assert.equal(plan.misAJour[0].data.nom, "Yao");
  assert.equal(plan.invalides, 1);
  assert.equal(plan.doublons, 1);
  assert.equal(plan.desinscrits, 1);
});

test("créneau ouvré : nuit, soir et week-end repoussés à 8 h", () => {
  assert.equal(prochainCreneau("2026-10-09T06:00:00Z"), "2026-10-09T08:00:00.000Z"); // vendredi matin
  assert.equal(prochainCreneau("2026-10-09T19:00:00Z"), "2026-10-12T08:00:00.000Z"); // vendredi soir → lundi
  assert.equal(prochainCreneau("2026-10-11T10:00:00Z"), "2026-10-12T08:00:00.000Z"); // dimanche
  assert.equal(
    prochainCreneau("2026-10-11T10:00:00Z", { joursOuvres: false }),
    "2026-10-11T10:00:00Z",
  );
});

test("automatisation « devis non signé » : entrée après activation, une fois, sortie si signé", () => {
  const auto = {
    ...automatisationDe("devis", "fr"),
    actif: true,
    activeLe: "2026-10-01T00:00:00Z",
    regles: { joursOuvres: false, sortie: true },
  };
  const ctx = {
    clients: [
      { id: "a", data: { email: "a@a.ci", nom: "Awa" } },
      { id: "b", data: { email: "", nom: "Sans" } },
    ],
    documents: [
      {
        id: "d1",
        data: {
          type: "devis",
          statut: "envoye",
          clientId: "a",
          date: "2026-10-02",
          numero: "DEV-1",
        },
      },
      {
        id: "d0",
        data: {
          type: "devis",
          statut: "envoye",
          clientId: "a",
          date: "2026-09-20",
          numero: "DEV-0",
        },
      },
      {
        id: "d2",
        data: { type: "devis", statut: "envoye", clientId: "b", date: "2026-10-02" },
      },
    ],
  };
  const { auto: a1, nouveaux } = inscrire(auto, ctx, "2026-10-02T10:00:00Z");
  assert.equal(nouveaux, 1);
  assert.equal(a1.inscrits[0].extra.numero, "DEV-1");
  assert.equal(inscrire(a1, ctx, "2026-10-03T10:00:00Z").nouveaux, 0);
  // Pas encore l'heure.
  assert.deepEqual(echeances(a1, ctx, "2026-10-05T10:00:00Z").prets, []);
  assert.deepEqual(echeances(a1, ctx, "2026-10-09T11:00:00Z").prets, ["devis:d1"]);
  // Signé entre-temps : sorti, pas d'e-mail.
  const signe = {
    ...ctx,
    documents: [{ id: "d1", data: { ...ctx.documents[0].data, statut: "accepte" } }],
  };
  const e = echeances(a1, signe, "2026-10-09T11:00:00Z");
  assert.deepEqual(e.prets, []);
  assert.equal(e.auto.inscrits[0].statut, "sorti");
});

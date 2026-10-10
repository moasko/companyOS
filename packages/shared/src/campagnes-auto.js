// Campagnes — les automatisations.
//
// ─────────────────────────────────────────────────────────────────────────
// LE BON MESSAGE AU BON MOMENT, SANS Y PENSER
//
// Une automatisation écoute une autre application de CompanyOS et écrit
// au client quand quelque chose lui arrive : il entre au CRM, reçoit un
// devis qu'il ne signe pas, achète, est livré, ne revient plus, fête un an
// de relation. Chaque recette dit :
//
//   • qui entre (`candidats`) — à partir des fiches des autres apps, et
//     seulement pour ce qui arrive **après l'activation** : activer
//     « Merci après achat » n'écrit pas à trois ans de clients ;
//   • quand écrire (`delai` en jours, puis le prochain créneau ouvré) ;
//   • quand renoncer (`sortie`) — le devis a été signé entre-temps.
//
// Une personne n'entre qu'une fois par événement (la clé `cle`). Le
// moteur (apps/api/src/campagnes.js) appelle ces fonctions à chaque
// passage ; elles ne font aucune entrée-sortie.
// ─────────────────────────────────────────────────────────────────────────

import { adresseValide } from "./courrier.js";

const JOUR = 86400000;
const jourDe = (iso) => String(iso || "").slice(0, 10);
const plusJours = (iso, n) => new Date(new Date(iso).getTime() + n * JOUR).toISOString();
const FENETRE = 60; // jours : un événement plus ancien n'est jamais rattrapé

const docs = (ctx) =>
  (ctx.documents || []).map((r) => ({
    id: r.id,
    ...(r.data || {}),
    creeLe: r.createdAt,
  }));

const derniereFactureParClient = (ctx) => {
  const t = {};
  for (const d of docs(ctx)) {
    if (d.type !== "facture" || ["brouillon", "annule"].includes(d.statut) || !d.clientId)
      continue;
    if (!t[d.clientId] || d.date > t[d.clientId]) t[d.clientId] = d.date;
  }
  return t;
};

const texte = (fr, en) => ({ fr, en });

/// Les recettes. `contenu` donne le message de départ, dans les deux
/// langues ; il se modifie ensuite librement.
export const RECETTES = [
  {
    id: "bienvenue",
    source: "crm",
    delai: 0,
    candidats: (ctx, depuis) =>
      (ctx.clients || [])
        .filter((c) => c.createdAt && c.createdAt >= depuis)
        .map((c) => ({ cle: `client:${c.id}`, clientId: c.id })),
    contenu: {
      sujet: texte(
        "Bienvenue chez {{entreprise}}, {{prenom}}",
        "Welcome to {{entreprise}}, {{prenom}}",
      ),
      apercu: texte("Ce que nous pouvons faire pour vous", "What we can do for you"),
      texte: texte(
        "Bonjour {{prenom}},\n\nMerci de votre confiance. Voici en quelques lignes qui nous sommes et comment nous joindre.\n\nRépondez simplement à ce message pour toute question.",
        "Hello {{prenom}},\n\nThank you for your trust. Here is, in a few lines, who we are and how to reach us.\n\nSimply reply to this email with any question.",
      ),
    },
  },
  {
    id: "devis",
    source: "facturation",
    delai: 7,
    candidats: (ctx, depuis) =>
      docs(ctx)
        .filter(
          (d) =>
            d.type === "devis" &&
            d.statut === "envoye" &&
            d.clientId &&
            d.date >= jourDe(depuis),
        )
        .map((d) => ({
          cle: `devis:${d.id}`,
          clientId: d.clientId,
          extra: { numero: d.numero || "" },
          objet: d.id,
        })),
    // Le devis a bougé (accepté, refusé, annulé) ou a disparu : on se tait.
    sortie: (ctx, inscrit) => {
      const d = docs(ctx).find((x) => x.id === inscrit.objet);
      return !d || d.statut !== "envoye";
    },
    contenu: {
      sujet: texte(
        "Votre devis {{numero}} vous attend",
        "Your quote {{numero}} is waiting",
      ),
      apercu: texte("Une question ? Nous sommes là.", "Any question? We are here."),
      texte: texte(
        "Bonjour {{prenom}},\n\nNous vous avons adressé le devis {{numero}} il y a quelques jours. Avez-vous pu le regarder ?\n\nS'il manque une précision ou si vous souhaitez l'ajuster, répondez simplement à ce message.",
        "Hello {{prenom}},\n\nWe sent you quote {{numero}} a few days ago. Have you had a chance to look at it?\n\nIf anything is missing or you would like to adjust it, simply reply to this email.",
      ),
    },
  },
  {
    id: "merci",
    source: "facturation",
    delai: 1,
    candidats: (ctx, depuis) =>
      docs(ctx)
        .filter(
          (d) =>
            d.type === "facture" &&
            !["brouillon", "annule"].includes(d.statut) &&
            d.clientId &&
            d.date >= jourDe(depuis),
        )
        .map((d) => ({
          cle: `facture:${d.id}`,
          clientId: d.clientId,
          extra: { numero: d.numero || "" },
          objet: d.id,
        })),
    contenu: {
      sujet: texte(
        "Merci pour votre confiance, {{prenom}}",
        "Thank you for your trust, {{prenom}}",
      ),
      apercu: texte("Votre avis compte pour nous", "Your opinion matters to us"),
      texte: texte(
        "Bonjour {{prenom}},\n\nMerci pour votre achat. Toute l'équipe de {{entreprise}} reste à votre disposition.\n\nÀ très bientôt.",
        "Hello {{prenom}},\n\nThank you for your purchase. The whole {{entreprise}} team remains at your service.\n\nSee you soon.",
      ),
    },
  },
  {
    id: "livraison",
    source: "stock",
    delai: 2,
    candidats: (ctx, depuis) => {
      const parId = new Map(docs(ctx).map((d) => [d.id, d]));
      const vus = new Set();
      const out = [];
      for (const m of ctx.mouvements || []) {
        const o = String(m.data?.origine || "");
        if (!o.startsWith("facture:") || (m.data.date || "") < jourDe(depuis)) continue;
        const id = o.slice(8);
        const f = parId.get(id);
        if (!f?.clientId || vus.has(id)) continue;
        vus.add(id);
        out.push({
          cle: `livraison:${id}`,
          clientId: f.clientId,
          extra: { numero: f.numero || "" },
          objet: id,
        });
      }
      return out;
    },
    contenu: {
      sujet: texte(
        "Votre commande est arrivée ? Dites-nous tout",
        "Did your order arrive? Tell us",
      ),
      apercu: texte("Une minute pour nous aider", "One minute to help us"),
      texte: texte(
        "Bonjour {{prenom}},\n\nVotre commande {{numero}} vous a été livrée. Tout est-il conforme ?\n\nVotre retour nous aide à mieux vous servir : répondez simplement à ce message.",
        "Hello {{prenom}},\n\nYour order {{numero}} has been delivered. Is everything as expected?\n\nYour feedback helps us serve you better: simply reply to this email.",
      ),
    },
  },
  {
    id: "endormi",
    source: "facturation",
    delai: 0,
    candidats: (ctx, depuis, maintenant) => {
      const derniere = derniereFactureParClient(ctx);
      const out = [];
      for (const [clientId, date] of Object.entries(derniere)) {
        const seuil = jourDe(plusJours(`${date}T12:00:00Z`, 90));
        if (seuil <= jourDe(maintenant) && seuil >= jourDe(depuis))
          out.push({
            cle: `endormi:${clientId}:${date}`,
            clientId,
            extra: { derniereFacture: date },
          });
      }
      return out;
    },
    // Il a racheté entre-temps : plus besoin de le réveiller.
    sortie: (ctx, inscrit) =>
      (derniereFactureParClient(ctx)[inscrit.clientId] || "") >
      (inscrit.extra?.derniereFacture || ""),
    contenu: {
      sujet: texte("{{prenom}}, cela fait longtemps !", "{{prenom}}, it's been a while!"),
      apercu: texte("Voici ce qui a changé chez nous", "Here is what's new with us"),
      texte: texte(
        "Bonjour {{prenom}},\n\nCela fait un moment que nous n'avons pas travaillé ensemble. Voici nos nouveautés — et si un besoin se présente, nous sommes là.",
        "Hello {{prenom}},\n\nIt's been a while since we last worked together. Here is what's new — and if a need comes up, we are here.",
      ),
    },
  },
  {
    id: "anniversaire",
    source: "crm",
    delai: 0,
    candidats: (ctx, depuis, maintenant) => {
      const aujourdhui = jourDe(maintenant);
      const out = [];
      for (const c of ctx.clients || []) {
        if (!c.createdAt) continue;
        const annee = Number(aujourdhui.slice(0, 4));
        const debut = Number(c.createdAt.slice(0, 4));
        if (annee <= debut) continue;
        const date = `${annee}${c.createdAt.slice(4, 10)}`;
        // Le jour même, ou dans les trois derniers jours (un serveur
        // arrêté un dimanche ne fait pas rater l'anniversaire).
        if (
          date <= aujourdhui &&
          date >= jourDe(plusJours(`${aujourdhui}T12:00:00Z`, -3)) &&
          date >= jourDe(depuis)
        ) {
          out.push({
            cle: `anniversaire:${c.id}:${annee}`,
            clientId: c.id,
            extra: { annees: String(annee - debut) },
          });
        }
      }
      return out;
    },
    contenu: {
      sujet: texte(
        "{{annees}} an(s) ensemble, merci {{prenom}} !",
        "{{annees}} year(s) together, thank you {{prenom}}!",
      ),
      apercu: texte("Un petit mot pour vous", "A little note for you"),
      texte: texte(
        "Bonjour {{prenom}},\n\nIl y a {{annees}} an(s), nous commencions à travailler ensemble. Merci pour votre fidélité !",
        "Hello {{prenom}},\n\n{{annees}} year(s) ago we started working together. Thank you for your loyalty!",
      ),
    },
  },
];

export const recetteDe = (id) => RECETTES.find((r) => r.id === id);

/// Une automatisation neuve depuis une recette, dans la langue de l'écran.
export const automatisationDe = (recetteId, langue = "fr", nom = "") => {
  const r = recetteDe(recetteId);
  const l = langue === "en" ? "en" : "fr";
  return {
    nom,
    recette: recetteId,
    actif: false,
    activeLe: "",
    delaiJours: r?.delai ?? 0,
    sujet: r?.contenu.sujet[l] || "",
    apercu: r?.contenu.apercu[l] || "",
    couleur: "#c2410c",
    langue: l,
    blocs: [
      { id: "t1", type: "texte", texte: r?.contenu.texte[l] || "" },
      {
        id: "s1",
        type: "signature",
        texte: l === "en" ? "Talk soon,\n{{entreprise}}" : "À très vite,\n{{entreprise}}",
      },
    ],
    regles: { joursOuvres: true, sortie: true },
    inscrits: [],
  };
};

/// Le prochain moment d'envoi : jours ouvrés, 8 h – 18 h (heure d'Abidjan,
/// c'est-à-dire UTC), si la règle le demande.
export const prochainCreneau = (iso, { joursOuvres = true } = {}) => {
  if (!joursOuvres) return iso;
  const d = new Date(iso);
  for (let i = 0; i < 8; i += 1) {
    const jour = d.getUTCDay();
    if (jour === 0 || jour === 6) {
      d.setUTCDate(d.getUTCDate() + (jour === 6 ? 2 : 1));
      d.setUTCHours(8, 0, 0, 0);
      continue;
    }
    if (d.getUTCHours() < 8) {
      d.setUTCHours(8, 0, 0, 0);
      break;
    }
    if (d.getUTCHours() >= 18) {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(8, 0, 0, 0);
      continue;
    }
    break;
  }
  return d.toISOString();
};

/// Fait entrer les nouveaux candidats. `clients` : les fiches CRM, pour
/// l'adresse ; une fiche sans adresse joignable n'entre pas.
export const inscrire = (auto, ctx, maintenant = new Date().toISOString()) => {
  const r = recetteDe(auto.recette);
  if (!r || !auto.actif || !auto.activeLe) return { auto, nouveaux: 0 };
  const depuis =
    auto.activeLe > plusJours(maintenant, -FENETRE)
      ? auto.activeLe
      : plusJours(maintenant, -FENETRE);
  const connues = new Set((auto.inscrits || []).map((i) => i.cle));
  const parId = new Map((ctx.clients || []).map((c) => [c.id, c]));
  const ajouts = [];
  for (const cand of r.candidats(ctx, depuis, maintenant)) {
    if (connues.has(cand.cle)) continue;
    const c = parId.get(cand.clientId);
    const d = c?.data || {};
    if (
      !adresseValide(d.email) ||
      d.emailDesinscrit ||
      d.emailRebond ||
      d.emailAConfirmer
    )
      continue;
    connues.add(cand.cle);
    ajouts.push({
      cle: cand.cle,
      clientId: cand.clientId,
      objet: cand.objet || "",
      extra: cand.extra || {},
      email: String(d.email).trim().toLowerCase(),
      nom: d.entreprise || d.nom || d.email,
      contact: d.entreprise ? d.nom || "" : "",
      prenom:
        String(d.nom && d.nom !== d.email ? d.nom : "")
          .trim()
          .split(/\s+/)[0] || "",
      ville: d.ville || "",
      entreLe: maintenant,
      prevuLe: prochainCreneau(
        plusJours(maintenant, Number(auto.delaiJours) || 0),
        auto.regles,
      ),
      statut: "attente",
    });
  }
  return {
    auto: {
      ...auto,
      inscrits: elaguer([...(auto.inscrits || []), ...ajouts], maintenant),
    },
    nouveaux: ajouts.length,
  };
};

/// Ceux dont le tour est venu. Les sortants (devis signé…) sont marqués.
export const echeances = (auto, ctx, maintenant = new Date().toISOString()) => {
  const r = recetteDe(auto.recette);
  const prets = [];
  const inscrits = (auto.inscrits || []).map((i) => {
    if (i.statut !== "attente" || i.prevuLe > maintenant) return i;
    if (auto.regles?.sortie !== false && r?.sortie && r.sortie(ctx, i))
      return { ...i, statut: "sorti", sortiLe: maintenant };
    prets.push(i.cle);
    return i;
  });
  return { auto: { ...auto, inscrits }, prets };
};

/// On garde la mémoire des entrées (une clé n'entre qu'une fois) sans
/// laisser la fiche grossir sans fin : au-delà de 120 jours, un inscrit
/// terminé est oublié — la fenêtre des candidats est plus courte.
export const elaguer = (inscrits = [], maintenant = new Date().toISOString()) => {
  const limite = plusJours(maintenant, -120);
  const gardes = inscrits.filter(
    (i) => i.statut === "attente" || (i.entreLe || "") >= limite,
  );
  return gardes.slice(-2000);
};

/// Les chiffres d'une automatisation.
export const statistiquesAuto = (auto = {}) => {
  const ins = auto.inscrits || [];
  const envoyes = ins.filter((i) => i.statut === "envoye");
  const ouverts = envoyes.filter((i) => i.ouvert).length;
  const cliques = envoyes.filter((i) => i.clique).length;
  return {
    entres: ins.length,
    attente: ins.filter((i) => i.statut === "attente").length,
    envoyes: envoyes.length,
    sortis: ins.filter((i) => i.statut === "sorti").length,
    echecs: ins.filter((i) => i.statut === "echec").length,
    ouverts,
    cliques,
    tauxOuverture: envoyes.length ? Math.round((ouverts / envoyes.length) * 100) : 0,
    tauxClic: envoyes.length ? Math.round((cliques / envoyes.length) * 100) : 0,
  };
};

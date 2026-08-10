// Caisse — les règles, sans React.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUI DISTINGUE UNE CAISSE D'UN MODULE DE FACTURATION
//
// La Facturation émet une pièce à un client identifié, avec un délai de
// paiement. Une caisse fait autre chose : trente ventes à la suite, à des
// gens qu'on ne connaît pas, payées sur-le-champ, pendant qu'une file
// attend. Les deux besoins n'ont ni le même rythme ni les mêmes garanties.
//
// D'où trois exigences que la Facturation n'a pas :
//
//   1. **La vitesse.** Pas de formulaire, pas de client à choisir. On
//      touche un produit, il entre au ticket.
//
//   2. **Le rendu de monnaie.** C'est l'erreur la plus fréquente et la
//      plus coûteuse d'un comptoir. Le calcul doit être fait par la
//      machine, affiché en grand, et proposer les coupures usuelles.
//
//   3. **La responsabilité de l'argent.** Une caisse s'ouvre avec un fond,
//      se ferme par un comptage, et l'écart se constate. Sans cela, rien
//      ne distingue une erreur de rendu d'un vol, et le commerçant n'a
//      aucun moyen de savoir lequel des deux s'est produit.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUE LA CAISSE NE STOCKE PAS
//
// Ni les produits — ils viennent du Stock, catalogue partagé de
// l'entreprise — ni les niveaux de stock, qui se déduisent des mouvements.
// Une vente écrit un mouvement de sortie ; le stock baisse tout seul. La
// caisse ne tient donc qu'une chose que personne d'autre ne tient : le
// ticket, et la session qui le contient.
// ─────────────────────────────────────────────────────────────────────────

/// Moyens de paiement, dans l'ordre où ils servent réellement ici.
///
/// `rendu` dit si le moyen peut donner lieu à de la monnaie : on ne rend
/// pas la monnaie sur un virement mobile, on encaisse le montant juste.
export const MOYENS = [
  { id: "especes", label: "Espèces", icone: "faMoneyBill", rendu: true, compte: "571" },
  { id: "mobile", label: "Mobile Money", icone: "faMobileScreen", compte: "531" },
  { id: "carte", label: "Carte", icone: "faCreditCard", compte: "521" },
  { id: "virement", label: "Virement", icone: "faBuildingColumns", compte: "521" },
];

/// Coupures du franc CFA, de la plus grosse à la plus petite.
///
/// Elles servent à deux choses : les touches de paiement rapide (« le
/// client donne 10 000 »), et le comptage de fermeture, qui se fait
/// coupure par coupure — c'est ainsi qu'on compte une caisse, pas en
/// saisissant un total.
export const COUPURES = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 25, 10, 5];

export const today = () => new Date().toISOString().slice(0, 10);

const arrondi = (n) => Math.round(Number(n) || 0);

// ---------------------------------------------------------------------------
// Ticket
// ---------------------------------------------------------------------------

/// Total d'une ligne, remise comprise.
export const totalLigne = (l = {}) => {
  const brut = (Number(l.qte) || 0) * (Number(l.pu) || 0);
  const remise = brut * ((Number(l.remise) || 0) / 100);
  return brut - remise;
};

/// Totaux d'un ticket.
///
/// Les prix affichés au comptoir sont **toutes taxes comprises** : c'est
/// ce que le client paie, et c'est ce qui est sur l'étiquette. La base
/// hors taxe s'en déduit — l'inverse obligerait le commerçant à saisir des
/// prix qu'il n'utilise jamais.
export const totaux = (ticket = {}) => {
  const lignes = ticket.lignes || [];
  const remiseGlobale = Number(ticket.remiseGlobale) || 0;

  let brut = 0;
  for (const l of lignes) brut += totalLigne(l);

  const abattement = brut * (remiseGlobale / 100);
  const ttc = brut - abattement;
  const facteur = brut ? ttc / brut : 1;

  const parTaux = new Map();
  let tva = 0;
  for (const l of lignes) {
    const ligneTtc = totalLigne(l) * facteur;
    const taux = Number(l.tva) || 0;
    const base = taux ? ligneTtc / (1 + taux / 100) : ligneTtc;
    const montant = ligneTtc - base;
    tva += montant;
    const cumul = parTaux.get(taux) || { base: 0, montant: 0 };
    parTaux.set(taux, { base: cumul.base + base, montant: cumul.montant + montant });
  }

  return {
    brut,
    abattement,
    ttc,
    tva,
    ht: ttc - tva,
    articles: lignes.reduce((s, l) => s + (Number(l.qte) || 0), 0),
    parTaux: [...parTaux.entries()]
      .map(([taux, v]) => ({ taux, ...v }))
      .sort((a, b) => a.taux - b.taux),
  };
};

/// Ajoute un article au ticket, ou incrémente sa ligne si elle existe.
///
/// Regrouper plutôt qu'empiler : un client qui prend trois fois le même
/// pain veut voir « Pain × 3 », pas trois lignes. La ligne existante n'est
/// reprise que si le prix est identique — un même article vendu à un prix
/// négocié forme une autre ligne, sinon la remise disparaîtrait.
export const ajouter = (lignes, article, quantite = 1) => {
  const pu = Number(article.prixVente) || 0;
  const i = lignes.findIndex(
    (l) => l.articleId === article.id && Number(l.pu) === pu && !l.remise,
  );
  if (i >= 0) {
    const copie = [...lignes];
    copie[i] = { ...copie[i], qte: (Number(copie[i].qte) || 0) + quantite };
    return copie;
  }
  return [
    ...lignes,
    {
      articleId: article.id,
      designation: article.designation,
      pu,
      qte: quantite,
      tva: Number(article.tva) || 0,
      remise: 0,
      unite: article.unite || "pièce",
    },
  ];
};

/// Change la quantité d'une ligne. Zéro ou moins retire la ligne : au
/// comptoir, « annuler cet article » et « mettre zéro » sont le même geste.
export const changerQuantite = (lignes, index, quantite) => {
  const q = Number(quantite) || 0;
  if (q <= 0) return lignes.filter((_, i) => i !== index);
  return lignes.map((l, i) => (i === index ? { ...l, qte: q } : l));
};

// ---------------------------------------------------------------------------
// Paiement
// ---------------------------------------------------------------------------

/// Ce qu'il reste à encaisser, et ce qu'il faut rendre.
///
/// Un ticket peut être payé en plusieurs fois — 5 000 en espèces, le reste
/// en mobile money — parce que c'est ce que font les gens. Le rendu n'a de
/// sens que sur les espèces : un paiement mobile de 12 000 sur un ticket à
/// 11 500 n'existe pas, on saisit le montant juste.
export const solde = (ticket, paiements = []) => {
  const du = totaux(ticket).ttc;
  let recu = 0;
  let recuEspeces = 0;
  for (const p of paiements) {
    const m = Number(p.montant) || 0;
    recu += m;
    if (MOYENS.find((x) => x.id === p.moyen)?.rendu) recuEspeces += m;
  }
  const reste = du - recu;
  return {
    du: arrondi(du),
    recu: arrondi(recu),
    // Reste à payer, jamais négatif : ce qui dépasse est du rendu, pas une
    // dette. Les confondre ferait afficher « il reste −2 000 à payer ».
    reste: arrondi(Math.max(0, reste)),
    rendu: arrondi(Math.max(0, -reste)),
    // On ne peut rendre que ce qu'on a reçu en espèces.
    renduPossible: arrondi(Math.min(Math.max(0, -reste), recuEspeces)),
    solde: reste <= 0,
  };
};

/// Les coupures à proposer pour un montant : le compte juste, puis les
/// arrondis vers le haut que le client donnera vraisemblablement.
///
/// Un caissier ne tape pas « 11 500 reçus » : le client tend un billet de
/// 10 000 et un de 2 000. Proposer ces montants supprime la saisie dans
/// l'immense majorité des cas.
export const suggestions = (montant) => {
  const du = arrondi(montant);
  if (du <= 0) return [];
  const out = [du];
  for (const c of [...COUPURES].reverse()) {
    const sup = Math.ceil(du / c) * c;
    if (sup > du && !out.includes(sup)) out.push(sup);
  }
  // Et les billets seuls, qu'on tend sans réfléchir.
  for (const c of COUPURES) if (c > du && !out.includes(c)) out.push(c);
  return out.sort((a, b) => a - b).slice(0, 6);
};

/// Décomposition d'un montant en coupures — ce qu'il faut sortir du tiroir.
export const enCoupures = (montant) => {
  let reste = arrondi(montant);
  const out = [];
  for (const c of COUPURES) {
    const n = Math.floor(reste / c);
    if (n > 0) {
      out.push({ coupure: c, nombre: n });
      reste -= n * c;
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Session de caisse
// ---------------------------------------------------------------------------

/// Ce que la session a encaissé, par moyen de paiement.
export const encaissements = (tickets, sessionId) => {
  const parMoyen = new Map();
  let total = 0;
  for (const t of tickets) {
    if (t.data.sessionId !== sessionId || t.data.annule) continue;
    for (const p of t.data.paiements || []) {
      const m = Number(p.montant) || 0;
      parMoyen.set(p.moyen, (parMoyen.get(p.moyen) || 0) + m);
      total += m;
    }
    // Le rendu sort du tiroir : il diminue les espèces réellement en
    // caisse, sans quoi le comptage de fermeture ne tomberait jamais juste.
    const r = Number(t.data.rendu) || 0;
    if (r) parMoyen.set("especes", (parMoyen.get("especes") || 0) - r);
    total -= r;
  }
  return {
    parMoyen: MOYENS.map((m) => ({ ...m, montant: arrondi(parMoyen.get(m.id) || 0) })),
    total: arrondi(total),
  };
};

/// Ce que le tiroir devrait contenir : le fond d'ouverture plus les
/// espèces encaissées, rendus déduits.
export const attenduEnCaisse = (session, tickets) => {
  const e = encaissements(tickets, session.id);
  const especes = e.parMoyen.find((m) => m.id === "especes")?.montant || 0;
  return arrondi((Number(session.data.fond) || 0) + especes);
};

/// Total d'un comptage physique, saisi coupure par coupure.
export const totalComptage = (comptage = {}) =>
  COUPURES.reduce((s, c) => s + c * (Number(comptage[c]) || 0), 0);

/// L'écart de caisse : constaté moins attendu.
///
/// Il n'est jamais corrigé en silence. Un écart négatif est une perte, un
/// écart positif est une erreur de rendu en votre faveur — les deux
/// méritent d'être vus, et c'est justement ce qu'une caisse qui « tombe
/// toujours juste » empêche de voir.
export const ecart = (session, tickets, comptage) =>
  arrondi(totalComptage(comptage) - attenduEnCaisse(session, tickets));

/// Statistiques d'une session, pour son résumé de fermeture.
export const resume = (session, tickets) => {
  const miens = tickets.filter(
    (t) => t.data.sessionId === session.id && !t.data.annule,
  );
  const annules = tickets.filter(
    (t) => t.data.sessionId === session.id && t.data.annule,
  );
  const ca = miens.reduce((s, t) => s + (Number(t.data.ttc) || 0), 0);
  const articles = miens.reduce((s, t) => s + (Number(t.data.articles) || 0), 0);

  return {
    tickets: miens.length,
    annules: annules.length,
    ca: arrondi(ca),
    articles,
    panierMoyen: miens.length ? arrondi(ca / miens.length) : 0,
    encaissements: encaissements(tickets, session.id),
  };
};

/// Numéro de ticket du jour : préfixe date et compteur, remis à zéro
/// chaque jour. Un numéro qui ne repart jamais devient illisible au bout
/// d'un an, et le rapprochement avec un ticket papier se fait à la journée.
export const prochainNumero = (tickets, date = today()) => {
  const jour = date.replace(/-/g, "").slice(2); // AAMMJJ
  const n = tickets.filter((t) => (t.data.numero || "").startsWith(jour)).length;
  return `${jour}-${String(n + 1).padStart(3, "0")}`;
};

// ---------------------------------------------------------------------------
// Ce que la vente produit ailleurs
// ---------------------------------------------------------------------------

/// Mouvements de stock d'un ticket : une sortie par ligne.
///
/// C'est ce qui fait que le stock n'a jamais à être ressaisi. Le motif
/// porte le numéro de ticket, si bien qu'un écart d'inventaire se remonte
/// jusqu'à la vente qui l'explique.
export const mouvementsDuTicket = (ticket, numero) =>
  (ticket.lignes || [])
    .filter((l) => l.articleId)
    .map((l) => ({
      articleId: l.articleId,
      sens: "sortie",
      quantite: Number(l.qte) || 0,
      date: ticket.date || today(),
      motif: `Vente ${numero}`,
      origine: `caisse:${numero}`,
    }));

/// Écriture comptable d'un ticket.
///
/// Une vente au comptoir est le cas le plus simple de la partie double :
/// la trésorerie au débit pour ce qui est réellement entré, la vente au
/// crédit pour le hors-taxe, la TVA au crédit pour le reste. Un paiement
/// mixte donne plusieurs lignes de trésorerie — c'est là que la caisse
/// gagne sur une saisie manuelle, qui les oublierait.
export const ecritureDuTicket = (ticket, numero) => {
  const t = totaux(ticket);
  const lignes = [];

  for (const p of ticket.paiements || []) {
    const moyen = MOYENS.find((m) => m.id === p.moyen);
    let montant = Number(p.montant) || 0;
    // Le rendu se déduit des espèces : il n'est jamais entré en caisse.
    if (moyen?.rendu) montant -= Number(ticket.rendu) || 0;
    if (arrondi(montant) !== 0) {
      lignes.push({ compte: moyen?.compte || "571", debit: arrondi(montant), credit: 0 });
    }
  }

  lignes.push({ compte: "701", debit: 0, credit: arrondi(t.ht) });
  if (arrondi(t.tva) !== 0) {
    lignes.push({ compte: "4431", debit: 0, credit: arrondi(t.tva) });
  }

  // Rattrapage d'arrondi sur la ligne de vente, qui est la ligne « reste ».
  const debit = lignes.reduce((s, l) => s + l.debit, 0);
  const credit = lignes.reduce((s, l) => s + l.credit, 0);
  const e = debit - credit;
  if (e !== 0) {
    const vente = lignes.find((l) => l.compte === "701");
    if (vente) vente.credit += e;
  }

  return {
    date: ticket.date || today(),
    libelle: `Vente comptoir ${numero}`,
    piece: numero,
    origine: `caisse:${numero}`,
    lignes,
  };
};

/// Montant lisible, dans la devise d'affichage de l'espace.
export { montant as fcfa } from "../../../utils/monnaie";

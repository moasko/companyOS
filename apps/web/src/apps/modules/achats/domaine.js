// Achats — les règles, sans React.
//
// ─────────────────────────────────────────────────────────────────────────
// L'ASYMÉTRIE QUE CE MODULE CORRIGE
//
// Côté ventes, tout est automatisé : la facture crée sa créance, le
// règlement l'éteint, le poste client se tient tout seul. Côté achats,
// rien : le Stock connaît les fournisseurs, la Comptabilité a le compte
// 401, mais aucun flux ne les relie. « Ce que je dois à mes fournisseurs »
// reste vide tant qu'on ne saisit pas tout à la main.
//
// Le cycle d'achat a trois temps, et les confondre coûte cher :
//
//   1. **La commande** — un engagement, pas une dette. Rien au stock,
//      rien en comptabilité. Elle sert à savoir ce qu'on attend.
//   2. **La réception** — la marchandise est là. Le stock monte,
//      ligne par ligne, avec les quantités *réellement* reçues — un
//      fournisseur livre rarement exactement ce qu'on a commandé.
//   3. **La facture fournisseur** — la dette naît, à sa date, avec sa TVA
//      déductible. C'est elle qui alimente le poste 401 et la déclaration.
//
// Séparer 2 et 3 n'est pas du zèle : la marchandise arrive souvent avant
// la facture, et la TVA ne se déduit qu'à la facture. Les fusionner
// fausserait soit le stock, soit la déclaration.
// ─────────────────────────────────────────────────────────────────────────

/// Les états d'une commande, dans l'ordre du cycle. Déduits des faits
/// autant que possible : « reçue » découle des réceptions, pas d'une case.
export const STATUTS = {
  brouillon: { label: "Brouillon", ton: "idle" },
  envoyee: { label: "Envoyée", ton: "info" },
  partielle: { label: "Reçue en partie", ton: "attention" },
  recue: { label: "Reçue", ton: "ok" },
  annulee: { label: "Annulée", ton: "off" },
};

export const today = () => new Date().toISOString().slice(0, 10);

const arrondi = (n) => Math.round(Number(n) || 0);

// ---------------------------------------------------------------------------
// Commande
// ---------------------------------------------------------------------------

/// Total d'une ligne de commande — prix d'achat, hors taxe. Les achats se
/// négocient en HT entre professionnels, contrairement au comptoir.
export const totalLigne = (l = {}) => (Number(l.qte) || 0) * (Number(l.pu) || 0);

/// Totaux d'une commande.
export const totaux = (commande = {}) => {
  const lignes = commande.lignes || [];
  let ht = 0;
  let tva = 0;
  for (const l of lignes) {
    const base = totalLigne(l);
    ht += base;
    tva += (base * (Number(l.tva) || 0)) / 100;
  }
  return { ht: arrondi(ht), tva: arrondi(tva), ttc: arrondi(ht + tva) };
};

/// Numéro de commande : CMD-AAAA-NNN, comme la Facturation numérote.
export const prochainNumero = (commandes, annee = new Date().getFullYear()) => {
  const prefixe = `CMD-${annee}-`;
  const n = commandes.filter((c) => (c.data.numero || "").startsWith(prefixe)).length;
  return `${prefixe}${String(n + 1).padStart(3, "0")}`;
};

// ---------------------------------------------------------------------------
// Réception
// ---------------------------------------------------------------------------

/// Quantités déjà reçues d'une commande : { [articleId]: qté }.
export const dejaRecu = (commande, receptions) => {
  const out = {};
  for (const r of receptions) {
    if (r.data.commandeId !== commande.id) continue;
    for (const l of r.data.lignes || []) {
      out[l.articleId] = (out[l.articleId] || 0) + (Number(l.qte) || 0);
    }
  }
  return out;
};

/// Ce qu'il reste à recevoir, ligne par ligne. C'est la liste que le
/// magasinier a sous les yeux quand le camion arrive.
export const resteARecevoir = (commande, receptions) => {
  const recu = dejaRecu(commande, receptions);
  return (commande.data.lignes || [])
    .map((l) => ({
      ...l,
      recu: recu[l.articleId] || 0,
      reste: Math.max(0, (Number(l.qte) || 0) - (recu[l.articleId] || 0)),
    }))
    .filter((l) => l.reste > 0);
};

/// L'état réel d'une commande, déduit des réceptions.
export const statutReel = (commande, receptions) => {
  const d = commande.data;
  if (d.statut === "annulee" || d.statut === "brouillon") return d.statut;
  const restes = resteARecevoir(commande, receptions);
  const quelqueChose = Object.keys(dejaRecu(commande, receptions)).length > 0;
  if (!restes.length && quelqueChose) return "recue";
  if (quelqueChose) return "partielle";
  return "envoyee";
};

/// Mouvements de stock d'une réception : une entrée par ligne reçue.
///
/// Le prix unitaire accompagne l'entrée — c'est lui qui alimente le prix
/// moyen pondéré du Stock. Le motif porte le numéro de commande : un
/// niveau de stock surprenant se remonte jusqu'au camion qui l'explique.
export const mouvementsDeReception = (reception, numeroCommande) =>
  (reception.lignes || [])
    .filter((l) => l.articleId && (Number(l.qte) || 0) > 0)
    .map((l) => ({
      articleId: l.articleId,
      sens: "entree",
      quantite: Number(l.qte) || 0,
      prixUnitaire: Number(l.pu) || 0,
      date: reception.date || today(),
      motif: `Réception ${numeroCommande}`,
      origine: `achats:${numeroCommande}:${reception.date}`,
    }));

// ---------------------------------------------------------------------------
// Facture fournisseur
// ---------------------------------------------------------------------------

/// Montant déjà facturé sur une commande.
export const dejaFacture = (commande, factures) =>
  factures
    .filter((f) => f.data.commandeId === commande.id)
    .reduce((s, f) => s + (Number(f.data.ttc) || 0), 0);

/// Montant déjà payé sur une facture fournisseur.
export const dejaPaye = (facture, paiements) =>
  paiements
    .filter((p) => p.data.factureId === facture.id)
    .reduce((s, p) => s + (Number(p.data.montant) || 0), 0);

/// Écriture comptable d'une facture fournisseur.
///
/// La charge au débit pour le HT, la TVA récupérable au débit, le
/// fournisseur au crédit pour le TTC. La dette naît ici — pas à la
/// commande, pas à la réception, pas au paiement.
export const ecritureDeFacture = (facture, nomFournisseur) => {
  const ht = arrondi(facture.ht);
  const tva = arrondi(facture.tva);
  const ttc = arrondi(facture.ttc);

  const lignes = [
    // 601 par défaut : des marchandises à revendre, le cas d'une boutique.
    // Une facture de frais (loyer, honoraires) se saisit en Comptabilité
    // avec le modèle qui va bien — ce module couvre l'approvisionnement.
    { compte: facture.compteCharge || "601", debit: ht, credit: 0 },
  ];
  if (tva) lignes.push({ compte: "4452", debit: tva, credit: 0 });
  lignes.push({ compte: "401", debit: 0, credit: ttc });

  // Rattrapage d'arrondi sur la dette, ligne « reste ».
  const ecart = lignes.reduce((s, l) => s + l.debit - l.credit, 0);
  if (ecart !== 0) lignes[lignes.length - 1].credit += ecart;

  return {
    date: facture.date || today(),
    libelle: `Facture ${facture.reference || ""} — ${nomFournisseur || "fournisseur"}`.trim(),
    piece: facture.reference || "",
    tiers: nomFournisseur || "",
    origine: `achat-facture:${facture.id || facture.reference}`,
    lignes,
  };
};

/// Écriture d'un paiement fournisseur : la dette s'éteint, la trésorerie
/// sort. Même pièce que la facture — c'est ce qui lettre le poste 401.
export const ecriturePaiement = (paiement, facture, nomFournisseur) => {
  const montant = arrondi(paiement.montant);
  const comptes = { especes: "571", mobile: "531", banque: "521" };
  return {
    date: paiement.date || today(),
    libelle: `Paiement ${facture?.data?.reference || ""} — ${nomFournisseur || "fournisseur"}`.trim(),
    piece: facture?.data?.reference || "",
    tiers: nomFournisseur || "",
    origine: `achat-paiement:${paiement.id}`,
    lignes: [
      { compte: "401", debit: montant, credit: 0 },
      { compte: comptes[paiement.moyen] || "521", debit: 0, credit: montant },
    ],
  };
};

// ---------------------------------------------------------------------------
// Vue d'ensemble
// ---------------------------------------------------------------------------

/// Les commandes dont il faut s'occuper, par urgence décroissante.
export const statistiques = (commandes, receptions, factures, paiements) => {
  const vivantes = commandes.filter(
    (c) => !["annulee", "brouillon"].includes(c.data.statut),
  );
  const enAttente = vivantes.filter(
    (c) => statutReel(c, receptions) !== "recue",
  );
  const engagement = enAttente.reduce((s, c) => {
    const restes = resteARecevoir(c, receptions);
    // Sur le **reste**, pas sur la quantité commandée : ce qui est déjà
    // reçu n'est plus un engagement, c'est du stock.
    return (
      s +
      restes.reduce(
        (x, l) => x + l.reste * (Number(l.pu) || 0) * (1 + (Number(l.tva) || 0) / 100),
        0,
      )
    );
  }, 0);

  const impayees = factures.filter(
    (f) => dejaPaye(f, paiements) < (Number(f.data.ttc) || 0) - 0.5,
  );
  const duFournisseurs = impayees.reduce(
    (s, f) => s + (Number(f.data.ttc) || 0) - dejaPaye(f, paiements),
    0,
  );

  return {
    enAttente: enAttente.length,
    engagement: arrondi(engagement),
    impayees: impayees.length,
    duFournisseurs: arrondi(duFournisseurs),
  };
};

/// Suggestion de réapprovisionnement : les articles sous leur seuil, avec
/// la quantité qui les ramène au double du seuil — de quoi tenir, sans
/// sur-stocker. C'est un point de départ à ajuster, pas un ordre.
export const aReapprovisionner = (articles, stocks) =>
  articles
    .map((a) => {
      const stock = stocks[a.id] ?? 0;
      const seuil = Number(a.data.seuil) || 0;
      if (!seuil || stock > seuil) return null;
      return {
        article: a,
        stock,
        seuil,
        suggestion: Math.max(1, seuil * 2 - stock),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.stock / a.seuil - b.stock / b.seuil);

/// Montant lisible, dans la devise d'affichage de l'espace.
export { montant as fcfa } from "../../../utils/monnaie";

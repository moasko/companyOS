// Éditeur de factures — les règles, en fonctions pures.
//
// ─────────────────────────────────────────────────────────────────────────
// UNE FACTURE, UN SEUL ENDROIT
//
// L'éditeur ne garde pas ses factures pour lui : il les range dans la
// collection de la Facturation (`facturation/factures`), au format de la
// Facturation. C'est ce qui fait qu'une facture créée ici est suivie
// là-bas (règlements, relances, état de paiement), qu'elle apparaît dans le
// panneau « Aujourd'hui » du bureau et dans la fiche du client au CRM.
//
// L'éditeur ajoute des champs que la Facturation ignore sans dommage
// (modèle, couleur, échéancier, notes de paiement…) et ne touche jamais au
// calcul : les totaux sont ceux de `@companyos/shared/facturation`. Deux
// écrans qui afficheraient deux totaux différents pour la même facture,
// c'est un litige avec un client.
//
// D'où deux choix de représentation :
//   • la remise s'applique aux articles, ligne par ligne (`remise` en %),
//     et non en remise globale : la remise globale du modèle partagé
//     s'appliquerait aussi aux frais de livraison ;
//   • les frais de livraison sont une ligne marquée `livraison: true`,
//     sans TVA : la Facturation la compte comme n'importe quelle ligne.
// ─────────────────────────────────────────────────────────────────────────

import { plusJours, prochainNumero, today, totalLigne, totaux } from "@companyos/shared/facturation";

export { today };

// ---------------------------------------------------------------------------
// Conditions de paiement
// ---------------------------------------------------------------------------

export const CONDITIONS = [
  { id: "reception", label: "À réception", jours: 0 },
  { id: "net15", label: "Net 15", jours: 15 },
  { id: "net30", label: "Net 30", jours: 30 },
  { id: "net45", label: "Net 45", jours: 45 },
  { id: "net60", label: "Net 60", jours: 60 },
  { id: "finMois", label: "Fin de mois", jours: null },
];

/// L'échéance que donnent des conditions de paiement à partir d'une date.
export const echeanceSelon = (conditions, date = today()) => {
  const c = CONDITIONS.find((x) => x.id === conditions);
  if (!c) return date;
  if (c.jours === null) {
    const d = new Date(`${date}T00:00:00Z`);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  }
  return plusJours(c.jours, date);
};

// ---------------------------------------------------------------------------
// Moyens de paiement et envoi
// ---------------------------------------------------------------------------

export const MOYENS_PAIEMENT = [
  { id: "virement", label: "Virement bancaire" },
  { id: "mobile", label: "Mobile Money" },
  { id: "especes", label: "Espèces" },
  { id: "cheque", label: "Chèque" },
  { id: "carte", label: "Carte bancaire" },
];

export const MODES_ENVOI = [
  {
    id: "immediat",
    label: "Envoyer au client immédiatement",
    aide: "La facture sera envoyée au client dès sa création, en PDF par le Courrier.",
  },
  {
    id: "envoyee",
    label: "Marquer comme envoyée, sans courriel",
    aide: "Pour une facture remise en main propre ou envoyée par un autre canal.",
  },
  {
    id: "brouillon",
    label: "Enregistrer comme brouillon",
    aide: "La facture reste modifiable et n'est comptée nulle part tant qu'elle n'est pas envoyée.",
  },
];

// ---------------------------------------------------------------------------
// Récurrence
// ---------------------------------------------------------------------------

export const FREQUENCES = [
  { id: "hebdo", label: "Chaque semaine" },
  { id: "mensuel", label: "Chaque mois" },
  { id: "trimestriel", label: "Chaque trimestre" },
  { id: "semestriel", label: "Chaque semestre" },
  { id: "annuel", label: "Chaque année" },
];

const MOIS_PAR_FREQUENCE = { mensuel: 1, trimestriel: 3, semestriel: 6, annuel: 12 };

/// La date suivante d'une récurrence. Un 31 janvier mensuel donne le
/// 28 (ou 29) février, puis le 31 mars : le jour d'origine est gardé.
export const dateSuivante = (date, frequence, jourOrigine = null) => {
  const d = new Date(`${date}T00:00:00Z`);
  if (frequence === "hebdo") return plusJours(7, date);
  const mois = MOIS_PAR_FREQUENCE[frequence] || 1;
  const jour = jourOrigine || d.getUTCDate();
  const cible = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + mois, 1));
  const dernier = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(jour, dernier));
  return cible.toISOString().slice(0, 10);
};

/// Les récurrences dont une facture est due aujourd'hui.
export const recurrencesDues = (recurrences = [], maintenant = today()) =>
  recurrences.filter((r) => {
    const d = r.data || r;
    if (d.actif === false || !d.prochaine) return false;
    if (d.prochaine > maintenant) return false;
    if (d.fin && d.prochaine > d.fin) return false;
    return true;
  });

// ---------------------------------------------------------------------------
// La facture de l'éditeur
// ---------------------------------------------------------------------------

let compteur = 0;
export const idLigne = () => `l${Date.now().toString(36)}${(compteur += 1)}`;

export const ligneVide = () => ({
  id: idLigne(),
  designation: "",
  description: "",
  qte: 1,
  pu: 0,
  tva: 18,
});

export const factureVide = (reglages = {}) => {
  const date = today();
  const conditions = reglages.conditions || "net30";
  return {
    type: "facture",
    numero: "",
    date,
    conditions,
    echeance: echeanceSelon(conditions, date),
    devise: reglages.devise || "XOF",
    clientId: "",
    clientNom: "",
    clientEntreprise: "",
    clientEmail: "",
    clientVille: "",
    clientTelephone: "",
    lignes: [ligneVide()],
    remise: 0,
    livraison: 0,
    mode: "standard",
    echeancier: [
      { id: idLigne(), libelle: "Acompte à la commande", pourcentage: 50, date },
      { id: idLigne(), libelle: "Solde", pourcentage: 50, date: echeanceSelon(conditions, date) },
    ],
    recurrence: { frequence: "mensuel", fin: "" },
    modele: reglages.modele || "moderne",
    couleur: reglages.couleur || "",
    afficherLogo: true,
    afficherSignature: true,
    montantEnLettres: true,
    envoi: "immediat",
    moyenPaiement: reglages.moyenPaiement || "virement",
    notes: reglages.notes ?? "Merci pour votre confiance. Nous restons à votre disposition pour toute question.",
    conditionsTexte: "",
  };
};

// ---- Conversion vers la Facturation et retour --------------------------------

/// La facture telle que la Facturation la range. `origine` est la fiche
/// déjà enregistrée : ses champs inconnus de l'éditeur sont conservés.
export const versFacturation = (f, origine = {}) => {
  const remise = Number(f.remise) || 0;
  const lignes = f.lignes
    .filter((l) => String(l.designation || "").trim() || Number(l.pu))
    .map((l) => {
      const { id: _id, ...reste } = l;
      return {
        ...reste,
        qte: Number(l.qte) || 0,
        pu: Number(l.pu) || 0,
        tva: Number(l.tva) || 0,
        remise,
      };
    });
  if (Number(f.livraison) > 0) {
    lignes.push({ designation: "Frais de livraison", qte: 1, pu: Number(f.livraison), tva: 0, remise: 0, livraison: true });
  }
  const {
    lignes: _l, remise: _r, livraison: _v, mode, echeancier, recurrence: _rec, envoi: _e, ...reste
  } = f;
  return {
    ...origine,
    ...reste,
    lignes,
    remiseGlobale: 0,
    // L'échéancier n'a de sens que pour une facture payée en plusieurs fois.
    echeancier: mode === "fractionne" ? echeancier.map(({ id: _id, ...e }) => e) : undefined,
    recurrente: mode === "recurrente" || undefined,
    mode,
    editeur: true,
  };
};

/// Une fiche de la Facturation, rouverte dans l'éditeur.
export const depuisFacturation = (doc, reglages = {}) => {
  const base = factureVide(reglages);
  const d = doc || {};
  const lignesSource = d.lignes || [];
  const livraison = lignesSource.filter((l) => l.livraison).reduce((s, l) => s + (Number(l.pu) || 0) * (Number(l.qte) || 1), 0);
  const articles = lignesSource.filter((l) => !l.livraison);
  // Une remise globale de la Facturation devient la remise des articles :
  // sans ligne de livraison, le total est rigoureusement le même.
  const remise = Number(d.remiseGlobale) || Number(articles[0]?.remise) || 0;
  return {
    ...base,
    ...d,
    lignes: articles.length
      ? articles.map((l) => ({ description: "", ...l, id: idLigne(), remise: undefined }))
      : [ligneVide()],
    remise,
    livraison,
    mode: d.mode || (d.echeancier?.length ? "fractionne" : "standard"),
    echeancier: d.echeancier?.length
      ? d.echeancier.map((e) => ({ id: idLigne(), ...e }))
      : base.echeancier,
    recurrence: base.recurrence,
    conditions: d.conditions || base.conditions,
    envoi: d.statut === "brouillon" ? "brouillon" : "envoyee",
  };
};

// ---- Totaux -------------------------------------------------------------------

/// Les chiffres de la facture, calculés par le modèle partagé.
export const chiffres = (f) => {
  const doc = versFacturation(f);
  const t = totaux(doc);
  const articles = doc.lignes.filter((l) => !l.livraison);
  const sousTotal = articles.reduce((s, l) => s + (Number(l.qte) || 0) * (Number(l.pu) || 0), 0);
  const montantRemise = sousTotal - articles.reduce((s, l) => s + totalLigne(l), 0);
  return {
    sousTotal,
    remise: montantRemise,
    tva: t.tva,
    parTaux: t.parTaux,
    livraison: Number(f.livraison) || 0,
    total: t.ttc,
    ht: t.ht,
  };
};

/// Le montant de chaque échéance ; la dernière absorbe l'arrondi pour que
/// la somme retombe exactement sur le total.
export const montantsEcheancier = (echeancier = [], total = 0) => {
  let reste = Math.round(total);
  return echeancier.map((e, i) => {
    const montant = i === echeancier.length - 1
      ? reste
      : Math.round((total * (Number(e.pourcentage) || 0)) / 100);
    reste -= montant;
    return { ...e, montant };
  });
};

// ---- Numérotation -----------------------------------------------------------

/// Le numéro suivant, dans la séquence de la Facturation : un seul
/// compteur pour toutes les factures de l'entreprise, quel que soit l'écran
/// qui les crée.
export const numeroSuivant = (documents = [], date = today()) =>
  prochainNumero(documents, "facture", Number(String(date).slice(0, 4)) || new Date().getFullYear());

// ---- Vérifications ---------------------------------------------------------------

/// Ce qui empêche d'émettre la facture, en phrases à montrer telles quelles.
export const problemes = (f) => {
  const out = [];
  if (!f.clientId && !String(f.clientNom || f.clientEntreprise || "").trim()) {
    out.push("Choisissez le client à facturer.");
  }
  const lignes = f.lignes.filter((l) => String(l.designation || "").trim());
  if (!lignes.length) out.push("Ajoutez au moins un article.");
  if (f.lignes.some((l) => String(l.designation || "").trim() && !(Number(l.qte) > 0))) {
    out.push("Chaque article doit avoir une quantité positive.");
  }
  if (!f.numero) out.push("Donnez un numéro à la facture.");
  if (f.echeance && f.date && f.echeance < f.date) out.push("L'échéance précède la date de facture.");
  if (f.mode === "fractionne") {
    const somme = f.echeancier.reduce((s, e) => s + (Number(e.pourcentage) || 0), 0);
    if (Math.round(somme * 100) !== 10000) out.push(`Les échéances totalisent ${somme} % au lieu de 100 %.`);
  }
  if (f.mode === "recurrente" && f.recurrence.fin && f.recurrence.fin < f.date) {
    out.push("La fin de la récurrence précède la première facture.");
  }
  return out;
};

// ---------------------------------------------------------------------------
// Montant en lettres
// ---------------------------------------------------------------------------
//
// « Arrêtée la présente facture à la somme de : deux millions deux cent
// mille francs CFA » — une mention d'usage en Afrique francophone, que
// beaucoup de clients et d'administrations attendent.

const UNITES = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix",
  "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
const DIZAINES = ["", "dix", "vingt", "trente", "quarante", "cinquante", "soixante", "soixante", "quatre-vingt", "quatre-vingt"];

const moinsDeCent = (n, final = true) => {
  if (n < 20) return UNITES[n];
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (d === 7 || d === 9) {
    const reste = 10 + u;
    const liaison = d === 7 && u === 1 ? " et " : "-";
    return `${DIZAINES[d]}${liaison}${UNITES[reste]}`;
  }
  // « quatre-vingts », mais « quatre-vingt mille ».
  if (u === 0) return d === 8 && final ? "quatre-vingts" : DIZAINES[d];
  if (u === 1 && d !== 8) return `${DIZAINES[d]} et un`;
  return `${DIZAINES[d]}-${UNITES[u]}`;
};

const moinsDeMille = (n, final = true) => {
  const c = Math.floor(n / 100);
  const r = n % 100;
  let s = "";
  if (c === 1) s = "cent";
  else if (c > 1) s = `${UNITES[c]} cent${r === 0 && final ? "s" : ""}`;
  if (r) s = s ? `${s} ${moinsDeCent(r, final)}` : moinsDeCent(r, final);
  return s;
};

/// 2 200 000 → « deux millions deux cent mille ».
export const nombreEnLettres = (valeur) => {
  let n = Math.round(Math.abs(Number(valeur) || 0));
  if (n === 0) return "zéro";
  const parties = [];
  const milliards = Math.floor(n / 1e9); n %= 1e9;
  const millions = Math.floor(n / 1e6); n %= 1e6;
  const milliers = Math.floor(n / 1e3); n %= 1e3;
  if (milliards) parties.push(`${moinsDeMille(milliards)} milliard${milliards > 1 ? "s" : ""}`);
  if (millions) parties.push(`${moinsDeMille(millions)} million${millions > 1 ? "s" : ""}`);
  if (milliers) parties.push(milliers === 1 ? "mille" : `${moinsDeMille(milliers, false)} mille`);
  if (n) parties.push(moinsDeMille(n));
  return parties.join(" ");
};

const NOMS_DEVISES = { XOF: "francs CFA", EUR: "euros", USD: "dollars" };

export const montantEnLettres = (valeur, devise = "XOF") => {
  const texte = nombreEnLettres(valeur);
  return `${texte.charAt(0).toUpperCase()}${texte.slice(1)} ${NOMS_DEVISES[devise] || devise}`;
};

// ---------------------------------------------------------------------------
// Petits outils d'affichage
// ---------------------------------------------------------------------------

export const initiales = (nom = "") =>
  String(nom)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0].toUpperCase())
    .join("") || "?";

export const dateLongue = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
};

/// Ce que la facture dit du paiement, selon le moyen choisi et le profil
/// de l'entreprise. Une ligne vide est retirée : un RIB non renseigné ne
/// doit pas imprimer « IBAN : ».
export const lignesPaiement = (moyen, e = {}) => {
  const nom = e.nom || "";
  const lignes = {
    virement: ["Virement bancaire", e.banque && `Banque : ${e.banque}`, (e.titulaire || nom) && `Titulaire : ${e.titulaire || nom}`, e.iban && `RIB / IBAN : ${e.iban}`],
    mobile: ["Mobile Money", e.mobileNumero && `${e.mobileOperateur || "Numéro"} : ${e.mobileNumero}`, nom && `Au nom de : ${nom}`],
    especes: ["Espèces", "Règlement à notre caisse, contre reçu."],
    cheque: ["Chèque", nom && `À l'ordre de ${nom}`],
    carte: ["Carte bancaire", "Paiement sur terminal ou en ligne."],
  }[moyen] || [];
  return lignes.filter(Boolean);
};

/// Le libellé de la taxe : le taux s'il est unique, sinon « TVA ».
export const libelleTaxe = (parTaux = []) => {
  const taux = parTaux.filter((t) => t.taux > 0);
  return taux.length === 1 ? `TVA (${taux[0].taux} %)` : "TVA";
};

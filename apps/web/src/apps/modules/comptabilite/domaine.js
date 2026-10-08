// Comptabilité — les règles, sans React.
//
// ─────────────────────────────────────────────────────────────────────────
// LE PARI DE CETTE APPLICATION
//
// Un logiciel de comptabilité classique demande à l'utilisateur de choisir
// deux numéros de compte pour chaque opération. C'est *la* barrière : un
// commerçant d'Adjamé sait parfaitement qu'il a payé son loyer, il ne sait
// pas que cela s'écrit 622 au débit et 571 au crédit — et il n'a aucune
// raison de l'apprendre.
//
// Ici la partie double reste entière, elle n'est simplement jamais
// demandée. Deux chemins la produisent :
//
//   1. **Les modèles d'opération** (`MODELES`) — « J'ai payé le loyer »,
//      « J'ai encaissé une facture ». L'utilisateur choisit une phrase et
//      un montant ; les comptes en découlent.
//
//   2. **La reprise automatique** (`ecrituresSuggerees`) — CompanyOS
//      possède déjà la Facturation. Chaque facture émise et chaque
//      règlement encaissé produisent leur écriture sans aucune saisie.
//      C'est ce qu'aucun logiciel externe ne peut faire : il faudrait
//      d'abord lui ressaisir les factures.
//
// Rien n'est écrit dans le journal sans que l'utilisateur ait vu et validé
// l'écriture. La commodité ne doit pas devenir de l'opacité : une
// comptabilité qu'on ne peut pas relire ne vaut rien devant un contrôle.
//
// ─────────────────────────────────────────────────────────────────────────
// LE RÉFÉRENTIEL
//
// SYSCOHADA révisé (AUDCIF), applicable depuis 2018 dans les 17 pays de
// l'OHADA. Codification décimale en neuf classes : 1 à 5 pour le bilan,
// 6 à 8 pour la gestion, 9 pour les engagements et l'analytique.
//
// Le plan ci-dessous n'est pas le plan complet — il compte des milliers de
// comptes. C'est l'extrait dont une PME se sert vraiment, avec les numéros
// exacts du référentiel. Un compte manquant s'ajoute à la liste ; rien
// dans le calcul ne dépend de la longueur du plan, seulement du premier
// chiffre, qui donne la classe.
// ─────────────────────────────────────────────────────────────────────────

/// Les neuf classes, et ce qu'elles portent.
export const CLASSES = {
  1: { label: "Ressources durables", groupe: "bilan", sens: "passif" },
  2: { label: "Actif immobilisé", groupe: "bilan", sens: "actif" },
  3: { label: "Stocks", groupe: "bilan", sens: "actif" },
  4: { label: "Tiers", groupe: "bilan", sens: "mixte" },
  5: { label: "Trésorerie", groupe: "bilan", sens: "actif" },
  6: { label: "Charges", groupe: "gestion", sens: "charge" },
  7: { label: "Produits", groupe: "gestion", sens: "produit" },
  8: { label: "Hors activités ordinaires", groupe: "gestion", sens: "mixte" },
  9: { label: "Engagements et analytique", groupe: "hors-bilan", sens: "mixte" },
};

/// Extrait du plan comptable général OHADA pour une PME.
export const PLAN = [
  // Classe 1 — ressources durables
  { code: "101", label: "Capital social" },
  { code: "106", label: "Écarts de réévaluation" },
  { code: "110", label: "Report à nouveau créditeur" },
  { code: "111", label: "Réserve légale" },
  { code: "118", label: "Autres réserves" },
  { code: "121", label: "Report à nouveau créditeur" },
  { code: "129", label: "Report à nouveau débiteur" },
  { code: "131", label: "Résultat net de l'exercice" },
  { code: "162", label: "Emprunts auprès des établissements de crédit" },

  // Classe 2 — actif immobilisé
  { code: "231", label: "Bâtiments" },
  { code: "241", label: "Matériel et outillage" },
  { code: "244", label: "Matériel et mobilier de bureau" },
  { code: "245", label: "Matériel de transport" },
  { code: "2841", label: "Amortissements du matériel et outillage" },
  { code: "2844", label: "Amortissements du matériel de bureau" },
  { code: "2845", label: "Amortissements du matériel de transport" },

  // Classe 3 — stocks
  { code: "311", label: "Marchandises" },
  { code: "321", label: "Matières premières" },

  // Classe 4 — tiers
  { code: "401", label: "Fournisseurs" },
  { code: "409", label: "Fournisseurs, avances versées" },
  { code: "411", label: "Clients" },
  { code: "419", label: "Clients créditeurs (avances reçues)" },
  { code: "421", label: "Personnel, rémunérations dues" },
  { code: "431", label: "Sécurité sociale (CNPS)" },
  { code: "4431", label: "TVA facturée sur ventes" },
  { code: "4441", label: "État, TVA due" },
  { code: "4449", label: "État, crédit de TVA à reporter" },
  { code: "4451", label: "TVA récupérable sur immobilisations" },
  { code: "4452", label: "TVA récupérable sur achats" },
  { code: "447", label: "État, impôts retenus à la source" },
  { code: "471", label: "Compte d'attente (à imputer)" },

  // Classe 5 — trésorerie
  { code: "521", label: "Banque" },
  { code: "531", label: "Mobile Money" },
  { code: "571", label: "Caisse" },
  { code: "585", label: "Virements de fonds" },

  // Classe 6 — charges
  { code: "601", label: "Achats de marchandises" },
  { code: "602", label: "Achats de matières premières" },
  { code: "6031", label: "Variation des stocks de marchandises" },
  { code: "604", label: "Achats stockés de matières et fournitures" },
  { code: "605", label: "Autres achats (eau, électricité, carburant)" },
  { code: "611", label: "Transports sur achats" },
  { code: "614", label: "Transports du personnel" },
  { code: "622", label: "Locations et charges locatives" },
  { code: "624", label: "Entretien et réparations" },
  { code: "625", label: "Primes d'assurance" },
  { code: "627", label: "Publicité et relations publiques" },
  { code: "628", label: "Frais de télécommunications" },
  { code: "631", label: "Frais bancaires" },
  { code: "632", label: "Honoraires" },
  { code: "641", label: "Impôts et taxes directs" },
  { code: "646", label: "Droits d'enregistrement" },
  { code: "661", label: "Rémunérations du personnel" },
  { code: "664", label: "Charges sociales" },
  { code: "671", label: "Intérêts des emprunts" },
  { code: "681", label: "Dotations aux amortissements d'exploitation" },

  // Classe 7 — produits
  { code: "701", label: "Ventes de marchandises" },
  { code: "702", label: "Ventes de produits finis" },
  { code: "706", label: "Services vendus" },
  { code: "707", label: "Produits accessoires" },
  { code: "758", label: "Produits divers" },
  { code: "771", label: "Intérêts de prêts" },

  // Classe 8 — hors activités ordinaires
  { code: "831", label: "Charges hors activités ordinaires" },
  { code: "841", label: "Produits hors activités ordinaires" },
  { code: "891", label: "Impôts sur le résultat" },
];

const PAR_CODE = new Map(PLAN.map((c) => [c.code, c]));

/// L'intitulé d'un compte, ou son code s'il n'est pas au plan — un compte
/// inconnu ne doit pas faire disparaître une ligne du grand livre.
export const intitule = (code) => PAR_CODE.get(code)?.label || `Compte ${code}`;

/// La classe d'un compte : son premier chiffre. C'est toute la logique de
/// la codification décimale, et c'est ce qui rend le plan extensible sans
/// toucher aux calculs.
export const classeDe = (code) => Number(String(code).charAt(0)) || 0;

// ---------------------------------------------------------------------------
// Écritures
// ---------------------------------------------------------------------------
//
// Une écriture = une date, un libellé, et des lignes { compte, debit,
// credit }. Le journal ne connaît rien d'autre : tout le reste — soldes,
// balance, résultat, bilan — s'en déduit.

/// Somme des débits et des crédits d'une écriture.
export const totauxEcriture = (ecriture) => {
  let debit = 0;
  let credit = 0;
  for (const l of ecriture?.lignes || []) {
    debit += Number(l.debit) || 0;
    credit += Number(l.credit) || 0;
  }
  return { debit, credit, ecart: debit - credit };
};

/// Une écriture équilibrée : autant au débit qu'au crédit.
///
/// La tolérance d'un centime absorbe les arrondis de TVA — sur une facture
/// à plusieurs taux, la somme des taxes arrondies ligne à ligne peut
/// différer du total arrondi. Refuser l'écriture pour un franc bloquerait
/// l'utilisateur sur une erreur qui n'est pas la sienne.
export const equilibree = (ecriture) => Math.abs(totauxEcriture(ecriture).ecart) < 1;

/// Ce qui empêche d'enregistrer, en clair. Liste vide = bon pour le journal.
export const problemes = (ecriture, { clotureAu } = {}) => {
  const out = [];
  if (!ecriture?.date) out.push("La date manque.");
  if (ecriture?.date && clotureAu && String(ecriture.date) <= clotureAu) {
    out.push(
      `La période est close jusqu'au ${clotureAu} : choisissez une date postérieure.`,
    );
  }
  if (!ecriture?.libelle?.trim()) out.push("Le libellé manque.");

  const lignes = (ecriture?.lignes || []).filter(
    (l) => l.compte && ((Number(l.debit) || 0) !== 0 || (Number(l.credit) || 0) !== 0),
  );
  if (lignes.length < 2) out.push("Une écriture demande au moins deux lignes.");

  for (const l of lignes) {
    if ((Number(l.debit) || 0) !== 0 && (Number(l.credit) || 0) !== 0) {
      out.push(`Le compte ${l.compte} porte un débit et un crédit à la fois.`);
    }
  }

  const { debit, credit, ecart } = totauxEcriture({ lignes });
  if (lignes.length >= 2 && Math.abs(ecart) >= 1) {
    out.push(
      `Débit ${Math.round(debit)} et crédit ${Math.round(credit)} : il manque ${Math.abs(Math.round(ecart))} d'un côté.`,
    );
  }
  return out;
};

// ---------------------------------------------------------------------------
// Modèles d'opération
// ---------------------------------------------------------------------------
//
// Le cœur de la promesse : une phrase que l'utilisateur reconnaît, et les
// comptes qui vont avec. `debit` et `credit` sont des numéros de compte ;
// `tva` indique qu'une ligne de taxe s'ajoute, et de quel côté.
//
// `tresorerie: true` fait proposer le choix entre caisse, banque et mobile
// money — en Afrique de l'Ouest, le mobile money n'est pas un cas
// particulier, c'est souvent le moyen principal.

export const MODELES = [
  {
    id: "vente-comptant",
    phrase: "J'ai vendu et encaissé tout de suite",
    famille: "Recettes",
    debit: "571",
    credit: "701",
    tva: "collectee",
    tresorerie: "debit",
  },
  {
    id: "prestation-comptant",
    phrase: "J'ai été payé pour une prestation",
    famille: "Recettes",
    debit: "571",
    credit: "706",
    tva: "collectee",
    tresorerie: "debit",
  },
  {
    id: "encaissement-client",
    phrase: "Un client m'a réglé une facture",
    famille: "Recettes",
    debit: "571",
    credit: "411",
    tresorerie: "debit",
    aide: "La vente a déjà été comptabilisée à l'émission de la facture : ici, seule la créance s'éteint.",
  },
  {
    id: "achat-marchandises",
    phrase: "J'ai acheté des marchandises à revendre",
    famille: "Achats",
    debit: "601",
    credit: "401",
    tva: "deductible",
  },
  {
    id: "achat-comptant",
    phrase: "J'ai acheté et payé sur-le-champ",
    famille: "Achats",
    debit: "601",
    credit: "571",
    tva: "deductible",
    tresorerie: "credit",
  },
  {
    id: "reglement-fournisseur",
    phrase: "J'ai payé un fournisseur",
    famille: "Achats",
    debit: "401",
    credit: "571",
    tresorerie: "credit",
  },
  {
    id: "loyer",
    phrase: "J'ai payé le loyer",
    famille: "Charges courantes",
    debit: "622",
    credit: "571",
    tva: "deductible",
    tresorerie: "credit",
  },
  {
    id: "electricite",
    phrase: "J'ai payé l'électricité, l'eau ou le carburant",
    famille: "Charges courantes",
    debit: "605",
    credit: "571",
    tva: "deductible",
    tresorerie: "credit",
  },
  {
    id: "telephone",
    phrase: "J'ai payé le téléphone ou la connexion",
    famille: "Charges courantes",
    debit: "628",
    credit: "571",
    tva: "deductible",
    tresorerie: "credit",
  },
  {
    id: "transport",
    phrase: "J'ai payé un transport",
    famille: "Charges courantes",
    debit: "611",
    credit: "571",
    tresorerie: "credit",
  },
  {
    id: "salaires",
    phrase: "J'ai payé les salaires",
    famille: "Personnel",
    debit: "661",
    credit: "571",
    tresorerie: "credit",
    aide: "Les cotisations CNPS se saisissent à part, avec le modèle « charges sociales ».",
  },
  {
    id: "cnps",
    phrase: "J'ai payé les cotisations CNPS",
    famille: "Personnel",
    debit: "664",
    credit: "571",
    tresorerie: "credit",
  },
  {
    id: "frais-bancaires",
    phrase: "La banque a prélevé des frais",
    famille: "Charges courantes",
    debit: "631",
    credit: "521",
  },
  {
    id: "materiel",
    phrase: "J'ai acheté du matériel qui va durer",
    famille: "Investissement",
    debit: "241",
    credit: "571",
    tva: "immobilisation",
    tresorerie: "credit",
    aide: "Un bien qui sert plusieurs années n'est pas une charge : il s'amortit.",
  },
  {
    id: "apport",
    phrase: "J'ai mis de l'argent dans l'entreprise",
    famille: "Financement",
    debit: "571",
    credit: "101",
    tresorerie: "debit",
  },
  {
    id: "emprunt",
    phrase: "J'ai reçu un prêt",
    famille: "Financement",
    debit: "521",
    credit: "162",
  },
  {
    id: "impots",
    phrase: "J'ai payé un impôt ou une taxe",
    famille: "Charges courantes",
    debit: "641",
    credit: "571",
    tresorerie: "credit",
  },
];

/// Comptes de trésorerie proposés par les modèles.
export const TRESORERIE = [
  { code: "571", label: "Caisse" },
  { code: "585", label: "Virements de fonds" },
  { code: "521", label: "Banque" },
  { code: "531", label: "Mobile Money" },
];

/// Taux de TVA en vigueur en Côte d'Ivoire. Le taux normal est de 18 % ;
/// certaines opérations sont exonérées.
export const TAUX_TVA = [18, 9, 0];

/// Construit l'écriture d'un modèle.
///
/// `montant` est ce que l'utilisateur a réellement payé ou reçu, taxe
/// comprise — c'est le chiffre qu'il a sous les yeux sur le reçu. On en
/// déduit le hors-taxe, jamais l'inverse : demander un montant HT à
/// quelqu'un qui lit un ticket de caisse, c'est lui demander de faire le
/// calcul à notre place.
export const ecritureDepuisModele = ({
  modele,
  montant,
  date,
  libelle,
  taux = 18,
  compteTresorerie,
  tiers,
  piece,
  axe,
}) => {
  const ttc = Number(montant) || 0;
  const t = modele.tva ? Number(taux) || 0 : 0;
  const ht = t ? ttc / (1 + t / 100) : ttc;
  const tva = ttc - ht;

  const arrondi = (n) => Math.round(n);

  // Le compte de trésorerie choisi remplace celui du modèle, du bon côté.
  const debit =
    modele.tresorerie === "debit" && compteTresorerie ? compteTresorerie : modele.debit;
  const credit =
    modele.tresorerie === "credit" && compteTresorerie
      ? compteTresorerie
      : modele.credit;

  const lignes = [];
  const compteTva =
    modele.tva === "collectee"
      ? "4431"
      : modele.tva === "immobilisation"
        ? "4451"
        : "4452";

  if (modele.tva === "collectee") {
    // Encaissement au débit pour le TTC ; la vente au crédit pour le HT,
    // la taxe au crédit pour le reste — elle appartient à l'État.
    lignes.push({ compte: debit, debit: arrondi(ttc), credit: 0 });
    lignes.push({ compte: credit, debit: 0, credit: arrondi(ht) });
    if (tva >= 1) lignes.push({ compte: compteTva, debit: 0, credit: arrondi(tva) });
  } else if (modele.tva) {
    // Achat : la charge au débit pour le HT, la TVA récupérable au débit,
    // et la contrepartie au crédit pour le TTC.
    lignes.push({ compte: debit, debit: arrondi(ht), credit: 0 });
    if (tva >= 1) lignes.push({ compte: compteTva, debit: arrondi(tva), credit: 0 });
    lignes.push({ compte: credit, debit: 0, credit: arrondi(ttc) });
  } else {
    lignes.push({ compte: debit, debit: arrondi(ttc), credit: 0 });
    lignes.push({ compte: credit, debit: 0, credit: arrondi(ttc) });
  }

  // L'arrondi de chaque ligne peut décaler le total d'une unité : on le
  // rattrape sur la contrepartie, qui est la ligne « reste ».
  const { ecart } = totauxEcriture({ lignes });
  if (ecart !== 0) {
    const cible = modele.tva === "collectee" ? lignes[1] : lignes[lignes.length - 1];
    if (cible.credit) cible.credit += ecart;
    else cible.debit -= ecart;
  }

  return {
    date,
    libelle: libelle?.trim() || modele.phrase,
    modele: modele.id,
    tiers: tiers || "",
    piece: piece || "",
    axe: axe || "",
    lignes,
  };
};

// ---------------------------------------------------------------------------
// Reprise de la Facturation
// ---------------------------------------------------------------------------

/// Écritures que la Facturation justifie, mais qui ne sont pas encore au
/// journal.
///
/// Deux faits comptables distincts, souvent confondus :
///
///   - **la facture émise** crée la créance et la TVA due, à sa date
///     d'émission, qu'elle soit payée ou non ;
///   - **le règlement** éteint la créance, à sa date d'encaissement.
///
/// Les comptabiliser séparément est ce qui permet à la balance âgée d'être
/// juste et à la TVA de tomber au bon mois. `origine` marque la source
/// pour ne jamais compter deux fois la même pièce.
export const ecrituresSuggerees = ({
  documents = [],
  reglements = [],
  // Tickets de la Caisse, et la fonction qui en fait une écriture — elle
  // vit dans le domaine de la Caisse, qui seul connaît la forme d'un
  // ticket. La passer en paramètre évite un import croisé entre domaines.
  tickets = [],
  ecritureTicket,
  // Propositions déjà construites par un autre module (les Achats font les
  // leurs avec leur propre domaine). Chacune porte son `origine` ; seul le
  // filtre anti-doublon est appliqué ici.
  propositions = [],
  ecritures = [],
  totauxDe,
}) => {
  const deja = new Set(
    ecritures.map((e) => e.data?.origine).filter(Boolean),
  );
  const out = [];

  for (const doc of documents) {
    const d = doc.data || {};
    // Un devis n'est pas une pièce comptable : il n'engage rien tant qu'il
    // n'est pas devenu facture.
    if (d.type !== "facture" && d.type !== "avoir") continue;
    if (d.statut === "brouillon" || d.statut === "annule") continue;

    const origine = `facture:${doc.id}`;
    if (deja.has(origine)) continue;

    const t = totauxDe(d);
    if (!t.ttc) continue;

    // Un avoir est une facture en sens inverse : mêmes comptes, montants
    // négatifs. On ne « supprime » jamais une facture émise.
    const signe = d.type === "avoir" ? -1 : 1;
    const r = (n) => Math.round(n * signe);

    const lignes = [{ compte: "411", debit: r(t.ttc), credit: 0 }];
    // Le produit va en 701 ou 706 selon la nature ; à défaut d'information
    // fiable sur les lignes, on retient les services, cas le plus fréquent
    // d'une facture qui n'a pas de rattachement au stock.
    lignes.push({ compte: d.compteProduit || "706", debit: 0, credit: r(t.ht) });
    if (Math.abs(t.tva) >= 1) {
      lignes.push({ compte: "4431", debit: 0, credit: r(t.tva) });
    }

    out.push({
      origine,
      // La pièce est le numéro de facture, porté à l'identique par la
      // facture et par ses règlements : c'est ce qui rapproche les deux
      // sans que personne n'ait à lettrer à la main.
      piece: d.numero || origine,
      date: d.date || d.emission,
      libelle: `${d.type === "avoir" ? "Avoir" : "Facture"} ${d.numero || ""} — ${d.clientNom || d.client || "client"}`.trim(),
      tiers: d.clientNom || d.clientEntreprise || d.client || "",
      echeance: d.echeance || "",
      journal: "VTE",
      lignes,
      source: "Facturation",
    });
  }

  const parMoyen = {
    Espèces: "571",
    "Mobile Money": "531",
    Virement: "521",
    Chèque: "521",
    "Carte bancaire": "521",
  };

  for (const reg of reglements) {
    const d = reg.data || {};
    const origine = `reglement:${reg.id}`;
    if (deja.has(origine)) continue;

    const montant = Math.round(Number(d.montant) || 0);
    if (!montant) continue;

    const doc = documents.find((x) => x.id === d.documentId);
    const numero = doc?.data?.numero ? ` ${doc.data.numero}` : "";

    out.push({
      origine,
      piece: doc?.data?.numero || origine,
      date: d.date,
      libelle: `Règlement${numero}${d.moyen ? ` (${d.moyen})` : ""}`,
      tiers: doc?.data?.clientNom || doc?.data?.clientEntreprise || "",
      journal: { Espèces: "CAI", "Mobile Money": "MM" }[d.moyen] || "BQ",
      lignes: [
        { compte: parMoyen[d.moyen] || "571", debit: montant, credit: 0 },
        { compte: "411", debit: 0, credit: montant },
      ],
      source: "Facturation",
    });
  }

  if (ecritureTicket) {
    for (const t of tickets) {
      const d = t.data || {};
      if (d.annule) continue;
      const numero = d.numero || t.id;
      const origine = `caisse:${numero}`;
      if (deja.has(origine)) continue;
      const e = ecritureTicket(d, numero);
      if (e?.lignes?.length) out.push({ journal: "CAI", ...e, origine, source: "Caisse" });
    }
  }

  for (const p of propositions) {
    if (p?.origine && !deja.has(p.origine) && p.lignes?.length) out.push(p);
  }

  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
};

// ---------------------------------------------------------------------------
// Restitutions
// ---------------------------------------------------------------------------

const dansPeriode = (date, { du, au } = {}) => {
  if (du && String(date) < du) return false;
  if (au && String(date) > au) return false;
  return true;
};

/// Toutes les lignes du journal, à plat, filtrées sur le contexte.
///
/// `contexte` porte la période **et** l'axe analytique. Les deux filtrent
/// au même endroit, si bien que tout ce qui se dérive du journal — balance,
/// résultat, bilan, TVA — respecte l'axe sans que chaque fonction ait à le
/// savoir. C'est le principe du journal unique : une seule table de lignes,
/// et des restitutions qui n'en sont que des agrégations.
export const lignesDe = (ecritures, contexte) => {
  const axe = contexte?.axe;
  const out = [];
  for (const e of ecritures) {
    const d = e.data || e;
    if (!dansPeriode(d.date, contexte)) continue;
    if (axe && d.axe !== axe) continue;
    for (const l of d.lignes || []) {
      out.push({
        ...l,
        date: d.date,
        libelle: d.libelle,
        tiers: d.tiers,
        piece: d.piece || d.origine || "",
        axe: d.axe || "",
        ecritureId: e.id,
        origine: d.origine || "",
      });
    }
  }
  return out;
};

/// Les axes analytiques réellement utilisés — la liste se déduit du
/// journal, elle ne se paramètre pas. Un axe qui n'a jamais servi n'a
/// aucune raison d'encombrer un menu.
export const axes = (ecritures) => {
  const vus = new Set();
  for (const e of ecritures) {
    const a = (e.data || e).axe;
    if (a) vus.add(a);
  }
  return [...vus].sort((a, b) => a.localeCompare(b, "fr"));
};

/// Balance : par compte, le total des débits, des crédits, et le solde.
export const balance = (ecritures, periode) => {
  const parCompte = new Map();
  for (const l of lignesDe(ecritures, periode)) {
    const c = parCompte.get(l.compte) || { compte: l.compte, debit: 0, credit: 0 };
    c.debit += Number(l.debit) || 0;
    c.credit += Number(l.credit) || 0;
    parCompte.set(l.compte, c);
  }
  return [...parCompte.values()]
    .map((c) => ({
      ...c,
      label: intitule(c.compte),
      classe: classeDe(c.compte),
      solde: c.debit - c.credit,
    }))
    .sort((a, b) => a.compte.localeCompare(b.compte));
};

/// Grand livre d'un compte : ses lignes, avec le solde qui court.
export const grandLivre = (ecritures, compte, periode) => {
  const lignes = lignesDe(ecritures, periode)
    .filter((l) => l.compte === compte)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  let solde = 0;
  return lignes.map((l) => {
    solde += (Number(l.debit) || 0) - (Number(l.credit) || 0);
    return { ...l, solde };
  });
};

/// Compte de résultat : produits (classe 7) moins charges (classe 6).
///
/// Le résultat n'est pas un compte qu'on alimente, c'est une différence
/// qu'on constate. L'écrire à la main serait le meilleur moyen de le voir
/// diverger du reste.
export const compteDeResultat = (ecritures, periode) => {
  const b = balance(ecritures, periode);

  const charges = b
    .filter((c) => c.classe === 6)
    .map((c) => ({ ...c, montant: c.debit - c.credit }))
    .filter((c) => c.montant !== 0);
  const produits = b
    .filter((c) => c.classe === 7)
    .map((c) => ({ ...c, montant: c.credit - c.debit }))
    .filter((c) => c.montant !== 0);

  const totalCharges = charges.reduce((s, c) => s + c.montant, 0);
  const totalProduits = produits.reduce((s, c) => s + c.montant, 0);

  return {
    charges,
    produits,
    totalCharges,
    totalProduits,
    resultat: totalProduits - totalCharges,
  };
};

/// Bilan : ce que l'entreprise possède, face à ce qu'elle doit.
///
/// Le résultat de l'exercice figure au passif : il appartient aux
/// propriétaires. Sans lui, le bilan ne s'équilibre pas — et c'est
/// précisément ce déséquilibre qui trahit une erreur de saisie.
export const bilan = (ecritures, periode) => {
  const b = balance(ecritures, periode);
  const { resultat } = compteDeResultat(ecritures, periode);

  const actif = [];
  const passif = [];

  for (const c of b) {
    if (c.classe >= 6) continue; // gestion : c'est le compte de résultat
    if (c.solde === 0) continue;

    // Les classes 4 et 5 vont d'un côté ou de l'autre selon leur solde :
    // un compte client débiteur est une créance, créditeur c'est une
    // avance reçue. Le sens ne se décrète pas, il se lit.
    if (c.solde > 0) actif.push({ ...c, montant: c.solde });
    else passif.push({ ...c, montant: -c.solde });
  }

  const totalActif = actif.reduce((s, c) => s + c.montant, 0);
  const totalPassifHorsResultat = passif.reduce((s, c) => s + c.montant, 0);

  return {
    actif,
    passif,
    resultat,
    totalActif,
    totalPassif: totalPassifHorsResultat + resultat,
    equilibre: Math.abs(totalActif - (totalPassifHorsResultat + resultat)) < 1,
  };
};

/// Déclaration de TVA de la période.
///
/// En Côte d'Ivoire, la déclaration mensuelle (CA02) se dépose avant le 15
/// du mois suivant. Le solde est ce qu'il reste à verser à l'État : la TVA
/// facturée aux clients, moins celle déjà payée aux fournisseurs. Négatif,
/// c'est un crédit reportable — pas un remboursement automatique.
export const tva = (ecritures, periode) => {
  // L'écriture de liquidation solde 4431 et 4452 vers 4441 : la compter
  // effacerait la TVA du mois qu'elle sert justement à déclarer.
  const b = balance(
    ecritures.filter((e) => !String((e.data || e).origine || "").startsWith("tva:")),
    periode,
  );
  const solde = (code) => b.find((c) => c.compte === code) || { debit: 0, credit: 0 };

  const collectee = solde("4431").credit - solde("4431").debit;
  const deductible =
    solde("4452").debit - solde("4452").credit + (solde("4451").debit - solde("4451").credit);

  return {
    collectee,
    deductible,
    aPayer: Math.max(0, collectee - deductible),
    credit: Math.max(0, deductible - collectee),
  };
};

/// Trésorerie disponible : le solde des comptes de classe 5.
export const tresorerie = (ecritures, periode) => {
  const b = balance(ecritures, periode);
  const comptes = b.filter((c) => c.classe === 5);
  return {
    comptes: comptes.map((c) => ({ ...c, montant: c.solde })),
    total: comptes.reduce((s, c) => s + c.solde, 0),
  };
};

// ---------------------------------------------------------------------------
// Postes ouverts
// ---------------------------------------------------------------------------
//
// Un compte de tiers ne se lit pas par son solde. « Clients : 3 200 000 F »
// ne dit ni qui doit, ni depuis quand, ni sur quelle facture — c'est
// pourtant la seule question qui compte quand on relance.
//
// La réponse est la gestion en postes ouverts : chaque ligne d'un compte de
// tiers porte sa pièce d'origine, et un poste est « soldé » quand ses
// débits et ses crédits s'annulent. Ce qui reste est exactement ce qu'on
// attend ou ce qu'on doit — non pas estimé, mais constaté.
//
// Le rapprochement se fait ici par la pièce plutôt qu'à la main : la
// reprise de la Facturation pose déjà le même numéro sur la facture et sur
// ses règlements, donc le lettrage est acquis sans que personne ne le
// fasse. Un règlement saisi à part reste non affecté, et se voit.

/// Postes d'un compte de tiers, regroupés par pièce.
///
/// `seuil` absorbe les arrondis : un reliquat d'un franc n'est pas une
/// créance, c'est une erreur de centime qu'on ne va pas relancer.
export const postesOuverts = (
  ecritures,
  compte,
  contexte,
  { seuil = 1, lettres = null } = {},
) => {
  const parPiece = new Map();

  for (const l of lignesDeTiers(ecritures, compte, contexte)) {
    // Un lettrage manuel complet rassemble ses lignes sous sa lettre : elles
    // s'annulent et le poste disparaît. Sinon, sans pièce, la ligne forme
    // son propre poste : elle ne peut se rapprocher de rien, et c'est une
    // information en soi.
    const lettre = lettres?.get(l.cle);
    const cle = lettre ? `lettre:${lettre}` : l.piece || `ligne:${l.ecritureId}`;
    const p = parPiece.get(cle) || {
      piece: l.piece || "",
      tiers: l.tiers || "",
      libelle: l.libelle || "",
      date: l.date,
      echeance: l.echeance || "",
      debit: 0,
      credit: 0,
      lignes: [],
    };
    p.debit += Number(l.debit) || 0;
    p.credit += Number(l.credit) || 0;
    p.lignes.push(l);
    // Le poste se présente sous sa pièce d'origine — la facture — et non
    // sous son dernier mouvement. Sans cela, une créance s'affiche sous le
    // libellé du règlement partiel qui l'a réduite, ce qui est exactement
    // l'inverse de ce qu'on cherche à lire. La date suit la même règle :
    // c'est depuis l'émission qu'on compte les jours.
    if (String(l.date) < String(p.date)) {
      p.date = l.date;
      p.libelle = l.libelle || p.libelle;
      if (l.echeance) p.echeance = l.echeance;
    }
    if (!p.echeance && l.echeance) p.echeance = l.echeance;
    if (!p.tiers && l.tiers) p.tiers = l.tiers;
    parPiece.set(cle, p);
  }

  return [...parPiece.values()]
    .map((p) => ({ ...p, solde: p.debit - p.credit }))
    .filter((p) => Math.abs(p.solde) >= seuil)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
};

/// Les lignes d'un compte de tiers, chacune avec sa clé stable
/// « écriture#rang » — c'est elle que le lettrage manuel désigne.
export const lignesDeTiers = (ecritures, compte, contexte) => {
  const out = [];
  for (const e of ecritures) {
    const d = e.data || e;
    if (!dansPeriode(d.date, contexte)) continue;
    if (contexte?.axe && d.axe !== contexte.axe) continue;
    (d.lignes || []).forEach((l, rang) => {
      if (l.compte !== compte) return;
      out.push({
        ...l,
        cle: `${e.id}#${rang}`,
        date: d.date,
        libelle: l.libelle || d.libelle,
        tiers: l.tiers || d.tiers || "",
        piece: d.piece || d.origine || "",
        numero: d.numero || "",
        echeance: d.echeance || "",
        journal: d.journal || "",
        ecritureId: e.id,
        origine: d.origine || "",
      });
    });
  }
  return out;
};

/// Ce que doivent les clients, par tiers, avec l'ancienneté.
///
/// Les tranches sont celles qu'utilise le recouvrement : à jour, puis 30,
/// 60, 90 jours et au-delà. Passé 90 jours, une créance change de nature —
/// on ne relance plus, on provisionne.
export const balanceAgee = (ecritures, compte, contexte, maintenant, lettres, echeances) => {
  const jour = maintenant || new Date().toISOString().slice(0, 10);
  const jours = (d) =>
    Math.floor((new Date(jour) - new Date(d)) / 86400000);

  const parTiers = new Map();
  for (const p of postesOuverts(ecritures, compte, contexte, { lettres })) {
    const nom = p.tiers || "Sans tiers";
    const t = parTiers.get(nom) || {
      tiers: nom,
      total: 0,
      aJour: 0,
      j30: 0,
      j60: 0,
      j90: 0,
      plus: 0,
      postes: [],
    };
    // L'ancienneté se compte depuis l'échéance quand la pièce en porte une :
    // une facture à 30 jours n'est pas « en retard » le lendemain de son
    // émission. À défaut, depuis la date de la pièce.
    // `echeances` (pièce → date) complète les écritures passées avant que
    // l'échéance ne soit reprise : la Facturation la connaît toujours.
    const age = jours(p.echeance || echeances?.get(p.piece) || p.date);
    const m = p.solde;
    t.total += m;
    if (age <= 0) t.aJour += m;
    else if (age <= 30) t.j30 += m;
    else if (age <= 60) t.j60 += m;
    else if (age <= 90) t.j90 += m;
    else t.plus += m;
    t.postes.push({ ...p, age });
    parTiers.set(nom, t);
  }

  return [...parTiers.values()].sort((a, b) => b.total - a.total);
};

// ---------------------------------------------------------------------------
// Clôture
// ---------------------------------------------------------------------------

/// Une période close n'accepte plus d'écriture.
///
/// Sans ce verrou, une écriture antidatée tombe dans un mois dont la TVA
/// est déjà déclarée : les livres cessent alors de correspondre à ce qui a
/// été déposé, et personne ne s'en aperçoit avant le contrôle. La clôture
/// n'efface rien et ne bloque pas le mois courant — elle empêche seulement
/// de réécrire le passé.
export const estClos = (date, clotureAu) => !!clotureAu && String(date) <= clotureAu;

/// Le journal ne s'équilibre-t-il pas ? Alors une écriture est fausse, et
/// tout le reste l'est aussi. Ce contrôle mérite d'être visible en
/// permanence, pas caché dans un rapport.
export const controle = (ecritures) => {
  const l = lignesDe(ecritures);
  const debit = l.reduce((s, x) => s + (Number(x.debit) || 0), 0);
  const credit = l.reduce((s, x) => s + (Number(x.credit) || 0), 0);
  return { debit, credit, ecart: debit - credit, equilibre: Math.abs(debit - credit) < 1 };
};

/// Montant lisible, dans la devise d'affichage de l'espace.
export { montant as fcfa } from "../../../utils/monnaie.js";

/// Le premier et le dernier jour d'un mois, au format ISO.
export const mois = (aaaaMm) => ({
  du: `${aaaaMm}-01`,
  au: new Date(Number(aaaaMm.slice(0, 4)), Number(aaaaMm.slice(5, 7)), 0)
    .toISOString()
    .slice(0, 10),
});

/// L'exercice comptable d'une année : du 1er janvier au 31 décembre.
export const exercice = (annee) => ({ du: `${annee}-01-01`, au: `${annee}-12-31` });

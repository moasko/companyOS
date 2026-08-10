// Règles des ressources humaines, en fonctions pures.
//
// Rien ici ne connaît React ni l'API : on entre des enregistrements, on
// sort des jours, des soldes et des montants. C'est ce qui permet de
// vérifier un solde de congés sans ouvrir l'écran — et un solde faux est
// la première chose qu'un salarié remarque.
//
// AVERTISSEMENT SUR LE DROIT DU TRAVAIL
//
// Les valeurs par défaut suivent l'usage le plus répandu en Afrique de
// l'Ouest (2,2 jours ouvrables acquis par mois de service effectif, semaine
// de six jours ouvrables). Elles sont **paramétrables**, et doivent l'être :
// une convention collective, un accord d'entreprise ou une autre juridiction
// changent la règle. Ce fichier calcule, il ne dit pas le droit.

export const TYPES_CONTRAT = {
  cdi: { label: "CDI", duree: false },
  cdd: { label: "CDD", duree: true },
  stage: { label: "Stage", duree: true },
  essai: { label: "Période d'essai", duree: true },
  prestation: { label: "Prestation", duree: true },
};

export const STATUTS = {
  actif: { label: "Actif", ton: "ok" },
  suspendu: { label: "Suspendu", ton: "warn" },
  sorti: { label: "Sorti des effectifs", ton: "idle" },
};

/// Types d'absence. `decompte` dit si l'absence retire des jours du solde
/// de congés payés : une maladie ou une maternité n'en retirent pas.
export const TYPES_ABSENCE = {
  conge: { label: "Congé payé", decompte: true, ton: "info", icone: "faUmbrellaBeach" },
  maladie: { label: "Maladie", decompte: false, ton: "warn", icone: "faBriefcaseMedical" },
  maternite: { label: "Maternité", decompte: false, ton: "info", icone: "faBabyCarriage" },
  permission: { label: "Permission", decompte: false, ton: "idle", icone: "faPersonWalkingArrowRight" },
  sansSolde: { label: "Sans solde", decompte: false, ton: "idle", icone: "faMoneyBillWave" },
  injustifiee: { label: "Absence injustifiée", decompte: false, ton: "bad", icone: "faTriangleExclamation" },
};

export const ETATS_DEMANDE = {
  demande: { label: "En attente", ton: "warn" },
  approuve: { label: "Approuvé", ton: "ok" },
  refuse: { label: "Refusé", ton: "bad" },
};

/// Réglages par défaut. Modifiables dans l'application, et enregistrés avec
/// les données de l'espace de travail.
export const REGLAGES_DEFAUT = {
  /// Jours ouvrables acquis par mois de service effectif.
  acquisParMois: 2.2,
  /// Jours de la semaine ouvrables. 0 = dimanche. Par défaut, la semaine de
  /// six jours : le dimanche seul est chômé.
  joursOuvres: [1, 2, 3, 4, 5, 6],
  /// Jours fériés, au format AAAA-MM-JJ. Volontairement vide : ils changent
  /// chaque année et selon le pays, les inventer serait pire que rien.
  feries: [],
};

export const today = () => new Date().toISOString().slice(0, 10);

const jour = (iso) => new Date(`${iso}T00:00:00Z`);

/// Nombre de jours ouvrables entre deux dates, bornes comprises.
///
/// Compter les jours calendaires ferait perdre un jour de congé au salarié
/// chaque fois que sa période couvre un dimanche — l'erreur se voit tout de
/// suite sur une paie.
export const joursOuvrables = (du, au, reglages = REGLAGES_DEFAUT) => {
  if (!du || !au) return 0;
  const debut = jour(du);
  const fin = jour(au);
  if (fin < debut) return 0;

  const ouvres = new Set(reglages.joursOuvres || REGLAGES_DEFAUT.joursOuvres);
  const feries = new Set(reglages.feries || []);

  let total = 0;
  for (let d = new Date(debut); d <= fin; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (ouvres.has(d.getUTCDay()) && !feries.has(iso)) total += 1;
  }
  return total;
};

/// Ancienneté en mois pleins.
export const ancienneteMois = (dateEmbauche, maintenant = today()) => {
  if (!dateEmbauche) return 0;
  const a = jour(dateEmbauche);
  const b = jour(maintenant);
  if (b < a) return 0;
  let mois =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth());
  // Le mois n'est plein que si le jour du mois est atteint : embauché le 20,
  // on n'a pas un mois d'ancienneté le 5 du mois suivant.
  if (b.getUTCDate() < a.getUTCDate()) mois -= 1;
  return Math.max(0, mois);
};

export const ancienneteTexte = (dateEmbauche, maintenant = today()) => {
  const mois = ancienneteMois(dateEmbauche, maintenant);
  const ans = Math.floor(mois / 12);
  const reste = mois % 12;
  if (!ans) return `${reste} mois`;
  if (!reste) return `${ans} an${ans > 1 ? "s" : ""}`;
  return `${ans} an${ans > 1 ? "s" : ""} et ${reste} mois`;
};

// ---------------------------------------------------------------------------
// Congés
// ---------------------------------------------------------------------------

/// Les absences d'un salarié qui pèsent sur son solde : congés payés,
/// approuvés. Une demande en attente ne se déduit pas — elle peut être
/// refusée — mais elle est *engagée*, et c'est une autre notion.
const congesDecomptes = (salarieId, absences, etats = ["approuve"]) =>
  absences.filter(
    (a) =>
      a.data.salarieId === salarieId &&
      TYPES_ABSENCE[a.data.type]?.decompte &&
      etats.includes(a.data.etat),
  );

/// Solde de congés d'un salarié.
///
/// Acquis = ancienneté en mois × taux, plus un éventuel report de l'année
/// précédente saisi sur la fiche. Pris = jours ouvrables des congés payés
/// approuvés. « Engagé » compte en plus les demandes en attente : c'est ce
/// qu'il faut regarder avant d'en approuver une nouvelle.
export const soldeConges = (salarie, absences, reglages = REGLAGES_DEFAUT, maintenant = today()) => {
  const mois = ancienneteMois(salarie.data.dateEmbauche, maintenant);
  const taux = Number(reglages.acquisParMois) || REGLAGES_DEFAUT.acquisParMois;
  const report = Number(salarie.data.reportConges) || 0;

  const acquis = Math.round((mois * taux + report) * 10) / 10;

  const compter = (etats) =>
    congesDecomptes(salarie.id, absences, etats).reduce(
      (s, a) => s + joursOuvrables(a.data.du, a.data.au, reglages),
      0,
    );

  const pris = compter(["approuve"]);
  const enAttente = compter(["demande"]);

  return {
    acquis,
    pris,
    enAttente,
    solde: Math.round((acquis - pris) * 10) / 10,
    // Ce qui resterait si tout ce qui est demandé était accordé.
    disponible: Math.round((acquis - pris - enAttente) * 10) / 10,
  };
};

/// Deux absences se chevauchent-elles ? Sert à refuser deux congés sur les
/// mêmes dates pour la même personne, faute de quoi le solde se déduit deux
/// fois pour une seule absence réelle.
export const chevauche = (a, b) =>
  a.du <= b.data.au && b.data.du <= a.au;

export const chevauchements = (demande, absences, ignorerId = null) =>
  absences.filter(
    (a) =>
      a.id !== ignorerId &&
      a.data.salarieId === demande.salarieId &&
      a.data.etat !== "refuse" &&
      chevauche(demande, a),
  );

/// Qui est absent à une date donnée — la question qu'on pose le matin.
export const absentsLe = (date, absences, salaries) =>
  absences
    .filter(
      (a) => a.data.etat === "approuve" && a.data.du <= date && date <= a.data.au,
    )
    .map((a) => ({
      absence: a,
      salarie: salaries.find((s) => s.id === a.data.salarieId) || null,
    }))
    .filter((x) => x.salarie);

// ---------------------------------------------------------------------------
// Contrats
// ---------------------------------------------------------------------------

/// Contrats à durée déterminée qui arrivent à échéance.
///
/// Laisser expirer un CDD sans décision le requalifie souvent en CDI : c'est
/// la première alerte qu'un service RH veut voir.
export const contratsAEcheance = (salaries, jours = 60, maintenant = today()) => {
  const limite = new Date(jour(maintenant));
  limite.setUTCDate(limite.getUTCDate() + jours);
  const limiteIso = limite.toISOString().slice(0, 10);

  return salaries
    .filter(
      (s) =>
        s.data.statut === "actif" &&
        TYPES_CONTRAT[s.data.typeContrat]?.duree &&
        s.data.dateFin &&
        s.data.dateFin <= limiteIso,
    )
    .map((s) => ({
      salarie: s,
      jours: Math.round(
        (jour(s.data.dateFin) - jour(maintenant)) / 86400000,
      ),
    }))
    .sort((a, b) => a.jours - b.jours);
};

// ---------------------------------------------------------------------------
// Agrégats
// ---------------------------------------------------------------------------

export const masseSalariale = (salaries) =>
  salaries
    .filter((s) => s.data.statut === "actif")
    .reduce((total, s) => total + (Number(s.data.salaireBase) || 0), 0);

export const statistiques = (salaries, absences, reglages, maintenant = today()) => {
  const actifs = salaries.filter((s) => s.data.statut === "actif");

  return {
    effectif: actifs.length,
    total: salaries.length,
    masse: masseSalariale(salaries),
    absentsAujourdhui: absentsLe(maintenant, absences, salaries).length,
    demandesEnAttente: absences.filter((a) => a.data.etat === "demande").length,
    echeances: contratsAEcheance(salaries, 60, maintenant).length,
  };
};

/// Effectif par département, du plus fourni au moins fourni.
export const parDepartement = (salaries) => {
  const compte = new Map();
  for (const s of salaries) {
    if (s.data.statut !== "actif") continue;
    const cle = s.data.departement || "Sans département";
    const e = compte.get(cle) || { nom: cle, effectif: 0, masse: 0 };
    e.effectif += 1;
    e.masse += Number(s.data.salaireBase) || 0;
    compte.set(cle, e);
  }
  return [...compte.values()].sort((a, b) => b.effectif - a.effectif);
};

/// Répartition par ancienneté — ce qui dit si l'entreprise garde ses gens.
export const parAnciennete = (salaries, maintenant = today()) => {
  const tranches = [
    { id: "moins1", label: "Moins d'un an", max: 12, effectif: 0 },
    { id: "un3", label: "1 à 3 ans", max: 36, effectif: 0 },
    { id: "trois5", label: "3 à 5 ans", max: 60, effectif: 0 },
    { id: "plus5", label: "Plus de 5 ans", max: Infinity, effectif: 0 },
  ];

  for (const s of salaries) {
    if (s.data.statut !== "actif") continue;
    const mois = ancienneteMois(s.data.dateEmbauche, maintenant);
    const t = tranches.find((x) => mois < x.max) || tranches[tranches.length - 1];
    t.effectif += 1;
  }
  return tranches;
};

/// Matricule suivant : SAL-001, SAL-002…
///
/// On repart du plus grand numéro déjà pris, jamais du nombre de salariés :
/// après un départ, compter redonnerait un matricule déjà utilisé, et deux
/// personnes se confondraient dans l'historique de paie.
export const prochainMatricule = (salaries) => {
  const max = salaries.reduce((acc, s) => {
    const m = /^SAL-(\d+)$/.exec(s.data.matricule || "");
    return m ? Math.max(acc, Number(m[1])) : acc;
  }, 0);
  return `SAL-${String(max + 1).padStart(3, "0")}`;
};

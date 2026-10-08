// Paie — le cycle du mois, sans React.
//
// Le modèle est celui de PayFit : la paie n'est pas une liste de bulletins
// qu'on remplit un par un, c'est un **cycle** qu'on fait avancer chaque
// mois — éléments variables, contrôles, validation, paiement,
// déclarations. Chaque étape a une fin claire, et le logiciel dit ce qui
// empêche de passer à la suivante.
//
// Ce fichier calcule tout ce que le cycle affiche, à partir des données
// des autres applications : les salariés et leurs absences (RH, Congés),
// les notes de frais approuvées (Frais), les bulletins déjà établis. Rien
// n'est ressaisi.

import { bulletin, completer, finDeMois, REGLAGES_DEFAUT } from "./domaine.js";

export const ETAPES = ["variables", "controles", "validation", "paiement", "declarations"];

/// Les états d'un cycle, dans l'ordre. Un cycle sans enregistrement est en
/// préparation.
export const ETATS_CYCLE = ["preparation", "valide", "paye", "declare"];

const arrondi = (n) => Math.round(Number(n) || 0);

export const debutDeMois = (mois) => `${mois}-01`;

export const moisSuivant = (mois) => {
  const d = new Date(Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)), 1));
  return d.toISOString().slice(0, 7);
};

export const moisPrecedent = (mois) => {
  const d = new Date(Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)) - 2, 1));
  return d.toISOString().slice(0, 7);
};

/// Jours ouvrables entre deux dates incluses. La semaine ivoirienne de
/// référence compte six jours ouvrables : seul le dimanche est chômé.
export const joursOuvrables = (du, au, joursOuvres = [1, 2, 3, 4, 5, 6]) => {
  if (!du || !au || au < du) return 0;
  let n = 0;
  const d = new Date(`${du}T12:00:00Z`);
  const fin = new Date(`${au}T12:00:00Z`);
  while (d <= fin) {
    if (joursOuvres.includes(d.getUTCDay())) n += 1;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
};

const borne = (date, min, max) => (date < min ? min : date > max ? max : date);

// ---------------------------------------------------------------------------
// Ce que les autres applications apportent
// ---------------------------------------------------------------------------

/// Les absences approuvées d'un salarié qui tombent dans le mois, comptées
/// en jours ouvrables du mois seulement (un congé à cheval sur deux mois se
/// partage).
export const absencesDuMois = (absences = [], salarieId, mois) => {
  const du = debutDeMois(mois);
  const au = finDeMois(mois);
  const out = { conge: 0, maladie: 0, maternite: 0, permission: 0, sansSolde: 0, injustifiee: 0, liste: [] };
  for (const a of absences) {
    const d = a.data || a;
    if (d.salarieId !== salarieId || d.etat !== "approuve") continue;
    if (!d.du || !d.au || d.au < du || d.du > au) continue;
    const jours = joursOuvrables(borne(d.du, du, au), borne(d.au, du, au));
    if (!jours) continue;
    out[d.type] = (out[d.type] || 0) + jours;
    out.liste.push({ id: a.id, type: d.type, du: d.du, au: d.au, jours });
  }
  return out;
};

/// Les notes de frais approuvées et pas encore remboursées : elles se
/// paient avec le salaire, sans passer par l'impôt.
export const fraisARembourser = (notes = [], salarieId) => {
  const liste = notes.filter((n) => (n.data || n).salarieId === salarieId && (n.data || n).etat === "approuvee");
  return {
    total: arrondi(liste.reduce((s, n) => s + (Number((n.data || n).montant) || 0), 0)),
    ids: liste.map((n) => n.id),
  };
};

/// Entrée ou sortie dans le mois : jours ouvrables de présence sur jours
/// ouvrables du mois. Null pour un mois complet.
export const prorataDe = (salarie = {}, mois) => {
  const du = debutDeMois(mois);
  const au = finDeMois(mois);
  const debut = salarie.dateEmbauche && salarie.dateEmbauche > du ? salarie.dateEmbauche : du;
  const fin = salarie.dateFin && salarie.dateFin < au ? salarie.dateFin : au;
  if (debut === du && fin === au) return null;
  return { jours: joursOuvrables(debut, fin), sur: joursOuvrables(du, au), debut, fin };
};

/// Le moyen de paiement par défaut : le virement si la banque est connue,
/// le mobile money si un numéro l'est, les espèces sinon.
export const modeParDefaut = (salarie = {}) =>
  salarie.banque ? "virement" : salarie.telephone ? "mobile" : "especes";

/// Le salarié est-il payé ce mois-ci ? Entré avant la fin du mois, et pas
/// sorti avant son début.
export const payeLeMois = (salarie = {}, mois) => {
  if (salarie.dateEmbauche && salarie.dateEmbauche > finDeMois(mois)) return false;
  if (salarie.dateFin && salarie.dateFin < debutDeMois(mois)) return false;
  return salarie.statut !== "sorti" || (salarie.dateFin && salarie.dateFin >= debutDeMois(mois));
};

/// La saisie de départ d'un salarié pour un mois : la situation familiale
/// du dernier bulletin, les absences de Congés, les frais approuvés, le
/// prorata d'entrée ou de sortie, l'indemnité de transport des réglages.
/// Ce qui a déjà été saisi à la main pour ce mois l'emporte toujours.
export const saisieInitiale = ({ salarie, mois, bulletins = [], absences = [], notes = [], reglages = REGLAGES_DEFAUT }) => {
  const r = completer(reglages);
  const s = salarie.data || salarie;
  const existant = bulletins.find((b) => b.data.mois === mois && b.data.matricule === s.matricule);
  const dernier = bulletins
    .filter((b) => b.data.matricule === s.matricule && b.data.mois < mois)
    .sort((a, b) => String(b.data.mois).localeCompare(String(a.data.mois)))[0];
  const abs = absencesDuMois(absences, salarie.id, mois);
  const frais = fraisARembourser(notes, salarie.id);
  const auto = {
    mois,
    absences: { injustifiee: abs.injustifiee, sansSolde: abs.sansSolde },
    absencesInfo: { conge: abs.conge, maladie: abs.maladie, maternite: abs.maternite, permission: abs.permission },
    frais: frais.total,
    notesFrais: frais.ids,
    prorata: prorataDe(s, mois),
  };
  if (existant) {
    // Une saisie enregistrée garde ses valeurs ; seules les reprises
    // automatiques non modifiées à la main se mettent à jour.
    const e = existant.data.saisie || {};
    return {
      ...e,
      mois,
      absences: e.absencesManuelles ? e.absences : auto.absences,
      absencesInfo: auto.absencesInfo,
      frais: e.fraisManuels ? e.frais : auto.frais,
      notesFrais: e.fraisManuels ? e.notesFrais || [] : auto.notesFrais,
      prorata: auto.prorata,
    };
  }
  const prec = dernier?.data?.saisie || {};
  return {
    primes: 0,
    retenues: 0,
    heuresSup: {},
    personnesCmu: prec.personnesCmu ?? 1,
    situation: prec.situation || s.situation || "celibataire",
    enfants: prec.enfants ?? s.enfants ?? 0,
    indemnites: prec.indemnites ?? r.transport,
    modePaiement: prec.modePaiement || modeParDefaut(s),
    ...auto,
  };
};

/// Les informations d'un salarié dont le calcul a besoin.
export const infosSalarie = (salarie, saisie = {}) => {
  const s = salarie.data || salarie;
  return {
    salaireBase: Number(s.salaireBase) || 0,
    dateEmbauche: s.dateEmbauche,
    situation: saisie.situation,
    enfants: saisie.enfants,
    prenom: s.prenom,
    nom: s.nom,
    matricule: s.matricule,
  };
};

export const calculer = (salarie, saisie, reglages) => bulletin(infosSalarie(salarie, saisie), saisie, reglages);

// ---------------------------------------------------------------------------
// Contrôles
// ---------------------------------------------------------------------------

/// Ce qui doit être vu avant de valider la paie.
///
/// Trois niveaux, comme dans le design : **bloquant** (la paie ne se
/// valide pas), **attention** (à regarder, rien n'empêche de valider),
/// **info** (un événement du mois qu'on aime voir passer).
export const controles = ({ lignes = [], precedents = new Map(), reglages = REGLAGES_DEFAUT }) => {
  const r = completer(reglages);
  const out = [];
  for (const l of lignes) {
    const { salarie, saisie, calcul, enregistre } = l;
    const s = salarie.data || salarie;
    const nom = [s.prenom, s.nom].filter(Boolean).join(" ") || s.matricule || "Salarié";
    const cle = s.matricule || salarie.id;
    const ajouter = (niveau, code, params = {}) => out.push({ niveau, code, cle, nom, salarieId: salarie.id, ...params });

    if (!s.matricule) ajouter("bloquant", "sansMatricule");
    if (!Number(s.salaireBase)) ajouter("bloquant", "sansSalaire");
    if (calcul.net <= 0) ajouter("bloquant", "netNegatif", { montant: calcul.net });
    if (!enregistre) ajouter("attention", "nonEnregistre");
    if (saisie.modePaiement === "virement" && !s.banque) ajouter("attention", "sansBanque");
    if (saisie.modePaiement === "mobile" && !s.telephone) ajouter("attention", "sansMobile");
    if (!s.numeroCnps) ajouter("attention", "sansCnps");
    if (calcul.brut > 0 && calcul.brut < r.smig && !saisie.prorata) ajouter("attention", "sousSmig", { montant: calcul.brut });
    if (saisie.absences?.injustifiee) ajouter("attention", "absenceInjustifiee", { jours: saisie.absences.injustifiee, montant: calcul.retenueAbsences });

    const avant = precedents.get(cle);
    if (avant?.net > 0 && calcul.net > 0) {
      const ecart = (calcul.net - avant.net) / avant.net;
      if (Math.abs(ecart) >= 0.2) ajouter("attention", "variation", { pourcent: Math.round(ecart * 100) });
    }
    if (saisie.prorata?.debut && saisie.prorata.debut > `${saisie.mois}-01`) ajouter("info", "entree", { date: saisie.prorata.debut, jours: saisie.prorata.jours, sur: saisie.prorata.sur });
    if (saisie.prorata?.fin && saisie.prorata.fin < finDeMois(saisie.mois)) ajouter("info", "sortie", { date: saisie.prorata.fin, jours: saisie.prorata.jours, sur: saisie.prorata.sur });
  }
  const ordre = { bloquant: 0, attention: 1, info: 2 };
  return out.sort((a, b) => ordre[a.niveau] - ordre[b.niveau]);
};

/// Le statut d'une ligne dans la liste des salariés.
export const statutLigne = (cle, liste) => {
  const siens = liste.filter((c) => c.cle === cle);
  if (siens.some((c) => c.niveau === "bloquant")) return "bloque";
  if (siens.some((c) => c.niveau === "attention")) return "verifier";
  if (siens.some((c) => c.code === "entree")) return "entree";
  if (siens.some((c) => c.code === "sortie")) return "sortie";
  return "pret";
};

// ---------------------------------------------------------------------------
// Totaux, paiements, déclarations
// ---------------------------------------------------------------------------

export const totaux = (calculs = []) => {
  const s = (f) => arrondi(calculs.reduce((t, c) => t + (Number(typeof f === "function" ? f(c) : c[f]) || 0), 0));
  return {
    effectif: calculs.length,
    brut: s("brut"),
    net: s("net"),
    coutTotal: s("coutTotal"),
    chargesPatronales: s("chargesPatronales"),
    primes: s("primes"),
    heuresSup: s("heuresSup"),
    frais: s("frais"),
    its: s("its"),
  };
};

/// Les paiements du mois, groupés par moyen.
export const paiements = (lignes = []) => {
  const g = { virement: [], mobile: [], especes: [] };
  for (const l of lignes) {
    const mode = g[l.saisie.modePaiement] ? l.saisie.modePaiement : "especes";
    g[mode].push(l);
  }
  return Object.fromEntries(
    Object.entries(g).map(([mode, liste]) => [mode, { liste, total: arrondi(liste.reduce((t, l) => t + l.calcul.net, 0)) }]),
  );
};

/// Les montants à déclarer pour le mois. Échéance : le 15 du mois suivant
/// pour la CNPS, l'ITS et le FDFP (entreprises de moins de 20 salariés : la
/// CNPS peut être trimestrielle — l'échéance reste modifiable à l'écran).
export const declarations = (calculs = [], mois) => {
  const s = (f) => arrondi(calculs.reduce((t, c) => t + (Number(f(c)) || 0), 0));
  const retraite = s((c) => c.cotisations.detail.retraiteSalarie + c.cotisations.detail.retraiteEmployeur);
  const pf = s((c) => c.cotisations.detail.prestationsFamiliales);
  const at = s((c) => c.cotisations.detail.accidentTravail);
  const echeance = `${moisSuivant(mois)}-15`;
  return {
    cnps: { montant: retraite + pf + at, retraite, pf, at, echeance },
    its: { montant: s((c) => c.its), echeance },
    fdfp: { montant: s((c) => c.fdfp || 0), echeance },
    cmu: { montant: s((c) => c.cmuSalarie + c.cmuEmployeur), personnes: calculs.length, echeance },
  };
};

/// Les lignes de l'ordre de virement : une par salarié payé par banque.
export const ordreDeVirement = (lignes = [], mois) => [
  ["Matricule", "Bénéficiaire", "Banque / RIB", "Montant", "Libellé"],
  ...lignes
    .filter((l) => l.saisie.modePaiement === "virement")
    .map((l) => {
      const s = l.salarie.data || l.salarie;
      return [s.matricule, [s.prenom, s.nom].filter(Boolean).join(" "), s.banque || "", l.calcul.net, `SALAIRE ${mois}`];
    }),
];

/// Les cumuls d'une année par salarié : la base de la DISA, la
/// déclaration individuelle des salaires annuels que la CNPS attend en
/// janvier.
export const cumulsAnnuels = (bulletins = [], annee) => {
  const m = new Map();
  for (const b of bulletins) {
    if (!String(b.data.mois).startsWith(String(annee))) continue;
    const c = b.data.calcul || {};
    const k = b.data.matricule;
    const t = m.get(k) || { matricule: k, mois: 0, brut: 0, cnpsSalarie: 0, cnpsEmployeur: 0, its: 0, net: 0 };
    t.mois += 1;
    t.brut += c.brut || 0;
    t.cnpsSalarie += c.cotisations?.salariale || 0;
    t.cnpsEmployeur += c.cotisations?.patronale || 0;
    t.its += c.its || 0;
    t.net += c.net || 0;
    m.set(k, t);
  }
  return [...m.values()].sort((a, b) => String(a.matricule).localeCompare(String(b.matricule)));
};

/// Le brut qui donne un net voulu, par dichotomie sur le calcul réel :
/// barème progressif et plafonds rendent l'inversion analytique fragile.
export const netVersBrut = (netCible, { situation, enfants, indemnites = 0 } = {}, reglages = REGLAGES_DEFAUT) => {
  const cible = Number(netCible) || 0;
  if (cible <= 0) return 0;
  let bas = 0;
  let haut = cible * 3 + 100000;
  for (let i = 0; i < 60; i += 1) {
    const milieu = (bas + haut) / 2;
    const net = bulletin({ salaireBase: milieu }, { situation, enfants, indemnites, personnesCmu: 1 }, reglages).net;
    if (net < cible) bas = milieu;
    else haut = milieu;
  }
  return Math.round(haut);
};

/// L'étape où en est le cycle.
export const etapeCourante = (cycle, nbBloquants, toutEnregistre) => {
  const etat = cycle?.etat || "preparation";
  if (etat === "declare") return "termine";
  if (etat === "paye") return "declarations";
  if (etat === "valide") return "paiement";
  if (!toutEnregistre) return "variables";
  if (nbBloquants) return "controles";
  return "validation";
};

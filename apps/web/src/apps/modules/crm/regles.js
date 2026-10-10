// CRM 3 — règles de pilotage, en fonctions pures.
//
// Complète `domaine.js` (étapes, relances, chronologie de base) avec ce
// que les meilleurs CRM du marché ont rendu indispensable :
//
//   - l'affaire qui **stagne** (Pipedrive) : sans activité depuis trop
//     longtemps, elle se perd en silence ;
//   - la **prochaine activité** de chaque affaire : une affaire sans
//     prochaine étape n'avance pas ;
//   - les **prévisions** (Salesforce) : gagné, engagé, pondéré — trois
//     chiffres qu'on ne doit jamais additionner ;
//   - le **score** d'un lead, avec ses raisons (HubSpot) : un chiffre
//     qu'on ne sait pas expliquer, personne ne s'en sert ;
//   - la **santé** d'un compte, les **doublons**, les **vues enregistrées** ;
//   - la **saisie rapide** : « rappeler mardi » crée la relance.
//
// Rien ici ne connaît React ni l'API.

import { ETAPES, ETAPES_OUVERTES, plusJours, today, valeurPonderee } from "./domaine.js";

export const SEUIL_STAGNATION = 14;

export const MOTIFS_PERTE = ["prix", "concurrent", "budget", "delai", "besoin", "silence", "autre"];

export const SOURCES = ["formulaire", "campagne", "recommandation", "salon", "import", "appel", "site", "autre"];

const jour = (d) => (d ? String(d).slice(0, 10) : "");
const ecart = (a, b) => Math.round((new Date(jour(a)) - new Date(jour(b))) / 86400000);
const borner = (n, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(n)));

// ---------------------------------------------------------------------------
// Affaires : stagnation et prochaine activité
// ---------------------------------------------------------------------------

/// Les activités qui concernent une affaire : celles qui lui sont
/// rattachées, et celles de son compte qui ne visent aucune autre affaire.
const activitesDe = (opp, activites) =>
  activites.filter(
    (a) =>
      a.data.opportuniteId === opp.id ||
      (!a.data.opportuniteId && a.data.clientId && a.data.clientId === opp.data.clientId),
  );

/// Date de la dernière chose qui s'est passée sur l'affaire : une activité
/// réalisée, ou un changement d'étape.
export const derniereActivite = (opp, activites) => {
  const dates = activitesDe(opp, activites)
    .filter((a) => a.data.type !== "tache" || a.data.fait)
    .map((a) => jour(a.data.faitLe || a.data.date));
  dates.push(jour(opp.data.etapeLe || opp.updatedAt || opp.createdAt));
  return dates.filter(Boolean).sort().pop() || null;
};

/// Une affaire ouverte stagne quand rien ne s'y est passé depuis le seuil
/// de son étape (14 jours par défaut, réglable étape par étape).
export const stagnation = (opp, activites, { seuils = {}, maintenant = today() } = {}) => {
  if (!ETAPES_OUVERTES.includes(opp.data.etape)) return { jours: 0, stagne: false, seuil: null };
  const seuil = Number(seuils[opp.data.etape]) || SEUIL_STAGNATION;
  const derniere = derniereActivite(opp, activites);
  const jours = derniere ? Math.max(0, ecart(maintenant, derniere)) : 0;
  return { jours, stagne: jours >= seuil, seuil };
};

/// La prochaine tâche prévue pour l'affaire (ou, à défaut, pour son compte).
export const prochaineActivite = (opp, activites, maintenant = today()) => {
  const taches = activitesDe(opp, activites)
    .filter((a) => a.data.type === "tache" && !a.data.fait && a.data.echeance)
    .sort((a, b) => (a.data.echeance < b.data.echeance ? -1 : 1));
  const t = taches[0];
  if (!t) return null;
  return { activite: t, enRetard: t.data.echeance < maintenant, aujourdhui: t.data.echeance === maintenant };
};

// ---------------------------------------------------------------------------
// Prévisions et objectif
// ---------------------------------------------------------------------------

const moisDe = (d) => jour(d).slice(0, 7);

const moisSuivant = (m) => {
  const [a, mm] = m.split("-").map(Number);
  return mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, "0")}`;
};

/// Une affaire est **engagée** quand elle est en négociation ou que son
/// responsable l'estime à 75 % ou plus : c'est le chiffre sur lequel on
/// s'engage auprès de la direction.
export const estEngagee = (opp) => {
  const d = opp.data;
  if (!ETAPES_OUVERTES.includes(d.etape)) return false;
  const p = d.probabilite === "" || d.probabilite === undefined || d.probabilite === null
    ? ETAPES[d.etape]?.probabilite ?? 0
    : Number(d.probabilite);
  return d.etape === "negociation" || p >= 75;
};

/// Date à laquelle une affaire gagnée l'a été : la date de clôture, sinon
/// celle du changement d'étape.
const dateGain = (opp) => jour(opp.data.dateCloture || opp.data.etapeLe || opp.updatedAt);

/// Prévisions mois par mois : gagné (réalisé), engagé, pondéré (ouvert).
/// Une affaire ouverte dont la date de clôture est passée compte pour le
/// mois en cours : elle n'est pas perdue tant que personne ne l'a dit.
export const previsions = (opportunites, { maintenant = today(), mois = 3 } = {}) => {
  const courant = moisDe(maintenant);
  const lignes = [];
  let m = courant;
  for (let i = 0; i < mois; i += 1) {
    lignes.push({ mois: m, gagne: 0, engage: 0, pondere: 0, nombre: 0 });
    m = moisSuivant(m);
  }
  const ligne = (cle) => lignes.find((l) => l.mois === cle);
  for (const o of opportunites) {
    const d = o.data;
    if (d.etape === "gagnee") {
      const l = ligne(moisDe(dateGain(o)));
      if (l) l.gagne += Number(d.montant) || 0;
      continue;
    }
    if (!ETAPES_OUVERTES.includes(d.etape)) continue;
    const cible = d.dateCloture && moisDe(d.dateCloture) > courant ? moisDe(d.dateCloture) : courant;
    const l = ligne(cible);
    if (!l) continue;
    l.nombre += 1;
    l.pondere += valeurPonderee(o);
    if (estEngagee(o)) l.engage += Number(d.montant) || 0;
  }
  return lignes;
};

/// Jours ouvrés (lundi–vendredi) restant dans le mois, aujourd'hui compris.
export const joursOuvresRestants = (maintenant = today()) => {
  const d = new Date(`${jour(maintenant)}T12:00:00`);
  const mois = d.getMonth();
  let n = 0;
  while (d.getMonth() === mois) {
    const j = d.getDay();
    if (j !== 0 && j !== 6) n += 1;
    d.setDate(d.getDate() + 1);
  }
  return n;
};

/// Où en est l'objectif du mois.
export const progressionObjectif = (opportunites, objectif, { maintenant = today(), responsableId = null } = {}) => {
  const miennes = responsableId
    ? opportunites.filter((o) => o.data.responsableId === responsableId)
    : opportunites;
  const [mois] = previsions(miennes, { maintenant, mois: 1 });
  const cible = Number(objectif) || 0;
  return {
    objectif: cible,
    gagne: mois.gagne,
    engage: mois.engage,
    pct: cible ? Math.round((mois.gagne / cible) * 100) : null,
    pctEngage: cible ? Math.round((Math.min(cible, mois.gagne + mois.engage) / cible) * 100) : null,
    joursRestants: joursOuvresRestants(maintenant),
  };
};

/// Performance commerciale sur une période : taux de gain, cycle moyen,
/// répartition des pertes par motif et des gains par source.
export const performance = (opportunites, clients = [], { maintenant = today(), jours = 90 } = {}) => {
  const depuis = plusJours(-jours, maintenant);
  const closes = opportunites.filter(
    (o) => ["gagnee", "perdue"].includes(o.data.etape) && dateGain(o) >= depuis,
  );
  const gagnees = closes.filter((o) => o.data.etape === "gagnee");
  const perdues = closes.filter((o) => o.data.etape === "perdue");
  const cycles = gagnees
    .map((o) => ecart(dateGain(o), o.createdAt))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const motifs = {};
  for (const o of perdues) {
    const m = o.data.motifPerte || "autre";
    motifs[m] = (motifs[m] || 0) + 1;
  }
  const sourceDe = (o) => clients.find((c) => c.id === o.data.clientId)?.data.source || "autre";
  const sources = {};
  for (const o of closes) {
    const s = sourceDe(o);
    sources[s] = sources[s] || { gagnees: 0, closes: 0, montant: 0 };
    sources[s].closes += 1;
    if (o.data.etape === "gagnee") {
      sources[s].gagnees += 1;
      sources[s].montant += Number(o.data.montant) || 0;
    }
  }
  return {
    taux: closes.length ? Math.round((gagnees.length / closes.length) * 100) : null,
    gagnees: gagnees.length,
    perdues: perdues.length,
    montantGagne: gagnees.reduce((s, o) => s + (Number(o.data.montant) || 0), 0),
    cycleMoyen: cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null,
    motifs: Object.entries(motifs).sort((a, b) => b[1] - a[1]).map(([motif, nombre]) => ({ motif, nombre })),
    sources: Object.entries(sources)
      .map(([source, s]) => ({ source, ...s, taux: Math.round((s.gagnees / s.closes) * 100) }))
      .sort((a, b) => b.montant - a.montant),
  };
};

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

/// Un lead : un prospect qu'on n'a encore ni qualifié ni écarté, et sur
/// lequel aucune affaire n'est ouverte. Les inscrits du formulaire des
/// Campagnes arrivent ici d'eux-mêmes.
export const estLead = (client, opportunites = []) =>
  client.data.statut === "prospect" &&
  !client.data.qualifie &&
  !client.data.ecarte &&
  !opportunites.some((o) => o.data.clientId === client.id);

/// Les signaux de campagne d'un contact : ouvertures et clics, toutes
/// campagnes confondues.
export const signauxCampagnes = (clientId, campagnes = []) => {
  let ouvertures = 0;
  let clics = 0;
  for (const c of campagnes) {
    for (const d of c.data.destinataires || []) {
      if (d.clientId !== clientId) continue;
      if (d.ouvert) ouvertures += 1;
      if (d.clique) clics += 1;
    }
  }
  return { ouvertures, clics };
};

/// Score d'un lead, de 0 à 100, avec ses raisons. Chaque point se justifie
/// par un fait qu'on peut vérifier dans la fiche.
export const scoreLead = (client, { campagnes = [], activites = [], secteursCibles = [], maintenant = today() } = {}) => {
  const d = client.data;
  const raisons = [];
  const ajouter = (points, cle, valeurs = {}) => points && raisons.push({ points, cle, ...valeurs });

  if (d.source === "formulaire") ajouter(25, "formulaire");
  else if (d.source === "recommandation") ajouter(25, "recommandation");
  else if (d.source === "salon" || d.source === "appel") ajouter(15, "rencontre");
  if (d.consentement?.confirmeLe) ajouter(10, "consentement");
  if (d.besoin) ajouter(10, "besoin");
  if (Number(d.montantEstime) > 0) ajouter(10, "montant");

  const { ouvertures, clics } = signauxCampagnes(client.id, campagnes);
  if (clics) ajouter(Math.min(20, clics * 10), "clics", { n: clics });
  if (ouvertures) ajouter(Math.min(8, ouvertures * 2), "ouvertures", { n: ouvertures });

  if (d.email) ajouter(6, "email");
  if (d.telephone) ajouter(6, "telephone");
  if (d.entreprise) ajouter(4, "entreprise");
  if (d.secteur && secteursCibles.some((s) => s.toLowerCase() === String(d.secteur).toLowerCase())) {
    ajouter(15, "secteur", { secteur: d.secteur });
  }

  const recente = activites.some(
    (a) => a.data.clientId === client.id && ecart(maintenant, a.data.date) <= 7,
  );
  if (recente) ajouter(10, "recent");

  const score = borner(raisons.reduce((s, r) => s + r.points, 0));
  return { score, raisons: raisons.sort((a, b) => b.points - a.points) };
};

/// Niveau d'un score : sert à la couleur et au tri.
export const niveauScore = (score) => (score >= 70 ? "chaud" : score >= 40 ? "tiede" : "froid");

// ---------------------------------------------------------------------------
// Doublons
// ---------------------------------------------------------------------------

const sansAccents = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export const normaliserNom = (t) =>
  sansAccents(t)
    .replace(/\b(sarl|sa|sas|sasu|ets|etablissements|groupe|ste|societe|ci)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/// Les 8 derniers chiffres : identiques avec ou sans indicatif (+225…).
export const normaliserTelephone = (t) => String(t || "").replace(/\D/g, "").slice(-8);

/// Les fiches qui ressemblent à celle-ci : même e-mail, même téléphone, ou
/// même nom d'entreprise une fois les formes juridiques retirées.
export const doublons = (fiche, clients) => {
  const d = fiche.data || fiche;
  const email = sansAccents(d.email).trim();
  const tel = normaliserTelephone(d.telephone);
  const nom = normaliserNom(d.entreprise || d.nom);
  const out = [];
  for (const c of clients) {
    if (fiche.id && c.id === fiche.id) continue;
    const raisons = [];
    if (email && sansAccents(c.data.email).trim() === email) raisons.push("email");
    if (tel.length >= 8 && normaliserTelephone(c.data.telephone) === tel) raisons.push("telephone");
    if (nom.length >= 3 && normaliserNom(c.data.entreprise || c.data.nom) === nom) raisons.push("nom");
    if (raisons.length) out.push({ client: c, raisons });
  }
  return out.sort((a, b) => b.raisons.length - a.raisons.length);
};

// ---------------------------------------------------------------------------
// Ventes et santé d'un compte
// ---------------------------------------------------------------------------

/// Ce que la Facturation dit d'un compte : chiffre d'affaires sur 12 mois
/// (et les 12 précédents), reste dû, échu, délai moyen de paiement.
export const ventesCompte = (clientId, documents, reglements, { totauxDe, etatPaiement, maintenant = today() }) => {
  const debut = plusJours(-365, maintenant);
  const debutPrec = plusJours(-730, maintenant);
  let ca12 = 0;
  let caPrec = 0;
  let du = 0;
  let echu = 0;
  let factures12 = 0;
  const delais = [];
  for (const doc of documents) {
    const d = doc.data;
    if (d.clientId !== clientId || d.type === "devis" || d.statut === "brouillon" || d.statut === "annule") continue;
    const signe = d.type === "avoir" ? -1 : 1;
    const ttc = totauxDe(d).ttc * signe;
    if (d.date >= debut) {
      ca12 += ttc;
      if (d.type !== "avoir") factures12 += 1;
    } else if (d.date >= debutPrec) caPrec += ttc;
    if (d.type === "avoir") continue;
    const e = etatPaiement(doc, reglements, maintenant);
    if (["impayee", "partielle", "retard"].includes(e.id)) du += e.reste || 0;
    if (e.id === "retard") echu += e.reste || 0;
    if (e.id === "payee") {
      const derniers = reglements.filter((r) => r.data.documentId === doc.id).map((r) => jour(r.data.date)).sort();
      if (derniers.length) delais.push(Math.max(0, ecart(derniers.pop(), d.date)));
    }
  }
  return {
    ca12,
    caPrec,
    evolution: caPrec > 0 ? Math.round(((ca12 - caPrec) / caPrec) * 100) : null,
    du,
    echu,
    factures12,
    delaiMoyen: delais.length ? Math.round(delais.reduce((a, b) => a + b, 0) / delais.length) : null,
  };
};

/// Santé d'un compte, de 0 à 100, avec les facteurs qui la font. Un compte
/// qui achète régulièrement, qu'on suit, et qui paie, est en bonne santé.
export const santeCompte = ({ ventes, joursSansContact, affairesOuvertes = 0, perduesRecentes = 0 }) => {
  const facteurs = [];
  const f = (points, cle, valeurs = {}) => facteurs.push({ points, cle, ...valeurs });
  if (ventes?.ca12 > 0) f(15, "achats");
  if (ventes?.factures12 >= 3) f(10, "regulier");
  if (ventes?.evolution !== null && ventes?.evolution !== undefined) {
    if (ventes.evolution >= 10) f(10, "croissance", { pct: ventes.evolution });
    else if (ventes.evolution <= -20) f(-10, "baisse", { pct: ventes.evolution });
  }
  if (joursSansContact === null || joursSansContact === undefined) f(-10, "jamaisContacte");
  else if (joursSansContact <= 30) f(15, "suivi");
  else if (joursSansContact > 90) f(-15, "silence", { jours: joursSansContact });
  if (affairesOuvertes > 0) f(10, "affaire");
  if (ventes?.echu > 0) f(-20, "retard");
  if (perduesRecentes > 0) f(-5, "perdue");
  const score = borner(50 + facteurs.reduce((s, x) => s + x.points, 0));
  return { score, niveau: score >= 70 ? "bon" : score >= 45 ? "moyen" : "risque", facteurs };
};

// ---------------------------------------------------------------------------
// Saisie rapide
// ---------------------------------------------------------------------------

const JOURS = {
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const prochainJour = (cible, maintenant) => {
  const d = new Date(`${maintenant}T12:00:00`);
  const diff = (cible - d.getDay() + 7) % 7 || 7;
  return plusJours(diff, maintenant);
};

/// Trouve une échéance dans une phrase : « demain », « mardi », « dans 3
/// jours », « le 12 », « 12/11 ». Rend la date ISO, ou null.
export const echeanceDans = (texte, maintenant = today()) => {
  const t = sansAccents(texte);
  if (/\b(apres[- ]demain|day after tomorrow)\b/.test(t)) return plusJours(2, maintenant);
  if (/\b(demain|tomorrow)\b/.test(t)) return plusJours(1, maintenant);
  if (/\b(aujourd'?hui|ce soir|today|tonight)\b/.test(t)) return maintenant;
  const dans = /\b(?:dans|in)\s+(\d{1,3})\s*(jours?|j|days?|semaines?|sem|weeks?|mois|months?)\b/.exec(t);
  if (dans) {
    const n = Number(dans[1]);
    const u = dans[2];
    if (/^(sem|week)/.test(u)) return plusJours(n * 7, maintenant);
    if (/^(mois|month)/.test(u)) {
      const d = new Date(`${maintenant}T12:00:00`);
      d.setMonth(d.getMonth() + n);
      return d.toISOString().slice(0, 10);
    }
    return plusJours(n, maintenant);
  }
  if (/\b(semaine prochaine|next week)\b/.test(t)) return prochainJour(1, maintenant);
  for (const [nom, num] of Object.entries(JOURS)) {
    if (new RegExp(`\\b${nom}\\b`).test(t)) return prochainJour(num, maintenant);
  }
  const jm = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/.exec(t);
  if (jm) {
    const [a] = maintenant.split("-").map(Number);
    const annee = jm[3] ? (jm[3].length === 2 ? 2000 + Number(jm[3]) : Number(jm[3])) : a;
    let iso = `${annee}-${String(jm[2]).padStart(2, "0")}-${String(jm[1]).padStart(2, "0")}`;
    if (!jm[3] && iso < maintenant) iso = `${annee + 1}${iso.slice(4)}`;
    if (!Number.isNaN(new Date(iso).getTime())) return iso;
  }
  const le = /\b(?:le|the)\s+(\d{1,2})\b/.exec(t);
  if (le) {
    const n = Number(le[1]);
    if (n >= 1 && n <= 31) {
      const [a, m, j] = maintenant.split("-").map(Number);
      const d = n >= j ? new Date(Date.UTC(a, m - 1, n)) : new Date(Date.UTC(a, m, n));
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
};

/// Interprète une saisie libre en activité : le type se devine aux mots,
/// une date à venir en fait une tâche (une relance).
export const analyserSaisie = (texte, maintenant = today()) => {
  const brut = String(texte || "").trim();
  const t = sansAccents(brut);
  const echeance = echeanceDans(brut, maintenant);
  const aFaire = /\b(rappeler|relancer|envoyer|preparer|penser|faire|prevoir|call back|follow up|send|remind)\b/.test(t);
  let type = "note";
  if (/\b(rdv|rendez[- ]vous|reunion|visite|demo|meeting)\b/.test(t)) type = "reunion";
  else if (/\b(appel|appele|telephone|tel|call|called)\b/.test(t)) type = "appel";
  else if (/\b(mail|e-mail|email|courriel)\b/.test(t)) type = "email";
  if (echeance && (aFaire || echeance > maintenant)) type = "tache";
  return { type, resume: brut, echeance: type === "tache" ? echeance || maintenant : "", date: maintenant };
};

// ---------------------------------------------------------------------------
// Chronologie unifiée : le CRM et toutes les apps qui parlent du client
// ---------------------------------------------------------------------------

/// Tout ce qui s'est passé avec un compte, d'où que ça vienne : échanges
/// du CRM, affaires, devis et factures, règlements, courriels envoyés,
/// signaux des campagnes, projets. Du plus récent au plus ancien.
export const chronologieUnifiee = ({
  client,
  activites = [],
  opportunites = [],
  documents = [],
  reglements = [],
  envois = [],
  campagnes = [],
  cartes = [],
  totauxDe = () => ({ ttc: 0 }),
}) => {
  if (!client) return [];
  const id = client.id;
  const email = sansAccents(client.data.email).trim();
  const ev = [];
  for (const a of activites) {
    if (a.data.clientId !== id) continue;
    if (a.data.type === "tache" && !a.data.fait) continue; // à venir : affiché à part
    ev.push({ id: `a-${a.id}`, date: jour(a.data.faitLe || a.data.date || a.data.echeance), famille: "echange", type: a.data.type, record: a });
  }
  for (const o of opportunites) {
    if (o.data.clientId !== id) continue;
    ev.push({ id: `o-${o.id}`, date: jour(o.data.etapeLe || o.createdAt), famille: "affaire", record: o });
  }
  const docsClient = new Set();
  for (const d of documents) {
    if (d.data.clientId !== id || d.data.statut === "brouillon") continue;
    docsClient.add(d.id);
    ev.push({ id: `d-${d.id}`, date: jour(d.data.date), famille: "vente", record: d, montant: totauxDe(d.data).ttc });
  }
  for (const r of reglements) {
    if (!docsClient.has(r.data.documentId)) continue;
    ev.push({ id: `r-${r.id}`, date: jour(r.data.date), famille: "paiement", record: r, montant: Number(r.data.montant) || 0 });
  }
  if (email) {
    for (const e of envois) {
      const a = sansAccents(e.data.a);
      if (!a.includes(email)) continue;
      ev.push({ id: `e-${e.id}`, date: jour(e.data.date || e.createdAt), famille: "courriel", record: e });
    }
  }
  for (const c of campagnes) {
    for (const d of c.data.destinataires || []) {
      if (d.clientId !== id) continue;
      if (d.clique) ev.push({ id: `c-${c.id}-k`, date: jour(d.cliqueLe || d.envoyeLe), famille: "campagne", action: "clic", record: c });
      else if (d.ouvert) ev.push({ id: `c-${c.id}-o`, date: jour(d.ouvertLe || d.envoyeLe), famille: "campagne", action: "ouverture", record: c });
    }
  }
  for (const k of cartes) {
    if (k.data.liens?.clientId !== id) continue;
    ev.push({ id: `p-${k.id}`, date: jour(k.updatedAt || k.createdAt), famille: "projet", record: k });
  }
  return ev.filter((e) => e.date).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
};

// ---------------------------------------------------------------------------
// Vues enregistrées
// ---------------------------------------------------------------------------

/// Applique les critères d'une vue enregistrée à la liste des comptes.
/// `ctx` fournit ce qui ne se lit pas dans la fiche : chiffre d'affaires,
/// jours sans contact.
export const appliquerVue = (clients, criteres = {}, ctx = {}) =>
  clients.filter((c) => {
    const d = c.data;
    if (criteres.statut && d.statut !== criteres.statut) return false;
    if (criteres.ville && sansAccents(d.ville) !== sansAccents(criteres.ville)) return false;
    if (criteres.secteur && sansAccents(d.secteur) !== sansAccents(criteres.secteur)) return false;
    if (criteres.responsableId && d.responsableId !== criteres.responsableId) return false;
    if (criteres.etiquette && !(d.etiquettes || []).includes(criteres.etiquette)) return false;
    if (criteres.caMin && (ctx.ca?.[c.id] || 0) < Number(criteres.caMin)) return false;
    if (criteres.sansContact) {
      const j = ctx.joursSansContact?.[c.id];
      if (j !== null && j !== undefined && j < Number(criteres.sansContact)) return false;
    }
    return true;
  });

// Agenda — les règles, sans React.
//
// ─────────────────────────────────────────────────────────────────────────
// UN AGENDA QUI SE REMPLIT TOUT SEUL
//
// CompanyOS a déjà toutes les dates qui comptent, éparpillées : une facture
// a une échéance, une tâche de projet aussi, un congé a un début et une
// fin, un contrat une date de terme, la paie tombe chaque mois. Personne ne
// pouvait les voir ensemble — trois calendriers implicites, aucun visible.
//
// Cet agenda les rassemble. Il ne duplique aucune donnée : il lit les
// enregistrements des autres modules et en déduit des événements. Un congé
// déplacé dans les RH bouge ici sans rien faire, parce que la source de
// vérité reste le module d'origine.
//
// À côté de ces événements **repris** (en lecture seule : on va les
// modifier dans leur app), l'agenda tient ses **propres** événements —
// réunions, rendez-vous, rappels — que l'utilisateur crée et modifie ici.
//
// ─────────────────────────────────────────────────────────────────────────
// COMMENT ON AJOUTE UNE SOURCE
//
// Chaque source est une entrée de `SOURCES` : d'où lire (`module`,
// `collection`) et comment transformer un enregistrement en événement
// (`evenements`). Brancher un nouveau module ne touche à rien d'autre — ni
// la grille, ni le rendu, ni le filtre. C'est ce qui rend l'agenda
// « avancé » extensible sans le réécrire.
// ─────────────────────────────────────────────────────────────────────────

/// Les familles d'événements, avec leur couleur et leur icône. La couleur
/// reprend celle du module d'origine, pour qu'on relie l'événement à son
/// app d'un coup d'œil.
export const FAMILLES = {
  perso: { label: "Mon agenda", couleur: "#4338ca", icone: "faCalendarDay" },
  facture: { label: "Factures", couleur: "#047857", icone: "faFileInvoiceDollar" },
  tache: { label: "Projets", couleur: "#4338ca", icone: "faListCheck" },
  relance: { label: "CRM", couleur: "#d97706", icone: "faUserClock" },
  absence: { label: "Absences", couleur: "#0d9488", icone: "faUmbrellaBeach" },
  contrat: { label: "Contrats", couleur: "#c0392b", icone: "faFileContract" },
  paie: { label: "Paie", couleur: "#d97706", icone: "faMoneyCheckDollar" },
};

const iso = (d) => (d ? String(d).slice(0, 10) : "");

/// Les sources reprises. Chaque `evenements` reçoit un enregistrement et le
/// contexte (des tables de correspondance pour retrouver un nom), et rend
/// zéro, un ou plusieurs événements. Un événement porte au minimum une date
/// et un titre ; `fin` en fait une plage, `app` dit quelle fenêtre ouvrir.
export const SOURCES = [
  {
    id: "factures",
    module: "facturation",
    collection: "factures",
    app: "facturation",
    evenements: (r) => {
      const d = r.data || {};
      // Une facture non réglée, à sa date d'échéance : c'est de l'argent
      // qu'on attend, et le rappel le plus utile d'un agenda d'entreprise.
      if (d.type !== "facture" || !d.echeance) return [];
      if (d.statut === "brouillon" || d.statut === "annule") return [];
      return [
        {
          date: iso(d.echeance),
          famille: "facture",
          titre: `Échéance ${d.numero || "facture"}`,
          detail: d.clientNom || d.client || "",
        },
      ];
    },
  },
  {
    id: "taches",
    module: "projets",
    collection: "cartes",
    app: "projets",
    evenements: (r) => {
      const d = r.data || {};
      if (!d.echeance) return [];
      return [
        {
          date: iso(d.echeance),
          famille: "tache",
          titre: d.titre || "Tâche",
        },
      ];
    },
  },
  {
    id: "relances",
    module: "crm",
    collection: "activites",
    app: "crm",
    evenements: (r) => {
      const d = r.data || {};
      // Seules les tâches à échéance sont des rendez-vous à venir ; un appel
      // déjà passé n'a rien à faire dans l'agenda.
      if (d.type !== "tache" || !d.echeance) return [];
      return [
        {
          date: iso(d.echeance),
          famille: "relance",
          titre: d.resume || "Relance client",
        },
      ];
    },
  },
  {
    id: "absences",
    module: "rh",
    collection: "absences",
    app: "rh",
    evenements: (r, ctx) => {
      const d = r.data || {};
      if (!d.du || d.etat === "refuse") return [];
      const nom = ctx.salaries?.get(d.salarieId) || "Salarié";
      return [
        {
          date: iso(d.du),
          fin: iso(d.au || d.du),
          famille: "absence",
          titre: `${nom} — ${d.type === "conge" ? "congé" : d.type || "absence"}`,
          provisoire: d.etat === "demande",
        },
      ];
    },
  },
  {
    id: "contrats",
    module: "rh",
    collection: "salaries",
    app: "rh",
    evenements: (r, ctx) => {
      const d = r.data || {};
      // Fin de contrat : une date à ne pas rater, sinon on emploie hors
      // cadre. On ne la montre que pour les salariés encore présents.
      if (!d.dateFin || d.statut === "sorti") return [];
      const nom = ctx.salaries?.get(r.id) || `${d.prenom || ""} ${d.nom || ""}`.trim();
      return [
        {
          date: iso(d.dateFin),
          famille: "contrat",
          titre: `Fin de contrat — ${nom}`,
        },
      ];
    },
  },
  {
    id: "paie",
    module: "paie",
    collection: "bulletins",
    app: "paie",
    // Un seul événement par mois de paie, pas un par bulletin : on regroupe
    // sur la date de versement.
    agrege: (records) => {
      const mois = new Set(records.map((r) => r.data?.mois).filter(Boolean));
      return [...mois].map((m) => ({
        date: `${m}-28`,
        famille: "paie",
        titre: `Paie ${m}`,
      }));
    },
  },
];

/// Construit tous les événements repris à partir des jeux d'enregistrements.
///
/// `datasets` est { [sourceId]: records[] }. `contexte` porte les tables de
/// correspondance (matricule/id → nom). Chaque événement reçoit un
/// identifiant stable et un drapeau `lectureSeule` : on le modifie dans son
/// app d'origine, pas ici.
export const evenementsRepris = (datasets = {}, contexte = {}) => {
  const out = [];
  for (const source of SOURCES) {
    const records = datasets[source.id] || [];
    if (source.agrege) {
      for (const e of source.agrege(records)) {
        out.push({ ...e, source: source.id, app: source.app, lectureSeule: true, id: `${source.id}:${e.date}:${e.titre}` });
      }
      continue;
    }
    for (const r of records) {
      for (const e of source.evenements(r, contexte)) {
        if (!e.date) continue;
        out.push({ ...e, source: source.id, app: source.app, lectureSeule: true, id: `${source.id}:${r.id}` });
      }
    }
  }
  return out;
};

/// Les événements propres à l'agenda, normalisés comme les autres.
export const evenementsPropres = (records = []) =>
  records
    .filter((r) => r.data?.date)
    .map((r) => ({
      id: r.id,
      date: iso(r.data.date),
      fin: r.data.fin ? iso(r.data.fin) : undefined,
      heure: r.data.heure || "",
      famille: "perso",
      titre: r.data.titre || "Événement",
      detail: r.data.lieu || r.data.detail || "",
      lectureSeule: false,
      record: r,
    }));

// ---------------------------------------------------------------------------
// Placement dans le calendrier
// ---------------------------------------------------------------------------

/// Vrai si un événement occupe un jour donné — un événement d'un seul jour
/// ou une plage qui le contient.
export const couvre = (evenement, jourIso) => {
  const debut = evenement.date;
  const fin = evenement.fin || evenement.date;
  return jourIso >= debut && jourIso <= fin;
};

/// Les événements d'un jour, triés : les datés à l'heure d'abord, puis le
/// reste par famille pour un ordre stable.
export const duJour = (evenements, jourIso) =>
  evenements
    .filter((e) => couvre(e, jourIso))
    .sort((a, b) => (a.heure || "99").localeCompare(b.heure || "99") || a.famille.localeCompare(b.famille));

/// Grille d'un mois : des semaines de sept jours, du lundi au dimanche,
/// débordant sur les mois voisins pour remplir les rangées. Chaque case
/// sait si elle appartient au mois affiché.
///
/// `annee`/`mois` (mois 1–12). Les dates sont construites en UTC pour que le
/// fuseau ne décale pas un jour d'un cran — un piège classique des grilles
/// de calendrier.
export const grilleMois = (annee, mois) => {
  const premier = new Date(Date.UTC(annee, mois - 1, 1));
  // Lundi = 0. getUTCDay() rend 0 pour dimanche, qu'on ramène en fin de
  // semaine.
  const decalage = (premier.getUTCDay() + 6) % 7;
  const debut = new Date(premier);
  debut.setUTCDate(1 - decalage);

  const semaines = [];
  const curseur = new Date(debut);
  // Six semaines couvrent tous les cas de figure d'un mois.
  for (let s = 0; s < 6; s += 1) {
    const jours = [];
    for (let j = 0; j < 7; j += 1) {
      jours.push({
        iso: curseur.toISOString().slice(0, 10),
        jour: curseur.getUTCDate(),
        duMois: curseur.getUTCMonth() === mois - 1,
      });
      curseur.setUTCDate(curseur.getUTCDate() + 1);
    }
    semaines.push(jours);
    // On s'arrête après la semaine qui contient la fin du mois, pour ne pas
    // afficher une sixième rangée entièrement hors-mois.
    if (jours[6].duMois === false && jours[0].duMois === false && s >= 4) break;
  }
  return semaines;
};

/// Les prochains événements à partir d'aujourd'hui, pour la colonne « à
/// venir ». Une plage compte tant qu'elle n'est pas terminée.
export const prochains = (evenements, aujourdhui, limite = 12) =>
  evenements
    .filter((e) => (e.fin || e.date) >= aujourdhui)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.heure || "").localeCompare(b.heure || ""))
    .slice(0, limite);

/// Compte d'événements par jour du mois, pour les pastilles de la grille.
export const compteParJour = (evenements, jours) => {
  const m = new Map();
  for (const j of jours) {
    const n = evenements.filter((e) => couvre(e, j)).length;
    if (n) m.set(j, n);
  }
  return m;
};

// ---------------------------------------------------------------------------
// Invitations au format iCalendar (.ics)
// ---------------------------------------------------------------------------
//
// Le format que tous les calendriers comprennent — Outlook, Gmail, un
// téléphone. Un événement de l'agenda devient une pièce jointe .ics : le
// destinataire clique, son calendrier propose d'ajouter le rendez-vous.

/// Échappe un texte pour un champ iCalendar : virgules, points-virgules
/// et retours à la ligne ont un sens dans le format.
const echapperIcs = (texte) =>
  String(texte || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

const compacte = (iso) => String(iso).replace(/-/g, "");

/// Le fichier .ics d'un événement de l'agenda.
///
/// Un événement à heure donnée dure une heure par défaut — c'est la
/// convention des calendriers, modifiable par le destinataire. Sans
/// heure, c'est une journée entière (ou une plage si `fin` est posée).
/// Les heures sont « flottantes » (sans fuseau) : un rendez-vous à 9 h
/// est à 9 h, où que soit la personne — le bon choix pour des équipes qui
/// travaillent dans le même pays.
export const icsDe = (evenement, { organisateur = "CompanyOS", uid } = {}) => {
  const { date, fin, heure, titre, detail } = evenement;
  const lignes = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CompanyOS//Agenda//FR",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid || `${compacte(date)}-${Math.abs([...String(titre)].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % 1e9}@companyos`}`,
    `DTSTAMP:${compacte(new Date().toISOString().slice(0, 10))}T000000Z`,
  ];

  if (heure) {
    const [h, m] = heure.split(":").map(Number);
    const debut = `${compacte(date)}T${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}00`;
    const finH = `${compacte(date)}T${String(h + 1).padStart(2, "0")}${String(m).padStart(2, "0")}00`;
    lignes.push(`DTSTART:${debut}`, `DTEND:${finH}`);
  } else {
    // Journée(s) entière(s) : DTEND est exclusif — le lendemain du dernier
    // jour couvert.
    const dernier = fin || date;
    const lendemain = new Date(`${dernier}T00:00:00Z`);
    lendemain.setUTCDate(lendemain.getUTCDate() + 1);
    lignes.push(
      `DTSTART;VALUE=DATE:${compacte(date)}`,
      `DTEND;VALUE=DATE:${compacte(lendemain.toISOString().slice(0, 10))}`,
    );
  }

  lignes.push(`SUMMARY:${echapperIcs(titre)}`);
  if (detail) lignes.push(`LOCATION:${echapperIcs(detail)}`);
  lignes.push(
    `DESCRIPTION:${echapperIcs(`Invitation envoyée depuis l'agenda de ${organisateur}.`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  );

  // Le format exige des fins de ligne CRLF.
  return lignes.join("\r\n") + "\r\n";
};

export const MOIS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

export const JOURS_FR = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];

/// Date lisible : « lundi 7 août ».
export const dateLisible = (iso) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  const jours = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  return `${jours[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS_FR[d.getUTCMonth()]}`;
};

// Règles du CRM, en fonctions pures.
//
// Rien ici ne connaît React ni l'API : on entre des enregistrements, on
// sort des chiffres et des listes ordonnées.
//
// PRINCIPE CENTRAL — un CRM n'est pas un carnet d'adresses.
//
// Ce qui a de la valeur, ce n'est pas la fiche du client : c'est
// l'historique de la relation et **la prochaine chose à faire**. Une fiche
// sans date de rappel est une fiche qu'on oublie. Tout ce fichier tourne
// autour de cette question : qui faut-il relancer aujourd'hui ?

export const STATUTS = {
  prospect: { label: "Prospect", ton: "info" },
  actif: { label: "Client actif", ton: "ok" },
  inactif: { label: "Inactif", ton: "idle" },
};

/// Étapes du pipeline commercial, dans l'ordre.
///
/// `probabilite` sert à pondérer le pipeline : additionner des affaires au
/// premier contact et des affaires en négociation donne un chiffre qui ne
/// veut rien dire et sur lequel personne ne peut décider.
export const ETAPES = {
  contact: { label: "Premier contact", probabilite: 10, ton: "idle" },
  qualifie: { label: "Qualifiée", probabilite: 30, ton: "info" },
  devis: { label: "Devis envoyé", probabilite: 50, ton: "info" },
  negociation: { label: "Négociation", probabilite: 75, ton: "warn" },
  gagnee: { label: "Gagnée", probabilite: 100, ton: "ok" },
  perdue: { label: "Perdue", probabilite: 0, ton: "bad" },
};

export const ETAPES_OUVERTES = ["contact", "qualifie", "devis", "negociation"];

/// Types d'interaction. Une tâche est une activité qui porte une échéance
/// et qui n'est pas encore faite — pas une entité séparée : c'est la même
/// chronologie, et la séparer obligerait à regarder à deux endroits.
export const ACTIVITES = {
  appel: { label: "Appel", icone: "faPhone", ton: "info" },
  reunion: { label: "Rendez-vous", icone: "faHandshake", ton: "info" },
  email: { label: "E-mail", icone: "faEnvelope", ton: "idle" },
  note: { label: "Note", icone: "faNoteSticky", ton: "idle" },
  tache: { label: "Tâche", icone: "faListCheck", ton: "warn" },
};

export const today = () => new Date().toISOString().slice(0, 10);

export const plusJours = (jours, depuis) => {
  const d = depuis ? new Date(depuis) : new Date();
  d.setDate(d.getDate() + jours);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/// Valeur pondérée d'une affaire : montant × probabilité de son étape.
export const valeurPonderee = (opp) => {
  const d = opp.data || opp;
  const montant = Number(d.montant) || 0;
  // Une probabilité saisie à la main prime sur celle de l'étape : un
  // commercial qui connaît son dossier en sait plus que le tableau.
  const p =
    d.probabilite === undefined || d.probabilite === null || d.probabilite === ""
      ? (ETAPES[d.etape]?.probabilite ?? 0)
      : Number(d.probabilite);
  return (montant * p) / 100;
};

/// Pipeline par étape : combien d'affaires, pour quel montant.
export const pipeline = (opportunites) =>
  Object.entries(ETAPES)
    .filter(([id]) => ETAPES_OUVERTES.includes(id))
    .map(([id, e]) => {
      const liste = opportunites.filter((o) => o.data.etape === id);
      return {
        id,
        label: e.label,
        ton: e.ton,
        nombre: liste.length,
        montant: liste.reduce((s, o) => s + (Number(o.data.montant) || 0), 0),
        pondere: liste.reduce((s, o) => s + valeurPonderee(o), 0),
      };
    });

/// Taux de transformation : gagnées sur affaires closes.
///
/// Sur les affaires **closes** uniquement. Rapporter les gagnées au total
/// ferait chuter le taux à chaque nouvelle affaire ouverte, ce qui n'a
/// aucun sens : une affaire en cours n'est ni gagnée ni perdue.
export const tauxTransformation = (opportunites) => {
  const gagnees = opportunites.filter((o) => o.data.etape === "gagnee");
  const perdues = opportunites.filter((o) => o.data.etape === "perdue");
  const closes = gagnees.length + perdues.length;
  if (!closes) return null;
  return {
    taux: Math.round((gagnees.length / closes) * 100),
    gagnees: gagnees.length,
    perdues: perdues.length,
    montantGagne: gagnees.reduce((s, o) => s + (Number(o.data.montant) || 0), 0),
  };
};

// ---------------------------------------------------------------------------
// Relance
// ---------------------------------------------------------------------------

/// La prochaine action prévue pour un client : la tâche non faite dont
/// l'échéance est la plus proche. `null` s'il n'y en a aucune — et c'est
/// précisément le cas qu'il faut savoir repérer.
export const prochaineAction = (clientId, activites) => {
  const taches = activites
    .filter(
      (a) =>
        a.data.clientId === clientId &&
        a.data.type === "tache" &&
        !a.data.fait &&
        a.data.echeance,
    )
    .sort((a, b) => (a.data.echeance < b.data.echeance ? -1 : 1));
  return taches[0] || null;
};

/// Dernier contact effectif — ce qui a eu lieu, pas ce qui est prévu.
export const dernierContact = (clientId, activites) => {
  const faits = activites
    .filter((a) => a.data.clientId === clientId && a.data.type !== "tache")
    .sort((a, b) => (a.data.date < b.data.date ? 1 : -1));
  return faits[0] || null;
};

/// Nombre de jours depuis le dernier contact, ou `null` si jamais contacté.
export const jourssansContact = (clientId, activites, maintenant = today()) => {
  const dernier = dernierContact(clientId, activites);
  if (!dernier) return null;
  return Math.round((new Date(maintenant) - new Date(dernier.data.date)) / 86400000);
};

/// Ce qu'il faut faire aujourd'hui : tâches en retard d'abord, puis celles
/// du jour, puis les suivantes. C'est la liste sur laquelle on ouvre.
export const aFaire = (activites, maintenant = today(), horizon = 7) => {
  const limite = plusJours(horizon, maintenant);
  return activites
    .filter(
      (a) =>
        a.data.type === "tache" &&
        !a.data.fait &&
        a.data.echeance &&
        a.data.echeance <= limite,
    )
    .sort((a, b) => (a.data.echeance < b.data.echeance ? -1 : 1))
    .map((a) => ({
      activite: a,
      enRetard: a.data.echeance < maintenant,
      aujourdhui: a.data.echeance === maintenant,
    }));
};

/// Clients sans nouvelle depuis trop longtemps. Un portefeuille se perd
/// par le silence, pas par les refus.
export const clientsDormants = (clients, activites, seuilJours = 60, maintenant = today()) =>
  clients
    .filter((c) => c.data.statut !== "inactif")
    .map((c) => ({ client: c, jours: jourssansContact(c.id, activites, maintenant) }))
    // `null` = jamais contacté : c'est le cas le plus urgent, pas le moins.
    .filter((x) => x.jours === null || x.jours >= seuilJours)
    .sort((a, b) => (b.jours ?? Infinity) - (a.jours ?? Infinity));

// ---------------------------------------------------------------------------
// Vue client
// ---------------------------------------------------------------------------

/// Chiffre d'affaires réalisé avec un client, lu dans les documents de la
/// Facturation. Les devis et les brouillons sont exclus : ce ne sont pas
/// des ventes. Les avoirs comptent en négatif.
export const chiffreAffaires = (clientId, documents, totauxDe) => {
  let total = 0;
  for (const d of documents) {
    if (d.data.clientId !== clientId) continue;
    if (d.data.type === "devis" || d.data.statut === "brouillon") continue;
    if (d.data.statut === "annule") continue;
    total += totauxDe(d.data).ttc * (d.data.type === "avoir" ? -1 : 1);
  }
  return total;
};

/// Chronologie complète d'un client : activités et affaires mêlées, du plus
/// récent au plus ancien. C'est la page qu'on regarde avant de décrocher
/// son téléphone.
export const chronologie = (clientId, activites, opportunites) => {
  const evenements = [
    ...activites
      .filter((a) => a.data.clientId === clientId)
      .map((a) => ({
        id: a.id,
        genre: "activite",
        date: a.data.echeance || a.data.date,
        record: a,
      })),
    ...opportunites
      .filter((o) => o.data.clientId === clientId)
      .map((o) => ({
        id: o.id,
        genre: "opportunite",
        date: o.data.dateCloture || o.createdAt.slice(0, 10),
        record: o,
      })),
  ];
  return evenements.sort((a, b) => (a.date < b.date ? 1 : -1));
};

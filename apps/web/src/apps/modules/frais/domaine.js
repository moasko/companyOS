// Notes de frais — les règles, sans React.
//
// ─────────────────────────────────────────────────────────────────────────
// LA PETITE DÉPENSE QUI FAIT LES GROS TROUS
//
// Le taxi du commercial, le carburant de la livraison, le déjeuner avec
// un client : payés de la poche du salarié, remboursés « quand on
// pense ». Sans circuit, c'est de l'argent qui fuit sans trace — et des
// salariés qui avancent les frais de l'entreprise sans garantie.
//
// Le circuit : le salarié **soumet** (avec le reçu photographié — pas de
// justificatif, pas de remboursement), le responsable **approuve** ou
// refuse, puis marque **remboursée** quand l'argent est parti. Chaque
// note approuvée propose son écriture à la Comptabilité : la charge au
// compte de sa catégorie, la dette au compte du personnel — le SYSCOHADA
// sans qu'on le voie.
// ─────────────────────────────────────────────────────────────────────────

/// Les catégories, chacune avec son compte de charge SYSCOHADA. La
/// catégorie choisit le compte : personne n'a besoin de connaître le plan
/// comptable pour se faire rembourser un taxi.
export const CATEGORIES = {
  transport: { label: "Transport & taxi", compte: "614", icone: "faTaxi" },
  carburant: { label: "Carburant", compte: "605", icone: "faGasPump" },
  repas: { label: "Repas & réception", compte: "638", icone: "faUtensils" },
  hebergement: { label: "Hébergement", compte: "638", icone: "faBed" },
  fournitures: { label: "Fournitures & petit matériel", compte: "605", icone: "faBoxOpen" },
  communication: { label: "Téléphone & internet", compte: "628", icone: "faPhone" },
  autre: { label: "Autre dépense", compte: "638", icone: "faReceipt" },
};

export const ETATS = {
  soumise: { label: "À valider", ton: "warn" },
  approuvee: { label: "Approuvée", ton: "ok" },
  refusee: { label: "Refusée", ton: "bad" },
  remboursee: { label: "Remboursée", ton: "idle" },
};

export const NOTE_VIDE = {
  date: "",
  categorie: "transport",
  montant: "",
  description: "",
  justificatif: null, // { id, name, mimeType, size } — le nœud du cloud
  etat: "soumise",
};

export const today = () => new Date().toISOString().slice(0, 10);

/// Ce qui rend une note irrecevable — null si tout va bien.
export const problemeNote = (note, maintenant = today()) => {
  if (!note.date) return "Indiquez la date de la dépense.";
  if (note.date > maintenant) return "Une dépense ne se date pas dans le futur.";
  const montant = Number(note.montant);
  if (!montant || montant <= 0) return "Indiquez le montant payé.";
  if (!CATEGORIES[note.categorie]) return "Choisissez une catégorie.";
  if (!String(note.description || "").trim()) {
    return "Dites en un mot de quoi il s'agit — le responsable et le comptable vous liront.";
  }
  if (!note.justificatif) return "Joignez le reçu : pas de justificatif, pas de remboursement.";
  return null;
};

/// Les notes d'un salarié, les plus récentes d'abord.
export const mesNotes = (notes = [], salarieId) =>
  notes
    .filter((n) => n.data.salarieId === salarieId)
    .sort((a, b) => (b.data.date || "").localeCompare(a.data.date || ""));

/// Totaux d'une liste de notes, par état.
export const totauxDe = (notes = []) => {
  const somme = (etat) =>
    notes
      .filter((n) => n.data.etat === etat)
      .reduce((s, n) => s + (Number(n.data.montant) || 0), 0);
  return {
    soumises: somme("soumise"),
    approuvees: somme("approuvee"),
    remboursees: somme("remboursee"),
  };
};

/// L'écriture comptable d'une note approuvée : la charge dans le compte
/// de sa catégorie, la dette envers le salarié au compte du personnel.
/// Même forme que les autres propositions (voir Comptabilité) ; `origine`
/// évite qu'une note soit comptabilisée deux fois.
export const ecritureDeNote = (note, noteId, nomSalarie = "salarié") => {
  const categorie = CATEGORIES[note.categorie] || CATEGORIES.autre;
  const montant = Number(note.montant) || 0;
  return {
    date: note.date,
    libelle: `Note de frais — ${categorie.label} (${nomSalarie})`,
    piece: `NDF-${note.date}`,
    tiers: nomSalarie,
    origine: `frais:${noteId}`,
    lignes: [
      { compte: categorie.compte, debit: montant, credit: 0 },
      { compte: "421", debit: 0, credit: montant },
    ],
  };
};

export { montant as fcfa } from "../../../utils/monnaie";

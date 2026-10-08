// Comptabilité — relevés bancaires et rapprochement.
//
// Le rapprochement répond à une seule question : ce que dit la banque et ce
// que disent les livres racontent-ils la même histoire ? Chaque ligne du
// relevé doit retrouver son écriture ; ce qui reste d'un côté ou de l'autre
// est soit un oubli de saisie (des frais, un prélèvement), soit une
// opération pas encore passée en banque (un chèque non encaissé).
//
// Pas d'API bancaire ici : en Côte d'Ivoire, les banques fournissent un
// relevé CSV ou OFX depuis leur espace client, et c'est ce qu'on importe.

import { lignesDe } from "./domaine.js";

// ---------------------------------------------------------------------------
// Lecture d'un relevé
// ---------------------------------------------------------------------------

/// « 1 234 567,50 », « -6500 », « 6.500,00 » → nombre.
export const lireMontant = (v) => {
  let s = String(v ?? "").trim().replace(/[\s  ]/g, "").replace(/[A-Za-z€$]/g, "");
  if (!s) return 0;
  const negatif = /^\(.*\)$/.test(s) || s.endsWith("-");
  s = s.replace(/[()]/g, "").replace(/-$/, "");
  if (s.includes(",") && s.includes(".")) {
    // Le dernier séparateur est la décimale.
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const x = Number(s);
  if (!Number.isFinite(x)) return 0;
  return negatif ? -Math.abs(x) : x;
};

/// « 05/10/2026 », « 5-10-26 », « 2026-10-05 », « 20261005 » → ISO.
export const lireDate = (v) => {
  const s = String(v ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) {
    const a = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${a}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return "";
};

const decouper = (ligne, sep) => {
  const out = [];
  let cur = "";
  let guillemets = false;
  for (let i = 0; i < ligne.length; i += 1) {
    const c = ligne[i];
    if (c === '"') {
      if (guillemets && ligne[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else guillemets = !guillemets;
    } else if (c === sep && !guillemets) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
};

const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const COLONNES = {
  date: ["date operation", "date d'operation", "date", "date valeur", "date de valeur"],
  libelle: ["libelle", "libelle operation", "description", "intitule", "operation", "motif", "details"],
  debit: ["debit", "montant debit", "sortie", "retrait"],
  credit: ["credit", "montant credit", "entree", "depot"],
  montant: ["montant", "amount", "somme"],
  solde: ["solde", "balance", "solde apres operation"],
  reference: ["reference", "ref", "ref.", "numero", "n°"],
};

const trouverColonne = (entetes, noms) => {
  const e = entetes.map(norm);
  for (const nom of noms) {
    const i = e.indexOf(nom);
    if (i >= 0) return i;
  }
  for (const nom of noms) {
    const i = e.findIndex((x) => x.startsWith(nom));
    if (i >= 0) return i;
  }
  return -1;
};

const lireCsv = (texte) => {
  const brutes = texte.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!brutes.length) return { lignes: [], solde: null };
  const sep = [";", "\t", ","].sort(
    (a, b) => brutes[0].split(b).length - brutes[0].split(a).length,
  )[0];

  // La ligne d'en-tête n'est pas toujours la première : les banques
  // ajoutent souvent le nom du compte et la période au-dessus.
  let iEntete = brutes.findIndex((l) => {
    const c = decouper(l, sep).map(norm);
    return c.some((x) => x.startsWith("date")) && c.some((x) => /libell|descr|operation|motif/.test(x));
  });
  if (iEntete < 0) iEntete = 0;
  const entetes = decouper(brutes[iEntete], sep);
  const col = Object.fromEntries(
    Object.entries(COLONNES).map(([k, noms]) => [k, trouverColonne(entetes, noms)]),
  );
  if (col.date < 0 || col.libelle < 0 || (col.montant < 0 && col.debit < 0 && col.credit < 0)) {
    throw new Error(
      "Colonnes introuvables : le relevé doit avoir une date, un libellé et un montant (ou débit et crédit).",
    );
  }

  const lignes = [];
  let solde = null;
  for (const brute of brutes.slice(iEntete + 1)) {
    const c = decouper(brute, sep);
    const date = lireDate(c[col.date]);
    if (!date) continue;
    const montant =
      col.montant >= 0 && String(c[col.montant] || "").trim()
        ? lireMontant(c[col.montant])
        : lireMontant(c[col.credit]) - Math.abs(lireMontant(c[col.debit]));
    if (!montant) continue;
    lignes.push({
      date,
      libelle: c[col.libelle] || "",
      montant: Math.round(montant),
      reference: col.reference >= 0 ? c[col.reference] || "" : "",
    });
    if (col.solde >= 0 && String(c[col.solde] || "").trim()) solde = Math.round(lireMontant(c[col.solde]));
  }
  return { lignes, solde };
};

const lireOfx = (texte) => {
  const balise = (bloc, nom) => {
    const m = new RegExp(`<${nom}>([^<\\r\\n]*)`, "i").exec(bloc);
    return m ? m[1].trim() : "";
  };
  const lignes = [];
  for (const m of texte.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|<\/BANKTRANLIST>)/gi)) {
    const bloc = m[1];
    const montant = Math.round(lireMontant(balise(bloc, "TRNAMT").replace(",", ".")));
    const date = lireDate(balise(bloc, "DTPOSTED"));
    if (!date || !montant) continue;
    lignes.push({
      date,
      libelle: [balise(bloc, "NAME"), balise(bloc, "MEMO")].filter(Boolean).join(" — "),
      montant,
      reference: balise(bloc, "FITID") || balise(bloc, "CHECKNUM"),
    });
  }
  const s = /<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]+)/i.exec(texte);
  return { lignes, solde: s ? Math.round(lireMontant(s[1].replace(",", "."))) : null };
};

/// Lit un relevé CSV ou OFX. Chaque ligne reçoit un identifiant stable,
/// calculé sur son contenu : réimporter le même relevé ne crée pas de
/// doublons.
export const lireReleve = (texte, nomFichier = "") => {
  const ofx = /\.(ofx|qfx)$/i.test(nomFichier) || /<OFX>|<STMTTRN>/i.test(texte);
  const { lignes, solde } = ofx ? lireOfx(texte) : lireCsv(texte);
  if (!lignes.length) throw new Error("Aucune opération lisible dans ce relevé.");
  const vus = new Map();
  const avecId = lignes
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((l) => {
      const base = `${l.date}|${l.montant}|${norm(l.libelle).slice(0, 40)}`;
      const k = (vus.get(base) || 0) + 1;
      vus.set(base, k);
      return { ...l, id: `${base}|${k}` };
    });
  return {
    lignes: avecId,
    solde,
    du: avecId[0].date,
    au: avecId[avecId.length - 1].date,
  };
};

/// Fusionne un nouveau relevé dans les lignes déjà importées d'un compte —
/// une ligne déjà connue garde son pointage.
export const fusionnerReleve = (existantes, nouvelles) => {
  const parId = new Map((existantes || []).map((l) => [l.id, l]));
  let ajoutees = 0;
  for (const l of nouvelles) {
    if (!parId.has(l.id)) {
      parId.set(l.id, l);
      ajoutees += 1;
    }
  }
  return {
    lignes: [...parId.values()].sort((a, b) => a.date.localeCompare(b.date)),
    ajoutees,
  };
};

// ---------------------------------------------------------------------------
// Rapprochement
// ---------------------------------------------------------------------------

/// Lignes du journal sur un compte de trésorerie, avec leur clé
/// « écriture#rang » et leur montant signé (+ entrée, − sortie).
export const lignesTresorerie = (ecritures, compte) => {
  const out = [];
  for (const e of ecritures) {
    const d = e.data || e;
    (d.lignes || []).forEach((l, rang) => {
      if (String(l.compte) !== compte) return;
      out.push({
        cle: `${e.id}#${rang}`,
        ecritureId: e.id,
        date: d.date,
        libelle: l.libelle || d.libelle,
        piece: d.numero || d.piece || "",
        tiers: l.tiers || d.tiers || "",
        montant: Math.round((Number(l.debit) || 0) - (Number(l.credit) || 0)),
      });
    });
  }
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
};

/// Règles proposées d'office : les libellés qu'on retrouve sur tous les
/// relevés ivoiriens. L'utilisateur ajoute les siennes.
export const REGLES_DEFAUT = [
  { contient: "FRAIS", compte: "631", libelle: "Frais bancaires" },
  { contient: "COMMISSION", compte: "631", libelle: "Frais bancaires" },
  { contient: "AGIOS", compte: "671", libelle: "Intérêts bancaires" },
  { contient: "CIE", compte: "605", libelle: "Électricité" },
  { contient: "SODECI", compte: "605", libelle: "Eau" },
  { contient: "VERSEMENT ESPECES", compte: "585", libelle: "Versement d'espèces" },
  { contient: "CNPS", compte: "431", libelle: "Cotisations CNPS" },
];

// Les mots que portent presque toutes les lignes : les voir en commun ne
// prouve rien.
const VIDES = new Set(["vir", "virement", "recu", "recue", "prlv", "prelevement", "paiement", "reglement", "fac", "facture", "frais", "les", "des", "pour", "sur", "par"]);

const mots = (s) => new Set(norm(s).split(/[^a-z0-9]+/).filter((m) => m.length > 2 && !VIDES.has(m)));

/// La règle qui s'applique à un libellé, ou null. Les règles de
/// l'utilisateur passent avant celles d'office.
export const regleDe = (libelle, regles = []) => {
  const lib = ` ${norm(libelle)} `;
  return (
    regles.find((r) => r.contient && lib.includes(norm(r.contient))) ||
    REGLES_DEFAUT.find((r) => {
      const c = norm(r.contient);
      // « CIE » ne doit pas trouver « AGENCIER » : on exige un mot entier.
      return new RegExp(`(^|[^a-z0-9])${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(lib);
    }) ||
    null
  );
};

const jours = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

/// Propositions de rapprochement pour les lignes non pointées.
///
/// Pour chaque ligne du relevé : même montant d'abord, puis la proximité
/// des dates, puis les mots en commun (numéro de facture, nom du tiers).
/// Une ligne comptable n'est proposée qu'une fois. Sans correspondance, on
/// propose une écriture à créer — d'après une règle si le libellé en
/// déclenche une.
export const rapprocher = ({ releve = [], comptables = [], pointees = new Set(), regles = [] }) => {
  const libres = comptables.filter((c) => !pointees.has(c.cle));
  const prises = new Set();
  const out = [];
  for (const l of releve) {
    if (l.ecriture) continue;
    const candidats = libres
      .filter((c) => !prises.has(c.cle) && c.montant === l.montant && jours(c.date, l.date) <= 31)
      .map((c) => {
        // Un numéro en commun (de facture, de chèque) vaut plus qu'un nom.
        const communs = [...mots(`${c.libelle} ${c.piece} ${c.tiers}`)]
          .filter((m) => mots(`${l.libelle} ${l.reference}`).has(m))
          .sort((a, b) => Number(/\d/.test(b)) - Number(/\d/.test(a)) || b.length - a.length);
        const score = 100 - jours(c.date, l.date) * 2 + communs.length * 15;
        return { c, score, communs };
      })
      .sort((a, b) => b.score - a.score);
    if (candidats.length) {
      const { c, communs } = candidats[0];
      prises.add(c.cle);
      out.push({
        ligne: l,
        type: "correspondance",
        comptable: c,
        raison: communs.length
          ? `Même montant, « ${communs[0].toUpperCase()} » cité`
          : jours(c.date, l.date) < 1
            ? "Même montant, même jour"
            : `Même montant, ${Math.round(jours(c.date, l.date))} j d'écart`,
      });
      continue;
    }
    const regle = regleDe(l.libelle, regles);
    out.push({
      ligne: l,
      type: "creer",
      regle,
      raison: regle
        ? `Règle « ${regle.contient} » → ${regle.compte} ${regle.libelle || ""}`.trim()
        : "Aucune écriture correspondante",
    });
  }
  return out;
};

/// L'écriture qui constate une ligne du relevé sans contrepartie au
/// journal : la banque d'un côté, le compte choisi de l'autre.
export const ecritureDeLigne = ({ ligne, compteBanque, compte, tiers, journal = "BQ" }) => {
  const m = Math.abs(Math.round(ligne.montant));
  const entree = ligne.montant > 0;
  const lignes = entree
    ? [
        { compte: compteBanque, debit: m, credit: 0 },
        { compte, debit: 0, credit: m },
      ]
    : [
        { compte, debit: m, credit: 0 },
        { compte: compteBanque, debit: 0, credit: m },
      ];
  if (tiers) lignes.forEach((l) => /^4(0|1)/.test(l.compte) && (l.tiers = tiers));
  return {
    journal,
    date: ligne.date,
    libelle: ligne.libelle || "Opération bancaire",
    piece: ligne.reference || "",
    tiers: tiers || "",
    lignes,
    source: "Banque",
  };
};

/// Où en est le rapprochement d'un compte.
export const etatRapprochement = ({ releve = [], soldeReleve = null, ecritures = [], compte, au }) => {
  const dansPeriode = (d) => !au || String(d) <= au;
  const lignes = releve.filter((l) => dansPeriode(l.date));
  const pointees = lignes.filter((l) => l.ecriture).length;
  const soldeComptable = lignesDe(ecritures, au ? { au } : undefined)
    .filter((l) => String(l.compte) === compte)
    .reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0);
  return {
    total: lignes.length,
    pointees,
    restantes: lignes.length - pointees,
    soldeReleve,
    soldeComptable: Math.round(soldeComptable),
    ecart: soldeReleve == null ? null : Math.round(soldeReleve - soldeComptable),
  };
};

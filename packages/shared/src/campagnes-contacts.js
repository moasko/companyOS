// Campagnes — l'import de contacts.
//
// Un seul fichier de contacts dans CompanyOS : le CRM. Importer un CSV
// (salon, ancien outil, carnet d'adresses) ne crée donc pas une liste à
// part : il crée des fiches prospects, ou complète celles qui existent,
// avec la source et la date du consentement. Le moteur d'envoi n'écrit
// qu'aux fiches du CRM — un import qui contournerait le CRM ne partirait
// jamais.
//
// Une personne désinscrite n'est jamais réabonnée par un import : son
// refus vaut plus qu'une ligne de tableur.

import { adresseValide } from "./courrier.js";

/// Lit un CSV : séparateur deviné (« ; », « , » ou tabulation), guillemets
/// et retours à la ligne dans les champs, BOM retiré.
export const lireCsv = (texte = "") => {
  const brut = String(texte).replace(/^\uFEFF/, "");
  const premiere = brut.split(/\r?\n/)[0] || "";
  const compte = (c) => premiere.split(c).length - 1;
  const separateur = [";", ",", "\t"].sort((a, b) => compte(b) - compte(a))[0];
  const lignes = [];
  let ligne = [];
  let champ = "";
  let guillemets = false;
  for (let i = 0; i < brut.length; i += 1) {
    const c = brut[i];
    if (guillemets) {
      if (c === '"' && brut[i + 1] === '"') {
        champ += '"';
        i += 1;
      } else if (c === '"') guillemets = false;
      else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === separateur) {
      ligne.push(champ);
      champ = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && brut[i + 1] === "\n") i += 1;
      ligne.push(champ);
      if (ligne.some((x) => x.trim())) lignes.push(ligne);
      ligne = [];
      champ = "";
    } else champ += c;
  }
  ligne.push(champ);
  if (ligne.some((x) => x.trim())) lignes.push(ligne);
  const [entetes = [], ...reste] = lignes;
  return { separateur, entetes: entetes.map((e) => e.trim()), lignes: reste };
};

/// Les champs de fiche qu'une colonne peut remplir.
export const CHAMPS_IMPORT = [
  "ignorer",
  "entreprise",
  "nom",
  "email",
  "telephone",
  "ville",
  "secteur",
  "etiquettes",
];

const sansAccent = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/// Le champ le plus probable pour chaque en-tête.
export const devinerColonnes = (entetes = []) => {
  const pris = new Set();
  return entetes.map((e) => {
    const t = sansAccent(e);
    const regles = [
      ["email", /mail|courriel/],
      ["telephone", /tel|phone|mobile|portable|whatsapp/],
      ["entreprise", /societe|entreprise|company|organisation|raison/],
      ["nom", /nom|name|contact|prenom|personne/],
      ["ville", /ville|city|commune|localite/],
      ["secteur", /secteur|activite|industry|domaine/],
      ["etiquettes", /tag|etiquette|label|categorie/],
    ];
    const r = regles.find(([champ, re]) => re.test(t) && !pris.has(champ));
    if (!r) return "ignorer";
    pris.add(r[0]);
    return r[0];
  });
};

const decouperEtiquettes = (v) =>
  String(v || "")
    .split(/[,;|]/)
    .map((x) => x.trim())
    .filter(Boolean);

/// Ce que l'import va faire, avant de le faire. Rien n'est écrit ici.
///
/// Renvoie { nouveaux: [data], misAJour: [{ id, data }], doublons,
/// invalides, desinscrits, total }.
export const planImport = ({
  lignes = [],
  colonnes = [],
  clients = [],
  etiquettes = [],
  consentement = null,
  statut = "prospect",
} = {}) => {
  const parEmail = new Map(
    clients
      .filter((c) => c.data?.email)
      .map((c) => [String(c.data.email).trim().toLowerCase(), c]),
  );
  const vus = new Set();
  const out = {
    nouveaux: [],
    misAJour: [],
    doublons: 0,
    invalides: 0,
    desinscrits: 0,
    total: lignes.length,
  };
  const enPlus = etiquettes.map((e) => String(e).trim()).filter(Boolean);

  for (const ligne of lignes) {
    const v = {};
    colonnes.forEach((champ, i) => {
      if (!champ || champ === "ignorer") return;
      const x = String(ligne[i] ?? "").trim();
      if (!x) return;
      if (champ === "etiquettes")
        v.etiquettes = [...(v.etiquettes || []), ...decouperEtiquettes(x)];
      else if (!v[champ]) v[champ] = x;
    });
    const email = String(v.email || "")
      .trim()
      .toLowerCase();
    if (!adresseValide(email)) {
      out.invalides += 1;
      continue;
    }
    if (vus.has(email)) {
      out.doublons += 1;
      continue;
    }
    vus.add(email);
    const tags = [...new Set([...(v.etiquettes || []), ...enPlus])];
    const existant = parEmail.get(email);

    if (existant) {
      if (existant.data.emailDesinscrit) {
        out.desinscrits += 1;
        continue;
      }
      // On complète, on n'écrase pas : la fiche du CRM a été tenue à la
      // main, elle a raison sur le fichier.
      const data = { ...existant.data };
      for (const k of ["entreprise", "nom", "telephone", "ville", "secteur"])
        if (!data[k] && v[k]) data[k] = v[k];
      data.etiquettes = [...new Set([...(data.etiquettes || []), ...tags])];
      if (consentement && !data.consentement) data.consentement = consentement;
      out.misAJour.push({ id: existant.id, data });
    } else {
      out.nouveaux.push({
        statut,
        entreprise: v.entreprise || "",
        nom: v.nom || v.entreprise || email,
        email,
        telephone: v.telephone || "",
        ville: v.ville || "",
        secteur: v.secteur || "",
        etiquettes: tags,
        source: "import",
        ...(consentement ? { consentement } : {}),
      });
    }
  }
  return out;
};

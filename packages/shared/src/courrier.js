// Courrier — les règles, sans React.
//
// Peu de calcul ici : le courrier est affaire de validation. Mais cette
// validation mérite d'être juste — un mail refusé pour une adresse valide
// agace, un mail parti vers une adresse impossible se perd en silence.

/// Une adresse plausible : quelque chose @ quelque chose . quelque chose.
/// On ne rejoue pas la RFC 5322 — les vraies boîtes des clients sont
/// simples, et le relais SMTP fera le contrôle final.
export const adresseValide = (a) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(a || "").trim());

/// Découpe un champ « À » écrit à la main : virgules ou points-virgules,
/// espaces tolérés, doublons retirés en gardant l'ordre.
export const adressesDe = (champ) => {
  const vues = new Set();
  return String(champ || "")
    .split(/[,;]/)
    .map((a) => a.trim())
    .filter((a) => {
      if (!a || vues.has(a.toLowerCase())) return false;
      vues.add(a.toLowerCase());
      return true;
    });
};

/// Les adresses invalides d'un champ « À » — vide si tout va bien.
export const adressesInvalides = (champ) =>
  adressesDe(champ).filter((a) => !adresseValide(a));

/// Prêt à partir : au moins une adresse, toutes valides, un sujet, un corps.
export const pretAEnvoyer = ({ a, sujet, texte }) => {
  const liste = adressesDe(a);
  return (
    liste.length > 0 &&
    liste.every(adresseValide) &&
    String(sujet || "").trim().length > 0 &&
    String(texte || "").trim().length > 0
  );
};

/// Extrait d'un corps de message pour la liste des envois.
export const extraitDe = (texte, longueur = 90) => {
  const plat = String(texte || "").replace(/\s+/g, " ").trim();
  return plat.length <= longueur ? plat : `${plat.slice(0, longueur - 1)}…`;
};

// ---------------------------------------------------------------------------
// Modèles de messages
// ---------------------------------------------------------------------------
//
// Un modèle est un sujet et un corps où des variables `{{nom}}` attendent
// leur valeur : `{{client}}`, `{{numero}}`, `{{montant}}`... Les
// intégrations (relances de factures, devis) fournissent les valeurs ;
// utilisé à la main, le modèle garde ses variables visibles — mieux vaut
// un `{{client}}` qui saute aux yeux qu'un trou silencieux.

/// Les variables que les intégrations savent remplir, pour l'aide-mémoire
/// de l'éditeur de modèles.
export const VARIABLES_MODELES = [
  { nom: "client", exemple: "Koné Distribution" },
  { nom: "numero", exemple: "FAC-2026-0042" },
  { nom: "montant", exemple: "1 250 000 F CFA" },
  { nom: "echeance", exemple: "15/08/2026" },
  { nom: "entreprise", exemple: "votre entreprise" },
  { nom: "utilisateur", exemple: "qui envoie" },
];

/// Remplace les variables connues ; les inconnues restent telles quelles.
/// Les espaces autour du nom sont tolérés : `{{ client }}` vaut `{{client}}`.
export const appliquerModele = (gabarit, variables = {}) =>
  String(gabarit || "").replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (tout, nom) =>
    variables[nom] !== undefined && variables[nom] !== null
      ? String(variables[nom])
      : tout,
  );

/// Les variables présentes dans un gabarit — pour prévenir quand un envoi
/// va partir avec un `{{...}}` non rempli.
export const variablesDe = (gabarit) => {
  const vues = new Set();
  for (const m of String(gabarit || "").matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)) {
    vues.add(m[1]);
  }
  return [...vues];
};

// ---------------------------------------------------------------------------
// Carnet d'adresses
// ---------------------------------------------------------------------------
//
// Le CRM connaît les clients, les RH connaissent l'équipe : le carnet se
// construit à partir d'eux, jamais à la main. Une adresse en double (un
// client qui est aussi salarié) n'apparaît qu'une fois — la première
// source gagne.

/// Fusionne les fiches en contacts { email, nom, source }.
export const contactsDe = ({ clients = [], salaries = [] } = {}) => {
  const vus = new Set();
  const out = [];
  const ajouter = (email, nom, source) => {
    const cle = String(email || "").trim().toLowerCase();
    if (!cle || !adresseValide(cle) || vus.has(cle)) return;
    vus.add(cle);
    out.push({ email: cle, nom: nom || cle, source });
  };
  for (const c of clients) {
    ajouter(c.data?.email, c.data?.entreprise || c.data?.nom, "Client");
  }
  for (const s of salaries) {
    ajouter(s.data?.email, `${s.data?.prenom || ""} ${s.data?.nom || ""}`.trim(), "Équipe");
  }
  return out;
};

/// Le morceau d'adresse en cours de frappe : ce qui suit la dernière
/// virgule (ou point-virgule).
export const tokenCourant = (champ) => {
  const morceaux = String(champ || "").split(/[,;]/);
  return morceaux[morceaux.length - 1].trim();
};

/// Les contacts qui correspondent à la saisie en cours — sans reproposer
/// une adresse déjà dans le champ. Deux lettres au moins : suggérer sur
/// une lettre gêne plus qu'il n'aide.
export const suggererContacts = (contacts, champ, limite = 6) => {
  const token = tokenCourant(champ).toLowerCase();
  if (token.length < 2) return [];
  const deja = new Set(adressesDe(champ).slice(0, -1).map((a) => a.toLowerCase()));
  return contacts
    .filter(
      (c) =>
        !deja.has(c.email) &&
        (c.email.includes(token) || c.nom.toLowerCase().includes(token)),
    )
    .slice(0, limite);
};

/// Remplace le morceau en cours de frappe par l'adresse choisie.
export const insererContact = (champ, email) => {
  const morceaux = String(champ || "").split(/[,;]/);
  morceaux[morceaux.length - 1] = ` ${email}`;
  return morceaux.join(",").replace(/^ /, "");
};

/// Initiales d'une adresse, pour la pastille de la liste : la partie
/// locale, découpée sur points et tirets. « awa.kone@… » → « AK ».
export const initialesDe = (adresse) => {
  const locale = String(adresse || "").split("@")[0];
  const morceaux = locale.split(/[._-]+/).filter(Boolean);
  const lettres =
    morceaux.length >= 2
      ? morceaux[0][0] + morceaux[1][0]
      : locale.slice(0, 2);
  return (lettres || "?").toUpperCase();
};

/// Une couleur stable par adresse, pour que la même personne garde la
/// même pastille d'une fois sur l'autre.
export const teinteDe = (adresse) => {
  let h = 0;
  for (const c of String(adresse || "")) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 42%)`;
};

/// Date lisible d'un envoi : « 8 août, 14:02 ».
export const dateEnvoi = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) +
    ", " +
    d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
};

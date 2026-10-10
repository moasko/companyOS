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
  const plat = String(texte || "")
    .replace(/\s+/g, " ")
    .trim();
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
    const cle = String(email || "")
      .trim()
      .toLowerCase();
    if (!cle || !adresseValide(cle) || vus.has(cle)) return;
    vus.add(cle);
    out.push({ email: cle, nom: nom || cle, source });
  };
  for (const c of clients) {
    ajouter(c.data?.email, c.data?.entreprise || c.data?.nom, "Client");
  }
  for (const s of salaries) {
    ajouter(
      s.data?.email,
      `${s.data?.prenom || ""} ${s.data?.nom || ""}`.trim(),
      "Équipe",
    );
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
  const deja = new Set(
    adressesDe(champ)
      .slice(0, -1)
      .map((a) => a.toLowerCase()),
  );
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
    morceaux.length >= 2 ? morceaux[0][0] + morceaux[1][0] : locale.slice(0, 2);
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
  return (
    d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) +
    ", " +
    d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  );
};

// ---------------------------------------------------------------------------
// Messagerie : adresses, sujets, réponses, fils
// ---------------------------------------------------------------------------

/// « Awa Koné <awa@konan.ci> » ou « awa@konan.ci » → { nom, email }.
export const analyserAdresse = (brut) => {
  const s = String(brut || "").trim();
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s);
  const email = (m ? m[2] : s).trim().toLowerCase();
  const nom = m ? m[1].trim() : "";
  return { nom: nom && nom.toLowerCase() !== email ? nom : "", email };
};

/// Un champ « À » (chaîne ou tableau) en liste d'adresses { nom, email },
/// sans doublon. Les entrées invalides sont gardées : l'appelant les
/// signale plutôt que de les perdre.
export const listeAdresses = (champ) => {
  const brutes = Array.isArray(champ)
    ? champ.map((x) => (typeof x === "string" ? x : x?.nom ? `${x.nom} <${x.email}>` : x?.email || ""))
    : String(champ || "").split(/[,;](?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const vues = new Set();
  const out = [];
  for (const b of brutes) {
    if (!String(b || "").trim()) continue;
    const a = analyserAdresse(b);
    if (!a.email || vues.has(a.email)) continue;
    vues.add(a.email);
    out.push(a);
  }
  return out;
};

/// { nom, email } → « Awa Koné <awa@konan.ci> » (le nom entre guillemets
/// s'il contient une virgule).
export const formaterAdresse = ({ nom, email } = {}) => {
  if (!nom) return email || "";
  const n = /[,;"<>]/.test(nom) ? `"${nom.replace(/"/g, "'")}"` : nom;
  return `${n} <${email}>`;
};

/// Nom à afficher : le nom s'il est connu, sinon la partie locale de
/// l'adresse, mise en forme (« awa.kone » → « Awa Kone »).
export const nomAffiche = ({ nom, email } = {}) => {
  if (nom) return nom;
  const locale = String(email || "").split("@")[0];
  return locale
    .split(/[._-]+/)
    .filter(Boolean)
    .map((m) => m[0].toUpperCase() + m.slice(1))
    .join(" ") || email || "";
};

const PREFIXES = /^\s*((re|tr|fw|fwd|réf|ref|aw|sv|antw|rv)\s*(\[\d+\])?\s*:\s*)+/i;

/// Sujet sans ses « Re: », « TR : », « Fwd: » empilés — la clé d'un fil.
export const sujetNormalise = (sujet) => String(sujet || "").replace(PREFIXES, "").trim();

export const sujetReponse = (sujet) => `Re : ${sujetNormalise(sujet) || "(sans sujet)"}`;
export const sujetTransfert = (sujet) => `Tr : ${sujetNormalise(sujet) || "(sans sujet)"}`;

/// Destinataires de « Répondre à tous » : l'expéditeur, puis les autres
/// destinataires — sauf soi-même (toutes ses adresses).
export const repondreATous = (message, mesAdresses = []) => {
  const moi = new Set(mesAdresses.map((a) => String(a).toLowerCase()));
  const a = listeAdresses([
    { nom: message.deNom, email: message.deEmail },
    ...(message.a || []),
  ]).filter((x) => !moi.has(x.email));
  const dejaA = new Set(a.map((x) => x.email));
  const cc = listeAdresses(message.cc || []).filter((x) => !moi.has(x.email) && !dejaA.has(x.email));
  return { a, cc };
};

/// Texte brut d'un HTML de courriel : blocs en lignes, entités décodées,
/// scripts et styles retirés. De quoi indexer, citer et faire un extrait.
export const texteDeHtml = (html) =>
  String(html || "")
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const echapper = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/// Texte brut → HTML (paragraphes, retours à la ligne, liens cliquables).
export const htmlDeTexte = (texte) =>
  String(texte || "")
    .split(/\n{2,}/)
    .map((p) =>
      `<p>${echapper(p)
        .replace(/\n/g, "<br>")
        .replace(/\bhttps?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)}</p>`,
    )
    .join("");

/// Citation du message auquel on répond, en texte et en HTML.
export const citation = (message) => {
  const quand = message.date
    ? new Date(message.date).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })
    : "";
  const qui = formaterAdresse({ nom: message.deNom, email: message.deEmail });
  const entete = `Le ${quand}, ${qui} a écrit :`;
  const corps = message.texte || texteDeHtml(message.html);
  return {
    texte: `\n\n${entete}\n${corps.split("\n").map((l) => `> ${l}`).join("\n")}`,
    html: `<p><br></p><p>${echapper(entete)}</p><blockquote style="margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex">${message.html || htmlDeTexte(corps)}</blockquote>`,
  };
};

/// En-tête du message transféré.
export const enteteTransfert = (message) => {
  const lignes = [
    "---------- Message transféré ----------",
    `De : ${formaterAdresse({ nom: message.deNom, email: message.deEmail })}`,
    `Date : ${message.date ? new Date(message.date).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" }) : ""}`,
    `Objet : ${message.sujet || ""}`,
    `À : ${(message.a || []).map(formaterAdresse).join(", ")}`,
  ];
  return {
    texte: `\n\n${lignes.join("\n")}\n\n${message.texte || texteDeHtml(message.html)}`,
    html: `<p><br></p><p>${lignes.map(echapper).join("<br>")}</p>${message.html || htmlDeTexte(message.texte)}`,
  };
};

/// Le fil auquel rattacher un message, d'après ses en-têtes : le premier
/// message connu parmi In-Reply-To puis References (du plus récent au
/// plus ancien). `trouver(messageId)` rend le filId d'un message connu.
export const filDe = async ({ inReplyTo, references = [] }, trouver) => {
  const candidats = [inReplyTo, ...[...references].reverse()].filter(Boolean);
  for (const id of candidats) {
    const fil = await trouver(id);
    if (fil) return fil;
  }
  return null;
};

/// Taille lisible d'une pièce jointe.
export const taillePiece = (octets) => {
  const n = Number(octets) || 0;
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
};

/// Date courte de la liste : l'heure aujourd'hui, « hier », le jour de la
/// semaine cette semaine, sinon la date.
export const dateListe = (iso, maintenant = new Date()) => {
  if (!iso) return "";
  const d = new Date(iso);
  const jour = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(maintenant) - jour(d)) / 86400000);
  if (ecart === 0) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (ecart === 1) return "hier";
  if (ecart > 1 && ecart < 7) return d.toLocaleDateString("fr-FR", { weekday: "long" });
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: d.getFullYear() === maintenant.getFullYear() ? undefined : "numeric" });
};

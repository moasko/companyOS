/// Politique de mot de passe, la même partout : inscription, invitation,
/// changement, réinitialisation.
///
/// Suivant les recommandations de l'ANSSI et du NIST (SP 800-63B) : la
/// longueur compte plus que les règles de composition, qui poussent vers
/// « Motdepasse1! ». On exige donc 10 caractères, et l'on refuse ce qui se
/// devine sans effort : les mots de passe les plus courants, l'adresse
/// e-mail ou le nom de la personne, un seul caractère répété.

export const LONGUEUR_MIN = 10;
export const LONGUEUR_MAX = 200;

const COURANTS = new Set([
  "motdepasse", "motdepasse1", "motdepasse123", "password", "password1", "password123",
  "1234567890", "0123456789", "123456789", "azertyuiop", "qwertyuiop", "azerty123",
  "qwerty123", "iloveyou", "bonjour123", "soleil123", "abc123456", "admin12345",
  "administrateur", "companyos", "companyos1", "changeme123", "bienvenue1", "bienvenue123",
  "welcome123", "letmein123", "jetaime123", "doudou1234", "marseille13", "football10",
]);

const normaliser = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/// Message d'erreur si le mot de passe est refusé, sinon `null`.
export const refusMotDePasse = (motDePasse, { email = "", nom = "" } = {}) => {
  if (typeof motDePasse !== "string" || motDePasse.length < LONGUEUR_MIN) {
    return `Mot de passe : ${LONGUEUR_MIN} caractères au moins.`;
  }
  if (motDePasse.length > LONGUEUR_MAX) return `Mot de passe : ${LONGUEUR_MAX} caractères au plus.`;
  const n = normaliser(motDePasse);
  if (COURANTS.has(n) || COURANTS.has(n.replace(/[^a-z0-9]/g, ""))) {
    return "Ce mot de passe fait partie des plus utilisés : choisissez-en un autre.";
  }
  if (/^(.)\1+$/.test(motDePasse)) return "Un seul caractère répété n'est pas un mot de passe.";
  const local = normaliser(email).split("@")[0];
  if (local.length >= 4 && n.includes(local)) {
    return "Le mot de passe ne doit pas contenir votre adresse e-mail.";
  }
  for (const morceau of normaliser(nom).split(/\s+/)) {
    if (morceau.length >= 4 && n.includes(morceau)) {
      return "Le mot de passe ne doit pas contenir votre nom.";
    }
  }
  return null;
};

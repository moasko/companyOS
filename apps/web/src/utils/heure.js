// Le fuseau horaire de l'espace de travail.
//
// Par défaut « automatique » : celui que le navigateur détecte. Mais un
// poste mal réglé, un VPN ou un voyage suffisent à afficher une heure
// fausse — et une entreprise vit à l'heure de son pays, pas à celle du
// matériel. On peut donc épingler un fuseau à la main ; le choix est
// retenu sur le poste.

const CLE = "companyos-fuseau";

/// Ce que le navigateur détecte.
export const fuseauDetecte = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/// Le choix enregistré : "auto" ou un identifiant IANA.
export const fuseauChoisi = () => localStorage.getItem(CLE) || "auto";

export const choisirFuseau = (zone) => {
  if (!zone || zone === "auto") localStorage.removeItem(CLE);
  else localStorage.setItem(CLE, zone);
};

/// Le fuseau réellement appliqué. Un identifiant devenu invalide (faute de
/// frappe, ancienne valeur) retombe sur la détection au lieu de casser
/// l'horloge.
export const fuseauEffectif = () => {
  const choix = fuseauChoisi();
  if (choix === "auto") return fuseauDetecte();
  try {
    Intl.DateTimeFormat("fr-FR", { timeZone: choix });
    return choix;
  } catch {
    return fuseauDetecte();
  }
};

/// Les fuseaux proposés à la main : l'Afrique de l'Ouest et centrale
/// d'abord — c'est là que vivent les clients — puis quelques places
/// d'affaires.
export const FUSEAUX = [
  "Africa/Abidjan",
  "Africa/Dakar",
  "Africa/Bamako",
  "Africa/Ouagadougou",
  "Africa/Lome",
  "Africa/Accra",
  "Africa/Lagos",
  "Africa/Douala",
  "Africa/Kinshasa",
  "Africa/Casablanca",
  "Africa/Tunis",
  "Europe/Paris",
  "Europe/London",
  "America/New_York",
  "Asia/Dubai",
  "Asia/Shanghai",
];

/// L'heure dans un fuseau, pour l'aperçu du réglage.
export const heureDans = (zone) =>
  new Date().toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: zone,
  });

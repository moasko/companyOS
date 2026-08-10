// Navigateur — les règles, sans React.
//
// Ce fichier ne touche ni au réseau ni à l'écran : il décide ce qu'une
// saisie veut dire. Chaque fonction s'éprouve seule, avec node.

/// Ce que l'utilisateur a tapé : une adresse, ou autre chose ?
///
/// La question paraît simple et ne l'est pas. « facture.pdf » ressemble à
/// un domaine, « localhost:3000 » n'a pas de point, et « quel taux de TVA
/// en Côte d'Ivoire » ne doit surtout pas devenir une adresse. La règle
/// retenue :
///
///   - un schéma explicite (http://, https://) tranche la question ;
///   - un espace signe une recherche, jamais une adresse ;
///   - « localhost », avec ou sans port, est une adresse ;
///   - sinon, il faut un point ET une terminaison de deux lettres au moins
///     qui ne soit pas une extension de fichier courante.
///
/// La dernière règle se trompera parfois. C'est assumé : la barre affiche
/// ce qu'elle a compris, et l'utilisateur peut forcer en écrivant https://.
const EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt", "zip",
  "rar", "png", "jpg", "jpeg", "gif", "svg", "webp", "mp3", "mp4", "avi",
  "json", "xml", "exe", "apk", "dmg",
]);

export const estAdresse = (saisie) => {
  const texte = String(saisie || "").trim();
  if (!texte) return false;
  if (/^https?:\/\//i.test(texte)) return true;
  // Un autre schéma n'est pas une adresse pour nous : le serveur les
  // refusera, autant ne pas laisser croire le contraire.
  // Ce qui suit les deux-points départage : des chiffres, c'est un port
  // (« localhost:3000 ») ; autre chose, c'est un schéma (« mailto:… »).
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(texte)) return false;
  if (/\s/.test(texte)) return false;

  const hote = texte.split("/")[0].split("?")[0];
  if (/^localhost(:\d+)?$/i.test(hote)) return true;
  if (!hote.includes(".")) return false;

  const fin = hote.split(".").pop().toLowerCase();
  if (EXTENSIONS.has(fin)) return false;
  return /^[a-z]{2,}$/i.test(fin) || /^\d+$/.test(fin);
};

/// Moteur de recherche. Aucun ne se laisse afficher dans un cadre — voir
/// `refusDeCadre` côté serveur — donc une recherche s'ouvre dans un vrai
/// onglet du navigateur de la machine. Mieux vaut le dire que servir une
/// fenêtre blanche.
export const urlDeRecherche = (requete) =>
  `https://duckduckgo.com/?q=${encodeURIComponent(requete)}`;

/// Transforme une saisie en intention.
///
///   { type: "adresse", href }  → à ouvrir dans la fenêtre
///   { type: "recherche", requete, href } → à ouvrir hors de CompanyOS
export const interpreter = (saisie) => {
  const texte = String(saisie || "").trim();
  if (!texte) return null;

  if (estAdresse(texte)) {
    const href = /^https?:\/\//i.test(texte) ? texte : `https://${texte}`;
    try {
      return { type: "adresse", href: new URL(href).href };
    } catch {
      return { type: "recherche", requete: texte, href: urlDeRecherche(texte) };
    }
  }
  return { type: "recherche", requete: texte, href: urlDeRecherche(texte) };
};

/// Ce qu'on montre dans la barre : le domaine en clair, le reste estompé.
/// Lire d'un coup d'œil sur quel site on se trouve est la seule défense
/// qu'un utilisateur a contre une adresse déguisée.
export const decouperUrl = (href) => {
  try {
    const url = new URL(href);
    return {
      protocole: url.protocol,
      sur: url.protocol === "https:",
      domaine: url.host,
      reste: `${url.pathname === "/" ? "" : url.pathname}${url.search}`,
    };
  } catch {
    return { protocole: "", sur: false, domaine: href, reste: "" };
  }
};

/// Taille lisible. `null` quand le serveur distant ne l'annonce pas — et
/// il ne l'annonce pas toujours, ce qui vaut mieux qu'un « 0 o » faux.
export const tailleLisible = (octets) => {
  if (octets == null || !Number.isFinite(octets)) return null;
  if (octets < 1024) return `${octets} o`;
  const unites = ["Ko", "Mo", "Go"];
  let n = octets / 1024;
  let i = 0;
  while (n >= 1024 && i < unites.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${unites[i]}`;
};

/// Historique de navigation : une pile avec un curseur, comme partout.
///
/// Empiler après un retour en arrière coupe la branche suivante — c'est ce
/// que fait tout navigateur, et ce à quoi l'utilisateur s'attend.
export const empiler = (pile, position, href) => {
  if (pile[position] === href) return { pile, position };
  const coupee = pile.slice(0, position + 1);
  coupee.push(href);
  return { pile: coupee, position: coupee.length - 1 };
};

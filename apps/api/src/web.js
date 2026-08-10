// Sorties HTTP demandées par un utilisateur.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI CE FICHIER EXISTE
//
// Le Navigateur laisse un membre coller une adresse, et le serveur va la
// chercher. C'est exactement la primitive qu'un attaquant cherche : faire
// émettre au serveur une requête qu'il ne peut pas émettre lui-même.
//
// Le serveur, lui, est **dans** le réseau. Il voit la base de données, les
// services voisins, et sur un hébergeur infonuagique le service de
// métadonnées — http://169.254.169.254/ — qui distribue les identifiants
// de la machine. Un simple « télécharge ceci » sur cette adresse exfiltre
// les clés de toute l'infrastructure. C'est la faille SSRF, et elle se
// répare ici ou nulle part.
//
// Trois gardes, dans cet ordre :
//
//   1. Le schéma. http(s) seulement : `file://`, `gopher://` et compagnie
//      liraient le disque ou parleraient à des services non HTTP.
//   2. L'adresse IP, pas le nom. On résout le nom nous-mêmes et on rejette
//      tout ce qui n'est pas public.
//   3. La connexion se fait sur **l'IP validée**, jamais sur le nom. Sans
//      cela, un nom peut répondre une IP publique à la vérification puis
//      une IP interne à la connexion — c'est le « DNS rebinding », et
//      valider sans épingler ne sert à rien.
//
// Chaque redirection repasse les trois gardes : une adresse publique qui
// renvoie vers 127.0.0.1 est le contournement le plus courant.
// ─────────────────────────────────────────────────────────────────────────

import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import ipaddr from "ipaddr.js";

/// Limite de temps d'une requête sortante. Un serveur distant qui ne
/// répond jamais ne doit pas retenir une connexion de la nôtre.
const DELAI_MS = 20_000;

/// Une chaîne de redirections plus longue est une boucle déguisée.
const REDIRECTIONS_MAX = 5;

/// Erreur destinée à être montrée telle quelle : le message est écrit pour
/// l'utilisateur, pas pour le journal.
export class ErreurWeb extends Error {
  constructor(message, code = 400) {
    super(message);
    this.code = code;
  }
}

/// Vrai pour toute adresse qui n'est pas routable sur l'Internet public.
///
/// Le classement vient d'`ipaddr.js` plutôt que d'une liste écrite ici :
/// les plages à refuser ne sont pas seulement les trois privées connues.
/// Il y a aussi 100.64/10 (réseaux d'opérateur), 198.18/15 (bancs d'essai),
/// 192.0.0/24, les plages de documentation, la multidiffusion, et leurs
/// équivalents IPv6. Une liste maintenue à la main en oublie toujours une,
/// et l'oubli ne se voit que le jour de l'incident.
///
/// Seul `unicast` est public. Tout le reste — `loopback`, `linkLocal`
/// (dont 169.254.169.254, les métadonnées de l'hébergeur), `private`,
/// `uniqueLocal`, `reserved`, `carrierGradeNat`, `multicast`… — est refusé.
export const adressePrivee = (ip) => {
  let analysee;
  try {
    analysee = ipaddr.parse(ip);
  } catch {
    return true; // pas une adresse : on refuse plutôt que de deviner
  }

  // Une IPv4 déguisée en IPv6 doit être jugée sur son IPv4 :
  // ::ffff:127.0.0.1 est la boucle locale, écrite autrement.
  if (analysee.kind() === "ipv6" && analysee.isIPv4MappedAddress()) {
    return adressePrivee(analysee.toIPv4Address().toString());
  }
  return analysee.range() !== "unicast";
};

/// Contrôle la forme de l'adresse, avant même de toucher au réseau.
export const analyserUrl = (entree) => {
  let url;
  try {
    url = new URL(String(entree).trim());
  } catch {
    throw new ErreurWeb("Cette adresse n'est pas valide.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ErreurWeb(
      "Seules les adresses http:// et https:// peuvent être ouvertes.",
    );
  }
  // Un mot de passe dans l'adresse partirait au serveur distant depuis
  // notre machine, et se retrouverait dans le journal.
  if (url.username || url.password) {
    throw new ErreurWeb("Une adresse ne doit pas contenir d'identifiants.");
  }
  return url;
};

/// Résout le nom et n'en garde que les adresses publiques.
const resoudre = async (hostname) => {
  // Une adresse IP écrite directement n'a rien à résoudre — et doit être
  // jugée comme les autres, sinon http://127.0.0.1 passerait.
  if (net.isIP(hostname)) {
    if (adressePrivee(hostname)) {
      throw new ErreurWeb("Cette adresse pointe vers le réseau interne.", 403);
    }
    return [{ address: hostname, family: net.isIP(hostname) }];
  }

  let adresses;
  try {
    adresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new ErreurWeb("Ce nom de domaine est introuvable.", 404);
  }

  // **Toutes** doivent être publiques. Il suffirait qu'une seule soit
  // interne pour que la connexion l'emprunte au gré du système.
  if (adresses.some((a) => adressePrivee(a.address))) {
    throw new ErreurWeb("Cette adresse pointe vers le réseau interne.", 403);
  }
  if (!adresses.length) {
    throw new ErreurWeb("Ce nom de domaine est introuvable.", 404);
  }
  return adresses;
};

/// Une requête, sans suivre les redirections : l'appelant s'en charge pour
/// pouvoir revalider chaque étape.
const requeteUnique = (url, adresses, { methode }) =>
  new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;

    const req = client.request(
      url,
      {
        method: methode,
        // La connexion part sur les IP déjà validées. Le nom reste utilisé
        // pour le certificat et l'en-tête Host : c'est ce qui distingue
        // l'épinglage d'un simple « connecte-toi à cette IP ».
        //
        // Les deux formes de rappel doivent être servies. Depuis Node 20,
        // `autoSelectFamily` est actif par défaut : la pile réseau demande
        // **toutes** les adresses d'un coup pour essayer IPv6 et IPv4 en
        // parallèle, et attend alors un tableau. Répondre le triplet
        // habituel donne « Invalid IP address: undefined » — l'erreur ne
        // nomme ni le rappel ni la raison.
        lookup: (_host, options, cb) =>
          options?.all
            ? cb(null, adresses)
            : cb(null, adresses[0].address, adresses[0].family),
        headers: {
          // Se présenter honnêtement. Un serveur qui ne veut pas de nous
          // doit pouvoir le dire.
          "user-agent": "CompanyOS/1.0 (+navigateur intégré)",
          accept: "*/*",
        },
        timeout: DELAI_MS,
      },
      resolve,
    );

    req.on("timeout", () => {
      req.destroy(new ErreurWeb("Le site distant n'a pas répondu à temps.", 504));
    });
    req.on("error", (err) => {
      reject(
        err instanceof ErreurWeb
          ? err
          : new ErreurWeb("Impossible de joindre ce site.", 502),
      );
    });
    req.end();
  });

/// Ouvre une adresse et renvoie la réponse finale, redirections suivies.
///
/// La réponse est un flux : à l'appelant de le consommer ou de le fermer.
/// Personne ne lit tout en mémoire — un fichier de 2 Go tuerait le serveur.
export const ouvrir = async (entree, { methode = "GET" } = {}) => {
  let url = analyserUrl(entree);

  for (let saut = 0; saut <= REDIRECTIONS_MAX; saut += 1) {
    const adresses = await resoudre(url.hostname);
    const reponse = await requeteUnique(url, adresses, { methode });

    const redirection =
      reponse.statusCode >= 300 &&
      reponse.statusCode < 400 &&
      reponse.headers.location;

    if (!redirection) {
      return { reponse, url };
    }

    // Le flux de la redirection ne nous intéresse pas, mais laissé ouvert
    // il retient la connexion.
    reponse.resume();

    if (saut === REDIRECTIONS_MAX) {
      throw new ErreurWeb("Ce lien renvoie en boucle vers lui-même.", 508);
    }
    // Nouvelle adresse, nouveaux gardes : `analyserUrl` refuse un saut
    // vers file://, et le tour de boucle suivant revalide l'IP.
    url = analyserUrl(new URL(reponse.headers.location, url).href);
  }

  throw new ErreurWeb("Ce lien renvoie en boucle vers lui-même.", 508);
};

/// Un site peut refuser d'être affiché dans un cadre, et la plupart le
/// font. Le dire avant d'essayer vaut mieux qu'une fenêtre blanche dont
/// l'utilisateur ne peut rien déduire.
export const refusDeCadre = (entetes) => {
  const xfo = String(entetes["x-frame-options"] || "").toLowerCase();
  if (xfo.includes("deny")) return "Ce site interdit tout affichage en cadre.";
  if (xfo.includes("sameorigin")) {
    return "Ce site ne s'affiche que sur son propre domaine.";
  }

  const csp = String(entetes["content-security-policy"] || "").toLowerCase();
  const clause = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("frame-ancestors"));

  if (clause) {
    const valeurs = clause.replace("frame-ancestors", "").trim();
    if (valeurs === "'none'") return "Ce site interdit tout affichage en cadre.";
    if (!valeurs.includes("*")) {
      return "Ce site n'autorise l'affichage en cadre que sur certains domaines.";
    }
  }
  return null;
};

/// Nom de fichier pour ce qui arrive : l'en-tête s'il en donne un, sinon
/// le dernier segment de l'adresse, sinon un nom neutre.
export const nomDeFichier = (url, entetes) => {
  const disposition = String(entetes["content-disposition"] || "");

  // RFC 5987 d'abord : c'est la forme qui porte les accents.
  const etoile = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (etoile) {
    try {
      const nom = nettoyerNom(decodeURIComponent(etoile[1].replace(/"/g, "")));
      if (nom) return nom;
    } catch {
      // Encodage annoncé mais invalide : on passe à la forme simple.
    }
  }

  const simple = disposition.match(/filename="?([^";]+)"?/i);
  if (simple) {
    const nom = nettoyerNom(simple[1]);
    if (nom) return nom;
  }

  const segment = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
  return nettoyerNom(segment) || "telechargement";
};

/// Un nom venu du réseau ne doit jamais pouvoir désigner un autre dossier.
/// « ../../etc/passwd » devient « etcpasswd ».
const nettoyerNom = (brut) =>
  brut
    .replace(/[\\/]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/[\x00-\x1f<>:"|?*]/g, "")
    .trim()
    .slice(0, 200);

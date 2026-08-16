// Pilote de stockage compatible S3.
//
// ─────────────────────────────────────────────────────────────────────────
// UN SEUL PILOTE POUR TOUS LES FOURNISSEURS
//
// Amazon S3, Cloudflare R2, Backblaze B2, Wasabi, Scaleway, OVH, et les
// NAS auto-hébergés qui parlent S3 (MinIO, Garage, Ceph) exposent tous la
// **même** interface HTTP. Un seul pilote les couvre donc, à condition de
// laisser configurer l'adresse, la région et le style d'URL.
//
// POURQUOI PAS LE SDK AWS
//
// `@aws-sdk/client-s3` pèse plusieurs mégaoctets pour quatre requêtes
// HTTP. Ce fichier signe lui-même en SigV4 — une centaine de lignes, sans
// dépendance, et le reste du projet fait déjà ce choix (le .docx et le
// .xlsx sont écrits à la main).
//
// SUR L'ADRESSE FOURNIE, ET LA RÈGLE ANTI-SSRF DU PROJET
//
// Le projet impose que toute route allant chercher une URL fournie par un
// utilisateur passe par les gardes de `src/web.js`, qui refusent les
// adresses privées. **Ce pilote en est exempté, et c'est délibéré.**
//
// Deux raisons. L'adresse n'est pas fournie par un utilisateur d'un espace
// client mais par l'exploitant de la plateforme, qui a déjà accès à la
// configuration et à la base : il n'obtiendrait rien de plus en visant une
// adresse interne. Et surtout, **viser le réseau local est précisément la
// fonction demandée** — « ou dans un cloud privé local, NAS » : interdire
// 192.168.x.x supprimerait la moitié de la fonctionnalité.
//
// Le garde qui compte ici est ailleurs : l'accès à ces routes est réservé
// à `PLATFORM_ADMINS` (voir src/routes/plateforme.js). Si un jour un
// administrateur d'espace pouvait régler son propre stockage, il faudrait
// alors filtrer les adresses privées.
//
// SUR LA SIGNATURE
//
// SigV4 signe une « requête canonique » : méthode, chemin, paramètres,
// en-têtes, et l'empreinte du corps. Pour les envois, on déclare
// `UNSIGNED-PAYLOAD` — autorisé en HTTPS et accepté par tous les
// fournisseurs cités : sans cela il faudrait lire le fichier entier en
// mémoire uniquement pour en calculer l'empreinte avant de l'envoyer.
// ─────────────────────────────────────────────────────────────────────────

import { createHash, createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

const VIDE_SHA256 = createHash("sha256").update("").digest("hex");

const sha256 = (donnees) => createHash("sha256").update(donnees).digest("hex");
const hmac = (cle, donnees) => createHmac("sha256", cle).update(donnees).digest();

/// Encodage des chemins pour S3 : chaque segment est encodé, mais les
/// barres obliques restent des séparateurs. `encodeURIComponent` échappe
/// aussi `!'()*`, qu'AWS attend en clair — d'où la reprise.
const encoderSegment = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const encoderChemin = (chemin) => chemin.split("/").map(encoderSegment).join("/");

const horodatage = () => {
  // AWS attend « 20260809T181500Z » : de l'ISO sans séparateurs.
  const iso = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { long: iso, court: iso.slice(0, 8) };
};

/// Construit les en-têtes signés d'une requête.
const signer = ({ config, methode, chemin, requete = "", entetes = {}, empreinte }) => {
  const { long, court } = horodatage();
  const url = new URL(config.endpoint);
  const hote = config.pathStyle ? url.host : `${config.bucket}.${url.host}`;

  const tous = {
    host: hote,
    "x-amz-content-sha256": empreinte,
    "x-amz-date": long,
    ...entetes,
  };

  // Les en-têtes signés doivent être triés, en minuscules, valeurs
  // resserrées : la moindre différence avec ce que le serveur recalcule
  // invalide la signature.
  const noms = Object.keys(tous).map((k) => k.toLowerCase()).sort();
  const canoniques = noms.map((n) => `${n}:${String(tous[Object.keys(tous).find((k) => k.toLowerCase() === n)]).trim()}\n`).join("");
  const signes = noms.join(";");

  const requeteCanonique = [
    methode,
    chemin,
    requete,
    canoniques,
    signes,
    empreinte,
  ].join("\n");

  const portee = `${court}/${config.region}/s3/aws4_request`;
  const aSigner = ["AWS4-HMAC-SHA256", long, portee, sha256(requeteCanonique)].join("\n");

  let cle = hmac(`AWS4${config.secretKey}`, court);
  cle = hmac(cle, config.region);
  cle = hmac(cle, "s3");
  cle = hmac(cle, "aws4_request");
  const signature = createHmac("sha256", cle).update(aSigner).digest("hex");

  return {
    ...tous,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${portee}, ` +
      `SignedHeaders=${signes}, Signature=${signature}`,
  };
};

const adresse = (config, chemin) => {
  const url = new URL(config.endpoint);
  const base = config.pathStyle
    ? `${url.origin}${chemin}`
    : `${url.protocol}//${config.bucket}.${url.host}${chemin}`;
  return base;
};

/// Le chemin canonique d'un objet, selon le style d'URL.
const cheminObjet = (config, key) =>
  config.pathStyle
    ? `/${encoderSegment(config.bucket)}/${encoderChemin(key)}`
    : `/${encoderChemin(key)}`;

const erreurLisible = async (rep, action) => {
  const texte = await rep.text().catch(() => "");
  // Les erreurs S3 arrivent en XML : on en extrait le message plutôt que
  // de renvoyer trente lignes de balises à l'utilisateur.
  const message = /<Message>([^<]+)<\/Message>/.exec(texte)?.[1];
  return new Error(
    `${action} : ${rep.status}${message ? ` — ${message}` : ""}`,
  );
};

/// Fabrique un pilote à partir d'une configuration.
export const creerPiloteS3 = (config) => ({
  nom: "s3",

  buildKey(tenantId, filename) {
    // Le nom d'origine est conservé en fin de clé : retrouver un objet
    // depuis la console du fournisseur reste possible.
    const propre = String(filename).replace(/[^\w.-]+/g, "_").slice(-120);
    return `${config.prefix || ""}${tenantId}/${randomUUID()}-${propre}`;
  },

  async put(key, stream) {
    // Le flux est rassemblé en mémoire : la taille écrite doit être
    // rendue à l'appelant, et le quota se calcule dessus. C'est le
    // compromis assumé — les fichiers de gestion sont des documents, pas
    // des vidéos de plusieurs gigaoctets.
    const morceaux = [];
    for await (const m of stream) morceaux.push(m);
    const corps = Buffer.concat(morceaux);

    const chemin = cheminObjet(config, key);
    const entetes = signer({
      config, methode: "PUT", chemin, empreinte: "UNSIGNED-PAYLOAD",
      entetes: { "content-length": String(corps.length) },
    });

    const rep = await fetch(adresse(config, chemin), { method: "PUT", headers: entetes, body: corps });
    if (!rep.ok) throw await erreurLisible(rep, "Envoi vers le stockage objet");
    return corps.length;
  },

  read(key) {
    return this.readRange(key, null, null);
  },

  readRange(key, debut, fin) {
    const chemin = cheminObjet(config, key);
    const supplement = debut !== null && debut !== undefined
      ? { range: `bytes=${debut}-${fin}` }
      : {};
    const entetes = signer({
      config, methode: "GET", chemin, empreinte: VIDE_SHA256, entetes: supplement,
    });

    // L'appelant attend un flux Node lisible, comme avec le disque local.
    // On lui en rend un tout de suite, alimenté dès que la réponse arrive.
    const flux = new Readable({ read() {} });
    fetch(adresse(config, chemin), { headers: entetes })
      .then(async (rep) => {
        if (!rep.ok) throw await erreurLisible(rep, "Lecture depuis le stockage objet");
        for await (const morceau of rep.body) flux.push(Buffer.from(morceau));
        flux.push(null);
      })
      .catch((e) => flux.destroy(e));
    return flux;
  },

  async remove(key) {
    const chemin = cheminObjet(config, key);
    const entetes = signer({ config, methode: "DELETE", chemin, empreinte: VIDE_SHA256 });
    const rep = await fetch(adresse(config, chemin), { method: "DELETE", headers: entetes });
    // 404 sur une suppression n'est pas une erreur : l'objet n'est plus
    // là, c'est le résultat voulu.
    if (!rep.ok && rep.status !== 404) throw await erreurLisible(rep, "Suppression");
  },

  /// Vérifie que la configuration fonctionne vraiment : on écrit un petit
  /// objet, on le relit, on le supprime. Un simple accès au bucket ne
  /// prouverait pas le droit d'écriture — et c'est celui qui manque le
  /// plus souvent.
  async tester() {
    const key = `${config.prefix || ""}_verification/${randomUUID()}.txt`;
    const temoin = `companyos ${new Date().toISOString()}`;
    await this.put(key, Readable.from([Buffer.from(temoin)]));

    const morceaux = [];
    for await (const m of this.readRange(key, null, null)) morceaux.push(m);
    const relu = Buffer.concat(morceaux).toString("utf8");
    await this.remove(key);

    if (relu !== temoin) throw new Error("L'objet relu ne correspond pas à ce qui a été écrit.");
    return true;
  },
});

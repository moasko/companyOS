import { COOKIE_SESSION } from "./auth.js";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { abonner, publier } from "./evenements.js";
import { notifier } from "./notifier.js";

/// Détection d'intrusion.
///
/// Les protections existantes (verrou par compte, limitation de débit,
/// double authentification) *freinent* une attaque ; personne n'en était
/// prévenu. Ce module la *voit* : il lève des alertes, prévient les
/// administrateurs concernés et bloque les adresses qui attaquent.
///
/// Règles :
///   force_brute              ≥ 5 mots de passe faux sur un compte en 15 min
///   bourrage_identifiants    une IP échoue sur ≥ 10 comptes en 15 min, dont
///                            ≥ 5 inexistants → IP bloquée
///   mfa_echecs               ≥ 3 codes faux en 15 min : le mot de passe est
///                            connu de quelqu'un
///   connexion_apres_echecs   connexion réussie juste après une force brute
///   nouvel_appareil          connexion depuis une IP et un navigateur jamais
///                            vus pour ce compte (90 jours)
///   sonde                    requête anonyme visant une faille connue
///                            (/.env, /.git, wp-admin, ../, injection SQL…) ;
///                            5 en 10 min → IP bloquée
///   balayage                 ≥ 40 adresses inexistantes (404) en 1 min
///   acces_refuses            un compte prend ≥ 30 refus (401/403) en 5 min
///   abus_debit               ≥ 20 refus pour excès de débit (429) en 5 min
///
/// Les compteurs de requêtes vivent en mémoire (volume élevé, une
/// approximation par instance suffit) ; les échecs de connexion sont en
/// base, partagés par toutes les instances ; les blocages aussi, et chaque
/// instance les relit au moindre changement (bus d'événements).

export const GRAVITES = ["info", "moyenne", "haute", "critique"];

const MIN = 60_000;
const SEUILS = {
  forceBrute: { n: 5, fenetre: 15 * MIN },
  bourrage: { comptes: 10, inexistants: 5, fenetre: 15 * MIN },
  mfa: { n: 3, fenetre: 15 * MIN },
  sondes: { n: 5, fenetre: 10 * MIN },
  balayage: { n: 40, fenetre: MIN },
  refus: { n: 30, fenetre: 5 * MIN },
  debit: { n: 20, fenetre: 5 * MIN },
};

/// Blocage automatique : 1 h, puis 6 h, 24 h, 7 jours à chaque récidive.
const PALIERS_MS = [60 * MIN, 6 * 60 * MIN, 24 * 60 * MIN, 7 * 24 * 60 * MIN];
export const dureeBlocage = (recidives = 0) => PALIERS_MS[Math.min(Math.max(0, recidives), PALIERS_MS.length - 1)];

// ---- Sondes : requêtes qui visent une faille connue -------------------------
//
// Le chemin seul suffit pour les fichiers et consoles qu'un scanner essaie
// partout. Les motifs d'injection ne sont cherchés que dans les requêtes
// **anonymes** : une personne connectée qui tape « union select » dans une
// recherche du CRM n'est pas un attaquant.

const CHEMINS_SONDES = [
  [/\/\.(env|git|svn|hg|aws|ssh|htaccess|htpasswd|ds_store)(\/|$)/i, "fichier caché de configuration"],
  [/\/(wp-admin|wp-login|wp-content|wp-includes|xmlrpc\.php)/i, "WordPress"],
  [/\/(phpmyadmin|pma|adminer|mysql|myadmin)(\/|$)/i, "console de base de données"],
  [/\.(php\d?|asp|aspx|jsp|cgi)(\?|$)/i, "script serveur étranger"],
  [/\/(cgi-bin|vendor\/phpunit|actuator|server-status|solr|jenkins|boaform|hnap1)(\/|$)/i, "console d'administration"],
  [/(\.\.\/|\.\.\\|%2e%2e(%2f|%5c|\/)|\.\.%2f)/i, "remontée de répertoire"],
  [/\/etc\/(passwd|shadow|hosts)|\/proc\/self\//i, "fichier système"],
  [/\/(config|backup|db|dump|database)\.(json|ya?ml|sql|bak|zip|tar|gz)$/i, "sauvegarde exposée"],
];

const INJECTIONS = [
  [/(\bunion\b[\s+/*]+(all[\s+]+)?select\b|\bselect\b.+\bfrom\b.+\bwhere\b)/i, "injection SQL"],
  [/('|%27)\s*(or|and)\s*('|%27)?\d+('|%27)?\s*=\s*('|%27)?\d+/i, "injection SQL"],
  [/(sleep\(\d+\)|benchmark\(|pg_sleep\(|waitfor\s+delay)/i, "injection SQL (temporisation)"],
  [/(<|%3c)\s*(script|img|svg|iframe)[\s/>%]|javascript:|onerror\s*=/i, "injection de script"],
  [/\$\{jndi:|\$\{\s*(env|sys|lower|upper):/i, "Log4Shell"],
  [/(;|\||`|\$\()\s*(cat|wget|curl|bash|sh|nc|id|whoami)\b/i, "injection de commande"],
];

const decoder = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/// Rend le motif reconnu (« WordPress », « injection SQL »…) ou null.
export const motifSuspect = (url, { anonyme = true } = {}) => {
  const brut = String(url || "");
  const [chemin, ...reste] = brut.split("?");
  const requete = reste.join("?");
  for (const [re, motif] of CHEMINS_SONDES) if (re.test(chemin) || re.test(decoder(chemin))) return motif;
  if (!anonyme) return null;
  const texte = `${decoder(chemin)} ${decoder(requete.replace(/\+/g, " "))}`;
  for (const [re, motif] of INJECTIONS) if (re.test(texte)) return motif;
  return null;
};

// ---- Fenêtres glissantes en mémoire -----------------------------------------

export class Fenetre {
  constructor(dureeMs, max = 50_000) {
    this.duree = dureeMs;
    this.max = max;
    this.cles = new Map();
  }

  /// Ajoute un évènement pour `cle` et rend le nombre dans la fenêtre.
  noter(cle, maintenant = Date.now()) {
    const liste = (this.cles.get(cle) || []).filter((t) => maintenant - t < this.duree);
    liste.push(maintenant);
    this.cles.delete(cle);
    this.cles.set(cle, liste);
    if (this.cles.size > this.max) this.cles.delete(this.cles.keys().next().value);
    return liste.length;
  }

  oublier(cle) {
    this.cles.delete(cle);
  }
}

const sondes = new Fenetre(SEUILS.sondes.fenetre);
const introuvables = new Fenetre(SEUILS.balayage.fenetre);
const refus = new Fenetre(SEUILS.refus.fenetre);
const debits = new Fenetre(SEUILS.debit.fenetre);

// ---- Alertes ----------------------------------------------------------------

const TITRES = {
  force_brute: "Tentatives de mot de passe en série",
  bourrage_identifiants: "Bourrage d'identifiants",
  mfa_echecs: "Codes de double authentification erronés",
  connexion_apres_echecs: "Connexion réussie après une série d'échecs",
  nouvel_appareil: "Connexion depuis un nouvel appareil",
  sonde: "Recherche de failles",
  balayage: "Balayage d'adresses",
  acces_refuses: "Accès refusés en série",
  abus_debit: "Excès de requêtes",
  ip_bloquee: "Adresse bloquée",
};
export const titreAlerte = (type) => TITRES[type] || type;

/// Une même alerte (type + sujet) n'est levée qu'une fois par période :
/// une attaque de mille essais fait une alerte, pas mille.
const dejaLevees = new Map();
const DEDUP_MS = 30 * MIN;

const agentDe = (request) => String(request?.headers?.["user-agent"] || "").slice(0, 300) || null;

export const alerter = async ({ type, gravite, request, ip, tenantId = null, userId = null, email = null, details = null, sujet, notifierUtilisateur = false }) => {
  const adresse = ip ?? request?.ip ?? null;
  const cleDedup = `${type}|${tenantId || "-"}|${sujet ?? adresse ?? userId ?? email ?? "-"}`;
  const avant = dejaLevees.get(cleDedup);
  if (avant && Date.now() - avant < DEDUP_MS) return null;
  dejaLevees.set(cleDedup, Date.now());
  if (dejaLevees.size > 20_000) dejaLevees.delete(dejaLevees.keys().next().value);

  // Une autre instance a pu lever la même alerte à l'instant.
  const recente = await prisma.alerteSecurite
    .findFirst({
      where: {
        type,
        tenantId,
        ...(sujet ? { details: { path: ["sujet"], equals: sujet } } : adresse ? { ip: adresse } : {}),
        creeLe: { gt: new Date(Date.now() - DEDUP_MS) },
      },
      select: { id: true },
    })
    .catch(() => null);
  if (recente) return null;

  const alerte = await prisma.alerteSecurite
    .create({
      data: {
        type,
        gravite,
        tenantId,
        userId,
        email,
        ip: adresse,
        agent: agentDe(request),
        details: { ...(details || {}), ...(sujet ? { sujet } : {}) },
      },
    })
    .catch((err) => {
      request?.log?.error?.({ err, type }, "détection : alerte non enregistrée");
      return null;
    });
  if (!alerte) return null;
  request?.log?.warn?.({ type, gravite, ip: adresse, tenantId }, `détection d'intrusion : ${titreAlerte(type)}`);

  // Les administrateurs de l'espace sont prévenus des alertes sérieuses ;
  // la personne visée, de ce qui touche son compte.
  if (tenantId) {
    const destinataires = [];
    if (GRAVITES.indexOf(gravite) >= GRAVITES.indexOf("haute")) {
      const admins = await prisma.user
        .findMany({ where: { tenantId, role: { in: ["OWNER", "ADMIN"] } }, select: { id: true } })
        .catch(() => []);
      destinataires.push(...admins.map((u) => u.id));
    }
    if (notifierUtilisateur && userId) destinataires.push(userId);
    if (destinataires.length) {
      await notifier(tenantId, destinataires, {
        source: "Sécurité",
        titre: titreAlerte(type),
        message: messageAlerte(alerte),
        lien: { app: "settings", params: { section: "securite" } },
      }).catch(() => {});
    }
  }
  return alerte;
};

export const messageAlerte = (a) => {
  const d = a.details || {};
  const ip = a.ip ? ` depuis ${a.ip}` : "";
  switch (a.type) {
    case "force_brute":
      return `${d.echecs || "Plusieurs"} mots de passe erronés pour ${a.email}${ip}. Le compte est temporairement verrouillé.`;
    case "bourrage_identifiants":
      return `${d.comptes} comptes essayés${ip}, dont ${d.inexistants} inexistants. Adresse bloquée.`;
    case "mfa_echecs":
      return `${d.echecs} codes erronés pour ${a.email}${ip} : le mot de passe semble connu de quelqu'un d'autre. Changez-le.`;
    case "connexion_apres_echecs":
      return `${a.email} s'est connecté${ip} juste après ${d.echecs} échecs. Vérifiez que c'est bien la personne.`;
    case "nouvel_appareil":
      return `${a.email} s'est connecté${ip} (${d.appareil || "appareil inconnu"}). Si ce n'est pas vous, changez votre mot de passe et fermez la session.`;
    case "sonde":
      return `Requête visant « ${d.motif} »${ip} : ${d.url}`;
    case "balayage":
      return `${d.requetes} adresses inexistantes en une minute${ip}.`;
    case "acces_refuses":
      return `${d.refus} accès refusés en 5 minutes pour ${a.email || "un compte"}${ip}.`;
    case "abus_debit":
      return `${d.refus} requêtes refusées pour excès de débit${ip}.`;
    case "ip_bloquee":
      return `${a.ip} bloquée jusqu'au ${new Date(d.jusqua).toLocaleString("fr-FR")} : ${d.motif}.`;
    default:
      return titreAlerte(a.type);
  }
};

// ---- Blocage d'adresses -----------------------------------------------------

let bloquees = new Map(); // ip → jusqua (ms)
let lu = 0;
const RELECTURE_MS = 30_000;

const relireBlocages = async () => {
  const lignes = await prisma.ipBloquee.findMany({ where: { jusqua: { gt: new Date() } }, select: { ip: true, jusqua: true } });
  bloquees = new Map(lignes.map((l) => [l.ip, l.jusqua.getTime()]));
  lu = Date.now();
};

const confiance = (ip) => !ip || env.idsIpsConfiance.includes(ip);

export const ipBloquee = async (ip) => {
  if (!ip) return false;
  if (Date.now() - lu > RELECTURE_MS) await relireBlocages().catch(() => {});
  const jusqua = bloquees.get(ip);
  return !!jusqua && jusqua > Date.now();
};

export const bloquerIp = async ({ ip, motif, request, manuel = false, parEmail = null, dureeMs = null }) => {
  if (!ip || (!manuel && confiance(ip))) return null;
  const existante = await prisma.ipBloquee.findUnique({ where: { ip } }).catch(() => null);
  const recidives = existante ? existante.recidives + (existante.jusqua < new Date() ? 1 : 0) : 0;
  const jusqua = new Date(Date.now() + (dureeMs ?? dureeBlocage(recidives)));
  await prisma.ipBloquee.upsert({
    where: { ip },
    create: { ip, motif: motif.slice(0, 200), jusqua, manuel, parEmail, recidives },
    update: { motif: motif.slice(0, 200), jusqua, manuel, parEmail, recidives },
  });
  bloquees.set(ip, jusqua.getTime());
  publier({ type: "ids-blocages" });
  if (!manuel) {
    await alerter({ type: "ip_bloquee", gravite: "haute", request, ip, sujet: `${ip}|${jusqua.getTime()}`, details: { motif, jusqua, recidives } });
  }
  return { ip, jusqua, recidives };
};

export const debloquerIp = async (ip) => {
  await prisma.ipBloquee.deleteMany({ where: { ip } });
  bloquees.delete(ip);
  sondes.oublier(ip);
  publier({ type: "ids-blocages" });
};

// ---- Signaux de connexion (en base, partagés entre instances) --------------

const depuis = (ms) => new Date(Date.now() - ms);

/// Mot de passe refusé. `user` : le compte visé s'il existe.
export const noterEchecConnexion = async (request, { email, user }) => {
  if (!env.idsActif) return;
  const ip = request.ip;
  try {
    await prisma.signalSecurite.create({
      data: { type: "connexion.echec", ip, cle: email, tenantId: user?.tenantId || null, existe: !!user },
    });

    const echecs = await prisma.signalSecurite.count({
      where: { type: "connexion.echec", cle: email, creeLe: { gt: depuis(SEUILS.forceBrute.fenetre) } },
    });
    if (user && echecs >= SEUILS.forceBrute.n) {
      await alerter({
        type: "force_brute",
        gravite: "haute",
        request,
        tenantId: user.tenantId,
        userId: user.id,
        email,
        sujet: email,
        details: { echecs },
        notifierUtilisateur: true,
      });
    }

    // Bourrage : une adresse qui essaie beaucoup de comptes différents,
    // dont beaucoup n'existent pas. Une sortie Internet d'entreprise où
    // quelques salariés se trompent ne réunit pas ces deux conditions.
    const parIp = await prisma.signalSecurite.groupBy({
      by: ["cle", "existe"],
      where: { type: "connexion.echec", ip, creeLe: { gt: depuis(SEUILS.bourrage.fenetre) } },
    });
    const comptes = new Set(parIp.map((l) => l.cle)).size;
    const inexistants = new Set(parIp.filter((l) => !l.existe).map((l) => l.cle)).size;
    if (comptes >= SEUILS.bourrage.comptes && inexistants >= SEUILS.bourrage.inexistants) {
      await alerter({ type: "bourrage_identifiants", gravite: "critique", request, sujet: ip, details: { comptes, inexistants } });
      await bloquerIp({ ip, motif: `bourrage d'identifiants (${comptes} comptes)`, request });
    }
  } catch (err) {
    request.log?.error?.({ err }, "détection : échec de connexion non analysé");
  }
};

/// Code de double authentification refusé : le mot de passe était bon.
export const noterEchecMfa = async (request, user) => {
  if (!env.idsActif || !user) return;
  try {
    await prisma.signalSecurite.create({
      data: { type: "mfa.echec", ip: request.ip, cle: user.id, tenantId: user.tenantId },
    });
    const echecs = await prisma.signalSecurite.count({
      where: { type: "mfa.echec", cle: user.id, creeLe: { gt: depuis(SEUILS.mfa.fenetre) } },
    });
    if (echecs >= SEUILS.mfa.n) {
      await alerter({
        type: "mfa_echecs",
        gravite: "haute",
        request,
        tenantId: user.tenantId,
        userId: user.id,
        email: user.email,
        sujet: user.id,
        details: { echecs },
        notifierUtilisateur: true,
      });
    }
  } catch (err) {
    request.log?.error?.({ err }, "détection : échec de code non analysé");
  }
};

/// Résumé lisible d'un User-Agent — assez pour reconnaître un appareil.
export const appareilDe = (agent = "") => {
  const a = String(agent);
  const nav = /Edg\//.test(a) ? "Edge" : /Chrome\//.test(a) ? "Chrome" : /Firefox\//.test(a) ? "Firefox" : /Safari\//.test(a) ? "Safari" : null;
  const os = /Windows/.test(a) ? "Windows" : /Android/.test(a) ? "Android" : /iPhone|iPad/.test(a) ? "iOS" : /Mac OS X/.test(a) ? "macOS" : /Linux/.test(a) ? "Linux" : null;
  return [nav, os].filter(Boolean).join(" · ") || "appareil inconnu";
};

/// Connexion réussie (avant l'ouverture de la nouvelle session).
export const noterConnexion = async (request, user) => {
  if (!env.idsActif || !user) return;
  try {
    const email = user.email;
    const echecs = await prisma.signalSecurite.count({
      where: { type: "connexion.echec", cle: email, creeLe: { gt: depuis(30 * MIN) } },
    });
    if (echecs >= SEUILS.forceBrute.n) {
      await alerter({
        type: "connexion_apres_echecs",
        gravite: "critique",
        request,
        tenantId: user.tenantId,
        userId: user.id,
        email,
        sujet: `${email}|${Date.now()}`,
        details: { echecs },
        notifierUtilisateur: true,
      });
      return;
    }

    // Nouvel appareil : ni cette adresse ni ce navigateur vus pour ce compte
    // depuis 90 jours. Le tout premier appareil d'un compte n'en est pas un.
    const appareil = appareilDe(request.headers["user-agent"]);
    const passees = await prisma.session.findMany({
      where: { userId: user.id, creeLe: { gt: depuis(90 * 24 * 60 * MIN) } },
      select: { ip: true, agent: true },
      take: 200,
      orderBy: { creeLe: "desc" },
    });
    if (!passees.length) return;
    const ipConnue = passees.some((s) => s.ip === request.ip);
    const appareilConnu = passees.some((s) => appareilDe(s.agent) === appareil);
    if (!ipConnue && !appareilConnu) {
      await alerter({
        type: "nouvel_appareil",
        gravite: "info",
        request,
        tenantId: user.tenantId,
        userId: user.id,
        email,
        sujet: `${user.id}|${request.ip}|${appareil}`,
        details: { appareil },
        notifierUtilisateur: true,
      });
    }
  } catch (err) {
    request.log?.error?.({ err }, "détection : connexion non analysée");
  }
};

// ---- Crochets HTTP ----------------------------------------------------------

const anonyme = (request) =>
  !request.headers.authorization && !String(request.headers.cookie || "").split(";").some((c) => c.trim().startsWith(`${COOKIE_SESSION}=`));

/// `onRequest`, au tout début : une adresse bloquée ne va pas plus loin, et
/// une sonde est repérée avant d'atteindre quoi que ce soit.
export const filtrerIntrusions = async (request, reply) => {
  if (!env.idsActif) return;
  const ip = request.ip;
  if (request.raw.url === "/health") return;
  if (await ipBloquee(ip)) {
    return reply.code(403).send({ error: "Accès temporairement bloqué pour activité suspecte." });
  }
  const motif = motifSuspect(request.raw.url, { anonyme: anonyme(request) });
  if (!motif) return;
  const url = String(request.raw.url).slice(0, 300);
  const n = sondes.noter(ip);
  alerter({ type: "sonde", gravite: "moyenne", request, sujet: ip, details: { motif, url, methode: request.method } }).catch(() => {});
  if (n >= SEUILS.sondes.n && !confiance(ip)) {
    await bloquerIp({ ip, motif: `recherche de failles (${motif})`, request }).catch(() => {});
    return reply.code(403).send({ error: "Accès temporairement bloqué pour activité suspecte." });
  }
  // La sonde elle-même ne mène à rien : inutile d'aller plus loin.
  return reply.code(404).send({ error: "Introuvable" });
};

/// `onResponse` : rafales de 404, de refus, de 429.
export const observerReponse = async (request, reply) => {
  if (!env.idsActif) return;
  const ip = request.ip;
  const code = reply.statusCode;
  if (code === 404) {
    const n = introuvables.noter(ip);
    if (n === SEUILS.balayage.n) {
      alerter({ type: "balayage", gravite: "moyenne", request, sujet: ip, details: { requetes: n } }).catch(() => {});
    }
  } else if ((code === 401 || code === 403) && request.user) {
    const n = refus.noter(request.user.id);
    if (n === SEUILS.refus.n) {
      alerter({
        type: "acces_refuses",
        gravite: "moyenne",
        request,
        tenantId: request.user.tenantId,
        userId: request.user.id,
        email: request.user.email,
        sujet: request.user.id,
        details: { refus: n, derniere: String(request.raw.url).split("?")[0].slice(0, 200) },
      }).catch(() => {});
    }
  } else if (code === 429) {
    const n = debits.noter(ip);
    if (n === SEUILS.debit.n) {
      alerter({ type: "abus_debit", gravite: "moyenne", request, sujet: ip, details: { refus: n } }).catch(() => {});
    }
  }
};

// ---- Démarrage, ménage ------------------------------------------------------

let desabonner = null;
let menage = null;

export const purgerDetection = async () => {
  await prisma.signalSecurite.deleteMany({ where: { creeLe: { lt: depuis(24 * 60 * MIN) } } });
  await prisma.alerteSecurite.deleteMany({ where: { creeLe: { lt: depuis(180 * 24 * 60 * MIN) } } });
  await prisma.ipBloquee.deleteMany({ where: { jusqua: { lt: depuis(30 * 24 * 60 * MIN) } } });
};

export const demarrerDetection = () => {
  if (desabonner) return;
  desabonner = abonner((evt) => {
    if (evt?.type === "ids-blocages") lu = 0;
  });
  relireBlocages().catch(() => {});
  purgerDetection().catch(() => {});
  menage = setInterval(() => purgerDetection().catch(() => {}), 60 * MIN);
  menage.unref?.();
};

export const arreterDetection = () => {
  desabonner?.();
  desabonner = null;
  clearInterval(menage);
};

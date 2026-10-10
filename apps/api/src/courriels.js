import { randomBytes } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { journaliserPour } from "./audit.js";
import { publier } from "./evenements.js";
import { consommerQuota, ecrireOuNettoyer, piloteEcriture, piloteLecture } from "./storage.js";
import { typeNeutralise } from "./mimetype.js";
import { creerTransporteur, creerTransporteurEspace, envoyerVia } from "./mail.js";
import { compterEnvois, messageQuotaAtteint, peutEnvoyer } from "./quota-mail.js";
import {
  adresseValide,
  analyserAdresse,
  extraitDe,
  formaterAdresse,
  listeAdresses,
  texteDeHtml,
} from "@companyos/shared/courrier";
import { Readable } from "node:stream";

/// Le cœur de la messagerie : visibilité, envoi (immédiat ou programmé),
/// nettoyage du HTML reçu, pièces jointes rangées dans le Cloud.
///
/// Les routes (routes/courrier.js) et la synchronisation IMAP
/// (courrielsSync.js) passent par ici.

export const DOSSIERS = ["reception", "envoyes", "brouillons", "programmes", "archives", "corbeille", "indesirables"];
export const PIECES_MAX = 10;
export const PIECES_OCTETS_MAX = 20 * 1024 * 1024;
export const DESTINATAIRES_MAX = 25;

export const nouvelId = () => randomBytes(12).toString("base64url");

// ---- Visibilité -------------------------------------------------------------
//
// Une boîte partagée (contact@…) se lit par tous les membres ; une boîte
// personnelle, par son titulaire seulement. Les envois faits sans boîte
// (relais de l'espace) restent visibles de toute l'équipe, comme avant.
// Brouillons et envois programmés n'appartiennent qu'à leur auteur.

export const boitesAccessibles = (user) =>
  prisma.boiteCourriel.findMany({
    where: { tenantId: user.tenantId, OR: [{ userId: null }, { userId: user.id }] },
    orderBy: [{ userId: "asc" }, { creeLe: "asc" }],
  });

export const filtreVisible = async (user) => {
  const ids = (await boitesAccessibles(user)).map((b) => b.id);
  return {
    tenantId: user.tenantId,
    AND: [
      { OR: [{ boiteId: null }, { boiteId: { in: ids } }] },
      { OR: [{ dossier: { notIn: ["brouillons", "programmes"] } }, { userId: user.id }] },
    ],
  };
};

export const courrielVisible = async (user, id) =>
  prisma.courriel.findFirst({ where: { id: String(id), ...(await filtreVisible(user)) } });

/// Ce que l'API renvoie d'une boîte : jamais les mots de passe.
export const vueBoite = (b, user) => ({
  id: b.id,
  nom: b.nom,
  adresse: b.adresse,
  partagee: !b.userId,
  mienne: b.userId === user?.id,
  actif: b.actif,
  signature: b.signature || "",
  imap: { host: b.imap?.host || "", port: b.imap?.port || 993, user: b.imap?.user || "", motDePasseDefini: !!b.imap?.pass },
  smtp: b.smtp?.host
    ? { host: b.smtp.host, port: b.smtp.port || 587, user: b.smtp.user || "", motDePasseDefini: !!b.smtp.pass }
    : null,
  derniereSynchro: b.derniereSynchro,
  erreur: b.erreur,
});

export const vueCourriel = (c, { complet = false } = {}) => {
  const base = {
    id: c.id,
    boiteId: c.boiteId,
    dossier: c.dossier,
    filId: c.filId,
    de: { nom: c.deNom || "", email: c.deEmail || "" },
    a: c.a || [],
    cc: c.cc || [],
    sujet: c.sujet,
    extrait: c.extrait,
    date: c.date,
    lu: c.lu,
    suivi: c.suivi,
    etiquettes: c.etiquettes || [],
    pieces: c.pieces || [],
    statut: c.statut,
    erreur: c.erreur,
    envoiLe: c.envoiLe,
    liens: c.liens || [],
    userId: c.userId,
  };
  if (!complet) return base;
  return { ...base, cci: c.cci || [], texte: c.texte, html: c.html, messageId: c.messageId, inReplyTo: c.inReplyTo, references: c.references || [] };
};

// ---- HTML reçu --------------------------------------------------------------
//
// Le HTML d'un courriel vient de n'importe qui. Il est nettoyé ici (pas de
// script, pas de formulaire, pas d'iframe, liens ouverts à part), puis
// affiché dans un cadre isolé sans scripts, où les images distantes ne se
// chargent qu'à la demande (elles servent à pister l'ouverture).

export const nettoyerHtml = (html) =>
  sanitizeHtml(String(html || ""), {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "img", "span", "font", "center", "u", "s", "del", "ins", "hr", "sup", "sub", "small", "big",
      "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col", "h1", "h2",
    ],
    disallowedTagsMode: "discard",
    allowedAttributes: {
      "*": ["style", "align", "valign", "width", "height", "bgcolor", "dir", "title", "lang"],
      a: ["href", "name", "title", "target", "rel"],
      img: ["src", "alt", "width", "height", "title", "style"],
      td: ["colspan", "rowspan", "style", "align", "valign", "width", "bgcolor"],
      th: ["colspan", "rowspan", "style", "align", "valign", "width", "bgcolor"],
      table: ["border", "cellpadding", "cellspacing", "style", "width", "align", "bgcolor"],
      font: ["face", "size", "color"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data", "cid"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tag, attribs) => ({ tagName: "a", attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" } }),
    },
  // `expression()` et `url(javascript:` dans les styles en ligne.
  }).replace(/style="[^"]*(expression\s*\(|javascript:)[^"]*"/gi, "");

// ---- Pièces jointes dans le Cloud --------------------------------------------

/// Le dossier « Courrier » de l'espace (et un sous-dossier), créés au besoin.
export const dossierCloud = async (tenantId, ownerId, sousDossier) => {
  const trouverOuCreer = async (parentId, name) => {
    const existant = await prisma.fsNode.findFirst({ where: { tenantId, parentId, name, type: "FOLDER", deletedAt: null } });
    if (existant) return existant;
    try {
      return await prisma.fsNode.create({ data: { tenantId, ownerId, parentId, name, type: "FOLDER" } });
    } catch {
      // Créé à l'instant par une autre requête.
      return prisma.fsNode.findFirst({ where: { tenantId, parentId, name, type: "FOLDER", deletedAt: null } });
    }
  };
  const racine = await trouverOuCreer(null, "Courrier");
  return sousDossier ? trouverOuCreer(racine.id, sousDossier) : racine;
};

const nomLibre = async (tenantId, parentId, nom) => {
  const pris = new Set(
    (await prisma.fsNode.findMany({ where: { tenantId, parentId, deletedAt: null }, select: { name: true } })).map((n) => n.name),
  );
  if (!pris.has(nom)) return nom;
  const point = nom.lastIndexOf(".");
  const base = point > 0 ? nom.slice(0, point) : nom;
  const ext = point > 0 ? nom.slice(point) : "";
  for (let i = 2; i < 1000; i++) if (!pris.has(`${base} (${i})${ext}`)) return `${base} (${i})${ext}`;
  return `${base} ${nouvelId()}${ext}`;
};

/// Range un contenu (Buffer) dans le Cloud de l'espace. Rend le nœud.
export const rangerDansCloud = async ({ tenantId, ownerId, parentId, nom, contenu, type }) => {
  const nomPropre = String(nom || "piece-jointe").replace(/[\\/\0]/g, "_").slice(0, 200) || "piece-jointe";
  const pilote = await piloteEcriture(tenantId);
  const cle = pilote.buildKey(tenantId, nomPropre);
  const taille = await ecrireOuNettoyer(pilote, cle, Readable.from(contenu));
  try {
    return await prisma.$transaction(async (tx) => {
      const noeud = await tx.fsNode.create({
        data: {
          tenantId,
          ownerId,
          parentId,
          name: await nomLibre(tenantId, parentId, nomPropre),
          type: "FILE",
          size: BigInt(taille),
          mimeType: typeNeutralise(type || "application/octet-stream"),
          storageKey: cle,
          storage: pilote.nom,
        },
      });
      await consommerQuota(tx, tenantId, taille);
      return noeud;
    });
  } catch (err) {
    await pilote.remove(cle).catch(() => {});
    throw err;
  }
};

/// Lit des fichiers du Cloud pour les joindre à un envoi.
const lirePieces = async (tenantId, ids) => {
  const pieces = [];
  const resume = [];
  let total = 0n;
  for (const id of ids) {
    const node = await prisma.fsNode.findFirst({ where: { id, tenantId, type: "FILE", deletedAt: null } });
    if (!node) throw Object.assign(new Error("Pièce jointe introuvable."), { statut: 404 });
    total += node.size;
    if (total > BigInt(PIECES_OCTETS_MAX)) {
      throw Object.assign(new Error("Pièces jointes trop lourdes (20 Mo au total, maximum)."), { statut: 413 });
    }
    pieces.push({ filename: node.name, content: (await piloteLecture(node.storage, tenantId)).read(node.storageKey) });
    resume.push({ nom: node.name, taille: Number(node.size), type: node.mimeType, fsNodeId: node.id });
  }
  return { pieces, resume };
};

// ---- Fils ---------------------------------------------------------------------

export const filDuMessage = async (tenantId, { inReplyTo, references = [] }) => {
  const candidats = [inReplyTo, ...[...(references || [])].reverse()].filter(Boolean).slice(0, 30);
  if (!candidats.length) return null;
  const connu = await prisma.courriel.findFirst({
    where: { tenantId, messageId: { in: candidats } },
    select: { filId: true },
    orderBy: { date: "desc" },
  });
  return connu?.filId || null;
};

// ---- Envoi --------------------------------------------------------------------

const installationCourrier = async (tenantId) => {
  const app = await prisma.app.findFirst({ where: { slug: "courrier", OR: [{ tenantId: null }, { tenantId }] } });
  if (!app) return null;
  return prisma.installation.findUnique({ where: { tenantId_appId: { tenantId, appId: app.id } } });
};

/// Le relais et l'expéditeur d'un envoi : la boîte si elle a son propre
/// SMTP, sinon le relais de l'espace (avec la boîte en « Répondre à »),
/// sinon celui de la plateforme.
export const relaisPour = async ({ tenantId, tenantNom, user, boite }) => {
  if (boite?.smtp?.host) {
    return {
      transport: creerTransporteurEspace(boite.smtp),
      de: formaterAdresse({ nom: boite.userId ? user?.name || boite.nom : boite.nom, email: boite.adresse }),
      repondreA: null,
      domaine: boite.adresse.split("@")[1],
    };
  }
  const smtp = (await installationCourrier(tenantId))?.settings?.smtp;
  const transport = smtp?.host
    ? creerTransporteurEspace(smtp)
    : creerTransporteur({ host: env.smtpHost, port: env.smtpPort, user: env.smtpUser, pass: env.smtpPass });
  const de = smtp?.de || `${tenantNom || "CompanyOS"} <${smtp?.user || env.smtpUser || "no-reply@localhost"}>`;
  return {
    transport,
    de,
    repondreA: boite ? formaterAdresse({ nom: boite.nom, email: boite.adresse }) : null,
    domaine: analyserAdresse(de).email.split("@")[1] || "companyos.local",
  };
};

const valider = (liste, champ) => {
  const invalides = liste.filter((x) => !adresseValide(x.email));
  if (invalides.length) throw Object.assign(new Error(`${champ} : adresse invalide (${invalides.slice(0, 3).map((x) => x.email).join(", ")}).`), { statut: 400 });
  if (liste.length > DESTINATAIRES_MAX) {
    throw Object.assign(new Error(`${champ} : ${DESTINATAIRES_MAX} destinataires au plus. Pour un envoi de masse, utilisez Campagnes.`), { statut: 400 });
  }
};

/// Prépare puis envoie un message. `message` :
///   { boiteId?, a, cc?, cci?, sujet, html?, texte?, piecesIds?, inReplyTo?, references?, liens? }
/// `courrielId` : un brouillon (ou envoi programmé) existant à transformer.
/// Rend le courriel enregistré ; lève { statut } sur une erreur de saisie.
export const envoyerCourriel = async ({ user, message, courrielId = null, requete = null }) => {
  const tenantId = user.tenantId;
  const a = listeAdresses(message.a);
  const cc = listeAdresses(message.cc || []);
  const cci = listeAdresses(message.cci || []);
  if (!a.length) throw Object.assign(new Error("Destinataire : aucune adresse."), { statut: 400 });
  valider(a, "Destinataire");
  valider(cc, "Copie");
  valider(cci, "Copie cachée");
  const sujet = String(message.sujet || "").trim().slice(0, 300);
  if (!sujet) throw Object.assign(new Error("Le sujet est requis."), { statut: 400 });
  const html = message.html ? nettoyerHtml(message.html) : null;
  const texte = String(message.texte || (html ? texteDeHtml(html) : "")).slice(0, 200_000);
  if (!texte.trim() && !html) throw Object.assign(new Error("Le message est vide."), { statut: 400 });

  let boite = null;
  if (message.boiteId) {
    boite = (await boitesAccessibles(user)).find((b) => b.id === message.boiteId) || null;
    if (!boite) throw Object.assign(new Error("Boîte d'envoi introuvable."), { statut: 404 });
  }

  const destinataires = a.length + cc.length + cci.length;
  if (!(await peutEnvoyer(tenantId, destinataires))) {
    throw Object.assign(new Error(messageQuotaAtteint()), { statut: 429 });
  }

  const ids = [...new Set(message.piecesIds || [])].slice(0, PIECES_MAX + 1);
  if (ids.length > PIECES_MAX) throw Object.assign(new Error(`${PIECES_MAX} pièces jointes au plus.`), { statut: 400 });
  const { pieces, resume } = await lirePieces(tenantId, ids);

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  const relais = await relaisPour({ tenantId, tenantNom: tenant?.name, user, boite });
  if (!relais.transport) {
    throw Object.assign(new Error("Aucun relais SMTP configuré. Renseignez-le dans Courrier → Réglages."), { statut: 409 });
  }

  const messageId = `<${nouvelId()}.${Date.now().toString(36)}@${relais.domaine}>`;
  const references = [...(message.references || []), message.inReplyTo].filter(Boolean).filter((v, i, l) => l.indexOf(v) === i).slice(-20);
  // Le fil : celui du message auquel on répond (ses en-têtes, ou le fil
  // indiqué par l'interface pour un message sans Message-ID).
  let filId = await filDuMessage(tenantId, { inReplyTo: message.inReplyTo, references });
  if (!filId && message.filId) {
    filId = (await prisma.courriel.findFirst({ where: { tenantId, filId: String(message.filId) }, select: { filId: true } }))?.filId || null;
  }

  const resultat = await envoyerVia(relais.transport, {
    de: relais.de,
    a: a.map(formaterAdresse).join(", "),
    cc: cc.length ? cc.map(formaterAdresse).join(", ") : undefined,
    cci: cci.length ? cci.map(formaterAdresse).join(", ") : undefined,
    sujet,
    texte,
    html: html || undefined,
    piecesJointes: pieces.length ? pieces : undefined,
    messageId,
    inReplyTo: message.inReplyTo || undefined,
    references,
    repondreA: relais.repondreA,
  });
  if (resultat.envoye) await compterEnvois(tenantId, destinataires);

  const exp = analyserAdresse(relais.repondreA || relais.de);
  const donnees = {
    tenantId,
    boiteId: boite?.id || null,
    dossier: "envoyes",
    messageId,
    inReplyTo: message.inReplyTo || null,
    references,
    deNom: exp.nom || user.name || null,
    deEmail: exp.email || null,
    a,
    cc: cc.length ? cc : undefined,
    cci: cci.length ? cci : undefined,
    sujet,
    texte,
    html,
    extrait: extraitDe(texte, 200),
    date: new Date(),
    lu: true,
    pieces: resume.length ? resume : undefined,
    statut: resultat.envoye ? "envoye" : "echec",
    erreur: resultat.erreur || null,
    envoiLe: null,
    userId: user.id,
    liens: message.liens?.length ? message.liens : undefined,
  };

  let courriel;
  if (courrielId) {
    courriel = await prisma.courriel.update({ where: { id: courrielId }, data: { ...donnees, ...(filId ? { filId } : {}) } });
  } else {
    const id = nouvelId();
    courriel = await prisma.courriel.create({ data: { id, filId: filId || id, ...donnees } });
  }

  // Compatibilité : le CRM (chronologie d'un compte), les automatisations
  // et l'historique d'avant lisent encore les fiches courrier/envois. Même
  // identifiant que le courriel : la reprise de l'historique (migration)
  // ne peut pas le dupliquer.
  await prisma.record
    .upsert({
      where: { id: courriel.id },
      create: {
        id: courriel.id,
        tenantId,
        userId: user.id,
        module: "courrier",
        collection: "envois",
        data: {
          a: a.map((x) => x.email).join(", "),
          cc: cc.map((x) => x.email).join(", ") || null,
          sujet,
          texte,
          extrait: texte.slice(0, 160),
          pieces: resume.map((p) => p.nom),
          pieceJointe: resume[0]?.nom || null,
          envoye: resultat.envoye,
          erreur: resultat.erreur || null,
          date: new Date().toISOString(),
        },
      },
      update: {},
    })
    .catch(() => {});

  if (resultat.envoye && requete) {
    await journaliserPour(requete, user, "courrier.envoi", a.map((x) => x.email).join(", "), { sujet, fil: courriel.filId });
  }
  publierCourrier({ tenantId, boite, userId: user.id });
  return courriel;
};

/// Prévient les navigateurs ouverts qu'une boîte a bougé.
export const publierCourrier = ({ tenantId, boite = null, userId = null }) =>
  publier({ type: "courrier", t: tenantId, boiteId: boite?.id || null, prive: boite?.userId || null, par: userId });

// ---- Envois programmés --------------------------------------------------------

let minuteur = null;

export const envoyerProgrammes = async () => {
  const dus = await prisma.courriel.findMany({
    where: { statut: "programme", envoiLe: { lte: new Date() } },
    take: 20,
    orderBy: { envoiLe: "asc" },
  });
  for (const c of dus) {
    // Réservation : une seule instance l'envoie.
    const { count } = await prisma.courriel.updateMany({ where: { id: c.id, statut: "programme" }, data: { statut: "envoi" } });
    if (!count) continue;
    const user = c.userId ? await prisma.user.findUnique({ where: { id: c.userId } }) : null;
    if (!user) {
      await prisma.courriel.update({ where: { id: c.id }, data: { statut: "echec", dossier: "envoyes", erreur: "Auteur introuvable." } });
      continue;
    }
    try {
      await envoyerCourriel({
        user,
        courrielId: c.id,
        requete: { ip: null, headers: {}, log: console },
        message: {
          boiteId: c.boiteId,
          a: c.a,
          cc: c.cc || [],
          cci: c.cci || [],
          sujet: c.sujet,
          html: c.html,
          texte: c.texte,
          piecesIds: (c.pieces || []).map((p) => p.fsNodeId).filter(Boolean),
          inReplyTo: c.inReplyTo,
          references: c.references || [],
          liens: c.liens || [],
        },
      });
    } catch (err) {
      await prisma.courriel.update({ where: { id: c.id }, data: { statut: "echec", dossier: "envoyes", erreur: err.message } });
    }
  }
};

export const demarrerEnvoisProgrammes = () => {
  if (minuteur) return;
  minuteur = setInterval(() => envoyerProgrammes().catch((e) => console.error("Envois programmés :", e.message)), 30_000);
  minuteur.unref?.();
};

export const arreterEnvoisProgrammes = () => {
  clearInterval(minuteur);
  minuteur = null;
};

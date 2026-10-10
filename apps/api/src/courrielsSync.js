import net from "node:net";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { resoudre } from "./web.js";
import { motDePasseClair } from "./mail.js";
import { notifier } from "./notifier.js";
import { planifier } from "./moteurAutomatisations.js";
import { extraitDe, texteDeHtml } from "@companyos/shared/courrier";
import { dossierCloud, filDuMessage, nettoyerHtml, nouvelId, publierCourrier, rangerDansCloud } from "./courriels.js";

/// Réception : relève des boîtes IMAP reliées à CompanyOS.
///
/// Toutes les deux minutes, chaque boîte active est relevée par une seule
/// instance (bail `syncJusqua`). Seuls les nouveaux messages sont lus
/// (UID > dernier UID connu) ; à la première relève, les 30 derniers jours
/// (100 messages au plus). Les pièces jointes sont rangées dans le Cloud
/// (Courrier › Pièces reçues), le HTML est nettoyé, le message rejoint son
/// fil d'après ses en-têtes.
///
/// Le serveur IMAP est saisi par l'espace : comme pour le relais SMTP, il
/// doit être une adresse publique, sur un port IMAP — sinon la plateforme
/// servirait à sonder son propre réseau interne.

export const PORTS_IMAP = [993, 143];
const TAILLE_MAX = 30 * 1024 * 1024;
const PIECE_MAX = 25 * 1024 * 1024;
const INLINE_MAX = 400 * 1024;
const RELEVE_MS = 2 * 60_000;
const BAIL_MS = 5 * 60_000;

/// Client IMAP vers une adresse vérifiée publique.
export const creerClientImap = async (imap) => {
  const port = Number(imap?.port) || 993;
  if (!PORTS_IMAP.includes(port)) throw new Error(`Port IMAP non autorisé (ports acceptés : ${PORTS_IMAP.join(", ")}).`);
  const nom = String(imap?.host || "").trim();
  if (!nom) throw new Error("Serveur IMAP manquant.");
  let host = nom;
  if (env.production || process.env.AUTORISER_RESEAU_PRIVE !== "true") {
    try {
      host = (await resoudre(nom))[0].address;
    } catch {
      throw new Error("Le serveur IMAP doit être une adresse publique joignable sur Internet.");
    }
  }
  return new ImapFlow({
    host,
    port,
    secure: port === 993,
    tls: { servername: net.isIP(nom) ? undefined : nom },
    auth: { user: String(imap.user || ""), pass: motDePasseClair(imap.pass) },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 90_000,
  });
};

const adresses = (champ) =>
  (Array.isArray(champ) ? champ : champ ? [champ] : [])
    .flatMap((g) => g.value || [])
    .flatMap((v) => (v.group ? v.group : [v]))
    .filter((v) => v.address)
    .map((v) => ({ nom: v.name || "", email: String(v.address).toLowerCase() }));

/// Les images intégrées (cid:) remplacées par leur contenu, quand elles
/// sont petites : sans cela, le cadre de lecture n'aurait que des trous.
const integrerImages = (html, pieces) => {
  let sortie = html;
  const utilisees = new Set();
  for (const p of pieces) {
    if (!p.cid || !p.contentType?.startsWith("image/") || p.size > INLINE_MAX) continue;
    const re = new RegExp(`cid:${p.cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi");
    if (!re.test(sortie)) continue;
    sortie = sortie.replace(re, `data:${p.contentType};base64,${p.content.toString("base64")}`);
    utilisees.add(p);
  }
  return { html: sortie, utilisees };
};

const proprietaireFichiers = async (boite) =>
  boite.userId ||
  (await prisma.user.findFirst({ where: { tenantId: boite.tenantId, role: "OWNER" }, select: { id: true } }))?.id ||
  (await prisma.user.findFirst({ where: { tenantId: boite.tenantId }, select: { id: true } }))?.id;

/// Analyse un message brut et l'enregistre. Rend le courriel, ou null s'il
/// était déjà connu.
export const enregistrerRecu = async (boite, { uid, source, flags = new Set() }) => {
  const p = await simpleParser(source, { skipImageLinks: true, maxHtmlLengthToParse: 3_000_000 });
  const messageId = p.messageId || null;
  if (messageId) {
    const deja = await prisma.courriel.findFirst({ where: { tenantId: boite.tenantId, boiteId: boite.id, messageId }, select: { id: true } });
    if (deja) return null;
  }
  const references = (Array.isArray(p.references) ? p.references : p.references ? [p.references] : []).slice(-30);
  const inReplyTo = p.inReplyTo || null;
  const de = adresses(p.from)[0] || { nom: "", email: "" };

  const piecesBrutes = p.attachments || [];
  let html = typeof p.html === "string" ? p.html : null;
  let enLigne = new Set();
  if (html) {
    const r = integrerImages(html, piecesBrutes);
    html = nettoyerHtml(r.html);
    enLigne = r.utilisees;
  }
  const texte = (p.text || (html ? texteDeHtml(html) : "")).slice(0, 200_000);

  // Pièces jointes : dans le Cloud, où elles s'ouvrent, se partagent et
  // se rangent comme n'importe quel fichier.
  const pieces = [];
  const aRanger = piecesBrutes.filter((x) => !enLigne.has(x) && !(x.related && x.contentDisposition === "inline" && x.cid)).slice(0, 15);
  if (aRanger.length) {
    const ownerId = await proprietaireFichiers(boite);
    const dossier = ownerId ? await dossierCloud(boite.tenantId, ownerId, "Pièces reçues") : null;
    for (const x of aRanger) {
      const nom = x.filename || `piece-jointe${x.contentType ? `.${x.contentType.split("/")[1]}` : ""}`;
      if (!dossier || x.size > PIECE_MAX) {
        pieces.push({ nom, taille: x.size, type: x.contentType, erreur: x.size > PIECE_MAX ? "trop lourde" : "non rangée" });
        continue;
      }
      try {
        const noeud = await rangerDansCloud({ tenantId: boite.tenantId, ownerId, parentId: dossier.id, nom, contenu: x.content, type: x.contentType });
        pieces.push({ nom: noeud.name, taille: Number(noeud.size), type: noeud.mimeType, fsNodeId: noeud.id });
      } catch (err) {
        pieces.push({ nom, taille: x.size, type: x.contentType, erreur: err.code === "QUOTA" ? "quota atteint" : "non rangée" });
      }
    }
  }

  const spam = /^yes/i.test(String(p.headers?.get("x-spam-flag") || "")) || /^\s*yes/i.test(String(p.headers?.get("x-spam-status") || ""));
  const id = nouvelId();
  const filId = (await filDuMessage(boite.tenantId, { inReplyTo, references })) || id;
  try {
    return await prisma.courriel.create({
      data: {
        id,
        tenantId: boite.tenantId,
        boiteId: boite.id,
        dossier: spam ? "indesirables" : "reception",
        filId,
        messageId,
        inReplyTo,
        references,
        uid,
        deNom: de.nom || null,
        deEmail: de.email || null,
        a: adresses(p.to),
        cc: adresses(p.cc),
        sujet: String(p.subject || "").slice(0, 500),
        texte,
        html,
        extrait: extraitDe(texte, 200),
        date: p.date && !Number.isNaN(p.date.getTime()) ? p.date : new Date(),
        lu: flags.has?.("\\Seen") || false,
        pieces: pieces.length ? pieces : undefined,
        statut: "recu",
      },
    });
  } catch (err) {
    if (err.code === "P2002") return null; // relevé à l'instant par une autre instance
    throw err;
  }
};

/// Relève une boîte. `fabrique` : pour les tests, un faux client IMAP.
export const synchroniserBoite = async (boiteId, { fabrique = creerClientImap, limiteInitiale = 100, forcer = false } = {}) => {
  const maintenant = new Date();
  const { count } = await prisma.boiteCourriel.updateMany({
    where: { id: boiteId, actif: true, ...(forcer ? {} : { OR: [{ syncJusqua: null }, { syncJusqua: { lt: maintenant } }] }) },
    data: { syncJusqua: new Date(maintenant.getTime() + BAIL_MS) },
  });
  if (!count) return { ignoree: true };
  const boite = await prisma.boiteCourriel.findUnique({ where: { id: boiteId } });
  const nouveaux = [];
  let client;
  try {
    client = await fabrique(boite.imap);
    await client.connect();
    const verrou = await client.getMailboxLock("INBOX");
    let dernier = boite.dernierUid;
    let validite = boite.uidValidite;
    try {
      const mb = client.mailbox || {};
      const v = mb.uidValidity != null ? BigInt(mb.uidValidity) : null;
      if (v != null && (validite == null || BigInt(validite) !== v)) {
        // Le serveur a renuméroté la boîte : les anciens UID ne valent plus rien.
        if (validite != null) await prisma.courriel.updateMany({ where: { boiteId: boite.id }, data: { uid: null } });
        dernier = 0;
        validite = v;
      }
      let plage;
      if (dernier === 0) {
        const trouves = (await client.search({ since: new Date(Date.now() - 30 * 86400_000) }, { uid: true })) || [];
        plage = [...trouves].sort((a, b) => a - b).slice(-limiteInitiale);
      } else {
        plage = `${dernier + 1}:*`;
      }
      if (Array.isArray(plage) ? plage.length : true) {
        const lus = [];
        for await (const msg of client.fetch(plage, { uid: true, size: true, flags: true, source: true }, { uid: true })) {
          if (msg.uid <= dernier) continue; // « n:* » rend le dernier même s'il est déjà connu
          lus.push(msg);
          if (lus.length >= 300) break;
        }
        for (const msg of lus.sort((a, b) => a.uid - b.uid)) {
          if (msg.size > TAILLE_MAX || !msg.source) {
            dernier = Math.max(dernier, msg.uid);
            continue;
          }
          const c = await enregistrerRecu(boite, msg);
          if (c) nouveaux.push(c);
          dernier = Math.max(dernier, msg.uid);
        }
      }
    } finally {
      verrou.release();
    }
    await client.logout().catch(() => {});
    await prisma.boiteCourriel.update({
      where: { id: boite.id },
      data: { dernierUid: dernier, uidValidite: validite, derniereSynchro: new Date(), erreur: null, syncJusqua: null },
    });
  } catch (err) {
    try {
      await client?.logout();
    } catch {
      // déjà fermé
    }
    const message = err.authenticationFailed || err.serverResponseCode === "AUTHENTICATIONFAILED"
      ? "Identifiants IMAP refusés par le serveur."
      : String(err.message || err).slice(0, 300);
    await prisma.boiteCourriel.update({ where: { id: boite.id }, data: { erreur: message, syncJusqua: null, derniereSynchro: new Date() } });
    return { erreur: message, nouveaux: nouveaux.length };
  }

  if (nouveaux.length) await apresReception(boite, nouveaux);
  return { nouveaux: nouveaux.length };
};

/// Après une relève : notification (boîte personnelle), automatisations
/// (« quand un courriel arrive… »), rafraîchissement des fenêtres ouvertes.
const apresReception = async (boite, nouveaux) => {
  const recus = nouveaux.filter((c) => c.dossier === "reception" && !c.lu);
  if (boite.userId && recus.length) {
    const un = recus[0];
    await notifier(boite.tenantId, [boite.userId], {
      source: "Courrier",
      titre: recus.length > 1 ? `${recus.length} nouveaux courriels` : `${un.deNom || un.deEmail} : ${un.sujet || "(sans sujet)"}`,
      message: recus.length > 1 ? recus.slice(0, 3).map((c) => c.deNom || c.deEmail).join(", ") : un.extrait,
      lien: { app: "courrier", params: { courriel: un.id } },
    }).catch(() => {});
  }
  for (const c of nouveaux) {
    planifier({
      tenantId: boite.tenantId,
      module: "courrier",
      collection: "recus",
      evenement: "creation",
      id: c.id,
      fiche: { deEmail: c.deEmail, deNom: c.deNom, sujet: c.sujet, texte: c.texte.slice(0, 5000), boite: boite.nom, adresseBoite: boite.adresse, pieces: (c.pieces || []).length },
      auteur: { id: null, nom: "Courrier" },
      profondeur: 0,
    });
  }
  publierCourrier({ tenantId: boite.tenantId, boite });
};

// ---- Relève périodique ----------------------------------------------------------

let minuteur = null;
let enCours = false;

export const releverTout = async () => {
  if (enCours) return;
  enCours = true;
  try {
    const boites = await prisma.boiteCourriel.findMany({
      where: { actif: true, OR: [{ syncJusqua: null }, { syncJusqua: { lt: new Date() } }] },
      select: { id: true },
      take: 200,
    });
    // Trois à la fois : un serveur lent ne retarde pas tout le monde.
    for (let i = 0; i < boites.length; i += 3) {
      await Promise.all(boites.slice(i, i + 3).map((b) => synchroniserBoite(b.id).catch(() => {})));
    }
  } finally {
    enCours = false;
  }
};

export const demarrerSynchroCourriel = () => {
  if (minuteur || process.env.COURRIER_RELEVE === "false") return;
  setTimeout(() => releverTout().catch(() => {}), 20_000).unref?.();
  minuteur = setInterval(() => releverTout().catch((e) => console.error("Relève du courrier :", e.message)), RELEVE_MS);
  minuteur.unref?.();
};

export const arreterSynchroCourriel = () => {
  clearInterval(minuteur);
  minuteur = null;
};

/// Essaie une configuration IMAP sans rien enregistrer (bouton « Tester »).
export const testerImap = async (imap, { fabrique = creerClientImap } = {}) => {
  const client = await fabrique(imap);
  try {
    await client.connect();
    const etat = await client.status("INBOX", { messages: true, unseen: true });
    return { ok: true, messages: etat.messages, nonLus: etat.unseen };
  } finally {
    await client.logout().catch(() => {});
  }
};

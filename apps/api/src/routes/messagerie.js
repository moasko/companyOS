import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, serialize } from "../db.js";
import { journaliser } from "../audit.js";
import { chiffrer } from "../chiffrement.js";
import { accesModule } from "../acces.js";
import {
  DOSSIERS,
  PIECES_MAX,
  boitesAccessibles,
  courrielVisible,
  envoyerCourriel,
  filtreVisible,
  nettoyerHtml,
  nouvelId,
  publierCourrier,
  vueBoite,
  vueCourriel,
} from "../courriels.js";
import { PORTS_IMAP, synchroniserBoite, testerImap } from "../courrielsSync.js";
import { PORTS_SMTP } from "../mail.js";
import { adresseValide, extraitDe, listeAdresses, texteDeHtml } from "@companyos/shared/courrier";

/// La messagerie (montée sous /api/courrier par routes/courrier.js) :
/// boîtes IMAP, conversations, brouillons, envois, contexte du
/// correspondant dans les autres applications.

const LIMITE_ENVOI = { rateLimit: { max: 30, timeWindow: "15 minutes" } };
const estAdmin = (user) => ["OWNER", "ADMIN"].includes(user.role);
const erreur = (reply, err) => reply.code(err.statut || 500).send({ error: err.statut ? err.message : "Erreur du serveur" });

const adresseSchema = z.object({ nom: z.string().max(200).optional().default(""), email: z.string().trim().toLowerCase().max(254) });
const listeSchema = z.union([z.string().max(10_000), z.array(z.union([z.string().max(400), adresseSchema])).max(60)]).optional();

const serveurSchema = (ports) =>
  z.object({
    host: z.string().trim().min(3).max(253),
    port: z.coerce.number().int().refine((p) => ports.includes(p), { message: `Port non autorisé (${ports.join(", ")}).` }),
    user: z.string().trim().max(254).default(""),
    pass: z.string().max(500).default(""),
  });

const boiteSchema = z.object({
  nom: z.string().trim().min(1).max(80),
  adresse: z.string().trim().toLowerCase().refine(adresseValide, "Adresse invalide."),
  partagee: z.boolean().default(false),
  imap: serveurSchema(PORTS_IMAP),
  smtp: serveurSchema(PORTS_SMTP).nullable().optional(),
  signature: z.string().max(5000).default(""),
  actif: z.boolean().default(true),
});

const messageSchema = z.object({
  boiteId: z.string().max(40).nullable().optional(),
  a: listeSchema,
  cc: listeSchema,
  cci: listeSchema,
  sujet: z.string().max(300).default(""),
  html: z.string().max(1_000_000).optional(),
  texte: z.string().max(200_000).optional(),
  piecesIds: z.array(z.string().max(40)).max(PIECES_MAX).default([]),
  inReplyTo: z.string().max(998).nullable().optional(),
  references: z.array(z.string().max(998)).max(40).default([]),
  filId: z.string().max(40).nullable().optional(),
  liens: z.array(z.object({ app: z.string().max(40), collection: z.string().max(40), id: z.string().max(40), libelle: z.string().max(200).default("") })).max(20).default([]),
});

/// Courriels où une adresse figure parmi les destinataires (colonne JSON).
const idsDestinataire = async (tenantId, motif, { exact = false } = {}) => {
  const m = String(motif).toLowerCase();
  const lignes = exact
    ? await prisma.$queryRaw`SELECT id FROM courriels WHERE "tenantId" = ${tenantId} AND (lower(a::text) LIKE ${`%"${m}"%`} OR lower(COALESCE(cc::text, '')) LIKE ${`%"${m}"%`}) LIMIT 1000`
    : await prisma.$queryRaw`SELECT id FROM courriels WHERE "tenantId" = ${tenantId} AND (lower(a::text) LIKE ${`%${m}%`} OR lower(COALESCE(cc::text, '')) LIKE ${`%${m}%`}) LIMIT 1000`;
  return lignes.map((l) => l.id);
};

/// Pièces d'un brouillon : des fichiers du Cloud de l'espace.
const resumePieces = async (tenantId, ids) => {
  if (!ids.length) return [];
  const noeuds = await prisma.fsNode.findMany({ where: { id: { in: ids }, tenantId, type: "FILE", deletedAt: null } });
  return ids.map((id) => noeuds.find((n) => n.id === id)).filter(Boolean).map((n) => ({ nom: n.name, taille: Number(n.size), type: n.mimeType, fsNodeId: n.id }));
};

/// Le texte d'un brouillon ou d'un envoi programmé, prêt à ranger.
const donneesBrouillon = async (user, m) => {
  const html = m.html ? nettoyerHtml(m.html) : null;
  const texte = m.texte || (html ? texteDeHtml(html) : "");
  let boiteId = null;
  if (m.boiteId) {
    if (!(await boitesAccessibles(user)).some((b) => b.id === m.boiteId)) throw Object.assign(new Error("Boîte d'envoi introuvable."), { statut: 404 });
    boiteId = m.boiteId;
  }
  return {
    boiteId,
    a: listeAdresses(m.a || []),
    cc: listeAdresses(m.cc || []),
    cci: listeAdresses(m.cci || []),
    sujet: m.sujet.trim(),
    html,
    texte,
    extrait: extraitDe(texte, 200),
    pieces: await resumePieces(user.tenantId, m.piecesIds),
    inReplyTo: m.inReplyTo || null,
    references: m.references,
    liens: m.liens,
    date: new Date(),
  };
};

export async function messagerieRoutes(app) {
  // ---- Boîtes ---------------------------------------------------------------

  app.get("/boites", async (request) => {
    const boites = await boitesAccessibles(request.user);
    return serialize(boites.map((b) => vueBoite(b, request.user)));
  });

  const peutGerer = (user, boite) => (boite.userId ? boite.userId === user.id : estAdmin(user));

  app.post("/boites/tester", async (request, reply) => {
    const parsed = serveurSchema(PORTS_IMAP).extend({ boiteId: z.string().max(40).optional() }).safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });
    let { pass } = parsed.data;
    // Mot de passe laissé vide : celui déjà enregistré pour cette boîte.
    if (!pass && parsed.data.boiteId) {
      const b = (await boitesAccessibles(request.user)).find((x) => x.id === parsed.data.boiteId);
      if (b && peutGerer(request.user, b)) pass = b.imap?.pass || "";
    }
    try {
      return await testerImap({ ...parsed.data, pass });
    } catch (err) {
      const msg = err.authenticationFailed ? "Identifiants refusés par le serveur." : String(err.message || err).slice(0, 200);
      return reply.code(400).send({ error: `Connexion impossible : ${msg}` });
    }
  });

  app.post("/boites", async (request, reply) => {
    const parsed = boiteSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });
    const d = parsed.data;
    if (d.partagee && !estAdmin(request.user)) return reply.code(403).send({ error: "Seul un administrateur crée une boîte partagée." });
    if ((await prisma.boiteCourriel.count({ where: { tenantId: request.tenantId } })) >= 50) {
      return reply.code(400).send({ error: "50 boîtes au plus par espace." });
    }
    const boite = await prisma.boiteCourriel.create({
      data: {
        tenantId: request.tenantId,
        userId: d.partagee ? null : request.user.id,
        nom: d.nom,
        adresse: d.adresse,
        imap: { ...d.imap, pass: d.imap.pass ? chiffrer(d.imap.pass) : "" },
        smtp: d.smtp?.host ? { ...d.smtp, pass: d.smtp.pass ? chiffrer(d.smtp.pass) : "" } : undefined,
        signature: d.signature || null,
        actif: d.actif,
      },
    });
    await journaliser(request, "courrier.boite.ajout", d.adresse, { partagee: d.partagee, imap: d.imap.host });
    synchroniserBoite(boite.id).catch(() => {});
    return reply.code(201).send(serialize(vueBoite(boite, request.user)));
  });

  app.put("/boites/:id", async (request, reply) => {
    const boite = (await boitesAccessibles(request.user)).find((b) => b.id === request.params.id);
    if (!boite) return reply.code(404).send({ error: "Boîte introuvable." });
    if (!peutGerer(request.user, boite)) return reply.code(403).send({ error: "Seul son titulaire (ou un administrateur, pour une boîte partagée) la modifie." });
    const parsed = boiteSchema.omit({ partagee: true }).safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });
    const d = parsed.data;
    // Un mot de passe vide garde l'existant (déjà chiffré).
    const imap = { ...d.imap, pass: d.imap.pass ? chiffrer(d.imap.pass) : boite.imap?.pass || "" };
    const smtp = d.smtp?.host ? { ...d.smtp, pass: d.smtp.pass ? chiffrer(d.smtp.pass) : boite.smtp?.pass || "" } : null;
    const serveurChange = imap.host !== boite.imap?.host || imap.user !== boite.imap?.user || d.adresse !== boite.adresse;
    const maj = await prisma.boiteCourriel.update({
      where: { id: boite.id },
      data: {
        nom: d.nom,
        adresse: d.adresse,
        imap,
        smtp: smtp ?? Prisma.DbNull,
        signature: d.signature || null,
        actif: d.actif,
        erreur: null,
        ...(serveurChange ? { dernierUid: 0, uidValidite: null } : {}),
      },
    });
    await journaliser(request, "courrier.boite.modification", d.adresse);
    return serialize(vueBoite(maj, request.user));
  });

  app.delete("/boites/:id", async (request, reply) => {
    const boite = (await boitesAccessibles(request.user)).find((b) => b.id === request.params.id);
    if (!boite) return reply.code(404).send({ error: "Boîte introuvable." });
    if (!peutGerer(request.user, boite)) return reply.code(403).send({ error: "Action réservée." });
    await prisma.boiteCourriel.delete({ where: { id: boite.id } });
    await journaliser(request, "courrier.boite.suppression", boite.adresse);
    publierCourrier({ tenantId: request.tenantId, boite });
    return { ok: true };
  });

  app.post("/boites/:id/synchroniser", { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async (request, reply) => {
    const boite = (await boitesAccessibles(request.user)).find((b) => b.id === request.params.id);
    if (!boite) return reply.code(404).send({ error: "Boîte introuvable." });
    const r = await synchroniserBoite(boite.id);
    if (r.ignoree) return { ok: true, enCours: true };
    if (r.erreur) return reply.code(502).send({ error: r.erreur });
    return { ok: true, nouveaux: r.nouveaux };
  });

  // ---- Conversations ----------------------------------------------------------

  /// Liste d'un dossier, par conversation : le dernier message de chaque
  /// fil, avec le nombre de messages et s'il reste du non-lu.
  app.get("/courriels", async (request) => {
    const q = request.query || {};
    const dossier = DOSSIERS.includes(q.dossier) ? q.dossier : null;
    const base = await filtreVisible(request.user);
    const where = { ...base, AND: [...base.AND] };
    if (q.vue === "suivis") where.AND.push({ suivi: true }, { dossier: { notIn: ["corbeille", "indesirables"] } });
    else if (dossier) where.AND.push({ dossier });
    if (q.boiteId) where.AND.push({ boiteId: String(q.boiteId) });
    if (q.filtre === "nonlus") where.AND.push({ lu: false });
    if (q.filtre === "pieces") where.AND.push({ NOT: { pieces: { equals: Prisma.DbNull } } });
    if (q.avant) where.AND.push({ date: { lt: new Date(String(q.avant)) } });
    const recherche = String(q.q || "").trim().slice(0, 120);
    if (recherche) {
      where.AND.push({
        OR: [
          { sujet: { contains: recherche, mode: "insensitive" } },
          { texte: { contains: recherche, mode: "insensitive" } },
          { deEmail: { contains: recherche, mode: "insensitive" } },
          { deNom: { contains: recherche, mode: "insensitive" } },
          { id: { in: await idsDestinataire(request.tenantId, recherche) } },
        ],
      });
    }
    const limite = Math.min(100, Number(q.limite) || 50);
    const lignes = await prisma.courriel.findMany({
      where,
      orderBy: { date: "desc" },
      take: limite * 4,
      select: {
        id: true, boiteId: true, dossier: true, filId: true, deNom: true, deEmail: true, a: true, cc: true, sujet: true,
        extrait: true, date: true, lu: true, suivi: true, etiquettes: true, pieces: true, statut: true, erreur: true,
        envoiLe: true, liens: true, userId: true,
      },
    });
    const fils = new Map();
    for (const l of lignes) {
      const f = fils.get(l.filId);
      if (!f) fils.set(l.filId, { ...vueCourriel(l), nombre: 1, nonLus: l.lu ? 0 : 1, avecPieces: !!l.pieces?.length });
      else {
        f.nombre += 1;
        if (!l.lu) f.nonLus += 1;
        if (l.pieces?.length) f.avecPieces = true;
        if (l.suivi) f.suivi = true;
      }
    }
    const conversations = [...fils.values()].slice(0, limite);
    return serialize({ conversations, suite: lignes.length >= limite * 4 || fils.size > limite ? conversations.at(-1)?.date : null });
  });

  /// Une conversation entière (hors corbeille, sauf si elle y est toute).
  app.get("/fils/:filId", async (request, reply) => {
    const base = await filtreVisible(request.user);
    const messages = await prisma.courriel.findMany({
      where: { ...base, AND: [...base.AND, { filId: String(request.params.filId) }] },
      orderBy: { date: "asc" },
      take: 200,
    });
    if (!messages.length) return reply.code(404).send({ error: "Conversation introuvable." });
    const horsCorbeille = messages.filter((m) => m.dossier !== "corbeille");
    return serialize({ messages: (horsCorbeille.length ? horsCorbeille : messages).map((m) => vueCourriel(m, { complet: true })) });
  });

  app.get("/courriels/:id", async (request, reply) => {
    const c = await courrielVisible(request.user, request.params.id);
    if (!c) return reply.code(404).send({ error: "Courriel introuvable." });
    return serialize(vueCourriel(c, { complet: true }));
  });

  /// Actions groupées : lu / non lu, suivi, déplacer, étiquettes — sur des
  /// courriels ou des conversations entières.
  app.patch("/courriels", async (request, reply) => {
    const parsed = z
      .object({
        ids: z.array(z.string().max(40)).max(500).default([]),
        fils: z.array(z.string().max(40)).max(200).default([]),
        lu: z.boolean().optional(),
        suivi: z.boolean().optional(),
        dossier: z.enum(["reception", "archives", "corbeille", "indesirables", "envoyes"]).optional(),
        etiquettes: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
      })
      .safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });
    const d = parsed.data;
    if (!d.ids.length && !d.fils.length) return { ok: true, n: 0 };
    const base = await filtreVisible(request.user);
    const cible = { ...base, AND: [...base.AND, { OR: [{ id: { in: d.ids } }, { filId: { in: d.fils } }] }] };
    const data = {};
    if (d.lu !== undefined) data.lu = d.lu;
    if (d.suivi !== undefined) data.suivi = d.suivi;
    if (d.etiquettes) data.etiquettes = d.etiquettes;
    let n = 0;
    if (d.dossier) {
      // Un brouillon ou un envoi ne devient pas un message reçu : « remettre
      // en boîte de réception » ne touche que les messages reçus, et les
      // envois retournent dans « Envoyés ».
      const recus = await prisma.courriel.updateMany({ where: { ...cible, AND: [...cible.AND, { statut: "recu" }] }, data: { ...data, dossier: d.dossier === "envoyes" ? "reception" : d.dossier } });
      const envoyes = await prisma.courriel.updateMany({
        where: { ...cible, AND: [...cible.AND, { statut: { in: ["envoye", "echec"] } }] },
        data: { ...data, dossier: ["reception", "envoyes"].includes(d.dossier) ? "envoyes" : d.dossier },
      });
      n = recus.count + envoyes.count;
    } else if (Object.keys(data).length) {
      n = (await prisma.courriel.updateMany({ where: cible, data })).count;
    }
    publierCourrier({ tenantId: request.tenantId, userId: request.user.id });
    return { ok: true, n };
  });

  /// Suppression définitive — depuis la corbeille seulement.
  app.delete("/courriels/:id", async (request, reply) => {
    const c = await courrielVisible(request.user, request.params.id);
    if (!c) return reply.code(404).send({ error: "Courriel introuvable." });
    if (!["corbeille", "brouillons"].includes(c.dossier)) return reply.code(409).send({ error: "Mettez d'abord le courriel à la corbeille." });
    await prisma.courriel.delete({ where: { id: c.id } });
    publierCourrier({ tenantId: request.tenantId, userId: request.user.id });
    return { ok: true };
  });

  app.delete("/corbeille", async (request) => {
    const base = await filtreVisible(request.user);
    const { count } = await prisma.courriel.deleteMany({ where: { ...base, AND: [...base.AND, { dossier: "corbeille" }] } });
    if (count) await journaliser(request, "courrier.corbeille.vidage", String(count));
    publierCourrier({ tenantId: request.tenantId, userId: request.user.id });
    return { ok: true, n: count };
  });

  /// Compteurs pour les badges : non lus par dossier et par boîte.
  app.get("/compteurs", async (request) => {
    const base = await filtreVisible(request.user);
    const lignes = await prisma.courriel.groupBy({
      by: ["dossier", "boiteId"],
      where: { ...base, AND: [...base.AND, { lu: false }] },
      _count: true,
    });
    const [brouillons, programmes, suivis] = await Promise.all([
      prisma.courriel.count({ where: { ...base, AND: [...base.AND, { dossier: "brouillons" }] } }),
      prisma.courriel.count({ where: { ...base, AND: [...base.AND, { dossier: "programmes" }] } }),
      prisma.courriel.count({ where: { ...base, AND: [...base.AND, { suivi: true }, { dossier: { notIn: ["corbeille", "indesirables"] } }] } }),
    ]);
    const nonLus = {};
    const parBoite = {};
    for (const l of lignes) {
      nonLus[l.dossier] = (nonLus[l.dossier] || 0) + l._count;
      if (l.dossier === "reception" && l.boiteId) parBoite[l.boiteId] = (parBoite[l.boiteId] || 0) + l._count;
    }
    return { nonLus, parBoite, brouillons, programmes, suivis };
  });

  /// Rattache une fiche d'une autre app (tâche, événement, compte…).
  app.post("/courriels/:id/liens", async (request, reply) => {
    const c = await courrielVisible(request.user, request.params.id);
    if (!c) return reply.code(404).send({ error: "Courriel introuvable." });
    const parsed = z.object({ app: z.string().max(40), collection: z.string().max(40), id: z.string().max(40), libelle: z.string().max(200).default("") }).safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ error: "Lien invalide." });
    const liens = [...(c.liens || []).filter((l) => !(l.app === parsed.data.app && l.id === parsed.data.id)), parsed.data].slice(-20);
    await prisma.courriel.updateMany({ where: { tenantId: request.tenantId, filId: c.filId }, data: { liens } });
    publierCourrier({ tenantId: request.tenantId, userId: request.user.id });
    return { ok: true, liens };
  });

  // ---- Brouillons et envois -----------------------------------------------------

  app.post("/brouillons", async (request, reply) => {
    const parsed = messageSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });
    try {
      const d = await donneesBrouillon(request.user, parsed.data);
      const id = nouvelId();
      const c = await prisma.courriel.create({
        data: { id, tenantId: request.tenantId, filId: parsed.data.filId || id, dossier: "brouillons", statut: "brouillon", userId: request.user.id, lu: true, deNom: request.user.name, deEmail: request.user.email, ...d },
      });
      return reply.code(201).send(serialize(vueCourriel(c, { complet: true })));
    } catch (err) {
      return erreur(reply, err);
    }
  });

  app.put("/brouillons/:id", async (request, reply) => {
    const c = await courrielVisible(request.user, request.params.id);
    if (!c || !["brouillons", "programmes"].includes(c.dossier)) return reply.code(404).send({ error: "Brouillon introuvable." });
    const parsed = messageSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });
    try {
      const d = await donneesBrouillon(request.user, parsed.data);
      const maj = await prisma.courriel.update({ where: { id: c.id }, data: { ...d, dossier: "brouillons", statut: "brouillon", envoiLe: null } });
      return serialize(vueCourriel(maj, { complet: true }));
    } catch (err) {
      return erreur(reply, err);
    }
  });

  /// Envoyer — maintenant, ou à une date (`envoiLe`) : l'envoi programmé
  /// attend dans « Programmés », modifiable jusqu'au départ.
  app.post("/messages", { config: LIMITE_ENVOI }, async (request, reply) => {
    const parsed = messageSchema
      .extend({ brouillonId: z.string().max(40).nullable().optional(), envoiLe: z.string().datetime({ offset: true }).nullable().optional() })
      .safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });
    const m = parsed.data;
    let existant = null;
    if (m.brouillonId) {
      existant = await courrielVisible(request.user, m.brouillonId);
      if (!existant || !["brouillons", "programmes"].includes(existant.dossier)) return reply.code(404).send({ error: "Brouillon introuvable." });
    }
    try {
      if (m.envoiLe && new Date(m.envoiLe) > new Date(Date.now() + 30_000)) {
        if (new Date(m.envoiLe) > new Date(Date.now() + 365 * 86400_000)) return reply.code(400).send({ error: "Programmez à moins d'un an." });
        const d = await donneesBrouillon(request.user, m);
        if (!d.a.length || d.a.some((x) => !adresseValide(x.email))) return reply.code(400).send({ error: "Destinataire : adresse invalide ou manquante." });
        if (!d.sujet) return reply.code(400).send({ error: "Le sujet est requis." });
        const donnees = { ...d, dossier: "programmes", statut: "programme", envoiLe: new Date(m.envoiLe), userId: request.user.id, lu: true, deNom: request.user.name, deEmail: request.user.email };
        const id = existant?.id || nouvelId();
        const c = existant
          ? await prisma.courriel.update({ where: { id }, data: donnees })
          : await prisma.courriel.create({ data: { id, tenantId: request.tenantId, filId: m.filId || id, ...donnees } });
        await journaliser(request, "courrier.programmation", d.a.map((x) => x.email).join(", "), { sujet: d.sujet, envoiLe: m.envoiLe });
        publierCourrier({ tenantId: request.tenantId, userId: request.user.id });
        return reply.code(201).send(serialize(vueCourriel(c)));
      }
      const c = await envoyerCourriel({ user: request.user, message: m, courrielId: existant?.id || null, requete: request });
      if (c.statut !== "envoye") return reply.code(502).send({ error: `Envoi refusé : ${c.erreur}`, id: c.id });
      return reply.code(201).send(serialize(vueCourriel(c)));
    } catch (err) {
      return erreur(reply, err);
    }
  });

  // ---- Le correspondant dans les autres applications -------------------------------
  //
  // Une adresse, et tout ce que l'OS sait d'elle : compte et contacts du
  // CRM, affaires en cours, factures, fiche salarié, cartes Projets
  // rattachées, derniers échanges. Chaque source n'est lue que si la
  // personne a accès à l'application.

  app.get("/contexte", async (request, reply) => {
    const email = String(request.query?.email || "").trim().toLowerCase();
    if (!adresseValide(email)) return reply.code(400).send({ error: "Adresse invalide." });
    const t = request.tenantId;
    const acces = async (m) => (await accesModule(request, m).catch(() => ({ autorise: false }))).autorise;
    const [crm, fact, rh, projets] = await Promise.all([acces("crm"), acces("facturation"), acces("rh"), acces("projets")]);
    const parEmail = (module, collection) => prisma.$queryRaw`
      SELECT id, data, "createdAt" FROM records
      WHERE "tenantId" = ${t} AND module = ${module} AND collection = ${collection} AND lower(data->>'email') = ${email}
      LIMIT 5`;
    const resultat = { email, crm: null, facturation: null, rh: null, projets: null };

    if (crm) {
      const contacts = await parEmail("crm", "contacts");
      const clientsDirects = await parEmail("crm", "clients");
      const idsClients = [...new Set([...clientsDirects.map((c) => c.id), ...contacts.map((c) => c.data?.clientId).filter(Boolean)])];
      const clients = idsClients.length ? await prisma.record.findMany({ where: { tenantId: t, module: "crm", collection: "clients", id: { in: idsClients } } }) : [];
      const opportunites = idsClients.length
        ? await prisma.$queryRaw`
            SELECT id, data FROM records WHERE "tenantId" = ${t} AND module = 'crm' AND collection = 'opportunites'
              AND data->>'clientId' = ANY(${idsClients}) AND COALESCE(data->>'etape', '') NOT IN ('gagnee', 'perdue') LIMIT 5`
        : [];
      resultat.crm = {
        clients: clients.map((c) => ({ id: c.id, nom: c.data.entreprise || c.data.nom || "", statut: c.data.statut || "", ville: c.data.ville || "", telephone: c.data.telephone || "" })),
        contacts: contacts.map((c) => ({ id: c.id, nom: [c.data.prenom, c.data.nom].filter(Boolean).join(" "), poste: c.data.poste || "", clientId: c.data.clientId || null })),
        opportunites: opportunites.map((o) => ({ id: o.id, libelle: o.data.libelle || "", montant: Number(o.data.montant) || 0, etape: o.data.etape || "" })),
      };
      if (fact && idsClients.length) {
        const docs = await prisma.$queryRaw`
          SELECT id, data FROM records WHERE "tenantId" = ${t} AND module = 'facturation' AND collection = 'factures'
            AND data->>'clientId' = ANY(${idsClients}) AND COALESCE(data->>'statut', '') <> 'brouillon'
          ORDER BY data->>'date' DESC NULLS LAST LIMIT 6`;
        resultat.facturation = docs.map((d) => ({ id: d.id, type: d.data.type || "facture", numero: d.data.numero || "", statut: d.data.statut || "", date: d.data.date || null, echeance: d.data.echeance || null }));
      }
    }
    if (rh) {
      const salaries = await parEmail("rh", "salaries");
      resultat.rh = salaries.map((s) => ({ id: s.id, nom: [s.data.prenom, s.data.nom].filter(Boolean).join(" "), poste: s.data.poste || "", service: s.data.service || "" }));
    }
    if (projets) {
      const ids = await idsDestinataire(t, email, { exact: true });
      const filIds = [
        ...new Set(
          (await prisma.courriel.findMany({ where: { tenantId: t, OR: [{ deEmail: email }, { id: { in: ids } }] }, select: { filId: true }, take: 300 })).map((c) => c.filId),
        ),
      ];
      const cartes = filIds.length
        ? await prisma.$queryRaw`
            SELECT id, data FROM records WHERE "tenantId" = ${t} AND module = 'projets' AND collection = 'cartes'
              AND data->'liens'->>'courrielFil' = ANY(${filIds}) LIMIT 5`
        : [];
      resultat.projets = cartes.map((c) => ({ id: c.id, titre: c.data.titre || "", echeance: c.data.echeance || null }));
    }
    const base = await filtreVisible(request.user);
    const avec = { OR: [{ deEmail: email }, { id: { in: await idsDestinataire(t, email, { exact: true }) } }] };
    const echanges = await prisma.courriel.findMany({
      where: { ...base, AND: [...base.AND, avec, { dossier: { notIn: ["brouillons", "corbeille"] } }] },
      orderBy: { date: "desc" },
      take: 5,
      select: { id: true, filId: true, sujet: true, date: true, statut: true },
    });
    const total = await prisma.courriel.count({ where: { ...base, AND: [...base.AND, avec] } });
    resultat.echanges = { total, derniers: echanges };
    return serialize(resultat);
  });

  /// Carnet d'adresses : équipe, CRM (comptes et contacts), RH, et les
  /// correspondants déjà connus du courrier.
  app.get("/contacts", async (request) => {
    const q = String(request.query?.q || "").trim().toLowerCase().slice(0, 80);
    const t = request.tenantId;
    const acces = async (m) => (await accesModule(request, m).catch(() => ({ autorise: false }))).autorise;
    const motif = `%${q}%`;
    const sortie = [];
    const vus = new Set();
    const ajouter = (email, nom, source) => {
      const e = String(email || "").trim().toLowerCase();
      if (!adresseValide(e) || vus.has(e)) return;
      vus.add(e);
      sortie.push({ email: e, nom: nom || "", source });
    };
    const membres = await prisma.user.findMany({
      where: { tenantId: t, ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {}) },
      select: { email: true, name: true },
      take: 10,
    });
    for (const m of membres) ajouter(m.email, m.name, "Équipe");
    const chercher = (module, collection) => prisma.$queryRaw`
      SELECT data FROM records WHERE "tenantId" = ${t} AND module = ${module} AND collection = ${collection}
        AND data->>'email' IS NOT NULL AND data->>'email' <> ''
        AND (${q} = '' OR lower(data->>'email') LIKE ${motif} OR lower(COALESCE(data->>'nom', '') || ' ' || COALESCE(data->>'prenom', '') || ' ' || COALESCE(data->>'entreprise', '')) LIKE ${motif})
      LIMIT 10`;
    if (await acces("crm")) {
      for (const r of await chercher("crm", "contacts")) ajouter(r.data.email, [r.data.prenom, r.data.nom].filter(Boolean).join(" "), "CRM");
      for (const r of await chercher("crm", "clients")) ajouter(r.data.email, r.data.entreprise || r.data.nom, "CRM");
    }
    if (await acces("rh")) for (const r of await chercher("rh", "salaries")) ajouter(r.data.email, [r.data.prenom, r.data.nom].filter(Boolean).join(" "), "RH");
    const base = await filtreVisible(request.user);
    const connus = await prisma.courriel.findMany({
      where: { ...base, AND: [...base.AND, { deEmail: q ? { contains: q } : { not: null } }] },
      distinct: ["deEmail"],
      select: { deEmail: true, deNom: true },
      orderBy: { date: "desc" },
      take: 10,
    });
    for (const c of connus) ajouter(c.deEmail, c.deNom, "Courrier");
    return sortie.slice(0, 20);
  });
}

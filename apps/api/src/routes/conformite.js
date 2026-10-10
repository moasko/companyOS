import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, serialize } from "../db.js";
import { authenticate, exigerRole } from "../auth.js";
import { journaliser } from "../audit.js";
import { publierFiche } from "../evenements.js";
import { sansSecrets } from "./apps.js";
import { baseDefaut, invaliderEspacePublic, normaliserDomaine, verifierDomaine } from "../espacePublic.js";

/// Conformité RGPD : droit d'accès, portabilité, droit à l'effacement.
///
///   GET  /mes-donnees          chacun : ses données personnelles (art. 15)
///   GET  /export               propriétaire : tout l'espace (art. 20)
///   POST /personne/recherche   administrateur : où apparaît une personne
///   POST /personne/anonymiser  administrateur : l'effacer (art. 17)
///
/// L'effacement **anonymise** plutôt que de supprimer : une facture doit
/// rester en comptabilité dix ans (obligation légale), mais le nom et
/// l'adresse de la personne n'ont plus à y figurer. L'historique des
/// fiches concernées est purgé, sinon l'ancien état restaurerait ce qu'on
/// vient d'effacer.

const CHAMPS_PERSONNELS = new Set([
  "nom", "prenom", "email", "telephone", "mobile", "adresse", "ville", "codePostal",
  "dateNaissance", "naissance", "lieuNaissance", "iban", "rib", "bic", "cnps", "numeroSecu",
  "nationalite", "photo", "situationFamiliale", "contactUrgence", "notes", "clientNom",
  "clientEmail", "clientTelephone", "clientVille", "clientEntreprise", "signature",
]);
export const ANONYME = "[anonymisé]";
const LIMITE_RECHERCHE = 500;

const echapperLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/// Remplace la valeur cherchée partout dans une fiche ; si un champ lui est
/// **égal** (la fiche décrit cette personne), efface aussi ses champs
/// personnels. Rend { data, change }.
export const anonymiserDonnees = (data, cible) => {
  const c = cible.toLowerCase();
  let change = false;
  const decrit = Object.values(data || {}).some((v) => typeof v === "string" && v.trim().toLowerCase() === c);
  const parcourir = (v, cle) => {
    if (typeof v === "string") {
      if (decrit && cle && CHAMPS_PERSONNELS.has(cle) && v !== "") {
        change = true;
        return ANONYME;
      }
      if (v.toLowerCase().includes(c)) {
        change = true;
        return v.replace(new RegExp(cible.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), ANONYME);
      }
      return v;
    }
    if (Array.isArray(v)) return v.map((x) => parcourir(x, null));
    if (v && typeof v === "object") {
      // Un sous-objet qui décrit la personne (destinataire de campagne…)
      // est traité comme une fiche à part entière.
      const sousDecrit = Object.values(v).some((x) => typeof x === "string" && x.trim().toLowerCase() === c);
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => {
          if (sousDecrit && typeof x === "string" && CHAMPS_PERSONNELS.has(k) && x !== "") {
            change = true;
            return [k, ANONYME];
          }
          return [k, parcourir(x, k)];
        }),
      );
    }
    return v;
  };
  const resultat = Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, parcourir(v, k)]));
  return { data: resultat, change };
};

const titreDe = (d) => d?.nom || d?.libelle || d?.titre || d?.numero || d?.designation || d?.resume || null;

const fichiersJson = (reply, nom) =>
  reply
    .header("content-type", "application/json; charset=utf-8")
    .header("content-disposition", `attachment; filename="${nom}"`)
    .header("cache-control", "no-store");

export default async function conformiteRoutes(app) {
  app.addHook("preHandler", authenticate);

  /// Mes données : profil, sessions, notifications, journal de mes actions,
  /// préférences, fiches que j'ai saisies.
  app.get("/mes-donnees", async (request, reply) => {
    const u = request.user;
    const [sessions, notifications, journal, fiches] = await Promise.all([
      prisma.session.findMany({
        where: { userId: u.id },
        select: { type: true, libelle: true, ip: true, agent: true, creeLe: true, vuLe: true, expireLe: true, revoqueLe: true },
        orderBy: { creeLe: "desc" },
        take: 500,
      }),
      prisma.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 1000 }),
      prisma.auditEvent.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 5000 }),
      prisma.record.findMany({
        where: { tenantId: request.tenantId, userId: u.id },
        select: { id: true, module: true, collection: true, data: true, createdAt: true, updatedAt: true },
        orderBy: { createdAt: "desc" },
        take: 5000,
      }),
    ]);
    await journaliser(request, "conformite.mes-donnees");
    fichiersJson(reply, `mes-donnees-companyos-${new Date().toISOString().slice(0, 10)}.json`);
    return serialize({
      genereLe: new Date().toISOString(),
      compte: {
        id: u.id,
        nom: u.name,
        email: u.email,
        role: u.role,
        espace: u.tenant?.name,
        creeLe: u.createdAt,
        doubleAuthentification: !!u.totpActif,
        preferences: u.preferences ?? null,
      },
      sessions,
      notifications,
      journal,
      fichesSaisies: fiches,
    });
  });

  /// Tout l'espace, pour le reprendre ailleurs : membres, applications,
  /// fiches, arborescence des fichiers (sans leur contenu, téléchargeable
  /// depuis le Cloud), automatisations, journal. Envoyé au fil de l'eau —
  /// un espace de 200 000 fiches ne tient pas en mémoire d'un coup.
  app.get("/export", { preHandler: exigerRole("OWNER") }, async (request, reply) => {
    const tenantId = request.tenantId;
    await journaliser(request, "conformite.export");

    async function* produire() {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      yield `{"format":"companyos-export","version":1,"genereLe":${JSON.stringify(new Date().toISOString())}`;
      yield `,"espace":${JSON.stringify(serialize({ id: tenant.id, nom: tenant.name, formule: tenant.plan, creeLe: tenant.createdAt }))}`;
      const membres = await prisma.user.findMany({
        where: { tenantId },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });
      yield `,"membres":${JSON.stringify(serialize(membres))}`;
      const installations = await prisma.installation.findMany({ where: { tenantId }, include: { app: true } });
      yield `,"applications":${JSON.stringify(
        serialize(
          installations.map((i) => ({
            slug: i.app.slug,
            nom: i.app.name,
            version: i.version,
            type: i.app.kind,
            definition: i.app.tenantId ? i.app.definition : undefined,
            reglages: sansSecrets(i.settings),
            acces: i.acces,
          })),
        ),
      )}`;
      const automatisations = await prisma.automatisation.findMany({ where: { tenantId } });
      yield `,"automatisations":${JSON.stringify(serialize(automatisations))}`;

      yield `,"fiches":[`;
      let curseur = null;
      let premier = true;
      for (;;) {
        const lot = await prisma.record.findMany({
          where: { tenantId },
          orderBy: { id: "asc" },
          take: 500,
          ...(curseur ? { cursor: { id: curseur }, skip: 1 } : {}),
        });
        if (!lot.length) break;
        for (const r of lot) {
          yield `${premier ? "" : ","}${JSON.stringify(
            serialize({ id: r.id, module: r.module, collection: r.collection, data: r.data, auteurId: r.userId, creeLe: r.createdAt, modifieLe: r.updatedAt }),
          )}`;
          premier = false;
        }
        curseur = lot[lot.length - 1].id;
      }
      yield `]`;

      const fichiers = await prisma.fsNode.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, parentId: true, name: true, type: true, size: true, mimeType: true, createdAt: true, updatedAt: true },
      });
      yield `,"fichiers":${JSON.stringify(serialize(fichiers))}`;
      const journal = await prisma.auditEvent.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 20000 });
      yield `,"journal":${JSON.stringify(serialize(journal))}}`;
    }

    fichiersJson(reply, `export-companyos-${new Date().toISOString().slice(0, 10)}.json`);
    return reply.send(Readable.from(produire()));
  });

  // ---- Réglages de l'espace -----------------------------------------------

  app.get("/reglages", async (request) => {
    const t = await prisma.tenant.findUnique({
      where: { id: request.tenantId },
      select: { partagePublic: true, domainePublic: true, domainePublicVerifie: true },
    });
    return {
      partagePublic: t?.partagePublic !== false,
      domainePublic: t?.domainePublic || null,
      domainePublicVerifie: t?.domainePublicVerifie || null,
      // La cible du CNAME : l'adresse de l'API de la plateforme.
      cibleDns: new URL(baseDefaut()).hostname,
    };
  });

  // ---- Domaine des liens publics -------------------------------------------

  app.put("/domaine", { preHandler: exigerRole("ADMIN") }, async (request, reply) => {
    const domaine = normaliserDomaine(request.body?.domaine);
    if (!domaine) return reply.code(400).send({ error: "Nom de domaine invalide (ex. liens.entreprise.ci)." });
    if (domaine === new URL(baseDefaut()).hostname) return reply.code(400).send({ error: "C'est déjà l'adresse de la plateforme." });
    const pris = await prisma.tenant.findFirst({ where: { domainePublic: domaine, id: { not: request.tenantId } }, select: { id: true } });
    if (pris) return reply.code(409).send({ error: "Ce domaine est déjà utilisé par un autre espace." });
    await prisma.tenant.update({ where: { id: request.tenantId }, data: { domainePublic: domaine, domainePublicVerifie: null } });
    invaliderEspacePublic(request.tenantId);
    await journaliser(request, "espace.domaine-public", domaine, { etape: "declaration" });
    return { domainePublic: domaine, domainePublicVerifie: null };
  });

  app.post("/domaine/verifier", { preHandler: exigerRole("ADMIN"), config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const t = await prisma.tenant.findUnique({ where: { id: request.tenantId }, select: { domainePublic: true } });
    if (!t?.domainePublic) return reply.code(400).send({ error: "Déclarez d'abord un domaine." });
    try {
      await verifierDomaine(request.tenantId, t.domainePublic);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
    const maj = await prisma.tenant.update({ where: { id: request.tenantId }, data: { domainePublicVerifie: new Date() } });
    invaliderEspacePublic(request.tenantId);
    await journaliser(request, "espace.domaine-public", t.domainePublic, { etape: "verification" });
    return { domainePublic: maj.domainePublic, domainePublicVerifie: maj.domainePublicVerifie };
  });

  /// Retour à l'adresse de la plateforme. Les liens déjà envoyés sous le
  /// domaine personnalisé cessent de fonctionner dès que celui-ci ne pointe
  /// plus vers l'API.
  app.delete("/domaine", { preHandler: exigerRole("ADMIN") }, async (request) => {
    await prisma.tenant.update({ where: { id: request.tenantId }, data: { domainePublic: null, domainePublicVerifie: null } });
    invaliderEspacePublic(request.tenantId);
    await journaliser(request, "espace.domaine-public", null, { etape: "retrait" });
    return { domainePublic: null };
  });

  /// Couper les liens publics : ceux déjà envoyés cessent aussitôt de
  /// fonctionner (la page publique vérifie ce réglage à chaque visite).
  app.put("/reglages", { preHandler: exigerRole("ADMIN") }, async (request, reply) => {
    if (typeof request.body?.partagePublic !== "boolean") return reply.code(400).send({ error: "Réglage invalide." });
    await prisma.tenant.update({ where: { id: request.tenantId }, data: { partagePublic: request.body.partagePublic } });
    await journaliser(request, "espace.partage-public", request.body.partagePublic ? "autorisé" : "désactivé");
    return { partagePublic: request.body.partagePublic };
  });

  // ---- Droit à l'effacement ----------------------------------------------

  const cibleSchema = z.object({ valeur: z.string().trim().min(5).max(200) });

  const trouver = async (tenantId, valeur) => {
    const motif = `%${echapperLike(valeur)}%`;
    return prisma.$queryRaw`
      SELECT id, module, collection, data FROM records
      WHERE "tenantId" = ${tenantId} AND data::text ILIKE ${motif}
      ORDER BY "updatedAt" DESC
      LIMIT ${LIMITE_RECHERCHE}`;
  };

  /// Où apparaît cette personne (adresse e-mail, téléphone, nom complet) ?
  app.post("/personne/recherche", { preHandler: exigerRole("ADMIN") }, async (request, reply) => {
    const parsed = cibleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Indiquez une adresse e-mail, un téléphone ou un nom (5 caractères au moins)." });
    const lignes = await trouver(request.tenantId, parsed.data.valeur);
    const compte = await prisma.user.findFirst({
      where: { tenantId: request.tenantId, email: { equals: parsed.data.valeur, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    return {
      fiches: lignes.map((l) => ({ id: l.id, module: l.module, collection: l.collection, titre: titreDe(l.data) })),
      tronque: lignes.length >= LIMITE_RECHERCHE,
      // Un membre de l'espace ne s'efface pas d'ici : on retire d'abord son
      // compte (Paramètres > Espace).
      compteMembre: compte ? compte.name : null,
    };
  });

  /// Anonymise la personne dans toutes les fiches où elle apparaît.
  app.post("/personne/anonymiser", { preHandler: exigerRole("ADMIN") }, async (request, reply) => {
    const parsed = cibleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Valeur invalide." });
    const valeur = parsed.data.valeur;
    const lignes = await trouver(request.tenantId, valeur);
    let modifiees = 0;
    for (const l of lignes) {
      const { data, change } = anonymiserDonnees(l.data, valeur);
      if (!change) continue;
      await prisma.record.update({ where: { id: l.id }, data: { data, updatedById: request.user.id } });
      publierFiche({ tenantId: request.tenantId, module: l.module, collection: l.collection, id: l.id, action: "modification", par: request.user.id });
      modifiees += 1;
    }
    // L'historique gardait l'ancien état, nom et adresse compris.
    const motif = `%${echapperLike(valeur)}%`;
    const versions = await prisma.$executeRaw`
      DELETE FROM versions_fiches
      WHERE "tenantId" = ${request.tenantId}
        AND ("recordId" IN (${lignes.length ? Prisma.join(lignes.map((l) => l.id)) : Prisma.sql`NULL`}) OR data::text ILIKE ${motif})`;
    // Le journal garde la trace du geste, pas la donnée effacée : une
    // empreinte permet de prouver qu'une demande précise a été traitée.
    await journaliser(request, "conformite.effacement", null, {
      empreinte: createHash("sha256").update(valeur.toLowerCase()).digest("hex").slice(0, 16),
      fiches: modifiees,
      versionsPurgees: versions,
    });
    return { fiches: modifiees, versionsPurgees: versions, reste: lignes.length >= LIMITE_RECHERCHE };
  });
}

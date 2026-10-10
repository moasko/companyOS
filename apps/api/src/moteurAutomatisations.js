import { createHmac, randomBytes } from "node:crypto";
import {
  conditionsVraies,
  declencheurCorrespond,
  remplir,
  valeurA,
} from "@companyos/shared/automatisations";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { abonner, publier, publierFiche } from "./evenements.js";
import { notifier } from "./notifier.js";
import { posterJson } from "./web.js";
import { creerTransporteurEspace, envoyerMail, envoyerVia } from "./mail.js";
import { declarerCache } from "./caches.js";

/// Le moteur des automatisations entre applications.
///
/// Après chaque écriture de fiche (création, modification, suppression),
/// la route appelle `declencher`. Le moteur cherche les automatisations
/// actives de l'espace pour cette collection, vérifie leurs conditions et
/// exécute leurs actions : notifier, créer une fiche dans une autre app,
/// modifier la fiche, créer une tâche dans Projets, écrire un courriel à
/// des membres, appeler un webhook.
///
/// Garde-fous :
///   - exécution **après** la réponse : l'écriture de l'utilisateur ne
///     dépend jamais d'une automatisation ;
///   - profondeur limitée : une fiche créée par une automatisation peut en
///     déclencher une autre, mais pas au-delà de 3 niveaux (pas de boucle
///     infinie entre deux règles qui se répondent) ;
///   - débit limité par espace ;
///   - jamais d'écriture dans les collections exécutées par un moteur
///     (campagnes, courrier…) ni dans la fiche de l'entreprise ;
///   - chaque exécution est journalisée, action par action.

const PROFONDEUR_MAX = 3;
const DEBIT_PAR_MINUTE = 300;
const HISTORIQUE_PAR_REGLE = 200;
const DUREE_CACHE_MS = 30_000;
const TAILLE_FICHE_MAX = 64 * 1024;

/// Collections où une automatisation n'écrit jamais. Voir COLLECTIONS_MOTEUR
/// et COLLECTIONS_REFERENCE dans routes/records.js.
const INTERDITES = new Set([
  "campagnes/campagnes",
  "campagnes/automatisations",
  "campagnes/modeles",
  "courrier/modeles",
  "courrier/envois",
  "courrier/relances",
  "relances/relances",
  "entreprise/profil",
  "classeur/classeurs",
]);
export const ecritureInterdite = (module, collection) => INTERDITES.has(`${module}/${collection}`);

// ---------------------------------------------------------------------------
// Règles actives, par espace
// ---------------------------------------------------------------------------

const cache = new Map(); // tenantId → { le, regles }

declarerCache("automatisations", {
  libelle: "Règles d'automatisation",
  description: "Les règles actives de chaque espace, relues à chaque écriture de fiche.",
  taille: () => cache.size,
  vider: () => cache.clear(),
});

const reglesDe = async (tenantId) => {
  const c = cache.get(tenantId);
  if (c && Date.now() - c.le < DUREE_CACHE_MS) return c.regles;
  const regles = await prisma.automatisation.findMany({ where: { tenantId, active: true } });
  cache.set(tenantId, { le: Date.now(), regles });
  return regles;
};

/// Après toute modification des règles d'un espace : toutes les instances
/// oublient leur copie.
export const reglesModifiees = (tenantId) => {
  cache.delete(tenantId);
  publier({ type: "automatisations", t: tenantId });
};

let desabonner = null;
export const demarrerMoteurAutomatisations = () => {
  if (desabonner) return;
  desabonner = abonner((evt) => {
    if (evt?.type === "automatisations") cache.delete(evt.t);
  });
};

/// Faut-il lire la fiche avant de la modifier ? Seulement si une règle
/// active écoute cette collection — sinon c'est une requête pour rien.
export const ecoute = async (tenantId, module, collection) =>
  (await reglesDe(tenantId)).some((r) => r.module === module && r.collection === collection);

// ---------------------------------------------------------------------------
// Débit
// ---------------------------------------------------------------------------

const compteurs = new Map(); // tenantId → { minute, n }
const debitAtteint = (tenantId) => {
  const minute = Math.floor(Date.now() / 60_000);
  const c = compteurs.get(tenantId);
  if (!c || c.minute !== minute) {
    compteurs.set(tenantId, { minute, n: 1 });
    if (compteurs.size > 10_000) compteurs.clear();
    return false;
  }
  c.n += 1;
  return c.n > DEBIT_PAR_MINUTE;
};

// ---------------------------------------------------------------------------
// Personnes
// ---------------------------------------------------------------------------

/// Les comptes désignés par une valeur : un identifiant de compte, ou une
/// fiche salarié (rh/salaries) reliée à un compte par son adresse e-mail.
const comptesDesignes = async (tenantId, valeurs) => {
  const ids = [...new Set([valeurs].flat().filter((v) => typeof v === "string" && v && v.length <= 64))];
  if (!ids.length) return [];
  const directs = await prisma.user.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } });
  const trouves = new Set(directs.map((u) => u.id));
  const restants = ids.filter((id) => !trouves.has(id));
  if (restants.length) {
    const salaries = await prisma.record.findMany({
      where: { tenantId, module: "rh", collection: "salaries", id: { in: restants } },
      select: { data: true },
    });
    const emails = salaries.map((s) => String(s.data?.email || "").trim().toLowerCase()).filter(Boolean);
    if (emails.length) {
      const parEmail = await prisma.user.findMany({ where: { tenantId, email: { in: emails } }, select: { id: true } });
      for (const u of parEmail) trouves.add(u.id);
    }
  }
  return [...trouves];
};

const destinatairesDe = async (tenantId, d, contexte) => {
  switch (d?.mode) {
    case "auteur":
      return contexte.auteur?.id ? [contexte.auteur.id] : [];
    case "admins":
      return (await prisma.user.findMany({ where: { tenantId, role: { in: ["OWNER", "ADMIN"] } }, select: { id: true } })).map((u) => u.id);
    case "tous":
      return (await prisma.user.findMany({ where: { tenantId }, select: { id: true }, take: 500 })).map((u) => u.id);
    case "membres":
      return (await prisma.user.findMany({ where: { tenantId, id: { in: d.ids || [] } }, select: { id: true } })).map((u) => u.id);
    case "champ":
      return comptesDesignes(tenantId, valeurA(contexte.fiche, d.champ) ?? valeurA(contexte.avant, d.champ));
    default:
      return [];
  }
};

/// Où mène le clic sur la notification : la fiche, dans son app.
const PARAMS_LIEN = {
  "crm/clients": "client",
  "crm/opportunites": "affaire",
  "projets/cartes": "carte",
  "rh/salaries": "salarie",
  "facturation/factures": "facture",
  "stock/articles": "article",
};
const lienVers = (module, collection, id) => {
  const param = PARAMS_LIEN[`${module}/${collection}`];
  return { app: module, ...(param && id ? { params: { [param]: id } } : {}) };
};

// ---------------------------------------------------------------------------
// Écritures du moteur
// ---------------------------------------------------------------------------

const remplirChamps = (champs, contexte) =>
  Object.fromEntries(Object.entries(champs || {}).map(([k, v]) => [k, remplir(v, contexte)]));

const verifierTaille = (data) => {
  if (Buffer.byteLength(JSON.stringify(data), "utf8") > TAILLE_FICHE_MAX) {
    throw new Error("Fiche trop volumineuse");
  }
};

const creerFiche = async (regle, module, collection, data, origine) => {
  if (ecritureInterdite(module, collection)) throw new Error(`Écriture interdite dans ${module}/${collection}`);
  verifierTaille(data);
  const fiche = await prisma.record.create({
    data: { tenantId: regle.tenantId, userId: regle.creeParId || origine.auteur?.id || "automatisation", module, collection, data },
  });
  await publierFiche({ tenantId: regle.tenantId, module, collection, id: fiche.id, action: "creation", par: null });
  planifier({
    tenantId: regle.tenantId,
    module,
    collection,
    evenement: "creation",
    id: fiche.id,
    fiche: data,
    avant: null,
    auteur: origine.auteur,
    profondeur: origine.profondeur + 1,
  });
  return fiche;
};

/// Un identifiant court pour une colonne de tableau (même forme que
/// l'app Projets).
const idCourt = () => randomBytes(6).toString("base64url");

const tableauPour = async (tenantId, tableauId) => {
  if (tableauId) {
    const t = await prisma.record.findFirst({ where: { tenantId, module: "projets", collection: "tableaux", id: tableauId } });
    if (t) return t;
  }
  const premier = await prisma.record.findFirst({
    where: { tenantId, module: "projets", collection: "tableaux" },
    orderBy: { createdAt: "asc" },
  });
  return premier;
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/// Signature d'un webhook : HMAC-SHA256 du corps, avec un secret propre à
/// l'automatisation (montré à l'administrateur pour vérification).
export const secretWebhook = (automatisationId) =>
  createHmac("sha256", env.jwtSecret).update(`webhook:${automatisationId}`).digest("hex").slice(0, 40);

export const signer = (secret, horodatage, corps) =>
  `sha256=${createHmac("sha256", secret).update(`${horodatage}.${corps}`).digest("hex")}`;

const transporteurEspace = async (tenantId) => {
  const app = await prisma.app.findFirst({ where: { slug: "courrier", tenantId: null } });
  const installation = app
    ? await prisma.installation.findUnique({ where: { tenantId_appId: { tenantId, appId: app.id } } }).catch(() => null)
    : null;
  const smtp = installation?.settings?.smtp;
  return smtp?.host ? { transport: creerTransporteurEspace(smtp), de: smtp.de || null } : null;
};

const ACTIONS = {
  async notifier(regle, action, ctx) {
    const ids = await destinatairesDe(regle.tenantId, action.destinataires, ctx);
    if (!ids.length) return "Aucun destinataire trouvé";
    const n = await notifier(regle.tenantId, ids, {
      auteurNom: "Automatisation",
      source: ctx.module,
      titre: String(remplir(action.titre, ctx)).slice(0, 140) || regle.nom,
      message: String(remplir(action.message || "", ctx)).slice(0, 600),
      lien: ctx.evenement === "suppression" ? { app: ctx.module } : lienVers(ctx.module, ctx.collection, ctx.id),
    });
    return `${n} personne(s) prévenue(s)`;
  },

  async creer(regle, action, ctx) {
    const data = remplirChamps(action.donnees, ctx);
    const fiche = await creerFiche(regle, action.module, action.collection, data, ctx);
    return `Fiche créée dans ${action.module}/${action.collection} (${fiche.id})`;
  },

  async modifier(regle, action, ctx) {
    if (ctx.evenement === "suppression") return "Fiche supprimée : rien à modifier";
    if (ecritureInterdite(ctx.module, ctx.collection)) throw new Error("Écriture interdite dans cette collection");
    const courante = await prisma.record.findFirst({
      where: { id: ctx.id, tenantId: regle.tenantId, module: ctx.module, collection: ctx.collection },
    });
    if (!courante) return "Fiche introuvable";
    const data = { ...(courante.data || {}), ...remplirChamps(action.champs, ctx) };
    verifierTaille(data);
    await prisma.record.update({ where: { id: courante.id }, data: { data, updatedById: regle.creeParId || null } });
    await publierFiche({ tenantId: regle.tenantId, module: ctx.module, collection: ctx.collection, id: courante.id, action: "modification", par: null });
    planifier({
      ...ctx,
      tenantId: regle.tenantId,
      evenement: "modification",
      avant: courante.data,
      fiche: data,
      profondeur: ctx.profondeur + 1,
    });
    return "Fiche modifiée";
  },

  async tache(regle, action, ctx) {
    let tableau = await tableauPour(regle.tenantId, action.tableauId);
    if (!tableau) {
      tableau = await prisma.record.create({
        data: {
          tenantId: regle.tenantId,
          userId: regle.creeParId || "automatisation",
          module: "projets",
          collection: "tableaux",
          data: {
            nom: "Automatisations",
            couleur: "#1a73e8",
            colonnes: ["À faire", "En cours", "Terminé"].map((titre) => ({ id: idCourt(), titre })),
          },
        },
      });
    }
    const colonneId = tableau.data?.colonnes?.[0]?.id || null;
    const assignes = action.assigne ? await comptesDesignes(regle.tenantId, valeurA(ctx.fiche, action.assigne)) : [];
    const liens = {};
    if (ctx.fiche?.clientId) liens.clientId = ctx.fiche.clientId;
    if (ctx.module === "crm" && ctx.collection === "clients") liens.clientId = ctx.id;
    if (ctx.module === "crm" && ctx.collection === "opportunites") liens.opportuniteId = ctx.id;
    const data = {
      tableauId: tableau.id,
      colonneId,
      ordre: Date.now(),
      titre: String(remplir(action.titre, ctx)).slice(0, 140) || regle.nom,
      description: String(remplir(action.description || "", ctx)),
      etiquettes: [],
      checklist: [],
      commentaires: [],
      pieces: [],
      liens,
      ...(assignes[0] ? { assigneId: assignes[0] } : {}),
      ...(action.echeance ? { echeance: String(remplir(action.echeance, ctx)).slice(0, 10) || null } : {}),
    };
    const carte = await creerFiche(regle, "projets", "cartes", data, ctx);
    if (assignes[0] && assignes[0] !== ctx.auteur?.id) {
      await notifier(regle.tenantId, [assignes[0]], {
        auteurNom: "Automatisation",
        source: "projets",
        titre: `Nouvelle tâche : ${data.titre}`,
        message: tableau.data?.nom ? `Tableau « ${tableau.data.nom} »` : null,
        lien: { app: "projets", params: { carte: carte.id } },
      });
    }
    return `Tâche créée dans « ${tableau.data?.nom || "Projets"} »`;
  },

  async courriel(regle, action, ctx) {
    const ids = await destinatairesDe(regle.tenantId, action.destinataires, ctx);
    if (!ids.length) return "Aucun destinataire trouvé";
    // Uniquement des membres de l'espace : une automatisation n'écrit pas
    // à l'extérieur (c'est le rôle des Campagnes, avec leurs garde-fous).
    const membres = await prisma.user.findMany({ where: { tenantId: regle.tenantId, id: { in: ids } }, select: { email: true } });
    const message = {
      a: membres.map((m) => m.email).join(", "),
      sujet: String(remplir(action.sujet, ctx)).slice(0, 200),
      texte: String(remplir(action.texte, ctx)),
    };
    const espace = await transporteurEspace(regle.tenantId);
    const envoye = espace
      ? (await envoyerVia(espace.transport, { ...message, de: espace.de || undefined })).envoye
      : await envoyerMail(message);
    if (!envoye) throw new Error("Courriel non envoyé (relais SMTP indisponible)");
    return `Courriel envoyé à ${membres.length} membre(s)`;
  },

  async webhook(regle, action, ctx) {
    const horodatage = String(Math.floor(Date.now() / 1000));
    const corps = {
      automatisation: { id: regle.id, nom: regle.nom },
      evenement: ctx.evenement,
      module: ctx.module,
      collection: ctx.collection,
      id: ctx.id,
      fiche: ctx.fiche,
      avant: ctx.avant,
      auteur: ctx.auteur ? { id: ctx.auteur.id, nom: ctx.auteur.nom } : null,
      horodatage: new Date().toISOString(),
    };
    const texte = JSON.stringify(corps);
    const code = await posterJson(action.url, corps, {
      "x-companyos-horodatage": horodatage,
      "x-companyos-signature": signer(secretWebhook(regle.id), horodatage, texte),
    });
    if (code < 200 || code >= 300) throw new Error(`Le webhook a répondu ${code}`);
    return `Webhook appelé (${code})`;
  },
};

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

const lireLiee = async (tenantId, lier, fiche) => {
  if (!lier) return null;
  const id = valeurA(fiche, lier.champ);
  if (typeof id !== "string" || !id) return null;
  const liee = await prisma.record.findFirst({
    where: { tenantId, module: lier.module, collection: lier.collection, id },
    select: { data: true },
  });
  return liee?.data || null;
};

/// Exécute une règle sur un événement (sans revérifier le déclencheur).
/// `essai` : n'écrit pas l'historique, pour le bouton « Tester ».
export const executer = async (regle, evt, { essai = false } = {}) => {
  const debut = Date.now();
  const definition = regle.definition || {};
  const ctx = {
    tenantId: regle.tenantId,
    module: evt.module,
    collection: evt.collection,
    evenement: evt.evenement,
    id: evt.id,
    fiche: evt.fiche || {},
    avant: evt.avant || null,
    auteur: evt.auteur || null,
    profondeur: evt.profondeur || 0,
    maintenant: new Date().toISOString(),
  };
  ctx.lie = await lireLiee(regle.tenantId, definition.declencheur?.lier, ctx.fiche).catch(() => null);

  const resultats = [];
  for (const action of definition.actions || []) {
    const fn = ACTIONS[action.type];
    try {
      if (!fn) throw new Error(`Action inconnue : ${action.type}`);
      resultats.push({ type: action.type, ok: true, detail: String(await fn(regle, action, ctx)).slice(0, 300) });
    } catch (err) {
      resultats.push({ type: action.type, ok: false, detail: String(err?.message || err).slice(0, 300) });
    }
  }
  const statut = resultats.every((r) => r.ok) ? "ok" : "erreur";
  const dureeMs = Date.now() - debut;

  if (!essai) {
    await prisma.executionAutomatisation
      .create({
        data: {
          automatisationId: regle.id,
          tenantId: regle.tenantId,
          statut,
          evenement: { module: evt.module, collection: evt.collection, evenement: evt.evenement, id: evt.id, auteur: ctx.auteur?.nom || null },
          resultats,
          dureeMs,
        },
      })
      .catch(() => {});
    await prisma.automatisation
      .update({
        where: { id: regle.id },
        data: {
          derniereExecution: new Date(),
          executions: { increment: 1 },
          ...(statut === "erreur" ? { echecs: { increment: 1 } } : {}),
        },
      })
      .catch(() => {});
    // Purge de l'historique, de temps en temps.
    if (Math.random() < 0.05) await purgerHistorique(regle.id).catch(() => {});
  }
  return { statut, resultats, dureeMs };
};

const purgerHistorique = async (automatisationId) => {
  const seuil = await prisma.executionAutomatisation.findFirst({
    where: { automatisationId },
    orderBy: { creeLe: "desc" },
    skip: HISTORIQUE_PAR_REGLE,
    select: { creeLe: true },
  });
  if (seuil) {
    await prisma.executionAutomatisation.deleteMany({ where: { automatisationId, creeLe: { lte: seuil.creeLe } } });
  }
};

/// Point d'entrée des routes : une fiche vient d'être écrite.
///   { tenantId, module, collection, evenement, id, fiche, avant, auteur:{id,nom}, profondeur }
export const declencher = async (evt) => {
  if ((evt.profondeur || 0) >= PROFONDEUR_MAX) return [];
  const regles = (await reglesDe(evt.tenantId)).filter(
    (r) => r.module === evt.module && r.collection === evt.collection,
  );
  const executees = [];
  for (const regle of regles) {
    const definition = regle.definition || {};
    const contexte = { ...evt, maintenant: new Date().toISOString() };
    if (!declencheurCorrespond(definition.declencheur, evt)) continue;
    if (!conditionsVraies(definition, contexte)) continue;
    if (debitAtteint(evt.tenantId)) break;
    executees.push(await executer(regle, evt));
  }
  return executees;
};

/// Après la réponse HTTP : l'utilisateur n'attend pas les automatisations,
/// et leurs erreurs ne remontent jamais jusqu'à lui.
export const planifier = (evt) => {
  setImmediate(() => {
    declencher(evt).catch((err) => console.error("Automatisations :", err?.message || err));
  });
};

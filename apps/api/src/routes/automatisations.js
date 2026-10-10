import {
  conditionVraie,
  conditionsVraies,
  declencheurCorrespond,
  remplir,
  validerAutomatisation,
} from "@companyos/shared/automatisations";
import { prisma, serialize } from "../db.js";
import { authenticate, exigerRole } from "../auth.js";
import { journaliser } from "../audit.js";
import { ecritureInterdite, reglesModifiees, secretWebhook } from "../moteurAutomatisations.js";

/// Les automatisations de l'espace : réservées aux administrateurs.
///
/// Une automatisation agit pour tout l'espace (elle crée des fiches,
/// prévient des gens, appelle des adresses externes avec le contenu des
/// fiches) : la configurer, c'est décider pour tout le monde.

const AUTOMATISATIONS_MAX = 100;

const enLigne = (a) => ({
  id: a.id,
  nom: a.nom,
  active: a.active,
  recette: a.recette,
  ...a.definition,
  stats: {
    executions: a.executions,
    echecs: a.echecs,
    derniereExecution: a.derniereExecution,
  },
  creeLe: a.creeLe,
  modifieLe: a.modifieLe,
});

/// Refus propres à l'espace (en plus de la validation de forme).
const refusMetier = (valeur) => {
  for (const action of valeur.actions) {
    if (action.type === "creer" && ecritureInterdite(action.module, action.collection)) {
      return `Une automatisation ne peut pas écrire dans ${action.module}/${action.collection}.`;
    }
    if (action.type === "modifier" && ecritureInterdite(valeur.declencheur.module, valeur.declencheur.collection)) {
      return "Une automatisation ne peut pas modifier les fiches de cette collection.";
    }
  }
  return null;
};

const colonnes = (valeur) => ({
  nom: valeur.nom,
  active: valeur.active,
  module: valeur.declencheur.module,
  collection: valeur.declencheur.collection,
  evenement: valeur.declencheur.evenement,
  definition: {
    declencheur: valeur.declencheur,
    toutes: valeur.toutes,
    conditions: valeur.conditions,
    actions: valeur.actions,
  },
});

export default async function automatisationRoutes(app) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", exigerRole("ADMIN"));

  app.get("/", async (request) => {
    const liste = await prisma.automatisation.findMany({
      where: { tenantId: request.tenantId },
      orderBy: { creeLe: "desc" },
    });
    return serialize(liste.map(enLigne));
  });

  app.post("/", async (request, reply) => {
    const { ok, erreurs, valeur } = validerAutomatisation(request.body);
    if (!ok) return reply.code(400).send({ error: erreurs[0], erreurs });
    const refus = refusMetier(valeur);
    if (refus) return reply.code(400).send({ error: refus });
    const n = await prisma.automatisation.count({ where: { tenantId: request.tenantId } });
    if (n >= AUTOMATISATIONS_MAX) {
      return reply.code(400).send({ error: `${AUTOMATISATIONS_MAX} automatisations au plus par espace.` });
    }
    const recette = typeof request.body?.recette === "string" ? request.body.recette.slice(0, 60) : null;
    const a = await prisma.automatisation.create({
      data: { tenantId: request.tenantId, creeParId: request.user.id, recette, ...colonnes(valeur) },
    });
    reglesModifiees(request.tenantId);
    await journaliser(request, "automatisation.creation", a.nom, { id: a.id });
    return reply.code(201).send(serialize(enLigne(a)));
  });

  const trouver = (request) =>
    prisma.automatisation.findFirst({ where: { id: request.params.id, tenantId: request.tenantId } });

  app.put("/:id", async (request, reply) => {
    const existante = await trouver(request);
    if (!existante) return reply.code(404).send({ error: "Automatisation introuvable" });
    const { ok, erreurs, valeur } = validerAutomatisation(request.body);
    if (!ok) return reply.code(400).send({ error: erreurs[0], erreurs });
    const refus = refusMetier(valeur);
    if (refus) return reply.code(400).send({ error: refus });
    const a = await prisma.automatisation.update({ where: { id: existante.id }, data: colonnes(valeur) });
    reglesModifiees(request.tenantId);
    await journaliser(request, "automatisation.modification", a.nom, { id: a.id });
    return serialize(enLigne(a));
  });

  app.put("/:id/active", async (request, reply) => {
    const existante = await trouver(request);
    if (!existante) return reply.code(404).send({ error: "Automatisation introuvable" });
    const active = request.body?.active === true;
    const a = await prisma.automatisation.update({ where: { id: existante.id }, data: { active } });
    reglesModifiees(request.tenantId);
    await journaliser(request, active ? "automatisation.activation" : "automatisation.pause", a.nom, { id: a.id });
    return serialize(enLigne(a));
  });

  app.delete("/:id", async (request, reply) => {
    const existante = await trouver(request);
    if (!existante) return reply.code(404).send({ error: "Automatisation introuvable" });
    await prisma.automatisation.delete({ where: { id: existante.id } });
    reglesModifiees(request.tenantId);
    await journaliser(request, "automatisation.suppression", existante.nom, { id: existante.id });
    return reply.code(204).send();
  });

  /// Les dernières exécutions, action par action.
  app.get("/:id/historique", async (request, reply) => {
    const existante = await trouver(request);
    if (!existante) return reply.code(404).send({ error: "Automatisation introuvable" });
    const liste = await prisma.executionAutomatisation.findMany({
      where: { automatisationId: existante.id },
      orderBy: { creeLe: "desc" },
      take: 50,
    });
    return serialize(liste);
  });

  /// Le secret de signature des webhooks, pour que le destinataire vérifie
  /// que l'appel vient bien de nous.
  app.get("/:id/secret", async (request, reply) => {
    const existante = await trouver(request);
    if (!existante) return reply.code(404).send({ error: "Automatisation introuvable" });
    return { secret: secretWebhook(existante.id), entete: "X-CompanyOS-Signature", algorithme: "HMAC-SHA256(horodatage + \".\" + corps)" };
  });

  /// Essai à blanc sur une fiche réelle : que se passerait-il ? Aucune
  /// action n'est exécutée — on montre les conditions évaluées et les
  /// textes tels qu'ils seraient remplis.
  app.post("/essai", async (request, reply) => {
    const { ok, erreurs, valeur } = validerAutomatisation(request.body?.automatisation);
    if (!ok) return reply.code(400).send({ error: erreurs[0], erreurs });
    const { module, collection, evenement } = valeur.declencheur;
    const ficheId = typeof request.body?.ficheId === "string" ? request.body.ficheId : null;
    const fiche = await prisma.record.findFirst({
      where: { tenantId: request.tenantId, module, collection, ...(ficheId ? { id: ficheId } : {}) },
      orderBy: { updatedAt: "desc" },
    });
    if (!fiche) return { fiche: null, correspond: false, raison: "Aucune fiche dans cette collection pour essayer." };

    // Pour une modification, on simule le passage à la valeur attendue
    // par les conditions « devient » (sinon l'essai ne dirait jamais oui).
    const avant = evenement === "creation" ? null : { ...fiche.data };
    const apres = { ...fiche.data };
    if (evenement === "modification") {
      for (const c of valeur.conditions) {
        if (c.operateur === "devient" && !c.champ.includes(".")) {
          if (String(avant[c.champ] ?? "").toLowerCase() === String(c.valeur).toLowerCase()) avant[c.champ] = null;
          apres[c.champ] = c.valeur;
        }
      }
      if (valeur.declencheur.champ && JSON.stringify(avant[valeur.declencheur.champ]) === JSON.stringify(apres[valeur.declencheur.champ])) {
        avant[valeur.declencheur.champ] = null;
      }
    }
    let lie = null;
    if (valeur.declencheur.lier) {
      const id = apres[valeur.declencheur.lier.champ];
      lie = typeof id === "string"
        ? (await prisma.record.findFirst({ where: { tenantId: request.tenantId, module: valeur.declencheur.lier.module, collection: valeur.declencheur.lier.collection, id }, select: { data: true } }))?.data || null
        : null;
    }
    const contexte = {
      id: fiche.id,
      evenement,
      fiche: apres,
      avant,
      lie,
      auteur: { id: request.user.id, nom: request.user.name },
      maintenant: new Date().toISOString(),
    };
    const evt = { module, collection, evenement, fiche: apres, avant };
    const apercu = valeur.actions.map((a) => {
      switch (a.type) {
        case "notifier":
          return { type: a.type, destinataires: a.destinataires, titre: remplir(a.titre, contexte), message: remplir(a.message, contexte) };
        case "courriel":
          return { type: a.type, destinataires: a.destinataires, sujet: remplir(a.sujet, contexte), texte: remplir(a.texte, contexte) };
        case "creer":
          return { type: a.type, cible: `${a.module}/${a.collection}`, donnees: Object.fromEntries(Object.entries(a.donnees).map(([k, v]) => [k, remplir(v, contexte)])) };
        case "modifier":
          return { type: a.type, champs: Object.fromEntries(Object.entries(a.champs).map(([k, v]) => [k, remplir(v, contexte)])) };
        case "tache":
          return { type: a.type, titre: remplir(a.titre, contexte), description: remplir(a.description, contexte), echeance: remplir(a.echeance, contexte) };
        case "webhook":
          return { type: a.type, url: a.url };
        default:
          return { type: a.type };
      }
    });
    return serialize({
      fiche: { id: fiche.id, data: fiche.data },
      declencheur: declencheurCorrespond(valeur.declencheur, evt),
      conditions: valeur.conditions.map((c) => ({ ...c, vraie: conditionVraie(c, contexte) })),
      correspond: declencheurCorrespond(valeur.declencheur, evt) && conditionsVraies(valeur, contexte),
      apercu,
    });
  });
}

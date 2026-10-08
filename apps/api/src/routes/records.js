import { z } from "zod";
import { prisma, serialize } from "../db.js";
import { authenticate, auMoins } from "../auth.js";
import { journaliser } from "../audit.js";
import { executerAutomatisations } from "../automatisations.js";
import {
  accesModule,
  creationPartagee,
  enAnnuaire,
  lecturePartagee,
  suppressionPartagee,
} from "../acces.js";

/// CRUD générique des modules métier. Un module range ses données dans
/// des collections nommées : /api/records/crm/clients, etc.
/// L'isolation par tenant est le seul vrai contrat de ce fichier.

const nameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "minuscules, chiffres et tirets uniquement");

const MAX_DATA_BYTES = 64 * 1024;
const MAX_CLASSEUR_BYTES = 8 * 1024 * 1024;
const MAX_RECORD_BODY_BYTES = 10 * 1024 * 1024;

const limiteDonnees = (names) =>
  names?.module === "classeur" && names?.collection === "classeurs"
    ? MAX_CLASSEUR_BYTES
    : MAX_DATA_BYTES;

/// Collections lues par un **moteur** du serveur, et non par un simple
/// écran.
///
/// Le CRUD de ce fichier est générique et ouvert à tout membre : c'est ce
/// qui permet à une app du Studio de ranger ses fiches sans une ligne de
/// serveur. Mais quelques collections ne sont pas de simples données —
/// elles sont **exécutées**. Une fiche déposée dans `campagnes/campagnes`
/// est ramassée par `src/campagnes.js`, qui envoie réellement les messages
/// aux adresses qu'elle contient.
///
/// Autrement dit, sans ce garde-fou, n'importe quel membre authentifié
/// dispose d'un relais d'envoi de masse au nom de son entreprise — et
/// depuis l'IP de la plateforme. Écrire ici demande donc d'être
/// administrateur, comme installer une application.
///
/// La lecture reste ouverte : voir ses propres campagnes n'a jamais fait
/// de mal.
const COLLECTIONS_MOTEUR = new Set([
  "campagnes/campagnes",
  "courrier/modeles",
  "courrier/envois",
  "relances/relances",
]);

/// Collections **de référence**, communes à toutes les applications : la
/// fiche de l'entreprise (raison sociale, NCC, RIB…) part sur chaque
/// facture. Un membre la lit ; seul un administrateur la change — un RIB
/// modifié en douce, c'est le paiement d'un client détourné.
const COLLECTIONS_REFERENCE = new Set(["entreprise/profil"]);

const exigeAdmin = (names) =>
  COLLECTIONS_MOTEUR.has(`${names.module}/${names.collection}`) ||
  COLLECTIONS_REFERENCE.has(`${names.module}/${names.collection}`);

/// Réponse commune à toute opération refusée par la règle d'accès.
const refuserAcces = (reply, names) =>
  reply.code(403).send({
    error: `Vous n'avez pas accès à l'application « ${names.module} ». Demandez-le à un administrateur de l'espace.`,
    acces: false,
  });

const validateParams = (params, reply) => {
  const module = nameSchema.safeParse(params.module);
  const collection = nameSchema.safeParse(params.collection);
  if (!module.success || !collection.success) {
    reply.code(400).send({ error: "Nom de module ou de collection invalide" });
    return null;
  }
  return { module: module.data, collection: collection.data };
};

const validateData = (body, reply, names) => {
  const data = body?.data;
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    reply.code(400).send({ error: "`data` doit être un objet JSON" });
    return null;
  }
  const taille = Buffer.byteLength(JSON.stringify(data), "utf8");
  const limite = limiteDonnees(names);
  if (taille > limite) {
    const plafond = limite >= 1024 * 1024 ? `${limite / (1024 * 1024)} Mo` : `${limite / 1024} Ko`;
    reply.code(413).send({ error: `Enregistrement trop volumineux (${plafond} max)` });
    return null;
  }
  return data;
};

/// Les identités jointes à chaque fiche : qui l'a saisie, qui l'a modifiée
/// en dernier. Renvoyées avec la fiche pour que les listes affichent un
/// visage sans réclamer une requête par ligne.
///
/// Les identifiants sont conservés à part : un compte supprimé laisse la
/// fiche intacte, simplement sans nom en face.
const auteurs = async (tenantId, records) => {
  const ids = [
    ...new Set(records.flatMap((r) => [r.userId, r.updatedById]).filter(Boolean)),
  ];
  if (!ids.length) return records;

  const gens = await prisma.user.findMany({
    where: { id: { in: ids }, tenantId },
    select: { id: true, name: true, avatar: true },
  });
  const par = new Map(gens.map((u) => [u.id, u]));

  return records.map((r) => ({
    ...r,
    auteur: par.get(r.userId) || null,
    modifiePar: r.updatedById ? par.get(r.updatedById) || null : null,
  }));
};

export default async function recordRoutes(app) {
  app.addHook("preHandler", authenticate);

  app.get("/:module/:collection", async (request, reply) => {
    const names = validateParams(request.params, reply);
    if (!names) return;

    // Sans accès à l'application, seules les collections partagées se
    // lisent — et la liste des salariés, réduite à son annuaire.
    const { autorise } = await accesModule(request, names.module);
    const partage = autorise ? null : lecturePartagee(names);
    if (!autorise && !partage) return refuserAcces(reply, names);

    const records = await prisma.record.findMany({
      where: { tenantId: request.tenantId, ...names },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    const lisibles = partage === "annuaire" ? records.map(enAnnuaire) : records;
    return serialize(await auteurs(request.tenantId, lisibles));
  });

  app.post("/:module/:collection", { bodyLimit: MAX_RECORD_BODY_BYTES }, async (request, reply) => {
    const names = validateParams(request.params, reply);
    if (!names) return;
    if (exigeAdmin(names) && !auMoins(request.user?.role, "ADMIN")) {
      return reply.code(403).send({
        error:
          "Cette collection déclenche des envois automatiques : seul un administrateur peut y écrire.",
      });
    }
    let data = validateData(request.body, reply, names);
    if (!data) return;

    // Sans accès, on ne dépose qu'une demande (un congé, par exemple), que
    // quelqu'un qui a accès tranchera.
    const { autorise } = await accesModule(request, names.module);
    if (!autorise && !creationPartagee(names, data)) return refuserAcces(reply, names);

    const execution = await executerAutomatisations({
      tenantId: request.tenantId,
      userId: request.user.id,
      ...names,
      declencheur: "creation",
      valeurs: data,
    });
    data = execution.valeurs;

    const record = await prisma.record.create({
      data: {
        tenantId: request.tenantId,
        userId: request.user.id,
        ...names,
        data,
      },
    });

    if (execution.declenchees.length) {
      await journaliser(request, "nocode.automatisation", execution.app, {
        collection: names.collection,
        declencheur: "creation",
        regles: execution.declenchees,
        recordId: record.id,
      });
    }
    const avecAuteur = (await auteurs(request.tenantId, [record]))[0];
    return reply
      .code(201)
      .send(
        serialize({ ...avecAuteur, automatisationsExecutees: execution.declenchees }),
      );
  });

  app.put("/:module/:collection/:id", { bodyLimit: MAX_RECORD_BODY_BYTES }, async (request, reply) => {
    const names = validateParams(request.params, reply);
    if (!names) return;
    if (exigeAdmin(names) && !auMoins(request.user?.role, "ADMIN")) {
      return reply.code(403).send({
        error:
          "Cette collection déclenche des envois automatiques : seul un administrateur peut y écrire.",
      });
    }
    let data = validateData(request.body, reply, names);
    if (!data) return;

    // Modifier, c'est trancher : jamais sans accès à l'application.
    if (!(await accesModule(request, names.module)).autorise) {
      return refuserAcces(reply, names);
    }

    const execution = await executerAutomatisations({
      tenantId: request.tenantId,
      userId: request.user.id,
      ...names,
      declencheur: "modification",
      valeurs: data,
    });
    data = execution.valeurs;

    // updateMany + filtre tenant : impossible de toucher la ligne d'un autre client.
    const revision = request.body?.updatedAt;
    if (revision && Number.isNaN(new Date(revision).getTime())) {
      return reply.code(400).send({ error: "Révision d’enregistrement invalide" });
    }
    const { count } = await prisma.record.updateMany({
      where: {
        id: request.params.id, tenantId: request.tenantId, ...names,
        ...(revision ? { updatedAt: new Date(revision) } : {}),
      },
      data: { data, updatedById: request.user.id },
    });

    if (count === 0) {
      if (revision) return reply.code(409).send({ error: "Ce document a été modifié dans une autre fenêtre. Rechargez-le avant d’enregistrer." });
      return reply.code(404).send({ error: "Enregistrement introuvable" });
    }

    const record = await prisma.record.findUnique({ where: { id: request.params.id } });
    if (execution.declenchees.length) {
      await journaliser(request, "nocode.automatisation", execution.app, {
        collection: names.collection,
        declencheur: "modification",
        regles: execution.declenchees,
        recordId: record.id,
      });
    }
    const avecAuteur = (await auteurs(request.tenantId, [record]))[0];
    return serialize({
      ...avecAuteur,
      automatisationsExecutees: execution.declenchees,
    });
  });

  app.delete("/:module/:collection/:id", async (request, reply) => {
    const names = validateParams(request.params, reply);
    if (!names) return;
    if (exigeAdmin(names) && !auMoins(request.user?.role, "ADMIN")) {
      return reply.code(403).send({
        error:
          "Cette collection déclenche des envois automatiques : seul un administrateur peut y écrire.",
      });
    }

    // On relit avant d'effacer : une fois la ligne partie, il ne reste
    // aucun moyen de dire au journal *ce qui* a disparu.
    const record = await prisma.record.findFirst({
      where: { id: request.params.id, tenantId: request.tenantId, ...names },
    });
    if (!record) {
      return reply.code(404).send({ error: "Enregistrement introuvable" });
    }

    // Sans accès à l'application, on ne retire que sa propre demande encore
    // en attente.
    const { autorise } = await accesModule(request, names.module);
    if (!autorise && !suppressionPartagee(names, record, request.user)) {
      return refuserAcces(reply, names);
    }

    // Chacun peut défaire sa propre saisie ; effacer celle d'un autre
    // demande d'être administrateur.
    //
    // Un simple `exigerRole("ADMIN")` sur la route serait plus court, mais
    // interdirait le geste le plus courant qui soit — retirer la fiche
    // qu'on vient de créer par erreur — et pousserait à donner le rôle
    // ADMIN à tout le monde, ce qui reviendrait à retirer le contrôle.
    // La règle utile est celle-ci : la suppression est définitive (il n'y
    // a pas de corbeille pour les fiches), donc personne n'efface le
    // travail d'un collègue sans en avoir la responsabilité.
    const sien = record.userId === request.user.id;
    if (!sien && !auMoins(request.user?.role, "ADMIN")) {
      return reply.code(403).send({
        error:
          "Cette fiche a été saisie par quelqu'un d'autre : seul un administrateur peut la supprimer.",
      });
    }

    await prisma.record.delete({ where: { id: record.id } });

    // Une suppression de donnée métier est irréversible — il n'y a pas de
    // corbeille pour les fiches. Elle a sa place au journal.
    await journaliser(
      request,
      "donnees.suppression",
      // Les fiches n'ont pas de champ commun : on prend le premier libellé
      // plausible, sinon la collection suffit à situer la perte.
      record.data?.nom || record.data?.titre || record.data?.designation || null,
      { module: names.module, collection: names.collection },
    );

    return reply.code(204).send();
  });
}

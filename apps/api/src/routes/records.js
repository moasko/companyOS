import { z } from "zod";
import { prisma, serialize } from "../db.js";
import { authenticate, auMoins } from "../auth.js";
import { journaliser } from "../audit.js";

/// CRUD générique des modules métier. Un module range ses données dans
/// des collections nommées : /api/records/crm/clients, etc.
/// L'isolation par tenant est le seul vrai contrat de ce fichier.

const nameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "minuscules, chiffres et tirets uniquement");

const MAX_DATA_BYTES = 64 * 1024;

const validateParams = (params, reply) => {
  const module = nameSchema.safeParse(params.module);
  const collection = nameSchema.safeParse(params.collection);
  if (!module.success || !collection.success) {
    reply.code(400).send({ error: "Nom de module ou de collection invalide" });
    return null;
  }
  return { module: module.data, collection: collection.data };
};

const validateData = (body, reply) => {
  const data = body?.data;
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    reply.code(400).send({ error: "`data` doit être un objet JSON" });
    return null;
  }
  if (JSON.stringify(data).length > MAX_DATA_BYTES) {
    reply.code(413).send({ error: "Enregistrement trop volumineux (64 Ko max)" });
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

    const records = await prisma.record.findMany({
      where: { tenantId: request.tenantId, ...names },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    return serialize(await auteurs(request.tenantId, records));
  });

  app.post("/:module/:collection", async (request, reply) => {
    const names = validateParams(request.params, reply);
    if (!names) return;
    const data = validateData(request.body, reply);
    if (!data) return;

    const record = await prisma.record.create({
      data: {
        tenantId: request.tenantId,
        userId: request.user.id,
        ...names,
        data,
      },
    });

    return reply
      .code(201)
      .send(serialize((await auteurs(request.tenantId, [record]))[0]));
  });

  app.put("/:module/:collection/:id", async (request, reply) => {
    const names = validateParams(request.params, reply);
    if (!names) return;
    const data = validateData(request.body, reply);
    if (!data) return;

    // updateMany + filtre tenant : impossible de toucher la ligne d'un autre client.
    const { count } = await prisma.record.updateMany({
      where: { id: request.params.id, tenantId: request.tenantId, ...names },
      data: { data, updatedById: request.user.id },
    });

    if (count === 0) {
      return reply.code(404).send({ error: "Enregistrement introuvable" });
    }

    const record = await prisma.record.findUnique({ where: { id: request.params.id } });
    return serialize((await auteurs(request.tenantId, [record]))[0]);
  });

  app.delete("/:module/:collection/:id", async (request, reply) => {
    const names = validateParams(request.params, reply);
    if (!names) return;

    // On relit avant d'effacer : une fois la ligne partie, il ne reste
    // aucun moyen de dire au journal *ce qui* a disparu.
    const record = await prisma.record.findFirst({
      where: { id: request.params.id, tenantId: request.tenantId, ...names },
    });
    if (!record) {
      return reply.code(404).send({ error: "Enregistrement introuvable" });
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

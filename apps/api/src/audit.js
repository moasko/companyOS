import { prisma } from "./db.js";

/// Journal d'activité.
///
/// `logger: true` de Fastify écrit des lignes HTTP : une méthode, un
/// chemin, un code. Cela dit qu'un DELETE a réussi, pas qui l'a fait ni
/// sur quoi, et tout disparaît au redémarrage. Ce module écrit l'autre
/// moitié : l'auteur, la cible, l'avant et l'après.
///
/// Règles :
///   - on journalise ce qui *change* l'espace, jamais les lectures ;
///   - on recopie le nom et l'adresse de l'auteur au lieu d'une clé
///     étrangère, pour que la ligne reste lisible après son départ ;
///   - l'écriture ne doit jamais faire échouer l'action journalisée.

/// Écrit une entrée. Ne lève jamais : si le journal tombe, l'action de
/// l'utilisateur a déjà eu lieu et la faire échouer après coup serait pire
/// que de perdre une ligne. L'échec part dans les logs du serveur.
export const journaliser = async (request, action, cible = null, details = null) => {
  const user = request.user;
  if (!user) return;

  try {
    await prisma.auditEvent.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        action,
        cible: cible ? String(cible).slice(0, 200) : null,
        details: details ?? undefined,
        ip: adresse(request),
      },
    });
  } catch (err) {
    request.log?.error({ err, action }, "journal d'activité : écriture impossible");
  }
};

/// Variante pour les actions qui créent la session elle-même (connexion,
/// inscription, invitation acceptée) : à ce moment-là `request.user`
/// n'existe pas encore, l'auteur est passé explicitement.
///
/// On reconstruit un objet minimal plutôt que d'étaler la requête : chez
/// Fastify, `headers` et `ip` sont des accesseurs du prototype, qu'un
/// `{ ...request }` laisserait derrière lui.
export const journaliserPour = async (request, user, action, cible = null, details = null) =>
  journaliser(
    { user, log: request.log, ip: request.ip, headers: request.headers },
    action,
    cible,
    details,
  );

/// Derrière un reverse proxy, `request.ip` est celui du proxy. On lit
/// l'en-tête standard quand il est là, en ne gardant que le premier saut.
const adresse = (request) => {
  const suivi = request.headers?.["x-forwarded-for"];
  if (typeof suivi === "string" && suivi.length) return suivi.split(",")[0].trim();
  return request.ip || null;
};

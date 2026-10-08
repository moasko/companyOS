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
///
/// `options.tenantId` écrit la ligne dans un **autre** espace que celui de
/// l'auteur : c'est le cas de l'exploitant, dont les gestes (formule, rôle,
/// suspension) concernent un client qui doit pouvoir les relire chez lui.
export const journaliser = async (
  request,
  action,
  cible = null,
  details = null,
  options = {},
) => {
  const user = request.user;
  if (!user) return;

  try {
    await prisma.auditEvent.create({
      data: {
        tenantId: options.tenantId || user.tenantId,
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

/// L'adresse du client, telle que Fastify l'a établie.
///
/// Ce module lisait autrefois `X-Forwarded-For` lui-même, en prenant le
/// premier saut : c'est la valeur que **le client** choisit, puisqu'il peut
/// envoyer l'en-tête à la main. N'importe qui inscrivait donc l'adresse de
/// son choix au journal. `request.ip` applique le réglage `trustProxy` de
/// `index.js`, qui ne croit que le nombre de proxies déclaré.
const adresse = (request) => request.ip || null;

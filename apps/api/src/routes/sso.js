import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { authenticate, exigerRole, hashPassword, normaliserEmail, ouvrirSession } from "../auth.js";
import { journaliser, journaliserPour } from "../audit.js";
import { chiffrer, dechiffrer } from "../chiffrement.js";
import { consommerJeton, creerJeton } from "../etatPartage.js";
import { posterFormulaire } from "../web.js";
import {
  aleatoire,
  decouvrir,
  defiPkce,
  domaineDe,
  urlAutorisation,
  validerConfigSso,
  verifierIdToken,
} from "../sso.js";

/// Authentification unique par espace — voir src/sso.js pour le flux.

const LIMITE = { rateLimit: { max: 30, timeWindow: "5 minutes", keyGenerator: (r) => r.ip } };

const urlApi = (request) => (env.apiPublique || `${request.protocol}://${request.headers.host}`).replace(/\/+$/, "");
const urlRetour = (request) => `${urlApi(request)}/api/auth/sso/retour`;
const urlShell = () => (env.urlPublique || env.corsOrigin[0] || "").replace(/\/+$/, "");

const versShell = (reply, params) => reply.redirect(`${urlShell()}/?connexion&${new URLSearchParams(params)}`);
const echec = (reply, message) => versShell(reply, { sso_erreur: message });

/// L'espace qui a déclaré ce domaine (un domaine n'appartient qu'à un espace).
const espacePourDomaine = async (domaine) => {
  if (!domaine) return null;
  const [t] = await prisma.$queryRaw`
    SELECT id, sso FROM tenants
    WHERE sso IS NOT NULL AND jsonb_exists(sso->'domaines', ${domaine})
      AND COALESCE((sso->>'actif')::boolean, false) AND NOT suspendu
    LIMIT 1`;
  return t || null;
};

export default async function ssoRoutes(app) {
  // ---- Configuration (propriétaire de l'espace) ----------------------------

  app.get("/config", { preHandler: [authenticate, exigerRole("ADMIN")] }, async (request) => {
    const t = await prisma.tenant.findUnique({ where: { id: request.tenantId }, select: { sso: true } });
    const { secret, ...reste } = t?.sso || {};
    return { config: t?.sso ? { ...reste, secretDefini: !!secret } : null, urlRetour: urlRetour(request) };
  });

  app.put("/config", { preHandler: [authenticate, exigerRole("OWNER")] }, async (request, reply) => {
    const { ok, erreur, valeur } = validerConfigSso(request.body);
    if (!ok) return reply.code(400).send({ error: erreur });

    // Un domaine se prouve : il doit être celui d'au moins un membre de
    // l'espace, et n'être réclamé par aucun autre. Sinon un espace pourrait
    // capter la connexion des salariés d'une autre entreprise.
    const membres = await prisma.user.findMany({ where: { tenantId: request.tenantId }, select: { email: true } });
    const domainesMembres = new Set(membres.map((m) => domaineDe(m.email)));
    const etranger = valeur.domaines.find((d) => !domainesMembres.has(d));
    if (etranger) {
      return reply.code(400).send({ error: `Aucun membre de l'espace n'a d'adresse en @${etranger} : invitez d'abord quelqu'un de ce domaine.` });
    }
    const [pris] = await prisma.$queryRaw`
      SELECT id FROM tenants
      WHERE id <> ${request.tenantId} AND sso IS NOT NULL
        AND sso->'domaines' ?| ${valeur.domaines}::text[]
      LIMIT 1`;
    if (pris) return reply.code(409).send({ error: "Un de ces domaines est déjà utilisé par un autre espace." });

    const actuel = (await prisma.tenant.findUnique({ where: { id: request.tenantId }, select: { sso: true } }))?.sso || {};
    const secretSaisi = typeof request.body?.secret === "string" ? request.body.secret.trim() : "";
    const secret = secretSaisi ? chiffrer(secretSaisi.slice(0, 500)) : actuel.secret || null;
    if (!secret) return reply.code(400).send({ error: "Secret client requis." });

    // Le fournisseur doit répondre avant qu'on enregistre : une faute de
    // frappe dans l'émetteur se voit ici, pas au premier salarié bloqué.
    try {
      await decouvrir(valeur.emetteur);
    } catch (err) {
      return reply.code(400).send({ error: `Fournisseur injoignable ou mal configuré : ${err.message}` });
    }

    await prisma.tenant.update({ where: { id: request.tenantId }, data: { sso: { ...valeur, secret } } });
    await journaliser(request, "espace.sso", valeur.actif ? "activée" : "désactivée", {
      emetteur: valeur.emetteur,
      domaines: valeur.domaines,
      obligatoire: valeur.obligatoire,
    });
    return { ok: true };
  });

  app.delete("/config", { preHandler: [authenticate, exigerRole("OWNER")] }, async (request) => {
    await prisma.tenant.update({ where: { id: request.tenantId }, data: { sso: Prisma.DbNull } });
    await journaliser(request, "espace.sso", "supprimée");
    return { ok: true };
  });

  // ---- Connexion -----------------------------------------------------------

  app.get("/debut", { config: LIMITE }, async (request, reply) => {
    const email = normaliserEmail(String(request.query?.email || "").slice(0, 200));
    const espace = await espacePourDomaine(domaineDe(email));
    if (!espace) return echec(reply, "Aucune authentification unique n'est configurée pour cette adresse.");
    const sso = espace.sso;
    let decouverte;
    try {
      decouverte = await decouvrir(sso.emetteur);
    } catch {
      return echec(reply, "Le fournisseur d'identité de votre entreprise ne répond pas. Réessayez plus tard.");
    }
    const verificateur = aleatoire(32);
    const nonce = aleatoire(16);
    const etat = await creerJeton("sso", espace.id, JSON.stringify({ verificateur, nonce }), 10 * 60 * 1000);
    return reply.redirect(
      urlAutorisation(decouverte, {
        clientId: sso.clientId,
        redirection: urlRetour(request),
        etat,
        nonce,
        defi: defiPkce(verificateur),
        email,
      }),
    );
  });

  app.get("/retour", { config: LIMITE }, async (request, reply) => {
    const { code, state, error, error_description: description } = request.query || {};
    if (error) return echec(reply, `Connexion refusée par le fournisseur : ${String(description || error).slice(0, 150)}`);
    const jeton = await consommerJeton("sso", String(state || ""));
    if (!jeton || typeof code !== "string" || code.length > 4000) return echec(reply, "Session de connexion expirée. Recommencez.");
    let verificateur;
    let nonce;
    try {
      ({ verificateur, nonce } = JSON.parse(jeton.cible));
    } catch {
      return echec(reply, "Session de connexion invalide. Recommencez.");
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: jeton.tenantId } });
    const sso = tenant?.sso;
    if (!sso?.actif || tenant.suspendu) return echec(reply, "L'authentification unique n'est plus active pour cet espace.");

    let identite;
    try {
      const decouverte = await decouvrir(sso.emetteur);
      const { statut, json } = await posterFormulaire(decouverte.token_endpoint, {
        grant_type: "authorization_code",
        code,
        redirect_uri: urlRetour(request),
        client_id: sso.clientId,
        client_secret: dechiffrer(sso.secret) || "",
        code_verifier: verificateur,
      });
      if (statut !== 200 || typeof json?.id_token !== "string") {
        throw new Error(json?.error_description || json?.error || `échange refusé (${statut})`);
      }
      identite = await verifierIdToken(json.id_token, { decouverte, emetteur: sso.emetteur, clientId: sso.clientId, nonce });
    } catch (err) {
      request.log.warn({ err: err?.message, tenantId: tenant.id }, "sso : échec");
      return echec(reply, `Connexion impossible : ${String(err?.message || "erreur inconnue").slice(0, 150)}`);
    }

    if (!sso.domaines.includes(domaineDe(identite.email))) {
      return echec(reply, "Cette adresse n'appartient pas aux domaines de l'espace.");
    }
    let user = await prisma.user.findUnique({ where: { email: identite.email }, include: { tenant: true } });
    if (user && user.tenantId !== tenant.id) return echec(reply, "Cette adresse est rattachée à un autre espace.");
    if (!user) {
      if (!sso.creerComptes) {
        return echec(reply, "Aucun compte pour cette adresse dans l'espace. Demandez une invitation à votre administrateur.");
      }
      // Compte créé à la première connexion. Mot de passe inutilisable :
      // ce compte n'entre que par le fournisseur d'identité.
      user = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: identite.email,
          name: identite.nom,
          passwordHash: await hashPassword(aleatoire(48)),
          role: "MEMBER",
        },
        include: { tenant: true },
      });
      await journaliserPour(request, user, "membre.creation.sso", user.email);
    }

    // La double authentification est celle du fournisseur d'identité.
    await ouvrirSession(request, reply, user, { mfa: true });
    await journaliserPour(request, user, "session.connexion.sso");
    return versShell(reply, { sso: "ok" });
  });
}

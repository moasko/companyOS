import { prisma } from "../db.js";
import { authenticate } from "../auth.js";
import { accesModule, lecturePartagee } from "../acces.js";
import { abonner } from "../evenements.js";
import { env } from "../env.js";

/// Le flux temps réel d'un navigateur (Server-Sent Events).
///
/// Une connexion HTTP qui reste ouverte et sur laquelle le serveur écrit
/// au fil de l'eau : « la fiche X de crm/clients a changé », « vous avez
/// une notification ». Plutôt qu'un WebSocket : ça traverse les proxys
/// d'entreprise comme une requête ordinaire, le cookie de session suffit,
/// et EventSource reprend tout seul après une coupure.
///
/// Ce que chacun reçoit est filtré ici, comme une lecture :
///   - rien d'un autre espace ;
///   - une notification seulement si elle est pour soi ;
///   - un changement de fiche seulement si l'on peut lire la collection.
/// Et un événement ne contient jamais la fiche elle-même : le navigateur
/// la relit par /api/records, avec ses droits.

const BATTEMENT_MS = 25_000;
/// La session est revérifiée régulièrement : une session révoquée (appareil
/// perdu, départ d'un salarié) ferme son flux sans attendre.
const CONTROLE_SESSION_MS = 2 * 60_000;
/// Les droits d'accès aux apps peuvent changer en cours de route.
const DUREE_DROITS_MS = 60_000;
const FLUX_PAR_PERSONNE = 8;

const ouverts = new Map(); // userId → nombre de flux
const fermetures = new Set();

export default async function evenementRoutes(app) {
  app.addHook("preHandler", authenticate);

  app.addHook("onClose", async () => {
    for (const fermer of fermetures) fermer();
  });

  app.get("/", async (request, reply) => {
    const user = request.user;
    const tenantId = request.tenantId;
    if ((ouverts.get(user.id) || 0) >= FLUX_PAR_PERSONNE) {
      return reply.code(429).send({ error: "Trop d'onglets ouverts en temps réel." });
    }

    // Les en-têtes CORS posés par le plugin doivent suivre : on écrit la
    // réponse à la main.
    const origine = request.headers.origin;
    const entetes = {
      ...reply.getHeaders(),
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // nginx et consorts gardent sinon la réponse en tampon.
      "x-accel-buffering": "no",
    };
    if (origine && env.corsOrigin.includes(origine)) {
      entetes["access-control-allow-origin"] = origine;
      entetes["access-control-allow-credentials"] = "true";
      entetes.vary = "Origin";
    }
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, entetes);
    ouverts.set(user.id, (ouverts.get(user.id) || 0) + 1);

    const ecrire = (texte) => {
      if (!res.writableEnded) res.write(texte);
    };
    const envoyer = (type, donnees) => ecrire(`event: ${type}\ndata: ${JSON.stringify(donnees)}\n\n`);

    // Droits de lecture par collection, gardés une minute.
    const droits = new Map();
    const peutLire = async (module, collection) => {
      const cle = `${module}/${collection}`;
      const connu = droits.get(cle);
      if (connu && Date.now() - connu.le < DUREE_DROITS_MS) return connu.ok;
      let ok = false;
      try {
        const { autorise } = await accesModule(request, module);
        ok = autorise || !!lecturePartagee({ module, collection });
      } catch {
        ok = false;
      }
      droits.set(cle, { ok, le: Date.now() });
      return ok;
    };

    const desabonner = abonner(async (evt) => {
      if (!evt || evt.t !== tenantId) return;
      if (evt.type === "notification") {
        if (evt.u === user.id) envoyer("notification", {});
        return;
      }
      if (evt.type === "cloud") {
        // Le Cloud de l'espace est commun à tous ses membres.
        envoyer("cloud", { client: evt.client });
        return;
      }
      if (evt.type === "fiche") {
        if (!(await peutLire(evt.module, evt.collection))) return;
        envoyer("fiche", {
          module: evt.module,
          collection: evt.collection,
          id: evt.id,
          action: evt.action,
          par: evt.par,
          client: evt.client,
        });
      }
    });

    let ferme = false;
    const fermer = () => {
      if (ferme) return;
      ferme = true;
      clearInterval(battement);
      clearInterval(controle);
      desabonner();
      fermetures.delete(fermer);
      const n = (ouverts.get(user.id) || 1) - 1;
      if (n > 0) ouverts.set(user.id, n);
      else ouverts.delete(user.id);
      if (!res.writableEnded) res.end();
    };
    fermetures.add(fermer);

    const battement = setInterval(() => ecrire(`: ${Date.now()}\n\n`), BATTEMENT_MS);
    const controle = setInterval(async () => {
      const s = await prisma.session
        .findUnique({ where: { id: request.session.id }, select: { revoqueLe: true, expireLe: true } })
        .catch(() => null);
      if (!s || s.revoqueLe || s.expireLe < new Date()) {
        envoyer("fin", { raison: "session" });
        fermer();
      }
    }, CONTROLE_SESSION_MS);
    battement.unref();
    controle.unref();

    request.raw.on("close", fermer);
    res.on("error", fermer);

    // Reconnexion après 5 s si la connexion tombe ; puis un premier
    // message, pour que le client sache le flux établi.
    ecrire("retry: 5000\n\n");
    envoyer("pret", { le: Date.now() });
  });
}

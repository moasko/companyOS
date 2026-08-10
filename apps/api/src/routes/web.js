// Navigateur — ce que le serveur fait pour lui.
//
// Deux besoins que la page ne peut pas satisfaire seule :
//
//   1. **Savoir avant d'essayer.** Un cadre vers un site qui refuse d'être
//      encadré donne une fenêtre blanche, sans message, sans code d'erreur
//      lisible depuis la page : le navigateur bloque justement l'accès à ce
//      qui s'y passe. Seul un appel côté serveur peut lire l'en-tête et
//      dire pourquoi.
//
//   2. **Rapporter un fichier.** Une page ne peut pas lire une adresse d'un
//      autre domaine — c'est la politique d'origine, et c'est très bien
//      ainsi. Le serveur, lui, le peut : il va chercher le fichier et
//      l'écrit dans le cloud de l'espace de travail. Un tarif fournisseur
//      trouvé sur le web finit donc dans l'Explorateur, visible des
//      collègues et décompté du quota, comme n'importe quel autre fichier.
//
// Les gardes contre les adresses internes sont dans ../web.js.

import { z } from "zod";
import { Transform } from "node:stream";
import { prisma, serialize } from "../db.js";
import { authenticate } from "../auth.js";
import { journaliser } from "../audit.js";
import { piloteEcriture } from "../storage.js";
import { typeNeutralise } from "../mimetype.js";
import { randomUUID } from "node:crypto";
import {
  ErreurWeb,
  ouvrir,
  refusDeCadre,
  nomDeFichier,
} from "../web.js";
import { HTML_MAX, decoder, preparer } from "../lecture.js";

const urlSchema = z.object({ url: z.string().min(1).max(2048) });
const telechargementSchema = urlSchema.extend({
  parentId: z.string().nullable().optional(),
});

/// De quoi lire un titre de page sans avaler le document entier.
const APERCU_MAX = 64 * 1024;

/// Le plafond des routes qui font sortir une requête du serveur.
///
/// Ces routes-là font émettre au serveur une connexion vers une adresse
/// choisie par l'appelant. Les gardes anti-SSRF de `web.js` interdisent les
/// adresses privées, mais rien n'empêchait de balayer les ports d'une
/// machine publique un par un — le code d'erreur renvoyé distingue
/// « connexion refusée » de « délai dépassé » — ni de retenir des
/// connexions sortantes en série. Trente par minute suffisent largement à
/// l'usage normal du Navigateur.
const LIMITE_SORTANTE = { rateLimit: { max: 30, timeWindow: "1 minute" } };

/// Plafond par téléchargement, indépendamment du quota. Il protège d'un
/// serveur distant qui annonce 2 Ko et en envoie 20 Go.
const FICHIER_MAX = 512 * 1024 * 1024;

/// Interrompt un flux dès qu'il dépasse la limite, au lieu de découvrir le
/// dépassement une fois le disque plein.
const plafonner = (limite, message) => {
  let vus = 0;
  return new Transform({
    transform(morceau, _encodage, suite) {
      vus += morceau.length;
      if (vus > limite) return suite(new ErreurWeb(message, 413));
      suite(null, morceau);
    },
  });
};

/// Titre de la page, quand il y en a un.
const titreDe = (html) => {
  const trouve = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!trouve) return null;
  return trouve[1]
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
};

/// Page d'erreur minimale, servie dans le cadre de lecture. Le cadre n'a
/// pas de scripts : c'est du HTML nu, et il doit rester lisible seul.
const page = (titre, message) =>
  `<!doctype html><meta charset="utf-8"><body style="font:15px/1.6 system-ui,sans-serif;padding:48px;text-align:center;color:#5f6368"><h1 style="font-size:17px;color:#202124">${titre}</h1><p>${message}</p></body>`;

/// Valide le corps de la requête et rend une erreur lisible.
///
/// Sans cela, `schema.parse` lève, Fastify traduit en 500 « Internal Server
/// Error » et renvoie le rapport Zod brut. Or une adresse mal formée est
/// une faute de l'appelant, pas une panne du serveur : c'est 400, et le
/// message doit se lire.
const lire = (schema, corps, reply) => {
  const resultat = schema.safeParse(corps);
  if (resultat.success) return resultat.data;
  reply.code(400).send({ error: "Adresse manquante ou trop longue." });
  return null;
};

/// Un nom qui ne heurte rien dans le dossier visé.
///
/// Deux tarifs téléchargés le même jour s'appellent tous deux
/// « tarifs.pdf ». Échouer là-dessus serait absurde : on numérote, comme
/// tout explorateur de fichiers. C'est le serveur qui s'en charge parce
/// que c'est lui qui choisit le nom, à partir des en-têtes.
const nomLibre = async (tenantId, parentId, souhaite) => {
  const voisins = await prisma.fsNode.findMany({
    where: { tenantId, parentId, deletedAt: null },
    select: { name: true },
  });
  const pris = new Set(voisins.map((n) => n.name));
  if (!pris.has(souhaite)) return souhaite;

  const point = souhaite.lastIndexOf(".");
  const base = point > 0 ? souhaite.slice(0, point) : souhaite;
  const ext = point > 0 ? souhaite.slice(point) : "";

  let i = 2;
  while (pris.has(`${base} (${i})${ext}`)) i += 1;
  return `${base} (${i})${ext}`;
};

/// Traduit une ErreurWeb en réponse, et laisse tout le reste remonter :
/// une panne de notre côté ne doit pas se déguiser en « adresse invalide ».
const repondreErreur = (reply, err) => {
  if (err instanceof ErreurWeb) {
    return reply.code(err.code).send({ error: err.message });
  }
  throw err;
};

// ---------------------------------------------------------------------------
// Jetons de vue de lecture
// ---------------------------------------------------------------------------
//
// Un cadre ne sait pas envoyer d'en-tête `Authorization` : c'est le
// navigateur qui émet la requête. L'autorisation doit donc être dans
// l'adresse — et surtout pas le jeton de session, qui traînerait alors
// dans l'historique et les journaux.
//
// Même choix que pour la lecture des fichiers en flux (voir files.js) :
// un jeton **opaque**, sans contenu, lié à une seule adresse et à une
// échéance. Chaque lien réécrit dans la page reçoit le sien, ce qui limite
// aussi ce qu'un jeton égaré permet : lire une page publique.

const VUE_DUREE_MS = 60 * 60 * 1000;
const vues = new Map();

const creerVue = (url, tenantId) => {
  const maintenant = Date.now();
  for (const [cle, valeur] of vues) {
    if (valeur.expire < maintenant) vues.delete(cle);
  }
  const jeton = randomUUID().replace(/-/g, "");
  vues.set(jeton, { url, tenantId, expire: maintenant + VUE_DUREE_MS });
  return jeton;
};

const lireVue = (jeton) => {
  const vue = vues.get(jeton);
  if (!vue) return null;
  if (vue.expire < Date.now()) {
    vues.delete(jeton);
    return null;
  }
  return vue;
};

export default async function webRoutes(app) {
  app.addHook("preHandler", async (request, reply) => {
    // La vue de lecture s'authentifie par son jeton d'URL : voir plus haut.
    if (request.raw.url?.startsWith("/api/web/voir/")) return;
    return authenticate(request, reply);
  });

  /// Sert une page distante depuis notre origine, pour qu'elle s'affiche
  /// dans un cadre malgré son refus. Voir ../lecture.js pour ce que cela
  /// implique — et pour ce que le client doit faire de son côté.
  app.get("/voir/:jeton", async (request, reply) => {
    const vue = lireVue(request.params.jeton);
    if (!vue) {
      return reply
        .code(410)
        .type("text/html; charset=utf-8")
        .send(page("Lien expiré", "Rechargez la page pour la consulter à nouveau."));
    }

    let resultat;
    try {
      resultat = await ouvrir(vue.url);
    } catch (err) {
      return reply
        .code(err instanceof ErreurWeb ? err.code : 502)
        .type("text/html; charset=utf-8")
        .send(page("Site injoignable", err.message));
    }

    const { reponse, url: finale } = resultat;
    const type = String(reponse.headers["content-type"] || "");

    if (!type.toLowerCase().includes("html")) {
      reponse.destroy();
      return reply
        .code(415)
        .type("text/html; charset=utf-8")
        .send(page("Pas une page", "Ce lien mène à un fichier, pas à une page à lire."));
    }

    const morceaux = [];
    let taille = 0;
    for await (const morceau of reponse) {
      morceaux.push(morceau);
      taille += morceau.length;
      if (taille >= HTML_MAX) break;
    }
    reponse.destroy();

    const html = preparer(
      decoder(Buffer.concat(morceaux), type),
      finale.href,
      (cible) => `/api/web/voir/${creerVue(cible, vue.tenantId)}`,
    );

    return (
      reply
        // Aucun en-tête du site distant n'est recopié : ni sa politique de
        // sécurité, ni ses cookies, ni son refus de cadre.
        .type("text/html; charset=utf-8")
        .header("cache-control", "no-store")
        .header("x-robots-tag", "noindex")
        // La politique de sécurité de **notre** réponse.
        //
        // Ce document est du HTML tiers servi depuis l'origine de l'API.
        // Jusqu'ici, la seule barrière était l'attribut `sandbox` du cadre
        // côté client — c'est-à-dire une décision que le serveur ne
        // contrôle pas et qu'une fenêtre échappée au bac à sable annule.
        //
        // La directive `sandbox` **en en-tête** ne peut, elle, pas être
        // retirée par le client : elle s'applique au document lui-même, où
        // qu'il soit chargé. `allow-popups` est conservé pour que les liens
        // vers l'extérieur continuent de s'ouvrir ; volontairement pas
        // `allow-popups-to-escape-sandbox`, ni `allow-same-origin`, ni
        // `allow-scripts`.
        .header(
          "content-security-policy",
          [
            "sandbox allow-popups",
            "default-src 'none'",
            "img-src https: data:",
            "style-src https: 'unsafe-inline'",
            "font-src https: data:",
            "frame-ancestors 'self'",
            "form-action 'none'",
            "base-uri 'none'",
          ].join("; "),
        )
        .header("x-content-type-options", "nosniff")
        .header("referrer-policy", "no-referrer")
        .send(html)
    );
  });

  /// Ce qu'il y a au bout de l'adresse, sans rien rapporter.
  ///
  /// Répond toujours, même pour un site en panne : c'est le Navigateur qui
  /// décide quoi montrer, et « ce site ne répond pas » est une information
  /// utile, pas une erreur de l'appel.
  app.post("/inspecter", { config: LIMITE_SORTANTE }, async (request, reply) => {
    const donnees = lire(urlSchema, request.body, reply);
    if (!donnees) return reply;
    const { url } = donnees;

    let resultat;
    try {
      resultat = await ouvrir(url);
    } catch (err) {
      return repondreErreur(reply, err);
    }

    const { reponse, url: finale } = resultat;
    const entetes = reponse.headers;
    const type = String(entetes["content-type"] || "").split(";")[0].trim();
    const estPage = type.startsWith("text/html") || type === "application/xhtml+xml";

    let titre = null;
    if (estPage && reponse.statusCode < 400) {
      // Lecture du début seulement : le titre est dans l'en-tête du
      // document, inutile de télécharger la page pour l'obtenir.
      const morceaux = [];
      let taille = 0;
      for await (const morceau of reponse) {
        morceaux.push(morceau);
        taille += morceau.length;
        if (taille >= APERCU_MAX) break;
      }
      reponse.destroy();
      titre = titreDe(Buffer.concat(morceaux).toString("utf8"));
    } else {
      reponse.destroy();
    }

    const longueur = Number(entetes["content-length"]);
    const refus = refusDeCadre(entetes);

    return {
      url: finale.href,
      statut: reponse.statusCode,
      type: type || null,
      taille: Number.isFinite(longueur) ? longueur : null,
      nom: nomDeFichier(finale, entetes),
      titre,
      // Une page peut s'afficher dans le Navigateur ; un fichier se
      // télécharge. Le distinguer ici évite d'ouvrir un PDF dans un cadre
      // qui ne saura pas quoi en faire.
      estPage,
      cadrable: estPage && !refus && reponse.statusCode < 400,
      raison: refus,
      // Un jeton de vue de lecture accompagne toute page refusée : le
      // client peut l'afficher sans un aller-retour de plus.
      vue:
        estPage && refus && reponse.statusCode < 400
          ? `/api/web/voir/${creerVue(finale.href, request.tenantId)}`
          : null,
    };
  });

  /// Rapporte le contenu d'une adresse dans le cloud de l'espace.
  app.post("/telecharger", { config: LIMITE_SORTANTE }, async (request, reply) => {
    const donnees = lire(telechargementSchema, request.body, reply);
    if (!donnees) return reply;
    const { url, parentId } = donnees;

    if (parentId) {
      const parent = await prisma.fsNode.findFirst({
        where: { id: parentId, tenantId: request.tenantId, deletedAt: null },
      });
      if (!parent || parent.type !== "FOLDER") {
        return reply.code(404).send({ error: "Dossier de destination introuvable" });
      }
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: request.tenantId },
    });
    if (tenant.usedBytes >= tenant.quota) {
      return reply.code(413).send({ error: "Quota de stockage atteint" });
    }

    let resultat;
    try {
      resultat = await ouvrir(url);
    } catch (err) {
      return repondreErreur(reply, err);
    }

    const { reponse, url: finale } = resultat;

    if (reponse.statusCode >= 400) {
      reponse.destroy();
      return reply
        .code(502)
        .send({ error: `Le site a répondu ${reponse.statusCode}.` });
    }

    // Refuser tout de suite ce qui ne tiendra pas, plutôt qu'après avoir
    // fait transiter des centaines de mégaoctets.
    const annoncee = Number(reponse.headers["content-length"]);
    const restant = Number(tenant.quota - tenant.usedBytes);
    if (Number.isFinite(annoncee) && annoncee > Math.min(restant, FICHIER_MAX)) {
      reponse.destroy();
      return reply.code(413).send({
        error: "Ce fichier dépasse l'espace disponible dans votre cloud.",
      });
    }

    const nom = await nomLibre(
      request.tenantId,
      parentId || null,
      nomDeFichier(finale, reponse.headers),
    );
    const pilote = await piloteEcriture(request.tenantId);
    const cle = pilote.buildKey(request.tenantId, nom);

    let taille;
    try {
      taille = await pilote.put(
        cle,
        reponse.pipe(
          plafonner(
            Math.min(restant, FICHIER_MAX),
            "Ce fichier dépasse l'espace disponible dans votre cloud.",
          ),
        ),
      );
    } catch (err) {
      reponse.destroy();
      await pilote.remove(cle);
      return repondreErreur(reply, err);
    }

    try {
      const node = await prisma.$transaction(async (tx) => {
        const cree = await tx.fsNode.create({
          data: {
            tenantId: request.tenantId,
            ownerId: request.user.id,
            parentId: parentId || null,
            name: nom,
            type: "FILE",
            size: BigInt(taille),
            // Ce type vient du serveur distant, choisi par l'utilisateur :
            // un serveur complice répondrait « text/html » pour déposer une
            // page exécutable dans le cloud de l'espace, visible de tous
            // les collègues. Voir src/mimetype.js.
            mimeType: typeNeutralise(reponse.headers["content-type"]),
            storageKey: cle,
            storage: pilote.nom,
          },
        });

        await tx.tenant.update({
          where: { id: request.tenantId },
          data: { usedBytes: { increment: BigInt(taille) } },
        });

        return cree;
      });

      // L'origine est journalisée : un fichier venu du web n'a pas la même
      // confiance qu'un fichier déposé par un collègue, et six mois plus
      // tard c'est la seule façon de savoir d'où il vient.
      await journaliser(request, "fichier.telechargement", node.name, {
        source: finale.href,
        octets: taille,
      });

      return reply.code(201).send(serialize(node));
    } catch (err) {
      await pilote.remove(cle);
      if (err.code === "P2002") {
        // Le nom est déjà pris ici. Le client réessaiera avec un autre :
        // c'est lui qui sait comment il numérote les doublons.
        return reply
          .code(409)
          .send({ error: "Un fichier porte déjà ce nom ici" });
      }
      throw err;
    }
  });
}

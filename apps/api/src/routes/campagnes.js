// Campagnes — les routes.
//
// Publiques, parce qu'elles servent des gens sans compte CompanyOS :
// pixel d'ouverture, redirection des clics, logo et images des messages,
// désinscription, formulaire d'inscription. Leur sécurité tient aux
// jetons signés (voir ../campagnes.js) — impossibles à forger sans le
// secret du serveur, et qui ne désignent qu'une seule fiche.
//
// Authentifiées (administrateurs) : l'e-mail de test, la pause et la
// reprise d'un envoi, l'adresse du formulaire.

import { prisma } from "../db.js";
import { authenticate, exigerRole } from "../auth.js";
import { env } from "../env.js";
import { creerTransporteur, creerTransporteurEspace, envoyerVia } from "../mail.js";
import { piloteLecture } from "../storage.js";
import { compterEnvois, peutEnvoyer } from "../quota-mail.js";
import { adresseValide } from "@companyos/shared/courrier";
import {
  envoyerTest,
  ficheEntreprise,
  jetonConfirmation,
  marquerDestinataire,
  signatureEgale,
  signatureFormulaire,
  signatureImage,
  signatureLogo,
  urlFormulaire,
  urlLienDe,
  verifierConfirmation,
  verifierJeton,
} from "../campagnes.js";

// Un GIF d'un pixel transparent — le plus petit accusé de lecture du
// monde, celui que tous les outils d'emailing utilisent.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const echapper = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/// La langue du visiteur : anglais si son navigateur le préfère, français
/// sinon.
const langueDe = (request) => (/^en\b/i.test(String(request.headers["accept-language"] || "")) ? "en" : "fr");

const T = {
  fr: {
    invalide: ["Lien invalide", "Ce lien est incomplet ou périmé."],
    expire: ["Lien expiré", "Cette campagne n'existe plus."],
    note: ["C'est noté", "Vous ne recevrez plus ces messages."],
    desaboDemande: ["Se désinscrire", "Confirmez que vous ne souhaitez plus recevoir les campagnes de cet expéditeur."],
    desaboBouton: "Me désinscrire",
    confirmeDemande: ["Confirmer l'inscription", "Un clic pour confirmer que vous souhaitez recevoir nos actualités."],
    confirmeBouton: "Confirmer",
    desabo: ["Désinscription confirmée", "Vous ne recevrez plus de campagnes de cet expéditeur. Les messages liés à vos commandes et factures, eux, continuent de vous parvenir."],
    inscription: "Recevoir nos actualités",
    inscriptionAide: "Nouveautés, offres et conseils — quelques messages par mois. Désinscription en un clic.",
    nom: "Votre nom",
    entreprise: "Entreprise (facultatif)",
    email: "Adresse e-mail",
    accord: "J'accepte de recevoir les e-mails de",
    envoyer: "M'inscrire",
    merci: ["Vérifiez votre boîte", "Un e-mail de confirmation vient de partir. Cliquez sur le lien qu'il contient pour finaliser votre inscription."],
    erreur: ["Inscription impossible", "Vérifiez l'adresse e-mail et cochez la case d'accord."],
    confirme: ["Inscription confirmée", "Merci ! Vous recevrez désormais nos actualités."],
    sujetConfirmation: "Confirmez votre inscription",
    texteConfirmation: "Bonjour,\n\nPour confirmer votre inscription aux actualités de {e}, ouvrez ce lien :\n{l}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : rien ne vous sera envoyé.",
  },
  en: {
    invalide: ["Invalid link", "This link is incomplete or expired."],
    expire: ["Link expired", "This campaign no longer exists."],
    note: ["Done", "You will no longer receive these emails."],
    desaboDemande: ["Unsubscribe", "Confirm that you no longer want to receive campaigns from this sender."],
    desaboBouton: "Unsubscribe me",
    confirmeDemande: ["Confirm your subscription", "One click to confirm you want to receive our news."],
    confirmeBouton: "Confirm",
    desabo: ["Unsubscribed", "You will no longer receive campaigns from this sender. Emails about your orders and invoices will still reach you."],
    inscription: "Get our news",
    inscriptionAide: "News, offers and tips — a few emails a month. Unsubscribe in one click.",
    nom: "Your name",
    entreprise: "Company (optional)",
    email: "Email address",
    accord: "I agree to receive emails from",
    envoyer: "Subscribe",
    merci: ["Check your inbox", "A confirmation email is on its way. Click the link inside to complete your subscription."],
    erreur: ["Subscription failed", "Check the email address and tick the consent box."],
    confirme: ["Subscription confirmed", "Thank you! You will now receive our news."],
    sujetConfirmation: "Confirm your subscription",
    texteConfirmation: "Hello,\n\nTo confirm your subscription to {e}'s news, open this link:\n{l}\n\nIf you did not request this, ignore this email: nothing will be sent to you.",
  },
};

const STYLE = `body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:90vh;margin:0;background:#f7f8fa;color:#1f2733}
main{box-sizing:border-box;width:min(440px,92vw);padding:36px;background:#fff;border:1px solid #e3e6eb;border-radius:14px}
h1{font-size:1.2em;margin:0 0 8px}p{color:#6b7684;font-size:.92em;line-height:1.6}
form{display:flex;flex-direction:column;gap:12px;margin-top:18px}label{display:flex;flex-direction:column;gap:5px;font-size:.88em;font-weight:600}
input[type=text],input[type=email]{height:40px;padding:0 12px;border:1px solid #d5d9df;border-radius:9px;font:inherit}
.accord{flex-direction:row;align-items:flex-start;gap:8px;font-weight:400;color:#4b5563}.accord input{margin-top:3px}
button{height:44px;border:0;border-radius:10px;background:#c2410c;color:#fff;font:inherit;font-weight:700;cursor:pointer}
.piege{position:absolute;left:-5000px}`;

/// Une page simple, sans script : `default-src 'none'` interdit tout ce
/// qui n'est pas ce HTML et sa feuille de style.
const page = (reply, langue, [titre, corps], contenu = "", { integrable = false } = {}) => {
  // Le formulaire d'inscription s'intègre au site de l'entreprise (iframe) :
  // pour lui seul, on retire l'interdiction d'encadrement posée par helmet.
  if (integrable) reply.removeHeader("x-frame-options");
  return reply
    .type("text/html; charset=utf-8")
    .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors " + (integrable ? "*" : "'none'"))
    .send(`<!doctype html><html lang="${langue}"><head><meta charset="utf-8"><title>${echapper(titre)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>${STYLE}</style></head>
<body><main><h1>${echapper(titre)}</h1><p>${echapper(corps)}</p>${contenu}</main></body></html>`);
};

/// Fiches nouvelles qu'un formulaire public peut créer par heure, toutes
/// IP confondues.
const INSCRIPTIONS_PAR_HEURE = 60;

const LIMITE_FORMULAIRE = { rateLimit: { max: 6, timeWindow: "1 hour", keyGenerator: (request) => request.ip } };

/// Le compte qui « saisit » une fiche créée par le formulaire public : le
/// propriétaire de l'espace (une fiche a toujours un auteur).
const auteurDeLEspace = async (tenantId) =>
  (await prisma.user.findFirst({ where: { tenantId, role: "OWNER" }, orderBy: { createdAt: "asc" } }))
  || (await prisma.user.findFirst({ where: { tenantId }, orderBy: { createdAt: "asc" } }));

export default async function campagnesRoutes(app) {
  // Le formulaire d'inscription poste en `application/x-www-form-urlencoded`,
  // que Fastify ne lit pas d'origine — dans ce module seulement.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 4096 }, (_req, corps, fait) => {
    try {
      fait(null, Object.fromEntries(new URLSearchParams(corps)));
    } catch (e) {
      fait(e);
    }
  });

  /// Le logo de l'espace, pour l'en-tête des messages.
  app.get("/logo", async (request, reply) => {
    const { e, s: sig } = request.query || {};
    if (!e || !signatureEgale(sig, signatureLogo(String(e)))) return reply.code(404).send();
    const logo = String((await ficheEntreprise(String(e))).logo || "");
    const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(logo);
    if (!m) return reply.code(404).send();
    reply.type(m[1]).header("Cache-Control", "public, max-age=86400").send(Buffer.from(m[2], "base64"));
  });

  /// Une image du Cloud posée dans un message — celle-là seule, et
  /// seulement si c'est une image.
  app.get("/image", async (request, reply) => {
    const { e, f, s: sig } = request.query || {};
    if (!e || !f || !signatureEgale(sig, signatureImage(String(e), String(f)))) return reply.code(404).send();
    const node = await prisma.fsNode.findFirst({ where: { id: String(f), tenantId: String(e), deletedAt: null, type: "FILE" } });
    if (!node?.storageKey || !/^image\/(png|jpeg|gif|webp)$/.test(node.mimeType || "")) return reply.code(404).send();
    return reply
      .type(node.mimeType)
      .header("Cache-Control", "public, max-age=604800")
      .header("X-Content-Type-Options", "nosniff")
      .send((await piloteLecture(node.storage, String(e))).read(node.storageKey));
  });

  /// Le pixel d'ouverture. Toujours répondre l'image, jeton valide ou
  /// non : un pixel qui casse, c'est une image cassée chez le client.
  app.get("/ouverture", async (request, reply) => {
    const infos = verifierJeton(request.query?.jeton || "");
    if (infos) await marquerDestinataire(infos, "ouvert").catch(() => {});
    reply.type("image/gif").header("Cache-Control", "no-store, must-revalidate").send(PIXEL);
  });

  /// Un clic : on marque (avec le numéro du lien), puis on redirige vers
  /// l'adresse relue dans la campagne — jamais prise dans la requête.
  app.get("/clic", async (request, reply) => {
    const langue = langueDe(request);
    const infos = verifierJeton(request.query?.jeton || "");
    if (!infos) return page(reply.code(400), langue, T[langue].invalide);
    const i = Number.parseInt(request.query?.l ?? "0", 10);
    const lien = Number.isInteger(i) ? i : 0;
    await marquerDestinataire(infos, "ouvert").catch(() => {});
    await marquerDestinataire(infos, "clique", { lien }).catch(() => {});
    const url = await urlLienDe(infos, lien);
    if (!url) return page(reply, langue, T[langue].expire);
    return reply.redirect(url, 302);
  });

  const desinscrire = async (infos) => {
    const client = await prisma.record.findFirst({
      where: { id: infos.clientId, tenantId: infos.tenantId, module: "crm", collection: "clients" },
    });
    if (client && !client.data.emailDesinscrit) {
      await prisma.record.update({
        where: { id: client.id },
        data: { data: { ...client.data, emailDesinscrit: true, emailDesinscritLe: new Date().toISOString() } },
      });
    }
    await marquerDestinataire(infos, "desinscrit").catch(() => {});
    return Boolean(client);
  };

  /// Le lien du message n'agit pas : il affiche un bouton. Les passerelles
  /// de sécurité (Safe Links, antivirus) ouvrent chaque lien d'un courriel
  /// reçu — un GET qui désinscrit désinscrivait donc, en silence et pour
  /// de bon, des contacts qui n'avaient rien demandé.
  app.get("/desinscription", async (request, reply) => {
    const langue = langueDe(request);
    const jeton = String(request.query?.jeton || "");
    if (!verifierJeton(jeton)) return page(reply.code(400), langue, T[langue].invalide);
    const t = T[langue];
    return page(reply, langue, t.desaboDemande, `
<form method="post" action="desinscription?jeton=${encodeURIComponent(jeton)}&amp;page=1">
  <button type="submit">${t.desaboBouton}</button>
</form>`);
  });

  /// RFC 8058 : le bouton « Se désinscrire » de Gmail et d'Outlook poste
  /// ici, sans que la personne ouvre le message. Le formulaire de la page
  /// ci-dessus aussi (`page=1`), qui attend une page en retour.
  app.post("/desinscription", async (request, reply) => {
    const langue = langueDe(request);
    const infos = verifierJeton(request.query?.jeton || "");
    const enPage = request.query?.page === "1";
    if (!infos) {
      return enPage
        ? page(reply.code(400), langue, T[langue].invalide)
        : reply.code(400).send({ error: "Jeton invalide" });
    }
    const trouve = await desinscrire(infos);
    if (enPage) return page(reply, langue, trouve ? T[langue].desabo : T[langue].note);
    return reply.send({ ok: true });
  });

  // ---- Formulaire d'inscription (double opt-in) ------------------------------

  app.get("/inscription", async (request, reply) => {
    const langue = langueDe(request);
    const { e, s: sig } = request.query || {};
    if (!e || !signatureEgale(sig, signatureFormulaire(String(e)))) return page(reply.code(404), langue, T[langue].invalide);
    const entreprise = await ficheEntreprise(String(e));
    const tenant = await prisma.tenant.findUnique({ where: { id: String(e) } });
    const nom = entreprise.nom || tenant?.name || "";
    const t = T[langue];
    return page(reply, langue, [t.inscription, `${nom} — ${t.inscriptionAide}`], `
<form method="post" action="inscription?e=${encodeURIComponent(e)}&amp;s=${encodeURIComponent(sig)}">
  <label>${t.nom}<input type="text" name="nom" maxlength="120" autocomplete="name"></label>
  <label>${t.entreprise}<input type="text" name="entreprise" maxlength="120" autocomplete="organization"></label>
  <label>${t.email}<input type="email" name="email" required maxlength="200" autocomplete="email"></label>
  <label class="piege" aria-hidden="true">Site<input type="text" name="site" tabindex="-1" autocomplete="off"></label>
  <label class="accord"><input type="checkbox" name="accord" value="1" required><span>${t.accord} ${echapper(nom)}.</span></label>
  <button type="submit">${t.envoyer}</button>
</form>`, { integrable: true });
  });

  app.post("/inscription", { config: LIMITE_FORMULAIRE }, async (request, reply) => {
    const langue = langueDe(request);
    const t = T[langue];
    const { e, s: sig } = request.query || {};
    if (!e || !signatureEgale(sig, signatureFormulaire(String(e)))) return page(reply.code(404), langue, t.invalide);
    const corps = request.body || {};
    // Le champ piège : invisible pour un humain, rempli par les robots. On
    // leur répond comme à tout le monde, sans rien enregistrer.
    if (corps.site) return page(reply, langue, t.merci, "", { integrable: true });
    const email = String(corps.email || "").trim().toLowerCase();
    if (!adresseValide(email) || corps.accord !== "1") return page(reply.code(400), langue, t.erreur, "", { integrable: true });
    const tenantId = String(e);

    // Recherche par l'index JSON plutôt que charger tout le CRM à chaque
    // envoi anonyme du formulaire.
    const [trouvee] = await prisma.$queryRaw`
      SELECT id FROM records
      WHERE "tenantId" = ${tenantId} AND module = 'crm' AND collection = 'clients'
        AND lower(trim(data->>'email')) = ${email}
      ORDER BY "createdAt" ASC LIMIT 1`;
    let fiche = trouvee ? await prisma.record.findUnique({ where: { id: trouvee.id } }) : null;
    const consentement = { source: "formulaire", le: new Date().toISOString() };

    // Une demande par adresse et par jour : sans cela, le formulaire
    // servait à bombarder une boîte de courriels de confirmation.
    const derniere = Date.parse(fiche?.data?.consentementDemande?.le || "");
    if (fiche && Date.now() - derniere < 24 * 3600 * 1000) {
      return page(reply, langue, t.merci, "", { integrable: true });
    }
    // Les confirmations comptent dans le plafond d'envoi de l'espace, comme
    // tout courriel qu'il fait partir.
    if (!(await peutEnvoyer(tenantId, 1))) {
      return page(reply, langue, t.merci, "", { integrable: true });
    }
    if (!fiche) {
      // Plafond de fiches créées par le formulaire, par espace et par
      // heure : changer d'IP ne permet pas de remplir un CRM de déchets.
      const [{ n }] = await prisma.$queryRaw`
        SELECT count(*)::int AS n FROM records
        WHERE "tenantId" = ${tenantId} AND module = 'crm' AND collection = 'clients'
          AND data->>'source' = 'formulaire' AND "createdAt" > now() - interval '1 hour'`;
      if (n >= INSCRIPTIONS_PAR_HEURE) return page(reply, langue, t.merci, "", { integrable: true });
      const auteur = await auteurDeLEspace(tenantId);
      if (!auteur) return page(reply.code(404), langue, t.invalide);
      fiche = await prisma.record.create({
        data: {
          tenantId,
          userId: auteur.id,
          module: "crm",
          collection: "clients",
          data: {
            statut: "prospect",
            nom: String(corps.nom || "").slice(0, 120) || email,
            entreprise: String(corps.entreprise || "").slice(0, 120),
            email,
            etiquettes: ["formulaire"],
            source: "formulaire",
            emailAConfirmer: true,
            consentementDemande: consentement,
          },
        },
      });
    } else if (!fiche.data.emailDesinscrit && !fiche.data.consentement) {
      // Une fiche existante : on demande la confirmation, on n'écrase rien.
      await prisma.record.update({ where: { id: fiche.id }, data: { data: { ...fiche.data, consentementDemande: consentement } } });
    } else {
      // Déjà inscrit, ou désinscrit : la même réponse, pour ne rien
      // révéler de la fiche à qui tape une adresse au hasard.
      return page(reply, langue, t.merci, "", { integrable: true });
    }

    // La confirmation est un message transactionnel, à une seule personne :
    // le relais de l'espace s'il existe, celui de la plateforme sinon.
    const entreprise = await ficheEntreprise(tenantId);
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    // Par le relais de la plateforme, le nom de l'espace part sous notre
    // signature : on en retire tout ce qui ressemble à une adresse, pour
    // qu'il ne serve pas de support d'hameçonnage.
    const nomEntreprise = String(entreprise.nom || tenant?.name || "")
      .replace(/\b(?:https?:\/\/|www\.)\S*/gi, "")
      .replace(/\b[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi, "")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, 80);
    const lien = `${env.apiPublique || `http://localhost:${env.port}`}/api/campagnes/inscription/confirmer?jeton=${jetonConfirmation(tenantId, fiche.id)}`;
    const appCourrier = await prisma.app.findFirst({ where: { slug: "courrier", tenantId: null } });
    const installation = appCourrier ? await prisma.installation.findUnique({ where: { tenantId_appId: { tenantId, appId: appCourrier.id } } }) : null;
    const smtp = installation?.settings?.smtp;
    const transport = smtp?.host ? creerTransporteurEspace(smtp) : creerTransporteur({ host: env.smtpHost, port: env.smtpPort, user: env.smtpUser, pass: env.smtpPass });
    const envoi = await envoyerVia(transport, {
      de: smtp?.host ? smtp.de || `${nomEntreprise} <${smtp.user}>` : env.mailFrom,
      a: email,
      sujet: `${t.sujetConfirmation} — ${nomEntreprise}`,
      texte: t.texteConfirmation.replace("{e}", nomEntreprise).replace("{l}", lien),
    });
    if (envoi.envoye) await compterEnvois(tenantId, 1);
    return page(reply, langue, t.merci, "", { integrable: true });
  });

  /// Même règle que la désinscription : le lien affiche un bouton, et
  /// seul le POST confirme. Une passerelle qui ouvre les liens ne doit pas
  /// pouvoir consentir à la place de la personne.
  app.get("/inscription/confirmer", async (request, reply) => {
    const langue = langueDe(request);
    const jeton = String(request.query?.jeton || "");
    if (!verifierConfirmation(jeton)) return page(reply.code(400), langue, T[langue].invalide);
    const t = T[langue];
    return page(reply, langue, t.confirmeDemande, `
<form method="post" action="confirmer?jeton=${encodeURIComponent(jeton)}">
  <button type="submit">${t.confirmeBouton}</button>
</form>`);
  });

  app.post("/inscription/confirmer", async (request, reply) => {
    const langue = langueDe(request);
    const infos = verifierConfirmation(request.query?.jeton || "");
    if (!infos) return page(reply.code(400), langue, T[langue].invalide);
    const fiche = await prisma.record.findFirst({ where: { id: infos.clientId, tenantId: infos.tenantId, module: "crm", collection: "clients" } });
    if (fiche && !fiche.data.emailDesinscrit) {
      const { emailAConfirmer: _attente, consentementDemande, ...reste } = fiche.data;
      await prisma.record.update({
        where: { id: fiche.id },
        data: { data: { ...reste, consentement: { ...(consentementDemande || { source: "formulaire" }), confirmeLe: new Date().toISOString() } } },
      });
    }
    return page(reply, langue, T[langue].confirme);
  });

  // ---- Routes de l'équipe ------------------------------------------------------

  await app.register(async (prive) => {
    prive.addHook("preHandler", authenticate);

    /// L'adresse publique du formulaire d'inscription de l'espace.
    prive.get("/formulaire", async (request) => ({ url: urlFormulaire(request.tenantId) }));

    /// Le vrai rendu, aux membres de l'équipe seulement.
    prive.post("/test", { preHandler: exigerRole("ADMIN"), config: { rateLimit: { max: 20, timeWindow: "10 minutes" } }, bodyLimit: 1024 * 1024 }, async (request, reply) => {
      const { message, adresses, exemple } = request.body || {};
      if (!message || !Array.isArray(adresses) || !adresses.length) return reply.code(400).send({ error: "Message et adresses requis." });
      const r = await envoyerTest(request.tenantId, message, adresses, exemple || null);
      if (!r.envoyes) {
        return reply.code(400).send({
          error: r.erreur || "Le test ne part qu'aux adresses des membres de l'espace.",
          refusees: r.refusees,
        });
      }
      return r;
    });

    /// Pause et reprise : seul le statut change, côté serveur — l'écran
    /// n'a pas à réécrire les destinataires (et leurs ouvertures fraîches).
    const changerStatut = (de, vers) => async (request, reply) => {
      const fiche = await prisma.record.findFirst({ where: { id: request.params.id, tenantId: request.tenantId, module: "campagnes", collection: "campagnes" } });
      if (!fiche) return reply.code(404).send({ error: "Campagne introuvable" });
      if (!de.includes(fiche.data.statut)) return reply.code(409).send({ error: "Statut incompatible" });
      const r = await prisma.record.update({ where: { id: fiche.id }, data: { data: { ...fiche.data, statut: vers }, updatedById: request.user.id } });
      return { id: r.id, statut: vers };
    };
    prive.post("/:id/pause", { preHandler: exigerRole("ADMIN") }, changerStatut(["envoi", "programmee"], "pause"));
    prive.post("/:id/reprendre", { preHandler: exigerRole("ADMIN") }, changerStatut(["pause"], "envoi"));
  });
}

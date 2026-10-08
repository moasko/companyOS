// Campagnes — la seule route qui doit être publique : la désinscription.
//
// Le lien arrive dans la boîte d'un client qui n'a aucun compte
// CompanyOS : pas d'authentification possible, et il n'en faut pas. La
// sécurité tient au jeton signé (voir ../campagnes.js) — impossible à
// forger sans le secret du serveur, et il ne désigne qu'une seule fiche.

import { prisma } from "../db.js";
import { ficheEntreprise, marquerDestinataire, signatureLogo, urlCtaDe, verifierJeton } from "../campagnes.js";

// Un GIF d'un pixel transparent — le plus petit accusé de lecture du
// monde, celui que tous les outils d'emailing utilisent.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const page = (titre, corps) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${titre}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:90vh;margin:0;background:#f7f8fa;color:#1f2733}
main{max-width:420px;padding:40px;background:#fff;border:1px solid #e3e6eb;border-radius:14px;text-align:center}
h1{font-size:1.15em}p{color:#6b7684;font-size:.92em;line-height:1.6}</style></head>
<body><main><h1>${titre}</h1><p>${corps}</p></main></body></html>`;

export default async function campagnesRoutes(app) {
  /// Le pixel d'ouverture. Toujours répondre l'image, jeton valide ou
  /// non : un pixel qui casse, c'est une image cassée dans le mail du
  /// client.
  /// Le logo de l'espace, pour l'en-tête des messages. Signé : voir
  /// signatureLogo.
  app.get("/logo", async (request, reply) => {
    const { e, s: sig } = request.query || {};
    if (!e || sig !== signatureLogo(String(e))) return reply.code(404).send();
    const logo = String((await ficheEntreprise(String(e))).logo || "");
    const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(logo);
    if (!m) return reply.code(404).send();
    reply
      .type(m[1])
      .header("Cache-Control", "public, max-age=86400")
      .send(Buffer.from(m[2], "base64"));
  });

  app.get("/ouverture", async (request, reply) => {
    const infos = verifierJeton(request.query?.jeton || "");
    if (infos) await marquerDestinataire(infos, "ouvert").catch(() => {});
    reply
      .type("image/gif")
      .header("Cache-Control", "no-store, must-revalidate")
      .send(PIXEL);
  });

  /// Le clic sur le bouton : on marque, puis on redirige vers l'URL de la
  /// campagne — relue en base, jamais prise dans la requête.
  app.get("/clic", async (request, reply) => {
    const infos = verifierJeton(request.query?.jeton || "");
    if (!infos) {
      reply.type("text/html; charset=utf-8");
      return reply.code(400).send(page("Lien invalide", "Ce lien est incomplet ou périmé."));
    }
    await marquerDestinataire(infos, "ouvert").catch(() => {});
    await marquerDestinataire(infos, "clique").catch(() => {});
    const url = await urlCtaDe(infos);
    if (!url) {
      reply.type("text/html; charset=utf-8");
      return reply.send(page("Lien expiré", "Cette campagne n'existe plus."));
    }
    return reply.redirect(url, 302);
  });

  app.get("/desinscription", async (request, reply) => {
    const infos = verifierJeton(request.query?.jeton || "");
    reply.type("text/html; charset=utf-8");

    if (!infos) {
      return reply
        .code(400)
        .send(page("Lien invalide", "Ce lien de désinscription est incomplet ou périmé."));
    }

    const client = await prisma.record.findFirst({
      where: {
        id: infos.clientId,
        tenantId: infos.tenantId,
        module: "crm",
        collection: "clients",
      },
    });
    if (!client) {
      // La fiche a disparu : la personne ne recevra de toute façon plus
      // rien — on la rassure plutôt que de l'inquiéter avec une erreur.
      return reply.send(page("C'est noté", "Vous ne recevrez plus ces messages."));
    }

    if (!client.data.emailDesinscrit) {
      await prisma.record.update({
        where: { id: client.id },
        data: {
          data: {
            ...client.data,
            emailDesinscrit: true,
            emailDesinscritLe: new Date().toISOString(),
          },
        },
      });
    }

    // La statistique de la campagne d'origine, quand le jeton la porte.
    await marquerDestinataire(infos, "desinscrit").catch(() => {});

    return reply.send(
      page(
        "Désinscription confirmée",
        "Vous ne recevrez plus de campagnes de cet expéditeur. Les messages liés à vos commandes et factures, eux, continuent de vous parvenir.",
      ),
    );
  });
}

// Campagnes — la seule route qui doit être publique : la désinscription.
//
// Le lien arrive dans la boîte d'un client qui n'a aucun compte
// CompanyOS : pas d'authentification possible, et il n'en faut pas. La
// sécurité tient au jeton signé (voir ../campagnes.js) — impossible à
// forger sans le secret du serveur, et il ne désigne qu'une seule fiche.

import { prisma } from "../db.js";
import { verifierJeton } from "../campagnes.js";

const page = (titre, corps) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${titre}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:90vh;margin:0;background:#f7f8fa;color:#1f2733}
main{max-width:420px;padding:40px;background:#fff;border:1px solid #e3e6eb;border-radius:14px;text-align:center}
h1{font-size:1.15em}p{color:#6b7684;font-size:.92em;line-height:1.6}</style></head>
<body><main><h1>${titre}</h1><p>${corps}</p></main></body></html>`;

export default async function campagnesRoutes(app) {
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

    return reply.send(
      page(
        "Désinscription confirmée",
        "Vous ne recevrez plus de campagnes de cet expéditeur. Les messages liés à vos commandes et factures, eux, continuent de vous parvenir.",
      ),
    );
  });
}

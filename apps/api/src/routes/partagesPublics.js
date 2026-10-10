import { createHash } from "node:crypto";
import { prisma } from "../db.js";
import { verifyPassword } from "../auth.js";
import { echapperHtml } from "../mail.js";
import { piloteLecture } from "../storage.js";
import { effacerEchecs, noterEchec, verrouDe } from "../etatPartage.js";

/// Liens de partage publics : /api/public/partages/:jeton
///
/// Route **sans session** : la personne qui reçoit le lien n'a pas de
/// compte. Tout repose donc sur le jeton (24 octets aléatoires, seule son
/// empreinte est en base) et sur les limites fixées à la création :
/// expiration, mot de passe, nombre de téléchargements. Un lien révoqué,
/// expiré, épuisé, un fichier mis à la corbeille ou un espace suspendu
/// donnent la même page « lien invalide » — rien n'indique lequel.

const LIMITE = { rateLimit: { max: 30, timeWindow: "1 minute", keyGenerator: (r) => r.ip } };
const JETON = /^[A-Za-z0-9_-]{32}$/;

const tailleLisible = (octets) => {
  const n = Number(octets);
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
};

const page = (titre, corps) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${echapperHtml(titre)} · CompanyOS</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6fa;color:#1f2733;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
main{background:#fff;border:1px solid #e3e6eb;border-radius:14px;max-width:420px;width:100%;padding:28px;box-sizing:border-box;box-shadow:0 6px 24px rgb(0 0 0 / 6%)}
h1{font-size:18px;margin:0 0 6px;overflow-wrap:anywhere}p{margin:6px 0;color:#6b7684;font-size:14px;line-height:1.5}
.bouton{display:block;width:100%;box-sizing:border-box;text-align:center;margin-top:18px;padding:12px;border-radius:10px;border:0;background:#1a73e8;color:#fff;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
input{width:100%;box-sizing:border-box;margin-top:14px;padding:11px;border:1px solid #cfd5dd;border-radius:10px;font:inherit}
.erreur{color:#b3261e}.marque{margin-top:20px;font-size:12px;color:#9aa3ad;text-align:center}
@media (prefers-color-scheme:dark){body{background:#16161c;color:#e8e8ee}main{background:#22222b;border-color:#35353f}p{color:#9a9aa8}input{background:#16161c;color:#e8e8ee;border-color:#35353f}}
</style></head><body><main>${corps}<div class="marque">Partagé avec CompanyOS</div></main></body></html>`;

const invalide = (reply) =>
  envoyerPage(reply.code(404), page("Lien invalide", "<h1>Ce lien n'est plus valable</h1><p>Il a expiré, a été retiré, ou a déjà servi le nombre de fois prévu. Demandez un nouveau lien à la personne qui vous l'a envoyé.</p>"));

const envoyerPage = (reply, html) =>
  reply
    .type("text/html; charset=utf-8")
    .header("cache-control", "no-store")
    .header("referrer-policy", "no-referrer")
    .header("x-robots-tag", "noindex, nofollow")
    .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
    .send(html);

/// Le lien et son fichier, s'il est encore utilisable.
const lienValide = async (jeton) => {
  if (!JETON.test(jeton || "")) return null;
  const lien = await prisma.lienPartage.findUnique({
    where: { empreinte: createHash("sha256").update(jeton).digest("hex") },
    include: { node: true },
  });
  if (!lien || lien.revoqueLe || lien.expireLe < new Date()) return null;
  if (lien.maxTelechargements && lien.telechargements >= lien.maxTelechargements) return null;
  if (!lien.node || lien.node.deletedAt || lien.node.type !== "FILE") return null;
  const tenant = await prisma.tenant.findUnique({ where: { id: lien.tenantId }, select: { suspendu: true, partagePublic: true, name: true } });
  if (!tenant || tenant.suspendu || tenant.partagePublic === false) return null;
  return { ...lien, tenant };
};

const servir = async (request, reply, lien) => {
  // Les aperçus de lien (messageries, antivirus) font des HEAD : ils ne
  // consomment pas un lien « 1 téléchargement ».
  if (request.method === "HEAD") {
    return reply.header("Content-Type", lien.node.mimeType || "application/octet-stream").send();
  }
  // Compté avant l'envoi, et de façon atomique : un lien « 1 téléchargement »
  // ouvert deux fois en même temps ne sert qu'une fois.
  const { count } = await prisma.lienPartage.updateMany({
    where: {
      id: lien.id,
      ...(lien.maxTelechargements ? { telechargements: { lt: lien.maxTelechargements } } : {}),
    },
    data: { telechargements: { increment: 1 }, dernierAcces: new Date() },
  });
  if (!count) return invalide(reply);
  const n = lien.node;
  reply
    .header("Content-Type", n.mimeType || "application/octet-stream")
    .header("X-Content-Type-Options", "nosniff")
    .header("Referrer-Policy", "no-referrer")
    .header("Cache-Control", "no-store")
    .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(n.name)}`);
  return reply.send((await piloteLecture(n.storage, lien.tenantId)).read(n.storageKey));
};

export default async function partagesPublicsRoutes(app) {
  // Le formulaire de mot de passe arrive en urlencoded.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 4096 }, (_req, corps, fait) => {
    try {
      fait(null, Object.fromEntries(new URLSearchParams(corps)));
    } catch (err) {
      fait(err);
    }
  });

  app.get("/:jeton", { config: LIMITE }, async (request, reply) => {
    const lien = await lienValide(request.params.jeton);
    if (!lien) return invalide(reply);
    const n = lien.node;
    const infos = `<h1>${echapperHtml(n.name)}</h1>
<p>${tailleLisible(n.size)} · partagé par ${echapperHtml(lien.creeParNom || "un membre")} (${echapperHtml(lien.tenant.name)})</p>
<p>Lien valable jusqu'au ${lien.expireLe.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.</p>`;
    const action = `${encodeURIComponent(request.params.jeton)}/telecharger`;
    return envoyerPage(
      reply,
      page(
        n.name,
        lien.motDePasseHash
          ? `${infos}<form method="post" action="${action}"><input type="password" name="motDePasse" placeholder="Mot de passe" required autofocus autocomplete="off"><button class="bouton" type="submit">Télécharger</button></form>`
          : `${infos}<a class="bouton" href="${action}" rel="nofollow">Télécharger</a>`,
      ),
    );
  });

  app.get("/:jeton/telecharger", { config: LIMITE }, async (request, reply) => {
    const lien = await lienValide(request.params.jeton);
    if (!lien) return invalide(reply);
    // Protégé : le mot de passe arrive par le formulaire, jamais dans l'URL.
    if (lien.motDePasseHash) return reply.redirect(`../${encodeURIComponent(request.params.jeton)}`);
    return servir(request, reply, lien);
  });

  app.post("/:jeton/telecharger", { config: LIMITE }, async (request, reply) => {
    const lien = await lienValide(request.params.jeton);
    if (!lien) return invalide(reply);
    if (!lien.motDePasseHash) return servir(request, reply, lien);
    // Essais limités par lien, quelle que soit l'IP.
    const cle = `partage:${lien.id}`;
    const attente = await verrouDe(cle);
    const formulaire = (message) =>
      envoyerPage(
        reply.code(401),
        page(
          lien.node.name,
          `<h1>${echapperHtml(lien.node.name)}</h1><p class="erreur">${message}</p><form method="post" action=""><input type="password" name="motDePasse" placeholder="Mot de passe" required autofocus autocomplete="off"><button class="bouton" type="submit">Télécharger</button></form>`,
        ),
      );
    if (attente > 0) return formulaire(`Trop d'essais. Réessayez dans ${Math.ceil(attente / 60000)} min.`);
    const ok = await verifyPassword(String(request.body?.motDePasse || "").slice(0, 200), lien.motDePasseHash);
    if (!ok) {
      await noterEchec(cle);
      return formulaire("Mot de passe incorrect.");
    }
    await effacerEchecs(cle);
    return servir(request, reply, lien);
  });
}

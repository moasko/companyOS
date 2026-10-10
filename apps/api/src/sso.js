import { createHash, randomBytes } from "node:crypto";
import { createLocalJWKSet, jwtVerify } from "jose";
import { lireJsonExterne } from "./web.js";

/// Authentification unique (OpenID Connect) — Microsoft Entra ID, Google
/// Workspace, Okta, Keycloak, Auth0… : tout fournisseur conforme.
///
/// Flux « code d'autorisation » avec PKCE et nonce :
///   1. /api/auth/sso/debut?email=… — l'espace est trouvé par le domaine de
///      l'adresse ; on part chez le fournisseur avec un `state` à usage
///      unique (jeton en base, 10 min) qui porte le vérificateur PKCE.
///   2. /api/auth/sso/retour — le code est échangé contre un id_token, dont
///      on vérifie la signature (clés publiques du fournisseur), l'émetteur,
///      l'audience, l'expiration et le nonce. L'adresse doit être vérifiée
///      et appartenir à un domaine déclaré par l'espace.
///
/// Les appels au fournisseur passent par les gardes anti-SSRF de web.js :
/// l'émetteur est saisi par un administrateur d'espace, il ne doit pas
/// pouvoir faire interroger le réseau interne de la plateforme.

const DOMAINE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const domaineDe = (email) => String(email || "").trim().toLowerCase().split("@")[1] || "";

/// Valide la configuration saisie. Rend { ok, erreur, valeur } — sans le
/// secret, traité à part (chiffré).
export const validerConfigSso = (brute) => {
  const c = brute && typeof brute === "object" ? brute : {};
  let emetteur;
  try {
    const u = new URL(String(c.emetteur || "").trim());
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) throw new Error();
    emetteur = u.href.replace(/\/+$/, "");
  } catch {
    return { ok: false, erreur: "Émetteur : adresse https:// du fournisseur d'identité (ex. https://login.microsoftonline.com/<id>/v2.0)." };
  }
  const clientId = String(c.clientId || "").trim();
  if (!clientId || clientId.length > 200) return { ok: false, erreur: "Identifiant client requis." };
  const domaines = [...new Set((Array.isArray(c.domaines) ? c.domaines : String(c.domaines || "").split(/[\s,;]+/))
    .map((d) => String(d).trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean))];
  if (!domaines.length || domaines.length > 20 || domaines.some((d) => !DOMAINE.test(d))) {
    return { ok: false, erreur: "Domaines : au moins un nom de domaine valide (ex. entreprise.ci)." };
  }
  return {
    ok: true,
    valeur: {
      actif: c.actif !== false,
      emetteur,
      clientId,
      domaines,
      obligatoire: c.obligatoire === true,
      creerComptes: c.creerComptes === true,
    },
  };
};

// ---- PKCE, état, nonce ------------------------------------------------------

export const aleatoire = (octets = 32) => randomBytes(octets).toString("base64url");
export const defiPkce = (verificateur) => createHash("sha256").update(verificateur).digest("base64url");

export const urlAutorisation = (decouverte, { clientId, redirection, etat, nonce, defi, email }) => {
  const u = new URL(decouverte.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirection);
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", etat);
  u.searchParams.set("nonce", nonce);
  u.searchParams.set("code_challenge", defi);
  u.searchParams.set("code_challenge_method", "S256");
  if (email) u.searchParams.set("login_hint", email);
  return u.href;
};

// ---- Découverte et clés, en cache -------------------------------------------

const cache = new Map(); // url → { le, valeur }
const DUREE_CACHE_MS = 60 * 60 * 1000;

const enCache = async (cle, charger, { forcer = false } = {}) => {
  const c = cache.get(cle);
  if (!forcer && c && Date.now() - c.le < DUREE_CACHE_MS) return c.valeur;
  const valeur = await charger();
  cache.set(cle, { le: Date.now(), valeur });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return valeur;
};

/// Tests uniquement : pose une valeur dans le cache (clés publiques d'un
/// faux fournisseur) pour vérifier des jetons sans réseau.
export const amorcerCache = (cle, valeur) => cache.set(cle, { le: Date.now(), valeur });

export const decouvrir = (emetteur) =>
  enCache(`decouverte:${emetteur}`, async () => {
    const d = await lireJsonExterne(`${emetteur}/.well-known/openid-configuration`);
    for (const champ of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
      if (typeof d?.[champ] !== "string" || !d[champ].startsWith("https://")) {
        throw new Error(`Configuration OpenID incomplète (${champ}).`);
      }
    }
    // Un document qui se réclame d'un autre émetteur est refusé : il
    // permettrait de faire accepter des jetons signés ailleurs.
    if (String(d.issuer || "").replace(/\/+$/, "") !== emetteur) {
      throw new Error("L'émetteur annoncé par le fournisseur ne correspond pas à celui configuré.");
    }
    return d;
  });

const cles = (jwksUri, options) => enCache(`jwks:${jwksUri}`, () => lireJsonExterne(jwksUri), options);

/// Vérifie l'id_token et rend ses revendications utiles.
export const verifierIdToken = async (idToken, { decouverte, emetteur, clientId, nonce }) => {
  const verifier = async (forcer) =>
    jwtVerify(idToken, createLocalJWKSet(await cles(decouverte.jwks_uri, { forcer })), {
      issuer: [emetteur, `${emetteur}/`],
      audience: clientId,
      clockTolerance: 60,
      algorithms: ["RS256", "RS384", "RS512", "PS256", "ES256", "ES384", "EdDSA"],
    });
  let resultat;
  try {
    resultat = await verifier(false);
  } catch (err) {
    // Rotation de clés chez le fournisseur : on relit une fois.
    if (err?.code !== "ERR_JWKS_NO_MATCHING_KEY") throw err;
    resultat = await verifier(true);
  }
  const c = resultat.payload;
  if (c.nonce !== nonce) throw new Error("Nonce invalide.");
  const email = String(c.email || c.preferred_username || c.upn || "").trim().toLowerCase();
  if (!email.includes("@")) throw new Error("Le fournisseur n'a pas transmis d'adresse e-mail.");
  if (c.email_verified === false) throw new Error("Adresse e-mail non vérifiée chez le fournisseur.");
  return { email, nom: String(c.name || [c.given_name, c.family_name].filter(Boolean).join(" ") || email.split("@")[0]).slice(0, 80), sujet: String(c.sub || "") };
};

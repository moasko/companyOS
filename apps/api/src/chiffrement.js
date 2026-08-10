// Chiffrement des secrets de configuration.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI
//
// La clé secrète d'un compte S3 donne un accès complet au stockage de tous
// les clients. La ranger en clair dans la base, c'est offrir l'ensemble
// des fichiers du SaaS à quiconque obtient une copie de la base — une
// sauvegarde égarée, un accès en lecture mal réglé, un export de support.
//
// AES-256-GCM plutôt qu'AES-CBC : GCM **authentifie** le message en plus
// de le chiffrer. Sans cela, un attaquant ayant accès en écriture à la
// base pourrait modifier le chiffré sans qu'on s'en aperçoive, et faire
// pointer le stockage ailleurs.
//
// La clé dérive de `ENCRYPTION_KEY` si elle existe, sinon du secret JWT —
// le serveur en a forcément un. Changer ce secret rend les secrets
// existants illisibles : c'est voulu, et l'écran de configuration le
// signale plutôt que d'échouer en silence.
// ─────────────────────────────────────────────────────────────────────────

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { env } from "./env.js";

const SEL = "companyos-config-v1";

let cleCache = null;
const cle = () => {
  if (cleCache) return cleCache;
  const source = process.env.ENCRYPTION_KEY || env.jwtSecret;
  if (!source) throw new Error("Aucun secret de chiffrement configuré.");
  cleCache = scryptSync(source, SEL, 32);
  return cleCache;
};

/// Chiffre une chaîne. Rend « v1.iv.tag.chiffré », en base64url.
///
/// Le préfixe de version permet de changer d'algorithme plus tard sans
/// avoir à deviner comment un ancien secret a été produit.
export const chiffrer = (clair) => {
  if (clair === null || clair === undefined || clair === "") return null;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cle(), iv);
  const chiffre = Buffer.concat([c.update(String(clair), "utf8"), c.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    c.getAuthTag().toString("base64url"),
    chiffre.toString("base64url"),
  ].join(".");
};

/// Déchiffre. Rend `null` si le secret est illisible — clé changée,
/// donnée tronquée, altération. L'appelant doit traiter ce cas comme
/// « non configuré » plutôt que de laisser remonter une exception.
export const dechiffrer = (paquet) => {
  if (!paquet) return null;
  try {
    const [version, iv, tag, chiffre] = String(paquet).split(".");
    if (version !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", cle(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(chiffre, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
};

/// Ce qu'on montre d'un secret sans le révéler : les quatre derniers
/// caractères suffisent à reconnaître la bonne clé sans permettre de la
/// reconstituer.
export const masquer = (secret) =>
  !secret ? null : `••••••••${String(secret).slice(-4)}`;

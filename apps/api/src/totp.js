// Double authentification par code à usage unique (TOTP, RFC 6238).
//
// Compatible avec toutes les applications d'authentification (Google
// Authenticator, Microsoft Authenticator, 1Password, Authy…) : HMAC-SHA1,
// pas de 30 secondes, 6 chiffres — les paramètres que toutes acceptent.
//
// Écrit ici plutôt que tiré d'une bibliothèque : une cinquantaine de lignes
// sur `node:crypto`, et une dépendance de moins sur le chemin de connexion.

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const PAS_SECONDES = 30;

export const base32 = (octets) => {
  let bits = 0;
  let valeur = 0;
  let sortie = "";
  for (const o of octets) {
    valeur = (valeur << 8) | o;
    bits += 8;
    while (bits >= 5) {
      sortie += ALPHABET[(valeur >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) sortie += ALPHABET[(valeur << (5 - bits)) & 31];
  return sortie;
};

export const depuisBase32 = (texte) => {
  const propre = String(texte).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let valeur = 0;
  const octets = [];
  for (const c of propre) {
    valeur = (valeur << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      octets.push((valeur >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(octets);
};

/// Un secret neuf : 160 bits, la taille recommandée pour HMAC-SHA1.
export const nouveauSecret = () => base32(randomBytes(20));

/// Le pas de temps courant (nombre de périodes de 30 s depuis 1970).
export const pasCourant = (maintenant = Date.now()) => Math.floor(maintenant / 1000 / PAS_SECONDES);

/// Le code d'un pas donné.
export const codeDuPas = (secret, pas) => {
  const compteur = Buffer.alloc(8);
  compteur.writeBigUInt64BE(BigInt(pas));
  const h = createHmac("sha1", depuisBase32(secret)).update(compteur).digest();
  const decalage = h[h.length - 1] & 0xf;
  const n = (h.readUInt32BE(decalage) & 0x7fffffff) % 1_000_000;
  return String(n).padStart(6, "0");
};

const egal = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/// Vérifie un code. Tolère un pas d'écart de part et d'autre (horloge du
/// téléphone un peu décalée). Refuse un pas déjà utilisé ou antérieur :
/// un code intercepté ne se rejoue pas.
///
/// Rend le pas accepté (à mémoriser), ou `null`.
export const verifierCode = (secret, code, { dernierPas = null, maintenant = Date.now() } = {}) => {
  const saisi = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(saisi)) return null;
  const courant = pasCourant(maintenant);
  for (const pas of [courant - 1, courant, courant + 1]) {
    if (dernierPas !== null && pas <= dernierPas) continue;
    if (egal(codeDuPas(secret, pas), saisi)) return pas;
  }
  return null;
};

/// L'adresse `otpauth://` que lisent les applications (via le QR code).
export const uriOtpauth = ({ secret, compte, emetteur = "CompanyOS" }) =>
  `otpauth://totp/${encodeURIComponent(`${emetteur}:${compte}`)}?secret=${secret}` +
  `&issuer=${encodeURIComponent(emetteur)}&algorithm=SHA1&digits=6&period=${PAS_SECONDES}`;

// ---------------------------------------------------------------------------
// Codes de secours
// ---------------------------------------------------------------------------

const ALPHABET_SECOURS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O ni 1/I

const normaliserSecours = (code) => String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export const empreinteSecours = (code) =>
  createHash("sha256").update(`companyos-secours:${normaliserSecours(code)}`).digest("hex");

/// Dix codes de 10 caractères (≈ 50 bits chacun), affichés une seule fois.
export const nouveauxCodesSecours = (nombre = 10) =>
  Array.from({ length: nombre }, () => {
    const brut = Array.from({ length: 10 }, () => ALPHABET_SECOURS[randomInt(ALPHABET_SECOURS.length)]).join("");
    return `${brut.slice(0, 5)}-${brut.slice(5)}`;
  });

/// Un code de secours a-t-il la forme attendue ? (pour l'aiguillage
/// TOTP / secours à la connexion)
export const ressembleSecours = (code) => normaliserSecours(code).length === 10;

/// Consomme un code de secours : rend la liste d'empreintes restante, ou
/// `null` si le code n'en fait pas partie.
export const consommerSecours = (empreintes, code) => {
  const liste = Array.isArray(empreintes) ? empreintes : [];
  const e = empreinteSecours(code);
  const i = liste.findIndex((x) => egal(x, e));
  if (i < 0) return null;
  return liste.filter((_, j) => j !== i);
};

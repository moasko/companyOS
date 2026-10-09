import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32, codeDuPas, consommerSecours, depuisBase32, empreinteSecours,
  nouveauxCodesSecours, pasCourant, verifierCode,
} from "../src/totp.js";

// Vecteur de la RFC 6238 (SHA-1, secret ASCII « 12345678901234567890 »).
const SECRET = base32(Buffer.from("12345678901234567890"));

test("base32 aller-retour", () => {
  assert.equal(depuisBase32(SECRET).toString(), "12345678901234567890");
});

test("vecteurs RFC 6238", () => {
  // T = 59 s → 94287082 (8 chiffres) → 287082 sur 6.
  assert.equal(codeDuPas(SECRET, Math.floor(59 / 30)), "287082");
  assert.equal(codeDuPas(SECRET, Math.floor(1111111109 / 30)), "081804");
  assert.equal(codeDuPas(SECRET, Math.floor(1234567890 / 30)), "005924");
});

test("tolère un pas de décalage, refuse le rejeu", () => {
  const t = 1_800_000_000_000;
  const pas = pasCourant(t);
  const code = codeDuPas(SECRET, pas - 1);
  assert.equal(verifierCode(SECRET, code, { maintenant: t }), pas - 1);
  assert.equal(verifierCode(SECRET, code, { maintenant: t, dernierPas: pas - 1 }), null);
  assert.equal(verifierCode(SECRET, codeDuPas(SECRET, pas - 2), { maintenant: t }), null);
  assert.equal(verifierCode(SECRET, "12345", { maintenant: t }), null);
});

test("codes de secours à usage unique", () => {
  const codes = nouveauxCodesSecours();
  assert.equal(new Set(codes).size, 10);
  const empreintes = codes.map(empreinteSecours);
  const reste = consommerSecours(empreintes, codes[3].toLowerCase().replace("-", " "));
  assert.equal(reste.length, 9);
  assert.equal(consommerSecours(reste, codes[3]), null);
});

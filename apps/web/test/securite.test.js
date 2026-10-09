import { test } from "node:test";
import assert from "node:assert/strict";
import { echapperHtml, lienSur } from "../src/utils/securite.js";

test("échappe un titre injecté dans une page d'impression", () => {
  assert.equal(
    echapperHtml(`</title><img src=x onerror="alert(1)">`),
    "&lt;/title&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  );
});

test("seuls http(s) et mailto sont des liens sûrs", () => {
  for (const ok of ["https://ex.com", "http://ex.com", "mailto:a@b.c", " HTTPS://EX.COM"]) assert.ok(lienSur(ok), ok);
  for (const ko of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,x", "vbscript:x", "", null]) assert.ok(!lienSur(ko), String(ko));
});

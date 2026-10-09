import test from "node:test";
import assert from "node:assert/strict";
import { recupererToken } from "../src/login.js";

test("récupère le jeton avec la requête de connexion", async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ token: "jwt-test", user: { name: "Ada" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await recupererToken({
    apiUrl: new URL("http://api.test"),
    email: " ADA@EXAMPLE.COM ",
    password: "secret-test",
    fetchImpl,
  });

  assert.equal(result.token, "jwt-test");
  assert.equal(request.url, "http://api.test/api/auth/login");
  assert.deepEqual(JSON.parse(request.init.body), {
    email: "ada@example.com",
    password: "secret-test",
    jeton: true,
    libelle: "Serveur MCP",
  });
});

test("enchaîne sur le code de double authentification", async () => {
  const appels = [];
  const fetchImpl = async (url, init) => {
    appels.push({ url: String(url), corps: JSON.parse(init.body) });
    const corps = appels.length === 1 ? { mfa: true, defi: "defi-test" } : { token: "jwt-mfa" };
    return new Response(JSON.stringify(corps), { status: 200 });
  };
  const result = await recupererToken({
    apiUrl: new URL("http://api.test"),
    email: "ada@example.com",
    password: "secret-test",
    demanderCode: async () => "123456",
    fetchImpl,
  });
  assert.equal(result.token, "jwt-mfa");
  assert.equal(appels[1].url, "http://api.test/api/auth/login/mfa");
  assert.deepEqual(appels[1].corps, { defi: "defi-test", code: "123456" });
});

test("ne fabrique pas de jeton lorsque la connexion est refusée", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ error: "Identifiants incorrects" }), { status: 401 });
  await assert.rejects(
    () =>
      recupererToken({
        apiUrl: new URL("http://api.test"),
        email: "ada@example.com",
        password: "incorrect",
        fetchImpl,
      }),
    /Identifiants incorrects/,
  );
});

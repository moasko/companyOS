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
  });
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

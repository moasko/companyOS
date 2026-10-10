import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { confianceProxy, estAdressePrivee } from "../src/reseau.js";

test("adresses privées", () => {
  for (const ip of ["10.0.1.2", "172.18.0.5", "192.168.1.1", "127.0.0.1", "::1", "::ffff:172.20.0.3", "fd12:3456::1"]) assert.equal(estAdressePrivee(ip), true, ip);
  for (const ip of ["41.202.10.20", "172.32.0.1", "8.8.8.8", "2001:db8::1"]) assert.equal(estAdressePrivee(ip), false, ip);
});

const ipVue = async (trustProxy, remoteAddress, xff) => {
  const app = Fastify({ trustProxy });
  app.get("/", async (r) => ({ ip: r.ip }));
  const res = await app.inject({ url: "/", remoteAddress, headers: xff ? { "x-forwarded-for": xff } : {} });
  await app.close();
  return res.json().ip;
};

test("TRUST_PROXY=1 derrière le proxy Docker : l'IP du client", async () => {
  assert.equal(await ipVue(confianceProxy("1"), "172.18.0.2", "41.202.10.20"), "41.202.10.20");
});

test("client joint en direct : X-Forwarded-For ignoré (pas d'usurpation)", async () => {
  assert.equal(await ipVue(confianceProxy("1"), "41.202.10.20", "1.2.3.4"), "41.202.10.20");
});

test("un seul saut de confiance : la chaîne forgée par le client n'est pas crue", async () => {
  assert.equal(await ipVue(confianceProxy("1"), "172.18.0.2", "10.0.0.9, 41.202.10.20"), "41.202.10.20");
});

test("0, vide ou true : aucun proxy cru", async () => {
  for (const v of ["0", "", "true", undefined]) assert.equal(confianceProxy(v), false);
  assert.equal(await ipVue(confianceProxy("0"), "172.18.0.2", "41.202.10.20"), "172.18.0.2");
});

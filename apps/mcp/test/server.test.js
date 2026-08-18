import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { CompanyOSClient } from "../src/client.js";
import { createHandler } from "../src/server.js";

const config = loadConfig({
  COMPANYOS_API_URL: "http://api.test",
  COMPANYOS_TOKEN: "secret",
});
const calls = [];
const fetchMock = async (url, init) => {
  calls.push({ url: String(url), init });
  return new Response(JSON.stringify([{ id: "1", nom: "Client" }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
const handler = createHandler(new CompanyOSClient(config, fetchMock));

test("annonce les capacités MCP", async () => {
  const result = await handler({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26" },
  });
  assert.equal(result.result.serverInfo.name, "companyos-mcp");
  assert.ok(result.result.capabilities.tools);
});

test("liste et appelle les outils avec authentification", async () => {
  const listed = await handler({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.ok(listed.result.tools.some((tool) => tool.name === "companyos_list_records"));
  const result = await handler({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "companyos_list_records",
      arguments: { module: "crm", collection: "clients", limit: 10 },
    },
  });
  assert.equal(result.result.structuredContent[0].nom, "Client");
  assert.match(calls.at(-1).url, /\/api\/records\/crm\/clients\?limit=10/);
  assert.equal(calls.at(-1).init.headers.authorization, "Bearer secret");
});

test("refuse les suppressions non confirmées", async () => {
  const result = await handler({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "companyos_request",
      arguments: { method: "DELETE", path: "/api/files/123" },
    },
  });
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /confirm=true/);
});

test("refuse un chemin hors API et les écritures en lecture seule", async () => {
  await assert.rejects(
    () =>
      new CompanyOSClient(config, fetchMock).request({ path: "https://evil.test/api/x" }),
    /commencer par/,
  );
  const readOnly = new CompanyOSClient({ ...config, allowWrites: false }, fetchMock);
  await assert.rejects(
    () => readOnly.request({ method: "POST", path: "/api/notifications", body: {} }),
    /lecture seule/,
  );
});

test("crée un vrai fichier multipart", async () => {
  const result = await handler({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "companyos_create_text_file",
      arguments: { name: "rapport.txt", content: "Terminé", parentId: "dossier-1" },
    },
  });
  assert.equal(result.result.isError, undefined);
  const call = calls.at(-1);
  assert.match(call.url, /\/api\/files\/upload$/);
  assert.equal(call.init.body.get("parentId"), "dossier-1");
  assert.equal(call.init.body.get("file").name, "rapport.txt");
});

import {
  tools,
  callTool,
  resources,
  readResource,
  prompts,
  getPrompt,
} from "./capabilities.js";

const VERSION = "2025-03-26";

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message, data) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message, ...(data ? { data } : {}) },
});

export function createHandler(client) {
  return async (message) => {
    const { id, method, params = {} } = message || {};
    if (!method) return fail(id, -32600, "Requête JSON-RPC invalide");
    if (method.startsWith("notifications/")) return null;
    try {
      switch (method) {
        case "initialize":
          return ok(id, {
            protocolVersion: params.protocolVersion || VERSION,
            capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: { name: "companyos-mcp", version: "0.1.0" },
            instructions:
              "Pilote CompanyOS via son API authentifiée. Confirmer les suppressions et vérifier les écritures.",
          });
        case "ping":
          return ok(id, {});
        case "tools/list":
          return ok(id, { tools });
        case "tools/call": {
          try {
            const value = await callTool(client, params.name, params.arguments || {});
            return ok(id, {
              content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
              structuredContent: value,
            });
          } catch (error) {
            return ok(id, {
              isError: true,
              content: [{ type: "text", text: error.message }],
            });
          }
        }
        case "resources/list":
          return ok(id, { resources });
        case "resources/read":
          return ok(id, await readResource(client, params.uri));
        case "resources/templates/list":
          return ok(id, { resourceTemplates: [] });
        case "prompts/list":
          return ok(id, { prompts });
        case "prompts/get":
          return ok(id, getPrompt(params.name, params.arguments));
        default:
          return fail(id, -32601, `Méthode inconnue : ${method}`);
      }
    } catch (error) {
      return fail(id, -32603, error.message);
    }
  };
}

export function startStdio(handler, input = process.stdin, output = process.stdout) {
  let buffer = "";
  input.setEncoding("utf8");
  const send = (message) => {
    if (message) output.write(`${JSON.stringify(message)}\n`);
  };
  input.on("data", async (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        send(await handler(JSON.parse(line)));
      } catch (error) {
        send(fail(null, -32700, `JSON invalide : ${error.message}`));
      }
    }
  });
  input.resume();
}

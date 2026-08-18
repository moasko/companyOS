import { loadConfig } from "./config.js";
import { CompanyOSClient } from "./client.js";
import { callTool } from "./capabilities.js";

try {
  const status = await callTool(new CompanyOSClient(loadConfig()), "companyos_status");
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`Échec du diagnostic MCP : ${error.message}\n`);
  process.exit(1);
}

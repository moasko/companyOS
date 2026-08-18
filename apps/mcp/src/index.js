#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { CompanyOSClient } from "./client.js";
import { createHandler, startStdio } from "./server.js";

try {
  const config = loadConfig();
  startStdio(createHandler(new CompanyOSClient(config)));
} catch (error) {
  process.stderr.write(`companyos-mcp: ${error.message}\n`);
  process.exit(1);
}

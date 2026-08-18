#!/usr/bin/env node
import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";

export async function recupererToken({ apiUrl, email, password, fetchImpl = fetch }) {
  const response = await fetchImpl(new URL("/api/auth/login", apiUrl), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    signal: AbortSignal.timeout(30_000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token) {
    throw new Error(data.error || `Connexion refusée (${response.status}).`);
  }
  return data;
}

async function demanderIdentifiants() {
  const emailReader = createInterface({ input: process.stdin, output: process.stdout });
  const email =
    process.env.COMPANYOS_EMAIL || (await emailReader.question("E-mail CompanyOS : "));
  emailReader.close();

  if (process.env.COMPANYOS_PASSWORD) {
    return { email, password: process.env.COMPANYOS_PASSWORD };
  }

  let muted = false;
  const hiddenOutput = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const passwordReader = createInterface({
    input: process.stdin,
    output: hiddenOutput,
    terminal: true,
  });
  const pending = passwordReader.question("Mot de passe : ");
  muted = true;
  const password = await pending;
  muted = false;
  passwordReader.close();
  process.stdout.write("\n");
  return { email, password };
}

async function main() {
  const config = loadConfig();
  const credentials = await demanderIdentifiants();
  const session = await recupererToken({ apiUrl: config.apiUrl, ...credentials });
  process.stdout.write(
    `\nConnexion réussie : ${session.user?.name || credentials.email}\n`,
  );
  process.stdout.write(`Espace : ${session.tenant?.name || "inconnu"}\n\n`);
  process.stdout.write("Jeton CompanyOS (à garder secret) :\n");
  process.stdout.write(`${session.token}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Connexion impossible : ${error.message}\n`);
    process.exitCode = 1;
  });
}

const bool = (value, fallback) => {
  if (value == null || value === "") return fallback;
  return !["0", "false", "non", "no"].includes(String(value).toLowerCase());
};

export function loadConfig(env = process.env) {
  const rawUrl = env.COMPANYOS_API_URL || "http://localhost:4000";
  let apiUrl;
  try {
    apiUrl = new URL(rawUrl);
  } catch {
    throw new Error("COMPANYOS_API_URL doit être une URL valide.");
  }
  if (!["http:", "https:"].includes(apiUrl.protocol)) {
    throw new Error("COMPANYOS_API_URL doit utiliser http ou https.");
  }
  apiUrl.pathname = apiUrl.pathname.replace(/\/$/, "");

  const timeoutMs = Number(env.COMPANYOS_TIMEOUT_MS || 30_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new Error("COMPANYOS_TIMEOUT_MS doit être compris entre 1000 et 120000.");
  }

  return {
    apiUrl,
    token: env.COMPANYOS_TOKEN?.trim() || "",
    allowWrites: bool(env.COMPANYOS_ALLOW_WRITES, true),
    timeoutMs,
  };
}

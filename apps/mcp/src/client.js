const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class CompanyOSClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async request({ method = "GET", path, query, body, confirm = false }) {
    method = String(method).toUpperCase();
    if (!METHODS.has(method)) throw new Error(`Méthode HTTP non autorisée : ${method}`);
    if (WRITE_METHODS.has(method) && !this.config.allowWrites) {
      throw new Error("Ce serveur MCP est configuré en lecture seule.");
    }
    if (method === "DELETE" && confirm !== true) {
      throw new Error(
        "Une suppression exige confirm=true après confirmation explicite de l’utilisateur.",
      );
    }
    if (typeof path !== "string" || !path.startsWith("/api/") || path.includes("\\")) {
      throw new Error("Le chemin doit commencer par /api/.");
    }

    const url = new URL(path, this.config.apiUrl);
    if (url.origin !== this.config.apiUrl.origin) {
      throw new Error("L’appel doit rester sur l’hôte CompanyOS configuré.");
    }
    for (const [key, value] of Object.entries(query || {})) {
      if (value != null) url.searchParams.set(key, String(value));
    }

    const headers = { accept: "application/json" };
    if (this.config.token) headers.authorization = `Bearer ${this.config.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    const response = await this.fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const raw = await response.text();
    let data = raw;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        /* réponse texte */
      }
    } else data = null;

    if (!response.ok) {
      const detail = data?.error || data?.message || raw || response.statusText;
      throw new Error(`CompanyOS ${response.status}: ${detail}`);
    }
    return data;
  }

  async uploadText({
    name,
    content,
    parentId = null,
    mimeType = "text/plain;charset=utf-8",
  }) {
    if (!this.config.allowWrites) {
      throw new Error("Ce serveur MCP est configuré en lecture seule.");
    }
    if (!name || typeof name !== "string" || name.length > 255 || /[\\/]/.test(name)) {
      throw new Error("Le nom du fichier est invalide.");
    }
    if (typeof content !== "string") throw new Error("Le contenu doit être du texte.");
    const form = new FormData();
    if (parentId) form.append("parentId", parentId);
    form.append("file", new File([content], name, { type: mimeType }));
    const headers = { accept: "application/json" };
    if (this.config.token) headers.authorization = `Bearer ${this.config.token}`;
    const response = await this.fetch(new URL("/api/files/upload", this.config.apiUrl), {
      method: "POST",
      headers,
      body: form,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        `CompanyOS ${response.status}: ${data?.error || response.statusText}`,
      );
    return data;
  }
}

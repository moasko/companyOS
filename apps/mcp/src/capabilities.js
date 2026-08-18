const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const tools = [
  {
    name: "companyos_status",
    description:
      "Vérifie que l’API CompanyOS répond et indique si le jeton courant est valide.",
    inputSchema: objectSchema({}),
  },
  {
    name: "companyos_list_apps",
    description: "Liste les applications installées ou tout le catalogue CompanyOS.",
    inputSchema: objectSchema({
      source: {
        type: "string",
        enum: ["installed", "catalog", "mine"],
        default: "installed",
      },
    }),
  },
  {
    name: "companyos_list_records",
    description: "Lit les fiches d’une collection d’application CompanyOS.",
    inputSchema: objectSchema(
      {
        module: { type: "string", description: "Slug de l’application" },
        collection: { type: "string", description: "Clé de la collection" },
        search: { type: "string", description: "Recherche facultative" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      ["module", "collection"],
    ),
  },
  {
    name: "companyos_save_record",
    description: "Crée ou modifie une fiche. Si id est absent, crée la fiche.",
    inputSchema: objectSchema(
      {
        module: { type: "string" },
        collection: { type: "string" },
        id: { type: "string" },
        data: {
          type: "object",
          description: "Valeurs de la fiche",
          additionalProperties: true,
        },
      },
      ["module", "collection", "data"],
    ),
  },
  {
    name: "companyos_create_text_file",
    description:
      "Crée un vrai fichier texte dans le cloud CompanyOS. Convient aux fichiers .txt, .md, .json, .csv, .html et aux sources de code.",
    inputSchema: objectSchema(
      {
        name: { type: "string", description: "Nom avec extension, sans chemin" },
        content: { type: "string", description: "Contenu UTF-8 du fichier" },
        parentId: {
          type: ["string", "null"],
          description: "Dossier destination ; null pour la racine",
        },
        mimeType: { type: "string", description: "Type MIME facultatif" },
      },
      ["name", "content"],
    ),
  },
  {
    name: "companyos_request",
    description:
      "Appelle une route de l’API CompanyOS pour piloter toutes les fonctions non couvertes par un outil spécialisé (fichiers, membres, notifications, audit, courrier, facturation, plateforme). Utiliser uniquement un chemin /api/ documenté. Toute suppression nécessite confirm=true.",
    inputSchema: objectSchema(
      {
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          default: "GET",
        },
        path: { type: "string", pattern: "^/api/" },
        query: {
          type: "object",
          additionalProperties: { type: ["string", "number", "boolean"] },
        },
        body: { description: "Corps JSON de la requête" },
        confirm: {
          type: "boolean",
          description: "Obligatoire pour DELETE, après accord explicite",
        },
      },
      ["path"],
    ),
  },
];

const encode = encodeURIComponent;

export async function callTool(client, name, args = {}) {
  switch (name) {
    case "companyos_status": {
      const health = await client
        .fetch(new URL("/health", client.config.apiUrl), {
          signal: AbortSignal.timeout(client.config.timeoutMs),
        })
        .then(async (r) => {
          if (!r.ok) throw new Error(`API indisponible (${r.status})`);
          return r.json();
        });
      let account = null;
      if (client.config.token) account = await client.request({ path: "/api/auth/me" });
      return {
        health,
        authenticated: Boolean(account),
        account,
        writesEnabled: client.config.allowWrites,
      };
    }
    case "companyos_list_apps": {
      if (args.source && !["installed", "catalog", "mine"].includes(args.source)) {
        throw new Error("source doit valoir installed, catalog ou mine.");
      }
      return client.request({ path: `/api/apps/${args.source || "installed"}` });
    }
    case "companyos_list_records":
      if (!args.module || !args.collection)
        throw new Error("module et collection sont obligatoires.");
      return client.request({
        path: `/api/records/${encode(args.module)}/${encode(args.collection)}`,
        query: { q: args.search, limit: args.limit },
      });
    case "companyos_save_record":
      if (
        !args.module ||
        !args.collection ||
        !args.data ||
        typeof args.data !== "object"
      ) {
        throw new Error("module, collection et data sont obligatoires.");
      }
      return client.request({
        method: args.id ? "PUT" : "POST",
        path: `/api/records/${encode(args.module)}/${encode(args.collection)}${args.id ? `/${encode(args.id)}` : ""}`,
        body: args.data,
      });
    case "companyos_create_text_file":
      return client.uploadText(args);
    case "companyos_request":
      return client.request(args);
    default:
      throw new Error(`Outil inconnu : ${name}`);
  }
}

export const resources = [
  {
    uri: "companyos://account",
    name: "Compte et espace courants",
    mimeType: "application/json",
  },
  {
    uri: "companyos://apps/installed",
    name: "Applications installées",
    mimeType: "application/json",
  },
  {
    uri: "companyos://apps/catalog",
    name: "Catalogue des applications",
    mimeType: "application/json",
  },
  {
    uri: "companyos://files/tree",
    name: "Arborescence des fichiers",
    mimeType: "application/json",
  },
  {
    uri: "companyos://notifications",
    name: "Notifications",
    mimeType: "application/json",
  },
  { uri: "companyos://audit", name: "Journal d’audit", mimeType: "application/json" },
];

const resourcePaths = new Map([
  ["companyos://account", "/api/auth/me"],
  ["companyos://apps/installed", "/api/apps/installed"],
  ["companyos://apps/catalog", "/api/apps/catalog"],
  ["companyos://files/tree", "/api/files/arborescence"],
  ["companyos://notifications", "/api/notifications"],
  ["companyos://audit", "/api/audit"],
]);

export async function readResource(client, uri) {
  const path = resourcePaths.get(uri);
  if (!path) throw new Error(`Ressource inconnue : ${uri}`);
  const value = await client.request({ path });
  return {
    contents: [
      { uri, mimeType: "application/json", text: JSON.stringify(value, null, 2) },
    ],
  };
}

export const prompts = [
  {
    name: "piloter-companyos",
    description:
      "Transforme une demande simple en actions CompanyOS sûres et vérifiables.",
    arguments: [
      { name: "objectif", description: "La tâche métier à accomplir", required: true },
    ],
  },
];

export function getPrompt(name, args = {}) {
  if (name !== "piloter-companyos") throw new Error(`Prompt inconnu : ${name}`);
  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Objectif dans CompanyOS : ${args.objectif}\n\nInspecte d’abord les applications et ressources utiles. Exécute les lectures nécessaires, puis les écritures strictement requises. Demande une confirmation avant toute suppression ou action irréversible. Après chaque écriture, relis la ressource concernée et résume précisément le résultat. N’invente jamais d’identifiant ni de route.`,
        },
      },
    ],
  };
}

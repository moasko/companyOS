-- MCP Center est une application native livrée par le shell. L'insérer par
-- migration la rend disponible dans la Boutique lors d'un déploiement normal,
-- même lorsque l'exploitant ne relance pas explicitement le seed du catalogue.
INSERT INTO "apps" (
  "id",
  "tenantId",
  "slug",
  "name",
  "description",
  "icon",
  "category",
  "version",
  "kind",
  "published",
  "isCore",
  "publishedAt"
)
SELECT
  'global-mcp-center',
  NULL,
  'mcp',
  'MCP Center',
  'Connectez CompanyOS à Codex, Claude et aux assistants compatibles MCP. Gérez le jeton, les permissions, les ressources exposées, la configuration et le diagnostic depuis une seule console.',
  'terminal',
  'Outils',
  '1.0.0',
  'NATIVE'::"AppKind",
  true,
  false,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "apps" WHERE "tenantId" IS NULL AND "slug" = 'mcp'
);

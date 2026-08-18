# MCP CompanyOS

Ce serveur relie un client MCP (Codex, Claude Desktop ou tout client compatible)
à **toutes les fonctions exposées par l’API CompanyOS**, avec le même compte, le
même espace et les mêmes permissions que son jeton. Il ne contourne ni les rôles
CompanyOS ni les consentements des services tiers.

## Installation

Prérequis : Node.js 22+, l’API CompanyOS démarrée et un jeton de session.

```powershell
npm install
$env:COMPANYOS_API_URL="http://localhost:4000"
$env:COMPANYOS_TOKEN="votre-jeton"
npm run mcp:check
```

Pour récupérer un jeton avec votre compte sans placer le mot de passe dans la
ligne de commande :

```powershell
npm run mcp:login
```

La commande demande l’e-mail et masque la saisie du mot de passe. Elle appelle
`POST /api/auth/login`, puis affiche le jeton une seule fois. Ne le commettez
jamais et ne le partagez pas.

Configuration d’un client MCP (remplacer le chemin et conserver les secrets hors
du dépôt) :

```json
{
  "mcpServers": {
    "companyos": {
      "command": "node",
      "args": ["E:/companyos/apps/mcp/src/index.js"],
      "env": {
        "COMPANYOS_API_URL": "http://localhost:4000",
        "COMPANYOS_TOKEN": "votre-jeton",
        "COMPANYOS_ALLOW_WRITES": "1"
      }
    }
  }
}
```

Le prompt MCP `piloter-companyos` accepte un objectif métier simple. Le client
peut découvrir les apps et ressources, lire ou enregistrer des fiches, puis
utiliser `companyos_request` pour les fichiers, membres, notifications, audit,
courrier, facturation et fonctions de plateforme.

`companyos_create_text_file` crée de vrais fichiers UTF-8 dans le cloud via le
téléversement multipart attendu par l’API.

## Sécurité

- Le serveur ne peut appeler que l’origine définie par `COMPANYOS_API_URL`.
- Les chemins doivent commencer par `/api/`.
- `COMPANYOS_ALLOW_WRITES=0` rend l’instance intégralement non destructive.
- Chaque requête `DELETE` exige `confirm=true` après accord explicite.
- Le jeton n’est ni renvoyé comme ressource, ni écrit dans les journaux.
- Les rôles `MEMBER`, `ADMIN`, `OWNER` et exploitant restent contrôlés par
  l’API.

## Vérification

```powershell
npm run test --workspace @companyos/mcp
npm run mcp:check
```

Le premier test vérifie le protocole sans serveur externe. Le diagnostic
contacte l’API réelle et valide aussi le jeton lorsqu’il est configuré.

# CompanyOS

Un système d'exploitation web : un bureau unique dans le navigateur, qui réunit
les applications de gestion de l'entreprise et les fait communiquer entre elles.
Chaque client dispose d'un espace de travail avec son propre stockage, et
installe depuis la Boutique les modules dont il a besoin.

Facturation, comptabilité, CRM, stock, paie, RH, congés, projets, campagnes,
courrier — et un Studio pour créer ses propres applications sans écrire de code.

## Structure

Un monorepo npm workspaces. Une seule commande `npm install` à la racine
installe tout.

```
companyos/
├── apps/
│   ├── web/            Shell : bureau, fenêtres, barre des tâches, modules métier
│   └── api/            API : comptes, espaces, quota, catalogue, fichiers
├── packages/
│   └── shared/         Règles métier appliquées des deux côtés
└── docs/               Documentation
```

| Espace de travail   | Rôle                                                              |
| ------------------- | ----------------------------------------------------------------- |
| `@companyos/web`    | React 18 · Vite 6 · Redux · TanStack Query · SCSS                 |
| `@companyos/api`    | Node 22 · Fastify 5 · Prisma 6 · PostgreSQL 17                    |
| `@companyos/shared` | JavaScript pur — totaux, validations, gabarits, règles d'échéance |

### Pourquoi `packages/shared`

Le serveur importait autrefois des fichiers du front
(`../../src/apps/modules/…`). Cela marchait, mais une modification faite « côté
écran » changeait le comportement du serveur sans que personne ne s'en aperçoive
— c'est exactement ce qui avait rendu exploitable une injection HTML dans les
emails de campagne. Le code que les deux côtés partagent vit maintenant dans un
paquet explicite.

## Pilotage par MCP

Un serveur MCP permet à un assistant compatible de découvrir et manipuler les
applications, fiches, fichiers et fonctions d’administration CompanyOS avec les
permissions d’un compte réel. Installation, configuration et garde-fous :
[`apps/mcp/README.md`](apps/mcp/README.md).

## Démarrer

Prérequis : Node 22, et PostgreSQL (ou Docker).

```bash
# 1. Les dépendances des trois espaces de travail, en une fois
npm install

# 2. La base de données
docker compose up -d postgres
cp apps/api/.env.example apps/api/.env   # puis remplissez les valeurs

# 3. Le schéma et le catalogue d'applications
npm run db:migrate
npm run db:seed

# 4. Dans deux terminaux
npm run dev:api    # http://localhost:4000
npm run dev:web    # http://localhost:5173
```

Le fichier `apps/api/.env.example` documente chaque variable. Deux à ne pas
laisser par défaut :

```bash
# Secret de signature des sessions
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# Clé de chiffrement des secrets stockés (S3, SMTP) — distincte de la première
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Commandes

| Commande             | Effet                                                   |
| -------------------- | ------------------------------------------------------- |
| `npm run dev:web`    | Shell en développement, port 5173                       |
| `npm run dev:api`    | API en développement avec rechargement, port 4000       |
| `npm run build`      | Build de production du shell dans `apps/web/build`      |
| `npm run lint`       | ESLint sur tout le dépôt                                |
| `npm run format`     | Prettier sur tout le dépôt                              |
| `npm run db:migrate` | Crée et applique une migration Prisma                   |
| `npm run db:studio`  | Ouvre Prisma Studio sur la base                         |
| `npm run audit:prod` | Audit des dépendances livrées (hors outillage de build) |

## Déploiement

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Les deux images se construisent depuis la racine du dépôt — c'est là que vivent
le manifeste des workspaces et le lockfile. Voir
[DEPLOIEMENT.md](DEPLOIEMENT.md) pour la marche à suivre sur Dokploy et la liste
des variables d'environnement.

## Documentation

- [Créer une application](docs/CREER-UNE-APP.md) — ajouter un module métier
- [Architecture](docs/ARCHITECTURE.md) — comment les morceaux tiennent ensemble
- [Sécurité](docs/SECURITE.md) — le modèle de menace et les règles à respecter
- [Déploiement](DEPLOIEMENT.md) — mise en production

## Origine et licence

Le shell — bureau, fenêtres, barre des tâches, menu Démarrer — est dérivé de
[win11React](https://github.com/blueedgetechno/win11React) de blueedgetechno,
publié sous [CC0 1.0](LICENSE) (domaine public). Les applications de
démonstration du projet d'origine ont été retirées et remplacées par les modules
de gestion ; le reste a été rebrandé et largement réécrit.

CompanyOS conserve la même licence CC0 1.0.

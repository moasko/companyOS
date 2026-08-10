# API CompanyOS

Backend du système : comptes, espaces de travail multi-tenant, quota de stockage,
catalogue d'applications installables et arborescence de fichiers.

**Stack** — Node 22 · Fastify 5 · Prisma 6 · PostgreSQL 17

## Démarrer

```bash
cd server
cp .env.example .env    # puis renseigner DATABASE_URL et JWT_SECRET
npm install
npx prisma migrate deploy
node prisma/seed.js
npm run dev
```

L'API écoute sur `http://localhost:4000`.

Pour un PostgreSQL local, `docker compose up -d postgres` à la racine du dépôt
lance une instance sur le port 5432 correspondant à l'URL par défaut.

## Modèle de données

| Table           | Rôle                                                                 |
| --------------- | -------------------------------------------------------------------- |
| `tenants`       | Un espace de travail = une entreprise. Porte le quota et la consommation. |
| `users`         | Comptes, rattachés à un tenant, avec un rôle (OWNER / ADMIN / MEMBER). |
| `apps`          | Catalogue global de la Boutique. `isCore` = installé d'office.        |
| `installations` | Quelle app est installée dans quel espace de travail.                 |
| `fs_nodes`      | Arborescence fichiers/dossiers. Métadonnées seulement.                |
| `records`       | Données des modules métier, en JSONB, rangées par (module, collection). |

L'isolation entre clients repose sur `tenantId`, présent sur chaque table métier.
Toute requête de lecture ou d'écriture doit être filtrée dessus — c'est la seule
barrière entre deux entreprises. Ne jamais interroger par `id` seul : voir le
helper `findOwned` dans `src/routes/files.js`.

Les octets des fichiers ne sont **pas** en base : `fs_nodes.storageKey` pointe vers
le stockage objet, piloté par `src/storage.js`. Le pilote `local` écrit sur disque ;
passer en S3 ne demande que d'ajouter un pilote exposant `buildKey` / `put` / `read`
/ `remove`.

## Endpoints

### Authentification

| Méthode | Route                | Description                                              |
| ------- | -------------------- | -------------------------------------------------------- |
| POST    | `/api/auth/register` | Crée l'espace de travail, son propriétaire, ses dossiers et installe les apps du socle. |
| POST    | `/api/auth/login`    | Renvoie un JWT.                                          |
| GET     | `/api/auth/me`       | Compte + espace de travail courants.                     |

### Applications

| Méthode | Route                       | Description                                  |
| ------- | --------------------------- | -------------------------------------------- |
| GET     | `/api/apps/catalog`         | Catalogue, avec l'état `installed` par app.  |
| GET     | `/api/apps/installed`       | Apps disponibles dans le shell.              |
| POST    | `/api/apps/:slug/install`   | Installe une app dans l'espace de travail.   |
| DELETE  | `/api/apps/:slug/install`   | Désinstalle (refusé pour les apps du socle). |

### Fichiers

| Méthode | Route                        | Description                                   |
| ------- | ---------------------------- | --------------------------------------------- |
| GET     | `/api/files/usage`           | Quota, consommation, espace restant.          |
| GET     | `/api/files?parentId=`       | Contenu d'un dossier (racine si omis).        |
| POST    | `/api/files/folder`          | Crée un dossier.                              |
| POST    | `/api/files/upload`          | Envoi multipart. Refuse si le quota est atteint. |
| GET     | `/api/files/:id/download`    | Télécharge un fichier.                        |
| DELETE  | `/api/files/:id`             | Suppression récursive, quota libéré.          |

### Données des modules

| Méthode | Route                                    | Description                          |
| ------- | ---------------------------------------- | ------------------------------------ |
| GET     | `/api/records/:module/:collection`       | Liste (500 max, plus récents d'abord). |
| POST    | `/api/records/:module/:collection`       | Crée un enregistrement.              |
| PUT     | `/api/records/:module/:collection/:id`   | Remplace les données.                |
| DELETE  | `/api/records/:module/:collection/:id`   | Supprime.                            |

Le corps est `{ "data": { ... } }`, un objet JSON libre de 64 Ko maximum.
Un nouveau module n'exige donc **aucune migration** : il choisit son couple
module/collection et écrit.

Toutes les routes hors `/api/auth/register` et `/api/auth/login` exigent
`Authorization: Bearer <token>`.

## Reste à faire

- Rafraîchissement de jeton et révocation (aujourd'hui : un seul JWT à 7 jours).
- Pilote de stockage S3.
- Invitation d'utilisateurs dans un espace de travail existant.
- Facturation / gestion des plans (`Plan` existe, rien ne le consomme encore).
- Tables métier des modules CRM, Facturation, Stock… : le catalogue les référence,
  leur schéma reste à écrire.

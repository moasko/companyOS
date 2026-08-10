# Architecture

Comment les morceaux tiennent ensemble, et pourquoi ils sont découpés ainsi.

## Le dépôt

```
apps/web/        Le shell — React 18, Vite, Redux, TanStack Query, SCSS
apps/api/        L'API — Node 22, Fastify 5, Prisma 6, PostgreSQL 17
packages/shared/ Les règles métier appliquées des deux côtés
```

Un monorepo npm workspaces : `npm install` à la racine installe les trois,
et `@companyos/shared` est résolu par un lien, pas par un registre.

### Pourquoi `packages/shared` existe

Le serveur importait autrefois des fichiers du shell :

```js
import { htmlDe } from "../../src/apps/modules/campagnes/domaine.js";
```

Cela marchait. Mais une modification faite « côté écran » changeait le
comportement du serveur sans que personne ne s'en aperçoive — et c'est
exactement ce qui avait rendu exploitable une injection HTML dans les emails
de campagne : le correctif appliqué au front ne protégeait rien tant que le
serveur lisait le même fichier.

Y entre du JavaScript **pur** : pas de React, pas de `window`, pas de
`prisma`, pas de réseau. Des fonctions qui prennent des données et rendent
des données. Une règle ESLint interdit `window`, `document` et
`localStorage` dans ce paquet — la panne serait sinon silencieuse, côté
serveur, au moment d'un envoi de mail.

## Le shell

### Deux gestionnaires d'état, et c'est voulu

| | Porte | Exemples |
| --- | --- | --- |
| **Redux** | l'état de l'OS lui-même | fenêtres ouvertes et leur position, thème, fond d'écran, menu Démarrer |
| **TanStack Query** | ce qui vient de l'API | fiches métier, fichiers, membres, notifications |

La distinction n'est pas cosmétique. Les données du serveur ne sont pas de
l'état : elles ont une fraîcheur, elles peuvent échouer, et deux fenêtres
qui affichent la même liste doivent voir la même chose. Les traiter comme
de l'état local avait produit quarante caches indépendants — un par module
— d'où des listes rechargées deux fois et des données périmées dans une
fenêtre restée ouverte.

Voir `apps/web/src/api/queries.js` pour la convention de clés.

### Une application = un dossier

```
apps/web/src/apps/modules/<nom>/
├── index.jsx     le composant racine, l'état, le chargement, les écritures
├── domaine.js    les règles métier du module, sans React
├── vues/         les sous-écrans, sans état
└── <nom>.scss
```

Le registre découvre les modules par `import.meta.glob("./modules/*/index.jsx")` :
un dossier suffit, il n'y a rien à déclarer ailleurs. `vues/` n'est pas
ramassé, ce qui est la raison pour laquelle les sous-écrans y vivent.

Les applications créées dans le **Studio** n'ont pas de code : ce sont des
définitions déclaratives (collections, champs, widgets) rendues par un
moteur générique. C'est la décision d'architecture la plus importante du
projet du point de vue de la sécurité — aucun chemin ne permet à un espace
de travail de faire exécuter du JavaScript à un autre.

## L'API

### Isolation par espace de travail

Le contrat central, et le seul qui ne se négocie pas : **toute requête de
données est filtrée sur `request.tenantId`**, posé par le préhandler
`authenticate` à partir du compte, jamais à partir de la requête.

En pratique : `updateMany`/`deleteMany` filtrés plutôt qu'`update` par
identifiant. Un `update` par identifiant qui oublie le tenant modifie la
donnée d'un autre client ; un `updateMany` qui l'oublie aussi, mais le
filtre est alors visible dans la requête et se relit.

### Rôles

```
MEMBER < ADMIN < OWNER
```

Contrôlés par `exigerRole("ADMIN")` **côté serveur**. Cacher un bouton
n'est pas une autorisation, c'est une politesse : toute règle qui compte
doit tenir quand la requête arrive sans passer par l'écran.

Au-dessus des rôles d'espace, l'**exploitant de la plateforme** : une liste
d'adresses dans `PLATFORM_ADMINS`. On ne le devient pas en créant un
espace ; on l'est parce que le serveur le sait.

### Le CRUD générique

`/api/records/:module/:collection` sert les données de tous les modules
métier, sans migration ni schéma côté serveur. C'est ce qui permet
d'ajouter une application sans toucher à l'API.

C'est aussi la porte de derrière à surveiller : les moteurs de fond
(campagnes, relances) lisent des collections qui s'écrivent par là. Tout
moteur qui agit sur une fiche doit **revalider son contenu côté serveur** —
l'écran qui l'a composée n'est pas un contrôle.

### Moteurs de fond

Deux boucles démarrées avec le serveur :

- `relances.js` — relance les factures échues selon les paliers réglés
- `campagnes.js` — avance les campagnes mûres, huit messages par passage

Les deux passent par `quota-mail.js`, qui borne les envois par espace et
par 24 h, tous chemins confondus.

### Stockage des fichiers

Deux pilotes, choisis dans la console Plateforme : disque local ou objet
compatible S3. Chaque `FsNode` retient **sa** destination : basculer de
l'un à l'autre ne rend pas illisibles les fichiers déjà écrits.

Les secrets de configuration (clé S3, mot de passe SMTP) sont chiffrés en
base en AES-256-GCM — chiffrement authentifié, pour qu'un accès en écriture
à la base ne permette pas de faire pointer le stockage ailleurs.

## Ce qui traverse les deux côtés

| Sujet | Shell | API |
| --- | --- | --- |
| Session | jeton en `localStorage`, en-tête `Authorization` | JWT signé, compte relu en base à chaque requête |
| Lecture d'une vidéo | `POST /files/:id/link` puis `<video src>` | jeton opaque, un fichier, deux heures |
| Web tiers | le module Navigateur demande au serveur | `web.js` : gardes anti-SSRF, IP épinglée, CSP sur la réponse |
| Calculs métier | `@companyos/shared` | `@companyos/shared` |

## Déploiement

Trois conteneurs : PostgreSQL, l'API, le shell derrière nginx. Les deux
images se construisent depuis la racine du dépôt — c'est là que vivent le
manifeste des workspaces et le lockfile.

Deux volumes, et ils comptent : la base et `storage-data`. Sans eux, chaque
redéploiement effacerait les fichiers des espaces de travail.

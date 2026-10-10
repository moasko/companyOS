# Déployer CompanyOS sur un VPS avec Dokploy

CompanyOS se déploie en trois conteneurs — base PostgreSQL, API Fastify,
front statique — décrits dans [docker-compose.prod.yml](docker-compose.prod.yml).
Dokploy construit les images, applique les migrations et enchaîne les
redéploiements sans perte de données : la base et les fichiers du cloud
vivent dans des volumes.

## 1. Prérequis

- Un VPS avec [Dokploy](https://dokploy.com) installé
  (`curl -sSL https://dokploy.com/install.sh | sh`).
- Le domaine `companyos.fr` et ses sous-domaines pointant (enregistrement
  A, et AAAA si le VPS a une IPv6) vers le VPS :
  - `companyos.fr` et `www.companyos.fr` — la vitrine ;
  - `app.companyos.fr` — le shell ;
  - `api.companyos.fr` — l'API.
- Ce dépôt accessible à Dokploy (GitHub, GitLab, ou dépôt privé avec clé).

## 2. Créer le service

Dans Dokploy : **Create Project** → **Create Service** → type **Docker Compose**.

- **Source** : ce dépôt, branche `master`.
- **Compose file** : `docker-compose.prod.yml`.

## 3. Variables d'environnement

Onglet **Environment** du service — toutes sont exigées sauf mention :

| Variable | Valeur | Rôle |
|---|---|---|
| `POSTGRES_PASSWORD` | un mot de passe fort | la base |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` | signature des sessions |
| `ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | chiffrement des secrets stockés (S3, SMTP) |
| `CORS_ORIGIN` | `https://app.companyos.fr` | le shell autorisé à appeler l'API |
| `VITE_API_URL` | `https://api.companyos.fr` | figée dans le build du shell |
| `TRUST_PROXY` | `1` | un proxy devant l'API (Traefik) |
| `JWT_EXPIRES_IN` | `7d` (défaut) | durée maximale d'une session de navigateur |
| `SESSION_INACTIVITE_MINUTES` | `720` (défaut, 12 h) | une session de navigateur sans activité se ferme |
| `SESSION_SAMESITE` | `Strict` (défaut) | `SameSite` du cookie de session ; `None` seulement si le shell et l'API sont sur deux domaines différents (HTTPS obligatoire) |
| `DEFAULT_TENANT_QUOTA` | vide (défaut : quota de la formule Découverte) | à ne renseigner que pour une offre de lancement |
| `UPLOAD_MAX_OCTETS` | `134217728` (défaut, 128 Mo) | taille maximale d'un fichier importé |
| `MAIL_QUOTA_JOUR` | `500` (défaut) | plafond d'envoi par espace et par 24 h |
| `PLATFORM_ADMINS` | `vous@companyos.fr` | les comptes exploitants (console Plateforme) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | vide (défaut : générées et rangées en base) | clés des notifications push ; `npx web-push generate-vapid-keys` pour les fixer |

> `VITE_API_URL` est cuite **au build** — et les images sont construites
> par GitHub Actions (`.github/workflows/images.yml`), pas par Dokploy. Sa
> valeur par défaut y est `https://api.companyos.fr` ; pour une autre,
> déclarez la variable de dépôt `VITE_API_URL` (Settings → Secrets and
> variables → Actions → Variables) puis relancez le workflow « Images ».
>
> `VITE_API_URL` est cuite **au build** : la changer exige un redéploiement,
> pas seulement un redémarrage.

> En production (`NODE_ENV=production`), l'API **refuse de démarrer** si
> `JWT_SECRET` fait moins de 32 caractères ou garde sa valeur d'exemple, ou
> si `ENCRYPTION_KEY` est renseignée avec moins de 32 caractères.
>
> `ENCRYPTION_KEY` doit être **distincte** de `JWT_SECRET`. À défaut, le
> secret JWT sert de repli — et faire tourner les sessions rendrait alors
> illisibles tous les secrets déjà stockés (clé S3, mots de passe SMTP des
> espaces). L'écran de configuration le signale au lieu d'échouer en
> silence, mais autant ne pas s'y exposer.

> `TRUST_PROXY` vaut `1` derrière Dokploy, jamais `true` : croire n'importe
> quel client qui envoie `X-Forwarded-For` lui-même revient à laisser
> maquiller les adresses du journal d'audit et contourner la limitation de
> débit. Laissé à `0`, c'est l'inverse : toutes les requêtes comptent comme
> venant du proxy, donc d'une seule IP.

## 4. Domaines

Onglet **Domains** du service :

| Domaine | Service | Port | HTTPS |
|---|---|---|---|
| `companyos.fr` | `web` | `80` | oui (Let's Encrypt) |
| `www.companyos.fr` | `web` | `80` | oui (Let's Encrypt) |
| `app.companyos.fr` | `web` | `80` | oui (Let's Encrypt) |
| `api.companyos.fr` | `api` | `4000` | oui (Let's Encrypt) |

Les trois premiers vont au même conteneur `web` : c'est `nginx.conf` qui
distingue la vitrine (domaine nu) de l'OS (`app.`).

Dokploy (Traefik) obtient et renouvelle les certificats tout seul.

## 5. Déployer

Bouton **Deploy**. Au premier démarrage, l'API :

1. applique les migrations Prisma (`prisma migrate deploy`) ;
2. rejoue le seed — idempotent : il remplit le catalogue de la Boutique
   sans jamais écraser les données existantes ;
3. démarre sur le port 4000 (`/health` répond `{"status":"ok"}`).

Ouvrez ensuite `https://app.companyos.fr` et créez le premier espace de
travail depuis l'écran d'inscription — son créateur en devient le
propriétaire (formule Découverte ; la formule se change dans
Paramètres → Formule et tarifs).

## 6. Courriels (invitations)

CompanyOS **envoie** des mails — il n'en reçoit pas. Quand un relais SMTP
est configuré, chaque invitation d'équipe part par mail avec son code ;
sans relais, l'administrateur transmet le code lui-même et rien ne casse.

Variables à ajouter dans **Environment** :

| Variable | Exemple |
|---|---|
| `SMTP_HOST` | `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` (STARTTLS) ou `465` (TLS) |
| `SMTP_USER` | l'identifiant du relais |
| `SMTP_PASS` | la clé SMTP |
| `MAIL_FROM` | `CompanyOS <no-reply@companyos.fr>` |

N'importe quel relais convient : Brevo (300 mails/jour gratuits), Resend,
Mailgun, un Gmail professionnel. Chez le fournisseur, validez le domaine
d'envoi (SPF + DKIM) pour ne pas finir en indésirable.

> **Pourquoi pas un serveur mail complet sur le VPS ?** Recevoir du
> courrier est un métier : la plupart des hébergeurs bloquent le port 25,
> et la réputation d'une IP neuve envoie tout en spam. Si vous y tenez,
> un `docker-mailserver` séparé peut fournir le relais SMTP ci-dessus —
> mais un relais géré coûte zéro et arrive dans la boîte de réception.

## 7. Landing page et console de l'exploitant

- **Landing page** : sur `companyos.fr` et `www.companyos.fr`, la racine
  affiche la page de présentation (`landing.html`) ; son lien « Se
  connecter » (`/?connexion`) renvoie vers `https://app.companyos.fr`.
  Tout autre domaine garde l'OS à la racine, la vitrine restant joignable
  sur `/landing.html`. Pour changer de domaine, modifiez les deux `map` en
  tête de `apps/web/nginx.conf`.
- **Console Plateforme** : l'application « Plateforme » montre tous les
  espaces clients (formules, membres, stockage, revenu mensuel), change
  une formule, suspend un espace ou déconnecte un compte compromis. Elle
  n'obéit qu'aux comptes listés dans `PLATFORM_ADMINS` (emails séparés par
  des virgules) — quiconque d'autre voit une porte fermée. Chaque geste est
  inscrit à votre journal **et** à celui de l'espace concerné.

### Créer le compte exploitant

L'application refuse toute inscription — ou invitation acceptée — sur une
adresse de `PLATFORM_ADMINS` : rien n'y prouve qu'on possède l'adresse, et
elle suffit à ouvrir la console. Le compte se crée donc sur le serveur,
dans le terminal du conteneur `api` (Dokploy → service → **Terminal**) :

```bash
node src/exploitant.js vous@companyos.fr --nom "Votre nom" --entreprise "CompanyOS"
```

La commande affiche un mot de passe à usage unique : connectez-vous avec,
puis changez-le dans Paramètres → Compte. Relancée sur un compte existant,
elle remplace son mot de passe et ferme toutes ses sessions — c'est la
procédure de reprise en cas de mot de passe perdu.

## 8. Données et sauvegardes

L'état de la plateforme vit dans la base PostgreSQL (comptes et toutes les
données saisies par les clients) et dans le volume `storage-data` (les
fichiers du cloud, quand ils sont sur le disque).

### Sauvegardes automatiques

L'API sauvegarde elle-même, sans rien à installer :

- **la base, chaque jour** vers 2 h UTC (`pg_dump`), gardée 14 jours ;
- **les fichiers du disque, chaque semaine** (archive `tar.gz`), gardés
  4 semaines.

Chaque copie est **relue** avant d'être déclarée bonne, et chaque tentative,
réussie ou non, apparaît dans la console **Plateforme → Santé** : date,
taille, état, téléchargement. Un échec est signalé par courriel aux
exploitants quand un relais SMTP est configuré.

Les copies sont écrites dans le volume `sauvegardes-data`, **sur le même
serveur**. Pour qu'elles survivent à sa perte, configurez un stockage objet
dans **Plateforme → Stockage** (Cloudflare R2, S3, Wasabi…) : chaque
sauvegarde de la base y est alors aussi envoyée, sous le préfixe
`_sauvegardes/`, et purgée à l'expiration.

Réglages (onglet **Environment**, tous facultatifs) :

| Variable | Défaut | Rôle |
|---|---|---|
| `SAUVEGARDE_ACTIVE` | `true` | `false` coupe les sauvegardes |
| `SAUVEGARDE_HEURE` | `2` | heure UTC de la sauvegarde quotidienne |
| `SAUVEGARDE_RETENTION_JOURS` | `14` | copies quotidiennes conservées |
| `SAUVEGARDE_FICHIERS_SEMAINES` | `4` | archives hebdomadaires conservées |

> Le client `pg_dump` de l'image est PostgreSQL 17. Si votre serveur est
> plus récent, la sauvegarde échoue avec « server version mismatch » et la
> console l'affiche : reconstruisez l'image avec
> `--build-arg PG_CLIENT=postgresql18-client`.

### Restaurer

1. Récupérez le fichier `base-….dump` : bouton **Télécharger** de la
   console, ou votre bucket, sous `_sauvegardes/`.
2. Restaurez-le dans une **base neuve** — jamais par-dessus la base en
   service :

   ```bash
   createdb -h HOTE -U UTILISATEUR companyos_restauree
   pg_restore --no-owner -h HOTE -U UTILISATEUR -d companyos_restauree base-AAAA-MM-JJTHH-MM.dump
   ```

3. Vérifiez les données, puis pointez `DATABASE_URL` sur la base restaurée
   et redéployez.

Pour les fichiers : `tar -xzf fichiers-….tar.gz -C /chemin/du/volume/storage-data`.

Faites l'exercice une fois, à blanc, avant d'en avoir besoin : une
sauvegarde qu'on n'a jamais restaurée est une hypothèse.

### Journal des erreurs

Les erreurs de l'API (500) et celles des navigateurs des clients sont
regroupées dans **Plateforme → Santé**, avec le nombre d'occurrences et la
pile d'appels. Chaque erreur nouvelle — ou résolue qui revient — est envoyée
par courriel aux adresses de `PLATFORM_ADMINS`.

## 9. Mises à jour

`git push`, puis **Deploy** (ou activez l'auto-deploy par webhook dans
l'onglet **Deployments**). Les migrations s'appliquent au démarrage ; les
volumes traversent les redéploiements intacts.

## Dépannage

- **L'écran de connexion tourne en boucle** : `CORS_ORIGIN` ne correspond
  pas exactement au domaine du front (schéma `https://` compris).
- **Le front appelle localhost:4000** : `VITE_API_URL` manquait au build —
  renseignez-la puis redéployez.
- **`Error: P3009 … migration … failed`** : une migration a échoué une
  fois et Prisma refuse depuis tout déploiement. Au démarrage,
  `prisma/reparer-migrations.js` affiche dans les journaux de l'API
  l'erreur d'origine (« Erreur d'origine : … ») et débloque seul les
  migrations écrites pour être rejouées. Pour une autre migration, corrigez
  la base puis, depuis un poste qui a `DATABASE_URL` de production :
  `npx prisma migrate resolve --rolled-back <nom>` (rien n'a été appliqué)
  ou `--applied <nom>` (appliquée à la main), et redéployez. N'utilisez
  jamais `prisma db push` sur la base de production : c'est ce qui crée ces
  écarts entre la base et l'historique des migrations.
- **`migrate deploy` échoue** : la base n'était pas prête ; le
  `depends_on: service_healthy` l'attend, mais un premier démarrage très
  lent peut nécessiter un simple redéploiement.

## Temps réel et plusieurs instances

L'API ouvre un flux Server-Sent Events par onglet (`/api/evenements`) :
notifications instantanées, rechargement des apps quand un collègue
modifie une fiche. Rien à configurer derrière Traefik ; derrière un autre
proxy, ne pas mettre en tampon les réponses `text/event-stream` (l'API
envoie `X-Accel-Buffering: no`) et laisser les connexions ouvertes au moins
60 s (un battement passe toutes les 25 s).

Plusieurs instances de l'API peuvent tourner côte à côte : les événements
passent par PostgreSQL (`LISTEN/NOTIFY`), les jetons d'URL et le verrou de
connexion sont en base. Une seule base, aucun Redis à ajouter.

## Pack entreprise : adresses à renseigner

| Variable | Sert à |
|---|---|
| `PUBLIC_URL` | lien des courriels de réinitialisation de mot de passe et d'invitation (`https://app.exemple.fr`) |
| `PUBLIC_API_URL` | adresse des liens de partage de fichiers et **adresse de redirection SSO** à déclarer chez le fournisseur d'identité : `https://api.exemple.fr/api/auth/sso/retour` |

**Authentification unique (OpenID Connect).** Le propriétaire de l'espace la
configure dans Paramètres › Sécurité : émetteur (ex.
`https://login.microsoftonline.com/<id-locataire>/v2.0`), identifiant et
secret client (chiffré en base), domaines de messagerie. Un domaine doit
être celui d'au moins un membre de l'espace et n'appartenir à aucun autre
espace. En mode « obligatoire », seul le propriétaire garde la connexion
par mot de passe (accès de secours).

**Historique des fiches** : 50 versions par fiche, fiches supprimées
récupérables 180 jours (purge automatique). **Versions de fichiers** : 10
par fichier, comptées dans le quota.

## Domaine personnalisé des liens publics

Un espace peut faire partir ses liens publics (partage de fichiers,
formulaire d'inscription, désinscription et suivi des campagnes) sous son
nom, ex. `liens.entreprise.ci` (Paramètres › Données et conformité) :

1. Le client crée chez son hébergeur DNS un **CNAME** `liens.entreprise.ci`
   → l'hôte de l'API (ex. `api.companyos.fr`).
2. L'exploitant ajoute ce domaine au service **api** dans Dokploy (Domains) :
   Traefik obtient le certificat https.
3. Le client clique « Vérifier » : l'API s'appelle par ce domaine et doit y
   trouver une preuve qu'elle seule sait calculer. Les nouveaux liens
   l'utilisent ensuite.

Sur un domaine personnalisé, seules les routes publiques répondent
(`/api/public/…` et les pages publiques des campagnes) : la connexion,
l'espace de travail et les fichiers privés restent sur l'adresse de la
plateforme. Un domaine n'appartient qu'à un espace.

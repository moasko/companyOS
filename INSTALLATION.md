# Installer CompanyOS sur un VPS, en une commande

CompanyOS s'installe sur un serveur vierge comme Dokploy : une commande, et
le serveur est prêt. Docker, le proxy HTTPS (certificats Let's Encrypt
automatiques), la base PostgreSQL, l'API, l'interface, les sauvegardes
quotidiennes et la rotation des journaux sont installés et configurés.
Aucun autre outil n'est nécessaire (plus besoin de Dokploy).

## Ce qu'il faut

- Un VPS **Ubuntu 22.04 / 24.04 ou Debian 12**, processeur x86_64.
- **2 Go de mémoire** au minimum (4 Go conseillés) et **10 Go de disque**
  libres. Sous 4 Go, l'installateur ajoute 2 Go de mémoire d'échange.
- Les ports **80 et 443 libres** : CompanyOS gère lui-même le HTTPS. Sur
  un serveur qui fait déjà tourner Dokploy, nginx ou Apache, l'installateur
  s'arrête et dit lequel.
- Un domaine, avec deux enregistrements DNS vers l'adresse IP du serveur :

  | Nom | Type | Valeur |
  |---|---|---|
  | `erp.monentreprise.ci` | A | IP du VPS |
  | `*.erp.monentreprise.ci` | A | IP du VPS (un sous-domaine par entreprise) |

  L'installation peut se faire avant que le DNS ne pointe : le HTTPS
  s'active tout seul au premier accès une fois le DNS en place.

## Installer

Connecté en SSH au serveur :

```bash
curl -fsSL https://raw.githubusercontent.com/moasko/companyOS/master/install.sh | sudo bash
```

Le script pose quatre questions (domaine, adresse de l'administrateur, nom
de l'entreprise, nom de l'administrateur), vérifie le serveur, installe
tout, puis affiche l'adresse de connexion et le mot de passe de
l'administrateur — **une seule fois** : notez-le.

Sans aucune question (provisionnement automatique) :

```bash
curl -fsSL https://raw.githubusercontent.com/moasko/companyOS/master/install.sh | sudo bash -s -- \
  --domaine erp.monentreprise.ci \
  --email admin@monentreprise.ci \
  --entreprise "Mon Entreprise" \
  --nom "Awa Koné" \
  --oui
```

Options : `--version v1.2.0` (une version précise au lieu de la dernière),
`--sans-pare-feu` (ne pas toucher à ufw), `--forcer` (système non testé).

À la première connexion, l'administrateur du serveur active la double
authentification : son compte ouvre la console d'exploitation du serveur.

## Ce que fait l'installateur

1. **Vérifie** le système, le processeur, la mémoire, le disque, les ports
   et le DNS — et explique quoi faire si quelque chose manque.
2. **Installe** ce qui manque : Docker et Docker Compose, la mémoire
   d'échange sur un petit VPS.
3. **Ferme le pare-feu** (ufw) sauf SSH, HTTP et HTTPS. Le port SSH réel
   est détecté : impossible de s'enfermer dehors.
4. **Génère les secrets** (base, sessions, chiffrement) dans
   `/opt/companyos/.env`, lisible par root seulement.
5. **Démarre la pile** décrite dans [`deploy/docker-compose.yml`](deploy/docker-compose.yml) :

   | Service | Rôle |
   |---|---|
   | `caddy` | seul service exposé (80/443) ; HTTPS automatique, certificat demandé au premier accès à chaque nom, après accord de l'API ([`deploy/Caddyfile`](deploy/Caddyfile)) |
   | `postgres` | la base, jamais exposée hors du réseau interne |
   | `api` | l'API ; applique les migrations à chaque démarrage, sauvegarde chaque nuit |
   | `web` | l'interface, servie à la même adresse que l'API |

   Les données vivent dans des volumes Docker : une mise à jour, un
   redémarrage du serveur ou de la pile ne perdent rien. Les journaux sont
   plafonnés (3 × 10 Mo par service) pour ne jamais remplir le disque.
6. **Crée l'entreprise et son administrateur**, et installe la commande
   `companyos`.

Rejouer le script sur un serveur déjà installé ne casse rien : il le
détecte et renvoie vers `companyos mise-a-jour`. Le détail de chaque
installation est dans `/var/log/companyos-install.log` (sans le mot de
passe).

## Gérer le serveur : la commande `companyos`

| Commande | Effet |
|---|---|
| `companyos statut` | services, HTTPS, mémoire, disque, consommation de chaque conteneur |
| `companyos journaux [api\|web\|caddy\|postgres]` | journaux en direct |
| `companyos redemarrer` / `arreter` / `demarrer` | cycle de vie |
| `companyos mise-a-jour [version]` | sauvegarde la base, télécharge la nouvelle version, redémarre ; les migrations s'appliquent seules |
| `companyos sauvegarde` | sauvegarde immédiate : base + fichiers |
| `companyos sauvegardes` | liste les sauvegardes du serveur |
| `companyos restaurer <fichier.dump>` | remplace une base par sa sauvegarde (confirmation demandée) |
| `companyos entreprise liste\|creer\|supprimer` | les entreprises du serveur, chacune dans sa base (voir plus bas) |
| `companyos mot-de-passe` | nouveau mot de passe pour l'administrateur du serveur |
| `companyos config` | ouvre `.env` (SMTP, sauvegardes…) puis applique |
| `companyos desinstaller [--tout]` | retire CompanyOS ; `--tout` supprime aussi les données |

Les sauvegardes automatiques tournent chaque nuit à 2 h (base chaque jour,
fichiers chaque semaine, 14 jours de conservation). Pour une copie hors du
serveur, renseignez un stockage S3 dans la console d'exploitation.

## Plusieurs entreprises sur le même serveur : une base chacune

La première entreprise (créée à l'installation) est servie sur le domaine
du serveur. Chaque entreprise ajoutée ensuite — une filiale, une société
sœur — reçoit :

- **sa propre base PostgreSQL** (`cos_<sous-domaine>`) : comptes, données,
  réglages, applications installées ; rien n'est partagé avec les autres ;
- **son sous-domaine** : `filiale-sud.erp.monentreprise.ci`, avec son
  certificat HTTPS obtenu automatiquement au premier accès ;
- **ses sauvegardes** : une archive par base, restaurable seule.

```bash
companyos entreprise creer --nom "Filiale Sud SARL" --email dg@filiale-sud.ci --admin "Koffi Aka"
companyos entreprise liste
companyos entreprise supprimer filiale-sud-sarl     # sauvegarde avant, confirmation demandée
```

La création affiche l'adresse et le mot de passe de l'administrateur de
la nouvelle entreprise. Un compte n'existe que dans la base de son
entreprise : il ne peut pas se connecter sur l'adresse d'une autre, et un
cookie de session volé sur l'une ne vaut rien sur l'autre.

Les migrations s'appliquent à toutes les bases à chaque démarrage. Les
sauvegardes de la nuit couvrent toutes les bases (`base-<date>.dump` pour
la principale, `base-<sous-domaine>-<date>.dump` pour les autres), et
`companyos restaurer <fichier>` restaure la bonne base d'après le nom.

## La console du serveur

Le compte administrateur créé à l'installation ouvre l'application
**Plateforme** (double authentification obligatoire), onglet **Serveur** :

- **la machine** : processeur, mémoire, disque, avec alerte au-delà de
  90 % ; volume total des bases et des fichiers ;
- **les entreprises** : pour chacune, son adresse, sa base de données et sa
  taille, ses membres, ses fiches, ses fichiers ;
- **ajouter une entreprise** en remplissant quatre champs (base,
  sous-domaine et administrateur créés en une vingtaine de secondes, mot
  de passe affiché une fois) ; **supprimer** une entreprise (sauvegarde de
  toutes les bases juste avant, sous-domaine à retaper pour confirmer).

Les onglets Santé, Sécurité et Maintenance donnent les sauvegardes, les
tentatives d'intrusion et les caches. Mise à jour, restauration et
journaux restent sur le serveur (`companyos …`) : l'application n'a
volontairement aucun accès à Docker. La console ne s'ouvre que depuis le
domaine principal : un compte d'une autre entreprise, même avec la même
adresse e-mail, n'y a pas accès.

## Envoi des e-mails

Facultatif : sans relais SMTP, les invitations fonctionnent par code.
`companyos config`, puis remplir `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `MAIL_FROM` (Brevo, Resend, Mailgun, un compte professionnel…).

## Versions

Les images sont publiées sur `ghcr.io/moasko/companyos-api` et
`ghcr.io/moasko/companyos-web` par GitHub Actions : `latest` suit `master`,
et chaque étiquette `vX.Y.Z` du dépôt publie la version correspondante. Le
serveur ne compile rien : il télécharge.

La même image d'interface sert n'importe quel domaine : l'adresse de l'API
est lue au démarrage du conteneur (`API_URL`, vide = même adresse que
l'interface), et non plus figée au moment de la construction.

## L'ancien déploiement Dokploy

Il reste décrit dans [DEPLOIEMENT.md](DEPLOIEMENT.md) et continue de
fonctionner : sans variable `API_URL`, l'interface garde l'adresse d'API
figée à la construction.

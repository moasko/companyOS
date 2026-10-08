# Sécurité

Ce que le produit protège, contre qui, et les règles à respecter en y
ajoutant du code.

## Le modèle de menace

CompanyOS est un SaaS multi-tenant qui héberge de la comptabilité, de la
paie, des données RH et les fichiers de plusieurs entreprises. Trois
attaquants, par ordre de probabilité :

1. **Un membre d'un espace de travail.** Il a un compte légitime, souvent
   le rôle `MEMBER`. C'est l'attaquant le plus réaliste et celui contre
   lequel la plupart des contrôles existent : il ne doit pas dépasser son
   rôle, ni sortir de son espace, ni faire agir la plateforme en son nom.
2. **Un tiers avec un jeton volé.** Même surface qu'un membre, mais sans
   compte à suspendre. C'est pourquoi la durée de vie du jeton compte.
3. **Un tiers sans compte.** Il attaque `/register`, `/login`, `/join`, les
   liens de flux et les pages de campagne — les seules routes publiques.

Ce que l'on protège, par ordre de gravité si c'est perdu : les données d'un
autre espace de travail, les secrets de configuration (S3, SMTP), la
réputation d'envoi du domaine, la disponibilité.

## Les règles

### 1. Toute requête de données est filtrée sur le tenant

```js
// oui
await prisma.record.updateMany({
  where: { id, tenantId: request.tenantId },
  data,
});

// non — modifie la donnée d'un autre client si l'id vient de la requête
await prisma.record.update({ where: { id }, data });
```

`request.tenantId` est posé par `authenticate` à partir du compte relu en
base. Il ne vient jamais du corps, de l'URL ni d'un en-tête.

### 2. Le contrôle vit sur le serveur

Cacher un bouton n'est pas une autorisation. Toute règle qui compte doit
tenir quand la requête arrive sans passer par l'écran : `exigerRole`,
validation zod, vérification d'appartenance.

Corollaire, souvent oublié : **une validation écrite dans un module du
shell n'existe pas.** Si le serveur en a besoin, elle va dans
`packages/shared` et il l'appelle lui aussi.

### 3. Un moteur de fond ne fait pas confiance à la fiche qu'il lit

Les campagnes, les modèles de courrier et les factures sont des `Record`,
et les `Record` s'écrivent par le CRUD générique. Tout moteur qui agit à
partir d'une fiche doit revalider ce qu'elle contient : adresses,
appartenance à l'espace, bornes.

C'est la leçon la plus chère du projet : `POST /api/records/campagnes/campagnes`
suffisait à faire envoyer des courriels arbitraires, au nom de
l'entreprise, depuis un relais avec SPF/DKIM valides.

### 4. Rien qui vient du réseau n'est du HTML de confiance

Une réponse distante peut annoncer `text/html`, un fichier importé peut
déclarer n'importe quel type MIME. Servi tel quel depuis l'origine de
l'API, cela s'exécute.

- types MIME : liste blanche, sinon `application/octet-stream` ;
- `X-Content-Type-Options: nosniff` sur tout ce qui est servi ;
- `Content-Disposition` sur tout ce qui n'est pas un média à afficher ;
- le HTML tiers (`/api/web/voir`) porte sa propre CSP avec la directive
  `sandbox` **en en-tête** — celle-là, le client ne peut pas la retirer.

### 5. Un secret ne ressort jamais

Écrire un mot de passe SMTP ou une clé S3 : oui. Le relire par l'API :
jamais. On renvoie un booléen (`motDePasseDefini`) ou les quatre derniers
caractères (`masquer()`).

En base, ils sont chiffrés — AES-256-GCM, `chiffrement.js`. Le chiffrement
authentifié n'est pas un luxe : sans lui, un accès en écriture à la base
permet de faire pointer le stockage ailleurs sans que rien ne le détecte.

Attention aux routes qui renvoient un objet entier : `settings` d'une
installation contient les réglages de l'app, donc potentiellement des
secrets. Filtrer à la sortie.

### 6. Ce qui est aléatoire et secret vient de `node:crypto`

Codes d'invitation, jetons de lien, identifiants de session : `randomInt`,
`randomUUID`, `randomBytes`. Jamais `Math.random()`, dont l'état interne se
reconstitue à partir de quelques sorties observées.

### 7. Tout envoi de courriel passe par le compteur

`quota-mail.js`, plafond commun aux trois chemins d'envoi. Un nouveau
chemin d'envoi appelle `peutEnvoyer` avant et `compterEnvois` après.

### 8. Les mutations sont journalisées

`journaliser(request, "objet.action", cible, details)`. Le journal n'a pas
de route de suppression, y compris pour le propriétaire — c'est
volontaire. N'y mettez donc jamais de secret ni de contenu de fichier.

## Ce qui est en place

| Domaine | État |
| --- | --- |
| Isolation multi-tenant | filtrage systématique, vérifié sur les 11 fichiers de routes |
| Mots de passe | bcrypt, 12 tours |
| Rôles | `exigerRole`, hiérarchie MEMBER < ADMIN < OWNER |
| Accès par application | règle par installation (`src/acces.js`), appliquée dans `routes/records.js` ; Paie et RH réservées aux administrateurs par défaut ; annuaire des salariés sans données sensibles pour les autres apps |
| Sessions | `sessionVersion` dans le jeton : révocation au changement de mot de passe, « déconnecter mes appareils », déconnexion par un admin ou l'exploitant |
| Compte exploitant | aucune création depuis l'application sur une adresse de `PLATFORM_ADMINS` ; adresses normalisées |
| Limitation de débit | globale + serrée sur login, join, register, envoi, web |
| En-têtes | helmet côté API, CSP et HSTS côté nginx |
| SSRF | classement IP par `ipaddr.js`, IP validée **épinglée** à la connexion, revalidation à chaque redirection |
| Traversée de chemin | `nomSansChemin` + `cheminSur`, double barrière |
| Secrets stockés | AES-256-GCM, jamais relus en clair |
| Quota d'envoi | par espace, par 24 h, commun aux trois chemins |
| Dépendances | CI, `npm audit --omit=dev --audit-level=high` |

## Ce qui reste ouvert

- **Le jeton de session est en `localStorage`, valable 7 jours.** Il est
  désormais révocable (`sessionVersion`), mais une XSS pourrait encore le
  lire : l'application analyse des fichiers utilisateur (docx, pptx, pdf)
  avec des bibliothèques tierces, dans l'origine du front. La vraie réponse
  reste un cookie `HttpOnly` avec protection CSRF.
- **Les fichiers du cloud ne suivent pas les règles d'accès des
  applications** : un bulletin exporté en PDF dans un dossier partagé est
  lisible par tout l'espace.
- **Montée de formule en libre-service**, réglée sur facture : aucune
  facture d'abonnement n'est générée ni suivie automatiquement.
- **Le pilote S3 assemble l'objet en mémoire** ; la limite d'import a été
  abaissée en attendant l'envoi par tranches.
- **Désinscription de campagne en GET** : les proxys d'analyse de liens
  (SafeLinks, proxy d'images) la déclenchent sans clic humain.
- **Le secret JWT sert à trois usages** (sessions, jetons de suivi,
  chiffrement de repli). À dériver par usage.

## Signaler une faille

Écrivez à l'exploitant de la plateforme plutôt que d'ouvrir une issue
publique. Une faille d'isolation entre espaces de travail est à traiter
comme un incident, pas comme un bug.

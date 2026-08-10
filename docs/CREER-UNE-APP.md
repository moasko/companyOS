# Créer une application CompanyOS

Guide complet et autonome. Il suppose seulement que vous savez lire du React.

---

## 1. Comment le système est fait

CompanyOS a trois couches.

**Le shell** (`src/`) — le bureau, les fenêtres, la barre des tâches, le menu
Démarrer. C'est un fork de win11React : React 18 + Vite + Redux (sans Toolkit)
+ SCSS. Pas de TypeScript.

**L'API** (`server/`) — Fastify + Prisma + PostgreSQL. Elle porte les comptes,
les espaces de travail (tenants), le quota, le catalogue d'applications, les
fichiers et les **données des modules**.

Un espace de travail contient **plusieurs personnes**, pas une seule : des
membres avec des rôles, des invitations, des notifications entre eux et un
journal de ce qui s'y passe. Écrivez chaque module pour cette réalité —
« qui a saisi ceci », « à qui est-ce attribué », « cette personne a-t-elle le
droit ». La partie 7 rassemble ce qu'il faut savoir.

**Les modules** (`src/apps/modules/<slug>/`) — les applications métier. Elles
s'installent depuis la Boutique. **Un module non installé n'existe pas dans le
shell** : ni icône sur le bureau, ni entrée au menu Démarrer, ni fenêtre montée
dans le DOM.

Deux familles d'applications coexistent :

| Famille | Où | Installable ? |
| --- | --- | --- |
| Socle (Explorateur, Boutique, Terminal, Bloc-notes, Calculatrice, Paramètres, Gestionnaire de tâches, Corbeille) | `src/containers/applications/apps/` | non, toujours présent |
| Modules métier (CRM, Facturation, Stock, Générateur QR…) | `src/apps/modules/<slug>/` | oui, depuis la Boutique |

Une troisième voie existe : le **Studio** (`src/apps/modules/studio/`) permet de
créer une application **sans écrire de code**, depuis le shell. Le navigateur ne
peut pas écrire dans les sources : une app créée ainsi est donc *décrite*
(collections + champs) et exécutée par le moteur générique
`src/apps/CustomApp.jsx`. Elle vit dans la base, appartient à son espace de
travail, et n'apparaît jamais dans la Boutique des autres clients.

Prenez le Studio quand l'application se résume à saisir et consulter des
fiches. Écrivez un module quand il faut des calculs, un rendu particulier, ou
du dialogue avec d'autres modules.

**Ce guide traite des modules.** C'est ce qu'on crée au quotidien.

---

## 2. Créer un module en quatre étapes

### Étape 1 — copier le modèle

```bash
cp -r src/apps/modules/_template src/apps/modules/rh
```

Le dossier `_template` est ignoré par le registre (les dossiers préfixés `_` ne
sont jamais chargés), il ne s'affichera donc jamais dans le shell.

### Étape 2 — le manifeste

Dans `src/apps/modules/rh/index.jsx` :

```js
export const manifest = {
  slug: "rh",              // = le slug du catalogue serveur
  name: "Ressources humaines", // affiché partout dans le shell
  icon: "people",          // un PNG de public/img/icon/, sans extension
  action: "RHAPP",         // action Redux, en MAJUSCULES
  Window: RhApp,           // le composant de la fenêtre
};
```

Trois règles à ne pas enfreindre :

- **`icon` doit être unique** dans tout le shell : c'est la clé de l'état de la
  fenêtre dans Redux (`state.apps[icon]`). Deux modules avec la même icône
  partageraient la même fenêtre.
- **`action` doit être unique** : c'est ce qui déclenche l'ouverture.
- **`slug` doit correspondre** exactement au slug du catalogue côté serveur.

Vérifiez que l'icône existe : `ls public/img/icon/`.

### Étape 3 — déclarer l'app au catalogue

Dans `server/prisma/seed.js`, ajoutez une entrée :

```js
{
  slug: "rh",
  name: "Ressources humaines",
  description: "Salariés, contrats, congés et absences.",
  icon: "people",
  category: "Gestion",
  kind: "NATIVE",
},
```

Puis :

```bash
cd server && node prisma/seed.js
```

Le seed fait un `upsert` : le relancer est sans danger.

### Étape 4 — écrire la fenêtre

`ModuleWindow` fournit tout le chrome : barre de titre, réduire / agrandir /
fermer, déplacement, z-index, et le fait de ne rien rendre si le module n'est
pas installé.

```jsx
export function RhApp() {
  return (
    <ModuleWindow manifest={manifest} className="rhApp">
      …votre contenu…
    </ModuleWindow>
  );
}
```

**Rien d'autre à câbler.** `src/apps/registry.js` découvre le dossier tout seul
via `import.meta.glob`. Aucun import à ajouter dans `App.jsx` ni ailleurs.

---

## 3. Mise en page

### Choisir sa structure

La charte vient du générateur QR (`src/apps/modules/qrcode/`), qui sert de
référence visuelle. Mais **n'ajoutez pas de barre latérale ni de panneau de
droite si le module n'en a pas besoin.**

- La **colonne centrale** est toujours là.
- La **barre latérale** ne se justifie qu'à partir de 4 panneaux environ.
- Le **panneau de droite** ne se justifie que s'il y a vraiment quelque chose à
  garder sous les yeux : un aperçu qui change en direct, un total qui bouge,
  une action principale qui doit rester atteignable.

| Module | Structure |
| --- | --- |
| `qrcode` | barre latérale + centre + aperçu (le QR change en direct) |
| `facturation` | barre latérale + centre + panneau (total et statut) |
| `crm` | barre latérale + centre + panneau (fiche du client) |
| `stock` | **une seule colonne** — rien à prévisualiser |

### La barre latérale est un jeu d'onglets

Les entrées de la barre latérale **ne font pas défiler une longue page** : ce
sont des onglets. Un seul panneau est visible à la fois.

```jsx
const SECTIONS = [
  { id: "salaries", label: "Salariés", icon: "faUsers" },
  { id: "conges", label: "Congés", icon: "faUmbrellaBeach" },
  { id: "analytics", label: "Analytics", icon: "faChartColumn" },
];

const [section, setSection] = useState("salaries");

const goToSection = (id) => {
  setSection(id);
  scrollElementTo(mainRef.current, 0); // on repart du haut
};
```

```jsx
<aside className="rhNav">
  {SECTIONS.map((s) => (
    <div
      key={s.id}
      className="rhNavItem handcr"
      data-active={section === s.id}
      onClick={() => goToSection(s.id)}
    >
      <Icon fafa={s.icon} width={13} />
      <span>{s.label}</span>
    </div>
  ))}
</aside>

<div className="rhMain win11Scroll" ref={mainRef}>
  <section className="rhSection" data-hidden={section !== "salaries"}>
    <h2><span className="rhNum">1.</span> Salariés</h2>
    <p className="rhHint">Une phrase qui explique la section</p>
    …
  </section>
  …
</div>
```

Le masquage se fait en CSS :

```scss
.rhSection {
  &[data-hidden="true"] {
    display: none;
  }
}
```

Un onglet peut contenir plusieurs sections numérotées (le générateur QR met
« 1. Type de contenu » et « 2. Contenu » dans le même onglet).

### Taille de la fenêtre

Une fenêtre **s'ouvre en taille normale**, jamais en plein écran : c'est un
choix qui appartient à l'utilisateur. Déclarez la taille sous
`&.floatTab[data-size="mini"]`, jamais à la racine de la classe — sinon le
bouton « agrandir » n'aurait plus d'effet.

```scss
.rhApp {
  &.floatTab[data-size="mini"] {
    width: 72%;
    height: 74%;
    top: 11%;
    left: 14%;
    min-width: 700px;
    min-height: 460px;
  }
}
```

Le sélecteur inclut `.floatTab` pour l'emporter sur la règle générique
`.floatTab[data-size="mini"]`, qui a la même spécificité sans lui.

---

## 4. Habillage

### Jetons de thème

Déclarez les couleurs en variables CSS sur la classe racine du module, et
donnez leur équivalent sombre. **Ne codez jamais une couleur en dur** dans une
règle : le thème sombre est cassé dès qu'on le fait.

```scss
.rhApp {
  --rh-bg: #ffffff;
  --rh-panel: #f8f9fb;
  --rh-card: #ffffff;
  --rh-line: #e3e6eb;
  --rh-text: #1f2733;
  --rh-muted: #6b7684;
  --rh-accent: #1a73e8;
  --rh-accent-soft: #e8f0fe;
  --rh-field: #ffffff;
  --rh-green: #188038;
  --rh-amber: #b06000;
  --rh-red: #d93025;
}

body[data-theme="dark"] .rhApp {
  --rh-bg: #1b1b22;
  --rh-panel: #202029;
  --rh-card: #262630;
  --rh-line: #35353f;
  --rh-text: #e8e8ee;
  --rh-muted: #9a9aa8;
  --rh-accent: #6f8dff;
  --rh-accent-soft: #2a3050;
  --rh-field: #262630;
  --rh-green: #6cd08a;
  --rh-amber: #e0b060;
  --rh-red: #f08078;
}
```

### Composants du répertoire

Copiez-les depuis un module existant, ils sont identiques partout :

| Élément | Classe | Usage |
| --- | --- | --- |
| Titre de section | `h2` + `<span className="rhNum">1.</span>` | en-tête numéroté |
| Sous-titre | `.rhHint` | une phrase grise sous le titre |
| Champ | `.rhField` + `.rhLabel` | libellé au-dessus, bord accentué au focus |
| Pastille de choix | `.rhChip` + `data-active` | filtres, catégories |
| Interrupteur | `.rhToggle` + `data-on` | booléens |
| Liste | `.rhList` + `.rhRow` + `data-active` | tableaux et listes |
| Étiquette d'état | `.rhTag` + `data-tone` | statuts colorés |
| Bouton principal | `.rhPrimary` | l'action de la fenêtre |
| Bouton secondaire | `.rhBtnGhost` | actions annexes |
| Avertissement | `.rhWarn` | encadré ambre |
| Zone vide | `.rhEmptyBox` | pointillés, message d'aide |
| Message éphémère | `.rhNotice` | retour d'action, disparaît seul |

Le retour d'action se fait toujours par un `flash` :

```js
const [notice, setNotice] = useState("");
const flash = (msg) => {
  setNotice(msg);
  setTimeout(() => setNotice(""), 3000);
};
```

### Icônes

`<Icon fafa="faUsers" width={13} />` pour FontAwesome (tout le paquet solid est
disponible), `<Icon src="people" width={22} />` pour un PNG de
`public/img/icon/`.

---

## 5. Données

### Aucune migration à écrire

Chaque module range ses enregistrements dans des collections libres, via la
table générique `records`. Les données sont **automatiquement cloisonnées par
espace de travail** : un module ne voit jamais celles d'un autre client.

```js
import { api } from "../../../api/client";

// module, collection — les deux sont des noms libres en minuscules
await api.records.create("rh", "salaries", { nom: "Awa Koné", poste: "Directrice" });
const salaries = await api.records.list("rh", "salaries");
await api.records.update("rh", "salaries", id, { ...donnees });
await api.records.remove("rh", "salaries", id);
```

Un enregistrement renvoyé a la forme `{ id, data, createdAt, updatedAt }` : vos
champs sont dans `data`.

Contraintes : 500 enregistrements par lecture (les plus récents d'abord), 64 Ko
par enregistrement.

Quand un module se stabilise, on peut le sortir vers de vraies tables typées
dans `server/prisma/schema.prisma` sans changer son interface.

### Charger au bon moment

Ne réécrivez pas le cycle de chargement : utilisez le hook commun.

```jsx
import { Contenu, useChargement } from "../../chargement";

const charger = async () => {
  const [clients, opps] = await Promise.all([…]);
  setClients(clients);
  setOpps(opps);
};

const etat = useChargement(ouvert, charger);
```

**Ne mettez pas de `try/catch` dans `charger`** : le hook a besoin de
recevoir l'erreur pour l'afficher en place avec un bouton « Réessayer ». Un
message éphémère de trois secondes laisse une fenêtre vide sans explication.

Puis protégez l'état vide — c'est le vrai piège :

```jsx
{etat.initial || etat.erreur ? (
  <Contenu etat={etat} vide={false} lignes={7} />
) : !visibles.length ? (
  <MonEtatVide />
) : (
  …la liste…
)}
```

Sans cette garde, la fenêtre affiche « Aucun client » pendant le chargement.
La phrase est fausse, et pousse à recréer des fiches qui existent déjà.

Après une écriture, appelez **`etat.rafraichir()`** et non `charger()` : le
rafraîchissement est silencieux, l'écran a déjà son contenu et le remplacer
par un squelette le ferait clignoter à chaque enregistrement.

### Charger au bon moment — l'ancien texte

Chargez à l'ouverture de la fenêtre, pas au montage — la fenêtre est montée en
permanence, juste masquée :

```js
useEffect(() => {
  if (wnapp && !wnapp.hide && session.status === "authenticated") load();
}, [wnapp?.hide, session.status]);
```

### Lire les données d'un autre module

C'est encouragé : un seul référentiel pour tout l'OS, jamais de saisie en
double. Prévoyez le cas où l'autre module n'est pas installé.

```js
const clients = await api.records.list("crm", "clients").catch(() => []);
const articles = await api.records.list("stock", "articles").catch(() => []);
```

C'est ainsi que la Facturation reprend les clients du CRM et les prix du Stock.

---

## 6. Fichiers

**Règle absolue : tout fichier produit ou importé par une application atterrit
dans le cloud de l'espace de travail**, donc dans l'Explorateur. Jamais un
simple téléchargement navigateur — sinon le fichier sort du produit : invisible
pour les collègues, non décompté du quota facturé.

Quand c'est **l'utilisateur** qui demande d'enregistrer, utilisez `saveAs` : il
ouvre le cloud pour qu'il choisisse le dossier et le nom, comme dans
l'Explorateur.

```js
import { saveAs, dataUrlToBlob } from "../../cloud";

const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
const node = await saveAs(blob, "export.csv", { folder: manifest.name });
if (node) flash(`« ${node.name} » enregistré dans l'Explorateur`);
// node vaut null si l'utilisateur annule
```

`saveToCloud` a la même signature mais écrit directement dans le dossier du
module sans rien demander : à réserver aux écritures automatiques.

Les deux dédoublonnent le nom (« export (2).csv »), mettent à jour le quota et
rafraîchissent l'Explorateur. Un bouton de téléchargement local peut exister
**en plus**, jamais à la place.

Pour un CSV lisible par Excel, préfixez d'un BOM UTF-8 et séparez par des
points-virgules :

```js
const csv = "﻿" + lignes.join("\r\n");
```

---

## 7. Travailler à plusieurs

Un espace de travail n'est plus une personne : il a des membres, des rôles, un
journal, et un moyen de se parler. Trois choses à connaître.

### Prévenir quelqu'un

Deux gestes différents, une seule porte d'entrée — `src/apps/notifications.js`.

**Sur ce poste**, quand personne d'autre n'est concerné (« export terminé ») :

```js
import { notifier } from "../../notifications";

notifier({ titre: "Facture créée", message: "2026-004", app: manifest.name,
           ton: "success" }); // info (défaut) | success | warning | error
```

**À une personne de l'espace**, quand quelqu'un doit être au courant. La
notification vit sur le serveur et suit la personne d'un poste à l'autre,
qu'elle soit connectée ou non :

```js
import { envoyerA } from "../../notifications";

await envoyerA(idMembre, {
  source: manifest.slug,
  titre: `Tâche attribuée : ${carte.data.titre}`,
  message: "Refonte du site · échéance 07/08/2026",
  lien: { app: manifest.id, params: { carte: carte.id } },
});
```

Le premier argument accepte un identifiant de membre, un tableau
d'identifiants, ou `"tous"`. Les identifiants viennent de `api.members()`,
route ouverte à tous les rôles — attribuer une tâche suppose de savoir à qui.

`lien` décrit **où mène le clic**. Le shell ouvre l'application puis émet
l'événement `companyos:lien` ; c'est à l'application de savoir quoi en faire :

```js
useEffect(() => {
  const aller = (e) => {
    if (e.detail.app !== manifest.id) return;
    const carte = cartes.find((c) => c.id === e.detail.params.carte);
    if (carte) setCarteOuverte(carte);
  };
  window.addEventListener("companyos:lien", aller);
  return () => window.removeEventListener("companyos:lien", aller);
}, [cartes]);
```

Piège : au premier lancement, le clic arrive **avant** les données. Gardez la
demande de côté et rejouez-la au chargement — voir `lienEnAttente` dans
`src/apps/modules/projets/index.jsx`, qui traite les deux cas.

`envoyerA` n'échoue jamais bruyamment : prévenir est secondaire par rapport à
l'action qui l'a déclenchée. N'attendez pas son résultat pour enregistrer, et
n'annulez rien si elle échoue.

Une notification est une information **adressée**, pas un journal. Une
notification par enregistrement modifié ne sera plus lue au bout d'un jour.

### Le catalogue produits

Un produit n'appartient pas à l'application Stock : il appartient à
l'entreprise. La Facturation le vend, les Achats le commanderont. N'allez
donc **jamais** lire `api.records.list("stock", "articles")` directement —
passez par le référentiel, qui met en cache, partage une seule requête entre
modules et sait déjà calculer les niveaux de stock :

```js
import { referentiel, choisirProduit } from "../../referentiel";

const produits = await referentiel.produits();
const stock = await referentiel.stockDe(id);
```

Pour faire désigner un produit à l'utilisateur, ouvrez le sélecteur commun
plutôt qu'une liste déroulante — au-delà de trente références, dérouler
n'est plus praticable, et on veut voir l'image et le stock avant de choisir :

```js
const p = await choisirProduit({ titre: "Ajouter une ligne" });
if (p) ajouterLigne(p.data.designation, p.data.prixVente);
```

Le sélecteur rend le produit choisi, ou `null` si on referme. Il est monté
une fois par le shell : rien d'autre à importer.

Si votre module **écrit** dans le catalogue, appelez `invaliderReferentiel()`
après coup, sinon les écrans ouverts à côté travaillent sur des données
périmées.

### Le fichier client

Même principe que le catalogue : les clients vivent dans le CRM par leur
écran, mais appartiennent à l'entreprise par leur usage.

```js
import { referentiel, choisirClient } from "../../referentiel";

const clients = await referentiel.clients();
const c = await choisirClient({ titre: "Choisir le client" });
```

Une règle qui a l'air d'un détail et n'en est pas : quand un document est
émis — devis, facture, bon de livraison — **recopiez** les coordonnées du
client dedans plutôt que de garder seulement son identifiant. Une facture
doit rester identique des années plus tard, même si le client déménage.
Gardez l'identifiant **en plus**, pour retrouver la fiche.

### Afficher une personne

Jamais de balise `<img>` posée à la main sur `session.user.avatar` : la photo
est facultative, et la moitié des membres n'en auront pas. Utilisez `Avatar`,
qui retombe sur les initiales colorées :

```jsx
import { Avatar } from "../../Avatar";

<Avatar user={membre} taille={30} />   // photo si elle existe, sinon « AK »
<Avatar nom="Awa Koné" taille={26} />  // quand on n'a que le nom
```

La couleur est tirée du nom : la même personne garde la même pastille d'un
écran à l'autre et d'un poste à l'autre, ce qui la rend reconnaissable dans une
liste avant même d'en lire le nom.

Les photos arrivent avec `api.members()`, déjà réduites à 256 px et incluses
dans la réponse — rien à charger en plus, aucune requête par ligne.

### Un menu contextuel

Construisez-le au clic droit, à partir de ce qui est visé. Le composant de
menu ne connaît ni les fichiers ni les applications : il place et affiche.

```jsx
import { menuContextuel } from "../../menuRequest";

onContextMenu={(e) => menuContextuel(e, [
  { nom: "Ouvrir", icone: "faFolderOpen", action: () => ouvrir(node) },
  famille && { nom: `Ouvrir avec ${famille.label}`, image: famille.icone,
               action: () => ouvrirFichier(node) },
  { separateur: true },
  { nom: "Renommer", icone: "faPen", raccourci: "F2", desactive: !seul,
    action: () => renommer(node) },
  { nom: "Supprimer", icone: "faTrashCan", danger: true, action: supprimer },
])}
```

Une entrée `false` ou `null` est ignorée : c'est ce qui permet d'écrire
`condition && { … }` sans construire la liste en deux temps.

Deux règles apprises à l'usage : **ne proposez jamais une entrée qui ne fera
rien** — mieux vaut l'absence ou `desactive: true`, qui montre que la
fonction existe. Et **sélectionnez la cible** si le clic droit tombe hors
sélection, sinon le menu agit sur des éléments que l'utilisateur ne regarde
plus.

### Afficher un modèle 3D

L'OS embarque une visionneuse 3D (three.js, chargé à la demande, donc absent
du premier chargement). Elle s'ouvre comme les autres visionneuses, par le
type du fichier :

```js
import { ouvrirFichier } from "../../openRequest";

ouvrirFichier(node, voisins);   // .glb .gltf .obj .stl .fbx .ply .dae
```

Rien d'autre à importer : `src/apps/fileTypes.js` associe l'extension à la
fenêtre, et l'Explorateur comme vos modules empruntent le même chemin.

### Signer les fiches

Chaque enregistrement revient du serveur avec `auteur` et `modifiePar` —
identité et photo comprises, sans requête supplémentaire par ligne. Posez la
signature en bas du formulaire de détail :

```jsx
import { Auteur } from "../../Auteur";

{selectedId ? <Auteur record={records.find((r) => r.id === selectedId)} /> : null}
```

`userId` ne change jamais, `updatedById` est réécrit à chaque modification :
« saisi par Awa » reste vrai des mois après que quelqu'un d'autre a tout
réécrit, et on voit les deux.

Les suppressions de fiches partent au journal d'activité : il n'y a pas de
corbeille pour les données métier, c'est la seule trace qui reste.

### Versionner son module

Un module porte sa version et ce qui a changé :

```js
export const manifest = {
  id: "stock",
  version: "2.0.0",
  nouveautes: [
    { version: "2.0.0", texte: "Catégories, images de produits, inventaire." },
  ],
  /// Facultatif : reprise des données, jouée une seule fois à la mise à
  /// jour, avec la version d'où l'on vient (`null` si inconnue).
  migrer: async (depuis) => { … },
  Window: StockApp,
};
```

La Boutique compare cette version à celle enregistrée pour l'espace de
travail et propose la mise à jour. Le code, lui, est déjà là — il arrive
avec le shell : **ce que la mise à jour fait vraiment, c'est lancer
`migrer`**, puis enregistrer la nouvelle version. C'est le seul endroit de
l'OS où des données existantes sont retouchées, et c'est tracé au journal.

Sans `migrer`, ne montez la version que si vous avez quelque chose à
annoncer : une pastille qui s'allume sans raison apprend à être ignorée.

### Le journal d'activité

Les actions qui changent l'espace — membres, rôles, applications, fichiers —
sont journalisées côté serveur (`server/src/audit.js`) et relues par les
administrateurs dans Paramètres → Journal d'activité.

Votre interface n'a rien à appeler : c'est la route qui journalise. Si votre
module ajoute une route serveur qui modifie l'espace, ajoutez-y un appel :

```js
await journaliser(request, "stock.transfert", article.nom, { de, vers });
```

Le verbe suit la forme `objet.action` ; ajoutez sa traduction dans la table
`ACTIONS` de `src/containers/applications/apps/settings.jsx`. Une action
inconnue s'affiche telle quelle — lisible, mais laid.

Rien n'efface le journal, pas même le propriétaire de l'espace. N'y mettez donc
jamais de secret : mot de passe, jeton, contenu de fichier.

### Rôles et permissions

Trois rôles, du plus faible au plus fort : `MEMBER`, `ADMIN`, `OWNER`.

```js
const role = useSelector((state) => state.session.user?.role);
const peutGerer = ["OWNER", "ADMIN"].includes(role);
```

Servez-vous-en pour **ne pas montrer** ce qui échouerait — jamais pour protéger
quoi que ce soit. Cacher un bouton est une politesse, pas une autorisation :
toute règle qui compte est appliquée par le serveur (`exigerRole` dans
`server/src/auth.js`), et une requête peut très bien arriver sans passer par
votre écran.

Corollaire pratique : en cas de doute, appelez la route et affichez l'erreur
renvoyée. C'est plus juste qu'une devinette côté client, et cela reste correct
le jour où les règles changent.

---

## 8. Langue et devise

L'OS s'affiche en français ou en anglais, et convertit les montants à l'écran
(FCFA, euro, dollar) selon le réglage **Paramètres → Langue et région** — par
défaut déduit du lieu (langue du navigateur, devise selon le fuseau horaire).
Une app n'a pas à connaître i18next ni les taux de change : tout passe par
`src/utils/intl.js`.

### Les textes

Déclarez vos libellés par langue, à côté du composant, et traduisez avec
`useTraduction` :

```jsx
import { useTraduction } from "../../../utils/intl";

const TEXTES = {
  fr: { titre: "Mes clients", compteur: "{n} fiche(s)" },
  en: { titre: "My customers", compteur: "{n} record(s)" },
};

function MonApp() {
  const t = useTraduction(TEXTES);
  return <h2>{t("titre")}</h2>; // se re-rend si la langue change
}
```

Le repli est **par clé** : une entrée absente en anglais garde sa version
française plutôt que de disparaître, et une clé inconnue s'affiche telle
quelle. `{nom}` s'interpole via le second argument : `t("compteur", { n: 3 })`.

Hors React (un `domaine.js`, un PDF), `creerTraducteur(TEXTES)` rend le même
`t()`, qui lit la langue au moment de l'appel.

Le français d'abord : écrivez `fr` complet, ajoutez `en` au même moment si
vous le pouvez — sinon le repli fait le pont, sans trou à l'écran.

### Les montants

Les données vivent en franc CFA ; la conversion n'existe qu'à l'écran, à
l'indicatif. Ne formatez **jamais** un montant à la main (`` `${n} F` `` est un
bug) : passez par le kit.

```jsx
import { useDevise } from "../../../utils/intl";

const { montant, montantDans } = useDevise();
montant(15000);          // « 15 000 F », « 22,87 € » ou « $25 » selon le réglage
montantDans(120, "EUR"); // « 120 € » — la devise propre d'un document, sans conversion
```

`montant()` pour tout ce qui est stocké en FCFA — c'est le cas général.
`montantDans()` pour un document qui porte sa propre devise (une facture en
euros reste en euros, quel que soit le réglage d'affichage). Hors React,
importez les mêmes fonctions depuis `src/utils/monnaie.js` — c'est ce que font
déjà les `fcfa()` des modules existants, qui n'en sont plus que des alias.

Le modèle `_template` montre les deux usages en place.

---

## 9. Pièges déjà rencontrés

Chacun a coûté un bug réel dans ce projet.

### Toujours mettre à jour un état de formulaire par fonction

```js
// ✗ `draft` vient de la closure du rendu courant. Si plusieurs champs
//   changent avant le rendu suivant (collage, remplissage auto, saisie
//   rapide), les modifications précédentes sont écrasées — et un formulaire
//   fraîchement ouvert peut hériter des données de la fiche précédente.
setDraft({ ...draft, [key]: value });

// ✓
setDraft((d) => ({ ...d, [key]: value }));
```

### Jamais `scrollIntoView`

Cette méthode fait défiler **tous** les ancêtres défilables, et `overflow:
hidden` n'empêche pas le défilement par programme : le bureau entier se
déplace. Utilisez les helpers de `src/apps/scrollTo.js`, qui ne touchent qu'au
conteneur visé.

```js
import { scrollElementTo, scrollSectionIntoView } from "../../scrollTo";
```

### Jamais `scroll-behavior: smooth` en CSS

Cette propriété détourne aussi les affectations directes de `scrollTop`, et là
où le moteur n'anime pas (onglet en arrière-plan, navigateur embarqué) le
défilement ne se produit jamais. L'animation est faite en JavaScript dans
`scrollTo.js`, qui garantit d'arriver à destination.

### Confiner le défilement dans la fenêtre

Une colonne latérale sans zone de défilement propre laisse la molette remonter
au premier ancêtre défilable — donc au bureau. La règle globale de
`src/utils/scroll.scss` s'en charge pour `aside` et `nav` ; si vous créez une
colonne d'un autre type, ajoutez-lui `overflow-y: auto; overscroll-behavior:
contain;`.

### Attention aux noms de fichiers sur Windows

Le système de fichiers est insensible à la casse : `SavePicker.jsx` et
`savePicker.js` entrent en collision à la résolution d'import. Donnez des noms
distincts, pas seulement par la casse.

### Vérifier l'unicité des identifiants métier

Deux brouillons ouverts en même temps calculent le même numéro de facture. Si
votre module numérote quelque chose, refusez le doublon à l'enregistrement :

```js
const duplicate = items.find((i) => i.id !== selectedId && i.data.numero === draft.numero.trim());
if (duplicate) {
  flash(`Le numéro ${draft.numero} est déjà utilisé — essayez ${nextNumero()}`);
  return;
}
```

### Ne pas stocker ce qui se calcule

Le Stock ne mémorise aucun niveau : il est la somme des mouvements. C'est ce
qui garantit que le compteur et le journal ne peuvent pas diverger.

---

## 10. Lancer et vérifier

```bash
cd server && npm run dev
```

```bash
npm start
```

Le shell écoute sur `http://localhost:5173`, l'API sur `http://localhost:4000`.

Ensuite, dans le navigateur :

1. Ouvrir la **Boutique** — votre module doit apparaître au catalogue.
2. **Installer** — l'icône doit apparaître immédiatement sur le bureau.
3. **Ouvrir** — la fenêtre s'ouvre en taille normale, pas en plein écran.
4. Cliquer chaque **onglet** de la barre latérale — un seul panneau visible, et
   le bureau ne bouge pas.
5. **Désinstaller** — l'icône et la fenêtre disparaissent.
6. `npm run build` doit passer.

---

## 11. Aide-mémoire

```
src/apps/
├── README.md            résumé de ce guide
├── registry.js          découverte automatique des modules
├── ModuleWindow.jsx     chrome de fenêtre commun
├── sync.js              installé ↔ présent dans le shell
├── cloud.js             saveAs / saveToCloud
├── scrollTo.js          défilement confiné
├── saveRequest.js       promesse du sélecteur d'emplacement
├── SavePicker.jsx       boîte « Enregistrer sous »
├── notifications.js     notifier (ce poste) / envoyerA (une personne)
├── Avatar.jsx           photo ou initiales colorées
├── image.js             redimensionner / choisir une image
├── referentiel.js       produits et clients, partagés par tout l'OS
├── SelecteurProduit.jsx sélecteur de produit commun
├── SelecteurClient.jsx  sélecteur de client commun
├── versions.js          comparaison de versions, mises à jour
├── fileTypes.js         quelle app ouvre quel fichier
├── modalRequest.js      modal.confirm / alert / prompt / open
├── windows.js           ouvrir, fermer, remonter une fenêtre
└── modules/
    ├── _template/       à copier
    ├── qrcode/          référence visuelle, exports vectoriels
    ├── crm/             maître/détail, sous-collection liée
    ├── facturation/     calculs, lecture inter-modules, PDF sans dépendance
    └── stock/           une seule colonne, valeur dérivée
```

| Besoin | Où regarder |
| --- | --- |
| Une liste avec fiche de détail | `crm` |
| Des calculs et des totaux | `facturation` |
| Un aperçu qui change en direct | `qrcode` |
| Un module simple, une colonne | `stock` |
| Générer un PDF | `facturation/pdf.js` |
| Générer une image ou du vectoriel | `qrcode/render.js` |
| Un formulaire à types multiples | `qrcode/types.js` |
| Prévenir un collègue | `projets` — `prevenirAssigne` |
| Réagir à un clic sur notification | `projets` — `lienEnAttente` |
| Adapter l'écran au rôle | `settings.jsx` — `peutGerer` |
| Afficher une personne | `Avatar.jsx` |
| Réduire une image avant envoi | `image.js` — `redimensionnerImage` |
| Un catalogue avec images et rayons | `stock` |
| Une arborescence de catégories | `stock/domaine.js` — `arbre`, `branche` |
| Des règles métier testables | `stock/domaine.js`, `facturation/domaine.js`, `crm/domaine.js`, `rh/domaine.js` |
| Des calculs de dates | `rh/domaine.js` — `joursOuvrables`, `ancienneteMois` |
| Un réglage propre à l'espace | `rh` — collection `reglages`, un seul enregistrement |
| Un pipeline glisser-déposer | `crm` — `CarteAffaire` |
| Une scène 3D | `objet3d/moteur.js` |
| Un état déduit et non saisi | `facturation/domaine.js` — `etatPaiement` |
| Des textes en FR et EN | `utils/intl.js` — `useTraduction`, exemple dans `_template` |
| Afficher un montant | `utils/intl.js` — `useDevise().montant`, jamais `` `${n} F` `` |
| Une numérotation par année | `facturation/domaine.js` — `prochainNumero` |

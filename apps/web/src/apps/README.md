# Modules CompanyOS

> Guide complet et autonome : [docs/CREER-UNE-APP.md](../../docs/CREER-UNE-APP.md).
> Ce fichier n'en est que le résumé.

Un module est une application métier installable depuis la Boutique.
**Un module non installé n'existe pas dans le shell** : ni icône sur le bureau,
ni entrée au menu Démarrer, ni fenêtre montée.

## Créer une app en 4 étapes

**1. Copier le modèle**

```bash
cp -r src/apps/modules/_template src/apps/modules/facturation
```

**2. Adapter le manifeste** dans `index.jsx`

```js
export const manifest = {
  id: "facturation",       // identité de la fenêtre — UNIQUE dans l'OS
  slug: "facturation",     // = le slug du catalogue serveur (installation)
  name: "Facturation",     // affiché partout dans le shell
  icon: "msoffice",        // un PNG de public/img/icon/ — PAS une clé :
                           // plusieurs apps peuvent partager la même image
  Window: FacturationApp,
};
```

Seul `id` doit être unique. `icon` est un fichier : le Studio et le
générateur QR partagent « code » sans se gêner.

Pour ouvrir ou fermer une fenêtre, depuis n'importe où :

```js
import { ouvrirFenetre, fermerFenetre } from "../../windows";

ouvrirFenetre("facturation");
```

Le champ `action` (chaîne Redux propre à l'app) existe encore pour les
modules qui n'ont pas migré — il n'est plus nécessaire pour une app neuve.

**Applications système.** Ajoutez `systeme: true` au manifeste : l'app est
alors montée d'office, sans passer par la Boutique, et n'apparaît ni sur le
bureau ni dans le catalogue. C'est ce que sont Photos, Musique, Vidéo et le
Presse-papiers — une visionneuse doit exister avant qu'on lui donne un
fichier à ouvrir. Pas de slug, pas d'entrée dans `seed.js`, rien à
installer.

**3. Déclarer l'app au catalogue** dans `server/prisma/seed.js`, avec le même
slug, puis :

```bash
cd server && node prisma/seed.js
```

**4. Écrire la fenêtre.** `ModuleWindow` fournit le chrome (barre de titre,
réduire / agrandir / fermer, déplacement, z-index) :

```jsx
<ModuleWindow manifest={manifest} className="factApp">
  ...votre contenu...
</ModuleWindow>
```

Rien d'autre à câbler : `src/apps/registry.js` découvre le dossier tout seul.

## Mise en page

**Utilisez le kit `src/apps/ui/`.** La charte n'est plus une consigne à
relire, c'est du code : les jetons de thème sont posés une fois pour toutes
sur `.moduleWin`, et les composants les utilisent. Une app ordinaire n'a
donc *aucune* feuille de style à écrire.

```jsx
import { Coquille, Nav, Centre, Section, Champ, Bouton, Vide } from "../../ui";

<Coquille>
  <Nav sections={SECTIONS} actif={section} onChoisir={setSection} />
  <Centre>
    <Section numero={1} titre="Contenu" aide="Ce que contiendra le document.">
      <Champ label="Titre">
        <input value={titre} onChange={(e) => setTitre(e.target.value)} />
      </Champ>
      <Bouton icone="faCheck" onClick={valider}>Enregistrer</Bouton>
    </Section>
  </Centre>
</Coquille>
```

Disponibles : `Coquille`, `Nav`, `Centre`, `Panneau`, `Section`, `Champ`,
`Ligne`, `Colonnes`, `Bouton` (principal / secondaire / danger), `Chips`,
`Bascule`, `Notice`, `Vide`, `Barre`, `Espace`.

Les jetons, si vous écrivez du style qui vous est propre : `--app-bg`,
`--app-panneau`, `--app-carte`, `--app-champ`, `--app-line`, `--app-text`,
`--app-muted`, `--app-accent`, `--app-accent-soft`, `--app-ok`,
`--app-attention`, `--app-danger`, `--app-rayon`, `--app-ombre`. **Aucune
couleur en dur** : le thème sombre est géré par ces variables.

Les modules antérieurs (QR, CRM, Facturation, Stock, Studio, Word, Projets)
gardent leurs jetons propres — les deux systèmes coexistent, rien n'est à
migrer en urgence. `src/apps/modules/pressepapiers/` montre à quoi
ressemble un module sur le kit : une centaine de lignes de style au lieu de
deux cent cinquante, et pas une couleur écrite en dur.

Mais **ne mettez pas de barre latérale ni de panneau d'aperçu si le module n'en
a pas besoin.** La colonne centrale suffit souvent. Ajoutez la nav quand il y a
assez de sections pour s'y perdre (4 et plus), et le panneau de droite quand il
y a vraiment quelque chose à garder sous les yeux — un aperçu vivant, un total
qui bouge, une action principale qui doit rester atteignable.

| Module        | Mise en page                                    |
| ------------- | ----------------------------------------------- |
| `qrcode`      | nav + centre + aperçu (le QR change en direct)   |
| `facturation` | nav + centre + panneau (total et statut)         |
| `crm`         | nav + centre + panneau (fiche du client)         |
| `stock`       | **une seule colonne** — rien à prévisualiser     |

## Charger les données d'une fenêtre

```jsx
import { Contenu, useChargement } from "../../chargement";

const etat = useChargement(ouvert, charger);   // pas de try/catch dans charger
```

Protégez l'état vide, sinon la fenêtre affiche « Aucun client » pendant le
chargement — une phrase fausse :

```jsx
{etat.initial || etat.erreur ? <Contenu etat={etat} vide={false} lignes={7} />
 : !visibles.length ? <MonEtatVide /> : …la liste…}
```

Après une écriture : `etat.rafraichir()`, qui recharge sans faire clignoter.

## Persister des données

Aucune migration à écrire. Chaque module range ses enregistrements dans des
collections libres, cloisonnées par espace de travail :

```js
await api.records.create("facturation", "factures", { client: "Awa", total: 250000 });
const factures = await api.records.list("facturation", "factures");
await api.records.update("facturation", "factures", id, { ...donnees });
await api.records.remove("facturation", "factures", id);
```

Les données vivent en JSONB dans la table `records`. Quand un module se
stabilise, on le sort vers de vraies tables typées sans changer son interface.

### Lire les données d'une autre application

Déclarez-le dans le manifeste, et passez par l'accesseur :

```js
export const manifest = {
  id: "projets",
  capacites: {
    lit: ["crm:clients", "facturation:factures"],
    ecrit: ["facturation:factures"],
  },
  // …
};

const donnees = accesDonnees(manifest);

await donnees.lire("cartes");                 // chez soi, rien à déclarer
await donnees.lire("crm", "clients");         // ailleurs, déclaré
await donnees.creer("facturation", "factures", { … });
```

Un accès non déclaré **lève une erreur en développement** (avec la ligne
exacte à ajouter) et se contente d'un avertissement en production — couper
une app déjà installée ferait pire que le mal. Les accès déclarés sont
montrés à l'utilisateur dans la Boutique **avant** l'installation.

> À lire avant de s'y fier : `src/apps/donnees.js` explique pourquoi ce
> n'est **pas** une barrière de sécurité. Toutes les apps partagent le même
> contexte JavaScript ; n'importe laquelle peut importer `api` et
> contourner l'accesseur. C'est un contrat lisible et un garde-fou de
> développement, pas un bac à sable. Le seul cloisonnement réellement
> appliqué est côté serveur : l'isolation par espace de travail, et le refus
> qu'une app du Studio prenne le slug d'une app du catalogue.

## Écrire des fichiers

**Règle : tout fichier produit ou importé par une app va dans le cloud du
tenant**, donc dans l'Explorateur. Jamais un simple téléchargement navigateur —
sinon le fichier sort du produit : invisible pour les collègues, non décompté
du quota facturé.

Quand c'est **l'utilisateur** qui demande d'enregistrer, utilisez `saveAs` :
il ouvre le cloud pour qu'il choisisse le dossier et le nom, comme dans
l'Explorateur.

```js
import { saveAs, dataUrlToBlob } from "../../cloud";

const blob = await dataUrlToBlob(canvas.toDataURL());
const node = await saveAs(blob, "rapport.png", { folder: manifest.name });
if (node) flash(`« ${node.name} » enregistré`); // null si l'utilisateur annule
```

`saveToCloud` a la même signature mais écrit directement dans le dossier du
module, sans rien demander : à réserver aux écritures automatiques.

Les deux dédoublonnent le nom (« rapport (2).png »), mettent à jour le quota
et rafraîchissent l'Explorateur. Un bouton de téléchargement local peut
exister **en plus**, jamais à la place.

## Demander quelque chose à l'utilisateur

**N'utilisez jamais `window.confirm`, `window.alert` ni `window.prompt`.** Ils
bloquent le fil d'exécution, sortent du thème de l'OS et affichent le nom de
domaine — dans un OS web, ça casse l'illusion. Passez par `modal`, qui rend une
boîte maison et renvoie une promesse :

```js
import { modal } from "../../modalRequest";

// Confirmation — résout true / false
const ok = await modal.confirm({
  title: "Supprimer l'article",
  message: `Supprimer « ${draft.designation} » ?`,
  detail: "Ses mouvements de stock partent avec lui.", // facultatif
  confirmLabel: "Supprimer",
  danger: true, // bouton rouge
});
if (!ok) return;

// Saisie — résout la chaîne (déjà élaguée) ou null si annulé
const nom = await modal.prompt({ title: "Nouveau dossier", label: "Nom" });

// Information — résout true à la fermeture
await modal.alert({ title: "Envoyé", message: "…", tone: "success" });
```

Un simple message suffit quand il n'y a rien à préciser :
`await modal.confirm("Continuer ?")`.

`tone` (`info` | `success` | `warning` | `error`) colore l'icône et le bouton.
`modal.open({ render: ({ close }) => <VotreContenu onDone={close} /> })` sert aux
boîtes sur mesure : `close(valeur)` résout la promesse.

Les boîtes s'empilent — une confirmation ouverte depuis une boîte déjà à
l'écran se pose par-dessus. Échap et le clic sur le fond écartent celle du
dessus avec l'issue la plus prudente (`false` pour une confirmation, `null` pour
une saisie) ; `persistent: true` l'en empêche quand une décision est obligatoire.

**Toute action destructive passe par une confirmation** : suppression d'un
enregistrement, d'un fichier ou d'un dossier, désinstallation d'une app.
L'installation, elle, ne demande rien — elle est réversible d'un clic.

## Supprimer un fichier

`api.deleteNode(id)` **met à la corbeille**, il n'efface rien : l'élément
disparaît des listes, ses octets restent stockés et comptés dans le quota, et
il revient intact avec `api.restoreNode(id)`. Passé 30 jours, il est purgé au
premier passage sur la corbeille.

```js
await api.deleteNode(id);        // → corbeille, réversible
await api.listTrash();           // ce que l'utilisateur a supprimé
await api.restoreNode(id);       // → { renommé, remontéÀLaRacine }
await api.purgeNode(id);         // définitif, octets et quota libérés
await api.emptyTrash();          // idem, pour tout
```

Supprimer un dossier emporte son contenu : tout le sous-arbre reçoit le même
`trashId`, et la corbeille n'affiche que la racine du geste. Une restauration
n'est pas toujours à l'identique — le nom a pu être repris (l'élément revient
en « rapport (2).pdf ») ou le dossier d'origine avoir disparu (l'élément
remonte à la racine). `restoreNode` le signale, prévenez l'utilisateur.

## Prévenir quelqu'un

Deux gestes différents, une seule porte d'entrée — `src/apps/notifications.js`.

**Signaler quelque chose sur ce poste** : « export terminé », « QR code
généré ». Local, transitoire, personne d'autre n'est concerné.

```js
import { notifier } from "../../notifications";

notifier({
  titre: "Facture créée",
  message: "2026-004",
  app: manifest.name,
  ton: "success", // info (défaut) | success | warning | error
});
```

**Prévenir une personne de l'espace de travail** : « je t'ai attribué cette
tâche », « ta commande est validée ». La notification vit sur le serveur et
suit la personne d'un poste à l'autre, qu'elle soit connectée ou non.

```js
import { envoyerA } from "../../notifications";

await envoyerA(idMembre, {
  source: manifest.slug,
  titre: `Tâche attribuée : ${carte.data.titre}`,
  message: "Refonte du site · échéance 07/08/2026",
  lien: { app: manifest.id, params: { carte: carte.id } },
});
```

`a` accepte un identifiant de membre, un tableau d'identifiants, ou la chaîne
`"tous"` pour tout l'espace. Les identifiants viennent de `api.members()`.

`lien` décrit **où mène le clic**. Le shell ouvre l'application puis émet
`companyos:lien` ; c'est à l'application de savoir quoi en faire :

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

Attention : au premier lancement, le clic précède le chargement des données.
Gardez la demande de côté et rejouez-la quand les données arrivent — voir
`lienEnAttente` dans `src/apps/modules/projets/index.jsx`.

`envoyerA` n'échoue jamais bruyamment : prévenir quelqu'un est secondaire par
rapport à l'action qui l'a déclenchée. **N'attendez pas son résultat pour
enregistrer**, et n'annulez rien si elle échoue.

Une notification est une information adressée, pas un journal. N'y mettez pas
ce que personne n'attend : une notification par enregistrement modifié ne sera
plus lue au bout d'une journée.

## Le catalogue produits

Ne lisez jamais `api.records.list("stock", "articles")` en direct : le
catalogue est un référentiel d'entreprise, avec cache partagé et calcul des
niveaux de stock.

```js
import { referentiel, choisirProduit } from "../../referentiel";

const produits = await referentiel.produits();
const p = await choisirProduit();   // sélecteur visuel commun, ou null
```

Si vous écrivez dans le catalogue, appelez `invaliderReferentiel()` ensuite.

## Le fichier client

```js
import { referentiel, choisirClient } from "../../referentiel";

const c = await choisirClient();   // sélecteur visuel commun, ou null
```

Dans un document émis, **recopiez** les coordonnées du client plutôt que de
ne garder que son identifiant : une facture doit rester identique même si le
client déménage. Gardez l'identifiant en plus.

## Afficher une personne

Jamais d'`<img>` posée à la main sur `user.avatar` : la photo est facultative.
`Avatar` retombe sur les initiales, colorées d'après le nom — donc stables d'un
écran à l'autre.

```jsx
import { Avatar } from "../../Avatar";

<Avatar user={membre} taille={30} />
<Avatar nom="Awa Koné" taille={26} />
```

Pour envoyer une image quelconque, réduisez-la d'abord :
`redimensionnerImage(fichier, { cote: 256 })` dans `src/apps/image.js`.

## Un menu contextuel

```jsx
import { menuContextuel } from "../../menuRequest";

onContextMenu={(e) => menuContextuel(e, [
  { nom: "Ouvrir", icone: "faFolderOpen", action: () => ouvrir(node) },
  { separateur: true },
  { nom: "Supprimer", icone: "faTrashCan", danger: true, action: supprimer },
])}
```

Une entrée `false`/`null` est ignorée — pratique pour `condition && { … }`.
Ne proposez jamais une entrée qui ne fera rien : `desactive: true` plutôt.

## Afficher un modèle 3D

```js
import { ouvrirFichier } from "../../openRequest";

ouvrirFichier(node, voisins);   // .glb .gltf .obj .stl .fbx .ply .dae
```

La visionneuse 3D fait partie du socle ; three.js est chargé à la demande.

## Signer les fiches

Chaque enregistrement revient du serveur avec `auteur` et `modifiePar`, photo
comprise. Posez la signature en bas du formulaire de détail :

```jsx
import { Auteur } from "../../Auteur";

{selectedId ? <Auteur record={records.find((r) => r.id === selectedId)} /> : null}
```

Les suppressions de fiches partent au journal : il n'y a pas de corbeille pour
les données métier.

## Ce que fait le journal d'activité

Les actions qui changent l'espace — membres, rôles, applications, fichiers —
sont journalisées **côté serveur**, dans `server/src/audit.js`. Les
administrateurs les relisent dans Paramètres → Journal d'activité.

Vous n'avez rien à appeler : c'est la route qui journalise, pas l'interface.
Si votre module ajoute une route serveur qui modifie l'espace, ajoutez-y un
appel :

```js
await journaliser(request, "stock.transfert", article.nom, { de, vers });
```

Le verbe suit la forme `objet.action`. Ajoutez sa traduction dans `ACTIONS`,
au début de `src/containers/applications/apps/settings/Journal.jsx` — une
action inconnue s'affiche telle quelle, ce qui est lisible mais laid.

Rien n'efface le journal, y compris le propriétaire de l'espace. N'y mettez
donc jamais de secret : mot de passe, jeton, contenu de fichier.

## Rôles et permissions

Trois rôles, du plus faible au plus fort : `MEMBER`, `ADMIN`, `OWNER`.

```js
const role = useSelector((state) => state.session.user?.role);
const peutGerer = ["OWNER", "ADMIN"].includes(role);
```

Servez-vous-en pour **ne pas montrer** ce qui échouera — pas pour protéger
quoi que ce soit. Cacher un bouton est une politesse, jamais une autorisation :
toute règle qui compte est appliquée par le serveur (`exigerRole` dans
`server/src/auth.js`), et une requête peut arriver sans passer par votre écran.

Corollaire pratique : appelez la route même si vous doutez du rôle, et
affichez l'erreur renvoyée. C'est plus juste qu'une devinette côté client.

## Piège à connaître : les formulaires

Toujours mettre à jour un état de formulaire avec la forme **fonctionnelle** :

```js
// ✗ `draft` vient de la closure du rendu courant. Si plusieurs champs
//   changent avant le rendu suivant (collage, remplissage auto, saisie
//   rapide), les modifications précédentes sont écrasées — et un formulaire
//   fraîchement ouvert peut hériter des données de la fiche précédente.
setDraft({ ...draft, [key]: value });

// ✓
setDraft((d) => ({ ...d, [key]: value }));
```

## Exemples complets

- `src/apps/modules/qrcode/` — six types de contenu, options d'apparence,
  historique partagé via `api.records`, export cloud via `saveToCloud`.
- `src/apps/modules/crm/` — liste maître/détail, recherche, filtres, sous-
  collection liée (opportunités rattachées à un client), export CSV.
- `src/apps/modules/facturation/` — lignes calculées, lecture des clients et
  des articles d'autres modules (`api.records.list("crm", "clients")`),
  génération PDF sans dépendance (`pdf.js`).
- `src/apps/modules/stock/` — module en une seule colonne, sans nav ni panneau.
  Le stock n'est jamais stocké : il se déduit de la somme des mouvements, donc
  rien ne peut diverger de l'historique.

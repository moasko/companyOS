# Migration des icônes — état des lieux et suite

## Ce qui a été fait

30 icônes SVG originales dans `public/img/icon/cos/`, plus un résolveur
`src/utils/iconesCos.js` branché sur le composant `Icon` de
`src/utils/general.jsx` (une ligne modifiée).

**Aucun manifeste d'application n'a été touché.** Un module qui déclare
`icon: "excel"` reçoit maintenant `img/icon/cos/stock.svg`. Le résolveur
retombe sur l'ancien PNG pour tout nom absent de la table, donc rien ne
casse et la migration peut continuer icône par icône.

## Deux découvertes pendant l'inventaire

**1. Sur les 53 PNG de `icon/`, seuls 23 sont référencés par le code.**
Les 30 autres sont des vestiges du fork Win11React : `edge`, `minecraft`,
`soltaire`, `cortana`, `defender`, `pinterest`, `spotify`, `skype`,
`onenote`, `powerpoint`, `paint`, `snip`, `narrator`… Ils ne sont chargés
par rien et peuvent être supprimés sans risque.

**2. Quatre icônes déclarées n'existent pas sur le disque.** Ces modules
affichaient une image cassée :

| Module | `icon:` déclaré | Fichier attendu |
|---|---|---|
| Traitement de texte | `winWord` | `icon/winWord.png` — absent |
| Lecteur PDF | `pdf` | `icon/pdf.png` — absent |
| Presse-papiers | `clipboard` | `icon/clipboard.png` — absent |
| Visionneuse 3D | `objet3d` | `icon/objet3d.png` — absent |

Les quatre sont désormais couvertes par le jeu SVG.

## Table de correspondance

| Ancien PNG | Nouvelle icône | Utilisé par |
|---|---|---|
| `home` | `demarrer` | Démarrer |
| `search` | `recherche` | Recherche |
| `settings` | `parametres` | Paramètres |
| `taskmanager` | `taches` | Gestionnaire de tâches |
| `explorer` | `explorateur` | Explorateur de fichiers |
| `terminal` | `terminal` | Terminal |
| `store` | `boutique` | Boutique |
| `bin0` / `bin1` | `corbeille` / `corbeille-pleine` | Corbeille |
| `notepad` | `blocnotes` | Bloc-notes |
| `notes` | `notes` | modèle de module |
| `winWord` ⚠ | `editeur` | Traitement de texte |
| `pdf` ⚠ | `pdf` | Lecteur PDF |
| `clipboard` ⚠ | `pressepapiers` | Presse-papiers |
| `todo` | `projets` | Projets |
| `excel` | `stock` | Stock |
| `msoffice` | `facturation` | Facturation |
| `people` | `crm` | CRM |
| `photos` | `photos` | Photos |
| `movies` | `video` | Vidéo |
| `groove` | `musique` | Musique |
| `objet3d` ⚠ | `objet3d` | Visionneuse 3D |
| `code` | `studio` | Studio, QR Code |
| `calculator` | `calculatrice` | Calculatrice |
| — | `qrcode` | *nouveau, à câbler* |

⚠ = le PNG d'origine n'existait pas.

Pour que le générateur de QR Code cesse de partager l'icône du Studio :
dans `src/apps/modules/qrcode/index.jsx`, remplacer `icon: "code"` par
`icon: "qrcode"`.

## Logos de marques tierces

Les PNG `excel`, `msoffice`, `groove`, `store` du dossier d'origine ne sont
pas des icônes « inspirées de » Microsoft : ce sont les fichiers d'icônes de
Microsoft. C'est de l'œuvre graphique protégée, et le problème n'est pas la
ressemblance mais la redistribution — d'autant plus dans un produit vendu à
des entreprises, où afficher un logo Excel sur un module de gestion de stock
suggère une intégration Microsoft qui n'existe pas.

Les quatre sont désormais remplacés. Cinq connecteurs génériques couvrent
les autres cas (`connecteur-chat`, `-mail`, `-drive`, `-depot`, `-visio`) :
la convention est d'illustrer *la fonction* (messagerie, dépôt de code) et
non le fournisseur.

Si CompanyOS intègre un jour réellement Slack ou GitHub, l'usage nominatif
du logo est admis, mais il faut alors récupérer le fichier officiel depuis
le brand kit de l'éditeur et en respecter les règles — pas reprendre le PNG
hérité du fork.

## Reste à traiter

**Hors icônes, même origine.** L'inventaire a fait apparaître d'autres
résidus du fork qui posent le même problème pour un produit commercial :

- `src/reducers/dir.json` — le faux système de fichiers contient
  `Microsoft OneDrive`, `Windows Defender`, `OneNote notebooks`,
  `Outlook Files`, et les dossiers personnels de l'auteur original
  (`blueedgetechno`, `blueedgetechno.github.io`).
- `src/reducers/globals.js` — les rubans de la Boutique listent
  `xbox gamepass`, `spotify`, `forza horizon`, `netflix`, `whatsApp`,
  `office`, `lightroom`.
- `src/containers/applications/wnapp.scss` — classes `.edgeBrowser`,
  `.edgenavicon`, `.spotify`, `.discordWn`.

**Couche UI — fait.** Voir la section suivante.

**`icon/win/`** (40 fichiers : dossiers, disques, Ce PC, corbeille de
l'explorateur) reste sur les PNG d'origine. Le résolveur les sert inchangés.

---

# Pictogrammes système — `src/utils/iconesUi.jsx`

Les 61 PNG de `icon/ui/` étaient monochromes **mais pas de la même
couleur** : `wifi.png` est noir, `settings.png` est blanc. Le thème sombre
était rattrapé au cas par cas avec `filter: invert(1)`, ce qui inversait
aussi les glyphes déjà clairs — d'où des icônes invisibles selon le thème.

Les 55 pictogrammes réellement utilisés sont maintenant des tracés dessinés
en `currentColor`, dans un module unique. La couleur vient de la CSS
environnante : un même fichier est noir sur barre claire et blanc sur barre
sombre, sans filtre ni seconde image.

Grille 24×24, trait 2, extrémités arrondies — les conventions de Lucide, que
tu peux donc mélanger sans rupture visuelle si tu ajoutes des glyphes plus
tard.

Le composant `Icon` teste `aUnGlypheUi(props.src)` avant de retomber sur
`img/icon/ui/<nom>.png`. Un nom absent du module continue donc de charger
son PNG : la migration est réversible glyphe par glyphe.

Restent sur PNG, faute d'usage repéré dans le code : `Apps`, `Contact`,
`Icon.targetsize-256`, `blueProf`, `defAccount`, `google`, `tesla`,
`dustbin` doublonné avec `bin`, `sort0` variante de `sort`. Les deux
derniers logos (`google`, `tesla`) relèvent du même problème de marque que
les icônes d'applications et devraient simplement disparaître.

---

# Fonds d'écran — `public/img/wallpaper/`

`default/img0.jpg` était **Bloom**, le fond emblématique de Windows 11, en
3840×2400. `dark/` et `ThemeA` à `ThemeD` étaient les thèmes Glow et Flow
officiels. C'était l'écran de démarrage, l'écran de verrouillage et le
bureau — soit tout ce qu'un client voit avant même d'ouvrir une fenêtre.

Six fonds SVG les remplacent, construits sur la tuile squircle du jeu
d'icônes agrandie et pivotée : la cohérence n'est pas une ressemblance de
palette, c'est littéralement la même forme.

| Fond | Thème appliqué |
|---|---|
| `clair` | light |
| `sombre` | dark |
| `aurore` | dark |
| `prairie` | light |
| `ambre` | light |
| `nuit` | dark |

Plus `lock.svg` pour l'écran de verrouillage, assombri en haut et en bas
pour que l'heure et le nom d'utilisateur restent lisibles.

Environ 1 Ko par fond au lieu de ~2 Mo, et net à toute définition puisque
`back.scss` applique déjà `background-size: cover` et que les SVG portent
`preserveAspectRatio="xMidYMid slice"`.

Fichiers modifiés : `src/reducers/wallpaper.js` (liste et thèmes),
`src/containers/applications/apps/settings.jsx` (`THEMES_FOND` et les
vignettes), `src/containers/background/index.jsx` (`lock.svg`).

Un point à connaître : la liste est passée de 18 à 6 entrées. Un `wps`
mémorisé dans le `localStorage` d'une session antérieure pouvait pointer
hors du tableau et donner un bureau sans fond — le reducer ramène désormais
l'indice dans les bornes au démarrage.

## À supprimer

Les anciens JPEG ne sont plus référencés nulle part :

```
public/img/wallpaper/default/  public/img/wallpaper/dark/
public/img/wallpaper/ThemeA/   public/img/wallpaper/ThemeB/
public/img/wallpaper/ThemeC/   public/img/wallpaper/ThemeD/
public/img/wallpaper/lock.jpg
```

Une vingtaine de fichiers, quelques dizaines de mégaoctets servis à chaque
client. Je ne les ai pas effacés — à toi de le faire une fois le rendu
validé dans le navigateur.

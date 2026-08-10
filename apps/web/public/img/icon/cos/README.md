# Jeu d'icônes CompanyOS

Icônes d'applications originales, en remplacement des PNG hérités de
Win11React (qui reprenaient les visuels Microsoft).

Ouvrir `preview.html` dans un navigateur pour la planche complète.

## Règles de construction

**Format** — SVG, `viewBox="0 0 48 48"`, aucun `<style>`, aucune police.
Rendu net de 16 px à 256 px, ~400 à 700 octets par fichier.

**La tuile** — c'est la signature de la famille. Squircle 48×48 dont trois
coins ont un rayon de 13 et le coin **bas-gauche** un rayon de 4. Cette
asymétrie est ce qui rend le jeu reconnaissable ; ne pas la modifier.

```
<path d="M13 0h22a13 13 0 0 1 13 13v22a13 13 0 0 1-13 13H4a4 4 0 0 1-4-4V13A13 13 0 0 1 13 0Z" fill="…"/>
```

**Le glyphe** — deux tons uniquement : blanc plein pour la forme
principale, blanc à `opacity=".5"` – `".75"` pour le secondaire. Les
détails *à l'intérieur* d'une forme blanche (lignes d'un document,
touches d'une calculatrice) sont peints dans la couleur de la tuile à
`opacity=".45"`, jamais en gris.

**Zone utile** — 12 → 36. Déborder jusqu'à 11 ou 37 est toléré pour une
forme large (cadre photo, enveloppe), jamais au-delà.

**Épaisseur de trait** — 3 à 3,5 pour un glyphe porteur de sens, 2,2 à 2,6
pour du détail interne. `stroke-linecap="round"` partout.

**Pas de dégradé, pas d'ombre, pas de contour sur la tuile.** Si une icône
n'est pas lisible à 16 px en aplat, c'est le glyphe qu'il faut simplifier.

## Palette par catégorie

| Catégorie | Couleur | Hex |
|---|---|---|
| Socle système | ardoise | `#1E293B` `#334155` `#475569` `#64748B` |
| Fichiers / dossiers | ambre | `#F59E0B` |
| Documents | indigo | `#4338CA` `#4F46E5` `#6366F1` |
| Métier — chiffres | émeraude | `#047857` `#059669` |
| Métier — relations | ambre foncé | `#D97706` |
| Média | magenta | `#BE185D` `#C026D3` `#DB2777` |
| Développement / 3D | violet | `#7C3AED` |
| Calcul | sarcelle | `#0D9488` |
| Connecteurs | cyan | `#0284C7` `#0369A1` `#0891B2` `#0EA5E9` |
| Marque (Démarrer, Boutique) | bleu | `#2563EB` |
| Alerte / PDF | rouge | `#DC2626` |

La couleur porte l'information : à deux tuiles vertes correspondent deux
apps qui manipulent des chiffres. Choisir la couleur d'après la catégorie,
pas d'après le goût.

## Ajouter une icône

1. Copier un SVG existant de la même catégorie, garder la tuile telle quelle.
2. Dessiner le glyphe dans la zone 12 → 36.
3. Ajouter le nom (sans extension) à `ICONES_COS` dans
   `src/utils/iconesCos.js`.
4. Vérifier à 16 px dans `preview.html`.

## Ce que ce jeu ne couvre pas

`icon/ui/` (barre des tâches, volume, wifi, fenêtres) et `icon/win/`
(dossiers de l'explorateur) sont encore les PNG d'origine. Le résolveur les
sert inchangés. Pour cette couche, un jeu open source sous licence MIT
— Lucide, Phosphor ou Tabler — est le bon choix : ce sont des pictogrammes
d'interface sans identité de marque, les redessiner n'apporte rien.

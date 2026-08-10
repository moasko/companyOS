# @companyos/shared

Les règles métier que **le shell et l'API appliquent toutes les deux**.

## Pourquoi ce paquet existe

Avant, le serveur importait directement des fichiers du front :

```js
// apps/api/src/campagnes.js — l'ancienne version
import { htmlDe } from "../../src/apps/modules/campagnes/domaine.js";
```

Cela fonctionnait, mais avec deux conséquences fâcheuses :

1. **Une modification faite « côté écran » changeait le comportement du serveur**
   sans que personne ne s'en aperçoive. C'est exactement ce qui a rendu
   exploitable l'injection HTML dans les mails de campagne (variable `couleur`
   interpolée sans échappement) : le correctif appliqué au front ne protégeait
   rien tant que le serveur lisait le même fichier.
2. Le `Dockerfile` de l'API devait copier une partie du front pour démarrer.

Le code partagé vit maintenant ici, explicitement, et les deux côtés le
consomment de la même façon.

## Ce qui a le droit d'entrer ici

Du JavaScript **pur** : pas de React, pas de `window`, pas de `prisma`, pas
d'accès réseau. Des fonctions qui prennent des données et rendent des données.

Concrètement : calculs de totaux, validation de format, règles d'échéance,
génération de gabarits. Tout ce dont le serveur a besoin pour ne pas refaire
confiance au client — et dont le client a besoin pour afficher la même chose
que ce que le serveur calculera.

## Utilisation

```js
import { totaux, etatPaiement } from "@companyos/shared/facturation";
import { adresseValide } from "@companyos/shared/courrier";
import { htmlDe, estMure } from "@companyos/shared/campagnes";
```

## Modules

| Module        | Contenu                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `facturation` | Totaux HT/TVA/TTC, états de paiement, retards, numérotation, balance âgée |
| `courrier`    | Validation d'adresses, gabarits et variables, extraits                   |
| `campagnes`   | Audience, maturité d'une campagne, rendu HTML de l'email, résumés        |

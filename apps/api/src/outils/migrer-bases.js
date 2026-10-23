// Au démarrage du conteneur, après la base principale : migrations et
// catalogue de chaque base d'entreprise (voir src/entreprises.js).
// Une base en échec est signalée sans empêcher l'API de démarrer.

import { deconnecterTout } from "../db.js";
import { mettreAniveauToutes } from "../entreprises.js";

await mettreAniveauToutes();
await deconnecterTout();

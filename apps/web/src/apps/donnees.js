// Accès aux données, médiatisé par les capacités déclarées.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUE CE FICHIER EST, ET CE QU'IL N'EST PAS
//
// Ce n'est **pas** une barrière de sécurité, et il ne faut pas le présenter
// comme telle. Toutes les applications de CompanyOS partagent le même
// contexte JavaScript : n'importe laquelle peut importer `api` directement
// et contourner ce fichier en une ligne. Une capacité déclarée ne peut donc
// pas *empêcher* un accès.
//
// Ce qu'elle fait, et qui a de la valeur :
//   — elle rend les dépendances entre apps explicites et lisibles ;
//   — elle permet de dire à l'utilisateur, avant d'installer, ce que l'app
//     ira lire et écrire ;
//   — elle attrape les erreurs honnêtes en développement, là où un accès
//     oublié passerait sinon inaperçu jusqu'en production.
//
// Une vraie barrière suppose que chaque application s'exécute dans son
// propre contexte (iframe ou worker, communication par messages) et qu'elle
// reçoive un jeton que les autres ne peuvent pas lire. C'est le jour où des
// tiers publieront du code qu'il faudra le faire — pas avant, et pas à
// moitié : une demi-barrière donne un faux sentiment de sécurité.
//
// Le seul cloisonnement réellement appliqué aujourd'hui l'est côté serveur :
// isolation par espace de travail (toujours), et confinement des
// applications du Studio à leur propre espace de noms — voir
// server/src/routes/records.js. Celui-là tient, parce que le Studio n'exécute
// pas de code : c'est le moteur générique qui appelle l'API pour lui.
// ─────────────────────────────────────────────────────────────────────────

import { api } from "../api/client";

const DEV = import.meta.env.MODE === "development";

/// Une capacité s'écrit « module:collection », ou « module:* » pour tout un
/// module. Le module lui-même est toujours accessible sans déclaration :
/// une app est chez elle dans ses propres données.
const autorise = (capacites = [], module, collection) =>
  capacites.some((c) => {
    const [m, col] = String(c).split(":");
    return m === module && (col === "*" || col === collection);
  });

const refus = (manifest, verbe, module, collection) => {
  const message =
    `${manifest.name} tente ${verbe === "lire" ? "de lire" : "d'écrire"} ` +
    `${module}:${collection} sans l'avoir déclaré. ` +
    `Ajoutez « ${module}:${collection} » à manifest.capacites.${verbe === "lire" ? "lit" : "ecrit"}.`;

  // En développement on casse net : c'est le seul moment où l'oubli se
  // corrige à peu de frais. En production on trace et on laisse passer —
  // couper l'accès à une app installée ferait pire que le mal.
  if (DEV) throw new Error(message);
  console.warn(`[capacites] ${message}`);
};

/// Accès aux données pour une application.
///
///   const donnees = accesDonnees(manifest);
///   await donnees.lire("clients");            // ses propres données
///   await donnees.lire("crm", "clients");     // celles d'une autre app
///
/// Les capacités se déclarent dans le manifeste :
///
///   capacites: {
///     lit:   ["crm:clients", "facturation:factures"],
///     ecrit: ["facturation:factures"],
///   }
export const accesDonnees = (manifest) => {
  const sien = manifest.id || manifest.slug;
  const caps = manifest.capacites || {};

  /// Résout (module, collection) selon qu'on passe une ou deux valeurs.
  const cible = (a, b) => (b === undefined ? [sien, a] : [a, b]);

  const verifier = (verbe, module, collection) => {
    if (module === sien) return true;
    const liste = verbe === "lire" ? caps.lit : caps.ecrit;
    if (autorise(liste, module, collection)) return true;
    refus(manifest, verbe, module, collection);
    return false;
  };

  return {
    lire: (a, b) => {
      const [m, c] = cible(a, b);
      verifier("lire", m, c);
      return api.records.list(m, c);
    },

    creer: (a, b, c) => {
      const [mod, col, data] = c === undefined ? [sien, a, b] : [a, b, c];
      verifier("écrire", mod, col);
      return api.records.create(mod, col, data);
    },

    modifier: (...args) => {
      const [mod, col, id, data] =
        args.length === 3 ? [sien, ...args] : args;
      verifier("écrire", mod, col);
      return api.records.update(mod, col, id, data);
    },

    supprimer: (...args) => {
      const [mod, col, id] = args.length === 2 ? [sien, ...args] : args;
      verifier("écrire", mod, col);
      return api.records.remove(mod, col, id);
    },
  };
};

/// Description lisible des capacités, pour l'écran d'installation.
/// Renvoie [] quand l'app ne demande rien hors de chez elle.
export const decrireCapacites = (capacites, nomDuModule = (m) => m) => {
  const phrase = (c) => {
    const [m, col] = String(c).split(":");
    return col === "*"
      ? `toutes les données de ${nomDuModule(m)}`
      : `${col} (${nomDuModule(m)})`;
  };

  const out = [];
  if (capacites?.lit?.length) {
    out.push({ verbe: "Consulte", quoi: capacites.lit.map(phrase) });
  }
  if (capacites?.ecrit?.length) {
    out.push({ verbe: "Modifie", quoi: capacites.ecrit.map(phrase) });
  }
  return out;
};

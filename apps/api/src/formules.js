// Les formules de CompanyOS — la source de vérité des tarifs.
//
// Une formule dit ce qu'un espace de travail a le droit de consommer :
// du stockage, des utilisateurs. Les prix sont en francs CFA par mois,
// TTC — le tarif affiché est le tarif payé, comme au marché.
//
// Ce fichier est la seule autorité : le client affiche ce que le serveur
// lui donne, et les limites sont appliquées ici, dans les routes — cacher
// un bouton n'a jamais empêché personne d'appeler une API.
//
// `utilisateursMax: null` veut dire sans limite. Les quotas sont en
// octets, comme `Tenant.quota`.

const Go = 1024 * 1024 * 1024;

export const FORMULES = [
  {
    id: "FREE",
    nom: "Découverte",
    prixMois: 0,
    quota: 2 * Go,
    utilisateursMax: 3,
    resume: "Pour essayer CompanyOS et gérer une très petite activité.",
    avantages: [
      "Toutes les applications de gestion",
      "3 utilisateurs",
      "2 Go de stockage",
      "Applications Studio illimitées",
    ],
  },
  {
    id: "PRO",
    nom: "Pro",
    prixMois: 15000,
    quota: 25 * Go,
    utilisateursMax: 15,
    resume: "Pour une PME qui travaille à plusieurs, tous les jours.",
    avantages: [
      "Tout Découverte",
      "15 utilisateurs",
      "25 Go de stockage",
      "Journal d'activité complet",
    ],
  },
  {
    id: "ENTERPRISE",
    nom: "Entreprise",
    prixMois: 45000,
    quota: 100 * Go,
    utilisateursMax: null,
    resume: "Pour une structure établie, sans se poser de questions.",
    avantages: [
      "Tout Pro",
      "Utilisateurs illimités",
      "100 Go de stockage",
      "Accompagnement à la mise en route",
    ],
  },
];

export const formuleDe = (plan) =>
  FORMULES.find((f) => f.id === plan) || FORMULES[0];

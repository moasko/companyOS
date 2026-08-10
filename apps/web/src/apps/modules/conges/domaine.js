// Congés — les règles propres au portail, sans React.
//
// L'essentiel du calcul — jours ouvrables, soldes, chevauchements — vit
// dans le domaine des Ressources humaines et il est réutilisé tel quel :
// le portail du salarié et le dossier RH ne peuvent pas se contredire
// d'un demi-jour. Ici ne restent que les règles du guichet : qui est le
// salarié derrière la session, et ce qu'une demande doit respecter.

import { joursOuvrables, today } from "../rh/domaine.js";

/// La fiche salarié de l'utilisateur connecté — par son adresse email,
/// la seule chose que la session et le dossier RH ont en commun.
export const salarieDe = (salaries = [], email = "") => {
  const cle = String(email || "").trim().toLowerCase();
  if (!cle) return null;
  return (
    salaries.find((s) => String(s.data?.email || "").trim().toLowerCase() === cle) ||
    null
  );
};

/// Ce qui rend une demande irrecevable — null si tout va bien. On rend la
/// raison, pas un booléen : le salarié doit savoir quoi corriger.
export const problemeDemande = (
  { du, au, type },
  { reglages, maintenant = today() } = {},
) => {
  if (!du || !au) return "Choisissez les deux dates.";
  if (au < du) return "La fin précède le début.";
  if (du < maintenant) return "Un congé se demande à l'avance — la date de début est passée.";
  if (!type) return "Choisissez un type d'absence.";
  if (joursOuvrables(du, au, reglages) === 0) {
    return "Cette période ne compte aucun jour ouvrable.";
  }
  return null;
};

/// Les absences à venir ou en cours, validées, pour le planning d'équipe —
/// triées par date de début.
export const planningDe = (absences = [], maintenant = today()) =>
  absences
    .filter((a) => a.data.etat === "approuve" && a.data.au >= maintenant)
    .sort((a, b) => a.data.du.localeCompare(b.data.du));

/// Les demandes d'un salarié, les plus récentes d'abord.
export const mesDemandes = (absences = [], salarieId) =>
  absences
    .filter((a) => a.data.salarieId === salarieId)
    .sort((a, b) => b.data.du.localeCompare(a.data.du));

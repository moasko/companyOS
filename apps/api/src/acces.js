import { prisma } from "./db.js";
import { auMoins } from "./auth.js";

/// Accès aux applications d'un espace de travail.
///
/// ─────────────────────────────────────────────────────────────────────────
/// POURQUOI
///
/// Les données des modules passent toutes par le CRUD générique de
/// `routes/records.js`, ouvert à tout membre authentifié. Concrètement, la
/// caissière lisait les bulletins de paie et le salaire de chacun : il
/// suffisait d'appeler `/api/records/paie/bulletins`, l'icône absente du
/// bureau n'y changeait rien.
///
/// Chaque installation porte donc une règle d'accès, réglée par un
/// administrateur, et appliquée **ici, côté serveur** — l'écran ne fait
/// que la refléter en cachant les icônes.
///
/// ─────────────────────────────────────────────────────────────────────────
/// LES DONNÉES PARTAGÉES ENTRE APPLICATIONS
///
/// Fermer les RH à un membre ne doit pas casser le portail Congés, ni les
/// Notes de frais, ni l'autocomplétion du Courrier : tous lisent la liste
/// des salariés. Quelques collections ont donc une règle plus fine pour qui
/// n'a pas accès à leur application (voir `PARTAGES`) :
///
///   - `rh/salaries` se lit en **annuaire** — identité, poste, ancienneté —
///     sans salaire, banque, n° CNPS, adresse, naissance ni notes ;
///   - `rh/absences` accepte une **demande** de congé, que seul quelqu'un
///     ayant accès aux RH peut approuver ou modifier ;
///   - `rh/reglages` se lit (jours fériés, acquisition des congés).
///
/// Tout le reste d'une application fermée est refusé, lecture comprise.
/// ─────────────────────────────────────────────────────────────────────────

export const MODES = ["membres", "admins", "selection"];

/// La règle d'une application tant qu'aucun administrateur n'en a décidé.
/// Ce qui touche aux salaires est fermé d'office : l'ouvrir doit être un
/// choix, pas un oubli.
const PAR_DEFAUT = {
  paie: { mode: "admins" },
  rh: { mode: "admins" },
};

/// Champs d'une fiche salarié visibles en annuaire.
///
/// `dateEmbauche` et `reportConges` y sont parce que le portail Congés
/// calcule le solde du salarié avec ; `statut` parce que les listes
/// écartent les salariés sortis.
const CHAMPS_ANNUAIRE = [
  "matricule",
  "nom",
  "prenom",
  "poste",
  "departement",
  "email",
  "statut",
  "userId",
  "photo",
  "dateEmbauche",
  "reportConges",
];

const PARTAGES = {
  "rh/salaries": { lecture: "annuaire" },
  "rh/absences": { lecture: "libre", demande: true },
  "rh/reglages": { lecture: "libre" },
};

/// La règle effective : celle de l'installation, sinon celle par défaut.
export const regleDe = (slug, installation) =>
  installation?.acces?.mode ? installation.acces : PAR_DEFAUT[slug] || { mode: "membres" };

/// Cette personne peut-elle ouvrir l'application ? Les administrateurs et
/// le propriétaire le peuvent toujours : on ne s'enferme pas dehors.
export const autoriseSelon = (user, regle) => {
  if (auMoins(user?.role, "ADMIN")) return true;
  if (regle.mode === "membres") return true;
  if (regle.mode === "selection") return (regle.membres || []).includes(user?.id);
  return false;
};

/// La règle d'accès d'un module pour la requête en cours.
///
/// Un module sans installation (désinstallé, ou qui n'est pas une app du
/// catalogue) suit sa règle par défaut : désinstaller la Paie ne doit pas
/// rendre ses bulletins lisibles par tous.
export const accesModule = async (request, module) => {
  const installation = await prisma.installation.findFirst({
    where: {
      tenantId: request.tenantId,
      app: { slug: module, OR: [{ tenantId: null }, { tenantId: request.tenantId }] },
    },
    select: { acces: true },
  });
  const regle = regleDe(module, installation);
  return { regle, autorise: autoriseSelon(request.user, regle) };
};

const partageDe = (names) => PARTAGES[`${names.module}/${names.collection}`] || null;

/// Ce qu'une personne sans accès à l'application peut lire de cette
/// collection : `"libre"`, `"annuaire"`, ou `null` (rien).
export const lecturePartagee = (names) => partageDe(names)?.lecture || null;

/// Réduit une fiche salarié à son annuaire.
export const enAnnuaire = (record) => ({
  ...record,
  data: Object.fromEntries(
    CHAMPS_ANNUAIRE.filter((c) => record.data?.[c] !== undefined).map((c) => [
      c,
      record.data[c],
    ]),
  ),
});

/// Une personne sans accès peut-elle **déposer** cette fiche ? Seulement
/// une demande, dans une collection qui en accepte.
export const creationPartagee = (names, data) =>
  !!partageDe(names)?.demande && data?.etat === "demande";

/// …et retirer celle-ci ? Seulement sa propre demande, tant qu'elle n'a
/// pas été tranchée.
export const suppressionPartagee = (names, record, user) =>
  !!partageDe(names)?.demande &&
  record.userId === user?.id &&
  record.data?.etat === "demande";

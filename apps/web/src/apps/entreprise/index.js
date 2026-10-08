// La fiche de l'entreprise — une seule, pour toutes les applications.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI UNE FICHE PARTAGÉE
//
// Raison sociale, adresse, NCC, RCCM, banque, logo, signataire : ce sont
// les mêmes sur une facture, un devis, un bulletin de paie ou un bon de
// commande. Les ressaisir dans chaque application, c'est les voir diverger
// au premier déménagement — et une facture qui porte l'ancienne adresse
// part quand même chez le client.
//
// La fiche est rangée dans `entreprise/profil` (une seule fiche par
// espace). Tout membre la lit ; seuls les administrateurs la modifient
// (règle tenue par le serveur, voir apps/api/src/routes/records.js).
//
//   import { useEntreprise } from "../../entreprise";
//   const { entreprise } = useEntreprise();      // dans un composant
//   const e = await chargerEntreprise();          // ailleurs
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useSyncExternalStore } from "react";
import { api, getToken } from "../../api/client";
import { TAILLE_MAX, tailleFiche } from "./domaine";

export const MODULE_ENTREPRISE = "entreprise";
export const COLLECTION_ENTREPRISE = "profil";

export {
  RUBRIQUES,
  CHAMPS_TEXTE,
  TAILLE_MAX,
  ficheVide,
  ligneLegale,
  manquesDe,
  tailleFiche,
} from "./domaine";
// ---------------------------------------------------------------------------
// Le magasin — une fiche en mémoire, partagée par toutes les fenêtres.
// ---------------------------------------------------------------------------

let etat = { fiche: null, id: null, charge: false, erreur: null, cle: null };
let enCours = null;
const abonnes = new Set();

const publier = (suite) => {
  etat = { ...etat, ...suite };
  abonnes.forEach((f) => f());
};

/// Lit la fiche (une fois par session) et la renvoie, ou `null`.
export const chargerEntreprise = async ({ force = false } = {}) => {
  // Le jeton change quand on change d'espace : la fiche aussi.
  const cle = getToken();
  if (!force && etat.charge && etat.cle === cle) return etat.fiche;
  if (!force && enCours) return enCours;
  enCours = api.records
    .list(MODULE_ENTREPRISE, COLLECTION_ENTREPRISE)
    .then((liste) => {
      const fiche = liste[0] || null;
      publier({ fiche: fiche?.data || null, id: fiche?.id || null, charge: true, erreur: null, cle });
      return etat.fiche;
    })
    .catch((e) => {
      publier({ charge: true, erreur: e.message, cle });
      return null;
    })
    .finally(() => {
      enCours = null;
    });
  return enCours;
};

/// Enregistre la fiche entière et prévient toutes les applications ouvertes.
export const enregistrerEntreprise = async (data) => {
  if (tailleFiche(data) > TAILLE_MAX) {
    throw new Error("La fiche est trop lourde : choisissez un logo ou un cachet plus léger.");
  }
  const fiche = etat.id
    ? await api.records.update(MODULE_ENTREPRISE, COLLECTION_ENTREPRISE, etat.id, data)
    : await api.records.create(MODULE_ENTREPRISE, COLLECTION_ENTREPRISE, data);
  publier({ fiche: fiche.data, id: fiche.id, charge: true, erreur: null, cle: getToken() });
  return fiche.data;
};

const sAbonner = (f) => {
  abonnes.add(f);
  return () => abonnes.delete(f);
};
const instantane = () => etat;

/// La fiche de l'entreprise, à jour dans toutes les fenêtres.
export const useEntreprise = (actif = true) => {
  const e = useSyncExternalStore(sAbonner, instantane);
  useEffect(() => {
    if (actif) chargerEntreprise();
  }, [actif]);
  return { entreprise: e.fiche, charge: e.charge, erreur: e.erreur, recharger: () => chargerEntreprise({ force: true }) };
};

// ---------------------------------------------------------------------------
// Signatures — celles dessinées dans l'application Signature.
// ---------------------------------------------------------------------------

/// Les signatures de l'espace. Une liste vide si l'application Signature
/// n'est pas installée ou que son accès est restreint : signer reste
/// possible avec le nom du signataire.
export const chargerSignatures = () => api.records.list("signature", "signatures").catch(() => []);

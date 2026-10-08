// La fiche de l'entreprise — les règles, en fonctions pures (testables
// sans navigateur). Voir index.js pour le magasin partagé.

/// Les rubriques de la fiche, dans l'ordre où on les remplit. Le
/// formulaire est construit à partir de cette table : un champ ajouté ici
/// apparaît partout.
export const RUBRIQUES = [
  {
    id: "identite",
    titre: "Identité",
    champs: [
      { id: "nom", label: "Raison sociale", requis: true, large: true },
      { id: "formeJuridique", label: "Forme juridique", liste: ["", "Entreprise individuelle", "SARL", "SARLU", "SA", "SAS", "SASU", "GIE", "Association", "Autre"] },
      { id: "capital", label: "Capital social", placeholder: "1 000 000 FCFA" },
      { id: "activite", label: "Activité", placeholder: "Agence de communication digitale", large: true },
    ],
  },
  {
    id: "coordonnees",
    titre: "Coordonnées",
    champs: [
      { id: "adresse", label: "Adresse", placeholder: "Rue, quartier, lot", large: true },
      { id: "ville", label: "Ville", placeholder: "Abidjan" },
      { id: "pays", label: "Pays" },
      { id: "telephone", label: "Téléphone", type: "tel", placeholder: "+225 07 00 00 00 00" },
      { id: "email", label: "E-mail", type: "email", placeholder: "contact@entreprise.ci" },
      { id: "siteWeb", label: "Site web", placeholder: "www.entreprise.ci", large: true },
    ],
  },
  {
    id: "fiscal",
    titre: "Identifiants légaux et fiscaux",
    champs: [
      { id: "ncc", label: "NCC (compte contribuable)", placeholder: "1234567 A" },
      { id: "rccm", label: "RCCM", placeholder: "CI-ABJ-03-2024-B12-01234" },
      { id: "cnpsEmployeur", label: "N° employeur CNPS", placeholder: "123456-A" },
      { id: "regimeFiscal", label: "Régime d'imposition", liste: ["", "Réel normal (RNI)", "Réel simplifié (RSI)", "Taxe d'État de l'entreprenant (TEE)", "Micro-entreprise", "Exonéré"] },
      { id: "centreImpots", label: "Centre des impôts", placeholder: "Cocody Riviera" },
    ],
  },
  {
    id: "paiement",
    titre: "Coordonnées de paiement",
    champs: [
      { id: "banque", label: "Banque", placeholder: "SGBCI, NSIA, Ecobank…" },
      { id: "titulaire", label: "Titulaire du compte" },
      { id: "iban", label: "RIB / IBAN", large: true },
      { id: "mobileOperateur", label: "Mobile Money", liste: ["", "Orange Money", "MTN MoMo", "Moov Money", "Wave"] },
      { id: "mobileNumero", label: "Numéro Mobile Money", type: "tel" },
    ],
  },
  {
    id: "signataire",
    titre: "Signataire et mentions",
    champs: [
      { id: "signataire", label: "Nom du signataire", placeholder: "Konan Yao" },
      { id: "fonctionSignataire", label: "Fonction", placeholder: "Gérant" },
      { id: "mentions", label: "Mentions en pied de document", multiligne: true, large: true, placeholder: "Pénalités de retard, escompte, conditions générales…" },
    ],
  },
];

export const CHAMPS_TEXTE = RUBRIQUES.flatMap((r) => r.champs.map((c) => c.id));

/// Une fiche vide, au nom de l'espace de travail.
export const ficheVide = (nomEspace = "") => ({ nom: nomEspace, pays: "Côte d'Ivoire" });

/// Ce qui manque pour émettre un document en règle, en phrases courtes.
/// L'adresse et le NCC ne sont pas des coquetteries : une facture sans
/// eux n'est pas déductible pour le client.
export const manquesDe = (e = {}) =>
  [
    !String(e.nom || "").trim() && "la raison sociale",
    !String(e.adresse || "").trim() && "l'adresse",
    !String(e.ncc || "").trim() && "le NCC",
    !String(e.telephone || e.email || "").trim() && "un téléphone ou un e-mail",
  ].filter(Boolean);

/// Ligne de l'identité légale : « SARL au capital de 1 000 000 FCFA ».
export const ligneLegale = (e = {}) => {
  const forme = e.formeJuridique && e.formeJuridique !== "Autre" ? e.formeJuridique : "";
  if (forme && e.capital) return `${forme} au capital de ${e.capital}`;
  return forme || (e.capital ? `Capital : ${e.capital}` : "");
};

/// Taille d'une fiche une fois rangée : le serveur refuse au-delà de 64 Ko.
export const tailleFiche = (data) => new Blob([JSON.stringify(data)]).size;
export const TAILLE_MAX = 60 * 1024;


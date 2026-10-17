// Le contenu de l'espace de démonstration « Akwaba Distribution ».
//
// Un grossiste-distributeur d'Abidjan : une boutique avec caisse, un dépôt,
// des clients professionnels (hôtels, supermarchés, écoles), une équipe de
// neuf personnes. Assez d'activité pour que chaque application ait quelque
// chose à montrer, et des cas qui racontent une histoire : une facture en
// retard, un article en rupture, un congé à valider, une affaire qui
// stagne, des écritures « à traiter ».
//
// Tout est daté **par rapport à aujourd'hui** : la démo ne vieillit pas.
// Le hasard est reproductible : deux réinitialisations donnent la même
// démo, au jour près.
//
// Les adresses électroniques des clients et des salariés sont fictives
// (domaines inventés). Aucun envoi n'est déclenché par ces données : les
// campagnes sont terminées ou en brouillon, les automatisations de
// campagne désactivées, les relances automatiques du Courrier éteintes.

import { totaux as totauxFacture } from "@companyos/shared/facturation";
import { RECETTES, validerAutomatisation } from "@companyos/shared/automatisations";
import { ecritureDeBulletin } from "@companyos/shared/paie";
import { calculer, saisieInitiale } from "@companyos/shared/paie-cycle";
import { arrondi, calendrier, csv, hasard, id, pdfTexte } from "./outils.js";
import { CACHET_PNG, LOGO_PNG, vignette } from "./images.js";

export const ENTREPRISE = "Akwaba Distribution";
const DOMAINE = "akwaba-distribution.ci";

/// Les membres de l'espace. Le premier est le propriétaire (le compte de
/// démonstration) ; son adresse est fournie par la commande.
export const EQUIPE = [
  { cle: "aicha", prenom: "Aïcha", nom: "Koné", role: "OWNER", poste: "Gérante", departement: "Direction", salaire: 850000, sexe: "F", naissance: "1984-03-17", embauche: "2019-02-01", situation: "marie", enfants: 2 },
  { cle: "yao", prenom: "Yao", nom: "Kouassi", role: "ADMIN", poste: "Comptable", departement: "Finance", salaire: 480000, sexe: "M", naissance: "1988-11-02", embauche: "2019-06-03", situation: "marie", enfants: 3 },
  { cle: "esther", prenom: "Esther", nom: "N'Guessan", role: "MEMBER", poste: "Responsable commerciale", departement: "Ventes", salaire: 420000, sexe: "F", naissance: "1991-07-24", embauche: "2020-09-01", situation: "celibataire", enfants: 1 },
  { cle: "serge", prenom: "Serge", nom: "Bamba", role: "MEMBER", poste: "Chef de projet", departement: "Direction", salaire: 520000, sexe: "M", naissance: "1986-01-30", embauche: "2021-04-12", situation: "marie", enfants: 1 },
  { cle: "ibrahim", prenom: "Ibrahim", nom: "Diabaté", role: "MEMBER", poste: "Magasinier", departement: "Logistique", salaire: 190000, sexe: "M", naissance: "1993-05-09", embauche: "2021-10-04", situation: "marie", enfants: 2 },
  { cle: "mariam", prenom: "Mariam", nom: "Traoré", role: "MEMBER", poste: "Caissière", departement: "Boutique", salaire: 165000, sexe: "F", naissance: "1997-12-14", embauche: "2022-03-01", situation: "celibataire", enfants: 0 },
];

/// Salariés sans compte dans l'espace (pas besoin d'ouvrir CompanyOS).
const AUTRES_SALARIES = [
  { prenom: "Koffi", nom: "Aka", poste: "Commercial terrain", departement: "Ventes", salaire: 260000, sexe: "M", naissance: "1995-08-21", embauche: "2023-01-09", situation: "celibataire", enfants: 0, contrat: "cdi" },
  { prenom: "Fatou", nom: "Ouattara", poste: "Livreuse", departement: "Logistique", salaire: 140000, sexe: "F", naissance: "1999-04-03", embauche: "2025-11-03", situation: "celibataire", enfants: 1, contrat: "cdd", finDans: 210 },
  { prenom: "Grâce", nom: "Yapo", poste: "Stagiaire marketing", departement: "Ventes", salaire: 100000, sexe: "F", naissance: "2002-10-11", embauche: null, situation: "celibataire", enfants: 0, contrat: "stage", finDans: 75 },
];

export const emailMembre = (m) =>
  `${m.prenom}.${m.nom}`
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z.]/g, "")
    .toLowerCase() + `@${DOMAINE}`;

// ---------------------------------------------------------------------------
// Référentiels
// ---------------------------------------------------------------------------

const CATEGORIES = ["Alimentaire", "Boissons", "Hygiène & entretien", "Fournitures de bureau"];

const FOURNISSEURS = [
  { cle: "sodiaci", nom: "SODIACI Import", contact: "M. Gnagne Paul", telephone: "+225 27 21 35 40 10", email: "commandes@sodiaci-import.ci", ville: "Abidjan — Vridi", delai: 7 },
  { cle: "boissons", nom: "Boissons d'Éburnie", contact: "Mme Assi Clarisse", telephone: "+225 27 22 41 18 90", email: "ventes@boissons-eburnie.ci", ville: "Abidjan — Yopougon", delai: 4 },
  { cle: "hygiene", nom: "Hygiène Plus CI", contact: "M. Tano Didier", telephone: "+225 07 48 22 19 05", email: "contact@hygieneplus.ci", ville: "Abidjan — Koumassi", delai: 5 },
  { cle: "bureau", nom: "Librairie de France Pro", contact: "M. Kouamé Eric", telephone: "+225 27 20 30 63 63", email: "pro@ldf-pro.ci", ville: "Abidjan — Plateau", delai: 3 },
];

// reference, désignation, unité, achat, vente TTC, seuil, catégorie, fournisseur, stock final visé
const ARTICLES = [
  ["RIZ-25", "Riz parfumé 25 kg", "sac", 14000, 17500, 10, 0, "sodiaci", 46],
  ["HUI-05", "Huile végétale 5 L", "pièce", 5400, 6900, 10, 0, "sodiaci", 38],
  ["SUC-01", "Sucre en poudre 1 kg", "kg", 650, 850, 30, 0, "sodiaci", 112],
  ["LAI-40", "Lait concentré sucré 397 g", "pièce", 320, 450, 48, 0, "sodiaci", 164],
  ["TOM-40", "Concentré de tomate 400 g", "pièce", 280, 400, 40, 0, "sodiaci", 96],
  ["SPA-50", "Spaghetti 500 g", "paquet", 300, 450, 40, 0, "sodiaci", 130],
  ["FAR-01", "Farine de blé 1 kg", "kg", 550, 750, 20, 0, "sodiaci", 58],
  ["CAF-20", "Café soluble 200 g", "pièce", 2000, 2800, 12, 0, "sodiaci", 13],
  ["EAU-15", "Eau minérale 1,5 L (pack de 6)", "carton", 1800, 2500, 20, 1, "boissons", 74],
  ["JUS-01", "Jus d'orange 1 L", "pièce", 900, 1300, 24, 1, "boissons", 51],
  ["SAV-01", "Savon de Marseille 300 g", "pièce", 220, 350, 30, 2, "hygiene", 88],
  ["LES-05", "Lessive liquide 5 L", "pièce", 3800, 5200, 8, 2, "hygiene", 7],
  ["JAV-01", "Eau de Javel 1 L", "pièce", 350, 500, 20, 2, "hygiene", 34],
  ["PAP-A4", "Ramette papier A4 80 g", "paquet", 2800, 3900, 10, 3, "bureau", 27],
  ["CAH-96", "Cahier 96 pages", "pièce", 250, 400, 50, 3, "bureau", 210],
  ["STY-50", "Stylos bille (boîte de 50)", "paquet", 3000, 4500, 5, 3, "bureau", 0],
];

// Clients professionnels : entreprise, contact, secteur, ville, étiquettes,
// statut, source, responsable (clé d'équipe), ancienneté en jours.
const CLIENTS = [
  ["Hôtel Ivoire Lagune", "Paul Ahoussou", "Hôtellerie", "Abidjan — Cocody", ["VIP", "Hôtellerie"], "actif", "recommandation", "esther", 640],
  ["Supermarché Prosuma Riviera", "Clarisse Dibi", "Grande distribution", "Abidjan — Riviera", ["VIP", "Grande distribution"], "actif", "salon", "esther", 580],
  ["Restaurant Le Maquis Chic", "Jean-Marc Yao", "Restauration", "Abidjan — Zone 4", ["Restauration"], "actif", "site", "koffi", 420],
  ["Groupe Scolaire Les Lauriers", "Mme Bléhoué Hortense", "Enseignement", "Abidjan — Angré", ["Écoles"], "actif", "appel", "esther", 510],
  ["Clinique Sainte-Marie", "Dr Kouadio Bernard", "Santé", "Abidjan — Marcory", ["Santé"], "actif", "recommandation", "aicha", 300],
  ["Boulangerie La Baguette d'Or", "Moussa Coulibaly", "Restauration", "Abidjan — Treichville", ["Restauration", "Grossiste"], "actif", "appel", "koffi", 460],
  ["Station Total Plateau", "Ange Kacou", "Distribution", "Abidjan — Plateau", ["Grande distribution"], "actif", "salon", "koffi", 260],
  ["Hôtel Résidence Assinie", "Nadège Ehui", "Hôtellerie", "Assinie", ["Hôtellerie"], "actif", "campagne", "esther", 200],
  ["Cantine Université FHB", "M. Soro Lacina", "Enseignement", "Abidjan — Cocody", ["Écoles", "VIP"], "actif", "appel", "aicha", 380],
  ["Supérette Chez Tantie Rose", "Rose Gbagbo", "Commerce de proximité", "Abidjan — Abobo", ["Grossiste"], "actif", "recommandation", "koffi", 700],
  ["Traiteur Délices d'Abidjan", "Fanta Sylla", "Restauration", "Abidjan — Deux-Plateaux", ["Restauration"], "actif", "formulaire", "esther", 150],
  ["Cabinet Kouamé & Associés", "Me Kouamé Serge", "Services", "Abidjan — Plateau", ["Bureaux"], "actif", "site", "aicha", 240],
  ["Orange CI — Agence Marcory", "Inès Doumbia", "Télécoms", "Abidjan — Marcory", ["Bureaux", "VIP"], "actif", "salon", "esther", 330],
  ["Lycée Moderne de Bingerville", "M. Yoboué Kan", "Enseignement", "Bingerville", ["Écoles"], "actif", "campagne", "koffi", 120],
  ["Pharmacie du Golf", "Dr Aké Mireille", "Santé", "Abidjan — Riviera Golf", ["Santé"], "actif", "site", "koffi", 180],
  ["Hôtel Tiama", "Patrick Séri", "Hôtellerie", "Abidjan — Plateau", ["Hôtellerie", "VIP"], "actif", "recommandation", "aicha", 90],
  ["Mini-market Sococé", "Adama Konaté", "Grande distribution", "Abidjan — Deux-Plateaux", ["Grande distribution"], "actif", "salon", "esther", 60],
  ["ONG Enfance Solidaire", "Mme Kra Béatrice", "Associatif", "Abidjan — Yopougon", ["Écoles"], "actif", "formulaire", "esther", 45],
  // Prospects (leads) et inactifs
  ["Résidence hôtelière Azalaï", "Thierry Kassi", "Hôtellerie", "Abidjan — Marcory", ["Hôtellerie"], "prospect", "salon", "esther", 12],
  ["Restaurant Saakan", "Awa Bakayoko", "Restauration", "Abidjan — Cocody", ["Restauration"], "prospect", "formulaire", "koffi", 6],
  ["Collège Saint-Viateur", "Frère Aimé N'Dri", "Enseignement", "Abidjan — Riviera", ["Écoles"], "prospect", "campagne", "esther", 20],
  ["Supermarché Leader Price Yopougon", "Michel Gohou", "Grande distribution", "Abidjan — Yopougon", ["Grande distribution"], "prospect", "appel", "aicha", 3],
  ["Snack Le Palmier", "Brice Amani", "Restauration", "Grand-Bassam", ["Restauration"], "inactif", "site", "koffi", 820],
  ["Imprimerie Nouvelle", "Hervé Guédé", "Services", "Abidjan — Adjamé", ["Bureaux"], "inactif", "appel", "koffi", 760],
];

const slug = (s) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 18);

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/// Construit toutes les données. Ne touche pas à la base : rend des listes
/// prêtes à insérer (voir index.js).
export const construireDemo = ({ tenantId, membres, maintenant = new Date() }) => {
  const C = calendrier(maintenant);
  const H = hasard(2026);
  const proprio = membres.aicha;
  const records = [];
  const fichiers = [];
  const courriels = [];
  const notifications = [];
  const automatisations = [];

  const ajouter = (module, collection, data, { jour = 0, heure = 9, par = proprio.id, rid = id() } = {}) => {
    const cree = typeof jour === "string" ? C.instant(C.ecart(jour), heure, H.entier(0, 59)) : C.instant(jour, heure, H.entier(0, 59));
    records.push({ id: rid, tenantId, userId: par, updatedById: par, module, collection, data, createdAt: cree, updatedAt: cree });
    return rid;
  };
  const fichier = (dossier, nom, contenu, type) => {
    const fid = id();
    fichiers.push({ id: fid, dossier, nom, contenu, type });
    return fid;
  };

  // ---------------------------------------------------------------- Entreprise
  const signatureId = id();
  const traits = [];
  // Une signature manuscrite stylisée : un « A » bouclé suivi d'une
  // ondulation, tracée en points comme le ferait la souris.
  const ligne1 = [];
  for (let i = 0; i <= 40; i++) {
    const x = 10 + i * 4.2;
    const y = 40 - Math.sin(i / 3.2) * 18 * (1 - i / 60) - (i < 8 ? i * 2 : 0) + (i > 30 ? (i - 30) * 1.4 : 0);
    ligne1.push({ x: Math.round(x), y: Math.round(Math.max(10, y)) });
  }
  const ligne2 = [];
  for (let i = 0; i <= 26; i++) ligne2.push({ x: Math.round(60 + i * 5.5), y: Math.round(62 + Math.sin(i / 2) * 4) });
  traits.push(ligne1, ligne2);
  ajouter("signature", "signatures", { nom: "Aïcha Koné", traits, largeur: 210, hauteur: 80, encre: "bleu", epaisseur: 2.5 }, { jour: -400, rid: signatureId });

  ajouter(
    "entreprise",
    "profil",
    {
      nom: "Akwaba Distribution SARL",
      formeJuridique: "SARL",
      capital: "25 000 000 FCFA",
      activite: "Distribution alimentaire, boissons, hygiène et fournitures aux professionnels",
      adresse: "Boulevard VGE, Immeuble Akwaba, 2e étage — Marcory Zone 4",
      ville: "Abidjan",
      pays: "Côte d'Ivoire",
      telephone: "+225 27 21 26 48 00",
      email: `contact@${DOMAINE}`,
      siteWeb: "www.akwaba-distribution.ci",
      ncc: "1914527 K",
      rccm: "CI-ABJ-2019-B-14527",
      cnpsEmployeur: "302-114527-A",
      regimeFiscal: "Réel normal (RNI)",
      centreImpots: "CME Marcory",
      banque: "SGBCI — Agence Marcory",
      titulaire: "Akwaba Distribution SARL",
      iban: "CI93 CI008 01245 012345678901 47",
      mobileOperateur: "Orange Money",
      mobileNumero: "+225 07 07 26 48 00",
      signataire: "Aïcha Koné",
      fonctionSignataire: "Gérante",
      mentions: "SARL au capital de 25 000 000 FCFA — RCCM CI-ABJ-2019-B-14527 — NCC 1914527 K",
      logo: LOGO_PNG,
      cachet: CACHET_PNG,
      signatureId,
      signatureNom: "Aïcha Koné",
    },
    { jour: -400 },
  );
  ajouter("editeur-factures", "emetteur", { modele: "officiel", couleur: "#C2410C", conditions: "net30", moyenPaiement: "virement", devise: "XOF", notes: "Merci pour votre confiance." }, { jour: -380 });

  // ---------------------------------------------------------------- Stock : référentiels
  const categories = CATEGORIES.map((nom) => ajouter("stock", "categories", { nom, parentId: "" }, { jour: -500, par: membres.ibrahim.id }));
  const fournisseurs = Object.fromEntries(
    FOURNISSEURS.map((f) => [f.cle, { ...f, id: ajouter("stock", "fournisseurs", { nom: f.nom, contact: f.contact, telephone: f.telephone, email: f.email, ville: f.ville, delai: f.delai }, { jour: -500, par: membres.ibrahim.id }) }]),
  );
  const depotId = ajouter("stock", "entrepots", { nom: "Dépôt Yopougon", code: "YOP", adresse: "Zone industrielle de Yopougon, lot 112", emplacements: ["Allée A", "Allée B", "Quai"] }, { jour: -200, par: membres.ibrahim.id });

  const articles = ARTICLES.map(([reference, designation, unite, prixAchat, prixVente, seuil, cat, fou, cible], i) => {
    const suiviLot = ["LAI-40", "TOM-40"].includes(reference);
    const data = {
      reference,
      designation,
      description: "",
      marque: "",
      codeBarre: `61812${String(345678 + i * 1371).padStart(8, "0")}`,
      categorieId: categories[cat],
      unite,
      prixAchat,
      prixVente,
      tva: 18,
      seuil,
      emplacement: `${"ABCD"[cat]}${(i % 4) + 1}`,
      fournisseurId: fournisseurs[fou].id,
      vignette: vignette(reference),
      imageNodeId: "",
      suiviLot,
      stockSecurite: Math.round(seuil / 2),
      delaiFournisseur: fournisseurs[fou].delai,
      qteCommande: Math.max(seuil * 2, 10),
      stockMax: seuil * 12,
    };
    return { id: ajouter("stock", "articles", data, { jour: -480, par: membres.ibrahim.id }), ...data, cible };
  });
  const art = Object.fromEntries(articles.map((a) => [a.reference, a]));

  // Mouvements : on note tout, puis on calcule le stock de départ qui mène
  // au stock visé aujourd'hui (voir plus bas).
  const mouvements = []; // { date, ref, delta, data, heure }
  const sortie = (date, ref, qte, extra) => mouvements.push({ date, ref, delta: -qte, data: { sens: "sortie", quantite: qte, ...extra } });
  const entree = (date, ref, qte, extra) => mouvements.push({ date, ref, delta: qte, data: { sens: "entree", quantite: qte, ...extra } });

  // ---------------------------------------------------------------- Caisse
  const PANIER = ["RIZ-25", "HUI-05", "SUC-01", "LAI-40", "TOM-40", "SPA-50", "FAR-01", "EAU-15", "JUS-01", "SAV-01", "JAV-01", "CAH-96", "CAF-20"];
  const tickets = [];
  const ttcLigne = (l) => l.pu * l.qte * (1 - (l.remise || 0) / 100);
  for (let n = -20; n <= 0; n++) {
    if (C.jourSemaine(n) === 0) continue; // fermé le dimanche
    const date = C.jour(n);
    const sessionId = id();
    const fond = 50000;
    const nb = n === 0 ? 6 : H.entier(8, 14);
    let especesNettes = 0;
    const duJour = [];
    for (let k = 1; k <= nb; k++) {
      const numero = `${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}-${String(k).padStart(3, "0")}`;
      const refs = H.melange(PANIER).slice(0, H.entier(1, 4));
      const lignes = refs.map((ref) => {
        const a = art[ref];
        return { articleId: a.id, designation: a.designation, pu: a.prixVente, qte: ref === "RIZ-25" || ref === "LES-05" ? 1 : H.entier(1, 3), tva: 18, remise: 0, unite: a.unite };
      });
      const ttc = arrondi(lignes.reduce((s, l) => s + ttcLigne(l), 0));
      const tva = arrondi(lignes.reduce((s, l) => s + (ttcLigne(l) - ttcLigne(l) / 1.18), 0));
      const moyen = H.nombre() < 0.6 ? "especes" : H.nombre() < 0.8 ? "mobile" : "carte";
      const recu = moyen === "especes" ? Math.ceil(ttc / 1000) * 1000 : ttc;
      const rendu = recu - ttc;
      if (moyen === "especes") especesNettes += ttc;
      const data = { numero, sessionId, date, lignes, paiements: [{ moyen, montant: recu }], ttc, ht: ttc - tva, tva, articles: lignes.reduce((s, l) => s + l.qte, 0), rendu };
      const heure = 8 + Math.floor((k / (nb + 1)) * 10);
      const tid = ajouter("caisse", "tickets", data, { jour: n, heure, par: membres.mariam.id });
      tickets.push({ id: tid, data, jour: n });
      duJour.push(data);
      for (const l of lignes) sortie(date, refs[lignes.indexOf(l)], l.qte, { motif: `Vente ${numero}`, origine: `caisse:${numero}` });
    }
    const session = { fond, date, ouverteLe: C.instant(n, 7, 55).toISOString() };
    if (n < 0) {
      const attendu = fond + especesNettes;
      const ecartCaisse = n === -3 ? -500 : 0;
      const compte = attendu + ecartCaisse;
      // Comptage : des grosses coupures vers les petites.
      const comptage = {};
      let reste = compte;
      for (const c of [10000, 5000, 2000, 1000, 500, 200, 100, 50, 25, 10, 5]) {
        const q = Math.floor(reste / c);
        if (q) comptage[String(c)] = q;
        reste -= q * c;
      }
      Object.assign(session, { fermeeLe: C.instant(n, 19, 5).toISOString(), comptage, compte, attendu, ecart: ecartCaisse });
    }
    ajouter("caisse", "sessions", session, { jour: n, heure: 7, par: membres.mariam.id, rid: sessionId });
  }

  // ---------------------------------------------------------------- CRM
  const clients = CLIENTS.map(([entreprise, contact, secteur, ville, etiquettes, statut, source, resp, anciennete], i) => {
    const local = slug(contact.split(" ").slice(-1)[0] || contact) || "contact";
    const domaine = `${slug(entreprise)}.ci`;
    const email = `${local}@${domaine}`;
    const telephone = `+225 07 ${String(10 + i).padStart(2, "0")} ${String(20 + ((i * 7) % 70)).padStart(2, "0")} ${String(30 + ((i * 13) % 60)).padStart(2, "0")} ${String(40 + ((i * 3) % 50)).padStart(2, "0")}`;
    const data = {
      entreprise,
      nom: contact,
      email,
      telephone,
      ville,
      adresse: ville.replace("Abidjan — ", ""),
      secteur,
      statut,
      source,
      responsableId: membres[resp]?.id || membres.esther.id,
      etiquettes,
      notes: "",
    };
    if (statut === "actif") data.clientDepuis = C.jour(-anciennete + 15);
    if (statut === "prospect" && i % 2 === 0) Object.assign(data, { besoin: "Approvisionnement mensuel en produits alimentaires et boissons", montantEstime: 4_500_000 + i * 250_000 });
    if (source === "formulaire") data.consentement = { source: "formulaire", le: C.instant(-anciennete, 10).toISOString(), confirmeLe: C.instant(-anciennete, 10, 20).toISOString() };
    const cid = ajouter("crm", "clients", data, { jour: -anciennete, par: data.responsableId });
    return { id: cid, ...data, anciennete };
  });
  const actifs = clients.filter((c) => c.statut === "actif");
  const client = (nom) => clients.find((c) => c.entreprise.startsWith(nom));

  const contacts = [];
  const ROLES = ["decideur", "facturation", "utilisateur", "technique"];
  clients.forEach((c, i) => {
    const [prenom, ...reste] = c.nom.replace(/^(Mme|M\.|Dr|Me|Frère) /, "").split(" ");
    contacts.push({ id: ajouter("crm", "contacts", { clientId: c.id, prenom, nom: reste.join(" ") || prenom, poste: i % 3 === 0 ? "Directeur général" : i % 3 === 1 ? "Responsable achats" : "Gérant", role: "decideur", email: c.email, telephone: c.telephone }, { jour: -c.anciennete }), clientId: c.id });
    if (c.statut === "actif" && i % 2 === 0) {
      const p2 = H.choix(["Mariette", "Cyrille", "Edwige", "Franck", "Josiane", "Arnaud", "Prisca"]);
      const n2 = H.choix(["Tapé", "Gnahoré", "Dosso", "Konan", "Zadi", "Méité", "Loukou"]);
      contacts.push({ id: ajouter("crm", "contacts", { clientId: c.id, prenom: p2, nom: n2, poste: "Comptable", role: ROLES[(i / 2) % 4 | 0] === "decideur" ? "facturation" : ROLES[(i / 2) % 4 | 0], email: `${slug(p2)}.${slug(n2)}@${c.email.split("@")[1]}`, telephone: `+225 05 ${String(40 + i).padStart(2, "0")} 11 22 ${String(10 + i).padStart(2, "0")}` }, { jour: -c.anciennete + 5 }), clientId: c.id });
    }
  });
  const contactDe = (clientId) => contacts.find((x) => x.clientId === clientId)?.id || "";

  // Affaires : libellé, client, montant, étape, clôture (jours), dernière
  // étape (jours), responsable, motif de perte.
  const AFFAIRES = [
    ["Contrat annuel boissons 2027", "Hôtel Ivoire Lagune", 24_000_000, "negociation", 18, -4, "esther"],
    ["Approvisionnement rentrée — internat", "Groupe Scolaire Les Lauriers", 8_500_000, "devis", 12, -16, "esther"],
    ["Ouverture 2e restaurant", "Restaurant Le Maquis Chic", 6_200_000, "qualifie", 35, -6, "koffi"],
    ["Référencement gamme hygiène", "Supermarché Prosuma Riviera", 12_800_000, "devis", 25, -3, "esther"],
    ["Kits fournitures — 1 200 élèves", "Lycée Moderne de Bingerville", 9_600_000, "negociation", 9, -11, "koffi"],
    ["Cantine 2e semestre", "Cantine Université FHB", 15_400_000, "devis", 40, -21, "aicha"],
    ["Linge et produits d'accueil", "Hôtel Tiama", 7_300_000, "qualifie", 30, -2, "aicha"],
    ["Contrat cadre fournitures bureau", "Orange CI — Agence Marcory", 5_900_000, "contact", 60, -8, "esther"],
    ["Ouverture résidence — équipement", "Résidence hôtelière Azalaï", 18_500_000, "contact", 75, -10, "esther"],
    ["Approvisionnement mensuel", "Supermarché Leader Price Yopougon", 11_000_000, "qualifie", 45, -2, "aicha"],
    // Gagnées (dont ce mois-ci) et perdues
    ["Commande fêtes de fin d'année", "Hôtel Résidence Assinie", 4_800_000, "gagnee", -3, -3, "esther"],
    ["Réassort trimestriel", "Clinique Sainte-Marie", 3_900_000, "gagnee", -9, -9, "aicha"],
    ["Contrat boulangerie farine & sucre", "Boulangerie La Baguette d'Or", 6_700_000, "gagnee", -36, -36, "koffi"],
    ["Pack accueil séminaire", "Cabinet Kouamé & Associés", 2_100_000, "gagnee", -62, -62, "aicha"],
    ["Fournitures traiteur mariages", "Traiteur Délices d'Abidjan", 3_200_000, "perdue", -14, -14, "esther", "prix"],
    ["Distribution boissons stade", "Station Total Plateau", 9_000_000, "perdue", -48, -48, "koffi", "concurrent"],
  ];
  const opportunites = AFFAIRES.map(([libelle, nomClient, montant, etape, cloture, etapeLe, resp, motif]) => {
    const c = client(nomClient);
    const data = { clientId: c.id, contactId: contactDe(c.id), libelle, montant, etape, probabilite: "", dateCloture: C.jour(cloture), etapeLe: C.jour(etapeLe), responsableId: membres[resp]?.id || membres.esther.id, notes: "", motifPerte: motif || "" };
    return { id: ajouter("crm", "opportunites", data, { jour: Math.min(etapeLe, cloture) - H.entier(15, 40), par: data.responsableId }), ...data, client: c };
  });
  const affaire = (lib) => opportunites.find((o) => o.libelle === lib);

  // Activités : passées, et tâches (en retard, du jour, à venir).
  const activite = (type, resume, jour, c, extra = {}) =>
    ajouter("crm", "activites", { type, resume, date: C.jour(Math.min(jour, 0)), echeance: "", fait: false, faitLe: "", clientId: c.id, opportuniteId: "", contactId: "", auteurId: proprio.id, ...extra }, { jour: Math.min(jour, 0), par: extra.auteurId || proprio.id });
  const historiques = [
    ["appel", "Point sur les volumes de fin d'année — besoin confirmé", -2, "Hôtel Ivoire Lagune", { resultat: "joint", auteurId: membres.esther.id }],
    ["reunion", "Visite du dépôt avec le chef cuisinier, dégustation des nouvelles références", -5, "Hôtel Ivoire Lagune", { auteurId: membres.esther.id }],
    ["email", "Envoi du catalogue hygiène et des tarifs dégressifs", -3, "Supermarché Prosuma Riviera", { auteurId: membres.esther.id }],
    ["appel", "Relance devis rentrée — attend validation du conseil d'administration", -16, "Groupe Scolaire Les Lauriers", { resultat: "messagerie", auteurId: membres.esther.id }],
    ["reunion", "Négociation des délais de paiement (60 jours demandés)", -11, "Lycée Moderne de Bingerville", { auteurId: membres.koffi?.id || proprio.id }],
    ["note", "Le nouveau directeur des achats arrive en novembre : prévoir une présentation", -7, "Cantine Université FHB", {}],
    ["appel", "Premier contact suite au salon, intéressé par les boissons et l'hygiène", -10, "Résidence hôtelière Azalaï", { resultat: "joint", auteurId: membres.esther.id }],
    ["appel", "Appel entrant : demande de devis pour un approvisionnement mensuel", -2, "Supermarché Leader Price Yopougon", { resultat: "joint" }],
    ["email", "Confirmation de commande et date de livraison", -3, "Hôtel Résidence Assinie", { auteurId: membres.esther.id }],
    ["reunion", "Bilan trimestriel : satisfaction, souhaite élargir à l'hygiène", -9, "Clinique Sainte-Marie", {}],
    ["appel", "Retard de paiement facture d'août : promesse de virement sous 10 jours", -6, "Restaurant Le Maquis Chic", { resultat: "joint", auteurId: membres.koffi?.id || proprio.id }],
    ["appel", "Tentative de joindre le gérant, rappeler en fin de semaine", -1, "Supérette Chez Tantie Rose", { resultat: "absent", auteurId: membres.koffi?.id || proprio.id }],
    ["email", "Envoi des nouvelles conditions générales de vente", -20, "Cabinet Kouamé & Associés", {}],
    ["reunion", "Visite de courtoisie, présentation de la gamme fournitures", -25, "Orange CI — Agence Marcory", { auteurId: membres.esther.id }],
    ["note", "Client très sensible au prix ; a choisi un concurrent pour les mariages", -14, "Traiteur Délices d'Abidjan", { auteurId: membres.esther.id }],
  ];
  for (const [type, resume, jour, nomClient, extra] of historiques) activite(type, resume, jour, client(nomClient), extra);
  // Tâches (« Ma journée » de la gérante, et de l'équipe)
  const taches = [
    ["Relancer le devis cantine du 2e semestre", -2, "Cantine Université FHB", proprio.id, "Cantine 2e semestre"],
    ["Envoyer la proposition révisée (remise 5 %)", -1, "Hôtel Tiama", proprio.id, "Linge et produits d'accueil"],
    ["RDV dégustation au dépôt — 11 h", 0, "Supermarché Leader Price Yopougon", proprio.id, "Approvisionnement mensuel"],
    ["Valider les conditions de paiement avec Yao", 0, "Lycée Moderne de Bingerville", proprio.id, "Kits fournitures — 1 200 élèves"],
    ["Préparer le contrat annuel boissons", 2, "Hôtel Ivoire Lagune", membres.esther.id, "Contrat annuel boissons 2027"],
    ["Appeler pour la commande de Noël", 4, "Clinique Sainte-Marie", proprio.id, ""],
    ["Relancer le devis rentrée", 1, "Groupe Scolaire Les Lauriers", membres.esther.id, "Approvisionnement rentrée — internat"],
    ["Présentation de la gamme au nouveau directeur", 9, "Cantine Université FHB", proprio.id, ""],
  ];
  for (const [resume, j, nomClient, auteur, lib] of taches) {
    const c = client(nomClient);
    ajouter("crm", "activites", { type: "tache", resume, date: C.jour(Math.min(j, 0) - 3), echeance: C.jour(j), fait: false, faitLe: "", clientId: c.id, opportuniteId: lib ? affaire(lib).id : "", contactId: "", auteurId: auteur }, { jour: Math.min(j, 0) - 3, par: auteur });
  }
  ajouter("crm", "activites", { type: "tache", resume: "Envoyer le bon de livraison signé", date: C.jour(-6), echeance: C.jour(-4), fait: true, faitLe: C.jour(-4), clientId: client("Hôtel Résidence Assinie").id, opportuniteId: "", contactId: "", auteurId: membres.esther.id }, { jour: -6, par: membres.esther.id });

  ajouter("crm", "reglages", {
    objectifs: { equipe: 45_000_000, [proprio.id]: 15_000_000, [membres.esther.id]: 20_000_000 },
    seuils: { contact: 21, qualifie: 14, devis: 10, negociation: 7 },
    secteursCibles: ["Hôtellerie", "Grande distribution", "Enseignement"],
    vues: [
      { id: "vvip", nom: "Comptes VIP", criteres: { etiquette: "VIP" } },
      { id: "vhot", nom: "Hôtellerie Abidjan", criteres: { secteur: "Hôtellerie" } },
      { id: "vpro", nom: "Prospects", criteres: { statut: "prospect" } },
    ],
  }, { jour: -300 });

  // ---------------------------------------------------------------- Facturation
  const factures = [];
  const reglements = [];
  const numeros = { facture: 0, devis: 0, avoir: 0 };
  const PREFIXES = { facture: "FAC", devis: "DEV", avoir: "AV" };
  const htGros = (a) => Math.round((a.prixVente / 1.18) * 0.9 / 5) * 5; // tarif professionnel
  const lignesCommande = (refs, mult = 1) =>
    refs.map(([ref, qte]) => {
      if (!art[ref]) return { designation: ref, qte, pu: 25000, remise: 0, tva: 18 };
      return { designation: art[ref].designation, qte: qte * mult, pu: htGros(art[ref]), remise: 0, tva: 18, articleId: art[ref].id };
    });
  const facturer = (type, c, date, lignes, { statut = "envoye", echeanceJours = 30, extra = {}, par = proprio.id, livraison = true } = {}) => {
    numeros[type] += 1;
    const annee = date.slice(0, 4);
    const numero = `${PREFIXES[type]}-${annee}-${String(numeros[type]).padStart(4, "0")}`;
    const tousLignes = livraison && type !== "devis" ? [...lignes, { designation: "Frais de livraison", qte: 1, pu: 15000, remise: 0, tva: 18 }] : lignes;
    const data = {
      type,
      numero,
      statut,
      date,
      echeance: C.jour(C.ecart(date) + (type === "devis" ? 15 : echeanceJours)),
      devise: "XOF",
      clientId: c.id,
      clientNom: c.nom,
      clientEntreprise: c.entreprise,
      clientEmail: c.email,
      clientVille: c.ville,
      clientTelephone: c.telephone,
      remiseGlobale: 0,
      notes: type === "devis" ? "Offre valable 15 jours. Livraison gratuite à partir de 500 000 F HT." : "",
      conditions: type === "devis" ? "Paiement à 30 jours fin de mois" : "Paiement à 30 jours",
      compteProduit: "701",
      lignes: tousLignes,
      ...extra,
    };
    const fid = ajouter("facturation", "factures", data, { jour: date, par });
    const f = { id: fid, data, total: totauxFacture(data).ttc };
    factures.push(f);
    return f;
  };
  const regler = (f, montant, date, moyen, ref = "") => {
    const data = { documentId: f.id, montant: arrondi(montant), moyen, date, reference: ref };
    const rid = ajouter("facturation", "reglements", data, { jour: date, par: membres.yao.id });
    reglements.push({ id: rid, data, facture: f });
  };

  const PANIERS_PRO = [
    [["RIZ-25", 20], ["HUI-05", 24], ["SUC-01", 60], ["EAU-15", 40]],
    [["EAU-15", 60], ["JUS-01", 96]],
    [["SAV-01", 120], ["JAV-01", 72], ["LES-05", 12]],
    [["PAP-A4", 30], ["CAH-96", 200], ["STY-50", 4]],
    [["RIZ-25", 10], ["SPA-50", 80], ["TOM-40", 96], ["LAI-40", 144]],
    [["FAR-01", 100], ["SUC-01", 80], ["LAI-40", 96]],
  ];
  const MOYENS_REGLEMENT = ["Virement", "Virement", "Mobile Money", "Chèque", "Espèces"];

  // Six mois d'historique : chaque client actif est facturé régulièrement.
  for (let m = -6; m <= 0; m++) {
    const parMois = m === 0 ? 5 : 7;
    for (let k = 0; k < parMois; k++) {
      const c = actifs[(k * 5 + (m + 6) * 3) % actifs.length];
      const jourDuMois = 3 + k * 4;
      const date = C.dansMois(m, jourDuMois);
      if (C.ecart(date) > 0) continue;
      const panier = PANIERS_PRO[(k + m + 6) % PANIERS_PRO.length];
      const f = facturer("facture", c, date, lignesCommande(panier, c.etiquettes.includes("VIP") ? 2 : 1), { par: H.choix([membres.esther.id, proprio.id, membres.yao.id]) });
      const age = -C.ecart(date);
      const moyen = H.choix(MOYENS_REGLEMENT);
      // Histoire des paiements : l'ancien est réglé, le récent est en cours.
      if (age > 75) regler(f, f.total, C.jour(C.ecart(date) + H.entier(15, 40)), moyen, moyen === "Virement" ? `VIR-${f.data.numero.slice(-4)}` : "");
      else if (age > 40) {
        if (k % 4 === 1) regler(f, Math.round(f.total * 0.5 / 1000) * 1000, C.jour(C.ecart(date) + 20), moyen);
        else if (k % 4 !== 3) regler(f, f.total, C.jour(C.ecart(date) + H.entier(10, 30)), moyen);
        // k % 4 === 3 : en retard, rien reçu
      } else if (age > 10 && k % 3 === 0) regler(f, f.total, C.jour(C.ecart(date) + H.entier(3, Math.max(4, age - 2))), moyen);
    }
  }
  // Un client en retard qui « raconte » la relance (Maquis Chic, cf. CRM).
  const retard = facturer("facture", client("Restaurant Le Maquis Chic"), C.jour(-58), lignesCommande(PANIERS_PRO[0]), { par: membres.koffi?.id || proprio.id });
  regler(retard, 300000, C.jour(-30), "Mobile Money", "OM-882145");
  // Devis : accepté (converti), envoyé, refusé, brouillon.
  const devisHotel = facturer("devis", client("Hôtel Résidence Assinie"), C.jour(-12), lignesCommande([["EAU-15", 80], ["JUS-01", 120], ["SAV-01", 200]]), { statut: "accepte" });
  const factureDevis = facturer("facture", client("Hôtel Résidence Assinie"), C.jour(-3), devisHotel.data.lignes.map((l) => ({ ...l })), { extra: { sourceId: devisHotel.id, sourceNumero: devisHotel.data.numero, opportuniteId: affaire("Commande fêtes de fin d'année").id }, livraison: false });
  factureDevis.data.lignes = devisHotel.data.lignes;
  facturer("devis", client("Groupe Scolaire Les Lauriers"), C.jour(-16), lignesCommande([["CAH-96", 1200], ["PAP-A4", 60], ["STY-50", 24], ["RIZ-25", 40]]), { statut: "envoye", extra: { opportuniteId: affaire("Approvisionnement rentrée — internat").id } });
  facturer("devis", client("Supermarché Prosuma Riviera"), C.jour(-3), lignesCommande([["SAV-01", 600], ["JAV-01", 480], ["LES-05", 96]]), { statut: "envoye", extra: { opportuniteId: affaire("Référencement gamme hygiène").id } });
  facturer("devis", client("Traiteur Délices d'Abidjan"), C.jour(-22), lignesCommande([["HUI-05", 40], ["RIZ-25", 30]]), { statut: "refuse" });
  facturer("devis", client("Cantine Université FHB"), C.jour(-21), lignesCommande([["RIZ-25", 200], ["HUI-05", 120], ["TOM-40", 600]]), { statut: "envoye", extra: { opportuniteId: affaire("Cantine 2e semestre").id } });
  facturer("devis", client("Hôtel Tiama"), C.jour(-1), lignesCommande([["SAV-01", 300], ["EAU-15", 60]]), { statut: "brouillon" });
  // Brouillons, annulée, avoir, une facture de l'Éditeur de factures.
  facturer("facture", client("Mini-market Sococé"), C.jour(0), lignesCommande(PANIERS_PRO[4]), { statut: "brouillon" });
  facturer("facture", client("ONG Enfance Solidaire"), C.jour(-1), lignesCommande([["CAH-96", 300], ["STY-50", 6]]), { statut: "brouillon" });
  facturer("facture", client("Pharmacie du Golf"), C.jour(-40), lignesCommande(PANIERS_PRO[2]), { statut: "annule" });
  const avoir = facturer("avoir", client("Supermarché Prosuma Riviera"), C.jour(-18), [{ designation: "Retour marchandise — 12 packs d'eau abîmés", qte: 12, pu: htGros(art["EAU-15"]), remise: 0, tva: 18, articleId: art["EAU-15"].id }], { livraison: false });
  facturer("facture", client("Cabinet Kouamé & Associés"), C.jour(-8), lignesCommande([["PAP-A4", 20], ["CAF-20", 12], ["EAU-15", 10]]), {
    extra: { editeur: true, mode: "standard", modele: "officiel", couleur: "", conditions: "net30", conditionsTexte: "Paiement à 30 jours", moyenPaiement: "virement", afficherLogo: true, afficherSignature: true, montantEnLettres: true },
  });

  // Sorties de stock des factures émises (hors brouillons, annulées, devis).
  for (const f of factures) {
    const d = f.data;
    if (d.type === "devis" || d.statut === "brouillon" || d.statut === "annule") continue;
    for (const l of d.lignes) {
      const a = articles.find((x) => x.id === l.articleId);
      if (!a) continue;
      if (d.type === "avoir") entree(d.date, a.reference, l.qte, { motif: `Retour ${d.numero}`, origine: `facture:${f.id}` });
      else sortie(d.date, a.reference, l.qte, { motif: `Livraison ${d.numero}`, origine: `facture:${f.id}` });
    }
  }

  // Facturation récurrente (Éditeur de factures).
  const recurrent = client("Clinique Sainte-Marie");
  const modeleRec = { type: "facture", devise: "XOF", clientId: recurrent.id, clientNom: recurrent.nom, clientEntreprise: recurrent.entreprise, clientEmail: recurrent.email, clientVille: recurrent.ville, lignes: lignesCommande([["SAV-01", 40], ["JAV-01", 30], ["EAU-15", 20]]), conditions: "net30", mode: "recurrente", editeur: true, recurrente: true };
  ajouter("editeur-factures", "recurrences", { modele: modeleRec, client: recurrent.entreprise, total: totauxFacture(modeleRec).ttc, devise: "XOF", frequence: "mensuel", fin: "", jourOrigine: Number(C.jour(9).slice(8, 10)), prochaine: C.jour(9), derniere: "", actif: true }, { jour: -40 });

  // ---------------------------------------------------------------- Achats
  const commandes = [];
  const commander = (n, fou, jour, statut, lignesRefs, note = "") => {
    const lignes = lignesRefs.map(([ref, qte]) => ({ articleId: art[ref].id, designation: art[ref].designation, qte, pu: art[ref].prixAchat, tva: 18 }));
    const data = { numero: `CMD-${C.annee}-${String(n).padStart(3, "0")}`, date: C.jour(jour), fournisseurId: fournisseurs[fou].id, statut, lignes, note };
    const cid = ajouter("achats", "commandes", data, { jour, par: membres.ibrahim.id });
    const c = { id: cid, data, fou };
    commandes.push(c);
    return c;
  };
  const recevoir = (c, jour, part = 1) => {
    const date = C.jour(jour);
    const lignes = c.data.lignes.map((l) => ({ articleId: l.articleId, designation: l.designation, qte: Math.round(l.qte * part), pu: l.pu }));
    ajouter("achats", "receptions", { commandeId: c.id, date, lignes }, { jour, par: membres.ibrahim.id });
    for (const l of lignes) {
      const a = articles.find((x) => x.id === l.articleId);
      const lot = a.suiviLot ? { lot: `L${date.slice(2, 4)}${date.slice(5, 7)}-${a.reference.slice(0, 3)}`, peremption: C.jour(jour + (a.reference === "LAI-40" ? 40 + 120 : 365)) } : {};
      entree(date, a.reference, l.qte, { motif: `Réception ${c.data.numero}`, origine: `achats:${c.data.numero}:${date}`, prixUnitaire: l.pu, ...lot });
    }
    return lignes;
  };
  const facturesAchat = [];
  const factureFournisseur = (c, jour, reference, lignesRecues) => {
    const ht = lignesRecues.reduce((s, l) => s + l.qte * l.pu, 0);
    const tva = arrondi(ht * 0.18);
    const data = { commandeId: c.id, fournisseurId: c.data.fournisseurId, reference, date: C.jour(jour), ht, tva, ttc: ht + tva };
    const fid = ajouter("achats", "factures", data, { jour, par: membres.yao.id });
    const f = { id: fid, data, fou: c.fou };
    facturesAchat.push(f);
    return f;
  };
  const paiementsAchat = [];
  const payerAchat = (f, jour, montant, moyen = "banque") => {
    const data = { factureId: f.id, montant: arrondi(montant), moyen, date: C.jour(jour) };
    paiementsAchat.push({ id: ajouter("achats", "paiements", data, { jour, par: membres.yao.id }), data, facture: f });
  };
  {
    const c1 = commander(1, "sodiaci", -70, "envoyee", [["RIZ-25", 60], ["HUI-05", 80], ["SUC-01", 200], ["LAI-40", 480]]);
    const r1 = recevoir(c1, -63);
    payerAchat(factureFournisseur(c1, -62, "SOD-F-24811", r1), -40, r1.reduce((s, l) => s + l.qte * l.pu, 0) * 1.18);
    const c2 = commander(2, "boissons", -45, "envoyee", [["EAU-15", 150], ["JUS-01", 200]]);
    const r2 = recevoir(c2, -41);
    const f2 = factureFournisseur(c2, -41, "BE-2026-1187", r2);
    payerAchat(f2, -20, Math.round((f2.data.ttc * 0.5) / 1000) * 1000, "mobile");
    const c3 = commander(3, "hygiene", -20, "envoyee", [["SAV-01", 240], ["JAV-01", 120], ["LES-05", 36]]);
    const r3 = recevoir(c3, -15, 0.5);
    factureFournisseur(c3, -14, "HP-00932", r3);
    commander(4, "bureau", -4, "envoyee", [["STY-50", 20], ["PAP-A4", 40], ["CAH-96", 400]], "Urgent : stylos en rupture, livrer avant la fin de semaine");
    commander(5, "sodiaci", -1, "brouillon", [["CAF-20", 48], ["TOM-40", 240], ["SPA-50", 300]]);
  }

  // ---------------------------------------------------------------- Stock : état final
  // Transfert vers le dépôt, inventaire tournant avec une casse.
  mouvements.push({ date: C.jour(-30), ref: "RIZ-25", delta: 0, data: { sens: "transfert", quantite: 20, de: "", vers: depotId, motif: "Réassort du dépôt de Yopougon" } });
  mouvements.push({ date: C.jour(-30), ref: "EAU-15", delta: 0, data: { sens: "transfert", quantite: 30, de: "", vers: depotId, motif: "Réassort du dépôt de Yopougon" } });
  const casse = { ref: "JAV-01", date: C.jour(-22), perdus: 4 };

  // Le stock de départ (bilan d'ouverture, il y a 200 jours) est ce qui
  // mène au stock visé : visé − Σ mouvements + pertes d'inventaire.
  for (const a of articles) {
    const somme = mouvements.filter((m) => m.ref === a.reference).reduce((s, m) => s + m.delta, 0);
    const pertes = a.reference === casse.ref ? casse.perdus : 0;
    const depart = Math.max(0, a.cible - somme + pertes);
    const lot = a.suiviLot ? { lot: `L${C.jour(-200).slice(2, 4)}${C.jour(-200).slice(5, 7)}-${a.reference.slice(0, 3)}`, peremption: C.jour(a.reference === "LAI-40" ? 21 : 200) } : {};
    mouvements.push({ date: C.jour(-200), ref: a.reference, delta: depart, data: { sens: "entree", quantite: depart, motif: "Stock initial (inventaire d'ouverture)", prixUnitaire: a.prixAchat, ...lot } });
  }
  // Inventaire : on rejoue le stock jusqu'à sa date pour poser le niveau compté.
  {
    const a = art[casse.ref];
    const avant = mouvements.filter((m) => m.ref === casse.ref && m.date <= casse.date).reduce((s, m) => s + m.delta, 0);
    const invId = id();
    mouvements.push({ date: casse.date, ref: casse.ref, delta: -casse.perdus, data: { sens: "inventaire", quantite: avant - casse.perdus, entrepotId: "", motif: "Inventaire INV-0001", cause: "casse", origine: `inventaire:${invId}:${a.id}` } });
    const lignes = articles.filter((x) => x.categorieId === a.categorieId).map((x) => {
      const attendu = mouvements.filter((m) => m.ref === x.reference && m.date <= casse.date && m.data.sens !== "inventaire").reduce((s, m) => s + m.delta, 0);
      return { articleId: x.id, attendu, compte: x.reference === casse.ref ? attendu - casse.perdus : attendu, cause: x.reference === casse.ref ? "casse" : "" };
    });
    ajouter("stock", "inventaires", { numero: "INV-0001", date: casse.date, entrepotId: "", portee: "categorie", categorieId: a.categorieId, statut: "valide", par: "Ibrahim Diabaté", lignes, valideLe: casse.date, valeurEcart: -casse.perdus * a.prixAchat }, { jour: casse.date, par: membres.ibrahim.id, rid: invId });
  }
  mouvements.sort((x, y) => x.date.localeCompare(y.date));
  for (const m of mouvements) {
    const data = { articleId: art[m.ref].id, date: m.date, motif: "", ...m.data };
    if (data.sens !== "transfert" && data.entrepotId === undefined) data.entrepotId = "";
    ajouter("stock", "mouvements", data, { jour: m.date, heure: 10, par: membres.ibrahim.id });
  }

  // ---------------------------------------------------------------- RH
  const salaries = [];
  let matricule = 0;
  const embaucher = (p, extra = {}) => {
    matricule += 1;
    const email = p.userEmail || emailMembre(p);
    const data = {
      matricule: `SAL-${String(matricule).padStart(3, "0")}`,
      nom: p.nom,
      prenom: p.prenom,
      photo: "",
      sexe: p.sexe,
      dateNaissance: p.naissance,
      telephone: `+225 07 ${String(55 + matricule).padStart(2, "0")} 12 34 ${String(10 + matricule * 7).slice(-2)}`,
      email,
      adresse: H.choix(["Cocody Angré 8e tranche", "Yopougon Maroc", "Marcory Résidentiel", "Abobo Baoulé", "Koumassi Remblais", "Riviera Palmeraie"]),
      ville: "Abidjan",
      poste: p.poste,
      departement: p.departement,
      typeContrat: p.contrat || "cdi",
      dateEmbauche: p.embauche || C.jour(-(150 - (p.finDans || 0))),
      dateFin: p.finDans ? C.jour(p.finDans) : "",
      salaireBase: p.salaire,
      numeroCnps: `${1000000000 + matricule * 7654321}`.slice(0, 10),
      banque: p.salaire >= 160000 ? `SGBCI CI008 01245 ${String(100000000000 + matricule * 13579).slice(0, 12)} ${String(10 + matricule).slice(-2)}` : "",
      statut: "actif",
      reportConges: matricule % 3 === 0 ? 4 : 0,
      userId: p.userId || "",
      notes: "",
      situation: p.situation,
      enfants: p.enfants,
      ...extra,
    };
    const sid = ajouter("rh", "salaries", data, { jour: data.dateEmbauche < C.jour(-700) ? -700 : data.dateEmbauche, par: membres.yao.id });
    const s = { id: sid, data };
    salaries.push(s);
    return s;
  };
  for (const m of EQUIPE) embaucher({ ...m, userId: membres[m.cle].id, userEmail: membres[m.cle].email });
  for (const p of AUTRES_SALARIES) embaucher(p);
  const sal = (prenom) => salaries.find((s) => s.data.prenom === prenom);

  ajouter("rh", "reglages", { acquisParMois: 2.2, joursOuvres: [1, 2, 3, 4, 5, 6], feries: [`${C.annee}-01-01`, `${C.annee}-05-01`, `${C.annee}-08-07`, `${C.annee}-08-15`, `${C.annee}-11-01`, `${C.annee}-11-15`, `${C.annee}-12-25`] }, { jour: -300 });
  const absences = [];
  const absence = (prenom, type, du, au, motif, etat, decide = true) => {
    const data = { salarieId: sal(prenom).id, type, du: C.jour(du), au: C.jour(au), motif, etat };
    if (etat !== "demande" && decide) Object.assign(data, { decidePar: "Aïcha Koné", dateDecision: C.jour(Math.min(du, 0) - 5) });
    absences.push({ id: ajouter("rh", "absences", data, { jour: Math.min(du, 0) - 8, par: sal(prenom).data.userId || membres.yao.id }), data });
  };
  // Les congés annuels des années passées (le mois d'août) : sans
  // eux, le solde affiché cumulerait toutes les années depuis l'embauche.
  for (const s of salaries) {
    const debut = Number(s.data.dateEmbauche.slice(0, 4)) + 1;
    for (let a = debut; a < C.annee; a++) {
      const data = { salarieId: s.id, type: "conge", du: `${a}-08-01`, au: `${a}-08-31`, motif: "Congés annuels", etat: "approuve", decidePar: "Aïcha Koné", dateDecision: `${a}-06-15` };
      absences.push({ id: ajouter("rh", "absences", data, { jour: C.ecart(`${a}-06-10`), par: s.data.userId || membres.yao.id }), data });
    }
  }
  absence("Yao", "conge", -75, -64, "Congés annuels", "approuve");
  absence("Mariam", "conge", -48, -44, "Mariage d'une sœur à Bouaké", "approuve");
  absence("Ibrahim", "maladie", -1, 2, "Arrêt maladie (certificat médical)", "approuve");
  absence("Serge", "permission", -33, -33, "Démarches administratives", "approuve");
  absence("Esther", "conge", 12, 16, "Congés — voyage familial", "approuve");
  absence("Koffi", "conge", 60, 73, "Congés de fin d'année", "demande");
  absence("Fatou", "conge", 20, 22, "Baptême", "demande");
  absence("Mariam", "conge", 5, 9, "Repos", "refuse");

  // Notes de frais, avec justificatif (PDF dans le Cloud).
  const notesFrais = [];
  const NOTES = [
    ["Esther", -18, "transport", 12500, "Taxis — tournée clients Riviera et Angré", "remboursee"],
    ["Koffi", -12, "carburant", 25000, "Carburant moto — prospection Bingerville", "approuvee"],
    ["Serge", -9, "repas", 38000, "Déjeuner de travail avec le transitaire", "approuvee"],
    ["Esther", -4, "communication", 10000, "Recharge internet — salon professionnel", "soumise"],
    ["Koffi", -2, "transport", 7500, "Taxi — livraison urgente Plateau", "soumise"],
    ["Ibrahim", -6, "fournitures", 15500, "Rubans adhésifs et cutters pour le dépôt", "refusee"],
    ["Serge", -25, "hebergement", 45000, "Nuit à Yamoussoukro — visite fournisseur", "remboursee"],
  ];
  for (const [prenom, jour, categorie, montant, description, etat] of NOTES) {
    const nomFichier = `recu-${categorie}-${C.jour(jour)}.pdf`;
    const fid = fichier("Notes de frais", nomFichier, pdfTexte("Reçu", [`Date : ${C.jour(jour)}`, `Objet : ${description}`, `Montant : ${montant.toLocaleString("fr-FR").replace(/\u202f/g, " ")} FCFA`, "Payé en espèces", "", "Merci de votre visite."]), "application/pdf");
    const data = { salarieId: sal(prenom).id, date: C.jour(jour), categorie, montant, description, justificatif: { id: fid, name: nomFichier, mimeType: "application/pdf", size: 0, type: "FILE" }, etat };
    notesFrais.push({ id: ajouter("frais", "notes", data, { jour, par: sal(prenom).data.userId || membres.yao.id }), data, prenom });
  }

  // ---------------------------------------------------------------- Paie
  const bulletins = [];
  const cycles = [];
  for (const [n, etat] of [[-3, "declare"], [-2, "declare"], [-1, "paye"]]) {
    const mois = C.mois(n);
    for (const s of salaries) {
      if (s.data.dateEmbauche > `${mois}-31`) continue;
      const saisie = saisieInitiale({ salarie: s, mois, bulletins, absences, notes: [] });
      if (s.data.departement === "Ventes" && s.data.typeContrat !== "stage") saisie.primes = n === -1 ? 45000 : 30000;
      if (s.data.prenom === "Ibrahim") saisie.heuresSup = { h15: 6 };
      const calcul = calculer(s, saisie);
      const data = { mois, matricule: s.data.matricule, saisie, calcul };
      bulletins.push({ id: ajouter("paie", "bulletins", data, { jour: C.ecart(`${mois}-25`), par: membres.yao.id }), data, salarie: s });
    }
    const fin = C.dansMois(n, 28);
    const decl = C.dansMois(n + 1, 12);
    const cycle = { mois, etat, valideLe: C.dansMois(n, 26), validePar: "Yao Kouassi", payeLe: fin, declarations: {} };
    if (etat === "declare") for (const k of ["cnps", "its", "fdfp", "cmu"]) cycle.declarations[k] = { le: decl, par: "Yao Kouassi" };
    cycles.push(cycle);
    ajouter("paie", "cycles", cycle, { jour: C.ecart(cycle.valideLe), par: membres.yao.id });
  }

  // ---------------------------------------------------------------- Comptabilité
  const ecritures = [];
  const compteurs = {};
  const ecrire = (e, jourCree) => {
    const annee = e.date.slice(0, 4);
    const cle = `${e.journal}-${annee}`;
    compteurs[cle] = (compteurs[cle] || 0) + 1;
    const data = { piece: "", tiers: "", ...e, numero: `${e.journal}-${annee}-${String(compteurs[cle]).padStart(4, "0")}` };
    const eid = ajouter("comptabilite", "ecritures", data, { jour: jourCree ?? e.date, heure: 17, par: membres.yao.id });
    ecritures.push({ id: eid, data });
    return eid;
  };
  const aComptabiliser = []; // tout est écrit dans l'ordre chronologique
  // Bilan d'ouverture
  aComptabiliser.push({ date: `${C.annee}-01-01`, journal: "OD", libelle: "Bilan d'ouverture — reprise des soldes au 1er janvier", source: "Reprise", lignes: [
    { compte: "521", debit: 18_400_000, credit: 0 }, { compte: "531", debit: 2_350_000, credit: 0 }, { compte: "571", debit: 650_000, credit: 0 },
    { compte: "311", debit: 12_800_000, credit: 0 }, { compte: "244", debit: 6_500_000, credit: 0 },
    { compte: "101", debit: 0, credit: 25_000_000 }, { compte: "162", debit: 0, credit: 8_200_000 }, { compte: "401", debit: 0, credit: 7_500_000 },
  ] });
  // Factures et règlements (sauf les tout derniers : ils restent « à traiter »).
  const limiteVentes = C.jour(-2);
  for (const f of factures) {
    const d = f.data;
    if ((d.type !== "facture" && d.type !== "avoir") || d.statut === "brouillon" || d.statut === "annule") continue;
    if (d.date > limiteVentes) continue;
    const t = totauxFacture(d);
    const s = d.type === "avoir" ? -1 : 1;
    const lignes = [{ compte: "411", debit: Math.round(t.ttc * s), credit: 0 }, { compte: "701", debit: 0, credit: Math.round(t.ht * s) }];
    if (Math.abs(t.tva) >= 1) lignes.push({ compte: "4431", debit: 0, credit: Math.round(t.tva * s) });
    aComptabiliser.push({ date: d.date, journal: "VTE", libelle: `${d.type === "avoir" ? "Avoir" : "Facture"} ${d.numero} — ${d.clientNom}`, piece: d.numero, tiers: d.clientNom, echeance: d.echeance, origine: `facture:${f.id}`, source: "Facturation", lignes });
  }
  const parMoyen = { Espèces: ["571", "CAI"], "Mobile Money": ["531", "MM"], Virement: ["521", "BQ"], Chèque: ["521", "BQ"], "Carte bancaire": ["521", "BQ"] };
  for (const r of reglements) {
    if (r.data.date > limiteVentes) continue;
    const [compte, journal] = parMoyen[r.data.moyen];
    aComptabiliser.push({ date: r.data.date, journal, libelle: `Règlement ${r.facture.data.numero} (${r.data.moyen})`, piece: r.facture.data.numero, tiers: r.facture.data.clientNom, origine: `reglement:${r.id}`, source: "Facturation", lignes: [{ compte, debit: r.data.montant, credit: 0 }, { compte: "411", debit: 0, credit: r.data.montant }] });
  }
  // Tickets de caisse (ceux d'aujourd'hui restent « à traiter »).
  for (const t of tickets) {
    if (t.jour === 0) continue;
    const d = t.data;
    const lignes = [];
    for (const p of d.paiements) {
      const compte = { especes: "571", mobile: "531", carte: "521", virement: "521" }[p.moyen];
      const montant = p.moyen === "especes" ? p.montant - d.rendu : p.montant;
      lignes.push({ compte, debit: montant, credit: 0 });
    }
    lignes.push({ compte: "701", debit: 0, credit: d.ht }, { compte: "4431", debit: 0, credit: d.tva });
    aComptabiliser.push({ date: d.date, journal: "CAI", libelle: `Vente comptoir ${d.numero}`, piece: d.numero, origine: `caisse:${d.numero}`, source: "Caisse", lignes });
  }
  // Achats : factures fournisseurs et paiements (la plus récente reste à traiter).
  for (const f of facturesAchat) {
    if (f.data.date > C.jour(-20)) continue;
    const nom = fournisseurs[f.fou].nom;
    aComptabiliser.push({ date: f.data.date, journal: "ACH", libelle: `Facture ${f.data.reference} — ${nom}`, piece: f.data.reference, tiers: nom, origine: `achat-facture:${f.id}`, source: "Achats", lignes: [{ compte: "601", debit: f.data.ht, credit: 0 }, { compte: "4452", debit: f.data.tva, credit: 0 }, { compte: "401", debit: 0, credit: f.data.ttc }] });
  }
  for (const p of paiementsAchat) {
    const nom = fournisseurs[p.facture.fou].nom;
    const compte = { especes: "571", mobile: "531", banque: "521" }[p.data.moyen];
    aComptabiliser.push({ date: p.data.date, journal: compte === "521" ? "BQ" : compte === "531" ? "MM" : "CAI", libelle: `Paiement ${p.facture.data.reference} — ${nom}`, piece: p.facture.data.reference, tiers: nom, origine: `achat-paiement:${p.id}`, source: "Achats", lignes: [{ compte: "401", debit: p.data.montant, credit: 0 }, { compte, debit: 0, credit: p.data.montant }] });
  }
  // Paie : les deux mois déclarés sont comptabilisés et virés ; le dernier
  // mois reste « à traiter ».
  for (const b of bulletins) {
    const mois = b.data.mois;
    if (mois === C.mois(-1)) continue;
    const e = ecritureDeBulletin(b.data.calcul, b.salarie.data, mois);
    aComptabiliser.push({ ...e, journal: "OD" });
  }
  for (const n of [-3, -2]) {
    const mois = C.mois(n);
    const net = bulletins.filter((b) => b.data.mois === mois).reduce((s, b) => s + b.data.calcul.net, 0);
    aComptabiliser.push({ date: C.dansMois(n, 28), journal: "BQ", libelle: `Virement des salaires de ${mois}`, piece: `PAIE-${mois}`, origine: `paie-virement:${mois}`, source: "Paie", lignes: [{ compte: "421", debit: net, credit: 0 }, { compte: "521", debit: 0, credit: net }] });
  }
  // Notes de frais remboursées.
  for (const n of notesFrais) {
    if (n.data.etat !== "remboursee") continue;
    const nom = `${n.prenom} ${sal(n.prenom).data.nom}`;
    const compte = { transport: "614", carburant: "605", repas: "638", hebergement: "638", fournitures: "605", communication: "628" }[n.data.categorie] || "638";
    aComptabiliser.push({ date: n.data.date, journal: "OD", libelle: `Note de frais — ${n.data.description} (${nom})`, piece: `NDF-${n.data.date}`, tiers: nom, origine: `frais:${n.id}`, source: "Frais", lignes: [{ compte, debit: n.data.montant, credit: 0 }, { compte: "421", debit: 0, credit: n.data.montant }] });
    aComptabiliser.push({ date: C.jour(C.ecart(n.data.date) + 5), journal: "CAI", libelle: `Remboursement note de frais (${nom})`, piece: `NDF-${n.data.date}`, tiers: nom, lignes: [{ compte: "421", debit: n.data.montant, credit: 0 }, { compte: "571", debit: 0, credit: n.data.montant }] });
  }
  // Charges courantes de chaque mois.
  for (let m = -6; m <= 0; m++) {
    const charge = (j, journal, libelle, compte, ht, tva, tresorerie, tiers = "") => {
      const date = C.dansMois(m, j);
      if (C.ecart(date) > -1) return;
      const lignes = [{ compte, debit: ht, credit: 0 }];
      if (tva) lignes.push({ compte: "4452", debit: tva, credit: 0 });
      lignes.push({ compte: tresorerie, debit: 0, credit: ht + tva });
      aComptabiliser.push({ date, journal, libelle, tiers, piece: `${compte}-${date.slice(0, 7)}`, lignes });
    };
    charge(5, "BQ", "Loyer du siège et du dépôt", "622", 650_000, 117_000, "521", "SCI Les Palmiers");
    charge(12, "BQ", "Électricité et eau (CIE / SODECI)", "605", 98_000 + (m % 2) * 7_000, 17_640 + (m % 2) * 1_260, "521", "CIE");
    charge(15, "MM", "Internet et téléphonie (Orange Business)", "628", 45_000, 8_100, "531", "Orange CI");
    charge(20, "BQ", "Frais et commissions bancaires", "631", 12_500, 0, "521", "SGBCI");
    charge(22, "CAI", "Carburant des véhicules de livraison", "605", 135_000, 0, "571", "Total Énergies");
    if (m % 2 === 0) charge(18, "BQ", "Publicité — spots radio et réseaux sociaux", "627", 250_000, 45_000, "521", "Agence Pulse");
    // Remontée des espèces de la caisse vers la banque, chaque fin de mois.
    const depot = C.dansMois(m, 27);
    if (C.ecart(depot) < -1) aComptabiliser.push({ date: depot, journal: "OD", libelle: "Versement des espèces en banque", piece: `VERS-${depot.slice(0, 7)}`, lignes: [{ compte: "585", debit: 1_800_000, credit: 0 }, { compte: "571", debit: 0, credit: 1_800_000 }, { compte: "521", debit: 1_800_000, credit: 0 }, { compte: "585", debit: 0, credit: 1_800_000 }] });
  }
  aComptabiliser.sort((a, b) => a.date.localeCompare(b.date));

  // TVA : déclaration et paiement de chaque mois clos (au 15 du suivant).
  const tvaDeclarees = {};
  const avecTva = [];
  for (let m = -6; m <= -2; m++) {
    const mois = C.mois(m);
    const duMois = aComptabiliser.filter((e) => e.date.startsWith(mois)).flatMap((e) => e.lignes);
    const collectee = duMois.filter((l) => l.compte === "4431").reduce((s, l) => s + l.credit - l.debit, 0);
    const deductible = duMois.filter((l) => l.compte === "4452").reduce((s, l) => s + l.debit - l.credit, 0);
    const due = collectee - deductible;
    const le = C.dansMois(m + 1, 15);
    if (due <= 0) continue;
    avecTva.push({ date: le, journal: "OD", libelle: `Déclaration de TVA de ${mois}`, piece: `TVA-${mois}`, origine: `tva:${mois}`, source: "TVA", lignes: [{ compte: "4431", debit: collectee, credit: 0 }, { compte: "4452", debit: 0, credit: deductible }, { compte: "4441", debit: 0, credit: due }] });
    avecTva.push({ date: le, journal: "BQ", libelle: `Paiement de la TVA de ${mois} (DGI)`, piece: `TVA-${mois}`, lignes: [{ compte: "4441", debit: due, credit: 0 }, { compte: "521", debit: 0, credit: due }] });
    tvaDeclarees[mois] = { le, montant: due, credit: 0 };
  }
  const tout = [...aComptabiliser, ...avecTva].sort((a, b) => a.date.localeCompare(b.date));
  for (const e of tout) ecrire(e);

  const clotureAu = C.dansMois(-2, 31);
  ajouter("comptabilite", "reglages", {
    clotureAu,
    historique: [{ au: clotureAu, le: C.dansMois(-1, 10), par: "Yao Kouassi" }],
    tvaDeclarees,
    regles: [
      { contient: "ORANGE", compte: "628", libelle: "Internet et téléphonie" },
      { contient: "CIE", compte: "605", libelle: "Électricité" },
      { contient: "FRAIS", compte: "631", libelle: "Frais bancaires" },
    ],
  }, { jour: -40, par: membres.yao.id });

  // Relevé bancaire du mois dernier : les mouvements de la banque, plus des
  // frais que le comptable n'a pas encore saisis (à rapprocher).
  {
    const mois = C.mois(-1);
    const sansAccent = (s) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().slice(0, 40);
    const lignes = [];
    const vus = new Map();
    for (const e of ecritures) {
      if (!e.data.date.startsWith(mois)) continue;
      e.data.lignes.forEach((l, i) => {
        if (l.compte !== "521") return;
        const montant = l.debit - l.credit;
        const libelle = e.data.libelle.toUpperCase();
        const cle = `${e.data.date}|${montant}|${sansAccent(libelle)}`;
        const k = (vus.get(cle) || 0) + 1;
        vus.set(cle, k);
        lignes.push({ id: `${cle}|${k}`, date: e.data.date, libelle, montant, reference: e.data.piece || "", ecriture: `${e.id}#${i}` });
      });
    }
    const date = C.dansMois(-1, 28);
    for (const [libelle, montant] of [["FRAIS TENUE DE COMPTE", -7500], ["AGIOS TRIMESTRIELS", -18250]]) {
      lignes.push({ id: `${date}|${montant}|${sansAccent(libelle)}|1`, date, libelle, montant, reference: "" });
    }
    lignes.sort((a, b) => a.date.localeCompare(b.date));
    const solde = ecritures.filter((e) => e.data.date <= C.dansMois(-1, 31)).flatMap((e) => e.data.lignes).filter((l) => l.compte === "521").reduce((s, l) => s + l.debit - l.credit, 0) - 25750;
    const nom = `releve-sgbci-${mois}.csv`;
    const fid = fichier("Comptabilité", nom, Buffer.from(csv([["Date", "Libellé", "Montant", "Référence"], ...lignes.map((l) => [l.date, l.libelle, l.montant, l.reference])]), "utf8"), "text/csv");
    ajouter("comptabilite", "releves", { compte: "521", fichier: { id: fid, name: nom }, du: `${mois}-01`, au: C.dansMois(-1, 31), solde, importeLe: C.dansMois(0, 2) < C.jour(0) ? C.dansMois(0, 2) : C.jour(0), lignes: lignes.slice(0, 250) }, { jour: -10, par: membres.yao.id });
  }

  // ---------------------------------------------------------------- Agenda
  const EVENEMENTS = [
    ["Point hebdomadaire de l'équipe", 0, "08:30", "Salle de réunion — siège", null],
    ["Dégustation Leader Price au dépôt", 0, "11:00", "Dépôt de Yopougon", "Supermarché Leader Price Yopougon"],
    ["Rendez-vous banque — ligne de crédit", 1, "10:00", "SGBCI Marcory", null],
    ["Livraison Hôtel Ivoire Lagune", 2, "07:30", "Cocody — quai fournisseurs", "Hôtel Ivoire Lagune"],
    ["Visite fournisseur SODIACI", 3, "15:00", "Vridi, zone portuaire", null],
    ["Inventaire tournant — hygiène", 5, "", "Boutique et dépôt", null],
    ["Réunion commerciale mensuelle", 7, "09:00", "Siège", null],
    ["Présentation catalogue — Cantine FHB", 9, "14:30", "Université FHB, Cocody", "Cantine Université FHB"],
    ["Comité de direction", 14, "09:00", "Siège", null],
    ["Échéance déclaration CNPS", 18, "", "", null],
    ["Formation caisse — nouvelle version", -2, "16:00", "Boutique", null],
    ["Rendez-vous Orange Business", -6, "10:30", "Plateau", "Orange CI — Agence Marcory"],
  ];
  for (const [titre, j, heure, lieu, nomClient] of EVENEMENTS) {
    ajouter("agenda", "evenements", { titre, date: C.jour(j), heure, fin: "", lieu, ...(nomClient ? { clientId: client(nomClient).id } : {}) }, { jour: Math.min(j, 0) - 4 });
  }
  ajouter("agenda", "evenements", { titre: "Salon Agro-Alimentaire d'Abidjan (SARA)", date: C.jour(24), heure: "", fin: C.jour(27), lieu: "Parc des expositions, Port-Bouët" }, { jour: -20 });

  // ---------------------------------------------------------------- Projets
  const colonnes = (...titres) => titres.map((titre, i) => ({ id: `c${i}${slug(titre).slice(0, 6)}`, titre }));
  const tYop = { id: id(), colonnes: colonnes("À faire", "En cours", "En validation", "Terminé") };
  ajouter("projets", "tableaux", { nom: "Ouverture du dépôt de Yopougon", couleur: "#0079bf", colonnes: tYop.colonnes }, { jour: -90, par: membres.serge.id, rid: tYop.id });
  const tWeb = { id: id(), colonnes: colonnes("Idées", "À faire", "En cours", "Terminé") };
  ajouter("projets", "tableaux", { nom: "Boutique en ligne & livraisons", couleur: "#519839", colonnes: tWeb.colonnes }, { jour: -45, par: membres.serge.id, rid: tWeb.id });
  const carte = (t, col, ordre, titre, extra = {}) =>
    ajouter("projets", "cartes", { tableauId: t.id, colonneId: t.colonnes[col].id, ordre: ordre * 1000, titre, description: "", echeance: null, assigneId: null, etiquettes: [], checklist: [], commentaires: [], pieces: [], liens: {}, ...extra }, { jour: -40 + ordre, par: membres.serge.id });
  const chk = (...items) => items.map(([texte, fait], i) => ({ id: `k${i}`, texte, fait }));
  const com = (auteur, texte, j) => ({ id: id().slice(0, 9), auteur, texte, date: C.instant(j, 15).toISOString() });
  carte(tYop, 3, 1, "Signature du bail et état des lieux", { assigneId: proprio.id, echeance: C.jour(-60), checklist: chk(["Négocier le loyer", true], ["Signer le bail", true], ["État des lieux", true]) });
  carte(tYop, 3, 2, "Installation des rayonnages", { assigneId: membres.ibrahim.id, echeance: C.jour(-35), etiquettes: ["interne"] });
  carte(tYop, 2, 3, "Raccordement électrique et alarme", { assigneId: membres.serge.id, echeance: C.jour(-1), etiquettes: ["attente"], checklist: chk(["Devis électricien", true], ["Travaux", true], ["Contrôle CIE", false]), commentaires: [com("Serge Bamba", "Le contrôleur de la CIE passe jeudi.", -2)] });
  carte(tYop, 1, 4, "Recrutement de deux magasiniers", { assigneId: proprio.id, echeance: C.jour(10), checklist: chk(["Fiche de poste", true], ["Annonce", true], ["Entretiens", false], ["Contrats", false]), commentaires: [com("Aïcha Koné", "12 candidatures reçues, entretiens la semaine prochaine.", -3)] });
  carte(tYop, 1, 5, "Logiciel de stock multi-entrepôts", { assigneId: membres.ibrahim.id, echeance: C.jour(5), etiquettes: ["interne"], description: "Paramétrer le dépôt dans l'app Stock, former l'équipe aux transferts." });
  carte(tYop, 0, 6, "Inauguration avec les clients VIP", { assigneId: membres.esther.id, echeance: C.jour(30), etiquettes: ["client"], liens: { clientId: client("Hôtel Ivoire Lagune").id } });
  carte(tYop, 0, 7, "Assurance multirisque du dépôt", { assigneId: membres.yao.id, echeance: C.jour(-3), etiquettes: ["urgent"] });
  carte(tYop, 1, 8, "Livraison Hôtel Résidence Assinie (commande de fin d'année)", { assigneId: membres.ibrahim.id, echeance: C.jour(4), etiquettes: ["client", "facture"], liens: { clientId: client("Hôtel Résidence Assinie").id, opportuniteId: affaire("Commande fêtes de fin d'année").id, factureId: factureDevis.id } });
  carte(tWeb, 3, 1, "Choix du prestataire de paiement mobile", { assigneId: membres.serge.id, checklist: chk(["Orange Money", true], ["Wave", true], ["MTN MoMo", true]) });
  carte(tWeb, 2, 2, "Photos des 50 produits phares", { assigneId: membres.mariam.id, echeance: C.jour(6), checklist: chk(["Alimentaire", true], ["Boissons", true], ["Hygiène", false], ["Fournitures", false]) });
  carte(tWeb, 2, 3, "Grille tarifaire de livraison par commune", { assigneId: membres.serge.id, echeance: C.jour(3), etiquettes: ["interne"] });
  carte(tWeb, 1, 4, "Campagne de lancement (e-mail + réseaux)", { assigneId: membres.esther.id, echeance: C.jour(20), etiquettes: ["client"] });
  carte(tWeb, 1, 5, "Conditions générales de vente en ligne", { assigneId: proprio.id, echeance: C.jour(12), etiquettes: ["attente"] });
  carte(tWeb, 0, 6, "Programme de fidélité clients pros", { etiquettes: [] });

  // ---------------------------------------------------------------- Campagnes
  const destinataires = (cibles, debut, { ouverture = 0.48, clic = 0.14 } = {}) =>
    cibles.map((c, i) => {
      const envoye = new Date(debut.getTime() + i * 40_000);
      const ouvert = H.vrai(ouverture);
      const clique = ouvert && H.vrai(clic / ouverture);
      const d = { clientId: c.id, email: c.email, nom: c.entreprise, contact: c.nom, prenom: c.nom.replace(/^(Mme|M\.|Dr|Me|Frère) /, "").split(" ")[0], ville: c.ville, statut: "envoye", erreur: null, envoyeLe: envoye.toISOString() };
      if (ouvert) Object.assign(d, { ouvert: true, ouvertLe: new Date(envoye.getTime() + H.entier(5, 600) * 60_000).toISOString() });
      if (clique) Object.assign(d, { clique: true, cliqueLe: new Date(Date.parse(d.ouvertLe) + H.entier(1, 20) * 60_000).toISOString(), liens: [0] });
      return d;
    });
  const blocsPromo = (titre, texte, bouton, produitsRefs = []) => [
    { id: "b1", type: "titre", texte: titre, taille: "grand", align: "centre" },
    { id: "b2", type: "texte", texte },
    ...(produitsRefs.length ? [{ id: "b3", type: "produits", produits: produitsRefs.map((r) => ({ articleId: art[r].id, nom: art[r].designation, prix: `${art[r].prixVente.toLocaleString("fr-FR").replace(/\u202f/g, " ")} F`, url: "https://www.akwaba-distribution.ci/catalogue" })), afficherPrix: true }] : []),
    { id: "b4", type: "bouton", label: bouton, url: "https://www.akwaba-distribution.ci/catalogue", align: "centre" },
    { id: "b5", type: "separateur", style: "ligne" },
    { id: "b6", type: "reseaux", site: "https://www.akwaba-distribution.ci", whatsapp: "+2250707264800", facebook: "https://facebook.com/akwabadistribution", instagram: "", linkedin: "" },
    { id: "b7", type: "signature", texte: "L'équipe Akwaba Distribution\n+225 27 21 26 48 00" },
  ];
  const filtresVides = { statut: "tous", villes: [], secteurs: [], etiquettes: [], achatMois: 0, repos: 0, ids: null };
  const campagne = (nom, sujet, apercu, jour, etiquettes, blocs, extra = {}) => {
    const cibles = clients.filter((c) => c.statut !== "inactif" && c.etiquettes.some((e) => etiquettes.includes(e)));
    const debut = C.instant(jour, 8);
    const data = { nom, sujet, apercu, texte: "", cta: { label: blocs.find((b) => b.type === "bouton")?.label || "", url: "https://www.akwaba-distribution.ci/catalogue" }, couleur: "#e8590c", langue: "fr", blocs, filtres: { ...filtresVides, etiquettes }, exclus: [], statut: "terminee", envoyerLe: debut.toISOString(), creeLe: C.instant(jour - 2, 16).toISOString(), termineeLe: new Date(debut.getTime() + 20 * 60_000).toISOString(), ab: { actif: false, sujetB: "", part: 20, heures: 4, gagnant: "" }, destinataires: destinataires(cibles, debut, extra.taux), ...extra.data };
    ajouter("campagnes", "campagnes", data, { jour: jour - 2, par: membres.esther.id });
  };
  campagne("Rentrée scolaire — kits fournitures", "Vos fournitures de rentrée livrées en 48 h", "Cahiers, ramettes et stylos à prix grossiste", -40, ["Écoles"], blocsPromo("Rentrée : tout est prêt", "Bonjour {{prenom}},\n\nPréparez la rentrée sereinement : nous livrons vos kits fournitures en 48 h partout à Abidjan.", "Commander mes kits", ["CAH-96", "PAP-A4", "STY-50"]), { taux: { ouverture: 0.62, clic: 0.24 } });
  campagne("Nouveautés boissons — hôtels & restaurants", "Nouvelle gamme de jus locaux pour vos clients", "Jus d'orange pressé, eau minérale : tarifs pros", -24, ["Hôtellerie", "Restauration"], blocsPromo("La fraîcheur, livrée", "Bonjour {{prenom}},\n\nDécouvrez notre nouvelle gamme de boissons, idéale pour vos chambres et vos tables.", "Voir les boissons", ["JUS-01", "EAU-15"]), { taux: { ouverture: 0.55, clic: 0.18 }, data: { ab: { actif: true, sujetB: "{{prenom}}, vos clients vont adorer ces jus", part: 20, heures: 4, gagnant: "B", decideLe: C.instant(-24, 12).toISOString() } } });
  campagne("Offre fin de mois grossistes", "-8 % sur le riz et l'huile jusqu'à dimanche", "Offre réservée à nos clients grossistes", -9, ["Grossiste", "Grande distribution"], blocsPromo("-8 % sur l'essentiel", "Bonjour {{prenom}},\n\nJusqu'à dimanche, profitez de -8 % sur le riz parfumé et l'huile végétale.", "J'en profite", ["RIZ-25", "HUI-05"]), { taux: { ouverture: 0.44, clic: 0.12 } });
  ajouter("campagnes", "campagnes", { nom: "Fêtes de fin d'année", sujet: "Préparez les fêtes avec Akwaba", apercu: "Commandez avant le 10 décembre", texte: "", cta: { label: "Réserver ma commande", url: "https://www.akwaba-distribution.ci/fetes" }, couleur: "#c2410c", langue: "fr", blocs: blocsPromo("Les fêtes approchent", "Bonjour {{prenom}},\n\nRéservez dès maintenant vos produits pour les fêtes et bénéficiez d'une livraison prioritaire.", "Réserver ma commande", ["JUS-01", "CAF-20", "LAI-40"]), filtres: { ...filtresVides, statut: "actif" }, exclus: [], statut: "brouillon", envoyerLe: "", creeLe: C.instant(-1, 11).toISOString(), ab: { actif: false, sujetB: "", part: 20, heures: 4, gagnant: "" }, destinataires: [] }, { jour: -1, par: membres.esther.id });
  ajouter("campagnes", "automatisations", { nom: "Bienvenue aux nouveaux clients", recette: "bienvenue", actif: false, activeLe: "", delaiJours: 0, sujet: "Bienvenue chez Akwaba Distribution, {{prenom}}", apercu: "Votre interlocuteur et nos conditions", couleur: "#c2410c", langue: "fr", blocs: [{ id: "t1", type: "texte", texte: "Bonjour {{prenom}},\n\nMerci de votre confiance ! Votre commerciale dédiée vous contactera cette semaine." }, { id: "s1", type: "signature", texte: "L'équipe Akwaba" }], regles: { joursOuvres: true, sortie: true }, inscrits: [] }, { jour: -100, par: membres.esther.id });
  ajouter("campagnes", "automatisations", { nom: "Merci après achat", recette: "merci", actif: false, activeLe: "", delaiJours: 2, sujet: "Merci pour votre commande, {{prenom}}", apercu: "Votre avis compte pour nous", couleur: "#c2410c", langue: "fr", blocs: [{ id: "t1", type: "texte", texte: "Bonjour {{prenom}},\n\nMerci pour votre commande. Tout s'est bien passé à la livraison ?" }, { id: "s1", type: "signature", texte: "À très vite,\nAkwaba Distribution" }], regles: { joursOuvres: true, sortie: true }, inscrits: [] }, { jour: -100, par: membres.esther.id });
  ajouter("campagnes", "modeles", { nom: "Promotion du mois", sujet: "La promo du mois chez Akwaba", apercu: "Des prix grossistes sur vos essentiels", couleur: "#e8590c", langue: "fr", blocs: blocsPromo("La promo du mois", "Bonjour {{prenom}},\n\nCe mois-ci, nos meilleurs prix sur…", "Voir la promo") }, { jour: -120, par: membres.esther.id });

  // ---------------------------------------------------------------- Courrier
  const fil = (n) => `demo-fil-${n}`;
  const mail = (c) =>
    courriels.push({
      id: id(),
      tenantId,
      boiteId: null,
      dossier: c.dossier || "reception",
      filId: c.filId,
      messageId: `<${id()}@${c.deEmail?.split("@")[1] || DOMAINE}>`,
      deNom: c.deNom,
      deEmail: c.deEmail,
      a: c.a,
      cc: [],
      sujet: c.sujet,
      texte: c.texte,
      html: null,
      extrait: c.texte.replace(/\s+/g, " ").slice(0, 160),
      date: c.date,
      lu: !!c.lu,
      suivi: !!c.suivi,
      etiquettes: [],
      pieces: [],
      statut: c.statut || "recu",
      userId: c.userId || null,
      liens: c.liens || [],
      creeLe: c.date,
      modifieLe: c.date,
    });
  const nous = { nom: "Akwaba Distribution", email: `contact@${DOMAINE}` };
  const leader = client("Supermarché Leader Price Yopougon");
  mail({ filId: fil(1), deNom: leader.nom, deEmail: leader.email, a: [nous], sujet: "Demande de devis — approvisionnement mensuel", texte: `Bonjour,\n\nNous ouvrons un nouveau point de vente à Yopougon et souhaitons recevoir votre meilleure offre pour un approvisionnement mensuel : riz, huile, sucre, boissons et produits d'hygiène.\n\nPouvez-vous nous faire parvenir un devis avant vendredi ?\n\nCordialement,\n${leader.nom}\n${leader.entreprise}`, date: C.instant(-2, 9, 12), lu: true, liens: [{ app: "crm", collection: "clients", id: leader.id, libelle: leader.entreprise }] });
  mail({ filId: fil(1), dossier: "envoyes", statut: "envoye", deNom: "Aïcha Koné", deEmail: nous.email, a: [{ nom: leader.nom, email: leader.email }], sujet: "Re : Demande de devis — approvisionnement mensuel", texte: `Bonjour M. Gohou,\n\nMerci pour votre demande. Je vous propose une dégustation de nos références au dépôt aujourd'hui à 11 h ; le devis suivra dans la foulée.\n\nBien cordialement,\nAïcha Koné\nGérante — Akwaba Distribution`, date: C.instant(-2, 11, 40), lu: true, userId: proprio.id, liens: [{ app: "crm", collection: "clients", id: leader.id, libelle: leader.entreprise }] });
  mail({ filId: fil(1), deNom: leader.nom, deEmail: leader.email, a: [nous], sujet: "Re : Demande de devis — approvisionnement mensuel", texte: "Parfait, nous serons là à 11 h avec notre responsable des achats.\n\nÀ tout à l'heure.", date: C.instant(-1, 8, 5), lu: false, suivi: true, liens: [{ app: "crm", collection: "clients", id: leader.id, libelle: leader.entreprise }] });
  const hotel = client("Hôtel Ivoire Lagune");
  mail({ filId: fil(2), deNom: hotel.nom, deEmail: hotel.email, a: [nous], sujet: "Contrat boissons 2027 — nos remarques", texte: "Bonjour Esther,\n\nNous avons relu la proposition. Deux points restent à discuter : le délai de paiement (nous souhaitons 45 jours) et une clause de révision des prix au semestre.\n\nPouvons-nous en parler cette semaine ?\n\nPaul Ahoussou\nDirecteur des achats", date: C.instant(-1, 15, 30), lu: false, suivi: true, liens: [{ app: "crm", collection: "clients", id: hotel.id, libelle: hotel.entreprise }] });
  mail({ filId: fil(3), deNom: "SODIACI Import", deEmail: "commandes@sodiaci-import.ci", a: [nous], sujet: "Confirmation de livraison — commande CMD-2026-005", texte: "Bonjour,\n\nNous accusons réception de votre projet de commande. Le café soluble est disponible ; livraison possible sous 7 jours après validation.\n\nService commandes SODIACI", date: C.instant(0, 8, 20), lu: false });
  const maquis = client("Restaurant Le Maquis Chic");
  mail({ filId: fil(4), deNom: maquis.nom, deEmail: maquis.email, a: [nous], sujet: "Paiement facture en retard", texte: "Bonjour,\n\nToutes nos excuses pour le retard. Le solde de la facture sera viré d'ici dix jours, nous attendons un encaissement important.\n\nCordialement,\nJean-Marc Yao", date: C.instant(-6, 17, 45), lu: true, liens: [{ app: "crm", collection: "clients", id: maquis.id, libelle: maquis.entreprise }] });
  mail({ filId: fil(5), deNom: "Kouadio Eric", deEmail: "eric.kouadio@mail-demo.ci", a: [nous], sujet: "Candidature — poste de magasinier", texte: "Madame, Monsieur,\n\nSuite à votre annonce, je vous adresse ma candidature au poste de magasinier pour votre nouveau dépôt de Yopougon. Cinq ans d'expérience en logistique, permis C.\n\nDans l'attente de votre réponse, veuillez agréer mes salutations distinguées.\n\nEric Kouadio", date: C.instant(-3, 10, 2), lu: true });
  mail({ filId: fil(6), deNom: "SGBCI Entreprises", deEmail: "entreprises@sgbci-demo.ci", a: [nous], sujet: "Votre relevé de compte est disponible", texte: "Madame, Monsieur,\n\nVotre relevé de compte du mois est disponible dans votre espace en ligne.\n\nSGBCI — Banque des entreprises", date: C.instant(-9, 6, 30), lu: true, dossier: "archives" });
  const ecole = client("Groupe Scolaire Les Lauriers");
  mail({ filId: fil(7), dossier: "envoyes", statut: "envoye", deNom: "Esther N'Guessan", deEmail: nous.email, a: [{ nom: ecole.nom, email: ecole.email }], sujet: "Votre devis pour la rentrée — internat", texte: "Madame Bléhoué,\n\nVeuillez trouver ci-joint notre devis pour l'approvisionnement de l'internat. Je reste à votre disposition pour l'ajuster.\n\nEsther N'Guessan\nResponsable commerciale", date: C.instant(-16, 10, 15), lu: true, userId: membres.esther.id, liens: [{ app: "crm", collection: "clients", id: ecole.id, libelle: ecole.entreprise }] });
  mail({ filId: fil(8), dossier: "brouillons", statut: "brouillon", deNom: "Aïcha Koné", deEmail: nous.email, a: [{ nom: hotel.nom, email: hotel.email }], sujet: "Re : Contrat boissons 2027 — nos remarques", texte: "Bonjour M. Ahoussou,\n\nMerci pour votre retour. Concernant le délai de paiement, nous pouvons vous proposer", date: C.instant(0, 7, 50), lu: true, userId: proprio.id });
  // Les envois apparaissent aussi dans la chronologie du CRM.
  ajouter("courrier", "envois", { a: [leader.email], cc: [], sujet: "Re : Demande de devis — approvisionnement mensuel", texte: "Bonjour M. Gohou, …", extrait: "Je vous propose une dégustation de nos références au dépôt…", date: C.instant(-2, 11, 40).toISOString(), envoye: true, erreur: null, pieces: [] }, { jour: -2 });
  ajouter("courrier", "envois", { a: [ecole.email], cc: [], sujet: "Votre devis pour la rentrée — internat", texte: "Madame Bléhoué, …", extrait: "Veuillez trouver ci-joint notre devis…", date: C.instant(-16, 10, 15).toISOString(), envoye: true, erreur: null, pieces: [] }, { jour: -16, par: membres.esther.id });

  // ---------------------------------------------------------------- Classeur & bloc-notes
  const cellule = (v, s) => (s ? { v: String(v), s } : { v: String(v) });
  const tete = (...v) => v.map((x) => cellule(x, { gras: true, couleurFond: "FDE7D7" }));
  const monnaie = { format: "monnaie" };
  const budget = [
    tete("Poste", "T1", "T2", "T3", "T4", "Total"),
    ...[["Chiffre d'affaires", 48e6, 52e6, 55e6, 64e6], ["Achats de marchandises", -31e6, -33e6, -35e6, -40e6], ["Salaires et charges", -9.8e6, -9.8e6, -10.4e6, -10.4e6], ["Loyers", -2.3e6, -2.3e6, -2.3e6, -2.3e6], ["Marketing", -0.9e6, -0.7e6, -1.2e6, -1.5e6], ["Autres charges", -1.4e6, -1.4e6, -1.5e6, -1.6e6]].map(
      (l, i) => [cellule(l[0]), ...l.slice(1).map((v) => cellule(v, monnaie)), cellule(`=SOMME(B${i + 2}:E${i + 2})`, { ...monnaie, gras: true })],
    ),
    [cellule("Résultat", { gras: true }), ...["B", "C", "D", "E", "F"].map((c) => cellule(`=SOMME(${c}2:${c}7)`, { ...monnaie, gras: true, couleurFond: "E8F5E9" }))],
  ];
  ajouter("classeur", "classeurs", { titre: `Budget prévisionnel ${C.annee + 1}`, version: 1, feuilles: [{ nom: "Budget", largeurs: { 0: 200, 1: 120, 2: 120, 3: 120, 4: 120, 5: 130 }, figees: { lignes: 1, colonnes: 1 }, cellules: budget }] }, { jour: -15, par: membres.yao.id });
  const livraisons = [tete("Date", "Client", "Commune", "Livreur", "Statut")];
  const communes = ["Cocody", "Marcory", "Plateau", "Yopougon", "Riviera", "Treichville", "Assinie"];
  for (let i = 0; i < 12; i++) {
    const c = actifs[i % actifs.length];
    livraisons.push([cellule(C.jour(-i), { format: "date" }), cellule(c.entreprise), cellule(communes[i % communes.length]), cellule(i % 2 ? "Fatou Ouattara" : "Ibrahim Diabaté"), cellule(i < 2 ? "En cours" : "Livrée")]);
  }
  ajouter("classeur", "classeurs", { titre: "Suivi des livraisons", version: 1, feuilles: [{ nom: "Livraisons", largeurs: { 0: 110, 1: 240, 2: 120, 3: 150, 4: 100 }, figees: { lignes: 1, colonnes: 0 }, cellules: livraisons }] }, { jour: -1, par: membres.ibrahim.id });

  for (const [titre, corps, couleur, epingle, par] of [
    ["Appeler le transitaire", "M. Konan — 07 08 09 10 11\nConteneur de riz bloqué au port : relancer avant vendredi.", "jaune", true, proprio.id],
    ["Idées salon SARA", "- Stand 18 m²\n- Dégustation jus locaux\n- Jeu concours cartes de visite\n- Brochure gamme hôtellerie", "vert", true, proprio.id],
    ["Codes Wi-Fi boutique", "Réseau : Akwaba-Boutique\nInvités : Akwaba2026", "bleu", false, membres.mariam.id],
    ["À commander", "Rouleaux de caisse x20\nÉtiquettes code-barres\nCartons de livraison", "rose", false, membres.ibrahim.id],
    ["Compte rendu comité", "Objectif T4 : +15 % sur l'hôtellerie.\nOuverture du dépôt le mois prochain.\nRecruter 2 magasiniers.", "papier", false, proprio.id],
  ]) ajouter("notepad", "notes", { titre, corps, couleur, epingle }, { jour: -H.entier(1, 20), par });

  // ---------------------------------------------------------------- Cloud
  fichier("Documents", "Statuts Akwaba Distribution SARL.pdf", pdfTexte("Statuts — Akwaba Distribution SARL", ["Société à responsabilité limitée au capital de 25 000 000 FCFA", "Siège social : Boulevard VGE, Marcory Zone 4, Abidjan", "RCCM CI-ABJ-2019-B-14527 — NCC 1914527 K", "", "Article 1 — Forme : société à responsabilité limitée.", "Article 2 — Objet : distribution de produits alimentaires, boissons,", "produits d'hygiène et fournitures aux professionnels.", "Article 3 — Dénomination : Akwaba Distribution.", "Article 4 — Durée : 99 ans.", "", "Gérance : Mme Aïcha Koné."]), "application/pdf");
  fichier("Documents", "Attestation de régularité fiscale.pdf", pdfTexte("Attestation de régularité fiscale", ["Direction Générale des Impôts — CME Marcory", "", "Il est attesté que la société Akwaba Distribution SARL", "(NCC 1914527 K) est à jour de ses obligations fiscales.", "", `Délivrée le ${C.jour(-30)} — valable trois mois.`]), "application/pdf");
  fichier("Documents", "Contrat de bail — dépôt de Yopougon.pdf", pdfTexte("Contrat de bail commercial", ["Entre SCI Les Palmiers (bailleur) et Akwaba Distribution SARL (preneur)", "Objet : entrepôt de 600 m², zone industrielle de Yopougon, lot 112", "Durée : 3 ans renouvelables — Loyer mensuel : 400 000 FCFA HT", "", "Fait à Abidjan, en deux exemplaires."]), "application/pdf");
  fichier("Documents", "Tarifs professionnels.csv", Buffer.from(csv([["Référence", "Désignation", "Unité", "Prix pro HT", "Prix public TTC"], ...articles.map((a) => [a.reference, a.designation, a.unite, htGros(a), a.prixVente])]), "utf8"), "text/csv");
  fichier("Partagé", "Liste des clients.csv", Buffer.from(csv([["Entreprise", "Contact", "Téléphone", "E-mail", "Ville", "Statut"], ...clients.map((c) => [c.entreprise, c.nom, c.telephone, c.email, c.ville, c.statut])]), "utf8"), "text/csv");
  fichier("Partagé", "Procédure de réception des marchandises.pdf", pdfTexte("Procédure de réception", ["1. Contrôler le bon de livraison avec la commande (app Achats).", "2. Compter et vérifier l'état des colis.", "3. Saisir la réception : le stock se met à jour tout seul.", "4. Ranger selon les emplacements indiqués sur la fiche article.", "5. Signaler toute casse au magasinier en chef."]), "application/pdf");
  fichier("Images", "Logo Akwaba.png", Buffer.from(LOGO_PNG.split(",")[1], "base64"), "image/png");
  fichier("Images", "Cachet de la société.png", Buffer.from(CACHET_PNG.split(",")[1], "base64"), "image/png");
  for (const s of salaries.slice(0, 6)) {
    fichier("Ressources humaines", `Contrat de travail — ${s.data.prenom} ${s.data.nom}.pdf`, pdfTexte("Contrat de travail", [`Employeur : Akwaba Distribution SARL`, `Salarié : ${s.data.prenom} ${s.data.nom} — matricule ${s.data.matricule}`, `Poste : ${s.data.poste}`, `Type de contrat : ${s.data.typeContrat.toUpperCase()}`, `Date d'embauche : ${s.data.dateEmbauche}`, `Salaire de base : ${s.data.salaireBase.toLocaleString("fr-FR").replace(/\u202f/g, " ")} FCFA`]), "application/pdf");
  }

  // ---------------------------------------------------------------- Automatisations
  const recettes = { "conge-demande": true, "conge-decide": true, "frais-approuvee": true, "affaire-gagnee-passation": true, "reglement-fil-client": false, "courriel-devis": false };
  for (const [cle, active] of Object.entries(recettes)) {
    const r = RECETTES.find((x) => x.id === cle);
    if (!r) continue;
    const { ok, valeur } = validerAutomatisation(r.automatisation);
    if (!ok) continue;
    automatisations.push({
      id: id(),
      tenantId,
      nom: valeur.nom,
      active,
      recette: cle,
      creeParId: proprio.id,
      module: valeur.declencheur.module,
      collection: valeur.declencheur.collection,
      evenement: valeur.declencheur.evenement,
      definition: { declencheur: valeur.declencheur, toutes: valeur.toutes, conditions: valeur.conditions, actions: valeur.actions },
      executions: active ? H.entier(3, 18) : 0,
      derniereExecution: active ? C.instant(-H.entier(0, 6), 10) : null,
      creeLe: C.instant(-90, 10),
    });
  }

  // ---------------------------------------------------------------- Notifications
  const notif = (titre, message, source, lien, jour, heure, lu = false, auteur = null) =>
    notifications.push({ id: id(), tenantId, userId: proprio.id, auteurId: auteur?.id || null, auteurNom: auteur ? `${auteur.name}` : null, source, titre, message, lien, lu, createdAt: C.instant(jour, heure) });
  notif("Demande d'absence du " + C.jour(60) + " au " + C.jour(73), "Koffi Aka — Congés de fin d'année", "automatisations", { app: "conges" }, -1, 16);
  notif("Demande d'absence du " + C.jour(20) + " au " + C.jour(22), "Fatou Ouattara — Baptême", "automatisations", { app: "conges" }, 0, 8);
  notif("Nouveau courriel de Michel Gohou", "Re : Demande de devis — approvisionnement mensuel", "courrier", { app: "courrier" }, -1, 8);
  notif("Stylos bille en rupture", "Stylos bille (boîte de 50) : plus aucun article en stock.", "stock", { app: "stock" }, -2, 12, true);
  notif("Bravo : « Commande fêtes de fin d'année » est gagnée", "Une tâche de passation a été créée dans Projets.", "automatisations", { app: "crm" }, -3, 15, true, membres.esther);
  notif("Note de frais à valider", "Esther N'Guessan — Recharge internet, 10 000 F", "frais", { app: "frais" }, -4, 9);
  notif("Facture en retard", `${retard.data.numero} — Restaurant Le Maquis Chic`, "facturation", { app: "facturation" }, -5, 8, true);

  return { records, fichiers, courriels, notifications, automatisations, avoir };
};

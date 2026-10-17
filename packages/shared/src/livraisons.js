// Livraisons — les règles, sans React.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUE FAIT L'APPLICATION
//
// Une PME d'Abidjan livre ses clients avec deux motos et une fourgonnette.
// Le matin, quelqu'un répartit les colis entre les livreurs ; dans la
// journée, chacun appelle le client, cherche la maison (« derrière la
// pharmacie, portail vert »), remet le colis, encaisse en espèces ou en
// mobile money, et revient avec un carnet griffonné. Le soir, personne ne
// sait exactement ce qui a été livré, ni qui a encaissé quoi.
//
// L'application remplace le carnet :
//   - les livraisons arrivent des factures (ou se saisissent à la main) ;
//   - le répartiteur les affecte à des **tournées** (un livreur, un
//     véhicule, un ordre de passage calculé) ;
//   - le livreur suit sa tournée sur son téléphone et prouve chaque
//     remise (nom, signature, photo) ou chaque échec (motif) ;
//   - l'encaissement à la livraison devient un règlement de la facture,
//     la sortie de stock se fait toute seule.
//
// Ce fichier porte les règles : statuts et transitions, numérotation,
// indicateurs du jour, ordre de passage, frais par commune, messages
// WhatsApp, et le pont vers le Stock et la Facturation. Il est partagé :
// l'API (démonstration) et le shell appliquent les mêmes règles.
// ─────────────────────────────────────────────────────────────────────────

export const aujourdhui = () => new Date().toISOString().slice(0, 10);

const arrondi = (n) => Math.round(Number(n) || 0);

// ---------------------------------------------------------------------------
// Statuts
// ---------------------------------------------------------------------------

/// Le cycle d'une livraison. `ton` sert à la couleur de la pastille,
/// `ouvert` dit si la livraison est encore « à faire ».
export const STATUTS = {
  a_planifier: { label: "À planifier", ton: "neutre", icone: "faInbox", ouvert: true },
  planifiee: { label: "Planifiée", ton: "info", icone: "faCalendarCheck", ouvert: true },
  en_route: { label: "En route", ton: "attention", icone: "faTruckFast", ouvert: true },
  livree: { label: "Livrée", ton: "ok", icone: "faCircleCheck", ouvert: false },
  echec: { label: "Échec", ton: "danger", icone: "faCircleXmark", ouvert: false },
  annulee: { label: "Annulée", ton: "neutre", icone: "faBan", ouvert: false },
};

/// Passages autorisés. Un échec se reprogramme (retour « à planifier ») ;
/// une livraison livrée ne revient pas en arrière — une erreur se corrige
/// par une nouvelle livraison, pour garder la trace de ce qui s'est passé.
export const TRANSITIONS = {
  a_planifier: ["planifiee", "en_route", "livree", "echec", "annulee"],
  planifiee: ["a_planifier", "en_route", "livree", "echec", "annulee"],
  en_route: ["planifiee", "livree", "echec"],
  echec: ["a_planifier", "annulee"],
  livree: [],
  annulee: ["a_planifier"],
};

export const peutPasser = (de, vers) => (TRANSITIONS[de] || []).includes(vers);

/// Pourquoi une livraison n'a pas pu se faire. L'ordre est celui de la
/// fréquence constatée : on choisit vite, sur le trottoir.
export const MOTIFS_ECHEC = [
  { id: "absent", label: "Client absent" },
  { id: "injoignable", label: "Client injoignable" },
  { id: "adresse", label: "Adresse introuvable" },
  { id: "report", label: "Report demandé par le client" },
  { id: "paiement", label: "Paiement non disponible" },
  { id: "refus", label: "Colis refusé" },
  { id: "autre", label: "Autre raison" },
];

/// Moyens d'encaissement à la livraison, et le libellé de règlement qu'ils
/// donnent dans la Facturation (qui ne connaît que « Mobile Money »).
export const MOYENS = [
  { id: "especes", label: "Espèces", reglement: "Espèces", icone: "faMoneyBill" },
  { id: "orange", label: "Orange Money", reglement: "Mobile Money", icone: "faMobileScreen", couleur: "#ff7900" },
  { id: "wave", label: "Wave", reglement: "Mobile Money", icone: "faMobileScreen", couleur: "#1dc8ff" },
  { id: "mtn", label: "MTN MoMo", reglement: "Mobile Money", icone: "faMobileScreen", couleur: "#ffcc00" },
  { id: "moov", label: "Moov Money", reglement: "Mobile Money", icone: "faMobileScreen", couleur: "#0066b3" },
  { id: "carte", label: "Carte", reglement: "Carte bancaire", icone: "faCreditCard" },
];

export const moyenDe = (id) => MOYENS.find((m) => m.id === id) || MOYENS[0];

export const PRIORITES = {
  normale: { label: "Normale" },
  urgente: { label: "Urgente" },
};

/// Créneaux proposés à la saisie (les heures exactes restent possibles).
export const CRENEAUX = [
  { id: "matin", label: "Matin", debut: "08:00", fin: "12:00" },
  { id: "midi", label: "Après-midi", debut: "12:00", fin: "17:00" },
  { id: "soir", label: "Soir", debut: "17:00", fin: "20:00" },
  { id: "journee", label: "Dans la journée", debut: "08:00", fin: "18:00" },
];

export const TYPES_VEHICULE = {
  moto: { label: "Moto", icone: "faMotorcycle", capacite: 40, vitesse: 22 },
  tricycle: { label: "Tricycle", icone: "faTruckPickup", capacite: 300, vitesse: 18 },
  fourgonnette: { label: "Fourgonnette", icone: "faVanShuttle", capacite: 800, vitesse: 18 },
  camion: { label: "Camion", icone: "faTruck", capacite: 3500, vitesse: 15 },
};

// ---------------------------------------------------------------------------
// Géographie : Abidjan et environs
// ---------------------------------------------------------------------------

/// Les communes du Grand Abidjan, avec un point central approximatif. Les
/// adresses n'ont souvent pas de numéro : la commune et un repère suffisent
/// à ordonner une tournée sans carte ni service payant.
export const COMMUNES = {
  Plateau: [5.3237, -4.0207],
  Adjamé: [5.3576, -4.0236],
  Attécoubé: [5.3352, -4.0466],
  Cocody: [5.3600, -3.9800],
  "Riviera": [5.3700, -3.9550],
  "Angré": [5.3950, -3.9900],
  "Deux-Plateaux": [5.3700, -4.0000],
  Marcory: [5.3030, -3.9880],
  Koumassi: [5.2950, -3.9550],
  Treichville: [5.3000, -4.0100],
  "Port-Bouët": [5.2550, -3.9300],
  Yopougon: [5.3400, -4.0870],
  Abobo: [5.4200, -4.0200],
  Anyama: [5.4950, -4.0520],
  Bingerville: [5.3550, -3.8850],
  Songon: [5.3100, -4.2600],
  "Grand-Bassam": [5.2100, -3.7400],
  Assinie: [5.1400, -3.2900],
};

export const LISTE_COMMUNES = Object.keys(COMMUNES);

/// Reconnaît une commune dans un texte libre (« Abidjan — Cocody »).
export const communeDe = (texte = "") => {
  const t = String(texte).toLowerCase();
  return LISTE_COMMUNES.find((c) => t.includes(c.toLowerCase())) || "";
};

/// Position d'une livraison : GPS précis si connu, sinon le centre de sa
/// commune, sinon null.
export const positionDe = (l = {}) => {
  const g = l.gps;
  if (g && Number.isFinite(Number(g.lat)) && Number.isFinite(Number(g.lng))) return [Number(g.lat), Number(g.lng)];
  return COMMUNES[l.commune] || null;
};

/// Distance à vol d'oiseau, en kilomètres.
export const distanceKm = (a, b) => {
  if (!a || !b) return 0;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

/// Un lien Google Maps est souvent tout ce que le client envoie : on en
/// extrait les coordonnées (formats « @lat,lng », « q=lat,lng », ou le
/// couple seul).
export const gpsDepuisTexte = (texte = "") => {
  const m = String(texte).match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
};

/// Lien d'itinéraire Google Maps vers une livraison.
export const lienItineraire = (l = {}) => {
  const p = l.gps && positionDe({ gps: l.gps });
  const cible = p ? `${p[0]},${p[1]}` : [l.adresse, l.repere, l.commune, "Côte d'Ivoire"].filter(Boolean).join(", ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(cible)}`;
};

// ---------------------------------------------------------------------------
// Tournées : ordre de passage et estimation
// ---------------------------------------------------------------------------

/// Ordonne les arrêts au plus proche voisin depuis le dépôt, puis
/// améliore par échanges (2-opt). Sans carte routière, c'est une
/// approximation honnête : elle évite les allers-retours absurdes
/// (Yopougon → Cocody → Yopougon) que fait un ordre de saisie.
///
/// Les livraisons urgentes passent en tête, dans leur propre ordre.
export const ordonnerArrets = (livraisons = [], depot = COMMUNES.Marcory) => {
  const avecPos = livraisons.map((l) => ({ l, p: positionDe(l.data || l) || depot }));
  const urgentes = avecPos.filter((x) => (x.l.data || x.l).priorite === "urgente");
  const normales = avecPos.filter((x) => (x.l.data || x.l).priorite !== "urgente");

  const voisin = (restants, depart) => {
    const ordre = [];
    let courant = depart;
    const pile = [...restants];
    while (pile.length) {
      let meilleur = 0;
      for (let i = 1; i < pile.length; i++) {
        if (distanceKm(courant, pile[i].p) < distanceKm(courant, pile[meilleur].p)) meilleur = i;
      }
      const [x] = pile.splice(meilleur, 1);
      ordre.push(x);
      courant = x.p;
    }
    return ordre;
  };

  const tete = voisin(urgentes, depot);
  const reste = voisin(normales, tete.length ? tete[tete.length - 1].p : depot);

  // 2-opt sur la partie non urgente.
  const longueur = (route, debut) => route.reduce((s, x, i) => s + distanceKm(i ? route[i - 1].p : debut, x.p), 0);
  const debut = tete.length ? tete[tete.length - 1].p : depot;
  let route = reste;
  let ameliore = true;
  let tours = 0;
  while (ameliore && tours < 50) {
    ameliore = false;
    tours += 1;
    for (let i = 0; i < route.length - 1; i++) {
      for (let k = i + 1; k < route.length; k++) {
        const essai = [...route.slice(0, i), ...route.slice(i, k + 1).reverse(), ...route.slice(k + 1)];
        if (longueur(essai, debut) + 0.01 < longueur(route, debut)) {
          route = essai;
          ameliore = true;
        }
      }
    }
  }
  return [...tete, ...route].map((x) => x.l);
};

/// Distance et durée estimées d'une tournée : trajet à vol d'oiseau
/// majoré de 35 % (les routes ne sont pas droites), à la vitesse moyenne
/// du véhicule, plus 8 minutes par arrêt (trouver, appeler, remettre).
export const estimerTournee = (livraisons = [], { depot = COMMUNES.Marcory, vehicule = "moto", retour = true } = {}) => {
  const pts = livraisons.map((l) => positionDe(l.data || l) || depot);
  let km = 0;
  let courant = depot;
  for (const p of pts) {
    km += distanceKm(courant, p);
    courant = p;
  }
  if (retour && pts.length) km += distanceKm(courant, depot);
  km *= 1.35;
  const vitesse = TYPES_VEHICULE[vehicule]?.vitesse || 18;
  const minutes = Math.round((km / vitesse) * 60 + pts.length * 8);
  return { km: Math.round(km * 10) / 10, minutes };
};

export const dureeLisible = (minutes = 0) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
};

// ---------------------------------------------------------------------------
// Numérotation et transitions
// ---------------------------------------------------------------------------

/// Prochain numéro « LIV-2026-0001 » (ou « TRN-… » pour une tournée).
/// Le plus grand numéro existant + 1 : une suppression ne recycle jamais
/// un numéro déjà communiqué à un client.
export const prochainNumero = (fiches = [], prefixe = "LIV", annee = new Date().getFullYear()) => {
  const motif = new RegExp(`^${prefixe}-${annee}-(\\d+)$`);
  const max = fiches.reduce((m, f) => {
    const r = motif.exec((f.data || f).numero || "");
    return r ? Math.max(m, Number(r[1])) : m;
  }, 0);
  return `${prefixe}-${annee}-${String(max + 1).padStart(4, "0")}`;
};

/// Fait passer une livraison à un nouveau statut et en garde la trace.
/// Rend les nouvelles données, ou lève une erreur lisible si le passage
/// n'a pas de sens.
export const passer = (data, statut, { par = "", note = "", le = new Date().toISOString(), ...champs } = {}) => {
  if (data.statut === statut) return { ...data, ...champs };
  if (!peutPasser(data.statut || "a_planifier", statut)) {
    throw new Error(`Une livraison « ${STATUTS[data.statut]?.label || data.statut} » ne peut pas passer à « ${STATUTS[statut]?.label || statut} ».`);
  }
  const suite = { ...data, ...champs, statut };
  if (statut === "a_planifier" || statut === "annulee") {
    suite.tourneeId = "";
    suite.ordre = 0;
  }
  suite.historique = [...(data.historique || []), { statut, le, par, ...(note ? { note } : {}) }].slice(-40);
  return suite;
};

// ---------------------------------------------------------------------------
// Indicateurs
// ---------------------------------------------------------------------------

/// Une livraison est-elle en retard ? Créneau dépassé et toujours à faire.
export const enRetard = (l, maintenant = new Date()) => {
  const d = l.data || l;
  if (!STATUTS[d.statut]?.ouvert) return false;
  const jour = maintenant.toISOString().slice(0, 10);
  if (d.date < jour) return true;
  if (d.date > jour) return false;
  const fin = d.creneau?.fin;
  if (!fin) return false;
  const [h, m] = fin.split(":").map(Number);
  return maintenant.getUTCHours() * 60 + maintenant.getUTCMinutes() > h * 60 + m;
};

/// Les chiffres du jour pour le tableau de bord.
export const indicateurs = (livraisons = [], jour = aujourdhui(), maintenant = new Date()) => {
  const duJour = livraisons.filter((l) => (l.data || l).date === jour && (l.data || l).statut !== "annulee");
  const compte = (s) => duJour.filter((l) => (l.data || l).statut === s).length;
  const livrees = compte("livree");
  const echecs = compte("echec");
  const terminees = livrees + echecs;
  const aEncaisser = duJour
    .filter((l) => STATUTS[(l.data || l).statut]?.ouvert)
    .reduce((s, l) => s + (Number((l.data || l).montantAEncaisser) || 0), 0);
  const encaisse = duJour.reduce((s, l) => s + (Number((l.data || l).encaissement?.montant) || 0), 0);
  return {
    total: duJour.length,
    aPlanifier: compte("a_planifier"),
    planifiees: compte("planifiee"),
    enRoute: compte("en_route"),
    livrees,
    echecs,
    enRetard: duJour.filter((l) => enRetard(l, maintenant)).length,
    tauxReussite: terminees ? Math.round((livrees / terminees) * 100) : null,
    aEncaisser: arrondi(aEncaisser),
    encaisse: arrondi(encaisse),
    avancement: duJour.length ? Math.round((terminees / duJour.length) * 100) : 0,
  };
};

/// Avancement d'une tournée.
export const avancementTournee = (arrets = []) => {
  const fait = arrets.filter((l) => ["livree", "echec"].includes((l.data || l).statut)).length;
  return { fait, total: arrets.length, pct: arrets.length ? Math.round((fait / arrets.length) * 100) : 0 };
};

/// Performance d'un livreur sur une période.
export const performance = (livraisons = [], livreurId, { depuis = "" } = {}) => {
  const siennes = livraisons.filter((l) => {
    const d = l.data || l;
    return d.livreurId === livreurId && (!depuis || d.date >= depuis);
  });
  const livrees = siennes.filter((l) => (l.data || l).statut === "livree").length;
  const echecs = siennes.filter((l) => (l.data || l).statut === "echec").length;
  const encaisse = siennes.reduce((s, l) => s + (Number((l.data || l).encaissement?.montant) || 0), 0);
  return { total: siennes.length, livrees, echecs, taux: livrees + echecs ? Math.round((livrees / (livrees + echecs)) * 100) : null, encaisse: arrondi(encaisse) };
};

// ---------------------------------------------------------------------------
// Véhicules
// ---------------------------------------------------------------------------

/// Ce qui demande l'attention sur un véhicule : assurance ou visite
/// technique échue ou proche (30 jours), vidange dépassée.
export const alertesVehicule = (v = {}, jour = aujourdhui()) => {
  const out = [];
  const dans = (date) => (date ? Math.round((Date.parse(date) - Date.parse(jour)) / 86400_000) : null);
  for (const [cle, libelle] of [["assuranceFin", "Assurance"], ["visiteFin", "Visite technique"]]) {
    const j = dans(v[cle]);
    if (j === null) continue;
    if (j < 0) out.push({ ton: "danger", texte: `${libelle} expirée depuis ${-j} j` });
    else if (j <= 30) out.push({ ton: "attention", texte: `${libelle} : expire dans ${j} j` });
  }
  if (Number(v.kilometrage) && Number(v.prochaineVidange) && Number(v.kilometrage) >= Number(v.prochaineVidange)) {
    out.push({ ton: "attention", texte: "Vidange à faire" });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Frais de livraison par commune
// ---------------------------------------------------------------------------

export const TARIFS_DEFAUT = {
  Plateau: 1500, Adjamé: 1500, Attécoubé: 2000, Cocody: 2000, Riviera: 2000, "Angré": 2000, "Deux-Plateaux": 2000,
  Marcory: 1000, Koumassi: 1500, Treichville: 1500, "Port-Bouët": 2000, Yopougon: 2500, Abobo: 2500,
  Anyama: 3500, Bingerville: 3000, Songon: 3500, "Grand-Bassam": 5000, Assinie: 8000,
};

export const fraisLivraison = (commune, tarifs = TARIFS_DEFAUT) => arrondi(tarifs?.[commune] ?? TARIFS_DEFAUT[commune] ?? 0);

// ---------------------------------------------------------------------------
// Messages au client (WhatsApp)
// ---------------------------------------------------------------------------

/// Numéro au format international sans « + » (wa.me), Côte d'Ivoire par
/// défaut pour les numéros locaux à 10 chiffres.
export const numeroInternational = (tel = "") => {
  let n = String(tel).replace(/[^\d+]/g, "");
  if (n.startsWith("+")) n = n.slice(1);
  else if (n.startsWith("00")) n = n.slice(2);
  else if (n.length === 10) n = `225${n}`;
  return n.length >= 8 ? n : "";
};

export const GABARITS = {
  planifiee: "Bonjour {client}, votre livraison {numero} est prévue le {date} ({creneau}). {entreprise}",
  en_route: "Bonjour {client}, votre commande {numero} est en route avec {livreur} ({telLivreur}). Merci de rester joignable. {entreprise}",
  livree: "Bonjour {client}, votre commande {numero} a bien été livrée. Merci de votre confiance ! {entreprise}",
  echec: "Bonjour {client}, nous n'avons pas pu livrer votre commande {numero} ({motif}). Répondez à ce message pour fixer un nouveau créneau. {entreprise}",
};

export const messageClient = (l, type, { entreprise = "", livreur = "", telLivreur = "", gabarits = {} } = {}) => {
  const d = l.data || l;
  const gabarit = gabarits[type] || GABARITS[type] || GABARITS.planifiee;
  const valeurs = {
    client: (d.contact || d.clientNom || "").split(" ")[0] || "",
    numero: d.numero || "",
    date: d.date ? new Date(`${d.date}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "",
    creneau: d.creneau ? `${d.creneau.debut}–${d.creneau.fin}` : "dans la journée",
    livreur,
    telLivreur,
    montant: Number(d.montantAEncaisser) > 0 ? `${Math.round(d.montantAEncaisser).toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, " ")} F` : "",
    motif: MOTIFS_ECHEC.find((m) => m.id === d.echec?.motif)?.label.toLowerCase() || "",
    entreprise,
  };
  return gabarit.replace(/\{(\w+)\}/g, (_, k) => valeurs[k] ?? "").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").trim();
};

export const lienWhatsApp = (tel, texte = "") => {
  const n = numeroInternational(tel);
  return n ? `https://wa.me/${n}${texte ? `?text=${encodeURIComponent(texte)}` : ""}` : "";
};

// ---------------------------------------------------------------------------
// Pont avec la Facturation et le Stock
// ---------------------------------------------------------------------------

/// Les lignes d'une facture qui se livrent : pas les frais de livraison ou
/// de port, ni les prestations sans article qui en portent le nom.
const FRAIS = /^(frais|forfait)\b.*(livraison|port|transport)|^(livraison|transport|port)\b/i;
const lignesArticles = (facture) =>
  (facture.data?.lignes || facture.lignes || []).filter((l) => Number(l.qte) > 0 && !l.livraison && (l.articleId || !FRAIS.test(String(l.designation || "").trim())));

/// Total TTC d'une facture (même calcul que la Facturation).
const totalFacture = (f = {}) => {
  const lignes = f.lignes || [];
  const brut = lignes.map((l) => (Number(l.qte) || 0) * (Number(l.pu) || 0) * (1 - (Number(l.remise) || 0) / 100));
  const ht = brut.reduce((s, x) => s + x, 0);
  const facteur = 1 - (Number(f.remiseGlobale) || 0) / 100;
  const tva = lignes.reduce((s, l, i) => s + brut[i] * facteur * ((Number(l.tva) || 0) / 100), 0);
  return ht * facteur + tva;
};

/// Reste dû sur une facture, d'après ses règlements.
export const resteDu = (facture, reglements = []) => {
  const paye = reglements.filter((r) => (r.data || r).documentId === facture.id).reduce((s, r) => s + (Number((r.data || r).montant) || 0), 0);
  return Math.max(0, arrondi(totalFacture(facture.data || facture) - paye));
};

/// Les factures émises qui attendent encore une livraison : ni livrées
/// en stock, ni déjà confiées à une livraison en cours.
export const facturesALivrer = (factures = [], { mouvements = [], livraisons = [] } = {}) => {
  const sorties = new Set(mouvements.map((m) => (m.data || m).origine).filter(Boolean));
  const prises = new Set(
    livraisons.filter((l) => (l.data || l).statut !== "annulee" && (l.data || l).statut !== "echec").map((l) => (l.data || l).factureId).filter(Boolean),
  );
  return factures.filter((f) => {
    const d = f.data || {};
    return d.type === "facture" && !["brouillon", "annule"].includes(d.statut) && lignesArticles(f).length && !sorties.has(`facture:${f.id}`) && !prises.has(f.id);
  });
};

/// Prépare une livraison à partir d'une facture : client, colis, montant
/// restant à encaisser.
export const depuisFacture = (facture, { client = null, reglements = [], jour = aujourdhui() } = {}) => {
  const d = facture.data || {};
  const c = client?.data || {};
  const commune = communeDe(c.adresse || "") || communeDe(c.ville || d.clientVille || "");
  return {
    type: "livraison",
    statut: "a_planifier",
    date: jour,
    creneau: { ...CRENEAUX[3] },
    priorite: "normale",
    clientId: d.clientId || "",
    clientNom: d.clientEntreprise || d.clientNom || "",
    contact: d.clientNom || c.nom || "",
    telephone: d.clientTelephone || c.telephone || "",
    commune,
    adresse: c.adresse && !communeDe(c.adresse) ? c.adresse : "",
    repere: "",
    gps: null,
    colis: lignesArticles(facture).map((l) => ({ designation: l.designation, qte: Number(l.qte), articleId: l.articleId || "" })),
    factureId: facture.id,
    factureNumero: d.numero || "",
    montantAEncaisser: resteDu(facture, reglements),
    instructions: "",
    tourneeId: "",
    ordre: 0,
    livreurId: "",
    historique: [],
  };
};

/// Les sorties de stock d'une livraison remise. Une livraison liée à une
/// facture livre **la facture** (origine `facture:<id>`, comme l'écran
/// Livraisons du Stock) ; une livraison libre sort ses propres colis.
export const sortiesStock = (livraison, { facture = null, mouvements = [], jour = aujourdhui() } = {}) => {
  const d = livraison.data || livraison;
  const deja = new Set(mouvements.map((m) => (m.data || m).origine).filter(Boolean));
  if (facture) {
    const origine = `facture:${facture.id}`;
    if (deja.has(origine)) return [];
    return lignesArticles(facture)
      .filter((l) => l.articleId)
      .map((l) => ({ articleId: l.articleId, sens: "sortie", quantite: Number(l.qte), date: jour, entrepotId: "", motif: `Livraison ${facture.data?.numero || ""} (${d.numero || ""})`.trim(), origine }));
  }
  const origine = `livraison:${livraison.id}`;
  if (deja.has(origine)) return [];
  return (d.colis || [])
    .filter((c) => c.articleId && Number(c.qte) > 0)
    .map((c) => ({ articleId: c.articleId, sens: "sortie", quantite: Number(c.qte), date: jour, entrepotId: "", motif: `Livraison ${d.numero || ""}`.trim(), origine }));
};

/// Le règlement de facture né d'un encaissement à la livraison.
export const reglementDe = (livraison) => {
  const d = livraison.data || livraison;
  const e = d.encaissement;
  if (!d.factureId || !e || !(Number(e.montant) > 0)) return null;
  const moyen = moyenDe(e.moyen);
  return {
    documentId: d.factureId,
    montant: arrondi(e.montant),
    moyen: moyen.reglement,
    date: (e.le || new Date().toISOString()).slice(0, 10),
    reference: [moyen.reglement === "Mobile Money" ? moyen.label : "", e.reference, `livraison ${d.numero || ""}`].filter(Boolean).join(" — "),
    origine: `livraison:${livraison.id}`,
  };
};

// ---------------------------------------------------------------------------
// Validation de saisie
// ---------------------------------------------------------------------------

/// Ce qui manque pour qu'un livreur puisse partir avec cette livraison.
export const manques = (d = {}) => {
  const out = [];
  if (!d.clientNom && !d.contact) out.push("le client");
  if (!d.telephone) out.push("un téléphone");
  if (!d.commune && !d.gps) out.push("la commune ou la position GPS");
  if (!d.date) out.push("la date");
  return out;
};

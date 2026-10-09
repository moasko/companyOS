// Relances automatiques des factures impayées.
//
// ─────────────────────────────────────────────────────────────────────────
// LE PRINCIPE
//
// La Facturation connaît les échéances, le Courrier sait envoyer : ce
// moteur les relie. À intervalle régulier, pour chaque espace qui a
// activé les relances, il repère les factures échues non soldées et
// envoie au client le rappel du palier atteint — J+7, J+15, J+30 par
// défaut.
//
// Trois garde-fous, parce qu'un robot qui écrit aux clients n'a pas le
// droit à l'erreur :
//
//   1. **Un palier ne part qu'une fois.** Chaque envoi laisse une fiche
//      d'état ; au passage suivant, le palier est tenu pour fait.
//   2. **Un seul rappel par facture et par passage** — le plus haut
//      palier atteint. Activer les relances sur un vieil impayé envoie
//      un message, pas trois d'un coup.
//   3. **Tout est tracé** : historique du Courrier (visible dans l'app)
//      et journal d'activité, comme un envoi manuel.
//
// Les règles de calcul (totaux, encaissé, reste dû) sont **celles du
// module Facturation**, importées telles quelles : le robot et l'écran ne
// peuvent pas diverger d'un centime.
// ─────────────────────────────────────────────────────────────────────────

import { prisma } from "./db.js";
import { env } from "./env.js";
import { creerTransporteur, creerTransporteurEspace, envoyerVia } from "./mail.js";
import { journaliser } from "./audit.js";
import {
  totaux,
  encaisse,
} from "@companyos/shared/facturation";
import { adresseValide, appliquerModele } from "@companyos/shared/courrier";
import { compterEnvois, peutEnvoyer } from "./quota-mail.js";

const PALIERS_DEFAUT = [7, 15, 30];

/// Le message de secours, si l'espace n'a pas choisi de modèle.
const MODELE_DEFAUT = {
  sujet: "Rappel — facture {{numero}}",
  texte: [
    "Bonjour {{client}},",
    "",
    "Sauf erreur de notre part, la facture {{numero}} d'un montant de {{montant}}, échue le {{echeance}}, reste en attente de règlement.",
    "",
    "Si votre paiement est déjà parti, merci de ne pas tenir compte de ce message.",
    "",
    "Cordialement,",
    "{{entreprise}}",
  ].join("\n"),
};

const aujourdhuiIso = () => new Date().toISOString().slice(0, 10);

const dateLisible = (iso) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR") : "";

const fcfa = (n) => `${Math.round(n).toLocaleString("fr-FR")} F CFA`;

/// Les installations de l'app Courrier dont les relances sont actives.
const espacesActifs = async () => {
  const app = await prisma.app.findFirst({
    where: { slug: "courrier", tenantId: null },
  });
  if (!app) return [];
  const installations = await prisma.installation.findMany({
    where: { appId: app.id },
    include: { tenant: true, user: true },
  });
  return installations.filter((i) => i.settings?.relances?.actif);
};

const lireRecords = (tenantId, module, collection) =>
  prisma.record.findMany({ where: { tenantId, module, collection } });

/// Un passage complet. Renvoie le compte de relances parties — les tests
/// s'en servent, les logs aussi.
export const passerLesRelances = async () => {
  let envoyees = 0;

  for (const installation of await espacesActifs()) {
    try {
      envoyees += await relancerEspace(installation);
    } catch (err) {
      // Un espace en échec ne doit pas priver les autres de leurs relances.
      console.error(
        `Relances de l'espace ${installation.tenantId} impossibles :`,
        err.message,
      );
    }
  }

  if (envoyees) console.log(`Relances : ${envoyees} rappel(s) envoyé(s).`);
  return envoyees;
};

const relancerEspace = async (installation) => {
  const { tenantId, tenant } = installation;
  const reglages = installation.settings.relances;
  const paliers = (reglages.paliers?.length ? reglages.paliers : PALIERS_DEFAUT)
    .map(Number)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);

  // Le relais de l'espace, sinon celui de la plateforme.
  const smtp = installation.settings?.smtp;
  const transport = smtp?.host
    ? creerTransporteurEspace(smtp)
    : creerTransporteur({
        host: env.smtpHost,
        port: env.smtpPort,
        user: env.smtpUser,
        pass: env.smtpPass,
      });
  if (!transport) return 0;

  // Le modèle choisi, ou celui de secours.
  let modele = MODELE_DEFAUT;
  if (reglages.modeleId) {
    const fiche = await prisma.record.findFirst({
      where: { id: reglages.modeleId, tenantId, module: "courrier", collection: "modeles" },
    });
    if (fiche) modele = fiche.data;
  }

  const [factures, reglements, dejaFaites] = await Promise.all([
    lireRecords(tenantId, "facturation", "factures"),
    lireRecords(tenantId, "facturation", "reglements"),
    lireRecords(tenantId, "courrier", "relances"),
  ]);

  const aujourdhui = aujourdhuiIso();
  let envoyees = 0;

  for (const facture of factures) {
    const d = facture.data;
    if (d.type !== "facture") continue;
    if (d.statut === "annule" || d.statut === "brouillon") continue;
    if (!d.echeance || d.echeance >= aujourdhui) continue;
    // L'adresse est validée ici, et pas seulement à la saisie : `clientEmail`
    // vient d'une fiche `facturation/factures`, écrite par le CRUD
    // générique. Sans ce contrôle, une « facture » forgée suffisait à faire
    // écrire le robot à n'importe qui, six heures plus tard, au nom de
    // l'entreprise.
    if (!d.clientEmail || !adresseValide(d.clientEmail)) continue;

    // Le plafond d'envoi de l'espace, partagé avec Courrier et Campagnes.
    // Atteint, les relances restantes attendent le lendemain : elles ne
    // sont pas marquées comme faites, donc rien n'est perdu.
    if (!(await peutEnvoyer(tenantId, 1))) break;

    // Le reste dû, calculé par les règles de la Facturation elle-même.
    const du = totaux(d).ttc;
    const paye = encaisse(facture.id, reglements);
    const reste = Math.round((du - paye) * 100) / 100;
    if (reste <= 0) continue;

    const joursRetard = Math.round(
      (new Date(aujourdhui) - new Date(d.echeance)) / 86400000,
    );
    // Le plus haut palier atteint, au-delà de ce qui a déjà été envoyé.
    // Strictement au-delà : une relance J+15 partie, les paliers
    // inférieurs sont tenus pour couverts — on ne revient jamais en
    // arrière écrire « cela fait 7 jours » à qui a déjà lu « cela fait
    // 15 jours ».
    const faits = dejaFaites
      .filter((r) => r.data.factureId === facture.id)
      .map((r) => Number(r.data.palier));
    const plafondFait = faits.length ? Math.max(...faits) : 0;
    const palier = [...paliers]
      .reverse()
      .find((p) => joursRetard >= p && p > plafondFait);
    if (!palier) continue;

    const variables = {
      client: d.clientEntreprise || d.clientNom || "Madame, Monsieur",
      numero: d.numero || "",
      montant: fcfa(reste),
      echeance: dateLisible(d.echeance),
      entreprise: tenant.name,
      utilisateur: tenant.name,
    };
    const sujet = appliquerModele(modele.sujet, variables);
    const texte = appliquerModele(modele.texte, variables);
    const de =
      smtp?.de ||
      `${tenant.name} <${smtp?.user || env.smtpUser || "no-reply@localhost"}>`;

    const resultat = await envoyerVia(transport, {
      de,
      a: d.clientEmail,
      sujet,
      texte,
    });

    // La trace, réussite ou échec — la même que pour un envoi manuel.
    await prisma.record.create({
      data: {
        tenantId,
        userId: installation.userId,
        module: "courrier",
        collection: "envois",
        data: {
          a: d.clientEmail,
          sujet,
          texte,
          extrait: texte.slice(0, 160),
          pieces: [],
          envoye: resultat.envoye,
          erreur: resultat.erreur || null,
          auto: `relance J+${palier}`,
          date: new Date().toISOString(),
        },
      },
    });

    if (resultat.envoye) {
      await compterEnvois(tenantId, 1);
      // L'état qui empêche le doublon — posé seulement si le mail est
      // vraiment parti : un échec de relais se retentera au passage suivant.
      await prisma.record.create({
        data: {
          tenantId,
          userId: installation.userId,
          module: "courrier",
          collection: "relances",
          data: { factureId: facture.id, palier, date: aujourdhui },
        },
      });
      await journaliser(
        { user: installation.user, headers: {} },
        "courrier.relance",
        d.clientEmail,
        { numero: d.numero, palier: `J+${palier}`, reste },
      );
      envoyees += 1;
    }
  }

  return envoyees;
};

/// Démarre le moteur : un passage peu après le démarrage — le temps que
/// tout soit en place — puis toutes les six heures.
export const demarrerRelances = () => {
  setTimeout(() => passerLesRelances().catch(() => {}), 30 * 1000);
  setInterval(() => passerLesRelances().catch(() => {}), 6 * 60 * 60 * 1000);
};

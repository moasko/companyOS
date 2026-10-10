import { EventEmitter } from "node:events";
import pg from "pg";
import { env } from "./env.js";
import { prisma } from "./db.js";

/// Le bus d'événements de l'espace : « une fiche a changé », « vous avez
/// une notification », « les automatisations ont été modifiées ».
///
/// Plusieurs instances de l'API servent les mêmes espaces : un événement
/// émis par l'une doit atteindre les navigateurs connectés à l'autre. On
/// passe donc par PostgreSQL (LISTEN/NOTIFY), déjà le point commun de
/// toutes les instances — pas de Redis à exploiter en plus.
///
/// Si la connexion d'écoute tombe, les événements continuent d'être
/// diffusés localement (l'instance qui les émet les reçoit) et la
/// connexion est reprise en arrière-plan. Le client garde de toute façon
/// une interrogation lente de secours.
///
/// Un événement ne transporte **jamais de données métier** : des
/// identifiants, pour que le navigateur aille relire ce qu'il a le droit
/// de lire, par les routes habituelles.

const CANAL = "companyos_evenements";
/// NOTIFY refuse au-delà de 8000 octets ; nos événements en font 200.
const TAILLE_MAX = 7000;

const local = new EventEmitter();
local.setMaxListeners(0);

let ecoute = null;
let actif = false;
let arret = false;
let delaiReprise = 1000;

/// Identifiant de cette instance : elle reçoit aussi ses propres NOTIFY,
/// qu'elle a déjà diffusés localement.
export const INSTANCE = Math.random().toString(36).slice(2, 10);

const diffuser = (evt) => {
  try {
    local.emit("evt", evt);
  } catch {
    // Un abonné en panne ne doit pas priver les autres.
  }
};

const connecter = async () => {
  if (arret) return;
  const client = new pg.Client({ connectionString: env.databaseUrl.replace(/[?&]schema=[^&]*/, "") });
  client.on("notification", (m) => {
    if (m.channel !== CANAL || !m.payload) return;
    try {
      const { i, e } = JSON.parse(m.payload);
      if (i !== INSTANCE) diffuser(e);
    } catch {
      // Message illisible : ignoré.
    }
  });
  const reprendre = () => {
    if (ecoute !== client) return;
    actif = false;
    ecoute = null;
    client.end().catch(() => {});
    if (arret) return;
    setTimeout(() => connecter().catch(() => {}), delaiReprise).unref();
    delaiReprise = Math.min(delaiReprise * 2, 30_000);
  };
  client.on("error", reprendre);
  client.on("end", reprendre);
  ecoute = client;
  try {
    await client.connect();
    await client.query(`LISTEN ${CANAL}`);
    actif = true;
    delaiReprise = 1000;
  } catch {
    reprendre();
  }
};

export const demarrerBus = async () => {
  arret = false;
  if (!ecoute) await connecter();
};

export const arreterBus = async () => {
  arret = true;
  actif = false;
  const c = ecoute;
  ecoute = null;
  if (c) await c.end().catch(() => {});
};

export const busActif = () => actif;

/// Émet un événement vers toutes les instances. Ne lève jamais : un
/// événement perdu se rattrape au prochain rafraîchissement.
export const publier = async (evt) => {
  diffuser(evt);
  if (!actif) return;
  const charge = JSON.stringify({ i: INSTANCE, e: evt });
  if (Buffer.byteLength(charge) > TAILLE_MAX) return;
  try {
    await prisma.$executeRaw`SELECT pg_notify(${CANAL}, ${charge})`;
  } catch {
    // Base momentanément indisponible : la diffusion locale a eu lieu.
  }
};

/// S'abonne à tous les événements de cette instance (locaux et reçus).
/// Rend la fonction de désabonnement.
export const abonner = (fn) => {
  local.on("evt", fn);
  return () => local.off("evt", fn);
};

// ---------------------------------------------------------------------------
// Événements types
// ---------------------------------------------------------------------------

const CLIENT_ID = /^[A-Za-z0-9_-]{8,40}$/;

/// L'identifiant de l'onglet qui écrit (en-tête `X-Client-Id`) : cet onglet
/// a déjà sa version à jour et ignore l'événement qui en résulte.
export const clientDe = (request) => {
  const id = request?.headers?.["x-client-id"];
  return typeof id === "string" && CLIENT_ID.test(id) ? id : null;
};

export const publierFiche = ({ tenantId, module, collection, id, action, par = null, client = null }) =>
  publier({ type: "fiche", t: tenantId, module, collection, id, action, par, client });

export const publierNotification = ({ tenantId, userId }) =>
  publier({ type: "notification", t: tenantId, u: userId });

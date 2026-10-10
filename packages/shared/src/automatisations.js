// Automatisations entre applications : « quand ceci arrive dans une app,
// faire cela dans une autre ».
//
// Ce fichier porte les règles pures, partagées par l'API (qui exécute) et
// l'interface (qui édite et prévisualise) :
//
//   - la forme d'une automatisation et sa validation ;
//   - l'évaluation des conditions, avant/après une modification ;
//   - les gabarits {{fiche.champ}} des textes et des valeurs ;
//   - le catalogue des recettes prêtes à l'emploi.
//
// Rien ici ne touche la base, le réseau ni le DOM.

export const EVENEMENTS = ["creation", "modification", "suppression"];

export const OPERATEURS = [
  "egal",
  "different",
  "contient",
  "superieur",
  "inferieur",
  "vide",
  "non-vide",
  "change",
  "devient",
];

/// Opérateurs qui comparent à une valeur (les autres n'en ont pas besoin).
export const OPERATEURS_AVEC_VALEUR = [
  "egal",
  "different",
  "contient",
  "superieur",
  "inferieur",
  "devient",
];

export const TYPES_ACTION = [
  "notifier",
  "creer",
  "modifier",
  "tache",
  "courriel",
  "webhook",
  {
    id: "courriel-devis",
    titre: "Demande de devis reçue → tâche dans Projets",
    description:
      "Un courriel reçu dont l'objet parle de devis crée une tâche de suivi et prévient les administrateurs.",
    apps: ["courrier", "projets"],
    automatisation: {
      nom: "Demandes de devis par courriel",
      declencheur: { module: "courrier", collection: "recus", evenement: "creation" },
      conditions: [{ champ: "sujet", operateur: "contient", valeur: "devis" }],
      actions: [
        {
          type: "tache",
          titre: "Devis demandé — {{fiche.deNom}}",
          description: "Courriel de {{fiche.deEmail}} : « {{fiche.sujet}} ». Répondre sous 48 h.",
          echeance: "{{date:+2}}",
        },
        {
          type: "notifier",
          destinataires: { mode: "admins" },
          titre: "Demande de devis de {{fiche.deNom}}",
          message: "{{fiche.sujet}}",
        },
      ],
    },
  },
];

/// À qui s'adresse une notification ou un courriel.
///   champ   — la personne désignée par un champ de la fiche (responsableId,
///             salarieId…) : un compte, ou une fiche salarié reliée par e-mail
///   auteur  — qui a fait le changement
///   admins  — propriétaires et administrateurs de l'espace
///   membres — une liste choisie
///   tous    — tout l'espace
export const MODES_DESTINATAIRES = ["champ", "auteur", "admins", "membres", "tous"];

export const LIMITES = {
  nom: 120,
  conditions: 10,
  actions: 10,
  titre: 140,
  message: 600,
  sujet: 200,
  texte: 5000,
  valeur: 2000,
  champs: 30,
  url: 2000,
  membres: 200,
};

const NOM = /^[a-z0-9-]{1,64}$/;
const CLE = /^[A-Za-z0-9_]{1,64}$/;
const INTERDITS = new Set(["__proto__", "prototype", "constructor"]);

const estObjet = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const texte = (x) => (typeof x === "string" ? x : x == null ? "" : String(x));

// ---------------------------------------------------------------------------
// Gabarits
// ---------------------------------------------------------------------------
//
//   {{fiche.libelle}}        champ de la fiche (après le changement)
//   {{avant.etape}}          champ avant le changement
//   {{lie.numero}}           champ de la fiche liée (voir `declencheur.lier`)
//   {{auteur.nom}}           qui a fait le changement
//   {{fiche.id}}             identifiant de la fiche
//   {{maintenant}}           date et heure ISO
//   {{date}} {{date:+7}}     date du jour, ou dans 7 jours (AAAA-MM-JJ)

const BALISE = /\{\{\s*([a-zA-Z0-9_.:+-]+)\s*\}\}/g;

/// Valeur au bout d'un chemin « a.b.c », sans jamais remonter le prototype.
export const valeurA = (objet, chemin) => {
  let x = objet;
  for (const morceau of String(chemin).split(".").slice(0, 4)) {
    if (
      !estObjet(x) ||
      INTERDITS.has(morceau) ||
      !Object.prototype.hasOwnProperty.call(x, morceau)
    ) {
      return undefined;
    }
    x = x[morceau];
  }
  return x;
};

const jourIso = (d) => d.toISOString().slice(0, 10);

const resoudreBalise = (nom, contexte) => {
  const maintenant = contexte.maintenant ? new Date(contexte.maintenant) : new Date();
  if (nom === "maintenant") return maintenant.toISOString();
  const date = nom.match(/^date(?::([+-]\d{1,4}))?$/);
  if (date) {
    const d = new Date(maintenant);
    d.setUTCDate(d.getUTCDate() + Number(date[1] || 0));
    return jourIso(d);
  }
  const [racine, ...reste] = nom.split(".");
  if (racine === "fiche" && reste[0] === "id") return contexte.id;
  const sources = {
    fiche: contexte.fiche,
    avant: contexte.avant,
    lie: contexte.lie,
    auteur: contexte.auteur,
  };
  if (!Object.prototype.hasOwnProperty.call(sources, racine) || !reste.length)
    return undefined;
  return valeurA(sources[racine], reste.join("."));
};

/// Remplit un gabarit. Un gabarit fait d'une seule balise garde le type de
/// la valeur (un montant reste un nombre) ; sinon on obtient du texte.
export const remplir = (gabarit, contexte = {}) => {
  if (typeof gabarit !== "string") return gabarit;
  const seule = gabarit.trim().match(/^\{\{\s*([a-zA-Z0-9_.:+-]+)\s*\}\}$/);
  if (seule) {
    const v = resoudreBalise(seule[1], contexte);
    return v === undefined || v === null ? "" : v;
  }
  return gabarit.replace(BALISE, (_, nom) => {
    const v = resoudreBalise(nom, contexte);
    if (v === undefined || v === null) return "";
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  });
};

/// Les balises d'un gabarit, pour l'aide à la saisie.
export const balisesDe = (gabarit) =>
  [...texte(gabarit).matchAll(BALISE)].map((m) => m[1]);

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

const vide = (v) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
const egaux = (a, b) => texte(a).trim().toLowerCase() === texte(b).trim().toLowerCase();
const nombre = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));

/// Une condition, sur la fiche après changement (et avant, pour
/// « change » et « devient »). La valeur attendue accepte les gabarits :
/// « quantite inferieur {{fiche.seuil}} ».
export const conditionVraie = (condition, contexte) => {
  const { champ, operateur = "egal" } = condition || {};
  const apres = valeurA(contexte.fiche, champ);
  const avant = valeurA(contexte.avant, champ);
  const attendu = remplir(condition?.valeur ?? "", contexte);
  switch (operateur) {
    case "vide":
      return vide(apres);
    case "non-vide":
      return !vide(apres);
    case "different":
      return !egaux(apres, attendu);
    case "contient":
      return Array.isArray(apres)
        ? apres.some((x) => egaux(x, attendu))
        : texte(apres).toLowerCase().includes(texte(attendu).toLowerCase());
    case "superieur":
      return nombre(apres) > nombre(attendu);
    case "inferieur":
      return nombre(apres) < nombre(attendu);
    case "change":
      return (
        contexte.evenement === "modification" &&
        JSON.stringify(avant ?? null) !== JSON.stringify(apres ?? null)
      );
    case "devient":
      return (
        egaux(apres, attendu) &&
        (contexte.evenement === "creation" || !egaux(avant, attendu))
      );
    default:
      return egaux(apres, attendu);
  }
};

/// Le déclencheur correspond-il à cet événement ? (module, collection,
/// nature, et pour une modification ciblée : le champ a-t-il bougé)
export const declencheurCorrespond = (declencheur, evenement) => {
  if (!declencheur || !evenement) return false;
  if (
    declencheur.module !== evenement.module ||
    declencheur.collection !== evenement.collection
  )
    return false;
  if (declencheur.evenement !== evenement.evenement) return false;
  if (declencheur.evenement === "modification" && declencheur.champ) {
    const avant = valeurA(evenement.avant, declencheur.champ);
    const apres = valeurA(evenement.fiche, declencheur.champ);
    if (JSON.stringify(avant ?? null) === JSON.stringify(apres ?? null)) return false;
  }
  return true;
};

/// Toutes les conditions (ET logique) — ou au moins une si `toutes` est faux.
export const conditionsVraies = (automatisation, contexte) => {
  const liste = automatisation?.conditions || [];
  if (!liste.length) return true;
  return automatisation.toutes === false
    ? liste.some((c) => conditionVraie(c, contexte))
    : liste.every((c) => conditionVraie(c, contexte));
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const verifierDestinataires = (d, erreurs, ou) => {
  if (!estObjet(d) || !MODES_DESTINATAIRES.includes(d.mode)) {
    erreurs.push(`${ou} : destinataires invalides`);
    return null;
  }
  if (d.mode === "champ" && !CLE.test(texte(d.champ)))
    erreurs.push(`${ou} : champ du destinataire invalide`);
  if (d.mode === "membres") {
    if (
      !Array.isArray(d.ids) ||
      !d.ids.length ||
      d.ids.length > LIMITES.membres ||
      d.ids.some((i) => typeof i !== "string" || i.length > 64)
    ) {
      erreurs.push(`${ou} : liste de membres invalide`);
    }
  }
  return {
    mode: d.mode,
    ...(d.mode === "champ" ? { champ: texte(d.champ) } : {}),
    ...(d.mode === "membres" ? { ids: [...new Set(d.ids || [])] } : {}),
  };
};

const verifierChamps = (objet, erreurs, ou, { max = LIMITES.champs } = {}) => {
  if (!estObjet(objet)) {
    erreurs.push(`${ou} : les champs doivent être un objet`);
    return {};
  }
  const paires = Object.entries(objet);
  if (!paires.length) erreurs.push(`${ou} : au moins un champ`);
  if (paires.length > max) erreurs.push(`${ou} : ${max} champs au plus`);
  const sortie = {};
  for (const [cle, valeur] of paires.slice(0, max)) {
    if (!CLE.test(cle) || INTERDITS.has(cle)) {
      erreurs.push(`${ou} : nom de champ invalide « ${cle} »`);
      continue;
    }
    if (!["string", "number", "boolean"].includes(typeof valeur)) {
      erreurs.push(`${ou} : valeur invalide pour « ${cle} »`);
      continue;
    }
    if (typeof valeur === "string" && valeur.length > LIMITES.valeur)
      erreurs.push(`${ou} : valeur trop longue pour « ${cle} »`);
    sortie[cle] = valeur;
  }
  return sortie;
};

const verifierTexte = (valeur, max, erreurs, libelle, { requis = true } = {}) => {
  const t = texte(valeur).trim();
  if (requis && !t) erreurs.push(`${libelle} obligatoire`);
  if (t.length > max) erreurs.push(`${libelle} : ${max} caractères au plus`);
  return t.slice(0, max);
};

const verifierAction = (action, i, erreurs, declencheur) => {
  const ou = `Action ${i + 1}`;
  if (!estObjet(action) || !TYPES_ACTION.includes(action.type)) {
    erreurs.push(`${ou} : type inconnu`);
    return null;
  }
  switch (action.type) {
    case "notifier":
      return {
        type: "notifier",
        destinataires: verifierDestinataires(action.destinataires, erreurs, ou),
        titre: verifierTexte(action.titre, LIMITES.titre, erreurs, `${ou} : titre`),
        message: verifierTexte(
          action.message,
          LIMITES.message,
          erreurs,
          `${ou} : message`,
          { requis: false },
        ),
      };
    case "courriel":
      return {
        type: "courriel",
        destinataires: verifierDestinataires(action.destinataires, erreurs, ou),
        sujet: verifierTexte(action.sujet, LIMITES.sujet, erreurs, `${ou} : sujet`),
        texte: verifierTexte(action.texte, LIMITES.texte, erreurs, `${ou} : texte`),
      };
    case "creer":
      if (!NOM.test(texte(action.module)) || !NOM.test(texte(action.collection))) {
        erreurs.push(`${ou} : application ou collection invalide`);
      }
      return {
        type: "creer",
        module: texte(action.module),
        collection: texte(action.collection),
        donnees: verifierChamps(action.donnees, erreurs, ou),
      };
    case "modifier":
      if (declencheur?.evenement === "suppression")
        erreurs.push(`${ou} : une fiche supprimée ne se modifie plus`);
      return {
        type: "modifier",
        champs: verifierChamps(action.champs, erreurs, ou, { max: 10 }),
      };
    case "tache":
      return {
        type: "tache",
        tableauId: texte(action.tableauId).slice(0, 64),
        titre: verifierTexte(action.titre, LIMITES.titre, erreurs, `${ou} : titre`),
        description: verifierTexte(
          action.description,
          LIMITES.texte,
          erreurs,
          `${ou} : description`,
          { requis: false },
        ),
        assigne: CLE.test(texte(action.assigne)) ? texte(action.assigne) : "",
        echeance: texte(action.echeance).slice(0, 40),
      };
    case "webhook": {
      const url = texte(action.url).trim();
      let valide = false;
      try {
        const u = new URL(url);
        valide = u.protocol === "https:" && !u.username && !u.password;
      } catch {
        valide = false;
      }
      if (!valide || url.length > LIMITES.url)
        erreurs.push(`${ou} : adresse https:// valide requise`);
      return { type: "webhook", url };
    }
    default:
      return null;
  }
};

/// Valide et normalise une automatisation. Rend { ok, erreurs, valeur }.
export const validerAutomatisation = (brute) => {
  const erreurs = [];
  if (!estObjet(brute))
    return { ok: false, erreurs: ["Automatisation invalide"], valeur: null };

  const nom = verifierTexte(brute.nom, LIMITES.nom, erreurs, "Nom");
  const d = estObjet(brute.declencheur) ? brute.declencheur : {};
  if (!NOM.test(texte(d.module)) || !NOM.test(texte(d.collection)))
    erreurs.push("Déclencheur : application ou collection invalide");
  if (!EVENEMENTS.includes(d.evenement)) erreurs.push("Déclencheur : événement inconnu");
  if (d.evenement === "modification" && d.champ && !CLE.test(texte(d.champ)))
    erreurs.push("Déclencheur : champ invalide");
  let lier = null;
  if (d.lier) {
    if (
      !estObjet(d.lier) ||
      !CLE.test(texte(d.lier.champ)) ||
      !NOM.test(texte(d.lier.module)) ||
      !NOM.test(texte(d.lier.collection))
    ) {
      erreurs.push("Déclencheur : fiche liée invalide");
    } else {
      lier = {
        champ: d.lier.champ,
        module: d.lier.module,
        collection: d.lier.collection,
      };
    }
  }
  const declencheur = {
    module: texte(d.module),
    collection: texte(d.collection),
    evenement: d.evenement,
    ...(d.evenement === "modification" && d.champ ? { champ: texte(d.champ) } : {}),
    ...(lier ? { lier } : {}),
  };

  const conditions = Array.isArray(brute.conditions) ? brute.conditions : [];
  if (conditions.length > LIMITES.conditions)
    erreurs.push(`${LIMITES.conditions} conditions au plus`);
  const conditionsPropres = conditions.slice(0, LIMITES.conditions).map((c, i) => {
    if (
      !estObjet(c) ||
      !CLE.test(texte(c.champ).split(".")[0]) ||
      !/^[A-Za-z0-9_.]{1,128}$/.test(texte(c.champ))
    ) {
      erreurs.push(`Condition ${i + 1} : champ invalide`);
    }
    if (!OPERATEURS.includes(c?.operateur))
      erreurs.push(`Condition ${i + 1} : opérateur inconnu`);
    if (
      ["change", "devient"].includes(c?.operateur) &&
      declencheur.evenement === "suppression"
    ) {
      erreurs.push(
        `Condition ${i + 1} : « ${c.operateur} » n'a pas de sens pour une suppression`,
      );
    }
    return {
      champ: texte(c?.champ),
      operateur: c?.operateur,
      ...(OPERATEURS_AVEC_VALEUR.includes(c?.operateur)
        ? { valeur: texte(c.valeur).slice(0, LIMITES.valeur) }
        : {}),
    };
  });

  const actions = Array.isArray(brute.actions) ? brute.actions : [];
  if (!actions.length) erreurs.push("Au moins une action");
  if (actions.length > LIMITES.actions)
    erreurs.push(`${LIMITES.actions} actions au plus`);
  const actionsPropres = actions
    .slice(0, LIMITES.actions)
    .map((a, i) => verifierAction(a, i, erreurs, declencheur))
    .filter(Boolean);

  return {
    ok: !erreurs.length,
    erreurs,
    valeur: {
      nom,
      active: brute.active !== false,
      declencheur,
      toutes: brute.toutes !== false,
      conditions: conditionsPropres,
      actions: actionsPropres,
    },
  };
};

// ---------------------------------------------------------------------------
// Ce que l'interface sait décrire
// ---------------------------------------------------------------------------

/// Les collections connues, pour proposer des choix plutôt qu'une saisie
/// libre. Une app du Studio reste utilisable en tapant son nom.
export const COLLECTIONS = [
  {
    module: "crm",
    collection: "clients",
    libelle: "CRM · Comptes",
    champs: [
      "nom",
      "entreprise",
      "email",
      "statut",
      "source",
      "secteur",
      "ville",
      "responsableId",
      "qualifie",
    ],
  },
  {
    module: "crm",
    collection: "opportunites",
    libelle: "CRM · Affaires",
    champs: [
      "libelle",
      "montant",
      "etape",
      "clientId",
      "responsableId",
      "dateCloture",
      "motifPerte",
    ],
  },
  {
    module: "crm",
    collection: "activites",
    libelle: "CRM · Activités",
    champs: ["type", "resume", "clientId", "opportuniteId", "echeance", "fait"],
  },
  {
    module: "facturation",
    collection: "factures",
    libelle: "Facturation · Documents",
    champs: ["type", "numero", "clientId", "clientNom", "statut", "date", "echeance"],
  },
  {
    module: "facturation",
    collection: "reglements",
    libelle: "Facturation · Règlements",
    champs: ["documentId", "montant", "moyen", "date", "reference"],
  },
  {
    module: "projets",
    collection: "cartes",
    libelle: "Projets · Cartes",
    champs: ["titre", "tableauId", "colonneId", "assigneId", "echeance"],
  },
  {
    module: "rh",
    collection: "absences",
    libelle: "RH · Absences et congés",
    champs: ["salarieId", "type", "du", "au", "motif", "etat"],
  },
  {
    module: "rh",
    collection: "salaries",
    libelle: "RH · Salariés",
    champs: ["nom", "prenom", "email", "poste", "service"],
  },
  {
    module: "frais",
    collection: "notes",
    libelle: "Notes de frais",
    champs: ["salarieId", "date", "categorie", "montant", "description", "etat"],
  },
  {
    module: "achats",
    collection: "commandes",
    libelle: "Achats · Commandes",
    champs: ["numero", "date", "fournisseurId", "statut"],
  },
  {
    module: "stock",
    collection: "articles",
    libelle: "Stock · Articles",
    champs: ["reference", "designation", "seuil", "prixVente"],
  },
  {
    module: "stock",
    collection: "mouvements",
    libelle: "Stock · Mouvements",
    champs: ["articleId", "quantite", "sens", "entrepotId", "date"],
  },
  {
    module: "courrier",
    collection: "recus",
    libelle: "Courrier · Courriels reçus",
    champs: ["deEmail", "deNom", "sujet", "texte", "boite", "adresseBoite", "pieces"],
  },
];

export const libelleCollection = (module, collection) =>
  COLLECTIONS.find((c) => c.module === module && c.collection === collection)?.libelle ||
  `${module} · ${collection}`;

// ---------------------------------------------------------------------------
// Recettes
// ---------------------------------------------------------------------------
//
// Des automatisations prêtes à l'emploi, que l'on active en un clic puis
// que l'on ajuste. Chacune doit passer `validerAutomatisation` (testé).

export const RECETTES = [
  {
    id: "affaire-gagnee-passation",
    titre: "Affaire gagnée → tâche de passation dans Projets",
    description:
      "Quand une affaire passe à « Gagnée », une carte de passation est créée dans Projets et le commercial est prévenu.",
    apps: ["crm", "projets"],
    automatisation: {
      nom: "Passation des affaires gagnées",
      declencheur: {
        module: "crm",
        collection: "opportunites",
        evenement: "modification",
        champ: "etape",
      },
      conditions: [{ champ: "etape", operateur: "devient", valeur: "gagnee" }],
      actions: [
        {
          type: "tache",
          titre: "Passation — {{fiche.libelle}}",
          description:
            "Affaire gagnée le {{date}} pour {{fiche.montant}}. Préparer le démarrage avec le client.",
          assigne: "responsableId",
          echeance: "{{date:+7}}",
        },
        {
          type: "notifier",
          destinataires: { mode: "champ", champ: "responsableId" },
          titre: "Bravo : « {{fiche.libelle}} » est gagnée",
          message: "Une tâche de passation a été créée dans Projets.",
        },
      ],
    },
  },
  {
    id: "affaire-perdue-relance",
    titre: "Affaire perdue → relance dans 90 jours",
    description:
      "Une affaire perdue n'est pas un client perdu : une tâche de relance apparaît dans le CRM trois mois plus tard.",
    apps: ["crm"],
    automatisation: {
      nom: "Relancer les affaires perdues",
      declencheur: {
        module: "crm",
        collection: "opportunites",
        evenement: "modification",
        champ: "etape",
      },
      conditions: [{ champ: "etape", operateur: "devient", valeur: "perdue" }],
      actions: [
        {
          type: "creer",
          module: "crm",
          collection: "activites",
          donnees: {
            type: "tache",
            resume: "Relancer après la perte de « {{fiche.libelle}} »",
            clientId: "{{fiche.clientId}}",
            opportuniteId: "{{fiche.id}}",
            echeance: "{{date:+90}}",
            date: "{{maintenant}}",
            fait: false,
          },
        },
      ],
    },
  },
  {
    id: "lead-formulaire",
    titre: "Nouveau lead du formulaire web → prévenir l'équipe",
    description:
      "Chaque inscription au formulaire du site prévient les administrateurs, pour un premier contact dans l'heure.",
    apps: ["crm"],
    automatisation: {
      nom: "Alerte nouveau lead",
      declencheur: { module: "crm", collection: "clients", evenement: "creation" },
      conditions: [{ champ: "source", operateur: "egal", valeur: "formulaire" }],
      actions: [
        {
          type: "notifier",
          destinataires: { mode: "admins" },
          titre: "Nouveau lead : {{fiche.nom}}",
          message:
            "{{fiche.entreprise}} {{fiche.email}} — inscrit via le formulaire du site.",
        },
      ],
    },
  },
  {
    id: "reglement-fil-client",
    titre: "Règlement reçu → note dans la fiche client",
    description:
      "Chaque paiement enregistré en Facturation apparaît dans le fil d'activité du client, côté CRM.",
    apps: ["facturation", "crm"],
    automatisation: {
      nom: "Paiements dans le CRM",
      declencheur: {
        module: "facturation",
        collection: "reglements",
        evenement: "creation",
        lier: { champ: "documentId", module: "facturation", collection: "factures" },
      },
      conditions: [{ champ: "montant", operateur: "superieur", valeur: "0" }],
      actions: [
        {
          type: "creer",
          module: "crm",
          collection: "activites",
          donnees: {
            type: "note",
            resume: "Paiement reçu : {{fiche.montant}} ({{lie.numero}})",
            clientId: "{{lie.clientId}}",
            date: "{{maintenant}}",
            fait: true,
          },
        },
      ],
    },
  },
  {
    id: "conge-demande",
    titre: "Demande de congé → prévenir les administrateurs",
    description: "Une demande d'absence prévient immédiatement ceux qui la valident.",
    apps: ["rh", "conges"],
    automatisation: {
      nom: "Demandes de congé à valider",
      declencheur: { module: "rh", collection: "absences", evenement: "creation" },
      conditions: [{ champ: "etat", operateur: "egal", valeur: "demande" }],
      actions: [
        {
          type: "notifier",
          destinataires: { mode: "admins" },
          titre: "Demande d'absence du {{fiche.du}} au {{fiche.au}}",
          message: "{{auteur.nom}} — {{fiche.motif}}",
        },
      ],
    },
  },
  {
    id: "conge-decide",
    titre: "Congé validé ou refusé → prévenir le salarié",
    description:
      "Le salarié apprend la décision dès qu'elle est prise, sans relancer personne.",
    apps: ["rh", "conges"],
    automatisation: {
      nom: "Décision de congé",
      declencheur: {
        module: "rh",
        collection: "absences",
        evenement: "modification",
        champ: "etat",
      },
      conditions: [{ champ: "etat", operateur: "different", valeur: "demande" }],
      actions: [
        {
          type: "notifier",
          destinataires: { mode: "champ", champ: "salarieId" },
          titre: "Votre absence du {{fiche.du}} : {{fiche.etat}}",
          message: "Décision prise par {{auteur.nom}}.",
        },
      ],
    },
  },
  {
    id: "frais-approuvee",
    titre: "Note de frais approuvée → prévenir le salarié",
    description: "Le salarié sait que sa note part au remboursement.",
    apps: ["frais"],
    automatisation: {
      nom: "Notes de frais approuvées",
      declencheur: {
        module: "frais",
        collection: "notes",
        evenement: "modification",
        champ: "etat",
      },
      conditions: [{ champ: "etat", operateur: "devient", valeur: "approuvee" }],
      actions: [
        {
          type: "notifier",
          destinataires: { mode: "champ", champ: "salarieId" },
          titre: "Note de frais approuvée : {{fiche.montant}}",
          message: "{{fiche.description}}",
        },
      ],
    },
  },
  {
    id: "webhook-affaires",
    titre: "Nouvelle affaire → outil externe (Zapier, Make, n8n…)",
    description:
      "Chaque nouvelle affaire est envoyée, signée, à l'adresse de votre choix.",
    apps: ["crm"],
    automatisation: {
      nom: "Affaires vers un outil externe",
      declencheur: { module: "crm", collection: "opportunites", evenement: "creation" },
      conditions: [],
      actions: [{ type: "webhook", url: "https://hooks.exemple.com/companyos" }],
    },
  },
];

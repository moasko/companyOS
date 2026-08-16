// Studio — les règles, sans React.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUE CE FICHIER A CHANGÉ
//
// Les règles du Studio vivaient dans le composant : types de champs en
// dur dans le JSX, normalisation et validation mêlées au rendu. Deux
// conséquences : rien ne pouvait être éprouvé sans ouvrir un navigateur,
// et le moteur d'exécution (CustomApp) devait redevinier ce que le Studio
// avait voulu dire.
//
// Ici les deux côtés lisent la même déclaration. Ajouter un type de champ
// se fait en une entrée de `TYPES` — le formulaire, la liste, l'export et
// la validation le suivent.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUI MANQUAIT À UN CONSTRUCTEUR D'APPLICATIONS
//
//   - **Les relations.** Une app « Suivi de livraisons » veut désigner un
//     client, pas retaper son nom. Sans lien entre collections, chaque app
//     du Studio restait un carnet isolé.
//   - **Les champs calculés.** Quantité × prix unitaire est le calcul le
//     plus courant d'une fiche ; le faire à la main invite l'erreur.
//   - **Les types du quotidien.** Téléphone, e-mail, lien : ils existaient
//     en « texte », donc sans clavier adapté sur mobile ni lien cliquable.
// ─────────────────────────────────────────────────────────────────────────

/// Les types de champ, et tout ce que les deux côtés doivent savoir d'eux.
///
/// `saisie` dit quel contrôle HTML rendre, `aligne` si la valeur se lit à
/// droite (les nombres se comparent en colonne), `calcule` si la valeur est
/// déduite au lieu d'être saisie.
export const TYPES = {
  texte: { label: "Texte court", saisie: "text" },
  zone: { label: "Texte long", saisie: "zone" },
  nombre: { label: "Nombre", saisie: "number", aligne: true },
  montant: { label: "Montant (F CFA)", saisie: "number", aligne: true },
  date: { label: "Date", saisie: "date" },
  choix: { label: "Liste de choix", saisie: "select", options: true },
  booleen: { label: "Oui / non", saisie: "checkbox" },
  telephone: { label: "Téléphone", saisie: "tel" },
  email: { label: "Adresse e-mail", saisie: "email" },
  lien: { label: "Lien web", saisie: "url" },
  // Une relation pointe vers une autre collection de la même application.
  // `cible` porte la clé de cette collection.
  relation: { label: "Lien vers une fiche", saisie: "relation", cible: true },
  // Un calcul ne se saisit pas : il se lit. `formule` porte l'expression.
  calcul: { label: "Calcul automatique", saisie: "aucune", aligne: true, calcule: true },
};

/// Version du contrat déclaratif compris par ce shell. Elle voyage avec la
/// définition afin qu'une future évolution puisse migrer les anciennes apps
/// explicitement au lieu d'en deviner la forme au rendu.
export const SCHEMA_VERSION = 2;

export const AUTOMATISATION_VIDE = (collection = "") => ({
  id: `regle-${Date.now()}`,
  nom: "Nouvelle règle",
  active: true,
  collection,
  declencheur: "creation",
  conditions: [],
  actions: [],
});

const conditionValide = (condition, valeurs) => {
  const valeur = valeurs?.[condition.champ];
  const attendu = condition.valeur ?? "";
  if (condition.operateur === "non-vide") return valeur !== "" && valeur != null;
  if (condition.operateur === "vide") return valeur === "" || valeur == null;
  if (condition.operateur === "different")
    return String(valeur ?? "") !== String(attendu);
  if (condition.operateur === "contient") {
    return String(valeur ?? "")
      .toLowerCase()
      .includes(String(attendu).toLowerCase());
  }
  if (condition.operateur === "superieur") return Number(valeur) > Number(attendu);
  return String(valeur ?? "") === String(attendu);
};

/// Exécute les règles déclaratives d'une app, sans `eval` et sans code fourni
/// par l'utilisateur. Une règle ne peut modifier que la fiche courante.
export const appliquerAutomatisations = (
  definition,
  collection,
  declencheur,
  valeurs,
) => {
  const resultat = { ...valeurs };
  const declenchees = [];
  const notifications = [];
  for (const regle of definition?.automatisations || []) {
    if (
      regle.active === false ||
      regle.collection !== collection ||
      ![declencheur, "toujours"].includes(regle.declencheur) ||
      !(regle.conditions || []).every((condition) => conditionValide(condition, resultat))
    ) {
      continue;
    }
    for (const action of regle.actions || []) {
      if (action.type === "definir" && action.champ)
        resultat[action.champ] = action.valeur;
      if (action.type === "notifier" && action.titre) {
        notifications.push({ titre: action.titre, message: action.message || "" });
      }
    }
    declenchees.push(regle.nom || "Règle sans nom");
  }
  return { valeurs: resultat, declenchees, notifications };
};

/// Ce qu'un champ neuf contient.
export const CHAMP_VIDE = () => ({
  key: "",
  label: "",
  type: "texte",
  options: [],
  required: false,
  cible: "",
  formule: "",
  // Mise en page de la fiche — de l'affichage, jamais de la donnée.
  largeur: "demi",
  section: "",
});

export const COLLECTION_VIDE = () => ({
  key: "elements",
  label: "Éléments",
  icon: "faTable",
  fields: [{ ...CHAMP_VIDE(), key: "nom", label: "Nom", required: true }],
});

/// Un identifiant technique à partir d'un libellé.
export const slugify = (valeur) =>
  String(valeur || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

// ---------------------------------------------------------------------------
// Modèles de départ
// ---------------------------------------------------------------------------
//
// Partir d'une page blanche est le meilleur moyen de ne rien créer. Ces
// modèles sont des applications complètes, à modifier plutôt qu'à
// contempler — et ils montrent au passage ce que le Studio sait faire :
// relations, calculs, listes de choix.

export const MODELES = [
  {
    id: "vierge",
    nom: "Application vierge",
    aide: "Une collection, un champ. À vous de construire.",
    icone: "notes",
    definition: { collections: [COLLECTION_VIDE()] },
  },
  {
    id: "livraisons",
    nom: "Suivi de livraisons",
    aide: "Des destinataires, et les livraisons qui leur sont faites.",
    icone: "livraison",
    categorie: "Suivi",
    definition: {
      collections: [
        {
          key: "destinataires",
          label: "Destinataires",
          icon: "faAddressBook",
          fields: [
            { key: "nom", label: "Nom", type: "texte", required: true },
            { key: "telephone", label: "Téléphone", type: "telephone" },
            { key: "quartier", label: "Quartier", type: "texte" },
          ],
        },
        {
          key: "livraisons",
          label: "Livraisons",
          icon: "faTruckFast",
          fields: [
            { key: "reference", label: "Référence", type: "texte", required: true },
            {
              key: "destinataire",
              label: "Destinataire",
              type: "relation",
              cible: "destinataires",
            },
            { key: "date", label: "Date prévue", type: "date" },
            {
              key: "etat",
              label: "État",
              type: "choix",
              options: ["À préparer", "En route", "Livrée", "Échec"],
            },
            { key: "frais", label: "Frais de livraison", type: "montant" },
            { key: "note", label: "Remarque", type: "zone" },
          ],
        },
      ],
    },
  },
  {
    id: "interventions",
    nom: "Interventions techniques",
    aide: "Des clients, et les dépannages facturés au temps passé.",
    icone: "projets",
    categorie: "Suivi",
    definition: {
      collections: [
        {
          key: "clients",
          label: "Clients",
          icon: "faAddressBook",
          fields: [
            { key: "nom", label: "Nom", type: "texte", required: true },
            { key: "telephone", label: "Téléphone", type: "telephone" },
            { key: "adresse", label: "Adresse", type: "zone" },
          ],
        },
        {
          key: "interventions",
          label: "Interventions",
          icon: "faScrewdriverWrench",
          fields: [
            { key: "objet", label: "Objet", type: "texte", required: true },
            { key: "client", label: "Client", type: "relation", cible: "clients" },
            { key: "date", label: "Date", type: "date" },
            { key: "heures", label: "Heures passées", type: "nombre" },
            { key: "taux", label: "Taux horaire", type: "montant" },
            {
              key: "total",
              label: "À facturer",
              type: "calcul",
              formule: "heures * taux",
            },
            {
              key: "etat",
              label: "État",
              type: "choix",
              options: ["Planifiée", "Faite", "Facturée"],
            },
          ],
        },
      ],
    },
  },
  {
    id: "adherents",
    nom: "Adhérents et cotisations",
    aide: "Un registre de membres, et ce que chacun a versé.",
    icone: "crm",
    categorie: "Gestion",
    definition: {
      collections: [
        {
          key: "adherents",
          label: "Adhérents",
          icon: "faUsers",
          fields: [
            { key: "nom", label: "Nom complet", type: "texte", required: true },
            { key: "telephone", label: "Téléphone", type: "telephone" },
            { key: "email", label: "E-mail", type: "email" },
            { key: "adhesion", label: "Date d'adhésion", type: "date" },
            { key: "actif", label: "Actif", type: "booleen" },
          ],
        },
        {
          key: "cotisations",
          label: "Cotisations",
          icon: "faHandHoldingDollar",
          fields: [
            {
              key: "adherent",
              label: "Adhérent",
              type: "relation",
              cible: "adherents",
              required: true,
            },
            { key: "date", label: "Date du versement", type: "date" },
            { key: "montant", label: "Montant", type: "montant" },
            {
              key: "moyen",
              label: "Moyen",
              type: "choix",
              options: ["Espèces", "Mobile Money", "Virement"],
            },
          ],
        },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// Calculs
// ---------------------------------------------------------------------------

/// Évalue la formule d'un champ calculé.
///
/// Volontairement minimaliste : des clés de champ, des nombres, et les
/// quatre opérations avec parenthèses. Pas d'`eval` — une formule saisie
/// par un utilisateur est du texte non fiable, et `eval` lui donnerait
/// accès à toute la page. On analyse donc l'expression nous-mêmes.
///
/// Une formule invalide rend `null` : la fiche affiche un tiret, elle ne
/// casse pas.
export const evaluer = (formule, valeurs = {}) => {
  const texte = String(formule || "").trim();
  if (!texte) return null;

  // Découpage : nombres, identifiants, opérateurs, parenthèses. Tout ce qui
  // n'entre pas dans ces catégories invalide la formule — c'est le filtre
  // qui remplace le bac à sable dont `eval` aurait eu besoin.
  const jetons = texte.match(/\d+\.?\d*|[a-zA-Z_][\w-]*|[+\-*/()]/g);
  if (!jetons || jetons.join("").length !== texte.replace(/\s+/g, "").length) {
    return null;
  }

  let i = 0;
  const suivant = () => jetons[i];
  const avaler = () => jetons[i++];

  // Descente récursive : expression → terme → facteur. Trois fonctions
  // suffisent pour la priorité des opérateurs et les parenthèses.
  const facteur = () => {
    const j = suivant();
    if (j === "(") {
      avaler();
      const v = expression();
      if (suivant() !== ")") throw new Error("parenthèse");
      avaler();
      return v;
    }
    if (j === "-") {
      avaler();
      return -facteur();
    }
    if (j === undefined) throw new Error("fin inattendue");
    avaler();
    if (/^\d/.test(j)) return Number(j);
    const v = valeurs[j];
    // Un champ vide vaut zéro : sur une fiche en cours de saisie, c'est ce
    // qu'attend l'utilisateur, pas une erreur.
    return Number(v) || 0;
  };

  const terme = () => {
    let v = facteur();
    while (suivant() === "*" || suivant() === "/") {
      const op = avaler();
      const d = facteur();
      if (op === "/") {
        // Division par zéro : la formule n'a pas de résultat, elle n'est
        // pas fausse. On rend null plutôt qu'Infinity.
        if (!d) throw new Error("division par zéro");
        v /= d;
      } else v *= d;
    }
    return v;
  };

  const expression = () => {
    let v = terme();
    while (suivant() === "+" || suivant() === "-") {
      const op = avaler();
      const d = terme();
      v = op === "+" ? v + d : v - d;
    }
    return v;
  };

  try {
    const v = expression();
    if (i !== jetons.length) return null; // du texte en trop après la formule
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
};

/// Les clés de champ qu'une formule utilise — pour vérifier qu'elles
/// existent avant de publier.
export const referencesDe = (formule) =>
  (String(formule || "").match(/[a-zA-Z_][\w-]*/g) || []).filter(
    (v, i, a) => a.indexOf(v) === i,
  );

/// Les valeurs d'une fiche, calculs compris. C'est ce que la liste,
/// l'export et l'affichage doivent lire — jamais `record.data` seul, qui ne
/// contient pas les calculs.
export const valeursCompletes = (collection, donnees = {}) => {
  const out = { ...donnees };
  for (const f of collection?.fields || []) {
    if (f.type === "calcul") out[f.key] = evaluer(f.formule, out);
  }
  return out;
};

// ---------------------------------------------------------------------------
// Normalisation et validation
// ---------------------------------------------------------------------------

/// Prépare une définition pour l'API : clés dérivées des libellés,
/// champs sans libellé écartés, options nettoyées.
export const normaliser = (definition) => {
  const collections = (definition?.collections || []).map((c, ci) => ({
    key: slugify(c.key || c.label) || `collection-${ci + 1}`,
    label: (c.label || "").trim() || `Collection ${ci + 1}`,
    icon: c.icon || "faTable",
    ...(c.vue
      ? {
          vue: {
            mode: ["liste", "cartes", "kanban"].includes(c.vue.mode)
              ? c.vue.mode
              : "liste",
            ...(c.vue.groupePar ? { groupePar: slugify(c.vue.groupePar) } : {}),
            ...(Array.isArray(c.vue.carte)
              ? { carte: c.vue.carte.map(slugify).filter(Boolean).slice(0, 6) }
              : {}),
          },
        }
      : {}),
    fields: (c.fields || [])
      .filter((f) => (f.label || "").trim())
      .map((f, fi) => ({
        key: slugify(f.key || f.label) || `champ-${fi + 1}`,
        label: f.label.trim(),
        type: TYPES[f.type] ? f.type : "texte",
        required: !!f.required,
        ...(f.largeur === "plein" ? { largeur: "plein" } : { largeur: "demi" }),
        ...(String(f.section || "").trim()
          ? { section: String(f.section).trim().slice(0, 60) }
          : {}),
        ...(f.type === "choix"
          ? { options: (f.options || []).map((o) => String(o).trim()).filter(Boolean) }
          : {}),
        ...(f.type === "relation" ? { cible: f.cible || "" } : {}),
        ...(f.type === "calcul" ? { formule: (f.formule || "").trim() } : {}),
      })),
  }));
  // Le tableau de bord : on écarte les pavés qui pointent vers une
  // collection ou un champ disparu, plutôt que de les laisser planter à
  // l'affichage. Un réglage d'écran qui n'est plus valable se retire, il
  // ne fait pas échouer la publication.
  const clesColl = new Set(collections.map((c) => c.key));
  const accueil = (definition?.accueil || []).filter((w) => {
    const coll = collections.find((c) => c.key === w.collection);
    if (!coll) return false;
    if (WIDGETS[w.type]?.besoinChamp) {
      return coll.fields.some((f) => f.key === w.champ);
    }
    return true;
  });
  const normaliserStyleResponsive = (style = {}) => ({
    ...(style.largeur && ["25", "50", "75", "100"].includes(String(style.largeur))
      ? { largeur: String(style.largeur) }
      : {}),
    ...(style.padding !== undefined
      ? { padding: Math.max(0, Math.min(64, Number(style.padding) || 0)) }
      : {}),
    ...(style.alignement && ["gauche", "centre", "droite"].includes(style.alignement)
      ? { alignement: style.alignement }
      : {}),
    ...(style.direction && ["ligne", "colonne", "grille"].includes(style.direction)
      ? { direction: style.direction }
      : {}),
    ...(style.colonnes && [2, 3, 4].includes(Number(style.colonnes))
      ? { colonnes: Number(style.colonnes) }
      : {}),
    ...(style.gap !== undefined
      ? { gap: Math.max(0, Math.min(48, Number(style.gap) || 0)) }
      : {}),
    ...(style.fond && ["surface", "transparent", "accent", "subtil"].includes(style.fond)
      ? { fond: style.fond }
      : {}),
    ...(style.masque !== undefined ? { masque: Boolean(style.masque) } : {}),
  });
  const typesComposants = new Set([
    "titre",
    "texte",
    "bouton",
    "compteur",
    "tableau",
    "formulaire",
    "conteneur",
    "section",
    "image",
    "carte",
    "liste",
    "graphique",
    "badge",
    "separateur",
  ]);
  const pages = (definition?.pages || []).slice(0, 20).map((page, index) => ({
    id: slugify(page.id || page.nom) || `page-${index + 1}`,
    nom: String(page.nom || `Page ${index + 1}`)
      .trim()
      .slice(0, 80),
    composants: (page.composants || [])
      .filter((composant) => typesComposants.has(composant.type))
      .slice(0, 80)
      .map((composant, composantIndex) => ({
        id: String(composant.id || `bloc-${composantIndex + 1}`).slice(0, 80),
        type: composant.type,
        label: String(composant.label || "").slice(0, 160),
        ...(composant.parentId &&
        (page.composants || [])
          .slice(0, composantIndex)
          .some(
            (parent) =>
              String(parent.id) === String(composant.parentId) &&
              ["section", "conteneur"].includes(parent.type),
          )
          ? { parentId: String(composant.parentId).slice(0, 80) }
          : {}),
        ...(composant.type === "image" && /^https?:\/\//i.test(composant.source || "")
          ? { source: String(composant.source).slice(0, 1000) }
          : {}),
        ...(composant.collection && clesColl.has(slugify(composant.collection))
          ? { collection: slugify(composant.collection) }
          : {}),
        ...(composant.type === "bouton" &&
        ["page", "collection"].includes(composant.action?.type) &&
        composant.action?.cible
          ? {
              action: {
                type: composant.action.type,
                cible: slugify(composant.action.cible),
              },
            }
          : {}),
        style: {
          largeur: ["25", "50", "75", "100"].includes(String(composant.style?.largeur))
            ? String(composant.style.largeur)
            : "50",
          padding: Math.max(0, Math.min(64, Number(composant.style?.padding) || 0)),
          alignement: ["gauche", "centre", "droite"].includes(composant.style?.alignement)
            ? composant.style.alignement
            : "gauche",
          fond: ["surface", "transparent", "accent", "subtil"].includes(
            composant.style?.fond,
          )
            ? composant.style.fond
            : "surface",
          ...(["section", "conteneur"].includes(composant.type)
            ? {
                direction: ["ligne", "colonne", "grille"].includes(
                  composant.style?.direction,
                )
                  ? composant.style.direction
                  : "ligne",
                colonnes: [2, 3, 4].includes(Number(composant.style?.colonnes))
                  ? Number(composant.style.colonnes)
                  : 2,
                gap: Math.max(0, Math.min(48, Number(composant.style?.gap) || 0)),
              }
            : {}),
        },
        ...(composant.responsive
          ? {
              responsive: {
                tablet: normaliserStyleResponsive(composant.responsive.tablet),
                mobile: normaliserStyleResponsive(composant.responsive.mobile),
              },
            }
          : {}),
      })),
  }));
  const automatisations = (definition?.automatisations || []).map((regle, index) => ({
    id: String(regle.id || `regle-${index + 1}`).slice(0, 60),
    nom: String(regle.nom || `Règle ${index + 1}`)
      .trim()
      .slice(0, 80),
    active: regle.active !== false,
    collection: slugify(regle.collection),
    declencheur: ["creation", "modification", "toujours"].includes(regle.declencheur)
      ? regle.declencheur
      : "creation",
    conditions: (regle.conditions || []).slice(0, 6).map((condition) => ({
      champ: slugify(condition.champ),
      operateur: [
        "egal",
        "different",
        "contient",
        "vide",
        "non-vide",
        "superieur",
      ].includes(condition.operateur)
        ? condition.operateur
        : "egal",
      valeur: condition.valeur ?? "",
    })),
    actions: (regle.actions || []).slice(0, 6).map((action) =>
      action.type === "notifier"
        ? {
            type: "notifier",
            titre: String(action.titre || "Notification")
              .trim()
              .slice(0, 100),
            message: String(action.message || "")
              .trim()
              .slice(0, 500),
          }
        : {
            type: "definir",
            champ: slugify(action.champ),
            valeur: action.valeur ?? "",
          },
    ),
  }));

  return {
    schemaVersion: SCHEMA_VERSION,
    genre: "donnees",
    collections,
    ...(accueil.length ? { accueil } : {}),
    ...(pages.length ? { pages } : {}),
    ...(automatisations.length ? { automatisations } : {}),
  };
};

/// Ce qui empêche de publier, en clair. Liste vide = bon à publier.
///
/// La validation dit *quoi* corriger et *où*, pas seulement qu'il y a une
/// erreur : une app à trois collections et vingt champs ne se relit pas à
/// l'œil nu.
export const problemes = (app) => {
  const out = [];
  if (!String(app?.name || "").trim()) out.push("Donnez un nom à l'application.");
  if (!app?.slug) out.push("L'identifiant technique est vide.");

  const collections = app?.definition?.collections || [];
  if (!collections.length) out.push("Ajoutez au moins une collection.");

  const clesCollections = collections.map((c) => c.key);
  if (new Set(clesCollections).size !== clesCollections.length) {
    out.push("Deux collections portent le même identifiant.");
  }

  for (const c of collections) {
    if (!c.fields?.length) {
      out.push(`La collection « ${c.label} » n'a aucun champ.`);
      continue;
    }
    const cles = c.fields.map((f) => f.key);
    if (new Set(cles).size !== cles.length) {
      out.push(`Deux champs portent le même identifiant dans « ${c.label} ».`);
    }

    for (const f of c.fields) {
      if (f.type === "choix" && !(f.options || []).length) {
        out.push(`« ${f.label} » est une liste de choix sans aucune option.`);
      }
      if (f.type === "relation") {
        if (!f.cible) {
          out.push(`« ${f.label} » doit désigner la collection vers laquelle pointer.`);
        } else if (!clesCollections.includes(f.cible)) {
          out.push(`« ${f.label} » pointe vers une collection qui n'existe pas.`);
        } else if (f.cible === c.key) {
          // Techniquement possible, mais presque toujours une erreur de
          // saisie — et le sélecteur proposerait la fiche en cours.
          out.push(`« ${f.label} » pointe vers sa propre collection.`);
        }
      }
      if (f.type === "calcul") {
        if (!f.formule) {
          out.push(`« ${f.label} » est un calcul sans formule.`);
        } else {
          const inconnues = referencesDe(f.formule).filter((r) => !cles.includes(r));
          if (inconnues.length) {
            out.push(
              `La formule de « ${f.label} » utilise ${inconnues.map((x) => `« ${x} »`).join(", ")}, qui n'existe pas dans cette collection.`,
            );
          } else if (
            evaluer(f.formule, Object.fromEntries(cles.map((k) => [k, 1]))) === null
          ) {
            out.push(`La formule de « ${f.label} » n'est pas valide.`);
          }
        }
      }
    }
  }
  for (const regle of app?.definition?.automatisations || []) {
    const collection = collections.find((c) => c.key === regle.collection);
    if (!collection) {
      out.push(`La règle « ${regle.nom} » vise une collection qui n'existe pas.`);
      continue;
    }
    const cles = new Set(collection.fields.map((f) => f.key));
    if (!(regle.actions || []).length)
      out.push(`La règle « ${regle.nom} » n'a aucune action.`);
    if (
      [
        ...(regle.conditions || []),
        ...(regle.actions || []).filter((action) => action.type === "definir"),
      ].some((x) => !cles.has(x.champ))
    ) {
      out.push(`La règle « ${regle.nom} » utilise un champ qui n'existe pas.`);
    }
  }
  return out;
};

/// Écran vers lequel guider l'utilisateur lorsqu'une validation échoue.
export const sectionPourProbleme = (probleme = "") => {
  if (/nom|identifiant technique/i.test(probleme)) return "identite";
  if (/adresse|http/i.test(probleme)) return "adresse";
  if (/règle|automatisation/i.test(probleme)) return "automatisations";
  return "donnees";
};

/// Le libellé d'une fiche liée : son premier champ texte renseigné.
///
/// Une relation doit montrer quelque chose de reconnaissable, pas un
/// identifiant. Le premier champ d'une collection est presque toujours son
/// nom — c'est la convention du Studio, et elle vaut mieux qu'un réglage
/// supplémentaire à comprendre.
export const libelleFiche = (collection, record) => {
  if (!record) return "";
  const champ = (collection?.fields || []).find(
    (f) => ["texte", "email", "telephone"].includes(f.type) && record.data?.[f.key],
  );
  return champ ? String(record.data[champ.key]) : record.id.slice(-6);
};

// ---------------------------------------------------------------------------
// Vues d'une collection
// ---------------------------------------------------------------------------
//
// Une même collection peut se lire de trois façons, et le bon choix dépend
// des données : un tableau pour comparer des chiffres, des cartes pour un
// répertoire, un kanban pour un suivi qui avance par étapes. C'est
// exactement ce qui manquait — le Studio ne savait faire qu'un tableau.

/// Les colonnes d'un kanban : les valeurs d'un champ à choix, dans l'ordre
/// où elles ont été déclarées, plus une colonne « sans » pour les fiches
/// qui n'ont pas encore de valeur. L'ordre déclaré *est* le flux de
/// travail — « À faire, En cours, Fait » n'a de sens que dans cet ordre.
export const colonnesKanban = (collection, champKey) => {
  const champ = (collection?.fields || []).find((f) => f.key === champKey);
  if (!champ || champ.type !== "choix") return [];
  return [...(champ.options || []), null];
};

/// Répartit des fiches dans les colonnes d'un kanban.
export const parColonne = (records, champKey, colonnes) => {
  const out = new Map(colonnes.map((c) => [c ?? "", []]));
  for (const r of records) {
    const v = r.data?.[champKey] || "";
    if (out.has(v)) out.get(v).push(r);
    else out.get("").push(r);
  }
  return out;
};

// ---------------------------------------------------------------------------
// Mise en page de la fiche
// ---------------------------------------------------------------------------

/// Regroupe les champs par section, dans l'ordre de déclaration. Une fiche
/// à vingt champs d'un seul tenant est illisible ; les sections la
/// découpent en « Coordonnées », « Facturation »… La section vide est le
/// cas par défaut — la plupart des fiches n'en ont pas besoin.
export const parSection = (fields = []) => {
  const out = [];
  for (const f of fields) {
    const nom = (f.section || "").trim();
    let bloc = out.find((b) => b.nom === nom);
    if (!bloc) {
      bloc = { nom, champs: [] };
      out.push(bloc);
    }
    bloc.champs.push(f);
  }
  return out;
};

// ---------------------------------------------------------------------------
// Tableau de bord de l'application
// ---------------------------------------------------------------------------
//
// Un carnet de fiches sans vue d'ensemble oblige à tout parcourir pour
// répondre à « combien » ou « combien ça fait ». Les pavés répondent à
// cette question sans code : un compteur, une somme, une répartition.

export const WIDGETS = {
  compteur: { label: "Nombre de fiches", besoinChamp: false },
  somme: {
    label: "Total d'un montant",
    besoinChamp: true,
    typeChamp: ["montant", "nombre", "calcul"],
  },
  repartition: {
    label: "Répartition par choix",
    besoinChamp: true,
    typeChamp: ["choix", "booleen"],
  },
};

/// Calcule la valeur d'un pavé à partir des fiches d'une collection.
///
/// Le filtre optionnel restreint aux fiches dont un champ vaut une valeur —
/// « nombre de livraisons *en retard* ». C'est ce qui transforme un
/// compteur brut en indicateur utile.
export const calculerWidget = (widget, records, collection) => {
  let fiches = records;
  if (widget.filtre?.champ) {
    fiches = fiches.filter(
      (r) => String(r.data?.[widget.filtre.champ] ?? "") === widget.filtre.valeur,
    );
  }

  if (widget.type === "compteur") {
    return { valeur: fiches.length, format: "nombre" };
  }

  if (widget.type === "somme") {
    const total = fiches.reduce((s, r) => {
      const valeurs = valeursCompletes(collection, r.data);
      return s + (Number(valeurs[widget.champ]) || 0);
    }, 0);
    const champ = (collection?.fields || []).find((f) => f.key === widget.champ);
    return { valeur: total, format: champ?.type === "montant" ? "montant" : "nombre" };
  }

  if (widget.type === "repartition") {
    const parValeur = new Map();
    const champ = (collection?.fields || []).find((f) => f.key === widget.champ);
    for (const r of fiches) {
      let v = r.data?.[widget.champ];
      if (champ?.type === "booleen") v = v ? "Oui" : "Non";
      v = v || "—";
      parValeur.set(v, (parValeur.get(v) || 0) + 1);
    }
    return {
      format: "repartition",
      parts: [...parValeur.entries()]
        .map(([libelle, n]) => ({ libelle, n }))
        .sort((a, b) => b.n - a.n),
      total: fiches.length,
    };
  }

  return { valeur: 0, format: "nombre" };
};

import { montant } from "../../../utils/monnaie.js";

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/// Affichage d'une valeur selon son type. Partagé par la liste, la fiche et
/// l'aperçu — c'est ce qui garantit que l'aperçu ne mente pas.
export const affiche = (champ, valeur) => {
  if (valeur === undefined || valeur === null || valeur === "") return "—";
  switch (champ.type) {
    case "booleen":
      return valeur ? "Oui" : "Non";
    case "montant":
      return montant(Number(valeur) || 0);
    case "calcul":
    case "nombre":
      return nf.format(Number(valeur) || 0);
    case "date": {
      const [y, m, d] = String(valeur).split("-");
      return d ? `${d}/${m}/${y}` : String(valeur);
    }
    default:
      return String(valeur);
  }
};

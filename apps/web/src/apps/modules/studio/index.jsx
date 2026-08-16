import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { syncInstalledModules } from "../../sync";
import { scrollElementTo } from "../../scrollTo";
import { modal } from "../../modalRequest";
import * as D from "./domaine";
import "./studio.scss";

// Studio : créer une application depuis le shell, puis la publier dans la
// Boutique de son espace de travail.
//
// Une app créée ici n'a pas de code — le navigateur ne peut pas écrire dans
// les sources. Elle est **décrite** : des collections, des champs. Le moteur
// générique (src/apps/CustomApp.jsx) en déduit listes, formulaires et CRUD.
// C'est ce qui la rend réellement utilisable sans recompiler quoi que ce soit.

// `genres` dit dans quel genre d'application la section a un sens. Une app
// « site web » n'a ni collection, ni tableau de bord, ni aperçu de fiche :
// lui montrer ces écrans vides serait la faire passer pour inachevée.
const SECTIONS = [
  { id: "mes-apps", label: "Mes applications", icon: "faLayerGroup", phase: "Espace" },
  { id: "identite", label: "Identité", icon: "faTag", phase: "Construire" },
  {
    id: "adresse",
    label: "Adresse du site",
    icon: "faGlobe",
    genres: ["web"],
    phase: "Construire",
  },
  {
    id: "donnees",
    label: "Données",
    icon: "faTable",
    genres: ["donnees"],
    phase: "Construire",
  },
  {
    id: "automatisations",
    label: "Automatisations",
    icon: "faBolt",
    genres: ["donnees"],
    phase: "Construire",
  },
  {
    id: "tableau",
    label: "Interface",
    icon: "faObjectGroup",
    genres: ["donnees"],
    phase: "Expérience",
  },
  {
    id: "apercu",
    label: "Aperçu",
    icon: "faEye",
    genres: ["donnees"],
    phase: "Expérience",
  },
  { id: "publication", label: "Publication", icon: "faRocket", phase: "Livrer" },
];

/// Les deux genres d'application que le Studio sait fabriquer.
const GENRES = [
  {
    id: "donnees",
    titre: "Application de données",
    texte:
      "Des collections et des champs : listes, fiches, tableau de bord. Le moteur en déduit l'écran, sans écrire de code.",
  },
  {
    id: "web",
    titre: "Site web en application",
    texte:
      "Une adresse présentée comme une app : icône sur le bureau, entrée au menu Démarrer, fenêtre à son nom. Pour les outils que l'équipe utilise déjà dans un onglet.",
  },
];

// Les types viennent du domaine : ajouter un type de champ se fait à un
// seul endroit, et le moteur d'exécution le suit sans être modifié.
const TYPES_CHAMP = Object.entries(D.TYPES).map(([id, t]) => ({ id, label: t.label }));

// Icônes proposées à une application du Studio.
//
// Uniquement le jeu maison (`public/img/icon/cos/`). L'ancienne liste
// puisait dans les PNG hérités de Win11React : dix de ses vingt-deux choix
// — « calendar », « maps », « security »… — étaient des visuels Microsoft.
// Une application créée par un client se retrouvait donc à porter le logo
// d'un produit tiers, ce que le jeu maison existe précisément pour éviter.
//
// Toute icône ajoutée à `ICONES_COS` peut être proposée ici : c'est une
// liste de noms, le résolveur fait le reste.
const ICONES = [
  // métier
  "projets",
  "crm",
  "rh",
  "facturation",
  "stock",
  "comptabilite",
  "livraison",
  // documents
  "notes",
  "blocnotes",
  "editeur",
  "presentation",
  "pdf",
  "pressepapiers",
  // outils
  "qrcode",
  "calculatrice",
  "studio",
  "navigateur",
  "taches",
  // média
  "photos",
  "video",
  "musique",
  "objet3d",
  // échanges
  "connecteur-mail",
  "connecteur-chat",
  "connecteur-drive",
  "connecteur-visio",
];

const CATEGORIES = ["Sur mesure", "Gestion", "Bureautique", "Outils", "Suivi"];

const slugify = D.slugify;
const CHAMP_VIDE = D.CHAMP_VIDE;
const COLLECTION_VIDE = D.COLLECTION_VIDE;

const APP_VIDE = () => ({
  slug: "",
  name: "",
  description: "",
  icon: "notes",
  category: "Sur mesure",
  published: false,
  // Le genre est écrit dès le brouillon vide : une définition relue depuis
  // la base peut ne pas l'avoir (elle est antérieure au second genre), et
  // c'est `genreDe` qui comble ce cas.
  definition: {
    schemaVersion: D.SCHEMA_VERSION,
    genre: "donnees",
    collections: [COLLECTION_VIDE()],
  },
});

/// Le genre d'une définition, avec le repli qui compte : les applications
/// créées avant l'existence des apps « site » n'ont pas ce champ, et sont
/// toutes des applications de données.
const genreDe = (draft) => draft?.definition?.genre || "donnees";

export const manifest = {
  id: "studio",
  slug: "studio",
  name: "Studio",
  // Sur localhost, le builder doit rester testable même lorsque le
  // catalogue distant est indisponible. En production il demeure un module
  // installable depuis la Boutique.
  systeme: import.meta.env.DEV,
  // L'icône est un fichier, pas une clé : le générateur QR utilise aussi
  // « code », et c'est sans conséquence depuis que l'identité d'une
  // application est son `id`.
  icon: "studio",
  action: "STUDIOAPP",
  Window: StudioApp,
};

function StudioApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id || manifest.icon]);
  const session = useSelector((state) => state.session);

  const [section, setSection] = useState("mes-apps");
  const [apps, setApps] = useState([]);
  // Résultat du dernier essai d'adresse, pour une app « site web ».
  const [essai, setEssai] = useState(null);
  const [essaiEnCours, setEssaiEnCours] = useState(false);
  // slug de l'app ouverte ; null = création
  const [editingSlug, setEditingSlug] = useState(null);
  const [draft, setDraft] = useState(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const mainRef = React.useRef(null);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 4000);
  };

  const load = async () => {
    try {
      setApps(await api.myApps());
    } catch (err) {
      flash(err.message);
    }
  };

  useEffect(() => {
    if (wnapp && !wnapp.hide && session.status === "authenticated") load();
  }, [wnapp?.hide, session.status]);

  const goToSection = (id) => {
    setSection(id);
    scrollElementTo(mainRef.current, 0);
  };

  /// Nouvelle application, à partir d'un modèle.
  ///
  /// Partir d'une page blanche est le meilleur moyen de ne rien créer : on
  /// ne sait pas ce que l'outil sait faire, donc on n'ose pas. Les modèles
  /// sont des applications complètes à modifier — et ils montrent au
  /// passage les relations et les calculs, qu'on ne devinerait pas.
  const openNew = async () => {
    const choix = await modal.open({
      title: "Nouvelle application",
      render: ({ close }) => (
        <div className="stdModeles">
          {D.MODELES.map((m) => (
            <button
              type="button"
              key={m.id}
              className="stdModele handcr"
              onClick={() => close(m.id)}
            >
              <Icon src={m.icone} width={30} />
              <b>{m.nom}</b>
              <span>{m.aide}</span>
            </button>
          ))}
        </div>
      ),
    });
    if (!choix) return;
    const modele = D.MODELES.find((m) => m.id === choix);
    setEditingSlug(null);
    setDraft({
      ...APP_VIDE(),
      ...(modele.id === "vierge"
        ? {}
        : {
            name: modele.nom,
            slug: D.slugify(modele.nom),
            description: modele.aide,
            icon: modele.icone,
            category: modele.categorie || "Sur mesure",
          }),
      // Copie profonde : deux applications créées depuis le même modèle ne
      // doivent pas partager leurs tableaux de champs.
      definition: JSON.parse(JSON.stringify(modele.definition)),
    });
    goToSection("identite");
  };

  const openApp = (app) => {
    setEditingSlug(app.slug);
    setDraft({
      slug: app.slug,
      name: app.name,
      description: app.description || "",
      icon: app.icon,
      category: app.category,
      published: app.published,
      definition: {
        schemaVersion: D.SCHEMA_VERSION,
        genre: "donnees",
        collections: [COLLECTION_VIDE()],
        ...(app.definition || {}),
      },
    });
    goToSection("identite");
  };

  const dupliquerApp = (app) => {
    const nom = `${app.name} — copie`;
    setEditingSlug(null);
    setDraft({
      ...APP_VIDE(),
      name: nom,
      slug: slugify(nom),
      description: app.description || "",
      icon: app.icon,
      category: app.category,
      published: false,
      definition: JSON.parse(JSON.stringify(app.definition || APP_VIDE().definition)),
    });
    goToSection("identite");
    flash("Copie créée — donnez-lui un nom avant de la publier");
  };

  // Mise à jour fonctionnelle : plusieurs champs peuvent changer avant le
  // rendu suivant, partir de `draft` capturé écraserait les précédents.
  const setField = (key) => (e) => {
    const value = e.target.value;
    setDraft((d) => ({ ...d, [key]: value }));
  };

  // --- Genre de l'application ----------------------------------------------

  /// Bascule entre app de données et app « site web ».
  ///
  /// Les collections ne sont pas effacées en passant à « site » : quelqu'un
  /// qui essaie l'autre genre par curiosité doit pouvoir revenir sans avoir
  /// perdu son travail. Elles ne sont simplement plus envoyées au serveur —
  /// voir le nettoyage à l'enregistrement.
  const choisirGenre = (id) => {
    setDraft((d) => ({
      ...d,
      definition: {
        ...d.definition,
        genre: id,
        ...(id === "web" && !d.definition.web
          ? { web: { url: "", ouverture: "cadre" } }
          : {}),
      },
    }));
    if (id === "web") goToSection("adresse");
  };

  /// Interroge réellement l'adresse et en tire le mode d'ouverture.
  ///
  /// C'est le serveur qui appelle le site (`POST /api/web/inspecter`) : le
  /// navigateur ne peut pas lire les en-têtes d'un autre domaine, et c'est
  /// justement l'en-tête qui contient la réponse. Au passage, cet appel
  /// passe par les protections contre les adresses internes du serveur.
  ///
  /// On enregistre le constat plutôt que de le refaire à chaque ouverture :
  /// interroger le site à chaque clic sur l'icône ajouterait une seconde
  /// d'attente pour une réponse qui ne change presque jamais.
  const essayerAdresse = async () => {
    const url = draft?.definition?.web?.url || "";
    setEssaiEnCours(true);
    setEssai(null);
    try {
      const info = await api.web.inspecter(url);
      const cadrable = !!info.cadrable;
      setWeb("ouverture")(cadrable ? "cadre" : "fenetre");
      setEssai(
        cadrable
          ? {
              etat: "ok",
              titre: info.titre || "Le site répond.",
              texte:
                "Il accepte d'être affiché dans un cadre : l'application le montrera directement dans sa fenêtre.",
            }
          : {
              etat: "onglet",
              titre: info.titre || "Le site répond, mais refuse le cadre.",
              texte:
                "C'est une protection contre le détournement de clic, et elle ne se contourne pas. " +
                "L'application ouvrira donc un onglet du navigateur — ce qui est de toute façon " +
                "préférable pour s'y connecter, avec la barre d'adresse et le cadenas visibles.",
            },
      );
    } catch (err) {
      setEssai({
        etat: "erreur",
        titre: "Adresse injoignable.",
        texte: err?.message || "Le serveur n'a pas réussi à ouvrir cette adresse.",
      });
    } finally {
      setEssaiEnCours(false);
    }
  };

  const setWeb = (champ) => (valeur) =>
    setDraft((d) => ({
      ...d,
      definition: {
        ...d.definition,
        web: { ...(d.definition.web || {}), [champ]: valeur },
      },
    }));

  // Le slug est l'identifiant technique : on le dérive du nom tant que
  // l'application n'existe pas, puis on le fige — le changer après coup
  // rendrait les données déjà saisies inaccessibles.
  const setName = (e) => {
    const value = e.target.value;
    setDraft((d) => ({
      ...d,
      name: value,
      slug: editingSlug ? d.slug : slugify(value),
    }));
  };

  const setCollection = (index, patch) =>
    setDraft((d) => ({
      ...d,
      definition: {
        ...d.definition,
        collections: d.definition.collections.map((c, i) =>
          i === index ? { ...c, ...patch } : c,
        ),
      },
    }));

  const addCollection = () =>
    setDraft((d) => ({
      ...d,
      definition: {
        ...d.definition,
        collections: [
          ...d.definition.collections,
          {
            ...COLLECTION_VIDE(),
            key: `collection-${d.definition.collections.length + 1}`,
            label: "Nouvelle collection",
          },
        ],
      },
    }));

  const removeCollection = (index) =>
    setDraft((d) => ({
      ...d,
      definition: {
        ...d.definition,
        collections:
          d.definition.collections.length > 1
            ? d.definition.collections.filter((_, i) => i !== index)
            : d.definition.collections,
      },
    }));

  const setChamp = (ci, fi, patch) =>
    setDraft((d) => ({
      ...d,
      definition: {
        ...d.definition,
        collections: d.definition.collections.map((c, i) =>
          i === ci
            ? {
                ...c,
                fields: c.fields.map((f, j) => (j === fi ? { ...f, ...patch } : f)),
              }
            : c,
        ),
      },
    }));

  const pages = () => draft.definition.pages || [];
  const setPages = (liste) =>
    setDraft((d) => ({
      ...d,
      definition: { ...d.definition, pages: liste },
    }));

  const addChamp = (ci) =>
    setDraft((d) => ({
      ...d,
      definition: {
        ...d.definition,
        collections: d.definition.collections.map((c, i) =>
          i === ci ? { ...c, fields: [...c.fields, CHAMP_VIDE()] } : c,
        ),
      },
    }));

  const removeChamp = (ci, fi) =>
    setDraft((d) => ({
      ...d,
      definition: {
        ...d.definition,
        collections: d.definition.collections.map((c, i) =>
          i === ci && c.fields.length > 1
            ? { ...c, fields: c.fields.filter((_, j) => j !== fi) }
            : c,
        ),
      },
    }));

  // ---- Logique no-code ---------------------------------------------------
  const automatisations = () => draft.definition.automatisations || [];
  const setAutomatisations = (liste) =>
    setDraft((d) => ({
      ...d,
      definition: { ...d.definition, automatisations: liste },
    }));
  const addAutomatisation = () =>
    setAutomatisations([
      ...automatisations(),
      D.AUTOMATISATION_VIDE(draft.definition.collections[0]?.key || ""),
    ]);
  const setAutomatisation = (index, patch) =>
    setAutomatisations(
      automatisations().map((regle, i) => (i === index ? { ...regle, ...patch } : regle)),
    );
  const removeAutomatisation = (index) =>
    setAutomatisations(automatisations().filter((_, i) => i !== index));

  /// Prépare la définition pour l'API : clés dérivées des libellés quand
  /// elles sont vides, options découpées, champs sans libellé écartés.
  ///
  /// Pour une app « site », on n'envoie **que** l'adresse : les collections
  /// gardées de côté dans le brouillon (pour pouvoir changer d'avis sans
  /// rien perdre) n'ont plus de sens une fois le genre choisi, et le
  /// serveur les refuserait comme une définition qui se contredit.
  const normaliser = () => {
    if (genreDe(draft) === "web") {
      const web = draft.definition.web || {};
      return {
        schemaVersion: D.SCHEMA_VERSION,
        genre: "web",
        collections: [],
        web: {
          url: String(web.url || "").trim(),
          ouverture: web.ouverture === "fenetre" ? "fenetre" : "cadre",
        },
      };
    }
    return { genre: "donnees", ...D.normaliser(draft.definition) };
  };

  /// Ce qui empêche une app « site » d'être enregistrée. Les apps de
  /// données ont leur propre validation dans le domaine.
  /// Les deux premières lignes reprennent volontairement `D.problemes` :
  /// un nom et un identifiant sont exigés dans les deux genres, et un
  /// message clair vaut mieux qu'une erreur brute renvoyée par le serveur.
  const problemesWeb = (definition) => {
    const out = [];
    if (!String(draft?.name || "").trim()) out.push("Donnez un nom à l'application.");
    if (!draft?.slug) out.push("L'identifiant technique est vide.");

    const url = definition.web?.url || "";
    if (!url) {
      out.push("Indiquez l'adresse du site que cette application doit ouvrir.");
    } else if (!/^https?:\/\//i.test(url)) {
      out.push("L'adresse doit commencer par http:// ou https://.");
    }
    return out;
  };

  const save = async ({ publish } = {}) => {
    if (busy) return;
    const definition = normaliser();
    // La validation dit *quoi* corriger et *où* : une app à trois
    // collections et vingt champs ne se relit pas à l'œil nu.
    const soucis =
      definition.genre === "web"
        ? problemesWeb(definition)
        : D.problemes({ ...draft, definition });
    if (soucis.length) {
      modal.alert({
        title: "Cette application ne peut pas être enregistrée",
        message: soucis.join("\n"),
        tone: "error",
      });
      return;
    }

    setBusy(true);
    try {
      const payload = {
        slug: draft.slug,
        name: draft.name.trim(),
        description: draft.description.trim(),
        icon: draft.icon,
        category: draft.category,
        definition,
        ...(publish === undefined ? {} : { published: publish }),
      };

      if (editingSlug) {
        await api.updateApp(editingSlug, payload);
        flash(
          publish === true
            ? `« ${payload.name} » est publiée dans la Boutique`
            : publish === false
              ? `« ${payload.name} » est retirée de la Boutique`
              : "Application enregistrée",
        );
      } else {
        const created = await api.createApp({ ...payload, published: publish ?? false });
        setEditingSlug(created.slug);
        flash(
          publish
            ? `« ${payload.name} » est créée et publiée`
            : `« ${payload.name} » est créée en brouillon`,
        );
      }

      setDraft((d) => ({ ...d, published: publish ?? d.published }));
      await load();
      // Une app dépubliée doit disparaître du bureau si elle était installée.
      await syncInstalledModules();
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const supprimer = async () => {
    if (!editingSlug) return;
    const ok = await modal.confirm({
      title: "Supprimer l'application",
      message: `Supprimer « ${draft.name} » ?`,
      detail: "Les données déjà saisies sont conservées.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteApp(editingSlug);
      setEditingSlug(null);
      setDraft(null);
      await load();
      await syncInstalledModules();
      flash("Application supprimée");
      goToSection("mes-apps");
    } catch (err) {
      flash(err.message);
    }
  };

  const installer = async () => {
    try {
      await api.installApp(draft.slug);
      await syncInstalledModules();
      flash(`« ${draft.name} » est installée — son icône est sur le bureau`);
    } catch (err) {
      flash(err.message);
    }
  };

  // Une app « site » n'a pas de collections : le tableau est vide, pas absent.
  const nbChamps = draft
    ? (draft.definition.collections || []).reduce((n, c) => n + c.fields.length, 0)
    : 0;

  const genre = genreDe(draft);
  const sectionsVisibles = SECTIONS.filter((s) => !s.genres || s.genres.includes(genre));
  const definitionCourante = draft ? normaliser() : null;
  const problemesCourants = draft
    ? definitionCourante.genre === "web"
      ? problemesWeb(definitionCourante)
      : D.problemes({ ...draft, definition: definitionCourante })
    : [];
  const etapesConfigurees = draft
    ? [
        Boolean(draft.name.trim() && draft.slug),
        genre === "web"
          ? Boolean(definitionCourante.web?.url)
          : Boolean(definitionCourante.collections.length && nbChamps),
        problemesCourants.length === 0,
      ].filter(Boolean).length
    : 0;

  const etatSection = (id) => {
    if (!draft || id === "mes-apps") return "";
    if (id === "identite") return draft.name.trim() && draft.slug ? "ok" : "todo";
    if (id === "adresse") {
      return /^https?:\/\//i.test(definitionCourante.web?.url || "") ? "ok" : "todo";
    }
    if (id === "donnees") return nbChamps > 0 ? "ok" : "todo";
    if (id === "automatisations") return automatisations().length ? "ok" : "optionnel";
    if (id === "tableau")
      return (draft.definition.pages || []).length ||
        (draft.definition.accueil || []).length
        ? "ok"
        : "optionnel";
    if (id === "apercu") return "optionnel";
    if (id === "publication") return problemesCourants.length ? "alerte" : "ok";
    return "";
  };

  const indexSection = sectionsVisibles.findIndex((s) => s.id === section);
  const sectionPrecedente = sectionsVisibles[indexSection - 1];
  const sectionSuivante = sectionsVisibles[indexSection + 1];
  const appsPubliees = apps.filter((app) => app.published).length;
  const reglesActives = apps.reduce(
    (total, app) =>
      total +
      (app.definition?.automatisations || []).filter((regle) => regle.active !== false)
        .length,
    0,
  );

  return (
    <ModuleWindow manifest={manifest} className="stdApp">
      {session.status !== "authenticated" ? (
        <div className="stdLocked">Connectez-vous pour utiliser le Studio.</div>
      ) : (
        <div className="stdShell">
          <aside className="stdNav" aria-label="Étapes de création">
            <div className="stdNavBrand">
              <span className="stdNavLogo">
                <Icon fafa="faWandMagicSparkles" width={15} />
              </span>
              <span>
                <strong>Studio</strong>
                <small>Créateur no-code</small>
              </span>
            </div>
            <div className="stdNavSteps">
              {sectionsVisibles.map((s, index) => (
                <React.Fragment key={s.id}>
                  {index === 0 || sectionsVisibles[index - 1].phase !== s.phase ? (
                    <div className="stdNavPhase">{s.phase}</div>
                  ) : null}
                  <button
                    type="button"
                    className="stdNavItem"
                    data-active={section === s.id}
                    data-state={etatSection(s.id)}
                    aria-current={section === s.id ? "step" : undefined}
                    onClick={() => goToSection(s.id)}
                  >
                    <Icon fafa={s.icon} width={13} />
                    <span>{s.label}</span>
                    {etatSection(s.id) === "ok" ? (
                      <Icon className="stdNavEtat" fafa="faCircleCheck" width={10} />
                    ) : etatSection(s.id) === "alerte" ? (
                      <span className="stdNavAlerte">{problemesCourants.length}</span>
                    ) : null}
                  </button>
                </React.Fragment>
              ))}
            </div>
            <div className="stdNavFooter">
              <Icon fafa="faCircleCheck" width={12} />
              <span>
                Moteur sécurisé
                <small>Schéma v{D.SCHEMA_VERSION}</small>
              </span>
            </div>
          </aside>

          <div className="stdMain cosScroll" ref={mainRef}>
            {draft ? (
              <header className="stdContext">
                <div className="stdContextApp">
                  <Icon src={draft.icon} width={30} />
                  <div>
                    <strong>{draft.name || "Application sans nom"}</strong>
                    <span>
                      {editingSlug ? "Modification" : "Nouvelle application"} · Schéma v
                      {draft.definition.schemaVersion || 1}
                    </span>
                  </div>
                </div>
                <div
                  className="stdProgress"
                  aria-label={`${etapesConfigurees} étapes sur 3 prêtes`}
                >
                  <span>{etapesConfigurees}/3 prêtes</span>
                  <div>
                    {[1, 2, 3].map((numero) => (
                      <i key={numero} data-done={numero <= etapesConfigurees} />
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className="stdBtnGhost"
                  onClick={() => save()}
                  disabled={busy}
                >
                  {busy ? "Enregistrement…" : "Enregistrer"}
                </button>
              </header>
            ) : null}
            {/* ---- Mes applications ---- */}
            <section className="stdSection" data-hidden={section !== "mes-apps"}>
              <div className="stdStudioHero">
                <div className="stdStudioHeroCopy">
                  <span className="stdEyebrow">COMPANYOS APP STUDIO</span>
                  <h1>Transformez vos processus en applications.</h1>
                  <p>
                    Données, interfaces et automatisations réunies dans un seul espace
                    no-code.
                  </p>
                  <button type="button" className="stdHeroCta" onClick={openNew}>
                    <Icon fafa="faPlus" width={11} />
                    Créer une application
                  </button>
                </div>
                <div className="stdStudioStats" aria-label="Résumé du Studio">
                  <div>
                    <strong>{apps.length}</strong>
                    <span>Applications</span>
                  </div>
                  <div>
                    <strong>{appsPubliees}</strong>
                    <span>En production</span>
                  </div>
                  <div>
                    <strong>{reglesActives}</strong>
                    <span>Règles actives</span>
                  </div>
                </div>
              </div>
              <div className="stdSectionHead">
                <div>
                  <h2>Vos applications</h2>
                  <p className="stdHint">
                    Applications créées par {session.tenant?.name}
                  </p>
                </div>
                <button type="button" className="stdBtnGhost" onClick={openNew}>
                  Nouvelle application
                </button>
              </div>

              {apps.length === 0 ? (
                <div className="stdEmptyBox">
                  Aucune application pour l'instant. « Nouvelle application » vous guide
                  en trois étapes : identité, données, publication.
                </div>
              ) : (
                <div className="stdList">
                  {apps.map((a) => (
                    <div
                      key={a.slug}
                      className="stdRow"
                      data-active={a.slug === editingSlug}
                      role="button"
                      tabIndex={0}
                      onClick={() => openApp(a)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") openApp(a);
                      }}
                    >
                      <Icon src={a.icon} width={24} />
                      <div className="stdRowInfo">
                        <div className="stdRowName">{a.name}</div>
                        <div className="stdRowMeta">
                          {a.category} · {(a.definition?.collections || []).length}{" "}
                          collection
                          {(a.definition?.collections || []).length > 1 ? "s" : ""}
                        </div>
                      </div>
                      <div className="stdTag" data-tone={a.published ? "ok" : "idle"}>
                        {a.published ? "Publiée" : "Brouillon"}
                      </div>
                      <span
                        className="stdRowDupliquer"
                        role="button"
                        tabIndex={0}
                        title="Dupliquer cette application"
                        onClick={(event) => {
                          event.stopPropagation();
                          dupliquerApp(a);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.stopPropagation();
                            dupliquerApp(a);
                          }
                        }}
                      >
                        <Icon fafa="faCopy" width={11} />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ---- Identité ---- */}
            <section className="stdSection" data-hidden={section !== "identite"}>
              <h2>
                <span className="stdNum">2.</span> Identité
              </h2>
              <p className="stdHint">Nom, icône et catégorie dans la Boutique</p>

              {!draft ? (
                <div className="stdEmptyBox">
                  Ouvrez une application, ou créez-en une.
                </div>
              ) : (
                <>
                  <div className="stdGenres">
                    {GENRES.map((g) => (
                      <button
                        type="button"
                        key={g.id}
                        className="stdGenre"
                        data-active={genre === g.id}
                        aria-pressed={genre === g.id}
                        onClick={() => choisirGenre(g.id)}
                      >
                        <strong>{g.titre}</strong>
                        <span>{g.texte}</span>
                      </button>
                    ))}
                  </div>

                  <div className="stdGrid">
                    <label className="stdField">
                      <span className="stdLabel">Nom de l'application</span>
                      <input
                        type="text"
                        value={draft.name}
                        placeholder="Suivi des livraisons"
                        onChange={setName}
                      />
                    </label>
                    <label className="stdField">
                      <span className="stdLabel">
                        Identifiant technique {editingSlug ? "(figé)" : "(auto)"}
                      </span>
                      <input type="text" value={draft.slug} disabled />
                    </label>
                    <label className="stdField">
                      <span className="stdLabel">Catégorie</span>
                      <select value={draft.category} onChange={setField("category")}>
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="stdField stdFull">
                      <span className="stdLabel">Description</span>
                      <input
                        type="text"
                        value={draft.description}
                        placeholder="Ce que fait l'application, en une phrase"
                        onChange={setField("description")}
                      />
                    </label>
                  </div>

                  <div className="stdField">
                    <span className="stdLabel">Icône</span>
                    <div className="stdIcons">
                      {ICONES.map((ic) => (
                        <button
                          type="button"
                          key={ic}
                          className="stdIcon"
                          aria-label={`Choisir l'icône ${ic}`}
                          aria-pressed={draft.icon === ic}
                          data-active={draft.icon === ic}
                          onClick={() => setDraft((d) => ({ ...d, icon: ic }))}
                        >
                          <Icon src={ic} width={26} />
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </section>

            {/* ---- Adresse (applications « site web ») ---- */}
            <section className="stdSection" data-hidden={section !== "adresse"}>
              <h2>
                <span className="stdNum">3.</span> Adresse du site
              </h2>
              <p className="stdHint">
                L'adresse que l'application ouvrira. Essayez-la : certains sites refusent
                d'être affichés dans une fenêtre, et il vaut mieux le savoir maintenant
                qu'après publication.
              </p>

              {!draft ? (
                <div className="stdEmptyBox">
                  Ouvrez une application, ou créez-en une.
                </div>
              ) : (
                <>
                  <div className="stdGrid">
                    <label className="stdField stdFull">
                      <span className="stdLabel">Adresse (https://…)</span>
                      <input
                        type="url"
                        value={draft.definition.web?.url || ""}
                        placeholder="https://vscode.dev/"
                        onChange={(e) => {
                          setWeb("url")(e.target.value);
                          setEssai(null);
                        }}
                      />
                    </label>
                  </div>

                  <div className="stdActionsLigne">
                    <button
                      type="button"
                      className="stdBtn"
                      disabled={
                        essaiEnCours ||
                        !/^https?:\/\//i.test(draft.definition.web?.url || "")
                      }
                      onClick={essayerAdresse}
                    >
                      {essaiEnCours ? "Essai en cours…" : "Essayer l'adresse"}
                    </button>
                    <span className="stdHint">
                      {draft.definition.web?.ouverture === "fenetre"
                        ? "Ce site s'ouvrira dans un onglet du navigateur."
                        : "Ce site s'affichera dans la fenêtre de l'application."}
                    </span>
                  </div>

                  {essai && (
                    <div className="stdEssai" data-etat={essai.etat}>
                      <strong>{essai.titre}</strong>
                      <p>{essai.texte}</p>
                    </div>
                  )}
                </>
              )}
            </section>

            {/* ---- Données ---- */}
            <section className="stdSection" data-hidden={section !== "donnees"}>
              <div className="stdSectionHead">
                <div>
                  <h2>
                    <span className="stdNum">3.</span> Données
                  </h2>
                  <p className="stdHint">
                    Une collection devient un onglet ; ses champs deviennent le formulaire
                    et les colonnes de la liste
                  </p>
                </div>
                {draft ? (
                  <button type="button" className="stdBtnGhost" onClick={addCollection}>
                    Ajouter une collection
                  </button>
                ) : null}
              </div>

              {!draft ? (
                <div className="stdEmptyBox">Aucune application ouverte.</div>
              ) : (
                draft.definition.collections.map((c, ci) => (
                  <div key={ci} className="stdCollection">
                    <div className="stdCollHead">
                      <input
                        className="stdCollName"
                        type="text"
                        value={c.label}
                        placeholder="Nom de la collection"
                        onChange={(e) => {
                          const v = e.target.value;
                          setCollection(ci, { label: v });
                        }}
                      />
                      {draft.definition.collections.length > 1 ? (
                        <div
                          className="stdDel handcr"
                          onClick={() => removeCollection(ci)}
                        >
                          ✕
                        </div>
                      ) : null}
                    </div>

                    {/* Comment cette collection s'affiche. Le tableau reste
                        le défaut ; le kanban demande un champ à choix, sur
                        lequel grouper les fiches en colonnes. */}
                    <div className="stdVue">
                      <span>Affichage</span>
                      <select
                        value={c.vue?.mode || "liste"}
                        onChange={(e) => {
                          const mode = e.target.value;
                          setCollection(ci, {
                            vue:
                              mode === "liste" ? undefined : { ...(c.vue || {}), mode },
                          });
                        }}
                      >
                        <option value="liste">Tableau</option>
                        <option value="cartes">Cartes</option>
                        <option value="kanban">Kanban (colonnes)</option>
                      </select>
                      {c.vue?.mode === "kanban" ? (
                        <select
                          value={c.vue?.groupePar || ""}
                          onChange={(e) =>
                            setCollection(ci, {
                              vue: { ...c.vue, groupePar: e.target.value },
                            })
                          }
                        >
                          <option value="">grouper par…</option>
                          {c.fields
                            .filter((f) => f.type === "choix")
                            .map((f) => (
                              <option
                                key={f.key || f.label}
                                value={D.slugify(f.key || f.label)}
                              >
                                {f.label}
                              </option>
                            ))}
                        </select>
                      ) : null}
                      {c.vue?.mode === "kanban" &&
                      !c.fields.some((f) => f.type === "choix") ? (
                        <em className="stdVueAstuce">
                          Ajoutez d'abord un champ « Liste de choix » : ses valeurs feront
                          les colonnes.
                        </em>
                      ) : null}
                    </div>

                    <div className="stdChamps">
                      <div className="stdChampHead">
                        <div>Libellé du champ</div>
                        <div>Type</div>
                        <div>Options / obligatoire</div>
                        <div />
                      </div>
                      {c.fields.map((f, fi) => (
                        <div key={fi} className="stdChampRow">
                          <input
                            type="text"
                            value={f.label}
                            placeholder="Ex. Nom du client"
                            onChange={(e) => {
                              const v = e.target.value;
                              setChamp(ci, fi, { label: v });
                            }}
                          />
                          <select
                            value={f.type}
                            onChange={(e) => {
                              const v = e.target.value;
                              setChamp(ci, fi, { type: v });
                            }}
                          >
                            {TYPES_CHAMP.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                          {f.type === "choix" ? (
                            <input
                              type="text"
                              value={(f.options || []).join(", ")}
                              placeholder="Choix séparés par des virgules"
                              onChange={(e) => {
                                const v = e.target.value.split(",");
                                setChamp(ci, fi, { options: v });
                              }}
                            />
                          ) : f.type === "relation" ? (
                            // Vers quelle collection ce champ pointe. On ne
                            // propose pas la collection courante : un champ
                            // qui se désigne lui-même n'a pas de sens ici.
                            <select
                              value={f.cible || ""}
                              onChange={(e) =>
                                setChamp(ci, fi, { cible: e.target.value })
                              }
                            >
                              <option value="">— vers quelle liste ? —</option>
                              {draft.definition.collections
                                .filter((autre, i) => i !== ci)
                                .map((autre) => (
                                  <option
                                    key={autre.key}
                                    value={D.slugify(autre.key || autre.label)}
                                  >
                                    {autre.label}
                                  </option>
                                ))}
                            </select>
                          ) : f.type === "calcul" ? (
                            <input
                              type="text"
                              value={f.formule || ""}
                              placeholder="Ex. heures * taux"
                              onChange={(e) =>
                                setChamp(ci, fi, { formule: e.target.value })
                              }
                            />
                          ) : (
                            <label className="stdCheck handcr">
                              <input
                                type="checkbox"
                                checked={!!f.required}
                                onChange={(e) => {
                                  const v = e.target.checked;
                                  setChamp(ci, fi, { required: v });
                                }}
                              />
                              <span>Obligatoire</span>
                            </label>
                          )}
                          <div
                            className="stdDel handcr"
                            onClick={() => removeChamp(ci, fi)}
                          >
                            ✕
                          </div>
                          {/* La mise en page de la fiche : demi ou pleine
                              largeur, et un nom de section pour regrouper.
                              Purement visuel — la donnée ne bouge pas. */}
                          <div className="stdChampMEP">
                            <select
                              value={f.largeur || "demi"}
                              onChange={(e) =>
                                setChamp(ci, fi, { largeur: e.target.value })
                              }
                              title="Largeur du champ dans la fiche"
                            >
                              <option value="demi">Demi-largeur</option>
                              <option value="plein">Pleine largeur</option>
                            </select>
                            <input
                              type="text"
                              value={f.section || ""}
                              placeholder="Section (ex. Coordonnées)"
                              onChange={(e) =>
                                setChamp(ci, fi, { section: e.target.value })
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      className="stdBtnGhost"
                      onClick={() => addChamp(ci)}
                    >
                      Ajouter un champ
                    </button>
                  </div>
                ))
              )}
            </section>

            {/* ---- Automatisations no-code ---- */}
            <section className="stdSection" data-hidden={section !== "automatisations"}>
              <div className="stdSectionHead">
                <div>
                  <h2>
                    <span className="stdNum">4.</span> Automatisations
                  </h2>
                  <p className="stdHint">
                    Déclencheur → conditions → actions. La logique s'exécute lorsque vos
                    collègues enregistrent une fiche, sans script ni formule cachée.
                  </p>
                </div>
                <button type="button" className="stdBtnGhost" onClick={addAutomatisation}>
                  <Icon fafa="faBolt" width={10} />
                  Nouvelle règle
                </button>
              </div>
              {draft ? (
                <AutomatisationsBuilder
                  regles={automatisations()}
                  collections={D.normaliser(draft.definition).collections}
                  onSet={setAutomatisation}
                  onRemove={removeAutomatisation}
                />
              ) : null}
            </section>

            {/* ---- Tableau de bord ---- */}
            <section className="stdSection" data-hidden={section !== "tableau"}>
              {draft ? (
                <InterfaceBuilder
                  pages={pages()}
                  collections={D.normaliser(draft.definition).collections}
                  onChange={setPages}
                />
              ) : null}
            </section>

            {/* ---- Aperçu ---- */}
            <section className="stdSection" data-hidden={section !== "apercu"}>
              <h2>
                <span className="stdNum">5.</span> Aperçu
              </h2>
              <p className="stdHint">
                Ce que verront vos collègues, avant de publier quoi que ce soit
              </p>
              {draft ? <Apercu definition={D.normaliser(draft.definition)} /> : null}
            </section>

            {/* ---- Publication ---- */}
            <section className="stdSection" data-hidden={section !== "publication"}>
              <h2>
                <span className="stdNum">6.</span> Publication
              </h2>
              <p className="stdHint">
                Publier place l'application dans la Boutique de votre espace de travail —
                elle n'est jamais visible par les autres clients
              </p>

              {!draft ? (
                <div className="stdEmptyBox">Aucune application ouverte.</div>
              ) : (
                <>
                  <div className="stdRecap">
                    <Icon src={draft.icon} width={40} />
                    <div className="stdRecapInfo">
                      <div className="stdRecapName">{draft.name || "Sans nom"}</div>
                      <div className="stdRecapMeta">
                        {draft.category} · {draft.definition.collections.length}{" "}
                        collection
                        {draft.definition.collections.length > 1 ? "s" : ""} · {nbChamps}{" "}
                        champ{nbChamps > 1 ? "s" : ""}
                      </div>
                    </div>
                    <div className="stdTag" data-tone={draft.published ? "ok" : "idle"}>
                      {editingSlug
                        ? draft.published
                          ? "Publiée"
                          : "Brouillon"
                        : "Non créée"}
                    </div>
                  </div>

                  <div
                    className="stdValidation"
                    data-ready={problemesCourants.length === 0}
                  >
                    <div className="stdValidationTitre">
                      <Icon
                        fafa={
                          problemesCourants.length
                            ? "faTriangleExclamation"
                            : "faCircleCheck"
                        }
                        width={13}
                      />
                      <strong>
                        {problemesCourants.length
                          ? `${problemesCourants.length} point${problemesCourants.length > 1 ? "s" : ""} à corriger`
                          : "Application prête à publier"}
                      </strong>
                    </div>
                    {problemesCourants.length ? (
                      <ul>
                        {problemesCourants.map((probleme) => (
                          <li key={probleme}>
                            <button
                              type="button"
                              onClick={() => goToSection(D.sectionPourProbleme(probleme))}
                            >
                              <span>{probleme}</span>
                              <Icon fafa="faArrowRight" width={9} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>Le nom, les données et les références ont été vérifiés.</p>
                    )}
                  </div>

                  <div className="stdActions">
                    <button
                      type="button"
                      className="stdPrimary handcr"
                      disabled={busy || problemesCourants.length > 0}
                      onClick={() => save({ publish: true })}
                    >
                      <Icon fafa="faRocket" width={11} />
                      <span>{busy ? "…" : "Publier dans la Boutique"}</span>
                    </button>
                    <button
                      type="button"
                      className="stdBtnGhost handcr"
                      disabled={busy}
                      onClick={() => save()}
                    >
                      Enregistrer le brouillon
                    </button>
                    {editingSlug && draft.published ? (
                      <div
                        className="stdBtnGhost handcr"
                        data-off={busy}
                        onClick={() => save({ publish: false })}
                      >
                        Dépublier
                      </div>
                    ) : null}
                    {editingSlug && draft.published ? (
                      <div className="stdBtnGhost handcr" onClick={installer}>
                        Installer maintenant
                      </div>
                    ) : null}
                    {editingSlug ? (
                      <div className="stdBtnGhost stdDanger handcr" onClick={supprimer}>
                        Supprimer
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </section>

            {draft && section !== "mes-apps" ? (
              <nav className="stdParcours" aria-label="Navigation dans la création">
                <button
                  type="button"
                  className="stdBtnGhost"
                  disabled={!sectionPrecedente || sectionPrecedente.id === "mes-apps"}
                  onClick={() => sectionPrecedente && goToSection(sectionPrecedente.id)}
                >
                  <Icon fafa="faArrowLeft" width={10} />
                  Précédent
                </button>
                <span>
                  Étape {indexSection} sur {sectionsVisibles.length - 1}
                </span>
                {sectionSuivante ? (
                  <button
                    type="button"
                    className="stdPrimary"
                    onClick={() => goToSection(sectionSuivante.id)}
                  >
                    Continuer
                    <Icon fafa="faArrowRight" width={10} />
                  </button>
                ) : null}
              </nav>
            ) : null}

            {notice ? <div className="stdNotice">{notice}</div> : null}
          </div>
        </div>
      )}
    </ModuleWindow>
  );
}

// ---------------------------------------------------------------------------
// Automatisations
// ---------------------------------------------------------------------------

const OPERATEURS = [
  ["egal", "est égal à"],
  ["different", "est différent de"],
  ["contient", "contient"],
  ["vide", "est vide"],
  ["non-vide", "n'est pas vide"],
  ["superieur", "est supérieur à"],
];

function AutomatisationsBuilder({ regles, collections, onSet, onRemove }) {
  if (!regles.length) {
    return (
      <div className="stdEmptyBox">
        Aucune automatisation. Exemple : « quand une opportunité est créée et que son
        montant dépasse 1 000 000, définir la priorité sur Haute ».
      </div>
    );
  }

  return (
    <div className="stdRegles">
      {regles.map((regle, index) => {
        const collection =
          collections.find((candidate) => candidate.key === regle.collection) ||
          collections[0];
        const champs = (collection?.fields || []).filter(
          (champ) => champ.type !== "calcul",
        );
        const setListe = (cle, liste) => onSet(index, { [cle]: liste });
        return (
          <article
            className="stdRegle"
            key={regle.id || index}
            data-active={regle.active}
          >
            <header>
              <label className="stdSwitchRegle">
                <input
                  type="checkbox"
                  checked={regle.active !== false}
                  onChange={(event) => onSet(index, { active: event.target.checked })}
                />
                <span>{regle.active !== false ? "Active" : "Inactive"}</span>
              </label>
              <input
                className="stdRegleNom"
                value={regle.nom}
                onChange={(event) => onSet(index, { nom: event.target.value })}
                aria-label="Nom de la règle"
              />
              <button type="button" className="stdDel" onClick={() => onRemove(index)}>
                <Icon fafa="faTrashCan" width={10} />
              </button>
            </header>

            <div className="stdReglePhrase">
              <b>Quand</b>
              <select
                value={regle.declencheur}
                onChange={(event) => onSet(index, { declencheur: event.target.value })}
              >
                <option value="creation">une fiche est créée</option>
                <option value="modification">une fiche est modifiée</option>
                <option value="toujours">une fiche est enregistrée</option>
              </select>
              <b>dans</b>
              <select
                value={regle.collection}
                onChange={(event) =>
                  onSet(index, {
                    collection: event.target.value,
                    conditions: [],
                    actions: [],
                  })
                }
              >
                {collections.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="stdRegleBloc">
              <div className="stdRegleTitre">
                <span>SI</span> Toutes les conditions
              </div>
              {(regle.conditions || []).map((condition, ci) => (
                <div className="stdRegleLigne" key={ci}>
                  <select
                    value={condition.champ}
                    onChange={(event) =>
                      setListe(
                        "conditions",
                        regle.conditions.map((item, i) =>
                          i === ci ? { ...item, champ: event.target.value } : item,
                        ),
                      )
                    }
                  >
                    <option value="">Choisir un champ</option>
                    {champs.map((champ) => (
                      <option key={champ.key} value={champ.key}>
                        {champ.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={condition.operateur}
                    onChange={(event) =>
                      setListe(
                        "conditions",
                        regle.conditions.map((item, i) =>
                          i === ci ? { ...item, operateur: event.target.value } : item,
                        ),
                      )
                    }
                  >
                    {OPERATEURS.map(([valeur, label]) => (
                      <option key={valeur} value={valeur}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {!["vide", "non-vide"].includes(condition.operateur) ? (
                    <input
                      value={condition.valeur ?? ""}
                      placeholder="Valeur"
                      onChange={(event) =>
                        setListe(
                          "conditions",
                          regle.conditions.map((item, i) =>
                            i === ci ? { ...item, valeur: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    className="stdDel"
                    onClick={() =>
                      setListe(
                        "conditions",
                        regle.conditions.filter((_, i) => i !== ci),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="stdLien"
                onClick={() =>
                  setListe("conditions", [
                    ...(regle.conditions || []),
                    { champ: champs[0]?.key || "", operateur: "egal", valeur: "" },
                  ])
                }
              >
                + Ajouter une condition
              </button>
            </div>

            <div className="stdRegleBloc">
              <div className="stdRegleTitre">
                <span>ALORS</span> Actions à exécuter
              </div>
              {(regle.actions || []).map((action, ai) => (
                <div className="stdRegleLigne stdRegleAction" key={ai}>
                  <select
                    value={action.type}
                    onChange={(event) =>
                      setListe(
                        "actions",
                        regle.actions.map((item, i) =>
                          i === ai
                            ? event.target.value === "notifier"
                              ? { type: "notifier", titre: "Information", message: "" }
                              : {
                                  type: "definir",
                                  champ: champs[0]?.key || "",
                                  valeur: "",
                                }
                            : item,
                        ),
                      )
                    }
                  >
                    <option value="definir">Définir un champ</option>
                    <option value="notifier">Envoyer une notification</option>
                  </select>
                  {action.type === "notifier" ? (
                    <>
                      <input
                        value={action.titre || ""}
                        placeholder="Titre de la notification"
                        onChange={(event) =>
                          setListe(
                            "actions",
                            regle.actions.map((item, i) =>
                              i === ai ? { ...item, titre: event.target.value } : item,
                            ),
                          )
                        }
                      />
                      <input
                        value={action.message || ""}
                        placeholder="Message"
                        onChange={(event) =>
                          setListe(
                            "actions",
                            regle.actions.map((item, i) =>
                              i === ai ? { ...item, message: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    </>
                  ) : (
                    <>
                      <select
                        value={action.champ}
                        onChange={(event) =>
                          setListe(
                            "actions",
                            regle.actions.map((item, i) =>
                              i === ai ? { ...item, champ: event.target.value } : item,
                            ),
                          )
                        }
                      >
                        <option value="">Choisir un champ</option>
                        {champs.map((champ) => (
                          <option key={champ.key} value={champ.key}>
                            {champ.label}
                          </option>
                        ))}
                      </select>
                      <input
                        value={action.valeur ?? ""}
                        placeholder="Nouvelle valeur"
                        onChange={(event) =>
                          setListe(
                            "actions",
                            regle.actions.map((item, i) =>
                              i === ai ? { ...item, valeur: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    </>
                  )}
                  <button
                    type="button"
                    className="stdDel"
                    onClick={() =>
                      setListe(
                        "actions",
                        regle.actions.filter((_, i) => i !== ai),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="stdLien"
                onClick={() =>
                  setListe("actions", [
                    ...(regle.actions || []),
                    { type: "definir", champ: champs[0]?.key || "", valeur: "" },
                  ])
                }
              >
                + Ajouter une action
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aperçu
// ---------------------------------------------------------------------------

/// Ce que verront les utilisateurs de l'application, sans rien publier.
///
/// C'était le manque le plus coûteux du Studio : on décrivait des champs à
/// l'aveugle, on publiait, on installait, et *alors* on découvrait la
/// forme du résultat. Chaque correction demandait le tour complet.
///
/// L'aperçu passe par les mêmes fonctions que le moteur d'exécution —
/// `TYPES` pour la saisie, `affiche` pour le rendu, `valeursCompletes`
/// pour les calculs. Un aperçu qui aurait son propre rendu finirait par
/// mentir, et un aperçu qui ment est pire que pas d'aperçu.
function Apercu({ definition }) {
  const collections = definition?.collections || [];
  const [cle, setCle] = useState(collections[0]?.key || "");
  const [fiche, setFiche] = useState({});

  const collection = collections.find((c) => c.key === cle) || collections[0];
  if (!collection) {
    return <div className="stdEmptyBox">Aucune collection à prévisualiser.</div>;
  }

  const valeurs = D.valeursCompletes(collection, fiche);
  const colonnes = collection.fields.slice(0, 3);

  const majChamp = (champ) => (e) => {
    const v =
      champ.type === "booleen"
        ? e.target.checked
        : ["nombre", "montant"].includes(champ.type)
          ? e.target.value === ""
            ? ""
            : Number(e.target.value)
          : e.target.value;
    setFiche((f) => ({ ...f, [champ.key]: v }));
  };

  return (
    <div className="stdApercu">
      {collections.length > 1 ? (
        <div className="stdApercuOnglets">
          {collections.map((c) => (
            <div
              key={c.key}
              className="stdApercuOnglet handcr"
              data-active={c.key === collection.key}
              onClick={() => {
                setCle(c.key);
                setFiche({});
              }}
            >
              {c.label}
            </div>
          ))}
        </div>
      ) : null}

      <div className="stdApercuCorps">
        <div className="stdApercuBloc">
          <div className="stdApercuTitre">La liste</div>
          <div className="stdApercuTable">
            <div
              className="stdApercuTHead"
              style={{ gridTemplateColumns: `repeat(${colonnes.length}, 1fr)` }}
            >
              {colonnes.map((f) => (
                <div key={f.key}>{f.label}</div>
              ))}
            </div>
            <div
              className="stdApercuTRow"
              style={{ gridTemplateColumns: `repeat(${colonnes.length}, 1fr)` }}
            >
              {colonnes.map((f) => (
                <div key={f.key} data-aligne={D.TYPES[f.type]?.aligne ? "true" : "false"}>
                  {f.type === "relation"
                    ? "— fiche liée —"
                    : D.affiche(f, valeurs[f.key])}
                </div>
              ))}
            </div>
          </div>
          <p className="stdHint">
            Les trois premiers champs font les colonnes. Réordonnez-les dans l'onglet
            Données pour changer ce que la liste montre.
          </p>
        </div>

        <div className="stdApercuBloc">
          <div className="stdApercuTitre">La fiche</div>
          <div className="stdApercuGrid">
            {collection.fields.map((champ) => (
              <label
                key={champ.key}
                className="stdApercuChamp"
                data-large={champ.type === "zone"}
              >
                <span>
                  {champ.label}
                  {champ.required ? " *" : ""}
                </span>
                {champ.type === "zone" ? (
                  <textarea
                    rows={2}
                    value={fiche[champ.key] ?? ""}
                    onChange={majChamp(champ)}
                  />
                ) : champ.type === "choix" ? (
                  <select value={fiche[champ.key] ?? ""} onChange={majChamp(champ)}>
                    <option value="">—</option>
                    {(champ.options || []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : champ.type === "booleen" ? (
                  <input
                    type="checkbox"
                    checked={!!fiche[champ.key]}
                    onChange={majChamp(champ)}
                  />
                ) : champ.type === "relation" ? (
                  // Sans données réelles, on montre la forme du contrôle et
                  // vers quoi il pointe — c'est ce qui se vérifie ici.
                  <select disabled>
                    <option>
                      {collections.find((c) => c.key === champ.cible)?.label ||
                        "collection inconnue"}
                    </option>
                  </select>
                ) : champ.type === "calcul" ? (
                  <output className="stdApercuCalcul">
                    {D.affiche(champ, valeurs[champ.key])}
                  </output>
                ) : (
                  <input
                    type={D.TYPES[champ.type]?.saisie || "text"}
                    value={fiche[champ.key] ?? ""}
                    onChange={majChamp(champ)}
                  />
                )}
              </label>
            ))}
          </div>
          <p className="stdHint">
            Saisissez ici pour éprouver vos calculs : ils se recalculent comme dans
            l'application réelle. Rien n'est enregistré.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Builder visuel de l'interface
// ---------------------------------------------------------------------------

const BLOCS_INTERFACE = {
  titre: { label: "Titre", icon: "faHeading" },
  texte: { label: "Texte", icon: "faAlignLeft" },
  bouton: { label: "Bouton", icon: "faArrowPointer" },
  compteur: { label: "Indicateur", icon: "faChartSimple" },
  tableau: { label: "Tableau", icon: "faTable" },
  formulaire: { label: "Formulaire", icon: "faRectangleList" },
  conteneur: { label: "Conteneur", icon: "faBorderAll" },
  section: { label: "Section", icon: "faColumns" },
  image: { label: "Image", icon: "faImage" },
  carte: { label: "Carte", icon: "faIdCard" },
  liste: { label: "Liste", icon: "faList" },
  graphique: { label: "Graphique", icon: "faChartColumn" },
  badge: { label: "Badge", icon: "faCertificate" },
  separateur: { label: "Séparateur", icon: "faMinus" },
};

const GROUPES_BLOCS = [
  { id: "structure", label: "Structure", types: ["section", "conteneur", "separateur"] },
  {
    id: "contenu",
    label: "Contenu",
    types: ["titre", "texte", "image", "badge", "bouton"],
  },
  {
    id: "donnees",
    label: "Données",
    types: ["compteur", "carte", "liste", "tableau", "graphique", "formulaire"],
  },
];

const MODELES_SECTIONS = [
  {
    id: "hero",
    label: "En-tête",
    icon: "faFlag",
    enfants: [
      ["titre", "Titre de la page"],
      ["texte", "Présentez cet espace à vos utilisateurs."],
      ["bouton", "Commencer"],
    ],
  },
  {
    id: "kpis",
    label: "Indicateurs",
    icon: "faChartSimple",
    enfants: [
      ["titre", "Vue d’ensemble"],
      ["compteur", "Total"],
      ["compteur", "En cours"],
      ["compteur", "Terminés"],
    ],
    grille: true,
  },
  {
    id: "donnees",
    label: "Données",
    icon: "faTable",
    enfants: [
      ["titre", "Dernières données"],
      ["tableau", "Enregistrements"],
    ],
  },
];

const idInterface = (prefixe) =>
  `${prefixe}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function nouveauBloc(type, collections) {
  return {
    id: idInterface("bloc"),
    type,
    label: BLOCS_INTERFACE[type]?.label || "Composant",
    collection: [
      "compteur",
      "tableau",
      "formulaire",
      "liste",
      "graphique",
      "carte",
    ].includes(type)
      ? collections[0]?.key || ""
      : "",
    ...(type === "image"
      ? { source: "https://images.unsplash.com/photo-1552664730-d307ca884978?w=1200" }
      : {}),
    style: {
      largeur: [
        "titre",
        "tableau",
        "liste",
        "graphique",
        "separateur",
        "section",
        "conteneur",
      ].includes(type)
        ? "100"
        : "50",
      padding: 16,
      alignement: "gauche",
      fond: "surface",
      direction: ["section", "conteneur"].includes(type) ? "ligne" : undefined,
      colonnes: ["section", "conteneur"].includes(type) ? 2 : undefined,
      gap: ["section", "conteneur"].includes(type) ? 12 : undefined,
    },
  };
}

function InterfaceBuilder({ pages, collections, onChange }) {
  const pagesCourantes = pages.length
    ? pages
    : [
        {
          id: "accueil",
          nom: "Accueil",
          composants: [
            { ...nouveauBloc("titre", collections), label: "Tableau de bord" },
            { ...nouveauBloc("compteur", collections), label: "Total" },
            { ...nouveauBloc("tableau", collections), label: "Dernières données" },
          ],
        },
      ];
  const [pageId, setPageId] = useState(pagesCourantes[0]?.id || "accueil");
  const [selectionId, setSelectionId] = useState(
    pagesCourantes[0]?.composants?.[0]?.id || "",
  );
  const [mode, setMode] = useState("desktop");
  const [apercuActif, setApercuActif] = useState(false);
  const [rechercheBlocs, setRechercheBlocs] = useState("");
  const [zoom, setZoom] = useState(100);
  const [panneauGauche, setPanneauGauche] = useState(true);
  const [inspecteurVisible, setInspecteurVisible] = useState(true);
  const historique = React.useRef([]);
  const futur = React.useRef([]);
  const [, rafraichirHistorique] = useState(0);
  const page = pagesCourantes.find((item) => item.id === pageId) || pagesCourantes[0];
  const composants = page?.composants || [];
  const selection = composants.find((item) => item.id === selectionId);
  const styleEdition = selection
    ? {
        ...selection.style,
        ...(mode !== "desktop" ? selection.responsive?.[mode] || {} : {}),
      }
    : {};

  const commit = (prochainesPages) => {
    historique.current = [...historique.current.slice(-49), pagesCourantes];
    futur.current = [];
    onChange(prochainesPages);
    rafraichirHistorique((version) => version + 1);
  };
  const annuler = () => {
    const precedent = historique.current.pop();
    if (!precedent) return;
    futur.current.push(pagesCourantes);
    onChange(precedent);
    rafraichirHistorique((version) => version + 1);
  };
  const retablir = () => {
    const suivant = futur.current.pop();
    if (!suivant) return;
    historique.current.push(pagesCourantes);
    onChange(suivant);
    rafraichirHistorique((version) => version + 1);
  };
  const setComposants = (liste) =>
    commit(
      pagesCourantes.map((item) =>
        item.id === page.id ? { ...item, composants: liste } : item,
      ),
    );
  const ajouterPage = () => {
    const id = idInterface("page");
    commit([
      ...pagesCourantes,
      { id, nom: `Page ${pagesCourantes.length + 1}`, composants: [] },
    ]);
    setPageId(id);
    setSelectionId("");
  };
  const modifierPage = (patch) =>
    commit(
      pagesCourantes.map((item) => (item.id === page.id ? { ...item, ...patch } : item)),
    );
  const dupliquerPage = () => {
    const id = idInterface("page");
    const nouveauxIds = Object.fromEntries(
      composants.map((item) => [item.id, idInterface("bloc")]),
    );
    const copie = {
      ...page,
      id,
      nom: `${page.nom} — copie`,
      composants: composants.map((item) => ({
        ...item,
        id: nouveauxIds[item.id],
        ...(item.parentId ? { parentId: nouveauxIds[item.parentId] } : {}),
      })),
    };
    commit([...pagesCourantes, copie]);
    setPageId(id);
    setSelectionId(copie.composants[0]?.id || "");
  };
  const supprimerPage = () => {
    if (pagesCourantes.length <= 1) return;
    const restantes = pagesCourantes.filter((item) => item.id !== page.id);
    commit(restantes);
    setPageId(restantes[0].id);
    setSelectionId(restantes[0].composants?.[0]?.id || "");
  };
  const ajouterBloc = (type, parentCible) => {
    const parentId =
      parentCible === null
        ? ""
        : parentCible ||
          (["section", "conteneur"].includes(selection?.type)
            ? selection.id
            : selection?.parentId || "");
    const bloc = {
      ...nouveauBloc(type, collections),
      ...(parentId ? { parentId } : {}),
    };
    setComposants([...composants, bloc]);
    setSelectionId(bloc.id);
  };
  const ajouterModeleSection = (modele) => {
    const section = {
      ...nouveauBloc("section", collections),
      label: modele.label,
      style: {
        ...nouveauBloc("section", collections).style,
        direction: modele.grille ? "grille" : "colonne",
        colonnes: modele.grille ? 3 : 2,
      },
    };
    const enfants = modele.enfants.map(([type, label]) => ({
      ...nouveauBloc(type, collections),
      label,
      parentId: section.id,
      ...(type === "titre"
        ? { style: { ...nouveauBloc(type, collections).style, largeur: "100" } }
        : {}),
    }));
    setComposants([...composants, section, ...enfants]);
    setSelectionId(section.id);
  };
  const modifierBloc = (patch) =>
    setComposants(
      composants.map((item) => (item.id === selectionId ? { ...item, ...patch } : item)),
    );
  const modifierStyle = (patch) => {
    if (mode === "desktop") {
      modifierBloc({ style: { ...selection.style, ...patch } });
      return;
    }
    modifierBloc({
      responsive: {
        ...selection.responsive,
        [mode]: { ...selection.responsive?.[mode], ...patch },
      },
    });
  };
  const supprimerBloc = () => {
    setComposants(
      composants
        .filter((item) => item.id !== selectionId)
        .map((item) =>
          item.parentId === selectionId
            ? { ...item, parentId: selection?.parentId }
            : item,
        ),
    );
    setSelectionId("");
  };
  const dupliquerBloc = () => {
    if (!selection) return;
    const index = composants.findIndex((item) => item.id === selectionId);
    const copie = {
      ...selection,
      id: idInterface("bloc"),
      label: `${selection.label} — copie`,
    };
    const liste = [...composants];
    liste.splice(index + 1, 0, copie);
    setComposants(liste);
    setSelectionId(copie.id);
  };
  const changerOrdre = (direction) => {
    const index = composants.findIndex((item) => item.id === selectionId);
    const cible = index + direction;
    if (index < 0 || cible < 0 || cible >= composants.length) return;
    const liste = [...composants];
    [liste[index], liste[cible]] = [liste[cible], liste[index]];
    setComposants(liste);
  };
  const deplacerBloc = (sourceId, cibleId) => {
    if (!sourceId || sourceId === cibleId) return;
    const source = composants.find((item) => item.id === sourceId);
    if (!source) return;
    const sansSource = composants.filter((item) => item.id !== sourceId);
    const cible = sansSource.findIndex((item) => item.id === cibleId);
    sansSource.splice(cible < 0 ? sansSource.length : cible, 0, source);
    setComposants(sansSource);
  };
  const imbriquerBloc = (sourceId, parentId) => {
    if (!sourceId || sourceId === parentId) return;
    const parent = composants.find((item) => item.id === parentId);
    if (!parent || !["section", "conteneur"].includes(parent.type)) return;
    let courant = parent;
    while (courant?.parentId) {
      if (courant.parentId === sourceId) return;
      courant = composants.find((item) => item.id === courant.parentId);
    }
    setComposants(
      composants.map((item) => (item.id === sourceId ? { ...item, parentId } : item)),
    );
  };
  const sortirBloc = (sourceId) => {
    if (!sourceId) return;
    setComposants(
      composants.map((item) =>
        item.id === sourceId ? { ...item, parentId: undefined } : item,
      ),
    );
  };
  const profondeurBloc = (bloc) => {
    let profondeur = 0;
    let courant = bloc;
    while (courant?.parentId && profondeur < 8) {
      profondeur += 1;
      courant = composants.find((item) => item.id === courant.parentId);
    }
    return profondeur;
  };
  const rechercheNormalisee = rechercheBlocs.trim().toLocaleLowerCase("fr");
  const cheminSelection = [];
  let elementChemin = selection;
  while (elementChemin && cheminSelection.length < 8) {
    cheminSelection.unshift(elementChemin);
    elementChemin = composants.find((item) => item.id === elementChemin.parentId);
  }

  return (
    <div className="stdBuilder">
      <header className="stdBuilderTop">
        <div>
          <span className="stdBuilderCrumb">INTERFACE</span>
          <strong>{page?.nom || "Nouvelle page"}</strong>
        </div>
        <div className="stdBuilderToolbar">
          <div className="stdBuilderHistory">
            <button
              type="button"
              disabled={!historique.current.length}
              onClick={annuler}
              title="Annuler"
            >
              <Icon fafa="faRotateLeft" width={11} />
            </button>
            <button
              type="button"
              disabled={!futur.current.length}
              onClick={retablir}
              title="Rétablir"
            >
              <Icon fafa="faRotateRight" width={11} />
            </button>
          </div>
          <div className="stdBuilderModes" aria-label="Taille de l'aperçu">
            {[
              ["desktop", "faDesktop"],
              ["tablet", "faTabletScreenButton"],
              ["mobile", "faMobileScreenButton"],
            ].map(([id, icon]) => (
              <button
                type="button"
                key={id}
                data-active={mode === id}
                onClick={() => setMode(id)}
                title={id}
              >
                <Icon fafa={icon} width={12} />
              </button>
            ))}
          </div>
          <div className="stdBuilderZoom" aria-label="Zoom du canvas">
            <button
              type="button"
              onClick={() => setZoom((valeur) => Math.max(50, valeur - 10))}
              title="Réduire le zoom"
            >
              −
            </button>
            <button type="button" onClick={() => setZoom(100)} title="Zoom à 100 %">
              {zoom}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((valeur) => Math.min(140, valeur + 10))}
              title="Augmenter le zoom"
            >
              +
            </button>
          </div>
        </div>
        <div className="stdBuilderTopActions">
          <button
            type="button"
            className="stdBuilderPanelToggle"
            data-active={panneauGauche}
            onClick={() => setPanneauGauche((visible) => !visible)}
            title={panneauGauche ? "Masquer la bibliothèque" : "Afficher la bibliothèque"}
          >
            <Icon fafa="faTableColumns" width={11} />
          </button>
          <button
            type="button"
            className="stdBuilderPanelToggle"
            data-active={inspecteurVisible}
            onClick={() => setInspecteurVisible((visible) => !visible)}
            title={inspecteurVisible ? "Masquer l’inspecteur" : "Afficher l’inspecteur"}
          >
            <Icon fafa="faSliders" width={11} />
          </button>
          <button
            type="button"
            className="stdBtnGhost"
            onClick={() => ajouterBloc("section", null)}
            data-preview-hidden={apercuActif}
          >
            <Icon fafa="faColumns" width={10} /> Nouvelle section
          </button>
          <button
            type="button"
            className="stdBtnGhost"
            data-active={apercuActif}
            onClick={() => {
              setApercuActif((actif) => !actif);
              setSelectionId("");
            }}
          >
            <Icon fafa={apercuActif ? "faPen" : "faPlay"} width={10} />
            {apercuActif ? "Modifier" : "Aperçu"}
          </button>
        </div>
      </header>

      <div
        className="stdBuilderBody"
        data-preview={apercuActif}
        data-left-open={panneauGauche}
        data-inspector-open={inspecteurVisible}
      >
        <aside className="stdBuilderLeft">
          <div className="stdBuilderPanelHead">
            <strong>Pages</strong>
            <button type="button" onClick={ajouterPage} title="Ajouter une page">
              +
            </button>
          </div>
          <div className="stdBuilderPages">
            {pagesCourantes.map((item) => (
              <button
                type="button"
                key={item.id}
                data-active={item.id === page?.id}
                onClick={() => {
                  setPageId(item.id);
                  setSelectionId(item.composants?.[0]?.id || "");
                }}
              >
                <Icon fafa="faFile" width={11} />
                <span>{item.nom}</span>
                <small>{item.composants?.length || 0}</small>
              </button>
            ))}
          </div>

          <div className="stdBuilderPalette">
          <div className="stdBuilderPanelHead stdBuilderComponentsHead">
            <strong>Composants</strong>
          </div>
          <label className="stdBuilderSearch">
            <Icon fafa="faMagnifyingGlass" width={10} />
            <input
              value={rechercheBlocs}
              placeholder="Rechercher…"
              onChange={(event) => setRechercheBlocs(event.target.value)}
            />
            {rechercheBlocs ? (
              <button type="button" onClick={() => setRechercheBlocs("")}>
                ×
              </button>
            ) : null}
          </label>
          {!rechercheNormalisee ? (
            <div className="stdSectionTemplates">
              <span>Sections prêtes</span>
              <div>
                {MODELES_SECTIONS.map((modele) => (
                  <button
                    type="button"
                    key={modele.id}
                    onClick={() => ajouterModeleSection(modele)}
                  >
                    <Icon fafa={modele.icon} width={11} />
                    <span>{modele.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="stdBuilderLibraryGroups">
            {GROUPES_BLOCS.map((groupe) => {
              const types = groupe.types.filter((type) =>
                BLOCS_INTERFACE[type].label
                  .toLocaleLowerCase("fr")
                  .includes(rechercheNormalisee),
              );
              if (!types.length) return null;
              return (
                <div className="stdBuilderLibraryGroup" key={groupe.id}>
                  <span>{groupe.label}</span>
                  <div className="stdBuilderLibrary">
                    {types.map((type) => {
                      const bloc = BLOCS_INTERFACE[type];
                      return (
                        <button
                          type="button"
                          key={type}
                          draggable
                          onDragStart={(event) =>
                            event.dataTransfer.setData("studio/type", type)
                          }
                          onClick={() => ajouterBloc(type)}
                          title={`Ajouter ${bloc.label}`}
                        >
                          <Icon fafa={bloc.icon} width={13} />
                          <span>{bloc.label}</span>
                          <small>+</small>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          </div>
          <div className="stdBuilderLayersPane">
          <div className="stdBuilderPanelHead stdBuilderLayersHead">
            <strong>Calques</strong>
            <small>{composants.length}</small>
          </div>
          <div className="stdBuilderLayers">
            {composants.map((bloc, index) => (
              <button
                type="button"
                key={bloc.id}
                data-active={bloc.id === selectionId}
                data-nested={Boolean(bloc.parentId)}
                style={{ "--layer-depth": profondeurBloc(bloc) }}
                onClick={() => setSelectionId(bloc.id)}
              >
                <Icon fafa={BLOCS_INTERFACE[bloc.type]?.icon} width={10} />
                <span>{bloc.label || BLOCS_INTERFACE[bloc.type]?.label}</span>
                <small>{index + 1}</small>
              </button>
            ))}
          </div>
          </div>
        </aside>

        <main className="stdBuilderStage">
          <div
            className="stdBuilderZoomSurface"
            style={{
              width: `${10000 / zoom}%`,
              transform: `scale(${zoom / 100})`,
            }}
          >
          <div
            className="stdBuilderCanvas"
            data-mode={mode}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              if (apercuActif) return;
              event.preventDefault();
              const type = event.dataTransfer.getData("studio/type");
              if (type) ajouterBloc(type, null);
              else sortirBloc(event.dataTransfer.getData("studio/bloc"));
            }}
          >
            <div className="stdCanvasBar">
              <span className="stdCanvasBreadcrumb">
                <b>{page?.nom}</b>
                {cheminSelection.map((item) => (
                  <React.Fragment key={item.id}>
                    <em>/</em>
                    <small>{item.label || BLOCS_INTERFACE[item.type]?.label}</small>
                  </React.Fragment>
                ))}
              </span>
              <i />
              <i />
              <i />
            </div>
            <div className="stdCanvasGrid">
              {composants.length ? (
                composants
                  .filter((bloc) => !bloc.parentId)
                  .map((bloc) => (
                    <BuilderBloc
                      key={bloc.id}
                      bloc={bloc}
                      collection={collections.find((c) => c.key === bloc.collection)}
                      selected={bloc.id === selectionId}
                      onSelect={(id = bloc.id) => setSelectionId(id)}
                      onMove={deplacerBloc}
                      onNest={imbriquerBloc}
                      onAdd={ajouterBloc}
                      composants={composants}
                      collections={collections}
                      selectedId={selectionId}
                      mode={mode}
                      preview={apercuActif}
                    />
                  ))
              ) : (
                <div className="stdCanvasEmpty">
                  <Icon fafa="faShapes" width={24} />
                  <strong>Déposez votre premier composant</strong>
                  <span>Cliquez ou glissez un élément depuis la bibliothèque.</span>
                </div>
              )}
            </div>
          </div>
          </div>
        </main>

        <aside className="stdBuilderInspector">
          {selection ? (
            <>
              <div className="stdInspectorTitle">
                <Icon fafa={BLOCS_INTERFACE[selection.type]?.icon} width={13} />
                <div>
                  <strong>{BLOCS_INTERFACE[selection.type]?.label}</strong>
                  <small>{selection.id}</small>
                </div>
              </div>
              <label>
                <span>Libellé</span>
                <input
                  value={selection.label || ""}
                  onChange={(e) => modifierBloc({ label: e.target.value })}
                />
              </label>
              {[
                "compteur",
                "tableau",
                "formulaire",
                "liste",
                "graphique",
                "carte",
              ].includes(selection.type) ? (
                <label>
                  <span>Source de données</span>
                  <select
                    value={selection.collection || ""}
                    onChange={(e) => modifierBloc({ collection: e.target.value })}
                  >
                    <option value="">Aucune</option>
                    {collections.map((coll) => (
                      <option key={coll.key} value={coll.key}>
                        {coll.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {selection.type === "image" ? (
                <label>
                  <span>Adresse de l’image</span>
                  <input
                    type="url"
                    value={selection.source || ""}
                    placeholder="https://…"
                    onChange={(e) => modifierBloc({ source: e.target.value })}
                  />
                </label>
              ) : null}
              {!["section", "conteneur"].includes(selection.type) ? (
                <label>
                  <span>Section parente</span>
                  <select
                    value={selection.parentId || ""}
                    onChange={(e) =>
                      modifierBloc({ parentId: e.target.value || undefined })
                    }
                  >
                    <option value="">Racine de la page</option>
                    {composants
                      .filter((item) => ["section", "conteneur"].includes(item.type))
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
              <div className="stdInspectorGroup">
                <strong>
                  Disposition{" "}
                  <span className="stdBreakpointBadge">
                    {mode === "desktop"
                      ? "Bureau"
                      : mode === "tablet"
                        ? "Tablette"
                        : "Mobile"}
                  </span>
                </strong>
                <label>
                  <span>Largeur</span>
                  <select
                    value={styleEdition.largeur || "50"}
                    onChange={(e) => modifierStyle({ largeur: e.target.value })}
                  >
                    <option value="25">25 %</option>
                    <option value="50">50 %</option>
                    <option value="75">75 %</option>
                    <option value="100">100 %</option>
                  </select>
                </label>
                <label>
                  <span>Alignement</span>
                  <select
                    value={styleEdition.alignement || "gauche"}
                    onChange={(e) => modifierStyle({ alignement: e.target.value })}
                  >
                    <option value="gauche">Gauche</option>
                    <option value="centre">Centre</option>
                    <option value="droite">Droite</option>
                  </select>
                </label>
                <label>
                  <span>Marge intérieure</span>
                  <input
                    type="number"
                    min="0"
                    max="64"
                    value={styleEdition.padding ?? 16}
                    onChange={(e) => modifierStyle({ padding: Number(e.target.value) })}
                  />
                </label>
                {["section", "conteneur"].includes(selection.type) ? (
                  <>
                    <label>
                      <span>Disposition des enfants</span>
                      <select
                        value={styleEdition.direction || "ligne"}
                        onChange={(e) => modifierStyle({ direction: e.target.value })}
                      >
                        <option value="ligne">Ligne flexible</option>
                        <option value="colonne">Colonne</option>
                        <option value="grille">Grille</option>
                      </select>
                    </label>
                    {styleEdition.direction === "grille" ? (
                      <label>
                        <span>Colonnes</span>
                        <select
                          value={styleEdition.colonnes || 2}
                          onChange={(e) =>
                            modifierStyle({ colonnes: Number(e.target.value) })
                          }
                        >
                          <option value="2">2 colonnes</option>
                          <option value="3">3 colonnes</option>
                          <option value="4">4 colonnes</option>
                        </select>
                      </label>
                    ) : null}
                    <label>
                      <span>Espacement</span>
                      <input
                        type="number"
                        min="0"
                        max="48"
                        value={styleEdition.gap ?? 12}
                        onChange={(e) => modifierStyle({ gap: Number(e.target.value) })}
                      />
                    </label>
                  </>
                ) : null}
              </div>
              <div className="stdInspectorGroup">
                <strong>Apparence</strong>
                <label>
                  <span>Fond</span>
                  <select
                    value={styleEdition.fond || "surface"}
                    onChange={(e) => modifierStyle({ fond: e.target.value })}
                  >
                    <option value="surface">Surface</option>
                    <option value="transparent">Transparent</option>
                    <option value="accent">Accent</option>
                    <option value="subtil">Subtil</option>
                  </select>
                </label>
              </div>
              {mode !== "desktop" ? (
                <label className="stdResponsiveVisibility">
                  <input
                    type="checkbox"
                    checked={!styleEdition.masque}
                    onChange={(e) => modifierStyle({ masque: !e.target.checked })}
                  />
                  <span>Visible sur {mode === "tablet" ? "tablette" : "mobile"}</span>
                </label>
              ) : null}
              {selection.type === "bouton" ? (
                <div className="stdInspectorGroup">
                  <strong>Action au clic</strong>
                  <label>
                    <span>Action</span>
                    <select
                      value={selection.action?.type || "aucune"}
                      onChange={(e) =>
                        modifierBloc({ action: { type: e.target.value, cible: "" } })
                      }
                    >
                      <option value="aucune">Aucune</option>
                      <option value="page">Ouvrir une page</option>
                      <option value="collection">Ouvrir une collection</option>
                    </select>
                  </label>
                  {selection.action?.type === "page" ? (
                    <label>
                      <span>Page cible</span>
                      <select
                        value={selection.action?.cible || ""}
                        onChange={(e) =>
                          modifierBloc({
                            action: { ...selection.action, cible: e.target.value },
                          })
                        }
                      >
                        <option value="">Choisir…</option>
                        {pagesCourantes.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.nom}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {selection.action?.type === "collection" ? (
                    <label>
                      <span>Collection cible</span>
                      <select
                        value={selection.action?.cible || ""}
                        onChange={(e) =>
                          modifierBloc({
                            action: { ...selection.action, cible: e.target.value },
                          })
                        }
                      >
                        <option value="">Choisir…</option>
                        {collections.map((item) => (
                          <option key={item.key} value={item.key}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
              ) : null}
              <div className="stdInspectorActions">
                <button type="button" onClick={() => changerOrdre(-1)} title="Monter">
                  <Icon fafa="faArrowUp" width={10} />
                </button>
                <button type="button" onClick={() => changerOrdre(1)} title="Descendre">
                  <Icon fafa="faArrowDown" width={10} />
                </button>
                <button type="button" onClick={dupliquerBloc} title="Dupliquer">
                  <Icon fafa="faCopy" width={10} /> Dupliquer
                </button>
              </div>
              <button
                type="button"
                className="stdInspectorDelete"
                onClick={supprimerBloc}
              >
                Supprimer le composant
              </button>
            </>
          ) : (
            <div className="stdPageInspector">
              <div className="stdInspectorTitle">
                <Icon fafa="faFile" width={13} />
                <div>
                  <strong>Page</strong>
                  <small>{page.id}</small>
                </div>
              </div>
              <label>
                <span>Nom de la page</span>
                <input
                  value={page.nom || ""}
                  onChange={(e) => modifierPage({ nom: e.target.value })}
                />
              </label>
              <div className="stdInspectorGroup">
                <strong>Gestion</strong>
                <div className="stdPageActions">
                  <button type="button" onClick={dupliquerPage}>
                    <Icon fafa="faCopy" width={10} /> Dupliquer
                  </button>
                  <button
                    type="button"
                    data-danger
                    disabled={pagesCourantes.length <= 1}
                    onClick={supprimerPage}
                  >
                    <Icon fafa="faTrash" width={10} /> Supprimer
                  </button>
                </div>
              </div>
              <div className="stdInspectorEmpty stdInspectorEmptyCompact">
                <Icon fafa="faArrowPointer" width={18} />
                <strong>Sélectionnez un composant</strong>
                <span>Ou modifiez les réglages de cette page.</span>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function BuilderBloc({
  bloc,
  collection,
  selected,
  selectedId,
  onSelect,
  onMove,
  onNest,
  onAdd,
  composants,
  collections,
  mode,
  preview,
}) {
  const estSection = ["section", "conteneur"].includes(bloc.type);
  const enfants = composants.filter((item) => item.parentId === bloc.id);
  const styleEffectif = {
    ...bloc.style,
    ...(mode !== "desktop" ? bloc.responsive?.[mode] || {} : {}),
  };
  return (
    <div
      className="stdCanvasBloc"
      data-type={bloc.type}
      data-selected={!preview && selected}
      data-preview={preview}
      data-background={bloc.style?.fond || "surface"}
      data-breakpoint-hidden={Boolean(styleEffectif.masque)}
      draggable={!preview}
      style={{
        "--bloc-width": `${styleEffectif.largeur || 50}%`,
        "--bloc-padding": `${styleEffectif.padding ?? 16}px`,
        textAlign:
          styleEffectif.alignement === "centre"
            ? "center"
            : styleEffectif.alignement === "droite"
              ? "right"
              : "left",
      }}
      onClick={(event) => {
        if (preview) return;
        event.stopPropagation();
        onSelect();
      }}
      onDragStart={(event) => event.dataTransfer.setData("studio/bloc", bloc.id)}
      onDragOver={(event) => !preview && event.preventDefault()}
      onDrop={(event) => {
        if (preview) return;
        event.stopPropagation();
        event.preventDefault();
        const type = event.dataTransfer.getData("studio/type");
        if (type && estSection) {
          onAdd(type, bloc.id);
          return;
        }
        const sourceId = event.dataTransfer.getData("studio/bloc");
        if (estSection) onNest(sourceId, bloc.id);
        else onMove(sourceId, bloc.id);
      }}
    >
      {!preview && selected ? (
        <span className="stdCanvasSelection">{BLOCS_INTERFACE[bloc.type]?.label}</span>
      ) : null}
      {bloc.type === "titre" ? <h3>{bloc.label}</h3> : null}
      {bloc.type === "texte" ? <p>{bloc.label || "Votre texte commence ici."}</p> : null}
      {bloc.type === "bouton" ? (
        <button type="button">{bloc.label || "Continuer"}</button>
      ) : null}
      {bloc.type === "compteur" ? (
        <div className="stdMockMetric">
          <span>{bloc.label}</span>
          <strong>128</strong>
          <small>+12 % ce mois</small>
        </div>
      ) : null}
      {bloc.type === "tableau" ? (
        <div className="stdMockTable">
          <strong>{bloc.label}</strong>
          <span>
            {collection?.fields
              ?.slice(0, 3)
              .map((f) => f.label)
              .join("  ·  ") || "Nom  ·  Statut  ·  Date"}
          </span>
          <i />
          <i />
          <i />
        </div>
      ) : null}
      {bloc.type === "formulaire" ? (
        <div className="stdMockForm">
          <strong>{bloc.label}</strong>
          <span />
          <span />
          <button type="button">Enregistrer</button>
        </div>
      ) : null}
      {bloc.type === "conteneur" ? (
        <div className="stdMockContainer">
          <Icon fafa="faPlus" width={12} />
          <span>{bloc.label}</span>
        </div>
      ) : null}
      {bloc.type === "section" ? (
        <div className="stdMockSectionLabel">
          <Icon fafa="faColumns" width={11} />
          <span>{bloc.label}</span>
          <small>
            {enfants.length} composant{enfants.length > 1 ? "s" : ""}
          </small>
        </div>
      ) : null}
      {bloc.type === "image" ? (
        <div className="stdMockImage" style={{ backgroundImage: `url(${bloc.source})` }}>
          <span>{bloc.label}</span>
        </div>
      ) : null}
      {bloc.type === "carte" ? (
        <div className="stdMockCard">
          <i />
          <div>
            <strong>{bloc.label}</strong>
            <span>{collection?.label || "Collection"}</span>
          </div>
          <Icon fafa="faChevronRight" width={9} />
        </div>
      ) : null}
      {bloc.type === "liste" ? (
        <div className="stdMockList">
          <strong>{bloc.label}</strong>
          {[1, 2, 3].map((item) => (
            <span key={item}>
              <i />
              <b>Élément {item}</b>
              <small>À l’instant</small>
            </span>
          ))}
        </div>
      ) : null}
      {bloc.type === "graphique" ? (
        <div className="stdMockChart">
          <strong>{bloc.label}</strong>
          <div>
            {[42, 68, 54, 88, 73, 96].map((value, index) => (
              <i key={index} style={{ height: `${value}%` }} />
            ))}
          </div>
        </div>
      ) : null}
      {bloc.type === "badge" ? (
        <span className="stdMockBadge">{bloc.label || "Nouveau"}</span>
      ) : null}
      {bloc.type === "separateur" ? (
        <div className="stdMockSeparator">
          <span>{bloc.label}</span>
        </div>
      ) : null}
      {estSection ? (
        <div
          className="stdNestedZone"
          data-direction={styleEffectif.direction || "ligne"}
          style={{
            "--nested-gap": `${styleEffectif.gap ?? 12}px`,
            "--nested-columns": styleEffectif.colonnes || 2,
          }}
        >
          {enfants.length ? (
            enfants.map((enfant) => (
              <BuilderBloc
                key={enfant.id}
                bloc={enfant}
                collection={collections.find((item) => item.key === enfant.collection)}
                selected={enfant.id === selectedId}
                selectedId={selectedId}
                onSelect={() => onSelect(enfant.id)}
                onMove={onMove}
                onNest={onNest}
                onAdd={onAdd}
                composants={composants}
                collections={collections}
                mode={mode}
                preview={preview}
              />
            ))
          ) : (
            <span className="stdNestedEmpty">
              Déposez des composants dans cette section
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

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
  { id: "mes-apps", label: "Mes applications", icon: "faLayerGroup" },
  { id: "identite", label: "Identité", icon: "faTag" },
  { id: "adresse", label: "Adresse du site", icon: "faGlobe", genres: ["web"] },
  { id: "donnees", label: "Données", icon: "faTable", genres: ["donnees"] },
  { id: "tableau", label: "Tableau de bord", icon: "faChartPie", genres: ["donnees"] },
  { id: "apercu", label: "Aperçu", icon: "faEye", genres: ["donnees"] },
  { id: "publication", label: "Publication", icon: "faRocket" },
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
            <div key={m.id} className="stdModele handcr" onClick={() => close(m.id)}>
              <Icon src={m.icone} width={30} />
              <b>{m.nom}</b>
              <span>{m.aide}</span>
            </div>
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

  // ---- Pavés du tableau de bord ----
  const widgets = () => draft.definition.accueil || [];
  const setWidgets = (liste) =>
    setDraft((d) => ({
      ...d,
      definition: { ...d.definition, accueil: liste },
    }));
  const addWidget = () =>
    setWidgets([
      ...widgets(),
      {
        type: "compteur",
        collection: draft.definition.collections[0]?.key || "",
        titre: "",
      },
    ]);
  const setWidget = (i, patch) =>
    setWidgets(widgets().map((w, j) => (j === i ? { ...w, ...patch } : w)));
  const removeWidget = (i) => setWidgets(widgets().filter((_, j) => j !== i));

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

  return (
    <ModuleWindow manifest={manifest} className="stdApp">
      {session.status !== "authenticated" ? (
        <div className="stdLocked">Connectez-vous pour utiliser le Studio.</div>
      ) : (
        <div className="stdShell">
          <aside className="stdNav" aria-label="Étapes de création">
            {sectionsVisibles.map((s) => (
              <button
                type="button"
                key={s.id}
                className="stdNavItem"
                data-active={section === s.id}
                aria-current={section === s.id ? "step" : undefined}
                onClick={() => goToSection(s.id)}
              >
                <Icon fafa={s.icon} width={13} />
                <span>{s.label}</span>
              </button>
            ))}
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
              <div className="stdSectionHead">
                <div>
                  <h2>
                    <span className="stdNum">1.</span> Mes applications
                  </h2>
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
                    <button
                      type="button"
                      key={a.slug}
                      className="stdRow"
                      data-active={a.slug === editingSlug}
                      onClick={() => openApp(a)}
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
                    </button>
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

            {/* ---- Tableau de bord ---- */}
            <section className="stdSection" data-hidden={section !== "tableau"}>
              <h2>
                <span className="stdNum">4.</span> Tableau de bord
              </h2>
              <p className="stdHint">
                Des indicateurs affichés à l'ouverture de l'application. Sans eux, il faut
                parcourir toutes les fiches pour savoir « combien ». Facultatif.
              </p>
              {draft ? (
                <TableauBuilder
                  widgets={widgets()}
                  collections={D.normaliser(draft.definition).collections}
                  onAdd={addWidget}
                  onSet={setWidget}
                  onRemove={removeWidget}
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
                          <li key={probleme}>{probleme}</li>
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

            {notice ? <div className="stdNotice">{notice}</div> : null}
          </div>
        </div>
      )}
    </ModuleWindow>
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
// Constructeur du tableau de bord
// ---------------------------------------------------------------------------

/// Compose les pavés du tableau de bord. Chaque pavé dit : quel indicateur,
/// sur quelle collection, sur quel champ. Les choix se restreignent à ce
/// qui a du sens — une somme ne se propose que sur un montant ou un nombre.
function TableauBuilder({ widgets, collections, onAdd, onSet, onRemove }) {
  return (
    <div className="stdWidgetsEditeur">
      {widgets.length === 0 ? (
        <div className="stdEmptyBox">
          Aucun pavé. Ajoutez-en un pour donner une vue d'ensemble à l'application.
        </div>
      ) : (
        widgets.map((w, i) => {
          const coll = collections.find((c) => c.key === w.collection);
          const def = D.WIDGETS[w.type];
          const champsPossibles = (coll?.fields || []).filter(
            (f) => !def?.typeChamp || def.typeChamp.includes(f.type),
          );
          return (
            <div key={i} className="stdWidgetRow">
              <input
                type="text"
                className="stdWidgetTitre"
                value={w.titre || ""}
                placeholder={def?.label || "Titre"}
                onChange={(e) => onSet(i, { titre: e.target.value })}
              />
              <select
                value={w.type}
                onChange={(e) => onSet(i, { type: e.target.value, champ: "" })}
              >
                {Object.entries(D.WIDGETS).map(([id, t]) => (
                  <option key={id} value={id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <select
                value={w.collection}
                onChange={(e) => onSet(i, { collection: e.target.value, champ: "" })}
              >
                {collections.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
              {def?.besoinChamp ? (
                <select
                  value={w.champ || ""}
                  onChange={(e) => onSet(i, { champ: e.target.value })}
                >
                  <option value="">— quel champ ? —</option>
                  {champsPossibles.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="stdWidgetVide" />
              )}
              <div className="stdDel handcr" onClick={() => onRemove(i)}>
                ✕
              </div>
            </div>
          );
        })
      )}
      <div className="stdBtnGhost handcr" onClick={onAdd}>
        Ajouter un pavé
      </div>
    </div>
  );
}

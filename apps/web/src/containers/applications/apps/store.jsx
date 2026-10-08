import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { Icon, ToolBar } from "../../../utils/general";
import { chercher } from "./boutique";
import { useNomApp } from "../../../utils/nomsApps";
import { api } from "../../../api/client";
import { syncInstalledModules, moduleBySlug } from "../../../apps/sync";
import { scrollElementTo } from "../../../apps/scrollTo";
import { etatFenetre, ouvrirFenetre } from "../../../apps/windows";
import { cleApp } from "../../../reducers/apps";
import { modal } from "../../../apps/modalRequest";
import { decrireCapacites } from "../../../apps/donnees";
import { Contenu, useChargement } from "../../../apps/chargement";
import {
  miseAJourDisponible,
  nouveautesDepuis,
  sansVersion,
  versionLivree,
} from "../../../apps/versions";
import "./assets/boutique.scss";

// Boutique CompanyOS : catalogue servi par l'API, installation par espace
// de travail. Même charte que les modules — voir src/apps/README.md.

const SECTIONS = [
  { id: "catalogue", label: "Découvrir", icon: "faCompass" },
  { id: "misesajour", label: "Mises à jour", icon: "faCircleArrowUp" },
  { id: "installees", label: "Installées", icon: "faLayerGroup" },
];

/// L'ordre des catégories à l'écran : le métier d'abord, c'est pour lui
/// qu'on ouvre la Boutique.
const ORDRE_CATEGORIES = ["Gestion", "Bureautique", "Création", "Outils"];

/// Ce qu'on met en avant à une entreprise qui n'a pas encore tout : les
/// applications qui font tourner une PME, dans l'ordre où elle en a besoin.
const A_LA_UNE = ["facturation", "caisse", "stock", "comptabilite", "paie", "rh", "crm", "achats", "conges"];

export const MicroStore = () => {
  const nomApp = useNomApp();
  const wnapp = useSelector((state) => state.apps.store);
  const session = useSelector((state) => state.session);

  const [section, setSection] = useState("catalogue");
  const [catalog, setCatalog] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Tout");
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [busySlug, setBusySlug] = useState(null);

  const mainRef = React.useRef(null);
  const sectionRefs = React.useRef({});
  const registerSection = (id) => (el) => {
    sectionRefs.current[id] = el;
  };

  const load = async () => {
    const apps = await api.catalog();
    setCatalog(apps);
    setError("");
    adopterVersions(apps);
  };

  /// Pose la version de référence des installations qui n'en ont pas.
  ///
  /// Elles datent d'avant le suivi de version : on ne sait pas d'où elles
  /// viennent, donc rien à reprendre. On enregistre ce qui tourne, en
  /// silence, et les mises à jour suivantes seront de vraies mises à jour.
  ///
  /// Réservé aux administrateurs côté serveur : pour un membre l'appel
  /// échoue, et c'est sans conséquence — le premier passage d'un
  /// administrateur posera la référence.
  const adopterVersions = async (apps) => {
    const orphelines = sansVersion(apps);
    if (!orphelines.length) return;

    let pose = false;
    for (const app of orphelines) {
      try {
        await api.appliquerMiseAJour(app.slug, versionLivree(app, moduleBySlug));
        pose = true;
      } catch {
        return; // 403 : l'utilisateur n'est pas administrateur, on s'arrête
      }
    }
    if (pose) setCatalog(await api.catalog());
  };

  // La Boutique est une fenêtre du socle : montée en permanence, elle ne
  // chargeait qu'au passage de `hide` à false. Ouverte avant l'ouverture de
  // session, elle restait donc vide jusqu'à ce qu'on la referme et la
  // rouvre — un catalogue à zéro carte alors que l'API répondait.
  const etat = useChargement(
    !wnapp.hide && session.status === "authenticated",
    load,
  );

  // Les entrées de la barre latérale sont des onglets : on change de
  // panneau et on repart du haut, plutôt que de faire défiler une page.
  const goToSection = (id) => {
    setSection(id);
    scrollElementTo(mainRef.current, 0);
  };

  const toggle = async (app) => {
    if (busySlug || app.isCore) return;

    // Garde-fou : on n'installe pas ce qui n'existe pas encore. La
    // désinstallation reste permise, pour les espaces qui auraient déjà
    // enregistré une installation sans effet.
    if (!app.installed && !disponible(app)) {
      return modal.alert({
        title: `${nomApp(app)} n'est pas encore disponible`,
        message: "Ce module figure à la feuille de route mais n'est pas encore livré.",
        detail:
          "Il apparaîtra dans la Boutique, installable, dès qu'il sera prêt. Rien à faire d'ici là.",
        tone: "info",
      });
    }
    // Installer ne demande rien : c'est réversible d'un clic. Désinstaller
    // retire l'icône du bureau, donc on s'assure de l'intention.
    if (app.installed) {
      const ok = await modal.confirm({
        title: "Désinstaller l'application",
        message: `Retirer « ${nomApp(app)} » de cet espace de travail ?`,
        detail:
          "Les données saisies sont conservées et reviendront si l'application est réinstallée.",
        confirmLabel: "Désinstaller",
        danger: true,
      });
      if (!ok) return;
    }
    setBusySlug(app.slug);
    try {
      if (app.installed) await api.uninstallApp(app.slug);
      else await api.installApp(app.slug, versionLivree(app, moduleBySlug));
      // Le shell suit immédiatement : icône ajoutée ou retirée du bureau.
      await syncInstalledModules();
      await etat.rafraichir();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusySlug(null);
    }
  };

  const categories = useMemo(
    () => ["Tout", ...new Set(catalog.map((a) => a.category))],
    [catalog],
  );

  const visible = useMemo(() => {
    // Le filtre par catégorie d'abord, la recherche ensuite : chercher dans
    // ce qu'on a déjà restreint, et non l'inverse.
    const parCategorie =
      filter === "Tout" ? catalog : catalog.filter((a) => a.category === filter);
    // `chercher` ignore les accents, accepte les mots dans le désordre et
    // classe par pertinence. Voir boutique.js — un simple `includes` ne
    // trouvait pas « Comptabilité » quand on tapait « comptabilite ».
    return chercher(parCategorie, query, nomApp);
  }, [catalog, filter, query, nomApp]);

  // Ce que la même recherche donnerait sans le filtre de catégorie.
  //
  // Le piège classique d'une boutique : on cherche « paie », un filtre
  // « Bureautique » est resté actif depuis tout à l'heure, et l'écran
  // répond « aucun module » — laissant croire que l'application n'existe
  // pas. Mieux vaut le dire, et proposer d'élargir.
  const ailleurs = useMemo(
    () => (filter === "Tout" ? [] : chercher(catalog, query, nomApp)),
    [catalog, filter, query, nomApp],
  );

  const installed = catalog.filter((a) => a.installed);

  const aMettreAJour = useMemo(
    () => catalog.filter((a) => miseAJourDisponible(a, moduleBySlug)),
    [catalog],
  );

  /// Applique une mise à jour.
  ///
  /// Le code, lui, est déjà là — il arrive avec le shell. Ce que cette
  /// action fait vraiment, c'est lancer la **reprise de données** du module
  /// puis enregistrer la nouvelle version. C'est le seul endroit de l'OS où
  /// des données existantes sont retouchées, et c'est tracé au journal.
  const mettreAJour = async (app) => {
    const cible = versionLivree(app, moduleBySlug);
    const notes = nouveautesDepuis(app, moduleBySlug);

    const ok = await modal.confirm({
      title: `Mettre à jour ${nomApp(app)}`,
      message: `Version ${app.installedVersion || "inconnue"} → ${cible}`,
      detail: notes.length
        ? notes.map((n) => `• ${n.texte}`).join("\n")
        : "Aucune nouveauté annoncée pour cette version.",
      confirmLabel: "Mettre à jour",
    });
    if (!ok) return;

    setBusySlug(app.slug);
    try {
      // La migration tourne **avant** l'enregistrement de la version : si
      // elle échoue, l'application reste marquée à mettre à jour et la
      // reprise sera retentée. L'inverse la perdrait en silence.
      const migrer = moduleBySlug[app.slug]?.migrer;
      if (migrer) await migrer(app.installedVersion || null);

      await api.appliquerMiseAJour(app.slug, cible);
      await syncInstalledModules();
      await etat.rafraichir();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusySlug(null);
    }
  };

  const toutMettreAJour = async () => {
    for (const app of aMettreAJour) {
      const cible = versionLivree(app, moduleBySlug);
      setBusySlug(app.slug);
      try {
        const migrer = moduleBySlug[app.slug]?.migrer;
        if (migrer) await migrer(app.installedVersion || null);
        await api.appliquerMiseAJour(app.slug, cible);
      } catch (err) {
        setError(err.message);
        break;
      } finally {
        setBusySlug(null);
      }
    }
    await syncInstalledModules();
    await etat.rafraichir();
  };

  const optional = catalog.filter((a) => !a.isCore);
  const detail = catalog.find((a) => a.slug === selected) || null;

  // Les capacités sont déclarées dans le manifeste du module, côté shell —
  // le catalogue serveur ne les connaît pas. Une app du Studio n'a jamais
  // d'accès externe : son moteur ne touche que ses propres collections.
  const acces = useMemo(
    () =>
      detail
        ? decrireCapacites(
            moduleBySlug[detail.slug]?.capacites,
            (m) => moduleBySlug[m]?.name || m,
          )
        : [],
    [detail],
  );

  /// Une application du catalogue n'est réellement utilisable que si un
  /// module lui répond dans le shell. Une app annoncée au catalogue avant
  /// que son module soit livré donnait sinon un « Installée » qui ne
  /// produisait rien à l'écran, puisque `syncInstalledModules` n'attache que
  /// ce qui existe dans le registre.
  /// Les apps du Studio n'ont pas de module : leur fenêtre est le moteur
  /// générique, elles sont donc toujours disponibles.
  const disponible = (app) => app.kind !== "NATIVE" || !!moduleBySlug[app.slug];

  /// L'application a-t-elle une fenêtre qu'on peut ouvrir d'ici ?
  // La clé de fenêtre est celle du shell : l'`id` du module, à défaut son
  // icône (le Traitement de texte n'a pas d'`id`).
  const idFenetre = (app) => (moduleBySlug[app.slug] ? cleApp(moduleBySlug[app.slug]) : app.slug);
  const ouvrable = (app) => (app.installed || app.isCore) && !!etatFenetre(idFenetre(app));
  const ouvrir = (app) => ouvrirFenetre(idFenetre(app));

  const voirFiche = (slug) => {
    setSelected(slug);
    scrollElementTo(mainRef.current, 0);
  };

  /// Le catalogue rangé par catégorie, le métier d'abord ; le socle (ce qui
  /// est livré avec CompanyOS et ne s'installe pas) à part, en dernier.
  const parCategorie = useMemo(() => {
    const groupes = new Map();
    for (const app of visible) {
      if (app.isCore) continue;
      if (!groupes.has(app.category)) groupes.set(app.category, []);
      groupes.get(app.category).push(app);
    }
    const rang = (c) => (ORDRE_CATEGORIES.indexOf(c) < 0 ? 99 : ORDRE_CATEGORIES.indexOf(c));
    return [...groupes.entries()].sort((a, b) => rang(a[0]) - rang(b[0]));
  }, [visible]);
  const socle = visible.filter((a) => a.isCore);

  /// L'application mise en avant : la première du métier pas encore
  /// installée et réellement disponible.
  const aLaUne = useMemo(() => {
    const candidates = catalog.filter((a) => !a.isCore && !a.installed && disponible(a));
    return A_LA_UNE.map((slug) => candidates.find((a) => a.slug === slug)).find(Boolean)
      || candidates[0]
      || null;
  }, [catalog]);

  /// Les applications dont elle lit ou modifie les données : ce avec quoi
  /// elle « fonctionne ».
  const liees = useMemo(() => {
    if (!detail) return [];
    const cap = moduleBySlug[detail.slug]?.capacites || {};
    const slugs = new Set(
      [...(cap.lit || []), ...(cap.ecrit || [])].map((c) => String(c).split(":")[0]),
    );
    slugs.delete(detail.slug);
    return [...slugs].map((slug) => catalog.find((a) => a.slug === slug)).filter(Boolean);
  }, [detail, catalog]);

  const statusOf = (app) => {
    if (app.isCore) return { label: "Socle", tone: "core" };
    if (!disponible(app)) return { label: "Bientôt", tone: "soon" };
    if (!app.installed) return { label: "Disponible", tone: "idle" };
    return { label: "Installée", tone: "ok" };
  };

  /// Une carte du catalogue : on l'ouvre pour lire la fiche ; le bouton
  /// fait l'action la plus probable — Ouvrir si c'est installé, Installer
  /// sinon. Désinstaller n'est jamais à portée d'un clic distrait : il est
  /// dans la fiche.
  const carte = (app) => {
    const status = statusOf(app);
    return (
      <div
        key={app.slug}
        className="btqCard"
        role="button"
        tabIndex={0}
        data-bientot={!disponible(app) && !app.installed ? "true" : "false"}
        onClick={() => voirFiche(app.slug)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); voirFiche(app.slug); }
        }}
      >
        <Icon src={app.icon} width={44} />
        <div className="btqCardCorps">
          <div className="btqName">{nomApp(app)}</div>
          <div className="btqCat">
            {app.category}
            {status.tone === "ok" ? <span className="btqInstallee"><Icon fafa="faCircleCheck" width={9} /> Installée</span> : null}
          </div>
          <div className="btqDesc">{app.description}</div>
        </div>
        <div className="btqCardFoot">
          {status.tone === "soon" ? (
            <span className="btqTag" data-tone="soon">Bientôt</span>
          ) : ouvrable(app) ? (
            <button type="button" className="btqBouton" data-ton="contour" onClick={(e) => { e.stopPropagation(); ouvrir(app); }}>
              Ouvrir
            </button>
          ) : !app.installed && !app.isCore ? (
            <button
              type="button"
              className="btqBouton"
              data-ton="doux"
              disabled={!!busySlug}
              onClick={(e) => { e.stopPropagation(); toggle(app); }}
            >
              {busySlug === app.slug ? "Installation…" : "Installer"}
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div
      className="boutique floatTab dpShad"
      data-size={wnapp.size}
      data-cascade={wnapp.cascade || 0}
      data-max={wnapp.max}
      style={{
        ...(wnapp.size == "cstm" ? wnapp.dim : null),
        zIndex: wnapp.z,
      }}
      data-hide={wnapp.hide}
      id={wnapp.icon + "App"}
    >
      <ToolBar
        app={wnapp.action}
        icon={wnapp.icon}
        size={wnapp.size}
        name={nomApp("store")}
      />
      <div className="windowScreen flex flex-col" data-dock="true">
        <div className="restWindow flex-grow flex flex-col">
          {session.status !== "authenticated" ? (
            <div className="btqLocked">
              Connectez-vous pour parcourir la Boutique.
            </div>
          ) : (
            <div className="btqShell">
              {/* Le rail de navigation, comme celui du Microsoft Store. */}
              <nav className="btqNav" aria-label="Boutique">
                {SECTIONS.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className="btqNavItem"
                    data-active={section === s.id && !detail}
                    onClick={() => { setSelected(null); goToSection(s.id); }}
                  >
                    <span className="btqNavIcone">
                      <Icon fafa={s.icon} width={15} />
                      {/* Une mise à jour en attente doit se voir sans avoir
                          à ouvrir l'onglet : c'est tout l'intérêt du suivi. */}
                      {s.id === "misesajour" && aMettreAJour.length ? (
                        <span className="btqPastille">{aMettreAJour.length}</span>
                      ) : null}
                    </span>
                    <span>{s.label}</span>
                  </button>
                ))}
              </nav>

              <div className="btqMain cosScroll" ref={mainRef}>
                {/* La recherche reste en haut, quel que soit l'onglet. */}
                <div className="btqBarre">
                  <div className="btqRecherche">
                    <Icon fafa="faMagnifyingGlass" width={13} />
                    <input
                      type="search"
                      placeholder="Rechercher une application : facturation, paie, stock…"
                      aria-label="Rechercher une application"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setSelected(null);
                        if (section !== "catalogue") setSection("catalogue");
                      }}
                    />
                  </div>
                </div>

                {error ? <div className="btqWarn">{error}</div> : null}

                {detail ? (
                  // ---------------------------------------------------------
                  // La fiche d'une application
                  // ---------------------------------------------------------
                  <article className="btqFiche">
                    <button type="button" className="btqRetour" onClick={() => setSelected(null)}>
                      <Icon fafa="faArrowLeft" width={11} />
                      <span>Retour</span>
                    </button>

                    <header className="btqFicheTete">
                      <span className="btqFicheIcone"><Icon src={detail.icon} width={64} /></span>
                      <div className="btqFicheInfo">
                        <h2>{nomApp(detail)}</h2>
                        <div className="btqFicheMeta">
                          {detail.category} · version {versionLivree(detail, moduleBySlug) || detail.version}
                          {detail.kind === "CUSTOM" ? " · créée dans le Studio" : ""}
                        </div>
                        <div className="btqFicheActions">
                          {detail.isCore ? (
                            <>
                              {ouvrable(detail) ? (
                                <button type="button" className="btqBouton" data-ton="plein" onClick={() => ouvrir(detail)}>Ouvrir</button>
                              ) : null}
                              <span className="btqTag" data-tone="core">Inclus dans CompanyOS</span>
                            </>
                          ) : !disponible(detail) && !detail.installed ? (
                            <span className="btqTag" data-tone="soon">Bientôt disponible</span>
                          ) : detail.installed ? (
                            <>
                              {ouvrable(detail) ? (
                                <button type="button" className="btqBouton" data-ton="plein" onClick={() => ouvrir(detail)}>Ouvrir</button>
                              ) : null}
                              {miseAJourDisponible(detail, moduleBySlug) ? (
                                <button type="button" className="btqBouton" data-ton="contour" disabled={!!busySlug} onClick={() => mettreAJour(detail)}>
                                  Mettre à jour
                                </button>
                              ) : null}
                              <button type="button" className="btqBouton" data-ton="danger" disabled={!!busySlug} onClick={() => toggle(detail)}>
                                {busySlug === detail.slug ? "Désinstallation…" : "Désinstaller"}
                              </button>
                            </>
                          ) : (
                            <button type="button" className="btqBouton" data-ton="plein" disabled={!!busySlug} onClick={() => toggle(detail)}>
                              <Icon fafa="faDownload" width={12} />
                              <span>{busySlug === detail.slug ? "Installation…" : "Installer"}</span>
                            </button>
                          )}
                        </div>
                        {!detail.isCore && disponible(detail) ? (
                          <div className="btqFicheNote">
                            {detail.installed
                              ? "Installée pour tout l'espace de travail."
                              : "Comprise dans votre abonnement · s'installe pour toute l'équipe en un clic."}
                          </div>
                        ) : null}
                      </div>
                    </header>

                    <div className="btqFicheCorps">
                      <section className="btqBloc btqBlocLarge">
                        <h3>Description</h3>
                        <p>{detail.description}</p>
                      </section>

                      {liees.length ? (
                        <section className="btqBloc">
                          <h3>Fonctionne avec</h3>
                          <div className="btqLiees">
                            {liees.map((app) => (
                              <button type="button" key={app.slug} className="btqLiee" onClick={() => voirFiche(app.slug)}>
                                <Icon src={app.icon} width={22} />
                                <span>{nomApp(app)}</span>
                                {app.installed ? <Icon fafa="faCircleCheck" width={10} /> : null}
                              </button>
                            ))}
                          </div>
                        </section>
                      ) : null}

                      {/* Ce que l'application ira chercher hors de chez
                          elle. Déclaré dans son manifeste, montré avant
                          l'installation : l'utilisateur doit savoir ce
                          qu'il autorise. */}
                      <section className="btqBloc">
                        <h3>Accès aux données</h3>
                        {acces.length ? (
                          acces.map((a) => (
                            <div className="btqAccesLigne" key={a.verbe}>
                              <Icon fafa={a.verbe === "Modifie" ? "faPen" : "faEye"} width={11} />
                              <span><b>{a.verbe}</b> {a.quoi.join(", ")}</span>
                            </div>
                          ))
                        ) : (
                          <div className="btqAccesLigne">
                            <Icon fafa="faLock" width={11} />
                            <span>Ne lit que ses propres données.</span>
                          </div>
                        )}
                      </section>

                      {moduleBySlug[detail.slug]?.nouveautes?.length ? (
                        <section className="btqBloc">
                          <h3>Nouveautés</h3>
                          <ul className="btqNouveautes">
                            {moduleBySlug[detail.slug].nouveautes.slice(0, 4).map((n) => (
                              <li key={n.version}><b>v{n.version}</b> {n.texte}</li>
                            ))}
                          </ul>
                        </section>
                      ) : null}

                      {!detail.isCore ? (
                        <section className="btqBloc">
                          <h3>Bon à savoir</h3>
                          <p>
                            Désinstaller retire l'application du bureau de toute l'équipe ; les
                            données saisies sont conservées et reviennent à la réinstallation.
                            Qui peut l'ouvrir se règle dans Paramètres → Applications.
                          </p>
                        </section>
                      ) : null}
                    </div>
                  </article>
                ) : (
                  <>
                    {/* ------------------------------------------------- Découvrir */}
                    <section ref={registerSection("catalogue")} className="btqSection" data-hidden={section !== "catalogue"}>
                      {!query.trim() && filter === "Tout" ? (
                        <div className="btqHero">
                          <div className="btqHeroTexte">
                            <span className="btqHeroSur">Boutique CompanyOS</span>
                            <h2>Des applications pour {session.tenant?.name || "votre entreprise"}</h2>
                            <p>
                              {installed.filter((a) => !a.isCore).length} installées ·{" "}
                              {optional.filter((a) => !a.installed && disponible(a)).length} à découvrir. Toutes
                              comprises dans votre abonnement, et reliées entre elles.
                            </p>
                          </div>
                          {aLaUne ? (
                            <div className="btqUne">
                              <span className="btqUneSur">À la une</span>
                              <div className="btqUneApp">
                                <Icon src={aLaUne.icon} width={48} />
                                <div>
                                  <b>{nomApp(aLaUne)}</b>
                                  <span>{aLaUne.description}</span>
                                </div>
                              </div>
                              <div className="btqUneActions">
                                <button type="button" className="btqBouton" data-ton="blanc" disabled={!!busySlug} onClick={() => toggle(aLaUne)}>
                                  {busySlug === aLaUne.slug ? "Installation…" : "Installer"}
                                </button>
                                <button type="button" className="btqBouton" data-ton="lien" onClick={() => voirFiche(aLaUne.slug)}>
                                  En savoir plus
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="btqChips" role="tablist" aria-label="Catégories">
                        {categories.map((cat) => (
                          <button
                            type="button"
                            role="tab"
                            key={cat}
                            className="btqChip"
                            aria-selected={filter === cat}
                            onClick={() => setFilter(cat)}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>

                      {etat.initial || etat.erreur ? (
                        <Contenu etat={etat} vide={false} squelette="grille" lignes={9} />
                      ) : visible.length === 0 ? (
                        <div className="btqEmptyBox">
                          {query.trim()
                            ? `Aucune application ne correspond à « ${query.trim()} ».`
                            : "Aucune application dans cette catégorie."}
                          {ailleurs.length > 0 && (
                            <>
                              {" "}
                              <button type="button" className="btqLien" onClick={() => setFilter("Tout")}>
                                {ailleurs.length === 1
                                  ? "Une application correspond dans une autre catégorie."
                                  : `${ailleurs.length} applications correspondent dans d'autres catégories.`}
                              </button>
                            </>
                          )}
                        </div>
                      ) : query.trim() || filter !== "Tout" ? (
                        <>
                          {/* Dire ce qui est montré, et combien : sinon on ne
                              sait pas si c'est le catalogue ou un filtre. */}
                          <p className="btqResultats" role="status">
                            {query.trim()
                              ? `${visible.length} résultat${visible.length > 1 ? "s" : ""} pour « ${query.trim()} »`
                              : `${visible.length} application${visible.length > 1 ? "s" : ""} · ${filter}`}
                          </p>
                          <div className="btqGrid">
                            {visible.map(carte)}
                          </div>
                        </>
                      ) : (
                        <>
                          {parCategorie.map(([categorie, apps]) => (
                            <div key={categorie} className="btqGroupe">
                              <div className="btqGroupeTete">
                                <h3>{categorie}</h3>
                                {apps.length > 6 ? (
                                  <button type="button" className="btqLien" onClick={() => setFilter(categorie)}>
                                    Tout voir ({apps.length})
                                  </button>
                                ) : null}
                              </div>
                              {/* Six par catégorie sur l'accueil : de quoi
                                  choisir sans faire défiler tout le catalogue. */}
                              <div className="btqGrid">
                                {apps.slice(0, 6).map(carte)}
                              </div>
                            </div>
                          ))}
                          {socle.length ? (
                            <div className="btqGroupe">
                              <div className="btqGroupeTete">
                                <h3>Inclus dans CompanyOS</h3>
                                <span className="btqGroupeAide">Toujours disponibles, rien à installer</span>
                              </div>
                              <div className="btqSocle">
                                {socle.map((app) => (
                                  <button type="button" key={app.slug} className="btqSocleApp" onClick={() => voirFiche(app.slug)}>
                                    <Icon src={app.icon} width={28} />
                                    <span>{nomApp(app)}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </>
                      )}
                    </section>

                    {/* ------------------------------------------------- Mises à jour */}
                    <section ref={registerSection("misesajour")} className="btqSection" data-hidden={section !== "misesajour"}>
                      <div className="btqTitre">
                        <h2>Mises à jour</h2>
                        {aMettreAJour.length ? (
                          <button type="button" className="btqBouton" data-ton="plein" disabled={!!busySlug} onClick={toutMettreAJour}>
                            Tout mettre à jour ({aMettreAJour.length})
                          </button>
                        ) : null}
                      </div>
                      <p className="btqHint">
                        Une mise à jour reprend les données existantes au nouveau format ; c'est tracé
                        au journal d'activité.
                      </p>

                      {!aMettreAJour.length ? (
                        <div className="btqEmptyBox btqAJour">
                          <Icon fafa="faCircleCheck" width={22} />
                          <span>Toutes vos applications sont à jour.</span>
                        </div>
                      ) : (
                        <div className="btqListe">
                          {aMettreAJour.map((app) => {
                            const cible = versionLivree(app, moduleBySlug);
                            const notes = nouveautesDepuis(app, moduleBySlug);
                            return (
                              <div key={app.slug} className="btqLigne btqLigneMaj">
                                <Icon src={app.icon} width={32} />
                                <div className="btqLigneInfo">
                                  <button type="button" className="btqLigneNom" onClick={() => voirFiche(app.slug)}>{nomApp(app)}</button>
                                  <div className="btqLigneMeta">
                                    {app.installedVersion ? `v${app.installedVersion}` : "version inconnue"}
                                    <Icon fafa="faArrowRight" width={8} />
                                    <strong>v{cible}</strong>
                                  </div>
                                  {notes.length ? (
                                    <ul className="btqNouveautes">
                                      {notes.map((n) => (
                                        <li key={n.version}>{n.texte}</li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <div className="btqLigneMeta">Reprise des données pour cette version.</div>
                                  )}
                                </div>
                                <button type="button" className="btqBouton" data-ton="contour" disabled={!!busySlug} onClick={() => mettreAJour(app)}>
                                  {busySlug === app.slug ? "Mise à jour…" : "Mettre à jour"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>

                    {/* ------------------------------------------------- Installées */}
                    <section ref={registerSection("installees")} className="btqSection" data-hidden={section !== "installees"}>
                      <div className="btqTitre">
                        <h2>Installées</h2>
                        <span className="btqHint">{installed.length} applications dans {session.tenant?.name || "cet espace"}</span>
                      </div>

                      <div className="btqListe">
                        {[...installed]
                          .sort((a, b) => Number(a.isCore) - Number(b.isCore) || nomApp(a).localeCompare(nomApp(b), "fr"))
                          .map((app) => (
                            <div key={app.slug} className="btqLigne">
                              <Icon src={app.icon} width={28} />
                              <div className="btqLigneInfo">
                                <button type="button" className="btqLigneNom" onClick={() => voirFiche(app.slug)}>{nomApp(app)}</button>
                                <div className="btqLigneMeta">
                                  {app.category} · v{app.installedVersion || versionLivree(app, moduleBySlug)}
                                  {miseAJourDisponible(app, moduleBySlug) ? (
                                    <em className="btqMajDispo"> · v{versionLivree(app, moduleBySlug)} disponible</em>
                                  ) : null}
                                  {app.isCore ? " · inclus dans CompanyOS" : ""}
                                </div>
                              </div>
                              {ouvrable(app) ? (
                                <button type="button" className="btqBouton" data-ton="contour" onClick={() => ouvrir(app)}>Ouvrir</button>
                              ) : null}
                              {app.isCore ? <span className="btqIconeBouton" aria-hidden="true" /> : (
                                <button
                                  type="button"
                                  className="btqIconeBouton"
                                  title={`Désinstaller ${nomApp(app)}`}
                                  aria-label={`Désinstaller ${nomApp(app)}`}
                                  disabled={!!busySlug}
                                  onClick={() => toggle(app)}
                                >
                                  <Icon fafa="faTrashCan" width={12} />
                                </button>
                              )}
                            </div>
                          ))}
                      </div>

                      <p className="btqHint btqAPropos">
                        Une application installée apparaît aussitôt sur le bureau et dans le menu
                        Démarrer de toute l'équipe. Désinstallée, elle disparaît de la même manière ;
                        ses données restent conservées et reviennent à la réinstallation.
                      </p>
                    </section>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

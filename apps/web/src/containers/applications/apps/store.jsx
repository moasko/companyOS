import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { Icon, ToolBar } from "../../../utils/general";
import { useNomApp } from "../../../utils/nomsApps";
import { api } from "../../../api/client";
import { syncInstalledModules, moduleBySlug } from "../../../apps/sync";
import { scrollElementTo } from "../../../apps/scrollTo";
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
  { id: "catalogue", label: "Catalogue", icon: "faGrip" },
  { id: "misesajour", label: "Mises à jour", icon: "faCircleArrowUp" },
  { id: "installees", label: "Installées", icon: "faCircleCheck" },
  { id: "apropos", label: "À propos", icon: "faCircleInfo" },
];

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
    const q = query.trim().toLowerCase();
    return catalog.filter((a) => {
      if (filter !== "Tout" && a.category !== filter) return false;
      if (!q) return true;
      // On cherche dans le nom affiché comme dans le nom d'origine :
      // le mot que la personne connaît doit trouver son app.
      return (nomApp(a) + " " + a.name + " " + a.description)
        .toLowerCase()
        .includes(q);
    });
  }, [catalog, filter, query, nomApp]);

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
  /// module lui répond dans le shell. `rh` et `comptabilite` sont annoncées
  /// mais pas encore écrites : les proposer à l'installation donnait un
  /// « Installée » qui ne produisait rien à l'écran, puisque
  /// `syncInstalledModules` n'attache que ce qui existe dans le registre.
  /// Les apps du Studio n'ont pas de module : leur fenêtre est le moteur
  /// générique, elles sont donc toujours disponibles.
  const disponible = (app) => app.kind !== "NATIVE" || !!moduleBySlug[app.slug];

  const statusOf = (app) => {
    if (app.isCore) return { label: "Socle", tone: "core" };
    if (!disponible(app)) return { label: "Bientôt", tone: "soon" };
    if (!app.installed) return { label: "Disponible", tone: "idle" };
    return { label: "Installée", tone: "ok" };
  };

  return (
    <div
      className="boutique floatTab dpShad"
      data-size={wnapp.size}
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
              {/* Navigation latérale */}
              <aside className="btqNav">
                {SECTIONS.map((s) => (
                  <div
                    key={s.id}
                    className="btqNavItem handcr"
                    data-active={section === s.id}
                    onClick={() => goToSection(s.id)}
                  >
                    <Icon fafa={s.icon} width={13} />
                    <span>{s.label}</span>
                    {/* Une mise à jour en attente doit se voir sans avoir à
                        ouvrir l'onglet : c'est tout l'intérêt du suivi. */}
                    {s.id === "misesajour" && aMettreAJour.length ? (
                      <span className="btqPastille">{aMettreAJour.length}</span>
                    ) : null}
                  </div>
                ))}
              </aside>

              {/* Colonne centrale */}
              <div className="btqMain cosScroll" ref={mainRef}>
                <section ref={registerSection("catalogue")} className="btqSection" data-hidden={section !== "catalogue"}>
                  <h2>
                    <span className="btqNum">1.</span> Catalogue
                  </h2>
                  <p className="btqHint">
                    Modules de gestion disponibles pour {session.tenant?.name}
                  </p>

                  <div className="btqField">
                    <input
                      type="text"
                      placeholder="Rechercher un module…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>

                  <div className="btqChips">
                    {categories.map((cat) => (
                      <div
                        key={cat}
                        className="btqChip handcr"
                        data-active={filter === cat}
                        onClick={() => setFilter(cat)}
                      >
                        {cat}
                      </div>
                    ))}
                  </div>

                  {error ? <div className="btqWarn">{error}</div> : null}

                  {etat.initial || etat.erreur ? (
                    <Contenu etat={etat} vide={false} squelette="grille" lignes={9} />
                  ) : visible.length === 0 ? (
                    <div className="btqEmptyBox">Aucun module pour ce filtre.</div>
                  ) : (
                    <div className="btqGrid">
                      {visible.map((app) => {
                        const status = statusOf(app);
                        return (
                          <div
                            key={app.slug}
                            className="btqCard handcr"
                            data-active={selected === app.slug}
                            data-bientot={!disponible(app) ? "true" : "false"}
                            onClick={() => setSelected(app.slug)}
                          >
                            <div className="btqCardTop">
                              <Icon src={app.icon} width={34} />
                              <div className="btqCardHead">
                                <div className="btqName">{nomApp(app)}</div>
                                <div className="btqCat">{app.category}</div>
                              </div>
                            </div>
                            <div className="btqDesc">{app.description}</div>
                            <div className="btqCardFoot">
                              <div className="btqTag" data-tone={status.tone}>
                                {status.label}
                              </div>
                              {app.isCore ||
                              (!disponible(app) && !app.installed) ? null : (
                                <div
                                  className="btqAction handcr"
                                  data-installed={app.installed}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggle(app);
                                  }}
                                >
                                  {busySlug === app.slug
                                    ? "…"
                                    : app.installed
                                      ? "Désinstaller"
                                      : "Installer"}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section ref={registerSection("misesajour")} className="btqSection" data-hidden={section !== "misesajour"}>
                  <h2>
                    <span className="btqNum">2.</span> Mises à jour
                  </h2>
                  <p className="btqHint">
                    Ce que le shell livre, comparé à ce qui est enregistré
                    dans cet espace de travail
                  </p>

                  {/* L'erreur doit apparaître là où le geste a eu lieu : une
                      mise à jour refusée signalée dans l'onglet Catalogue
                      passe inaperçue, et le bouton semble ne rien faire. */}
                  {error ? <div className="btqWarn">{error}</div> : null}

                  {!aMettreAJour.length ? (
                    <div className="btqEmptyBox">
                      Toutes vos applications sont à jour.
                    </div>
                  ) : (
                    <>
                      <div className="btqMajTete">
                        <span>
                          {aMettreAJour.length} application
                          {aMettreAJour.length > 1 ? "s" : ""} à mettre à jour
                        </span>
                        <div
                          className="btqPrimary handcr"
                          data-off={!!busySlug}
                          onClick={toutMettreAJour}
                        >
                          Tout mettre à jour
                        </div>
                      </div>

                      {aMettreAJour.map((app) => {
                        const cible = versionLivree(app, moduleBySlug);
                        const notes = nouveautesDepuis(app, moduleBySlug);
                        return (
                          <div key={app.slug} className="btqMaj">
                            <Icon src={app.icon} width={26} />
                            <div className="btqMajInfo">
                              <div className="btqMajNom">{nomApp(app)}</div>
                              <div className="btqMajVersions">
                                {app.installedVersion ? (
                                  <>
                                    v{app.installedVersion}
                                    <Icon fafa="faArrowRight" width={8} />
                                  </>
                                ) : (
                                  "version inconnue → "
                                )}
                                <strong>v{cible}</strong>
                              </div>
                              {notes.length ? (
                                <ul className="btqMajNotes">
                                  {notes.map((n) => (
                                    <li key={n.version}>{n.texte}</li>
                                  ))}
                                </ul>
                              ) : (
                                <div className="btqMajVide">
                                  Reprise des données pour cette version.
                                </div>
                              )}
                            </div>
                            <div
                              className="btqPrimary handcr"
                              data-off={busySlug === app.slug}
                              onClick={() => mettreAJour(app)}
                            >
                              {busySlug === app.slug ? "…" : "Mettre à jour"}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </section>

                <section ref={registerSection("installees")} className="btqSection" data-hidden={section !== "installees"}>
                  <h2>
                    <span className="btqNum">3.</span> Installées
                  </h2>
                  <p className="btqHint">
                    Modules actifs dans cet espace de travail
                  </p>

                  <div className="btqList">
                    {installed.map((app) => {
                      const status = statusOf(app);
                      return (
                        <div key={app.slug} className="btqRow">
                          <Icon src={app.icon} width={22} />
                          <div className="btqRowInfo">
                            <div className="btqRowName">{nomApp(app)}</div>
                            <div className="btqRowMeta">
                              {app.category} · v
                              {app.installedVersion || versionLivree(app, moduleBySlug)}
                              {miseAJourDisponible(app, moduleBySlug) ? (
                                <em className="btqMajDispo">
                                  {" "}
                                  · v{versionLivree(app, moduleBySlug)} disponible
                                </em>
                              ) : null}
                            </div>
                          </div>
                          <div className="btqTag" data-tone={status.tone}>
                            {status.label}
                          </div>
                          {app.isCore ? null : (
                            <div
                              className="btqAction handcr"
                              data-installed
                              onClick={() => toggle(app)}
                            >
                              Retirer
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section ref={registerSection("apropos")} className="btqSection" data-hidden={section !== "apropos"}>
                  <h2>
                    <span className="btqNum">4.</span> À propos
                  </h2>
                  <p className="btqHint">
                    Comment fonctionnent les modules de CompanyOS
                  </p>
                  <div className="btqAbout">
                    <p>
                      Un module installé apparaît immédiatement sur le bureau et
                      dans le menu Démarrer de tout l'espace de travail. Un module
                      retiré disparaît de la même manière — ses données restent
                      conservées et reviennent à la réinstallation.
                    </p>
                    <p>
                      Les modules marqués « Module à venir » sont déjà réservés au
                      catalogue mais leur interface reste à livrer.
                    </p>
                  </div>
                </section>
              </div>

              {/* Panneau contextuel */}
              <aside className="btqSide cosScroll">
                <div className="btqSideTitle">
                  {detail ? "Module sélectionné" : "Votre espace"}
                </div>

                <div className="btqCardDetail">
                  {detail ? (
                    <>
                      <Icon src={detail.icon} width={48} />
                      <div className="btqDetailName">{nomApp(detail)}</div>
                      <div className="btqDetailCat">
                        {detail.category} · v{detail.version}
                      </div>
                      <div className="btqTag" data-tone={statusOf(detail).tone}>
                        {statusOf(detail).label}
                      </div>
                      <div className="btqDetailDesc">{detail.description}</div>

                      {/* Ce que l'application ira chercher hors de chez
                          elle. Déclaré dans son manifeste, montré avant
                          l'installation : l'utilisateur doit savoir ce
                          qu'il autorise. */}
                      {acces.length ? (
                        <div className="btqAcces">
                          <div className="btqAccesTitre">
                            <Icon fafa="faKey" width={11} /> Accès demandés
                          </div>
                          {acces.map((a) => (
                            <div className="btqAccesLigne" key={a.verbe}>
                              <b>{a.verbe}</b> {a.quoi.join(", ")}
                            </div>
                          ))}
                        </div>
                      ) : detail.kind === "NATIVE" ? (
                        <div className="btqAcces" data-neutre="true">
                          <div className="btqAccesTitre">
                            <Icon fafa="faLock" width={11} /> Aucun accès externe
                          </div>
                          <div className="btqAccesLigne">
                            Cette application ne lit que ses propres données.
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="btqDetailEmpty">
                      Sélectionnez un module pour voir sa fiche.
                    </div>
                  )}
                </div>

                {/* Module annoncé mais pas encore livré : on le dit, plutôt
                    que de proposer une installation sans effet. */}
                {detail && !detail.isCore && !disponible(detail) && !detail.installed ? (
                  <div className="btqBientot">
                    <Icon fafa="faHourglassHalf" width={13} />
                    <div>
                      <b>Bientôt disponible</b>
                      <span>
                        Ce module figure à la feuille de route. Il apparaîtra ici,
                        installable, dès qu'il sera prêt.
                      </span>
                    </div>
                  </div>
                ) : null}

                {detail && !detail.isCore && (disponible(detail) || detail.installed) ? (
                  <div
                    className="btqPrimary handcr"
                    data-off={busySlug === detail.slug}
                    data-installed={detail.installed}
                    onClick={() => toggle(detail)}
                  >
                    <Icon
                      fafa={detail.installed ? "faTrash" : "faDownload"}
                      width={12}
                    />
                    <span>
                      {busySlug === detail.slug
                        ? "…"
                        : detail.installed
                          ? "Désinstaller"
                          : "Installer le module"}
                    </span>
                  </div>
                ) : null}

                <div className="btqStats">
                  <div className="btqStat">
                    <div className="btqStatVal">{catalog.length}</div>
                    <div className="btqStatLbl">au catalogue</div>
                  </div>
                  <div className="btqStat">
                    <div className="btqStatVal">{installed.length}</div>
                    <div className="btqStatLbl">installés</div>
                  </div>
                  <div className="btqStat">
                    <div className="btqStatVal">
                      {optional.filter((a) => !a.installed).length}
                    </div>
                    <div className="btqStatLbl">à découvrir</div>
                  </div>
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

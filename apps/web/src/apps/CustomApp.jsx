import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "./ModuleWindow";
import { Icon } from "../utils/general";
import { api } from "../api/client";
import { saveAs } from "./cloud";
import { scrollElementTo } from "./scrollTo";
import { modal } from "./modalRequest";
import { Auteur } from "./Auteur";
import {
  TYPES,
  WIDGETS,
  affiche,
  calculerWidget,
  colonnesKanban,
  libelleFiche,
  parColonne,
  parSection,
  valeursCompletes,
} from "./modules/studio/domaine";
import "./customapp.scss";

// Moteur d'exécution des applications créées dans le Studio.
//
// Une app décrite n'a pas de code : elle déclare des collections et leurs
// champs, et ce composant en déduit la liste, le formulaire et le CRUD.
// Les données passent par api.records, donc rien à migrer côté serveur.

// L'affichage vient du domaine du Studio : les deux côtés doivent rendre
// exactement la même chose, sinon l'aperçu du concepteur mentirait sur ce
// que verra l'utilisateur.

const valeurVide = (champ) => (champ.type === "booleen" ? false : "");

const brouillonVide = (collection) =>
  Object.fromEntries(
    collection.fields
      .filter((f) => f.type !== "calcul")
      .map((f) => [f.key, valeurVide(f)]),
  );

export const CustomApp = ({ app }) => {
  const wnapp = useSelector((state) => state.apps[app.id || app.icon]);
  const session = useSelector((state) => state.session);

  const collections = app.definition?.collections || [];
  // La définition peut porter un tableau de bord : s'il existe, c'est le
  // premier écran — une app sans vue d'ensemble oblige à tout parcourir.
  const accueil = app.definition?.accueil || [];
  const pages = app.definition?.pages || [];
  const [vue, setVue] = useState(
    pages.length
      ? `__page:${pages[0].id}`
      : accueil.length
        ? "__accueil"
        : collections[0]?.key || "",
  );
  const collKey = vue.startsWith("__") ? collections[0]?.key || "" : vue;
  const [records, setRecords] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const mainRef = React.useRef(null);

  const collection = collections.find((c) => c.key === collKey) || collections[0] || null;

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 3000);
  };

  // Les fiches des collections vers lesquelles pointent les relations :
  // { [cleCollection]: [records] }. Sans elles, un champ « Client »
  // n'aurait rien à proposer et afficherait un identifiant brut.
  const [liees, setLiees] = useState({});
  // Les fiches de chaque collection qu'un pavé du tableau de bord observe.
  const [donneesAccueil, setDonneesAccueil] = useState({});

  useEffect(() => {
    if (!accueil.length && !pages.length) return;
    if (!wnapp || wnapp.hide || session.status !== "authenticated") return;
    const cibles = [
      ...new Set(
        [
          ...accueil.map((w) => w.collection),
          ...pages.flatMap((page) =>
            (page.composants || []).map((composant) => composant.collection),
          ),
        ].filter(Boolean),
      ),
    ];
    Promise.all(cibles.map((c) => api.records.list(app.slug, c).catch(() => []))).then(
      (listes) =>
        setDonneesAccueil(Object.fromEntries(cibles.map((c, i) => [c, listes[i]]))),
    );
  }, [wnapp?.hide, session.status, vue]);

  const load = async () => {
    if (!collection) return;
    try {
      setRecords(await api.records.list(app.slug, collection.key));

      const cibles = [
        ...new Set(
          collection.fields
            .filter((f) => f.type === "relation" && f.cible)
            .map((f) => f.cible),
        ),
      ];
      if (cibles.length) {
        const listes = await Promise.all(
          cibles.map((c) => api.records.list(app.slug, c).catch(() => [])),
        );
        setLiees(Object.fromEntries(cibles.map((c, i) => [c, listes[i]])));
      } else {
        setLiees({});
      }
    } catch (err) {
      flash(err.message);
    }
  };

  /// Ce qu'affiche une relation : le libellé de la fiche visée, pas son
  /// identifiant. `collections` sert à retrouver la définition de la cible.
  const libelleRelation = (champ, valeur) => {
    if (!valeur) return "—";
    const cible = collections.find((c) => c.key === champ.cible);
    // La collection liée n'est pas encore chargée : ne rien annoncer plutôt
    // que « fiche supprimée », qui accuserait à tort.
    if (liees[champ.cible] === undefined) return "…";
    const fiche = liees[champ.cible].find((r) => r.id === valeur);
    // Chargée, mais la fiche visée n'y est plus : là, elle a bien disparu.
    return fiche ? libelleFiche(cible, fiche) : "fiche supprimée";
  };

  /// Valeur affichable d'un champ, tous types confondus.
  const rendu = (champ, valeurs) =>
    champ.type === "relation"
      ? libelleRelation(champ, valeurs[champ.key])
      : affiche(champ, valeurs[champ.key]);

  useEffect(() => {
    if (wnapp && !wnapp.hide && session.status === "authenticated") load();
  }, [wnapp?.hide, session.status, collection?.key]);

  const changeCollection = (key) => {
    setVue(key);
    setSelectedId(null);
    setDraft(null);
    setQuery("");
    scrollElementTo(mainRef.current, 0);
  };

  const openNew = () => {
    setSelectedId(null);
    setDraft(brouillonVide(collection));
  };

  const openRecord = (record) => {
    setSelectedId(record.id);
    setDraft({ ...brouillonVide(collection), ...record.data });
  };

  // Mise à jour fonctionnelle : plusieurs champs peuvent changer avant le
  // rendu suivant, partir de `draft` capturé écraserait les précédents.
  const setField = (champ) => (e) => {
    const value =
      champ.type === "booleen"
        ? e.target.checked
        : champ.type === "nombre" || champ.type === "montant"
          ? e.target.value === ""
            ? ""
            : Number(e.target.value)
          : e.target.value;
    setDraft((d) => ({ ...d, [champ.key]: value }));
  };

  const save = async () => {
    const manquant = collection.fields.find(
      (f) => f.required && (draft[f.key] === "" || draft[f.key] === undefined),
    );
    if (manquant) {
      flash(`« ${manquant.label} » est obligatoire`);
      return;
    }
    setBusy(true);
    try {
      if (selectedId) {
        const updated = await api.records.update(
          app.slug,
          collection.key,
          selectedId,
          draft,
        );
        const executees = updated.automatisationsExecutees || [];
        setDraft(updated.data);
        flash(
          executees.length
            ? `Mis à jour · ${executees.length} automatisation${executees.length > 1 ? "s" : ""} exécutée${executees.length > 1 ? "s" : ""}`
            : "Enregistrement mis à jour",
        );
      } else {
        const created = await api.records.create(app.slug, collection.key, draft);
        const executees = created.automatisationsExecutees || [];
        setSelectedId(created.id);
        setDraft(created.data);
        flash(
          executees.length
            ? `Créé · ${executees.length} automatisation${executees.length > 1 ? "s" : ""} exécutée${executees.length > 1 ? "s" : ""}`
            : "Enregistrement créé",
        );
      }
      await load();
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selectedId) return;
    const ok = await modal.confirm({
      title: "Supprimer l'enregistrement",
      message: "Supprimer cet enregistrement ?",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.records.remove(app.slug, collection.key, selectedId);
      setSelectedId(null);
      setDraft(null);
      await load();
      flash("Enregistrement supprimé");
    } catch (err) {
      flash(err.message);
    }
  };

  /// Export CSV — le fichier part dans le cloud, comme partout dans l'OS.
  const exportCsv = async () => {
    if (!records.length || busy) return;
    setBusy(true);
    try {
      const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const header = collection.fields.map((f) => f.label);
      const rows = records.map((r) => {
        const valeurs = valeursCompletes(collection, r.data);
        // Le fichier reprend ce que l'écran montre — calculs résolus,
        // relations en clair. Un export d'identifiants ne servirait à
        // personne dans un tableur.
        return collection.fields.map((f) => escape(rendu(f, valeurs))).join(";");
      });
      // BOM UTF-8 pour qu'Excel lise correctement les accents.
      const csv = "﻿" + [header.map(escape).join(";"), ...rows].join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const node = await saveAs(blob, `${collection.key}.csv`, { folder: app.name });
      if (node) flash(`« ${node.name} » enregistré dans l'Explorateur`);
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Les trois premiers champs servent de colonnes dans la liste : au-delà
  // le tableau devient illisible dans une fenêtre.
  const colonnes = (collection?.fields || []).slice(0, 3);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => {
      const valeurs = valeursCompletes(collection, r.data);
      // Chercher sur ce qui est *affiché* : quelqu'un qui voit « Awa » dans
      // la colonne Client s'attend à la trouver en tapant « Awa », même si
      // la donnée stockée est un identifiant.
      return (collection.fields || []).some((f) =>
        String(rendu(f, valeurs) ?? "")
          .toLowerCase()
          .includes(q),
      );
    });
  }, [records, query, collection, liees]);

  if (!collection) {
    return (
      <ModuleWindow manifest={app} className="cstApp">
        <div className="cstLocked">
          Cette application n'a aucune collection. Modifiez-la dans le Studio.
        </div>
      </ModuleWindow>
    );
  }

  return (
    <ModuleWindow manifest={app} className="cstApp">
      {session.status !== "authenticated" ? (
        <div className="cstLocked">Connectez-vous pour utiliser cette application.</div>
      ) : (
        <div className="cstShell">
          {/* Barre latérale dès qu'il y a un tableau de bord ou plusieurs
              collections. Une app à une seule collection sans dashboard n'a
              rien à y mettre. */}
          {collections.length > 1 || accueil.length || pages.length ? (
            <aside className="cstNav">
              {pages.map((page) => (
                <div
                  key={page.id}
                  className="cstNavItem handcr"
                  data-active={vue === `__page:${page.id}`}
                  onClick={() => setVue(`__page:${page.id}`)}
                >
                  <Icon fafa="faFile" width={13} />
                  <span>{page.nom}</span>
                </div>
              ))}
              {accueil.length ? (
                <div
                  className="cstNavItem handcr"
                  data-active={vue === "__accueil"}
                  onClick={() => setVue("__accueil")}
                >
                  <Icon fafa="faChartPie" width={13} />
                  <span>Tableau de bord</span>
                </div>
              ) : null}
              {collections.map((c) => (
                <div
                  key={c.key}
                  className="cstNavItem handcr"
                  data-active={vue === c.key}
                  onClick={() => changeCollection(c.key)}
                >
                  <Icon fafa={c.icon || "faTable"} width={13} />
                  <span>{c.label}</span>
                </div>
              ))}
            </aside>
          ) : null}

          <div className="cstMain cosScroll" ref={mainRef}>
            {vue.startsWith("__page:") ? (
              <PageComposee
                page={pages.find((page) => `__page:${page.id}` === vue)}
                collections={collections}
                donnees={donneesAccueil}
                onNavigate={setVue}
                appSlug={app.slug}
              />
            ) : vue === "__accueil" ? (
              <TableauDeBord
                accueil={accueil}
                collections={collections}
                donnees={donneesAccueil}
              />
            ) : (
              <>
                <section className="cstSection">
                  <div className="cstSectionHead">
                    <div>
                      <h2>
                        <span className="cstNum">1.</span> {collection.label}
                      </h2>
                      <p className="cstHint">
                        {records.length} enregistrement{records.length > 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="cstHeadBtns">
                      <div className="cstBtnGhost handcr" onClick={openNew}>
                        Nouveau
                      </div>
                      <div
                        className="cstBtnGhost handcr"
                        data-off={!records.length || busy}
                        onClick={exportCsv}
                      >
                        Export CSV
                      </div>
                    </div>
                  </div>

                  <div className="cstField">
                    <input
                      type="text"
                      placeholder="Rechercher…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>

                  {visible.length === 0 ? (
                    <div className="cstEmptyBox">
                      {records.length === 0
                        ? "Aucun enregistrement. Créez le premier avec « Nouveau »."
                        : "Aucun résultat."}
                    </div>
                  ) : (
                    <VueCollection
                      collection={collection}
                      colonnes={colonnes}
                      records={visible}
                      selectedId={selectedId}
                      rendu={rendu}
                      onOuvrir={openRecord}
                    />
                  )}
                </section>

                <section className="cstSection">
                  <h2>
                    <span className="cstNum">2.</span> Fiche
                  </h2>
                  <p className="cstHint">
                    {draft
                      ? "Renseignez les champs, puis enregistrez"
                      : "Sélectionnez une ligne, ou créez un enregistrement"}
                  </p>

                  {!draft ? (
                    <div className="cstEmptyBox">Aucune fiche ouverte.</div>
                  ) : (
                    <>
                      <div className="cstGrid">
                        {collection.fields.map((champ, index) => {
                          const valeurs = valeursCompletes(collection, draft);
                          // Un titre de section quand elle change : c'est ce qui
                          // découpe une fiche à vingt champs en blocs lisibles.
                          const sectionPrec = collection.fields[index - 1]?.section || "";
                          const enTete =
                            (champ.section || "") &&
                            (champ.section || "") !== sectionPrec ? (
                              <div key={`s-${index}`} className="cstFicheSection">
                                {champ.section}
                              </div>
                            ) : null;
                          return (
                            <React.Fragment key={champ.key}>
                              {enTete}
                              <label
                                className="cstField"
                                data-large={
                                  champ.type === "zone" || champ.largeur === "plein"
                                }
                              >
                                <span className="cstLabel">
                                  {champ.label}
                                  {champ.required ? " *" : ""}
                                </span>
                                {champ.type === "zone" ? (
                                  <textarea
                                    rows={3}
                                    value={draft[champ.key] ?? ""}
                                    onChange={setField(champ)}
                                  />
                                ) : champ.type === "choix" ? (
                                  <select
                                    value={draft[champ.key] ?? ""}
                                    onChange={setField(champ)}
                                  >
                                    <option value="">—</option>
                                    {(champ.options || []).map((o) => (
                                      <option key={o} value={o}>
                                        {o}
                                      </option>
                                    ))}
                                  </select>
                                ) : champ.type === "booleen" ? (
                                  <label className="cstCheck handcr">
                                    <input
                                      type="checkbox"
                                      checked={!!draft[champ.key]}
                                      onChange={setField(champ)}
                                    />
                                    <span>Oui</span>
                                  </label>
                                ) : champ.type === "relation" ? (
                                  <select
                                    value={draft[champ.key] ?? ""}
                                    onChange={setField(champ)}
                                  >
                                    <option value="">—</option>
                                    {(liees[champ.cible] || []).map((r) => (
                                      <option key={r.id} value={r.id}>
                                        {libelleFiche(
                                          collections.find((c) => c.key === champ.cible),
                                          r,
                                        )}
                                      </option>
                                    ))}
                                  </select>
                                ) : champ.type === "calcul" ? (
                                  // Un calcul se lit, il ne se saisit pas. Il reste
                                  // visible dans la fiche parce que c'est souvent le
                                  // chiffre qui intéresse — le total à facturer.
                                  <output className="cstCalcul">
                                    {affiche(champ, valeurs[champ.key])}
                                  </output>
                                ) : (
                                  <input
                                    type={TYPES[champ.type]?.saisie || "text"}
                                    value={draft[champ.key] ?? ""}
                                    onChange={setField(champ)}
                                  />
                                )}
                              </label>
                            </React.Fragment>
                          );
                        })}
                      </div>

                      {/* Toute app du Studio hérite de la signature : ce sont
                      des fiches partagées, « qui a saisi ça » s'y pose
                      exactement comme ailleurs. */}
                      {selectedId ? (
                        <Auteur record={records.find((r) => r.id === selectedId)} />
                      ) : null}

                      <div className="cstFormActions">
                        <div className="cstPrimary handcr" data-off={busy} onClick={save}>
                          <Icon fafa="faFloppyDisk" width={11} />
                          <span>{busy ? "…" : "Enregistrer"}</span>
                        </div>
                        {selectedId ? (
                          <div className="cstBtnGhost cstDanger handcr" onClick={remove}>
                            Supprimer
                          </div>
                        ) : null}
                      </div>
                    </>
                  )}
                </section>
              </>
            )}
            {notice ? <div className="cstNotice">{notice}</div> : null}
          </div>
        </div>
      )}
    </ModuleWindow>
  );
};

// ---------------------------------------------------------------------------
// Vues d'une collection
// ---------------------------------------------------------------------------

/// Tableau, cartes ou kanban, selon `collection.vue.mode`. Le tableau reste
/// le défaut : c'est le plus dense, et une collection sans réglage l'obtient.
function VueCollection({ collection, colonnes, records, selectedId, rendu, onOuvrir }) {
  const mode = collection.vue?.mode || "liste";

  if (mode === "kanban" && collection.vue?.groupePar) {
    return (
      <VueKanban
        collection={collection}
        champKey={collection.vue.groupePar}
        records={records}
        selectedId={selectedId}
        rendu={rendu}
        onOuvrir={onOuvrir}
      />
    );
  }

  if (mode === "cartes") {
    const champsCarte = (
      collection.vue?.carte?.length ? collection.vue.carte : colonnes.map((c) => c.key)
    )
      .map((k) => collection.fields.find((f) => f.key === k))
      .filter(Boolean);
    return (
      <div className="cstCartes">
        {records.map((r) => {
          const valeurs = valeursCompletes(collection, r.data);
          return (
            <div
              key={r.id}
              className="cstCarte handcr"
              data-active={r.id === selectedId}
              onClick={() => onOuvrir(r)}
            >
              {champsCarte.map((f, i) => (
                <div key={f.key} className={i === 0 ? "cstCarteTitre" : "cstCarteLigne"}>
                  {i > 0 ? <span className="cstCarteLabel">{f.label}</span> : null}
                  <span>{rendu(f, valeurs)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="cstTable">
      <div
        className="cstTHead"
        style={{ gridTemplateColumns: `repeat(${colonnes.length}, 1fr)` }}
      >
        {colonnes.map((f) => (
          <div key={f.key}>{f.label}</div>
        ))}
      </div>
      {records.map((r) => {
        const valeurs = valeursCompletes(collection, r.data);
        return (
          <div
            key={r.id}
            className="cstTRow handcr"
            data-active={r.id === selectedId}
            style={{ gridTemplateColumns: `repeat(${colonnes.length}, 1fr)` }}
            onClick={() => onOuvrir(r)}
          >
            {colonnes.map((f) => (
              <div
                key={f.key}
                className="cstCell"
                data-aligne={TYPES[f.type]?.aligne ? "true" : "false"}
              >
                {rendu(f, valeurs)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/// Kanban : une colonne par valeur du champ de choix, dans l'ordre déclaré.
/// L'ordre est le flux de travail — « À faire → En cours → Fait » ne se lit
/// que dans ce sens.
function VueKanban({ collection, champKey, records, selectedId, rendu, onOuvrir }) {
  const colonnes = colonnesKanban(collection, champKey);
  const parCol = parColonne(records, champKey, colonnes);
  const titres = collection.fields.filter((f) => f.key !== champKey).slice(0, 2);

  return (
    <div className="cstKanban cosScroll">
      {colonnes.map((col) => {
        const fiches = parCol.get(col ?? "") || [];
        return (
          <div key={col ?? "__sans"} className="cstKColonne">
            <div className="cstKTitre">
              {col || "Sans valeur"} <em>{fiches.length}</em>
            </div>
            {fiches.map((r) => {
              const valeurs = valeursCompletes(collection, r.data);
              return (
                <div
                  key={r.id}
                  className="cstKCarte handcr"
                  data-active={r.id === selectedId}
                  onClick={() => onOuvrir(r)}
                >
                  {titres.map((f, i) => (
                    <div
                      key={f.key}
                      className={i === 0 ? "cstKCarteTitre" : "cstKCarteSous"}
                    >
                      {rendu(f, valeurs)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pages composées dans le Studio
// ---------------------------------------------------------------------------

function PageComposee({ page, collections, donnees, onNavigate, appSlug }) {
  if (!page) return null;
  return (
    <section className="cstSection cstPageComposee">
      <div className="cstPageGrid">
        {(page.composants || [])
          .filter((bloc) => !bloc.parentId)
          .map((bloc) => {
            const collection = collections.find((item) => item.key === bloc.collection);
            const records = donnees[bloc.collection] || [];
            return (
              <div
                key={bloc.id}
                className="cstPageBloc"
                data-background={bloc.style?.fond || "surface"}
                data-hide-tablet={Boolean(bloc.responsive?.tablet?.masque)}
                data-hide-mobile={Boolean(bloc.responsive?.mobile?.masque)}
                style={{
                  "--cst-bloc-width": `${bloc.style?.largeur || 50}%`,
                  "--cst-tablet-width": `${bloc.responsive?.tablet?.largeur || bloc.style?.largeur || 50}%`,
                  "--cst-mobile-width": `${bloc.responsive?.mobile?.largeur || bloc.responsive?.tablet?.largeur || bloc.style?.largeur || 50}%`,
                  "--cst-padding": `${bloc.style?.padding ?? 16}px`,
                  "--cst-tablet-padding": `${bloc.responsive?.tablet?.padding ?? bloc.style?.padding ?? 16}px`,
                  "--cst-mobile-padding": `${bloc.responsive?.mobile?.padding ?? bloc.responsive?.tablet?.padding ?? bloc.style?.padding ?? 16}px`,
                  textAlign:
                    bloc.style?.alignement === "centre"
                      ? "center"
                      : bloc.style?.alignement === "droite"
                        ? "right"
                        : "left",
                }}
              >
                {bloc.type === "titre" ? <h2>{bloc.label}</h2> : null}
                {bloc.type === "texte" ? <p>{bloc.label}</p> : null}
                {bloc.type === "bouton" ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (bloc.action?.type === "page" && bloc.action.cible) {
                        onNavigate(`__page:${bloc.action.cible}`);
                      }
                      if (bloc.action?.type === "collection" && bloc.action.cible) {
                        onNavigate(bloc.action.cible);
                      }
                    }}
                  >
                    {bloc.label}
                  </button>
                ) : null}
                {bloc.type === "compteur" ? (
                  <div className="cstPageMetric">
                    <span>{bloc.label}</span>
                    <strong>
                      {new Intl.NumberFormat("fr-FR").format(records.length)}
                    </strong>
                    <small>{collection?.label || "Données"}</small>
                  </div>
                ) : null}
                {bloc.type === "tableau" ? (
                  <div className="cstPageTable">
                    <strong>{bloc.label}</strong>
                    <div className="cstPageTableHead">
                      {(collection?.fields || []).slice(0, 4).map((field) => (
                        <span key={field.key}>{field.label}</span>
                      ))}
                    </div>
                    {records.slice(0, 5).map((record) => (
                      <div key={record.id} className="cstPageTableRow">
                        {(collection?.fields || []).slice(0, 4).map((field) => (
                          <span key={field.key}>
                            {affiche(field, record.values?.[field.key])}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : null}
                {bloc.type === "formulaire" ? (
                  <FormulaireCompose
                    appSlug={appSlug}
                    collection={collection}
                    titre={bloc.label}
                  />
                ) : null}
                {bloc.type === "conteneur" ? (
                  <div className="cstPageContainer">{bloc.label}</div>
                ) : null}
                {bloc.type === "section" ? (
                  <strong className="cstPageSectionTitle">{bloc.label}</strong>
                ) : null}
                {bloc.type === "image" ? (
                  bloc.source ? (
                    <img
                      className="cstPageImage"
                      src={bloc.source}
                      alt={bloc.label || ""}
                    />
                  ) : (
                    <div className="cstPageContainer">Image non configurée</div>
                  )
                ) : null}
                {bloc.type === "carte" ? (
                  <div className="cstPageCard">
                    <span>{bloc.label}</span>
                    <strong>
                      {records[0]
                        ? affiche(
                            collection?.fields?.[0] || { type: "texte" },
                            records[0].values?.[collection?.fields?.[0]?.key],
                          )
                        : "Aucune donnée"}
                    </strong>
                    <small>{collection?.label || "Collection"}</small>
                  </div>
                ) : null}
                {bloc.type === "liste" ? (
                  <div className="cstPageList">
                    <strong>{bloc.label}</strong>
                    {records.slice(0, 6).map((record) => (
                      <div key={record.id}>
                        <i />
                        <span>
                          {affiche(
                            collection?.fields?.[0] || { type: "texte" },
                            record.values?.[collection?.fields?.[0]?.key],
                          )}
                        </span>
                        <small>{collection?.label}</small>
                      </div>
                    ))}
                  </div>
                ) : null}
                {bloc.type === "graphique" ? (
                  <div className="cstPageChart">
                    <strong>{bloc.label}</strong>
                    <div>
                      {(records.length ? records.slice(0, 8) : [1, 2, 3, 4, 5]).map(
                        (record, index) => (
                          <i
                            key={record.id || index}
                            style={{
                              height: `${28 + ((index * 19 + records.length * 7) % 68)}%`,
                            }}
                          />
                        ),
                      )}
                    </div>
                    <small>
                      {records.length} élément{records.length > 1 ? "s" : ""}
                    </small>
                  </div>
                ) : null}
                {bloc.type === "badge" ? (
                  <span className="cstPageBadge">{bloc.label || "Nouveau"}</span>
                ) : null}
                {bloc.type === "separateur" ? (
                  <div className="cstPageSeparator">
                    <span>{bloc.label}</span>
                  </div>
                ) : null}
                {["section", "conteneur"].includes(bloc.type) ? (
                  <div
                    className="cstNestedZone"
                    data-direction={bloc.style?.direction || "ligne"}
                    style={{
                      "--cst-nested-gap": `${bloc.style?.gap ?? 12}px`,
                      "--cst-nested-columns": bloc.style?.colonnes || 2,
                    }}
                  >
                    {(page.composants || [])
                      .filter((enfant) => enfant.parentId === bloc.id)
                      .map((enfant) => (
                        <BlocImbrique
                          key={enfant.id}
                          bloc={enfant}
                          page={page}
                          collections={collections}
                          donnees={donnees}
                          onNavigate={onNavigate}
                          appSlug={appSlug}
                        />
                      ))}
                  </div>
                ) : null}
              </div>
            );
          })}
      </div>
    </section>
  );
}

function BlocImbrique({ bloc, page, collections, donnees, onNavigate, appSlug }) {
  const collection = collections.find((item) => item.key === bloc.collection);
  const records = donnees[bloc.collection] || [];
  const enfants = (page.composants || []).filter((item) => item.parentId === bloc.id);
  const estSection = ["section", "conteneur"].includes(bloc.type);
  return (
    <div
      className="cstPageBloc cstPageBlocNested"
      data-background={bloc.style?.fond || "surface"}
      data-hide-tablet={Boolean(bloc.responsive?.tablet?.masque)}
      data-hide-mobile={Boolean(bloc.responsive?.mobile?.masque)}
      style={{
        "--cst-bloc-width": `${bloc.style?.largeur || 50}%`,
        "--cst-tablet-width": `${bloc.responsive?.tablet?.largeur || bloc.style?.largeur || 50}%`,
        "--cst-mobile-width": `${bloc.responsive?.mobile?.largeur || bloc.responsive?.tablet?.largeur || bloc.style?.largeur || 50}%`,
        "--cst-padding": `${bloc.style?.padding ?? 16}px`,
        "--cst-tablet-padding": `${bloc.responsive?.tablet?.padding ?? bloc.style?.padding ?? 16}px`,
        "--cst-mobile-padding": `${bloc.responsive?.mobile?.padding ?? bloc.responsive?.tablet?.padding ?? bloc.style?.padding ?? 16}px`,
      }}
    >
      {bloc.type === "titre" ? <h2>{bloc.label}</h2> : null}
      {bloc.type === "texte" ? <p>{bloc.label}</p> : null}
      {bloc.type === "badge" ? <span className="cstPageBadge">{bloc.label}</span> : null}
      {bloc.type === "image" && bloc.source ? (
        <img className="cstPageImage" src={bloc.source} alt={bloc.label || ""} />
      ) : null}
      {bloc.type === "compteur" ? (
        <div className="cstPageMetric">
          <span>{bloc.label}</span>
          <strong>{records.length}</strong>
          <small>{collection?.label}</small>
        </div>
      ) : null}
      {bloc.type === "bouton" ? (
        <button
          type="button"
          onClick={() =>
            bloc.action?.cible &&
            onNavigate(
              bloc.action.type === "page"
                ? `__page:${bloc.action.cible}`
                : bloc.action.cible,
            )
          }
        >
          {bloc.label}
        </button>
      ) : null}
      {bloc.type === "separateur" ? (
        <div className="cstPageSeparator">
          <span>{bloc.label}</span>
        </div>
      ) : null}
      {estSection ? (
        <>
          <strong className="cstPageSectionTitle">{bloc.label}</strong>
          <div
            className="cstNestedZone"
            data-direction={bloc.style?.direction || "ligne"}
            style={{
              "--cst-nested-gap": `${bloc.style?.gap ?? 12}px`,
              "--cst-nested-columns": bloc.style?.colonnes || 2,
            }}
          >
            {enfants.map((enfant) => (
              <BlocImbrique
                key={enfant.id}
                bloc={enfant}
                page={page}
                collections={collections}
                donnees={donnees}
                onNavigate={onNavigate}
                appSlug={appSlug}
              />
            ))}
          </div>
        </>
      ) : null}
      {bloc.type === "formulaire" ? (
        <FormulaireCompose appSlug={appSlug} collection={collection} titre={bloc.label} />
      ) : null}
      {["carte", "liste", "graphique", "tableau"].includes(bloc.type) ? (
        <div className="cstPageContainer">
          {bloc.label} · {records.length} élément{records.length > 1 ? "s" : ""}
        </div>
      ) : null}
    </div>
  );
}

function FormulaireCompose({ appSlug, collection, titre }) {
  const champs = (collection?.fields || []).filter((field) => field.type !== "calcul");
  const [valeurs, setValeurs] = useState(() =>
    Object.fromEntries(champs.map((field) => [field.key, valeurVide(field)])),
  );
  const [etat, setEtat] = useState("");
  const envoyer = async (event) => {
    event.preventDefault();
    if (!appSlug || !collection) return;
    setEtat("Enregistrement…");
    try {
      await api.records.create(appSlug, collection.key, valeurs);
      setValeurs(
        Object.fromEntries(champs.map((field) => [field.key, valeurVide(field)])),
      );
      setEtat("Enregistré");
    } catch (error) {
      setEtat(error.message || "Échec de l’enregistrement");
    }
  };
  if (!collection)
    return <div className="cstPageContainer">Choisissez une collection.</div>;
  return (
    <form className="cstPageForm" onSubmit={envoyer}>
      <strong>{titre}</strong>
      {champs.slice(0, 8).map((field) => (
        <label key={field.key}>
          <span>{field.label}</span>
          {field.type === "choix" ? (
            <select
              value={valeurs[field.key] ?? ""}
              required={field.required}
              onChange={(event) =>
                setValeurs((courantes) => ({
                  ...courantes,
                  [field.key]: event.target.value,
                }))
              }
            >
              <option value="">Choisir…</option>
              {(field.options || []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : field.type === "booleen" ? (
            <input
              type="checkbox"
              checked={Boolean(valeurs[field.key])}
              onChange={(event) =>
                setValeurs((courantes) => ({
                  ...courantes,
                  [field.key]: event.target.checked,
                }))
              }
            />
          ) : (
            <input
              type={TYPES[field.type]?.saisie || "text"}
              value={valeurs[field.key] ?? ""}
              required={field.required}
              onChange={(event) =>
                setValeurs((courantes) => ({
                  ...courantes,
                  [field.key]: event.target.value,
                }))
              }
            />
          )}
        </label>
      ))}
      <div className="cstPageFormActions">
        <small>{etat}</small>
        <button type="submit">Enregistrer</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------------

function TableauDeBord({ accueil, collections, donnees }) {
  return (
    <section className="cstSection">
      <h2>
        <span className="cstNum">◆</span> Tableau de bord
      </h2>
      <div className="cstWidgets">
        {accueil.map((w, i) => {
          const collection = collections.find((c) => c.key === w.collection);
          const records = donnees[w.collection] || [];
          const res = calculerWidget(w, records, collection);
          return (
            <div key={i} className="cstWidget" data-large={res.format === "repartition"}>
              <div className="cstWidgetTitre">
                {w.titre || WIDGETS[w.type]?.label || "Indicateur"}
              </div>
              {res.format === "repartition" ? (
                <div className="cstWidgetParts">
                  {res.parts.map((p) => (
                    <div key={p.libelle} className="cstWidgetPart">
                      <span className="cstWidgetPartNom">{p.libelle}</span>
                      <span className="cstWidgetPiste">
                        <span
                          className="cstWidgetRemplie"
                          style={{ width: `${res.total ? (p.n / res.total) * 100 : 0}%` }}
                        />
                      </span>
                      <b>{p.n}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="cstWidgetValeur">
                  {res.format === "montant"
                    ? affiche({ type: "montant" }, res.valeur)
                    : new Intl.NumberFormat("fr-FR").format(res.valeur)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

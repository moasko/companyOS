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
  const [vue, setVue] = useState(accueil.length ? "__accueil" : collections[0]?.key || "");
  const collKey = vue === "__accueil" ? collections[0]?.key || "" : vue;
  const [records, setRecords] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const mainRef = React.useRef(null);

  const collection =
    collections.find((c) => c.key === collKey) || collections[0] || null;

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
    if (!accueil.length) return;
    if (!wnapp || wnapp.hide || session.status !== "authenticated") return;
    const cibles = [...new Set(accueil.map((w) => w.collection))];
    Promise.all(
      cibles.map((c) => api.records.list(app.slug, c).catch(() => [])),
    ).then((listes) =>
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
        await api.records.update(app.slug, collection.key, selectedId, draft);
        flash("Enregistrement mis à jour");
      } else {
        const created = await api.records.create(app.slug, collection.key, draft);
        setSelectedId(created.id);
        flash("Enregistrement créé");
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
          {collections.length > 1 || accueil.length ? (
            <aside className="cstNav">
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
            {vue === "__accueil" ? (
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
                        (champ.section || "") && (champ.section || "") !== sectionPrec ? (
                          <div key={`s-${index}`} className="cstFicheSection">
                            {champ.section}
                          </div>
                        ) : null;
                      return (
                      <React.Fragment key={champ.key}>
                      {enTete}
                      <label
                        className="cstField"
                        data-large={champ.type === "zone" || champ.largeur === "plein"}
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
                          <select value={draft[champ.key] ?? ""} onChange={setField(champ)}>
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
                          <select value={draft[champ.key] ?? ""} onChange={setField(champ)}>
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
    const champsCarte = (collection.vue?.carte?.length
      ? collection.vue.carte
      : colonnes.map((c) => c.key)
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
                    <div key={f.key} className={i === 0 ? "cstKCarteTitre" : "cstKCarteSous"}>
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

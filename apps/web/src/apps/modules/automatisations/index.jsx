// Automatisations — « quand ceci arrive dans une app, faire cela dans une
// autre ».
//
// L'écran des administrateurs : la liste des automatisations de l'espace
// (actives ou en pause, avec leurs résultats), le catalogue des recettes
// prêtes à l'emploi, l'éditeur et l'historique des exécutions.
//
// L'exécution est faite par le serveur (apps/api/src/moteurAutomatisations.js)
// après chaque écriture de fiche ; les règles de forme et les recettes
// sont partagées (packages/shared/src/automatisations.js).

import React, { useCallback, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { libelleCollection, RECETTES } from "@companyos/shared/automatisations";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { depuis } from "../../notifications";
import { Contenu, useChargement } from "../../chargement";
import { Bouton, Notice, Vide } from "../../ui";
import { useTraduction } from "../../../utils/intl";
import { Editeur } from "./Editeur";
import { TEXTES } from "./textes";
import "./automatisations.scss";
import { manifest as descriptif } from "./manifest";

const ICONE_APP = {
  crm: "faHandshake",
  projets: "faTableColumns",
  facturation: "faFileInvoice",
  rh: "faUserTie",
  conges: "faUmbrellaBeach",
  frais: "faReceipt",
  stock: "faBoxesStacked",
  achats: "faCartShopping",
};

const ICONE_ACTION = {
  notifier: "faBell",
  creer: "faPlus",
  modifier: "faPen",
  tache: "faListCheck",
  courriel: "faEnvelope",
  webhook: "faPlug",
};

const VIDE = () => ({
  nom: "",
  active: true,
  declencheur: { module: "crm", collection: "opportunites", evenement: "creation" },
  toutes: true,
  conditions: [],
  actions: [{ type: "notifier", destinataires: { mode: "admins" }, titre: "", message: "" }],
});

const copie = (x) => JSON.parse(JSON.stringify(x));

/// Une ligne de la liste : quoi, quand, et comment ça se passe.
const Carte = ({ t, a, onBasculer, onModifier, onHistorique, onSupprimer, histOuvert, historique }) => (
  <article className="autCarte" data-active={a.active ? "true" : "false"}>
    <div className="autCarteTete">
      <button type="button" className="autBascule" role="switch" aria-checked={a.active} onClick={() => onBasculer(a)} title={a.active ? t("active") : t("enPause")}>
        <span />
      </button>
      <div className="autCarteCorps" onClick={() => onModifier(a)}>
        <strong>{a.nom}</strong>
        <span className="autMuted">
          {t(`ev_${a.declencheur.evenement}`)} · {libelleCollection(a.declencheur.module, a.declencheur.collection)}
        </span>
      </div>
      <div className="autActionsIcones" aria-hidden="true">
        {a.actions.map((x, i) => (
          <span key={i} className="autPuce" title={t(`act_${x.type}`)}>
            <Icon fafa={ICONE_ACTION[x.type] || "faBolt"} width={11} />
          </span>
        ))}
      </div>
    </div>
    <div className="autCartePied">
      <span className="autMuted">
        {a.stats.derniereExecution ? t("derniere", { quand: depuis(new Date(a.stats.derniereExecution).getTime()) }) : t("jamais")}
        {a.stats.executions ? ` · ${t("executions", { n: a.stats.executions })}` : ""}
      </span>
      {a.stats.echecs ? <span className="autEchec">{t("echecs", { n: a.stats.echecs })}</span> : null}
      <span className="autEspace" />
      <button type="button" className="autLien" onClick={() => onHistorique(a)}>{t("historique")}</button>
      <button type="button" className="autLien" onClick={() => onModifier(a)}>{t("modifier")}</button>
      <button type="button" className="autLien autLienDanger" onClick={() => onSupprimer(a)}>{t("supprimer")}</button>
    </div>
    {histOuvert ? <Historique t={t} liste={historique} /> : null}
  </article>
);

const Historique = ({ t, liste }) => {
  if (!liste) return <div className="autHist autMuted">…</div>;
  if (!liste.length) return <div className="autHist autMuted">{t("histVide")}</div>;
  return (
    <ul className="autHist">
      {liste.map((h) => (
        <li key={h.id} data-statut={h.statut}>
          <div className="autHistTete">
            <Icon fafa={h.statut === "ok" ? "faCircleCheck" : "faCircleExclamation"} width={12} />
            <strong>{t(h.statut === "ok" ? "ok" : "erreur")}</strong>
            <span className="autMuted">
              {t(`ev_${h.evenement?.evenement}`)}
              {h.evenement?.auteur ? ` · ${t("par", { nom: h.evenement.auteur })}` : ""}
            </span>
            <span className="autEspace" />
            <span className="autMuted">{depuis(new Date(h.creeLe).getTime())}</span>
          </div>
          <ul className="autHistActions">
            {(h.resultats || []).map((r, i) => (
              <li key={i} data-ok={r.ok ? "true" : "false"}>
                <Icon fafa={ICONE_ACTION[r.type] || "faBolt"} width={10} />
                <span>{r.detail}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
};

function AutomatisationsApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const admin = ["OWNER", "ADMIN"].includes(session.user?.role);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated" && admin;
  const t = useTraduction(TEXTES);

  const [vue, setVue] = useState("liste");
  const [liste, setListe] = useState([]);
  const [membres, setMembres] = useState([]);
  const [edition, setEdition] = useState(null); // { id?, brouillon, recette? }
  const [histOuvert, setHistOuvert] = useState(null);
  const [historique, setHistorique] = useState(null);
  const [info, setInfo] = useState(null);

  const charger = useCallback(async () => {
    const [l, m] = await Promise.all([api.automatisations.list(), api.members().catch(() => [])]);
    setListe(l);
    setMembres(m);
  }, []);
  const etat = useChargement(ouvert, charger);

  const recettesUtilisees = useMemo(() => new Set(liste.map((a) => a.recette).filter(Boolean)), [liste]);

  const signaler = (texte, ton = "succes") => {
    setInfo({ texte, ton });
    setTimeout(() => setInfo((x) => (x?.texte === texte ? null : x)), 3500);
  };

  const basculer = async (a) => {
    try {
      const maj = await api.automatisations.activer(a.id, !a.active);
      setListe((l) => l.map((x) => (x.id === a.id ? maj : x)));
      signaler(t(maj.active ? "activee" : "pausee"));
    } catch (e) {
      signaler(e.message, "erreur");
    }
  };

  const supprimer = async (a) => {
    const ok = await modal.confirm({
      title: t("supprimerTitre"),
      message: t("supprimerMsg", { nom: a.nom }),
      confirmLabel: t("supprimer"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.automatisations.remove(a.id);
      setListe((l) => l.filter((x) => x.id !== a.id));
    } catch (e) {
      signaler(e.message, "erreur");
    }
  };

  const voirHistorique = async (a) => {
    if (histOuvert === a.id) {
      setHistOuvert(null);
      return;
    }
    setHistOuvert(a.id);
    setHistorique(null);
    try {
      setHistorique(await api.automatisations.historique(a.id));
    } catch {
      setHistorique([]);
    }
  };

  const modifier = (a) =>
    setEdition({
      id: a.id,
      brouillon: copie({ nom: a.nom, active: a.active, declencheur: a.declencheur, toutes: a.toutes !== false, conditions: a.conditions || [], actions: a.actions || [] }),
    });

  const enregistrer = async (brouillon) => {
    const corps = { ...brouillon, ...(edition?.recette ? { recette: edition.recette } : {}) };
    const sauvee = edition?.id ? await api.automatisations.update(edition.id, corps) : await api.automatisations.create(corps);
    setListe((l) => (edition?.id ? l.map((x) => (x.id === sauvee.id ? sauvee : x)) : [sauvee, ...l]));
    setEdition({ id: sauvee.id, brouillon: copie(brouillon) });
    signaler(t("enregistree"));
    return sauvee;
  };

  if (!wnapp) return null;

  if (!admin) {
    return (
      <ModuleWindow manifest={manifest} className="autApp">
        <Vide icone="faLock" titre={t("reserve")} aide={t("reserveAide")} />
      </ModuleWindow>
    );
  }

  return (
    <ModuleWindow manifest={manifest} className="autApp">
      {edition ? (
        <Editeur
          t={t}
          id={edition.id}
          initial={edition.brouillon}
          membres={membres}
          onRetour={() => setEdition(null)}
          onEnregistrer={enregistrer}
        />
      ) : (
        <div className="autCoquille">
          <header className="autEntete">
            <div>
              <h1>{t("titre")}</h1>
              <p className="autMuted">{t("sousTitre")}</p>
            </div>
            <Bouton icone="faPlus" onClick={() => setEdition({ brouillon: VIDE() })}>
              {t("nouvelle")}
            </Bouton>
          </header>
          <nav className="autOnglets" role="tablist">
            {[
              ["liste", t("vueListe"), liste.length],
              ["recettes", t("vueRecettes"), RECETTES.length],
            ].map(([id, libelle, n]) => (
              <button key={id} type="button" role="tab" aria-selected={vue === id} className="autOnglet" onClick={() => setVue(id)}>
                {libelle}
                <span className="autCompte">{n}</span>
              </button>
            ))}
          </nav>
          {info ? (
            <div className="autInfo">
              <Notice ton={info.ton}>{info.texte}</Notice>
            </div>
          ) : null}
          <div className="autCorps cosScroll">
            <Contenu etat={etat} vide={false} lignes={4}>
              {vue === "liste" ? (
                liste.length ? (
                  <div className="autListe">
                    {liste.map((a) => (
                      <Carte
                        key={a.id}
                        t={t}
                        a={a}
                        onBasculer={basculer}
                        onModifier={modifier}
                        onHistorique={voirHistorique}
                        onSupprimer={supprimer}
                        histOuvert={histOuvert === a.id}
                        historique={historique}
                      />
                    ))}
                  </div>
                ) : (
                  <Vide icone="faBolt" titre={t("aucune")} aide={t("aucuneAide")}>
                    <Bouton variante="secondaire" onClick={() => setVue("recettes")}>
                      {t("voirRecettes")}
                    </Bouton>
                  </Vide>
                )
              ) : (
                <>
                  <p className="autMuted autIntro">{t("recettesAide")}</p>
                  <div className="autRecettes">
                    {RECETTES.map((r) => (
                      <article key={r.id} className="autRecette">
                        <div className="autRecetteApps">
                          {r.apps.map((app, i) => (
                            <React.Fragment key={app}>
                              {i ? <Icon fafa="faArrowRight" width={9} /> : null}
                              <span className="autPuce" title={app}>
                                <Icon fafa={ICONE_APP[app] || "faCube"} width={12} />
                              </span>
                            </React.Fragment>
                          ))}
                        </div>
                        <strong>{r.titre}</strong>
                        <p className="autMuted">{r.description}</p>
                        <div className="autRecettePied">
                          {recettesUtilisees.has(r.id) ? <span className="autMuted">{t("dejaUtilisee")}</span> : null}
                          <span className="autEspace" />
                          <Bouton variante="secondaire" onClick={() => setEdition({ brouillon: copie({ active: true, toutes: true, ...r.automatisation }), recette: r.id })}>
                            {t("utiliser")}
                          </Bouton>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </Contenu>
          </div>
        </div>
      )}
    </ModuleWindow>
  );
}

export const manifest = { ...descriptif, Window: AutomatisationsApp };

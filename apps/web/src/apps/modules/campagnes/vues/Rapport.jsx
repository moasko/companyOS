// Campagnes — le rapport d'une campagne programmée, en cours ou terminée.

import React, { useMemo, useState } from "react";
import { Icon } from "../../../../utils/general";
import { suivreLien } from "../../../notifications";
import * as D from "@companyos/shared/campagnes";
import { Bouton, Carte, Entete, Etiquette, Kpi, Onglets, Recherche, Statut, telecharger, useC, useImagesCloud } from "../commun";

const FILTRES = ["tous", "ouverts", "cliques", "nonOuverts", "echecs", "desinscrits"];

export const Rapport = () => {
  const s = useC();
  const { t, n, pct, argent, dateHeure, heure, dateCourte, campagnes, factures, intention, peutEcrire, aller, supprimerCampagne, annulerProgrammation, pause, reprendre, reessayer, occupe } = s;
  const fiche = campagnes.find((c) => c.id === intention?.id);
  const [filtre, setFiltre] = useState("tous");
  const [recherche, setRecherche] = useState("");
  const [limite, setLimite] = useState(50);
  const c = useMemo(() => fiche?.data || {}, [fiche]);
  const dests = c.destinataires || [];
  const r = D.resumeDe(dests);
  const liens = useMemo(() => D.liensDe(c), [c]);
  const clics = useMemo(() => D.clicsParLien(c, liens.length), [c, liens.length]);
  const ventes = useMemo(() => D.ventesAttribuees(c, factures), [c, factures]);
  const totalVentes = ventes.reduce((x, v) => x + v.montant, 0);
  const ab = c.ab?.actif ? D.resultatsAB(c) : null;
  const courbe = useMemo(() => D.ouverturesParHeure(c), [c]);

  if (!fiche) {
    return (
      <div className="cmpVue">
        <Entete titre={t("navCampagnes")} retour={{ section: "campagnes", label: t("navCampagnes") }} />
        <div className="cmpConteneur"><p className="cmpRien">{t("campagneIntrouvable")}</p></div>
      </div>
    );
  }

  const nonOuverts = dests.filter(D.FILTRES_DESTINATAIRES.nonOuverts.garde).length;
  const cliqueurs = Math.max(1, r.cliques);
  const rebondsDef = dests.filter((d) => d.rebond === "definitif").length;
  const enReessai = dests.filter((d) => d.statut === "attente" && d.essais).length;
  const autresEchecs = dests.filter((d) => d.statut === "echec" && !d.rebond && !d.desinscrit).length;

  const sous =
    c.statut === "programmee"
      ? c.envoyerLe ? t("departPrevu", { quand: dateHeure(c.envoyerLe) }) : t("departMinute")
      : ["envoi", "pause"].includes(c.statut)
        ? t("envoiEnCours", { a: n(r.envoyes + r.echecs), b: n(r.total), p: r.pourcent })
        : t("envoyeeLe", { quand: dateHeure(c.envoyerLe || c.creeLe), fin: c.termineeLe ? heure(c.termineeLe) : "" });

  const exporter = () =>
    telecharger(`﻿${D.csvDe(c, [t("nom"), t("email"), t("ville"), t("statut"), t("version"), t("ouvertLe"), t("cliqueLe"), t("desinscrit"), t("erreur")])}`, `${(c.nom || "campagne").replace(/[\\/:*?"<>|]/g, "-")}.csv`, "text/csv;charset=utf-8");

  const options = FILTRES.map((id) => ({ id, label: t(`filtre_${id}`), nb: dests.filter(D.FILTRES_DESTINATAIRES[id].garde).length }));
  const q = recherche.trim().toLowerCase();
  const liste = dests.filter(D.FILTRES_DESTINATAIRES[filtre].garde).filter((d) => !q || [d.nom, d.email, d.ville].some((v) => String(v || "").toLowerCase().includes(q)));

  const brut = Math.max(1, ...courbe.cases.map((x) => x.n));
  const max = brut <= 4 ? 4 : [10, 20, 50, 100, 200, 500, 1000].find((m) => m >= brut) || Math.ceil(brut / 1000) * 1000;
  const pic = courbe.cases.reduce((m, x) => (x.n > m.n ? x : m), { n: 0 });

  return (
    <div className="cmpVue">
      <Entete titre={c.nom || t("sansNom")} sous={sous} retour={{ section: "campagnes", label: t("navCampagnes") }}>
        <Statut statut={c.statut} />
        {r.total ? <Bouton icone="faFileArrowDown" onClick={exporter}>{t("exporter")}</Bouton> : null}
        {peutEcrire ? <Bouton icone="faClone" onClick={() => aller("editeur", { initial: D.dupliquer(c), cle: Date.now() })}>{t("dupliquer")}</Bouton> : null}
        {peutEcrire && c.statut === "programmee" ? <Bouton icone="faBan" onClick={() => annulerProgrammation(fiche)}>{t("annulerProg")}</Bouton> : null}
        {peutEcrire && ["envoi", "programmee"].includes(c.statut) ? <Bouton icone="faPause" disabled={occupe} onClick={() => pause(fiche)}>{t("mettrePause")}</Bouton> : null}
        {peutEcrire && c.statut === "pause" ? <Bouton variante="principal" icone="faPlay" disabled={occupe} onClick={() => reprendre(fiche)}>{t("reprendreEnvoi")}</Bouton> : null}
        {peutEcrire && c.statut === "terminee" && nonOuverts ? <Bouton variante="principal" icone="faRotateRight" onClick={() => aller("editeur", { initial: D.relanceDe(c), cle: Date.now() })}>{t("relancerNonOuvreurs", { n: n(nonOuverts) })}</Bouton> : null}
        {peutEcrire ? <button type="button" className="cmpIcone" aria-label={t("supprimer")} title={t("supprimer")} onClick={() => supprimerCampagne(fiche)}><Icon fafa="faTrashCan" width={12} /></button> : null}
      </Entete>

      <div className="cmpConteneur">
        {["envoi", "pause"].includes(c.statut) ? (
          <div className="cmpProgression" role="progressbar" aria-valuenow={r.pourcent} aria-valuemin={0} aria-valuemax={100} aria-label={t("progression")} data-pause={c.statut === "pause" || undefined}>
            <span style={{ width: `${r.pourcent}%` }} />
          </div>
        ) : null}

        {ab ? (
          <section className="cmpAB" aria-label={t("testAB")}>
            {["A", "B"].map((v) => (
              <div key={v} className="cmpVariante" data-gagnant={ab.gagnant === v || undefined}>
                <div className="cmpVarianteTete">
                  <b>{t("versionN", { v, n: n(ab[v].envoyes) })}</b>
                  {ab.gagnant === v ? <Etiquette ton="vert">{t("gagnant")}</Etiquette> : null}
                </div>
                <span className="cmpVarianteObjet">{v === "A" ? c.sujet : c.ab.sujetB}</span>
                <div className="cmpVarianteChiffres">
                  <span><small>{t("ouverture")}</small><b>{pct(ab[v].tauxOuverture)}</b></span>
                  <span><small>{t("clics")}</small><b>{pct(ab[v].tauxClic)}</b></span>
                </div>
              </div>
            ))}
            {!ab.gagnant ? <p className="cmpEncadre">{t("abEnCours", { heures: c.ab.heures })}</p> : null}
          </section>
        ) : null}

        <section className="cmpKpis cmpKpis5">
          <Kpi label={t("delivres")} valeur={n(r.envoyes)} aide={r.total ? t("pctEnvoyes", { p: Math.round((r.envoyes / r.total) * 100) }) : ""} />
          <Kpi label={t("ouverture")} valeur={pct(r.tauxOuverture)} aide={t("ouverturesRobots")} />
          <Kpi label={t("clics")} valeur={pct(r.tauxClic)} aide={r.ouverts ? t("pctOuvreurs", { p: Math.round((r.cliques / r.ouverts) * 100) }) : "—"} />
          <Kpi label={t("desinscriptions")} valeur={pct(r.envoyes ? Math.round((r.desinscrits / r.envoyes) * 1000) / 10 : 0)} aide={t("nContacts", { n: n(r.desinscrits) })} />
          <Kpi label={t("caAttribue")} valeur={argent(totalVentes)} aide={t("nFactures", { n: ventes.length })} ton={totalVentes ? "vert" : ""} />
        </section>

        <div className="cmpGrille">
          <Carte titre={t("carteClics")} aide={t("carteClicsAide")} className="cmpCarteClics">
            <CarteDesClics campagne={c} clics={clics} cliqueurs={cliqueurs} />
          </Carte>

          <div className="cmpColonne cmpColonneLarge">
            <Carte titre={t("liens")}>
              {liens.length ? (
                <ul className="cmpLiens">
                  {liens.map((l, i) => (
                    <li key={i}>
                      <span className="cmpQui"><b className="cmpEllipse">{l.label}</b><small className="cmpDoux cmpEllipse">{l.url}</small></span>
                      <b className="cmpMt">{n(clics[i])}</b>
                      <span className="cmpPiste"><span style={{ width: `${Math.round((clics[i] / cliqueurs) * 100)}%` }} /></span>
                    </li>
                  ))}
                </ul>
              ) : <p className="cmpAide">{t("aucunLien")}</p>}
            </Carte>

            <Carte titre={t("ventesAttribuees", { montant: argent(totalVentes) })} aide={t("ventesAide")}>
              {ventes.length ? (
                <ul className="cmpVentes">
                  {ventes.map((v) => (
                    <li key={v.id}>
                      <span><b>{v.client}</b> <small className="cmpDoux">{v.numero} · {v.joursApres ? t("nJoursApres", { n: v.joursApres }) : t("leJourMeme")}</small></span>
                      <b className="cmpMt">{argent(v.montant)}</b>
                    </li>
                  ))}
                </ul>
              ) : <p className="cmpAide">{t("aucuneVente")}</p>}
            </Carte>

            {rebondsDef || enReessai || autresEchecs || r.desinscrits ? (
              <Carte titre={t("aTraiter")} ton="rouge">
                <ul className="cmpATraiter">
                  {rebondsDef ? <li><b data-ton="rouge">{n(rebondsDef)}</b><span><b>{t("rebondsDefinitifs")}</b><small>{t("rebondsDefinitifsD")}</small></span></li> : null}
                  {enReessai ? <li><b data-ton="orange">{n(enReessai)}</b><span><b>{t("rebondsTemporaires")}</b><small>{t("rebondsTemporairesD")}</small></span></li> : null}
                  {autresEchecs ? (
                    <li>
                      <b data-ton="rouge">{n(autresEchecs)}</b>
                      <span>
                        <b>{t("autresEchecs")}</b>
                        <small>{dests.find((d) => d.statut === "echec" && !d.rebond)?.erreur || ""}</small>
                        {peutEcrire && c.statut === "terminee" ? <button type="button" className="cmpLien" onClick={() => reessayer(fiche)}>{t("reessayer")}</button> : null}
                      </span>
                    </li>
                  ) : null}
                  {r.desinscrits ? <li><b>{n(r.desinscrits)}</b><span><b>{t("desinscriptions")}</b><small>{t("desinscriptionsD")}</small></span></li> : null}
                </ul>
              </Carte>
            ) : null}
          </div>
        </div>

        <Carte titre={t("ouverturesHeure")} aide={pic.n ? t("pic", { h: new Date(pic.heure).getHours(), n: pic.n }) : ""}>
          {courbe.cases.length && r.ouverts ? (
            <figure className="cmpCourbe">
              <div className="cmpCourbeZone">
                <div className="cmpAxe" aria-hidden="true"><span>{max}</span><span>{Math.round(max / 2)}</span><span>0</span></div>
                <div className="cmpBarres" role="img" aria-label={t("ouverturesHeure")}>
                  {courbe.cases.map((x) => (
                    <span key={x.heure} className="cmpBarreH" title={`${new Date(x.heure).getHours()} h : ${x.n}`}>
                      <span style={{ height: `${(x.n / max) * 100}%` }} data-vide={!x.n || undefined} />
                    </span>
                  ))}
                </div>
              </div>
              <div className="cmpGraduations" aria-hidden="true">
                {courbe.cases.filter((_, i) => i % 6 === 0).map((x) => <span key={x.heure}>{new Date(x.heure).getHours()} h</span>)}
                <span>+24 h</span>
              </div>
            </figure>
          ) : (
            <p className="cmpAide">{c.statut === "programmee" ? t("ouverturesApres") : t("aucuneOuverture")}</p>
          )}
        </Carte>

        {r.total ? (
          <Carte titre={t("destinataires")} actions={<Recherche valeur={recherche} onChanger={setRecherche} placeholder={t("rechercherContact")} />}>
            <Onglets options={options} valeur={filtre} onChoisir={(f) => { setFiltre(f); setLimite(50); }} label={t("filtrer")} />
            <div className="cmpTableau" role="table">
              {liste.slice(0, limite).map((d) => (
                <div key={`${d.clientId}-${d.email}`} className="cmpLigneT cmpColsRapport" role="row">
                  <span className="cmpQui"><b className="cmpEllipse">{d.nom}</b><small className="cmpDoux cmpEllipse">{d.email}</small></span>
                  <span>{d.variante ? <Etiquette>{d.variante}</Etiquette> : null}</span>
                  <span className="cmpActivite" data-ton={d.statut === "echec" ? "rouge" : d.clique ? "fort" : d.ouvert ? "vert" : ""}>
                    {d.statut === "echec"
                      ? `${d.rebond === "definitif" ? t("rebond") : t("echec")} : ${d.erreur || ""}`
                      : d.statut === "attente" ? (d.essais ? t("reessaiPrevu") : t("enAttente"))
                        : d.statut === "reserve" ? t("attendGagnant")
                          : [d.ouvert ? t("ouvertA", { h: heure(d.ouvertLe) }) : t("delivreNonOuvert"), d.clique ? t("cliqueA", { h: heure(d.cliqueLe) }) : "", d.desinscrit ? t("desinscrit") : ""].filter(Boolean).join(" · ")}
                  </span>
                  <small className="cmpDoux">{d.envoyeLe ? dateCourte(d.envoyeLe) : ""}</small>
                  {d.clientId ? <button type="button" className="cmpLien" onClick={() => suivreLien({ lien: { app: "crm", params: { client: d.clientId } } })}>{t("ficheCRM")}</button> : <span />}
                </div>
              ))}
              {!liste.length ? <p className="cmpRien">{t("personneCategorie")}</p> : null}
            </div>
            {liste.length > limite ? <div className="cmpCartePied"><button type="button" className="cmpLien" onClick={() => setLimite(limite + 100)}>{t("afficherPlus", { n: n(liste.length - limite) })}</button></div> : null}
          </Carte>
        ) : null}
      </div>
    </div>
  );
};

/// Le message, bloc par bloc, avec la part des cliqueurs sur les liens de
/// chaque bloc.
const CarteDesClics = ({ campagne, clics, cliqueurs }) => {
  const { t, nomEntreprise } = useC();
  const exemple = { nom: "Koné Distribution", contact: "Awa Koné", prenom: "Awa", ville: "Abidjan" };
  const p = D.personnaliser({ ...campagne, blocs: (campagne.blocs || []).length ? campagne.blocs : D.blocsDepuisTexte(campagne) }, { ...D.variablesPour(exemple, nomEntreprise), numero: "DEV-2026-0141", annees: "2" });
  const blocs = p.blocs;
  const image = useImagesCloud(blocs);
  let debut = 0;
  return (
    <div className="cmpFeuille cmpFeuilleClics">
      <div className="cmpFeuilleTete" style={{ background: D.couleurSure(campagne.couleur) }}>{t("enTeteAuto")}</div>
      {blocs.map((b) => {
        const rendu = D.htmlBloc(b, { couleur: campagne.couleur, image, debut });
        debut = rendu.suivant;
        const total = rendu.liens.reduce((s, i) => s + (clics[i] || 0), 0);
        return (
          <div key={b.id} className="cmpBlocPlan cmpBlocClics" onClickCapture={(e) => { if (e.target.closest("a")) e.preventDefault(); }}>
            {rendu.liens.length ? <span className="cmpBadgeClics">{Math.round((total / cliqueurs) * 100)} %</span> : null}
            <div className="cmpBlocRendu" dangerouslySetInnerHTML={{ __html: rendu.html }} />
          </div>
        );
      })}
    </div>
  );
};

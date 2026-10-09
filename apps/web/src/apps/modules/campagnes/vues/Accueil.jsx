// Campagnes — l'accueil : chiffres, choses à faire, campagnes récentes,
// automatisations, santé de la liste.

import React, { useMemo } from "react";
import { Icon } from "../../../../utils/general";
import * as D from "@companyos/shared/campagnes";
import { Bouton, Carte, Entete, Kpi, Puce, Statut, useC } from "../commun";

/// Le chiffre d'affaires attribué aux campagnes envoyées sur `jours` jours.
export const caAttribue = (campagnes, factures, jours = 30) => {
  const limite = new Date(Date.now() - jours * 86400000).toISOString();
  return campagnes
    .filter((c) => (c.data.termineeLe || c.data.envoyerLe || c.data.creeLe || "") >= limite)
    .reduce((s, c) => s + D.ventesAttribuees(c.data, factures).reduce((x, v) => x + v.montant, 0), 0);
};

export const Accueil = () => {
  const s = useC();
  const { t, n, pct, argent, dateCourte, campagnes, automatisations, clients, factures, sante, session, aller, peutEcrire } = s;
  const stats = useMemo(() => D.statistiquesGlobales(campagnes), [campagnes]);
  const ca = useMemo(() => caAttribue(campagnes, factures), [campagnes, factures]);
  const limite30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const nouveaux = clients.filter((c) => (c.createdAt || "") >= limite30 && !c.data.emailDesinscrit).length;
  const actives = automatisations.filter((a) => a.data.actif);

  const taches = useMemo(() => {
    const out = [];
    for (const c of campagnes) {
      const r = D.resultatsAB(c.data);
      if (c.data.ab?.actif && c.data.ab.gagnant && c.data.statut !== "brouillon" && (c.data.ab.decideLe || "") >= limite30) {
        const g = r[c.data.ab.gagnant];
        const p = r[c.data.ab.gagnant === "A" ? "B" : "A"];
        out.push({ id: `ab-${c.id}`, ton: "orange", n: "A/B", titre: t("tAB", { v: c.data.ab.gagnant, a: g.tauxOuverture, b: p.tauxOuverture }), detail: c.data.nom, action: t("voir"), aller: () => aller("rapport", { id: c.id }) });
      }
    }
    if (sante.rebonds) out.push({ id: "rebonds", ton: "rouge", n: n(sante.rebonds), titre: t("tRebonds", { n: n(sante.rebonds) }), detail: t("tRebondsD"), action: t("corriger"), aller: () => aller("contacts", { filtre: "rebonds" }) });
    const programmees = campagnes.filter((c) => c.data.statut === "programmee");
    if (programmees.length) out.push({ id: "prog", ton: "bleu", n: n(programmees.length), titre: t("tProgrammees", { n: programmees.length }), detail: programmees.slice(0, 2).map((c) => c.data.nom).join(", "), action: t("voir"), aller: () => aller("rapport", { id: programmees[0].id }) });
    const relance = campagnes.find((c) => c.data.statut === "terminee" && !campagnes.some((x) => x.data.relanceDe === c.data.nom) && (c.data.destinataires || []).filter(D.FILTRES_DESTINATAIRES.nonOuverts.garde).length >= 5);
    if (relance) {
      const nb = relance.data.destinataires.filter(D.FILTRES_DESTINATAIRES.nonOuverts.garde).length;
      out.push({ id: "relance", ton: "", n: n(nb), titre: t("tRelance", { n: n(nb) }), detail: relance.data.nom, action: t("relancer"), aller: () => aller("editeur", { initial: D.relanceDe(relance.data), cle: Date.now() }) });
    }
    if (sante.aConfirmer) out.push({ id: "confirmer", ton: "", n: n(sante.aConfirmer), titre: t("tAConfirmer", { n: n(sante.aConfirmer) }), detail: t("tAConfirmerD"), action: t("voir"), aller: () => aller("contacts", { filtre: "aConfirmer" }) });
    if (!actives.length) out.push({ id: "auto", ton: "", n: "+", titre: t("tAuto"), detail: t("tAutoD"), action: t("decouvrir"), aller: () => aller("automatisations") });
    const brouillons = campagnes.filter((c) => c.data.statut === "brouillon");
    if (brouillons.length) out.push({ id: "brouillons", ton: "", n: n(brouillons.length), titre: t("tBrouillons", { n: brouillons.length }), detail: brouillons.slice(0, 2).map((c) => c.data.nom).join(", "), action: t("reprendre"), aller: () => aller("editeur", { id: brouillons[0].id }) });
    return out;
  }, [campagnes, sante, actives.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const recentes = campagnes.slice(0, 6);
  const total = Math.max(1, sante.total);
  const prenom = String(session.user?.name || "").split(/\s+/)[0];

  return (
    <div className="cmpVue">
      <Entete titre={prenom ? t("bonjour", { nom: prenom }) : t("navAccueil")} sous={t("sousAccueil", { c: campagnes.filter((c) => ["programmee", "envoi"].includes(c.data.statut)).length, a: actives.length })}>
        <Bouton icone="faBolt" onClick={() => aller("automatisations")}>{t("nouvelleAuto")}</Bouton>
        <Bouton variante="principal" icone="faPlus" disabled={!peutEcrire} onClick={() => aller("editeur", { cle: Date.now() })}>{t("nouvelleCampagne")}</Bouton>
      </Entete>
      <div className="cmpConteneur">
        <section className="cmpKpis">
          <Kpi label={t("kJoignables")} valeur={n(sante.joignables)} aide={t("kJoignablesD", { n: n(nouveaux) })} ton={nouveaux ? "vert" : ""} onClick={() => aller("contacts")} />
          <Kpi label={t("kEnvoyes")} valeur={n(stats.envoyes)} aide={t("kEnvoyesD", { n: stats.campagnes })} onClick={() => aller("campagnes")} />
          <Kpi label={t("kOuverture")} valeur={pct(stats.tauxOuverture)} aide={stats.tauxClic !== null ? t("kClicD", { p: pct(stats.tauxClic) }) : t("kOuvertureD")} />
          <Kpi label={t("kCA")} valeur={argent(ca)} aide={t("kCAD")} />
        </section>

        <div className="cmpGrille">
          <div className="cmpLarge">
            <Carte titre={t("aFaire")}>
              {taches.length ? (
                <ul className="cmpTaches">
                  {taches.map((x) => (
                    <li key={x.id}>
                      <Puce ton={x.ton}>{x.n}</Puce>
                      <span><b>{x.titre}</b><small>{x.detail}</small></span>
                      <Bouton onClick={x.aller}>{x.action}</Bouton>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="cmpRien"><Icon fafa="faCircleCheck" width={14} /> {t("rienAFaire")}</div>
              )}
            </Carte>

            <Carte titre={t("campagnesRecentes")} actions={<button type="button" className="cmpLien" onClick={() => aller("campagnes")}>{t("toutes")}</button>}>
              {recentes.length ? (
                <div className="cmpTableau" role="table">
                  <div className="cmpLigneT cmpEnteteT cmpColsRecentes" role="row">
                    <span>{t("campagne")}</span><span>{t("statut")}</span><span className="cmpMt">{t("ouverture")}</span><span className="cmpMt">{t("clics")}</span><span className="cmpMt">{t("caAttribue")}</span>
                  </div>
                  {recentes.map((c) => {
                    const r = D.resumeDe(c.data.destinataires);
                    const ventes = D.ventesAttribuees(c.data, factures).reduce((x, v) => x + v.montant, 0);
                    return (
                      <button type="button" key={c.id} className="cmpLigneT cmpColsRecentes" role="row" onClick={() => aller(c.data.statut === "brouillon" ? "editeur" : "rapport", { id: c.id })}>
                        <span className="cmpQui">
                          <b className="cmpEllipse">{c.data.nom || t("sansNom")}</b>
                          <small className="cmpDoux">{[c.data.ab?.actif ? t("testAB") : "", r.total ? t("nDestinataires", { n: n(r.total) }) : "", dateCourte(c.data.termineeLe || c.data.envoyerLe || c.data.creeLe)].filter(Boolean).join(" · ")}</small>
                        </span>
                        <span><Statut statut={c.data.statut} /></span>
                        <span className="cmpMt">{r.envoyes ? pct(r.tauxOuverture) : "—"}</span>
                        <span className="cmpMt">{r.envoyes ? pct(r.tauxClic) : "—"}</span>
                        <b className="cmpMt">{ventes ? argent(ventes) : "—"}</b>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="cmpVide">
                  <Icon fafa="faPaperPlane" width={22} />
                  <b>{t("aucuneCampagne")}</b>
                  <span>{t("aucuneCampagneD")}</span>
                  <Bouton variante="principal" disabled={!peutEcrire} onClick={() => aller("editeur", { cle: Date.now() })}>{t("premiereCampagne")}</Bouton>
                </div>
              )}
            </Carte>
          </div>

          <aside className="cmpColonne">
            <Carte titre={t("navAutomatisations")} actions={<button type="button" className="cmpLien" onClick={() => aller("automatisations")}>{t("gerer")}</button>}>
              {automatisations.length ? (
                <ul className="cmpListeAutos">
                  {automatisations.map((a) => {
                    const st = D.statistiquesAuto(a.data);
                    return (
                      <li key={a.id}>
                        <button type="button" onClick={() => aller("automatisation", { id: a.id })}>
                          <span className="cmpPoint" data-actif={a.data.actif || undefined} aria-hidden="true" />
                          <span><b>{a.data.nom}</b><small>{t(`source_${D.recetteDe(a.data.recette)?.source || "crm"}`)}</small></span>
                          <small className="cmpMt">{a.data.actif ? t("nEnvoyes", { n: n(st.envoyes) }) : t("enPause")}</small>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="cmpAide">{t("aucuneAutoD")}</p>
              )}
            </Carte>

            <Carte titre={t("santeListe")}>
              <div className="cmpBarreSante" role="img" aria-label={t("santeListe")}>
                <span data-ton="vert" style={{ width: `${(sante.joignables / total) * 100}%` }} />
                <span data-ton="orange" style={{ width: `${((sante.sansEmail + sante.aConfirmer) / total) * 100}%` }} />
                <span data-ton="gris" style={{ width: `${(sante.desinscrits / total) * 100}%` }} />
                <span data-ton="rouge" style={{ width: `${(sante.rebonds / total) * 100}%` }} />
              </div>
              <ul className="cmpLegende">
                <li><i data-ton="vert" />{t("joignables")}<b>{n(sante.joignables)}</b></li>
                <li><i data-ton="orange" />{t("sansEmailOuAConfirmer")}<b>{n(sante.sansEmail + sante.aConfirmer)}</b></li>
                <li><i data-ton="gris" />{t("desinscrits")}<b>{n(sante.desinscrits)}</b></li>
                <li><i data-ton="rouge" />{t("rebonds")}<b>{n(sante.rebonds)}</b></li>
              </ul>
              <button type="button" className="cmpLien" onClick={() => aller("contacts")}>{t("gererContacts")}</button>
            </Carte>
          </aside>
        </div>
      </div>
    </div>
  );
};

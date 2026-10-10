// Ma journée : ce qu'il faut faire aujourd'hui, et ce qui risque de se
// perdre. L'écran sur lequel on ouvre le CRM le matin.

import React, { useMemo } from "react";
import { Icon } from "../../../../utils/general";
import { montant } from "../../../../utils/monnaie";
import { ETAPES_OUVERTES, nomDe, plusJours, valeurPonderee } from "../domaine";
import { clientsDormants } from "../domaine";
import { abrege, BoutonIcone, Carte, dateCourte, Initiales, Jauge, Kpi, lienTel, Pastille, TON_ACTIVITE, TON_ETAPE, Vide } from "../commun";

export const Journee = ({ t, d, ctx, actions, clientDe, membreDe, session, moi, taches, objectif, perf, maintenant }) => {
  const prenom = (membreDe(moi)?.name || "").split(" ")[0];
  const ouvertes = d.opportunites.filter((o) => ETAPES_OUVERTES.includes(o.data.etape));
  const pondere = ouvertes.reduce((s, o) => s + valeurPonderee(o), 0);
  const total = ouvertes.reduce((s, o) => s + (Number(o.data.montant) || 0), 0);
  const stagnent = ouvertes
    .filter((o) => ctx.stag[o.id]?.stagne)
    .sort((a, b) => (Number(b.data.montant) || 0) - (Number(a.data.montant) || 0));
  const montantStagne = stagnent.reduce((s, o) => s + (Number(o.data.montant) || 0), 0);
  const enRetard = taches.filter((x) => x.enRetard);
  const duJour = taches.filter((x) => x.aujourdhui);
  const rdvJour = duJour.filter((x) => /^RDV/.test(x.activite.data.resume || "") || x.activite.data.evenementId).length;

  const dormants = useMemo(() => clientsDormants(d.clients, d.activites, 60, maintenant).slice(0, 5), [d.clients, d.activites, maintenant]);

  /// Ce que les autres apps ont appris sur nos clients cette semaine.
  const signaux = useMemo(() => {
    const depuis = plusJours(-7, maintenant);
    const out = [];
    const docs = new Map(d.documents.map((x) => [x.id, x]));
    for (const r of d.reglements) {
      if ((r.data.date || "") < depuis) continue;
      const doc = docs.get(r.data.documentId);
      const c = doc && clientDe(doc.data.clientId);
      if (!c) continue;
      out.push({ id: `r${r.id}`, app: "facturation", ton: "ok", date: r.data.date, client: c, texte: `${nomDe(c)} · ${t("ev_paiement", { montant: montant(r.data.montant) })}` });
    }
    for (const camp of d.campagnes) {
      for (const dest of camp.data.destinataires || []) {
        if (!dest.clique || (dest.cliqueLe || "").slice(0, 10) < depuis) continue;
        const c = clientDe(dest.clientId);
        if (!c) continue;
        out.push({ id: `k${camp.id}${dest.clientId}`, app: "campagnes", ton: "orange", date: dest.cliqueLe, client: c, texte: `${nomDe(c)} · ${t("ev_clic", { nom: camp.data.nom || camp.data.sujet || "" })}` });
      }
    }
    for (const c of d.clients) {
      const v = ctx.ventes[c.id];
      if (v?.echu > 0) out.push({ id: `e${c.id}`, app: "comptabilite", ton: "bad", date: "", client: c, texte: `${nomDe(c)} · ${t("dontEchu", { montant: montant(v.echu) })}` });
    }
    return out.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6);
  }, [d.reglements, d.documents, d.campagnes, d.clients, ctx.ventes, clientDe, t, maintenant]);

  const liste = taches.slice(0, 12);

  return (
    <div className="crmPage">
      <header className="crmEntete">
        <div>
          <h1>{t("bonjour", { nom: prenom || session?.user?.name || "" })}</h1>
          <p className="crmSous">{t("resumeJour", { retard: enRetard.length, rdv: rdvJour })}</p>
        </div>
        <div className="crmEnteteActions">
          <button type="button" className="crmBtn crmBtnPrimaire" onClick={() => actions.editerCompte()}>
            {t("nouveauCompte")}
          </button>
          <button type="button" className="crmBtn" onClick={() => actions.editerAffaire()}>
            {t("nouvelleAffaire")}
          </button>
        </div>
      </header>

      <section className="crmKpis">
        <Kpi
          libelle={t("objectifMois")}
          valeur={objectif.objectif ? `${abrege(objectif.gagne)} / ${abrege(objectif.objectif)}` : abrege(objectif.gagne)}
          detail={objectif.objectif ? t("objectifReste", { pct: objectif.pct, jours: objectif.joursRestants }) : t("objectifNonDefini")}
          onClick={() => actions.allerA("previsions")}
        >
          {objectif.objectif ? <Jauge pct={objectif.pct} pct2={objectif.pctEngage} /> : null}
        </Kpi>
        <Kpi libelle={t("pipelinePondere")} valeur={abrege(pondere)} detail={t("pipelineOuvert", { montant: abrege(total) })} onClick={() => actions.allerA("pipeline")} />
        <Kpi
          libelle={t("tauxGain")}
          valeur={perf.taux === null ? "—" : `${perf.taux} %`}
          detail={perf.cycleMoyen === null ? t("pasAssez") : t("cycleMoyen", { n: perf.cycleMoyen })}
        />
        <Kpi
          libelle={t("stagnent")}
          valeur={stagnent.length}
          ton={stagnent.length ? "bad" : undefined}
          detail={t("stagnentDetail", { montant: abrege(montantStagne) })}
          onClick={() => actions.allerA("pipeline")}
        />
      </section>

      <div className="crmGrille2">
        <Carte
          titre={t("aFaireAujourdhui")}
          action={
            <div className="crmPills">
              {enRetard.length ? <Pastille ton="bad">{t("nbRetard", { n: enRetard.length })}</Pastille> : null}
              <Pastille>{t("nbAujourdhui", { n: duJour.length })}</Pastille>
            </div>
          }
        >
          {liste.length ? (
            <ul className="crmLignes">
              {liste.map(({ activite: a, enRetard: retard, aujourdhui }) => {
                const c = clientDe(a.data.clientId);
                const opp = a.data.opportuniteId ? d.opportunites.find((o) => o.id === a.data.opportuniteId) : null;
                const jours = Math.round((new Date(maintenant) - new Date(a.data.echeance)) / 86400000);
                return (
                  <li key={a.id} className="crmLigne">
                    <input type="checkbox" checked={false} onChange={() => actions.basculerTache(a)} aria-label={t("marquerFait")} />
                    <button type="button" className="crmLigneCorps" onClick={() => c && actions.ouvrirCompte(c.id)}>
                      <strong>{a.data.resume}</strong>
                      <span className="crmMuted">{[c ? nomDe(c) : "", opp?.data.libelle].filter(Boolean).join(" · ")}</span>
                    </button>
                    <span className="crmQuand" data-retard={retard ? "1" : undefined}>
                      {retard ? t("retardJ", { n: jours }) : aujourdhui ? t("aujourdhui") : dateCourte(a.data.echeance)}
                    </span>
                    {c?.data.telephone ? (
                      <BoutonIcone icone="faPhone" libelle={t("appeler")} href={lienTel(c.data.telephone)} onClick={() => setTimeout(() => actions.compteRendu(c.id), 400)} />
                    ) : null}
                    {c?.data.email ? <BoutonIcone icone="faEnvelope" libelle={t("ecrire")} onClick={() => actions.ecrire(c)} /> : null}
                    <BoutonIcone icone="faClock" libelle={t("reporter")} onClick={() => actions.reporterTache(a)} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <Vide icone="faMugHot">{t("rienAFaire")}</Vide>
          )}
        </Carte>

        <div className="crmColonne">
          <Carte titre={t("stagnent")} action={<button type="button" className="crmLien" onClick={() => actions.allerA("pipeline")}>{t("voirPipeline")}</button>}>
            {stagnent.length ? (
              <ul className="crmLignes">
                {stagnent.slice(0, 5).map((o) => {
                  const c = clientDe(o.data.clientId);
                  return (
                    <li key={o.id} className="crmLigne">
                      <Initiales nom={nomDe(c)} />
                      <button type="button" className="crmLigneCorps" onClick={() => actions.editerAffaire(o)}>
                        <strong>{o.data.libelle}</strong>
                        <span className="crmMuted">{nomDe(c)} · <Pastille ton={TON_ETAPE[o.data.etape]}>{t(`etape_${o.data.etape}`)}</Pastille></span>
                      </button>
                      <span className="crmDroite">
                        <strong>{abrege(o.data.montant)}</strong>
                        <span className="crmRouge">{t("joursSansActivite", { n: ctx.stag[o.id].jours })}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Vide icone="faCircleCheck">{t("aucuneAffaire")}</Vide>
            )}
          </Carte>

          <Carte titre={t("signaux")}>
            {signaux.length ? (
              <ul className="crmLignes">
                {signaux.map((s) => (
                  <li key={s.id} className="crmLigne">
                    <Pastille ton={s.ton}>{t(`app_${s.app}`)}</Pastille>
                    <button type="button" className="crmLigneCorps crmTronque" onClick={() => actions.ouvrirCompte(s.client.id)}>
                      <span>{s.texte}</span>
                    </button>
                    <span className="crmMuted crmPetit">{s.date ? dateCourte(s.date) : ""}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Vide icone="faSatelliteDish">{t("aucunSignal")}</Vide>
            )}
          </Carte>

          {dormants.length ? (
            <Carte titre={t("comptesSilencieux")}>
              <ul className="crmLignes">
                {dormants.map(({ client: c, jours }) => (
                  <li key={c.id} className="crmLigne">
                    <Initiales nom={nomDe(c)} />
                    <button type="button" className="crmLigneCorps" onClick={() => actions.ouvrirCompte(c.id)}>
                      <strong>{nomDe(c)}</strong>
                      <span className="crmMuted">{jours === null ? t("jamaisContacte") : t("ilYa", { n: jours })}</span>
                    </button>
                    <Pastille ton={TON_ACTIVITE.tache}>{membreDe(c.data.responsableId)?.name?.split(" ")[0] || t("nonAttribue")}</Pastille>
                    <Icon fafa="faChevronRight" width={10} />
                  </li>
                ))}
              </ul>
            </Carte>
          ) : null}
        </div>
      </div>
    </div>
  );
};

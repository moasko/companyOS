// Prévisions : ce qui est gagné, ce sur quoi on s'engage, ce qui est
// probable — mois par mois. Puis la performance (taux de gain, cycle,
// motifs de perte) et les réglages (objectifs, seuils, secteurs cibles).

import React, { useEffect, useState } from "react";
import { montant } from "../../../../utils/monnaie";
import { ETAPES_OUVERTES } from "../domaine";
import { SEUIL_STAGNATION } from "../regles";
import { abrege, Carte, Jauge, Kpi, moisLong, Vide } from "../commun";

export const Previsions = ({ t, d, actions, prev, perf, objectif, reglages, admin }) => {
  const [r, setR] = useState(() => ({
    equipe: reglages.objectifs?.equipe || "",
    perso: { ...reglages.objectifs },
    seuils: { ...reglages.seuils },
    secteurs: (reglages.secteursCibles || []).join(", "),
  }));
  useEffect(() => {
    setR({
      equipe: reglages.objectifs?.equipe || "",
      perso: { ...reglages.objectifs },
      seuils: { ...reglages.seuils },
      secteurs: (reglages.secteursCibles || []).join(", "),
    });
  }, [reglages]);

  const max = Math.max(1, ...prev.map((m) => m.gagne + m.engage + m.pondere));
  const maxMotif = Math.max(1, ...perf.motifs.map((m) => m.nombre));

  const enregistrer = () => {
    const objectifs = {};
    for (const [k, v] of Object.entries(r.perso)) if (k !== "equipe" && Number(v) > 0) objectifs[k] = Number(v);
    if (Number(r.equipe) > 0) objectifs.equipe = Number(r.equipe);
    const seuils = {};
    for (const [k, v] of Object.entries(r.seuils)) if (Number(v) > 0) seuils[k] = Number(v);
    actions.enregistrerReglages({
      objectifs,
      seuils,
      secteursCibles: r.secteurs.split(",").map((x) => x.trim()).filter(Boolean),
    });
  };

  return (
    <div className="crmPage">
      <header className="crmEntete"><h1>{t("previsions")}</h1></header>

      <section className="crmKpis">
        <Kpi libelle={t("objectifMois")} valeur={objectif.objectif ? `${objectif.pct} %` : "—"} detail={objectif.objectif ? `${abrege(objectif.gagne)} / ${abrege(objectif.objectif)}` : t("objectifNonDefini")}>
          {objectif.objectif ? <Jauge pct={objectif.pct} pct2={objectif.pctEngage} /> : null}
        </Kpi>
        <Kpi libelle={t("tauxGain")} valeur={perf.taux === null ? "—" : `${perf.taux} %`} detail={`${t("gagnees")} ${perf.gagnees} · ${t("perdues")} ${perf.perdues}`} />
        <Kpi libelle={t("montantGagne")} valeur={abrege(perf.montantGagne)} detail={t("performance")} />
        <Kpi libelle={t("cycle")} valeur={perf.cycleMoyen === null ? "—" : t("jours", { n: perf.cycleMoyen })} detail={perf.cycleMoyen === null ? t("pasAssez") : ""} />
      </section>

      <Carte titre={t("previsions")}>
        <div className="crmTableBoite crmTableBoiteSimple">
          <table className="crmTable">
            <thead>
              <tr><th>{t("mois")}</th><th className="crmNum">{t("colGagne")}</th><th className="crmNum">{t("colEngage")}</th><th className="crmNum">{t("pondere")}</th><th className="crmNum">{t("nbAffairesCol")}</th><th aria-hidden="true" /></tr>
            </thead>
            <tbody>
              {prev.map((m) => (
                <tr key={m.mois}>
                  <td className="crmCapitale">{moisLong(m.mois)}</td>
                  <td className="crmNum crmVert">{montant(m.gagne)}</td>
                  <td className="crmNum">{montant(m.engage)}</td>
                  <td className="crmNum crmMuted">{montant(m.pondere)}</td>
                  <td className="crmNum">{m.nombre}</td>
                  <td className="crmBarreCellule">
                    <span className="crmBarres">
                      <span data-ton="ok" style={{ width: `${(m.gagne / max) * 100}%` }} />
                      <span data-ton="info" style={{ width: `${(m.engage / max) * 100}%` }} />
                      <span data-ton="idle" style={{ width: `${(m.pondere / max) * 100}%` }} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Carte>

      <div className="crmGrille2">
        <Carte titre={t("motifsPerte")}>
          {perf.motifs.length ? (
            <ul className="crmHisto">
              {perf.motifs.map((m) => (
                <li key={m.motif}>
                  <span>{t(`motif_${m.motif}`)}</span>
                  <span className="crmHistoPiste"><span style={{ width: `${(m.nombre / maxMotif) * 100}%` }} /></span>
                  <strong>{m.nombre}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <Vide icone="faTrophy">{t("aucunePerte")}</Vide>
          )}
        </Carte>
        <Carte titre={t("parSource")}>
          {perf.sources.length ? (
            <div className="crmTableBoite crmTableBoiteSimple">
              <table className="crmTable">
                <tbody>
                  {perf.sources.map((s) => (
                    <tr key={s.source}>
                      <td>{t(`source_${s.source}`)}</td>
                      <td className="crmNum">{s.taux} %</td>
                      <td className="crmNum">{s.gagnees} / {s.closes}</td>
                      <td className="crmNum">{montant(s.montant)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Vide icone="faChartPie">{t("pasAssez")}</Vide>
          )}
        </Carte>
      </div>

      <Carte titre={t("reglages")} action={!admin ? <span className="crmMuted crmPetit">{t("adminSeulement")}</span> : null}>
        <fieldset className="crmReglages" disabled={!admin}>
          <div className="crmReglagesGrille">
            <label className="crmChamp"><span>{t("objectifEquipe")}</span><input type="number" min="0" step="100000" value={r.equipe} onChange={(e) => setR((x) => ({ ...x, equipe: e.target.value }))} /></label>
            {d.membres.map((m) => (
              <label key={m.id} className="crmChamp">
                <span>{t("objectifPerso", { nom: m.name })}</span>
                <input type="number" min="0" step="100000" value={r.perso[m.id] || ""} onChange={(e) => setR((x) => ({ ...x, perso: { ...x.perso, [m.id]: e.target.value } }))} />
              </label>
            ))}
          </div>
          <h3 className="crmIntertitre">{t("seuilsStagnation")}</h3>
          <div className="crmReglagesGrille">
            {ETAPES_OUVERTES.map((e) => (
              <label key={e} className="crmChamp">
                <span>{t(`etape_${e}`)}</span>
                <input type="number" min="1" max="365" placeholder={String(SEUIL_STAGNATION)} value={r.seuils[e] || ""} onChange={(ev) => setR((x) => ({ ...x, seuils: { ...x.seuils, [e]: ev.target.value } }))} />
              </label>
            ))}
          </div>
          <label className="crmChamp crmChampPlein">
            <span>{t("secteursCibles")}</span>
            <input value={r.secteurs} onChange={(e) => setR((x) => ({ ...x, secteurs: e.target.value }))} placeholder="Restauration, Santé, BTP" />
          </label>
          <div className="crmLeadBoutons">
            <button type="button" className="crmBtn crmBtnPrimaire" onClick={enregistrer}>{t("enregistrer")}</button>
          </div>
        </fieldset>
      </Carte>
    </div>
  );
};

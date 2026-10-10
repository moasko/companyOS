// Comptes : le portefeuille, avec sa santé, ses ventes et son suivi —
// filtrable, et enregistrable en vues (« Clients Abidjan > 5 M »).

import React, { useMemo, useRef, useState } from "react";
import { Icon } from "../../../../utils/general";
import { montant } from "../../../../utils/monnaie";
import { STATUTS, nomDe, prochaineAction } from "../domaine";
import { appliquerVue } from "../regles";
import { dateCourte, Initiales, Pastille, Vide } from "../commun";

const TON_STATUT = { prospect: "info", actif: "ok", inactif: "idle" };
const TON_SANTE = { bon: "ok", moyen: "warn", risque: "bad" };

export const Comptes = ({ t, d, ctx, actions, membreDe, telephone, reglages, vueId, setVueId }) => {
  const [requete, setRequete] = useState("");
  const [statut, setStatut] = useState("");
  const [tri, setTri] = useState("nom");
  const fichier = useRef(null);
  const vue = (reglages.vues || []).find((v) => v.id === vueId) || null;

  const liste = useMemo(() => {
    const q = requete.trim().toLowerCase();
    let l = appliquerVue(d.clients, vue?.criteres || {}, { ca: ctx.ca, joursSansContact: ctx.joursSansContact });
    if (statut) l = l.filter((c) => c.data.statut === statut);
    if (q) {
      const idsContacts = new Set(
        d.contacts
          .filter((x) => [x.data.prenom, x.data.nom, x.data.email, x.data.telephone].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
          .map((x) => x.data.clientId),
      );
      l = l.filter(
        (c) =>
          idsContacts.has(c.id) ||
          [c.data.nom, c.data.entreprise, c.data.ville, c.data.email, c.data.telephone, c.data.secteur, ...(c.data.etiquettes || [])]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    const cle = {
      nom: (c) => nomDe(c).toLowerCase(),
      ca: (c) => -(ctx.ca[c.id] || 0),
      sante: (c) => ctx.sante[c.id]?.score ?? 0,
      contact: (c) => -(ctx.joursSansContact[c.id] ?? 99999),
    }[tri];
    return [...l].sort((a, b) => (cle(a) < cle(b) ? -1 : cle(a) > cle(b) ? 1 : 0));
  }, [d.clients, d.contacts, vue, statut, requete, tri, ctx]);

  const prochaine = (c) => prochaineAction(c.id, d.activites);

  return (
    <div className="crmPage">
      <header className="crmEntete">
        <div>
          <h1>{vue ? vue.nom : t("navComptes")}</h1>
          <p className="crmSous">{t("nbComptes", { n: liste.length })}</p>
        </div>
        <div className="crmFiltres">
          <label className="crmRecherche">
            <Icon fafa="faMagnifyingGlass" width={12} />
            <input type="search" value={requete} onChange={(e) => setRequete(e.target.value)} placeholder={t("rechercher")} aria-label={t("rechercher")} />
          </label>
          <select className="crmChoix" value={statut} onChange={(e) => setStatut(e.target.value)} aria-label={t("statut")}>
            <option value="">{t("statut")} : {t("tous")}</option>
            {Object.keys(STATUTS).map((s) => <option key={s} value={s}>{t(`statut_${s}`)}</option>)}
          </select>
          <select className="crmChoix" value={tri} onChange={(e) => setTri(e.target.value)} aria-label="Tri">
            <option value="nom">A → Z</option>
            <option value="ca">{t("colCA")}</option>
            <option value="sante">{t("colSante")} ↑</option>
            <option value="contact">{t("colDernier")}</option>
          </select>
          {vue ? (
            <>
              <button type="button" className="crmPuce" onClick={() => setVueId(null)}>{t("tous")}</button>
              <button type="button" className="crmPuce" onClick={() => actions.supprimerVue(vue.id)}>{t("supprimerVue")}</button>
            </>
          ) : (
            <button type="button" className="crmPuce" onClick={actions.enregistrerVue}>{t("nouvelleVue")}</button>
          )}
          {!telephone ? (
            <>
              <button type="button" className="crmBtn" onClick={() => fichier.current?.click()}>{t("importerCsv")}</button>
              <button type="button" className="crmBtn" onClick={() => actions.exporterComptes(liste)}>{t("exporter")}</button>
              <input ref={fichier} type="file" accept=".csv,text/csv" hidden onChange={(e) => { actions.importerComptes(e.target.files?.[0]); e.target.value = ""; }} />
            </>
          ) : null}
          <button type="button" className="crmBtn crmBtnPrimaire" onClick={() => actions.editerCompte()}>{t("nouveauCompte")}</button>
        </div>
      </header>

      {!liste.length ? (
        <Vide icone="faBuilding">{t("aucunCompte")}</Vide>
      ) : telephone ? (
        <ul className="crmCartesListe">
          {liste.map((c) => {
            const s = ctx.sante[c.id];
            const j = ctx.joursSansContact[c.id];
            return (
              <li key={c.id}>
                <button type="button" className="crmCarteCompte" onClick={() => actions.ouvrirCompte(c.id)}>
                  <Initiales nom={nomDe(c)} taille={40} carre />
                  <span className="crmCarteCompteCorps">
                    <strong>{nomDe(c)}</strong>
                    <span className="crmMuted">{[c.data.entreprise ? c.data.nom : "", c.data.ville].filter(Boolean).join(" · ")}</span>
                    <span className="crmMuted crmPetit">{j === null ? t("jamaisContacte") : t("ilYa", { n: j })} · {montant(ctx.ca[c.id] || 0)}</span>
                  </span>
                  <Pastille ton={TON_SANTE[s?.niveau]}>{s?.score}</Pastille>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="crmTableBoite">
          <table className="crmTable">
            <thead>
              <tr>
                <th>{t("colCompte")}</th><th>{t("colVille")}</th><th>{t("colStatut")}</th><th>{t("colSante")}</th>
                <th className="crmNum">{t("colCA")}</th><th>{t("colDernier")}</th><th>{t("colProchaine")}</th><th>{t("colResponsable")}</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((c) => {
                const s = ctx.sante[c.id];
                const j = ctx.joursSansContact[c.id];
                const p = prochaine(c);
                return (
                  <tr key={c.id} className="handcr" onClick={() => actions.ouvrirCompte(c.id)}>
                    <td>
                      <span className="crmCellCompte">
                        <Initiales nom={nomDe(c)} carre />
                        <span><strong>{nomDe(c)}</strong><span className="crmMuted crmPetit">{c.data.entreprise ? c.data.nom : c.data.email}</span></span>
                      </span>
                    </td>
                    <td>{c.data.ville || "—"}</td>
                    <td><Pastille ton={TON_STATUT[c.data.statut]}>{t(`statut_${c.data.statut || "prospect"}`)}</Pastille></td>
                    <td><Pastille ton={TON_SANTE[s?.niveau]} title={t(`sante_${s?.niveau}`)}>{s?.score}</Pastille></td>
                    <td className="crmNum">{montant(ctx.ca[c.id] || 0)}</td>
                    <td className={j === null || j > 60 ? "crmOrange" : ""}>{j === null ? t("jamaisContacte") : t("ilYa", { n: j })}</td>
                    <td className={p && p.data.echeance < new Date().toISOString().slice(0, 10) ? "crmRouge" : ""}>
                      {p ? `${dateCourte(p.data.echeance)} · ${p.data.resume}` : "—"}
                    </td>
                    <td>{membreDe(c.data.responsableId)?.name || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

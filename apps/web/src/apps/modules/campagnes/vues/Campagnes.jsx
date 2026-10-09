// Campagnes — la liste.

import React, { useMemo, useState } from "react";
import { Icon } from "../../../../utils/general";
import * as D from "@companyos/shared/campagnes";
import { Bouton, Carte, Entete, Onglets, Recherche, Statut, useC } from "../commun";

const ONGLETS = ["toutes", "brouillon", "programmee", "envoi", "terminee"];

export const Campagnes = () => {
  const s = useC();
  const { t, n, pct, argent, dateCourte, campagnes, factures, aller, peutEcrire, supprimerCampagne } = s;
  const [onglet, setOnglet] = useState("toutes");
  const [recherche, setRecherche] = useState("");

  const options = ONGLETS.map((id) => ({
    id,
    label: t(`onglet_${id}`),
    nb: id === "toutes" ? campagnes.length : campagnes.filter((c) => (id === "envoi" ? ["envoi", "pause"].includes(c.data.statut) : c.data.statut === id)).length,
  }));
  const q = recherche.trim().toLowerCase();
  const visibles = useMemo(
    () =>
      campagnes
        .filter((c) => onglet === "toutes" || (onglet === "envoi" ? ["envoi", "pause"].includes(c.data.statut) : c.data.statut === onglet))
        .filter((c) => !q || [c.data.nom, c.data.sujet].some((v) => String(v || "").toLowerCase().includes(q))),
    [campagnes, onglet, q],
  );

  return (
    <div className="cmpVue">
      <Entete titre={t("navCampagnes")} sous={t("sousCampagnes", { n: campagnes.length })}>
        <Recherche valeur={recherche} onChanger={setRecherche} placeholder={t("rechercherCampagne")} />
        <Bouton variante="principal" icone="faPlus" disabled={!peutEcrire} onClick={() => aller("editeur", { cle: Date.now() })}>{t("nouvelleCampagne")}</Bouton>
      </Entete>
      <div className="cmpConteneur">
        <Onglets options={options} valeur={onglet} onChoisir={setOnglet} label={t("statut")} />
        <Carte>
          {visibles.length ? (
            <div className="cmpTableau" role="table">
              <div className="cmpLigneT cmpEnteteT cmpColsCampagnes" role="row">
                <span>{t("campagne")}</span><span>{t("statut")}</span><span className="cmpMt">{t("destinataires")}</span><span className="cmpMt">{t("ouverture")}</span><span className="cmpMt">{t("clics")}</span><span className="cmpMt">{t("caAttribue")}</span><span />
              </div>
              {visibles.map((c) => {
                const r = D.resumeDe(c.data.destinataires);
                const ventes = D.ventesAttribuees(c.data, factures).reduce((x, v) => x + v.montant, 0);
                return (
                  <div key={c.id} className="cmpLigneT cmpColsCampagnes" role="row">
                    <button type="button" className="cmpQui cmpLienTexte" onClick={() => aller(c.data.statut === "brouillon" ? "editeur" : "rapport", { id: c.id })}>
                      <b className="cmpEllipse">{c.data.nom || t("sansNom")}</b>
                      <small className="cmpDoux cmpEllipse">{[c.data.sujet, c.data.ab?.actif ? t("testAB") : "", dateCourte(c.data.termineeLe || c.data.envoyerLe || c.data.creeLe)].filter(Boolean).join(" · ")}</small>
                    </button>
                    <span><Statut statut={c.data.statut} /></span>
                    <span className="cmpMt">{r.total ? n(r.total) : "—"}</span>
                    <span className="cmpMt">{r.envoyes ? pct(r.tauxOuverture) : "—"}</span>
                    <span className="cmpMt">{r.envoyes ? pct(r.tauxClic) : "—"}</span>
                    <b className="cmpMt">{ventes ? argent(ventes) : "—"}</b>
                    <span className="cmpActionsLigne">
                      {peutEcrire ? (
                        <>
                          <button type="button" className="cmpIcone" title={t("dupliquer")} aria-label={t("dupliquer")} onClick={() => aller("editeur", { initial: D.dupliquer(c.data), cle: Date.now() })}><Icon fafa="faClone" width={12} /></button>
                          <button type="button" className="cmpIcone" title={t("supprimer")} aria-label={t("supprimer")} onClick={() => supprimerCampagne(c)}><Icon fafa="faTrashCan" width={12} /></button>
                        </>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="cmpRien">{campagnes.length ? t("aucunResultat") : t("aucuneCampagneD")}</p>
          )}
        </Carte>
      </div>
    </div>
  );
};

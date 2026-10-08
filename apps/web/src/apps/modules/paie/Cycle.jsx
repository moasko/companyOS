// Paie — le cycle du mois.

import React, { useMemo, useState } from "react";
import { Icon } from "../../../utils/general";
import { suivreLien } from "../../notifications";
import { etatFenetre } from "../../windows";
import * as C from "./cycle";
import { finDeMois } from "./domaine";
import { Bouton, Carte, Entete, Kpi, Puce, Statut, initiales, nomDe, useP } from "./commun";

/// Les étapes du cycle, avec leur état et leur détail.
const etapesDe = (p, etape) => {
  const { t, cycle, lignes, bloquants, controles, date } = p;
  const ordre = C.ETAPES;
  const rang = etape === "termine" ? ordre.length : ordre.indexOf(etape);
  const prets = lignes.filter((l) => l.enregistre).length;
  const d = cycle?.data || {};
  const detail = {
    variables: t("detVariables", { prets, total: lignes.length }),
    controles: bloquants.length || controles.filter((c) => c.niveau === "attention").length
      ? t("detControles", { n: controles.filter((c) => c.niveau !== "info").length })
      : t("detControlesOk"),
    validation: d.valideLe ? t("detValide", { date: date(d.valideLe) }) : t("detValidation"),
    paiement: d.payeLe ? t("detPaye", { date: date(d.payeLe) }) : t("detPaiement"),
    declarations: d.etat === "declare" ? t("detDeclare") : t("detDeclarations"),
  };
  return ordre.map((id, i) => ({
    id,
    titre: t(`etape_${id}`),
    detail: detail[id],
    etat: i < rang ? "fait" : i === rang ? "encours" : "avenir",
    numero: i + 1,
  }));
};

const SECTION_ETAPE = { variables: "variables", controles: "cycle", validation: "cycle", paiement: "paiement", declarations: "paiement" };

export const Cycle = () => {
  const p = useP();
  const { t, m, n, nomMois, date, mois, lignes, controles, bloquants, totaux, precedents, cycle, fige, occupe, aller, preparerTout, valider, rouvrir, peutAdministrer, bulletins } = p;
  const [q, setQ] = useState("");

  const toutEnregistre = lignes.length > 0 && lignes.every((l) => l.enregistre);
  const etape = C.etapeCourante(cycle?.data, bloquants.length, toutEnregistre);
  const etapes = etapesDe(p, etape);

  const versement = finDeMois(mois);
  const jours = Math.round((new Date(versement) - new Date(new Date().toISOString().slice(0, 10))) / 86400000);
  const pay = C.paiements(lignes);

  const brutPrec = [...precedents.values()].reduce((s, c) => s + (c?.brut || 0), 0);
  const ecartBrut = brutPrec ? ((totaux.brut - brutPrec) / brutPrec) * 100 : null;
  const entrees = controles.filter((c) => c.code === "entree").length;
  const sorties = controles.filter((c) => c.code === "sortie").length;

  // Les bulletins pas encore préparés se résument en une ligne : quatorze
  // fois le même message ne dirait rien de plus.
  const visibles = controles.filter((c) => c.code !== "nonEnregistre");
  const nonEnregistres = lignes.filter((l) => !l.enregistre).length;
  const nbActions = visibles.filter((c) => c.niveau !== "info").length + (nonEnregistres ? 1 : 0);

  const filtrees = lignes.filter((l) => !q.trim() || nomDe(l.salarie.data).toLowerCase().includes(q.trim().toLowerCase()));

  // Coût employeur des six derniers mois, depuis les bulletins.
  const masse = useMemo(() => {
    const out = [];
    let x = C.moisSuivant(mois);
    for (let i = 0; i < 6; i += 1) {
      x = C.moisPrecedent(x);
      const cout = x === mois ? totaux.coutTotal : bulletins.filter((b) => b.data.mois === x).reduce((s, b) => s + (b.data.calcul?.coutTotal || 0), 0);
      out.unshift({ mois: x, cout });
    }
    return out;
  }, [bulletins, mois, totaux.coutTotal]);
  const max = Math.max(1, ...masse.map((x) => x.cout));

  const d = cycle?.data || {};
  const decl = d.declarations || {};
  const echeances = [
    { jour: versement.slice(8, 10), mois: nomMois(mois, { annee: false, court: true }), titre: t("echVersement"), detail: d.payeLe ? t("echFait", { date: date(d.payeLe) }) : t("echVersementDet"), ton: d.payeLe ? "ok" : "accent" },
    { jour: "15", mois: nomMois(C.moisSuivant(mois), { annee: false, court: true }), titre: t("echDeclarations", { mois: nomMois(mois, { annee: false }) }), detail: decl.cnps && decl.its ? t("echFait", { date: date(decl.cnps.le) }) : t("echDeclarationsDet"), ton: decl.cnps && decl.its ? "ok" : "" },
    { jour: "31", mois: nomMois(`${Number(mois.slice(0, 4)) + 1}-01`, { annee: false, court: true }), titre: t("echDisa", { annee: mois.slice(0, 4) }), detail: t("echDisaDet"), ton: "" },
  ];

  const ficheRh = () => (etatFenetre("rh") ? suivreLien({ lien: { app: "rh" } }) : null);

  const action = (c) => {
    if (["sansMatricule", "sansSalaire", "sansBanque", "sansMobile", "sansCnps"].includes(c.code)) {
      return etatFenetre("rh") ? <Bouton onClick={ficheRh}>{t("ouvrirRh")}</Bouton> : null;
    }
    if (c.code === "nonEnregistre") return null;
    return (
      <Bouton onClick={() => aller(c.code === "absenceInjustifiee" || c.code === "netNegatif" ? "variables" : "bulletins", { matricule: c.cle })}>
        {c.code === "netNegatif" ? t("corriger") : t("voir")}
      </Bouton>
    );
  };

  return (
    <div className="paiVue">
      <Entete
        retour={false}
        titre={t("titreCycle", { mois: nomMois(mois) })}
        sous={jours > 0 ? t("sousCycleJ", { date: date(versement), j: jours, n: lignes.length }) : t("sousCycle", { date: date(versement), n: lignes.length })}
      >
        <Bouton icone="faCalculator" onClick={() => aller("bulletins", { simulateur: true })}>{t("simulateur")}</Bouton>
        {fige ? (
          peutAdministrer && d.etat === "valide" ? <Bouton icone="faLockOpen" onClick={rouvrir} disabled={occupe}>{t("rouvrir")}</Bouton> : null
        ) : nonEnregistres ? (
          <Bouton variante="principal" icone="faWandMagicSparkles" onClick={preparerTout} disabled={occupe || !lignes.length}>
            {t("preparerTout")}
          </Bouton>
        ) : (
          <Bouton variante="principal" icone="faCheck" onClick={valider} disabled={occupe || !!bloquants.length || !lignes.length}>
            {t("valider")}
          </Bouton>
        )}
      </Entete>

      <div className="paiConteneur">
        <nav className="paiEtapes" aria-label={t("navCycle")}>
          {etapes.map((e) => (
            <button key={e.id} type="button" className="paiEtape" data-etat={e.etat} aria-current={e.etat === "encours" ? "step" : undefined} onClick={() => aller(SECTION_ETAPE[e.id])}>
              <Puce niveau={e.etat === "fait" ? "ok" : e.etat === "encours" ? "courant" : "avenir"}>{e.etat === "fait" ? "✓" : e.numero}</Puce>
              <span>
                <b>{e.titre}</b>
                <small>{e.detail}</small>
              </span>
            </button>
          ))}
        </nav>

        {fige ? (
          <div className="paiInfo" data-ton="ok">
            <Icon fafa="faLock" width={13} />
            <span>
              {d.payeLe
                ? t("moisPaye", { date: date(d.payeLe) })
                : t("moisValide", { date: date(d.valideLe), par: d.validePar ? ` (${d.validePar})` : "" })}
            </span>
          </div>
        ) : null}

        <section className="paiKpis" aria-label={t("kpiBrut")}>
          <Kpi
            label={t("kpiBrut")}
            valeur={m(totaux.brut)}
            aide={ecartBrut == null ? t("aideBrutNeuf") : t("aideBrut", { ecart: `${ecartBrut >= 0 ? "+" : "−"} ${Math.abs(ecartBrut).toLocaleString(p.langue === "en" ? "en-US" : "fr-FR", { maximumFractionDigits: 1 })} %` })}
          />
          <Kpi label={t("kpiNet")} valeur={m(totaux.net)} aide={t("aideNet", { v: n(pay.virement.total), m: n(pay.mobile.total), e: n(pay.especes.total) })} />
          <Kpi label={t("kpiCout")} valeur={m(totaux.coutTotal)} aide={t("aideCout", { c: m(totaux.chargesPatronales) })} />
          <Kpi label={t("kpiEffectif")} valeur={String(lignes.length)} aide={t("aideEffectif", { entrees, sorties })} />
        </section>

        <div className="paiGrille">
          <div className="paiLarge">
            {!fige ? (
              <Carte
                ton={bloquants.length ? "erreur" : nbActions ? "attention" : "ok"}
                titre={t("actionsRequises", { n: nbActions })}
                aide={t("actionsAide")}
              >
                {visibles.length || nonEnregistres ? (
                  <ul className="paiActions">
                    {nonEnregistres ? (
                      <li>
                        <Puce niveau="attention" />
                        <span>
                          <b>{t("detVariables", { prets: lignes.length - nonEnregistres, total: lignes.length })}</b>
                          <small>{t("ctrl_nonEnregistre_d")}</small>
                        </span>
                        <Bouton variante="principal" onClick={preparerTout} disabled={occupe}>{t("preparerTout")}</Bouton>
                      </li>
                    ) : null}
                    {visibles.slice(0, 30).map((c, i) => (
                      <li key={`${c.cle}-${c.code}-${i}`}>
                        <Puce niveau={c.niveau} />
                        <span>
                          <b>{t(`ctrl_${c.code}`, { nom: c.nom, jours: c.jours, pourcent: c.pourcent > 0 ? `+${c.pourcent}` : `−${Math.abs(c.pourcent)}`, date: date(c.date) })}</b>
                          <small>{t(`ctrl_${c.code}_d`, { montant: m(c.montant), jours: c.jours, sur: c.sur })}</small>
                        </span>
                        {action(c)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="paiRien">{t("aucuneAction")}</p>
                )}
              </Carte>
            ) : null}

            <Carte
              titre={t("salariesDuMois")}
              actions={<input className="paiRecherche" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("rechercher")} aria-label={t("rechercher")} />}
            >
              {lignes.length ? (
                <div className="paiTableau" role="table">
                  <div className="paiLigneT paiEnteteT paiColsSalaries" role="row">
                    <span>{t("colSalarie")}</span>
                    <span>{t("colPoste")}</span>
                    <span className="paiMt">{t("colBrut")}</span>
                    <span className="paiMt">{t("colNet")}</span>
                    <span className="paiMt">{t("colEcart")}</span>
                    <span>{t("colStatut")}</span>
                  </div>
                  {filtrees.map((l) => {
                    const s = l.salarie.data;
                    const avant = precedents.get(s.matricule);
                    const ecart = avant?.net ? ((l.calcul.net - avant.net) / avant.net) * 100 : null;
                    const statut = fige ? "pret" : C.statutLigne(s.matricule || l.salarie.id, controles);
                    return (
                      <button type="button" key={l.salarie.id || s.matricule} className="paiLigneT paiColsSalaries" role="row" onClick={() => aller("bulletins", { matricule: s.matricule })}>
                        <span className="paiQui">
                          <span className="paiAvatar">{initiales(s)}</span>
                          <b className="paiEllipse">{nomDe(s)}</b>
                        </span>
                        <span className="paiEllipse paiDoux">{s.poste || "—"}</span>
                        <span className="paiMt">{n(l.calcul.brut)}</span>
                        <b className="paiMt">{n(l.calcul.net)}</b>
                        <span className="paiMt" data-fort={ecart != null && Math.abs(ecart) >= 20 ? "true" : "false"}>
                          {ecart == null ? t("nouveau") : `${ecart >= 0 ? "+" : "−"} ${Math.abs(ecart).toLocaleString(p.langue === "en" ? "en-US" : "fr-FR", { maximumFractionDigits: 1 })} %`}
                        </span>
                        <span><Statut statut={statut} t={t} /></span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="paiRien">{t("aucunSalarie")}</p>
              )}
            </Carte>
          </div>

          <aside className="paiColonne">
            <Carte titre={t("echeances")}>
              <ul className="paiEcheances">
                {echeances.map((e) => (
                  <li key={e.titre}>
                    <span className="paiDate" data-ton={e.ton}>
                      <b>{e.jour}</b>
                      <small>{e.mois}</small>
                    </span>
                    <span>
                      <b>{e.titre}</b>
                      <small>{e.detail}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </Carte>
            <Carte titre={t("masseSixMois")} aide={t("masseAide")}>
              <div className="paiBarres" role="img" aria-label={masse.map((x) => `${nomMois(x.mois)} : ${m(x.cout)}`).join(", ")}>
                {masse.map((x, i) => (
                  <span key={x.mois} className="paiBarreCol" title={`${nomMois(x.mois)} : ${m(x.cout)}`}>
                    <small>{i === masse.length - 1 && x.cout ? n(x.cout) : ""}</small>
                    <span className="paiBarrePiste">
                      <span className="paiBarre" data-dernier={i === masse.length - 1 ? "true" : "false"} style={{ height: `${Math.max(2, (x.cout / max) * 100)}%` }} />
                    </span>
                    <span>{nomMois(x.mois, { annee: false, court: true })}</span>
                  </span>
                ))}
              </div>
            </Carte>
          </aside>
        </div>
      </div>
    </div>
  );
};

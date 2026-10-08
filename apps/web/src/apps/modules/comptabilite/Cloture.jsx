// Comptabilité — assistant de clôture.

import React, { useMemo, useState } from "react";
import { Icon } from "../../../utils/general";
import { modal } from "../../modalRequest";
import { bilanControles, controlesCloture, moisAClore, moisPrecedent, moisSuivant, nomMois } from "./cloture";
import { Bouton, Carte, Entete, Puce, aujourdhui, dateFr, useCpt } from "./commun";
import * as D from "./domaine";

export const Cloture = () => {
  const {
    ecritures,
    suggerees,
    relevesParCompte,
    lettres,
    reglages,
    clotureAu,
    verrouiller,
    rouvrir,
    aller,
    occupe,
    peutAdministrer,
  } = useCpt();
  const jour = aujourdhui();
  const [mois, setMois] = useState(() => moisAClore(clotureAu, jour));

  const controles = useMemo(
    () =>
      controlesCloture({
        mois,
        ecritures,
        suggerees,
        releves: relevesParCompte,
        lettres,
        tvaDeclarees: reglages.tvaDeclarees || {},
      }),
    [mois, ecritures, suggerees, relevesParCompte, lettres, reglages.tvaDeclarees],
  );
  const s = bilanControles(controles);
  const fin = D.mois(mois).au;
  const dejaClos = !!clotureAu && fin <= clotureAu;
  // On ne clôt pas un mois en laissant ouvert celui d'avant : la clôture
  // est une date, tout ce qui la précède est verrouillé d'un coup.
  const options = useMemo(() => {
    const liste = [];
    let m = moisSuivant(jour.slice(0, 7));
    for (let i = 0; i < 14; i += 1) {
      m = moisPrecedent(m);
      liste.push(m);
    }
    return liste;
  }, [jour]);
  const historique = [...(reglages.historique || [])].reverse();

  const lancer = async () => {
    const avertissements = controles.filter((c) => !c.ok && !c.bloquant);
    const ok = await modal.confirm({
      title: `Verrouiller ${nomMois(mois)} ?`,
      message: avertissements.length
        ? `${avertissements.length} point(s) restent à revoir : ${avertissements.map((c) => c.titre.toLowerCase()).join(", ")}.`
        : "Tous les contrôles sont au vert.",
      detail: `Plus aucune écriture ne pourra être datée du ${dateFr(fin)} ou avant. Une correction passera par une extourne datée de ${nomMois(moisSuivant(mois), { annee: false })}.`,
      confirmLabel: "Verrouiller",
    });
    if (ok) await verrouiller(fin);
  };

  return (
    <div className="cptVue">
      <Entete titre="Clôture et états financiers">
        <select className="cptSelectTete" value={mois} onChange={(e) => setMois(e.target.value)} aria-label="Mois à clôturer">
          {options.map((m) => (
            <option key={m} value={m}>
              Mois · {nomMois(m)}
              {clotureAu && D.mois(m).au <= clotureAu ? " (verrouillé)" : ""}
            </option>
          ))}
        </select>
        <Bouton icone="faFileInvoiceDollar" onClick={() => aller("etats")}>États financiers</Bouton>
      </Entete>

      <div className="cptConteneur">
        <div className="cptGrille">
          <Carte className="cptLarge" titre={`Clôturer ${nomMois(mois)}`}>
            <div className="cptProgres">
              <span className="cptProgresPiste">
                <span style={{ width: `${(s.ok / s.total) * 100}%` }} />
              </span>
              <b>{s.ok} / {s.total}</b>
            </div>
            <p className="cptAide">Chaque contrôle se vérifie tout seul. La période se verrouille quand aucun point bloquant ne reste.</p>
            <ul className="cptEtapesCloture">
              {controles.map((c) => (
                <li key={c.id} data-etat={c.ok ? "ok" : c.bloquant ? "bloque" : "todo"}>
                  <Puce ok={c.ok} bloquant={c.bloquant} />
                  <span>
                    <b>{c.titre}</b>
                    <small>{c.detail}</small>
                  </span>
                  {c.action ? (
                    <Bouton
                      onClick={() =>
                        aller(c.action.section, {
                          ...(c.action.compte ? { compte: c.action.compte } : {}),
                          ...(c.action.journal ? { journal: c.action.journal } : {}),
                          ...(c.id === "tva" ? { mois } : {}),
                        })
                      }
                    >
                      {c.action.label}
                    </Bouton>
                  ) : null}
                </li>
              ))}
            </ul>
            {dejaClos ? (
              <div className="cptInfo" data-ton="ok">
                <Icon fafa="faLock" width={14} />
                <span>{nomMois(mois)} est déjà verrouillé (clôture au {dateFr(clotureAu)}).</span>
              </div>
            ) : (
              <>
                <div className="cptInfo" data-ton="attention">
                  <Icon fafa="faCircleInfo" width={14} />
                  <span>
                    Une fois verrouillé, {nomMois(mois, { annee: false })} ne se modifie plus : une correction passe par une écriture d'extourne datée de {nomMois(moisSuivant(mois), { annee: false })}.
                  </span>
                </div>
                <div className="cptActions">
                  <Bouton variante="principal" icone="faLock" disabled={occupe || !s.verrouillable} onClick={lancer}>
                    Verrouiller {nomMois(mois, { annee: false })}
                  </Bouton>
                  {!s.verrouillable ? <small className="cptAide">{s.bloquants.map((b) => b.titre).join(" · ")} : à régler d'abord.</small> : null}
                </div>
              </>
            )}
          </Carte>

          <div className="cptColonne">
            <Carte titre="États de la période">
              <div className="cptLiens">
                <button type="button" className="cptLien" onClick={() => aller("etats", { onglet: "bilan" })}>Bilan →</button>
                <button type="button" className="cptLien" onClick={() => aller("etats", { onglet: "resultat" })}>Compte de résultat →</button>
                <button type="button" className="cptLien" onClick={() => aller("etats", { onglet: "flux" })}>Flux de trésorerie →</button>
                <button type="button" className="cptLien" onClick={() => aller("balance")}>Balance générale →</button>
              </div>
            </Carte>
            <Carte titre="Historique">
              {historique.length ? (
                <ul className="cptHistorique">
                  {historique.slice(0, 8).map((h, i) => (
                    <li key={i}>
                      <Icon fafa={h.reouverture ? "faLockOpen" : "faLock"} width={11} />
                      <span>
                        {h.reouverture ? "Réouverture" : "Clôture"} {h.au ? `au ${dateFr(h.au)}` : "totale"}
                        <small> · le {dateFr(h.le)}{h.par ? ` par ${h.par}` : ""}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cptRien">Aucune période n'a encore été close.</p>
              )}
              {clotureAu && peutAdministrer ? (
                <button
                  type="button"
                  className="cptLien"
                  onClick={() => {
                    const precedent = moisPrecedent(clotureAu.slice(0, 7));
                    const premier = ecritures.length ? ecritures.reduce((m, e) => (e.data.date < m ? e.data.date : m), "9999") : "";
                    rouvrir(premier && D.mois(precedent).au >= premier ? D.mois(precedent).au : "");
                  }}
                >
                  Rouvrir {nomMois(clotureAu.slice(0, 7), { annee: false })} →
                </button>
              ) : null}
            </Carte>
          </div>
        </div>
      </div>
    </div>
  );
};

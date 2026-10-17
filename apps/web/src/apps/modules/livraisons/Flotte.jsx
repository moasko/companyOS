// Livraisons — « Flotte et livreurs » : les véhicules avec leurs
// échéances (assurance, visite technique, vidange) et ce que chaque
// livreur a livré et encaissé sur la période.

import React, { useMemo, useState } from "react";
import { Icon } from "../../../utils/general";
import { suivreLien } from "../../notifications";
import * as L from "@companyos/shared/livraisons";
import { Avatar, IconeVehicule, dateCourte, decalerJour, fcfa, useLiv } from "./commun";

const PERIODES = [
  { id: "7", label: "7 jours" },
  { id: "30", label: "30 jours" },
  { id: "90", label: "3 mois" },
];

export const Flotte = () => {
  const c = useLiv();
  const [periode, setPeriode] = useState("30");
  const depuis = decalerJour(L.aujourdhui(), -Number(periode));

  const perfs = useMemo(
    () =>
      c.livreurs
        .map((x) => ({ ...x, perf: L.performance(c.livraisons, x.id, { depuis }), vehicule: c.vehicules.find((v) => v.data.livreurId === x.id) || null }))
        .sort((a, b) => b.perf.livrees - a.perf.livrees || a.nom.localeCompare(b.nom, "fr")),
    [c.livreurs, c.livraisons, c.vehicules, depuis],
  );
  // Les livreurs : ceux qui ont livré sur la période, ont un véhicule
  // attitré ou un poste de logistique. Les autres salariés restent
  // disponibles pour une tournée, mais n'encombrent pas le tableau.
  const [tous, setTous] = useState(false);
  const actifs = perfs.filter((x) => x.perf.total || x.vehicule || /livr|logist|chauffeur|coursier/i.test(x.poste));
  const affiches = tous ? perfs : actifs;
  const alertes = c.vehicules.reduce((s, v) => s + L.alertesVehicule(v.data).length, 0);

  return (
    <div className="lvVue">
      {!c.telephone ? (
        <header className="lvEntete">
          <div>
            <h1>Flotte et livreurs</h1>
            <p>{c.vehicules.length} véhicule{c.vehicules.length > 1 ? "s" : ""}{alertes ? ` · ${alertes} échéance${alertes > 1 ? "s" : ""} à traiter` : " · tout est à jour"}</p>
          </div>
          <div className="lvEnteteActions">
            <button type="button" className="lvBouton" onClick={() => c.ouvrirFormulaire({ type: "vehicule" })}>
              <Icon fafa="faPlus" width={11} /> Ajouter un véhicule
            </button>
          </div>
        </header>
      ) : null}

      <section className="lvGroupe">
        <h2>Véhicules {c.telephone ? <button type="button" className="lvLien" onClick={() => c.ouvrirFormulaire({ type: "vehicule" })}>Ajouter</button> : null}</h2>
        {c.vehicules.length ? (
          <div className="lvGrilleCartes">
            {c.vehicules.map((v) => {
              const d = v.data;
              const al = L.alertesVehicule(d);
              const lv = c.livreur(d.livreurId);
              const enTournee = c.tournees.some((t) => t.data.vehiculeId === v.id && t.data.statut === "en_cours");
              return (
                <button key={v.id} type="button" className="lvVehicule" data-alerte={al.some((a) => a.ton === "danger") ? "danger" : al.length ? "attention" : undefined} onClick={() => c.ouvrirFormulaire({ type: "vehicule", vehicule: v })}>
                  <div className="lvVehiculeTete">
                    <span className="lvVehiculeIcone"><IconeVehicule type={d.type} taille={16} /></span>
                    <span>
                      <b>{d.nom}</b>
                      <small className="lvMono">{d.immatriculation || "Sans immatriculation"}</small>
                    </span>
                    <span className="lvEtatTournee" data-statut={d.statut === "maintenance" ? "maintenance" : enTournee ? "en_cours" : "planifiee"}>
                      {d.statut === "maintenance" ? "Maintenance" : enTournee ? "En tournée" : "Disponible"}
                    </span>
                  </div>
                  <dl className="lvVehiculeInfos">
                    <div><dt>Livreur</dt><dd>{lv ? lv.nom : "—"}</dd></div>
                    <div><dt>Assurance</dt><dd>{d.assuranceFin ? dateCourte(d.assuranceFin) : "—"}</dd></div>
                    <div><dt>Visite</dt><dd>{d.visiteFin ? dateCourte(d.visiteFin) : "—"}</dd></div>
                    <div><dt>Kilométrage</dt><dd>{d.kilometrage ? `${Number(d.kilometrage).toLocaleString("fr-FR")} km` : "—"}</dd></div>
                  </dl>
                  {al.length ? (
                    <ul className="lvAlertes">
                      {al.map((a, i) => <li key={i} data-ton={a.ton}><Icon fafa="faTriangleExclamation" width={10} /> {a.texte}</li>)}
                    </ul>
                  ) : (
                    <div className="lvAJour"><Icon fafa="faCircleCheck" width={10} /> Échéances à jour</div>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="lvVide" data-compact>
            <Icon fafa="faMotorcycle" width={24} />
            <b>Aucun véhicule enregistré</b>
            <span>Ajoutez vos motos et camionnettes : CompanyOS vous préviendra avant l'expiration de l'assurance ou de la visite technique.</span>
            <button type="button" className="lvBouton" onClick={() => c.ouvrirFormulaire({ type: "vehicule" })}>Ajouter un véhicule</button>
          </div>
        )}
      </section>

      <section className="lvGroupe">
        <h2>
          Livreurs
          <div className="lvSegment" role="group" aria-label="Période">
            {PERIODES.map((p) => <button key={p.id} type="button" data-actif={periode === p.id || undefined} onClick={() => setPeriode(p.id)}>{p.label}</button>)}
          </div>
        </h2>
        {affiches.length ? (
          <div className="lvTableEnv">
            <table className="lvTable" data-statique>
              <thead>
                <tr>
                  <th>Livreur</th>
                  {!c.telephone ? <th>Véhicule</th> : null}
                  <th data-droite>Livrées</th>
                  {!c.telephone ? <th data-droite>Échecs</th> : null}
                  <th>Réussite</th>
                  <th data-droite>Encaissé</th>
                </tr>
              </thead>
              <tbody>
                {affiches.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <span className="lvQui"><Avatar nom={x.nom} taille={26} /> <span><b>{x.nom}</b><small>{x.poste || x.telephone || "—"}</small></span></span>
                    </td>
                    {!c.telephone ? <td>{x.vehicule ? <span className="lvQui"><IconeVehicule type={x.vehicule.data.type} taille={11} /> {x.vehicule.data.nom}</span> : <span className="lvDiscret">—</span>}</td> : null}
                    <td data-droite><b>{x.perf.livrees}</b>{x.perf.total ? <small>sur {x.perf.total}</small> : null}</td>
                    {!c.telephone ? <td data-droite>{x.perf.echecs || <span className="lvDiscret">0</span>}</td> : null}
                    <td>
                      {x.perf.taux == null ? <span className="lvDiscret">—</span> : (
                        <span className="lvTaux" data-ton={x.perf.taux >= 90 ? "ok" : x.perf.taux >= 75 ? "attention" : "danger"}>
                          <i style={{ width: `${x.perf.taux}%` }} />
                          <b>{x.perf.taux} %</b>
                        </span>
                      )}
                    </td>
                    <td data-droite><b>{fcfa(x.perf.encaisse)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="lvVide" data-compact>
            <Icon fafa="faUserPlus" width={24} />
            <b>Aucun livreur</b>
            <span>Vos livreurs sont les salariés de l'app Ressources humaines. Ajoutez-les là-bas avec leur téléphone.</span>
            <button type="button" className="lvBouton" data-variante="secondaire" onClick={() => suivreLien({ lien: { app: "rh", params: {} } })}>Ouvrir les RH</button>
          </div>
        )}
        {perfs.length > actifs.length ? (
          <button type="button" className="lvLien lvNote" onClick={() => setTous(!tous)}>
            {tous ? "Masquer les autres salariés" : `Afficher les ${perfs.length - actifs.length} autres salariés`}
          </button>
        ) : null}
      </section>
    </div>
  );
};

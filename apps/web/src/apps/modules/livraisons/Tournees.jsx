// Livraisons — « Tournées » : l'historique des tournées, jour par jour,
// et la feuille de route imprimable que le livreur garde sur lui.

import React, { useMemo, useState } from "react";
import { Icon } from "../../../utils/general";
import * as L from "@companyos/shared/livraisons";
import { Avancement, Avatar, IconeVehicule, Statut, dateCourte, decalerJour, fcfa, heure, jourLisible, useLiv } from "./commun";

const PERIODES = [
  { id: "7", label: "7 jours" },
  { id: "30", label: "30 jours" },
  { id: "tout", label: "Tout" },
];

const ETATS = { planifiee: "Planifiée", en_cours: "En cours", terminee: "Terminée" };

export const Tournees = () => {
  const c = useLiv();
  const [periode, setPeriode] = useState("7");
  const [livreurId, setLivreurId] = useState("");
  const [ouverte, setOuverte] = useState(null);

  const liste = useMemo(() => {
    const depuis = periode === "tout" ? "" : decalerJour(L.aujourdhui(), -Number(periode));
    return c.tournees
      .filter((t) => (!depuis || t.data.date >= depuis) && (!livreurId || t.data.livreurId === livreurId))
      .sort((a, b) => (b.data.date || "").localeCompare(a.data.date || "") || (b.data.numero || "").localeCompare(a.data.numero || ""));
  }, [c.tournees, periode, livreurId]);

  // Regroupées par jour : c'est ainsi qu'on les cherche.
  const parJour = useMemo(() => {
    const m = new Map();
    for (const t of liste) m.set(t.data.date, [...(m.get(t.data.date) || []), t]);
    return [...m.entries()];
  }, [liste]);

  return (
    <div className="lvVue">
      {!c.telephone ? (
        <header className="lvEntete">
          <div>
            <h1>Tournées</h1>
            <p>Chaque tournée, ses arrêts, ce qui a été livré et encaissé.</p>
          </div>
          <div className="lvEnteteActions">
            <button type="button" className="lvBouton" onClick={() => c.ouvrirFormulaire({ type: "tournee", date: c.jour })}>
              <Icon fafa="faPlus" width={11} /> Nouvelle tournée
            </button>
          </div>
        </header>
      ) : null}

      <div className="lvFiltres">
        <div className="lvSegment" role="group" aria-label="Période">
          {PERIODES.map((p) => (
            <button key={p.id} type="button" data-actif={periode === p.id || undefined} onClick={() => setPeriode(p.id)}>{p.label}</button>
          ))}
        </div>
        <select value={livreurId} onChange={(e) => setLivreurId(e.target.value)} aria-label="Livreur">
          <option value="">Tous les livreurs</option>
          {c.livreurs.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
        </select>
      </div>

      {parJour.length ? (
        parJour.map(([date, ts]) => (
          <section key={date} className="lvGroupe">
            <h2>{jourLisible(date)} <span>{dateCourte(date)}</span></h2>
            <div className="lvTableau">
              {ts.map((t) => (
                <LigneTournee key={t.id} t={t} ouverte={ouverte === t.id} onBasculer={() => setOuverte(ouverte === t.id ? null : t.id)} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="lvVide">
          <Icon fafa="faRoute" width={28} />
          <b>Aucune tournée sur la période</b>
          <span>Créez une tournée depuis « Aujourd'hui » : choisissez un livreur, glissez-lui ses livraisons.</span>
          <button type="button" className="lvBouton" onClick={() => c.setVue("jour")}>Ouvrir la répartition</button>
        </div>
      )}
    </div>
  );
};

const LigneTournee = ({ t, ouverte, onBasculer }) => {
  const c = useLiv();
  const arrets = c.arretsDe(t.id);
  const lv = c.livreur(t.data.livreurId);
  const ve = c.vehicule(t.data.vehiculeId);
  const av = L.avancementTournee(arrets);
  const est = L.estimerTournee(arrets, { depot: c.depotPos, vehicule: ve?.data.type });
  const encaisse = arrets.reduce((s, l) => s + (Number(l.data.encaissement?.montant) || 0), 0);
  const echecs = arrets.filter((l) => l.data.statut === "echec").length;
  const statut = t.data.statut || "planifiee";

  return (
    <article className="lvLigneTournee" data-ouverte={ouverte || undefined}>
      <button type="button" className="lvLigneTourneeTete" onClick={onBasculer} aria-expanded={ouverte}>
        <Avatar nom={lv?.nom || "?"} taille={32} />
        <span className="lvLigneTourneeNom">
          <b>{lv?.nom || "Livreur à choisir"}</b>
          <small><span className="lvMono">{t.data.numero}</span> · {ve ? <><IconeVehicule type={ve.data.type} taille={9} /> {ve.data.nom}</> : "sans véhicule"}</small>
        </span>
        <span className="lvLigneTourneeAv">
          <small>{av.fait}/{av.total} arrêts{echecs ? ` · ${echecs} échec${echecs > 1 ? "s" : ""}` : ""}</small>
          <Avancement pct={av.pct} ton={statut === "terminee" ? "ok" : "info"} />
        </span>
        <span className="lvLigneTourneeChiffre"><small>Distance</small><b>{est.km} km</b></span>
        <span className="lvLigneTourneeChiffre"><small>Encaissé</small><b>{fcfa(encaisse)}</b></span>
        <span className="lvEtatTournee" data-statut={statut}>{ETATS[statut]}</span>
        <Icon fafa={ouverte ? "faChevronUp" : "faChevronDown"} width={10} />
      </button>
      {ouverte ? (
        <div className="lvLigneTourneeCorps">
          <ol className="lvArretsListe">
            {arrets.map((l, i) => (
              <li key={l.id}>
                <span className="lvNumero">{i + 1}</span>
                <button type="button" className="lvLien" onClick={() => c.ouvrirFiche(l.id)}>{l.data.clientNom || l.data.contact}</button>
                <span className="lvDiscret">{l.data.commune}</span>
                <span className="lvEspace" />
                {l.data.encaissement?.montant ? <span className="lvMono">{fcfa(l.data.encaissement.montant)}</span> : null}
                {l.data.preuve?.le ? <span className="lvDiscret">{heure(l.data.preuve.le)}</span> : null}
                <Statut statut={l.data.statut} petit />
              </li>
            ))}
            {!arrets.length ? <li className="lvDiscret">Aucun arrêt.</li> : null}
          </ol>
          <div className="lvLigneTourneePied">
            {t.data.notes ? <span className="lvDiscret"><Icon fafa="faNoteSticky" width={10} /> {t.data.notes}</span> : null}
            <span className="lvEspace" />
            <button type="button" className="lvBouton" data-variante="secondaire" disabled={!arrets.length} onClick={() => imprimerFeuille(t, arrets, c)}>
              <Icon fafa="faPrint" width={11} /> Feuille de route
            </button>
            {statut !== "terminee" ? (
              <button type="button" className="lvBouton" data-variante="secondaire" onClick={() => c.ouvrirFormulaire({ type: "tournee", tournee: t })}>
                <Icon fafa="faPen" width={11} /> Modifier
              </button>
            ) : null}
            <button type="button" className="lvIconeBtn" aria-label="Supprimer la tournée" title="Supprimer" onClick={() => c.supprimerTournee(t)}>
              <Icon fafa="faTrashCan" width={12} />
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
};

// ---------------------------------------------------------------------------
// Feuille de route imprimable
// ---------------------------------------------------------------------------

const echapper = (s) => String(s ?? "").replace(/[&<>"']/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[x]);

/// Ouvre la feuille de route d'une tournée dans un nouvel onglet et lance
/// l'impression : une ligne par arrêt, avec contact, repère, colis, montant
/// à encaisser et une case « signature » pour le papier.
export const imprimerFeuille = (t, arrets, c) => {
  const lv = c.livreur(t.data.livreurId);
  const ve = c.vehicule(t.data.vehiculeId);
  const est = L.estimerTournee(arrets, { depot: c.depotPos, vehicule: ve?.data.type });
  const total = arrets.reduce((s, l) => s + (Number(l.data.montantAEncaisser) || 0), 0);
  const entreprise = c.entreprise?.nom || "";
  const lignes = arrets
    .map((l, i) => {
      const d = l.data;
      const colis = (d.colis || []).map((x) => `${echapper(x.designation)} × ${echapper(x.qte)}`).join("<br>");
      return `<tr>
        <td class="n">${i + 1}</td>
        <td><b>${echapper(d.clientNom || d.contact)}</b><br>${echapper(d.contact && d.contact !== d.clientNom ? d.contact : "")} ${echapper(d.telephone)}<br><span class="m">${echapper(d.numero)}${d.creneau ? ` · ${echapper(d.creneau.debut)}–${echapper(d.creneau.fin)}` : ""}</span></td>
        <td>${echapper(d.commune)}${d.adresse ? `, ${echapper(d.adresse)}` : ""}${d.repere ? `<br><i>${echapper(d.repere)}</i>` : ""}${d.instructions ? `<br><span class="m">${echapper(d.instructions)}</span>` : ""}</td>
        <td>${colis || "—"}</td>
        <td class="r">${Number(d.montantAEncaisser) > 0 ? echapper(fcfa(d.montantAEncaisser)) : "—"}</td>
        <td class="s"></td>
      </tr>`;
    })
    .join("");
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Feuille de route ${echapper(t.data.numero)}</title>
  <style>
    *{box-sizing:border-box}body{font:12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#111827;margin:24px}
    header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111827;padding-bottom:10px;margin-bottom:14px}
    h1{font-size:20px;margin:0}header p{margin:2px 0 0;color:#4b5563}
    .resume{display:flex;gap:24px;margin:0 0 14px}.resume div{display:flex;flex-direction:column}.resume small{color:#6b7280;text-transform:uppercase;font-size:9px;letter-spacing:.06em}.resume b{font-size:14px}
    table{width:100%;border-collapse:collapse}th{text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;border-bottom:1px solid #d1d5db;padding:6px}
    td{border-bottom:1px solid #e5e7eb;padding:8px 6px;vertical-align:top}td.n{font-weight:700;font-size:14px;width:28px}td.r{text-align:right;white-space:nowrap;font-weight:600}td.s{width:120px}
    .m{color:#6b7280;font-size:11px}tr{page-break-inside:avoid}
    footer{margin-top:24px;display:flex;justify-content:space-between;color:#6b7280}footer div{border-top:1px solid #9ca3af;padding-top:4px;width:200px}
  </style></head><body>
  <header><div><h1>Feuille de route — ${echapper(t.data.numero)}</h1><p>${echapper(entreprise)} · ${echapper(jourLisible(t.data.date))} ${echapper(dateCourte(t.data.date))}</p></div>
  <div style="text-align:right"><b>${echapper(lv?.nom || "")}</b><br>${echapper(lv?.telephone || "")}<br>${echapper(ve ? `${ve.data.nom}${ve.data.immatriculation ? ` · ${ve.data.immatriculation}` : ""}` : "")}</div></header>
  <div class="resume"><div><small>Arrêts</small><b>${arrets.length}</b></div><div><small>Distance estimée</small><b>${est.km} km</b></div><div><small>Durée estimée</small><b>${echapper(L.dureeLisible(est.minutes))}</b></div><div><small>À encaisser</small><b>${echapper(fcfa(total))}</b></div><div><small>Départ</small><b>${echapper(c.reglages.depot?.nom || "Dépôt")} — ${echapper(c.reglages.depot?.commune || "")}</b></div></div>
  <table><thead><tr><th>#</th><th>Client</th><th>Adresse et repère</th><th>Colis</th><th style="text-align:right">À encaisser</th><th>Signature</th></tr></thead><tbody>${lignes}</tbody></table>
  <footer><div>Signature du livreur</div><div>Visa au retour (caisse)</div></footer>
  <script>window.onload=()=>{window.print()}</script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
};

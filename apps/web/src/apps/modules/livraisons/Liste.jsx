// Livraisons — « Livraisons » : toutes les livraisons, filtrables, avec
// l'export pour Excel. On y retrouve une commande en tapant un nom, un
// numéro de téléphone, une commune ou un numéro de facture.

import React, { useMemo, useState } from "react";
import { Icon } from "../../../utils/general";
import { saveAs } from "../../cloud";
import { modal } from "../../modalRequest";
import * as L from "@companyos/shared/livraisons";
import { Avatar, Statut, dateCourte, decalerJour, fcfa, useLiv } from "./commun";

const FILTRES = [
  { id: "ouvertes", label: "En cours", test: (s) => L.STATUTS[s]?.ouvert },
  { id: "a_planifier", label: "À planifier", test: (s) => s === "a_planifier" },
  { id: "en_route", label: "En route", test: (s) => s === "en_route" },
  { id: "livree", label: "Livrées", test: (s) => s === "livree" },
  { id: "echec", label: "Échecs", test: (s) => s === "echec" },
  { id: "toutes", label: "Toutes", test: () => true },
];

const PERIODES = [
  { id: "jour", label: "Jour affiché" },
  { id: "7", label: "7 jours" },
  { id: "30", label: "30 jours" },
  { id: "tout", label: "Tout" },
];

const csvDe = (lignes) => "﻿" + lignes.map((l) => l.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
const normal = (s = "") => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const Liste = () => {
  const c = useLiv();
  const [filtre, setFiltre] = useState("ouvertes");
  const [periode, setPeriode] = useState("30");
  const [q, setQ] = useState("");
  const [tri, setTri] = useState({ cle: "date", sens: -1 });

  const compte = useMemo(() => Object.fromEntries(FILTRES.map((f) => [f.id, c.livraisons.filter((l) => f.test(l.data.statut)).length])), [c.livraisons]);

  const { livraisons, jour, livreur } = c;
  const lignes = useMemo(() => {
    const test = FILTRES.find((f) => f.id === filtre).test;
    const depuis = periode === "jour" || periode === "tout" ? "" : decalerJour(L.aujourdhui(), -Number(periode));
    const mots = normal(q).split(/\s+/).filter(Boolean);
    const val = (l) => {
      const d = l.data;
      if (tri.cle === "client") return normal(d.clientNom || d.contact || "");
      if (tri.cle === "commune") return normal(d.commune || "");
      if (tri.cle === "montant") return Number(d.encaissement?.montant || d.montantAEncaisser) || 0;
      if (tri.cle === "statut") return Object.keys(L.STATUTS).indexOf(d.statut);
      return `${d.date || ""}${String(d.ordre || 0).padStart(3, "0")}`;
    };
    return livraisons
      .filter((l) => test(l.data.statut))
      .filter((l) => (periode === "jour" ? l.data.date === jour : !depuis || l.data.date >= depuis || L.STATUTS[l.data.statut]?.ouvert))
      .filter((l) => {
        if (!mots.length) return true;
        const d = l.data;
        const texte = normal([d.numero, d.clientNom, d.contact, d.telephone, d.commune, d.adresse, d.repere, d.factureNumero, livreur(d.livreurId)?.nom].join(" "));
        return mots.every((m) => texte.includes(m));
      })
      .sort((a, b) => {
        const x = val(a);
        const y = val(b);
        return (x < y ? -1 : x > y ? 1 : 0) * tri.sens;
      });
  }, [livraisons, jour, livreur, filtre, periode, q, tri]);

  const totaux = useMemo(() => ({
    encaisse: lignes.reduce((s, l) => s + (Number(l.data.encaissement?.montant) || 0), 0),
    attendu: lignes.reduce((s, l) => s + (L.STATUTS[l.data.statut]?.ouvert ? Number(l.data.montantAEncaisser) || 0 : 0), 0),
  }), [lignes]);

  const trier = (cle) => setTri((t) => ({ cle, sens: t.cle === cle ? -t.sens : cle === "date" || cle === "montant" ? -1 : 1 }));
  const Th = ({ cle, children, droite }) => (
    <th data-droite={droite || undefined} aria-sort={tri.cle === cle ? (tri.sens > 0 ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => trier(cle)}>
        {children}
        {tri.cle === cle ? <Icon fafa={tri.sens > 0 ? "faArrowUp" : "faArrowDown"} width={8} /> : null}
      </button>
    </th>
  );

  const exporter = async () => {
    const entete = ["Numéro", "Date", "Statut", "Client", "Contact", "Téléphone", "Commune", "Adresse", "Repère", "Livreur", "Facture", "À encaisser", "Encaissé", "Moyen", "Référence", "Remis à", "Motif d'échec"];
    const corps = lignes.map(({ data: d }) => [
      d.numero, d.date, L.STATUTS[d.statut]?.label, d.clientNom, d.contact, d.telephone, d.commune, d.adresse, d.repere,
      c.livreur(d.livreurId)?.nom || "", d.factureNumero || "", Number(d.montantAEncaisser) || 0, Number(d.encaissement?.montant) || 0,
      d.encaissement ? L.moyenDe(d.encaissement.moyen).label : "", d.encaissement?.reference || "", d.preuve?.recuPar || "",
      d.echec ? L.MOTIFS_ECHEC.find((m) => m.id === d.echec.motif)?.label || "" : "",
    ]);
    const blob = new Blob([csvDe([entete, ...corps])], { type: "text/csv;charset=utf-8" });
    try {
      const noeud = await saveAs(blob, `livraisons-${L.aujourdhui()}.csv`, { folder: "Livraisons" });
      if (noeud) modal.alert({ title: "Export terminé", message: `${corps.length} livraison(s) dans « ${noeud.name} ».`, tone: "success" });
    } catch (e) {
      modal.alert({ title: "Export impossible", message: e.message, tone: "error" });
    }
  };

  return (
    <div className="lvVue">
      {!c.telephone ? (
        <header className="lvEntete">
          <div>
            <h1>Livraisons</h1>
            <p>{lignes.length} livraison{lignes.length > 1 ? "s" : ""} · {fcfa(totaux.encaisse)} encaissés{totaux.attendu ? ` · ${fcfa(totaux.attendu)} attendus` : ""}</p>
          </div>
          <div className="lvEnteteActions">
            <button type="button" className="lvBouton" data-variante="secondaire" disabled={!lignes.length} onClick={exporter}>
              <Icon fafa="faFileExport" width={11} /> Exporter
            </button>
            <button type="button" className="lvBouton" onClick={() => c.ouvrirFormulaire({ type: "livraison" })}>
              <Icon fafa="faPlus" width={11} /> Nouvelle livraison
            </button>
          </div>
        </header>
      ) : null}

      <div className="lvOngletsStatut" role="tablist" aria-label="Statut">
        {FILTRES.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filtre === f.id} data-actif={filtre === f.id || undefined} onClick={() => setFiltre(f.id)}>
            {f.label} <em>{compte[f.id]}</em>
          </button>
        ))}
      </div>

      <div className="lvFiltres">
        <label className="lvChercher">
          <Icon fafa="faMagnifyingGlass" width={12} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Client, téléphone, commune, n° de facture…" aria-label="Rechercher" />
        </label>
        <select value={periode} onChange={(e) => setPeriode(e.target.value)} aria-label="Période">
          {PERIODES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>

      {lignes.length ? (
        c.telephone ? (
          <div className="lvListeTel">
            {lignes.map((l) => {
              const d = l.data;
              return (
                <button key={l.id} type="button" className="lvLigneTel" onClick={() => c.ouvrirFiche(l.id)}>
                  <span>
                    <b>{d.clientNom || d.contact}</b>
                    <small>{d.commune || "—"} · {dateCourte(d.date)} · <span className="lvMono">{d.numero}</span></small>
                  </span>
                  <span className="lvLigneTelDroite">
                    <Statut statut={d.statut} petit />
                    {Number(d.encaissement?.montant || d.montantAEncaisser) > 0 ? <small className="lvMono">{fcfa(d.encaissement?.montant || d.montantAEncaisser)}</small> : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="lvTableEnv cosScroll">
            <table className="lvTable">
              <thead>
                <tr>
                  <Th cle="date">Date</Th>
                  <th>N°</th>
                  <Th cle="client">Client</Th>
                  <Th cle="commune">Commune</Th>
                  <th>Livreur</th>
                  <Th cle="montant" droite>Montant</Th>
                  <Th cle="statut">Statut</Th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => {
                  const d = l.data;
                  const lv = c.livreur(d.livreurId);
                  const retard = L.enRetard(d);
                  return (
                    <tr key={l.id} onClick={() => c.ouvrirFiche(l.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && c.ouvrirFiche(l.id)}>
                      <td>
                        {dateCourte(d.date)}
                        {d.creneau ? <small>{d.creneau.debut}–{d.creneau.fin}</small> : null}
                      </td>
                      <td className="lvMono">{d.numero}</td>
                      <td>
                        <b>{d.clientNom || d.contact}</b>
                        <small>{d.telephone}{d.factureNumero ? ` · ${d.factureNumero}` : ""}</small>
                      </td>
                      <td>
                        {d.commune || "—"}
                        {d.repere ? <small>{d.repere}</small> : null}
                      </td>
                      <td>{lv ? <span className="lvQui"><Avatar nom={lv.nom} taille={20} /> {lv.nom}</span> : <span className="lvDiscret">—</span>}</td>
                      <td data-droite>
                        {d.encaissement?.montant ? <><b>{fcfa(d.encaissement.montant)}</b><small>{L.moyenDe(d.encaissement.moyen).label}</small></> : Number(d.montantAEncaisser) > 0 ? <>{fcfa(d.montantAEncaisser)}<small>à encaisser</small></> : <span className="lvDiscret">Payée</span>}
                      </td>
                      <td>
                        <Statut statut={d.statut} petit />
                        {retard ? <span className="lvBadge" data-ton="attention">En retard</span> : null}
                        {d.priorite === "urgente" && L.STATUTS[d.statut]?.ouvert ? <span className="lvBadge" data-ton="danger">Urgent</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="lvVide">
          <Icon fafa={q ? "faMagnifyingGlass" : "faBoxOpen"} width={28} />
          <b>{q ? "Aucun résultat" : "Aucune livraison ici"}</b>
          <span>{q ? "Essayez un autre nom, un numéro de téléphone ou une commune." : "Changez de filtre, ou créez une livraison depuis une facture en deux clics."}</span>
          {!q ? <button type="button" className="lvBouton" onClick={() => c.ouvrirFormulaire({ type: "livraison" })}>Nouvelle livraison</button> : null}
        </div>
      )}
    </div>
  );
};

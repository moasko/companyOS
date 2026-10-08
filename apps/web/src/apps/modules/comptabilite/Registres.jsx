// Comptabilité — journaux, grand livre, balance et plan comptable.

import React, { useMemo, useState } from "react";
import { Icon } from "../../../utils/general";
import { choisirFichierCloud } from "../../ChoisirFichier";
import * as D from "./domaine";
import { JOURNAUX, journalDe, trousNumerotation } from "./journaux";
import { lignesLettrage } from "./lettrage";
import { rapportPdf } from "./pdf";
import {
  Bouton,
  Carte,
  Entete,
  Origine,
  csvDe,
  dateCourte,
  dateFr,
  nb,
  nbSigne,
  ouvrirPiece,
  rangerDansLeCloud,
  useCpt,
} from "./commun";

const dansContexte = (e, { du, au, axe }) => {
  const d = e.data.date;
  if (axe && e.data.axe !== axe) return false;
  return (!du || d >= du) && (!au || d <= au);
};

// ---------------------------------------------------------------------------
// Journaux
// ---------------------------------------------------------------------------

export const Journaux = () => {
  const { ecritures, contexte, periode, intention, contrepasser, joindre, lettrages } = useCpt();
  const [journal, setJournal] = useState("");
  const [q, setQ] = useState("");
  const [sansJustif, setSansJustif] = useState(intention?.filtre === "sansJustificatif");
  const [limite, setLimite] = useState(80);

  const periodeEcr = useMemo(() => ecritures.filter((e) => dansContexte(e, contexte)), [ecritures, contexte]);
  const comptes = useMemo(() => {
    const m = {};
    for (const e of periodeEcr) m[journalDe(e)] = (m[journalDe(e)] || 0) + 1;
    return m;
  }, [periodeEcr]);
  const trous = useMemo(() => trousNumerotation(ecritures), [ecritures]);

  const liste = useMemo(() => {
    const t = q.trim().toLowerCase();
    return periodeEcr
      .filter((e) => !journal || journalDe(e) === journal)
      .filter((e) => !sansJustif || (!e.data.justificatif && !e.data.origine && !e.data.contrepasse))
      .filter(
        (e) =>
          !t ||
          [e.data.libelle, e.data.numero, e.data.piece, e.data.tiers, ...(e.data.lignes || []).map((l) => l.compte)]
            .join(" ")
            .toLowerCase()
            .includes(t),
      )
      .sort(
        (a, b) =>
          String(b.data.date).localeCompare(String(a.data.date)) ||
          String(b.data.numero || "").localeCompare(String(a.data.numero || "")),
      );
  }, [periodeEcr, journal, sansJustif, q]);

  const joindreA = async (e) => {
    const node = await choisirFichierCloud({
      titre: `Justificatif de ${e.data.numero || e.data.libelle}`,
      filtre: (n) => /\.(pdf|png|jpe?g|webp|gif)$/i.test(n.name),
    });
    if (node) await joindre(e, node);
  };

  /// Export au format du fichier des écritures comptables (FEC) : une ligne
  /// par ligne d'écriture, colonnes normalisées. C'est ce que lisent tous
  /// les logiciels de production des cabinets.
  const exporterFec = async () => {
    const lettresParCle = new Map();
    for (const compte of ["411", "401"]) {
      for (const l of lignesLettrage(ecritures, compte, lettrages)) {
        if (l.lettre && l.lettre !== "auto") lettresParCle.set(l.cle, l.lettre);
      }
    }
    const lignes = [
      ["JournalCode", "JournalLib", "EcritureNum", "EcritureDate", "CompteNum", "CompteLib", "CompAuxLib", "PieceRef", "PieceDate", "EcritureLib", "Debit", "Credit", "EcritureLet", "Origine"],
    ];
    const tri = [...periodeEcr].sort((a, b) => String(a.data.date).localeCompare(String(b.data.date)));
    for (const e of tri) {
      const j = journalDe(e);
      (e.data.lignes || []).forEach((l, rang) => {
        lignes.push([
          j,
          JOURNAUX.find((x) => x.code === j)?.label || "",
          e.data.numero || "",
          e.data.date.replace(/-/g, ""),
          l.compte,
          D.intitule(l.compte),
          l.tiers || (/^4(0|1)/.test(l.compte) ? e.data.tiers || "" : ""),
          e.data.piece || e.data.reference || "",
          e.data.date.replace(/-/g, ""),
          l.libelle || e.data.libelle,
          String(Math.round(l.debit || 0)),
          String(Math.round(l.credit || 0)),
          lettresParCle.get(`${e.id}#${rang}`) || "",
          e.data.origine || "",
        ]);
      });
    }
    await rangerDansLeCloud(
      new Blob([csvDe(lignes)], { type: "text/csv;charset=utf-8" }),
      `ecritures-${periode.du}-${periode.au}.csv`,
      "Écritures exportées",
    );
  };

  return (
    <div className="cptVue">
      <Entete titre="Journaux" sous={`${liste.length} pièce(s) sur la période`}>
        <input className="cptRecherche" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher une pièce, un compte, un tiers…" aria-label="Rechercher" />
        <Bouton icone="faFileCsv" onClick={exporterFec}>Export des écritures</Bouton>
      </Entete>
      <div className="cptConteneur">
        <div className="cptFiltres" role="tablist" aria-label="Journal">
          <button type="button" role="tab" aria-selected={!journal} onClick={() => setJournal("")}>
            Tous <small>{periodeEcr.length}</small>
          </button>
          {JOURNAUX.map((j) => (
            <button type="button" role="tab" key={j.code} aria-selected={journal === j.code} onClick={() => setJournal(j.code)}>
              {j.code} · {j.label} <small>{comptes[j.code] || 0}</small>
            </button>
          ))}
          <label className="cptCase">
            <input type="checkbox" checked={sansJustif} onChange={(e) => setSansJustif(e.target.checked)} />
            <span>Sans justificatif</span>
          </label>
        </div>

        {trous.length ? (
          <div className="cptInfo" data-ton="attention">
            <Icon fafa="faTriangleExclamation" width={14} />
            <span>
              Numérotation interrompue : {trous.slice(0, 5).join(", ")}
              {trous.length > 5 ? ` et ${trous.length - 5} autre(s)` : ""}. Un vérificateur le relèvera — une pièce annulée se contre-passe, elle ne se supprime pas.
            </span>
          </div>
        ) : null}

        <Carte aide="Le journal ne se corrige pas : une pièce fausse s'annule par une extourne. C'est ce qui le rend opposable.">
          {liste.length ? (
            <div className="cptTableau" role="table">
              <div className="cptLigneT cptEnteteT cptColsJournal" role="row">
                <span>Date</span>
                <span>Journal</span>
                <span>Pièce</span>
                <span>Libellé</span>
                <span>Tiers</span>
                <span className="cptMt">Montant</span>
                <span>Origine</span>
                <span aria-label="Justificatif" />
              </div>
              {liste.slice(0, limite).map((e) => (
                <button
                  type="button"
                  key={e.id}
                  className="cptLigneT cptColsJournal"
                  role="row"
                  onClick={() => ouvrirPiece(e, { onContrepasser: contrepasser, onJoindre: joindreA })}
                >
                  <span>{dateCourte(e.data.date)}</span>
                  <span className="cptJournal">{journalDe(e)}</span>
                  <span className="cptCode">{e.data.numero || e.data.piece || "—"}</span>
                  <span className="cptEllipse">{e.data.libelle}</span>
                  <span className="cptEllipse">{e.data.tiers || ""}</span>
                  <span className="cptMt">{nb(D.totauxEcriture(e.data).debit)}</span>
                  <span><Origine e={e} /></span>
                  <span>{e.data.justificatif ? <Icon fafa="faPaperclip" width={11} /> : null}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="cptRien">Aucune pièce ne correspond.</p>
          )}
          {liste.length > limite ? (
            <button type="button" className="cptLien" onClick={() => setLimite((x) => x + 200)}>
              Afficher les {Math.min(200, liste.length - limite)} suivantes
            </button>
          ) : null}
        </Carte>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Grand livre
// ---------------------------------------------------------------------------

export const GrandLivre = () => {
  const { ecritures, contexte, intention, contrepasser, entreprise, periode } = useCpt();
  const balance = useMemo(() => D.balance(ecritures, contexte), [ecritures, contexte]);
  const [compte, setCompte] = useState(intention?.compte || balance[0]?.compte || "411");
  const lignes = useMemo(() => D.grandLivre(ecritures, compte, contexte), [ecritures, compte, contexte]);
  const t = lignes.reduce((s, l) => ({ debit: s.debit + (l.debit || 0), credit: s.credit + (l.credit || 0) }), { debit: 0, credit: 0 });

  const pdf = () =>
    rangerDansLeCloud(
      rapportPdf({
        titre: "Grand livre",
        sousTitre: `${compte} ${D.intitule(compte)} — du ${dateFr(periode.du)} au ${dateFr(periode.au)}`,
        entreprise,
        colonnes: [
          { label: "Date", largeur: 0.11 },
          { label: "Pièce", largeur: 0.16 },
          { label: "Libellé", largeur: 0.37 },
          { label: "Débit", largeur: 0.12, align: "right" },
          { label: "Crédit", largeur: 0.12, align: "right" },
          { label: "Solde", largeur: 0.12, align: "right" },
        ],
        lignes: [
          ...lignes.map((l) => ({ cellules: [dateFr(l.date), l.piece, l.libelle, l.debit ? nb(l.debit) : "", l.credit ? nb(l.credit) : "", nbSigne(l.solde)] })),
          { style: "total", cellules: ["", "", "Totaux", nb(t.debit), nb(t.credit), nbSigne(t.debit - t.credit)] },
        ],
      }),
      `grand-livre-${compte}-${periode.du}-${periode.au}.pdf`,
      "Grand livre enregistré",
    );

  return (
    <div className="cptVue">
      <Entete titre="Grand livre" sous={`${compte} — ${D.intitule(compte)}`}>
        <select className="cptSelectTete" value={compte} onChange={(e) => setCompte(e.target.value)} aria-label="Compte">
          {(balance.some((c) => c.compte === compte) ? balance : [{ compte, label: D.intitule(compte) }, ...balance]).map((c) => (
            <option key={c.compte} value={c.compte}>{c.compte} — {c.label}</option>
          ))}
        </select>
        <Bouton icone="faFilePdf" onClick={pdf} disabled={!lignes.length}>PDF</Bouton>
      </Entete>
      <div className="cptConteneur">
        <Carte>
          {lignes.length ? (
            <div className="cptTableau" role="table">
              <div className="cptLigneT cptEnteteT cptColsGL" role="row">
                <span>Date</span>
                <span>Pièce</span>
                <span>Libellé</span>
                <span className="cptMt">Débit</span>
                <span className="cptMt">Crédit</span>
                <span className="cptMt">Solde</span>
              </div>
              {lignes.map((l, i) => (
                <button
                  type="button"
                  key={i}
                  className="cptLigneT cptColsGL"
                  role="row"
                  onClick={() => {
                    const e = ecritures.find((x) => x.id === l.ecritureId);
                    if (e) ouvrirPiece(e, { onContrepasser: contrepasser });
                  }}
                >
                  <span>{dateCourte(l.date)}</span>
                  <span className="cptCode">{l.piece || "—"}</span>
                  <span className="cptEllipse">{l.libelle}</span>
                  <span className="cptMt">{l.debit ? nb(l.debit) : ""}</span>
                  <span className="cptMt">{l.credit ? nb(l.credit) : ""}</span>
                  <span className="cptMt cptSolde">{nbSigne(l.solde)}</span>
                </button>
              ))}
              <div className="cptLigneT cptColsGL cptTotalT" role="row">
                <span />
                <span />
                <span>Totaux de la période</span>
                <span className="cptMt">{nb(t.debit)}</span>
                <span className="cptMt">{nb(t.credit)}</span>
                <span className="cptMt">{nbSigne(t.debit - t.credit)}</span>
              </div>
            </div>
          ) : (
            <p className="cptRien">Ce compte n'a pas bougé sur la période.</p>
          )}
        </Carte>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

export const Balance = () => {
  const { ecritures, contexte, aller, entreprise, periode } = useCpt();
  const balance = useMemo(() => D.balance(ecritures, contexte), [ecritures, contexte]);
  const parClasse = useMemo(() => {
    const m = new Map();
    for (const c of balance) {
      if (!m.has(c.classe)) m.set(c.classe, []);
      m.get(c.classe).push(c);
    }
    return [...m.entries()];
  }, [balance]);
  const t = balance.reduce((s, c) => ({ debit: s.debit + c.debit, credit: s.credit + c.credit }), { debit: 0, credit: 0 });
  const somme = (liste) => liste.reduce((s, c) => ({ debit: s.debit + c.debit, credit: s.credit + c.credit }), { debit: 0, credit: 0 });

  const csv = () => {
    const lignes = [["Compte", "Intitulé", "Débit", "Crédit", "Solde débiteur", "Solde créditeur"]];
    for (const c of balance) lignes.push([c.compte, c.label, Math.round(c.debit), Math.round(c.credit), c.solde > 0 ? Math.round(c.solde) : 0, c.solde < 0 ? Math.round(-c.solde) : 0]);
    return rangerDansLeCloud(new Blob([csvDe(lignes)], { type: "text/csv;charset=utf-8" }), `balance-${periode.du}-${periode.au}.csv`, "Balance exportée");
  };
  const pdf = () =>
    rangerDansLeCloud(
      rapportPdf({
        titre: "Balance générale",
        sousTitre: `du ${dateFr(periode.du)} au ${dateFr(periode.au)}`,
        entreprise,
        colonnes: [
          { label: "Compte", largeur: 0.1 },
          { label: "Intitulé", largeur: 0.34 },
          { label: "Débit", largeur: 0.14, align: "right" },
          { label: "Crédit", largeur: 0.14, align: "right" },
          { label: "Solde D", largeur: 0.14, align: "right" },
          { label: "Solde C", largeur: 0.14, align: "right" },
        ],
        lignes: [
          ...parClasse.flatMap(([n, liste]) => {
            const s = somme(liste);
            return [
              { style: "titre", cellules: [`Classe ${n} — ${D.CLASSES[n]?.label || ""}`] },
              ...liste.map((c) => ({ cellules: [c.compte, c.label, nb(c.debit), nb(c.credit), c.solde > 0 ? nb(c.solde) : "", c.solde < 0 ? nb(-c.solde) : ""] })),
              { style: "sous", cellules: ["", `Total classe ${n}`, nb(s.debit), nb(s.credit), s.debit > s.credit ? nb(s.debit - s.credit) : "", s.credit > s.debit ? nb(s.credit - s.debit) : ""] },
            ];
          }),
          { style: "total", cellules: ["", "Totaux", nb(t.debit), nb(t.credit), "", ""] },
        ],
      }),
      `balance-${periode.du}-${periode.au}.pdf`,
      "Balance enregistrée",
    );

  return (
    <div className="cptVue">
      <Entete titre="Balance générale" sous={Math.abs(t.debit - t.credit) < 1 ? "Débits et crédits s'équilibrent" : "Balance déséquilibrée"}>
        <Bouton icone="faFileCsv" onClick={csv} disabled={!balance.length}>Excel (CSV)</Bouton>
        <Bouton icone="faFilePdf" onClick={pdf} disabled={!balance.length}>PDF</Bouton>
      </Entete>
      <div className="cptConteneur">
        <Carte aide="Cliquez un compte pour ouvrir son grand livre.">
          {balance.length ? (
            <div className="cptTableau" role="table">
              <div className="cptLigneT cptEnteteT cptColsBalance" role="row">
                <span>Compte</span>
                <span>Intitulé</span>
                <span className="cptMt">Débit</span>
                <span className="cptMt">Crédit</span>
                <span className="cptMt">Solde</span>
              </div>
              {parClasse.map(([n, liste]) => {
                const s = somme(liste);
                return (
                  <React.Fragment key={n}>
                    <div className="cptLigneT cptClasseT" role="row">
                      <span>Classe {n} — {D.CLASSES[n]?.label}</span>
                    </div>
                    {liste.map((c) => (
                      <button type="button" key={c.compte} className="cptLigneT cptColsBalance" role="row" onClick={() => aller("grandlivre", { compte: c.compte })}>
                        <span className="cptCode">{c.compte}</span>
                        <span className="cptEllipse">{c.label}</span>
                        <span className="cptMt">{nb(c.debit)}</span>
                        <span className="cptMt">{nb(c.credit)}</span>
                        <span className="cptMt cptSolde">{nbSigne(c.solde)}</span>
                      </button>
                    ))}
                    <div className="cptLigneT cptColsBalance cptSousT" role="row">
                      <span />
                      <span>Total classe {n}</span>
                      <span className="cptMt">{nb(s.debit)}</span>
                      <span className="cptMt">{nb(s.credit)}</span>
                      <span className="cptMt">{nbSigne(s.debit - s.credit)}</span>
                    </div>
                  </React.Fragment>
                );
              })}
              <div className="cptLigneT cptColsBalance cptTotalT" role="row">
                <span />
                <span>Totaux</span>
                <span className="cptMt">{nb(t.debit)}</span>
                <span className="cptMt">{nb(t.credit)}</span>
                <span className="cptMt">{nbSigne(t.debit - t.credit)}</span>
              </div>
            </div>
          ) : (
            <p className="cptRien">Rien à équilibrer pour l'instant.</p>
          )}
        </Carte>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Plan comptable
// ---------------------------------------------------------------------------

export const Plan = () => {
  const { ecritures, aller } = useCpt();
  const [q, setQ] = useState("");
  const utilises = useMemo(() => new Set(D.balance(ecritures).map((c) => c.compte)), [ecritures]);
  const liste = D.PLAN.filter(
    (c) => !q.trim() || c.code.includes(q.trim()) || c.label.toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <div className="cptVue">
      <Entete titre="Plan comptable" sous="SYSCOHADA révisé — extrait utile à une PME">
        <input className="cptRecherche" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un compte ou un mot…" aria-label="Rechercher un compte" />
      </Entete>
      <div className="cptConteneur">
        <p className="cptAide">
          Le référentiel des 17 pays de l'OHADA. Un compte absent de cet extrait se saisit quand même par son numéro : il se range seul dans sa classe et dans la bonne rubrique des états.
        </p>
        {Object.entries(D.CLASSES)
          .filter(([n]) => liste.some((c) => D.classeDe(c.code) === Number(n)))
          .map(([n, cl]) => (
            <Carte key={n} titre={`Classe ${n} — ${cl.label}`}>
              <div className="cptTableau" role="table">
                {liste
                  .filter((c) => D.classeDe(c.code) === Number(n))
                  .map((c) => (
                    <button type="button" key={c.code} className="cptLigneT cptColsPlan" role="row" onClick={() => aller("grandlivre", { compte: c.code })}>
                      <span className="cptCode">{c.code}</span>
                      <span>{c.label}</span>
                      <span>{utilises.has(c.code) ? <em className="cptEtiquette" data-ton="vert">mouvementé</em> : null}</span>
                    </button>
                  ))}
              </div>
            </Carte>
          ))}
      </div>
    </div>
  );
};

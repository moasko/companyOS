// Comptabilité — états financiers SYSCOHADA et TVA.

import React, { useMemo, useState } from "react";
import { Icon } from "../../../utils/general";
import { modal } from "../../modalRequest";
import * as D from "./domaine";
import { bilanSyscohada, compteDeResultatSyscohada, fluxTresorerie, lignesDeRubrique } from "./etats";
import { moisPrecedent, moisSuivant, nomMois } from "./cloture";
import { rapportPdf } from "./pdf";
import { Bouton, Carte, Entete, aujourdhui, csvDe, dateCourte, dateFr, nb, nbSigne, ouvrirPiece, rangerDansLeCloud, useCpt } from "./commun";

const ONGLETS = [
  { id: "resultat", label: "Compte de résultat" },
  { id: "bilan", label: "Bilan" },
  { id: "flux", label: "Flux de trésorerie" },
];

/// La même période, un an plus tôt — la colonne N-1 du modèle officiel.
const anMoins1 = ({ du, au, axe }) => ({
  du: du ? `${Number(du.slice(0, 4)) - 1}${du.slice(4)}` : du,
  au: au ? `${Number(au.slice(0, 4)) - 1}${au.slice(4)}` : au,
  axe,
});

const montantEtat = (n, solde) => (n ? nbSigne(n) : solde ? "0" : "—");

export const Etats = ({ ongletInitial }) => {
  const { ecritures, contexte, periode, entreprise, intention, contrepasser } = useCpt();
  const [onglet, setOnglet] = useState(intention?.onglet || ongletInitial || "resultat");
  const n1 = anMoins1(contexte);

  const cr = useMemo(() => compteDeResultatSyscohada(ecritures, contexte), [ecritures, contexte]);
  const crN1 = useMemo(() => compteDeResultatSyscohada(ecritures, n1), [ecritures, n1.du, n1.au, n1.axe]); // eslint-disable-line react-hooks/exhaustive-deps
  const bi = useMemo(() => bilanSyscohada(ecritures, contexte), [ecritures, contexte]);
  const biN1 = useMemo(() => bilanSyscohada(ecritures, n1), [ecritures, n1.du, n1.au, n1.axe]); // eslint-disable-line react-hooks/exhaustive-deps
  const fl = useMemo(() => fluxTresorerie(ecritures, contexte), [ecritures, contexte]);
  const flN1 = useMemo(() => fluxTresorerie(ecritures, n1), [ecritures, n1.du, n1.au, n1.axe]); // eslint-disable-line react-hooks/exhaustive-deps

  const sections =
    onglet === "resultat"
      ? [{ titre: null, lignes: cr.lignes, n1: crN1.lignes }]
      : onglet === "bilan"
        ? [
            { titre: "Actif", lignes: bi.actif, n1: biN1.actif },
            { titre: "Passif", lignes: bi.passif, n1: biN1.passif },
          ]
        : [{ titre: null, lignes: fl.lignes, n1: flN1.lignes }];

  // Une rubrique sans montant ni en N ni en N-1 n'apporte rien à l'écran ;
  // le PDF et l'export, eux, gardent le modèle complet.
  const visible = (l, autre) => l.solde || l.montant || autre?.montant;

  const descendre = (ligne) => {
    if (!ligne.comptes?.length) return;
    const detail = lignesDeRubrique(ecritures, ligne.comptes, onglet === "bilan" ? { au: contexte.au, axe: contexte.axe } : contexte);
    modal.open({
      title: `${ligne.ref} — ${ligne.libelle}`,
      render: ({ close }) => (
        <div className="cptDescente">
          <p className="cptAide">
            Comptes : {ligne.comptes.map((c) => `${c} ${D.intitule(c)}`).join(", ")} · {detail.length} ligne(s). Cliquez une ligne pour ouvrir sa pièce.
          </p>
          <div className="cptTableau cptDescenteListe">
            {detail.slice(-200).reverse().map((l, i) => (
              <button
                type="button"
                key={i}
                className="cptLigneT cptColsDescente"
                onClick={() => {
                  const e = ecritures.find((x) => x.id === l.ecritureId);
                  close();
                  if (e) ouvrirPiece(e, { onContrepasser: contrepasser });
                }}
              >
                <span>{dateCourte(l.date)}</span>
                <span className="cptCode">{l.compte}</span>
                <span className="cptEllipse">{l.libelle}</span>
                <span className="cptMt">{l.debit ? nb(l.debit) : ""}</span>
                <span className="cptMt">{l.credit ? nb(l.credit) : ""}</span>
              </button>
            ))}
          </div>
        </div>
      ),
    });
  };

  const titreOnglet = ONGLETS.find((o) => o.id === onglet).label;
  const sous = `${onglet === "bilan" ? "au" : "du"} ${onglet === "bilan" ? dateFr(periode.au) : `${dateFr(periode.du)} au ${dateFr(periode.au)}`} · en francs CFA`;

  const lignesExport = () =>
    sections.flatMap((s) => [
      ...(s.titre ? [{ style: "titre", cellules: [s.titre] }] : []),
      ...s.lignes.map((l, i) => ({
        style: l.total ? "total" : l.solde ? "sous" : "",
        cellules: [l.ref, l.libelle, montantEtat(l.montant, l.solde), montantEtat(s.n1[i]?.montant, l.solde)],
      })),
    ]);

  const pdf = () =>
    rangerDansLeCloud(
      rapportPdf({
        titre: titreOnglet,
        sousTitre: sous,
        entreprise,
        colonnes: [
          { label: "Réf.", largeur: 0.08 },
          { label: "Libellé", largeur: 0.56 },
          { label: `Exercice ${periode.au.slice(0, 4)}`, largeur: 0.18, align: "right" },
          { label: `Exercice ${Number(periode.au.slice(0, 4)) - 1}`, largeur: 0.18, align: "right" },
        ],
        lignes: lignesExport(),
        notes: ["Présentation du système normal SYSCOHADA révisé (AUDCIF). Colonne N-1 : même période de l'exercice précédent."],
      }),
      `${onglet}-${periode.du}-${periode.au}.pdf`,
      `${titreOnglet} enregistré`,
    );

  const excel = () => {
    const lignes = [["Réf.", "Libellé", `Exercice ${periode.au.slice(0, 4)}`, `Exercice ${Number(periode.au.slice(0, 4)) - 1}`]];
    for (const s of sections) {
      if (s.titre) lignes.push([s.titre, "", "", ""]);
      s.lignes.forEach((l, i) => lignes.push([l.ref, l.libelle, l.montant, s.n1[i]?.montant || 0]));
    }
    return rangerDansLeCloud(new Blob([csvDe(lignes)], { type: "text/csv;charset=utf-8" }), `${onglet}-${periode.du}-${periode.au}.csv`, `${titreOnglet} exporté`);
  };

  /// Les montants de la liasse, rubrique par rubrique, pour la saisie sur
  /// la plateforme de la DGI (e-impots) ou par le cabinet.
  const liasse = () => {
    const lignes = [["Tableau", "Réf.", "Libellé", "Montant N", "Montant N-1"]];
    const ajouter = (tableau, liste, autre) => liste.forEach((l, i) => lignes.push([tableau, l.ref, l.libelle, l.montant, autre[i]?.montant || 0]));
    ajouter("Bilan actif", bi.actif, biN1.actif);
    ajouter("Bilan passif", bi.passif, biN1.passif);
    ajouter("Compte de résultat", cr.lignes, crN1.lignes);
    ajouter("Flux de trésorerie", fl.lignes, flN1.lignes);
    return rangerDansLeCloud(
      new Blob([csvDe(lignes)], { type: "text/csv;charset=utf-8" }),
      `liasse-syscohada-${periode.au.slice(0, 4)}.csv`,
      "Liasse exportée",
    );
  };

  return (
    <div className="cptVue">
      <Entete titre="États financiers" sous={`Système normal SYSCOHADA · ${titreOnglet.toLowerCase()}`}>
        <div className="cptOnglets" role="tablist">
          {ONGLETS.map((o) => (
            <button type="button" key={o.id} role="tab" aria-selected={onglet === o.id} onClick={() => setOnglet(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
        <Bouton icone="faFilePdf" onClick={pdf}>PDF</Bouton>
        <Bouton icone="faFileExcel" onClick={excel}>Excel</Bouton>
        <Bouton icone="faFileExport" onClick={liasse}>Liasse DGI</Bouton>
      </Entete>
      <div className="cptConteneur">
        {onglet === "bilan" && !bi.equilibre ? (
          <div className="cptInfo" data-ton="erreur">
            <Icon fafa="faTriangleExclamation" width={14} />
            <span>L'actif ({nb(bi.totalActif)}) et le passif ({nb(bi.totalPassif)}) ne s'équilibrent pas : une écriture est fausse — la balance dira laquelle.</span>
          </div>
        ) : null}
        {sections.map((s) => (
          <Carte key={s.titre || "unique"} titre={s.titre ? `${s.titre}` : `${titreOnglet} · ${sous}`}>
            <div className="cptTableau cptEtat" role="table">
              <div className="cptLigneT cptEnteteT cptColsEtat" role="row">
                <span>Réf.</span>
                <span>Libellé</span>
                <span className="cptMt">Exercice {periode.au.slice(0, 4)}</span>
                <span className="cptMt">Exercice {Number(periode.au.slice(0, 4)) - 1}</span>
              </div>
              {s.lignes.map((l, i) =>
                visible(l, s.n1[i]) ? (
                  <div key={l.ref} className="cptLigneT cptColsEtat" role="row" data-type={l.total ? "total" : l.solde ? "sous" : ""}>
                    <span className="cptCode">{l.ref}</span>
                    <span>{l.libelle}</span>
                    <span className="cptMt">
                      {l.comptes?.length ? (
                        <button type="button" className="cptMontantLien" onClick={() => descendre(l)} title="Voir les écritures">
                          {montantEtat(l.montant, l.solde)}
                        </button>
                      ) : (
                        montantEtat(l.montant, l.solde)
                      )}
                    </span>
                    <span className="cptMt cptN1">{montantEtat(s.n1[i]?.montant, l.solde)}</span>
                  </div>
                ) : null,
              )}
            </div>
          </Carte>
        ))}
        <p className="cptAide">
          Cliquez un montant pour voir les écritures qui le composent, jusqu'à la pièce et son justificatif. La période se choisit dans la colonne de gauche.
        </p>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// TVA
// ---------------------------------------------------------------------------

export const Tva = () => {
  const { ecritures, intention, reglages, majReglages, creer, entreprise, occupe, clotureAu } = useCpt();
  const [mois, setMois] = useState(intention?.mois || moisPrecedent(aujourdhui().slice(0, 7)));
  const p = D.mois(mois);
  const t = useMemo(() => D.tva(ecritures, p), [ecritures, p.du, p.au]); // eslint-disable-line react-hooks/exhaustive-deps
  const report = useMemo(() => {
    // Le crédit de TVA du mois précédent s'impute sur ce mois.
    const prec = D.mois(moisPrecedent(mois));
    const tp = D.tva(ecritures, prec);
    return tp.credit;
  }, [ecritures, mois]);
  const aPayer = Math.max(0, t.collectee - t.deductible - report);
  const credit = Math.max(0, t.deductible + report - t.collectee);
  const declarees = reglages.tvaDeclarees || {};
  const decl = declarees[mois];
  const liquidee = ecritures.some((e) => e.data.origine === `tva:${mois}`);
  const options = Array.from({ length: 13 }, (_, i) => {
    let m = aujourdhui().slice(0, 7);
    for (let k = 0; k < i; k += 1) m = moisPrecedent(m);
    return m;
  });

  const liquider = async () => {
    const b = D.balance(ecritures.filter((e) => !String(e.data.origine || "").startsWith("tva:")), p);
    const solde = (c) => Math.round(b.find((x) => x.compte === c)?.solde || 0);
    const lignes = [];
    if (t.collectee) lignes.push({ compte: "4431", debit: Math.round(t.collectee), credit: 0 });
    for (const c of ["4452", "4451"]) if (solde(c)) lignes.push({ compte: c, debit: 0, credit: solde(c) });
    if (report) lignes.push({ compte: "4449", debit: 0, credit: Math.round(report) });
    if (aPayer) lignes.push({ compte: "4441", debit: 0, credit: Math.round(aPayer) });
    if (credit) lignes.push({ compte: "4449", debit: Math.round(credit), credit: 0 });
    if (lignes.length < 2) {
      modal.alert({ title: "Rien à liquider", message: "Aucune TVA collectée ni déductible ce mois-ci." });
      return;
    }
    const ok = await modal.confirm({
      title: `Passer la liquidation de ${nomMois(mois)} ?`,
      message: aPayer ? `${nb(aPayer)} F passeront en « État, TVA due » (4441).` : `${nb(credit)} F de crédit seront reportés (4449).`,
      detail: "Écriture OD datée du dernier jour du mois. Le paiement à la DGI se saisira ensuite depuis la banque.",
      confirmLabel: "Passer l'écriture",
    });
    if (!ok) return;
    await creer({ journal: "OD", date: p.au, libelle: `Liquidation de la TVA — ${nomMois(mois)}`, origine: `tva:${mois}`, piece: `CA02-${mois}`, lignes });
  };

  const declarer = () =>
    majReglages({ tvaDeclarees: { ...declarees, [mois]: { le: aujourdhui(), montant: aPayer, credit } } });

  const pdf = () =>
    rangerDansLeCloud(
      rapportPdf({
        titre: "Déclaration de TVA",
        sousTitre: `${nomMois(mois)} · à déposer avant le 15 ${nomMois(moisSuivant(mois))}`,
        entreprise,
        colonnes: [
          { label: "Compte", largeur: 0.14 },
          { label: "Libellé", largeur: 0.6 },
          { label: "Montant", largeur: 0.26, align: "right" },
        ],
        lignes: [
          { cellules: ["4431", "TVA collectée sur les ventes", nb(t.collectee)] },
          { cellules: ["4452 / 4451", "TVA déductible sur achats et immobilisations", `- ${nb(t.deductible)}`] },
          { cellules: ["4449", "Crédit de TVA du mois précédent", report ? `- ${nb(report)}` : "0"] },
          { style: "total", cellules: ["", aPayer ? "TVA à reverser" : "Crédit de TVA à reporter", nb(aPayer || credit)] },
        ],
        notes: [`Régime : ${entreprise.regimeFiscal || "non renseigné"} · centre des impôts : ${entreprise.centreImpots || "non renseigné"}.`],
      }),
      `tva-${mois}.pdf`,
      "Déclaration enregistrée",
    );

  return (
    <div className="cptVue">
      <Entete titre="TVA" sous={`Déclaration mensuelle · ${nomMois(mois)}`}>
        <select className="cptSelectTete" value={mois} onChange={(e) => setMois(e.target.value)} aria-label="Mois">
          {options.map((m) => (
            <option key={m} value={m}>{nomMois(m)}{declarees[m] ? " · déclarée" : ""}</option>
          ))}
        </select>
        <Bouton icone="faFilePdf" onClick={pdf}>PDF</Bouton>
      </Entete>
      <div className="cptConteneur">
        <div className="cptGrille">
          <Carte className="cptLarge" titre="Calcul" aide={`En Côte d'Ivoire, la déclaration se dépose avant le 15 ${nomMois(moisSuivant(mois))}.`}>
            <div className="cptTableau" role="table">
              <div className="cptLigneT cptColsTva" role="row"><span className="cptCode">4431</span><span>TVA facturée à vos clients</span><span className="cptMt">{nb(t.collectee)}</span></div>
              <div className="cptLigneT cptColsTva" role="row"><span className="cptCode">4452</span><span>TVA payée à vos fournisseurs, récupérable</span><span className="cptMt">− {nb(t.deductible)}</span></div>
              <div className="cptLigneT cptColsTva" role="row"><span className="cptCode">4449</span><span>Crédit reporté du mois précédent</span><span className="cptMt">{report ? `− ${nb(report)}` : "0"}</span></div>
              <div className="cptLigneT cptColsTva cptTotalT" role="row">
                <span />
                <span>{aPayer ? "À reverser à l'État" : "Crédit de TVA reportable"}</span>
                <span className="cptMt">{nb(aPayer || credit)}</span>
              </div>
            </div>
            {credit ? (
              <p className="cptAide">Vous avez payé plus de TVA que vous n'en avez facturé : ce crédit se reporte sur le mois suivant, il n'est pas remboursé automatiquement.</p>
            ) : null}
          </Carte>
          <div className="cptColonne">
            <Carte titre="Étapes">
              <ol className="cptEtapes">
                <li data-ok={liquidee ? "true" : "false"}>
                  <b>Passer l'écriture de liquidation</b>
                  <small>Solde 4431 et 4452 vers 4441 (à payer) ou 4449 (crédit).</small>
                  {liquidee ? (
                    <em className="cptEtiquette" data-ton="vert">passée</em>
                  ) : (
                    <Bouton disabled={occupe || D.estClos(p.au, clotureAu)} onClick={liquider}>Passer l'écriture</Bouton>
                  )}
                </li>
                <li data-ok={decl ? "true" : "false"}>
                  <b>Déposer la déclaration</b>
                  <small>Sur e-impots.gouv.ci, puis la marquer ici : l'assistant de clôture en tient compte.</small>
                  {decl ? (
                    <em className="cptEtiquette" data-ton="vert">déclarée le {dateFr(decl.le)}</em>
                  ) : (
                    <Bouton variante="principal" disabled={occupe} onClick={declarer}>Marquer comme déclarée</Bouton>
                  )}
                </li>
                <li>
                  <b>Payer la DGI</b>
                  <small>Depuis la banque : débit 4441, crédit 521 — ou importez le relevé, le prélèvement sera proposé.</small>
                </li>
              </ol>
            </Carte>
          </div>
        </div>
      </div>
    </div>
  );
};

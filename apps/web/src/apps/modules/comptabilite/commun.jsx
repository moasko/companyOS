// Comptabilité — briques partagées par les écrans.

import React, { createContext, useContext } from "react";
import { Icon } from "../../../utils/general";
import { modal } from "../../modalRequest";
import { saveAs } from "../../cloud";
import { ouvrirFichier } from "../../openRequest";
import * as D from "./domaine";
import { journalDe, libelleJournal } from "./journaux";

/// Tout ce que les écrans partagent : données, contexte d'observation et
/// actions. Un seul fournisseur évite de faire descendre trente props.
export const Cpt = createContext(null);
export const useCpt = () => useContext(Cpt);

export const aujourdhui = () => new Date().toISOString().slice(0, 10);
export const dateCourte = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
export const dateFr = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

/// Un montant sans devise, en chasse fixe : « 1 240 916 ».
export const nb = (n) => (n || n === 0 ? Math.round(Number(n)).toLocaleString("fr-FR") : "");
/// Un montant signé lisible : « − 2 557 445 ».
export const nbSigne = (n) => (Number(n) < 0 ? `− ${nb(-n)}` : nb(n));

export const Bouton = ({ variante = "secondaire", icone, children, ...reste }) => (
  <button type="button" className="cptBtn" data-variante={variante} {...reste}>
    {icone ? <Icon fafa={icone} width={12} /> : null}
    {children}
  </button>
);

export const Kpi = ({ label, valeur, aide, ton, onClick }) => (
  <button type="button" className="cptKpi" data-ton={ton || ""} onClick={onClick} disabled={!onClick}>
    <span className="cptKpiLabel">{label}</span>
    <b className="cptKpiValeur">{valeur}</b>
    {aide ? <small>{aide}</small> : null}
  </button>
);

export const Entete = ({ titre, sous, children, retour }) => {
  const { aller } = useCpt();
  return (
    <header className="cptTete">
      {retour !== false ? (
        <button type="button" className="cptRetour" onClick={() => aller("pilotage")}>
          <Icon fafa="faChevronLeft" width={11} />
          Pilotage
        </button>
      ) : null}
      <div className="cptTeteTitre">
        <h1>{titre}</h1>
        {sous ? <span>{sous}</span> : null}
      </div>
      <div className="cptTeteActions">{children}</div>
    </header>
  );
};

export const Carte = ({ titre, aide, actions, children, className = "" }) => (
  <section className={`cptCarte ${className}`}>
    {titre || actions ? (
      <div className="cptCarteTete">
        <div>
          {titre ? <h2>{titre}</h2> : null}
          {aide ? <p>{aide}</p> : null}
        </div>
        {actions ? <div className="cptCarteActions">{actions}</div> : null}
      </div>
    ) : null}
    {children}
  </section>
);

export const Puce = ({ ok, bloquant, children }) => (
  <span className="cptPuce" data-etat={ok ? "ok" : bloquant ? "bloque" : "todo"} aria-hidden="true">
    {children || (ok ? "✓" : bloquant ? "×" : "!")}
  </span>
);

/// Les lignes d'une écriture, toujours affichées de la même façon : c'est
/// ce qui permet d'apprendre la partie double sans qu'on l'impose.
export const LignesEcriture = ({ lignes }) => (
  <table className="cptLignes">
    <tbody>
      {lignes.map((l, i) => (
        <tr key={i}>
          <td className="cptCode">{l.compte}</td>
          <td className="cptLib">
            {D.intitule(l.compte)}
            {l.tiers ? <small> · {l.tiers}</small> : null}
            {l.auto ? <em className="cptAuto">calculée</em> : null}
          </td>
          <td className="cptMt">{l.debit ? nb(l.debit) : ""}</td>
          <td className="cptMt">{l.credit ? nb(l.credit) : ""}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

export const Origine = ({ e }) => {
  const d = e.data || e;
  const source =
    d.source ||
    (String(d.origine || "").startsWith("facture") || String(d.origine || "").startsWith("reglement")
      ? "Facturation"
      : String(d.origine || "").startsWith("caisse")
        ? "Caisse"
        : String(d.origine || "").startsWith("paie")
          ? "Paie"
          : String(d.origine || "").startsWith("achat")
            ? "Achats"
            : String(d.origine || "").startsWith("frais")
              ? "Notes de frais"
              : d.contrepasse
                ? "Extourne"
                : "Saisie");
  return (
    <span className="cptOrigine" data-source={source}>
      {source}
    </span>
  );
};

export const ouvrirJustificatif = (j) => {
  if (!j?.id) return;
  const node = { type: "FILE", ...j };
  if (!ouvrirFichier(node)) {
    modal.alert({
      title: "Aucune application pour ce fichier",
      message: `Ouvrez « ${j.name} » depuis le gestionnaire de fichiers.`,
    });
  }
};

/// Le détail d'une pièce, depuis n'importe quel écran : c'est le bout de
/// la descente « montant → écritures → pièce → justificatif ».
export const ouvrirPiece = (ecriture, { onContrepasser, onJoindre } = {}) => {
  const d = ecriture.data || ecriture;
  const t = D.totauxEcriture(d);
  return modal.open({
    title: d.numero || d.piece || "Pièce",
    render: ({ close }) => (
      <div className="cptPiece">
        <dl>
          <div><dt>Journal</dt><dd>{journalDe(d)} — {libelleJournal(journalDe(d))}</dd></div>
          <div><dt>Date</dt><dd>{dateFr(d.date)}</dd></div>
          {d.reference || d.piece ? <div><dt>Référence</dt><dd>{d.reference || d.piece}</dd></div> : null}
          {d.tiers ? <div><dt>Tiers</dt><dd>{d.tiers}</dd></div> : null}
          {d.echeance ? <div><dt>Échéance</dt><dd>{dateFr(d.echeance)}</dd></div> : null}
          <div><dt>Origine</dt><dd><Origine e={d} /></dd></div>
        </dl>
        <p className="cptPieceLib">{d.libelle}</p>
        <LignesEcriture lignes={d.lignes || []} />
        <div className="cptPieceTotal">
          <span>Total</span>
          <b>{nb(t.debit)}</b>
          <b>{nb(t.credit)}</b>
        </div>
        <div className="cptPieceActions">
          {d.justificatif?.id ? (
            <Bouton icone="faPaperclip" onClick={() => ouvrirJustificatif(d.justificatif)}>
              {d.justificatif.name}
            </Bouton>
          ) : onJoindre ? (
            <Bouton icone="faPaperclip" onClick={() => { close(); onJoindre(ecriture); }}>
              Joindre un justificatif
            </Bouton>
          ) : null}
          {onContrepasser ? (
            <Bouton variante="danger" icone="faRotateLeft" onClick={() => { close(); onContrepasser(ecriture); }}>
              Contre-passer
            </Bouton>
          ) : null}
          <Bouton variante="principal" onClick={() => close()}>Fermer</Bouton>
        </div>
      </div>
    ),
  });
};

/// CSV prêt pour Excel en français : BOM UTF-8 et point-virgule.
export const csvDe = (lignes) =>
  "﻿" +
  lignes.map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");

/// Range un fichier dans le dossier « Comptabilité » du Cloud et le dit.
export const rangerDansLeCloud = async (blob, nom, titre = "Fichier enregistré") => {
  const node = await saveAs(blob, nom, { folder: "Comptabilité" });
  if (node) {
    modal.alert({ title: titre, message: `« ${node.name} » est dans votre Cloud.`, tone: "success" });
  }
  return node;
};

// Paie — briques partagées par les écrans.

import React, { createContext, useContext } from "react";
import { Icon } from "../../../utils/general";
import { modal } from "../../modalRequest";
import { saveAs } from "../../cloud";

export const Ctx = createContext(null);
export const useP = () => useContext(Ctx);

export const aujourdhui = () => new Date().toISOString().slice(0, 10);

export const Bouton = ({ variante = "secondaire", icone, children, ...reste }) => (
  <button type="button" className="paiBtn" data-variante={variante} {...reste}>
    {icone ? <Icon fafa={icone} width={12} /> : null}
    {children}
  </button>
);

export const Entete = ({ titre, sous, retour = true, children }) => {
  const { aller, t } = useP();
  return (
    <header className="paiTete">
      {retour ? (
        <button type="button" className="paiRetour" onClick={() => aller("cycle")}>
          <Icon fafa="faChevronLeft" width={11} />
          {t("retourCycle")}
        </button>
      ) : null}
      <div className="paiTeteTitre">
        <h1>{titre}</h1>
        {sous ? <span>{sous}</span> : null}
      </div>
      <div className="paiTeteActions">{children}</div>
    </header>
  );
};

export const Carte = ({ titre, aide, actions, children, className = "", ton }) => (
  <section className={`paiCarte ${className}`} data-ton={ton || ""}>
    {titre || actions ? (
      <div className="paiCarteTete">
        <div>
          {titre ? <h2>{titre}</h2> : null}
          {aide ? <p>{aide}</p> : null}
        </div>
        {actions ? <div className="paiCarteActions">{actions}</div> : null}
      </div>
    ) : null}
    {children}
  </section>
);

export const Kpi = ({ label, valeur, aide }) => (
  <div className="paiKpi">
    <span>{label}</span>
    <b>{valeur}</b>
    {aide ? <small>{aide}</small> : null}
  </div>
);

export const Puce = ({ niveau, children }) => (
  <span className="paiPuce" data-niveau={niveau} aria-hidden="true">
    {children || (niveau === "bloquant" ? "×" : niveau === "attention" ? "!" : niveau === "ok" ? "✓" : "i")}
  </span>
);

export const Statut = ({ statut, t }) => (
  <span className="paiStatut" data-statut={statut}>
    {t(`st_${statut}`)}
  </span>
);

export const initiales = (s) =>
  [s?.prenom, s?.nom]
    .filter(Boolean)
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

export const nomDe = (s) => [s?.prenom, s?.nom].filter(Boolean).join(" ") || s?.matricule || "—";

/// CSV prêt pour Excel en français : BOM UTF-8 et point-virgule.
export const csvDe = (lignes) =>
  "﻿" + lignes.map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");

/// Range un fichier dans le dossier « Paie » du Cloud, en laissant choisir
/// l'emplacement, et le dit.
export const ranger = async (blob, nom, t) => {
  const node = await saveAs(blob, nom, { folder: "Paie" });
  if (node) modal.alert({ title: t("exporte"), message: t("fichierRange", { nom: node.name }), tone: "success" });
  return node;
};

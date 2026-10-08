// Stock — briques partagées par les écrans.

import React, { createContext, useContext } from "react";
import { Icon } from "../../../utils/general";
import { modal } from "../../modalRequest";
import { saveAs } from "../../cloud";

export const Ctx = createContext(null);
export const useS = () => useContext(Ctx);

export const Bouton = ({ variante = "secondaire", icone, children, ...reste }) => (
  <button type="button" className="stoBtn" data-variante={variante} {...reste}>
    {icone ? <Icon fafa={icone} width={12} /> : null}
    {children}
  </button>
);

export const Entete = ({ titre, sous, retour, children }) => {
  const { aller, t } = useS();
  return (
    <header className="stoTete">
      {retour ? (
        <button type="button" className="stoRetour" onClick={() => aller(retour.section, retour.opts)}>
          <Icon fafa="faChevronLeft" width={11} />
          {retour.label || t("navTableau")}
        </button>
      ) : null}
      <div className="stoTeteTitre">
        <h1>{titre}</h1>
        {sous ? <span>{sous}</span> : null}
      </div>
      <div className="stoTeteActions">{children}</div>
    </header>
  );
};

export const Carte = ({ titre, aide, actions, children, className = "", ton }) => (
  <section className={`stoCarte ${className}`} data-ton={ton || ""}>
    {titre || actions ? (
      <div className="stoCarteTete">
        <div>
          {titre ? <h2>{titre}</h2> : null}
          {aide ? <p>{aide}</p> : null}
        </div>
        {actions ? <div className="stoCarteActions">{actions}</div> : null}
      </div>
    ) : null}
    {children}
  </section>
);

export const Kpi = ({ label, valeur, aide, ton, onClick }) => (
  <button type="button" className="stoKpi" data-ton={ton || ""} onClick={onClick} disabled={!onClick}>
    <span>{label}</span>
    <b>{valeur}</b>
    {aide ? <small>{aide}</small> : null}
  </button>
);

export const Puce = ({ ton, children }) => (
  <span className="stoPastilleTache" data-ton={ton || ""}>
    {children}
  </span>
);

export const Etiquette = ({ ton, children }) => (
  <span className="stoChip" data-ton={ton || ""}>
    {children}
  </span>
);

export const Vignette = ({ article, taille = 40 }) => {
  const d = article?.data || {};
  return d.vignette ? (
    <img className="stoVignette" src={d.vignette} alt="" style={{ width: taille, height: taille }} />
  ) : (
    <span className="stoVignette" aria-hidden="true" style={{ width: taille, height: taille }}>
      {(d.designation || "?")
        .split(/\s+/)
        .slice(0, 2)
        .map((x) => x[0])
        .join("")
        .toUpperCase()}
    </span>
  );
};

/// CSV prêt pour Excel en français : BOM UTF-8 et point-virgule.
export const csvDe = (lignes) =>
  "﻿" + lignes.map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");

/// Range un fichier dans le dossier « Stock » du Cloud et le dit.
export const ranger = async (blob, nom, t) => {
  const node = await saveAs(blob, nom, { folder: "Stock" });
  if (node) modal.alert({ title: t("exporte"), message: t("fichierRange", { nom: node.name }), tone: "success" });
  return node;
};

export const nombre = (v) => {
  const x = Number(String(v ?? "").replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isFinite(x) ? x : 0;
};

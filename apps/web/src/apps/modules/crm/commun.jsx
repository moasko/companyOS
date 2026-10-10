// Petites pièces partagées par les écrans du CRM.

import React from "react";
import { Icon } from "../../../utils/general";
import { localeEffective } from "../../../utils/langue";
import { montantAbrege } from "../../../utils/monnaie";

/// Montant abrégé pour les cartes et les indicateurs (18,4 M), dans la
/// devise d'affichage. Le montant exact reste dans les tableaux.
export const abrege = (n) => montantAbrege(n);

export const dateCourte = (iso) => {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(localeEffective(), { day: "numeric", month: "short" });
};

export const moisLong = (cle) => {
  const d = new Date(`${cle}-01T12:00:00`);
  return d.toLocaleDateString(localeEffective(), { month: "long", year: "numeric" });
};

/// Couleur stable dérivée d'un texte, pour les pastilles d'initiales.
const TEINTES = ["#1a56c4", "#137333", "#8a5300", "#7627bb", "#a23d00", "#00639b", "#b3261e", "#3c4652"];
export const teinte = (texte = "") => {
  let h = 0;
  for (const c of String(texte)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TEINTES[h % TEINTES.length];
};

export const Initiales = ({ nom, taille = 30, carre = false }) => {
  const mots = String(nom || "?").trim().split(/\s+/);
  const ini = ((mots[0]?.[0] || "?") + (mots.length > 1 ? mots[1][0] : "")).toUpperCase();
  return (
    <span
      className="crmIni"
      aria-hidden="true"
      style={{
        width: taille,
        height: taille,
        borderRadius: carre ? Math.round(taille / 3.5) : "50%",
        background: teinte(nom),
        fontSize: Math.round(taille * 0.38),
      }}
    >
      {ini}
    </span>
  );
};

/// Une étiquette de couleur : ok, info, warn, bad, idle, violet, orange.
export const Pastille = ({ ton = "idle", children, title }) => (
  <span className="crmPill" data-ton={ton} title={title}>
    {children}
  </span>
);

export const TON_ETAPE = {
  contact: "idle",
  qualifie: "info",
  devis: "info",
  negociation: "warn",
  gagnee: "ok",
  perdue: "bad",
};

export const TON_ACTIVITE = {
  appel: "info",
  reunion: "ok",
  email: "idle",
  note: "idle",
  tache: "warn",
};

export const ICONE_ACTIVITE = {
  appel: "faPhone",
  reunion: "faHandshake",
  email: "faEnvelope",
  note: "faNoteSticky",
  tache: "faListCheck",
};

export const Kpi = ({ libelle, valeur, detail, ton, onClick, children }) => {
  const Balise = onClick ? "button" : "div";
  return (
    <Balise type={onClick ? "button" : undefined} className="crmKpi" data-ton={ton} onClick={onClick}>
      <span className="crmKpiLbl">{libelle}</span>
      <span className="crmKpiVal">{valeur}</span>
      {children}
      {detail ? <span className="crmKpiDet">{detail}</span> : null}
    </Balise>
  );
};

export const Jauge = ({ pct = 0, pct2 = null }) => (
  <div className="crmJauge" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
    <span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    {pct2 !== null ? (
      <span className="crmJauge2" style={{ width: `${Math.min(100, Math.max(0, pct2 - pct))}%` }} />
    ) : null}
  </div>
);

export const BoutonIcone = ({ icone, libelle, onClick, href, ton }) =>
  href ? (
    <a className="crmIb" data-ton={ton} href={href} aria-label={libelle} title={libelle} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" onClick={onClick}>
      <Icon fafa={icone} width={13} />
    </a>
  ) : (
    <button type="button" className="crmIb" data-ton={ton} aria-label={libelle} title={libelle} onClick={onClick}>
      <Icon fafa={icone} width={13} />
    </button>
  );

export const Carte = ({ titre, action, children, className = "" }) => (
  <section className={`crmCarte ${className}`}>
    {titre || action ? (
      <header className="crmCarteTete">
        {titre ? <h2>{titre}</h2> : <span />}
        {action}
      </header>
    ) : null}
    {children}
  </section>
);

export const Vide = ({ icone = "faInbox", children }) => (
  <div className="crmVide">
    <Icon fafa={icone} width={18} />
    <span>{children}</span>
  </div>
);

// ---- Liens vers le monde extérieur ----------------------------------------

export const lienTel = (tel) => (tel ? `tel:${String(tel).replace(/[^\d+]/g, "")}` : null);

/// WhatsApp attend le numéro international sans « + ». Un numéro ivoirien
/// à 10 chiffres sans indicatif reçoit le 225.
export const lienWhatsapp = (tel) => {
  let n = String(tel || "").replace(/\D/g, "");
  if (!n) return null;
  if (n.startsWith("00")) n = n.slice(2);
  if (n.length === 10) n = `225${n}`;
  return `https://wa.me/${n}`;
};

export const lienItineraire = (adresse, ville) => {
  const q = [adresse, ville].filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
};

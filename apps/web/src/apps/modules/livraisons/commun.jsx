// Livraisons — pièces communes de l'interface.

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Icon } from "../../../utils/general";
import { montant } from "../../../utils/monnaie";
import { STATUTS, TYPES_VEHICULE } from "@companyos/shared/livraisons";

/// Tout ce que les écrans partagent : données chargées et actions.
export const Ctx = createContext(null);
export const useLiv = () => useContext(Ctx);

export const fcfa = (n) => montant(Number(n) || 0);

/// « jeudi 17 octobre » / « aujourd'hui » / « demain ».
export const jourLisible = (date, ref = new Date().toISOString().slice(0, 10)) => {
  if (!date) return "";
  const ecart = Math.round((Date.parse(date) - Date.parse(ref)) / 86400_000);
  if (ecart === 0) return "Aujourd'hui";
  if (ecart === 1) return "Demain";
  if (ecart === -1) return "Hier";
  const texte = new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return texte.charAt(0).toUpperCase() + texte.slice(1);
};

export const dateCourte = (date) =>
  date ? new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";

export const heure = (iso) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");

export const decalerJour = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/// Pastille de statut : couleur, icône et libellé, toujours les trois —
/// la couleur seule ne se lit pas par tout le monde.
export const Statut = ({ statut, petit }) => {
  const s = STATUTS[statut] || STATUTS.a_planifier;
  return (
    <span className="lvStatut" data-ton={s.ton} data-petit={petit || undefined}>
      <Icon fafa={s.icone} width={petit ? 9 : 10} />
      {s.label}
    </span>
  );
};

const TEINTES = ["#2563eb", "#0891b2", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#4f46e5", "#0d9488"];
const teinte = (texte = "") => TEINTES[[...texte].reduce((s, c) => s + c.charCodeAt(0), 0) % TEINTES.length];
export const initiales = (nom = "") =>
  nom
    .replace(/^(Mme|M\.|Dr|Me)\s+/, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0])
    .join("")
    .toUpperCase() || "?";

export const Avatar = ({ nom, taille = 30 }) => (
  <span className="lvAvatar" style={{ width: taille, height: taille, fontSize: taille * 0.38, background: teinte(nom) }} aria-hidden="true">
    {initiales(nom)}
  </span>
);

export const IconeVehicule = ({ type, taille = 13 }) => <Icon fafa={TYPES_VEHICULE[type]?.icone || "faTruck"} width={taille} />;

/// Carte indicateur du bandeau.
export const Kpi = ({ icone, ton, libelle, valeur, detail, onClick, actif }) => (
  <button type="button" className="lvKpi" data-ton={ton} data-actif={actif || undefined} onClick={onClick} disabled={!onClick}>
    <span className="lvKpiIcone">
      <Icon fafa={icone} width={14} />
    </span>
    <span className="lvKpiTexte">
      <small>{libelle}</small>
      <b>{valeur}</b>
      {detail ? <em>{detail}</em> : null}
    </span>
  </button>
);

/// Barre d'avancement.
export const Avancement = ({ pct, ton = "ok" }) => (
  <span className="lvAvance" data-ton={ton} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
    <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
  </span>
);

/// Panneau latéral (fiche, formulaire). Échap ferme ; sur téléphone il
/// prend tout l'écran.
export const Panneau = ({ titre, sousTitre, onFermer, children, pied, large }) => {
  const ref = useRef(null);
  useEffect(() => {
    const touche = (e) => {
      if (e.key === "Escape") onFermer?.();
    };
    window.addEventListener("keydown", touche);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", touche);
  }, [onFermer]);
  return (
    <div className="lvPanneauFond" onMouseDown={(e) => e.target === e.currentTarget && onFermer?.()}>
      <aside className="lvPanneau" data-large={large || undefined} role="dialog" aria-label={titre} tabIndex={-1} ref={ref}>
        <header className="lvPanneauTete">
          <div>
            <h2>{titre}</h2>
            {sousTitre ? <div className="lvSousTitre">{sousTitre}</div> : null}
          </div>
          <button type="button" className="lvIconeBtn" aria-label="Fermer" onClick={onFermer}>
            <Icon fafa="faXmark" width={14} />
          </button>
        </header>
        <div className="lvPanneauCorps cosScroll">{children}</div>
        {pied ? <footer className="lvPanneauPied">{pied}</footer> : null}
      </aside>
    </div>
  );
};

/// Zone de signature au doigt ou à la souris. Rend des traits (listes de
/// points) recadrés, au même format que l'app Signature.
export const ZoneSignature = ({ onChange }) => {
  const canvas = useRef(null);
  const traits = useRef([]);
  const enCours = useRef(null);
  const [vide, setVide] = useState(true);

  const point = (e) => {
    const r = canvas.current.getBoundingClientRect();
    return { x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) };
  };
  const dessiner = () => {
    const c = canvas.current;
    const ctx = c.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1e3a8a";
    for (const t of [...traits.current, enCours.current].filter(Boolean)) {
      ctx.beginPath();
      t.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
  };
  useEffect(() => {
    const c = canvas.current;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    dessiner();
  }, []);
  const publier = () => {
    const tous = traits.current.flat();
    if (tous.length < 8) return onChange(null);
    const minX = Math.min(...tous.map((p) => p.x));
    const minY = Math.min(...tous.map((p) => p.y));
    const maxX = Math.max(...tous.map((p) => p.x));
    const maxY = Math.max(...tous.map((p) => p.y));
    onChange({
      traits: traits.current.map((t) => t.filter((_, i) => i % 2 === 0 || i === t.length - 1).map((p) => ({ x: p.x - minX + 6, y: p.y - minY + 6 }))),
      largeur: maxX - minX + 12,
      hauteur: maxY - minY + 12,
    });
  };
  return (
    <div className="lvSignature">
      <canvas
        ref={canvas}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          enCours.current = [point(e)];
        }}
        onPointerMove={(e) => {
          if (!enCours.current) return;
          enCours.current.push(point(e));
          dessiner();
        }}
        onPointerUp={() => {
          if (enCours.current?.length > 1) traits.current.push(enCours.current);
          enCours.current = null;
          setVide(!traits.current.length);
          dessiner();
          publier();
        }}
        aria-label="Zone de signature"
      />
      {vide ? <span className="lvSignatureAide">Le client signe ici, au doigt</span> : null}
      {!vide ? (
        <button
          type="button"
          className="lvLien"
          onClick={() => {
            traits.current = [];
            setVide(true);
            dessiner();
            onChange(null);
          }}
        >
          Effacer
        </button>
      ) : null}
    </div>
  );
};

/// Une signature enregistrée, redessinée en SVG.
export const SignatureVue = ({ signature, hauteur = 56 }) =>
  signature?.traits?.length ? (
    <svg className="lvSignatureVue" viewBox={`0 0 ${signature.largeur} ${signature.hauteur}`} style={{ height: hauteur }} aria-label="Signature du client">
      {signature.traits.map((t, i) => (
        <polyline key={i} points={t.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#1e3a8a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  ) : null;

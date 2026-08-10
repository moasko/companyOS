import React from "react";
import { Icon } from "../../utils/general";
import "./ui.scss";

// Kit de composants des applications CompanyOS.
//
// La charte du produit était jusqu'ici de la documentation : chaque module
// recopiait les mêmes structures et les mêmes jetons de couleur, et rien
// n'empêchait de s'en écarter. Ici, elle est du code — utiliser ces
// composants suffit à être à la charte, et il n'y a plus de feuille de
// style à écrire pour une application ordinaire.
//
//   import { Coquille, Nav, Centre, Section, Champ, Bouton } from "../../ui";
//
// Les modules antérieurs gardent leurs styles propres : les deux systèmes
// coexistent, rien n'est à migrer en urgence.

/// Coquille d'une application : jusqu'à trois colonnes.
///
/// N'en mettez que ce qui se justifie. La colonne centrale suffit souvent ;
/// la nav se justifie à partir de quatre sections, le panneau seulement
/// s'il y a quelque chose à garder sous les yeux en permanence.
export const Coquille = ({ children, className = "" }) => (
  <div className={`uiCoquille ${className}`}>{children}</div>
);

/// Barre de navigation des sections.
export const Nav = ({ sections, actif, onChoisir }) => (
  <div className="uiNav cosScroll">
    {sections.map((s) => (
      <div
        key={s.id}
        className="uiNavItem"
        data-actif={actif === s.id ? "true" : "false"}
        onClick={() => onChoisir(s.id)}
      >
        {s.icone ? <Icon fafa={s.icone} width={13} /> : null}
        <span>{s.label}</span>
      </div>
    ))}
  </div>
);

export const Centre = ({ children, innerRef }) => (
  <div className="uiCentre cosScroll" ref={innerRef}>
    {children}
  </div>
);

export const Panneau = ({ children }) => (
  <div className="uiPanneau cosScroll">{children}</div>
);

/// Section numérotée. `cache` la retire du flux plutôt que de la masquer :
/// un onglet inactif ne doit pas exister à l'écran.
export const Section = ({ numero, titre, aide, cache, children, innerRef }) => (
  <section className="uiSection" data-cache={cache ? "true" : "false"} ref={innerRef}>
    <h2 className="uiSectionTitre">
      {numero ? <span className="uiNum">{numero}.</span> : null}
      {titre}
    </h2>
    {aide ? <p className="uiAide">{aide}</p> : null}
    {children}
  </section>
);

/// Champ de saisie : libellé au-dessus, aide en dessous.
export const Champ = ({ label, aide, children }) => (
  <label className="uiChamp">
    {label ? <label>{label}</label> : null}
    {children}
    {aide ? <span className="uiAide">{aide}</span> : null}
  </label>
);

export const Ligne = ({ children }) => <div className="uiLigne">{children}</div>;

export const Colonnes = ({ nb = 2, children }) => (
  <div className="uiColonnes" style={{ "--uiCols": nb }}>
    {children}
  </div>
);

/// Bouton. `variante` : "principal" (défaut) | "secondaire" | "danger".
export const Bouton = ({
  variante = "principal",
  icone,
  large,
  off,
  onClick,
  children,
  ...reste
}) => (
  <button
    className="uiBouton"
    data-variante={variante}
    data-large={large ? "true" : "false"}
    data-off={off ? "true" : "false"}
    onClick={off ? undefined : onClick}
    {...reste}
  >
    {icone ? <Icon fafa={icone} width={12} /> : null}
    {children}
  </button>
);

/// Grille de choix. `multiple` autorise plusieurs sélections.
export const Chips = ({ options, valeur, onChoisir, multiple }) => {
  const actif = (id) =>
    multiple ? (valeur || []).includes(id) : valeur === id;

  const choisir = (id) => {
    if (!multiple) return onChoisir(id);
    const liste = valeur || [];
    onChoisir(liste.includes(id) ? liste.filter((x) => x !== id) : [...liste, id]);
  };

  return (
    <div className="uiChips">
      {options.map((o) => (
        <div
          key={o.id}
          className="uiChip"
          data-actif={actif(o.id) ? "true" : "false"}
          onClick={() => choisir(o.id)}
        >
          {o.icone ? <Icon fafa={o.icone} width={13} /> : null}
          <span>{o.label}</span>
        </div>
      ))}
    </div>
  );
};

export const Bascule = ({ on, onChanger, children }) => (
  <div className="uiBascule" data-on={on ? "true" : "false"} onClick={() => onChanger(!on)}>
    <span className="uiPiste" />
    <span>{children}</span>
  </div>
);

/// Message contextuel. `ton` : "info" | "succes" | "attention" | "erreur".
export const Notice = ({ ton = "info", icone, children }) =>
  children ? (
    <div className="uiNotice" data-ton={ton}>
      {icone ? <Icon fafa={icone} width={13} /> : null}
      <span>{children}</span>
    </div>
  ) : null;

/// État vide : dire ce qui manque et comment le remplir, jamais une page
/// blanche.
export const Vide = ({ icone = "faInbox", titre, aide, children }) => (
  <div className="uiVide">
    <div className="uiVideIcone">
      <Icon fafa={icone} width={26} />
    </div>
    {titre ? <div className="uiVideTitre">{titre}</div> : null}
    {aide ? <div className="uiVideAide">{aide}</div> : null}
    {children}
  </div>
);

export const Barre = ({ children }) => <div className="uiBarre">{children}</div>;
export const Espace = () => <div className="uiEspace" />;

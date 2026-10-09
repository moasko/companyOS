// Campagnes — briques partagées par les écrans.

import React, { createContext, useContext, useEffect, useState } from "react";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import * as D from "@companyos/shared/campagnes";

export const Ctx = createContext(null);
export const useC = () => useContext(Ctx);

export const COULEURS = ["#c2410c", "#1d4ed8", "#047857", "#7c3aed", "#be123c", "#18181b"];

export const Bouton = ({ variante = "secondaire", icone, children, className = "", ...reste }) => (
  <button type="button" className={`cmpBtn ${className}`} data-variante={variante} {...reste}>
    {icone ? <Icon fafa={icone} width={12} /> : null}
    {children}
  </button>
);

export const Entete = ({ titre, sous, retour, children }) => {
  const { aller, t } = useC();
  return (
    <header className="cmpTete">
      {retour ? (
        <button type="button" className="cmpRetour" onClick={() => (retour.action ? retour.action() : aller(retour.section, retour.opts))}>
          <Icon fafa="faChevronLeft" width={11} />
          {retour.label || t("navAccueil")}
        </button>
      ) : null}
      <div className="cmpTeteTitre">
        <h1>{titre}</h1>
        {sous ? <span>{sous}</span> : null}
      </div>
      <div className="cmpTeteActions">{children}</div>
    </header>
  );
};

export const Carte = ({ titre, aide, actions, children, className = "", ton }) => (
  <section className={`cmpCarte ${className}`} data-ton={ton || ""}>
    {titre || actions ? (
      <div className="cmpCarteTete">
        <div>
          {titre ? <h2>{titre}</h2> : null}
          {aide ? <p>{aide}</p> : null}
        </div>
        {actions ? <div className="cmpCarteActions">{actions}</div> : null}
      </div>
    ) : null}
    {children}
  </section>
);

export const Kpi = ({ label, valeur, aide, ton, onClick }) => (
  <button type="button" className="cmpKpi" data-ton={ton || ""} onClick={onClick} disabled={!onClick}>
    <span>{label}</span>
    <b>{valeur}</b>
    {aide ? <small>{aide}</small> : null}
  </button>
);

export const Puce = ({ ton, children }) => <span className="cmpPuce" data-ton={ton || ""}>{children}</span>;

export const Etiquette = ({ ton, children }) => <span className="cmpChip" data-ton={ton || ""}>{children}</span>;

export const Statut = ({ statut }) => {
  const { t } = useC();
  const ton = { brouillon: "", programmee: "orange", envoi: "bleu", pause: "orange", terminee: "vert" }[statut] || "";
  return <Etiquette ton={ton}>{t(`statut_${statut}`)}</Etiquette>;
};

export const Onglets = ({ options, valeur, onChoisir, label }) => (
  <div className="cmpOnglets" role="tablist" aria-label={label}>
    {options.map((o) => (
      <button key={o.id} type="button" role="tab" aria-selected={valeur === o.id} onClick={() => onChoisir(o.id)}>
        {o.label}
        {o.nb !== undefined ? <span>{o.nb}</span> : null}
      </button>
    ))}
  </div>
);

export const Recherche = ({ valeur, onChanger, placeholder }) => (
  <label className="cmpRecherche">
    <Icon fafa="faMagnifyingGlass" width={12} />
    <input value={valeur} onChange={(e) => onChanger(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
  </label>
);

export const initiales = (nom = "") =>
  String(nom).split(/\s+/).filter((m) => /^[A-Za-zÀ-ÿ]/.test(m)).slice(0, 2).map((m) => m[0]).join("").toUpperCase() || "?";

export const telecharger = (contenu, nom, type) => {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nom });
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
};

/// Les adresses de lecture des images du Cloud, pour l'aperçu dans
/// l'application (le message envoyé, lui, porte une adresse signée).
const cacheImages = new Map();
export const useImagesCloud = (blocs = []) => {
  const [, forcer] = useState(0);
  const ids = blocs.filter((b) => b.type === "image" && b.nodeId).map((b) => b.nodeId);
  useEffect(() => {
    let vivant = true;
    for (const id of ids) {
      if (cacheImages.has(id)) continue;
      cacheImages.set(id, "");
      api.streamUrl(id).then((u) => {
        cacheImages.set(id, u);
        if (vivant) forcer((x) => x + 1);
      }).catch(() => {});
    }
    return () => { vivant = false; };
  }, [ids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return (b) => (b.nodeId ? cacheImages.get(b.nodeId) || "" : b.url);
};

/// Le pied légal, comme le serveur le compose.
export const piedDe = (entreprise = {}, nom = "") =>
  [entreprise.nom || nom, [entreprise.adresse, entreprise.ville].filter(Boolean).join(", "), entreprise.ncc ? `NCC ${entreprise.ncc}` : "", entreprise.telephone || ""]
    .filter(Boolean)
    .join(" · ");

/// L'aperçu du message tel que le destinataire le recevra : même rendu que
/// le serveur, personnalisé pour une personne d'exemple.
export const ApercuMail = ({ message, exemple, appareil = "ordinateur", extra = {} }) => {
  const { t, entreprise, nomEntreprise } = useC();
  const image = useImagesCloud(message.blocs || []);
  const dest = exemple ? D.destinataireDe(exemple) : { nom: "Koné Distribution", contact: "Awa Koné", prenom: "Awa", ville: "Abidjan" };
  const variables = { ...D.variablesPour(dest, nomEntreprise), numero: "DEV-2026-0141", annees: "2", ...extra };
  const p = D.personnaliser(message, variables);
  let html = D.htmlDe(p, { entreprise: nomEntreprise, image, lienDesinscription: "https://apercu.invalid/", pied: piedDe(entreprise, nomEntreprise) });
  // Le logo est une image locale : on l'insère après coup (le gabarit
  // n'accepte que des liens http(s), comme un vrai client mail).
  if (entreprise?.logo && /^data:image\/(png|jpeg|gif|webp);base64,/.test(entreprise.logo)) {
    html = html.replace(/(<td style="background:[^"]*;padding:20px 32px">\s*)/, `$1<img src="${entreprise.logo}" alt="" height="36" style="height:36px;max-width:160px;vertical-align:middle;margin-right:12px;border-radius:6px;background:#ffffff">`);
  }
  return (
    <div className="cmpApercu" data-appareil={appareil}>
      <div className="cmpBoite">
        <span className="cmpAvatar" aria-hidden="true">{initiales(nomEntreprise)}</span>
        <span className="cmpBoiteTexte">
          <span><b>{nomEntreprise}</b><small>{t("maintenant")}</small></span>
          <b>{p.sujet || t("objetVide")}</b>
          <small>{p.apercu || ""}</small>
        </span>
      </div>
      <div className="cmpCadre">
        <iframe title={t("apercu")} srcDoc={html} sandbox="" />
      </div>
    </div>
  );
};

import React, { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "./ModuleWindow";
import { useTraduction } from "../utils/intl";

// ---------------------------------------------------------------------------
// APPLICATIONS « SITE WEB » DU STUDIO
//
// Une adresse, présentée comme une application : icône sur le bureau, entrée
// au menu Démarrer, fenêtre à son nom. Beaucoup d'outils qu'une équipe
// utilise chaque jour sont déjà des sites — un ERP hébergé, un tableau de
// bord interne, une documentation. Leur donner leur place dans l'OS évite de
// les chercher parmi trente onglets.
//
// DEUX COMPORTEMENTS, ET C'EST LE SITE QUI DÉCIDE
//
// Un site peut refuser d'être affiché dans le cadre d'un autre — par
// `X-Frame-Options`, ou par `frame-ancestors` dans sa politique de sécurité.
// C'est une protection contre le détournement de clic, et elle est
// parfaitement légitime : sans elle, n'importe qui pourrait superposer une
// page invisible au-dessus d'un bouton « Confirmer le virement ».
//
// Ce refus ne se contourne pas, et il ne doit pas se contourner. Le Studio
// le constate à la création (il interroge l'adresse par
// `POST /api/web/inspecter`) et enregistre `ouverture: "fenetre"` pour ces
// sites-là : l'app ouvre alors un véritable onglet, avec la barre d'adresse
// du navigateur et le cadenas — ce qui est de toute façon ce qu'il faut pour
// se connecter à un service.
//
// vscode.dev est exactement ce cas : il répond `frame-ancestors 'none'`.
// ---------------------------------------------------------------------------

const TEXTES = {
  fr: {
    ouvrir: "Ouvrir {nom}",
    horsCadre: "{nom} ne peut pas s'afficher dans une fenêtre de CompanyOS.",
    pourquoi:
      "Le site refuse d'être encadré par un autre — une protection contre le détournement de clic. Il s'ouvre donc dans un onglet du navigateur.",
    adresse: "Adresse",
    rouvrir: "Rouvrir l'onglet",
    recharger: "Recharger",
  },
  en: {
    ouvrir: "Open {nom}",
    horsCadre: "{nom} cannot be displayed inside a CompanyOS window.",
    pourquoi:
      "The site refuses to be framed by another one — a protection against clickjacking. It therefore opens in a browser tab.",
    adresse: "Address",
    rouvrir: "Reopen the tab",
    recharger: "Reload",
  },
};

/// Une adresse sûre à poser dans un `src` ou un `href`.
///
/// Le serveur valide déjà à l'enregistrement, mais une définition peut venir
/// d'une base plus ancienne que cette validation : on ne fait pas confiance
/// à ce qu'on relit, seulement à ce qu'on vérifie.
const adresseSure = (valeur) => {
  const brute = String(valeur || "").trim();
  return /^https?:\/\//i.test(brute) ? brute : "";
};

export const CustomWebApp = ({ app }) => {
  const wnapp = useSelector((state) => state.apps[app.id || app.icon]);
  const t = useTraduction(TEXTES);
  const [cle, setCle] = useState(0);
  const dejaOuvert = useRef(false);

  const config = app.definition?.web || {};
  const url = adresseSure(config.url);
  const dansUnOnglet = config.ouverture === "fenetre" || !url;

  const ouvrirOnglet = () => {
    if (!url) return;
    // `noopener` : sans lui, la page ouverte reçoit une référence à la
    // nôtre par `window.opener` et peut la faire naviguer ailleurs.
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // Pour un site qui refuse le cadre, l'onglet s'ouvre à la première
  // ouverture de la fenêtre — sinon l'app donnerait l'impression de ne rien
  // faire. Une seule fois : rouvrir un onglet à chaque va-et-vient entre
  // deux fenêtres serait insupportable.
  useEffect(() => {
    if (!wnapp || wnapp.hide || !dansUnOnglet || dejaOuvert.current) return;
    dejaOuvert.current = true;
    ouvrirOnglet();
  }, [wnapp?.hide, dansUnOnglet]);

  return (
    <ModuleWindow manifest={app} className="customWebApp">
      {dansUnOnglet ? (
        <div className="webAppMessage">
          <h2>{t("horsCadre", { nom: app.name })}</h2>
          <p>{t("pourquoi")}</p>
          {url && (
            <>
              <p className="webAppAdresse">
                <span>{t("adresse")}</span>
                <code>{url}</code>
              </p>
              <button type="button" className="webAppBouton" onClick={ouvrirOnglet}>
                {t("rouvrir")}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="webAppCadre">
          <div className="webAppBarre">
            <code>{url}</code>
            <button type="button" onClick={() => setCle((n) => n + 1)}>
              {t("recharger")}
            </button>
            <button type="button" onClick={ouvrirOnglet}>
              {t("ouvrir", { nom: "↗" })}
            </button>
          </div>
          <iframe
            key={cle}
            src={url}
            title={app.name}
            // Même réglage que le Navigateur pour une page distante : elle
            // est servie par **son** site, donc elle garde son origine à
            // elle et ne peut rien lire chez nous. `allow-same-origin` est
            // nécessaire — sans lui l'origine devient opaque, les cookies
            // ne suivent plus, et aucune connexion n'est possible : l'app
            // n'afficherait qu'un écran de login en boucle.
            //
            // La règle « jamais `allow-same-origin` » vaut pour l'autre cas,
            // celui d'un document servi par **notre** serveur : là, cette
            // permission donnerait notre origine au contenu distant, donc
            // l'accès au jeton de session. Voir la vue de lecture dans
            // src/apps/modules/navigateur/index.jsx.
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-downloads"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </ModuleWindow>
  );
};

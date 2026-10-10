import React, { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { useTraduction } from "../../../utils/intl";
import { api } from "../../../api/client";
import "./fne.scss";
import { manifest as descriptif } from "./manifest";

// ---------------------------------------------------------------------------
// FNE — le portail de la facture normalisée électronique
//
// La facture normalisée est obligatoire pour les entreprises ivoiriennes :
// le portail de la DGI fait partie des outils qu'on ouvre toutes les
// semaines. Il mérite donc son icône sur le bureau plutôt qu'un signet
// perdu au milieu de trente onglets.
//
// LE SITE EST ENCADRÉ, MAIS L'ADRESSE RESTE VISIBLE
//
// Le portail réclame les identifiants fiscaux de l'entreprise. Un cadre
// cache d'ordinaire la barre d'adresse et le cadenas — les deux repères qui
// permettent de vérifier qu'on est chez la DGI et pas sur une copie. D'où
// la barre au-dessus du cadre : elle affiche l'adresse en permanence et
// propose d'ouvrir un véritable onglet d'un clic.
//
// LE CADRE N'EST PAS TOUJOURS POSSIBLE, ET ON LE DEMANDE AVANT
//
// Beaucoup d'administrations refusent d'être encadrées
// (`X-Frame-Options`, `frame-ancestors`), et un cadre refusé ne donne
// qu'une fenêtre blanche, sans message. L'app interroge donc le portail
// **par le serveur** au moment de s'ouvrir : s'il accepte, elle l'affiche ;
// s'il refuse — ou s'il est injoignable — elle bascule sur l'écran de
// lancement et ouvre un onglet.
//
// Le portail n'étant pas joignable hors de Côte d'Ivoire, je n'ai pas pu
// savoir dans quel cas on tombe. C'est précisément pour ça que les deux
// sont traités.
// ---------------------------------------------------------------------------

/// Les adresses du portail. Écrites une fois, en clair : le jour où la DGI
/// change de chemin, c'est le seul endroit à corriger.
const PORTAIL = "https://www.services.fne.dgi.gouv.ci/fr/login";
const ACCUEIL = "https://www.services.fne.dgi.gouv.ci/";

const TEXTES = {
  fr: {
    titre: "Facture Normalisée Électronique",
    sous: "Le portail de la Direction Générale des Impôts.",
    ouvrir: "Ouvrir le portail FNE",
    accueil: "Page d'accueil du service",
    adresse: "Adresse officielle",
    pourquoiTitre: "Pourquoi un onglet, et pas une fenêtre intégrée",
    pourquoi:
      "Vous allez saisir les identifiants fiscaux de l'entreprise. Dans un cadre, " +
      "la barre d'adresse et le cadenas disparaissent — or ce sont eux qui prouvent " +
      "que vous êtes bien chez la DGI. L'onglet les garde visibles.",
    verifier: "Vérifiez toujours que l'adresse commence par",
    rappelTitre: "Avant de vous connecter",
    rappel1: "Munissez-vous du numéro de compte contribuable de l'entreprise.",
    rappel2: "Le portail n'est joignable que depuis la Côte d'Ivoire.",
    rappel3: "CompanyOS ne conserve aucun de vos identifiants fiscaux.",
    rouvrir: "Rouvrir l'onglet",
    ouvrirOnglet: "Ouvrir dans un onglet",
    refuseTitre: "Le portail refuse d'être affiché dans une fenêtre",
    refuse:
      "Le site interdit son affichage à l'intérieur d'un autre — une protection contre " +
      "le détournement de clic, qui ne se contourne pas. Il s'ouvre donc dans un onglet.",
    inconnuTitre: "Le portail n'a pas répondu à la vérification",
    inconnu:
      "Impossible de savoir s'il accepte d'être affiché dans une fenêtre : il n'est " +
      "joignable que depuis la Côte d'Ivoire. Vous pouvez tenter l'affichage intégré — " +
      "s'il refuse, la fenêtre restera blanche et il faudra revenir à l'onglet.",
    essayerCadre: "Essayer l'affichage dans la fenêtre",
  },
  en: {
    titre: "Standardised Electronic Invoice",
    sous: "The portal of the Ivorian tax authority (DGI).",
    ouvrir: "Open the FNE portal",
    accueil: "Service home page",
    adresse: "Official address",
    pourquoiTitre: "Why a tab, and not an embedded window",
    pourquoi:
      "You are about to enter the company's tax credentials. Inside a frame, the " +
      "address bar and the padlock disappear — yet they are what proves you are on " +
      "the DGI's site. A tab keeps them visible.",
    verifier: "Always check that the address starts with",
    rappelTitre: "Before signing in",
    rappel1: "Have the company's taxpayer account number to hand.",
    rappel2: "The portal is only reachable from Côte d'Ivoire.",
    rappel3: "CompanyOS never stores your tax credentials.",
    rouvrir: "Reopen the tab",
    ouvrirOnglet: "Open in a tab",
    refuseTitre: "The portal refuses to be shown in a window",
    refuse:
      "The site forbids being displayed inside another one — a protection against " +
      "clickjacking, which cannot be bypassed. It opens in a tab instead.",
    inconnuTitre: "The portal did not answer the check",
    inconnu:
      "We cannot tell whether it accepts being shown in a window: it is only reachable " +
      "from Côte d'Ivoire. You may try the embedded view — if it refuses, the window " +
      "will stay blank and you will need the tab.",
    essayerCadre: "Try the embedded view",
  },
};

export const manifest = { ...descriptif, Window: FneApp };

/// Ouvre le portail dans un onglet.
///
/// `noopener` n'est pas décoratif : sans lui, la page ouverte reçoit une
/// référence à la nôtre par `window.opener` et peut la faire naviguer
/// ailleurs — le début d'un détournement.
const ouvrirPortail = (url) => window.open(url, "_blank", "noopener,noreferrer");

function FneApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const t = useTraduction(TEXTES);
  const dejaOuvert = useRef(false);

  // Quatre états, et la nuance compte : « refuse » et « injoignable » ne
  // se corrigent pas de la même façon, et les confondre fait afficher une
  // explication fausse.
  //   null       — vérification en cours
  //   "oui"      — le portail accepte le cadre
  //   "refuse"   — il l'interdit (X-Frame-Options, frame-ancestors)
  //   "inconnu"  — il n'a pas répondu : on ne sait pas
  const [cadrable, setCadrable] = useState(null);
  // Passer outre la vérification : elle renseigne, elle ne décide pas.
  const [force, setForce] = useState(false);

  // C'est le **serveur** qui interroge le portail, pas le navigateur : une
  // page ne peut pas lire les en-têtes d'un autre domaine, et c'est
  // justement l'en-tête qui contient la réponse. Au passage, cet appel part
  // de la machine où l'API tourne — donc de Côte d'Ivoire une fois
  // déployée, seul endroit d'où le portail répond.
  useEffect(() => {
    if (!wnapp || wnapp.hide || cadrable !== null) return;
    let vivant = true;
    api.web
      .inspecter(PORTAIL)
      .then((info) => vivant && setCadrable(info.cadrable ? "oui" : "refuse"))
      .catch(() => vivant && setCadrable("inconnu"));
    return () => {
      vivant = false;
    };
  }, [wnapp?.hide, cadrable]);

  // L'onglet ne part tout seul que si le cadre est impossible : sinon
  // l'app ouvrirait un onglet **et** afficherait le site, ce qui fait deux
  // fois la même chose.
  useEffect(() => {
    if (!wnapp || wnapp.hide || cadrable === null || cadrable === "oui") return;
    if (dejaOuvert.current) return;
    dejaOuvert.current = true;
    ouvrirPortail(PORTAIL);
  }, [wnapp?.hide, cadrable]);

  return (
    <ModuleWindow manifest={manifest} className="fneApp">
      {cadrable === "oui" || force ? (
        <div className="fneCadre">
          <div className="fneBarre">
            {/* L'adresse reste visible en permanence. C'était ma réserve
                contre le cadre — un portail fiscal où l'on ne voit plus où
                l'on est. La montrer ici la lève en partie ; le bouton
                d'ouverture en onglet la lève tout à fait. */}
            <code>{PORTAIL}</code>
            <button type="button" onClick={() => ouvrirPortail(PORTAIL)}>
              {t("ouvrirOnglet")} ↗
            </button>
          </div>
          <iframe
            src={PORTAIL}
            title={t("titre")}
            // Page distante servie par son propre site : elle garde son
            // origine et ne peut rien lire chez nous. `allow-same-origin`
            // est nécessaire — sans lui l'origine devient opaque, les
            // cookies ne suivent plus, et la connexion est impossible.
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-downloads"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : (
      <div className="fneCorps">
        <header className="fneTete">
          <img src="img/icon/cos/fne.svg" alt="" width={54} height={54} />
          <div>
            <h2>{t("titre")}</h2>
            <p>{t("sous")}</p>
          </div>
        </header>

        <div className="fneActions">
          <button type="button" className="fnePrincipal" onClick={() => ouvrirPortail(PORTAIL)}>
            {t("ouvrir")} ↗
          </button>
          <button type="button" className="fneSecondaire" onClick={() => ouvrirPortail(ACCUEIL)}>
            {t("accueil")}
          </button>
        </div>

        <p className="fneAdresse">
          <span>{t("adresse")}</span>
          <code>{PORTAIL}</code>
        </p>

        <section className="fneNote">
          <h3>{cadrable === "refuse" ? t("refuseTitre") : t("inconnuTitre")}</h3>
          <p>{cadrable === "refuse" ? t("refuse") : t("inconnu")}</p>
          {cadrable !== "refuse" && (
            <button type="button" className="fneSecondaire" onClick={() => setForce(true)}>
              {t("essayerCadre")}
            </button>
          )}
          <p>{t("pourquoi")}</p>
          <p className="fneVerif">
            {t("verifier")} <code>https://www.services.fne.dgi.gouv.ci</code>
          </p>
        </section>

        <section className="fneNote">
          <h3>{t("rappelTitre")}</h3>
          <ul>
            <li>{t("rappel1")}</li>
            <li>{t("rappel2")}</li>
            <li>{t("rappel3")}</li>
          </ul>
        </section>
      </div>
      )}
    </ModuleWindow>
  );
}

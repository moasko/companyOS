// Navigateur.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUE CETTE APPLICATION EST, ET CE QU'ELLE N'EST PAS
//
// Elle ne remplace pas Chrome. Une page web affichée dans une autre page
// web l'est dans un cadre, et la plupart des sites l'interdisent — c'est
// leur défense contre le détournement de clic, et elle est justifiée.
// Prétendre le contraire produirait une fenêtre blanche par site visité.
//
// Ce qu'elle fait, elle le fait pour de bon :
//
//   - **ouvrir les outils de l'entreprise** dans une fenêtre de l'OS, à
//     côté du stock et de la facturation, avec des favoris partagés par
//     l'espace de travail ;
//   - **dire pourquoi** quand un site refuse le cadre, et proposer de
//     l'ouvrir dans un vrai onglet — plutôt que de laisser deviner ;
//   - **rapporter les téléchargements dans le cloud**, sans rien demander.
//     Une adresse qui mène à un fichier plutôt qu'à une page n'ouvre pas
//     un dialogue « voulez-vous enregistrer » : le serveur va le chercher
//     et l'écrit dans l'Explorateur, dossier Téléchargements. C'est le
//     point qui manquait le plus — un tarif fournisseur récupéré sur le
//     web tombait jusqu'ici dans les téléchargements de la machine, donc
//     hors du produit : invisible pour les collègues, absent du quota, et
//     perdu au prochain poste.
//
// L'historique reste dans la fenêtre et meurt avec elle. Il n'est pas
// enregistré : les données d'un module sont partagées par tout l'espace de
// travail, et l'historique de navigation d'un collègue ne regarde pas ses
// collègues. Les favoris, eux, sont des outils d'entreprise : ils se
// partagent.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api, BASE_URL } from "../../../api/client";
import { ensureRootFolder } from "../../cloud";
import { modal } from "../../modalRequest";
import { notifier } from "../../notifications";
import { composerCourriel } from "../../courrielRequest";
import { analyserMailto, estMailto } from "../../mailto";
import { ouvrirDossier } from "../../explorerRequest";
import { ouvrirFichier } from "../../openRequest";
import { Contenu, useChargement } from "../../chargement";
import {
  decouperUrl,
  empiler,
  interpreter,
  tailleLisible,
} from "./domaine";
import "./navigateur.scss";

export const manifest = {
  id: "navigateur",
  slug: "browser",
  name: "Navigateur",
  icon: "navigateur",
  // L'icône du bureau ouvre encore la fenêtre par une action Redux : sans
  // ce champ, l'application apparaît sur le bureau et le double-clic ne
  // fait rien.
  action: "NAVIGATEURAPP",
  Window: NavigateurApp,
};

/// Dossier du cloud où atterrissent les téléchargements. Toujours le même,
/// pour qu'on sache où regarder sans avoir à chercher.
const DOSSIER = "Téléchargements";

/// Un onglet vierge.
const nouvelOnglet = () => ({
  cle: `o${Math.random().toString(36).slice(2, 9)}`,
  saisie: "",
  href: "",
  // vide | chargement | page | refus | fichier | enregistre | erreur
  etat: "vide",
  info: null,
  fichier: null,
  dossier: null,
  message: "",
  pile: [],
  position: -1,
});

function NavigateurApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";

  const [onglets, setOnglets] = useState([nouvelOnglet()]);
  const [actif, setActif] = useState(0);
  const [favoris, setFavoris] = useState([]);
  const [enCours, setEnCours] = useState(null);
  const champ = useRef(null);

  const onglet = onglets[actif] || onglets[0];

  const charger = useCallback(async () => {
    setFavoris(await api.records.list(manifest.slug, "favoris"));
  }, []);
  const etat = useChargement(ouvert, charger);

  /// Modifie l'onglet actif sans toucher aux autres.
  const majOnglet = useCallback(
    (changements) => {
      setOnglets((liste) =>
        liste.map((o, i) => (i === actif ? { ...o, ...changements } : o)),
      );
    },
    [actif],
  );

  // ---- Téléchargement -----------------------------------------------------

  /// Rapporte une adresse dans le cloud de l'espace de travail.
  ///
  /// Le serveur fait le trajet : la page ne peut pas lire un autre domaine.
  /// `vue` distingue les deux appelants — un téléchargement déclenché par
  /// la navigation occupe la fenêtre et y affiche son résultat, alors que
  /// le bouton de la barre s'exerce sur une page qu'on est en train de
  /// lire et ne doit pas la faire disparaître.
  const rapatrier = useCallback(
    async (href, { vue = true } = {}) => {
      if (!href) return;
      setEnCours(href);
      if (vue) majOnglet({ etat: "fichier", message: "" });

      try {
        const dossier = await ensureRootFolder(DOSSIER);
        const node = await api.web.telecharger(href, dossier);

        notifier({
          titre: "Téléchargement terminé",
          message: `« ${node.name} » est dans ${DOSSIER}.`,
          app: "Navigateur",
          ton: "success",
        });

        if (vue) majOnglet({ etat: "enregistre", fichier: node, dossier });
        else {
          modal.alert({
            title: "Enregistré dans le cloud",
            message: `« ${node.name} » est dans ${DOSSIER}.`,
            tone: "success",
          });
        }
      } catch (e) {
        const message = e?.message || "Le fichier n'a pas pu être récupéré.";
        if (vue) majOnglet({ etat: "erreur", message });
        else modal.alert({ title: "Téléchargement impossible", message, tone: "error" });
      } finally {
        setEnCours(null);
      }
    },
    [majOnglet],
  );

  // ---- Navigation ---------------------------------------------------------

  /// Va à une adresse : demande au serveur ce qu'il y a au bout, puis
  /// décide quoi montrer. Rien n'est encadré à l'aveugle — c'est ce qui
  /// permet d'expliquer un refus au lieu d'afficher du vide.
  const aller = useCallback(
    async (href, { historiser = true } = {}) => {
      // Une adresse mailto: n'est pas une page : elle ouvre le Courrier,
      // prérempli, et l'onglet reste où il est.
      if (estMailto(href)) {
        composerCourriel(analyserMailto(href));
        return;
      }

      majOnglet({ etat: "chargement", href, saisie: href, message: "" });

      let info;
      try {
        info = await api.web.inspecter(href);
      } catch (e) {
        return majOnglet({
          etat: "erreur",
          message: e?.message || "Ce site n'a pas pu être ouvert.",
        });
      }

      // Une page qui répond en erreur n'est ni affichable ni téléchargeable
      // utilement : le dire vaut mieux que d'encadrer un « 404 » du site.
      const enErreur = info.statut >= 400;

      setOnglets((liste) =>
        liste.map((o, i) => {
          if (i !== actif) return o;
          const suite = historiser
            ? empiler(o.pile, o.position, info.url)
            : { pile: o.pile, position: o.position };

          return {
            ...o,
            ...suite,
            href: info.url,
            saisie: info.url,
            info,
            message: enErreur
              ? `Le site a répondu ${info.statut}. Cette page n'existe pas, ou elle demande une connexion.`
              : info.raison || "",
            etat: enErreur
              ? "erreur"
              : !info.estPage
                ? "fichier"
                : info.cadrable
                  ? "page"
                  : "refus",
          };
        }),
      );

      // Ce n'est pas une page : c'est un téléchargement. Il part dans le
      // cloud tout seul, sans bouton à trouver — c'est la règle de l'OS,
      // et un fichier qui atterrit dans le dossier Téléchargements de la
      // machine est un fichier sorti du produit.
      if (!enErreur && !info.estPage) rapatrier(info.url);
    },
    [actif, majOnglet, rapatrier],
  );

  /// Ce que l'utilisateur a tapé. Une recherche ne s'encadre pas : aucun
  /// moteur ne l'autorise, donc elle part dans un vrai onglet.
  const valider = (saisie) => {
    // Une adresse mailto: saisie dans la barre ouvre le Courrier — avant
    // même l'interprétation, qui la prendrait pour une recherche.
    if (estMailto(saisie)) {
      composerCourriel(analyserMailto(saisie));
      return;
    }

    const intention = interpreter(saisie);
    if (!intention) return;

    if (intention.type === "recherche") {
      window.open(intention.href, "_blank", "noopener,noreferrer");
      return;
    }
    aller(intention.href);
  };

  const naviguerDans = (delta) => {
    const cible = onglet.position + delta;
    if (cible < 0 || cible >= onglet.pile.length) return;
    majOnglet({ position: cible });
    aller(onglet.pile[cible], { historiser: false });
  };

  // ---- Favoris ------------------------------------------------------------

  const enFavori = favoris.find((f) => f.data.href === onglet.href);

  const basculerFavori = async () => {
    if (!onglet.href) return;
    if (enFavori) {
      await api.records.remove(manifest.slug, "favoris", enFavori.id);
    } else {
      await api.records.create(manifest.slug, "favoris", {
        href: onglet.href,
        titre: onglet.info?.titre || decouperUrl(onglet.href).domaine,
      });
    }
    await etat.rafraichir();
  };

  const retirerFavori = async (favori) => {
    const ok = await modal.confirm({
      title: "Retirer ce favori ?",
      message: `« ${favori.data.titre} » disparaîtra pour tout l'espace de travail.`,
      confirmLabel: "Retirer",
      danger: true,
    });
    if (!ok) return;
    await api.records.remove(manifest.slug, "favoris", favori.id);
    await etat.rafraichir();
  };

  // ---- Onglets ------------------------------------------------------------

  const ajouterOnglet = () => {
    setOnglets((liste) => [...liste, nouvelOnglet()]);
    setActif(onglets.length);
    setTimeout(() => champ.current?.focus(), 0);
  };

  const fermerOnglet = (index) => {
    // Le dernier onglet ne se ferme pas : il se vide. Une fenêtre de
    // navigateur sans onglet n'a rien à montrer.
    if (onglets.length === 1) {
      setOnglets([nouvelOnglet()]);
      return;
    }
    setOnglets((liste) => liste.filter((_, i) => i !== index));
    setActif((a) => (index < a || a === onglets.length - 1 ? Math.max(0, a - 1) : a));
  };

  useEffect(() => {
    if (ouvert) setTimeout(() => champ.current?.focus(), 120);
  }, [ouvert]);

  const adresse = useMemo(() => decouperUrl(onglet.href), [onglet.href]);

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="navApp">
        <div className="navVerrou">Ouvrez une session pour naviguer.</div>
      </ModuleWindow>
    );
  }

  return (
    <ModuleWindow manifest={manifest} className="navApp">
      <div className="navShell">
        {/* ---------- Onglets ---------- */}
        <div className="navOnglets">
          {onglets.map((o, i) => (
            <div
              key={o.cle}
              className="navOnglet handcr"
              data-actif={i === actif}
              onClick={() => setActif(i)}
            >
              <Icon fafa="faGlobe" width={11} />
              <span className="navOngletNom">
                {o.info?.titre || decouperUrl(o.href).domaine || "Nouvel onglet"}
              </span>
              <span
                className="navFermer"
                onClick={(e) => {
                  e.stopPropagation();
                  fermerOnglet(i);
                }}
              >
                <Icon fafa="faXmark" width={9} />
              </span>
            </div>
          ))}
          <div className="navPlus handcr" onClick={ajouterOnglet}>
            <Icon fafa="faPlus" width={11} />
          </div>
        </div>

        {/* ---------- Barre d'adresse ---------- */}
        <div className="navBarre">
          <div
            className="navBouton handcr"
            data-inactif={onglet.position <= 0}
            onClick={() => naviguerDans(-1)}
            title="Précédent"
          >
            <Icon fafa="faArrowLeft" width={13} />
          </div>
          <div
            className="navBouton handcr"
            data-inactif={onglet.position >= onglet.pile.length - 1}
            onClick={() => naviguerDans(1)}
            title="Suivant"
          >
            <Icon fafa="faArrowRight" width={13} />
          </div>
          <div
            className="navBouton handcr"
            data-inactif={!onglet.href}
            onClick={() => onglet.href && aller(onglet.href, { historiser: false })}
            title="Actualiser"
          >
            <Icon fafa="faRotateRight" width={13} />
          </div>

          <div className="navChamp">
            {onglet.href ? (
              <Icon
                fafa={adresse.sur ? "faLock" : "faLockOpen"}
                width={11}
                className={adresse.sur ? "navSur" : "navPasSur"}
              />
            ) : (
              <Icon fafa="faMagnifyingGlass" width={11} />
            )}
            <input
              ref={champ}
              value={onglet.saisie}
              placeholder="Adresse d'un site, ou une recherche"
              onChange={(e) => majOnglet({ saisie: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") valider(e.target.value);
                if (e.key === "Escape") majOnglet({ saisie: onglet.href });
              }}
              onFocus={(e) => e.target.select()}
            />
            {onglet.etat === "chargement" ? <span className="navFilet" /> : null}
          </div>

          <div
            className="navBouton handcr"
            data-inactif={!onglet.href}
            data-actif={!!enFavori}
            onClick={basculerFavori}
            title={enFavori ? "Retirer des favoris" : "Ajouter aux favoris"}
          >
            <Icon fafa="faStar" width={13} />
          </div>
          <div
            className="navTelecharger handcr"
            data-inactif={!onglet.href || !!enCours}
            onClick={() => rapatrier(onglet.href, { vue: false })}
            title="Enregistrer cette adresse dans le cloud de l'entreprise"
          >
            <Icon fafa="faCloudArrowDown" width={13} />
            <span>{enCours ? "Téléchargement…" : "Dans le cloud"}</span>
          </div>
        </div>

        {/* ---------- Favoris ---------- */}
        <div className="navFavoris">
          <Contenu etat={etat} vide={false} lignes={1}>
            {favoris.length ? (
              favoris.map((f) => (
                <div
                  key={f.id}
                  className="navFavori handcr"
                  onClick={() => aller(f.data.href)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    retirerFavori(f);
                  }}
                  title={f.data.href}
                >
                  <Icon fafa="faGlobe" width={10} />
                  <span>{f.data.titre}</span>
                </div>
              ))
            ) : (
              <div className="navFavVide">
                Les sites mis en favori ici sont partagés avec vos collègues.
              </div>
            )}
          </Contenu>
        </div>

        {/* ---------- Contenu ---------- */}
        <div className="navPage">
          {onglet.etat === "vide" ? (
            <Accueil favoris={favoris} onAller={aller} />
          ) : onglet.etat === "chargement" ? (
            <div className="navEtat">
              <Icon fafa="faGlobe" width={26} />
              <p>Ouverture de {decouperUrl(onglet.href).domaine}…</p>
            </div>
          ) : onglet.etat === "page" ? (
            <iframe
              key={onglet.href}
              title={onglet.info?.titre || onglet.href}
              src={onglet.href}
              // Page distante servie par son propre site : elle garde son
              // origine, donc elle ne peut rien lire chez nous. Le bac à
              // sable limite en plus ce qu'elle impose à la fenêtre parente.
              sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin"
              referrerPolicy="no-referrer"
            />
          ) : onglet.etat === "refus" && onglet.info?.vue ? (
            <Lecture onglet={onglet} enCours={enCours} onRapatrier={rapatrier} />
          ) : (
            <Impasse
              onglet={onglet}
              enCours={enCours}
              onRapatrier={rapatrier}
            />
          )}
        </div>
      </div>
    </ModuleWindow>
  );
}

/// Page d'accueil : les outils de l'entreprise, et ce que la fenêtre sait
/// faire de plus qu'un onglet ordinaire.
const Accueil = ({ favoris, onAller }) => (
  <div className="navAccueil">
    <div className="navAccTitre">Navigateur</div>
    <p className="navAccSous">
      Ouvrez les outils de l'entreprise dans une fenêtre, à côté de vos autres
      applications. Tout fichier récupéré ici part dans le cloud de l'espace,
      dossier {DOSSIER} — jamais dans les téléchargements de cette machine.
    </p>

    {favoris.length ? (
      <div className="navAccGrille">
        {favoris.map((f) => (
          <div key={f.id} className="navAccCarte handcr" onClick={() => onAller(f.data.href)}>
            <Icon fafa="faGlobe" width={18} />
            <div className="navAccNom">{f.data.titre}</div>
            <div className="navAccUrl">{decouperUrl(f.data.href).domaine}</div>
          </div>
        ))}
      </div>
    ) : (
      <div className="navAccVide">
        Aucun favori pour l'instant. Ouvrez un site, puis l'étoile de la barre
        d'adresse : il apparaîtra ici pour toute l'équipe.
      </div>
    )}
  </div>
);

/// Vue de lecture : la page servie par notre serveur, donc affichable
/// malgré le refus du site.
///
/// Le bandeau n'est pas décoratif. Ce qui est à l'écran n'est pas tout à
/// fait la page réelle — scripts retirés, formulaires inertes — et
/// l'utilisateur doit le savoir avant de conclure qu'un site est cassé.
const Lecture = ({ onglet, enCours, onRapatrier }) => (
  <>
    <div className="navBandeau">
      <Icon fafa="faBookOpen" width={12} />
      <span>
        Vue de lecture — {decouperUrl(onglet.href).domaine} n'autorise pas
        l'affichage direct. Scripts désactivés, formulaires inactifs.
      </span>
      <div
        className="navBandeauAction handcr"
        onClick={() => window.open(onglet.href, "_blank", "noopener,noreferrer")}
      >
        Ouvrir dans un onglet
      </div>
      <div
        className="navBandeauAction handcr"
        data-inactif={!!enCours}
        onClick={() => onRapatrier(onglet.href, { vue: false })}
      >
        Dans le cloud
      </div>
    </div>
    <iframe
      key={onglet.info.vue}
      title={onglet.info?.titre || onglet.href}
      src={`${BASE_URL}${onglet.info.vue}`}
      // **Ne jamais ajouter `allow-same-origin` ici.** Ce document est
      // servi par notre serveur : avec cette permission, le contenu du
      // site distant partagerait notre origine et pourrait lire le jeton
      // de session dans le localStorage. Pas de `allow-scripts` non plus —
      // les scripts sont déjà retirés côté serveur, ceci est la seconde
      // barrière. Voir apps/api/src/lecture.js.
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
    />
  </>
);

/// Ce qu'on montre quand la page ne s'affichera pas — refus de cadre,
/// fichier, ou panne. Chacun de ces trois cas a une suite possible : c'est
/// elle qu'on met en avant, pas le problème.
const Impasse = ({ onglet, enCours, onRapatrier }) => {
  const { info, etat, href, message, fichier, dossier } = onglet;
  const taille = tailleLisible(info?.taille);

  // Téléchargement en cours. Il a démarré tout seul en arrivant sur le
  // lien : il n'y a rien à valider, seulement à patienter.
  if (etat === "fichier") {
    return (
      <div className="navEtat">
        <Icon fafa="faCloudArrowDown" width={30} />
        <div className="navEtatTitre">{info?.nom || "Fichier"}</div>
        <p>
          Enregistrement dans {DOSSIER}
          {info?.type ? ` — ${info.type}` : ""}
          {taille ? `, ${taille}` : ""}…
        </p>
      </div>
    );
  }

  if (etat === "enregistre") {
    return (
      <div className="navEtat">
        <Icon fafa="faCircleCheck" width={30} />
        <div className="navEtatTitre">{fichier?.name}</div>
        <p>
          Enregistré dans le cloud de l'entreprise, dossier {DOSSIER}. Vos
          collègues y ont accès, et le fichier compte dans le quota de l'espace
          — il n'est pas dans les téléchargements de cette machine.
        </p>
        <div className="navActions">
          <div
            className="navAction navPrimaire handcr"
            // Tous les types n'ont pas de visionneuse : dans ce cas
            // `ouvrirFichier` répond faux, et le dossier est le meilleur
            // repli — mieux vaut ça qu'un clic sans effet.
            onClick={() => {
              if (!fichier || !ouvrirFichier(fichier)) ouvrirDossier(dossier);
            }}
          >
            Ouvrir le fichier
          </div>
          <div className="navAction handcr" onClick={() => ouvrirDossier(dossier)}>
            Ouvrir le dossier
          </div>
        </div>
      </div>
    );
  }

  if (etat === "refus") {
    return (
      <div className="navEtat">
        <Icon fafa="faShieldHalved" width={30} />
        <div className="navEtatTitre">{decouperUrl(href).domaine}</div>
        <p>
          {message} C'est une protection du site, pas une panne de CompanyOS :
          rien ici ne peut la contourner.
        </p>
        <div className="navActions">
          <div
            className="navAction navPrimaire handcr"
            onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
          >
            Ouvrir dans un onglet
          </div>
          <div
            className="navAction handcr"
            data-inactif={!!enCours}
            onClick={() => onRapatrier(href, { vue: false })}
          >
            Enregistrer la page dans le cloud
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="navEtat navEchec">
      <Icon fafa="faTriangleExclamation" width={30} />
      <div className="navEtatTitre">Site injoignable</div>
      <p>{message}</p>
    </div>
  );
};

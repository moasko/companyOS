// Présentations.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUE C'EST
//
// Un créateur et lecteur de diaporamas `.pptx` : ouvrir un fichier
// PowerPoint, le modifier, en créer de zéro, le présenter en plein écran.
// Le moteur est `pptx-react-viewer` (Apache 2.0) — un rendu HTML/CSS et
// non canvas, donc le texte reste net à tout niveau de zoom, sélectionnable
// et lisible par un lecteur d'écran.
//
// LE MÊME MODÈLE QUE LE TRAITEMENT DE TEXTE
//
// Une présentation n'est pas un enregistrement de module : c'est un fichier
// `.pptx` dans le cloud de l'espace, dossier Présentations. Il apparaît
// dans l'Explorateur, se partage, se met à la corbeille et compte dans le
// quota comme n'importe quel fichier — et un double-clic dessus l'ouvre
// ici (voir fileTypes.js).
//
// L'ENREGISTREMENT APPARTIENT À COMPANYOS
//
// La bibliothèque n'expose pas de crochet « Enregistrer » : son propre
// bouton télécharge le fichier sur la machine, ce qui le sortirait du
// produit. La barre de CompanyOS s'en charge donc elle-même, en lisant les
// octets par `ref.getContent()` — c'est la même règle que partout :
// tout fichier produit par une app atterrit dans le cloud.
// ─────────────────────────────────────────────────────────────────────────

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import store from "../../../reducers";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api, apiFetch } from "../../../api/client";
import { ensureRootFolder, saveToCloud } from "../../cloud";
import { modal } from "../../modalRequest";
import { notifier } from "../../notifications";
import { subscribeVisionneuse } from "../../openRequest";
import { Contenu, useChargement } from "../../chargement";
import { MIME_PPTX, MODELES_PRESENTATION, diaporamaVierge } from "./gabarit";
import "./presentation.scss";

export const manifest = {
  slug: "presentation",
  name: "Présentations",
  icon: "presentation",
  action: "PRESENTATIONAPP",
  Window: PresentationApp,
};

/// Dossier du cloud où vivent les présentations.
const DOSSIER = "Présentations";

/// Le moteur pèse lourd : il ne se télécharge qu'à l'ouverture d'un fichier.
const Editeur = React.lazy(() => import("./Editeur.jsx"));

const sansExtension = (nom = "") => nom.replace(/\.pptx$/i, "");

/// Le thème de l'OS, lu là où il est réellement posé : sur <body>.
const useThemeSombre = () => {
  const [sombre, setSombre] = useState(document.body.dataset.theme === "dark");
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setSombre(document.body.dataset.theme === "dark"),
    );
    obs.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return sombre;
};

function PresentationApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id || manifest.icon]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const sombre = useThemeSombre();

  const refEditeur = useRef(null);
  const minuteur = useRef(null);

  const [octets, setOctets] = useState(null);
  const [fichier, setFichier] = useState(null);
  const [titre, setTitre] = useState("Présentation");
  // Changer de document remonte l'éditeur : c'est le chemin de chargement
  // prévu par la bibliothèque, plus sûr qu'un rechargement en place.
  const [cle, setCle] = useState(0);

  const [modifie, setModifie] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  // L'étiquette d'état ne peut pas se déduire de « rien n'a changé » : un
  // enregistrement qui échoue ne change rien non plus, et l'écran
  // annonçait alors « Enregistré dans le cloud » à côté du message
  // d'erreur. On retient donc ce qui s'est réellement passé.
  const [echec, setEchec] = useState("");

  const [fichiers, setFichiers] = useState([]);
  const [voletReplie, setVoletReplie] = useState(false);

  // ---- Liste des présentations -------------------------------------------

  const charger = useCallback(async () => {
    const dossier = await ensureRootFolder(DOSSIER);
    const contenu = dossier ? await api.listFiles(dossier) : [];
    setFichiers(contenu.filter((n) => n.type === "FILE" && /\.pptx$/i.test(n.name)));
  }, []);
  const etat = useChargement(ouvert, charger);

  // ---- Ouverture ---------------------------------------------------------

  const telecharger = async (node) => {
    const reponse = await apiFetch(api.downloadUrl(node.id), {});
    if (!reponse.ok) throw new Error("Cette présentation n'a pas pu être téléchargée.");
    return new Uint8Array(await reponse.arrayBuffer());
  };

  const confirmerAbandon = async () =>
    !modifie ||
    modal.confirm({
      title: "Modifications non enregistrées",
      message: `« ${titre} » a été modifié depuis le dernier enregistrement.`,
      detail: "Continuer fera perdre ces modifications.",
      confirmLabel: "Continuer sans enregistrer",
      danger: true,
    });

  const monter = (contenu, node) => {
    setOctets(contenu);
    setFichier(node);
    setTitre(node ? sansExtension(node.name) : "Présentation");
    setModifie(false);
    setEchec("");
    setCle((c) => c + 1);
  };

  const ouvrirFichier = async (node) => {
    if (!(await confirmerAbandon())) return;
    try {
      monter(await telecharger(node), node);
    } catch (e) {
      modal.alert({ title: "Ouverture impossible", message: e.message, tone: "error" });
    }
  };

  /// Diaporama neuf — voir gabarit.js pour ce qu'il contient et pourquoi.
  const nouveau = async () => {
    if (!(await confirmerAbandon())) return;
    const choix = await modal.open({
      title: "Créer une présentation",
      render: ({ close }) => (
        <div className="pptModeles">
          <div className="pptModelesIntro">
            <b>Commencez avec une histoire, pas une page blanche.</b>
            <span>
              Chaque modèle contient une structure narrative, des notes du présentateur et
              des données faciles à remplacer.
            </span>
          </div>
          <div className="pptModelesGrille">
            {MODELES_PRESENTATION.map((modele) => (
              <button
                type="button"
                className="pptModele"
                key={modele.id}
                style={{ "--ppt-modele-accent": modele.accent }}
                onClick={() => close(modele.id)}
              >
                <span className={`pptModeleApercu pptModeleApercu--${modele.id}`}>
                  <i />
                  <i />
                  <i />
                </span>
                <span className="pptModeleTexte">
                  <b>{modele.nom}</b>
                  <span>{modele.description}</span>
                  <small>
                    {modele.slides} diapositive{modele.slides > 1 ? "s" : ""}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </div>
      ),
    });
    if (!choix) return;
    try {
      monter(await diaporamaVierge(choix), null);
    } catch (e) {
      modal.alert({ title: "Création impossible", message: e.message, tone: "error" });
    }
  };

  // Fichier ouvert depuis l'Explorateur (double-clic sur un .pptx).
  //
  // L'abonnement se pose une fois, mais doit appeler la version *courante*
  // d'`ouvrirFichier` : celle du premier rendu croit que rien n'est
  // modifié et sauterait la confirmation d'abandon.
  const ouvrirFichierRef = useRef(ouvrirFichier);
  ouvrirFichierRef.current = ouvrirFichier;
  useEffect(
    () =>
      subscribeVisionneuse(manifest.action, (charge) => {
        if (charge?.node) ouvrirFichierRef.current(charge.node);
      }),
    [],
  );

  // ---- Enregistrement ----------------------------------------------------

  const enregistrer = useCallback(
    async ({ silencieux = false } = {}) => {
      if (enregistrement) return;
      const tampon = await refEditeur.current?.getContent();
      if (!tampon) return;

      let nom = null;
      if (!fichier) {
        if (silencieux) return; // pas de dialogue surprise pendant la frappe
        nom = await modal.prompt({
          title: "Enregistrer la présentation",
          label: "Nom du fichier",
          value: titre,
          confirmLabel: "Enregistrer",
        });
        if (!nom) return;
      }

      setEnregistrement(true);
      try {
        const contenu = new File(
          [tampon],
          `${(nom || titre).replace(/[\\/:*?"<>|]/g, "")}.pptx`,
          { type: MIME_PPTX },
        );

        if (fichier) {
          const maj = await api.updateFileContent(fichier.id, contenu, fichier.updatedAt);
          setFichier(maj);
          store.dispatch({ type: "CLOUD_TOUCH" });
          if (!silencieux) {
            notifier({
              titre: "Présentation enregistrée",
              message: `« ${titre} » est à jour dans le cloud.`,
              app: "Présentations",
              ton: "success",
            });
          }
        } else {
          // `saveToCloud` numérote si le nom est déjà pris, et signale
          // lui-même l'écriture.
          const node = await saveToCloud(contenu, contenu.name, { folder: DOSSIER });
          setFichier(node);
          setTitre(sansExtension(node.name));
          await etat.rafraichir();
        }
        setModifie(false);
        setEchec("");
      } catch (e) {
        setEchec(e.message);
        modal.alert({
          title: "Enregistrement impossible",
          message: e.message,
          tone: "error",
        });
      } finally {
        setEnregistrement(false);
      }
    },
    [fichier, titre, enregistrement, etat],
  );

  // La version la plus récente d'`enregistrer`, pour le minuteur et les
  // rappels posés une seule fois : un délai armé avant un rendu ne doit
  // pas enregistrer sous un vieux titre.
  const enregistrerRef = useRef(enregistrer);
  enregistrerRef.current = enregistrer;

  /// L'éditeur signale ses modifications par `onDirtyChange`. On en profite
  /// pour armer un enregistrement différé — mais seulement sur un fichier
  /// déjà nommé, sinon un dialogue surgirait en pleine frappe.
  const surModification = useCallback((sale) => {
    setModifie(sale);
    clearTimeout(minuteur.current);
    if (sale) {
      minuteur.current = setTimeout(() => {
        enregistrerRef.current({ silencieux: true });
      }, 4000);
    }
  }, []);

  useEffect(() => () => clearTimeout(minuteur.current), []);

  // Une présentation encore sale ne doit pas disparaître lors d'un
  // rechargement, d'une fermeture d'onglet ou d'un crash du shell.
  useEffect(() => {
    if (!modifie) return undefined;
    const proteger = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", proteger);
    return () => window.removeEventListener("beforeunload", proteger);
  }, [modifie]);

  const renommer = async (nouveau) => {
    const propre = nouveau.trim().replace(/[\\/:*?"<>|]/g, "");
    if (!propre || propre === titre) return;
    setTitre(propre);
    if (fichier) {
      try {
        const maj = await api.renameNode(fichier.id, `${propre}.pptx`);
        setFichier(maj);
        await etat.rafraichir();
      } catch (e) {
        modal.alert({ title: "Renommage impossible", message: e.message, tone: "error" });
      }
    }
  };

  const supprimer = async (node) => {
    const ok = await modal.confirm({
      title: "Mettre à la corbeille",
      message: `« ${node.name} » partira à la corbeille du cloud.`,
      detail: "Restaurable pendant 30 jours depuis l'Explorateur.",
      confirmLabel: "Mettre à la corbeille",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteNode(node.id);
      store.dispatch({ type: "CLOUD_TOUCH" });
      if (fichier?.id === node.id) {
        setOctets(null);
        setFichier(null);
        setModifie(false);
      }
      await etat.rafraichir();
    } catch (e) {
      modal.alert({ title: "Suppression impossible", message: e.message, tone: "error" });
    }
  };

  // Ctrl+S — l'habitude est plus forte que n'importe quel bouton.
  useEffect(() => {
    if (!ouvert) return undefined;
    const surTouche = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        enregistrerRef.current();
      }
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [ouvert]);

  // ---- Rendu -------------------------------------------------------------

  return (
    <ModuleWindow manifest={manifest} className="pptApp">
      {session.status !== "authenticated" ? (
        <div className="pptVerrou">Connectez-vous pour créer vos présentations.</div>
      ) : (
        <div className="pptShell">
          {/* Volet : les présentations de l'espace de travail */}
          <div className="pptVolet" data-replie={voletReplie}>
            <div className="pptVoletBarre">
              <div className="pptVoletTitre">Présentations</div>
              <div className="pptVoletActions">
                <div
                  className="pptOutil handcr"
                  title="Nouvelle présentation"
                  onClick={nouveau}
                >
                  <Icon fafa="faFileCirclePlus" width={13} />
                </div>
                <div
                  className="pptOutil handcr"
                  title="Replier le volet"
                  onClick={() => setVoletReplie(true)}
                >
                  <Icon fafa="faAnglesLeft" width={12} />
                </div>
              </div>
            </div>

            <div className="pptVoletCorps cosScroll">
              <Contenu
                etat={etat}
                vide={!fichiers.length}
                lignes={6}
                rendreVide={() => (
                  <div className="pptVoletVide">
                    Aucune présentation. Créez-en une — elle vivra dans le dossier{" "}
                    {DOSSIER} du cloud, visible de toute l'équipe.
                  </div>
                )}
              >
                {fichiers.map((node) => (
                  <div
                    key={node.id}
                    className="pptDoc handcr"
                    data-actif={fichier?.id === node.id}
                    onClick={() => ouvrirFichier(node)}
                  >
                    <Icon fafa="faRectangleList" width={13} />
                    <span className="pptDocNom">{sansExtension(node.name)}</span>
                    <span
                      className="pptDocPoubelle"
                      title="Mettre à la corbeille"
                      onClick={(e) => {
                        e.stopPropagation();
                        supprimer(node);
                      }}
                    >
                      <Icon fafa="faTrashCan" width={11} />
                    </span>
                  </div>
                ))}
              </Contenu>
            </div>
          </div>

          {voletReplie ? (
            <div
              className="pptVoletPoignee handcr"
              title="Afficher les présentations"
              onClick={() => setVoletReplie(false)}
            >
              <Icon fafa="faAnglesRight" width={12} />
            </div>
          ) : null}

          <div className="pptScene">
            {octets ? (
              <>
                {/* La barre du document appartient à CompanyOS : titre
                    renommable, état d'enregistrement, et le bouton
                    Enregistrer — la bibliothèque n'en propose pas qui
                    écrive ailleurs que sur la machine. */}
                <div className="pptBarreDoc">
                  <span className="pptBarreMarque">
                    <Icon fafa="faRectangleList" width={13} />
                    <b>SLIDES</b>
                  </span>
                  <input
                    className="pptTitreDoc"
                    value={titre}
                    onChange={(e) => setTitre(e.target.value)}
                    onBlur={(e) => renommer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.target.blur();
                    }}
                  />
                  <span
                    className="pptEtatDoc"
                    data-modifie={modifie}
                    data-echec={!!echec}
                    title={echec || undefined}
                  >
                    {enregistrement
                      ? "Enregistrement…"
                      : echec
                        ? "Non enregistré"
                        : modifie
                          ? "Modifié"
                          : fichier
                            ? "Enregistré dans le cloud"
                            : "Jamais enregistrée"}
                  </span>
                  <span className="pptCompatibilite" title="Format PowerPoint natif">
                    PPTX
                  </span>
                  <div
                    className="pptEnregistrer handcr"
                    data-inactif={enregistrement}
                    onClick={() => enregistrerRef.current()}
                  >
                    <Icon fafa="faCloudArrowUp" width={12} />
                    <span>Enregistrer</span>
                  </div>
                </div>

                <Suspense
                  fallback={
                    <div className="pptPatiente">
                      <Icon fafa="faRectangleList" width={26} />
                      <p>Chargement de l'éditeur…</p>
                    </div>
                  }
                >
                  <Editeur
                    key={cle}
                    ref={refEditeur}
                    octets={octets}
                    nom={`${titre}.pptx`}
                    sombre={sombre}
                    auteur={session.user?.name}
                    surOuverture={() => setVoletReplie(false)}
                    surModification={surModification}
                  />
                </Suspense>
              </>
            ) : (
              <div className="pptAccueil">
                <Icon className="pptAccueilIcone" src="presentation" width={56} />
                <div className="pptAccueilSurTitre">COMPANYOS</div>
                <div className="pptAccueilTitre">Slides</div>
                <p>
                  Des présentations convaincantes, compatibles PowerPoint et rangées dans
                  le cloud de l'entreprise. Partez d'une structure professionnelle,
                  adaptez-la et présentez-la en plein écran.
                </p>
                <div className="pptAccueilAtouts">
                  <span>Modèles professionnels</span>
                  <span>Transitions et animations</span>
                  <span>Notes du présentateur</span>
                </div>
                <div className="pptAccueilActions">
                  <div className="pptAccueilBtn handcr" onClick={nouveau}>
                    <Icon fafa="faFileCirclePlus" width={13} />
                    Créer une présentation
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </ModuleWindow>
  );
}

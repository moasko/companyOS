// Traitement de texte.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUI A CHANGÉ, ET POURQUOI
//
// La version précédente était une zone `contenteditable` pilotée par
// `document.execCommand`, avec un ruban imité de Word par-dessus. Trois
// impasses structurelles :
//
//   - `execCommand` est obsolète et chaque navigateur en fait autre
//     chose : un document rédigé sur Chrome n'avait pas le même balisage
//     que sur Firefox ;
//   - la « pagination » était une estimation — le texte coulait d'un seul
//     tenant, le compteur de pages divisait la hauteur ;
//   - l'export `.doc` était du HTML déguisé, que Word ouvre avec un
//     avertissement et ne réenregistre pas à l'identique.
//
// Le moteur est maintenant `@docx-editor.dev` : un éditeur OOXML complet
// qui peint de vraies pages, au format natif de Word, sans perte — ce
// qu'un document contient et que l'éditeur ne comprend pas est réécrit tel
// quel à l'enregistrement.
//
// LE DOCUMENT EST UN FICHIER
//
// Conséquence du format : un document n'est plus un enregistrement de
// module, c'est un fichier `.docx` dans le cloud de l'espace, dossier
// Documents. Il apparaît dans l'Explorateur, se partage, se met à la
// corbeille et compte dans le quota comme n'importe quel fichier — et un
// double-clic dessus dans l'Explorateur l'ouvre ici (voir fileTypes.js).
// Les documents de l'ancienne version, enregistrés en HTML dans la
// collection « documents », sont convertis à l'ouverture (voir
// heritage.js) puis continuent leur vie en `.docx`.
// ─────────────────────────────────────────────────────────────────────────

import React, {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
import { MIME_DOCX, documentVierge } from "./gabarit";
import "./word.scss";
import { echapperHtml } from "../../../utils/securite.js";

export const manifest = {
  slug: "word",
  name: "Traitement de texte",
  icon: "winWord",
  action: "WORDAPP",
  Window: WordApp,
};

/// Dossier du cloud où vivent les documents.
const DOSSIER = "Documents";

/// L'éditeur pèse lourd (moteur OOXML + mise en forme WebAssembly) : il ne
/// se télécharge qu'à l'ouverture de la fenêtre, comme three.js pour la 3D.
const Editeur = React.lazy(() => import("./Editeur.jsx"));

const sansExtension = (nom = "") => nom.replace(/\.docx$/i, "");

/// Le thème de l'OS, lu là où il est réellement posé : sur <body>. Le
/// suivre par le store imposerait de connaître la forme du réducteur des
/// réglages ; l'attribut, lui, est le contrat public.
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

function WordApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id || manifest.icon]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const sombre = useThemeSombre();

  const refEditeur = useRef(null);
  const minuteur = useRef(null);
  const refImport = useRef(null);

  // Le document ouvert : ses octets, et le fichier du cloud d'où il vient.
  // `fichier` est null pour un document neuf jamais enregistré.
  const [octets, setOctets] = useState(null);
  const [fichier, setFichier] = useState(null);
  const [titre, setTitre] = useState("Document");
  // Clé de montage : changer de document remonte l'éditeur — c'est le
  // chemin de chargement prévu par la bibliothèque, plus simple et plus
  // sûr que de recharger en place.
  const [cle, setCle] = useState(0);

  const [modifie, setModifie] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  // L'étiquette d'état ne peut pas se déduire de « rien n'a changé » : un
  // enregistrement qui échoue ne change rien non plus, et l'écran
  // annonçait alors « Enregistré dans le cloud » à côté du message
  // d'erreur. On retient donc ce qui s'est réellement passé.
  const [echec, setEchec] = useState("");

  const [fichiers, setFichiers] = useState([]);
  const [heritage, setHeritage] = useState([]);
  // Le volet des documents est un panneau superposé, ouvert depuis
  // Fichier → Documents : l'accueil liste déjà les récents.
  const [voletReplie, setVoletReplie] = useState(true);

  // ---- Liste des documents ----------------------------------------------

  const charger = useCallback(async () => {
    const dossier = await ensureRootFolder(DOSSIER);
    const contenu = dossier ? await api.listFiles(dossier) : [];
    setFichiers(
      contenu.filter((n) => n.type === "FILE" && /\.docx$/i.test(n.name)),
    );
    // Les documents de l'ancienne version, tant qu'il en reste.
    setHeritage(await api.records.list(manifest.slug, "documents").catch(() => []));
  }, []);
  const etat = useChargement(ouvert, charger);

  // ---- Ouverture ---------------------------------------------------------

  const telecharger = async (node) => {
    const reponse = await apiFetch(api.downloadUrl(node.id), {});
    if (!reponse.ok) throw new Error("Ce document n'a pas pu être téléchargé.");
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
    setTitre(node ? sansExtension(node.name) : "Document");
    setModifie(false);
    setEchec("");
    setVoletReplie(true);
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

  const nouveau = async () => {
    if (!(await confirmerAbandon())) return;
    monter(documentVierge(), null);
  };

  const importerLocal = async (event) => {
    const local = event.target.files?.[0];
    event.target.value = "";
    if (!local) return;
    if (!/\.docx$/i.test(local.name)) {
      modal.alert({ title: "Format non pris en charge", message: "Choisissez un fichier Word au format .docx.", tone: "error" });
      return;
    }
    if (local.size > 50 * 1024 * 1024) {
      modal.alert({ title: "Document trop volumineux", message: "La taille maximale d’ouverture est de 50 Mo.", tone: "error" });
      return;
    }
    if (!(await confirmerAbandon())) return;
    try {
      const contenu = new Uint8Array(await local.arrayBuffer());
      setOctets(contenu);
      setFichier(null);
      setTitre(sansExtension(local.name) || "Document");
      setModifie(false);
      setEchec("");
      setVoletReplie(true);
      setCle((c) => c + 1);
    } catch (e) {
      modal.alert({ title: "Ouverture impossible", message: e.message, tone: "error" });
    }
  };

  /// Un ancien document HTML : converti en `.docx`, posé dans le cloud,
  /// puis l'enregistrement d'origine est retiré — le document a déménagé,
  /// le garder en double ferait croire à deux documents distincts.
  const ouvrirHeritage = async (rec) => {
    if (!(await confirmerAbandon())) return;
    const ok = await modal.confirm({
      title: "Convertir ce document",
      message: `« ${rec.data.titre} » vient de l'ancienne version.`,
      detail:
        "Il sera converti au format Word (.docx) et rangé dans le dossier Documents du cloud. La mise en forme complexe peut différer légèrement.",
      confirmLabel: "Convertir et ouvrir",
    });
    if (!ok) return;

    try {
      const { convertirHeritage } = await import("./heritage.js");
      const blob = await convertirHeritage(rec.data.titre, rec.data.html);
      const nom = `${(rec.data.titre || "Document").replace(/[\\/:*?"<>|]/g, "")}.docx`;
      // `saveToCloud` numérote les doublons (« Document (2).docx ») et
      // signale déjà l'écriture — deux conversions du même brouillon ne
      // doivent pas échouer sur un nom déjà pris.
      const node = await saveToCloud(blob, nom, { folder: DOSSIER });
      await api.records.remove(manifest.slug, "documents", rec.id);
      await etat.rafraichir();
      monter(new Uint8Array(await blob.arrayBuffer()), node);
    } catch (e) {
      modal.alert({ title: "Conversion impossible", message: e.message, tone: "error" });
    }
  };

  // Fichier ouvert depuis l'Explorateur (double-clic sur un .docx).
  //
  // L'abonnement se pose une fois, mais il doit appeler la version
  // **courante** d'`ouvrirFichier` : celle du premier rendu croit que rien
  // n'est modifié et sauterait la confirmation d'abandon.
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

  /// Écrit le document dans le cloud. Premier enregistrement : demande un
  /// nom et crée le fichier ; ensuite : remplace le contenu en place, même
  /// identifiant, donc l'Explorateur et les liens ne bougent pas.
  const enregistrer = useCallback(
    async ({ silencieux = false } = {}) => {
      const tampon = await refEditeur.current?.save();
      if (!tampon || enregistrement) return;

      let nom = null;
      if (!fichier) {
        if (silencieux) return; // pas de dialogue surprise pendant une frappe
        nom = await modal.prompt({
          title: "Enregistrer le document",
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
          `${(nom || titre).replace(/[\\/:*?"<>|]/g, "")}.docx`,
          { type: MIME_DOCX },
        );

        if (fichier) {
          const maj = await api.updateFileContent(fichier.id, contenu, fichier.updatedAt);
          setFichier(maj);
          store.dispatch({ type: "CLOUD_TOUCH" });
          if (!silencieux) {
            notifier({
              titre: "Document enregistré",
              message: `« ${titre} » est à jour dans le cloud.`,
              app: "Traitement de texte",
              ton: "success",
            });
          }
        } else {
          // Premier enregistrement : `saveToCloud` numérote si le nom est
          // déjà pris, et signale lui-même l'écriture.
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

  /// À chaque modification : marquer, et programmer un enregistrement
  /// silencieux. Seulement pour un document déjà nommé — un document neuf
  /// ne déclenche jamais de dialogue tout seul.
  const surModification = useCallback(() => {
    setModifie(true);
    clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => {
      enregistrerRef.current({ silencieux: true });
    }, 3000);
  }, []);

  // La version la plus récente d'`enregistrer`, pour le minuteur : un
  // délai armé avant un rendu ne doit pas enregistrer avec un vieux titre.
  const enregistrerRef = useRef(enregistrer);
  enregistrerRef.current = enregistrer;

  useEffect(() => () => clearTimeout(minuteur.current), []);

  // Le navigateur ne doit jamais fermer silencieusement un brouillon.
  useEffect(() => {
    if (!modifie) return undefined;
    const proteger = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", proteger);
    return () => window.removeEventListener("beforeunload", proteger);
  }, [modifie]);

  const telechargerCopie = async () => {
    try {
      const tampon = await refEditeur.current?.save();
      if (!tampon) return;
      const url = URL.createObjectURL(new Blob([tampon], { type: MIME_DOCX }));
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = `${titre.replace(/[\\/:*?"<>|]/g, "") || "Document"}.docx`;
      lien.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      modal.alert({ title: "Téléchargement impossible", message: e.message, tone: "error" });
    }
  };

  /// Renommage depuis la barre de titre de l'éditeur.
  const surTitre = async (nouveau) => {
    const propre = nouveau.trim().replace(/[\\/:*?"<>|]/g, "");
    if (!propre) return;
    setTitre(propre);
    if (fichier) {
      try {
        const maj = await api.renameNode(fichier.id, `${propre}.docx`);
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

  /// Imprimer les pages, et elles seules.
  ///
  /// `window.print()` imprimerait l'OS entier — bureau, barre des tâches,
  /// ruban. Les pages déjà mises en forme par le moteur sont recopiées dans
  /// un cadre invisible, avec les feuilles de style de la page, et c'est ce
  /// cadre qu'on imprime : une feuille par page, sans marge ajoutée.
  const imprimer = () => {
    const pages = document.querySelector(".wordApp .docx-pages");
    if (!pages) return;
    const cadre = document.createElement("iframe");
    cadre.setAttribute("aria-hidden", "true");
    Object.assign(cadre.style, { position: "fixed", width: "0", height: "0", border: "0" });
    document.body.appendChild(cadre);
    const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')]
      .map((n) => n.outerHTML)
      .join("");
    const doc = cadre.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${echapperHtml(titre)}</title>${styles}
      <style>
        @page { margin: 0; }
        html, body { margin: 0; background: #fff; }
        .docx-pages { display: block !important; transform: none !important; }
        .docx-page { margin: 0 !important; box-shadow: none !important; break-after: page; filter: none !important; background: #fff !important; }
        .docx-page-content { filter: none !important; }
        .docx-selection-overlay, .docx-comment-overlay { display: none !important; }
      </style></head><body class="docx-editor">${pages.outerHTML}</body></html>`);
    doc.close();
    // Laisser les polices et les images se charger avant d'imprimer.
    setTimeout(() => {
      cadre.contentWindow.focus();
      cadre.contentWindow.print();
      setTimeout(() => cadre.remove(), 1000);
    }, 400);
  };

  // Ctrl+S — l'habitude est plus forte que n'importe quel bouton.
  useEffect(() => {
    if (!ouvert) return undefined;
    const surTouche = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const touche = e.key.toLowerCase();
      if (touche === "s") {
        e.preventDefault();
        enregistrerRef.current();
      } else if (touche === "p" && octetsRef.current) {
        e.preventDefault();
        imprimerRef.current();
      }
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [ouvert]);

  const imprimerRef = useRef(imprimer);
  imprimerRef.current = imprimer;
  const octetsRef = useRef(octets);
  octetsRef.current = octets;

  // ---- Rendu -------------------------------------------------------------

  /// L'état d'enregistrement, en un mot et une couleur — à côté du titre,
  /// comme « Enregistré » dans Word.
  const etatDoc = enregistrement
    ? { texte: "Enregistrement…", ton: "neutre" }
    : echec
      ? { texte: "Non enregistré", ton: "echec", detail: echec }
      : modifie
        ? { texte: fichier ? "Modifications non enregistrées" : "Non enregistré", ton: "modifie" }
        : fichier
          ? { texte: "Enregistré", ton: "ok", detail: "Enregistré dans le cloud, dossier Documents" }
          : { texte: "Nouveau document", ton: "neutre" };

  const actionsDoc = {
    nouveau,
    ouvrir: () => refImport.current?.click(),
    documents: () => setVoletReplie(false),
    enregistrer: () => enregistrerRef.current(),
    telecharger: telechargerCopie,
    imprimer,
  };

  /// Les documents du plus récent au plus ancien — l'ordre des « Récents »
  /// de Word.
  const recents = [...fichiers].sort(
    (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0),
  );
  const quandModifie = (iso) =>
    iso
      ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })
      : "";

  return (
    <ModuleWindow manifest={manifest} className="wordApp">
      {session.status !== "authenticated" ? (
        <div className="wdVerrou">Connectez-vous pour rédiger vos documents.</div>
      ) : (
        <div className="wdShell">
          {/* Volet : les documents de l'espace de travail */}
          <div className="wdVolet" data-replie={voletReplie}>
            <div className="wdVoletBarre">
              <div className="wdVoletTitre">Documents</div>
              <div className="wdVoletActions">
                <div className="wdOutil handcr" title="Nouveau document" onClick={nouveau}>
                  <Icon fafa="faFileCirclePlus" width={13} />
                </div>
                <div
                  className="wdOutil handcr"
                  title="Replier le volet"
                  onClick={() => setVoletReplie(true)}
                >
                  <Icon fafa="faAnglesLeft" width={12} />
                </div>
              </div>
            </div>

            <div className="wdVoletCorps cosScroll">
              <Contenu etat={etat} vide={!fichiers.length && !heritage.length} lignes={6}
                rendreVide={() => (
                  <div className="wdVoletVide">
                    Aucun document. Créez-en un — il vivra dans le dossier{" "}
                    {DOSSIER} du cloud, visible de toute l'équipe.
                  </div>
                )}
              >
                {fichiers.map((node) => (
                  <div
                    key={node.id}
                    className="wdDoc handcr"
                    data-actif={fichier?.id === node.id}
                    onClick={() => ouvrirFichier(node)}
                  >
                    <Icon fafa="faFileWord" width={13} />
                    <span className="wdDocNom">{sansExtension(node.name)}</span>
                    <span
                      className="wdDocPoubelle"
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

                {heritage.length ? (
                  <>
                    <div className="wdVoletSection">
                      Anciens documents — à convertir
                    </div>
                    {heritage.map((rec) => (
                      <div
                        key={rec.id}
                        className="wdDoc wdDocHeritage handcr"
                        title="Document de l'ancienne version, encore en HTML"
                        onClick={() => ouvrirHeritage(rec)}
                      >
                        <Icon fafa="faClockRotateLeft" width={12} />
                        <span className="wdDocNom">{rec.data.titre}</span>
                      </div>
                    ))}
                  </>
                ) : null}
              </Contenu>
            </div>
          </div>

          {/* L'éditeur, ou l'accueil quand rien n'est ouvert */}
          {/* Un clic dans le document referme le tiroir des documents. */}
          <div
            className="wdScene"
            onMouseDown={() => {
              if (!voletReplie) setVoletReplie(true);
            }}
          >
            <input ref={refImport} className="wdImportCache" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={importerLocal} />
            {octets ? (
              <Suspense
                fallback={
                  <div className="wdPatiente">
                    <Icon fafa="faFileWord" width={26} />
                    <p>Chargement de l'éditeur…</p>
                  </div>
                }
              >
                <Editeur
                  key={cle}
                  ref={refEditeur}
                  octets={octets}
                  sombre={sombre}
                  document={{
                    titre,
                    setTitre,
                    surTitre,
                    etat: etatDoc,
                    enregistrement,
                  }}
                  actions={actionsDoc}
                  surModification={surModification}
                  surErreur={(message) => setEchec(message)}
                />
              </Suspense>
            ) : (
              // L'accueil de Word : créer, ouvrir, et reprendre un document
              // récent — sans passer par le volet.
              <div className="wdAccueil cosScroll">
                <div className="wdAccueilCorps">
                  <h2>Bonjour{session.user?.name ? `, ${session.user.name.split(" ")[0]}` : ""}</h2>

                  <div className="wdAccueilNouveau">
                    <button type="button" className="wdTuile" onClick={nouveau}>
                      <span className="wdTuileFeuille">
                        <Icon fafa="faPlus" width={18} />
                      </span>
                      <span>Document vierge</span>
                    </button>
                    <button
                      type="button"
                      className="wdTuile"
                      onClick={() => refImport.current?.click()}
                    >
                      <span className="wdTuileFeuille wdTuileOuvrir">
                        <Icon fafa="faFolderOpen" width={18} />
                      </span>
                      <span>Ouvrir un fichier .docx</span>
                    </button>
                  </div>

                  <div className="wdAccueilSection">Récents</div>
                  <Contenu
                    etat={etat}
                    vide={!recents.length && !heritage.length}
                    lignes={4}
                    rendreVide={() => (
                      <p className="wdAccueilVide">
                        Aucun document pour l'instant. Ce que vous créez ici est rangé dans
                        le dossier {DOSSIER} du cloud, visible de toute l'équipe, et se rouvre
                        dans Word sans avertissement.
                      </p>
                    )}
                  >
                    <div className="wdRecents" role="list">
                      {recents.map((node) => (
                        <div key={node.id} role="listitem" className="wdRecent">
                          <button
                            type="button"
                            className="wdRecentOuvrir"
                            onClick={() => ouvrirFichier(node)}
                          >
                            <Icon fafa="faFileWord" width={15} />
                            <span className="wdRecentNom">{sansExtension(node.name)}</span>
                            <span className="wdRecentDate">{quandModifie(node.updatedAt)}</span>
                          </button>
                          <button
                            type="button"
                            className="wdRecentSuppr"
                            title="Mettre à la corbeille"
                            aria-label={`Mettre « ${node.name} » à la corbeille`}
                            onClick={() => supprimer(node)}
                          >
                            <Icon fafa="faTrashCan" width={11} />
                          </button>
                        </div>
                      ))}
                      {heritage.map((rec) => (
                        <div key={rec.id} role="listitem" className="wdRecent">
                          <button
                            type="button"
                            className="wdRecentOuvrir"
                            title="Document de l'ancienne version, à convertir"
                            onClick={() => ouvrirHeritage(rec)}
                          >
                            <Icon fafa="faClockRotateLeft" width={14} />
                            <span className="wdRecentNom">{rec.data.titre}</span>
                            <span className="wdRecentDate">à convertir</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </Contenu>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </ModuleWindow>
  );
}

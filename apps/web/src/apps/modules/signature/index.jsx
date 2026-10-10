// Signature.
//
// ─────────────────────────────────────────────────────────────────────────
// TROIS GESTES
//
//   1. **Dessiner** sa signature au pointeur — souris, stylet ou doigt —
//      et la garder dans la bibliothèque de l'espace.
//   2. **Retrouver** les signatures enregistrées, en PNG dans le cloud.
//   3. **Signer un document** : poser une signature sur un PDF du cloud
//      et enregistrer la copie signée. L'original n'est jamais touché.
//
// On stocke les traits, pas l'image (voir domaine.js) : la signature se
// régénère nette à toute taille. Le PDF signé est recomposé page par page
// à partir du rendu — le moteur de lecture est celui du module PDF.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { saveAs, saveToCloud } from "../../cloud";
import { Contenu, useChargement } from "../../chargement";
import { Bouton, Chips, Vide } from "../../ui";
import * as D from "./domaine";
import "./signature.scss";
import { manifest as descriptif } from "./manifest";

export const manifest = { ...descriptif, Window: SignatureApp };

const VUES = [
  { id: "dessiner", label: "Dessiner", icone: "faPenNib" },
  { id: "bibliotheque", label: "Mes signatures", icone: "faSignature" },
  { id: "documents", label: "Signer un document", icone: "faFileSignature" },
];

/// PNG net d'une signature : le SVG est rejoué à trois fois sa taille.
const svgVersPng = (svg, largeur, hauteur, echelle = 3) =>
  new Promise((resoudre, rejeter) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = largeur * echelle;
      c.height = hauteur * echelle;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resoudre(b) : rejeter(new Error("Export impossible"))), "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rejeter(new Error("Export impossible"));
    };
    img.src = url;
  });

const apercuDe = (record) => D.imageSignature(record.data);

function SignatureApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";

  const [vue, setVue] = useState("dessiner");
  const [signatures, setSignatures] = useState([]);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    setSignatures(await api.records.list(manifest.slug, "signatures"));
  }, []);
  const etat = useChargement(ouvert, charger);

  // ---- Enregistrement d'un dessin ----------------------------------------

  const enregistrer = async (traits, encre, epaisseur) => {
    if (D.tropCourte(traits)) {
      return modal.alert({
        title: "Signature trop courte",
        message: "Dessinez votre signature complète avant d'enregistrer.",
      });
    }
    const nom = await modal.prompt({
      title: "Enregistrer la signature",
      label: "À qui appartient-elle ?",
      placeholder: session.user?.name || "Nom du signataire",
      confirmLabel: "Enregistrer",
    });
    if (!nom) return;

    setOccupe(true);
    try {
      const { traits: recadres, largeur, hauteur } = D.recadrer(traits);
      const svg = D.svgDe(recadres, largeur, hauteur, {
        couleur: D.couleurEncre(encre),
        epaisseur,
      });
      // Le PNG part au cloud — visible dans l'Explorateur, utilisable
      // ailleurs — et les traits restent dans le module pour régénérer.
      await saveToCloud(await svgVersPng(svg, largeur, hauteur), D.nomFichier(nom), {
        folder: "Signatures",
      });
      await api.records.create(manifest.slug, "signatures", {
        nom: nom.trim(),
        traits: recadres,
        largeur,
        hauteur,
        encre,
        epaisseur,
      });
      await etat.rafraichir();
      setVue("bibliotheque");
    } catch (e) {
      modal.alert({ title: "Enregistrement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const supprimer = async (record) => {
    const ok = await modal.confirm({
      title: "Supprimer cette signature ?",
      message: `La signature de ${record.data.nom} sera retirée de la bibliothèque.`,
      detail: "Le fichier PNG déjà exporté dans le cloud, lui, reste en place.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    await api.records.remove(manifest.slug, "signatures", record.id);
    await etat.rafraichir();
  };

  // ---- Rendu --------------------------------------------------------------

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="sigApp">
        <div className="sigVerrou">Connectez-vous pour gérer vos signatures.</div>
      </ModuleWindow>
    );
  }

  return (
    <ModuleWindow manifest={manifest} className="sigApp">
      <div className="sigShell">
        <nav className="sigNav">
          {VUES.map((v) => (
            <div
              key={v.id}
              className="sigOnglet handcr"
              data-actif={vue === v.id}
              onClick={() => setVue(v.id)}
            >
              <Icon fafa={v.icone} width={13} />
              <span>{v.label}</span>
            </div>
          ))}
        </nav>

        <div className="sigCentre">
          {vue === "dessiner" ? (
            <Pad occupe={occupe} onEnregistrer={enregistrer} />
          ) : vue === "bibliotheque" ? (
            <Bibliotheque
              etat={etat}
              signatures={signatures}
              onSupprimer={supprimer}
              onDessiner={() => setVue("dessiner")}
              onUtiliser={() => setVue("documents")}
            />
          ) : (
            <Documents signatures={signatures} />
          )}
        </div>
      </div>
    </ModuleWindow>
  );
}

// ---------------------------------------------------------------------------
// Le pad de dessin
// ---------------------------------------------------------------------------

const Pad = ({ occupe, onEnregistrer }) => {
  const [traits, setTraits] = useState([]);
  const [encre, setEncre] = useState("noir");
  const [epaisseur, setEpaisseur] = useState(2.5);
  const zone = useRef(null);
  const enCours = useRef(null); // trait en cours, hors état pour la fluidité
  const [, forcer] = useState(0);

  const pointDe = (e) => {
    const r = zone.current.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - r.left) * 10) / 10,
      y: Math.round((e.clientY - r.top) * 10) / 10,
    };
  };

  const debut = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    zone.current.setPointerCapture?.(e.pointerId);
    enCours.current = [pointDe(e)];
    forcer((n) => n + 1);
  };

  const mouvement = (e) => {
    if (!enCours.current) return;
    const p = pointDe(e);
    const dernier = enCours.current[enCours.current.length - 1];
    // On n'ajoute un point qu'après un vrai déplacement : le lissage fait
    // le reste, et les données restent légères.
    if (Math.abs(p.x - dernier.x) + Math.abs(p.y - dernier.y) < 1.5) return;
    enCours.current.push(p);
    forcer((n) => n + 1);
  };

  const fin = () => {
    if (!enCours.current) return;
    const trait = enCours.current;
    enCours.current = null;
    setTraits((t) => [...t, trait]);
  };

  const tous = enCours.current ? [...traits, enCours.current] : traits;
  const couleur = D.couleurEncre(encre);

  return (
    <div className="sigDessin">
      <div className="sigOutils">
        <Chips
          options={D.ENCRES.map((e) => ({ id: e.id, label: e.label }))}
          valeur={encre}
          onChoisir={setEncre}
        />
        <label className="sigEpaisseur">
          Plume
          <input
            type="range"
            min="1.5"
            max="4.5"
            step="0.5"
            value={epaisseur}
            onChange={(e) => setEpaisseur(Number(e.target.value))}
          />
        </label>
      </div>

      <div
        ref={zone}
        className="sigPad"
        onPointerDown={debut}
        onPointerMove={mouvement}
        onPointerUp={fin}
        onPointerLeave={fin}
      >
        <svg className="sigTraits">
          {tous.map((t, i) => (
            <path
              key={i}
              d={D.cheminDe(t)}
              fill="none"
              stroke={couleur}
              strokeWidth={epaisseur}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
        {!tous.length ? (
          <div className="sigConsigne">
            Signez ici, à la souris, au stylet ou au doigt
          </div>
        ) : null}
        <div className="sigLigne" />
      </div>

      <div className="sigActions">
        <Bouton
          variante="secondaire"
          icone="faRotateLeft"
          off={!traits.length}
          onClick={() => setTraits((t) => t.slice(0, -1))}
        >
          Annuler le trait
        </Bouton>
        <Bouton
          variante="secondaire"
          icone="faEraser"
          off={!traits.length}
          onClick={() => setTraits([])}
        >
          Tout effacer
        </Bouton>
        <Bouton
          icone="faFloppyDisk"
          off={occupe || !traits.length}
          onClick={() => onEnregistrer(traits, encre, epaisseur)}
        >
          Enregistrer la signature
        </Bouton>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// La bibliothèque
// ---------------------------------------------------------------------------

const Bibliotheque = ({ etat, signatures, onSupprimer, onDessiner, onUtiliser }) => (
  <div className="sigBiblio cosScroll">
    <Contenu
      etat={etat}
      vide={!signatures.length}
      lignes={3}
      rendreVide={() => (
        <Vide
          icone="faSignature"
          titre="Aucune signature"
          aide="Dessinez votre première signature : elle restera sous la main pour signer devis, contrats et bons de livraison."
        >
          <Bouton icone="faPenNib" onClick={onDessiner}>
            Dessiner ma signature
          </Bouton>
        </Vide>
      )}
    >
      <div className="sigGrille">
        {signatures.map((s) => (
          <div key={s.id} className="sigCarte">
            <div className="sigApercu">
              <img src={apercuDe(s)} alt={`Signature de ${s.data.nom}`} />
            </div>
            <div className="sigCarteBas">
              <span className="sigCarteNom">{s.data.nom}</span>
              <div className="sigCarteActions">
                <span title="Signer un document" onClick={onUtiliser}>
                  <Icon fafa="faFileSignature" width={12} />
                </span>
                <span title="Supprimer" onClick={() => onSupprimer(s)}>
                  <Icon fafa="faTrashCan" width={12} />
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Contenu>
  </div>
);

// ---------------------------------------------------------------------------
// Signer un document PDF du cloud
// ---------------------------------------------------------------------------

/// Ramasse les PDF du cloud, dossiers compris (trois niveaux : au-delà,
/// c'est que le classement a un problème que cette app ne réglera pas).
const listerPdf = async () => {
  const trouves = [];
  const parcourir = async (parentId, profondeur, chemin) => {
    const noeuds = await api.listFiles(parentId).catch(() => []);
    for (const n of noeuds) {
      if (n.type === "FILE" && /\.pdf$/i.test(n.name)) {
        trouves.push({ ...n, chemin });
      } else if (n.type === "FOLDER" && profondeur < 3) {
        await parcourir(n.id, profondeur + 1, chemin ? `${chemin} / ${n.name}` : n.name);
      }
    }
  };
  await parcourir(null, 0, "");
  return trouves;
};

const Documents = ({ signatures }) => {
  const [pdfs, setPdfs] = useState(null); // null = pas encore listés
  const [doc, setDoc] = useState(null); // { node, pdf, pages: [{largeur, hauteur}] }
  const [choix, setChoix] = useState(signatures[0]?.id || null);
  const [largeurPct, setLargeurPct] = useState(22); // largeur de la signature, en % de page
  const [poses, setPoses] = useState([]); // { page, xr, yr } en ratios de page
  const [occupe, setOccupe] = useState(false);
  const conteneur = useRef(null);
  const canvases = useRef({});

  const signature = signatures.find((s) => s.id === choix) || signatures[0] || null;

  React.useEffect(() => {
    if (pdfs === null) listerPdf().then(setPdfs);
  }, [pdfs]);

  const ouvrir = async (node) => {
    setOccupe(true);
    try {
      // Le moteur PDF (pdf.js) ne se charge qu'ici : inutile d'alourdir
      // l'ouverture de l'OS pour ceux qui ne signent pas de documents.
      const { ouvrirDocument } = await import("../pdf/moteur");
      const url = await api.streamUrl(node.id);
      const pdf = await ouvrirDocument(url);
      // Un contrat se signe sur des pages précises ; au-delà de vingt on
      // rend tout de même, page à page.
      const pages = [];
      for (let n = 1; n <= pdf.numPages; n += 1) {
        const page = await pdf.getPage(n);
        const vue = page.getViewport({ scale: 1 });
        pages.push({ largeur: vue.width, hauteur: vue.height });
      }
      setDoc({ node, pdf, pages });
      setPoses([]);
      // Le rendu des canvas suit le montage du DOM.
      setTimeout(() => rendre(pdf, pages), 30);
    } catch (e) {
      modal.alert({ title: "Ouverture impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const rendre = async (pdf, pages) => {
    const largeurCadre = (conteneur.current?.clientWidth || 700) - 32;
    for (let n = 1; n <= pages.length; n += 1) {
      const canvas = canvases.current[n];
      if (!canvas) continue;
      const echelle = Math.min(largeurCadre / pages[n - 1].largeur, 1.6);
      const page = await pdf.getPage(n);
      const vue = page.getViewport({ scale: echelle });
      const densite = window.devicePixelRatio || 1;
      canvas.width = Math.floor(vue.width * densite);
      canvas.height = Math.floor(vue.height * densite);
      canvas.style.width = `${Math.floor(vue.width)}px`;
      canvas.style.height = `${Math.floor(vue.height)}px`;
      await page.render({
        canvasContext: canvas.getContext("2d"),
        viewport: vue,
        transform: densite !== 1 ? [densite, 0, 0, densite, 0, 0] : null,
      }).promise;
    }
  };

  /// Un clic sur une page pose la signature, centrée sous le pointeur.
  const poser = (numero) => (e) => {
    if (!signature) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPoses((p) => [
      ...p,
      {
        id: `${Date.now()}-${p.length}`,
        page: numero,
        xr: (e.clientX - r.left) / r.width,
        yr: (e.clientY - r.top) / r.height,
      },
    ]);
  };

  const glisser = (pose) => (e) => {
    e.stopPropagation();
    const surface = e.currentTarget.closest(".sigPage");
    const r = surface.getBoundingClientRect();
    const move = (ev) => {
      setPoses((p) =>
        p.map((x) =>
          x.id === pose.id
            ? { ...x, xr: (ev.clientX - r.left) / r.width, yr: (ev.clientY - r.top) / r.height }
            : x,
        ),
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /// Recompose le PDF signé : chaque page est rendue en haute définition,
  /// la signature dessinée dessus, et le tout réassemblé. L'original du
  /// cloud n'est pas modifié — on enregistre une copie « -signé ».
  const signer = async () => {
    if (!doc || !poses.length || !signature) return;
    setOccupe(true);
    try {
      const { jsPDF } = await import("jspdf");
      const d = signature.data;
      const svg = D.svgDe(d.traits, d.largeur, d.hauteur, {
        couleur: D.couleurEncre(d.encre),
        epaisseur: d.epaisseur,
      });
      const imgSig = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
      });

      let pdfSortie = null;
      for (let n = 1; n <= doc.pages.length; n += 1) {
        const page = await doc.pdf.getPage(n);
        const vue = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = vue.width;
        canvas.height = vue.height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vue }).promise;

        for (const pose of poses.filter((p) => p.page === n)) {
          const largeur = (largeurPct / 100) * canvas.width;
          const hauteur = largeur * (d.hauteur / d.largeur);
          ctx.drawImage(
            imgSig,
            pose.xr * canvas.width - largeur / 2,
            pose.yr * canvas.height - hauteur / 2,
            largeur,
            hauteur,
          );
        }

        const format = [doc.pages[n - 1].largeur, doc.pages[n - 1].hauteur];
        if (!pdfSortie) {
          pdfSortie = new jsPDF({
            unit: "pt",
            format,
            orientation: format[0] > format[1] ? "landscape" : "portrait",
          });
        } else {
          pdfSortie.addPage(format, format[0] > format[1] ? "landscape" : "portrait");
        }
        pdfSortie.addImage(
          canvas.toDataURL("image/jpeg", 0.92),
          "JPEG",
          0,
          0,
          format[0],
          format[1],
        );
      }

      const nomSigne = doc.node.name.replace(/\.pdf$/i, "") + "-signé.pdf";
      const node = await saveAs(pdfSortie.output("blob"), nomSigne, {
        folder: "Documents signés",
      });
      if (node) {
        setDoc(null);
        setPoses([]);
        modal.alert({
          title: "Document signé",
          message: `« ${node.name} » est dans votre cloud. L'original n'a pas été modifié.`,
          tone: "success",
        });
      }
    } catch (e) {
      modal.alert({ title: "Signature impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  // ---- Rendu --------------------------------------------------------------

  if (!signatures.length) {
    return (
      <Vide
        icone="faFileSignature"
        titre="Aucune signature enregistrée"
        aide="Dessinez d'abord votre signature : c'est elle que vous poserez sur les documents."
      />
    );
  }

  if (!doc) {
    return (
      <div className="sigDocs cosScroll">
        <p className="sigAide">
          Choisissez un document PDF de votre cloud. Vous poserez ensuite la
          signature d'un clic, page par page — l'original ne sera pas modifié.
        </p>
        {pdfs === null ? (
          <p className="sigAide">Recherche des documents…</p>
        ) : pdfs.length ? (
          <div className="sigListeDocs">
            {pdfs.map((n) => (
              <div key={n.id} className="sigDoc handcr" data-off={occupe} onClick={() => !occupe && ouvrir(n)}>
                <Icon fafa="faFilePdf" width={16} />
                <div>
                  <div className="sigDocNom">{n.name}</div>
                  <div className="sigDocChemin">{n.chemin || "Racine du cloud"}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Vide
            icone="faFilePdf"
            titre="Aucun PDF dans le cloud"
            aide="Déposez d'abord le document à signer dans l'Explorateur ou sur le bureau."
          />
        )}
      </div>
    );
  }

  return (
    <div className="sigSigner">
      <div className="sigSignerBarre">
        <Bouton variante="secondaire" icone="faArrowLeft" onClick={() => setDoc(null)}>
          Documents
        </Bouton>
        <select value={choix || ""} onChange={(e) => setChoix(e.target.value)}>
          {signatures.map((s) => (
            <option key={s.id} value={s.id}>
              Signature de {s.data.nom}
            </option>
          ))}
        </select>
        <label className="sigEpaisseur">
          Taille
          <input
            type="range"
            min="10"
            max="45"
            value={largeurPct}
            onChange={(e) => setLargeurPct(Number(e.target.value))}
          />
        </label>
        <span className="sigSignerEtat">
          {poses.length
            ? `${poses.length} signature${poses.length > 1 ? "s" : ""} posée${poses.length > 1 ? "s" : ""}`
            : "Cliquez sur la page pour poser la signature"}
        </span>
        <Bouton icone="faFileSignature" off={occupe || !poses.length} onClick={signer}>
          Signer et enregistrer
        </Bouton>
      </div>

      <div ref={conteneur} className="sigPages cosScroll">
        {doc.pages.map((p, i) => (
          <div key={i} className="sigPage" onClick={poser(i + 1)}>
            <canvas ref={(el) => (canvases.current[i + 1] = el)} />
            {poses
              .filter((x) => x.page === i + 1)
              .map((pose) => (
                <img
                  key={pose.id}
                  className="sigPosee"
                  src={apercuDe(signature)}
                  alt="Signature posée — double-clic pour retirer"
                  title="Glissez pour déplacer · double-clic pour retirer"
                  style={{
                    left: `${pose.xr * 100}%`,
                    top: `${pose.yr * 100}%`,
                    width: `${largeurPct}%`,
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={glisser(pose)}
                  onDoubleClick={() =>
                    setPoses((liste) => liste.filter((x) => x.id !== pose.id))
                  }
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
};

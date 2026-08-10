import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { Vide } from "../../ui";
import { api, getToken } from "../../../api/client";
import { subscribeVisionneuse, oublierFichier } from "../../openRequest";
import { memeGenre } from "../../fileTypes";
import {
  chercherDansDocument,
  dessinerPage,
  echellePour,
  ouvrirDocument,
} from "./moteur";
import "./pdf.scss";

// Lecteur PDF du socle.
//
// Comme les autres visionneuses, il ne s'installe pas : l'Explorateur
// l'ouvre via les associations de `fileTypes.js`. Le rendu passe par
// pdf.js — voir moteur.js pour le pourquoi.

/// Lecteur PDF du socle : ouvert par l'Explorateur, jamais installé.
export const manifest = {
  id: "pdf",
  name: "Lecteur PDF",
  icon: "pdf",
  action: "PDFAPP",
  systeme: true,
  Window: PdfApp,
};

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

const formatBytes = (o) => {
  if (o == null) return "";
  if (o < 1024) return `${o} o`;
  const u = ["Ko", "Mo", "Go"];
  let v = o;
  let i = -1;
  do {
    v /= 1024;
    i += 1;
  } while (v >= 1024 && i < u.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
};

const sansExtension = (nom = "") => nom.replace(/\.[^.]+$/, "");

function PdfApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);

  const [charge, setCharge] = useState(null);
  const [doc, setDoc] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [zoom, setZoom] = useState(null); // null = ajusté
  const [mode, setMode] = useState("largeur"); // "largeur" | "page"
  const [rotation, setRotation] = useState(0);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [resultats, setResultats] = useState(null);
  const [enRecherche, setEnRecherche] = useState(false);
  const [vignettes, setVignettes] = useState(true);

  const toile = useRef(null);
  const scene = useRef(null);
  const tacheCourante = useRef(null);

  const visible = wnapp && !wnapp.hide;

  // ---- Fichier demandé ----------------------------------------------------

  useEffect(
    () =>
      subscribeVisionneuse(manifest.action, (c) => {
        setCharge(c);
        setErreur("");
        setPage(1);
        setResultats(null);
        setRecherche("");
        setRotation(0);
      }),
    [],
  );

  useEffect(() => {
    if (wnapp?.hide) oublierFichier(manifest.action);
  }, [wnapp?.hide]);

  const liste = useMemo(() => {
    if (!charge) return [];
    const l = memeGenre(charge.voisins || [], "pdf");
    return l.length ? l : [charge.node];
  }, [charge]);

  const index = liste.findIndex((n) => n.id === charge?.node?.id);
  const courant = charge?.node || null;

  const aller = (pas) => {
    const suivant = liste[(index + pas + liste.length) % liste.length];
    if (suivant) setCharge((c) => ({ ...c, node: suivant }));
  };

  // ---- Ouverture du document ---------------------------------------------

  useEffect(() => {
    if (!courant || !visible) return;

    let vivant = true;
    setChargement(true);
    setErreur("");
    setDoc(null);

    api
      .streamUrl(courant.id)
      .then(ouvrirDocument)
      .then((d) => {
        if (!vivant) return;
        setDoc(d);
        setTotal(d.numPages);
        setPage(1);
      })
      .catch((e) =>
        vivant &&
        setErreur(
          e?.message === "Failed to fetch"
            ? "Le serveur de fichiers est injoignable."
            : "Ce PDF n'a pas pu être ouvert. Il est peut-être protégé ou endommagé.",
        ),
      )
      .finally(() => vivant && setChargement(false));

    return () => {
      vivant = false;
    };
  }, [courant?.id, visible]);

  // ---- Rendu de la page courante -----------------------------------------

  const rendre = useCallback(async () => {
    if (!doc || !toile.current || !scene.current) return;

    // Un rendu en cours est annulé avant d'en lancer un autre : sans cela,
    // feuilleter vite empile les rendus et la page affichée n'est plus
    // celle qu'on demande.
    tacheCourante.current?.cancel?.();

    const cadre = {
      largeur: scene.current.clientWidth,
      hauteur: scene.current.clientHeight,
    };
    const echelle = zoom ?? (await echellePour(doc, page, mode, cadre));

    try {
      await dessinerPage(doc, page, toile.current, echelle, rotation, (t) => {
        tacheCourante.current = t;
      });
      setErreur("");
    } catch (e) {
      setErreur("Cette page n'a pas pu être affichée.");
    }
  }, [doc, page, zoom, mode, rotation]);

  useEffect(() => {
    rendre();
  }, [rendre]);

  // Le mode « ajusté » suit la taille de la fenêtre.
  useEffect(() => {
    if (zoom || !scene.current) return;
    const obs = new ResizeObserver(() => rendre());
    obs.observe(scene.current);
    return () => obs.disconnect();
  }, [zoom, rendre]);

  // ---- Raccourcis ---------------------------------------------------------

  useEffect(() => {
    if (!visible) return;
    const surTouche = (e) => {
      const dans = e.target;
      if (dans?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(dans?.tagName)) {
        return;
      }
      const actions = {
        ArrowRight: () => setPage((p) => Math.min(total, p + 1)),
        PageDown: () => setPage((p) => Math.min(total, p + 1)),
        ArrowLeft: () => setPage((p) => Math.max(1, p - 1)),
        PageUp: () => setPage((p) => Math.max(1, p - 1)),
        Home: () => setPage(1),
        End: () => setPage(total),
        "+": () => setZoom((z) => Math.min(4, (z ?? 1) + 0.25)),
        "=": () => setZoom((z) => Math.min(4, (z ?? 1) + 0.25)),
        "-": () => setZoom((z) => Math.max(0.25, (z ?? 1) - 0.25)),
        "0": () => setZoom(null),
        r: () => setRotation((r) => (r + 90) % 360),
      };
      const fn = actions[e.key];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [visible, total]);

  // ---- Recherche ----------------------------------------------------------

  const lancerRecherche = async () => {
    if (!doc || !recherche.trim()) return setResultats(null);
    setEnRecherche(true);
    const pages = await chercherDansDocument(doc, recherche);
    setResultats(pages);
    setEnRecherche(false);
    if (pages.length) setPage(pages[0]);
  };

  const telecharger = async () => {
    const res = await fetch(api.downloadUrl(courant.id), {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = courant.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ModuleWindow manifest={manifest} className="pdfApp">
      {!courant ? (
        <Vide
          icone="faFilePdf"
          titre="Aucun document"
          aide="Double-cliquez sur un PDF dans l'Explorateur pour le lire ici."
        />
      ) : (
        <>
          <div className="pdBarre">
            {liste.length > 1 ? (
              <Icon fafa="faChevronLeft" width={12} onClick={() => aller(-1)} />
            ) : null}
            <span className="pdNom" title={courant.name}>
              {sansExtension(courant.name)}
            </span>
            <span className="pdInfo">
              {liste.length > 1 ? `${index + 1} / ${liste.length} · ` : ""}
              {formatBytes(courant.size)}
            </span>
            {liste.length > 1 ? (
              <Icon fafa="faChevronRight" width={12} onClick={() => aller(1)} />
            ) : null}

            <div className="pdEspace" />

            <div className="pdPages">
              <Icon
                fafa="faChevronUp"
                width={11}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              />
              <input
                value={page}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (n >= 1 && n <= total) setPage(n);
                }}
              />
              <span>/ {total || "…"}</span>
              <Icon
                fafa="faChevronDown"
                width={11}
                onClick={() => setPage((p) => Math.min(total, p + 1))}
              />
            </div>

            <div className="pdZoom">
              <Icon
                fafa="faMagnifyingGlassMinus"
                width={12}
                onClick={() => setZoom((z) => Math.max(0.25, (z ?? 1) - 0.25))}
              />
              <select
                value={zoom ?? mode}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "largeur" || v === "page") {
                    setMode(v);
                    setZoom(null);
                  } else setZoom(Number(v));
                }}
              >
                <option value="largeur">Largeur</option>
                <option value="page">Page entière</option>
                {ZOOMS.map((z) => (
                  <option key={z} value={z}>
                    {Math.round(z * 100)} %
                  </option>
                ))}
              </select>
              <Icon
                fafa="faMagnifyingGlassPlus"
                width={12}
                onClick={() => setZoom((z) => Math.min(4, (z ?? 1) + 0.25))}
              />
            </div>

            <Icon
              fafa="faRotateRight"
              width={12}
              onClick={() => setRotation((r) => (r + 90) % 360)}
            />
            <Icon
              className={vignettes ? "pdActif" : ""}
              fafa="faTableCellsLarge"
              width={12}
              onClick={() => setVignettes((v) => !v)}
            />
            <Icon fafa="faDownload" width={12} onClick={telecharger} />
          </div>

          <div className="pdRecherche">
            <Icon fafa="faMagnifyingGlass" width={11} />
            <input
              placeholder="Rechercher dans le document…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lancerRecherche()}
            />
            {enRecherche ? <span className="pdCompte">Recherche…</span> : null}
            {resultats ? (
              <span className="pdCompte">
                {resultats.length
                  ? `${resultats.length} page(s) : ${resultats.slice(0, 8).join(", ")}${resultats.length > 8 ? "…" : ""}`
                  : "Aucun résultat"}
              </span>
            ) : null}
          </div>

          <div className="pdCorps">
            {vignettes && total > 1 ? (
              <div className="pdVignettes cosScroll">
                {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
                  <div
                    key={n}
                    className="pdVignette"
                    data-actif={n === page ? "true" : "false"}
                    data-trouve={resultats?.includes(n) ? "true" : "false"}
                    onClick={() => setPage(n)}
                  >
                    {n}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="pdScene cosScroll" ref={scene}>
              {chargement ? (
                <div className="pdEtat">
                  <span className="pdSpinner" /> Ouverture du document…
                </div>
              ) : null}
              {erreur ? (
                <div className="pdEtat pdErreur">
                  <Icon fafa="faCircleExclamation" width={16} />
                  {erreur}
                </div>
              ) : null}
              <canvas ref={toile} className="pdToile" />
            </div>
          </div>
        </>
      )}
    </ModuleWindow>
  );
}

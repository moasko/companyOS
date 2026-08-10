import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../../utils/general";
import { useNomApp } from "../../../utils/nomsApps";
import {
  Accueil,
  Etat,
  FenetreMedia,
  Progression,
  Vignette,
  duree,
  formatBytes,
  sansExtension,
  useRaccourcis,
  useVisionneuse,
} from "../_visionneuse/commun";

/// Visionneuse d'images du socle. Ouverte par l'Explorateur via les
/// associations de `fileTypes.js`, jamais appelée directement.
export const manifest = {
  id: "photos",
  name: "Photos",
  icon: "photos",
  action: "PHOTOS",
  systeme: true,
  Window: PhotosApp,
};

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

function PhotosApp() {
  const nomApp = useNomApp();
  const v = useVisionneuse("photos", "PHOTOS", "image");
  const [zoom, setZoom] = useState(null); // null = ajusté à la fenêtre
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [pellicule, setPellicule] = useState(true);
  const glisse = useRef(null);

  // Chaque image s'ouvre ajustée, sans hériter des réglages de la précédente.
  useEffect(() => {
    setZoom(null);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  }, [v.courant?.id]);

  const zoomer = (pas) =>
    setZoom((z) => Math.min(600, Math.max(10, (z ?? 100) + pas)));

  const raccourcis = useMemo(
    () => ({
      ArrowLeft: () => v.aller(-1),
      ArrowRight: () => v.aller(1),
      "+": () => zoomer(20),
      "=": () => zoomer(20),
      "-": () => zoomer(-20),
      r: () => setRotation((r) => (r + 90) % 360),
      R: () => setRotation((r) => (r + 90) % 360),
      "0": () => {
        setZoom(null);
        setPan({ x: 0, y: 0 });
      },
    }),
    [v.aller],
  );
  useRaccourcis(v.visible, raccourcis);

  // Molette : zoom, comme dans toute visionneuse.
  const surMolette = (e) => {
    if (!v.url) return;
    zoomer(e.deltaY < 0 ? 15 : -15);
  };

  // Glisser pour déplacer l'image quand elle dépasse de la fenêtre.
  const surAppui = (e) => {
    if (!zoom) return;
    glisse.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };
  const surDeplacement = (e) => {
    if (!glisse.current) return;
    setPan({ x: e.clientX - glisse.current.x, y: e.clientY - glisse.current.y });
  };
  const relacher = () => (glisse.current = null);

  return (
    <FenetreMedia wnapp={v.wnapp} nom={nomApp("photos")} className="photosApp">
      {!v.courant ? (
        <Accueil
          icone="faImages"
          titre="Aucune image ouverte"
          aide="Double-cliquez sur une image dans l'Explorateur pour l'afficher ici."
        />
      ) : (
        <>
          <div
            className="mdScene mdSceneSombre"
            onWheel={surMolette}
            onMouseDown={surAppui}
            onMouseMove={surDeplacement}
            onMouseUp={relacher}
            onMouseLeave={relacher}
            data-glisse={zoom ? "true" : "false"}
          >
            <Etat chargement={v.chargement} erreur={v.erreur} />

            {v.url ? (
              <img
                className="mdImage"
                src={v.url}
                alt={v.courant.name}
                draggable={false}
                data-ajuste={zoom ? "false" : "true"}
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${(zoom ?? 100) / 100}) rotate(${rotation}deg)`,
                }}
                onDoubleClick={() => setZoom((z) => (z ? null : 200))}
              />
            ) : null}

            {/* Flèches en surimpression, comme dans une galerie. */}
            {v.liste.length > 1 ? (
              <>
                <div className="mdFleche mdFlecheG" onClick={() => v.aller(-1)}>
                  <Icon fafa="faChevronLeft" width={16} />
                </div>
                <div className="mdFleche mdFlecheD" onClick={() => v.aller(1)}>
                  <Icon fafa="faChevronRight" width={16} />
                </div>
              </>
            ) : null}

            {/* Bandeau du haut : titre et compteur, effacé au repos. */}
            <div className="mdEntete">
              <span className="mdNom">{sansExtension(v.courant.name)}</span>
              <span className="mdInfo">
                {v.liste.length > 1 ? `${v.index + 1} / ${v.liste.length} · ` : ""}
                {formatBytes(v.courant.size)}
              </span>
            </div>

            {/* Contrôles flottants. */}
            <div className="mdFlottant">
              <button className="mdRond" title="Réduire (−)" onClick={() => zoomer(-20)}>
                <Icon fafa="faMagnifyingGlassMinus" width={13} />
              </button>
              <button
                className="mdRond mdRondTexte"
                title="Taille réelle / ajuster (0)"
                onClick={() => setZoom((z) => (z ? null : 100))}
              >
                {zoom ? `${zoom} %` : "Ajusté"}
              </button>
              <button className="mdRond" title="Agrandir (+)" onClick={() => zoomer(20)}>
                <Icon fafa="faMagnifyingGlassPlus" width={13} />
              </button>
              <span className="mdSep" />
              <button
                className="mdRond"
                title="Pivoter (R)"
                onClick={() => setRotation((r) => (r + 90) % 360)}
              >
                <Icon fafa="faRotateRight" width={13} />
              </button>
              {v.liste.length > 1 ? (
                <button
                  className="mdRond"
                  data-actif={pellicule ? "true" : "false"}
                  title="Pellicule"
                  onClick={() => setPellicule((p) => !p)}
                >
                  <Icon fafa="faTableCellsLarge" width={13} />
                </button>
              ) : null}
            </div>
          </div>

          {v.liste.length > 1 && pellicule ? (
            <div className="mdPellicule win11Scroll">
              {v.liste.map((n, i) => (
                <Vignette
                  key={n.id}
                  node={n}
                  actif={i === v.index}
                  onClick={() => v.allerA(i)}
                />
              ))}
            </div>
          ) : null}
        </>
      )}
    </FenetreMedia>
  );
}

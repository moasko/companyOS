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

/// Lecteur vidéo du socle.
export const manifest = {
  id: "movies",
  name: "Vidéo",
  icon: "movies",
  action: "VIDEOAPP",
  systeme: true,
  Window: VideoApp,
};

// ---------------------------------------------------------------------------
// Vidéo
// ---------------------------------------------------------------------------

const VITESSES = [0.5, 0.75, 1, 1.25, 1.5, 2];

function VideoApp() {
  const nomApp = useNomApp();
  const v = useVisionneuse("movies", "VIDEOAPP", "video", "flux");
  const video = useRef(null);
  const scene = useRef(null);
  const cacher = useRef(null);
  const [illisible, setIllisible] = useState(false);
  const [enLecture, setEnLecture] = useState(false);
  const [position, setPosition] = useState(0);
  const [total, setTotal] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muet, setMuet] = useState(false);
  const [vitesse, setVitesse] = useState(1);
  const [controles, setControles] = useState(true);

  useEffect(() => {
    setIllisible(false);
    setPosition(0);
  }, [v.courant?.id]);

  const basculer = useCallback(() => {
    const el = video.current;
    if (!el) return;
    if (el.paused) el.play().then(() => setEnLecture(true), () => {});
    else {
      el.pause();
      setEnLecture(false);
    }
  }, []);

  // Les contrôles s'effacent au repos et reviennent au moindre mouvement.
  const reveiller = () => {
    setControles(true);
    clearTimeout(cacher.current);
    cacher.current = setTimeout(() => setControles(false), 2600);
  };
  useEffect(() => () => clearTimeout(cacher.current), []);

  const raccourcis = useMemo(
    () => ({
      " ": basculer,
      k: basculer,
      ArrowRight: () => video.current && (video.current.currentTime += 5),
      ArrowLeft: () => video.current && (video.current.currentTime -= 5),
      ArrowUp: () => setVolume((x) => Math.min(1, x + 0.1)),
      ArrowDown: () => setVolume((x) => Math.max(0, x - 0.1)),
      m: () => setMuet((x) => !x),
      f: () => scene.current?.requestFullscreen?.(),
    }),
    [basculer],
  );
  useRaccourcis(v.visible, raccourcis);

  useEffect(() => {
    if (video.current) {
      video.current.volume = muet ? 0 : volume;
      video.current.playbackRate = vitesse;
    }
  }, [volume, muet, vitesse, v.url]);

  return (
    <FenetreMedia wnapp={v.wnapp} nom={nomApp("video")} className="videoApp">
      {!v.courant ? (
        <Accueil
          icone="faFilm"
          titre="Aucune vidéo"
          aide="Double-cliquez sur une vidéo dans l'Explorateur pour la lire ici."
        />
      ) : (
        <div
          className="mdScene mdSceneVideo"
          ref={scene}
          data-controles={controles ? "true" : "false"}
          onMouseMove={reveiller}
          onMouseLeave={() => setControles(false)}
        >
          <Etat chargement={v.chargement} erreur={v.erreur} />

          {illisible ? (
            <div className="mdErreur">
              <Icon fafa="faCircleExclamation" width={18} />
              <span>
                Ce format n'est pas lu par le navigateur. Téléchargez le fichier
                depuis l'Explorateur pour l'ouvrir dans un lecteur local.
              </span>
            </div>
          ) : null}

          {v.url && !illisible ? (
            <video
              ref={video}
              className="mdVideo"
              src={v.url}
              autoPlay
              onClick={basculer}
              onDoubleClick={() => scene.current?.requestFullscreen?.()}
              onTimeUpdate={(e) => setPosition(e.target.currentTime)}
              onDurationChange={(e) => setTotal(e.target.duration)}
              onPlay={() => setEnLecture(true)}
              onPause={() => setEnLecture(false)}
              onEnded={() => v.liste.length > 1 && v.aller(1)}
              onError={() => setIllisible(true)}
            />
          ) : null}

          {/* Gros bouton central quand c'est en pause. */}
          {v.url && !illisible && !enLecture ? (
            <button className="mdPlayCentral" onClick={basculer}>
              <Icon fafa="faPlay" width={22} />
            </button>
          ) : null}

          <div className="mdEntete">
            <span className="mdNom">{sansExtension(v.courant.name)}</span>
            <span className="mdInfo">
              {v.liste.length > 1 ? `${v.index + 1} / ${v.liste.length} · ` : ""}
              {formatBytes(v.courant.size)}
            </span>
          </div>

          {v.url && !illisible ? (
            <div className="mdBarreVideo">
              <Progression
                position={position}
                total={total}
                onChanger={(t) => {
                  setPosition(t);
                  if (video.current) video.current.currentTime = t;
                }}
              />
              <div className="mdBoutonsVideo">
                <button className="mdRond" title="Lecture / pause (Espace)" onClick={basculer}>
                  <Icon fafa={enLecture ? "faPause" : "faPlay"} width={13} />
                </button>
                {v.liste.length > 1 ? (
                  <>
                    <button className="mdRond" title="Précédent" onClick={() => v.aller(-1)}>
                      <Icon fafa="faBackwardStep" width={13} />
                    </button>
                    <button className="mdRond" title="Suivant" onClick={() => v.aller(1)}>
                      <Icon fafa="faForwardStep" width={13} />
                    </button>
                  </>
                ) : null}
                <button className="mdRond" title="Couper le son (M)" onClick={() => setMuet((m) => !m)}>
                  <Icon
                    fafa={muet || volume === 0 ? "faVolumeXmark" : volume < 0.5 ? "faVolumeLow" : "faVolumeHigh"}
                    width={13}
                  />
                </button>
                <input
                  className="mdVolume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.02"
                  value={muet ? 0 : volume}
                  onChange={(e) => {
                    setVolume(Number(e.target.value));
                    setMuet(false);
                  }}
                />
                <span className="mdChrono">
                  {duree(position)} / {duree(total)}
                </span>
                <div className="mdSpacer" />
                <select
                  className="mdVitesse"
                  value={vitesse}
                  title="Vitesse de lecture"
                  onChange={(e) => setVitesse(Number(e.target.value))}
                >
                  {VITESSES.map((x) => (
                    <option key={x} value={x}>
                      {x === 1 ? "Normal" : `${x}×`}
                    </option>
                  ))}
                </select>
                <button
                  className="mdRond"
                  title="Incrustation vidéo"
                  onClick={() => video.current?.requestPictureInPicture?.().catch(() => {})}
                >
                  <Icon fafa="faClone" width={13} />
                </button>
                <button
                  className="mdRond"
                  title="Plein écran (F)"
                  onClick={() => scene.current?.requestFullscreen?.()}
                >
                  <Icon fafa="faExpand" width={13} />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </FenetreMedia>
  );
}

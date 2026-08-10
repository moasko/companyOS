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

/// Lecteur audio du socle.
export const manifest = {
  id: "groove",
  name: "Musique",
  icon: "groove",
  action: "MUSIQUE",
  systeme: true,
  Window: MusiqueApp,
};

// ---------------------------------------------------------------------------
// Musique
// ---------------------------------------------------------------------------

function MusiqueApp() {
  const nomApp = useNomApp();
  const v = useVisionneuse("groove", "MUSIQUE", "audio", "flux");
  const audio = useRef(null);
  const canvas = useRef(null);
  const analyse = useRef(null);
  const [enLecture, setEnLecture] = useState(false);
  const [position, setPosition] = useState(0);
  const [total, setTotal] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muet, setMuet] = useState(false);
  const [boucle, setBoucle] = useState(false);
  const [aleatoire, setAleatoire] = useState(false);

  const suivant = useCallback(() => {
    if (aleatoire && v.liste.length > 2) {
      let n = v.index;
      while (n === v.index) n = Math.floor(Math.random() * v.liste.length);
      return v.allerA(n);
    }
    v.aller(1);
  }, [aleatoire, v.index, v.liste.length, v.aller, v.allerA]);

  const surFin = () => {
    if (boucle && audio.current) {
      audio.current.currentTime = 0;
      audio.current.play();
      return;
    }
    if (v.liste.length > 1) suivant();
    else setEnLecture(false);
  };

  const basculer = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) a.play().then(() => setEnLecture(true), () => {});
    else {
      a.pause();
      setEnLecture(false);
    }
  }, []);

  useEffect(() => {
    if (!audio.current || !v.url) return;
    audio.current.volume = muet ? 0 : volume;
    audio.current.play().then(
      () => setEnLecture(true),
      // Le navigateur peut refuser la lecture automatique : on l'affiche
      // en pause plutôt que de prétendre que ça joue.
      () => setEnLecture(false),
    );
  }, [v.url]);

  // Visualiseur : une analyse fréquentielle du son en cours. Purement
  // décoratif — si l'API audio n'est pas disponible, le lecteur marche
  // exactement pareil, sans les barres.
  useEffect(() => {
    if (!enLecture || !audio.current || !canvas.current) return;

    let anime = 0;
    try {
      if (!analyse.current) {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const source = ctx.createMediaElementSource(audio.current);
        const noeud = ctx.createAnalyser();
        noeud.fftSize = 128;
        source.connect(noeud);
        noeud.connect(ctx.destination);
        analyse.current = { ctx, noeud };
      }
      analyse.current.ctx.resume?.();
    } catch {
      return;
    }

    const { noeud } = analyse.current;
    const data = new Uint8Array(noeud.frequencyBinCount);
    const c = canvas.current;
    const g = c.getContext("2d");

    const dessiner = () => {
      anime = requestAnimationFrame(dessiner);
      noeud.getByteFrequencyData(data);
      const l = c.width / data.length;
      g.clearRect(0, 0, c.width, c.height);
      for (let i = 0; i < data.length; i++) {
        const h = (data[i] / 255) * c.height;
        const t = i / data.length;
        g.fillStyle = `hsl(${210 + t * 60} 90% ${58 + t * 12}%)`;
        g.fillRect(i * l, c.height - h, l - 1.5, h);
      }
    };
    dessiner();

    return () => cancelAnimationFrame(anime);
  }, [enLecture]);

  const raccourcis = useMemo(
    () => ({
      " ": basculer,
      ArrowRight: () => audio.current && (audio.current.currentTime += 5),
      ArrowLeft: () => audio.current && (audio.current.currentTime -= 5),
      ArrowUp: () => setVolume((x) => Math.min(1, x + 0.1)),
      ArrowDown: () => setVolume((x) => Math.max(0, x - 0.1)),
    }),
    [basculer],
  );
  useRaccourcis(v.visible, raccourcis);

  useEffect(() => {
    if (audio.current) audio.current.volume = muet ? 0 : volume;
  }, [volume, muet]);

  return (
    <FenetreMedia wnapp={v.wnapp} nom={nomApp("musique")} className="musiqueApp">
      {!v.courant ? (
        <Accueil
          icone="faMusic"
          titre="Aucun morceau"
          aide="Double-cliquez sur un fichier audio dans l'Explorateur pour l'écouter ici."
        />
      ) : (
        <div className="mdLecteur">
          <div className="mdScèneAudio">
            <div className="mdPochette" data-anime={enLecture ? "true" : "false"}>
              <canvas ref={canvas} width={220} height={130} className="mdVisu" />
              <Icon fafa="faMusic" width={34} />
            </div>

            <div className="mdMeta">
              <div className="mdTitre" title={v.courant.name}>
                {sansExtension(v.courant.name)}
              </div>
              <div className="mdInfo">
                {formatBytes(v.courant.size)}
                {v.liste.length > 1 ? ` · ${v.index + 1} sur ${v.liste.length}` : ""}
              </div>
            </div>

            <Etat chargement={v.chargement} erreur={v.erreur} />

            <audio
              ref={audio}
              src={v.url || undefined}
              onTimeUpdate={(e) => setPosition(e.target.currentTime)}
              onDurationChange={(e) => setTotal(e.target.duration)}
              onEnded={surFin}
              onPlay={() => setEnLecture(true)}
              onPause={() => setEnLecture(false)}
            />

            <div className="mdTemps">
              <span>{duree(position)}</span>
              <Progression
                position={position}
                total={total}
                onChanger={(t) => {
                  setPosition(t);
                  if (audio.current) audio.current.currentTime = t;
                }}
              />
              <span>-{duree(Math.max(0, (total || 0) - position))}</span>
            </div>

            <div className="mdControles">
              <button
                className="mdRond"
                data-actif={aleatoire ? "true" : "false"}
                title="Lecture aléatoire"
                onClick={() => setAleatoire((a) => !a)}
              >
                <Icon fafa="faShuffle" width={13} />
              </button>
              <button className="mdRond" title="Précédent" onClick={() => v.aller(-1)}>
                <Icon fafa="faBackwardStep" width={15} />
              </button>
              <button className="mdPlay" title="Lecture / pause (Espace)" onClick={basculer}>
                <Icon fafa={enLecture ? "faPause" : "faPlay"} width={16} />
              </button>
              <button className="mdRond" title="Suivant" onClick={suivant}>
                <Icon fafa="faForwardStep" width={15} />
              </button>
              <button
                className="mdRond"
                data-actif={boucle ? "true" : "false"}
                title="Répéter le morceau"
                onClick={() => setBoucle((b) => !b)}
              >
                <Icon fafa="faRepeat" width={13} />
              </button>
            </div>

            <div className="mdVolumeLigne">
              <button className="mdRond" title="Couper le son" onClick={() => setMuet((m) => !m)}>
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
            </div>
          </div>

          {v.liste.length > 1 ? (
            <div className="mdListe win11Scroll">
              <div className="mdListeTitre">File d'attente · {v.liste.length}</div>
              {v.liste.map((n, i) => (
                <div
                  key={n.id}
                  className="mdMorceau"
                  data-actif={i === v.index ? "true" : "false"}
                  onClick={() => v.allerA(i)}
                >
                  <span className="mdRang">
                    {i === v.index && enLecture ? (
                      <span className="mdOndes">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="mdMorceauNom">{sansExtension(n.name)}</span>
                  <span className="mdMorceauTaille">{formatBytes(n.size)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </FenetreMedia>
  );
}

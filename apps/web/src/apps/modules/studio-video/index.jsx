import React, { useEffect, useRef, useState } from "react";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import "./studio-video.scss";

export const manifest = {
  id: "studioVideo",
  slug: "studio-video",
  name: "Studio Vidéo",
  icon: "movies",
  // Le Bureau ouvre les apps par leur action Redux (dispatch du manifest) :
  // sans cette chaîne, l'icône reste inerte.
  action: "STUDIOVIDEOAPP",
  version: "1.0.0",
  nouveautes: [
    { version: "1.0.0", texte: "Montage vidéo multi-pistes dans le navigateur : coupes, textes, formes, filtres, audio et export MP4/WebM — propulsé par CE.SDK (IMG.LY), moteur 100 % client." },
  ],
  Window: VideoApp,
};

// Moteur CE.SDK chargé à la demande depuis le CDN (aucun poids dans le
// bundle). En production : installer @cesdk/cesdk-js, self-hoster les
// assets dans public/ et renseigner VITE_IMGLY_LICENSE pour retirer le
// filigrane d'essai.
const VERSION_CESDK = "1.80.0";
const URL_MODULE = `https://esm.sh/@cesdk/cesdk-js@${VERSION_CESDK}`;
const URL_ASSETS = `https://cdn.img.ly/packages/imgly/cesdk-js/${VERSION_CESDK}/assets`;

function VideoApp() {
  const conteneur = useRef(null);
  const editeur = useRef(null);
  const importeurScene = useRef(null);
  const [etat, setEtat] = useState("chargement");
  const [message, setMessage] = useState("Initialisation du moteur vidéo…");

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const module = await import(/* @vite-ignore */ URL_MODULE);
        if (annule) return;
        const CreativeEditorSDK = module.default;
        const cesdk = await CreativeEditorSDK.create(conteneur.current, {
          baseURL: URL_ASSETS,
          license: import.meta.env.VITE_IMGLY_LICENSE || undefined,
          locale: "fr",
          i18n: {
            fr: {
              "actions.export.video": "Télécharger la vidéo",
              "common.apply": "Appliquer",
              "common.cancel": "Annuler",
            },
          },
        });
        if (annule) {
          cesdk.dispose();
          return;
        }
        editeur.current = cesdk;
        cesdk.ui?.setTheme?.("dark");
        if (typeof cesdk.addDefaultAssetSources === "function") {
          await cesdk.addDefaultAssetSources();
        }
        setMessage("Création de la timeline…");
        await cesdk.actions.run("scene.create", { mode: "Video" });
        setEtat("pret");
      } catch (err) {
        if (annule) return;
        setEtat("erreur");
        setMessage(err?.message || "Impossible de charger le moteur vidéo (connexion au CDN requise).");
      }
    })();
    return () => {
      annule = true;
      try { editeur.current?.dispose(); } catch { /* déjà libéré */ }
      editeur.current = null;
    };
  }, []);

  const sauverScene = async () => {
    const cesdk = editeur.current;
    if (!cesdk || etat !== "pret") return;
    try {
      const json = await cesdk.engine.scene.saveToString();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = "montage.scene";
      lien.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Scène sauvegardée (.scene)");
    } catch (err) {
      setMessage(`Sauvegarde impossible : ${err?.message || "erreur"}`);
    }
  };

  const ouvrirScene = async (fichier) => {
    const cesdk = editeur.current;
    if (!cesdk || etat !== "pret" || !fichier) return;
    try {
      const json = await fichier.text();
      if (typeof cesdk.engine.scene.loadFromString === "function") {
        await cesdk.engine.scene.loadFromString(json);
      } else {
        const url = URL.createObjectURL(fichier);
        await cesdk.load(url);
        URL.revokeObjectURL(url);
      }
      setMessage("Scène chargée");
    } catch (err) {
      setMessage(`Chargement impossible : ${err?.message || "fichier invalide"}`);
    }
  };

  const exporterVideo = async () => {
    const cesdk = editeur.current;
    if (!cesdk || etat !== "pret") return;
    setMessage("Export en cours — l'encodage peut prendre quelques minutes…");
    try {
      await cesdk.actions.run("exportDesign", { mimeType: "video/mp4" });
      setMessage("Vidéo exportée");
    } catch (err) {
      setMessage(`Export interrompu : ${err?.message || "erreur"}`);
    }
  };

  return (
    <ModuleWindow manifest={manifest} className="svApp">
      <div className="svBarre">
        <span className="svMarque"><i><Icon fafa="faFilm" width={12} /></i> Studio Vidéo</span>
        <button onClick={() => importeurScene.current?.click()} disabled={etat !== "pret"}><Icon fafa="faFolderOpen" width={12} /> Ouvrir scène</button>
        <input ref={importeurScene} hidden type="file" accept=".scene,.json" onChange={(e) => ouvrirScene(e.target.files?.[0])} />
        <button onClick={sauverScene} disabled={etat !== "pret"}><Icon fafa="faFloppyDisk" width={12} /> Sauver scène</button>
        <button className="svPrimaire" onClick={exporterVideo} disabled={etat !== "pret"}><Icon fafa="faClapperboard" width={12} /> Exporter MP4</button>
        <span className="svStatut" data-etat={etat}>{message}</span>
      </div>
      <div className="svScene" data-etat={etat}>
        <div ref={conteneur} className="svConteneur" />
        {etat !== "pret" ? (
          <div className="svVoile">
            {etat === "erreur" ? <Icon fafa="faPlugCircleXmark" width={26} /> : <span className="svRotation"><Icon fafa="faCircleNotch" width={22} /></span>}
            <b>{etat === "erreur" ? "Moteur indisponible" : "Chargement du moteur"}</b>
            <span>{message}</span>
            {etat === "erreur" ? <small>Sans clé de licence, l'éditeur fonctionne en essai avec filigrane. Renseignez VITE_IMGLY_LICENSE pour la production.</small> : null}
          </div>
        ) : null}
      </div>
    </ModuleWindow>
  );
}

export default VideoApp;

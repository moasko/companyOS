import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { Icon, ToolBar } from "../../../utils/general";
import { api, apiFetch } from "../../../api/client";
import { subscribeVisionneuse, oublierFichier } from "../../openRequest";
import { memeGenre, TAILLE_MAX_LECTURE } from "../../fileTypes";
import { chargerApercu } from "../../../containers/applications/apps/assets/FileThumb";
import "./media.scss";

// Visionneuses système de CompanyOS : Photos, Musique et Vidéo.
//
// Elles ne s'installent pas et ne se désinstallent pas — un double-clic sur
// un fichier du cloud doit l'ouvrir, toujours. L'Explorateur ne les appelle
// pas directement : il passe par `ouvrirFichier`, qui consulte les
// associations de `fileTypes.js`. Ajouter un format ne touche donc jamais
// à ce fichier.
//
// Les fichiers du cloud exigent un jeton : pas de `src="…"` direct vers
// l'API, on récupère le blob puis on en fait une URL d'objet, libérée dès
// qu'on change de fichier.

export const formatBytes = (o) => {
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

export const duree = (s) => {
  if (!s || !isFinite(s)) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = Math.floor(s % 60);
  const mm = h ? String(m).padStart(2, "0") : m;
  return `${h ? `${h}:` : ""}${mm}:${String(r).padStart(2, "0")}`;
};

/// Un nom de fichier sans son extension — les lecteurs affichent le titre,
/// pas le nom technique.
export const sansExtension = (nom = "") => nom.replace(/\.[^.]+$/, "");

/// Socle commun aux trois visionneuses : la fenêtre, le fichier courant,
/// la liste des voisins lisibles et l'URL d'objet du fichier affiché.
export const useVisionneuse = (cle, action, genre, mode = "blob") => {
  const wnapp = useSelector((state) => state.apps[cle]);
  const [charge, setCharge] = useState(null);
  const [index, setIndex] = useState(0);
  const [url, setUrl] = useState(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);

  useEffect(
    () =>
      subscribeVisionneuse(action, (c) => {
        setCharge(c);
        setErreur("");
        if (!c) return;
        // On se positionne sur le fichier demandé au sein de ses voisins.
        const liste = memeGenre(c.voisins || [], genre);
        const i = liste.findIndex((n) => n.id === c.node.id);
        setIndex(i < 0 ? 0 : i);
      }),
    [action, genre],
  );

  const liste = useMemo(() => {
    if (!charge) return [];
    const l = memeGenre(charge.voisins || [], genre);
    return l.length ? l : [charge.node];
  }, [charge, genre]);

  const courant = liste[index] || charge?.node || null;

  // Chargement du fichier affiché.
  //
  // Deux modes. Les images sont téléchargées en blob : elles doivent de
  // toute façon être complètes pour s'afficher, et le cache des vignettes
  // les réutilise. Le son et la vidéo passent par un lien de flux : le
  // navigateur ne réclame que les octets dont il a besoin, la lecture
  // démarre tout de suite et on peut se déplacer dans la timeline.
  useEffect(() => {
    if (!courant || wnapp?.hide) return;

    let vivant = true;
    let objet = null;
    setChargement(true);
    setErreur("");

    const echec = (e) => {
      if (!vivant) return;
      setErreur(
        e?.message === "Failed to fetch"
          ? "Le serveur de fichiers est injoignable. Vérifiez qu'il tourne, puis réessayez."
          : e?.message || "Fichier illisible",
      );
    };

    if (mode === "flux") {
      api
        .streamUrl(courant.id)
        .then((u) => vivant && setUrl(u))
        .catch(echec)
        .finally(() => vivant && setChargement(false));
      return () => {
        vivant = false;
        setUrl(null);
      };
    }

    if (courant.size > TAILLE_MAX_LECTURE) {
      setUrl(null);
      setChargement(false);
      setErreur(
        `Fichier trop volumineux pour l'affichage (${formatBytes(courant.size)}). Téléchargez-le depuis l'Explorateur.`,
      );
      return;
    }

    apiFetch(api.downloadUrl(courant.id), {})
      .then((r) => {
        if (!r.ok) throw new Error("Fichier illisible");
        return r.blob();
      })
      .then((blob) => {
        if (!vivant) return;
        objet = URL.createObjectURL(blob);
        setUrl(objet);
      })
      .catch(echec)
      .finally(() => vivant && setChargement(false));

    return () => {
      vivant = false;
      // L'URL d'objet ne sert plus : la libérer évite de retenir en
      // mémoire toutes les images d'un dossier feuilleté.
      if (objet) URL.revokeObjectURL(objet);
      setUrl(null);
    };
  }, [courant?.id, wnapp?.hide, mode]);

  const aller = useCallback(
    (pas) => setIndex((i) => (i + pas + liste.length) % liste.length),
    [liste.length],
  );

  const allerA = useCallback((i) => setIndex(i), []);

  useEffect(() => {
    if (wnapp?.hide) oublierFichier(action);
  }, [wnapp?.hide, action]);

  const visible = wnapp && !wnapp.hide;

  return { wnapp, visible, courant, liste, index, aller, allerA, url, erreur, chargement };
};

/// Raccourcis clavier, actifs seulement quand la fenêtre est au premier plan.
/// Sans ce garde-fou, taper dans le traitement de texte piloterait le lecteur.
export const useRaccourcis = (actif, table) => {
  useEffect(() => {
    if (!actif) return;
    const surTouche = (e) => {
      const dans = e.target;
      if (dans?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(dans?.tagName)) {
        return;
      }
      const fn = table[e.key];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [actif, table]);
};

/// Barre de progression commune : cliquable, avec aperçu du temps au survol.
export const Progression = ({ position, total, onChanger }) => {
  const piste = useRef(null);
  const [survol, setSurvol] = useState(null);

  const tempsA = (e) => {
    const r = piste.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    return ratio * (total || 0);
  };

  return (
    <div
      className="mdBarreTemps"
      ref={piste}
      onMouseMove={(e) => setSurvol(tempsA(e))}
      onMouseLeave={() => setSurvol(null)}
      onClick={(e) => onChanger(tempsA(e))}
    >
      <div className="mdPisteFond">
        <div
          className="mdPisteLue"
          style={{ width: `${total ? (position / total) * 100 : 0}%` }}
        >
          <span className="mdCurseur" />
        </div>
      </div>
      {survol != null ? (
        <span
          className="mdApercuTemps"
          style={{ left: `${total ? (survol / total) * 100 : 0}%` }}
        >
          {duree(survol)}
        </span>
      ) : null}
    </div>
  );
};

/// Enveloppe de fenêtre commune, pour ne pas répéter le chrome trois fois.
export const FenetreMedia = ({ wnapp, nom, className, children }) => {
  if (!wnapp) return null;
  return (
    <div
      className={`${className} mediaApp floatTab dpShad`}
      data-size={wnapp.size}
      data-cascade={wnapp.cascade || 0}
      data-max={wnapp.max}
      style={{
        ...(wnapp.size == "cstm" ? wnapp.dim : null),
        zIndex: wnapp.z,
      }}
      data-hide={wnapp.hide}
      id={wnapp.icon + "App"}
    >
      <ToolBar app={wnapp.action} icon={wnapp.icon} size={wnapp.size} name={nom} />
      <div className="windowScreen flex flex-col">{children}</div>
    </div>
  );
};

export const Accueil = ({ icone, titre, aide }) => (
  <div className="mdAccueil">
    <div className="mdAccueilIcone">
      <Icon fafa={icone} width={30} />
    </div>
    <div className="mdAccueilTitre">{titre}</div>
    <div className="mdAccueilAide">{aide}</div>
  </div>
);

export const Etat = ({ chargement, erreur }) =>
  erreur ? (
    <div className="mdErreur">
      <Icon fafa="faCircleExclamation" width={18} />
      <span>{erreur}</span>
    </div>
  ) : chargement ? (
    <div className="mdChargement">
      <span className="mdSpinner" />
      Chargement…
    </div>
  ) : null;

/// Vignette réelle d'une image du dossier, pour la pellicule.
export const Vignette = ({ node, actif, onClick }) => {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let vivant = true;
    chargerApercu(node).then((u) => vivant && setUrl(u));
    return () => {
      vivant = false;
    };
  }, [node.id]);

  return (
    <div
      className="mdVignette"
      data-actif={actif ? "true" : "false"}
      title={node.name}
      onClick={onClick}
    >
      {url ? <img src={url} alt="" draggable={false} /> : <span className="mdVignetteVide" />}
    </div>
  );
};

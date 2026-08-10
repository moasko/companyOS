import React, { useEffect, useState } from "react";
import { api, getToken } from "../../../../api/client";
import { iconeDeFichier } from "../../../../apps/iconesFichiers";

// Vignettes des fichiers du cloud.
//
// Le téléchargement exige le jeton, donc pas de <img src="…"> direct : on
// récupère le blob puis on en fait une URL d'objet, libérée au démontage.
//
// Les URL sont mises en cache par identifiant de fichier : rouvrir un
// dossier ne retélécharge pas les mêmes images.

const cache = new Map();

const EXTENSIONS_IMAGE = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;

/// 4 Mo : au-delà, une vignette coûte plus qu'elle ne rapporte.
const TAILLE_MAX = 4 * 1024 * 1024;

export const estImage = (node) =>
  node.type === "FILE" &&
  (node.mimeType?.startsWith("image/") || EXTENSIONS_IMAGE.test(node.name));

export const peutEtreAffiche = (node) => estImage(node) && node.size <= TAILLE_MAX;

/// Charge l'image d'un nœud et renvoie une URL d'objet, ou null.
export const chargerApercu = async (node) => {
  if (cache.has(node.id)) return cache.get(node.id);

  const promesse = fetch(api.downloadUrl(node.id), {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
    .then((r) => (r.ok ? r.blob() : null))
    .then((blob) => (blob ? URL.createObjectURL(blob) : null))
    .catch(() => null);

  cache.set(node.id, promesse);
  return promesse;
};

export const oublierApercu = (id) => {
  const entree = cache.get(id);
  cache.delete(id);
  Promise.resolve(entree).then((url) => url && URL.revokeObjectURL(url));
};

/// Icône d'un fichier : vignette pour les images, icône générique sinon.
export const FileThumb = ({ node }) => {
  const [url, setUrl] = useState(null);
  const [echec, setEchec] = useState(false);

  useEffect(() => {
    if (!peutEtreAffiche(node)) return;
    let vivant = true;
    chargerApercu(node).then((u) => {
      if (!vivant) return;
      if (u) setUrl(u);
      else setEchec(true);
    });
    return () => {
      vivant = false;
    };
  }, [node.id]);

  if (url && !echec) {
    return (
      <div className="thumbBox">
        <img src={url} alt="" draggable={false} />
      </div>
    );
  }

  // Dossier, fichier sans vignette, image trop lourde : l'icône de son
  // type — jamais un trou, jamais une icône générique quand on sait mieux.
  return (
    <img
      className="thumbIcone"
      src={`img/icon/cos/${iconeDeFichier(node)}.svg`}
      alt=""
      draggable={false}
    />
  );
};

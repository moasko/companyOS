import React, { useEffect, useMemo, useState } from "react";
import { Icon } from "../utils/general";
import { api, apiFetch } from "../api/client";
import { modal } from "./modalRequest";
import { FileThumb, estImage } from "../containers/applications/apps/assets/FileThumb";
import "./choisirfichier.scss";

// « Ouvrir depuis le Cloud » — le pendant de la boîte « Enregistrer sous ».
//
// N'importe quelle application peut demander un fichier du gestionnaire de
// fichiers de l'espace, sans réécrire une navigation de dossiers :
//
//   const node = await choisirFichierCloud({ titre: "Logo", filtre: "image" });
//   if (node) { const blob = await blobDuFichier(node); … }
//
// `filtre` vaut "image", "pdf", une liste d'extensions ([".png", ".jpg"]) ou
// une fonction (node) => bool. Les dossiers restent toujours visibles.

const FILTRES = {
  image: estImage,
  pdf: (n) => /\.pdf$/i.test(n.name),
};

const accepteur = (filtre) => {
  if (!filtre) return () => true;
  if (typeof filtre === "function") return filtre;
  if (Array.isArray(filtre)) return (n) => filtre.some((ext) => n.name.toLowerCase().endsWith(ext.toLowerCase()));
  return FILTRES[filtre] || (() => true);
};

const taille = (octets = 0) => {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / 1024 / 1024).toFixed(1)} Mo`;
};

const Navigateur = ({ titre, filtre, dossier, plusieurs, close }) => {
  const accepte = useMemo(() => accepteur(filtre), [filtre]);
  const [chemin, setChemin] = useState([{ id: null, name: "Cloud" }]);
  const [noeuds, setNoeuds] = useState(null);
  const [erreur, setErreur] = useState("");
  const [recherche, setRecherche] = useState("");
  const [choisis, setChoisis] = useState([]);
  const courant = chemin[chemin.length - 1];

  // On ouvre sur le dossier suggéré s'il existe déjà à la racine.
  useEffect(() => {
    if (!dossier) return;
    api.listFiles(null).then((racine) => {
      const cible = racine.find((n) => n.type === "FOLDER" && n.name === dossier);
      if (cible) setChemin([{ id: null, name: "Cloud" }, { id: cible.id, name: cible.name }]);
    }).catch(() => {});
  }, [dossier]);

  useEffect(() => {
    let vivant = true;
    setNoeuds(null);
    api.listFiles(courant.id)
      .then((liste) => { if (vivant) { setNoeuds(liste); setErreur(""); } })
      .catch((e) => { if (vivant) { setNoeuds([]); setErreur(e.message); } });
    return () => { vivant = false; };
  }, [courant.id]);

  const q = recherche.trim().toLowerCase();
  const visibles = (noeuds || []).filter((n) => !q || n.name.toLowerCase().includes(q));
  const dossiers = visibles.filter((n) => n.type === "FOLDER").sort((a, b) => a.name.localeCompare(b.name));
  const fichiers = visibles.filter((n) => n.type === "FILE" && accepte(n)).sort((a, b) => a.name.localeCompare(b.name));
  const masques = (noeuds || []).filter((n) => n.type === "FILE" && !accepte(n)).length;

  const entrer = (n) => { setRecherche(""); setChemin([...chemin, { id: n.id, name: n.name }]); };
  const basculer = (n) => {
    if (!plusieurs) { close([n]); return; }
    setChoisis((c) => (c.some((x) => x.id === n.id) ? c.filter((x) => x.id !== n.id) : [...c, n]));
  };

  return (
    <div className="cfBoite">
      <div className="cfTete">
        <Icon fafa="faCloud" width={14} />
        <b>{titre}</b>
        <button type="button" className="cfFermer" aria-label="Fermer" onClick={() => close(null)}>
          <Icon fafa="faXmark" width={12} />
        </button>
      </div>

      <div className="cfBarre">
        <nav className="cfChemin" aria-label="Emplacement">
          {chemin.map((etape, i) => (
            <React.Fragment key={etape.id || "racine"}>
              {i > 0 ? <span aria-hidden="true">›</span> : null}
              <button type="button" data-dernier={i === chemin.length - 1} onClick={() => setChemin(chemin.slice(0, i + 1))}>
                {etape.name}
              </button>
            </React.Fragment>
          ))}
        </nav>
        <label className="cfRecherche">
          <Icon fafa="faMagnifyingGlass" width={11} />
          <input value={recherche} placeholder="Rechercher dans ce dossier" onChange={(e) => setRecherche(e.target.value)} />
        </label>
      </div>

      <div className="cfListe cosScroll" role="listbox" aria-multiselectable={!!plusieurs}>
        {noeuds === null ? (
          <div className="cfVide">Chargement…</div>
        ) : erreur ? (
          <div className="cfVide" data-erreur>{erreur}</div>
        ) : !dossiers.length && !fichiers.length ? (
          <div className="cfVide">
            {q ? "Aucun élément ne correspond." : "Ce dossier ne contient aucun fichier utilisable ici."}
          </div>
        ) : (
          <div className="cfGrille">
            {dossiers.map((n) => (
              <button type="button" key={n.id} className="cfCase" onClick={() => entrer(n)} title={n.name}>
                <span className="cfVignette"><Icon src="win/folder" width={40} /></span>
                <span className="cfNom">{n.name}</span>
              </button>
            ))}
            {fichiers.map((n) => {
              const actif = choisis.some((x) => x.id === n.id);
              return (
                <button
                  type="button"
                  key={n.id}
                  role="option"
                  aria-selected={actif}
                  className="cfCase"
                  data-actif={actif}
                  title={n.name}
                  onClick={() => basculer(n)}
                >
                  <span className="cfVignette"><FileThumb node={n} /></span>
                  <span className="cfNom">{n.name}</span>
                  <small>{taille(n.size)}</small>
                  {actif ? <span className="cfCoche"><Icon fafa="faCheck" width={9} /></span> : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="cfPied">
        <span>{masques ? `${masques} fichier${masques > 1 ? "s" : ""} d'un autre type masqué${masques > 1 ? "s" : ""}` : ""}</span>
        <button type="button" className="cfBouton" onClick={() => close(null)}>Annuler</button>
        {plusieurs ? (
          <button type="button" className="cfBouton cfPrincipal" disabled={!choisis.length} onClick={() => close(choisis)}>
            Joindre {choisis.length || ""}
          </button>
        ) : null}
      </div>
    </div>
  );
};

/// Ouvre le gestionnaire de fichiers en mode « choisir ». Rend le nœud
/// choisi (ou la liste, avec `plusieurs`), ou null si l'on annule.
export const choisirFichierCloud = async ({ titre = "Choisir dans le Cloud", filtre, dossier, plusieurs = false } = {}) => {
  const resultat = await modal.open({
    title: null,
    nu: true,
    render: ({ close }) => (
      <Navigateur titre={titre} filtre={filtre} dossier={dossier} plusieurs={plusieurs} close={close} />
    ),
  });
  if (!resultat?.length) return null;
  return plusieurs ? resultat : resultat[0];
};

/// Le contenu d'un fichier du Cloud.
export const blobDuFichier = async (node) => {
  const r = await apiFetch(api.downloadUrl(node.id));
  if (!r.ok) throw new Error(`Lecture de « ${node.name} » impossible.`);
  return r.blob();
};

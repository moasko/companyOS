// Versions d'un fichier et liens de partage publics — fenêtres ouvertes
// depuis l'Explorateur (menu contextuel).
//
//   ouvrirVersions(node, { onRestaure })
//   ouvrirPartage(node)

import React, { useCallback, useEffect, useState } from "react";
import { api, apiFetch } from "../api/client";
import { modal } from "./modalRequest";
import { depuis } from "./notifications";
import { Icon } from "../utils/general";
import "./historique.scss";

const taille = (o) => {
  const n = Number(o) || 0;
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / 1024 ** 2).toFixed(1)} Mo`;
};

const telecharger = async (url, nom) => {
  const r = await apiFetch(url);
  if (!r.ok) throw new Error(`Erreur ${r.status}`);
  const lien = document.createElement("a");
  lien.href = URL.createObjectURL(await r.blob());
  lien.download = nom;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(lien.href), 10_000);
};

const Versions = ({ node, close, onRestaure }) => {
  const [etat, setEtat] = useState(null);
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(null);

  const charger = useCallback(
    () =>
      api
        .versionsFichier(node.id)
        .then(setEtat)
        .catch((e) => setErreur(e.message)),
    [node.id],
  );
  useEffect(() => {
    charger();
  }, [charger]);

  const restaurer = async (v) => {
    const ok = await modal.confirm({
      title: "Restaurer cette version",
      message: "Elle redeviendra le contenu du fichier ; le contenu actuel sera gardé comme version.",
      confirmLabel: "Restaurer",
    });
    if (!ok) return;
    setOccupe(v.id);
    try {
      await api.restaurerVersionFichier(node.id, v.id);
      onRestaure?.();
      await charger();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(null);
    }
  };

  return (
    <div className="hstBoite">
      {erreur ? <div className="hstErreur">{erreur}</div> : null}
      {!etat ? (
        <div className="hstVide">Chargement…</div>
      ) : (
        <ul className="hstListe hstCorbeille">
          <li>
            <div className="hstTete">
              <Icon fafa="faFile" width={11} />
              <strong>Version actuelle</strong>
              <span className="hstQuand">
                {taille(etat.actuelle.size)} · {depuis(new Date(etat.actuelle.updatedAt).getTime())}
              </span>
            </div>
          </li>
          {etat.versions.length ? (
            etat.versions.map((v) => (
              <li key={v.id}>
                <div className="hstTete">
                  <Icon fafa="faClockRotateLeft" width={11} />
                  <span>{new Date(v.creeLe).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                  <span className="hstQuand">
                    {taille(v.size)}
                    {v.auteurNom ? ` · remplacée par ${v.auteurNom}` : ""}
                  </span>
                </div>
                <span style={{ display: "inline-flex", gap: 6 }}>
                  <button type="button" className="hstBouton" onClick={() => telecharger(api.urlVersionFichier(node.id, v.id), node.name).catch((e) => setErreur(e.message))}>
                    <Icon fafa="faDownload" width={10} />
                  </button>
                  <button type="button" className="hstBouton" disabled={occupe === v.id} onClick={() => restaurer(v)}>
                    Restaurer
                  </button>
                </span>
              </li>
            ))
          ) : (
            <li className="hstMuted">Aucune version précédente : elles apparaissent quand le fichier est remplacé ou réenregistré.</li>
          )}
        </ul>
      )}
      <div className="hstPied">
        <button type="button" className="hstBouton" onClick={() => close(null)}>
          Fermer
        </button>
      </div>
    </div>
  );
};

const Partage = ({ node, close }) => {
  const [liens, setLiens] = useState(null);
  const [reglages, setReglages] = useState({ joursValidite: 7, motDePasse: "", maxTelechargements: "" });
  const [cree, setCree] = useState(null);
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [copie, setCopie] = useState(false);

  const charger = useCallback(
    () =>
      api
        .partagesFichier(node.id)
        .then(setLiens)
        .catch((e) => setErreur(e.message)),
    [node.id],
  );
  useEffect(() => {
    charger();
  }, [charger]);

  const creer = async () => {
    setOccupe(true);
    setErreur("");
    try {
      const lien = await api.partagerFichier(node.id, {
        joursValidite: Number(reglages.joursValidite),
        ...(reglages.motDePasse ? { motDePasse: reglages.motDePasse } : {}),
        ...(reglages.maxTelechargements ? { maxTelechargements: Number(reglages.maxTelechargements) } : {}),
      });
      setCree(lien);
      setReglages((r) => ({ ...r, motDePasse: "" }));
      await charger();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  };

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(cree.url);
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    } catch {
      // Presse-papiers refusé : l'adresse reste sélectionnable.
    }
  };

  const revoquer = async (l) => {
    try {
      await api.revoquerPartage(l.id);
      if (cree?.id === l.id) setCree(null);
      await charger();
    } catch (e) {
      setErreur(e.message);
    }
  };

  return (
    <div className="hstBoite">
      {erreur ? <div className="hstErreur">{erreur}</div> : null}
      <div className="fpaFormulaire">
        <p className="hstMuted">
          Toute personne qui a le lien peut télécharger « {node.name} », sans compte. Ajoutez un mot de passe pour un document
          sensible.
        </p>
        <div className="fpaGrille">
          <label>
            <span>Valable</span>
            <select value={reglages.joursValidite} onChange={(e) => setReglages((r) => ({ ...r, joursValidite: e.target.value }))}>
              {[1, 7, 30, 90].map((j) => (
                <option key={j} value={j}>
                  {j} jour{j > 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Téléchargements max.</span>
            <input type="number" min="1" placeholder="Illimité" value={reglages.maxTelechargements} onChange={(e) => setReglages((r) => ({ ...r, maxTelechargements: e.target.value }))} />
          </label>
          <label className="fpaPlein">
            <span>Mot de passe (facultatif, 6 caractères min.)</span>
            <input type="password" autoComplete="new-password" value={reglages.motDePasse} onChange={(e) => setReglages((r) => ({ ...r, motDePasse: e.target.value }))} />
          </label>
        </div>
        <button type="button" className="hstBouton fpaPrincipal" disabled={occupe} onClick={creer}>
          <Icon fafa="faLink" width={11} /> Créer le lien
        </button>
        {cree ? (
          <div className="fpaLien">
            <input readOnly value={cree.url} onFocus={(e) => e.target.select()} />
            <button type="button" className="hstBouton" onClick={copier}>
              {copie ? "Copié" : "Copier"}
            </button>
            <p className="hstMuted">Copiez-le maintenant : pour votre sécurité, il ne sera plus affiché.</p>
          </div>
        ) : null}
      </div>
      {liens?.length ? (
        <ul className="hstListe hstCorbeille">
          {liens.map((l) => (
            <li key={l.id}>
              <div className="hstTete">
                <Icon fafa={l.protege ? "faLock" : "faLink"} width={11} />
                <span>
                  {l.actif ? "Actif" : "Expiré"} · jusqu'au {new Date(l.expireLe).toLocaleDateString()}
                </span>
                <span className="hstQuand">
                  {l.telechargements} téléchargement(s){l.maxTelechargements ? ` / ${l.maxTelechargements}` : ""}
                  {l.creeParNom ? ` · par ${l.creeParNom}` : ""}
                </span>
              </div>
              <button type="button" className="hstBouton" onClick={() => revoquer(l)}>
                Retirer
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="hstPied">
        <button type="button" className="hstBouton" onClick={() => close(null)}>
          Fermer
        </button>
      </div>
    </div>
  );
};

export const ouvrirVersions = (node, { onRestaure } = {}) =>
  modal.open({ title: `Versions — ${node.name}`, nu: true, render: ({ close }) => <Versions node={node} close={close} onRestaure={onRestaure} /> });

export const ouvrirPartage = (node) =>
  modal.open({ title: `Partager — ${node.name}`, nu: true, render: ({ close }) => <Partage node={node} close={close} /> });

// Historique des fiches et corbeille — communs à toutes les applications.
//
//   ouvrirHistorique({ module: "crm", collection: "clients", id, titre, actuel })
//   ouvrirCorbeilleFiches({ module: "crm", collection: "clients", titre })
//
// Le serveur garde l'état d'une fiche avant chaque modification et chaque
// suppression (apps/api/src/versions.js) ; ces fenêtres montrent qui a
// changé quoi, et permettent de revenir en arrière.

import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import { modal } from "./modalRequest";
import { depuis } from "./notifications";
import { Icon } from "../utils/general";
import { useTraduction } from "../utils/intl";
import { localeEffective } from "../utils/langue";
import "./historique.scss";

const TEXTES = {
  fr: {
    historique: "Historique",
    corbeille: "Fiches supprimées",
    chargement: "Chargement…",
    aucun: "Aucune modification enregistrée pour cette fiche.",
    corbeilleVide: "Aucune fiche supprimée ces six derniers mois.",
    modifiee: "Modifiée par {nom}",
    supprimee: "Supprimée par {nom}",
    quelquun: "quelqu'un",
    avant: "Avant",
    apres: "Après",
    restaurer: "Restaurer cette version",
    restaurerFiche: "Restaurer",
    confirmer: "Revenir à cette version ? L'état actuel restera dans l'historique.",
    restauree: "Fiche restaurée.",
    rienChange: "Aucun champ visible n'a changé.",
    fermer: "Fermer",
    vide: "(vide)",
  },
  en: {
    historique: "History",
    corbeille: "Deleted records",
    chargement: "Loading…",
    aucun: "No changes recorded for this record.",
    corbeilleVide: "No records deleted in the last six months.",
    modifiee: "Edited by {nom}",
    supprimee: "Deleted by {nom}",
    quelquun: "someone",
    avant: "Before",
    apres: "After",
    restaurer: "Restore this version",
    restaurerFiche: "Restore",
    confirmer: "Go back to this version? The current state will stay in the history.",
    restauree: "Record restored.",
    rienChange: "No visible field changed.",
    fermer: "Close",
    vide: "(empty)",
  },
};

const CACHES = new Set(["id", "createdAt", "updatedAt"]);

const lisible = (v, vide) => {
  if (v === undefined || v === null || v === "") return vide;
  if (typeof v === "object") {
    const t = JSON.stringify(v);
    return t.length > 90 ? `${t.slice(0, 87)}…` : t;
  }
  const t = String(v);
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
};

/// Les champs qui diffèrent entre deux états.
export const differences = (avant = {}, apres = {}) =>
  [...new Set([...Object.keys(avant || {}), ...Object.keys(apres || {})])]
    .filter((k) => !CACHES.has(k) && JSON.stringify(avant?.[k] ?? null) !== JSON.stringify(apres?.[k] ?? null))
    .map((k) => ({ champ: k, avant: avant?.[k], apres: apres?.[k] }));

const titreDe = (data) => data?.nom || data?.libelle || data?.titre || data?.numero || data?.designation || data?.resume || "—";

const Historique = ({ module, collection, id, actuel, close, onRestaure }) => {
  const t = useTraduction(TEXTES);
  const [versions, setVersions] = useState(null);
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    api.records
      .historique(module, collection, id)
      .then(setVersions)
      .catch((e) => setErreur(e.message));
  }, [module, collection, id]);

  const restaurer = async (v) => {
    if (!(await modal.confirm({ title: t("restaurer"), message: t("confirmer"), confirmLabel: t("restaurerFiche") }))) return;
    setOccupe(true);
    try {
      const fiche = await api.records.restaurer(module, collection, id, v.id);
      onRestaure?.(fiche);
      close(fiche);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <div className="hstBoite">
      {erreur ? <div className="hstErreur">{erreur}</div> : null}
      {!versions ? (
        <div className="hstVide">{t("chargement")}</div>
      ) : !versions.length ? (
        <div className="hstVide">{t("aucun")}</div>
      ) : (
        <ol className="hstListe">
          {versions.map((v, i) => {
            // Ce qui a changé lors de ce geste : l'état d'avant (v) contre
            // l'état d'après (la version plus récente, ou la fiche actuelle).
            const apres = i === 0 ? actuel : versions[i - 1].data;
            const diff = apres ? differences(v.data, apres) : [];
            return (
              <li key={v.id}>
                <div className="hstTete">
                  <Icon fafa={v.action === "suppression" ? "faTrashCan" : "faPen"} width={11} />
                  <strong>{t(v.action === "suppression" ? "supprimee" : "modifiee", { nom: v.auteurNom || t("quelquun") })}</strong>
                  <span className="hstQuand">{depuis(new Date(v.creeLe).getTime())}</span>
                </div>
                {apres ? (
                  diff.length ? (
                    <table className="hstDiff">
                      <thead>
                        <tr>
                          <th />
                          <th>{t("avant")}</th>
                          <th>{t("apres")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diff.slice(0, 12).map((d) => (
                          <tr key={d.champ}>
                            <th>{d.champ}</th>
                            <td className="hstAvant">{lisible(d.avant, t("vide"))}</td>
                            <td>{lisible(d.apres, t("vide"))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="hstMuted">{t("rienChange")}</div>
                  )
                ) : null}
                <button type="button" className="hstLien" disabled={occupe} onClick={() => restaurer(v)}>
                  <Icon fafa="faClockRotateLeft" width={10} /> {t("restaurer")}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <div className="hstPied">
        <button type="button" className="hstBouton" onClick={() => close(null)}>
          {t("fermer")}
        </button>
      </div>
    </div>
  );
};

const Corbeille = ({ module, collection, close, onRestaure }) => {
  const t = useTraduction(TEXTES);
  const [liste, setListe] = useState(null);
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(null);

  useEffect(() => {
    api.records
      .corbeille(module, collection)
      .then(setListe)
      .catch((e) => setErreur(e.message));
  }, [module, collection]);

  const restaurer = async (v) => {
    setOccupe(v.id);
    try {
      const fiche = await api.records.restaurer(module, collection, v.recordId, v.id);
      setListe((l) => l.filter((x) => x.id !== v.id));
      onRestaure?.(fiche);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(null);
    }
  };

  return (
    <div className="hstBoite">
      {erreur ? <div className="hstErreur">{erreur}</div> : null}
      {!liste ? (
        <div className="hstVide">{t("chargement")}</div>
      ) : !liste.length ? (
        <div className="hstVide">{t("corbeilleVide")}</div>
      ) : (
        <ul className="hstListe hstCorbeille">
          {liste.map((v) => (
            <li key={v.id}>
              <div className="hstTete">
                <strong>{titreDe(v.data)}</strong>
                <span className="hstQuand">
                  {t("supprimee", { nom: v.auteurNom || t("quelquun") })} · {depuis(new Date(v.creeLe).getTime())}
                </span>
              </div>
              <button type="button" className="hstBouton" disabled={occupe === v.id} onClick={() => restaurer(v)}>
                <Icon fafa="faClockRotateLeft" width={10} /> {t("restaurerFiche")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="hstPied">
        <button type="button" className="hstBouton" onClick={() => close(null)}>
          {t("fermer")}
        </button>
      </div>
    </div>
  );
};

const titreFenetre = (cle, titre) => {
  const libelle = (TEXTES[localeEffective().startsWith("en") ? "en" : "fr"] || TEXTES.fr)[cle];
  return titre ? `${libelle} — ${titre}` : libelle;
};

/// Résout la fiche restaurée, ou `null`.
export const ouvrirHistorique = ({ module, collection, id, titre, actuel, onRestaure }) =>
  modal.open({
    title: titreFenetre("historique", titre),
    nu: true,
    render: ({ close }) => (
      <Historique module={module} collection={collection} id={id} actuel={actuel} close={close} onRestaure={onRestaure} />
    ),
  });

export const ouvrirCorbeilleFiches = ({ module, collection, titre, onRestaure }) =>
  modal.open({
    title: titreFenetre("corbeille", titre),
    nu: true,
    render: ({ close }) => <Corbeille module={module} collection={collection} close={close} onRestaure={onRestaure} />,
  });

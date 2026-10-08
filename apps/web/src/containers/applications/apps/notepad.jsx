// Bloc-notes.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUI A CHANGÉ
//
// L'ancien Bloc-notes était un `<textarea>` sans aucune persistance : on y
// écrivait, et tout était perdu à la fermeture de la fenêtre. Une fausse
// application — la coquille d'un éditeur, sans le fond.
//
// Celui-ci enregistre pour de bon, dans le cloud de l'espace de travail
// (api.records, module « notepad »). Beaucoup de petites notes plutôt qu'un
// document : c'est ce qui le distingue du Traitement de texte, qui produit
// des `.docx`. Ici on jette une idée, un numéro, une liste — vite, sans
// mise en forme, partagé avec l'équipe et signé.
//
// Il garde sa fenêtre héritée (état `state.apps.notepad`, action NOTEPAD) :
// seul son contenu est refait. Les règles sont dans
// src/apps/modules/_blocnotes/domaine.js, éprouvées seules.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ToolBar, Icon } from "../../../utils/general";
import { useNomApp } from "../../../utils/nomsApps";
import { api } from "../../../api/client";
import { modal } from "../../../apps/modalRequest";
import { Auteur } from "../../../apps/Auteur";
import * as D from "../../../apps/modules/_blocnotes/domaine";
import "./assets/notepad.scss";

export const Notepad = () => {
  const nomApp = useNomApp();
  const wnapp = useSelector((state) => state.apps.notepad);
  const session = useSelector((state) => state.session);
  const ouvert = wnapp && !wnapp.hide && session.status === "authenticated";

  const [notes, setNotes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [actifId, setActifId] = useState(null);
  // Miroir synchrone de `actifId` pour l'enregistrement : entre deux
  // sauvegardes rapprochées, le state n'a pas encore basculé, la ref si.
  const idRef = useRef(null);
  // Verrou : tant qu'une création est en vol, les sauvegardes suivantes
  // attendent son identifiant au lieu de créer un doublon.
  const creationEnCours = useRef(null);
  const [brouillon, setBrouillon] = useState(null); // { titre, corps, couleur, epingle }
  const [recherche, setRecherche] = useState("");
  const minuteur = useRef(null);

  const charger = useCallback(async () => {
    try {
      setNotes(await api.records.list("notepad", "notes"));
    } catch {
      setNotes([]);
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    if (ouvert) charger();
  }, [ouvert, charger]);

  const visibles = useMemo(
    () => D.trier(D.filtrer(notes, recherche)),
    [notes, recherche],
  );

  const active = notes.find((n) => n.id === actifId) || null;

  // ---- Édition ------------------------------------------------------------

  const ouvrirNote = (note) => {
    idRef.current = note.id;
    setActifId(note.id);
    setBrouillon({ ...D.NOTE_VIDE(), ...note.data });
  };

  const nouvelle = () => {
    idRef.current = null;
    creationEnCours.current = null;
    setActifId(null);
    setBrouillon(D.NOTE_VIDE());
  };

  /// Enregistrement différé : on n'écrit pas à chaque touche. Une note vide
  /// n'est jamais enregistrée — ouvrir « Nouvelle » sans rien taper ne doit
  /// pas semer de fiches fantômes.
  const modifier = (patch) => {
    const suivant = { ...brouillon, ...patch };
    setBrouillon(suivant);
    clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => enregistrer(suivant), 800);
  };

  const enregistrer = async (note) => {
    if (D.estVide(note)) return;
    // Une création est déjà partie : on attend son identifiant plutôt que
    // d'en lancer une seconde. C'est ce qui évite le doublon.
    if (creationEnCours.current) {
      try {
        idRef.current = await creationEnCours.current;
      } catch {
        creationEnCours.current = null;
      }
    }
    try {
      if (idRef.current) {
        const id = idRef.current;
        const maj = await api.records.update("notepad", "notes", id, note);
        setNotes((l) => l.map((n) => (n.id === id ? maj : n)));
      } else {
        const promesse = api.records.create("notepad", "notes", note);
        creationEnCours.current = promesse.then((c) => c.id);
        const cree = await promesse;
        idRef.current = cree.id;
        creationEnCours.current = null;
        setActifId(cree.id);
        setNotes((l) => [cree, ...l]);
      }
    } catch {
      creationEnCours.current = null;
      /* une écriture ratée sera retentée à la frappe suivante */
    }
  };

  const basculerEpingle = () => {
    const suivant = { ...brouillon, epingle: !brouillon.epingle };
    setBrouillon(suivant);
    enregistrer(suivant);
  };

  const supprimer = async () => {
    const id = idRef.current;
    if (!id) {
      setBrouillon(null);
      return;
    }
    const ok = await modal.confirm({
      title: "Supprimer cette note ?",
      message: `« ${D.titreDe(brouillon)} » sera retirée pour toute l'équipe.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.records.remove("notepad", "notes", id);
      setNotes((l) => l.filter((n) => n.id !== id));
      idRef.current = null;
      setActifId(null);
      setBrouillon(null);
    } catch (e) {
      modal.alert({ title: "Suppression impossible", message: e.message, tone: "error" });
    }
  };

  useEffect(() => () => clearTimeout(minuteur.current), []);

  return (
    <div
      className="notepad floatTab dpShad"
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
      <ToolBar app={wnapp.action} icon={wnapp.icon} size={wnapp.size} name={nomApp("notepad")} />
      <div className="windowScreen flex flex-col" data-dock="true">
        <div className="restWindow flex-grow npShell">
          {/* ---- Liste des notes ---- */}
          <aside className="npListe">
            <div className="npListeTete">
              <input
                className="npRecherche"
                value={recherche}
                placeholder="Rechercher…"
                onChange={(e) => setRecherche(e.target.value)}
              />
              <div className="npNouveau handcr" title="Nouvelle note" onClick={nouvelle}>
                <Icon fafa="faPlus" width={13} />
              </div>
            </div>

            <div className="npNotes cosScroll">
              {chargement ? (
                <div className="npVide">Chargement…</div>
              ) : visibles.length ? (
                visibles.map((n) => {
                  const c = D.couleurDe(n.data.couleur);
                  return (
                    <div
                      key={n.id}
                      className="npNote handcr"
                      data-actif={n.id === actifId}
                      style={{ background: c.fond, borderColor: c.bord }}
                      onClick={() => ouvrirNote(n)}
                    >
                      <div className="npNoteTitre">
                        {n.data.epingle ? <Icon fafa="faThumbtack" width={9} /> : null}
                        {D.titreDe(n.data)}
                      </div>
                      {D.apercuDe(n.data) ? (
                        <div className="npNoteApercu">{D.apercuDe(n.data)}</div>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <div className="npVide">
                  {recherche
                    ? "Aucune note ne correspond."
                    : "Aucune note. La première vous attend."}
                </div>
              )}
            </div>
          </aside>

          {/* ---- Éditeur ---- */}
          <div className="npEditeur">
            {brouillon ? (
              <>
                <div className="npBarre">
                  <div className="npCouleurs">
                    {D.COULEURS.map((c) => (
                      <span
                        key={c.id}
                        className="npPastille handcr"
                        data-actif={brouillon.couleur === c.id}
                        style={{ background: c.fond, borderColor: c.bord }}
                        onClick={() => modifier({ couleur: c.id })}
                      />
                    ))}
                  </div>
                  <div className="npBarreFin">
                    <div
                      className="npBtn handcr"
                      data-actif={brouillon.epingle}
                      title={brouillon.epingle ? "Désépingler" : "Épingler en tête"}
                      onClick={basculerEpingle}
                    >
                      <Icon fafa="faThumbtack" width={12} />
                    </div>
                    <div className="npBtn handcr" title="Supprimer" onClick={supprimer}>
                      <Icon fafa="faTrashCan" width={12} />
                    </div>
                  </div>
                </div>

                <input
                  className="npTitre"
                  value={brouillon.titre}
                  placeholder="Titre"
                  onChange={(e) => modifier({ titre: e.target.value })}
                />
                <textarea
                  className="npCorps cosScroll"
                  value={brouillon.corps}
                  placeholder="Écrivez votre note…"
                  autoFocus
                  onChange={(e) => modifier({ corps: e.target.value })}
                  style={{ background: D.couleurDe(brouillon.couleur).fond }}
                />
                {active ? <Auteur record={active} /> : null}
              </>
            ) : (
              <div className="npAccueil">
                <Icon src="notepad" width={46} />
                <p>
                  Une note pour ce qu'on jette sur un papier : un numéro, une
                  liste, une idée. Choisissez-en une à gauche, ou créez-en une.
                </p>
                <div className="npAccueilBtn handcr" onClick={nouvelle}>
                  <Icon fafa="faPlus" width={12} />
                  Nouvelle note
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

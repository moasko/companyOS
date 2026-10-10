import React, { useEffect, useState } from "react";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { Barre, Bouton, Espace, Vide } from "../../ui";
import {
  epingler,
  historique,
  recopier,
  retirer,
  subscribeClipboard,
  vider,
} from "../../clipboard";
import { modal } from "../../modalRequest";
import "./clipboard.scss";
import { manifest as descriptif } from "./manifest";

// Presse-papiers de CompanyOS — l'historique de ce qui a été copié dans
// l'OS, à la manière de Win+V.
//
// L'historique ne quitte jamais le navigateur : voir l'en-tête de
// src/apps/clipboard.js pour la raison.
//
// Ce module se sert du kit de `src/apps/ui/` : il n'a donc ni jetons de
// thème, ni styles de boutons, ni état vide à écrire — seulement ce qui lui
// est propre, la liste des entrées.

/// Presse-papiers du socle : l'historique de ce qui a été copié dans l'OS.
export const manifest = { ...descriptif, Window: ClipboardApp };

const quand = (date) => {
  const s = Math.round((Date.now() - date) / 1000);
  if (s < 45) return "à l'instant";
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return new Date(date).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
};

/// Aperçu compact : un texte copié peut faire des milliers de lignes.
const apercu = (t) => (t.length > 400 ? `${t.slice(0, 400)}…` : t);

function ClipboardApp() {
  const [entrees, setEntrees] = useState(historique);
  const [filtre, setFiltre] = useState("");
  const [copiee, setCopiee] = useState(null);

  useEffect(() => subscribeClipboard(setEntrees), []);

  const visibles = entrees
    .filter((e) => e.texte.toLowerCase().includes(filtre.trim().toLowerCase()))
    // Les épinglées d'abord, puis les plus récentes.
    .sort((a, b) => (b.epingle ? 1 : 0) - (a.epingle ? 1 : 0) || b.date - a.date);

  const copier = async (entree) => {
    const ok = await recopier(entree.texte);
    if (!ok) return;
    setCopiee(entree.id);
    setTimeout(() => setCopiee((c) => (c === entree.id ? null : c)), 1400);
  };

  const viderTout = async () => {
    const epinglees = entrees.filter((e) => e.epingle).length;
    const ok = await modal.confirm({
      title: "Vider le presse-papiers",
      message: `Effacer ${entrees.length - epinglees} entrée(s) de l'historique ?`,
      detail: epinglees
        ? `${epinglees} entrée(s) épinglée(s) seront conservée(s).`
        : "Cette action est irréversible.",
      confirmLabel: "Vider",
      danger: true,
    });
    if (ok) vider();
  };

  return (
    <ModuleWindow manifest={manifest} className="clipboardApp">
      <Barre>
        <input
          className="cbRecherche"
          placeholder="Rechercher dans l'historique…"
          value={filtre}
          onChange={(e) => setFiltre(e.target.value)}
        />
        <Espace />
        <span className="cbCompte">
          {entrees.length} entrée{entrees.length > 1 ? "s" : ""}
        </span>
        <Bouton
          variante="secondaire"
          icone="faTrashCan"
          off={!entrees.length}
          onClick={viderTout}
        >
          Vider
        </Bouton>
      </Barre>

      <div className="cbListe cosScroll">
        {!visibles.length ? (
          <Vide
            icone="faClipboard"
            titre={filtre ? "Aucune correspondance" : "Rien pour l'instant"}
            aide={
              filtre
                ? "Aucune entrée de l'historique ne contient ce texte."
                : "Copiez du texte n'importe où dans CompanyOS, il apparaîtra ici."
            }
          />
        ) : (
          visibles.map((e) => (
            <div className="cbEntree" key={e.id} data-epingle={e.epingle}>
              <div className="cbTexte" onClick={() => copier(e)}>
                {apercu(e.texte)}
              </div>
              <div className="cbPied">
                <span className="cbMeta">
                  {e.origine ? `${e.origine} · ` : ""}
                  {quand(e.date)}
                </span>
                <div className="cbActions">
                  <span
                    className="cbAction"
                    data-actif={e.epingle}
                    title={e.epingle ? "Détacher" : "Épingler"}
                    onClick={() => epingler(e.id)}
                  >
                    <Icon fafa="faThumbtack" width={10} />
                  </span>
                  <span className="cbAction" title="Copier" onClick={() => copier(e)}>
                    <Icon fafa={copiee === e.id ? "faCheck" : "faCopy"} width={10} />
                  </span>
                  <span
                    className="cbAction cbSuppr"
                    title="Retirer"
                    onClick={() => retirer(e.id)}
                  >
                    <Icon fafa="faXmark" width={10} />
                  </span>
                </div>
              </div>
              {copiee === e.id ? <div className="cbCopie">Copié</div> : null}
            </div>
          ))
        )}
      </div>

      <div className="cbPiedFenetre">
        L'historique reste sur cet appareil — il n'est jamais envoyé au serveur.
      </div>
    </ModuleWindow>
  );
}

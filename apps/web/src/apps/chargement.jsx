// Chargement des données d'une fenêtre — un seul mécanisme pour tout l'OS.
//
// ─────────────────────────────────────────────────────────────────────────
// LE PROBLÈME QU'IL RÈGLE
//
// Chaque application refaisait ceci :
//
//   const charger = async () => { try { … } catch (e) { flash(e.message) } };
//   useEffect(() => { if (ouvert) charger(); }, [ouvert]);
//
// Trois défauts, les mêmes partout :
//
// 1. **L'état vide ment.** Entre l'ouverture de la fenêtre et l'arrivée des
//    données, la liste est vide — donc l'écran affiche « Votre catalogue est
//    vide », « Aucun client », « Aucun document ». L'utilisateur lit une
//    phrase fausse, et parfois clique sur « Créer le premier » alors que ses
//    données existent.
//
// 2. **Une réponse en retard écrase une plus récente.** Deux chargements qui
//    se croisent — ouverture puis rafraîchissement — se terminent dans
//    l'ordre du réseau, pas dans celui des demandes.
//
// 3. **Une erreur disparaît.** Elle passe dans un message éphémère de trois
//    secondes, sans moyen de réessayer : la fenêtre reste vide sans dire
//    pourquoi.
//
// Ce fichier fait les trois : il distingue le premier chargement d'un
// rafraîchissement, ignore les réponses périmées, et garde l'erreur à
// l'écran avec un bouton.
// ─────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../utils/general";
import { creerTraducteur } from "../utils/intl";
import "./chargement.scss";

/// Message d'erreur présentable.
///
/// « Failed to fetch » est ce que dit le navigateur quand rien ne répond :
/// c'est de l'anglais, c'est du jargon, et cela n'indique aucune action. Le
/// cas est fréquent en développement comme sur un réseau instable — il
/// mérite une phrase qui dise quoi faire.
const MESSAGES = {
  fr: {
    injoignable: "Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.",
    droits: "Vous n'avez pas les droits pour consulter ces données.",
    expiree: "Votre session a expiré. Reconnectez-vous.",
    impossible: "Chargement impossible",
    reessayer: "Réessayer",
  },
  en: {
    injoignable: "The server cannot be reached. Check your connection and try again.",
    droits: "You do not have permission to view this data.",
    expiree: "Your session has expired. Sign in again.",
    impossible: "Could not load",
    reessayer: "Try again",
  },
};
const tMsg = creerTraducteur(MESSAGES);

const lisible = (e) => {
  const m = e?.message || "";
  if (/failed to fetch|networkerror|load failed/i.test(m)) return tMsg("injoignable");
  if (e?.status === 403) return tMsg("droits");
  if (e?.status === 401) return tMsg("expiree");
  return m || tMsg("impossible");
};

/// Charge les données d'une fenêtre dès qu'elle devient utilisable.
///
///   const { chargement, erreur, recharger } = useChargement(ouvert, charger);
///
/// `charger` doit poser les états du module ; le hook ne s'occupe que du
/// cycle. `recharger()` refait un tour sans vider l'écran — c'est ce qu'on
/// appelle après une écriture.
export const useChargement = (actif, charger) => {
  // `premier` distingue « la fenêtre s'ouvre, il n'y a encore rien » de
  // « les données sont là, on les rafraîchit ». Le premier cas mérite un
  // squelette, le second ne doit rien faire clignoter.
  const [premier, setPremier] = useState(true);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");

  // Jeton d'ordre : seule la réponse du dernier appel a le droit d'écrire.
  // Sans lui, un premier chargement lent qui revient après un
  // rafraîchissement rapide réinstalle des données périmées.
  const jeton = useRef(0);
  const fn = useRef(charger);
  fn.current = charger;

  const lancer = useCallback(async ({ silencieux = false } = {}) => {
    const mien = ++jeton.current;
    if (!silencieux) setChargement(true);
    setErreur("");
    try {
      await fn.current();
      if (mien !== jeton.current) return;
      setPremier(false);
    } catch (e) {
      if (mien !== jeton.current) return;
      setErreur(lisible(e));
    } finally {
      if (mien === jeton.current) setChargement(false);
    }
  }, []);

  useEffect(() => {
    if (actif) lancer();
  }, [actif, lancer]);

  return {
    /// Vrai pendant un chargement, quel qu'il soit.
    chargement,
    /// Vrai tant que rien n'a jamais été chargé : c'est **celui-ci** qui
    /// commande le squelette. Un rafraîchissement ne doit pas vider l'écran.
    initial: premier && chargement,
    erreur,
    recharger: lancer,
    /// Rafraîchissement après écriture : pas d'indicateur, l'écran a déjà
    /// son contenu et la mise à jour est presque instantanée.
    rafraichir: () => lancer({ silencieux: true }),
  };
};

/// Barres grises au rythme d'un tableau. Un squelette n'est pas décoratif :
/// il occupe la place que prendront les données, donc la mise en page ne
/// saute pas quand elles arrivent.
export const Squelette = ({ lignes = 6, className = "" }) => (
  <div className={`cosSquelette ${className}`} aria-hidden="true">
    {Array.from({ length: lignes }, (_, i) => (
      <div key={i} className="cosSqLigne">
        <span className="cosSqPastille" />
        <span className="cosSqBarre" style={{ width: `${55 + ((i * 37) % 35)}%` }} />
        <span className="cosSqBarre cosSqCourte" />
      </div>
    ))}
  </div>
);

/// Squelette de grille — pour les catalogues en vignettes.
export const SqueletteGrille = ({ cases = 8, className = "" }) => (
  <div className={`cosSqGrille ${className}`} aria-hidden="true">
    {Array.from({ length: cases }, (_, i) => (
      <div key={i} className="cosSqCarte">
        <span className="cosSqImage" />
        <span className="cosSqBarre" />
        <span className="cosSqBarre cosSqCourte" />
      </div>
    ))}
  </div>
);

/// Erreur de chargement, avec de quoi réessayer.
///
/// Affichée en place, pas en message éphémère : une fenêtre vide sans
/// explication est le pire des deux mondes.
export const ErreurChargement = ({ erreur, onReessayer }) => (
  <div className="cosErreurChargement">
    <Icon fafa="faTriangleExclamation" width={22} />
    <span className="cosErrTexte">{erreur}</span>
    {onReessayer ? (
      <div className="cosErrBouton handcr" onClick={() => onReessayer()}>
        {tMsg("reessayer")}
      </div>
    ) : null}
  </div>
);

/// Enveloppe les trois cas d'un écran de liste : chargement, erreur, vide.
///
///   <Contenu etat={etat} vide={!liste.length} squelette="grille"
///            rendreVide={() => <MonEtatVide />}>
///     {…la vraie liste…}
///   </Contenu>
export const Contenu = ({
  etat,
  vide,
  squelette = "liste",
  lignes,
  rendreVide,
  children,
}) => {
  if (etat.initial) {
    return squelette === "grille" ? (
      <SqueletteGrille cases={lignes} />
    ) : (
      <Squelette lignes={lignes} />
    );
  }
  if (etat.erreur) {
    return <ErreurChargement erreur={etat.erreur} onReessayer={etat.recharger} />;
  }
  if (vide) return rendreVide ? rendreVide() : null;
  return children;
};

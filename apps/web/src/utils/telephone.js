import { useSyncExternalStore } from "react";

// Le mode téléphone : un écran trop étroit pour des fenêtres.
//
// En dessous de 640 px, des fenêtres flottantes et une barre des tâches
// n'ont plus de sens — elles débordent et se chevauchent. Le shell passe
// alors à la logique d'un téléphone : un lanceur plein écran, une
// application à la fois, une barre du bas réduite à l'essentiel.

export const REQUETE_TELEPHONE = "(max-width: 640px)";

const media = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia(REQUETE_TELEPHONE)
    : null;

const abonner = (rappel) => {
  const m = media();
  if (!m) return () => {};
  m.addEventListener("change", rappel);
  return () => m.removeEventListener("change", rappel);
};

export const estTelephone = () => Boolean(media()?.matches);

export const useTelephone = () => useSyncExternalStore(abonner, estTelephone, () => false);

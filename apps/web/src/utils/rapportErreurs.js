// Rapport des erreurs du navigateur vers le journal de la plateforme.
//
// Une erreur JavaScript chez un client ne laissait aucune trace : il voyait
// une fenêtre figée, fermait l'onglet, et l'exploitant n'en savait rien.
// Elles partent désormais vers `/api/erreurs`, où la console Plateforme les
// regroupe et les compte.
//
// Discrétion d'abord : jamais plus de vingt rapports par session, jamais
// deux fois la même erreur, et un envoi qui échoue n'en provoque pas un
// autre — un rapporteur d'erreurs qui boucle est pire que pas de rapporteur.

import { BASE_URL } from "../api/client";

const PLAFOND = 20;
const deja = new Set();

export const signalerErreur = (erreur, contexte = "") => {
  try {
    const message = String(erreur?.message || erreur || "Erreur inconnue").slice(0, 500);
    const pile = String(erreur?.stack || "").slice(0, 8000);
    const cle = `${message}|${pile.split("\n")[1] || ""}`;
    if (deja.has(cle) || deja.size >= PLAFOND) return;
    deja.add(cle);

    // Le cookie de session, s'il existe, dit qui était touché.
    fetch(`${BASE_URL}/api/erreurs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({
        message: contexte ? `${contexte} : ${message}`.slice(0, 500) : message,
        pile: pile || undefined,
        url: location.href.slice(0, 500),
      }),
    }).catch(() => {});
  } catch {
    // Rien : signaler une erreur ne doit jamais en produire une.
  }
};

/// Branche le rapporteur sur les erreurs non rattrapées de la page.
export const installerRapportErreurs = () => {
  window.addEventListener("error", (e) => {
    // Une image ou un script qui ne charge pas déclenche aussi « error »,
    // sans objet Error : ce n'est pas un bogue de l'application.
    if (e.error) signalerErreur(e.error);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const raison = e.reason;
    // Un refus de l'API (401, 403, 409…) remonte souvent en promesse non
    // rattrapée ; c'est une réponse normale, pas un bogue.
    if (raison?.status && raison.status < 500) return;
    signalerErreur(raison, "Promesse rejetée");
  });
};

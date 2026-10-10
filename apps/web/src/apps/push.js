// Notifications push : être prévenu sur cet appareil, même CompanyOS fermé.
//
// Le navigateur s'abonne auprès du service de push de son éditeur (Google,
// Mozilla, Apple, Microsoft) avec la clé publique de notre serveur ; l'API
// garde l'abonnement et y poste chaque nouvelle notification. Le service
// worker (public/push-sw.js) l'affiche, et un clic rouvre CompanyOS sur
// la bonne fiche.
//
// L'abonnement est propre à l'appareil : on l'active sur son téléphone,
// son poste du bureau, etc.

import { api } from "../api/client";
import { suivreLien } from "./notifications";

export const pushDisponible = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  typeof Notification !== "undefined";

const enregistrement = async () => {
  if (!pushDisponible()) return null;
  // `ready` ne se résout jamais sans service worker (mode développement) :
  // on n'attend pas indéfiniment.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
  ]);
};

/// « indisponible » | « refuse » | « actif » | « inactif »
export const etatPush = async () => {
  if (!pushDisponible()) return "indisponible";
  if (Notification.permission === "denied") return "refuse";
  const reg = await enregistrement();
  if (!reg) return "indisponible";
  const abonnement = await reg.pushManager.getSubscription().catch(() => null);
  return abonnement && Notification.permission === "granted" ? "actif" : "inactif";
};

const cleEnOctets = (base64) => {
  const rembourre = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const brut = atob(rembourre);
  return Uint8Array.from(brut, (c) => c.charCodeAt(0));
};

export const activerPush = async () => {
  if (!pushDisponible()) throw new Error("Ce navigateur ne sait pas recevoir de notifications push.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications refusées dans les réglages du navigateur.");
  const reg = await enregistrement();
  if (!reg) throw new Error("Service hors ligne indisponible : rechargez la page et réessayez.");
  const { cle } = await api.pushCle();
  let abonnement = await reg.pushManager.getSubscription();
  if (!abonnement) {
    abonnement = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleEnOctets(cle) });
  }
  await api.pushAbonner(abonnement.toJSON());
  return "actif";
};

export const desactiverPush = async () => {
  const reg = await enregistrement();
  const abonnement = reg && (await reg.pushManager.getSubscription().catch(() => null));
  if (abonnement) {
    await api.pushDesabonner(abonnement.endpoint).catch(() => {});
    await abonnement.unsubscribe().catch(() => {});
  }
  return "inactif";
};

/// Un clic sur une notification push : le service worker rend la main à
/// l'onglet ouvert (message) ou ouvre CompanyOS avec le lien dans l'adresse.
export const ecouterLiensPush = () => {
  if (typeof window === "undefined") return;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type === "companyos:lien" && e.data.lien?.app) suivreLien({ lien: e.data.lien });
    });
  }
  const m = window.location.hash.match(/^#lien=(.+)$/);
  if (m) {
    try {
      const lien = JSON.parse(decodeURIComponent(m[1]));
      history.replaceState(null, "", window.location.pathname + window.location.search);
      // Le shell doit d'abord avoir monté la session et les apps.
      if (lien?.app) setTimeout(() => suivreLien({ lien }), 2500);
    } catch {
      // Lien illisible : on ouvre simplement le bureau.
    }
  }
};

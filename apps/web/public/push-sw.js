// Notifications push de CompanyOS — chargé par le service worker généré
// (vite.config.js, `workbox.importScripts`).
//
// Le message arrive chiffré du service de push du navigateur ; le
// navigateur le déchiffre et nous le passe : { titre, message, lien }.

self.addEventListener("push", (event) => {
  let n = {};
  try {
    n = event.data ? event.data.json() : {};
  } catch {
    n = { titre: event.data ? event.data.text() : "CompanyOS" };
  }
  event.waitUntil(
    (async () => {
      // CompanyOS déjà au premier plan : le centre de notifications l'affiche
      // lui-même, inutile de doubler.
      const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (fenetres.some((c) => c.visibilityState === "visible" && c.focused)) return;
      await self.registration.showNotification(n.titre || "CompanyOS", {
        body: n.message || "",
        icon: "favicon.png",
        badge: "favicon.png",
        tag: n.id || undefined,
        data: { lien: n.lien || null },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const lien = event.notification.data && event.notification.data.lien;
  event.waitUntil(
    (async () => {
      const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const ouverte = fenetres.find((c) => new URL(c.url).origin === self.location.origin);
      if (ouverte) {
        await ouverte.focus();
        if (lien) ouverte.postMessage({ type: "companyos:lien", lien });
        return;
      }
      const base = new URL(self.registration.scope);
      if (lien) base.hash = `lien=${encodeURIComponent(JSON.stringify(lien))}`;
      await self.clients.openWindow(base.href);
    })(),
  );
});

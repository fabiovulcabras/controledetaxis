/* Service worker do Controle de Táxis: recebe as notificações push e abre a tela certa ao tocar. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { corpo: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.titulo || "Controle de Táxis", {
    body: d.corpo || "",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    icon: "/logo-v.png",
    badge: "/logo-v.png",
    data: { url: d.url || "/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const abertas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of abertas) {
      if (c.url === url && "focus" in c) return c.focus();
    }
    for (const c of abertas) {
      if ("navigate" in c && new URL(c.url).origin === self.location.origin) { await c.navigate(url); return c.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});

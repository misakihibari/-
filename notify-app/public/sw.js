// プッシュ受信 → 通知表示。通知はユーザーがスワイプするまで残る(requireInteraction)。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: '通知', body: event.data?.text() }; }
  event.waitUntil(
    self.registration.showNotification(d.title || '通知', {
      body: d.body || '',
      tag: d.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      requireInteraction: true,
      data: { url: d.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin) {
          await w.focus();
          w.postMessage({ type: 'open', url });
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

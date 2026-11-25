// Baudoku 2 ist entfernt. Dieser Worker ersetzt einen schon installierten
// Baudoku-2-Worker: er liefert keine alte App mehr aus, löscht nur deren
// Caches und meldet sich ab. baudoku- und gaeb-Caches bleiben.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('baudoku2-')).map((key) => caches.delete(key)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    await Promise.all(windows.map((client) => client.navigate(client.url)));
  })());
});

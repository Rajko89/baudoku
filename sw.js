// Service Worker: App-Shell offline verfügbar (Cache-first), Daten liegen in IndexedDB.
// Alle URLs werden relativ zum Skript aufgelöst, damit die App unter einem Unterpfad
// (z. B. https://rajko89.github.io/baudoku/) funktioniert.
const VERSION = 'baudoku-v1.2.0';
const ASSET_PATHS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/util.js',
  './js/media.js',
  './js/exif.js',
  './js/geom.js',
  './js/measure.js',
  './js/pdf.js',
  './js/backup.js',
  './js/sketch.js',
  './js/sketch-calc.js',
  './js/detect.js',
  './vendor/jspdf.umd.min.js',
  './vendor/jszip.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];
const assetUrl = (path) => new URL(path, self.location).href;
const ASSETS = ASSET_PATHS.map(assetUrl);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return; // z. B. Nominatim: direkt ans Netz
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request).then((res) => {
      if (res.ok) {
        const cp = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, cp));
      }
      return res;
    }).catch(() => (e.request.mode === 'navigate' ? caches.match(assetUrl('./index.html')) : Response.error())))
  );
});

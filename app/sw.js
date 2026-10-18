// Service worker: keeps the app working offline. Bump VERSION on every release so
// phones pick up the new files. Only the app's own files are cached; task data
// lives in IndexedDB and is never sent anywhere by this worker.
const VERSION = 'ppm-v1.1.0';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './js/main.js',
  './js/i18n.js',
  './js/store.js',
  './js/db.js',
  './js/platform.js',
  './js/vendor/htm-preact.js',
  './js/core/crypto.js',
  './js/core/dates.js',
  './js/core/ics.js',
  './js/core/merge.js',
  './js/core/model.js',
  './js/core/parse.js',
  './js/core/reminders.js',
  './js/core/scoring.js',
  './js/core/stats.js',
  './js/core/sync.js',
  './js/core/validate.js',
  './js/ui/agenda.js',
  './js/ui/common.js',
  './js/ui/editor.js',
  './js/ui/home.js',
  './js/ui/progress.js',
  './js/ui/projects.js',
  './js/ui/settings.js',
  './js/ui/tasks.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      try {
        return await fetch(req);
      } catch {
        if (shell) return shell;
        throw new Error('offline');
      }
    }
    return fetch(req);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const taskId = event.notification.data && event.notification.data.taskId;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all.find((c) => new URL(c.url).origin === self.location.origin);
    if (client) {
      await client.focus();
      if (taskId) client.postMessage({ type: 'OPEN_TASK', taskId });
      return;
    }
    await self.clients.openWindow(taskId ? `./?task=${encodeURIComponent(taskId)}#home` : './#home');
  })());
});

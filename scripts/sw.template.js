/*
 * NexusIDE service worker (template). The build prepends `VERSION` and `FILES`.
 * It precaches the whole build so the app, the editor, the terminal and the sandbox page work with no network,
 * and it never touches cross-origin requests. A new build installs a new cache and waits until the user reloads.
 */
const CACHE = `nexuside-${VERSION}`;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('nexuside-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async cache => {
      // ignoreVary: every cached file is a content-hashed build output, and some hosts (including `vite preview`) answer
      // with `Vary: Origin`; module scripts then carry an Origin header the precache request did not, so they would miss.
      const hit = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
      if (hit) return hit;
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return fetch(request);
    })
  );
});

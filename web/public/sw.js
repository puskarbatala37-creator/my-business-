/*
 * Slay service worker
 *  - App shell: the built app is pre-cached at install, so Slay opens instantly and even with no
 *    signal (the build fills in VERSION and PRECACHE below).
 *  - Photos: product/bill photos are kept once seen, so saved orders and stock still show them offline.
 *  - Live data (/api) is never cached here. Recently viewed orders and stock are saved by the app
 *    itself, per signed-in person, and wiped on sign-out.
 *  - Web Push for security alerts.
 */
const VERSION = self.__SLAY_VERSION__ || 'dev';
const PRECACHE = self.__SLAY_PRECACHE__ || ['/', '/manifest.webmanifest', '/icons/icon-192.png'];
const SHELL = `slay-shell-${VERSION}`;
const PHOTOS = 'slay-photos';
const MAX_PHOTOS = 400;
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== PHOTOS).map((k) => caches.delete(k))))
      .then(() => self.registration.navigationPreload?.enable())
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  // Sign-out: forget this person's photos.
  if (event.data?.type === 'clear-user-data') event.waitUntil(caches.delete(PHOTOS));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    // The customer payment page always comes from the network.
    if (url.pathname.startsWith('/pay/')) return;
    event.respondWith(navigate(event));
    return;
  }
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(photo(req));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req, SHELL));
    return;
  }
  if (/^\/(icons|splash|screenshots)\/|^\/(manifest\.webmanifest|favicon\.ico|apple-touch-icon\.png)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, SHELL));
  }
});

/** Pages: the newest version when online; the saved app instantly when offline or on a very slow line. */
async function navigate(event) {
  const cache = await caches.open(SHELL);
  const network = (async () => {
    const preloaded = await event.preloadResponse;
    const res = preloaded || (await fetch(event.request));
    if (res.ok) cache.put('/', res.clone());
    return res;
  })();
  const timeout = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch {}
  const cached = await cache.match('/');
  return cached || network;
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || fresh;
}

/** Photo file names never change, so once a photo is seen it is kept (most recent few hundred). */
async function photo(req) {
  const cache = await caches.open(PHOTOS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PHOTOS))) await cache.delete(k);
  }
  return res;
}

self.addEventListener('push', (event) => {
  let data = { title: 'Slay', body: 'New alert', url: '/' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/monochrome-512.png',
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((wins) => {
      for (const w of wins) if ('focus' in w) return w.navigate(url).then((c) => c && c.focus());
      return self.clients.openWindow(url);
    }),
  );
});

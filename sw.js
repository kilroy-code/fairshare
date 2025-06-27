const { Response, clients} = self;
const version = 'sourceV1';

async function addResourcesToCache(resources) {
  const cache = await caches.open(version);
  await cache.addAll(resources);
};

async function cacheFirstWithRefresh(event, request = event.request) {
  // Start fetching to update cache...
  const fetchResponsePromise = fetch(request)
	.then(
	  async networkResponse => { // Schedule a .then to execute on response ASYNCHRONOUSLY to match or preload, below.
	    if (networkResponse?.ok && (request.method === 'GET')) { // Cache it for next time, if we can.
	      const cache = await caches.open(version);
	      cache.put(request, networkResponse.clone());
	    }
	    return networkResponse; // Pass the networkResponse if we need it below.
	  },
	  error => { // If it fails (e.g., offline), cons a valid non-ok response to pass back to app.
	    console.log('sw fetch failed', error);
	    return new Response("Network error", {
	      status: 408,
	      headers: { "Content-Type": "text/plain" },
	    });
	  }
	);
  // ...but without waiting, use a cache hit if there is one.
  // There are rumors of in intermittent bug (Safari) in direct use of (await caches.match(request)), so open explicitly.
  // ignoreSearch so that app.html?user=mumble&group=mumble hits.
  return (await caches.open(version).then(cache => cache.match(request, {ignoreSearch: true}))) ||
    //(await event.preloadResponse) ||
    (await fetchResponsePromise);
}

// async function enablePreload() {
//   if (!self.registration.navigationPreload) return;
//   await self.registration.navigationPreload.enable();
// }

async function deleteCache(key) {
  await caches.delete(key);
};

async function deleteOldCaches(cacheKeepList = [version]) {
  const keyList = await caches.keys();
  const cachesToDelete = keyList.filter((key) => !cacheKeepList.includes(key));
  await Promise.all(cachesToDelete.map(deleteCache));
};

const vaultHost = origin.startsWith('http:/localhost') ? origin : 'https://cloud.ki1r0y.com';
const securitySource = `${vaultHost}/@ki1r0y/distributed-security/dist/`;


// EVENT HANDLERS

let update = null;
self.addEventListener('message', async event => {
  console.log('service worker got message', event.data);
  switch (event.data) {
  case 'clearSourceCache':
    await deleteOldCaches([]);
    break;
  case 'updated':
    update?.resolve?.();
    break;
  default:
    console.warn(`Unrecognized service worker message: "${event.data}".`);
  }
});

// Install all the resources we need, so that we can work offline.
// (Users, groups, and media are cached separately in indexeddb.)
self.addEventListener('install', event => {
  console.log('install', event);
  event.waitUntil(
    addResourcesToCache([
      "./app.html",
      "./script.js",

      "/@kilroy-code/ui-components/bundle.mjs",      
      "/@kilroy-code/flexstore/bundle.mjs",
      securitySource + "index-bundle.mjs",
      securitySource + "worker-bundle.mjs",
      securitySource + "vault.html",
      securitySource + "vault-bundle.mjs",

      "./style.css",
      "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap",
      "https://fonts.googleapis.com/icon?family=Material+Icons",

      "./qr-scanner.min.js",
      "https://cdn.jsdelivr.net/npm/jdenticon@3.3.0/dist/jdenticon.min.js",
      "https://unpkg.com/qr-code-styling@1.8.0/lib/qr-code-styling.js"
    ]).then(() => self.skipWaiting()) // Activate worker immediately
  );
});

self.addEventListener('activate', event => {
  console.log('activate', event);
  event.waitUntil(Promise.all([
    deleteOldCaches(),
    //enablePreload(),
    self.clients.claim() // Become available to all pages
  ]));
});

self.addEventListener('fetch', event => {
  const {request} = event; // It is conceivable that something might await before request is referenced, and find it missing.
  // E.g., Safari might define event.request only within the dynamic extent of the original event dispatch.
  event.respondWith(cacheFirstWithRefresh(event, request));
});

/*
  curl "http://localhost:3000/flexstore/poke/2GSlKfza-dvC1jme5_u24a-HvPu6ecOEXiV7wdCaSB4"
 */
self.addEventListener('push', event => {
  const url = new URL(event.data.text());
  console.log('push', url.href);
  // Resubscribe in case the existing is about to expire.
  event.waitUntil(fetch(new URL('/flexstore/publicVapidKey', url).href)
		  .then(response => response.json())
		  .then(applicationServerKey =>
		    self.registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey})));
  event.waitUntil(
    // Find a window and wake it up.
    clients.matchAll({type: 'window', includeUncontrolled: true}).then(async clients => {
      if (clients.length) {
	let resolver;
	update = new Promise(resolve => resolver = resolve);
	update.resolve = resolver;
	clients[0].postMessage('update');
	await self.registration.showNotification('fixme update', {body: event.data.text()}); // FIXME remove
	return update;
      }
      // No client window open. We should not open the app without interaction,
      // but we can display a notification that they can touch to open it (which will then sync).
      return self.registration.showNotification(`Activity at ${url.host}.`, {
	body: 'Click to launch app and synchronize.',
	icon: new URL('./images/fairshare-192.png', url).href,
	image: new URL('./images/fairshare-512.png', url).href,
	data: {url: url.href}
      });
    })
  );
});

self.addEventListener('notificationclick', event => {
  const {notification} = event;
  const {title, body, data} = notification;
  notification.close();
  if (!data) return console.log('no data in notification', notification);
  // This looks to see if the current is already open and focuses if it is. Else opens one.
  event.waitUntil(
    clients
      .matchAll({type: 'window', includeUncontrolled: true})
      .then(async clientList => {
	const url = data.url || `app.html?user=${data.aud}&group=${data.iss}#Messages`;
	console.log('hrs notificationLick', {title, body, data, url, clientList});
        for (const client of clientList) {
	  return client.navigate(url).then(() => client.focus());
        }
	return clients.openWindow(url);
      }),
  );
});

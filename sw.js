const { Response, clients} = self;
const version = 'sourceV1';

async function addResourcesToCache(resources) {
  const cache = await caches.open(version);
  await cache.addAll(resources);
};

async function cacheFirstWithRefresh(event) {
  const {request} = event;
  // Start fetching to update cache...
  const fetchResponsePromise = fetch(request)
	.catch(() => new Response("Network error", {   // If it fails (e.g., offline), cons a valid non-ok response to pass back to app.
	  status: 408,
	  headers: { "Content-Type": "text/plain" },
	}))
	.then(async (networkResponse) => { // Schedule a .then to execute on response ASYNCHRONOUSLY to match or preload, below.
	  if (networkResponse?.ok && (request.method === 'GET')) { // Cache it for next time, if we can.
	    const cache = await caches.open(version);
	    cache.put(request, networkResponse.clone());
	  }
	  return networkResponse; // Pass the networkResponse if we need it below.
	});
  // ...but without waiting, use a cache hit if there is one.
  return (await caches.match(request)) ||
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

self.addEventListener("message", async event => {
  switch (event.data) {
  case 'clearSourceCache':
    await deleteOldCaches([]);
    break;
  default:
    console.warn(`Unrecognized service worker message: "${event.data}".`);
  }
});

// Install all the resources we need, so that we can work offline.
// (Users, groups, and media are cached separately in indexeddb.)
self.addEventListener("install", (event) => {
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

self.addEventListener("fetch", (event) => {
  event.respondWith(cacheFirstWithRefresh(event));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    deleteOldCaches(),
    //enablePreload(),
    self.clients.claim() // Become available to all pages
  ]));
});

self.addEventListener("notificationclick", (event) => {
  const {notification} = event;
  const {title, body, data} = notification;
  notification.close();

  // This looks to see if the current is already open and
  // focuses if it is
  event.waitUntil(
    clients
      .matchAll({type: "window", includeUncontrolled: true})
      .then(clientList => {
	const url = `app.html?user=${data.aud}&group=${data.iss}#History`;
        for (const client of clientList) {
	  client.navigate(url);
	  client.focus();
	  return;
        }
        clients.openWindow(url);
      }),
  );
});

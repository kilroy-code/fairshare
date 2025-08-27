const { Response, clients} = self;
const version = "0.10.9";

async function getResource(request) { // Answer the previously cached source code, else just fetch normally.
  // There are rumors of in intermittent bug (Safari) in direct use of (await caches.match(request)), so open explicitly.
  return await caches.open(version).then(cache => cache.match(request, {ignoreSearch: true})) ||
    fetch(request); // Currently do not add any responses to our cache.
}

// async function enablePreload() {
//   if (!self.registration.navigationPreload) return;
//   await self.registration.navigationPreload.enable();
// }


// EVENT HANDLERS

let update = null;
self.addEventListener('message', async event => {
  console.log('service worker got message', event.data);
  const {method, params} = event.data;
  switch (method) {
  case 'updated':
    update?.resolve?.(params);
    break;
  case 'version':
    event.waitUntil(event.source.postMessage({method: 'version', params: version}));
    break;
  default:
    console.warn(`Unrecognized service worker message: "${event.data}".`);
  }
});

// Install all the resources we need, so that we can work offline.
// (Users, groups, and media are cached separately in indexeddb.)
self.addEventListener('install', event => {
  console.log('install', event, version);
  // IF a service worker is updated, the old service worker is active, and by default,
  // the new will not be activated until the old one dies. This is our only chance to
  // tell the browser to skipWaiting, and activate the new service worker right away,
  // allowing restarted main code to compare versions and bootstrap itself onto the new main code.
  //
  // However, even though skipWaiting answers a promise, we do NOT want to waitUntil it resolves
  // (as for claim in activate, below), because on Safari, that causes the new worker to activate
  // BEFORE the main script's 'installed' state change fires, thus executing with a non-null
  // serviceWorker.controller, and thus telling the user that there is a download available.
  // Fortunately, leaving out the waitUntil seems to get the expected activation timing. And indeed,
  // the MDN doc for skipWaiting does not use waitUntil either.
  //
  // Alas, there's still a screw case in Safari: The panic button unregisters service workers,
  // but in Safari, the service worker stays running until the page is closed. Even a reload
  // or setting location.href will keep the old service worker around. This means that a reload
  // after panic will cause a harmless but confusing "new version available" popup. Instead,
  // one must manually close the tab after panic.
  self.skipWaiting(); // Activate worker immediately
});

self.addEventListener('activate', event => {
  //const clientId = event.clientId;
  // event.waitUntil(enablePreload(),
  console.log('activate', event, version); //, event, clientId);
  // Apply to running clients now, so that first fresh install sees updatefound event.
  // Otherwise, the service worker wouldn't fire until the code NEXT time the page loads after
  // registration, and thus the initial load would not see any updatefound events.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const {request} = event; // It is conceivable that something might await before request is referenced, and find it missing.
  // E.g., Safari might define event.request only within the dynamic extent of the original event dispatch.
  event.respondWith(getResource(request));
});

self.addEventListener('push', event => {
  const url = new URL(event.data.text());
  console.log('push', url.href, new Date());
  // Resubscribe in case the existing is about to expire.
  event.waitUntil(fetch(new URL('/flexstore/publicVapidKey', url).href)
		  .then(response => response.json())
		  .then(applicationServerKey =>
		    self.registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey})));
  event.waitUntil(
    // Find a window and wake it up.
    clients.matchAll({type: 'window', includeUncontrolled: true}).then(clients => {
      if (clients.length) {
	let {promise, resolve} = Promise.withResolvers();
	update = promise;
	update.resolve = resolve;
	clients[0].postMessage({method: 'update', params: new URL('/flexstore/sync', url).href});

	const result = update.then(success => {
	  if (success) {
	    //return self.registration.showNotification('debug poke successful', {body: "sync'd " + success});
	    return console.log('debug poke successful', {body: "sync'd " + success});
	  } else if (success === null) {
	    return self.registration.showNotification('debug poke', {body: "No relay server is enabled."});
	  } else {
	    return self.registration.showNotification('debug poke timeout', {body: "got a push but did not sync in time"});
	  }
	});
	let resultsTimer = setTimeout(() => update.resolve(false), 20e3);
	return result;

	//return update;
      }
      // No client window open. We should not open the app without interaction,
      // but we can display a notification that they can touch to open it (which will then sync).
      const icon = new URL('./images/fairshare-192.png', url).href;
      const image = new URL('./images/fairshare-512.png', url).href;
      console.log('notification with', {url, icon, image});
      return self.registration.showNotification(`Activity at ${url.host}.`, {
	body: 'Click to launch app and synchronize.',
	tag: 'update',
	icon, image, 
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
	let url = data.url || `app.html?group=${data.iss}`;
	if (data.aud) url += `&user=${data.aud}`; // Else app must figure it out from group.
	url += '#Messages';
	console.log('notification', {title, body, data, url, clientList});
        for (const client of clientList) {
	  // focus first, because client may be different after navigation.
	  console.log('notification click found client', url);
	  return client.focus().then(() => client.navigate(url));
        }
	console.log('notification click opening client', url);
	return clients.openWindow(url);
      }),
  );
});

/**
 * Road & Recovery service worker — the minimum the offline outbox needs.
 *
 * DELIBERATELY NOT A CACHING LAYER.
 *
 * This worker caches NOTHING. Not API responses, not pages, not assets. Road &
 * Recovery is multi-tenant, and a service worker cache is keyed by URL with no
 * notion of who was signed in when the entry was written. Two users on one
 * device — a shift change on a shared yard tablet is exactly that — would share
 * a cache, and one driver could be served the other tenant's job data from disk.
 *
 * Caching correctly would mean partitioning every entry by session and purging
 * on sign-out. That is a platform-wide change with a real security surface, and
 * this phase is about queue reliability, not offline reading. So: no caching.
 *
 * What it DOES do is wake the page's outbox when the browser tells us there is a
 * reason to try again. The queue itself lives in the page, because the page owns
 * the authenticated session; the worker only says "now would be a good time".
 */

self.addEventListener("install", (event) => {
  // Take over immediately rather than waiting for every tab to close: a driver
  // who reloads should get the current worker, not the previous one.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Remove anything a previous iteration of this worker may have cached, so
      // an upgrade cannot leave tenant data on disk.
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("rr-")).map((name) => caches.delete(name)));
      await self.clients.claim();
    })()
  );
});

/**
 * No fetch handler.
 *
 * Omitting it entirely is the point: every request goes straight to the network
 * exactly as it would without a worker, so authentication, session refresh and
 * tenant scoping behave identically and nothing is stored.
 */

/** Tell every open tab to drain its queue. */
async function askClientsToDrain() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: "rr-outbox-drain" });
  }
}

// Background Sync, where the browser supports it: fires when connectivity is
// restored, including after the tab was closed and reopened.
self.addEventListener("sync", (event) => {
  if (event.tag === "rr-outbox") {
    event.waitUntil(askClientsToDrain());
  }
});

// A page can also ask directly — used on reconnect in browsers without Sync.
self.addEventListener("message", (event) => {
  if (event.data?.type === "rr-outbox-drain-request") {
    event.waitUntil(askClientsToDrain());
  }
});

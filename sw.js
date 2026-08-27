// Service worker: cache-first for same-origin, network passthrough for
// fonts/cross-origin. Bump VERSION on every deploy (CLAUDE.md rule) — this
// both busts the cache and drives the "update available" toast (DESIGN §11).
"use strict";

var VERSION = "v9";
var CACHE_NAME = "mathtrainer-" + VERSION;
// core.js is referenced as core.js?v=<APP_VERSION> from index.html so an
// uncontrolled load can never pair a fresh page with an HTTP-cached old core.
var PRECACHE_URLS = ["./", "index.html", "core.js", "core.js?v=0.8.0", "manifest.webmanifest", "icon-180.png", "icon-512.png"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // cache: "reload" bypasses the HTTP cache so a new VERSION never
      // precaches a stale core.js next to a fresh index.html (version skew
      // seen live on 2026-08-27: old core.js + new index.html froze feedback).
      .then(function (cache) {
        return cache.addAll(PRECACHE_URLS.map(function (url) { return new Request(url, { cache: "reload" }); }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names.filter(function (name) { return name !== CACHE_NAME; }).map(function (name) { return caches.delete(name); })
        );
      })
      .then(function () { return self.clients.claim(); })
      .then(function () { return notifyClients(); })
  );
});

function notifyClients() {
  return self.clients.matchAll().then(function (clients) {
    clients.forEach(function (client) {
      client.postMessage({ type: "updated", version: VERSION });
    });
  });
}

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return; // network passthrough (fonts, etc.) — not intercepted, not cached
  }
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request);
    })
  );
});

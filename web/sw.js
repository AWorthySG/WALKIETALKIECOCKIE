// Cache the app shell only. API responses, sessions and voice are never cached.
const CACHE = 'cockie-shell-v2-4';
const SHELL = ['/', '/app.css', '/app.js', '/icon.svg', '/sticker.webp', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/icon-maskable.png', '/manifest.webmanifest', '/fonts/nunito-400.woff2', '/fonts/nunito-600.woff2', '/fonts/nunito-700.woff2', '/fonts/nunito-800.woff2', '/fonts/nunito-900.woff2'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => (key.startsWith('relay-shell-') || key.startsWith('cockie-shell-')) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(url.pathname).then(response => response || new Response('Connect to the internet to open Cockie Talkie.', { status: 503 }))));
});

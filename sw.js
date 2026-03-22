// Hyperspeed proxy service worker
importScripts('/hyperspeed.bundle.js');
importScripts('/hyperspeed.config.js');
importScripts('/hyperspeed.mux.js');

const hyperspeed = new HyperspeedServiceWorker();
const mux = new BareMux.BareClient();

// Set our custom transport
async function initTransport() {
  await mux.setTransport('/transport.js', []);
}

self.addEventListener('install', (e) => {
  e.waitUntil(Promise.all([self.skipWaiting(), initTransport()]));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // SW health check
  if (url.pathname === '/sw-check') {
    e.respondWith(new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' }
    }));
    return;
  }

  // Hyperspeed handles everything under /proxy/
  if (hyperspeed.route(e)) {
    e.respondWith(hyperspeed.fetch(e).catch(err =>
      new Response('Proxy error: ' + err.message, { status: 500 })
    ));
    return;
  }
});
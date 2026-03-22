importScripts('/hyperspeed.bundle.js');
importScripts('/hyperspeed.config.js');

const WORKER_URL = 'https://lumatest.craftedgamz.workers.dev';

// Replace BareClient with a direct fetch to our CF Worker
// hyperspeed.sw.js expects: { rawHeaders, status, statusText, body, finalURL, text() }
class DirectBareClient {
  async fetch(url, options = {}) {
    const target = url instanceof URL ? url.href : String(url);
    const fetchURL = WORKER_URL + '?url=' + encodeURIComponent(target);

    const res = await fetch(fetchURL, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body || null,
      credentials: 'omit',
    });

    const rawHeaders = {};
    for (const [k, v] of res.headers.entries()) {
      rawHeaders[k] = v;
    }

    // Buffer body so both .body (stream) and .text() work independently
    const bodyBuf = await res.arrayBuffer();

    return {
      status: res.status,
      statusText: res.statusText,
      rawHeaders,
      finalURL: res.url || target,
      body: new Uint8Array(bodyBuf),
      text: () => Promise.resolve(new TextDecoder().decode(bodyBuf)),
    };
  }
}

// Patch Hyperspeed.BareClient before loading the SW class
self.Ultraviolet = self.Hyperspeed;
self.Ultraviolet.BareClient = DirectBareClient;
self.Hyperspeed.BareClient = DirectBareClient;

importScripts('/hyperspeed.sw.js');

let hyperspeed = null;
try {
  hyperspeed = new HyperspeedServiceWorker();
  console.log('[SW] ready');
} catch(e) {
  console.error('[SW] init failed:', e);
}

self.addEventListener('install', e => {
  console.log('[SW] install');
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', e => {
  console.log('[SW] activate');
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.pathname === '/sw-check') {
    e.respondWith(new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' }
    }));
    return;
  }

  if (hyperspeed && hyperspeed.route(e)) {
    e.respondWith(hyperspeed.fetch(e).catch(err => {
      console.error('[SW] fetch error:', err);
      return new Response('Proxy error: ' + err.message, { status: 500 });
    }));
    return;
  }
});
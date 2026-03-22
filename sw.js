importScripts('/hyperspeed.bundle.js');
importScripts('/hyperspeed.config.js');

const WORKER_URL = 'https://lumatest.craftedgamz.workers.dev';

// Replace BareClient with a direct fetch to our CF Worker.
// hyperspeed.sw.js expects: { rawHeaders, status, statusText, body, finalURL, text() }
class DirectBareClient {
  async fetch(url, options = {}) {
    const target = url instanceof URL ? url.href : String(url);
    const fetchURL = WORKER_URL + '?url=' + encodeURIComponent(target);

    const method = (options.method || 'GET').toUpperCase();

    // The SW passes body as a Blob (from await e.blob()).
    // Force null for GET/HEAD regardless of what was passed.
    let body = null;
    if (!['GET', 'HEAD'].includes(method) && options.body != null) {
      body = options.body;
    }

    let res;
    try {
      res = await fetch(fetchURL, {
        method,
        headers: options.headers || {},
        body,
        // SW fetches are still subject to CORS. Setting mode:'cors' and
        // credentials:'omit' avoids preflight credential checks.
        // The CF worker must echo back the requesting origin as ACAO.
        mode: 'cors',
        credentials: 'omit',
        redirect: 'follow',
      });
    } catch (networkErr) {
      // CF worker unreachable — return synthetic 502 so hyperspeed.sw.js
      // doesn't throw and produce an unhandled 500.
      console.warn('[DirectBareClient] network error:', networkErr.message);
      const empty = new Uint8Array(0);
      return {
        status: 502,
        statusText: 'Bad Gateway',
        rawHeaders: { 'content-type': 'text/plain' },
        finalURL: target,
        body: empty,
        text: () => Promise.resolve(''),
      };
    }

    // Build rawHeaders object (hyperspeed.sw.js iterates with for...in)
    const rawHeaders = {};
    for (const [k, v] of res.headers.entries()) {
      rawHeaders[k] = v;
    }

    // x-final-url is set by our CF worker to the real post-redirect URL.
    // res.url here would be the CF worker's own URL, not the target's.
    const finalURL = rawHeaders['x-final-url'] || target;

    // Buffer the body once so both .body and .text() work independently.
    let bodyBuf;
    try {
      bodyBuf = await res.arrayBuffer();
    } catch (bodyErr) {
      console.warn('[DirectBareClient] body read error:', bodyErr.message);
      bodyBuf = new ArrayBuffer(0);
    }

    const bodyBytes = new Uint8Array(bodyBuf);
    let cachedText = null;
    const getText = () => {
      if (cachedText === null) cachedText = new TextDecoder().decode(bodyBuf);
      return Promise.resolve(cachedText);
    };

    return {
      status: res.status,
      statusText: res.statusText || 'OK',
      rawHeaders,
      finalURL,
      body: bodyBytes,
      text: getText,
    };
  }
}

// Patch Hyperspeed.BareClient before loading the SW class
self.Ultraviolet = self.Hyperspeed;
self.Ultraviolet.BareClient = DirectBareClient;
self.Hyperspeed.BareClient = DirectBareClient;

// Suppress bare-mux BroadcastChannel errors in the SW context.
// When worker-destination scripts are injected, the bundle initialises bare-mux
// which creates a BroadcastChannel and may try to read localStorage — both can
// throw or misbehave inside a SW. Wrap BroadcastChannel to swallow those errors.
if (typeof BroadcastChannel !== 'undefined') {
  const _OrigBC = BroadcastChannel;
  self.BroadcastChannel = class SafeBroadcastChannel extends _OrigBC {
    constructor(name) {
      try { super(name); } catch(e) { /* ignore */ }
    }
    set onmessage(fn) { try { super.onmessage = fn; } catch(e) {} }
    get onmessage() { try { return super.onmessage; } catch(e) { return null; } }
  };
}

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
importScripts('/hyperspeed/hyperspeed.bundle.js');
importScripts('/hyperspeed/hyperspeed.config.js');
const WORKER_URL = 'https://lumatest.craftedgamz.workers.dev';
class DirectBareClient {
  async fetch(url, options = {}) {
    const target = url instanceof URL ? url.href : String(url);
    const fetchURL = WORKER_URL + '?url=' + encodeURIComponent(target);

    const method = (options.method || 'GET').toUpperCase();
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
        mode: 'cors',
        credentials: 'omit',
        redirect: 'follow',
      });
    } catch (networkErr) {
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

    const rawHeaders = {};
    for (const [k, v] of res.headers.entries()) {
      rawHeaders[k] = v;
    }

    const finalURL = rawHeaders['x-final-url'] || target;

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

self.Ultraviolet = self.Hyperspeed;
self.Ultraviolet.BareClient = DirectBareClient;
self.Hyperspeed.BareClient = DirectBareClient;

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

importScripts('/hyperspeed/hyperspeed.sw.js');

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
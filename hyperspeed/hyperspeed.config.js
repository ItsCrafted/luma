self.__hyperspeed$config = {
  prefix: '/hypertunnel/',
  encodeUrl: (url) => encodeURIComponent(btoa(url)),
  decodeUrl: (str) => {
    try {
      return atob(decodeURIComponent(str));
    } catch(e) {
      // Fallback: strip trailing padding issues and retry
      try {
        const s = decodeURIComponent(str).replace(/[^A-Za-z0-9+/=]/g, '');
        return atob(s);
      } catch(e2) {
        return decodeURIComponent(str);
      }
    }
  },
  handler: '/hyperspeed/hyperspeed.handler.js',
  client:  '/hyperspeed/hyperspeed.client.js',
  bundle:  '/hyperspeed/hyperspeed.bundle.js',
  config:  '/hyperspeed/hyperspeed.config.js',
  sw:      '/sw.js',
};

// ── No bare-mux patch ────────────────────────────────────────────────────────
// We use DirectBareClient in the SW and don't need bare-mux anywhere.
// The bundle and client both try to instantiate BareMuxConnection (reads
// localStorage["bare-mux-path"]) when spawning Workers or creating a
// page-side BareClient with no args. Both paths throw without a SharedWorker.
// We kill those paths here, after the bundle has loaded but before the handler
// runs (injection order: inline-cookies → bundle → client → config → handler).
(function patchOutBareMux() {
  // 1. Replace Hyperspeed.BareClient with a no-op so new m.BareClient() in the
  //    handler (page context, h===false branch) never touches bare-mux.
  if (self.Hyperspeed) {
    self.Hyperspeed.BareClient = class NoOpBareClient {
      constructor() {}
      async fetch() { return new Response('', { status: 200 }); }
      createWebSocket() { throw new Error('WebSocket not supported in no-bare-mux mode'); }
    };
    // Keep Ultraviolet alias in sync (sw.js aliases it)
    if (self.Ultraviolet) self.Ultraviolet.BareClient = self.Hyperspeed.BareClient;
  }

  // 2. Patch UVClient.workers.overrideWorker so it doesn't try to create a
  //    BareMuxConnection to forward a port into spawned Workers.
  //    The original overrideWorker wraps window.Worker and does:
  //      let c = new i.target(...); let l = new b(); (await l.getInnerPort()) → throws
  //    We replace it with a version that just rewrites the URL, no port forwarding.
  if (self.UVClient) {
    const _orig = self.UVClient.prototype.constructor;
    // Hook into instance creation: after UVClient is newed, replace workers.overrideWorker
    const origInit = self.UVClient;
    // We can't easily intercept the constructor, so we patch the prototype method directly.
    const workersProto = Object.getPrototypeOf(
      new self.UVClient(self, null, false).workers
    );
    if (workersProto && workersProto.overrideWorker) {
      workersProto.overrideWorker = function () {
        // Minimal Worker override: only rewrite the URL, no bare-mux port.
        this.ctx.override(this.window, 'Worker', (orig, thisArg, args) => {
          if (!args.length) return new orig(...args);
          const [url, opts = {}] = args;
          const rewritten = this.ctx.meta
            ? this.ctx.meta.rewriteUrl
              ? this.ctx.meta.rewriteUrl(url)
              : url
            : url;
          try {
            return new orig(rewritten, opts);
          } catch (e) {
            // Cross-origin Worker URLs (e.g. reCAPTCHA) throw SecurityError.
            // Return a no-op EventTarget so callers don't crash.
            console.warn('[hyperspeed] Worker blocked (cross-origin):', url);
            const stub = new EventTarget();
            stub.postMessage = () => {};
            stub.terminate = () => {};
            return stub;
          }
        }, true);
      };
    }
  }
})();
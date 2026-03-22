// Minimal bare-mux transport that proxies through our CF Worker
// This is loaded as an ES module by bare-mux's SharedWorker

const WORKER_URL = 'https://lumatest.craftedgamz.workers.dev';

export default class WorkerTransport {
  constructor() {
    this.ready = false;
  }

  async init() {
    this.ready = true;
  }

  async request(remote, method, body, headers, signal) {
    // remote is a URL object
    const url = WORKER_URL + '?url=' + encodeURIComponent(remote.href);
    
    const reqHeaders = {};
    if (headers) {
      if (headers instanceof Headers) {
        for (const [k, v] of headers.entries()) reqHeaders[k] = v;
      } else {
        Object.assign(reqHeaders, headers);
      }
    }

    const res = await fetch(url, {
      method: method || 'GET',
      headers: reqHeaders,
      body: body || null,
      signal,
    });

    // bare-mux expects: { status, statusText, headers, body, finalURL }
    const resHeaders = {};
    for (const [k, v] of res.headers.entries()) resHeaders[k] = v;

    return {
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders,
      body: res.body,
      finalURL: res.url || remote.href,
    };
  }

  connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
    // WebSocket proxying — tunnel via CF Worker
    const wsURL = WORKER_URL.replace('https://', 'wss://').replace('http://', 'ws://') 
      + '/ws?url=' + encodeURIComponent(url.href);
    
    const ws = new WebSocket(wsURL, protocols);
    ws.binaryType = 'arraybuffer';
    
    ws.onopen = () => onopen(ws.protocol, {});
    ws.onmessage = (e) => onmessage(e.data);
    ws.onclose = (e) => onclose(e.code, e.reason, e.wasClean);
    ws.onerror = () => onerror(new Error('WebSocket error'));
    
    return {
      send: (data) => ws.send(data),
      close: (code, reason) => ws.close(code, reason),
    };
  }
}
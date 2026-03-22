let bareServer = null;

self.addEventListener('message', e => {
  if (e.data?.type === 'config') {
    bareServer = e.data.bare;
    console.log('[SW] bare set:', bareServer);
  }
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.pathname === '/sw-check') {
    e.respondWith(new Response(JSON.stringify({ ok: true, bare: bareServer }), {
      headers: { 'content-type': 'application/json' }
    }));
    return;
  }

  if (!url.pathname.startsWith('/proxy/')) return;

  const withoutPrefix = url.pathname.slice('/proxy/'.length);
  const slashIdx = withoutPrefix.indexOf('/');
  const encoded = slashIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, slashIdx);
  const pathAfter = slashIdx === -1 ? '/' : withoutPrefix.slice(slashIdx);

  let origin;
  try { origin = atob(encoded); } catch {
    e.respondWith(new Response('Bad proxy URL', { status: 400 }));
    return;
  }

  const qBare = url.searchParams.get('__bare');
  if (qBare && !bareServer) bareServer = qBare;

  const forwardParams = new URLSearchParams(url.search);
  forwardParams.delete('__bare');
  const forwardSearch = forwardParams.size ? '?' + forwardParams.toString() : '';
  const targetURL = origin.replace(/\/$/, '') + pathAfter + forwardSearch;

  e.respondWith(proxyFetch(targetURL, e.request));
});

// ── Wisp connection pool ───────────────────────────────────────────────────
const wispPool = new Map();

class WispConnection {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.streams = new Map();
    this.nextId = 1;
    this.ready = false;
    this.greetingDone = false;
    this._resolveGreeting = null;
    this._greetingPromise = new Promise(r => this._resolveGreeting = r);
    this._connectPromise = this._connect();
  }

  _connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      const t = setTimeout(() => { ws.close(); reject(new Error('WS timeout')); }, 10000);

      ws.addEventListener('open', () => {
        clearTimeout(t);
        this.ready = true;
        console.log('[Wisp] WS open to', this.url);
        resolve();
      });
      ws.addEventListener('message', e => this._onframe(new Uint8Array(e.data)));
      ws.addEventListener('close', () => {
        this.ready = false;
        for (const s of this.streams.values()) s._close(-1);
        this.streams.clear();
        wispPool.delete(this.url);
      });
      ws.addEventListener('error', () => {
        clearTimeout(t);
        reject(new Error('WS error'));
        wispPool.delete(this.url);
      });
    });
  }

  _onframe(buf) {
    if (buf.length < 5) return;
    const type = buf[0];
    const sid = buf[1] | (buf[2]<<8) | (buf[3]<<16) | (buf[4]<<24);
    const payload = buf.slice(5);

    if (sid === 0) {
      if (!this.greetingDone) {
        this.greetingDone = true;
        console.log('[Wisp] greeting resolved');
        this._resolveGreeting();
      }
      return;
    }

    const stream = this.streams.get(sid);
    if (!stream) return;

    if (type === 0x02) {
      stream._ondata(payload);
    } else if (type === 0x03) {
      console.log('[Wisp] close stream', sid, 'reason', payload[0]);
      stream._close(payload[0] ?? 0);
      this.streams.delete(sid);
    } else if (type === 0x04) {
      // CONTINUE — send ack back
      const f = new Uint8Array(9);
      f[0] = 0x04;
      f[1] = sid&0xFF; f[2] = (sid>>8)&0xFF; f[3] = (sid>>16)&0xFF; f[4] = (sid>>24)&0xFF;
      const b = 0xFFFFFF;
      f[5] = b&0xFF; f[6] = (b>>8)&0xFF; f[7] = (b>>16)&0xFF; f[8] = (b>>24)&0xFF;
      this.ws.send(f);
    }
  }

  async openStream(host, port) {
    await this._greetingPromise;
    console.log('[Wisp] opening stream to', host, port);

    const sid = this.nextId++;
    const hostBytes = new TextEncoder().encode(host);
    const frame = new Uint8Array(1 + 4 + 1 + 2 + hostBytes.length);
    let o = 0;
    frame[o++] = 0x01;
    frame[o++] = sid&0xFF; frame[o++] = (sid>>8)&0xFF;
    frame[o++] = (sid>>16)&0xFF; frame[o++] = (sid>>24)&0xFF;
    frame[o++] = 0x01; // TCP — Worker handles TLS itself via fetch()
    frame[o++] = port&0xFF; frame[o++] = (port>>8)&0xFF;
    frame.set(hostBytes, o);
    this.ws.send(frame);

    const stream = new WispStream(sid, this.ws);
    this.streams.set(sid, stream);
    return stream;
  }
}

class WispStream {
  constructor(sid, ws) {
    this.sid = sid;
    this.ws = ws;
    this._chunks = [];
    this._datacb = null;
    this._closecb = null;
    this._closed = false;
  }
  send(data) {
    const payload = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
    const f = new Uint8Array(5 + payload.length);
    f[0] = 0x02;
    f[1] = this.sid&0xFF; f[2] = (this.sid>>8)&0xFF;
    f[3] = (this.sid>>16)&0xFF; f[4] = (this.sid>>24)&0xFF;
    f.set(payload, 5);
    this.ws.send(f);
  }
  _ondata(chunk) {
    if (this._datacb) this._datacb(chunk);
    else this._chunks.push(chunk);
  }
  _close(reason) {
    this._closed = true;
    if (this._closecb) this._closecb(reason);
  }
  onData(cb) {
    this._datacb = cb;
    while (this._chunks.length) cb(this._chunks.shift());
  }
  onClose(cb) {
    this._closecb = cb;
    if (this._closed) cb(0);
  }
}

async function getWisp(url) {
  if (wispPool.has(url)) {
    const c = wispPool.get(url);
    if (c.ready) return c;
  }
  const c = new WispConnection(url);
  wispPool.set(url, c);
  await c._connectPromise;
  return c;
}

// ── Chunked decoder ────────────────────────────────────────────────────────
function decodeChunked(data) {
  const result = [];
  let i = 0;
  while (i < data.length) {
    let lineEnd = i;
    while (lineEnd < data.length - 1 && !(data[lineEnd]===13 && data[lineEnd+1]===10)) lineEnd++;
    if (lineEnd >= data.length - 1) break;
    const sizeLine = new TextDecoder().decode(data.slice(i, lineEnd)).trim().split(';')[0];
    const chunkSize = parseInt(sizeLine, 16);
    if (isNaN(chunkSize) || chunkSize === 0) break;
    i = lineEnd + 2;
    if (i + chunkSize > data.length) break;
    result.push(data.slice(i, i + chunkSize));
    i += chunkSize + 2;
  }
  const total = result.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of result) { out.set(c, off); off += c.length; }
  return out;
}

// ── Proxy fetch ────────────────────────────────────────────────────────────
async function proxyFetch(targetURL, originalRequest, hops=0) {
  if (!bareServer) return new Response('Bare server not configured', { status: 500 });
  if (hops > 5) return new Response('Too many redirects', { status: 508 });

  let wsURL = bareServer.replace(/\/$/, '');
  if (wsURL.startsWith('https://')) wsURL = 'wss://' + wsURL.slice(8);
  else if (wsURL.startsWith('http://')) wsURL = 'ws://' + wsURL.slice(7);
  if (!wsURL.endsWith('/')) wsURL += '/';

  const parsed = new URL(targetURL);
  const host = parsed.hostname;
  const isHTTPS = parsed.protocol === 'https:';
  const port = parseInt(parsed.port) || (isHTTPS ? 443 : 80);
  const path = (parsed.pathname || '/') + (parsed.search || '');

  let bodyBytes = null;
  if (!['GET','HEAD'].includes(originalRequest.method)) {
    bodyBytes = new Uint8Array(await originalRequest.arrayBuffer());
  }

  // Raw HTTP request — Worker uses fetch() internally so handles TLS fine
  const reqLines = [
    `${originalRequest.method} ${path} HTTP/1.1`,
    `Host: ${host}`,
    `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`,
    `Accept: ${originalRequest.headers.get('accept') || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'}`,
    `Accept-Language: en-US,en;q=0.9`,
    `Connection: close`,
  ];
  if (bodyBytes?.length) {
    reqLines.push(`Content-Length: ${bodyBytes.length}`);
    const ct = originalRequest.headers.get('content-type');
    if (ct) reqLines.push(`Content-Type: ${ct}`);
  }
  const reqBytes = new TextEncoder().encode(reqLines.join('\r\n') + '\r\n\r\n');

  let wisp;
  try { wisp = await getWisp(wsURL); }
  catch(e) { return new Response('Wisp connect failed: ' + e.message, { status: 502 }); }

  let stream;
  try { stream = await wisp.openStream(host, port); }
  catch(e) { return new Response('Wisp stream failed: ' + e.message, { status: 502 }); }

  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      resolve(new Response('Wisp stream timed out', { status: 504 }));
    }, 15000);

    const chunks = [];
    let resolved = false;
    let rawTransferEncoding = '';

    function buildResponse() {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);

      const total = chunks.reduce((s, c) => s + c.length, 0);
      const all = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { all.set(c, off); off += c.length; }

      let bodyOff = 0;
      for (let i = 0; i < all.length - 3; i++) {
        if (all[i]===13 && all[i+1]===10 && all[i+2]===13 && all[i+3]===10) {
          bodyOff = i + 4; break;
        }
      }

      const headerText = new TextDecoder().decode(all.slice(0, bodyOff));
      const rawBody = all.slice(bodyOff);
      const lines = headerText.split('\r\n');

      let status = 200;
      const statusMatch = lines[0]?.match(/HTTP\/[\d.]+ (\d+)/);
      if (statusMatch) status = parseInt(statusMatch[1]);

      const safeHeaders = new Headers();
      const strip = new Set(['content-encoding','transfer-encoding','content-length',
        'x-frame-options','content-security-policy','strict-transport-security','x-content-type-options']);
      for (let i = 1; i < lines.length; i++) {
        const colon = lines[i].indexOf(':');
        if (colon < 1) continue;
        const k = lines[i].slice(0, colon).trim().toLowerCase();
        const v = lines[i].slice(colon + 1).trim();
        if (k === 'transfer-encoding') rawTransferEncoding = v.toLowerCase();
        if (!strip.has(k)) try { safeHeaders.append(k, v); } catch {}
      }

      // Follow redirects — resolve Location relative to targetURL
      if ([301,302,303,307,308].includes(status)) {
        const loc = safeHeaders.get('location');
        if (loc) {
          try {
            const abs = new URL(loc, targetURL).href;
            const nextMethod = (status === 303 || ((status === 301 || status === 302) && originalRequest.method === 'POST')) ? 'GET' : originalRequest.method;
            const nextReq = { method: nextMethod, headers: originalRequest.headers };
            resolve(proxyFetch(abs, nextReq, hops + 1));
            return;
          } catch(err) {
            console.log('[SW] redirect failed:', err);
          }
        }
      }

      const isChunked = rawTransferEncoding.includes('chunked');
      const body = isChunked ? decodeChunked(rawBody) : rawBody;

      // Use x-final-url as rewrite base if the Worker followed a redirect
      const finalURL = safeHeaders.get('x-final-url') || targetURL;
      safeHeaders.delete('x-final-url');

      const ctype = (safeHeaders.get('content-type') || '').toLowerCase();
      if (ctype.includes('text/html')) {
        resolve(new Response(rewriteHTML(new TextDecoder().decode(body), finalURL), { status, headers: safeHeaders }));
      } else if (ctype.includes('text/css')) {
        resolve(new Response(rewriteCSS(new TextDecoder().decode(body), finalURL), { status, headers: safeHeaders }));
      } else {
        resolve(new Response(body, { status, headers: safeHeaders }));
      }
    }

    let contentLength = -1; // will be set once headers arrive
    let headersParsed = false;
    let headerEndOffset = 0;
    let totalReceived = 0;

    stream.onData(chunk => {
      const b = new Uint8Array(chunk);
      chunks.push(b);
      totalReceived += b.length;

      // Parse Content-Length from headers once we have them
      if (!headersParsed) {
        const soFar = new Uint8Array(chunks.reduce((s,c)=>s+c.length,0));
        let o=0; for(const c of chunks){soFar.set(c,o);o+=c.length;}
        for (let i = 0; i < soFar.length - 3; i++) {
          if (soFar[i]===13&&soFar[i+1]===10&&soFar[i+2]===13&&soFar[i+3]===10) {
            headersParsed = true;
            headerEndOffset = i + 4;
            const hdrs = new TextDecoder().decode(soFar.slice(0, i));
            const clMatch = hdrs.match(/content-length:\s*(\d+)/i);
            if (clMatch) contentLength = parseInt(clMatch[1]);
            const teMatch = hdrs.match(/transfer-encoding:\s*([^\r\n]+)/i);
            if (teMatch) rawTransferEncoding = teMatch[1].toLowerCase();
            break;
          }
        }
      }

      // Resolve when Content-Length bytes of body received
      if (headersParsed && contentLength >= 0) {
        const bodyReceived = totalReceived - headerEndOffset;
        if (bodyReceived >= contentLength) {
          buildResponse();
          return;
        }
      }

      // Detect chunked EOF: "0\r\n\r\n" — check across chunk boundary
      if (rawTransferEncoding.includes('chunked') || !headersParsed) {
        const last = new Uint8Array(Math.min(totalReceived, 8));
        let pos = totalReceived - last.length;
        let li = 0;
        for (const c of chunks) {
          for (let i = 0; i < c.length; i++) {
            if (pos + i >= totalReceived - last.length) last[li++] = c[i];
          }
          pos += c.length;
        }
        for (let i = 0; i <= last.length - 5; i++) {
          if (last[i]===48&&last[i+1]===13&&last[i+2]===10&&last[i+3]===13&&last[i+4]===10) {
            buildResponse();
            return;
          }
        }
      }
    });

    stream.onClose(() => buildResponse());

    stream.send(reqBytes);
    if (bodyBytes?.length) stream.send(bodyBytes);
  });
}

// ── URL rewriting ──────────────────────────────────────────────────────────
function toProxyURL(url, base) {
  try {
    if (url.startsWith('//')) url = 'https:' + url;
    const abs = new URL(url, base);
    if (!abs.protocol.startsWith('http')) return url;
    const bareParam = bareServer ? '__bare=' + encodeURIComponent(bareServer) : '';
    const sep = abs.search ? '&' : '?';
    const q = bareParam ? sep + bareParam : '';
    return '/proxy/' + btoa(abs.origin) + abs.pathname + abs.search + q + abs.hash;
  } catch { return url; }
}

function rewriteHTML(html, base) {
  const bare = bareServer || '';

  // Rewrite only HTML attributes — skip content inside <script> and <style> tags
  // by splitting on them and only processing non-script sections
  function rewriteAttrs(chunk) {
    chunk = chunk.replace(/\b(src|href|action|poster|data|formaction)\s*=\s*"([^"]+)"/gi, (m, a, u) =>
      /^(data:|blob:|#|javascript:)/i.test(u.trim()) ? m : `${a}="${toProxyURL(u.trim(), base)}"`);
    chunk = chunk.replace(/\b(src|href|action|poster|data|formaction)\s*=\s*'([^']+)'/gi, (m, a, u) =>
      /^(data:|blob:|#|javascript:)/i.test(u.trim()) ? m : `${a}='${toProxyURL(u.trim(), base)}'`);
    chunk = chunk.replace(/\bsrcset\s*=\s*"([^"]+)"/gi, (m, ss) =>
      'srcset="' + ss.split(',').map(s => { const p=s.trim().split(/\s+/); p[0]=toProxyURL(p[0],base); return p.join(' '); }).join(', ') + '"');
    chunk = chunk.replace(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, '');
    return chunk;
  }

  // Split HTML into script/style blocks and everything else, only rewrite outside
  const parts = html.split(/(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>)/gi);
  html = parts.map((part, i) => {
    // Odd indices are the captured script/style blocks — don't rewrite inside them
    if (i % 2 === 1) return part;
    return rewriteAttrs(part);
  }).join('');

  const rt = `<script>(function(){
  var _b=${JSON.stringify(bare)};
  function _p(u){try{if(!u||typeof u!=='string'||/^(data:|blob:|#|javascript:)/i.test(u))return u;if(u.startsWith('//'))u='https:'+u;var a=new URL(u,location.href);if(!a.protocol.startsWith('http'))return u;var _q=a.search?'&':'?';return'/proxy/'+btoa(a.origin)+a.pathname+a.search+(_b?_q+'__bare='+encodeURIComponent(_b):'')+a.hash;}catch(e){return u;}}
  var _f=self.fetch;self.fetch=function(u,o){return _f(typeof u==='string'?_p(u):u,o);};
  var _x=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){return _x.apply(this,[m,_p(u)].concat([].slice.call(arguments,2)));};
  history.pushState=new Proxy(history.pushState,{apply(t,th,a){a[2]=_p(a[2]);return Reflect.apply(t,th,a);}});
  history.replaceState=new Proxy(history.replaceState,{apply(t,th,a){a[2]=_p(a[2]);return Reflect.apply(t,th,a);}});
  // Intercept dynamic iframe/script src assignment
  var _dsd=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'src')||Object.getOwnPropertyDescriptor(Element.prototype,'src');
  if(_dsd&&_dsd.set){var _ss=_dsd.set;Object.defineProperty(HTMLElement.prototype,'src',{get:_dsd.get,set:function(v){return _ss.call(this,_p(v));},configurable:true});}
  // Intercept window.location.href assignment
  try{var _loc=Object.getOwnPropertyDescriptor(window,'location');if(_loc){var _href=Object.getOwnPropertyDescriptor(Location.prototype,'href');if(_href&&_href.set){var _hs=_href.set;Object.defineProperty(Location.prototype,'href',{get:_href.get,set:function(v){return _hs.call(this,_p(v));},configurable:true});}}}catch(e){}
  // Intercept document.createElement to catch programmatic iframe creation
  var _ce=document.createElement.bind(document);document.createElement=function(tag){var el=_ce(tag);if(/^(iframe|frame|script|img|source)$/i.test(tag)){var d=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'src')||{};if(d.set){var os=d.set;Object.defineProperty(el,'src',{get:d.get,set:function(v){return os.call(this,_p(v));},configurable:true});}}return el;};
  // Strip meta CSP tags
  document.addEventListener('DOMContentLoaded',function(){document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach(function(m){m.remove();});});
})();<\/script>`;
  return html.replace(/(<head\b[^>]*>)/i, '$1' + rt);
}

function rewriteCSS(css, base) {
  return css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (m, u) => {
    u = u.trim();
    if (/^(data:|blob:)/i.test(u)) return m;
    return `url('${toProxyURL(u, base)}')`;
  });
}
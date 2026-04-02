// SW_VERSION: 4 — bump this number to force the browser to reload the SW
const SW_VERSION = 10;

importScripts('/hyperspeed/hyperspeed.bundle.js');
importScripts('/hyperspeed/hyperspeed.config.js');

const WORKER_URL = 'https://lumatest.craftedgamz.workers.dev';
const WISP_URL   = 'wss://public-steffane-crafted-gamz-c6318a33.koyeb.app/';

console.log(`[SW] version ${SW_VERSION} loading`);

// ═══════════════════════════════════════════════════════════════════
// Wisp protocol — binary framing over a shared multiplexed WebSocket
// ═══════════════════════════════════════════════════════════════════
const W_CONNECT = 0x01, W_DATA = 0x03, W_CLOSE = 0x04;

let wispWS = null, wispReady = false, wispConnecting = null;
const wispStreams = new Map();
let nextSid = 1;

function mkSid() { const id = nextSid; nextSid = (nextSid + 1) >>> 0 || 1; return id; }

function frame(type, sid, payload) {
  const f = new Uint8Array(5 + payload.length);
  const dv = new DataView(f.buffer);
  dv.setUint8(0, type); dv.setUint32(1, sid, true); f.set(payload, 5); return f;
}

function connectWisp() {
  if (wispReady && wispWS && wispWS.readyState === WebSocket.OPEN) return Promise.resolve();
  if (wispConnecting) return wispConnecting;
  wispConnecting = new Promise((resolve, reject) => {
    let ws; try { ws = new WebSocket(WISP_URL); } catch(e) { wispConnecting=null; reject(e); return; }
    ws.binaryType = 'arraybuffer';
    const timer = setTimeout(() => { ws.close(); wispConnecting=null; reject(new Error('Wisp timeout')); }, 6000);
    ws.onopen = () => { clearTimeout(timer); wispWS=ws; wispReady=true; wispConnecting=null; console.log('[Wisp] connected ✓'); resolve(); };
    ws.onerror = () => { clearTimeout(timer); wispReady=false; wispConnecting=null; reject(new Error('Wisp WS error')); };
    ws.onclose = () => { wispReady=false; wispWS=null; for(const[,s]of wispStreams)try{s.onclose(1006);}catch(_){} wispStreams.clear(); console.warn('[Wisp] closed'); };
    ws.onmessage = ({data}) => {
      const buf=new Uint8Array(data); if(buf.length<5)return;
      const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
      const type=dv.getUint8(0), sid=dv.getUint32(1,true), payload=buf.slice(5);
      const s=wispStreams.get(sid); if(!s)return;
      if(type===W_DATA)s.ondata(payload);
      if(type===W_CLOSE){s.onclose(payload.length>=4?dv.getUint32(5,true):0);wispStreams.delete(sid);}
    };
  });
  return wispConnecting;
}

async function wispFetch(targetURL, options={}) {
  const p=new URL(targetURL), host=p.hostname, ssl=p.protocol==='https:';
  const port=p.port?parseInt(p.port,10):(ssl?443:80);
  const method=(options.method||'GET').toUpperCase(), path=(p.pathname||'/')+(p.search||'');
  await connectWisp();
  return new Promise((resolve,reject)=>{
    const sid=mkSid(), chunks=[]; let done=false;
    const finish=err=>{ if(done)return; done=true; wispStreams.delete(sid); if(err){reject(err);return;} parseHttp(chunks,targetURL,resolve,reject); };
    wispStreams.set(sid,{ondata:c=>chunks.push(c),onclose:()=>finish(null)});
    const hdrs=options.headers||{};
    const hdrLines=Object.entries(hdrs).filter(([k])=>!['host','connection','transfer-encoding','accept-encoding'].includes(k.toLowerCase())).map(([k,v])=>`${k}: ${v}`).join('\r\n');
    let bodyBytes=null;
    if(!['GET','HEAD'].includes(method)&&options.body!=null){
      if(options.body instanceof Uint8Array)bodyBytes=options.body;
      else if(options.body instanceof ArrayBuffer)bodyBytes=new Uint8Array(options.body);
      else bodyBytes=new TextEncoder().encode(String(options.body));
    }
    const lines=[`${method} ${path} HTTP/1.1`,`Host: ${host}`,'Connection: close','Accept-Encoding: identity'];
    if(hdrLines)lines.push(hdrLines); if(bodyBytes)lines.push(`Content-Length: ${bodyBytes.length}`);
    lines.push('','');
    const headBytes=new TextEncoder().encode(lines.join('\r\n'));
    let req; if(bodyBytes){req=new Uint8Array(headBytes.length+bodyBytes.length);req.set(headBytes);req.set(bodyBytes,headBytes.length);}else req=headBytes;
    try {
      // Build connect payload: [1B tcp=0x01][2B port BE][hostname bytes]
      const hb=new TextEncoder().encode(host), cpay=new Uint8Array(3+hb.length), cdv=new DataView(cpay.buffer);
      cdv.setUint8(0,0x01); cdv.setUint16(1,port,false); cpay.set(hb,3);
      wispWS.send(frame(W_CONNECT,sid,cpay));
      wispWS.send(frame(W_DATA,sid,req));
      wispWS.send(frame(W_CLOSE,sid,new Uint8Array(4)));
    } catch(e){finish(e);return;}
    setTimeout(()=>finish(new Error('Wisp stream timeout')),12000);
  });
}

function parseHttp(chunks,finalURL,resolve,reject){
  const total=chunks.reduce((s,c)=>s+c.length,0),full=new Uint8Array(total);
  let off=0; for(const c of chunks){full.set(c,off);off+=c.length;}
  let split=-1; for(let i=0;i<full.length-3;i++){if(full[i]===13&&full[i+1]===10&&full[i+2]===13&&full[i+3]===10){split=i;break;}}
  if(split===-1){reject(new Error('Wisp: no HTTP boundary'));return;}
  const hdr=new TextDecoder().decode(full.slice(0,split)),body=full.slice(split+4),lines=hdr.split('\r\n');
  const m=lines[0].match(/^HTTP\/\d(?:\.\d)?\s+(\d+)\s*(.*)/);
  if(!m){reject(new Error('Wisp: bad status'));return;}
  const rawHeaders={};
  for(let i=1;i<lines.length;i++){const col=lines[i].indexOf(':');if(col!==-1)rawHeaders[lines[i].slice(0,col).trim().toLowerCase()]=lines[i].slice(col+1).trim();}
  let cached=null;
  resolve({status:parseInt(m[1],10),statusText:m[2]||'OK',rawHeaders,finalURL,body,text:()=>{if(!cached)cached=new TextDecoder().decode(body);return Promise.resolve(cached);}});
}

// Probe + cache 60 s
let wispAvail=false, wispProbed=false, wispProbing=null;
function probeWisp(){
  if(wispProbed)return Promise.resolve(wispAvail);
  if(wispProbing)return wispProbing;
  wispProbing=connectWisp().then(()=>{wispAvail=true;wispProbed=true;wispProbing=null;return true;}).catch(()=>{wispAvail=false;wispProbed=true;wispProbing=null;return false;});
  return wispProbing;
}
setInterval(()=>{wispProbed=false;wispProbing=null;},60000);

function mkErr(status,text,target){return{status,statusText:text,rawHeaders:{'content-type':'text/plain'},finalURL:String(target),body:new Uint8Array(0),text:()=>Promise.resolve('')};}

// ═══════════════════════════════════════════════════════════════════
// HybridBareClient — MUST be set BEFORE importScripts(hyperspeed.sw.js)
// so the HyperspeedServiceWorker constructor picks it up via new h.BareClient()
// ═══════════════════════════════════════════════════════════════════
class HybridBareClient {
  async fetch(url, options={}) {
    const target=url instanceof URL?url.href:String(url);
    const fetchURL=WORKER_URL+'?url='+encodeURIComponent(target);
    const method=(options.method||'GET').toUpperCase();
    const body=(!['GET','HEAD'].includes(method)&&options.body!=null)?options.body:null;

    // 1. CF worker
    let primary=null;
    try {
      // Do NOT set accept-encoding:identity — it breaks YouTube's responses.
      // fetch() in SW context auto-decompresses gzip/br, so arrayBuffer() always
      // gives us the raw decompressed bytes. We just need to strip content-encoding
      // from rawHeaders so UV doesn't think the body is still compressed.
      const res=await fetch(fetchURL,{method,headers:options.headers||{},body,mode:'cors',credentials:'omit',redirect:'follow'});
      const rawHeaders={};
      for(const[k,v]of res.headers.entries())rawHeaders[k]=v;
      // Remove content-encoding — body is already decompressed by fetch()
      delete rawHeaders['content-encoding'];
      // Remove content-length — it no longer matches decompressed size
      delete rawHeaders['content-length'];
      const finalURL=rawHeaders['x-final-url']||target;
      let bodyBuf; try{bodyBuf=await res.arrayBuffer();}catch{bodyBuf=new ArrayBuffer(0);}
      const bodyBytes=new Uint8Array(bodyBuf); let cached=null;
      primary={status:res.status,statusText:res.statusText||'OK',rawHeaders,finalURL,body:bodyBytes,text:()=>{if(!cached)cached=new TextDecoder().decode(bodyBuf);return Promise.resolve(cached);}};
    } catch(e){console.warn('[Hybrid] CF network error:',e.message);}

    // 2. Good? Done.
    if(primary&&primary.status<500)return primary;

    if(primary)console.log(`[Hybrid] CF ${primary.status} for ${target} → trying Wisp`);
    else console.log(`[Hybrid] CF failed for ${target} → trying Wisp`);

    // 3. Wisp fallback
    const ok=await probeWisp();
    if(!ok){console.warn('[Hybrid] Wisp unavailable');return primary||mkErr(502,'Bad Gateway',target);}
    try{const r=await wispFetch(target,options);console.log(`[Hybrid] Wisp OK (${r.status}) for ${target}`);return r;}
    catch(e){console.warn('[Hybrid] Wisp failed:',e.message);return primary||mkErr(502,'Bad Gateway',target);}
  }
}

// ── Wire up BEFORE loading hyperspeed.sw.js ─────────────────────────────────
self.Ultraviolet=self.Hyperspeed;
self.Ultraviolet.BareClient=HybridBareClient;
self.Hyperspeed.BareClient=HybridBareClient;

if(typeof BroadcastChannel!=='undefined'){
  const _Orig=BroadcastChannel;
  self.BroadcastChannel=class SafeBroadcastChannel extends _Orig{
    constructor(n){try{super(n);}catch(_){}}
    set onmessage(fn){try{super.onmessage=fn;}catch(_){}}
    get onmessage(){try{return super.onmessage;}catch(_){return null;}}
  };
}

importScripts('/hyperspeed/hyperspeed.sw.js');

let hyperspeed=null;
try{hyperspeed=new HyperspeedServiceWorker();console.log(`[SW] v${SW_VERSION} ready — HybridBareClient (CF + Wisp WSS)`);}
catch(e){console.error('[SW] init failed:',e);}

probeWisp(); // background probe

self.addEventListener('install',e=>{
  console.log(`[SW] v${SW_VERSION} installing`);
  e.waitUntil(self.skipWaiting());
});
self.addEventListener('activate',e=>{
  console.log(`[SW] v${SW_VERSION} activating`);
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(url.pathname==='/sw-check'){
    e.respondWith(new Response(JSON.stringify({ok:true,version:SW_VERSION,wisp:wispAvail}),{headers:{'content-type':'application/json'}}));
    return;
  }
  if(hyperspeed&&hyperspeed.route(e)){
    e.respondWith(hyperspeed.fetch(e).catch(err=>{console.error('[SW] fetch error:',err);return new Response('Proxy error: '+err.message,{status:500});}));
    return;
  }
});
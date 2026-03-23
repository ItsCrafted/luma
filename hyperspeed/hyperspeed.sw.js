"use strict";(()=>{var h=self.Ultraviolet,O=["cross-origin-embedder-policy","cross-origin-opener-policy","cross-origin-resource-policy","content-security-policy","content-security-policy-report-only","expect-ct","feature-policy","origin-isolation","strict-transport-security","upgrade-insecure-requests","x-content-type-options","x-download-options","x-frame-options","x-permitted-cross-domain-policies","x-powered-by","x-xss-protection"],C=["GET","HEAD"],g=class extends h.EventEmitter{constructor(e=__hyperspeed$config){super(),e.prefix||(e.prefix="/service/"),this.config=e,this.bareClient=new h.BareClient}route({request:e}){return!!e.url.startsWith(location.origin+this.config.prefix)}async fetch({request:e}){let s;try{if(!e.url.startsWith(location.origin+this.config.prefix))return await fetch(e);let t=new h(this.config);typeof this.config.construct=="function"&&this.config.construct(t,"service");let w=await t.cookie.db();t.meta.origin=location.origin,t.meta.base=t.meta.url=new URL(t.sourceUrl(e.url));let o=new v(e,t,C.includes(e.method.toUpperCase())?null:await e.blob());if(t.meta.url.protocol==="blob:"&&(o.blob=!0,o.base=o.url=new URL(o.url.pathname)),e.referrer&&e.referrer.startsWith(location.origin)){let i=new URL(t.sourceUrl(e.referrer));(o.headers.origin||t.meta.url.origin!==i.origin&&e.mode==="cors")&&(o.headers.origin=i.origin),o.headers.referer=i.href}let f=await t.cookie.getCookies(w)||[],x=t.cookie.serialize(f,t.meta,!1);o.headers["user-agent"]=navigator.userAgent,x&&(o.headers.cookie=x);let p=new u(o,null,null);if(this.emit("request",p),p.intercepted)return p.returnValue;s=o.blob?"blob:"+location.origin+o.url.pathname:o.url;let c=await this.bareClient.fetch(s,{headers:o.headers,method:o.method,body:o.body,credentials:o.credentials,mode:o.mode,cache:o.cache,redirect:o.redirect}),r=new y(o,c),l=new u(r,null,null);if(this.emit("beforemod",l),l.intercepted)return l.returnValue;for(let i of O)r.headers[i]&&delete r.headers[i];if(r.headers.location&&(r.headers.location=t.rewriteUrl(r.headers.location)),["document","iframe"].includes(e.destination)){let i=r.getHeader("content-disposition");if(!/\s*?((inline|attachment);\s*?)filename=/i.test(i)){let n=/^\s*?attachment/i.test(i)?"attachment":"inline",[m]=new URL(c.finalURL).pathname.split("/").slice(-1);r.headers["content-disposition"]=`${n}; filename=${JSON.stringify(m)}`}}if(r.headers["set-cookie"]&&(Promise.resolve(t.cookie.setCookies(r.headers["set-cookie"],w,t.meta)).then(()=>{self.clients.matchAll().then(function(i){i.forEach(function(n){n.postMessage({msg:"updateCookies",url:t.meta.url.href})})})}),delete r.headers["set-cookie"]),r.body)switch(e.destination){case"script":r.body=t.js.rewrite(await c.text());break;case"worker":{let i=[t.bundleScript,t.clientScript,t.configScript,t.handlerScript].map(n=>JSON.stringify(n)).join(",");r.body=`if (!self.__hyperspeed) {
                                ${t.createJsInject(t.cookie.serialize(f,t.meta,!0),e.referrer)}
                            importScripts(${i});
                            }
`,r.body+=t.js.rewrite(await c.text())}break;case"style":r.body=t.rewriteCSS(await c.text());break;case"iframe":case"document":if(r.getHeader("content-type")&&r.getHeader("content-type").startsWith("text/html")){let i=await c.text();if(Array.isArray(this.config.inject)){let n=i.indexOf("<head>"),m=i.indexOf("<HEAD>"),b=i.indexOf("<body>"),k=i.indexOf("<BODY>"),S=new URL(s),U=this.config.inject;for(let d of U)new RegExp(d.host).test(S.host)&&(d.injectTo==="head"?(n!==-1||m!==-1)&&(i=i.slice(0,n)+`${d.html}`+i.slice(n)):d.injectTo==="body"&&(b!==-1||k!==-1)&&(i=i.slice(0,b)+`${d.html}`+i.slice(b)))}r.body=t.rewriteHtml(i,{document:!0,injectHead:t.createHtmlInject(t.handlerScript,t.bundleScript,t.clientScript,t.configScript,t.cookie.serialize(f,t.meta,!0),e.referrer)})}break;default:break}return o.headers.accept==="text/event-stream"&&(r.headers["content-type"]="text/event-stream"),crossOriginIsolated&&(r.headers["Cross-Origin-Embedder-Policy"]="require-corp"),this.emit("response",l),l.intercepted?l.returnValue:new Response(r.body,{headers:r.headers,status:r.status,statusText:r.statusText})}catch(t){return["document","iframe"].includes(e.destination)?(console.error(t),T(t,s)):new Response(void 0,{status:500})}}static Ultraviolet=h};self.HyperspeedServiceWorker=g;var y=class{constructor(e,s){this.request=e,this.raw=s,this.ultraviolet=e.ultraviolet,this.headers={};for(let t in s.rawHeaders)this.headers[t.toLowerCase()]=s.rawHeaders[t];this.status=s.status,this.statusText=s.statusText,this.body=s.body}get url(){return this.request.url}get base(){return this.request.base}set base(e){this.request.base=e}getHeader(e){return Array.isArray(this.headers[e])?this.headers[e][0]:this.headers[e]}},v=class{constructor(e,s,t=null){this.ultraviolet=s,this.request=e,this.headers=Object.fromEntries(e.headers.entries()),this.method=e.method,this.body=t||null,this.cache=e.cache,this.redirect=e.redirect,this.credentials="omit",this.mode=e.mode==="cors"?e.mode:"same-origin",this.blob=!1}get url(){return this.ultraviolet.meta.url}set url(e){this.ultraviolet.meta.url=e}get base(){return this.ultraviolet.meta.base}set base(e){this.ultraviolet.meta.base=e}},u=class{#e;#t;constructor(e={},s=null,t=null){this.#e=!1,this.#t=null,this.data=e,this.target=s,this.that=t}get intercepted(){return this.#e}get returnValue(){return this.#t}respondWith(e){this.#t=e,this.#e=!0}};function E(a,e){
  const err = String(a);
  const url = e ? String(e) : '';
  const script = `
    document.getElementById('err-trace').textContent = ${JSON.stringify(err)};
    document.getElementById('err-url').textContent = ${JSON.stringify(url)};
    document.getElementById('reload-btn').addEventListener('click', () => location.reload());
    document.getElementById('back-btn').addEventListener('click', () => history.back());
  `;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Connection Error</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Space+Grotesk:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #000;
    --surface: rgba(15,15,15,0.95);
    --border: rgba(255,255,255,0.05);
    --border-hi: rgba(255,255,255,0.08);
    --text: #ccc;
    --muted: #666;
    --pink: #d856bf;
    --cyan: #03b3c3;
    --mono: 'IBM Plex Mono', monospace;
    --sans: 'Space Grotesk', sans-serif;
  }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    position: relative;
  }
  /* Speed lines */
  .lines { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
  .line {
    position: absolute;
    height: 1px;
    opacity: 0;
    animation: zip 2.5s linear infinite;
  }
  .line:nth-child(1)  { top: 15%; width: 60%; background: linear-gradient(90deg, transparent, rgba(216,86,191,0.6), transparent); animation-delay: 0s; }
  .line:nth-child(2)  { top: 35%; width: 40%; background: linear-gradient(90deg, transparent, rgba(3,179,195,0.5), transparent); animation-delay: 0.7s; }
  .line:nth-child(3)  { top: 55%; width: 70%; background: linear-gradient(90deg, transparent, rgba(216,86,191,0.4), transparent); animation-delay: 1.3s; }
  .line:nth-child(4)  { top: 75%; width: 50%; background: linear-gradient(90deg, transparent, rgba(3,179,195,0.6), transparent); animation-delay: 0.4s; }
  .line:nth-child(5)  { top: 90%; width: 35%; background: linear-gradient(90deg, transparent, rgba(216,86,191,0.3), transparent); animation-delay: 1.8s; }
  @keyframes zip {
    0%   { left: -100%; opacity: 0; }
    10%  { opacity: 1; }
    90%  { opacity: 1; }
    100% { left: 100%; opacity: 0; }
  }
  /* Corner accents */
  .corner { position: fixed; width: 120px; height: 120px; border: 1px solid; opacity: 0.12; pointer-events: none; }
  .corner-tl { top: 0; left: 0; border-color: var(--pink) transparent transparent var(--pink); }
  .corner-br { bottom: 0; right: 0; border-color: transparent var(--cyan) var(--cyan) transparent; }
  /* Card */
  .card {
    position: relative;
    z-index: 10;
    width: 100%;
    max-width: 680px;
    padding: 40px;
    background: var(--surface);
    border: 1px solid var(--border-hi);
    backdrop-filter: blur(10px);
    box-shadow: 0 0 60px rgba(0,0,0,0.8), 0 0 30px rgba(216,86,191,0.05);
  }
  .err-code {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--pink);
    letter-spacing: 3px;
    text-transform: uppercase;
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .err-code::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--pink);
    box-shadow: 0 0 8px var(--pink);
    animation: blink 1.2s ease-in-out infinite;
  }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
  h1 {
    font-family: var(--mono);
    font-size: 28px;
    font-weight: 500;
    color: var(--text);
    margin-bottom: 8px;
    text-shadow: 0 0 20px rgba(216,86,191,0.3);
  }
  .subtitle {
    font-size: 13px;
    color: var(--muted);
    margin-bottom: 30px;
    font-family: var(--mono);
  }
  .url-display {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--cyan);
    background: rgba(3,179,195,0.05);
    border: 1px solid rgba(3,179,195,0.15);
    padding: 10px 14px;
    margin-bottom: 24px;
    word-break: break-all;
    min-height: 36px;
  }
  .trace-label {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--muted);
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-bottom: 8px;
  }
  #err-trace {
    width: 100%;
    background: rgba(0,0,0,0.6);
    border: 1px solid var(--border-hi);
    color: #888;
    font-family: var(--mono);
    font-size: 11px;
    padding: 12px 14px;
    resize: vertical;
    min-height: 80px;
    margin-bottom: 28px;
    outline: none;
    line-height: 1.6;
  }
  .actions { display: flex; gap: 12px; }
  button {
    flex: 1;
    padding: 13px 20px;
    background: rgba(15,15,15,0.8);
    border: 1px solid rgba(216,86,191,0.3);
    color: #999;
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 3px;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
  }
  button::before {
    content: '';
    position: absolute;
    top: 0; left: -100%;
    width: 100%; height: 100%;
    background: linear-gradient(90deg, transparent, rgba(216,86,191,0.1), rgba(3,179,195,0.1), transparent);
    transition: left 0.5s;
  }
  button:hover::before { left: 100%; }
  button:hover { border-color: rgba(3,179,195,0.4); color: #ddd; box-shadow: 0 0 20px rgba(216,86,191,0.1); }
  button:active { transform: scale(0.98); }
  #back-btn { border-color: rgba(3,179,195,0.2); }
  #back-btn:hover { border-color: rgba(3,179,195,0.5); }
  .divider { border: none; border-top: 1px solid var(--border); margin: 28px 0; }
  .tips {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .tip {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    font-size: 11px;
    color: var(--muted);
    line-height: 1.5;
  }
  .tip-num { font-family: var(--mono); color: var(--pink); flex-shrink: 0; font-size: 10px; margin-top: 1px; }
</style>
</head>
<body>
<div class="lines">
  <div class="line"></div><div class="line"></div><div class="line"></div>
  <div class="line"></div><div class="line"></div>
</div>
<div class="corner corner-tl"></div>
<div class="corner corner-br"></div>
<div class="card">
  <div class="err-code">hyperspeed &mdash; proxy error</div>
  <h1>connection failed</h1>
  <div class="subtitle" id="err-url"></div>
  <div class="trace-label">error trace</div>
  <textarea id="err-trace" readonly></textarea>
  <div class="actions">
    <button id="reload-btn">&#8635; retry</button>
    <button id="back-btn">&#8592; go back</button>
  </div>
  <hr class="divider"/>
  <div class="tips">
    <div class="tip"><span class="tip-num">01</span><span>Check your internet connection</span></div>
    <div class="tip"><span class="tip-num">02</span><span>Verify the URL is correct</span></div>
    <div class="tip"><span class="tip-num">03</span><span>Clear site data and retry</span></div>
    <div class="tip"><span class="tip-num">04</span><span>The site may be unavailable</span></div>
  </div>
</div>
<script src="${"data:application/javascript,"+encodeURIComponent(script)}"><\/script>
</body>
</html>`;
}
function T(a,e){let s={"content-type":"text/html"};return crossOriginIsolated&&(s["Cross-Origin-Embedder-Policy"]="require-corp"),new Response(E(String(a),e),{status:500,headers:s})}})();
//# sourceMappingURL=uv.sw.js.map
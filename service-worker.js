/* PMS Dashboard service worker — offline-first.
 *
 * The app is used at sea with no connection for days, so once installed it must
 * open with no network at all:
 *  • the app shell is served from the cache straight away (stale-while-revalidate:
 *    a connection, if there is one, only refreshes the cache for the next launch);
 *  • precaching is per-asset, so one failed request (e.g. Google Fonts) can never
 *    leave the cache empty;
 *  • activate deletes only OUR old caches. This origin (dines09.github.io) is
 *    shared with the other apps (Month End etc.) and CacheStorage is per-origin —
 *    deleting every other cache name wiped their offline copies too.
 */
const PREFIX = 'pms-dashboard-';
const CACHE = PREFIX + 'v10';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap';
const CRITICAL = ['./index.html', './app.js'];

async function precache(){
  const c = await caches.open(CACHE);
  const failed = [];
  await Promise.all(SHELL.map(async (u)=>{
    try{
      const res = await fetch(u, {cache:'reload'});
      if(res && res.ok) await c.put(u, res); else failed.push(u);
    }catch(_){ failed.push(u); }
  }));
  // Fonts are nice-to-have: the app falls back to system fonts without them.
  try{ const r = await fetch(FONT_CSS, {cache:'reload'}); if(r && r.ok) await c.put(FONT_CSS, r); }catch(_){}
  return failed;
}

self.addEventListener('install', (e)=>{
  e.waitUntil((async ()=>{
    const failed = await precache();
    // A cache without the shell is useless; keep the previous worker instead.
    if(failed.some(u=> CRITICAL.includes(u))){
      await caches.delete(CACHE);
      throw new Error('precache incomplete — keeping the previous cache');
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e)=>{
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=> k.startsWith(PREFIX) && k !== CACHE).map(k=> caches.delete(k)));
    await self.clients.claim();
  })());
});

/* The page sends this on every launch: refill anything missing from the cache
 * (e.g. after the browser or another app cleared it) while a connection exists. */
self.addEventListener('message', (e)=>{
  if(e.data !== 'heal') return;
  e.waitUntil((async ()=>{
    const c = await caches.open(CACHE);
    for(const u of SHELL){
      if(await c.match(u)) continue;
      try{ const r = await fetch(u, {cache:'reload'}); if(r && r.ok) await c.put(u, r); }catch(_){}
    }
  })());
});

function withTimeout(p, ms){
  return Promise.race([p, new Promise((_, rej)=> setTimeout(()=> rej(new Error('timeout')), ms))]);
}

/* Serve from cache now; refresh the cache in the background if online. */
function staleWhileRevalidate(e, req, key){
  const refresh = fetch(req, {cache:'no-cache'}).then(async res=>{
    if(res && res.ok){ const c = await caches.open(CACHE); await c.put(key, res.clone()); }
    return res;
  });
  e.waitUntil(refresh.catch(()=>{}));
  return caches.match(key, {ignoreSearch:true}).then(cached=>
    // No copy yet: wait for the network, but never hang on a dead link.
    cached || withTimeout(refresh, 8000)
  );
}

self.addEventListener('fetch', (e)=>{
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: cache-first; offline and uncached → empty stylesheet/font so
  // the page never waits on them.
  if(url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    e.respondWith((async ()=>{
      const cached = await caches.match(req);
      if(cached) return cached;
      try{
        const res = await withTimeout(fetch(req), 4000);
        if(res && (res.ok || res.type === 'opaque')){
          const copy = res.clone();
          caches.open(CACHE).then(c=> c.put(req, copy)).catch(()=>{});
        }
        return res;
      }catch(_){
        return new Response('', {status:200, headers:{'Content-Type': url.hostname === 'fonts.googleapis.com' ? 'text/css' : 'font/woff2'}});
      }
    })());
    return;
  }

  if(url.origin !== self.location.origin) return;

  // Page loads (incl. the home-screen launch): always the cached index.html.
  if(req.mode === 'navigate'){
    e.respondWith(staleWhileRevalidate(e, './index.html', './index.html').catch(()=>
      new Response('<!doctype html><meta charset=utf-8><title>PMS</title><body style="font:16px system-ui;padding:2rem;text-align:center"><h1>PMS</h1><p>The app is still installing. Open it once with a connection and it will work offline from then on.</p>',
        {status:200, headers:{'Content-Type':'text/html; charset=utf-8'}})
    ));
    return;
  }

  const path = url.pathname;
  if(path.endsWith('/app.js') || path.endsWith('/manifest.json')){
    e.respondWith(staleWhileRevalidate(e, req, req).catch(()=> new Response('', {status:504})));
    return;
  }

  // Everything else: cache first, network only when the cache has nothing.
  e.respondWith((async ()=>{
    const cached = await caches.match(req, {ignoreSearch:true});
    if(cached) return cached;
    try{
      const res = await fetch(req);
      if(res && res.ok){ const copy = res.clone(); caches.open(CACHE).then(c=> c.put(req, copy)).catch(()=>{}); }
      return res;
    }catch(_){ return new Response('', {status:504}); }
  })());
});

/* PMS Dashboard service worker — offline cache */
const CACHE = 'pms-dashboard-v6';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(
    caches.open(CACHE).then(c=> c.addAll(ASSETS.map(u=> new Request(u, {cache:'reload'})))).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys=> Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

/* Network-first for the app shell (so updates land), cache-first fallback for the rest */
self.addEventListener('fetch', (e)=>{
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  const isShell = url.pathname.endsWith('/index.html') || url.pathname.endsWith('/app.js') || url.pathname.endsWith('/');

  if(isShell){
    e.respondWith(
      fetch(req).then(res=>{
        const copy = res.clone();
        caches.open(CACHE).then(c=> c.put(req, copy)).catch(()=>{});
        return res;
      }).catch(()=> caches.match(req).then(r=> r || caches.match('./index.html')))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(cached=> cached || fetch(req).then(res=>{
      const copy = res.clone();
      caches.open(CACHE).then(c=> c.put(req, copy)).catch(()=>{});
      return res;
    }).catch(()=> cached))
  );
});

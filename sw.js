const CACHE_NAME = 'baby-feeding-v3.41';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Supabase API 鍜?CDN 鍔ㄦ€佹暟鎹缁堣蛋缃戠粶锛屼笉缂撳瓨
  if (event.request.url.includes('supabase.co') ||
      event.request.url.includes('cdn.jsdelivr.net')) {
    return; // 涓嶆嫤鎴紝鐩存帴璧版祻瑙堝櫒榛樿缃戠粶璇锋眰
  }

  // SheetJS CDN 鏈夌嫭绔嬬紦瀛樼瓥鐣?
  if (event.request.url.includes('cdn.sheetjs.com')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, response.clone());
            return response;
          });
        });
      })
    );
    return;
  }

  // 闈欐€佽祫婧愶細缂撳瓨浼樺厛锛岀綉缁滄洿鏂?
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});


/* ============================================================
   DetectLab — Service Worker v1.0.0
   ============================================================ */

const CACHE_NAME = 'detectlab-v3';

// ── Static assets to pre-cache on install ──
const PRECACHE_URLS = [
  '.',
  'index.html',
  'css/styles.css',
  'css/leaflet.css',
  'css/L.Control.Layers.Tree.css',
  'css/L.Control.Locate.min.css',
  'css/leaflet.photon.css',
  'css/leaflet-measure.css',
  'css/fontawesome-all.min.css',
  'css/MarkerCluster.css',
  'css/MarkerCluster.Default.css',
  'css/qgis2web.css',
  'js/translations.js',
  'js/leaflet.js',
  'js/L.Control.Layers.Tree.min.js',
  'js/L.Control.Locate.min.js',
  'js/leaflet-hash.js',
  'js/leaflet.photon.js',
  'js/leaflet-measure.js',
  'js/Autolinker.min.js',
  'js/supabase.js',
  'js/auth.js',
  'js/auth-forms.js',
  'js/account-legacy.js',
  'js/map-app.js',
  'images/pwa-icon-192.png',
  'images/pwa-icon-512.png'
];

// ── Install event: pre-cache essential static files ──
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      console.log('[SW] Pre-caching static assets');
      return cache.addAll(PRECACHE_URLS).catch(function (err) {
        console.warn('[SW] Pre-cache partial failure:', err.message);
      });
    }).then(function () {
      // Activate immediately — don't wait for page reload
      return self.skipWaiting();
    })
  );
});

// ── Activate event: clean old caches ──
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames.map(function (name) {
          if (name !== CACHE_NAME) {
            console.log('[SW] Removing old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(function () {
      // Take control of all clients immediately
      return self.clients.claim();
    })
  );
});

// ── Fetch event: network-first with cache fallback ──
//     (Network-first for fresh data; fall back to cache when offline)
self.addEventListener('fetch', function (event) {
  var request = event.request;

  // ── Bypass caching for non-GET requests ──
  if (request.method !== 'GET') return;

  var url = new URL(request.url);

  // ── Never cache Supabase / authentication API calls ──
  if (url.hostname.includes('supabase') || url.hostname.includes('auth')) {
    return;
  }

  // ── Never cache the geolocation / detection backends ──
  if (url.hostname.includes('workers.dev') ||
      url.hostname.includes('railway.app') ||
      url.hostname.includes('r2.dev') ||
      url.hostname.includes('geo-spatial.org') ||
      url.hostname.includes('geo-spatial.ro') ||
      url.hostname.includes('arcgisonline.com') ||
      url.pathname.includes('/map/') ||
      url.pathname.includes('/tile/')) {
    return;
  }

  // ── Strategy: Network-first for everything else ──
  event.respondWith(
    fetch(request)
      .then(function (response) {
        // Cache successful responses (status 200, not opaque)
        if (response && response.status === 200 && response.type === 'basic') {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, clone);
          });
        }
        return response;
      })
      .catch(function () {
        // Offline — serve from cache if available
        return caches.match(request).then(function (cached) {
          if (cached) return cached;
          // For navigation requests, return the cached index.html
          if (request.mode === 'navigate') {
            return caches.match('index.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

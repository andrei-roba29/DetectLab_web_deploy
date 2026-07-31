/* ============================================================
   DetectLab — Service Worker v1.3.0
   ============================================================ */

const CACHE_NAME = 'detectlab-v12';

// ── Static assets to pre-cache on install ──
const PRECACHE_URLS = [
  '.',
  'index.html',
  'css/styles.css',
  'css/styles.css?v=20260731',
  'css/leaflet.css',
  'css/L.Control.Layers.Tree.css',
  'css/L.Control.Locate.min.css',
  'css/leaflet.photon.css',
  'css/leaflet-measure.css',
  'css/fontawesome-all.min.css',
  'css/MarkerCluster.css',
  'css/MarkerCluster.Default.css',
  'js/translations.js',
  'js/translations.js?v=20260729',
  'js/leaflet.js',
  'js/L.Control.Layers.Tree.min.js',
  'js/L.Control.Locate.min.js',
  'js/leaflet-hash.js',
  'js/leaflet.photon.js',
  'js/leaflet-measure.js',
  'js/Autolinker.min.js',
  'js/supabase.js',
  'js/auth.js',
  'js/auth.js?v=20260729',
  'js/auth.js?v=20260730',
  'js/auth-forms.js',
  'js/account-legacy.js',
  'js/map-app.js',
  'js/map-app.js?v=20260731',
  'images/sonar_loading_animation.webp',
  'images/sonar_loading_animation.webp?v=20260729',
  'images/pwa-icon-192.png',
  'images/pwa-icon-512.png'
];

// ── Domains that must NEVER be intercepted by the SW ──
//     Tile servers, APIs, and large data sources. Intercepting them adds
//     latency (clone + cache-write on every tile) and can cause question-mark
//     artifacts when the SW's network-first fetch races with the browser.
const PASSTHROUGH_HOSTS = [
  'supabase',           // auth / database
  'workers.dev',        // APM tiles + feedback worker
  'railway.app',        // detection backend
  'r2.dev',             // Josephine / historical tiles + ONNX model
  'geo-spatial.org',    // heritage WMS + eharta
  'geo-spatial.ro',     // heritage WMS (eism)
  'arcgisonline.com',   // Esri satellite tiles
  'tiles.arcgis.com',   // LAKI III / MDH historical map tiles
  'raw.githubusercontent.com', // heritage images + geo-data JSON
  'githubusercontent.com',     // catch-all for GitHub CDN
  'overpass-api.de',    // OSM Overpass queries
  'cdn.jsdelivr.net',   // ONNX runtime CDN
  'ran.cimec.ro',       // Romanian cultural data
  'wikipedia.org',      // Wikipedia API
  'openstreetmap.org'   // OSM tiles / API
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
      return self.clients.claim();
    })
  );
});

// ── Fetch event: network-first with cache fallback ──
self.addEventListener('fetch', function (event) {
  var request = event.request;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // ── Only intercept same-origin requests ──
  //     Cross-origin tile / API requests go straight to the network with
  //     zero SW overhead. This is the single biggest performance win:
  //     hundreds of tile requests per pan/zoom no longer pass through the
  //     SW's clone-and-cache pipeline.
  var requestURL;
  try {
    requestURL = new URL(request.url);
  } catch (e) {
    // Malformed URL — let the browser handle it
    return;
  }

  // ── Pass through ALL cross-origin requests immediately ──
  if (requestURL.origin !== location.origin) {
    return;
  }

  // ── Same-origin path-based exclusions ──
  //     (These catch any same-origin proxy paths that serve tiles or API data)
  if (requestURL.pathname.includes('/map/') ||
      requestURL.pathname.includes('/tile/')) {
    return;
  }

  // ── Strategy: Network-first for same-origin requests ──
  event.respondWith(
    fetch(request)
      .then(function (response) {
        // Cache successful same-origin responses
        if (response && response.status === 200) {
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

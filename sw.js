/* ============================================================
   DetectLab — Service Worker v1.4.4
   ============================================================ */

// Bump this when a client-side feature or data-sync fix ships so installed
// PWAs replace stale scripts instead of continuing to run an older client.
const CACHE_NAME = 'detectlab-v55-historical-dossier';

// ── Detection settings ──
let detectionEnabled = false;
let backgroundDetectionEnabled = true; // can be disabled by user
let lastKnownPosition = null;

const PROTECTED_SITES_URL = 'https://detectlab-backend-production.up.railway.app/api/heritage-sites';
const PROTECTED_SITES_CACHE_KEY = 'protected-sites';

// ── Static assets to pre-cache on install ──
const PRECACHE_URLS = [
  '.',
  'index.html',
  'css/styles.css',
  'css/styles.css?v=2026080502',
  'css/leaflet.css',
  'css/L.Control.Layers.Tree.css',
  'css/L.Control.Locate.min.css',
  'css/leaflet.photon.css',
  'css/leaflet-measure.css',
  'css/fontawesome-all.min.css',
  'css/MarkerCluster.css',
  'css/MarkerCluster.Default.css',
  'js/translations.js',
  'js/translations.js?v=2026080702',
  'js/translations.js?v=20260811',
  'js/leaflet.js',
  'js/L.Control.Layers.Tree.min.js',
  'js/L.Control.Locate.min.js',
  'js/leaflet-hash.js',
  'js/leaflet.photon.js',
  'js/leaflet-measure.js',
  'js/Autolinker.min.js',
  'js/supabase.js',
  'js/events.js?v=20260814-chat-realtime',
  'js/events.js?v=20260815-last-location',
  'js/last-location.js?v=20260815-last-location',
  'js/auth.js',
  'js/auth.js?v=20260729',
  'js/auth.js?v=20260730',
  'js/auth-forms.js',
  'js/account-legacy.js',
  'js/map-app.js',
  'js/map-app.js?v=20260814-coordinate-search',
  'js/map-app.js?v=20260815-last-location',
  'js/map-app.js?v=20260819-sat60-premium-layer',
  'js/corona-wms-layer.js',
  'js/corona-wms-layer.js?v=20260812-layers',
  'js/archeo-potential.js',
  'js/archeo-potential.js?v=20260803',
  'js/lidar-geo.js?v=20260811-latlon',
  'js/lidar-scanner.js?v=20260812-scanner-above-lidar',
  'css/styles.css?v=20260811-lidar-perf',
  'css/styles.css?v=20260812-vertical-opacity',
  'css/library-of-babel.css?v=20260815',
  'css/library-of-babel.css?v=20260819',
  'css/library-of-babel.css?v=20260827-historical-dossier',
  'js/library-of-babel.js?v=20260815',
  'js/library-of-babel.js?v=20260819',
  'js/library-of-babel.js?v=20260827-historical-dossier',
  'js/vertical-opacity-control.js',
  'js/vertical-opacity-control.js?v=20260812',
  'js/auth.js?v=20260812-vertical-opacity',
  'js/subscriptions.js?v=20260812-premium',
  'js/checkout.js?v=20260812-premium',
  'js/subscriptions.js?v=20260812-payments',
  'js/checkout.js?v=20260812-payments',
  'js/translations.js?v=20260812-payments',
  'js/translations.js?v=20260812-premium-catalogue',
  'js/subscriptions.js?v=20260812-premium-catalogue',
  'css/styles.css?v=20260812-premium-catalogue',
  'css/checkout.css?v=20260812',
  // ── One-time €5 Premium purchase (no automatic renewal) ──
  'js/translations.js?v=20260813-onetime',
  'js/subscriptions.js?v=20260813-onetime',
  'js/checkout.js?v=20260813-onetime',
  'js/account-legacy.js?v=20260813-onetime',
  'js/auth.js?v=20260813-onetime',
  'css/checkout.css?v=20260813-onetime',
  // Promo codes (free-trial redemption in the popup + checkout page).
  'js/translations.js?v=20260814-promo',
  'js/translations.js?v=20260814-useful-info',
  'js/subscriptions.js?v=20260814-promo',
  'js/subscriptions.js?v=20260819-sat60-premium-layer',
  'js/checkout.js?v=20260814-promo',
  'js/account-legacy.js?v=20260814-promo',
  'js/auth.js?v=20260814-promo',
  'css/checkout.css?v=20260814-promo',
  'css/styles.css?v=20260814-promo',
  'checkout.html',
  'images/sonar_loading_animation.webp',
  'images/sonar_loading_animation.webp?v=20260729',
  'images/pwa-icon-192.png',
  'images/pwa-icon-512.png',
  // Archeological Report premium layer: self-contained PDF writer + report +
  // canvas-rendered PDF pages (no external PDF library is fetched at runtime).
  'js/pdf-writer.js?v=20260827-arch-report',
  'js/archeo-report-pdf.js?v=20260827-arch-report',
  'js/archeo-report.js?v=20260827-arch-report',
  'js/archeo-potential.js?v=20260827-arch-report',
  'js/lidar-scanner.js?v=20260827-arch-report',
  'js/translations.js?v=20260827-arch-report',
  'css/styles.css?v=20260827-arch-report'
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

// ─────────────────────────────────────────────────────────────
// BACKGROUND DETECTION + PERSISTENT NOTIFICATION + USER TOGGLE
// ─────────────────────────────────────────────────────────────

// Load detection state from IndexedDB on startup
async function loadDetectionState() {
    try {
        const cache = await caches.open(CACHE_NAME);
        const stored = await cache.match('detection-state');
        if (stored) {
            const state = await stored.json();
            detectionEnabled = !!state.detectionEnabled;
            backgroundDetectionEnabled = state.backgroundDetectionEnabled !== false;
            console.log('[SW] Restored detection state:', { detectionEnabled, backgroundDetectionEnabled });
        }
    } catch (e) {
        console.warn('[SW] Could not load detection state');
    }
}

// Save detection state
async function saveDetectionState() {
    try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put('detection-state', new Response(JSON.stringify({
            detectionEnabled,
            backgroundDetectionEnabled
        })));
    } catch (e) {}
}

// Message handler from the main app
self.addEventListener('message', async (event) => {
    if (!event.data) return;

    if (event.data.type === 'SET_DETECTION') {
        detectionEnabled = !!event.data.enabled;
        await saveDetectionState();
        
        if (detectionEnabled && backgroundDetectionEnabled) {
            await registerPeriodicSync();
            await showPersistentDetectionNotification();
        } else {
            await hidePersistentDetectionNotification();
        }
        
        console.log('[SW] Detection toggled:', detectionEnabled);
    }

    if (event.data.type === 'SET_BACKGROUND_DETECTION') {
        backgroundDetectionEnabled = !!event.data.enabled;
        await saveDetectionState();
        
        if (!backgroundDetectionEnabled) {
            await hidePersistentDetectionNotification();
        } else if (detectionEnabled) {
            await showPersistentDetectionNotification();
        }
    }

    if (event.data.type === 'GET_DETECTION_STATUS') {
        event.ports[0].postMessage({
            detectionEnabled,
            backgroundDetectionEnabled
        });
    }
});

// Register periodic background sync
async function registerPeriodicSync() {
    if ('periodicSync' in self.registration) {
        try {
            await self.registration.periodicSync.register('detect-protected-areas', {
                minInterval: 15 * 60 * 1000 // 15 minutes
            });
            console.log('[SW] Periodic sync registered');
        } catch (err) {
            console.warn('[SW] Periodic sync registration failed:', err);
        }
    }
}

// ── PERSISTENT NOTIFICATION (background running indicator) ──
const PERSISTENT_NOTIFICATION_TAG = 'detectlab-background-detection';

async function showPersistentDetectionNotification() {
    if (!backgroundDetectionEnabled || !detectionEnabled) return;

    try {
        await self.registration.showNotification('DetectLab — Detection Active', {
            body: 'Background detection is running. You will be notified when entering protected areas.',
            icon: 'images/pwa-icon-192.png',
            badge: 'images/pwa-icon-192.png',
            tag: PERSISTENT_NOTIFICATION_TAG,
            silent: true,
            requireInteraction: false,
            data: { type: 'persistent-detection' }
        });
        console.log('[SW] Persistent detection notification shown');
    } catch (err) {
        console.warn('[SW] Could not show persistent notification:', err);
    }
}

async function hidePersistentDetectionNotification() {
    const notifications = await self.registration.getNotifications({ tag: PERSISTENT_NOTIFICATION_TAG });
    notifications.forEach(n => n.close());
}

// ── PERIODIC SYNC HANDLER ──
self.addEventListener('periodicsync', async (event) => {
    if (event.tag === 'detect-protected-areas') {
        if (!detectionEnabled || !backgroundDetectionEnabled) return;
        console.log('[SW] Running background protected-area check');
        await performBackgroundCheck();
    }
});

// Core background check logic
async function performBackgroundCheck() {
    if (!detectionEnabled || !backgroundDetectionEnabled) return;

    try {
        // Get current position
        const position = await new Promise((resolve, reject) => {
            // We can't use geolocation directly in SW in all browsers.
            // Use the last known position sent from the main thread if available.
            if (lastKnownPosition) {
                resolve({ coords: lastKnownPosition });
            } else {
                reject(new Error('No position available'));
            }
        });

        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;

        const sites = await getProtectedSites();
        const RADIUS = 600; // meters

        let enteredSite = null;
        for (const site of sites) {
            const dist = getDistanceMeters(userLat, userLng, site.lat, site.lng);
            if (dist <= RADIUS) {
                enteredSite = site;
                break;
            }
        }

        if (enteredSite) {
            await showProtectedAreaAlert(enteredSite);
        }
    } catch (err) {
        console.warn('[SW] Background check error:', err.message);
    }
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getProtectedSites() {
    const cache = await caches.open(CACHE_NAME);
    let response = await cache.match(PROTECTED_SITES_CACHE_KEY);
    
    if (!response) {
        try {
            const fresh = await fetch(PROTECTED_SITES_URL);
            if (fresh.ok) {
                const data = await fresh.json();
                await cache.put(PROTECTED_SITES_CACHE_KEY, new Response(JSON.stringify(data)));
                return data;
            }
        } catch (e) {}
        return [];
    }
    
    return response.json();
}

async function showProtectedAreaAlert(site) {
    const title = '⚠️ ALERTĂ — Zonă protejată';
    const body = `Ați intrat în raza de protecție a sitului: ${site.name || 'Sit arheologic'}\nActivitate interzisă prin lege.`;

    await self.registration.showNotification(title, {
        body: body,
        icon: 'images/pwa-icon-192.png',
        badge: 'images/pwa-icon-192.png',
        tag: 'protected-area-alert',
        requireInteraction: true,
        vibrate: [200, 100, 200],
        data: { siteId: site.id, lat: site.lat, lng: site.lng, type: 'alert' }
    });
}

// On activate, restore state and show persistent notification if needed
self.addEventListener('activate', async () => {
    await loadDetectionState();
    if (detectionEnabled && backgroundDetectionEnabled) {
        await showPersistentDetectionNotification();
    }
});

// Initial load
loadDetectionState();

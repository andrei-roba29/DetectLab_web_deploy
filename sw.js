/* ============================================================
   DetectLab — Service Worker v1.4.8
   ============================================================ */

// Bump this when a client-side feature or data-sync fix ships so installed
// PWAs replace stale scripts instead of continuing to run an older client.
// v81: premium historical-maps accordion releases its max-height after the
// expand animation so the last card (Galiția & Lodomeria 1855) can no longer
// be clipped in the standalone mobile PWA.
// v82: fix PWA Patrimoniu zoom glitch — stop redrawing custom canvases
// during pinch/zoom animation, round transform to match tile container,
// and guard visualViewport resize while zooming.
// v84: offline-maps panel — zoom-level wording ("Nivel zoom" / "Zoom level"),
// closing a polygon on its first corner, the over-sized-polygon error that was
// being overwritten, and panel/bottom-bar/status-bar geometry in the PWA.
// v85: Satellite layer "Istoric" period slider — 2016 / 2018 orthophotos
// (geo-spatial.org WMS) alongside the present-day imagery, with both vertical
// mirrors (opacity + period) shown together on the map.
// v86: Social layer — "Prieteni / Friends" (search by e-mail · name · id +
// county filter), friend requests, private and group chat with an admin,
// events created straight from a chat and the "Adaugă prieteni / Add friends"
// box of the create-event form, all bounded by the quotas in public.app_limits.
// v87: Visibility prompt — turning ON the Detect switch or the live-location
// button now asks "Vrei să fii vizibil și pentru alți utilizatori?" (Da/Nu);
// the answer gates every presence publish so users are only shown to other
// detectorists after an explicit "Da".
// v89: Satellite „Istoric” keeps only the 2016 orthophoto (the 2018 layer is
// removed from the base layer → two stops, 2016 / Prezent) and the two
// map-side mirrors of the Satellite layer stay side by side in the installed
// PWA / on phones, where the ≤600px breakpoint used to stack them on the same
// anchor so only the ISTORIC mirror was visible.
// v90: the map-side opacity mirror no longer prints the word "OPACITY" above
// the range — the slider shows the layer name only (period mirrors keep
// ISTORIC / PERIOADĂ).
// v95: layer info for "Harta Transilvaniei 1859" and "Hartă administrativă a
// Galiției și Lodomeriei – 1855" also credits the digitization and publication
// by Universitatea „Ștefan cel Mare” din Suceava, with bukowina1856.eu as the
// source (ⓘ popup, Leaflet attribution, offline-maps panel). The source domain
// is rendered as a clickable link inside the ⓘ popup.
// v98: PWA layer panel + analysis sliders + detectorist social fixes —
//   • the layers window is anchored top→bottom of the map frame (it used to be
//     capped at 560px, so in the installed PWA it stopped after the lower half
//     of the screen) and carries no bottom padding any more;
//   • a mirrored vertical slider shows its layer title ABOVE the card instead of
//     inside it, and the LIDAR / potential / report ranges take the colour of the
//     pin + radius circle of their own layer (green / purple / blue);
//   • the magnifier only starts the live location — it no longer switches the
//     detection mode on — and being visible to others now depends on live
//     location + consent alone;
//   • tapping a detectorist pin always offers the friend action (Leaflet's
//     popup.update() used to repaint the string content over the buttons, so the
//     button appeared only when it lost that race);
//   • the friends search browses the county on an empty query, searches while you
//     type, reads the tables the RLS already exposes when the search RPC is
//     missing, and says so when the server could not be reached
//     (supabase/migrations/20260916020000_social_directory_projection.sql);
//   • offline areas are drawn as a polygon only — no vertex pins, no radius
//     circles, and the analysis layers never drop their pin under the finger
//     while a ring is being drawn — plus a centred ✕ at the bottom that leaves
//     an active offline map.
// v100: tile performance governor — js/tile-perf.js (loaded right after Leaflet)
//   applies gesture-safe defaults to every tile layer, merges the tile work of a
//   fast zoom into one update per layer, prunes the old zoom levels harder and
//   watches the page's decoded-tile budget; it is what stops the crash/reload
//   reported with several dense layers open at once (LIDAR + „Imagini
//   satelitare anii 60'" + historical maps + APM) when zooming abruptly.
//   See MAP_LAYER_PERFORMANCE.md.
const CACHE_NAME = 'detectlab-v100-tile-perf';
// Raster tiles explicitly downloaded by the user. This cache is separate from
// the app shell so expiring one offline area never evicts the PWA itself.
const OFFLINE_TILE_CACHE_NAME = 'detectlab-offline-tiles-v1';

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
  'js/events.js?v=20260908-anonymous-event-sync',
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
  'js/map-app.js?v=20260902-satbase-native18',
  'js/map-app.js?v=20260908-coordinate-formats',
  'js/patrimoniu-clustering.js?v=20260914-patrimoniu-cluster',
  'js/map-app.js?v=20260914-patrimoniu-zoom-anchor',
  'js/map-app.js?v=20260914-premium-hist-pwa-fix',
  'js/map-app.js?v=20260915-patrimoniu-pwa-zoom-fix',
  'css/styles.css?v=20260915-patrimoniu-pwa-zoom-fix',
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
  'css/library-of-babel.css?v=20260831-babel-multisource',
  'css/library-of-babel.css?v=20260902-babel-osm-nearby',
  'css/library-of-babel.css?v=20260902-babel-safe-area',
  'css/library-of-babel.css?v=20260917-babel-epochs',
  'js/library-of-babel.js?v=20260815',
  'js/library-of-babel.js?v=20260819',
  'js/library-of-babel.js?v=20260827-historical-dossier',
  'js/library-of-babel.js?v=20260828-evidence-search-fix',
  'js/library-of-babel.js?v=20260831-babel-multisource',
  'js/library-of-babel.js?v=20260902-babel-osm-nearby',
  'js/library-of-babel.js?v=20260831-babel-cimec',
  'js/library-of-babel.js?v=20260831-babel-periods-lexicon',
  'js/library-of-babel.js?v=20260917-babel-epochs',
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
  // Documentation tabs: the “Tehnologie / Technology” and “Proces / Process”
  // pages moved off the homepage into their own RO/EN page pair. Precached so
  // they also open offline from the installed PWA.
  'tehnologie.html',
  'technology.html',
  'proces.html',
  'process.html',
  'css/documentation.css',
  'css/documentation.css?v=20260917-doc-tabs',
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
  'css/styles.css?v=20260827-arch-report',
  // Archeological Report fix release: Search-Help-style APM figure polygons,
  // century/name-based period estimation, user-picked PDF language.
  'js/archeo-report-pdf.js?v=20260827-arch-report-v2',
  'js/archeo-report.js?v=20260827-arch-report-v2',
  'js/translations.js?v=20260827-arch-report-v2',
  'css/styles.css?v=20260827-arch-report-v2',
  // Archaeological Report: circular 1–10 km radius, blue LIDAR-like UI, dark PDF.
  'js/archeo-report-pdf.js?v=20260831-arch-report-v4',
  'js/archeo-report.js?v=20260831-arch-report-v4',
  'js/archeo-report.js?v=20260902-arch-report-v4',
  'js/translations.js?v=20260831-arch-report-v4',
  'css/styles.css?v=20260831-arch-report-v4',
  // Battles v3: on-hover century bubble on the period slider + the century
  // range mirrored in the map-side vertical control like every other layer.
  'js/battles-layer.js?v=20260901-battles-v3',
  'js/vertical-opacity-control.js?v=20260901-battles-v3',
  'css/styles.css?v=20260901-battles-v3',
  // Josephine source transition: pure CSS/SVG sonar overlay (the animated
  // sonar webp/mp4 are gone — no more image glitching on the map).
  'css/styles.css?v=20260902-josephine-sonar',
  // Battles v5: compact battle info window — hard width/height caps (px + vh/vw),
  // smaller type and spacing, and a long description collapsed to a few lines
  // behind a "Detalii / Details" toggle, so the popup no longer covers the screen.
  'js/battles-layer.js?v=20260902-battles-compact',
  'js/translations.js?v=20260902-battles-compact',
  'css/styles.css?v=20260902-battles-compact',
  // Battles v6: battle title tags are now L.marker anchored GEOGRAPHICALLY on
  // the top edge of their own radius (lat + radius/6371000 → exactly where
  // L.Circle._project paints the circle top). Leaflet moves them natively on
  // pan / zoom / pinch / flyTo, so they no longer drift or jump between zooms.
  'js/battles-layer.js?v=20260902-battles-label-anchor',
  'css/styles.css?v=20260902-battles-label-anchor',
  // Mini tutorial: "?" button (top-right of the map) + 5 purple, blurred
  // slides with arrows pointing at the real side / bottom-bar controls,
  // the layers panel, the free & premium layer catalogue and perf tips.
  'js/tutorial.js?v=20260907-tutorial-events',
  'css/tutorial.css?v=20260908-tutorial',
  // Tutorial slides now cross-fade and slide in the direction of travel
  // instead of cutting: staggered callouts, length-matched arrow drawing,
  // swipe / drag navigation, and the layers slide waits for the panel to
  // finish opening before its arrows are measured.
  'js/tutorial.js?v=20260908-smooth-slides',
  'css/tutorial.css?v=20260908-smooth-slides',
  // Offline maps: polygon editor, IndexedDB metadata and tile-cache UI.
  'js/offline-maps.js?v=20260915-offline-maps',
  'css/offline-maps.css?v=20260915-offline-maps',
  // Offline-maps panel polish: named zoom pickers, tap-to-close the polygon,
  // sticky size error, and panel geometry inside the map canvas / above the
  // PWA bottom bar / under the phone status bar. The tutorial slide for
  // #btnOfflineMaps describes the same flow, so it ships in the same version.
  'js/offline-maps.js?v=20260915-offline-panel',
  'css/offline-maps.css?v=20260915-offline-panel',
  'js/tutorial.js?v=20260915-offline-panel',
  // Nearby detectorists: the popup card (.map-place-popup) used to be
  // position:absolute, which pulled it out of the Leaflet popup's flow and left
  // an empty little popup box next to the info card — two windows, one of them
  // blank, on every nearby pin (offline bubbles included). Now in-flow only.
  'css/styles.css?v=20260907-nearby-popup',
  // Subtle layer coverage highlights + standalone map/layout/auth hooks.
  // Keep the installed/offline PWA on the same CSS and JS as index.html.
  'css/styles.css?v=20260907-layer-visibility-pwa',
  'js/map-app.js?v=20260907-layer-visibility-pwa',
  // Android install flow: Samsung Internet & OEM browsers mint a WebAPK that
  // Google Play Protect blocks, so the install section now routes those users
  // to Chrome and explains the "Unsafe app blocked" dialog.
  'css/styles.css?v=20260914-android-install',
  'js/translations.js?v=20260914-android-install',
  // Satellite "Istoric": the Satellite layer gains a period slider — 2016 and
  // 2018 national orthophotos (geo-spatial.org WMS) alongside the present-day
  // imagery; the vertical opacity mirror is joined on the map by a vertical
  // period mirror, both visible at the same time.
  'js/map-app.js?v=20260915-sat-historic',
  // Da/Nu visibility prompt when enabling Detect / live location.
  'js/map-app.js?v=20260915-visibility-prompt',
  'js/vertical-opacity-control.js?v=20260915-sat-historic',
  'js/translations.js?v=20260915-sat-historic',
  'css/styles.css?v=20260915-sat-historic',
  // Social layer ("Prieteni / Friends"): friends, friend requests, private and
  // group chat with an admin, events started from a chat, and the
  // "Adaugă prieteni / Add friends" box of the create-event form.
  'js/friends.js?v=20260915-social',
  'js/events.js?v=20260915-social',
  'js/translations.js?v=20260915-social',
  // Detectorist pins on the map ("Vezi alți detectoriști în zonă"): the live
  // (orange) and offline (black/white) popups now carry the social action slot
  // — friend request / accept / cancel / send message — painted by friends.js
  // when the popup opens.
  'js/friends.js?v=20260915-map-social',
  'js/map-app.js?v=20260915-map-social',
  'css/styles.css?v=20260915-map-social',
  // Satellite „Istoric” without 2018 + the installed-PWA mirror fix:
  // • the base layer keeps only the 2016 orthophoto (GeoServer „geospatial”)
  //   and the present-day Esri imagery — the 2018 layer (GeoServer „clc”) is
  //   gone, so the period slider has two stops (2016 / Prezent);
  // • the two map-side vertical mirrors (opacity + period) no longer collapse
  //   onto the same anchor inside the ≤600px breakpoint, which is exactly the
  //   width every installed PWA / phone reports — in standalone mode only the
  //   ISTORIC mirror used to be visible, never the pair.
  'css/styles.css?v=20260916-sat-2016-only',
  'js/map-app.js?v=20260916-sat-2016-only',
  'js/vertical-opacity-control.js?v=20260916-sat-2016-only',
  'js/auth.js?v=20260916-sat-2016-only',
  // The map-side opacity mirror drops its "OPACITY" caption strip; the caption
  // row collapses (:empty) so the layer name sits at the top of the control.
  'css/styles.css?v=20260916-no-opacity-caption',
  'js/vertical-opacity-control.js?v=20260916-no-opacity-caption',
  // PWA bottom bar removed: the bottom-right account stack absorbs
  // language + storage, Detect moves under the tap-to-lock compass,
  // nearby detectorists join the left icon stack, live-location sits
  // above the account avatar.
  'css/styles.css?v=20260916-no-bottom-bar',
  'css/offline-maps.css?v=20260916-no-bottom-bar',
  'js/map-app.js?v=20260916-no-bottom-bar',
  'js/events.js?v=20260916-no-bottom-bar',
  'js/friends.js?v=20260916-no-bottom-bar',
  'js/tutorial.js?v=20260916-no-bottom-bar',
  'js/translations.js?v=20260916-no-bottom-bar',
  'js/vertical-opacity-control.js?v=20260916-no-bottom-bar',
  // Detectorist popups become a horizontal card (avatar + identity row,
  // actions below); the popup re-runs its Leaflet layout after friends.js
  // paints the slot, so buttons and messages stay inside the frame.
  // "Adaugă prietenie" is renamed to "Adaugă prieten".
  'css/styles.css?v=20260916-friend-card',
  'js/friends.js?v=20260916-friend-card',
  'js/map-app.js?v=20260916-friend-card',
  'js/translations.js?v=20260916-friend-card',
  // Unified friend search (migration 20260916010000): one query matched
  // partially, diacritics folded, against name / e-mail / county / city /
  // id; multi-word queries need every word in at least one column.
  'js/friends.js?v=20260916-unified-search',
  // "?" tutorial: 6th slide for the Friends panel (unified search,
  // requests, chats), PWA control positions (Detect under the compass,
  // live-location above the account icon, magnifier in the left stack)
  // and the "Adaugă prieten" detectorist card.
  'js/tutorial.js?v=20260916-tutorial-friends',
  // Harta Transilvaniei 1859 + Hartă administrativă a Galiției și Lodomeriei
  // 1855: ⓘ layer info, Leaflet attribution and the offline-maps panel now also
  // state "Digitalizare și publicare: Universitatea „Ștefan cel Mare” din
  // Suceava · Sursă: bukowina1856.eu" (the source domain is clickable in the
  // popup, hence the styles.css + map-app.js re-version).
  'css/styles.css?v=20260916-map-source-usv',
  'js/map-app.js?v=20260916-map-source-usv',
  'js/offline-maps.js?v=20260916-map-source-usv',
  // Straturile de analiză (LIDAR Scanner, Zone cu potențial arheologic, Raport
  // arheologic): sliderul de distanță/rază e oglindit vertical pe hartă exact ca
  // opacitatea, iar butonul de acțiune al stratului se andochează centrat jos
  // (#layerActionDock). Potențialul arheologic primește pin mov + rază 1–10 km
  // și două moduri de ieșire — bule dense fără goluri și hartă termică pe
  // fiecare punct (leaflet-heat.js intră acum în app shell), cu zonele excluse
  // (UAT + raze de protecție) marcate cu roșu.
  'js/leaflet-heat.js?v=20260916-analysis-dock',
  'css/styles.css?v=20260916-analysis-dock',
  'js/translations.js?v=20260916-analysis-dock',
  'js/vertical-opacity-control.js?v=20260916-analysis-dock',
  'js/archeo-potential.js?v=20260916-analysis-dock',
  'js/lidar-scanner.js?v=20260916-analysis-dock',
  'js/archeo-report.js?v=20260916-analysis-dock',
  // Zone cu potențial arheologic — „sweet spot” pentru bule + heatmap real:
  //   • bulele nu mai pavează toată harta: se desenează doar celulele care au
  //     loc ca disc întreg, deci nu se ating între ele și nu intră peste razele
  //     de protecție ale siturilor sau peste masca roșie UAT;
  //   • heatmap-ul nu mai e leaflet-heat (alfa acumulat → culoare aproape
  //     constantă + alunecare la zoom), ci un raster de scoruri desenat pe un
  //     canvas ancorat în geografie, cu scala întinsă pe percentila 2..98 a
  //     rulării ca diferența slab↔tare să se vadă clar.
  'js/archeo-potential.js?v=20260916-archeo-sweetspot',
  'css/styles.css?v=20260916-archeo-sweetspot',
  'js/translations.js?v=20260916-archeo-sweetspot',
  // Panoul de straturi se întinde acum pe toată înălțimea hărții (fără tăierea
  // la 560px din PWA) și fără padding jos; titlul oglinzii verticale iese din
  // card, deasupra lui; sliderele LIDAR / potențial arheologic / raport primesc
  // culoarea pinului și a razei stratului lor; lupa pornește doar locația live;
  // căutarea de prieteni caută în timp ce scrii și arată de ce nu a ajuns la
  // server; harta offline se desenează doar ca poligon și are un ✕ centrat jos
  // pentru ieșire.
  'css/styles.css?v=20260916-pwa-panel-offline-exit',
  'css/offline-maps.css?v=20260916-pwa-panel-offline-exit',
  'js/translations.js?v=20260916-pwa-panel-offline-exit',
  'js/friends.js?v=20260916-pwa-panel-offline-exit',
  'js/map-app.js?v=20260916-pwa-panel-offline-exit',
  'js/offline-maps.js?v=20260916-pwa-panel-offline-exit',
  'js/vertical-opacity-control.js?v=20260916-pwa-panel-offline-exit',
  'js/archeo-potential.js?v=20260916-pwa-panel-offline-exit',
  'js/lidar-scanner.js?v=20260916-pwa-panel-offline-exit',
  'js/archeo-report.js?v=20260916-pwa-panel-offline-exit',
  'js/tutorial.js?v=20260916-pwa-panel-offline-exit',
  // Guvernorul global de tile-uri: oprește explozia de tile-uri (și crash-ul
  // paginii) când sunt deschise simultan mai multe straturi dense — LIDAR,
  // „Imagini satelitare anii 60'", hărți istorice, APM — și se face un gest
  // brusc de zoom. Se încarcă imediat după Leaflet, înaintea map-app.js.
  // Vezi MAP_LAYER_PERFORMANCE.md.
  'js/tile-perf.js',
  'js/tile-perf.js?v=20260917-tile-perf',
  'js/translations.js?v=20260917-tile-perf',
  'js/map-app.js?v=20260917-tile-perf'
];

// ── Domains that normally bypass the app-shell strategy ──
//     Tile servers, APIs, and large data sources must not be cached by the
//     network-first shell path. Explicitly downloaded raster tiles are the
//     one exception and are looked up in OFFLINE_TILE_CACHE_NAME below.
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
          if (name !== CACHE_NAME && name !== OFFLINE_TILE_CACHE_NAME) {
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

// ── Offline tile cache ─────────────────────────────────────────
// Normal cross-origin requests continue to bypass the service worker. Only
// URLs that look like raster map tiles are checked against the user-managed
// cache; this keeps the existing PWA fast while making downloaded areas work
// without a connection.
function isOfflineTileRequest(url) {
  var path = url.pathname || '';
  var query = (url.search || '').toLowerCase();
  if (query.indexOf('request=getmap') !== -1) return true;
  if (path.indexOf('/tile/') !== -1 || path.indexOf('/APM_TILES/') !== -1 || path.indexOf('/UAT/') !== -1) return true;
  return /\/\d+\/\d+\/\d+\.(png|jpg|jpeg)(?:$|\?)/i.test(path + url.search);
}

function cacheOfflineTileFromMessage(url) {
  return caches.open(OFFLINE_TILE_CACHE_NAME).then(function (cache) {
    return fetch(new Request(url, { method: 'GET', mode: 'no-cors', cache: 'no-store' })).then(function (response) {
      return cache.put(url, response.clone()).then(function () { return true; });
    });
  });
}

// ── Fetch event: network-first with cache fallback ──
self.addEventListener('fetch', function (event) {
  var request = event.request;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // ── Keep the app-shell strategy same-origin only ──
  //     Cross-origin tile / API requests either use the dedicated offline
  //     lookup below or go straight to the network; they never enter the
  //     shell's network-first clone-and-cache pipeline.
  var requestURL;
  try {
    requestURL = new URL(request.url);
  } catch (e) {
    // Malformed URL — let the browser handle it
    return;
  }

  // ── Cross-origin tile lookup ──
  // Cache.match is cheap for normal requests and only returns a response when
  // the user previously downloaded this exact tile URL. If it is not cached,
  // the original network request proceeds unchanged.
  if (requestURL.origin !== location.origin) {
    if (!isOfflineTileRequest(requestURL)) return;
    event.respondWith(
      caches.open(OFFLINE_TILE_CACHE_NAME).then(function (cache) {
        return cache.match(request).then(function (cached) {
          return cached || fetch(request);
        });
      }).catch(function () { return fetch(request); })
    );
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

    if (event.data.type === 'CACHE_OFFLINE_TILE' && event.data.url) {
        try {
            await cacheOfflineTileFromMessage(event.data.url);
            if (event.ports && event.ports[0]) event.ports[0].postMessage({ ok: true });
        } catch (error) {
            if (event.ports && event.ports[0]) event.ports[0].postMessage({ ok: false, error: String(error && error.message || error) });
        }
        return;
    }

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

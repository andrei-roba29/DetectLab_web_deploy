/*
 * corona-wms-layer.js
 * ──────────────────────────────────────────────────────────────────────────
 * Optimised WMS tile layer for the "Satellite imagery 60's" (CORONA / CAST UARK
 * GeoWebCache) layer.
 *
 * Problems this solves (see SATELLITE_60s_FIX.md / task brief):
 *   1. 500+ simultaneous WMS requests because 16 pass sublayers each request
 *      their own tiles with no global coordination.
 *   2. Tiles fetched at every zoom and all over the world, not just Romania.
 *   3. No caching — pan/zoom re-requests every tile from the remote server.
 *   4. Mobile crashes from memory/connection pressure.
 *
 * Strategy:
 *   • ONE shared request queue across ALL CORONA sublayers, with a hard cap on
 *     concurrent in-flight requests (8 desktop / 4 mobile).
 *   • Per-tile geographic intersection with Romania's bbox BEFORE any request.
 *   • Zoom threshold: no tiles below z4 (desktop) / z5 (mobile).
 *   • IndexedDB blob cache with TTL (30 d desktop / 60 d mobile).
 *   • Viewport priority (center tiles first), cancellation of stale/aborted
 *     tiles, exponential backoff, and a circuit breaker after repeated fails.
 *   • A small, unobtrusive loading indicator.
 *   • ON-DEMAND MODE (option `manualOnly: true`, used by the Satellite
 *     imagery 60's layer): map tiles NEVER trigger a network request — they
 *     render only tiles that are already present in the IndexedDB cache.
 *     The `coronaProbeTiles()` API (the "Load images here" /
 *     "Încarcă imagini aici" button) is the ONLY thing allowed to hit the
 *     network; every image it downloads lands in the same cache, so the layer
 *     renders the probed viewport instantly without fetching anything itself.
 *
 * Leaflet must be loaded BEFORE this file. It exposes:
 *     window.CoronaWmsLayer   → L.TileLayer.WMS subclass (factory: new CoronaWmsLayer(url, opts))
 *     window.CoronaWmsQueue   → shared throttling/cache manager (with .stats())
 *
 * The factory is used from map-app.js instead of plain L.tileLayer.wms().
 */
(function (root) {
    'use strict';

    if (!root.L) {
        console.error('[CoronaWms] Leaflet is not loaded — corona-wms-layer.js must load after leaflet.js');
        return;
    }
    var L = root.L;

    /* ───────────────────────────────────────────────────────────────────────
     * 1. Device / capability detection
     * ───────────────────────────────────────────────────────────────────── */
    function detectMobile() {
        var ua = (root.navigator && root.navigator.userAgent) ? root.navigator.userAgent : '';
        if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(ua)) {
            return true;
        }
        // Touch + coarse pointer + small screen is a good secondary signal.
        if (root.matchMedia && root.matchMedia('(pointer: coarse)').matches) {
            var w = root.innerWidth || 0, h = root.innerHeight || 0;
            if (w > 0 && w < 820) return true;
        }
        // Memory-conscious devices.
        if (root.navigator && root.navigator.deviceMemory && root.navigator.deviceMemory <= 2) {
            return true;
        }
        return false;
    }

    var IS_MOBILE = detectMobile();

    // All settings are overridable at runtime from the console for tuning, e.g.
    //   CoronaWmsQueue.config.concurrent = 6
    var CONFIG = {
        isMobile: IS_MOBILE,
        // The layer is only relevant at zoom >= minLoadZoom. Below that:
        //   - No sublayer creates any tile element at all (prevents flooding
        //     the DOM with tens of thousands of <img> elements when the user
        //     is viewing all of Romania at a low zoom).
        //   - No network request is ever fired (the user's "Load images here"
        //     button is the only fetch trigger, and it is itself disabled
        //     below minLoadZoom).
        // The DOM-flooding was the real cause of the "site crash" — see the
        // tile-count simulation in the fix history: at z=10 with 16 sublayers
        // we were creating 8,640 empty <img> elements on a single toggle.
        minZoom: 11,
        minLoadZoom: 11,
        // Hard cap on concurrent WMS image requests ACROSS ALL sublayers.
        concurrent: IS_MOBILE ? 4 : 8,
        // TTL for the IndexedDB tile cache.
        cacheTtlMs: (IS_MOBILE ? 60 : 30) * 24 * 60 * 60 * 1000,
        cacheDb: 'detectlab',
        cacheStore: 'corona_tiles',
        cacheVersion: 1,
        // Leaflet pre-fetches a ring of tiles around the viewport (keepBuffer).
        // Mobile fetches only what is visible to save memory/bandwidth.
        keepBuffer: IS_MOBILE ? 0 : 1,
        updateWhenZooming: false,
        updateWhenIdle: IS_MOBILE, // mobile: wait until the pan settles
        // Retry / backoff
        maxRetries: 3,
        backoffBaseMs: 500,
        // Circuit breaker: after this many failures, pause for cooldownMs.
        failureThreshold: 10,
        cooldownMs: 30 * 1000,
        // Romania bounds (EPSG:4326) used for the per-tile bbox intersection.
        // Slightly padded from the task's exact values so edge tiles still load.
        romaniaBounds: L.latLngBounds(
            [43.60, 20.25],
            [48.28, 29.45]
        )
    };

    /* ───────────────────────────────────────────────────────────────────────
     * 2. IndexedDB tile cache (best-effort; never blocks rendering)
     * ───────────────────────────────────────────────────────────────────── */
    var IDB = (function () {
        var dbPromise = null;
        var available = !!root.indexedDB;

        function open() {
            if (dbPromise) return dbPromise;
            dbPromise = new Promise(function (resolve) {
                if (!available) { resolve(null); return; }
                var req;
                try {
                    req = root.indexedDB.open(CONFIG.cacheDb, CONFIG.cacheVersion);
                } catch (e) {
                    available = false;
                    resolve(null);
                    return;
                }
                req.onupgradeneeded = function (e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains(CONFIG.cacheStore)) {
                        // keyPath = cache key (string). We store { key, blob, ts }.
                        db.createObjectStore(CONFIG.cacheStore, { keyPath: 'key' });
                    }
                };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { available = false; resolve(null); };
                req.onblocked = function () { resolve(null); };
            });
            return dbPromise;
        }

        function tx(mode, fn) {
            return open().then(function (db) {
                if (!db) return null;
                return new Promise(function (resolve) {
                    try {
                        var t = db.transaction(CONFIG.cacheStore, mode);
                        var store = t.objectStore(CONFIG.cacheStore);
                        var r = fn(store);
                        if (r && typeof r.onsuccess !== 'undefined') {
                            r.onsuccess = function () { resolve(r.result || null); };
                            r.onerror = function () { resolve(null); };
                        } else {
                            resolve(null);
                        }
                    } catch (e) {
                        resolve(null);
                    }
                });
            });
        }

        return {
            get: function (key) {
                return tx('readonly', function (store) { return store.get(key); })
                    .then(function (rec) {
                        if (!rec || !rec.blob) return null;
                        if (Date.now() - (rec.ts || 0) > CONFIG.cacheTtlMs) {
                            // Expired — best-effort eviction.
                            tx('readwrite', function (store) { store.delete(key); });
                            return null;
                        }
                        return rec.blob;
                    })
                    .catch(function () { return null; });
            },
            set: function (key, blob) {
                return tx('readwrite', function (store) {
                    return store.put({ key: key, blob: blob, ts: Date.now() });
                }).catch(function () { /* quota / private mode — ignore */ });
            }
        };
    })();

    /* ───────────────────────────────────────────────────────────────────────
     * 3. Shared throttled request queue
     *
     *    All CORONA sublayers push tile jobs into ONE queue. The queue keeps at
     *    most CONFIG.concurrent jobs in flight, prioritises tiles nearer the
     *    current viewport centre, supports AbortController cancellation, and
     *    implements exponential backoff + a global circuit breaker.
     * ───────────────────────────────────────────────────────────────────── */
    var Queue = (function () {
        var active = 0;
        var waiting = [];            // { job, priority, enqueuedAt }
        var inFlight = {};           // jobKey -> { controller, job }
        var consecutiveFailures = 0;
        var circuitOpenUntil = 0;
        // In-session negative cache: tiles the server said do not exist
        // (HTTP 404) or are outside the cached grid range (HTTP 400), keyed by
        // cacheKey. Stops the same missing tile being re-requested on every
        // pan/zoom — matters once the lower zoom threshold lets a pass request
        // zoom levels it has no cached coverage for. NOT persisted to IndexedDB.
        var missing = {};
        var stats = { requested: 0, cacheHits: 0, fetched: 0, failed: 0, queued: 0, cancelled: 0, empty: 0 };

        // If the server ever rejects CORS for fetch(), we fall back to a plain
        // <img> load for the whole session (no IndexedDB caching that session).
        var fetchForbidden = false;

        function pump() {
            while (active < CONFIG.concurrent && waiting.length > 0) {
                if (Date.now() < circuitOpenUntil) break; // circuit open — wait
                // Highest priority first (closest to viewport / most recent).
                waiting.sort(function (a, b) { return b.priority - a.priority; });
                var item = waiting.shift();
                if (!item) break;
                startJob(item);
            }
            updateIndicator();
        }

        function startJob(item) {
            var job = item.job;

            // Negative cache hit: server already told us this tile is missing
            // for this session — render it as empty without a network request.
            if (missing[job.cacheKey]) {
                stats.empty++;
                job.onEmpty && job.onEmpty();
                return;
            }

            active++;
            stats.requested++;
            inFlight[job.key] = { job: job };

            var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            if (controller) inFlight[job.key].controller = controller;

            job._cancelled = false;

            // 1) IndexedDB cache check. Skipped entirely for `forceFetch`
            //    retries (e.g. a probe re-asking the plain WMS endpoint for a
            //    tile whose GWC tile-cache blob is already stored as a fully
            //    transparent image — reading the transparent blob again would
            //    just reproduce the same false "no imagery" answer).
            if (job.forceFetch) {
                // ON-DEMAND MODE is still honoured even on a forced retry.
                if (job.noFetch) {
                    stats.empty++;
                    job.onEmpty && job.onEmpty();
                    finish(job, 'empty');
                    return;
                }
                fetchAndCache(job, controller);
                return;
            }
            IDB.get(job.cacheKey).then(function (blob) {
                if (job._cancelled) { finish(job, 'cancelled'); return; }
                if (blob) {
                    stats.cacheHits++;
                    try {
                        var url = root.URL.createObjectURL(blob);
                        job.onBlobUrl && job.onBlobUrl(url, true /*fromCache*/);
                        loadIntoImage(job, url, true, function (fromCacheOk) {
                            if (!fromCacheOk) {
                                // Cached blob failed to decode (corrupt/quota).
                                root.URL.revokeObjectURL(url);
                                if (job.noFetch) {
                                    // On-demand mode: never hit the network
                                    // from a map tile — just render it empty.
                                    stats.empty++;
                                    job.onEmpty && job.onEmpty();
                                    finish(job, 'empty');
                                    return;
                                }
                                // Refetch from the server.
                                fetchAndCache(job, controller);
                            } else {
                                finish(job, 'ok');
                            }
                        });
                    } catch (e) {
                        if (job.noFetch) {
                            stats.empty++;
                            job.onEmpty && job.onEmpty();
                            finish(job, 'empty');
                            return;
                        }
                        fetchAndCache(job, controller);
                    }
                    return;
                }
                // ON-DEMAND MODE: this is a map tile of a `manualOnly` layer.
                // It is NOT allowed to fetch — if the tile is not in the
                // IndexedDB cache yet (i.e. the user hasn't pressed
                // "Load images here" / "Încarcă imagini aici" for this area)
                // it renders as nothing and NO network request is made.
                if (job.noFetch) {
                    stats.empty++;
                    job.onEmpty && job.onEmpty();
                    finish(job, 'empty');
                    return;
                }
                fetchAndCache(job, controller);
            });
        }

        function fetchAndCache(job, controller) {
            if (fetchForbidden) {
                // CORS-less fallback: let the <img> load directly from the WMS.
                loadIntoImage(job, job.url, false, function (ok) {
                    if (ok) finish(job, 'ok');
                    else retryOrFail(job);
                });
                return;
            }

            var fetchOpts = { mode: 'cors', credentials: 'omit' };
            if (controller) fetchOpts.signal = controller.signal;

            // If the first endpoint (the GWC tile cache) cannot serve this tile
            // (HTTP 4xx / 5xx, or a non-image 200), retry ONCE on the plain WMS
            // rendering endpoint before treating the tile as missing. GWC only
            // serves the zoom levels/grids it has pre-cached for a layer — at
            // other zooms it answers 400/404 or an empty placeholder even when
            // the imagery really exists on the backend WMS.
            function tryFallback() {
                if (!job.fallbackUrl || job._fallbackTried) return false;
                job._fallbackTried = true;
                job.url = job.fallbackUrl;
                stats.requested++;
                var c2 = (typeof AbortController !== 'undefined') ? new AbortController() : null;
                if (c2) inFlight[job.key].controller = c2;
                fetchAndCache(job, c2);
                return true;
            }

            root.fetch(job.url, fetchOpts).then(function (res) {
                if (job._cancelled) { finish(job, 'cancelled'); return; }
                if (!res.ok) {
                    // 4xx = "no such tile / out of grid range" for this pass.
                    // These are EXPECTED once we request zoom levels a given
                    // pass (or the GWC cache) doesn't cover — do NOT retry
                    // with backoff, do NOT count toward the circuit breaker.
                    // 5xx = genuine server trouble, still worth one try on the
                    // fallback endpoint before the regular retry path.
                    if (res.status >= 400 && res.status < 500) {
                        if (tryFallback()) return;
                        // Definitive miss on BOTH endpoints — remember it for
                        // the session and render an empty tile.
                        missing[job.cacheKey] = true;
                        stats.empty++;
                        job.onEmpty && job.onEmpty();
                        finish(job, 'empty');
                        return;
                    }
                    if (tryFallback()) return;
                    throw new Error('HTTP ' + res.status);
                }
                var ct = res.headers.get('content-type') || '';
                if (ct.indexOf('image/') === -1) {
                    // GWC sometimes returns a text/XML 200 for a missing tile.
                    // Try the WMS endpoint once before declaring a permanent
                    // miss for this session.
                    if (tryFallback()) return;
                    missing[job.cacheKey] = true;
                    stats.empty++;
                    job.onEmpty && job.onEmpty();
                    finish(job, 'empty');
                    return;
                }
                return res.blob();
            }).then(function (blob) {
                if (!blob) return; // already handled as empty above
                if (job._cancelled || !blob) { finish(job, 'cancelled'); return; }
                // Persist in the background (do not block rendering on IDB write).
                IDB.set(job.cacheKey, blob);
                stats.fetched++;
                var url = root.URL.createObjectURL(blob);
                job.onBlobUrl && job.onBlobUrl(url, false);
                loadIntoImage(job, url, false, function (ok) {
                    if (ok) {
                        consecutiveFailures = 0;
                        finish(job, 'ok');
                    } else {
                        root.URL.revokeObjectURL(url);
                        retryOrFail(job);
                    }
                });
            }).catch(function (err) {
                if (job._cancelled) { finish(job, 'cancelled'); return; }
                if (err && err.name === 'AbortError') { finish(job, 'cancelled'); return; }
                // A TypeError from fetch usually means a CORS/network failure.
                // Fall back to direct <img> for the rest of the session.
                if (err && (err.message || '').toLowerCase().indexOf('failed to fetch') !== -1) {
                    fetchForbidden = true;
                    console.warn('[CoronaWms] fetch() blocked (CORS/network) — falling back to direct <img> loads (caching disabled for this session).');
                    loadIntoImage(job, job.url, false, function (ok) {
                        if (ok) finish(job, 'ok');
                        else retryOrFail(job);
                    });
                    return;
                }
                retryOrFail(job, err);
            });
        }

        function loadIntoImage(job, url, fromCache, cb) {
            try {
                var img = job.tileEl;
                var settled = false;
                img.onload = function () {
                    if (settled) return;
                    settled = true;
                    img.onerror = img.onload = null;
                    job.onLoad && job.onLoad();
                    cb(true);
                };
                img.onerror = function () {
                    if (settled) return;
                    settled = true;
                    img.onerror = img.onload = null;
                    cb(false);
                };
                img.src = url;
            } catch (e) {
                cb(false);
            }
        }

        function retryOrFail(job, err) {
            job.attempts = (job.attempts || 0) + 1;
            if (job.attempts <= CONFIG.maxRetries) {
                var delay = CONFIG.backoffBaseMs * Math.pow(2, job.attempts - 1);
                // Re-queue with a delay, same priority.
                setTimeout(function () {
                    if (job._cancelled) { finish(job, 'cancelled'); return; }
                    waiting.push({ job: job, priority: job.priority, enqueuedAt: Date.now() });
                    stats.queued++;
                    pump();
                }, delay);
                // Release the active slot immediately while we wait for retry.
                finish(job, 'retry', true);
                return;
            }
            stats.failed++;
            consecutiveFailures++;
            if (consecutiveFailures >= CONFIG.failureThreshold) {
                circuitOpenUntil = Date.now() + CONFIG.cooldownMs;
                console.warn('[CoronaWms] ' + consecutiveFailures + ' consecutive failures — pausing requests for ' +
                    (CONFIG.cooldownMs / 1000) + 's.');
                setTimeout(pump, CONFIG.cooldownMs);
            }
            job.onError && job.onError(err || new Error('tile load failed'));
            finish(job, 'error');
        }

        function finish(job, reason, keepSlot) {
            delete inFlight[job.key];
            if (!keepSlot) active = Math.max(0, active - 1);
            if (reason === 'cancelled') stats.cancelled++;
            pump();
        }

        /* ── Public API ───────────────────────────────────────────────────── */
        return {
            config: CONFIG,
            // job: { key, cacheKey, url, tileEl, priority, onLoad, onError,
            //        onBlobUrl, onEmpty, noFetch }
            // noFetch=true (on-demand map tiles): IndexedDB cache ONLY — the
            // job never produces a network request; a cache miss is reported
            // via onEmpty(). Probes (coronaProbeTiles) use noFetch=false.
            enqueue: function (job) {
                if (Date.now() < circuitOpenUntil) {
                    // Queue it; pump() will resume when the cooldown ends.
                    waiting.push({ job: job, priority: job.priority || 0, enqueuedAt: Date.now() });
                    stats.queued++;
                    return;
                }
                waiting.push({ job: job, priority: job.priority || 0, enqueuedAt: Date.now() });
                stats.queued++;
                pump();
            },
            cancel: function (key) {
                // Remove from waiting list.
                for (var i = waiting.length - 1; i >= 0; i--) {
                    if (waiting[i].job.key === key) {
                        waiting[i].job._cancelled = true;
                        waiting.splice(i, 1);
                        stats.cancelled++;
                    }
                }
                // Abort an in-flight request.
                var infl = inFlight[key];
                if (infl) {
                    infl.job._cancelled = true;
                    try { infl.controller && infl.controller.abort(); } catch (e) {}
                }
            },
            stats: function () {
                return {
                    isMobile: IS_MOBILE,
                    minZoom: CONFIG.minZoom,
                    concurrent: CONFIG.concurrent,
                    active: active,
                    waiting: waiting.length,
                    consecutiveFailures: consecutiveFailures,
                    circuitOpen: Date.now() < circuitOpenUntil,
                    totals: stats
                };
            }
        };
    })();

    /* ───────────────────────────────────────────────────────────────────────
     * 4. Loading indicator (subtle, injected into the map container)
     * ───────────────────────────────────────────────────────────────────── */
    var _indicatorEl = null;
    var _indicatorHideTimer = null;
    function updateIndicator() {
        var s = Queue.stats();
        if (!root.document || typeof root.document.createElement !== 'function') return;
        if (!_indicatorEl) {
            try {
            _indicatorEl = root.document.createElement('div');
            _indicatorEl.className = 'corona-loading-indicator';
            _indicatorEl.setAttribute('role', 'status');
            _indicatorEl.setAttribute('aria-live', 'polite');
            _indicatorEl.innerHTML =
                '<span class="corona-loading-spinner"></span>' +
                '<span class="corona-loading-text">Loading 1960s imagery…</span>';
            _indicatorEl.style.cssText =
                'position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:1200;' +
                'display:none;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;' +
                'background:rgba(6,14,30,0.82);border:1px solid rgba(184,216,240,0.25);' +
                'color:#B8D8F0;font:600 12px/1.2 Outfit,system-ui,sans-serif;' +
                'box-shadow:0 6px 18px rgba(0,0,0,0.35);pointer-events:none;';
            var mapEl = typeof root.document.getElementById === 'function'
                ? root.document.getElementById('detectlab-map') : null;
            if (mapEl) mapEl.appendChild(_indicatorEl);
            } catch (e) { _indicatorEl = null; return; }
        }
        var inflight = s.active + s.waiting;
        if (inflight > 2) {
            _indicatorEl.style.display = 'flex';
            _indicatorEl.querySelector('.corona-loading-text').textContent =
                'Loading 1960s imagery… (' + inflight + ' tiles)';
            if (_indicatorHideTimer) { clearTimeout(_indicatorHideTimer); _indicatorHideTimer = null; }
        } else {
            if (_indicatorHideTimer) clearTimeout(_indicatorHideTimer);
            _indicatorHideTimer = setTimeout(function () {
                if (_indicatorEl) _indicatorEl.style.display = 'none';
            }, 400);
        }
    }

    // Inject spinner keyframe styles once.
    (function injectSpinnerStyle() {
        if (!root.document || typeof root.document.createElement !== 'function') return;
        if (typeof root.document.getElementById === 'function' &&
            root.document.getElementById('corona-loading-style')) return;
        try {
            var style = root.document.createElement('style');
            style.id = 'corona-loading-style';
            style.textContent =
                '@keyframes coronaSpin{to{transform:rotate(360deg)}}' +
                '.corona-loading-spinner{width:12px;height:12px;border-radius:50%;' +
                'border:2px solid rgba(184,216,240,0.3);border-top-color:#B8D8F0;' +
                'animation:coronaSpin .8s linear infinite;display:inline-block;}';
            if (root.document.head) root.document.head.appendChild(style);
        } catch (e) { /* non-DOM environment — ignore */ }
    })();

    /* ───────────────────────────────────────────────────────────────────────
     * 5b. Probe helper — decide whether a decoded tile image actually has
     *     visible (non-transparent) content. WMS TRANSPARENT=true tiles for
     *     areas a pass does NOT cover come back as a fully transparent PNG
     *     with HTTP 200, so a successful decode alone is NOT proof of imagery.
     * ───────────────────────────────────────────────────────────────────── */
    function tileHasVisibleContent(img, cb) {
        try {
            var c = root.document.createElement('canvas');
            var w = img.naturalWidth || img.width || 256;
            var h = img.naturalHeight || img.height || 256;
            c.width = w;
            c.height = h;
            var ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            var d = ctx.getImageData(0, 0, w, h).data;
            var opaque = 0;
            for (var i = 3; i < d.length; i += 4) {
                if (d[i] > 8) {
                    opaque++;
                    if (opaque >= 4) break;
                }
            }
            cb(opaque >= 4);
        } catch (e) {
            // Tainted canvas (CORS-less <img> fallback) — assume it has content.
            cb(true);
        }
    }

    /* ───────────────────────────────────────────────────────────────────────
     * 5c. Probe / on-demand loader — backs the "Load images here" (Încarcă
     *     imagini aici) button of the Satellite imagery 60's layer.
     *
     *     Requests WMS tiles ONLY for the current viewport (the caller builds
     *     the job list from the visible bounds), through the SAME shared queue
     *     as the map tiles, so it respects the concurrency cap, backoff,
     *     per-session negative cache and the IndexedDB blob cache. Every tile
     *     that actually contains imagery is stored in IndexedDB, which means
     *     the layer's own tiles render from cache right after the probe.
     *
     *     job: { url, layerLabel, z, x, y }
     *     resolves: { total, found, empty, failed, foundTiles: ["z/x/y", …] }
     *
     *     GWC → WMS fallback: the tile-cache endpoint (/gwc/service/wms) only
     *     serves zooms/grids it has pre-cached per layer, and can answer
     *     HTTP 400/404 or a fully transparent placeholder for zooms it has no
     *     cache for — even when the imagery really exists. To avoid false
     *     "No images here" results, every probe tile that came back
     *     missing/empty from the cache is retried ONCE on the plain WMS
     *     rendering endpoint (/geoserver/wms), which renders any valid
     *     layer+bbox on the fly.
     * ───────────────────────────────────────────────────────────────────── */
    // Derive the plain WMS rendering URL from a GeoWebCache WMS-C URL by
    // swapping the /gwc/service/wms path segment for /wms. Returns null when
    // the URL does not go through the GWC cache (nothing to fall back to).
    function fallbackWmsUrl(url) {
        if (!url) return null;
        var u = String(url);
        var marker = '/geoserver/gwc/service/wms';
        var i = u.indexOf(marker);
        if (i !== -1) {
            return u.slice(0, i) + '/geoserver/wms' + u.slice(i + marker.length);
        }
        marker = '/gwc/service/wms';
        i = u.indexOf(marker);
        if (i !== -1) {
            return u.slice(0, i) + '/wms' + u.slice(i + marker.length);
        }
        return null;
    }

    function coronaProbeTiles(jobs) {
        return new Promise(function (resolve) {
            var results = {
                total: jobs.length,
                found: 0,
                empty: 0,
                failed: 0,
                foundTiles: []
            };
            var pending = jobs.length;
            if (pending === 0) { resolve(results); return; }

            function oneDone() {
                pending--;
                if (pending <= 0) resolve(results);
            }

            // Inspect a fetched tile for visible content. A transparent PNG
            // (or a canvas that is tainted by a CORS-less <img> fallback,
            // which the helper reports as "has content") decides found/empty.
            // When the tile came from the GWC tile cache and looks empty, it
            // is re-requested ONCE from the plain WMS endpoint before we give
            // up — this is what eliminates the false "no imagery here"
            // reports at zooms/areas the cache cannot serve.
            function decide(job, imgEl, allowFallback, blobRef) {
                tileHasVisibleContent(imgEl, function (hasContent) {
                    if (blobRef.v) {
                        try { root.URL.revokeObjectURL(blobRef.v); } catch (e) {}
                        blobRef.v = null;
                    }
                    if (hasContent) {
                        results.found++;
                        var tileKey = job.z + '/' + job.x + '/' + job.y;
                        if (results.foundTiles.indexOf(tileKey) === -1) {
                            results.foundTiles.push(tileKey);
                        }
                        oneDone();
                        return;
                    }
                    if (allowFallback && job.fallbackUrl && !job._fbProbeTried) {
                        job._fbProbeTried = true;
                        // forceFetch: skip the IndexedDB read — the cache may
                        // already hold the transparent GWC blob for this tile.
                        Queue.enqueue({
                            key: job.key + '::fb',
                            cacheKey: job.cacheKey,
                            url: job.fallbackUrl,
                            tileEl: imgEl,
                            priority: 0,
                            forceFetch: true,
                            onBlobUrl: function (url) { blobRef.v = url; },
                            onLoad: function () { decide(job, imgEl, false, blobRef); },
                            onEmpty: function () {
                                if (blobRef.v) {
                                    try { root.URL.revokeObjectURL(blobRef.v); } catch (e) {}
                                    blobRef.v = null;
                                }
                                results.empty++;
                                oneDone();
                            },
                            onError: function () {
                                if (blobRef.v) {
                                    try { root.URL.revokeObjectURL(blobRef.v); } catch (e) {}
                                    blobRef.v = null;
                                }
                                results.failed++;
                                oneDone();
                            }
                        });
                        return;
                    }
                    results.empty++;
                    oneDone();
                });
            }

            jobs.forEach(function (job, idx) {
                var cacheKey = makeCacheKey(job.layerLabel, job.z, job.x, job.y);
                var key = cacheKey + '::probe' + idx;
                var imgEl = new root.Image();
                var blobUrl = { v: null };
                if (!job.fallbackUrl) {
                    job.fallbackUrl = fallbackWmsUrl(job.url);
                }

                Queue.enqueue({
                    key: key,
                    cacheKey: cacheKey,
                    url: job.url,
                    fallbackUrl: job.fallbackUrl,
                    tileEl: imgEl,
                    priority: 0,
                    onBlobUrl: function (url) { blobUrl.v = url; },
                    onLoad: function () {
                        // Synchronous decode inspection, then release the blob URL.
                        decide(job, imgEl, true, blobUrl);
                    },
                    onEmpty: function () {
                        if (blobUrl.v) {
                            try { root.URL.revokeObjectURL(blobUrl.v); } catch (e) {}
                            blobUrl.v = null;
                        }
                        results.empty++;
                        oneDone();
                    },
                    onError: function () {
                        if (blobUrl.v) {
                            try { root.URL.revokeObjectURL(blobUrl.v); } catch (e) {}
                            blobUrl.v = null;
                        }
                        results.failed++;
                        oneDone();
                    }
                });
            });
        });
    }

    /* ───────────────────────────────────────────────────────────────────────
     * 5. Helper: tile coords → LatLngBounds and Romania intersection
     * ───────────────────────────────────────────────────────────────────── */
    function tileBounds(map, coords) {
        // coords may be {x,y,z} (or an L.Point with x/y/z for retro/non-retina).
        var z = coords.z, x = coords.x, y = coords.y;
        var nw = map.unproject([x * 256, y * 256], z);
        var se = map.unproject([(x + 1) * 256, (y + 1) * 256], z);
        return L.latLngBounds(nw, se);
    }

    function tileIntersectsRomania(map, coords) {
        try {
            var tb = tileBounds(map, coords);
            if (!tb || !tb.isValid()) return false;
            // Quick reject: tile entirely outside Romania bbox.
            return tb.intersects(CONFIG.romaniaBounds);
        } catch (e) {
            return true; // never block rendering on a geometry error
        }
    }

    /* ───────────────────────────────────────────────────────────────────────
     * 6. The custom L.TileLayer.WMS subclass
     * ───────────────────────────────────────────────────────────────────── */
    var CoronaWmsLayer = L.TileLayer.WMS.extend({

        initialize: function (url, options) {
            // Sensible defaults for every corona sublayer.
            options = L.extend({
                format: 'image/png',
                transparent: true,
                version: '1.1.1',
                tiled: true,
                tileSize: 256,
                maxZoom: 18,
                maxNativeZoom: 15,
                // CRITICAL: do not create ANY tile element below minZoom (=11).
                // Below that zoom the user's "Load images here" button is
                // disabled, so creating tile elements would only burn DOM
                // resources and (at low zooms covering all of Romania)
                // produce hundreds of thousands of empty <img> elements that
                // were crashing the browser on toggle. Tile creation is also
                // blocked in createTile() itself as a belt-and-braces check.
                minZoom: CONFIG.minZoom,
                bounds: CONFIG.romaniaBounds,
                keepBuffer: CONFIG.keepBuffer,
                updateWhenZooming: CONFIG.updateWhenZooming,
                updateWhenIdle: CONFIG.updateWhenIdle,
                // Custom option: used to group/debug per pass.
                coronaLayer: '',
                // ON-DEMAND MODE: when true, the layer NEVER fetches tiles
                // from the network on its own ("niciun fetch până nu se
                // apasă butonul"). Its tiles only render blobs that are
                // already in the IndexedDB cache — populated exclusively by
                // the "Load images here" / "Încarcă imagini aici" button
                // (see coronaProbeTiles below).
                manualOnly: false
            }, options || {});

            L.TileLayer.WMS.prototype.initialize.call(this, url, options);

            // Per-layer bookkeeping of active blob URLs so they can be revoked.
            this._blobUrls = {};
            this._layerLabel = options.coronaLayer || options.layers || 'corona';
        },

        // Called by Leaflet to create each tile element. We override it so that:
        //  - tiles below the zoom threshold / outside Romania are never created
        //  - all loads go through the shared, throttled queue
        createTile: function (coords, done) {
            var tile = L.DomUtil.create('img', 'leaflet-tile');
            tile.alt = '';

            var map = this._map;
            var z = coords.z;

            // (a) Zoom threshold — no corona tiles below minZoom.
            if (z < this.options.minZoom) {
                tile.style.display = 'none';
                // Complete immediately as an "empty" (but successful) tile so
                // Leaflet's loading state does not get stuck.
                done && done(null, tile);
                return tile;
            }

            // (b) Geographic filter — reject tiles outside Romania.
            if (!tileIntersectsRomania(map, coords)) {
                tile.style.display = 'none';
                done && done(null, tile);
                return tile;
            }

            // (c) Build the WMS URL (reuses Leaflet's own WMS logic, preserving
            //     the EPSG:900913 SRS, BBOX, tiled=true, etc.).
            var url;
            try {
                url = this.getTileUrl(coords);
            } catch (e) {
                done && done(e, tile);
                return tile;
            }

            // (d) Stable cache key — strip any transient cache-buster param.
            var cacheKey = makeCacheKey(this._layerLabel, z, coords.x, coords.y);
            var jobKey = cacheKey + '::' + Math.random().toString(36).slice(2, 8);

            // (e) Priority = closeness of this tile's centre to the viewport
            //     centre so the user sees the middle of the screen fill first.
            var priority = computePriority(map, coords, z);

            var self = this;
            var noFetch = this.options.manualOnly === true;
            var job = {
                key: jobKey,
                cacheKey: cacheKey,
                url: url,
                tileEl: tile,
                priority: priority,
                attempts: 0,
                // On-demand mode: this map tile must NEVER cause a network
                // request — it renders from the IndexedDB cache or not at all.
                noFetch: noFetch,
                onBlobUrl: function (blobUrl /*, fromCache */) {
                    // Revoke any previous blob URL we handed to this tile.
                    if (self._blobUrls[jobKey]) {
                        try { root.URL.revokeObjectURL(self._blobUrls[jobKey]); } catch (e) {}
                    }
                    self._blobUrls[jobKey] = blobUrl;
                },
                onLoad: function () {
                    // Tile decoded successfully.
                    done && done(null, tile);
                },
                onEmpty: function () {
                    // Server reported this tile as missing / out of grid range
                    // (HTTP 4xx or non-image 200). Complete as a transparent
                    // empty tile so Leaflet doesn't get stuck loading.
                    tile.style.display = 'none';
                    done && done(null, tile);
                },
                onError: function (err) {
                    console.warn('[CoronaWms] tile failed', self._layerLabel, z + '/' + coords.x + '/' + coords.y, err && err.message);
                    done && done(err, tile);
                }
            };
            tile._coronaJobKey = jobKey;

            Queue.enqueue(job);
            return tile;
        },

        // When Leaflet prunes a tile (pan/zoom away), cancel its queued/in-flight
        // request and release the object URL. This is the "viewport lazy loading"
        // piece — requests for off-screen tiles are aborted instead of piling up.
        _removeTile: function (key) {
            var tile = this._tiles[key];
            if (tile && tile.el && tile.el._coronaJobKey) {
                Queue.cancel(tile.el._coronaJobKey);
                var blobUrl = this._blobUrls[tile.el._coronaJobKey];
                if (blobUrl) {
                    try { root.URL.revokeObjectURL(blobUrl); } catch (e) {}
                    delete this._blobUrls[tile.el._coronaJobKey];
                }
            }
            return L.TileLayer.WMS.prototype._removeTile.call(this, key);
        },

        // Allow live reconfiguration of the zoom threshold from the console.
        setMinZoom: function (z) {
            this.options.minZoom = z;
            if (this._map) this.redraw();
        },

        getCoronaStats: Queue.stats
    });

    function makeCacheKey(label, z, x, y) {
        // Keep the label but strip characters that are awkward as an IDB key.
        var safe = String(label).replace(/[^a-zA-Z0-9_-]/g, '_');
        return 'corona_' + safe + '_' + z + '_' + x + '_' + y;
    }

    function computePriority(map, coords, z) {
        try {
            // Centre of the tile in pixel space at zoom z.
            var tileCenter = L.point(
                (coords.x + 0.5) * 256,
                (coords.y + 0.5) * 256
            );
            var viewCenter = map.project(map.getCenter(), z);
            var dx = tileCenter.x - viewCenter.x;
            var dy = tileCenter.y - viewCenter.y;
            var dist = Math.sqrt(dx * dx + dy * dy);
            // Closer to centre => higher priority. Negative so larger = better.
            return -Math.round(dist);
        } catch (e) {
            return 0;
        }
    }

    /* ───────────────────────────────────────────────────────────────────────
     * 7. Factory + exports
     * ───────────────────────────────────────────────────────────────────── */
    function coronaWmsLayer(url, options) {
        return new CoronaWmsLayer(url, options);
    }

    root.CoronaWmsLayer = CoronaWmsLayer;
    root.CoronaWmsQueue = Queue;
    root.createCoronaWmsLayer = coronaWmsLayer;
    root.coronaProbeTiles = coronaProbeTiles;

    // Console helper for on-device verification (Step 9 of the brief).
    root.coronaWmsDebug = function () {
        var s = Queue.stats();
		console.log('[CoronaWms] device:', s.isMobile ? 'MOBILE' : 'DESKTOP',
            '| minZoom:', s.minZoom, '| max concurrent:', s.concurrent);
        console.log('[CoronaWms] active:', s.active, '| queued:', s.waiting,
            '| cacheHits:', s.totals.cacheHits, '| fetched:', s.totals.fetched,
            '| failed:', s.totals.failed, '| cancelled:', s.totals.cancelled,
            '| circuitOpen:', s.circuitOpen);
        return s;
    };

    console.log('[CoronaWms] optimised layer initialised (' +
        (IS_MOBILE ? 'mobile' : 'desktop') + ', minZoom=' + CONFIG.minZoom +
        ', concurrent=' + CONFIG.concurrent + ').');

})(typeof window !== 'undefined' ? window : this);

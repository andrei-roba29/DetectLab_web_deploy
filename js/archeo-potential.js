/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DetectLab — "Archeological Potential Sites" / "Zone cu potențial arheologic"
 * Premium map analysis layer.
 *
 * PURPOSE
 * ───────
 * This layer does NOT predict archaeological sites with AI. It identifies
 * candidate areas that *statistically* have a higher probability of containing
 * undiscovered sites, based purely on the spatial distribution of the already
 * known archaeological sites inside a working area.
 *
 * WORKFLOW (triggered by the "Detect / Detectează" button)
 * ────────
 *   1. Take the current map center.
 *   2. Build a search circle of `SEARCH_RADIUS_M` (default 10 km) around it.
 *   3. Load every known archaeological site intersecting that circle
 *      (from DetectLab's own API — layers 0/5/6, same source as the
 *      Patrimoniu layer) and the UAT "red" raster coverage.
 *   4. Run a Delaunay triangulation over the site coordinates.
 *   5. Generate candidate seeds near the centroids / interiors of the
 *      Delaunay triangles ("empty spaces surrounded by known sites").
 *   6. Apply the mandatory filters (see CONFIG / filters below).
 *   7. Score + classify every surviving candidate (Medium / High Potential).
 *   8. De-duplicate (spatial separation) and render 300 m purple circles.
 *
 * MANDATORY FILTERS (every candidate must pass ALL of them)
 * ─────────────────────────────────────────────────────────────
 *   A. UAT / "red zone" constraint  — the candidate must fall inside the
 *      UAT layer's red area. This app renders UAT as raster tiles on
 *      Cloudflare R2, so we read the tile pixel under the candidate:
 *      opaque pixel  → inside a UAT polygon ("red")  → keep
 *      transparent   → outside the red area          → discard
 *      tile missing / unreadable → we FAIL CLOSED (discard) — same policy
 *      the rest of the app uses for its UAT checks.
 *   B. Distance from existing sites — each known site has a protection
 *      radius (`SITE_RADIUS_M`, default 600 m, the same value the app's
 *      heritage circles use). A candidate must be at least
 *      `SITE_RADIUS_M + SITE_BUFFER_M` (600 + 100 m) away from every
 *      site's center. Polygon sites (layer 6) are covered by guard points
 *      placed along their perimeter every `POLYGON_GUARD_STEP_M` + their
 *      centroid, and candidates may not fall inside a site polygon at all.
 *   C. Search circle — candidates are only kept inside `SEARCH_RADIUS_M`.
 *   D. Candidate separation — after scoring, candidates closer than
 *      `CANDIDATE_MIN_SEPARATION_M` are merged (greedy keep-highest).
 *
 * SCORING (normalized 0..1, configurable weights)
 * ────────
 *   • nearby site count   (2 sites → low, 4 → medium, 6+ → high)
 *   • average distance to the K nearest sites (closer → higher)
 *   • Delaunay triangle quality + centroid proximity (well-formed triangles
 *     get extra weight, elongated slivers contribute less)
 *   • local site density (dense clusters → higher confidence)
 *
 * PERFORMANCE
 * ───────────
 *   • A lazy global grid index (lightweight R-tree-style culling) is built
 *     once over all loaded heritage features and cached.
 *   • UAT tile pixels are fetched through the app's existing per-tile
 *     promise cache (`window._uatGetTile`), so the 10 km area typically
 *     touches only a few hundred cached tile requests regardless of how
 *     many candidates are tested.
 *   • Analysis runs in async chunks, yielding to the UI between batches so
 *     the map stays responsive. A Web Worker is unnecessary here: the heavy
 *     parts are the (already async + cached) tile reads, and the geometry
 *     itself is O(n log n)-ish over a few hundred points.
 *
 * CONFIGURATION
 * ─────────────
 *   Everything is exposed via `window.ARCH_POTENTIAL_CONFIG` and can be
 *   tuned live from the browser console without a redeploy, e.g.:
 *       ARCH_POTENTIAL_CONFIG.CLASSIFY.SCORE_HIGH_FROM = 0.6;
 *       ARCH_POTENTIAL_CONFIG.SEARCH_RADIUS_M = 15000;
 *   Adding a new scoring criterion later = add a factor + a weight row in
 *   CONFIG.SCORING and merge it in `scoreCandidate()`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
    'use strict';

    /* ═══════════════════════════════════════════════════════════════════════
     * 1. CONFIGURATION
     * ═══════════════════════════════════════════════════════════════════════ */
    var CONFIG = {
        // Working area -------------------------------------------------------
        SEARCH_RADIUS_M: 10000,      // pipeline default (also the report's radius)
        // The layer's own slider: 1–10 km around the purple pin (or around the
        // map centre when pin mode is off). SEARCH_RADIUS_M stays the default
        // for headless callers (js/archeo-report.js).
        RADIUS_KM_MIN: 1,
        RADIUS_KM_MAX: 10,
        RADIUS_KM_DEFAULT: 10,
        SITE_LAYERS: [0, 5, 6],      // DetectLab API layer ids used as "known sites"
                                     //   0 = RAN archaeological sites (points)
                                     //   5 = Tumuli (points)
                                     //   6 = RAN site boundaries (polygons)
        INCLUDE_APPROXIMATE_SITES: true,  // layer 0 sites with COORD !== 'DA' (locality-level precision)

        // Site protection radii (distance filter) ---------------------------
        SITE_RADIUS_M: 600,          // each known site's protection/search radius (matches app circles)
        SITE_BUFFER_M: 100,          // mandatory clearance OUTSIDE the radius: dist > radius + buffer
        POLYGON_GUARD_STEP_M: 400,   // guard-point spacing along polygon perimeters (like the app's circles)
        SITE_DEDUPE_M: 25,           // merge site points closer than this (avoid degenerate triangles)

        // Candidate generation ----------------------------------------------
        MIN_TRIANGLE_QUALITY: 0.12,  // skip Delaunay slivers below this quality (0..1)
        MIN_TRIANGLE_AREA_M2: 2500,  // skip triangles smaller than this (no room for a candidate)
        EXTRA_SAMPLES_MIN_RADIUS_M: 2000, // triangles with circumradius ≥ this get interior samples
        MAX_SAMPLES_PER_TRIANGLE: 5, // hard cap on candidate seeds per triangle

        // Candidate output (Delaunay-seed pipeline — window.computeArcheoPotential,
        // consumed by the Archeological Report; unchanged on purpose) ---------
        CANDIDATE_RADIUS_M: 300,     // rendered circle radius
        CANDIDATE_MIN_SEPARATION_M: 900, // suppress candidates closer than this (300 m circles won't overlap)
        MAX_CANDIDATES: 80,          // cap the final output for readability

        // Score field --------------------------------------------------------
        // Both display modes read the SAME dense grid of scores covering the
        // whole search circle (no un-scored gaps):
        //   • bubbles — a SPARSE, non-overlapping selection of the best cells
        //     (see CONFIG.BUBBLE): readable circles that never touch each other
        //     and never touch the red exclusion mask;
        //   • heat    — a true score raster over every scored cell (see
        //     CONFIG.HEAT), plus a red mask for the excluded areas (UAT built-up
        //     + heritage protection radii).
        FIELD: {
            MODE: 'bubbles',              // 'bubbles' | 'heat' (UI: Bubbles / Heatmap)
            BUBBLE_CELL_M: 250,           // baseline cell spacing in bubble mode
            BUBBLE_MAX_CELLS: 2200,       // grows the cell size on big radii (phones)
            HEAT_CELL_M: 120,             // baseline cell spacing in heat mode
            HEAT_MAX_CELLS: 9000,
            TRI_INDEX_CELL_M: 2500,       // triangle bucket size for point lookups
            OUTSIDE_HULL_TRI_SCORE: 0.15, // cells beyond the site convex hull
            PROGRESS_EVERY: 500,          // cells between status updates
            CHUNK_SIZE: 120               // cells per async batch
        },

        // Bubble output — the "sweet spot" -----------------------------------
        // The score grid stays dense (that is what the heatmap reads), but only
        // a few cells are promoted to visible circles. A bubble is drawn only
        // when the whole disc fits:
        //   • ≥ GAP_M away from every other bubble (they never touch),
        //   • ≥ GAP_M away from the red mask — the 700 m heritage rings, the
        //     site polygons and the UAT built-up rectangles,
        //   • score ≥ MIN_SCORE (weak cells stay in the heatmap).
        // Count and size scale with the slider radius so a 1 km analysis and a
        // 10 km analysis look equally readable on screen.
        BUBBLE: {
            RADIUS_M: 420,            // bubble radius at the 10 km reference radius
            RADIUS_MIN_M: 150,        // preferred floor for a bubble radius
            RADIUS_FLOOR_M: 90,       // absolute floor, used only by the relaxed pass
            RADIUS_MAX_M: 520,
            GAP_M: 260,               // clear gap BETWEEN BUBBLES at 10 km
            GAP_MIN_M: 80,
            MASK_CLEARANCE_M: 90,     // clear gap between a bubble and the red mask
            MIN_SCORE: 0.30,          // below this the cell is left to the heatmap
            PER_KM2: 0.22,            // target bubble density (sweet spot)
            MIN_BUBBLES: 10,          // floor of the cap for small radii
            MAX_BUBBLES: 140          // hard cap so the map never gets crowded
        },

        // Heatmap output ------------------------------------------------------
        // The heat surface is a raster of SCORES (not accumulated alpha), so a
        // colour always means the same thing: the score of that ground. The
        // score window is stretched over the run's own 2nd..98th percentile so
        // the weak/strong contrast stays visible even when the raw scores sit
        // in a narrow band, and alpha also grows with the score.
        HEAT: {
            OPACITY: 0.80,            // whole-surface opacity over the basemap
            ALPHA_MIN: 0.46,          // alpha of the weakest cells
            ALPHA_MAX: 0.97,          // alpha of the strongest cells
            SMOOTH_SIGMA_CELLS: 1.0,  // gaussian smoothing, in grid cells
            LOW_PERCENTILE: 0.02,     // score window lower edge
            HIGH_PERCENTILE: 0.98,    // score window upper edge
            MIN_WINDOW: 0.12          // never compress the window below this span
        },

        // Rendering ----------------------------------------------------------
        PANE_Z_INDEX: 660,           // above heritage canvas (650) + markers (600), below popups (700)
        PANE_Z_HEAT: 656,            // heatmap canvas, under the bubbles
        PANE_Z_MASK: 658,            // red exclusion mask (UAT + heritage radii)
        PANE_Z_PIN: 662,             // purple analysis pin + its tooltip
        SHOW_WORKING_AREA: true,     // draw the search circle + center marker
        SHOW_TRIANGULATION: false,   // debug: draw the Delaunay triangles

        // Purple analysis pin (same anatomy as the report's blue pin) --------
        PIN: {
            COLOR: '#a070e8',
            FILL: '#c4a0f0',
            CIRCLE_IDLE: { color: '#c4a0f0', weight: 1.8, dashArray: '5 6', fill: true, fillColor: '#a070e8', fillOpacity: 0.05, opacity: 0.85 },
            CIRCLE_DRAG: { color: '#c4a0f0', weight: 2, dashArray: null, fill: false, fillColor: '#a070e8', fillOpacity: 0, opacity: 0.95 }
        },

        // Red exclusion mask -------------------------------------------------
        MASK: {
            COLOR: '#e03c3c',
            FILL: '#c0392b',
            FILL_OPACITY_UAT: 0.34,
            FILL_OPACITY_SITE: 0.20,
            OPACITY: 0.75
        },

        // Classification thresholds ------------------------------------------
        CLASSIFY: {
            SCORE_DISCARD_BELOW: 0.25,  // score < this  → discarded
            SCORE_HIGH_FROM: 0.55       // score >= this → High Potential; else Medium
        },

        // Scoring ------------------------------------------------------------
        SCORING: {
            // contribution 1: number of sites within NEARBY_RADIUS_M
            NEARBY_RADIUS_M: 1500,
            NEARBY_COUNT_REF: 6,        // 2 → 0.33 (low), 4 → 0.67 (medium), 6+ → 1.0 (high)
            // contribution 2: average distance to the K nearest sites
            K_NEAREST: 5,
            AVG_DIST_REFERENCE_M: 3000, // avg distance of this → 0 contribution; closer → higher
            // contribution 3: triangulation quality (computed per seed)
            // contribution 4: site density within DENSITY_RADIUS_M
            DENSITY_RADIUS_M: 3000,
            DENSITY_COUNT_REF: 8,
            // weights (must sum to 1)
            W_NEARBY: 0.30,
            W_AVG_DIST: 0.25,
            W_TRIANGLE: 0.25,
            W_DENSITY: 0.20
        },

        // Data source --------------------------------------------------------
        UAT_TILE_SIZE: 256,
        SITES_DATA_POLL_MS: 200,     // how often we wait for the site data to load
        SITES_DATA_TIMEOUT_MS: 20000 // give up waiting after this
    };

    // Allow live tuning from the console: window.ARCH_POTENTIAL_CONFIG.X = ...
    window.ARCH_POTENTIAL_CONFIG = CONFIG;

    /* ═══════════════════════════════════════════════════════════════════════
     * 2. MATH / GEO HELPERS
     * ═══════════════════════════════════════════════════════════════════════ */

    // Great-circle distance in meters (Haversine).
    function haversineM(aLat, aLng, bLat, bLng) {
        var R = 6371000;
        var dLat = (bLat - aLat) * Math.PI / 180;
        var dLng = (bLng - aLng) * Math.PI / 180;
        var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
    }

    // Local Web Mercator-ish projection in meters, centered so that a 10 km
    // working area has negligible distortion. `lat0` is the map center latitude.
    function projectToLocalMeters(lat, lng, lat0) {
        var kLng = 111320 * Math.cos(lat0 * Math.PI / 180);
        var kLat = 111320;
        return { x: lng * kLng, y: lat * kLat };
    }

    function clamp01(v) {
        return v < 0 ? 0 : (v > 1 ? 1 : v);
    }

    /* ── Lightweight grid spatial index ────────────────────────────────────
     * A fixed-cell uniform grid used as an R-tree-style culling structure.
     * `cellSizeM` is in the same units as the stored coordinates (meters for
     * local grids, or equirectangular degrees for the global site cache).
     * Insert is O(1); circle queries visit only the cells overlapped by the
     * query circle, then apply an exact distance test. */
    function createGridIndex(cellSizeX, cellSizeY) {
        var cells = {}; // key "cx,cy" -> [items]
        return {
            cellSizeX: cellSizeX,
            cellSizeY: cellSizeY,
            insert: function (x, y, item) {
                var cx = Math.floor(x / cellSizeX);
                var cy = Math.floor(y / cellSizeY);
                var key = cx + ',' + cy;
                if (!cells[key]) cells[key] = [];
                cells[key].push(item);
            },
            // Return every item whose cell intersects the circle (x,y,r).
            // The caller still must verify exact distance; the grid only culls.
            queryCircle: function (x, y, r) {
                var out = [];
                var minCx = Math.floor((x - r) / cellSizeX);
                var maxCx = Math.floor((x + r) / cellSizeX);
                var minCy = Math.floor((y - r) / cellSizeY);
                var maxCy = Math.floor((y + r) / cellSizeY);
                for (var cx = minCx; cx <= maxCx; cx++) {
                    for (var cy = minCy; cy <= maxCy; cy++) {
                        var bucket = cells[cx + ',' + cy];
                        if (bucket) {
                            for (var i = 0; i < bucket.length; i++) out.push(bucket[i]);
                        }
                    }
                }
                return out;
            }
        };
    }

    // Ray-casting point-in-polygon (planar). `poly` = array of {x,y}.
    function pointInPolygon(px, py, poly) {
        var inside = false;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            var xi = poly[i].x, yi = poly[i].y;
            var xj = poly[j].x, yj = poly[j].y;
            if (((yi > py) !== (yj > py)) &&
                (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }

    /* ═══════════════════════════════════════════════════════════════════════
     * 3. SITE DATA — LOADING + GLOBAL SPATIAL CACHE
     * ═══════════════════════════════════════════════════════════════════════
     * The full heritage FeatureCollections are already fetched by map-app.js
     * into window._localLayerData (layers 0/5/6). We cache a flat, precomputed
     * point list + polygon list in a global grid index, built lazily ONCE,
     * then query the 10 km circle per analysis run. */

    var _siteIndexCache = null; // { key, pointIndex, polygons }

    // Wait until the app's layer data has been fetched (it loads on page
    // load asynchronously). Resolves with the raw layer data object.
    function waitForSiteData() {
        return new Promise(function (resolve, reject) {
            var waited = 0;
            var poll = function () {
                var data = window._localLayerData;
                if (data && data[0] !== undefined && data[0] !== null) {
                    return resolve(data);
                }
                waited += CONFIG.SITES_DATA_POLL_MS;
                if (waited >= CONFIG.SITES_DATA_TIMEOUT_MS) {
                    return resolve(data || {});
                }
                setTimeout(poll, CONFIG.SITES_DATA_POLL_MS);
            };
            poll();
        });
    }

    // Build (once) the global spatial cache over all heritage features.
    // Returns { pointIndex, polygons }.
    //
    // pointIndex is a global grid in *equirectangular degrees-ish* units so
    // that it covers all of Romania with a single built structure. The grid
    // is only a culling structure — exact distances are recomputed in local
    // meters per analysis run.
    function buildGlobalSiteIndex(data) {
        var key = CONFIG.SITE_LAYERS.join(',') + '|' + (CONFIG.INCLUDE_APPROXIMATE_SITES ? 1 : 0);
        // Rebuild when the config changes OR when the underlying layer data
        // object is replaced (e.g. a future refresh of window._localLayerData).
        if (_siteIndexCache && _siteIndexCache.key === key && _siteIndexCache.dataRef === data) {
            return _siteIndexCache;
        }

        var DEG_CELL = 0.02; // ~2.2 km cell at lat 45°
        var pointIndex = createGridIndex(DEG_CELL, DEG_CELL);
        var polygons = [];

        CONFIG.SITE_LAYERS.forEach(function (lid) {
            var fc = data[lid];
            if (!fc || !fc.features) return;
            fc.features.forEach(function (f) {
                if (!f.geometry) return;
                var props = f.properties || {};

                if (lid === 0 && !CONFIG.INCLUDE_APPROXIMATE_SITES && props.COORD !== 'DA') return;

                if (f.geometry.type === 'Point') {
                    var c = f.geometry.coordinates;
                    pointIndex.insert(c[0], c[1], {
                        lat: c[1], lng: c[0], layerId: lid, oid: f.id, props: props
                    });
                } else if (f.geometry.type === 'Polygon') {
                    // coordinates = array of rings
                    polygons.push(polygonRecord(lid, f.id, props, f.geometry.coordinates));
                } else if (f.geometry.type === 'MultiPolygon') {
                    // treat each member polygon as a separate site boundary
                    f.geometry.coordinates.forEach(function (polyCoords) {
                        polygons.push(polygonRecord(lid, f.id, props, polyCoords));
                    });
                }
            });
        });

        _siteIndexCache = { key: key, dataRef: data, pointIndex: pointIndex, polygons: polygons };
        return _siteIndexCache;
    }

    function polygonBbox(rings) {
        var minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
        rings.forEach(function (ring) {
            ring.forEach(function (p) {
                if (p[0] < minLng) minLng = p[0];
                if (p[0] > maxLng) maxLng = p[0];
                if (p[1] < minLat) minLat = p[1];
                if (p[1] > maxLat) maxLat = p[1];
            });
        });
        return { minLng: minLng, minLat: minLat, maxLng: maxLng, maxLat: maxLat };
    }

    function polygonRecord(layerId, oid, props, ringsArray) {
        var rings = ringsArray.map(function (ring) {
            return ring.map(function (pt) { return { lng: pt[0], lat: pt[1] }; });
        });
        return {
            layerId: layerId, oid: oid, props: props,
            rings: rings,
            bbox: polygonBbox(ringsArray)
        };
    }

    // Collect every site inside the search circle, projected into local meters.
    // Returns { sites: [{x,y,lat,lng,layerId,oid}], polygons: [{rings(local), bboxLocal}] }
    function collectSitesInRadius(centerLat, centerLng, radiusM, lat0) {
        var cache = buildGlobalSiteIndex(window._localLayerData || {});
        var c = projectToLocalMeters(centerLat, centerLng, lat0);
        var DEG_R = radiusM / 111320; // coarse degree radius for culling

        var sites = [];
        var seen = {}; // dedupe within ~SITE_DEDUPE_M

        var rawPoints = cache.pointIndex.queryCircle(centerLng, centerLat, DEG_R * 1.6);
        for (var i = 0; i < rawPoints.length; i++) {
            var p = rawPoints[i];
            var pm = projectToLocalMeters(p.lat, p.lng, lat0);
            var d = Math.sqrt((pm.x - c.x) * (pm.x - c.x) + (pm.y - c.y) * (pm.y - c.y));
            if (d > radiusM) continue;
            // dedupe: merge sites closer than SITE_DEDUPE_M (they would create
            // degenerate triangles); keep the first representative.
            var cell = Math.round(pm.x / CONFIG.SITE_DEDUPE_M) + '|' + Math.round(pm.y / CONFIG.SITE_DEDUPE_M);
            var merged = false;
            for (var k = 0; k < 9; k++) {
                var dx = (k % 3) - 1, dy = Math.floor(k / 3) - 1;
                var key = (Math.round(pm.x / CONFIG.SITE_DEDUPE_M) + dx) + '|' + (Math.round(pm.y / CONFIG.SITE_DEDUPE_M) + dy);
                if (seen[key]) { merged = true; break; }
            }
            if (merged) continue;
            seen[cell] = true;
            sites.push({ x: pm.x, y: pm.y, lat: p.lat, lng: p.lng, layerId: p.layerId, oid: p.oid, props: p.props });
        }

        // Polygons intersecting the circle → guard points + local geometry.
        var polygons = [];
        for (var pi = 0; pi < cache.polygons.length; pi++) {
            var poly = cache.polygons[pi];
            var b = poly.bbox;
            if (b.maxLng < centerLng - DEG_R || b.minLng > centerLng + DEG_R ||
                b.maxLat < centerLat - DEG_R || b.minLat > centerLat + DEG_R) continue;

            var localRings = poly.rings.map(function (ring) {
                return ring.map(function (pt) {
                    var m = projectToLocalMeters(pt.lat, pt.lng, lat0);
                    return { x: m.x, y: m.y };
                });
            });

            // centroid (area-weighted on the outer ring)
            var outer = localRings[0];
            var area2 = 0, cx = 0, cy = 0;
            for (var vi = 0; vi < outer.length - 1; vi++) {
                var cross = outer[vi].x * outer[vi + 1].y - outer[vi + 1].x * outer[vi].y;
                area2 += cross;
                cx += (outer[vi].x + outer[vi + 1].x) * cross;
                cy += (outer[vi].y + outer[vi + 1].y) * cross;
            }
            if (area2 !== 0) { cx /= 3 * area2; cy /= 3 * area2; } else { cx = outer[0].x; cy = outer[0].y; }

            // guard points along the perimeter (matches the app's 600 m circle
            // approach for polygons) + the centroid
            var guards = [{ x: cx, y: cy }];
            localRings.forEach(function (ring) {
                for (var j = 0; j < ring.length - 1; j++) {
                    var a = ring[j], b = ring[j + 1];
                    var len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
                    var steps = Math.max(1, Math.ceil(len / CONFIG.POLYGON_GUARD_STEP_M));
                    for (var s = 0; s < steps; s++) {
                        guards.push({
                            x: a.x + (b.x - a.x) * s / steps,
                            y: a.y + (b.y - a.y) * s / steps
                        });
                    }
                }
            });

            var hasGuardInside = false;
            for (var g = 0; g < guards.length; g++) {
                var gd = Math.sqrt((guards[g].x - c.x) * (guards[g].x - c.x) + (guards[g].y - c.y) * (guards[g].y - c.y));
                if (gd <= radiusM) {
                    hasGuardInside = true;
                    // dedupe guard points too (dense polygons would flood the list)
                    var gkey = Math.round(guards[g].x / CONFIG.SITE_DEDUPE_M) + '|' + Math.round(guards[g].y / CONFIG.SITE_DEDUPE_M);
                    if (!seen[gkey]) {
                        seen[gkey] = true;
                        var ll = localMetersToLatLng(guards[g].x, guards[g].y, lat0);
                        sites.push({ x: guards[g].x, y: guards[g].y, lat: ll.lat, lng: ll.lng, layerId: poly.layerId, oid: poly.oid, props: poly.props, isGuard: true });
                    }
                }
            }
            if (hasGuardInside) polygons.push({ rings: localRings, layerId: poly.layerId, oid: poly.oid });
        }

        return { sites: sites, polygons: polygons };
    }

    function localMetersToLatLng(x, y, lat0) {
        var kLng = 111320 * Math.cos(lat0 * Math.PI / 180);
        return { lat: y / 111320, lng: x / kLng };
    }

    /* ═══════════════════════════════════════════════════════════════════════
     * 4. DELAUNAY TRIANGULATION (Bowyer–Watson)
     * ═══════════════════════════════════════════════════════════════════════
     * Input:  array of points {x, y} in local meters (with a stable `i` index).
     * Output: array of triangles [{a, b, c}] referencing the input points
     *         (super-triangle vertices are stripped).
     * Complexity: expected O(n log n) for reasonably distributed sites. */

    function circumcircle(t) {
        var d = 2 * (t.a.x * (t.b.y - t.c.y) + t.b.x * (t.c.y - t.a.y) + t.c.x * (t.a.y - t.b.y));
        if (Math.abs(d) < 1e-9) return null; // collinear / degenerate
        var a2 = t.a.x * t.a.x + t.a.y * t.a.y;
        var b2 = t.b.x * t.b.x + t.b.y * t.b.y;
        var c2 = t.c.x * t.c.x + t.c.y * t.c.y;
        var ux = (a2 * (t.b.y - t.c.y) + b2 * (t.c.y - t.a.y) + c2 * (t.a.y - t.b.y)) / d;
        var uy = (a2 * (t.c.x - t.b.x) + b2 * (t.a.x - t.c.x) + c2 * (t.b.x - t.a.x)) / d;
        return {
            cx: ux, cy: uy,
            r: Math.sqrt((ux - t.a.x) * (ux - t.a.x) + (uy - t.a.y) * (uy - t.a.y))
        };
    }

    function circumcircleContains(t, p) {
        var cc = circumcircle(t);
        if (!cc) return false;
        var ddx = p.x - cc.cx, ddy = p.y - cc.cy;
        return (ddx * ddx + ddy * ddy) < cc.r * cc.r;
    }

    function delaunayTriangulation(points) {
        var n = points.length;
        if (n < 3) return [];

        // Normalize: every input point needs a stable index for edge dedup.
        for (var ni = 0; ni < n; ni++) {
            if (points[ni].i === undefined) points[ni].i = ni;
        }

        // super-triangle covering the whole point set
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var i = 0; i < n; i++) {
            if (points[i].x < minX) minX = points[i].x;
            if (points[i].x > maxX) maxX = points[i].x;
            if (points[i].y < minY) minY = points[i].y;
            if (points[i].y > maxY) maxY = points[i].y;
        }
        var dx = (maxX - minX) || 1, dy = (maxY - minY) || 1;
        var dmax = Math.max(dx, dy);
        var midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
        var superVerts = [
            { x: midX - 20 * dmax, y: midY - dmax, i: -1, isSuper: true },
            { x: midX, y: midY + 20 * dmax, i: -2, isSuper: true },
            { x: midX + 20 * dmax, y: midY - dmax, i: -3, isSuper: true }
        ];

        var triangles = [{ a: superVerts[0], b: superVerts[1], c: superVerts[2] }];

        for (var pi = 0; pi < n; pi++) {
            var p = points[pi];
            var bad = [];
            var edgeCount = {}; // key "minI|maxI" -> count

            function addEdge(u, v) {
                var key = (u.i < v.i ? u.i + '|' + v.i : v.i + '|' + u.i);
                edgeCount[key] = (edgeCount[key] || 0) + 1;
            }

            for (var ti = 0; ti < triangles.length; ti++) {
                var t = triangles[ti];
                if (circumcircleContains(t, p)) {
                    bad.push(t);
                    addEdge(t.a, t.b);
                    addEdge(t.b, t.c);
                    addEdge(t.c, t.a);
                }
            }

            if (bad.length === 0) continue;

            // cavity boundary = edges that appear exactly once
            var boundary = [];
            for (var key in edgeCount) {
                if (edgeCount[key] === 1) {
                    var parts = key.split('|');
                    boundary.push({ u: +parts[0], v: +parts[1] });
                }
            }

            // map vertex index -> vertex object (bad triangles are the only source)
            var verts = {};
            bad.forEach(function (bt) {
                verts[bt.a.i] = bt.a; verts[bt.b.i] = bt.b; verts[bt.c.i] = bt.c;
            });

            triangles = triangles.filter(function (t) { return bad.indexOf(t) === -1; });
            for (var e = 0; e < boundary.length; e++) {
                triangles.push({
                    a: verts[boundary[e].u],
                    b: verts[boundary[e].v],
                    c: p
                });
            }
        }

        // strip super-triangle vertices + degenerate slivers
        var out = [];
        for (var k = 0; k < triangles.length; k++) {
            var tr = triangles[k];
            if (tr.a.isSuper || tr.b.isSuper || tr.c.isSuper) continue;
            var area = Math.abs(
                (tr.b.x - tr.a.x) * (tr.c.y - tr.a.y) - (tr.c.x - tr.a.x) * (tr.b.y - tr.a.y)
            ) / 2;
            if (!isFinite(area) || area < CONFIG.MIN_TRIANGLE_AREA_M2) continue;
            out.push(tr);
        }
        return out;
    }

    // Triangle quality in [0,1]: 1 for equilateral, → 0 for slivers.
    // q = 16·area² / (perimeter · a·b·c)  (ratio of inradius/circumradius × 2)
    function triangleQuality(t) {
        var a = Math.sqrt((t.b.x - t.c.x) * (t.b.x - t.c.x) + (t.b.y - t.c.y) * (t.b.y - t.c.y));
        var b = Math.sqrt((t.a.x - t.c.x) * (t.a.x - t.c.x) + (t.a.y - t.c.y) * (t.a.y - t.c.y));
        var c = Math.sqrt((t.a.x - t.b.x) * (t.a.x - t.b.x) + (t.a.y - t.b.y) * (t.a.y - t.b.y));
        var s = (a + b + c) / 2;
        var area2 = s * (s - a) * (s - b) * (s - c);
        var area = area2 > 0 ? Math.sqrt(area2) : 0;
        var q = (16 * area * area) / ((a + b + c) * a * b * c);
        if (!isFinite(q) || isNaN(q)) return 0;
        return clamp01(q);
    }

    function triangleCentroid(t) {
        return { x: (t.a.x + t.b.x + t.c.x) / 3, y: (t.a.y + t.b.y + t.c.y) / 3 };
    }

    /* ═══════════════════════════════════════════════════════════════════════
     * 5. CANDIDATE SEEDS FROM TRIANGLES
     * ═══════════════════════════════════════════════════════════════════════
     * Each seed = an interior point of a Delaunay triangle plus metadata used
     * by the scoring step (triangle quality, distance to centroid). */

    var BARYCENTRIC_EXTRA = [
        [0.55, 0.225, 0.225],
        [0.225, 0.55, 0.225],
        [0.225, 0.225, 0.55],
        [0.334, 0.333, 0.333]
    ];

    function sampleTriangles(triangles, lat0) {
        var seeds = [];
        for (var i = 0; i < triangles.length; i++) {
            var t = triangles[i];
            var q = triangleQuality(t);
            if (q < CONFIG.MIN_TRIANGLE_QUALITY) continue;

            var cc = circumcircle(t);
            var circR = cc ? cc.r : 0;
            var cent = triangleCentroid(t);

            var samples = [{ w: [1 / 3, 1 / 3, 1 / 3] }]; // centroid first
            if (circR >= CONFIG.EXTRA_SAMPLES_MIN_RADIUS_M) {
                for (var b = 0; b < BARYCENTRIC_EXTRA.length; b++) samples.push({ w: BARYCENTRIC_EXTRA[b] });
            }
            if (samples.length > CONFIG.MAX_SAMPLES_PER_TRIANGLE) {
                samples.length = CONFIG.MAX_SAMPLES_PER_TRIANGLE;
            }

            for (var s = 0; s < samples.length; s++) {
                var w = samples[s].w;
                var px = t.a.x * w[0] + t.b.x * w[1] + t.c.x * w[2];
                var py = t.a.y * w[0] + t.b.y * w[1] + t.c.y * w[2];
                var dCentroid = Math.sqrt((px - cent.x) * (px - cent.x) + (py - cent.y) * (py - cent.y));
                var centroidBonus = circR > 0 ? clamp01(1 - dCentroid / circR) : 1;
                var ll = localMetersToLatLng(px, py, lat0);

                seeds.push({
                    x: px, y: py,
                    lat: ll.lat, lng: ll.lng,
                    triQuality: q,
                    circumRadius: circR,
                    centroidDistM: dCentroid,
                    triScore: q * (0.5 + 0.5 * centroidBonus)
                });
            }
        }
        return seeds;
    }

    /* ═══════════════════════════════════════════════════════════════════════
     * 6. UAT "RED ZONE" CHECK (async, raster pixels)
     * ═══════════════════════════════════════════════════════════════════════
     * Reuses the app's cached tile loader (window._uatGetTile). A candidate is
     * "inside the red zone" iff the tile pixel under it is OPAQUE (drawn red on
     * the UAT raster = inside a UAT polygon). Transparent = outside the red
     * area. Missing/unreadable tiles → null → FAIL CLOSED (discarded). */

    var UAT_UNREADABLE = window._UAT_TILE_UNREADABLE;

    function uatTileZ() {
        return (window.UAT_TILE_Z !== undefined) ? window.UAT_TILE_Z : 14;
    }

    // Same math as map-app.js (UAT raster is generated with gdal2tiles, TMS
    // naming, XYZ pixel layout — only the row number in the URL is flipped).
    function uatLngToTileXF(lng, z) { return (lng + 180) / 360 * Math.pow(2, z); }
    function uatLatToTileYF(lat, z) {
        var rad = lat * Math.PI / 180;
        return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z);
    }

    // Promise<boolean|null>: true = inside the red UAT area, false = not red,
    // null = no data / uncertain (callers must fail closed).
    function uatPixelAt(lat, lng) {
        if (typeof window._uatGetTile !== 'function') {
            return Promise.resolve(null);
        }
        var z = uatTileZ();
        var txF = uatLngToTileXF(lng, z);
        var tyF = uatLatToTileYF(lat, z);
        var tx = Math.floor(txF), ty = Math.floor(tyF);
        var max = Math.pow(2, z);
        if (tx < 0 || ty < 0 || tx >= max || ty >= max) return Promise.resolve(null);

        return window._uatGetTile(z, tx, ty).then(function (tile) {
            if (tile === null || tile === UAT_UNREADABLE) return null;
            var size = tile.size || CONFIG.UAT_TILE_SIZE;
            var px = Math.floor((txF - tx) * size);
            var py = Math.floor((tyF - ty) * size);
            if (px < 0 || py < 0 || px >= size || py >= size) return null;
            var idx = (py * size + px) * 4;
            return tile.data[idx + 3] > 128; // opaque = inside red UAT polygon
        });
    }

    /* ═══════════════════════════════════════════════════════════════════════
     * 7. FILTERING + SCORING + SEPARATION
     * ═══════════════════════════════════════════════════════════════════════ */

    // Mandatory spatial filters (everything except the async UAT check).
    function passesMandatorySpatialFilters(seed, ctx) {
        // C. inside the search circle
        var dx = seed.x - ctx.center.x, dy = seed.y - ctx.center.y;
        if (dx * dx + dy * dy > ctx.radius * ctx.radius) return false;

        // B. not inside any site boundary polygon
        for (var p = 0; p < ctx.polygons.length; p++) {
            var rings = ctx.polygons[p].rings;
            for (var r = 0; r < rings.length; r++) {
                if (pointInPolygon(seed.x, seed.y, rings[r])) return false;
            }
        }

        // B. outside every site's protection radius: dist > SITE_RADIUS + SITE_BUFFER
        var minDist = ctx.siteRadius + ctx.siteBuffer;
        var nearby = ctx.siteIndex.queryCircle(seed.x, seed.y, minDist);
        for (var s = 0; s < nearby.length; s++) {
            var site = nearby[s];
            var d2x = seed.x - site.x, d2y = seed.y - site.y;
            if (d2x * d2x + d2y * d2y < minDist * minDist) return false;
        }
        return true;
    }

    function scoreCandidate(seed, ctx) {
        var S = CONFIG.SCORING;
        // NOTE: the grid index only culls by cell — exact distances are
        // verified here, otherwise counts would be inflated by sites that
        // merely share a neighbouring cell with the query circle.
        var nearbyAll = ctx.siteIndex.queryCircle(seed.x, seed.y, S.NEARBY_RADIUS_M);
        var nearby = [];
        var dists = [];
        for (var i = 0; i < nearbyAll.length; i++) {
            var dx = seed.x - nearbyAll[i].x, dy = seed.y - nearbyAll[i].y;
            var d = Math.sqrt(dx * dx + dy * dy);
            if (d <= S.NEARBY_RADIUS_M) {
                nearby.push(nearbyAll[i]);
                dists.push(d);
            }
        }

        // average distance to the K nearest sites
        dists.sort(function (a, b) { return a - b; });
        var k = Math.min(S.K_NEAREST, dists.length);
        var avgDist = k > 0
            ? dists.slice(0, k).reduce(function (a, b) { return a + b; }, 0) / k
            : S.AVG_DIST_REFERENCE_M;

        var densityAll = ctx.siteIndex.queryCircle(seed.x, seed.y, S.DENSITY_RADIUS_M);
        var density = 0;
        for (var di = 0; di < densityAll.length; di++) {
            var ddx = seed.x - densityAll[di].x, ddy = seed.y - densityAll[di].y;
            if (ddx * ddx + ddy * ddy <= S.DENSITY_RADIUS_M * S.DENSITY_RADIUS_M) density++;
        }

        // Distance to the closest known site in the working area (always
        // ≥ SITE_RADIUS + SITE_BUFFER, since every candidate passed the
        // mandatory distance filter — but the exact value is useful info).
        var closestSiteM = Infinity;
        var allSites = ctx.sites || ctx.siteIndex.queryCircle(seed.x, seed.y, ctx.radius || 20000);
        for (var ci = 0; ci < allSites.length; ci++) {
            var sdx = seed.x - allSites[ci].x, sdy = seed.y - allSites[ci].y;
            var sd = Math.sqrt(sdx * sdx + sdy * sdy);
            if (sd < closestSiteM) closestSiteM = sd;
        }

        var sNearby = clamp01(nearby.length / S.NEARBY_COUNT_REF);
        var sAvgDist = 1 - clamp01(avgDist / S.AVG_DIST_REFERENCE_M);
        var sTri = clamp01(seed.triScore);
        var sDensity = clamp01(density / S.DENSITY_COUNT_REF);

        var score = S.W_NEARBY * sNearby +
            S.W_AVG_DIST * sAvgDist +
            S.W_TRIANGLE * sTri +
            S.W_DENSITY * sDensity;

        return {
            lat: seed.lat, lng: seed.lng, x: seed.x, y: seed.y,
            score: clamp01(score),
            factors: {
                nearbyCount: nearby.length,
                avgDistM: Math.round(avgDist),
                densityCount: density,
                triQuality: seed.triQuality,
                closestSiteM: isFinite(closestSiteM) ? Math.round(closestSiteM) : null,
                sNearby: sNearby, sAvgDist: sAvgDist, sTri: sTri, sDensity: sDensity
            }
        };
    }

    function classify(score) {
        if (score < CONFIG.CLASSIFY.SCORE_DISCARD_BELOW) return 'discard';
        if (score >= CONFIG.CLASSIFY.SCORE_HIGH_FROM) return 'high';
        return 'medium';
    }

    // Greedy suppression of overlapping candidates: sort by score desc, then
    // keep a candidate only if it is at least CANDIDATE_MIN_SEPARATION_M away
    // from every already-kept candidate.
    function selectSeparated(scored) {
        scored.sort(function (a, b) { return b.score - a.score; });
        var kept = [];
        var minSep2 = CONFIG.CANDIDATE_MIN_SEPARATION_M * CONFIG.CANDIDATE_MIN_SEPARATION_M;
        for (var i = 0; i < scored.length && kept.length < CONFIG.MAX_CANDIDATES; i++) {
            var c = scored[i];
            var ok = true;
            for (var j = 0; j < kept.length; j++) {
                var dx = c.x - kept[j].x, dy = c.y - kept[j].y;
                if (dx * dx + dy * dy < minSep2) { ok = false; break; }
            }
            if (ok) kept.push(c);
        }
        return kept;
    }

    /* ═══════════════════════════════════════════════════════════════════════
     * 7b. CÂMP DE SCOR — grilă densă peste întreaga rază de analiză
     * ═══════════════════════════════════════════════════════════════════════
     * DE CE: pipeline-ul pe semințe Delaunay produce candidați doar *în
     * interiorul* triunghiurilor rețelei de situri cunoscute, deci bulele
     * lăsau goluri mari nescorate pe hartă. Câmpul scorează FIECARE celulă a
     * unei grile regulate peste cercul de analiză, cu aceiași factori și
     * aceleași filtre obligatorii, și alimentează ambele moduri de afișare:
     *   • bule    — cercuri mici și dese care pavează toată zona (fără goluri);
     *   • heatmap — hartă termică peste celulele scorate + mască roșie peste
     *               cele excluse (intravilan UAT și razele de protecție).
     * Partea asincronă e doar citirea rasterului UAT (tile-uri cache-uite). */

    // Dimensiunea celulei astfel încât cercul să aibă cel mult `maxCells`
    // celule (crește automat pe raze mari, ca telefonul să rămână fluid),
    // rotunjită la 25 m.
    function gridCellM(radiusM, baseCellM, maxCells) {
        var area = Math.PI * radiusM * radiusM;
        var needed = Math.sqrt(area / Math.max(1, maxCells));
        var cell = Math.max(baseCellM || 250, needed);
        return Math.max(25, Math.round(cell / 25) * 25);
    }

    // Index uniform de bucket-uri peste triunghiurile Delaunay (inserare pe
    // bbox), ca o celulă a grilei să-și găsească triunghiul conținător în O(1)
    // în loc de O(număr triunghiuri).
    function buildTriangleIndex(triangles, cellM) {
        var index = createGridIndex(cellM, cellM);
        var records = [];
        for (var i = 0; i < triangles.length; i++) {
            var t = triangles[i];
            var minX = Math.min(t.a.x, t.b.x, t.c.x);
            var maxX = Math.max(t.a.x, t.b.x, t.c.x);
            var minY = Math.min(t.a.y, t.b.y, t.c.y);
            var maxY = Math.max(t.a.y, t.b.y, t.c.y);
            var cc = circumcircle(t);
            var rec = {
                t: t,
                quality: triangleQuality(t),
                circumR: cc ? cc.r : 0,
                centroid: triangleCentroid(t)
            };
            records.push(rec);
            for (var bx = Math.floor(minX / cellM); bx <= Math.floor(maxX / cellM); bx++) {
                for (var by = Math.floor(minY / cellM); by <= Math.floor(maxY / cellM); by++) {
                    index.insert(bx * cellM, by * cellM, rec);
                }
            }
        }
        return { index: index, cellM: cellM, records: records };
    }

    function triangleRecordAt(x, y, triIndex) {
        if (!triIndex) return null;
        var bucket = triIndex.index.queryCircle(x, y, 0);
        for (var i = 0; i < bucket.length; i++) {
            var t = bucket[i].t;
            if (pointInPolygon(x, y, [t.a, t.b, t.c])) return bucket[i];
        }
        return null;
    }

    // triScore pentru un punct oarecare: aceeași formulă pe care
    // sampleTriangles() o folosește pentru o sămânță (calitate × proximitate
    // față de centroid). În afara anvelopei de situri → un bază mică, ca
    // celulele îndepărtate să nu arate identic cu un gol „perfect”.
    function triScoreAt(x, y, triIndex) {
        var rec = triangleRecordAt(x, y, triIndex);
        if (!rec) return { triScore: CONFIG.FIELD.OUTSIDE_HULL_TRI_SCORE, triQuality: 0 };
        var dx = x - rec.centroid.x, dy = y - rec.centroid.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        var bonus = rec.circumR > 0 ? clamp01(1 - d / rec.circumR) : 1;
        return { triScore: rec.quality * (0.5 + 0.5 * bonus), triQuality: rec.quality };
    }

    // Grila regulată de celule peste cercul de analiză (numai celulele ale
    // căror centre cad în cerc). Cellulele sunt deja în metri locali.
    function buildFieldCells(centerLat, centerLng, radiusM, cellM, lat0) {
        var kLat = 111320;
        var kLng = Math.max(1, 111320 * Math.cos(lat0 * Math.PI / 180));
        var halfLat = radiusM / kLat;
        var halfLng = radiusM / kLng;
        var cellLat = cellM / kLat;
        var cellLng = cellM / kLng;
        var rows = Math.max(1, Math.ceil(2 * halfLat / cellLat));
        var cols = Math.max(1, Math.ceil(2 * halfLng / cellLng));
        var center = projectToLocalMeters(centerLat, centerLng, lat0);
        var r2 = radiusM * radiusM;
        var cells = [];
        for (var r = 0; r < rows; r++) {
            for (var c = 0; c < cols; c++) {
                var lat = centerLat - halfLat + (r + 0.5) * cellLat;
                var lng = centerLng - halfLng + (c + 0.5) * cellLng;
                var p = projectToLocalMeters(lat, lng, lat0);
                var dx = p.x - center.x, dy = p.y - center.y;
                if (dx * dx + dy * dy > r2) continue;
                cells.push({ lat: lat, lng: lng, x: p.x, y: p.y, row: r, col: c });
            }
        }
        return {
            cells: cells, rows: rows, cols: cols, cellM: cellM,
            cellLat: cellLat, cellLng: cellLng,
            bbox: {
                minLat: centerLat - halfLat, maxLat: centerLat + halfLat,
                minLng: centerLng - halfLng, maxLng: centerLng + halfLng
            }
        };
    }

    // Aceleași filtre obligatorii ca la candidați, dar raportează MOTIVUL
    // excluderii, ca modul heatmap să poată picta masca roșie:
    //   'heritage' → în raza de protecție / în poligonul unui sit cunoscut
    //   'outside'  → în afara cercului de analiză
    //   null       → trece filtrele spațiale (urmează verificarea UAT)
    function exclusionReason(cell, ctx) {
        var dx = cell.x - ctx.center.x, dy = cell.y - ctx.center.y;
        if (dx * dx + dy * dy > ctx.radius * ctx.radius) return 'outside';

        for (var p = 0; p < ctx.polygons.length; p++) {
            var rings = ctx.polygons[p].rings;
            for (var r = 0; r < rings.length; r++) {
                if (pointInPolygon(cell.x, cell.y, rings[r])) return 'heritage';
            }
        }

        var minDist = ctx.siteRadius + ctx.siteBuffer;
        var minDist2 = minDist * minDist;
        var nearby = ctx.siteIndex.queryCircle(cell.x, cell.y, minDist);
        for (var s = 0; s < nearby.length; s++) {
            var ddx = cell.x - nearby[s].x, ddy = cell.y - nearby[s].y;
            if (ddx * ddx + ddy * ddy < minDist2) return 'heritage';
        }
        return null;
    }

    /**
     * Câmpul dens de scor — sursa ambelor moduri de afișare ale stratului.
     *
     * @param {number} centerLat  centrul analizei (pinul mov sau centrul hărții)
     * @param {number} centerLng
     * @param {number} [radiusM]  raza (default: sliderul 1–10 km)
     * @param {Object} [opts]     mode 'bubbles'|'heat', isCancelled(), onProgress(0..1),
     *                            chunkSize, skipDataWait
     * @returns {Promise<{status, mode, cellM, bubbleBaseRadiusM, results, bubbles,
     *                     excluded, heatPoints, heat, bbox, ctx, stats}>}
     *          results = TOATE celulele scorate [{lat,lng,x,y,row,col,score,...}]
     *          bubbles = selecția rară, ne-suprapusă, desenată în modul BULE
     *          excluded = [{lat,lng,x,y,row,col,reason:'uat'|'heritage'}]
     *          heat    = fereastra de normalizare + rama folosite de heatmap
     */
    function computePotentialField(centerLat, centerLng, radiusM, opts) {
        opts = opts || {};
        var F = CONFIG.FIELD;
        var mode = (opts.mode === 'heat') ? 'heat' : 'bubbles';
        var radius = (typeof radiusM === 'number' && isFinite(radiusM))
            ? radiusM
            : (typeof currentRadiusM === 'function' ? currentRadiusM() : CONFIG.SEARCH_RADIUS_M);
        var lat0 = centerLat;
        var t0 = performance.now();
        var isCancelled = typeof opts.isCancelled === 'function' ? opts.isCancelled : function () { return false; };
        var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
        var chunkSize = Math.max(1, opts.chunkSize || F.CHUNK_SIZE || 120);

        return (async function main() {
            if (!opts.skipDataWait) await waitForSiteData();

            var ctx = collectSitesInRadius(centerLat, centerLng, radius, lat0);
            ctx.center = projectToLocalMeters(centerLat, centerLng, lat0);
            ctx.centerLat = centerLat;
            ctx.centerLng = centerLng;
            ctx.radius = radius;
            ctx.siteRadius = CONFIG.SITE_RADIUS_M;
            ctx.siteBuffer = CONFIG.SITE_BUFFER_M;
            ctx.mode = mode;
            ctx.triangles = [];
            ctx.triIndex = null;

            var cellM = gridCellM(radius, mode === 'heat' ? F.HEAT_CELL_M : F.BUBBLE_CELL_M,
                mode === 'heat' ? F.HEAT_MAX_CELLS : F.BUBBLE_MAX_CELLS);
            var grid = buildFieldCells(centerLat, centerLng, radius, cellM, lat0);

            var field = {
                mode: mode,
                centerLat: centerLat, centerLng: centerLng, radius: radius,
                cellM: cellM,
                bubbleBaseRadiusM: bubbleBaseRadiusM(radius),
                bubbleGapM: bubbleGapM(radius),
                grid: grid, bbox: grid.bbox,
                results: [], bubbles: [], excluded: [], heatPoints: [],
                heat: null,
                ctx: ctx,
                stats: {
                    sites: ctx.sites.length, cells: grid.cells.length,
                    scored: 0, excludedUat: 0, excludedHeritage: 0,
                    high: 0, medium: 0, low: 0,
                    bubbles: 0, bubblesHigh: 0, bubblesMedium: 0, ms: 0
                }
            };

            function finish(status) {
                field.status = status;
                field.stats.ms = Math.round(performance.now() - t0);
                return field;
            }

            if (ctx.sites.length < 3) return finish('no_sites');

            ctx.siteIndex = createGridIndex(1200, 1200);
            for (var i = 0; i < ctx.sites.length; i++) {
                ctx.siteIndex.insert(ctx.sites[i].x, ctx.sites[i].y, ctx.sites[i]);
            }

            var points = ctx.sites.map(function (s, idx) {
                return { x: s.x, y: s.y, lat: s.lat, lng: s.lng, i: idx };
            });
            var triangles = delaunayTriangulation(points);
            ctx.triangles = triangles.map(function (t) {
                return {
                    a: { x: t.a.x, y: t.a.y, lat: points[t.a.i].lat, lng: points[t.a.i].lng },
                    b: { x: t.b.x, y: t.b.y, lat: points[t.b.i].lat, lng: points[t.b.i].lng },
                    c: { x: t.c.x, y: t.c.y, lat: points[t.c.i].lat, lng: points[t.c.i].lng }
                };
            });
            ctx.triIndex = buildTriangleIndex(triangles, F.TRI_INDEX_CELL_M || 2500);

            var cells = grid.cells;
            var processed = 0;

            for (var b = 0; b < cells.length; b += chunkSize) {
                var batch = cells.slice(b, b + chunkSize);
                var res = await Promise.all(batch.map(async function (cell) {
                    var reason = exclusionReason(cell, ctx);
                    if (reason) return { cell: cell, excluded: reason };

                    // UAT: celula trebuie să stea pe rasterul roșu (în afara
                    // intravilanului); tile lipsă/necitibil → eșuăm închis.
                    var uat = await uatPixelAt(cell.lat, cell.lng);
                    if (uat !== true) return { cell: cell, excluded: 'uat' };

                    var tri = triScoreAt(cell.x, cell.y, ctx.triIndex);
                    cell.triScore = tri.triScore;
                    cell.triQuality = tri.triQuality;
                    return { cell: cell, scored: scoreCandidate(cell, ctx) };
                }));

                for (var k = 0; k < res.length; k++) {
                    var item = res[k];
                    if (item.scored) {
                        var s = item.scored;
                        var cls = classify(s.score);
                        var record = {
                            lat: s.lat, lng: s.lng, x: s.x, y: s.y,
                            row: item.cell.row, col: item.cell.col,
                            score: s.score, factors: s.factors,
                            classification: cls,
                            cellM: cellM
                        };
                        field.results.push(record);
                        field.heatPoints.push([s.lat, s.lng, Math.max(0.02, s.score)]);
                        if (cls === 'high') field.stats.high++;
                        else if (cls === 'medium') field.stats.medium++;
                        else field.stats.low++;
                        field.stats.scored++;
                    } else if (item.excluded === 'uat') {
                        field.excluded.push({
                            lat: item.cell.lat, lng: item.cell.lng,
                            x: item.cell.x, y: item.cell.y,
                            row: item.cell.row, col: item.cell.col, reason: 'uat'
                        });
                        field.stats.excludedUat++;
                    } else if (item.excluded === 'heritage') {
                        field.excluded.push({
                            lat: item.cell.lat, lng: item.cell.lng,
                            x: item.cell.x, y: item.cell.y,
                            row: item.cell.row, col: item.cell.col, reason: 'heritage'
                        });
                        field.stats.excludedHeritage++;
                    }
                }

                processed += batch.length;
                if (onProgress) onProgress(Math.min(1, processed / Math.max(1, cells.length)));
                await yieldToUI();
                if (isCancelled()) return finish('cancelled');
            }

            // Bulele = selecția rară, ne-suprapusă a câmpului (modul BULE).
            // Câmpul scorat rămâne dens: heatmap-ul îl citește integral.
            field.bubbles = selectBubbles(field);
            field.stats.bubbles = field.bubbles.length;
            for (var bi = 0; bi < field.bubbles.length; bi++) {
                if (field.bubbles[bi].classification === 'high') field.stats.bubblesHigh++;
                else if (field.bubbles[bi].classification === 'medium') field.stats.bubblesMedium++;
            }
            // Heatmap: fereastra de normalizare a scorurilor acestei rulări
            // (calculată mereu, ca legenda/rapoartele să știe scala reală).
            field.heat = heatScoreWindow(field.results);

            return finish(field.results.length ? 'ok' : 'no_candidates');
        })();
    }

    /* ═══════════════════════════════════════════════════════════════════════
     * 7c. BULE RARE („sweet spot”) + RASTERUL DE SCOR PENTRU HEATMAP
     * ═══════════════════════════════════════════════════════════════════════
     * DE CE: câmpul de scor rămâne dens (heatmap-ul are nevoie de fiecare
     * celulă), dar bulele NU mai pavează toată harta — erau prea dese și se
     * suprapuneau între ele și peste razele siturilor. Aici alegem doar
     * celulele care au loc să fie desenate ca disc întreg:
     *   • la cel puțin BUBBLE.GAP_M de orice altă bulă (nu se ating),
     *   • la cel puțin BUBBLE.MASK_CLEARANCE_M de masca roșie (raza de 700 m a
     *     siturilor, poligoanele de sit, dreptunghiurile de intravilan UAT),
     *   • cu scor ≥ BUBBLE.MIN_SCORE (celulele slabe rămân doar în heatmap).
     * Numărul și dimensiunea scalează cu raza din slider, ca o analiză de 1 km
     * și una de 10 km să arate la fel de aerisit pe ecran. */

    // Raza bulelor la raza de analiză dată (referința: 10 km = BUBBLE.RADIUS_M).
    // Scala e √(rază), nu liniară: la 1 km bulele rămân citibile, la 10 km nu
    // devin puncte.
    function bubbleScale(radiusM) {
        return Math.max(0.34, Math.sqrt(Math.max(1, radiusM) / CONFIG.SEARCH_RADIUS_M));
    }

    function bubbleBaseRadiusM(radiusM) {
        var B = CONFIG.BUBBLE;
        var r = (B.RADIUS_M || 420) * bubbleScale(radiusM);
        return Math.round(Math.max(B.RADIUS_MIN_M || 150, Math.min(B.RADIUS_MAX_M || 520, r)));
    }

    function bubbleGapM(radiusM) {
        var B = CONFIG.BUBBLE;
        var g = (B.GAP_M || 260) * bubbleScale(radiusM);
        return Math.round(Math.max(B.GAP_MIN_M || 80, g));
    }

    // Câte bule are voie să aibă o rulare (sweet spot-ul de densitate).
    function bubbleCountCap(radiusM) {
        var B = CONFIG.BUBBLE;
        var areaKm2 = Math.PI * radiusM * radiusM / 1e6;
        var n = Math.round(areaKm2 * (B.PER_KM2 || 0.22));
        return Math.max(B.MIN_BUBBLES || 10, Math.min(B.MAX_BUBBLES || 140, n));
    }

    /**
     * Selecția bulelor. Parcurge celulele scorate în ordinea scorului și păstrează
     * o celulă doar dacă discul ei nu atinge nicio bulă deja aleasă și nicio
     * parte a măștii roșii (raza de 700 m a siturilor, poligoanele de sit,
     * dreptunghiurile de intravilan UAT).
     *
     * Raza fiecărei bule e cea reală: `min(raza de bază, distanța liberă până la
     * mască − clearance)`. Dacă zona e atât de fragmentată de intravilan încât
     * nu încap bule la dimensiunea preferată, se reia o dată cu podeaua și
     * gap-urile relaxate — altfel harta ar rămâne fără nicio bulă.
     *
     * @returns {Array<{lat,lng,x,y,row,col,score,factors,classification,radiusM,cellM}>}
     */
    function selectBubbles(field) {
        var B = CONFIG.BUBBLE;
        var ctx = field.ctx || {};
        var cellM = field.cellM;
        var gap = field.bubbleGapM || bubbleGapM(field.radius);
        var baseR = field.bubbleBaseRadiusM || bubbleBaseRadiusM(field.radius);
        var cap = bubbleCountCap(field.radius);
        var minScore = (typeof B.MIN_SCORE === 'number') ? B.MIN_SCORE : 0;
        var siteGuard = (ctx.siteRadius || CONFIG.SITE_RADIUS_M) +
            (ctx.siteBuffer || CONFIG.SITE_BUFFER_M);
        // Masca roșie e desenată exact pe cutia celulei excluse (dreptunghiurile
        // UAT sunt celule unite pe rânduri), deci distanța liberă până la mască
        // e distanța exactă punct→dreptunghi, nu cea până la centrul celulei.
        var halfCell = cellM / 2;
        var i, s, m;

        // Index peste celulele excluse (adică peste masca roșie desenată).
        var maskIndex = createGridIndex(Math.max(cellM, 250), Math.max(cellM, 250));
        for (i = 0; i < field.excluded.length; i++) {
            maskIndex.insert(field.excluded[i].x, field.excluded[i].y, field.excluded[i]);
        }

        // 1) spațiul liber din jurul fiecărei celule bune (o singură dată)
        var cells = [];
        for (i = 0; i < field.results.length; i++) {
            var r = field.results[i];
            if (r.score < minScore) continue;
            var clearance = Infinity;

            if (ctx.siteIndex) {
                var near = ctx.siteIndex.queryCircle(r.x, r.y, baseR + siteGuard);
                for (s = 0; s < near.length; s++) {
                    var sdx = r.x - near[s].x, sdy = r.y - near[s].y;
                    var sd = Math.sqrt(sdx * sdx + sdy * sdy) - siteGuard;
                    if (sd < clearance) clearance = sd;
                }
            }
            var masked = maskIndex.queryCircle(r.x, r.y, baseR + cellM);
            for (m = 0; m < masked.length; m++) {
                // distanța de la punct la dreptunghiul [x±halfCell, y±halfCell]
                var mdx = Math.abs(r.x - masked[m].x) - halfCell;
                var mdy = Math.abs(r.y - masked[m].y) - halfCell;
                if (mdx < 0) mdx = 0;
                if (mdy < 0) mdy = 0;
                var md = Math.sqrt(mdx * mdx + mdy * mdy);
                if (md < clearance) clearance = md;
            }
            if (!isFinite(clearance)) continue;
            cells.push({ cell: r, clearance: clearance });
        }

        // 2) greedy, cu verificarea reală a distanței față de bulele deja alese
        cells.sort(function (a, b) {
            return (b.cell.score - a.cell.score) ||
                (a.cell.row - b.cell.row) || (a.cell.col - b.cell.col);
        });

        function pass(minR, bubbleGap, maskGap) {
            var keptIndex = createGridIndex(baseR * 2 + bubbleGap, baseR * 2 + bubbleGap);
            var kept = [];
            for (var k = 0; k < cells.length && kept.length < cap; k++) {
                var radius = Math.min(baseR, Math.floor(cells[k].clearance - maskGap));
                if (radius < minR) continue;
                var c = cells[k].cell;
                var reach = radius + baseR + bubbleGap;
                var neighbours = keptIndex.queryCircle(c.x, c.y, reach);
                var ok = true;
                for (var n = 0; n < neighbours.length; n++) {
                    var ndx = c.x - neighbours[n].x, ndy = c.y - neighbours[n].y;
                    var need = radius + neighbours[n].radiusM + bubbleGap;
                    if (ndx * ndx + ndy * ndy < need * need) { ok = false; break; }
                }
                if (!ok) continue;
                var bubble = {
                    lat: c.lat, lng: c.lng, x: c.x, y: c.y,
                    row: c.row, col: c.col,
                    score: c.score, factors: c.factors,
                    classification: c.classification,
                    cellM: cellM, radiusM: radius
                };
                kept.push(bubble);
                keptIndex.insert(bubble.x, bubble.y, bubble);
            }
            return kept;
        }

        var maskGap = B.MASK_CLEARANCE_M === undefined ? 60 : B.MASK_CLEARANCE_M;
        var bubbles = pass(B.RADIUS_MIN_M || 150, gap, maskGap);
        // Zonă foarte fragmentată (intravilan dens): mai încercăm o dată, mai mic.
        if (bubbles.length < Math.min(4, cap)) {
            var relaxed = pass(B.RADIUS_FLOOR_M || 90, Math.round(gap * 0.6), Math.round(maskGap * 0.6));
            if (relaxed.length > bubbles.length) bubbles = relaxed;
        }
        return bubbles;
    }

    /* ── Heatmap: fereastra de normalizare + rampa de culori ────────────────
     * simpleheat aduna ALFA peste puncte suprapuse: cu o grilă densă fiecare
     * pixel era acoperit de zeci de blob-uri, deci ajungea la 1 aproape peste
     * tot și harta ieșea aproape monocoloră. Aici culoarea e funcție de SCOR,
     * nu de numărul de vecini: fiecare celulă primește poziția ei în fereastra
     * 2..98% a rulării, iar diferența slab↔tare rămâne vizibilă oriunde. */

    function percentile(sortedAsc, p) {
        if (!sortedAsc || !sortedAsc.length) return 0;
        var idx = Math.max(0, Math.min(1, p)) * (sortedAsc.length - 1);
        var i0 = Math.floor(idx), i1 = Math.ceil(idx);
        if (i0 === i1) return sortedAsc[i0];
        return sortedAsc[i0] + (sortedAsc[i1] - sortedAsc[i0]) * (idx - i0);
    }

    function heatScoreWindow(results) {
        var H = CONFIG.HEAT;
        var loP = (typeof H.LOW_PERCENTILE === 'number') ? H.LOW_PERCENTILE : 0.02;
        var hiP = (typeof H.HIGH_PERCENTILE === 'number') ? H.HIGH_PERCENTILE : 0.98;
        var minWindow = (typeof H.MIN_WINDOW === 'number') ? H.MIN_WINDOW : 0.12;
        var scores = [];
        for (var i = 0; i < (results || []).length; i++) scores.push(results[i].score);
        var win = { lo: 0, hi: 1, min: 0, max: 0, count: scores.length, stretched: false };
        if (!scores.length) return win;
        scores.sort(function (a, b) { return a - b; });
        win.min = scores[0];
        win.max = scores[scores.length - 1];
        var a = percentile(scores, loP);
        var b = percentile(scores, hiP);
        // Scoruri într-o bandă îngustă → întindem fereastra în jurul medianei,
        // altfel toată harta ar ieși aceeași culoare.
        if (b - a < minWindow) {
            var mid = percentile(scores, 0.5);
            a = mid - minWindow / 2;
            b = mid + minWindow / 2;
            win.stretched = true;
        }
        win.lo = a;
        win.hi = b;
        return win;
    }

    // Scor brut → 0..1 în fereastra rulării (0 = cel mai slab, 1 = cel mai bun).
    function heatNormalize(score, win) {
        if (!win || !(win.hi > win.lo)) return 0.5;
        var t = (score - win.lo) / (win.hi - win.lo);
        return Math.max(0, Math.min(1, t));
    }

    function parseHexColor(hex) {
        var h = String(hex).replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        if (!isFinite(n)) return [255, 255, 255];
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    // Rampă → tabel de 256 de culori (o singură dată, apoi doar indexare).
    function buildHeatRamp(stops) {
        var keys = Object.keys(stops).map(Number).sort(function (a, b) { return a - b; });
        var rgb = keys.map(function (k) { return parseHexColor(stops[k]); });
        var lut = new Uint8ClampedArray(256 * 4);
        for (var i = 0; i < 256; i++) {
            var t = i / 255;
            var k1 = keys.length - 1;
            for (var k = 1; k < keys.length; k++) {
                if (t <= keys[k]) { k1 = k; break; }
            }
            var k0 = Math.max(0, k1 - 1);
            var span = (keys[k1] - keys[k0]) || 1;
            var f = Math.max(0, Math.min(1, (t - keys[k0]) / span));
            lut[i * 4] = Math.round(rgb[k0][0] + (rgb[k1][0] - rgb[k0][0]) * f);
            lut[i * 4 + 1] = Math.round(rgb[k0][1] + (rgb[k1][1] - rgb[k0][1]) * f);
            lut[i * 4 + 2] = Math.round(rgb[k0][2] + (rgb[k1][2] - rgb[k0][2]) * f);
            lut[i * 4 + 3] = 255;
        }
        return lut;
    }

    // Netezire gaussiană separabilă, doar între celule cu scor: valorile nu se
    // scurg în zonele excluse (acelea rămân transparente, sub masca roșie).
    function smoothField(values, valid, cols, rows, sigmaCells) {
        var sigma = Number(sigmaCells) || 0;
        if (!(sigma > 0)) return values;
        var radius = Math.max(1, Math.ceil(sigma * 2));
        var kernel = [], ksum = 0, k;
        for (k = -radius; k <= radius; k++) {
            var w = Math.exp(-(k * k) / (2 * sigma * sigma));
            kernel.push(w);
            ksum += w;
        }
        for (k = 0; k < kernel.length; k++) kernel[k] /= ksum;

        var tmp = new Float32Array(values.length);
        var out = new Float32Array(values.length);
        var x, y, i;
        for (y = 0; y < rows; y++) {
            for (x = 0; x < cols; x++) {
                var acc = 0, wsum = 0;
                for (k = -radius; k <= radius; k++) {
                    var sx = x + k;
                    if (sx < 0 || sx >= cols) continue;
                    i = y * cols + sx;
                    if (!valid[i]) continue;
                    var wk = kernel[k + radius];
                    acc += values[i] * wk;
                    wsum += wk;
                }
                i = y * cols + x;
                tmp[i] = wsum > 0 ? acc / wsum : 0;
            }
        }
        for (x = 0; x < cols; x++) {
            for (y = 0; y < rows; y++) {
                var acc2 = 0, wsum2 = 0;
                for (k = -radius; k <= radius; k++) {
                    var sy = y + k;
                    if (sy < 0 || sy >= rows) continue;
                    i = sy * cols + x;
                    if (!valid[i]) continue;
                    var wk2 = kernel[k + radius];
                    acc2 += tmp[i] * wk2;
                    wsum2 += wk2;
                }
                i = y * cols + x;
                out[i] = wsum2 > 0 ? acc2 / wsum2 : 0;
            }
        }
        return out;
    }

    // Valori normalizate → RGBA. Alfa crește odată cu scorul: zonele slabe sunt
    // translucide (se citesc ca „puțin interesant”), cele bune saturate.
    function colorizeField(values, valid, cols, rows, lut, H) {
        var aMin = (typeof H.ALPHA_MIN === 'number') ? H.ALPHA_MIN : 0.46;
        var aMax = (typeof H.ALPHA_MAX === 'number') ? H.ALPHA_MAX : 0.97;
        var rgba = new Uint8ClampedArray(cols * rows * 4);
        for (var i = 0; i < values.length; i++) {
            if (!valid[i]) continue;
            var t = Math.max(0, Math.min(1, values[i]));
            var li = Math.round(t * 255) * 4;
            rgba[i * 4] = lut[li];
            rgba[i * 4 + 1] = lut[li + 1];
            rgba[i * 4 + 2] = lut[li + 2];
            rgba[i * 4 + 3] = Math.round((aMin + (aMax - aMin) * Math.pow(t, 0.75)) * 255);
        }
        return rgba;
    }

    /**
     * Rasterul de scor al rulării: o imagine de cols × rows pixeli în care
     * fiecare celulă a grilei e un pixel colorat după scorul ei normalizat.
     * @returns {{cols,rows,rgba,values,valid,window,bbox,cellM}}
     */
    function buildHeatRaster(field) {
        var H = CONFIG.HEAT;
        var grid = field.grid;
        var cols = grid.cols, rows = grid.rows;
        var win = field.heat || heatScoreWindow(field.results);
        var values = new Float32Array(rows * cols);
        var valid = new Uint8Array(rows * cols);
        for (var i = 0; i < field.results.length; i++) {
            var r = field.results[i];
            if (r.row == null || r.col == null) continue;
            var idx = r.row * cols + r.col;
            if (idx < 0 || idx >= values.length) continue;
            values[idx] = heatNormalize(r.score, win);
            valid[idx] = 1;
        }
        var smooth = smoothField(values, valid, cols, rows, H.SMOOTH_SIGMA_CELLS);
        return {
            cols: cols, rows: rows,
            values: smooth, valid: valid,
            rgba: colorizeField(smooth, valid, cols, rows, heatRampLut(), H),
            window: win, bbox: grid.bbox, cellM: grid.cellM
        };
    }

    /* ═══════════════════════════════════════════════════════════════════════
     * 8. RENDERING
     * ═══════════════════════════════════════════════════════════════════════ */

    var _layerGroup = null;      // bule + aria de lucru (pane_archeo)
    var _heatLayer = null;       // canvas heatmap (pane_archeo_heat)
    var _maskGroup = null;       // mască roșie: UAT + raze patrimoniu (pane_archeo_mask)
    var _bubbleRenderer = null;  // renderer canvas partajat pentru bule
    var _heatRaster = null;      // rasterul de scoruri al ultimei rulări (debug)
    var _currentResults = null;  // celulele scorate la ultima rulare (API public)
    var _currentField = null;    // câmpul complet (debug / teste)
    var _resultsVisible = true;

    // Bulele mici păstrează limbajul vizual mov, dar au trei trepte: scorurile
    // slabe sunt desenate pal (ca să nu rămână goluri pe hartă, fără a concura
    // vizual cu zonele bune), cele medii ca înainte, cele ridicate saturat.
    var STYLE = {
        low:    { color: '#B388E8', weight: 0.7, opacity: 0.40, fillColor: '#B388E8', fillOpacity: 0.09 },
        medium: { color: '#B388E8', weight: 1.1, opacity: 0.75, fillColor: '#B388E8', fillOpacity: 0.24 },
        high:   { color: '#5E2B9E', weight: 1.6, opacity: 0.92, fillColor: '#6B2FA0', fillOpacity: 0.48 }
    };

    function styleFor(score) {
        var cls = classify(score);
        if (cls === 'high') return STYLE.high;
        if (cls === 'medium') return STYLE.medium;
        return STYLE.low;
    }

    // Paneele stratului: heatmap sub mască, masca sub bule, bulele sub pin.
    var PANE_DEFS = [
        ['pane_archeo_heat', function () { return CONFIG.PANE_Z_HEAT; }, 'none'],
        ['pane_archeo_mask', function () { return CONFIG.PANE_Z_MASK; }, 'none'],
        ['pane_archeo', function () { return CONFIG.PANE_Z_INDEX; }, ''],
        ['pane_archeo_pin', function () { return CONFIG.PANE_Z_PIN; }, '']
    ];

    function ensurePane(map) {
        if (!map || typeof map.createPane !== 'function') return false;
        for (var i = 0; i < PANE_DEFS.length; i++) {
            var name = PANE_DEFS[i][0];
            var pane = map.getPane ? map.getPane(name) : null;
            if (!pane) pane = map.createPane(name);
            if (pane && pane.style) {
                pane.style.zIndex = PANE_DEFS[i][1]();
                pane.style.pointerEvents = PANE_DEFS[i][2];
            }
        }
        return true;
    }

    function paneOption(map, name) {
        return (ensurePane(map) && map.getPane && map.getPane(name)) ? name : undefined;
    }

    function assignPane(map, options, name) {
        var pane = paneOption(map, name);
        if (pane) options.pane = pane;
        return options;
    }

    // Renderer canvas pentru bule: cu câteva sute/mii de cercuri, SVG-ul ar
    // muta un nod DOM la fiecare repaint; canvas-ul doar redesenează pixeli.
    function bubbleRendererOption(map) {
        if (!_bubbleRenderer && typeof L !== 'undefined' && L.canvas) {
            _bubbleRenderer = L.canvas(assignPane(map, { padding: 0.25 }, 'pane_archeo'));
        }
        return _bubbleRenderer;
    }

    // ── Score → color (heat scale) ──────────────────────────────────────────
    // Maps the valid score range [SCORE_DISCARD_BELOW .. 1] onto a
    // red → amber → violet gradient, matching the layer's purple "high"
    // visual language (low scores burn red, high scores glow violet).
    var SCORE_COLOR_STOPS = [
        { s: 0.25, rgb: [224, 82, 82] },   // #E05252 red (low)
        { s: 0.55, rgb: [240, 160, 48] },  // #F0A030 amber (medium)
        { s: 1.00, rgb: [123, 63, 212] }   // #7B3FD4 violet (high)
    ];

    function scoreColor(score) {
        var t = Math.max(SCORE_COLOR_STOPS[0].s, Math.min(SCORE_COLOR_STOPS[SCORE_COLOR_STOPS.length - 1].s, score));
        for (var i = 1; i < SCORE_COLOR_STOPS.length; i++) {
            if (t <= SCORE_COLOR_STOPS[i].s) {
                var a = SCORE_COLOR_STOPS[i - 1], b = SCORE_COLOR_STOPS[i];
                var f = (t - a.s) / (b.s - a.s);
                var r = Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f);
                var g = Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f);
                var bl = Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f);
                return 'rgb(' + r + ',' + g + ',' + bl + ')';
            }
        }
        return 'rgb(' + SCORE_COLOR_STOPS[SCORE_COLOR_STOPS.length - 1].rgb.join(',') + ')';
    }

    // Rampa heatmap: indigo închis (cel mai slab) → albastru → verde →
    // chihlimbar → violet (cel mai bun). Cinci trepte de nuanță bine separate,
    // ca diferența dintre o zonă slabă și una bună să sară în ochi. Roșul e
    // rezervat exclusiv zonelor excluse (UAT / patrimoniu), ca legenda să nu
    // fie ambiguă. Aceeași rampă e în .archeo-pot-heatbar (css/styles.css).
    var HEAT_GRADIENT = {
        0.00: '#10233f',
        0.25: '#1f7fc4',
        0.50: '#23c48e',
        0.75: '#f2b134',
        1.00: '#8b3ff0'
    };

    var _heatRampLut = null;
    function heatRampLut() {
        if (!_heatRampLut) _heatRampLut = buildHeatRamp(HEAT_GRADIENT);
        return _heatRampLut;
    }

    // ── 5-star rating ───────────────────────────────────────────────────────
    // 5 gray stars with a colored overlay clipped to `score × 100%` — so the
    // number of lit stars equals the score (e.g. 0.72 → 3.6/5 stars) and the
    // color itself also reflects the score (heat scale, see scoreColor()).
    function starRatingHtml(score) {
        var pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
        var color = scoreColor(score);
        var stars = '★★★★★';
        return '<span style="display:inline-flex;align-items:center;gap:8px">' +
            '<span style="position:relative;display:inline-block;font-size:1.05rem;line-height:1;letter-spacing:2px">' +
            '<span style="color:rgba(245,240,235,0.18)">' + stars + '</span>' +
            '<span style="position:absolute;left:0;top:0;width:' + pct + '%;overflow:hidden;white-space:nowrap;color:' + color + '">' + stars + '</span>' +
            '</span>' +
            '<span style="font-size:0.8rem;font-weight:700;color:' + color + '">' + (score * 5).toFixed(1) + '/5</span>' +
            '</span>';
    }

    function popupHtml(c, idx) {
        var cls = classify(c.score) === 'high' ? tr('class_high') : tr('class_medium');
        var color = scoreColor(c.score);
        var pct = Math.round(c.score * 100);
        var factors = c.factors || {};
        var cellLine = c.radiusM
            ? tr('cell') + ': <strong style="color:' + color + '">' + c.radiusM + ' m</strong> ' +
              tr('radius') + '<br>'
            : (c.cellM ? tr('cell') + ': <strong style="color:' + color + '">' + c.cellM + ' m</strong><br>' : '');
        return '<div style="font-family:Outfit,sans-serif;min-width:215px;padding:2px">' +
            '<div style="font-family:Cinzel,serif;font-size:0.85rem;color:#c4a0f0;font-weight:700;margin-bottom:8px">' +
            '🔎 ' + tr('candidate') + ' #' + idx + '</div>' +
            '<div style="font-size:0.78rem;color:rgba(245,240,235,0.9);margin-bottom:7px">' +
            '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:' + color + '"></span>' +
            '<strong>' + cls + '</strong> — ' + pct + '%</div>' +
            '<div style="margin-bottom:8px">' + starRatingHtml(c.score) + '</div>' +
            '<div style="font-size:0.72rem;color:rgba(245,240,235,0.65);line-height:1.7">' +
            '📍 ' + c.lat.toFixed(5) + ', ' + c.lng.toFixed(5) + '<br>' +
            cellLine +
            tr('closest_site') + ': <strong style="color:' + color + '">' + factors.closestSiteM + ' m</strong><br>' +
            tr('nearby') + ': ' + factors.nearbyCount + ' &nbsp;·&nbsp; ' +
            tr('avg_dist') + ': ' + factors.avgDistM + ' m<br>' +
            tr('density') + ': ' + factors.densityCount + ' &nbsp;·&nbsp; ' +
            tr('tri_quality') + ': ' + Number(factors.triQuality || 0).toFixed(2) + '</div></div>';
    }

    // Conținutul popup-ului ca funcție — Leaflet îl apelează doar la deschidere.
    function makePopupContent(c, idx) {
        return function () { return popupHtml(c, idx); };
    }

    /* ── curățarea rezultatelor anterioare ───────────────────────────────── */
    function clearRendered(map) {
        if (!map) return;
        if (_layerGroup) { try { map.removeLayer(_layerGroup); } catch (e) {} _layerGroup = null; }
        if (_heatLayer) {
            try { map.removeLayer(_heatLayer); } catch (e) {}
            try {
                // onRemove dezlipește canvas-ul; aici e doar plasa de siguranță
                // pentru hărțile-fantomă din teste (removeLayer fără onRemove).
                var heatCanvas = _heatLayer._canvas;
                var parent = heatCanvas && (heatCanvas.parentNode || heatCanvas.parentElement);
                if (parent && parent.removeChild) parent.removeChild(heatCanvas);
            } catch (e) {}
            _heatLayer = null;
        }
        _heatRaster = null;
        if (_maskGroup) { try { map.removeLayer(_maskGroup); } catch (e) {} _maskGroup = null; }
    }

    /* ── aria de lucru: cercul razei + punctul central ───────────────────── */
    function renderWorkingArea(map, ctx, group) {
        if (!CONFIG.SHOW_WORKING_AREA) return;
        var style = CONFIG.PIN || {};
        group.addLayer(L.circle([ctx.centerLat, ctx.centerLng], assignPane(map, {
            radius: ctx.radius,
            color: style.COLOR || '#a070e8',
            weight: 1.4,
            dashArray: '6 6',
            fillColor: style.COLOR || '#a070e8',
            fillOpacity: 0.03,
            opacity: 0.5,
            interactive: false
        }, 'pane_archeo')));

        group.addLayer(L.circleMarker([ctx.centerLat, ctx.centerLng], assignPane(map, {
            radius: 4,
            color: style.COLOR || '#a070e8',
            weight: 1.5,
            fillColor: style.FILL || '#c4a0f0',
            fillOpacity: 0.9,
            interactive: false
        }, 'pane_archeo')));

        if (CONFIG.SHOW_TRIANGULATION && ctx.triangles) {
            ctx.triangles.forEach(function (t) {
                group.addLayer(L.polyline(
                    [[t.a.lat, t.a.lng], [t.b.lat, t.b.lng], [t.c.lat, t.c.lng], [t.a.lat, t.a.lng]],
                    assignPane(map, { color: 'rgba(163,112,232,0.55)', weight: 1, interactive: false }, 'pane_archeo')
                ));
            });
        }
    }

    /* ── MODUL 1: bule rare, fără suprapuneri ────────────────────────────────
     * Se desenează doar celulele alese de selectBubbles(), fiecare cu raza ei
     * reală (deja limitată de distanța până la masca roșie). Rezultatul: bule
     * aerisite, care nu se ating între ele și nu intră peste razele siturilor. */
    function renderBubbles(map, field, group) {
        var renderer = bubbleRendererOption(map);
        var bubbles = field.bubbles || [];
        bubbles.forEach(function (c, idx) {
            var style = styleFor(c.score);
            var options = assignPane(map, {
                radius: c.radiusM,
                color: style.color,
                weight: style.weight,
                opacity: style.opacity,
                fillColor: style.fillColor,
                fillOpacity: style.fillOpacity,
                stroke: style.weight > 0.9
            }, 'pane_archeo');
            if (renderer) options.renderer = renderer;
            var circle = L.circle([c.lat, c.lng], options);
            // Popup construit leneș (funcție, nu șir): cu sute de bule, șirurile
            // eager ar aloca HTML nefolosit la fiecare rulare.
            if (circle.bindPopup) circle.bindPopup(makePopupContent(c, idx + 1));
            group.addLayer(circle);
        });
    }

    /* ── MODUL 2: heatmap = raster de scoruri ancorat în geografie ───────────
     * Canvas propriu, cu exact contractul canvas-urilor Patrimoniu din
     * map-app.js (același tip de suprafață, deja testat în
     * test-patrimoniu-canvas-transform.js):
     *   • la fiecare vedere așezată (move/moveend/zoom/zoomend/viewreset/
     *     resize) canvas-ul e pus la colțul viewport-ului în layer points, iar
     *     rasterul e desenat scalat între colțurile GEOGRAFICE ale grilei —
     *     deci nu plutește niciodată față de hartă la zoom;
     *   • în timpul animației de zoom (zoomanim / pinch) elementul primește
     *     transformata de renderer (scalare în jurul ancorei bitmap-ului), ca
     *     restul hărții, apoi e redesenat la zoom-ul final.
     * Înlocuiește leaflet-heat: acela repoziționa canvas-ul doar la moveend,
     * își repoziționa blob-urile într-o grilă de pixeli la fiecare redraw și
     * folosea o rază în pixeli trunchiată — trei surse de „alunecare” la zoom.
     * Iar culoarea nu mai e alfa acumulat, ci scorul celulei (vezi 7c). */

    var HEAT_REDRAW_EVENTS = ['move', 'moveend', 'zoom', 'zoomend', 'viewreset', 'resize'];

    // Poziția/transformata canvas-ului, scrise direct pe element. Leaflet face
    // același lucru prin L.DomUtil (translate3d, opțional scale); îl ținem
    // local ca să fie identic în browser și în testele Node.
    function setCanvasPosition(el, point) {
        if (!el || !el.style) return;
        el._leaflet_pos = point;
        el.style.transform = 'translate3d(' + point.x + 'px,' + point.y + 'px,0)';
    }

    function setCanvasTransform(el, point, scale) {
        if (!el || !el.style) return;
        el._leaflet_pos = point;
        el.style.transform = 'translate3d(' + point.x + 'px,' + point.y + 'px,0)' +
            (scale && scale !== 1 ? ' scale(' + scale + ')' : '');
    }

    function createCanvasEl(w, h) {
        if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
        var canvas = document.createElement('canvas');
        if (!canvas || typeof canvas.getContext !== 'function') return null;
        canvas.width = w;
        canvas.height = h;
        return canvas;
    }

    // Rasterul de scoruri, ca imagine sursă de cols × rows px (redimensionată
    // de canvas la desenare — de aici aspectul neted, fără „trepte”).
    function createHeatSourceCanvas(raster) {
        if (!raster || !raster.cols || !raster.rows || !raster.rgba) return null;
        var canvas = createCanvasEl(raster.cols, raster.rows);
        if (!canvas) return null;
        var ctx = canvas.getContext('2d');
        if (!ctx || typeof ctx.createImageData !== 'function') return null;
        var img = ctx.createImageData(raster.cols, raster.rows);
        if (!img || !img.data) return canvas;
        img.data.set(raster.rgba);
        if (typeof ctx.putImageData === 'function') ctx.putImageData(img, 0, 0);
        return canvas;
    }

    // Layer point FĂRĂ rotunjirea la pixel întreg a lui latLngToLayerPoint:
    // bitmap-ul e scalat CSS în timpul zoom-ului, deci o jumătate de pixel
    // înglobată în desen e înmulțită cu scara și apare ca o alunecare.
    function layerPointUnrounded(map, latlng) {
        if (typeof map.project === 'function') {
            var origin = (typeof map.getPixelOrigin === 'function' && map.getPixelOrigin()) || { x: 0, y: 0 };
            var p = map.project(latlng, map.getZoom());
            return { x: p.x - origin.x, y: p.y - origin.y };
        }
        var lp = map.latLngToLayerPoint(latlng);
        return { x: lp.x, y: lp.y };
    }

    function heatPaneEl(map) {
        var pane = (map.getPane && map.getPane('pane_archeo_heat')) || null;
        if (pane) return pane;
        var container = map.getContainer && map.getContainer();
        return (container && container.querySelector) ? container.querySelector('.leaflet-map-pane') : null;
    }

    var heatLayerProto = {
        initialize: function (raster, options) {
            this.options = options || {};
            this._raster = raster || null;
            this._srcCanvas = null;
            this._canvas = null;
            this._ctx = null;
            this._map = null;
            this._anchor = null;   // originea bitmap-ului în pixeli de proiectare
            this._zoom = null;     // zoom-ul pentru care a fost desenat
            this._frame = null;
            this._lastFrame = null;
            var self = this;
            this._handlers = {
                redraw: function () { self.scheduleRedraw(); },
                zoomanim: function (e) { self.applyZoomTransform(e); },
                pinch: function (e) {
                    if (!e || !e.pinch || !self._map) return;
                    self.applyZoomTransform({ center: self._map.getCenter(), zoom: self._map.getZoom() });
                }
            };
            this._srcCanvas = createHeatSourceCanvas(this._raster);
        },

        onAdd: function (map) {
            this._map = map;
            if (!this.ensureCanvas()) return;
            var pane = heatPaneEl(map);
            if (pane && pane.appendChild && this._canvas.parentNode !== pane) pane.appendChild(this._canvas);
            this.bindMap(map);
            this.redraw();
        },

        onRemove: function (map) {
            this.unbindMap(map);
            this._frame = null;
            var parent = this._canvas && this._canvas.parentNode;
            if (parent && parent.removeChild) parent.removeChild(this._canvas);
            this._map = null;
            this._lastFrame = null;
        },

        ensureCanvas: function () {
            if (!this._canvas) {
                this._canvas = createCanvasEl(1, 1);
                if (!this._canvas) return false;
                // leaflet-zoom-animated: transformata de zoomanim e tranziționată
                // odată cu restul hărții (regula CSS e activă doar în zoom).
                this._canvas.className = 'leaflet-heatmap-layer leaflet-zoom-animated';
                if (this._canvas.style) {
                    this._canvas.style.position = 'absolute';
                    this._canvas.style.top = '0';
                    this._canvas.style.left = '0';
                    this._canvas.style.pointerEvents = 'none';
                }
                this._ctx = this._canvas.getContext('2d');
            }
            if (!this._srcCanvas && this._raster) this._srcCanvas = createHeatSourceCanvas(this._raster);
            return !!this._ctx;
        },

        setRaster: function (raster) {
            this._raster = raster || null;
            this._srcCanvas = createHeatSourceCanvas(this._raster);
            this._anchor = null;
            this._zoom = null;
            this.redraw();
        },

        bindMap: function (map) {
            if (!map || typeof map.on !== 'function' || this._bound) return;
            this._bound = true;
            var self = this;
            HEAT_REDRAW_EVENTS.forEach(function (type) { map.on(type, self._handlers.redraw); });
            map.on('zoomanim', this._handlers.zoomanim);
            map.on('zoom', this._handlers.pinch);
        },

        unbindMap: function (map) {
            if (!map || typeof map.off !== 'function' || !this._bound) return;
            this._bound = false;
            var self = this;
            HEAT_REDRAW_EVENTS.forEach(function (type) { map.off(type, self._handlers.redraw); });
            map.off('zoomanim', this._handlers.zoomanim);
            map.off('zoom', this._handlers.pinch);
        },

        scheduleRedraw: function () {
            var self = this;
            if (this._frame !== null || !this._canvas) return;
            this._frame = raf(function () {
                self._frame = null;
                if (!self._map || !self._canvas) return;
                self.redraw();
            });
        },

        // Redesenare la vedere așezată: repoziționare în layer points + rasterul
        // desenat între colțurile geografice ale grilei.
        redraw: function () {
            var map = this._map;
            if (!map || !this._canvas || !this._ctx) return;
            // În timpul animației CSS de zoom / pinch nu redesenăm: bitmap-ul e
            // transformat de applyZoomTransform() odată cu restul hărții.
            if (map._animatingZoom) return;
            if (map.touchZoom && map.touchZoom._zooming) return;
            var size = (typeof map.getSize === 'function' && map.getSize()) || null;
            if (!size) return;
            if (this._canvas.width !== size.x) this._canvas.width = size.x;
            if (this._canvas.height !== size.y) this._canvas.height = size.y;

            var topLeft = map.containerPointToLayerPoint([0, 0]);
            setCanvasPosition(this._canvas, topLeft);   // curăță orice transform de zoom
            this._zoom = map.getZoom();
            var origin = (typeof map.getPixelOrigin === 'function' && map.getPixelOrigin()) || { x: 0, y: 0 };
            this._anchor = { x: origin.x + topLeft.x, y: origin.y + topLeft.y };

            var ctx = this._ctx;
            ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
            if (!this._srcCanvas || !this._raster || !this._raster.bbox) return;
            var bbox = this._raster.bbox;
            var nw = layerPointUnrounded(map, { lat: bbox.maxLat, lng: bbox.minLng });
            var se = layerPointUnrounded(map, { lat: bbox.minLat, lng: bbox.maxLng });
            var x = nw.x - topLeft.x;
            var y = nw.y - topLeft.y;
            var w = se.x - nw.x;
            var h = se.y - nw.y;
            if (!(w > 0) || !(h > 0)) return;

            if (typeof ctx.save === 'function') ctx.save();
            ctx.globalAlpha = (typeof this.options.opacity === 'number') ? this.options.opacity : 0.8;
            if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = true;
            if ('mozImageSmoothingEnabled' in ctx) ctx.mozImageSmoothingEnabled = true;
            if ('webkitImageSmoothingEnabled' in ctx) ctx.webkitImageSmoothingEnabled = true;
            ctx.drawImage(this._srcCanvas, x, y, w, h);
            if (typeof ctx.restore === 'function') ctx.restore();

            this._lastFrame = {
                topLeft: { x: topLeft.x, y: topLeft.y },
                x: x, y: y, w: w, h: h,
                zoom: this._zoom,
                anchor: { x: this._anchor.x, y: this._anchor.y },
                transform: this._canvas.style ? this._canvas.style.transform : null
            };
        },

        // Transformata de animație de zoom — aceeași formă ca
        // _updateCanvasTransform() din map-app.js: scalare în jurul ancorei
        // bitmap-ului (pixelOrigin + topLeft), nu în jurul centrului proiectat.
        applyZoomTransform: function (e) {
            var map = this._map;
            if (!map || !this._canvas || !this._anchor || this._zoom == null) return;
            if (!e || e.center == null || e.zoom == null) return;
            if (typeof map.getZoomScale !== 'function' || typeof map._getNewPixelOrigin !== 'function') return;
            var scale = map.getZoomScale(e.zoom, this._zoom);
            var npo = map._getNewPixelOrigin(e.center, e.zoom);
            setCanvasTransform(this._canvas, {
                x: Math.round(this._anchor.x * scale - npo.x),
                y: Math.round(this._anchor.y * scale - npo.y)
            }, scale);
        }
    };

    var _HeatLayerClass = null;

    // În browser e un L.Layer real (map.addLayer/removeLayer, onAdd/onRemove).
    // Fără L.Layer (teste Node) e același obiect, cu un addTo minim.
    function makeHeatLayer(raster, options) {
        if (typeof L !== 'undefined' && L.Layer && typeof L.Layer.extend === 'function') {
            if (!_HeatLayerClass) _HeatLayerClass = L.Layer.extend(heatLayerProto);
            return new _HeatLayerClass(raster, options);
        }
        var inst = Object.create(heatLayerProto);
        heatLayerProto.initialize.call(inst, raster, options);
        inst.addTo = function (map) {
            if (map && typeof map.addLayer === 'function') map.addLayer(this);
            else this.onAdd(map);
            return this;
        };
        return inst;
    }

    function renderHeat(map, field) {
        if (!field || !field.results.length) return;
        var raster = buildHeatRaster(field);
        if (!raster) return;
        var layer = makeHeatLayer(raster, { opacity: CONFIG.HEAT.OPACITY });
        if (!layer) return;
        _heatLayer = layer;
        _heatRaster = raster;
        if (typeof layer.addTo === 'function') layer.addTo(map);
        else if (typeof map.addLayer === 'function') map.addLayer(layer);
    }

    // Celulele excluse de UAT sunt unite pe rânduri (run-length) în dreptunghiuri,
    // ca masca roșie să aibă câteva sute de forme în loc de câteva mii.
    function uatMaskRectangles(field) {
        var byRow = {};
        field.excluded.forEach(function (c) {
            if (c.reason !== 'uat') return;
            (byRow[c.row] = byRow[c.row] || []).push(c);
        });
        var rects = [];
        var halfCellLat = field.grid.cellLat / 2;
        var halfCellLng = field.grid.cellLng / 2;
        Object.keys(byRow).forEach(function (rowKey) {
            var cells = byRow[rowKey].sort(function (a, b) { return a.col - b.col; });
            var run = null;
            var flush = function () {
                if (!run) return;
                rects.push([
                    [run.minLat - halfCellLat, run.minLng - halfCellLng],
                    [run.maxLat + halfCellLat, run.maxLng + halfCellLng]
                ]);
                run = null;
            };
            cells.forEach(function (c) {
                if (run && c.col === run.lastCol + 1) {
                    run.lastCol = c.col;
                    run.minLat = Math.min(run.minLat, c.lat); run.maxLat = Math.max(run.maxLat, c.lat);
                    run.minLng = Math.min(run.minLng, c.lng); run.maxLng = Math.max(run.maxLng, c.lng);
                } else {
                    flush();
                    run = { lastCol: c.col, minLat: c.lat, maxLat: c.lat, minLng: c.lng, maxLng: c.lng };
                }
            });
            flush();
        });
        return rects;
    }

    function renderExclusionMask(map, field, ctx) {
        var M = CONFIG.MASK || {};
        var group = L.layerGroup([]);
        var renderer = null;
        if (typeof L.canvas === 'function') {
            renderer = L.canvas(assignPane(map, { padding: 0.2 }, 'pane_archeo_mask'));
        }

        // 1. intravilan UAT (celule picate pe rasterul non-roșu)
        uatMaskRectangles(field).forEach(function (bounds) {
            var options = assignPane(map, {
                color: M.COLOR || '#e03c3c',
                weight: 0.6,
                opacity: M.OPACITY === undefined ? 0.75 : M.OPACITY,
                fillColor: M.FILL || '#c0392b',
                fillOpacity: M.FILL_OPACITY_UAT === undefined ? 0.34 : M.FILL_OPACITY_UAT,
                interactive: false,
                stroke: false
            }, 'pane_archeo_mask');
            if (renderer) options.renderer = renderer;
            group.addLayer(L.rectangle(bounds, options));
        });

        // 2. razele de protecție ale siturilor cunoscute (600 m + 100 m buffer)
        var siteRadius = (ctx.siteRadius || CONFIG.SITE_RADIUS_M) + (ctx.siteBuffer || CONFIG.SITE_BUFFER_M);
        (ctx.sites || []).forEach(function (s) {
            if (s.isGuard) return; // gărzile de poligon ar umple harta cu cercuri
            var options = assignPane(map, {
                radius: siteRadius,
                color: M.COLOR || '#e03c3c',
                weight: 1,
                opacity: 0.6,
                fillColor: M.FILL || '#c0392b',
                fillOpacity: M.FILL_OPACITY_SITE === undefined ? 0.2 : M.FILL_OPACITY_SITE,
                interactive: false
            }, 'pane_archeo_mask');
            if (renderer) options.renderer = renderer;
            group.addLayer(L.circle([s.lat, s.lng], options));
        });

        // 3. contururile siturilor poligon (layer 6)
        (ctx.polygons || []).forEach(function (poly) {
            poly.rings.forEach(function (ring) {
                var latlngs = ring.map(function (p) {
                    var ll = localMetersToLatLng(p.x, p.y, ctx.centerLat);
                    return [ll.lat, ll.lng];
                });
                var options = assignPane(map, {
                    color: M.COLOR || '#e03c3c',
                    weight: 1.2,
                    opacity: 0.8,
                    fillColor: M.FILL || '#c0392b',
                    fillOpacity: 0.3,
                    interactive: false
                }, 'pane_archeo_mask');
                if (renderer) options.renderer = renderer;
                group.addLayer(L.polygon(latlngs, options));
            });
        });

        _maskGroup = group;
        if (_resultsVisible) group.addTo(map);
    }

    /* ── randarea completă a unei rulări ─────────────────────────────────── */
    function renderField(field) {
        var map = window._dlMap;
        if (!map || !field) return;
        ensurePane(map);
        clearRendered(map);

        var ctx = field.ctx;
        _layerGroup = L.layerGroup([]);
        renderWorkingArea(map, ctx, _layerGroup);

        // Modul de afișare e cel din UI, nu cel cu care a fost calculat câmpul:
        // comutarea Bule↔Heatmap redesenează imediat ultima analiză în noul mod
        // (altfel butoanele par să nu facă nimic până la următoarea „Detectează”).
        if (outputMode() === 'heat') renderHeat(map, field);
        else renderBubbles(map, field, _layerGroup);

        // Masca roșie (intravilan UAT + razele de protecție + contururile
        // poligon) se desenează în AMBELE moduri: explică de ce există goluri
        // între bule și marchează zonele în care detectarea nu e permisă.
        renderExclusionMask(map, field, ctx);

        if (_resultsVisible) _layerGroup.addTo(map);
    }

    /* ═══════════════════════════════════════════════════════════════════════
     * 9. UI — status, i18n, main entry point
     * ═══════════════════════════════════════════════════════════════════════ */

    var I18N = {
        en: {
            run_btn: 'Detect',
            running_short: 'Analyzing',
            running: 'Analyzing the {r} km area…',
            running_pin: 'Analyzing the {r} km area around the purple pin…',
            running_center: 'Analyzing the {r} km area around the map center…',
            progress: 'Analyzing… {p}%',
            ready: 'Set the radius (1–10 km) and press the button. With the pin switch on, tap the map first.',
            done: 'Analysis complete.',
            no_sites: 'Not enough archaeological sites in the area (need at least 3).',
            no_triangles: 'Sites are collinear / too clustered — no valid triangles.',
            no_candidates: 'No cell passed the filters (UAT red zone / site distances). Try a different area.',
            no_bubbles: 'Every scored cell sits too close to the UAT built-up area or a heritage radius for a whole bubble to fit — switch to Heatmap to read the scores.',
            error: 'Analysis failed — check the console for details.',
            cancelled: 'Analysis cancelled.',
            candidate: 'Candidate',
            cell: 'Cell',
            radius: 'radius',
            class_high: 'High Potential',
            class_medium: 'Medium Potential',
            nearby: 'Nearby sites',
            closest_site: 'Closest site',
            avg_dist: 'Avg. distance',
            density: 'Density',
            tri_quality: 'Triangle quality',
            summary: '{n} candidates · {h} High · {m} Medium',
            summary_field: '{n} bubbles ({h} High · {m} Medium) from {s} scored cells · {x} excluded (red)',
            summary_heat: '{n} scored cells in the heatmap · {x} excluded (red)',
            pin_hint: 'Pin mode off — the analysis starts from the map center.',
            pin_armed: 'Tap the map to drop the purple pin, then press “Detect”.',
            pin_set: 'Pin at {lat}, {lng} · radius {r} km — press “Detect”.'
        },
        ro: {
            run_btn: 'Detectează',
            running_short: 'Se analizează',
            running: 'Se analizează raza de {r} km…',
            running_pin: 'Se analizează raza de {r} km din jurul pinului mov…',
            running_center: 'Se analizează raza de {r} km din jurul centrului hărții…',
            progress: 'Se analizează… {p}%',
            ready: 'Alege raza (1–10 km) și apasă butonul. Cu comutatorul de pin pornit, atinge întâi harta.',
            done: 'Analiză finalizată.',
            no_sites: 'Nu sunt suficiente situri arheologice în zonă (e nevoie de cel puțin 3).',
            no_triangles: 'Siturile sunt coliniare / prea grupate — fără triunghiuri valide.',
            no_candidates: 'Nicio celulă nu a trecut filtrele (zona roșie UAT / distanțe față de situri). Încearcă altă zonă.',
            no_bubbles: 'Fiecare celulă cu scor e prea aproape de intravilanul UAT sau de o rază de protecție ca să încapă o bulă întreagă — treci pe Heatmap ca să vezi scorurile.',
            error: 'Analiza a eșuat — vezi consola pentru detalii.',
            cancelled: 'Analiză anulată.',
            candidate: 'Candidat',
            cell: 'Celulă',
            radius: 'rază',
            class_high: 'Potențial Ridicat',
            class_medium: 'Potențial Mediu',
            nearby: 'Situri apropiate',
            closest_site: 'Situl cel mai apropiat',
            avg_dist: 'Distanță medie',
            density: 'Densitate',
            tri_quality: 'Calitate triunghi',
            summary: '{n} candidați · {h} Ridicat · {m} Mediu',
            summary_field: '{n} bule ({h} Ridicat · {m} Mediu) din {s} celule cu scor · {x} excluse (roșu)',
            summary_heat: '{n} celule în heatmap · {x} excluse (roșu)',
            pin_hint: 'Modul pin e oprit — analiza pornește din centrul hărții.',
            pin_armed: 'Atinge harta ca să pui pinul mov, apoi apasă „Detectează”.',
            pin_set: 'Pin la {lat}, {lng} · rază {r} km — apasă „Detectează”.'
        }
    };

    function tr(key) {
        var lang = (typeof window._currentLang === 'function') ? window._currentLang() : 'en';
        var dict = I18N[lang] || I18N.en;
        return dict[key] !== undefined ? dict[key] : I18N.en[key];
    }

    function el(id) { return document.getElementById(id); }

    var _lastStatus = { key: 'ready', isError: false, vars: null };

    function setStatus(key, isError, vars) {
        _lastStatus = { key: key, isError: !!isError, vars: vars || null };
        var statusEl = el('archeoPotStatus');
        if (!statusEl) return;
        var text = tr(key);
        if (vars) {
            Object.keys(vars).forEach(function (k) {
                text = String(text).split('{' + k + '}').join(vars[k]);
            });
        }
        statusEl.textContent = text;
        if (statusEl.classList && statusEl.classList.toggle) statusEl.classList.toggle('error', !!isError);
    }

    function setSummary(stats, mode) {
        var summaryEl = el('archeoPotSummary');
        if (!summaryEl) return;
        stats = stats || {};
        var n = stats.scored || 0;
        if (n > 0) {
            var excluded = (stats.excludedUat || 0) + (stats.excludedHeritage || 0);
            // Modul BULE numără bulele desenate, modul HEAT celulele scorate.
            var text = tr(mode === 'heat' ? 'summary_heat' : 'summary_field')
                .replace('{n}', mode === 'heat' ? n : (stats.bubbles || 0))
                .replace('{h}', mode === 'heat' ? (stats.high || 0) : (stats.bubblesHigh || 0))
                .replace('{m}', mode === 'heat' ? (stats.medium || 0) : (stats.bubblesMedium || 0))
                .replace('{s}', n)
                .replace('{x}', excluded);
            summaryEl.style.display = '';
            summaryEl.innerHTML = '<span style="color:#c4a0f0;font-weight:600">' + text + '</span>';
        } else {
            summaryEl.style.display = 'none';
            summaryEl.textContent = '';
        }
    }

    function setRunning(running) {
        var btn = el('archeoPotRunBtn');
        if (btn) {
            btn.disabled = running;
            btn.classList.toggle('running', running);
            // Keep a .t[data-key] span inside so future language switches
            // (window.setLang) still re-translate the button label.
            btn.innerHTML = running
                ? '<span class="archeo-spinner" aria-hidden="true"></span><span class="t" data-key="archeo_run_running">Analyzing…</span>'
                : '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" style="flex-shrink:0"><path d="M6.5 1.5 L10 6 L8 6 L10 11.5 L6.5 8.2 L3 11.5 L5 6 L3 6 Z" fill="#c4a0f0" /></svg><span class="t" data-key="archeo_run_btn">' + tr('run_btn') + '</span>';
        }
    }

    function updateRunButtonVisibility(show) {
        if (show === undefined) show = !!_pinLatLng;
        var btn = el('archeoPotRunBtn');
        if (btn) {
            if (btn.style) btn.style.display = show ? '' : 'none';
            if (btn.classList && typeof btn.classList.toggle === 'function') {
                btn.classList.toggle('is-hidden', !show);
            }
        }
        try {
            if (window.DetectLabVerticalOpacity && typeof window.DetectLabVerticalOpacity.refreshDock === 'function') {
                window.DetectLabVerticalOpacity.refreshDock();
            }
        } catch (e) {}
    }

    function yieldToUI() {
        return new Promise(function (resolve) {
            setTimeout(resolve, 0);
        });
    }

    function chunk(array, size) {
        var out = [];
        for (var i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
        return out;
    }

    /* ═══════════════════════════════════════════════════════════════════════
     * 9b. PIN MOV + RAZĂ 1–10 KM + MOD DE AFIȘARE (bule / heatmap)
     * ═══════════════════════════════════════════════════════════════════════
     * Același tip de interacțiune ca la LIDAR Scanner și Raport arheologic:
     * comutatorul de pin pornește modul de selectare, un tap pe hartă pune
     * pinul (mov, ca identitatea stratului) și cercul razei, iar sliderul
     * 1–10 km redimensionează cercul în timp real. Fără pin, analiza pornește
     * din centrul hărții — comportamentul vechi rămâne disponibil. */

    var _pinMode = false;
    var _pinLatLng = null;
    var _pinMarker = null;
    var _pinCircle = null;
    var _pinRenderer = null;
    var _mode = null;                 // null → CONFIG.FIELD.MODE
    var _draggingRadius = false;

    var raf = (typeof window !== 'undefined' && window.requestAnimationFrame &&
        window.requestAnimationFrame.bind(window)) || function (fn) { return setTimeout(fn, 16); };

    function outputMode() {
        if (_mode === 'heat' || _mode === 'bubbles') return _mode;
        return CONFIG.FIELD.MODE === 'heat' ? 'heat' : 'bubbles';
    }

    function radiusKm() {
        var slider = el('archeoPotDistance');
        var value = slider ? parseFloat(slider.value) : NaN;
        if (!isFinite(value)) value = CONFIG.RADIUS_KM_DEFAULT;
        return Math.max(CONFIG.RADIUS_KM_MIN, Math.min(CONFIG.RADIUS_KM_MAX, value));
    }

    function currentRadiusM() {
        return radiusKm() * 1000;
    }

    function setRadiusKm(km) {
        var slider = el('archeoPotDistance');
        var value = Math.max(CONFIG.RADIUS_KM_MIN, Math.min(CONFIG.RADIUS_KM_MAX, Number(km) || CONFIG.RADIUS_KM_DEFAULT));
        if (slider) {
            slider.value = String(value);
            if (typeof slider.dispatchEvent === 'function') {
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
        updateRadiusLabel(value);
        if (_pinLatLng) drawPinCircle(_pinLatLng, false);
        return value;
    }

    function updateRadiusLabel(km) {
        var label = el('archeoPotDistanceValue');
        if (label) label.textContent = (km === undefined ? radiusKm() : km) + ' km';
    }

    function setOutputMode(mode) {
        _mode = (mode === 'heat') ? 'heat' : 'bubbles';
        CONFIG.FIELD.MODE = _mode;
        var bubblesBtn = el('archeoPotModeBubbles');
        var heatBtn = el('archeoPotModeHeat');
        if (bubblesBtn && bubblesBtn.classList) bubblesBtn.classList.toggle('is-active', _mode === 'bubbles');
        if (heatBtn && heatBtn.classList) heatBtn.classList.toggle('is-active', _mode === 'heat');
        var legendBubbles = el('archeoPotLegendBubbles');
        var legendHeat = el('archeoPotLegendHeat');
        if (legendBubbles) legendBubbles.style.display = _mode === 'bubbles' ? 'flex' : 'none';
        if (legendHeat) legendHeat.style.display = _mode === 'heat' ? 'flex' : 'none';
        // Comutarea modului redesenează imediat ultima analiză (dacă există).
        if (_currentField) renderField(_currentField);
        return _mode;
    }

    function pinRendererOption(map) {
        if (!_pinRenderer && typeof L !== 'undefined' && L.canvas) {
            _pinRenderer = L.canvas(assignPane(map, { padding: 0.3 }, 'pane_archeo'));
        }
        return _pinRenderer;
    }

    function drawPinCircle(latlng, dragging) {
        var map = window._dlMap;
        if (!map || typeof L === 'undefined' || !L.circle) return;
        var style = dragging ? CONFIG.PIN.CIRCLE_DRAG : CONFIG.PIN.CIRCLE_IDLE;
        var radiusM = currentRadiusM();
        if (_pinCircle && _pinCircle.setLatLng && _pinCircle.setRadius) {
            _pinCircle.setLatLng(latlng);
            _pinCircle.setRadius(radiusM);
            if (_pinCircle.setStyle) _pinCircle.setStyle(style);
            return;
        }
        var options = assignPane(map, {
            radius: radiusM,
            color: style.color,
            weight: style.weight,
            dashArray: style.dashArray,
            fill: style.fill,
            fillColor: style.fillColor,
            fillOpacity: style.fillOpacity,
            opacity: style.opacity,
            interactive: false
        }, 'pane_archeo');
        var renderer = pinRendererOption(map);
        if (renderer) options.renderer = renderer;
        _pinCircle = L.circle(latlng, options);
        if (_pinCircle.addTo) _pinCircle.addTo(map);
        else if (map.addLayer) map.addLayer(_pinCircle);
    }

    function clearPinCircle() {
        var map = window._dlMap;
        if (map && _pinCircle && map.removeLayer) map.removeLayer(_pinCircle);
        _pinCircle = null;
    }

    // Pinul mov: aceeași anatomie ca pinul albastru al Raportului arheologic
    // (halou pulsant + punct central), în culoarea stratului.
    function drawPin(latlng) {
        var map = window._dlMap;
        if (!map) return;
        if (_pinMarker && map.removeLayer) map.removeLayer(_pinMarker);
        _pinLatLng = { lat: latlng.lat, lng: latlng.lng };
        try { window._dlSearchAreaPin = { lat: latlng.lat, lng: latlng.lng }; } catch (e) {}
        if (typeof L === 'undefined' || !L.marker || !L.divIcon) {
            drawPinCircle(latlng, false);
            updateRunButtonVisibility(true);
            return;
        }
        var icon = L.divIcon({
            className: 'archeo-pot-pin-wrapper',
            html: '<div class="archeo-pot-pin" title="' + tr('candidate') + '">' +
                  '<div class="archeo-pot-pin-pulse"></div><div class="archeo-pot-pin-dot"></div></div>',
            iconSize: [26, 26],
            iconAnchor: [13, 13]
        });
        _pinMarker = L.marker(latlng, assignPane(map, { icon: icon, zIndexOffset: 2000, interactive: false }, 'pane_archeo_pin'));
        if (_pinMarker.addTo) _pinMarker.addTo(map);
        if (_pinMarker.bindTooltip) {
            _pinMarker.bindTooltip(
                '<span class="archeo-pot-tag"><b>' + tr('candidate') + '</b><br>' +
                latlng.lat.toFixed(4) + ', ' + latlng.lng.toFixed(4) + '</span>',
                assignPane(map, { direction: 'top', offset: [0, -14], className: 'archeo-pot-tooltip' }, 'pane_archeo_pin')
            );
        }
        drawPinCircle(latlng, false);
        updateRunButtonVisibility(true);
    }

    function clearPin() {
        var map = window._dlMap;
        if (map && _pinMarker && map.removeLayer) map.removeLayer(_pinMarker);
        _pinMarker = null;
        _pinLatLng = null;
        clearPinCircle();
        updateRunButtonVisibility(false);
    }

    function onMapClick(e) {
        if (!_pinMode || _runInFlight) return;
        var latlng = e && e.latlng ? e.latlng : null;
        if (!latlng) return;
        drawPin(latlng);
        setStatus('pin_set', false, {
            lat: latlng.lat.toFixed(5), lng: latlng.lng.toFixed(5), r: radiusKm()
        });
    }

    function setPinMode(on) {
        _pinMode = !!on;
        var map = window._dlMap;
        var row = el('archeoPotentialRow');
        if (row && row.classList) row.classList.toggle('is-on', _pinMode);
        var toggle = el('archeoPotPinToggle');
        if (toggle && toggle.checked !== _pinMode) toggle.checked = _pinMode;

        if (map && typeof map.on === 'function') {
            if (_pinMode) {
                ensurePane(map);
                map.on('click', onMapClick);
                if (_pinLatLng) drawPinCircle(_pinLatLng, false);
                setStatus(_pinLatLng ? 'pin_set' : 'pin_armed', false, _pinLatLng ? {
                    lat: _pinLatLng.lat.toFixed(5), lng: _pinLatLng.lng.toFixed(5), r: radiusKm()
                } : null);
                updateRunButtonVisibility(!!_pinLatLng);
            } else {
                if (typeof map.off === 'function') map.off('click', onMapClick);
                clearPin();
                setStatus('pin_hint');
            }
        }
        // Oglinda verticală a razei + butonul andocat jos urmează modul pin.
        notifyVerticalControl(_pinMode ? 'archeoPotDistance' : null);
        return _pinMode;
    }

    // Trimite stratul către oglinda verticală (slider de rază în dreapta) și
    // către dock-ul centrat jos (butonul „Detectează”). Absența modulului
    // (teste node, încărcare parțială) e ignorată.
    function notifyVerticalControl(sliderId) {
        try {
            var api = window.DetectLabVerticalOpacity;
            if (!api) return;
            if (sliderId && typeof api.select === 'function') api.select(sliderId);
            else if (!sliderId && typeof api.getActiveSliderId === 'function' &&
                     api.getActiveSliderId() === 'archeoPotDistance' && typeof api.close === 'function') {
                api.close();
            }
        } catch (e) { /* controlul nu e încă inițializat */ }
    }

    // Sliderul de rază: aceeași optimizare ca la LIDAR Scanner / Raport —
    // cercul e redesenat o singură dată pe frame, cu stilul „drag” (fără fill
    // și fără dash) cât timp degetul e pe slider, apoi revine la stilul normal.
    function wireRadiusSlider(slider) {
        var pending = null;
        var scheduled = false;
        var frame = null;
        var releaseTimer = null;

        function paint() {
            scheduled = false;
            frame = null;
            var value = pending;
            pending = null;
            if (value == null) return;
            updateRadiusLabel(value);
            if (_pinLatLng && _pinCircle && _pinCircle.setRadius) _pinCircle.setRadius(value * 1000);
        }

        function schedule() {
            if (scheduled) return;
            scheduled = true;
            frame = raf(paint);
        }

        function beginDrag() {
            if (_draggingRadius) return;
            _draggingRadius = true;
            if (document.body && document.body.classList) document.body.classList.add('arch-distance-dragging');
            if (_pinCircle && _pinCircle.setStyle) _pinCircle.setStyle(CONFIG.PIN.CIRCLE_DRAG);
        }

        function endDrag() {
            if (!_draggingRadius) return;
            _draggingRadius = false;
            if (pending !== null) {
                if (scheduled && typeof window !== 'undefined' && window.cancelAnimationFrame) window.cancelAnimationFrame(frame);
                else clearTimeout(frame);
                scheduled = false;
                paint();
            }
            if (_pinCircle && _pinCircle.setStyle) _pinCircle.setStyle(CONFIG.PIN.CIRCLE_IDLE);
            if (document.body && document.body.classList) document.body.classList.remove('arch-distance-dragging');
        }

        slider.addEventListener('input', function () {
            pending = +this.value;
            beginDrag();
            schedule();
            clearTimeout(releaseTimer);
            releaseTimer = setTimeout(endDrag, 220);
        });
        ['change', 'pointerup', 'pointercancel', 'touchend', 'touchcancel', 'mouseup', 'blur'].forEach(function (type) {
            slider.addEventListener(type, function () {
                clearTimeout(releaseTimer);
                endDrag();
            });
        });
    }

    var _runInFlight = false;
    var _runVersion = 0;

    /**
     * The whole analysis pipeline, WITHOUT any UI or map side effects.
     *
     * Both the layer's own button and the Premium "Archeological Report"
     * (js/archeo-report.js) run through here, so a "potential zone" bubble means
     * exactly the same thing in both features — one implementation, one set of
     * filters, one scoring table.
     *
     * @param {number} centerLat  analysis centre
     * @param {number} centerLng
     * @param {number} [radiusM]  working radius (default CONFIG.SEARCH_RADIUS_M)
     * @param {Object} [opts]
     *        isCancelled()  → truthy aborts between batches ({status:'cancelled'})
     *        chunkSize      → seeds per async batch (default 30)
     *        yieldModulo    → yield to the UI every N batches (default 4)
     * @returns {Promise<{status, results, ctx, stats}>}
     *          status ∈ ok | no_sites | no_triangles | no_candidates | cancelled
     *          results = [{lat, lng, x, y, score, factors, classification}]
     */
    function computeCandidates(centerLat, centerLng, radiusM, opts) {
        opts = opts || {};
        var radius = (typeof radiusM === 'number' && isFinite(radiusM)) ? radiusM : CONFIG.SEARCH_RADIUS_M;
        var lat0 = centerLat;
        var t0 = performance.now();
        var isCancelled = typeof opts.isCancelled === 'function' ? opts.isCancelled : function () { return false; };
        var chunkSize = opts.chunkSize || 30;
        var yieldModulo = opts.yieldModulo === undefined ? 4 : opts.yieldModulo;

        return (async function main() {
            // Callers that already waited for window._localLayerData (e.g. the
            // Archeological Report layer) pass skipDataWait so an unreachable
            // heritage API is not waited on twice.
            if (!opts.skipDataWait) await waitForSiteData();

            var ctx = collectSitesInRadius(centerLat, centerLng, radius, lat0);
            ctx.center = projectToLocalMeters(centerLat, centerLng, lat0);
            ctx.centerLat = centerLat;
            ctx.centerLng = centerLng;
            ctx.radius = radius;
            ctx.siteRadius = CONFIG.SITE_RADIUS_M;
            ctx.siteBuffer = CONFIG.SITE_BUFFER_M;
            ctx.triangles = [];
            ctx.seeds = [];

            if (ctx.sites.length < 3) return done('no_sites');

            // local spatial index over the sites inside the radius
            ctx.siteIndex = createGridIndex(1200, 1200);
            for (var i = 0; i < ctx.sites.length; i++) {
                ctx.siteIndex.insert(ctx.sites[i].x, ctx.sites[i].y, ctx.sites[i]);
            }

            // triangulate
            var points = ctx.sites.map(function (s, idx) {
                return { x: s.x, y: s.y, lat: s.lat, lng: s.lng, i: idx };
            });
            var triangles = delaunayTriangulation(points);
            ctx.triangles = triangles.map(function (t) {
                // keep lat/lng refs for debug rendering
                return {
                    a: { x: t.a.x, y: t.a.y, lat: points[t.a.i].lat, lng: points[t.a.i].lng },
                    b: { x: t.b.x, y: t.b.y, lat: points[t.b.i].lat, lng: points[t.b.i].lng },
                    c: { x: t.c.x, y: t.c.y, lat: points[t.c.i].lat, lng: points[t.c.i].lng }
                };
            });
            if (ctx.triangles.length === 0) return done('no_triangles');

            var seeds = sampleTriangles(triangles, lat0);
            ctx.seeds = seeds;
            if (seeds.length === 0) return done('no_candidates');

            // async filtering, chunked so the UI stays responsive
            var kept = [];
            var batches = chunk(seeds, chunkSize);
            for (var b = 0; b < batches.length; b++) {
                var res = await Promise.all(batches[b].map(async function (seed) {
                    if (!passesMandatorySpatialFilters(seed, ctx)) return null;
                    var uat = await uatPixelAt(seed.lat, seed.lng);
                    if (uat !== true) return null; // fail closed: not confirmed inside red UAT area
                    return seed;
                }));
                kept = kept.concat(res.filter(function (x) { return x !== null; }));
                if (yieldModulo > 0 && b % yieldModulo === 0) await yieldToUI();
                if (isCancelled()) return done('cancelled');
            }

            var scored = kept.map(function (seed) { return scoreCandidate(seed, ctx); });
            var results = selectSeparated(scored).map(function (c) {
                return {
                    lat: c.lat, lng: c.lng, x: c.x, y: c.y,
                    score: c.score, factors: c.factors,
                    classification: classify(c.score)
                };
            });
            ctx.keptCount = kept.length;
            return done('ok', results);

            function done(status, results) {
                var out = results || [];
                var nHigh = 0, nMed = 0;
                out.forEach(function (r) { if (r.classification === 'high') nHigh++; else nMed++; });
                return {
                    status: status,
                    results: out,
                    ctx: ctx,
                    stats: {
                        sites: ctx.sites.length,
                        triangles: ctx.triangles.length,
                        seeds: seeds ? seeds.length : 0,
                        passed: ctx.keptCount || 0,
                        high: nHigh,
                        medium: nMed,
                        ms: Math.round(performance.now() - t0)
                    }
                };
            }
        })();
    }

    /**
     * Main entry point — called every time the user presses
     * "Detect / Detectează". Analizează raza din slider (1–10 km)
     * în jurul pinului mov, sau în jurul centrului hărții când modul pin e
     * oprit, și randează câmpul de scor în modul ales (bule / heatmap).
     */
    function runArcheoPotentialAnalysis() {
        if (_runInFlight) return Promise.resolve(false);
        _runInFlight = true;
        _runVersion++;
        var myVersion = _runVersion;

        var map = window._dlMap;
        if (!map) {
            setStatus('error', true);
            _runInFlight = false;
            return Promise.resolve(false);
        }

        var center = _pinLatLng ? { lat: _pinLatLng.lat, lng: _pinLatLng.lng } : map.getCenter();
        var radiusM = currentRadiusM();
        var mode = outputMode();
        setRunning(true);
        setStatus(_pinLatLng ? 'running_pin' : 'running_center', false, { r: radiusKm() });
        setSummary({ scored: 0 }, mode);

        return (async function main() {
            var field = null;
            try {
                field = await computePotentialField(center.lat, center.lng, radiusM, {
                    mode: mode,
                    isCancelled: function () { return myVersion !== _runVersion; },
                    onProgress: function (ratio) {
                        if (myVersion !== _runVersion) return;
                        setStatus('progress', false, { p: Math.round(ratio * 100) });
                    }
                });

                if (myVersion !== _runVersion) return; // superseded by a newer run

                if (field.status === 'cancelled') { setStatus('cancelled'); return; }
                if (field.status === 'no_sites') {
                    setStatus('no_sites', true);
                    setSummary(field.stats, mode);
                    return;
                }

                _currentField = field;
                _currentResults = field.results;
                renderField(field);

                var st = field.stats;
                console.log('[ArcheoPotential] ' + mode + ' · ' +
                    st.sites + ' sites, ' + st.cells + ' cells (' + field.cellM + ' m), ' +
                    st.scored + ' scored, ' + st.excludedUat + ' UAT-excluded, ' +
                    st.excludedHeritage + ' heritage-excluded (' + st.high + ' high, ' +
                    st.medium + ' medium, ' + st.low + ' low) — ' + st.ms + ' ms');

                if (!field.results.length) setStatus('no_candidates', true);
                else if (mode !== 'heat' && !field.bubbles.length) setStatus('no_bubbles', true);
                else setStatus('done');
                setSummary(st, mode);
            } catch (err) {
                console.error('[ArcheoPotential] Analysis failed:', err);
                setStatus('error', true);
                setSummary({ scored: 0 }, mode);
            } finally {
                if (myVersion === _runVersion) _runInFlight = false;
                setRunning(false);
            }
        })();
    }

    function layerList() {
        var out = [];
        if (_layerGroup) out.push(_layerGroup);
        if (_maskGroup) out.push(_maskGroup);
        if (_heatLayer) out.push(_heatLayer);
        return out;
    }

    function toggleArcheoPotentialLayer(on) {
        _resultsVisible = !!on;
        // Stratul oprit → și modul pin se oprește (iar oglinda razei + dock-ul
        // de acțiune se închid), ca să nu rămână unelte active fără rezultate.
        if (!_resultsVisible && _pinMode) setPinMode(false);
        var map = window._dlMap;
        if (!map) return;
        layerList().forEach(function (layer) {
            try {
                var has = (typeof map.hasLayer === 'function') ? map.hasLayer(layer) : false;
                if (_resultsVisible) {
                    if (!has) layer.addTo(map);
                    if (layer === _heatLayer && typeof layer.ensureCanvas === 'function') layer.ensureCanvas();
                } else if (has) {
                    map.removeLayer(layer);
                }
            } catch (e) { /* DOM-only tests */ }
        });
    }

    /* ═══════════════════════════════════════════════════════════════════════
     * 10. WIRE-UP + PUBLIC API
     * ═══════════════════════════════════════════════════════════════════════ */

    function onLangChange() {
        setStatus(_lastStatus.key, _lastStatus.isError, _lastStatus.vars);
        if (_currentField) setSummary(_currentField.stats, outputMode());
        if (!_runInFlight) setRunning(false);
        // Tooltip-ul pinului și eticheta cercului urmăresc limba curentă.
        if (_pinMode && _pinLatLng) drawPin(_pinLatLng);
    }

    function wireUI() {
        var btn = el('archeoPotRunBtn');
        if (btn && !btn.dataset.archeoWired) {
            btn.dataset.archeoWired = '1';
            btn.addEventListener('click', function () { runArcheoPotentialAnalysis(); });
        }
        var toggle = el('archeoPotToggle');
        if (toggle && !toggle.dataset.archeoWired) {
            toggle.dataset.archeoWired = '1';
            toggle.addEventListener('change', function () {
                toggleArcheoPotentialLayer(toggle.checked);
            });
        }
        var pinToggle = el('archeoPotPinToggle');
        if (pinToggle && !pinToggle.dataset.archeoWired) {
            pinToggle.dataset.archeoWired = '1';
            pinToggle.addEventListener('change', function () {
                setPinMode(this.checked);
            });
        }
        var slider = el('archeoPotDistance');
        if (slider && !slider.dataset.archeoWired) {
            slider.dataset.archeoWired = '1';
            wireRadiusSlider(slider);
        }
        updateRadiusLabel();

        var bubblesBtn = el('archeoPotModeBubbles');
        if (bubblesBtn && !bubblesBtn.dataset.archeoWired) {
            bubblesBtn.dataset.archeoWired = '1';
            bubblesBtn.addEventListener('click', function () { setOutputMode('bubbles'); });
        }
        var heatBtn = el('archeoPotModeHeat');
        if (heatBtn && !heatBtn.dataset.archeoWired) {
            heatBtn.dataset.archeoWired = '1';
            heatBtn.addEventListener('click', function () { setOutputMode('heat'); });
        }
        setOutputMode(outputMode());

        if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('detectlab:langchange', onLangChange);
        }
        updateRunButtonVisibility(!!_pinLatLng);
        setStatus(_pinLatLng ? 'pin_set' : (_pinMode ? 'pin_armed' : 'ready'), false,
            _pinLatLng ? { lat: _pinLatLng.lat.toFixed(5), lng: _pinLatLng.lng.toFixed(5), r: radiusKm() } : null);
    }

    // The panel may load before or after this script — wire on both events.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireUI);
    } else {
        wireUI();
    }

    // Public API (used by index.html handlers + console)
    window.runArcheoPotentialAnalysis = runArcheoPotentialAnalysis;
    window.toggleArcheoPotentialLayer = toggleArcheoPotentialLayer;
    window.setArcheoPotentialMode = setOutputMode;
    window.setArcheoPotentialPinMode = setPinMode;
    window.setArcheoPotentialRadiusKm = setRadiusKm;
    // Headless pipeline — used by js/archeo-report.js (the Premium
    // "Archeological Report") so that its "potential zones" are exactly the
    // bubbles this layer would return, with the same filters and scoring.
    window.computeArcheoPotential = computeCandidates;
    // Dense score field (both display modes of this layer).
    window.computeArcheoPotentialField = computePotentialField;
    window._archeoPotentialResults = function () { return _currentResults; };
    window._archeoPotentialField = function () { return _currentField; };
    // Bulele desenate (selecția rară) + suprafața de heatmap a ultimei rulări.
    window._archeoPotentialBubbles = function () { return _currentField ? _currentField.bubbles : null; };
    window._archeoPotentialHeat = function () { return _heatLayer; };
    window._archeoPotentialHeatRaster = function () { return _heatRaster; };
    window._archeoPotentialState = function () {
        return {
            pinMode: _pinMode,
            pin: _pinLatLng ? { lat: _pinLatLng.lat, lng: _pinLatLng.lng } : null,
            radiusKm: radiusKm(),
            radiusM: currentRadiusM(),
            mode: outputMode(),
            resultsVisible: _resultsVisible,
            running: _runInFlight
        };
    };
    // Console helper: _archeoPotSetPoint(46.77, 23.59) then runArcheoPotentialAnalysis()
    window._archeoPotSetPoint = function (lat, lng) {
        var latlng = (typeof L !== 'undefined' && L.latLng) ? L.latLng(lat, lng) : { lat: lat, lng: lng };
        if (!_pinMode) setPinMode(true);
        drawPin(latlng);
        return _pinLatLng;
    };
    window._archeoPotentialResetCache = function () { _siteIndexCache = null; };
    window._archeoPotentialDebug = {
        config: CONFIG,
        collectSitesInRadius: collectSitesInRadius,
        buildGlobalSiteIndex: buildGlobalSiteIndex,
        delaunayTriangulation: delaunayTriangulation,
        triangleQuality: triangleQuality,
        sampleTriangles: sampleTriangles,
        scoreCandidate: scoreCandidate,
        classify: classify,
        selectSeparated: selectSeparated,
        pointInPolygon: pointInPolygon,
        scoreColor: scoreColor,
        starRatingHtml: starRatingHtml,
        popupHtml: popupHtml,
        uatPixelAt: uatPixelAt,
        computeCandidates: computeCandidates,
        projectToLocalMeters: projectToLocalMeters,
        localMetersToLatLng: localMetersToLatLng,
        haversineM: haversineM,
        _uatTileZ: uatTileZ,
        // câmp de scor (grilă densă) + moduri de afișare
        computePotentialField: computePotentialField,
        gridCellM: gridCellM,
        buildFieldCells: buildFieldCells,
        buildTriangleIndex: buildTriangleIndex,
        triangleRecordAt: triangleRecordAt,
        triScoreAt: triScoreAt,
        exclusionReason: exclusionReason,
        uatMaskRectangles: uatMaskRectangles,
        // bule rare (sweet spot) + rasterul de scor pentru heatmap
        selectBubbles: selectBubbles,
        bubbleBaseRadiusM: bubbleBaseRadiusM,
        bubbleGapM: bubbleGapM,
        bubbleCountCap: bubbleCountCap,
        heatScoreWindow: heatScoreWindow,
        heatNormalize: heatNormalize,
        buildHeatRamp: buildHeatRamp,
        buildHeatRaster: buildHeatRaster,
        smoothField: smoothField,
        colorizeField: colorizeField,
        percentile: percentile,
        HEAT_GRADIENT: HEAT_GRADIENT,
        heatLayerProto: heatLayerProto,
        makeHeatLayer: makeHeatLayer,
        renderField: renderField,
        outputMode: outputMode,
        setOutputMode: setOutputMode,
        radiusKm: radiusKm,
        currentRadiusM: currentRadiusM,
        setPinMode: setPinMode,
        state: function () { return window._archeoPotentialState(); }
    };
})();

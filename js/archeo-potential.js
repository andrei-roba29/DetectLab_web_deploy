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
 * WORKFLOW (triggered by the "Candidate Areas / Zone candidati" button)
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
        SEARCH_RADIUS_M: 10000,      // radius around the current map center (10 km)
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

        // Candidate output ---------------------------------------------------
        CANDIDATE_RADIUS_M: 300,     // rendered circle radius
        CANDIDATE_MIN_SEPARATION_M: 900, // suppress candidates closer than this (300 m circles won't overlap)
        MAX_CANDIDATES: 80,          // cap the final output for readability

        // Rendering ----------------------------------------------------------
        PANE_Z_INDEX: 660,           // above heritage canvas (650) + markers (600), below popups (700)
        SHOW_WORKING_AREA: true,     // draw the 10 km search circle + center marker
        SHOW_TRIANGULATION: false,   // debug: draw the Delaunay triangles

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
     * 8. RENDERING
     * ═══════════════════════════════════════════════════════════════════════ */

    var _layerGroup = null;
    var _currentResults = null;
    var _resultsVisible = true;

    // Medium = lighter purple, semi-transparent; High = darker purple, stronger opacity.
    var STYLE = {
        medium: { color: '#B388E8', weight: 1.5, opacity: 0.85, fillColor: '#B388E8', fillOpacity: 0.28 },
        high: { color: '#5E2B9E', weight: 2.2, opacity: 0.95, fillColor: '#6B2FA0', fillOpacity: 0.55 }
    };

    function ensurePane(map) {
        var pane = map.getPane('pane_archeo');
        if (!pane) {
            pane = map.createPane('pane_archeo');
        }
        if (pane && pane.style) pane.style.zIndex = CONFIG.PANE_Z_INDEX;
    }

    function popupHtml(c, idx) {
        var cls = classify(c.score) === 'high' ? tr('class_high') : tr('class_medium');
        var pct = Math.round(c.score * 100);
        return '<div style="font-family:Outfit,sans-serif;min-width:200px;padding:2px">' +
            '<div style="font-family:Cinzel,serif;font-size:0.85rem;color:#c4a0f0;font-weight:700;margin-bottom:8px">' +
            '🔎 ' + tr('candidate') + ' #' + idx + '</div>' +
            '<div style="font-size:0.78rem;color:rgba(245,240,235,0.9);margin-bottom:6px">' +
            '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:' +
            (cls === tr('class_high') ? '#6B2FA0' : '#B388E8') + '"></span>' +
            '<strong>' + cls + '</strong> — ' + pct + '%</div>' +
            '<div style="font-size:0.72rem;color:rgba(245,240,235,0.65);line-height:1.6">' +
            '📍 ' + c.lat.toFixed(5) + ', ' + c.lng.toFixed(5) + '<br>' +
            tr('nearby') + ': ' + c.factors.nearbyCount + ' &nbsp;·&nbsp; ' +
            tr('avg_dist') + ': ' + c.factors.avgDistM + ' m<br>' +
            tr('density') + ': ' + c.factors.densityCount + ' &nbsp;·&nbsp; ' +
            tr('tri_quality') + ': ' + c.factors.triQuality.toFixed(2) + '</div></div>';
    }

    function render(results, ctx) {
        var map = window._dlMap;
        if (!map) return;
        ensurePane(map);

        if (_layerGroup) {
            map.removeLayer(_layerGroup);
            _layerGroup = null;
        }
        _layerGroup = L.layerGroup([]);

        if (CONFIG.SHOW_WORKING_AREA) {
            var workCircle = L.circle([ctx.centerLat, ctx.centerLng], {
                radius: CONFIG.SEARCH_RADIUS_M,
                pane: 'pane_archeo',
                color: '#a070e8',
                weight: 1.4,
                dashArray: '6 6',
                fillColor: '#a070e8',
                fillOpacity: 0.03,
                opacity: 0.5,
                interactive: false
            });
            _layerGroup.addLayer(workCircle);

            var centerDot = L.circleMarker([ctx.centerLat, ctx.centerLng], {
                pane: 'pane_archeo',
                radius: 4,
                color: '#a070e8',
                weight: 1.5,
                fillColor: '#c4a0f0',
                fillOpacity: 0.9,
                interactive: false
            });
            _layerGroup.addLayer(centerDot);
        }

        if (CONFIG.SHOW_TRIANGULATION) {
            ctx.triangles.forEach(function (t) {
                _layerGroup.addLayer(L.polyline(
                    [[t.a.lat, t.a.lng], [t.b.lat, t.b.lng], [t.c.lat, t.c.lng], [t.a.lat, t.a.lng]],
                    {
                        pane: 'pane_archeo',
                        color: 'rgba(163,112,232,0.55)',
                        weight: 1,
                        interactive: false
                    }
                ));
            });
        }

        results.forEach(function (c, idx) {
            var cls = classify(c.score) === 'high' ? 'high' : 'medium';
            var style = STYLE[cls];
            var circle = L.circle([c.lat, c.lng], {
                pane: 'pane_archeo',
                radius: CONFIG.CANDIDATE_RADIUS_M,
                color: style.color,
                weight: style.weight,
                opacity: style.opacity,
                fillColor: style.fillColor,
                fillOpacity: style.fillOpacity
            });
            circle.bindPopup(popupHtml(c, idx + 1));
            _layerGroup.addLayer(circle);
        });

        if (_resultsVisible) _layerGroup.addTo(map);
    }

    /* ═══════════════════════════════════════════════════════════════════════
     * 9. UI — status, i18n, main entry point
     * ═══════════════════════════════════════════════════════════════════════ */

    var I18N = {
        en: {
            run_btn: 'Candidate Areas',
            running_short: 'Analyzing',
            running: 'Analyzing the 10 km area around the map center…',
            done: 'Analysis complete.',
            no_sites: 'Not enough archaeological sites in the area (need at least 3).',
            no_triangles: 'Sites are collinear / too clustered — no valid triangles.',
            no_candidates: 'No candidate passed the filters (UAT red zone / site distances). Try a different area.',
            error: 'Analysis failed — check the console for details.',
            cancelled: 'Analysis cancelled.',
            candidate: 'Candidate',
            class_high: 'High Potential',
            class_medium: 'Medium Potential',
            nearby: 'Nearby sites',
            avg_dist: 'Avg. distance',
            density: 'Density',
            tri_quality: 'Triangle quality',
            summary: '{n} candidates · {h} High · {m} Medium'
        },
        ro: {
            run_btn: 'Zone candidati',
            running_short: 'Se analizează',
            running: 'Se analizează zona de 10 km din jurul centrului hărții…',
            done: 'Analiză finalizată.',
            no_sites: 'Nu sunt suficiente situri arheologice în zonă (e nevoie de cel puțin 3).',
            no_triangles: 'Siturile sunt coliniare / prea grupate — fără triunghiuri valide.',
            no_candidates: 'Niciun candidat nu a trecut filtrele (zona roșie UAT / distanțe față de situri). Încearcă altă zonă.',
            error: 'Analiza a eșuat — vezi consola pentru detalii.',
            cancelled: 'Analiză anulată.',
            candidate: 'Candidat',
            class_high: 'Potențial Ridicat',
            class_medium: 'Potențial Mediu',
            nearby: 'Situri apropiate',
            avg_dist: 'Distanță medie',
            density: 'Densitate',
            tri_quality: 'Calitate triunghi',
            summary: '{n} candidați · {h} Ridicat · {m} Mediu'
        }
    };

    function tr(key) {
        var lang = (typeof window._currentLang === 'function') ? window._currentLang() : 'en';
        var dict = I18N[lang] || I18N.en;
        return dict[key] !== undefined ? dict[key] : I18N.en[key];
    }

    function el(id) { return document.getElementById(id); }

    function setStatus(key, isError) {
        var statusEl = el('archeoPotStatus');
        if (!statusEl) return;
        statusEl.textContent = tr(key);
        statusEl.classList.toggle('error', !!isError);
    }

    function setSummary(n, h, m) {
        var summaryEl = el('archeoPotSummary');
        if (!summaryEl) return;
        if (n > 0) {
            summaryEl.style.display = '';
            summaryEl.innerHTML =
                '<span style="color:#c4a0f0;font-weight:600">' +
                tr('summary').replace('{n}', n).replace('{h}', h).replace('{m}', m) +
                '</span>';
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
                : '<span class="t" data-key="archeo_run_btn">Candidate Areas</span>';
        }
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

    var _runInFlight = false;
    var _runVersion = 0;

    /**
     * Main entry point — called every time the user presses
     * "Candidate Areas / Zone candidati".
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

        var center = map.getCenter();
        var lat0 = center.lat;
        var t0 = performance.now();
        setRunning(true);
        setStatus('running');
        setSummary(0, 0, 0);

        var ctx = null;

        return (async function main() {
            try {
                var data = await waitForSiteData();

                if (myVersion !== _runVersion) return; // superseded by a newer run

                ctx = collectSitesInRadius(
                    center.lat, center.lng,
                    CONFIG.SEARCH_RADIUS_M, lat0
                );
                ctx.center = projectToLocalMeters(center.lat, center.lng, lat0);
                ctx.centerLat = center.lat;   // used by the working-area circle
                ctx.centerLng = center.lng;
                ctx.radius = CONFIG.SEARCH_RADIUS_M;
                ctx.siteRadius = CONFIG.SITE_RADIUS_M;
                ctx.siteBuffer = CONFIG.SITE_BUFFER_M;

                if (ctx.sites.length < 3) {
                    setStatus('no_sites', true);
                    setSummary(0, 0, 0);
                    return;
                }

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
                if (ctx.triangles.length === 0) {
                    setStatus('no_triangles', true);
                    setSummary(0, 0, 0);
                    return;
                }

                var seeds = sampleTriangles(triangles, lat0);
                if (seeds.length === 0) {
                    setStatus('no_candidates', true);
                    setSummary(0, 0, 0);
                    return;
                }

                // async filtering, chunked so the UI stays responsive
                var kept = [];
                var batches = chunk(seeds, 30);
                for (var b = 0; b < batches.length; b++) {
                    var res = await Promise.all(batches[b].map(async function (seed) {
                        if (!passesMandatorySpatialFilters(seed, ctx)) return null;
                        var uat = await uatPixelAt(seed.lat, seed.lng);
                        if (uat !== true) return null; // fail closed: not confirmed inside red UAT area
                        return seed;
                    }));
                    kept = kept.concat(res.filter(function (x) { return x !== null; }));
                    if (b % 4 === 0) await yieldToUI();
                    if (myVersion !== _runVersion) { setStatus('cancelled'); return; }
                }

                var scored = kept.map(function (seed) { return scoreCandidate(seed, ctx); });
                var results = selectSeparated(scored).map(function (c) {
                    return {
                        lat: c.lat, lng: c.lng, score: c.score, factors: c.factors,
                        classification: classify(c.score)
                    };
                });

                _currentResults = results;
                render(results, ctx);

                var nHigh = 0, nMed = 0;
                results.forEach(function (r) {
                    if (r.classification === 'high') nHigh++; else nMed++;
                });

                console.log('[ArcheoPotential] ' +
                    ctx.sites.length + ' sites, ' + triangles.length + ' triangles, ' +
                    seeds.length + ' seeds, ' + kept.length + ' passed filters, ' +
                    results.length + ' candidates (' + nHigh + ' high, ' + nMed + ' medium) — ' +
                    Math.round(performance.now() - t0) + ' ms');

                if (results.length === 0) setStatus('no_candidates', true);
                else setStatus('done');
                setSummary(results.length, nHigh, nMed);
            } catch (err) {
                console.error('[ArcheoPotential] Analysis failed:', err);
                setStatus('error', true);
                setSummary(0, 0, 0);
            } finally {
                if (myVersion === _runVersion) _runInFlight = false;
                setRunning(false);
            }
        })();
    }

    function toggleArcheoPotentialLayer(on) {
        _resultsVisible = on;
        var map = window._dlMap;
        if (!map || !_layerGroup) return;
        if (on) {
            if (!map.hasLayer(_layerGroup)) _layerGroup.addTo(map);
        } else {
            if (map.hasLayer(_layerGroup)) map.removeLayer(_layerGroup);
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════
     * 10. WIRE-UP + PUBLIC API
     * ═══════════════════════════════════════════════════════════════════════ */

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
    window._archeoPotentialResults = function () { return _currentResults; };
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
        uatPixelAt: uatPixelAt,
        _uatTileZ: uatTileZ
    };
})();

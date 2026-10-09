/*
 * DetectLab — 3D globe basemap adapter
 *
 * MapLibre renders the permanent Esri World Imagery basemap with its native
 * globe projection. The small Leaflet binding keeps the existing application
 * map, controls, layer panes and country-lock contract intact; local data
 * layers continue to be geographic Leaflet overlays above the globe.
 *
 * This module intentionally does not render the country-selection gate. That
 * gate remains the canvas/d3 implementation in globe-country-picker.js so a
 * WebGL failure in the working map never prevents country selection.
 *
 * Vector overlays that must stay on the imagery (the selected-country outline
 * and highlight) are built with createProjectedPolygon(): their vertices are
 * placed with the same globe camera that draws the basemap, not with Leaflet's
 * Web Mercator, so they do not drift off the imagery when zoomed out or when
 * the globe is moved. The basemap itself is unchanged.
 */
(function (window) {
    'use strict';
    if (!window) return;

    var SOURCE_ID = 'detectlab';
    var RASTER_LAYER_ID = 'detectlab-world-imagery-raster';
    var BACKGROUND_LAYER_ID = 'detectlab-globe-background';
    var WORLD_IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    var ATTRIBUTION = 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community';
    var BACKGROUND = '#030916';

    function clampOpacity(value) {
        var opacity = Number(value);
        if (!isFinite(opacity)) return 1;
        return Math.max(0, Math.min(1, opacity));
    }

    function nativeZoom(value) {
        var zoom = Number(value);
        if (!isFinite(zoom)) return 18;
        return Math.max(1, Math.min(22, Math.round(zoom)));
    }

    function buildStyle(options) {
        options = options || {};
        var opacity = clampOpacity(options.opacity);
        var maxzoom = nativeZoom(options.maxNativeZoom);
        return {
            version: 8,
            name: 'DetectLab 3D Globe',
            metadata: {
                'detectlab:basemap': '3d-globe',
                'detectlab:imagery': 'Esri World Imagery'
            },
            projection: { type: 'globe' },
            sources: {
                detectlab: {
                    type: 'raster',
                    tiles: [options.tileUrl || WORLD_IMAGERY_URL],
                    tileSize: 256,
                    maxzoom: maxzoom,
                    attribution: ATTRIBUTION
                }
            },
            layers: [
                {
                    id: BACKGROUND_LAYER_ID,
                    type: 'background',
                    paint: { 'background-color': options.backgroundColor || BACKGROUND }
                },
                {
                    id: RASTER_LAYER_ID,
                    type: 'raster',
                    source: 'detectlab',
                    paint: {
                        'raster-opacity': opacity,
                        'raster-fade-duration': 150
                    }
                }
            ]
        };
    }

    function mapLibreReady() {
        var L = window.L;
        var maplibregl = window.maplibregl;
        if (!L || typeof L.maplibreGL !== 'function' || !maplibregl || typeof maplibregl.Map !== 'function') return false;
        // Use the library's feature test when available. On a negative result
        // the caller can still show the existing Leaflet raster fallback.
        if (typeof maplibregl.supported === 'function') {
            try { return maplibregl.supported({ failIfMajorPerformanceCaveat: false }) !== false; }
            catch (e) { return false; }
        }
        return true;
    }

    function create(leafletMap, options) {
        options = options || {};
        var L = window.L;
        if (!leafletMap || !mapLibreReady()) return null;

        var opacity = clampOpacity(options.opacity);
        var layer;
        try {
            layer = L.maplibreGL({
                style: buildStyle(options),
                pane: options.pane || 'pane_satellite',
                interactive: false,
                padding: (typeof options.padding === 'number') ? options.padding : 0.06,
                minZoom: (typeof options.minZoom === 'number') ? options.minZoom : 1,
                maxZoom: (typeof options.maxZoom === 'number') ? options.maxZoom : 22,
                renderWorldCopies: false,
                maxPitch: 0
            });
        } catch (e) {
            return null;
        }
        if (!layer || typeof layer.addTo !== 'function' || typeof layer.getMaplibreMap !== 'function') return null;

        // The adapter syncs the globe camera at most every 32 ms while the map
        // is dragged, so during a drag the basemap can trail Leaflet's panes and
        // the projected overlays. Sync on every move instead. The basemap's
        // style, projection and imagery are unchanged; only its update rate is.
        if (typeof layer.getEvents === 'function') {
            var adapterEvents = layer.getEvents;
            layer.getEvents = function () {
                var events = adapterEvents.call(this);
                events.move = this._update;
                return events;
            };
        }

        function applyOpacity(glMap) {
            if (!glMap || typeof glMap.setPaintProperty !== 'function') return false;
            try {
                if (typeof glMap.isStyleLoaded === 'function' && !glMap.isStyleLoaded()) return false;
                if (typeof glMap.getLayer === 'function' && !glMap.getLayer(RASTER_LAYER_ID)) return false;
                glMap.setPaintProperty(RASTER_LAYER_ID, 'raster-opacity', opacity);
                return true;
            } catch (e) {
                return false;
            }
        }

        function watchMap(glMap) {
            if (!glMap || layer._detectlabOpacityMap === glMap) return;
            layer._detectlabOpacityMap = glMap;
            var applyWhenReady = function () { applyOpacity(glMap); };
            if (typeof glMap.once === 'function') glMap.once('load', applyWhenReady);
            else if (typeof glMap.on === 'function') glMap.on('load', applyWhenReady);
            if (typeof glMap.isStyleLoaded === 'function' && glMap.isStyleLoaded()) applyWhenReady();
        }

        // The Leaflet adapter can be removed/re-added (for example when an
        // offline map is activated). Rebind opacity to each fresh MapLibre
        // instance created by the adapter's onAdd hook.
        var originalOnAdd = layer.onAdd;
        if (typeof originalOnAdd === 'function') {
            layer.onAdd = function (map) {
                var result = originalOnAdd.call(this, map);
                watchMap(this.getMaplibreMap());
                return result;
            };
        }

        layer.setOpacity = function (value) {
            opacity = clampOpacity(value);
            if (layer.options) layer.options.opacity = opacity;
            var glMap = layer.getMaplibreMap();
            watchMap(glMap);
            applyOpacity(glMap);
            return layer;
        };
        layer._detectlabGlobeBase = true;
        layer._detectlabGlobeSourceId = SOURCE_ID;
        layer._detectlabGlobeStyle = buildStyle(options);

        try {
            layer.addTo(leafletMap);
            watchMap(layer.getMaplibreMap());
        } catch (e) {
            // A browser without a usable WebGL context should still get the
            // existing raster fallback. Clean up a partially added GL layer
            // defensively; normal MapLibre failures happen before it is added.
            try {
                if (layer._glMap && typeof layer._glMap.remove === 'function') layer._glMap.remove();
            } catch (cleanupError) {}
            try {
                if (layer._container && layer._container.parentNode) layer._container.parentNode.removeChild(layer._container);
            } catch (cleanupError2) {}
            try {
                if (layer._leaflet_id && leafletMap._layers) delete leafletMap._layers[layer._leaflet_id];
            } catch (cleanupError3) {}
            layer._glMap = null;
            layer._map = null;
            return null;
        }
        return layer;
    }

    /* ── Vector overlays projected with the globe camera ─────────────────────
       Leaflet places vectors with Web Mercator, but the basemap is a true
       sphere. The two agree only near the view centre, so a Leaflet outline
       drifts off the imagery by tens of pixels when zoomed out, and it moves
       as the globe is panned. A projected polygon takes its screen positions
       from the same MapLibre camera that draws the globe, so it stays on the
       imagery at every zoom and view. It is still an ordinary Leaflet path in
       the caller's pane, so z-order and clipping are unchanged, and it is
       recomputed on every view change. Without a live globe it falls back to
       Leaflet's own placement. */
    var GLOBE_EDGE_STEP_DEG = 1;      // longer edges are sampled along the sphere
    var GLOBE_EDGE_MAX_STEPS = 400;
    var GLOBE_SIMPLIFY_PX = 0.25;     // largest on-screen error from simplification
    var GLOBE_MOVE_EVENTS = 'move resize';
    var globePolygonClass = null;

    function wrapLng(lng) {
        return ((lng + 540) % 360 + 360) % 360 - 180;
    }

    function unitVector(lat, lng) {
        var la = lat * Math.PI / 180;
        var lo = lng * Math.PI / 180;
        var c = Math.cos(la);
        return [c * Math.sin(lo), Math.sin(la), c * Math.cos(lo)];
    }

    // Ring of [lat, lng] pairs without the closing vertex. Long edges are
    // sampled every GLOBE_EDGE_STEP_DEG along the ring, and longitudes are
    // unwrapped so a ring that crosses the antimeridian stays continuous.
    function densifyLatLngs(latlngs) {
        var out = [];
        var n = latlngs.length;
        if (!n) return out;
        var lng = latlngs[0].lng;
        out.push([latlngs[0].lat, lng]);
        for (var k = 0; k < n; k++) {
            var a = latlngs[k];
            var b = latlngs[(k + 1) % n];
            var dLat = b.lat - a.lat;
            var dLng = wrapLng(b.lng - a.lng);
            var span = Math.max(Math.abs(dLat), Math.abs(dLng));
            var steps = Math.min(GLOBE_EDGE_MAX_STEPS, Math.max(1, Math.ceil(span / GLOBE_EDGE_STEP_DEG)));
            for (var s = 1; s <= steps; s++) {
                if (k === n - 1 && s === steps) break;   // the closing edge returns to out[0]
                var t = s / steps;
                out.push([a.lat + dLat * t, lng + dLng * t]);
            }
            lng += dLng;
        }
        return out;
    }

    // Douglas–Peucker on a closed ring of [lat, lng] pairs (unwrapped). Points
    // are dropped only when they lie within `tol` degrees of the kept outline,
    // so the simplified ring is within the on-screen tolerance at the zoom it
    // was built for. Large countries shrink a lot at the low zooms the country
    // lock uses; detailed coastlines at high zoom are kept almost whole.
    function simplifyRing(pts, tol) {
        var n = pts.length;
        if (n < 4 || !(tol > 0)) return pts;
        var line = pts.concat([pts[0]]);   // closed: the last segment returns to the start
        var keep = new Array(line.length);
        for (var k = 0; k < keep.length; k++) keep[k] = false;
        keep[0] = true;
        keep[line.length - 1] = true;
        var tol2 = tol * tol;
        var stack = [[0, line.length - 1]];
        while (stack.length) {
            var seg = stack.pop();
            var a = seg[0], b = seg[1];
            var ax = line[a][1], ay = line[a][0], bx = line[b][1], by = line[b][0];
            var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
            var maxD2 = 0, idx = -1;
            for (var i = a + 1; i < b; i++) {
                var px = line[i][1], py = line[i][0];
                var qx, qy;
                if (len2 === 0) {
                    qx = ax - px; qy = ay - py;
                } else {
                    var t = ((px - ax) * dx + (py - ay) * dy) / len2;
                    t = t < 0 ? 0 : (t > 1 ? 1 : t);
                    qx = ax + t * dx - px; qy = ay + t * dy - py;
                }
                var d2 = qx * qx + qy * qy;
                if (d2 > maxD2) { maxD2 = d2; idx = i; }
            }
            if (idx >= 0 && maxD2 > tol2) {
                keep[idx] = true;
                stack.push([a, idx], [idx, b]);
            }
        }
        var out = [];
        for (var m = 0; m < n; m++) if (keep[m]) out.push(pts[m]);
        return out;
    }

    // Tolerance for a zoom: GLOBE_SIMPLIFY_PX on screen at the top of the
    // integer zoom band. A globe degree spans worldSize/360 px at the centre
    // (worldSize = 256 · 2^zoom), which is the largest screen scale on the sphere.
    function simplifyTolerance(zoomBand) {
        return GLOBE_SIMPLIFY_PX * 360 / (256 * Math.pow(2, zoomBand + 1));
    }

    // Leaflet latlngs → the same nesting, holding densified and simplified
    // [lat, lng] rings. A flat ring is a list of LatLng; anything else is a list
    // of rings or polygons.
    function sampleLatlngs(latlngs, tol) {
        if (!latlngs.length) return [];
        if (latlngs[0] instanceof window.L.LatLng) return simplifyRing(densifyLatLngs(latlngs), tol);
        return latlngs.map(function (part) { return sampleLatlngs(part, tol); });
    }

    // Walks sampled rings, projects every vertex with the globe camera and
    // appends the rings to `result` with the matching layer-point bounds.
    function projectSamples(samples, frame, result, bounds) {
        if (!samples.length) return;
        if (!(Array.isArray(samples[0]) && typeof samples[0][0] === 'number')) {
            for (var i = 0; i < samples.length; i++) projectSamples(samples[i], frame, result, bounds);
            return;
        }
        var L = window.L;
        var ring = [];
        var v = null;
        for (var p = 0; p < samples.length; p++) {
            var lat = samples[p][0];
            var lng = wrapLng(samples[p][1]);
            v = unitVector(lat, lng);
            // Vertices on the far side of the globe fold back over the visible
            // disc under perspective projection, so they are left out. The
            // country lock keeps the selected country near the view centre, so
            // an outline does not reach the far side.
            if (v[0] * frame.centre[0] + v[1] * frame.centre[1] + v[2] * frame.centre[2] < 0) continue;
            var g = frame.gl.project([lng, lat]);
            if (!isFinite(g.x) || !isFinite(g.y)) continue;
            var pt = L.point(frame.x + g.x, frame.y + g.y);
            ring.push(pt);
            bounds.extend(pt);
        }
        if (ring.length) result.push(ring);
    }

    // Camera snapshot for one projection pass. The layer origin is the
    // container's layer position, which is also where the GL canvas is drawn,
    // so layer points match the basemap pixels.
    function globeFrame(globeLayer, map) {
        if (!globeLayer || !map || globeLayer._map !== map || typeof globeLayer.getMaplibreMap !== 'function') return null;
        var gl = globeLayer.getMaplibreMap();
        if (!gl || typeof gl.project !== 'function' || typeof gl.getCenter !== 'function') return null;
        var container = typeof globeLayer.getContainer === 'function' ? globeLayer.getContainer() : null;
        if (!container || !window.L || !window.L.DomUtil) return null;
        var origin = window.L.DomUtil.getPosition(container);
        var center = gl.getCenter();
        return { gl: gl, x: origin.x, y: origin.y, centre: unitVector(center.lat, center.lng) };
    }

    function globePolygon() {
        if (globePolygonClass) return globePolygonClass;
        var L = window.L;
        if (!L || !L.Polygon || typeof L.Polygon.extend !== 'function') return null;
        globePolygonClass = L.Polygon.extend({
            // noClip: Leaflet's own clipping assumes Mercator screen positions.
            // smoothFactor 0: Leaflet must not simplify the projected vertices.
            options: { noClip: true, smoothFactor: 0 },

            onAdd: function (map) {
                L.Polygon.prototype.onAdd.call(this, map);
                map.on(GLOBE_MOVE_EVENTS, this._onGlobeMove, this);
            },

            onRemove: function (map) {
                map.off(GLOBE_MOVE_EVENTS, this._onGlobeMove, this);
                L.Polygon.prototype.onRemove.call(this, map);
            },

            // Leaflet re-projects paths on viewreset (_reset), zoomend (_project)
            // and moveend (_update). Every path update here re-projects from the
            // current globe camera and container position, so each of those
            // passes lands on the rendered globe.
            _reset: function () {
                this._update();
            },

            _update: function () {
                if (!this._map) return;
                this._project();
                L.Polygon.prototype._update.call(this);
            },

            // Pans and resizes re-project with the camera the adapter has just
            // synced. During a zoom animation the adapter's camera and container
            // are still the old ones, so the zoom-end pass does the update.
            _onGlobeMove: function () {
                var globe = this.options.globeLayer;
                if (globe && globe._zooming) return;
                this._update();
            },

            // Sampled rings are cached per integer zoom band: the simplification
            // depends only on the zoom, and it is recomputed at most once per band.
            _samplesForZoom: function (zoom) {
                var band = Math.floor(zoom);
                if (this._globeSampleSource !== this._latlngs) {
                    this._globeSampleSource = this._latlngs;
                    this._globeSamples = {};
                }
                if (!this._globeSamples[band]) {
                    this._globeSamples[band] = sampleLatlngs(this._latlngs, simplifyTolerance(band));
                }
                return this._globeSamples[band];
            },

            _project: function () {
                this._globeFrame = globeFrame(this.options.globeLayer, this._map);
                if (!this._globeFrame) {
                    L.Polygon.prototype._project.call(this);   // no live globe: Leaflet placement
                    return;
                }
                var pxBounds = new L.Bounds();
                this._rings = [];
                projectSamples(this._samplesForZoom(this._map.getZoom()), this._globeFrame, this._rings, pxBounds);
                if (this._bounds.isValid() && pxBounds.isValid()) {
                    this._rawPxBounds = pxBounds;
                    this._updateBounds();
                }
            }
        });
        return globePolygonClass;
    }

    // Leaflet rings (lat/lng) → projected polygon. Returns null when there is
    // no globe to project with, so callers keep their Leaflet fallback.
    function createProjectedPolygon(latlngs, options) {
        var Projected = globePolygon();
        if (!Projected || !options || !options.globeLayer || !latlngs || !latlngs.length) return null;
        try { return new Projected(latlngs, options); } catch (e) { return null; }
    }

    // GeoJSON Polygon or MultiPolygon → Leaflet rings. Holes stay rings after
    // their outer ring, as Leaflet expects.
    function geoJsonToLatLngs(geometry) {
        var L = window.L;
        if (!L || !geometry || !geometry.coordinates) return null;
        function rings(list) {
            return list.filter(function (ring) { return ring && ring.length >= 3; })
                .map(function (ring) {
                    return ring.map(function (pos) { return L.latLng(pos[1], pos[0]); });
                });
        }
        if (geometry.type === 'Polygon') return rings(geometry.coordinates);
        if (geometry.type === 'MultiPolygon') {
            return geometry.coordinates.map(rings).filter(function (poly) { return poly.length > 0; });
        }
        return null;
    }

    function createProjectedFeature(feature, options) {
        var latlngs = geoJsonToLatLngs(feature && feature.geometry);
        if (!latlngs || !latlngs.length) return null;
        return createProjectedPolygon(latlngs, options);
    }

    window.DetectLabGlobeBase = {
        create: create,
        buildStyle: buildStyle,
        isSupported: mapLibreReady,
        createProjectedPolygon: createProjectedPolygon,
        createProjectedFeature: createProjectedFeature,
        constants: {
            sourceId: SOURCE_ID,
            rasterLayerId: RASTER_LAYER_ID,
            backgroundLayerId: BACKGROUND_LAYER_ID,
            imageryUrl: WORLD_IMAGERY_URL,
            attribution: ATTRIBUTION
        },
        // Internal hooks for test-globe-outline-projection.js. Not public API.
        _test: {
            wrapLng: wrapLng,
            unitVector: unitVector,
            densifyLatLngs: densifyLatLngs,
            simplifyRing: simplifyRing,
            simplifyTolerance: simplifyTolerance,
            geoJsonToLatLngs: geoJsonToLatLngs
        }
    };
})(window);

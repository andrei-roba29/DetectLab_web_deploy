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
                style: options.style || buildStyle(options),
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
        // Overlay twins (options.overlay) are not the basemap and carry no basemap flags.
        if (options.overlay) {
            layer._detectlabGlobeOverlay = true;
        } else {
            layer._detectlabGlobeBase = true;
            layer._detectlabGlobeSourceId = SOURCE_ID;
            layer._detectlabGlobeStyle = buildStyle(options);
        }

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

    /* ── Raster overlays on the globe (“globe twins”) ───────────────────────
       A Leaflet tile or WMS layer is painted on the flat Web Mercator plane, so
       it drifts off the globe basemap the same way the outline did. A twin is a
       MapLibre raster overlay built from the same tile URLs, in the same pane,
       on the same globe camera. The Leaflet layer keeps owning add/remove,
       opacity and parameters. While a twin is attached the Leaflet layer's own
       tiles are hidden and no longer requested. A layer gets a twin only when
       its URL template reproduces Leaflet's own requests at sample tiles;
       anything else stays a plain Leaflet layer. */
    var BLANK_TILE_URL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    var WEB_MERCATOR_HALF = 20037508.342789244;
    var OVERLAY_SOURCE_ID = 'detectlab-overlay';
    var TWIN_PROBES = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 11, z: 5 }, { x: 140, y: 90, z: 8 }];

    // EPSG:3857 extent of a 256-px tile in WMS BBOX order (minx, miny, maxx, maxy).
    function tileBbox3857(z, x, y) {
        var w = 2 * WEB_MERCATOR_HALF / Math.pow(2, z);
        var minX = -WEB_MERCATOR_HALF + x * w;
        var maxY = WEB_MERCATOR_HALF - y * w;
        return [minX, maxY - w, minX + w, maxY];
    }

    // Two WMS request URLs are the same when everything before BBOX matches
    // exactly and the four bbox numbers agree to a millimetre.
    function sameWmsRequest(a, b, key) {
        var ia = a.lastIndexOf(key), ib = b.lastIndexOf(key);
        if (ia < 0 || ib < 0 || a.slice(0, ia) !== b.slice(0, ib)) return false;
        var pa = a.slice(ia + key.length).split(','), pb = b.slice(ib + key.length).split(',');
        if (pa.length !== 4 || pb.length !== 4) return false;
        for (var i = 0; i < 4; i++) {
            if (!(Math.abs(+pa[i] - +pb[i]) <= 1e-3)) return false;
        }
        return true;
    }

    // Leaflet's own URL for one tile. Leaflet reads coords.scaleBy and coords.z
    // (WMS) and takes {z} from layer._tileZoom, so the probe is an L.point with
    // z, and _tileZoom is set only for the duration of the call.
    function leafletTileUrl(layer, getUrl, probe) {
        var L = window.L;
        if (!L || typeof L.point !== 'function') return null;
        var coords = L.point(probe.x, probe.y);
        coords.z = probe.z;
        var saved = layer._tileZoom;
        layer._tileZoom = probe.z;
        try {
            return getUrl.call(layer, coords);
        } finally {
            layer._tileZoom = saved;
        }
    }

    // Replaces every {x}, {y} and {z} in a template with one tile's values.
    function fillTemplate(template, p) {
        return template.split('{z}').join(String(p.z))
            .split('{x}').join(String(p.x))
            .split('{y}').join(String(p.y));
    }

    // MapLibre raster source settings that reproduce a Leaflet layer's requests,
    // or null when the layer uses anything this converter does not reproduce
    // exactly. getUrl is Leaflet's own getTileUrl, so every template is checked
    // against it at the sample tiles that Leaflet can request for this layer.
    function overlaySourceFor(layer, getUrl) {
        var opts = layer.options || {};
        var url = typeof layer._url === 'string' ? layer._url : '';
        if (!url || typeof getUrl !== 'function') return null;
        if (opts.tms || opts.zoomOffset || opts.zoomReverse || opts.minNativeZoom !== undefined) return null;
        if ((opts.tileSize || 256) !== 256) return null;
        if (/\{(q|-y|r)\}/.test(url)) return null;
        var native = typeof opts.maxNativeZoom === 'number' ? opts.maxNativeZoom : null;
        var cap = typeof opts.maxZoom === 'number' ? opts.maxZoom : null;
        var sourceMax = native !== null ? native : (cap !== null ? cap : 22);
        var probes = TWIN_PROBES.filter(function (p) { return p.z <= sourceMax; });
        if (!probes.length) return null;
        var tiles;
        if (layer.wmsParams) {
            if (/\{(s|z|x|y)\}/.test(url) || !layer._crs || layer._crs.code !== 'EPSG:3857' || !layer._map) return null;
            var key = opts.uppercase ? 'BBOX=' : 'bbox=';
            var first = leafletTileUrl(layer, getUrl, probes[0]);
            if (typeof first !== 'string' || first.lastIndexOf(key) < 0) return null;
            var template = first.slice(0, first.lastIndexOf(key) + key.length) + '{bbox-epsg-3857}';
            for (var w = 0; w < probes.length; w++) {
                var wp = probes[w];
                var expectedWms = leafletTileUrl(layer, getUrl, wp);
                var bbox = tileBbox3857(wp.z, wp.x, wp.y).join(',');
                if (typeof expectedWms !== 'string' ||
                    !sameWmsRequest(expectedWms, template.replace('{bbox-epsg-3857}', bbox), key)) return null;
            }
            tiles = [template];
        } else {
            var subs = opts.subdomains;
            subs = typeof subs === 'string' ? subs.split('') : (Array.isArray(subs) ? subs : []);
            if (/\{s\}/.test(url) && !subs.length) return null;
            tiles = /\{s\}/.test(url) ? subs.map(function (s) { return url.replace('{s}', s); }) : [url];
            for (var k = 0; k < probes.length; k++) {
                var q = probes[k];
                var expected = leafletTileUrl(layer, getUrl, q);
                if (typeof expected !== 'string') return null;
                var found = tiles.some(function (t) { return fillTemplate(t, q) === expected; });
                if (!found) return null;
            }
        }
        return {
            tiles: tiles, tileSize: 256, wms: !!layer.wmsParams,
            sourceMinzoom: 0, sourceMaxzoom: sourceMax,
            // Leaflet shows the layer while Math.round(zoom) is inside
            // [minZoom, maxZoom] (GridLayer._setView). null means no limit.
            minZoom: typeof opts.minZoom === 'number' ? opts.minZoom : null,
            maxZoom: cap
        };
    }

    function overlayStyle(source, opacity) {
        var sources = {};
        sources[OVERLAY_SOURCE_ID] = {
            type: 'raster', tiles: source.tiles, tileSize: source.tileSize,
            minzoom: source.sourceMinzoom, maxzoom: source.sourceMaxzoom
        };
        var rasterLayer = {
            id: RASTER_LAYER_ID, type: 'raster', source: OVERLAY_SOURCE_ID,
            paint: { 'raster-opacity': clampOpacity(opacity) }
        };
        // The adapter drives the globe camera at Leaflet's zoom minus 1 (its
        // 512-px world against Leaflet's 256-px tiles), and style-layer limits are
        // in camera zoom. Leaflet shows the layer while Math.round(zoom) is inside
        // [minZoom, maxZoom], which is camera zoom in [minZoom - 1.5, maxZoom - 0.5).
        if (source.minZoom !== null) rasterLayer.minzoom = Math.max(0, source.minZoom - 1.5);
        if (source.maxZoom !== null) rasterLayer.maxzoom = Math.max(0, source.maxZoom - 0.5);
        return { version: 8, projection: { type: 'globe' }, sources: sources, layers: [rasterLayer] };
    }

    // Gives a Leaflet tile/WMS layer a globe twin in its own pane. Returns true
    // when the hooks are installed; the twin itself is only attached while the
    // layer is on a map and its URLs convert exactly, otherwise the layer keeps
    // Leaflet's own tiles.
    function attachTileTwin(tileLayer) {
        if (!tileLayer || tileLayer._detectlabTwin || !tileLayer.options) return false;
        if (typeof tileLayer.getTileUrl !== 'function' || typeof tileLayer.onAdd !== 'function') return false;
        var twin = {
            glLayer: null, map: null,
            opacity: typeof tileLayer.options.opacity === 'number' ? tileLayer.options.opacity : 1
        };
        tileLayer._detectlabTwin = twin;
        var getUrl = tileLayer.getTileUrl;
        var onAddOriginal = tileLayer.onAdd;
        var onRemoveOriginal = tileLayer.onRemove;
        var setOpacityOriginal = tileLayer.setOpacity;
        var redrawOriginal = tileLayer.redraw;

        function containerOf() {
            return typeof tileLayer.getContainer === 'function' ? tileLayer.getContainer() : null;
        }
        function release() {
            if (twin.glLayer && twin.map) {
                try { twin.map.removeLayer(twin.glLayer); } catch (e) {}
            }
            twin.glLayer = null;
            twin.map = null;
            delete tileLayer.getTileUrl;             // back to Leaflet's own URL building
            var container = containerOf();
            if (container) container.style.display = '';
        }
        function engage(map) {
            release();
            var glLayer = null;
            try {
                var source = overlaySourceFor(tileLayer, getUrl);
                if (source) {
                    glLayer = create(map, {
                        pane: tileLayer.options.pane || 'tilePane',
                        style: overlayStyle(source, twin.opacity),
                        opacity: twin.opacity,
                        overlay: true
                    });
                }
            } catch (e) {
                glLayer = null;   // any surprise keeps Leaflet's own tiles
            }
            if (!glLayer) return false;
            twin.glLayer = glLayer;
            twin.map = map;
            tileLayer.getTileUrl = function () { return BLANK_TILE_URL; };
            var container = containerOf();
            if (container) container.style.display = 'none';
            return true;
        }
        function engageOrFallBack(map) {
            if (engage(map)) return;
            delete tileLayer.getTileUrl;             // no twin: Leaflet draws its own tiles
            redrawOriginal.call(tileLayer);
        }

        tileLayer.onAdd = function (map) {
            tileLayer.getTileUrl = function () { return BLANK_TILE_URL; };   // no early requests
            var result = onAddOriginal.call(this, map);
            engageOrFallBack(map);
            return result;
        };
        tileLayer.onRemove = function (map) {
            release();
            return onRemoveOriginal.call(this, map);
        };
        tileLayer.setOpacity = function (value) {
            var result = setOpacityOriginal.call(this, value);
            twin.opacity = typeof this.options.opacity === 'number' ? this.options.opacity : twin.opacity;
            if (twin.glLayer) twin.glLayer.setOpacity(twin.opacity);
            return result;
        };
        tileLayer.redraw = function () {
            var result = redrawOriginal.call(this);
            if (this._map && this._map.hasLayer(this)) engageOrFallBack(this._map);   // URL or params changed
            return result;
        };
        if (tileLayer._map) {
            tileLayer.getTileUrl = function () { return BLANK_TILE_URL; };
            engageOrFallBack(tileLayer._map);
        }
        return true;
    }

    window.DetectLabGlobeBase = {
        create: create,
        buildStyle: buildStyle,
        isSupported: mapLibreReady,
        createProjectedPolygon: createProjectedPolygon,
        createProjectedFeature: createProjectedFeature,
        attachTileTwin: attachTileTwin,
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
            tileBbox3857: tileBbox3857,
            sameWmsRequest: sameWmsRequest,
            overlaySourceFor: overlaySourceFor,
            simplifyTolerance: simplifyTolerance,
            geoJsonToLatLngs: geoJsonToLatLngs
        }
    };
})(window);

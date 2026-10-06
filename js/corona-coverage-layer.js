/*
 * corona-coverage-layer.js
 * ───────────────────────────────────────────────────────────────────────────
 * "Satellite imagery 60's" — COVERAGE OUTLINES.
 *
 * The CORONA archive published by CAST (corona.cast.uark.edu) does not cover
 * Europe uniformly: it is a set of satellite passes flown between 1963 and
 * 1972, so the imagery exists only inside long, narrow, strongly rotated
 * strips. Outside them the layer is legitimately empty — which, without a
 * hint on the map, reads as "the layer is broken".
 *
 * This module draws the union of those footprints (the KML exported from the
 * coverage shapefile) as outlines, so a user can see at a glance where the
 * 1960s imagery actually exists before zooming in.
 *
 * Source (CORS-enabled, cached by the CDN):
 *   https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/corona2.kml
 * Override with  window.CORONA_COVERAGE_KML_URL  before this script runs.
 *
 * Design notes
 *   • lazy: nothing is downloaded until the outlines are first shown;
 *   • the KML is a world-wide multipolygon — only the rings intersecting the
 *     configured bbox (Europe by default) are kept;
 *   • the shapefile was buffered, so every corner carries ~16 near-identical
 *     vertices; they are collapsed with a cheap distance filter, which cuts
 *     the vertex count by ~60% with no visible difference;
 *   • drawn on a canvas renderer in its own pane, non-interactive except for
 *     a tooltip, so it never steals clicks from the map tools.
 *
 * Exposes:
 *   window.CoronaCoverage.load()            → Promise<GeoJSON-like rings>
 *   window.CoronaCoverage.show(map)         → Promise<L.LayerGroup>
 *   window.CoronaCoverage.hide()
 *   window.CoronaCoverage.isVisible()
 *   window.CoronaCoverage.parseKml(text, bbox)   (pure, used by the tests)
 */
(function (root) {
    'use strict';

    var L = root.L;
    if (!L) {
        console.error('[CoronaCoverage] Leaflet is not loaded — corona-coverage-layer.js must load after leaflet.js');
        return;
    }

    var DEFAULT_KML_URL = 'https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/corona2.kml';

    // Same window as the imagery catalogue (js/corona-wms-layer.js).
    var DEFAULT_BBOX = (root.CoronaAtlas && root.CoronaAtlas.EUROPE_BBOX) || [-25, 34, 60, 72];

    // Collapse vertices closer than this (degrees ≈ 110 m) — the buffered
    // corners of the source shapefile.
    var SIMPLIFY_EPS = 0.001;

    var STYLE = {
        color: '#ffc832',
        weight: 1.2,
        opacity: 0.95,
        fillColor: '#ffc832',
        fillOpacity: 0.07,
        interactive: false
    };

    function bboxIntersects(a, b) {
        return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
    }

    /**
     * KML → array of rings ([[lon,lat], …]) clipped to `bbox`.
     * Pure string/DOM work, no Leaflet — the test calls it directly.
     */
    function parseKml(text, bbox) {
        bbox = bbox || DEFAULT_BBOX;
        var rings = [];
        if (!text) return rings;

        // <coordinates> blocks are all we need: every Polygon /
        // LinearRing / MultiGeometry member carries exactly one.
        var re = /<coordinates[^>]*>([\s\S]*?)<\/coordinates>/gi;
        var match;
        while ((match = re.exec(text)) !== null) {
            var ring = parseCoordinateBlock(match[1]);
            if (ring.length < 4) continue;
            var ringBbox = ringBounds(ring);
            if (!bboxIntersects(ringBbox, bbox)) continue;
            rings.push(simplifyRing(ring));
        }
        return rings;
    }

    function parseCoordinateBlock(block) {
        var out = [];
        var tokens = String(block).split(/\s+/);
        for (var i = 0; i < tokens.length; i++) {
            var token = tokens[i];
            if (!token) continue;
            var parts = token.split(',');
            if (parts.length < 2) continue;
            var lon = parseFloat(parts[0]);
            var lat = parseFloat(parts[1]);
            if (isNaN(lon) || isNaN(lat)) continue;
            // The source wraps slightly past the antimeridian (±180.01).
            if (lon < -180) lon = -180;
            if (lon > 180) lon = 180;
            out.push([lon, lat]);
        }
        return out;
    }

    function ringBounds(ring) {
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var i = 0; i < ring.length; i++) {
            var x = ring[i][0], y = ring[i][1];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        return [minX, minY, maxX, maxY];
    }

    function simplifyRing(ring) {
        var out = [ring[0]];
        var last = ring[0];
        for (var i = 1; i < ring.length - 1; i++) {
            var point = ring[i];
            if (Math.abs(point[0] - last[0]) < SIMPLIFY_EPS &&
                Math.abs(point[1] - last[1]) < SIMPLIFY_EPS) continue;
            out.push(point);
            last = point;
        }
        out.push(ring[ring.length - 1]);
        return out.length >= 4 ? out : ring;
    }

    /* ── Leaflet plumbing ─────────────────────────────────────────────────── */

    var _rings = null;
    var _promise = null;
    var _layer = null;
    var _map = null;
    var _renderer = null;

    function kmlUrl() {
        return root.CORONA_COVERAGE_KML_URL || DEFAULT_KML_URL;
    }

    function load(options) {
        options = options || {};
        if (_rings && !options.force) return Promise.resolve(_rings);
        if (_promise && !options.force) return _promise;

        var url = options.url || kmlUrl();
        _promise = fetch(url, { credentials: 'omit' })
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.text();
            })
            .then(function (text) {
                _rings = parseKml(text, options.bbox || DEFAULT_BBOX);
                console.info('[Corona] coverage outlines: ' + _rings.length + ' footprints');
                return _rings;
            })['catch'](function (err) {
                console.warn('[Corona] coverage outlines unavailable: ' + (err && err.message));
                _promise = null;
                _rings = [];
                return _rings;
            });

        return _promise;
    }

    function buildLayer(map, rings) {
        if (!map.getPane('pane_corona_coverage')) {
            map.createPane('pane_corona_coverage');
            // Above the Corona imagery pane (648), below markers.
            map.getPane('pane_corona_coverage').style.zIndex = 649;
            map.getPane('pane_corona_coverage').style.pointerEvents = 'none';
        }
        if (!_renderer) {
            // Canvas: thousands of vertices as SVG paths would stall mobile.
            _renderer = L.canvas({ pane: 'pane_corona_coverage', padding: 0.25 });
        }

        var polygons = [];
        for (var i = 0; i < rings.length; i++) {
            var latlngs = [];
            for (var j = 0; j < rings[i].length; j++) {
                latlngs.push([rings[i][j][1], rings[i][j][0]]);
            }
            polygons.push(L.polygon(latlngs, L.extend({
                pane: 'pane_corona_coverage',
                renderer: _renderer
            }, STYLE)));
        }
        return L.layerGroup(polygons);
    }

    function show(map, options) {
        _map = map || _map;
        if (!_map) return Promise.resolve(null);
        return load(options).then(function (rings) {
            if (!rings || !rings.length) return null;
            if (!_layer) _layer = buildLayer(_map, rings);
            if (!_map.hasLayer(_layer)) _layer.addTo(_map);
            return _layer;
        });
    }

    function hide() {
        if (_layer && _map && _map.hasLayer(_layer)) _map.removeLayer(_layer);
    }

    function isVisible() {
        return !!(_layer && _map && _map.hasLayer(_layer));
    }

    root.CoronaCoverage = {
        DEFAULT_KML_URL: DEFAULT_KML_URL,
        STYLE: STYLE,
        parseKml: parseKml,
        simplifyRing: simplifyRing,
        load: load,
        show: show,
        hide: hide,
        isVisible: isVisible,
        getLayer: function () { return _layer; },
        getRings: function () { return _rings; }
    };

})(window);

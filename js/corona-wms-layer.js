/*
 * corona-wms-layer.js
 * ───────────────────────────────────────────────────────────────────────────
 * CORONA ("Satellite imagery 60's") tile layer for DetectLab — a faithful
 * replica of how the original Corona Atlas website
 * (https://corona.cast.uark.edu/atlas) fetches its tiles.
 *
 * How the original fetches tiles (verified against its live network traffic,
 * captured by the Internet Archive on 2020-04-29 and 2019-10-28 — see
 * SATELLITE_60s_FIX.md for the exact captured URLs):
 *
 *   Endpoint : https://geoserve.cast.uark.edu/geoserver/gwc/service/wms
 *              (GeoWebCache WMS-C tile cache, workspace "corona")
 *   Request  : WMS 1.1.1 GetMap, ONE Corona layer per request
 *   Params   : SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap
 *              &FORMAT=image%2Fpng&TRANSPARENT=true
 *              &LAYERS=corona:<pass-or-frame>&tiled=true
 *              &WIDTH=256&HEIGHT=256&SRS=EPSG%3A900913&STYLES=
 *              &BBOX=<minx>,<miny>,<maxx>,<maxy>
 *   Grid     : standard Web-Mercator XYZ tile grid; BBOX in EPSG:900913
 *              metres, aligned to 256×256 tiles (the exact tile grid
 *              GeoWebCache's EPSG:900913 gridset is built on).
 *   Behaviour: the layer is a plain map tile layer — when visible it asks
 *              the browser to load the tiles covering the viewport at the
 *              current zoom, exactly like any basemap. There is NO manual
 *              "load here" button, NO client-side request queue, NO
 *              IndexedDB cache: each tile is a direct GET <img> request
 *              (browser/HTTP caching only), same as the original.
 *
 * Two granularities are used, exactly like the original atlas:
 *   • pass mosaics  ("corona:1103-2139Fore" / "…Aft") — coarse level;
 *   • frame layers  ("corona:1105-2235df064" / "…da###") — full-res level.
 * Each Corona layer is its OWN tile layer instance so every request carries
 * a single LAYERS= value (GeoWebCache cannot combine layers dynamically).
 *
 * Leaflet must be loaded BEFORE this file. It exposes:
 *     window.coronaWmsTileUrl(baseUrl, layerName, z, x, y)  → exact request URL
 *     window.CoronaWmsLayer                                  → L.TileLayer.WMS subclass
 *     window.createCoronaWmsLayer(url, options)              → factory
 */
(function (root) {
    'use strict';

    if (!root.L) {
        console.error('[CoronaWms] Leaflet is not loaded — corona-wms-layer.js must load after leaflet.js');
        return;
    }
    var L = root.L;

    /* ───────────────────────────────────────────────────────────────────────
     * Web-Mercator / EPSG:900913 tile-grid math (the standard XYZ grid that
     * GeoWebCache's EPSG:900913 gridset uses: 256×256 tiles, world extent
     * ±20037508.342789244 m, origin top-left at zoom 0).
     * ───────────────────────────────────────────────────────────────────── */
    var WM_ORIGIN = 20037508.342789244; // half the EPSG:900913 world extent

    function tileToBbox900913(z, x, y) {
        var tileSize = (WM_ORIGIN * 2) / Math.pow(2, z); // metres per 256 px tile
        var minX = -WM_ORIGIN + x * tileSize;
        var maxX = minX + tileSize;
        var maxY = WM_ORIGIN - y * tileSize;
        var minY = maxY - tileSize;
        // 6 decimals of a metre (~1 µm) — far beyond GeoWebCache's cache-key
        // tolerance, and it keeps the URLs as tidy as the original's.
        return [minX.toFixed(6), minY.toFixed(6), maxX.toFixed(6), maxY.toFixed(6)].join(',');
    }

    /* ───────────────────────────────────────────────────────────────────────
     * The EXACT WMS-C request URL the original Corona Atlas sends, byte for
     * byte in parameter name/order/encoding. Example captured from the
     * original site (z15 tile x=19312 y=13536, layer corona:1105-2235df021):
     *
     *   https://geoserve.cast.uark.edu/geoserver/gwc/service/wms
     *   ?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image%2Fpng
     *   &TRANSPARENT=true&LAYERS=corona%3A1105-2235df021&tiled=true
     *   &WIDTH=256&HEIGHT=256&SRS=EPSG%3A900913&STYLES=
     *   &BBOX=3580921.899662502%2C3481859.511022657%2C3582144.892114846%2C3483082.503475001
     * ───────────────────────────────────────────────────────────────────── */
    function buildWmsUrl(base, layerName, z, x, y) {
        return base
            + '?SERVICE=WMS'
            + '&VERSION=1.1.1'
            + '&REQUEST=GetMap'
            + '&FORMAT=image%2Fpng'
            + '&TRANSPARENT=true'
            + '&LAYERS=' + encodeURIComponent(layerName)
            + '&tiled=true'
            + '&WIDTH=256'
            + '&HEIGHT=256'
            + '&SRS=EPSG%3A900913'
            + '&STYLES='
            + '&BBOX=' + encodeURIComponent(tileToBbox900913(z, x, y));
    }

    /* ───────────────────────────────────────────────────────────────────────
     * The tile layer. One instance per Corona layer (pass mosaic or frame),
     * so each tile request carries exactly one LAYERS= value — the same way
     * the original atlas issues its requests.
     *
     * We build on L.TileLayer.WMS only for the standard tile lifecycle
     * (createTile / _removeTile / redraw / loading events); getTileUrl() is
     * overridden to emit the original's exact URL (Leaflet's own WMS params
     * would use lowercase names and SRS=EPSG:3857 — the original sends
     * uppercase names and SRS=EPSG:900913, which GeoWebCache's EPSG:900913
     * gridset is keyed on).
     * ───────────────────────────────────────────────────────────────────── */
    var CoronaWmsLayer = L.TileLayer.WMS.extend({

        initialize: function (url, options) {
            options = L.extend({
                format: 'image/png',
                transparent: true,
                version: '1.1.1',
                tileSize: 256,
                maxNativeZoom: 15,   // server pyramids end at z15 (verified)
                // Zoom gating is opt-in per layer (passes vs frames). Below
                // minZoom Leaflet creates no tile element and fires no
                // request; above maxZoom nothing is requested either.
                minZoom: 0,
                maxZoom: 20
            }, options || {});

            this._coronaLayer = options.layers || options.coronaLayer || 'corona';
            this._coronaBaseUrl = url;

            L.TileLayer.WMS.prototype.initialize.call(this, url, options);
        },

        // The ONLY thing that differs from a normal basemap: the URL format.
        getTileUrl: function (coords) {
            return buildWmsUrl(this._coronaBaseUrl, this._coronaLayer, coords.z, coords.x, coords.y);
        },

        getCoronaLayerName: function () {
            return this._coronaLayer;
        }
    });

    /* ───────────────────────────────────────────────────────────────────────
     * Exports
     * ───────────────────────────────────────────────────────────────────── */
    root.coronaWmsTileUrl = buildWmsUrl;          // pure helper (also used by tests)
    root.CoronaWmsLayer = CoronaWmsLayer;
    root.createCoronaWmsLayer = function (url, options) {
        return new CoronaWmsLayer(url, options);
    };

})(window);

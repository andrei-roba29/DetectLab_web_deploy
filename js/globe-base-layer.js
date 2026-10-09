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

    window.DetectLabGlobeBase = {
        create: create,
        buildStyle: buildStyle,
        isSupported: mapLibreReady,
        constants: {
            sourceId: SOURCE_ID,
            rasterLayerId: RASTER_LAYER_ID,
            backgroundLayerId: BACKGROUND_LAYER_ID,
            imageryUrl: WORLD_IMAGERY_URL,
            attribution: ATTRIBUTION
        }
    };
})(window);

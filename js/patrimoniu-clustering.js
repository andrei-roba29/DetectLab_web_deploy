/*
 * DetectLab — small, dependency-free spatial helpers for the Patrimoniu layer.
 *
 * The map contains considerably more heritage features than can be usefully
 * painted one by one at country scale.  This module keeps the clustering math
 * separate from Leaflet so it can be used for both the site pins and their
 * protection-radius preview without creating one DOM node per feature.
 *
 * Distances are deliberately expressed in metres, rather than pixels.  A
 * pixel-radius cluster changes size with the map viewport and does not mean
 * the same thing at different latitudes.  The equirectangular projection below
 * is accurate enough for the short (maximum 5 km) distances used here and
 * avoids a trigonometric distance calculation for every neighbouring point.
 */
(function (root) {
    'use strict';

    var EARTH_RADIUS_M = 6371008.8;
    var REFERENCE_LAT = 46.2; // central Romania; keeps east/west distances local
    var COS_REFERENCE_LAT = Math.cos(REFERENCE_LAT * Math.PI / 180);

    var CONFIG = {
        // Clustering starts at the first level at which the whole map can be
        // explored comfortably.  `disableClusteringAtZoom` follows Leaflet's
        // convention: at z11 and above every site is an individual pin.
        minZoom: 6,
        disableClusteringAtZoom: 11,
        distanceKmByZoom: {
            6: 5,
            7: 4,
            8: 3,
            9: 2,
            10: 1
        },
        defaultDistanceKm: 5,
        indexCellSizeM: 2500
    };

    var _batchId = 0;

    function clampLat(lat) {
        return Math.max(-89.5, Math.min(89.5, Number(lat) || 0));
    }

    // Local metric coordinates.  At the scale of one cluster this differs from
    // a geodesic distance by much less than the precision of the source data.
    function project(lat, lng) {
        lat = clampLat(lat);
        return {
            x: EARTH_RADIUS_M * (Number(lng) || 0) * Math.PI / 180 * COS_REFERENCE_LAT,
            y: EARTH_RADIUS_M * lat * Math.PI / 180
        };
    }

    function unproject(x, y) {
        return {
            lat: y / EARTH_RADIUS_M * 180 / Math.PI,
            lng: x / (EARTH_RADIUS_M * COS_REFERENCE_LAT) * 180 / Math.PI
        };
    }

    function recordLat(record) {
        if (record.latlng) return Number(record.latlng.lat);
        return Number(record.lat);
    }

    function recordLng(record) {
        if (record.latlng) return Number(record.latlng.lng);
        return Number(record.lng);
    }

    function ensureProjected(record) {
        if (!record || !isFinite(record._clusterX) || !isFinite(record._clusterY)) {
            var p = project(recordLat(record), recordLng(record));
            record._clusterX = p.x;
            record._clusterY = p.y;
        }
        return record;
    }

    /**
     * Return the physical grouping distance for a map zoom.
     *
     * z6 = 5 km, z7 = 4 km, ... z10 = 1 km; z11+ = no grouping.  Fractional
     * zooms use the lower integer level while Leaflet is animating, which keeps
     * the grouping stable until the zoom finishes.
     */
    function getDistanceKm(zoom, config) {
        config = config || CONFIG;
        var level = Math.floor(Number(zoom));
        if (!isFinite(level)) level = config.minZoom;
        if (level >= config.disableClusteringAtZoom) return 0;

        var table = config.distanceKmByZoom || {};
        if (Object.prototype.hasOwnProperty.call(table, level)) return Number(table[level]) || 0;
        if (level <= config.minZoom) return Number(config.defaultDistanceKm) || 0;

        // Safe interpolation for a caller that asks for a level between the
        // configured steps: it never gets denser than the nearest configured
        // zoom and never accidentally turns clustering back on at z11.
        var highest = Number(config.defaultDistanceKm) || 0;
        var highestLevel = -Infinity;
        for (var key in table) {
            var keyLevel = Number(key);
            if (keyLevel <= level && keyLevel > highestLevel) {
                highestLevel = keyLevel;
                highest = Number(table[key]) || highest;
            }
        }
        return Math.max(0, highest);
    }

    /** A tiny projected-metre grid used only as a candidate culling index. */
    function SpatialIndex(cellSizeM) {
        this.cellSizeM = Number(cellSizeM) > 0 ? Number(cellSizeM) : CONFIG.indexCellSizeM;
        this.cells = Object.create(null);
        this.records = [];
    }

    SpatialIndex.prototype._key = function (cx, cy) {
        return cx + ':' + cy;
    };

    SpatialIndex.prototype._cell = function (x) {
        return Math.floor(x / this.cellSizeM);
    };

    SpatialIndex.prototype.add = function (record) {
        if (!record) return record;
        ensureProjected(record);
        var cx = this._cell(record._clusterX);
        var cy = this._cell(record._clusterY);
        var key = this._key(cx, cy);
        var bucket = this.cells[key];
        if (!bucket) bucket = this.cells[key] = [];
        bucket.push(record);
        this.records.push(record);
        record._clusterCellKey = key;
        return record;
    };

    SpatialIndex.prototype.clear = function () {
        this.cells = Object.create(null);
        this.records.length = 0;
    };

    SpatialIndex.prototype.queryBBox = function (minX, minY, maxX, maxY) {
        var minCX = this._cell(minX), maxCX = this._cell(maxX);
        var minCY = this._cell(minY), maxCY = this._cell(maxY);
        var cellCount = (maxCX - minCX + 1) * (maxCY - minCY + 1);
        // At country scale walking every empty grid cell costs more than a
        // single linear pass through the populated records.
        if (cellCount > 4096) {
            return this.records.filter(function (record) {
                return record._clusterX >= minX && record._clusterX <= maxX &&
                    record._clusterY >= minY && record._clusterY <= maxY;
            });
        }
        var result = [];
        for (var cy = minCY; cy <= maxCY; cy++) {
            for (var cx = minCX; cx <= maxCX; cx++) {
                var bucket = this.cells[this._key(cx, cy)];
                if (!bucket) continue;
                for (var i = 0; i < bucket.length; i++) {
                    var record = bucket[i];
                    if (record._clusterX >= minX && record._clusterX <= maxX &&
                        record._clusterY >= minY && record._clusterY <= maxY) {
                        result.push(record);
                    }
                }
            }
        }
        return result;
    };

    SpatialIndex.prototype.queryRadius = function (x, y, radiusM) {
        var result = [];
        var minCX = this._cell(x - radiusM), maxCX = this._cell(x + radiusM);
        var minCY = this._cell(y - radiusM), maxCY = this._cell(y + radiusM);
        var radius2 = radiusM * radiusM;
        for (var cy = minCY; cy <= maxCY; cy++) {
            for (var cx = minCX; cx <= maxCX; cx++) {
                var bucket = this.cells[this._key(cx, cy)];
                if (!bucket) continue;
                for (var i = 0; i < bucket.length; i++) {
                    var record = bucket[i];
                    var dx = record._clusterX - x;
                    var dy = record._clusterY - y;
                    if (dx * dx + dy * dy <= radius2) result.push(record);
                }
            }
        }
        return result;
    };

    function makeCluster(members) {
        var sx = 0, sy = 0;
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var i = 0; i < members.length; i++) {
            var member = ensureProjected(members[i]);
            sx += member._clusterX;
            sy += member._clusterY;
            minX = Math.min(minX, member._clusterX);
            minY = Math.min(minY, member._clusterY);
            maxX = Math.max(maxX, member._clusterX);
            maxY = Math.max(maxY, member._clusterY);
        }
        var centre = unproject(sx / members.length, sy / members.length);
        return {
            isCluster: members.length > 1,
            count: members.length,
            members: members,
            lat: centre.lat,
            lng: centre.lng,
            latlng: centre,
            x: sx / members.length,
            y: sy / members.length,
            minX: minX,
            minY: minY,
            maxX: maxX,
            maxY: maxY
        };
    }

    /**
     * Cluster records using connected components in the projected metre grid.
     * The input should already be limited to the current viewport plus one
     * grouping radius.  `index` may be a global index; a batch marker prevents
     * neighbours outside that input window from being pulled into a cluster.
     */
    function clusterRecords(records, zoom, index, config) {
        config = config || CONFIG;
        records = Array.isArray(records) ? records : [];
        if (!records.length) return [];

        var distanceM = getDistanceKm(zoom, config) * 1000;
        if (distanceM <= 0) {
            return records.map(function (record) {
                ensureProjected(record);
                return makeCluster([record]);
            });
        }

        var localIndex = index;
        if (!localIndex) {
            localIndex = new SpatialIndex(config.indexCellSizeM);
            records.forEach(function (record) { localIndex.add(record); });
        }

        var batch = ++_batchId;
        for (var i = 0; i < records.length; i++) {
            ensureProjected(records[i]);
            records[i]._clusterBatch = batch;
        }

        var out = [];
        var distance2 = distanceM * distanceM;
        for (var seedIndex = 0; seedIndex < records.length; seedIndex++) {
            var seed = records[seedIndex];
            if (seed._clusterVisited === batch) continue;

            var members = [];
            var queue = [seed];
            seed._clusterVisited = batch;

            for (var qi = 0; qi < queue.length; qi++) {
                var current = queue[qi];
                members.push(current);
                var near = localIndex.queryRadius(current._clusterX, current._clusterY, distanceM);
                for (var ni = 0; ni < near.length; ni++) {
                    var candidate = near[ni];
                    if (candidate._clusterBatch !== batch || candidate._clusterVisited === batch) continue;
                    var dx = candidate._clusterX - current._clusterX;
                    var dy = candidate._clusterY - current._clusterY;
                    if (dx * dx + dy * dy <= distance2) {
                        candidate._clusterVisited = batch;
                        queue.push(candidate);
                    }
                }
            }
            out.push(makeCluster(members));
        }
        return out;
    }

    root.DetectLabPatrimoniuClustering = {
        CONFIG: CONFIG,
        SpatialIndex: SpatialIndex,
        project: project,
        unproject: unproject,
        getDistanceKm: getDistanceKm,
        clusterRecords: clusterRecords
    };
}(typeof window !== 'undefined' ? window : this));

/* Geographic helpers for the LIDAR Scanner.
 *
 * Scanner CSV files normally use WGS 84 / EPSG:4326 latitude and longitude.
 * Legacy EPSG:4936 geocentric X/Y/Z rows are still accepted and converted once
 * while the file is loaded. scan() only works with the normalized lat/lon
 * properties thereafter.
 */
(function (root) {
    'use strict';

    var A = 6378137;
    var F = 1 / 298.257222101;
    var B = A * (1 - F);
    var E2 = F * (2 - F);
    var EP2 = E2 / (1 - E2);
    var EARTH_RADIUS_M = 6371008.8;

    function number(value) {
        if (typeof value === 'number') return value;
        return parseFloat(String(value == null ? '' : value).trim().replace(',', '.'));
    }

    function normalizedKey(value) {
        var key = String(value == null ? '' : value).trim().toLowerCase();
        if (key.normalize) key = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return key;
    }

    function findKey(row, accepted) {
        var keys = Object.keys(row || {});
        for (var i = 0; i < keys.length; i++) {
            if (accepted.indexOf(normalizedKey(keys[i])) !== -1) return keys[i];
        }
        return null;
    }

    function looks_like_ecef(rows, x, y, z) {
        var magnitudes = (rows || []).map(function (row) {
            var xv = number(row[x]);
            var yv = number(row[y]);
            var zv = number(row[z]);
            return Math.sqrt(xv * xv + yv * yv + zv * zv);
        }).filter(function (magnitude) {
            return isFinite(magnitude);
        }).sort(function (a, b) {
            return a - b;
        });

        return !!magnitudes.length && magnitudes[Math.floor(magnitudes.length / 2)] > 6000000;
    }

    function ecefToLlh(x, y, z) {
        var p = Math.sqrt(x * x + y * y);
        var lon = Math.atan2(y, x);
        var theta = Math.atan2(z * A, p * B);
        var st = Math.sin(theta);
        var ct = Math.cos(theta);
        var lat = Math.atan2(z + (EP2 * B) * st * st * st, p - E2 * A * ct * ct * ct);
        var sl = Math.sin(lat);
        var n = A / Math.sqrt(1 - E2 * sl * sl);
        var h = p / Math.cos(lat) - n;
        return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI, height_m: h };
    }

    function load_points(rows, x, y, z) {
        x = x || 'X';
        y = y || 'Y';
        z = z || 'Z';

        if (!Array.isArray(rows) || !rows.length) {
            throw new Error('CSV contains no point rows');
        }

        var points = [];
        var sawGeographicColumns = false;
        var sawEcefColumns = false;
        var sawSmallEcefValues = false;

        rows.forEach(function (row) {
            var latKey = findKey(row, ['lat', 'latitude', 'latitudine']);
            var lonKey = findKey(row, ['lon', 'lng', 'longitude', 'longitudine']);

            if (latKey && lonKey) {
                sawGeographicColumns = true;
                var lat = number(row[latKey]);
                var lon = number(row[lonKey]);
                if (isFinite(lat) && isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
                    row.lat = lat;
                    row.lon = lon;
                    // Leaflet names longitude `lng`; retain both names so the
                    // scanner can pass records directly to Leaflet helpers.
                    row.lng = lon;
                    points.push(row);
                    return;
                }
            }

            if (Object.prototype.hasOwnProperty.call(row, x) &&
                Object.prototype.hasOwnProperty.call(row, y) &&
                Object.prototype.hasOwnProperty.call(row, z)) {
                sawEcefColumns = true;
                var xv = number(row[x]);
                var yv = number(row[y]);
                var zv = number(row[z]);
                var magnitude = Math.sqrt(xv * xv + yv * yv + zv * zv);

                if (isFinite(magnitude) && magnitude > 6000000) {
                    var converted = ecefToLlh(xv, yv, zv);
                    row.lat = converted.lat;
                    row.lon = converted.lon;
                    row.lng = converted.lon;
                    row.height_m = converted.height_m;
                    points.push(row);
                } else if (isFinite(magnitude)) {
                    sawSmallEcefValues = true;
                }
            }
        });

        if (points.length) return points;
        if (sawGeographicColumns) {
            throw new Error('CSV latitude/longitude values are invalid; expected WGS 84 decimal degrees');
        }
        if (sawEcefColumns && sawSmallEcefValues) {
            throw new Error('Values too small to be EPSG:4936 geocentric metres');
        }
        throw new Error('CSV must contain latitude/longitude (Latitudine/Longitudine) or ECEF X, Y and Z columns');
    }

    function haversine_m(lat1, lon1, lat2, lon2) {
        var p = Math.PI / 180;
        var dlat = (lat2 - lat1) * p;
        var dlon = (lon2 - lon1) * p;
        var a = Math.sin(dlat / 2) ** 2 +
            Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dlon / 2) ** 2;
        return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
    }

    function scan(rows, lat, lon, radius_m) {
        var dlat = radius_m / 111320;
        var dlon = radius_m / (111320 * Math.max(Math.cos(lat * Math.PI / 180), 1e-6));
        return rows.filter(function (row) {
            return row.lat >= lat - dlat && row.lat <= lat + dlat &&
                row.lon >= lon - dlon && row.lon <= lon + dlon;
        }).map(function (row) {
            row.distance_m = haversine_m(lat, lon, row.lat, row.lon);
            return row;
        }).filter(function (row) {
            return row.distance_m <= radius_m;
        }).sort(function (a, b) {
            return a.distance_m - b.distance_m;
        });
    }

    root.LidarGeo = {
        looks_like_ecef: looks_like_ecef,
        load_points: load_points,
        scan: scan
    };
})(window);

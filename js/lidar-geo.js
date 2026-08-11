/* EPSG:4936 (ETRS89 geocentric/ECEF) -> EPSG:4326 helpers.
 * The transform is deliberately done once for the complete CSV; scan() only
 * works with the derived geographic columns thereafter.
 */
(function (root) {
    'use strict';
    var A = 6378137, F = 1 / 298.257222101, B = A * (1 - F), E2 = F * (2 - F);
    var EARTH_RADIUS_M = 6371008.8;

    function looks_like_ecef(rows, x, y, z) {
        var magnitudes = rows.map(function (r) { return Math.sqrt(r[x] * r[x] + r[y] * r[y] + r[z] * r[z]); }).sort(function(a,b){return a-b;});
        return magnitudes.length && magnitudes[Math.floor(magnitudes.length / 2)] > 6000000;
    }
    function ecefToLlh(x, y, z) {
        var p = Math.sqrt(x*x + y*y), lon = Math.atan2(y, x), theta = Math.atan2(z*A, p*B);
        var st = Math.sin(theta), ct = Math.cos(theta);
        var lat = Math.atan2(z + (E2 * B) * st*st*st, p - E2*A*ct*ct*ct);
        var sl = Math.sin(lat), n = A / Math.sqrt(1 - E2*sl*sl);
        var h = p / Math.cos(lat) - n;
        return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI, height_m: h };
    }
    function load_points(rows, x, y, z) {
        x=x||'X'; y=y||'Y'; z=z||'Z';
        if (!rows.length || !Object.prototype.hasOwnProperty.call(rows[0], x) || !Object.prototype.hasOwnProperty.call(rows[0], y) || !Object.prototype.hasOwnProperty.call(rows[0], z)) throw new Error('CSV must contain ECEF columns X, Y and Z');
        if (!looks_like_ecef(rows, x, y, z)) throw new Error('Values too small to be EPSG:4936 geocentric metres');
        return rows.map(function(r) { var p=ecefToLlh(+r[x],+r[y],+r[z]); r.lat=p.lat; r.lon=p.lon; r.height_m=p.height_m; return r; });
    }
    function haversine_m(lat1, lon1, lat2, lon2) { var p=Math.PI/180, dlat=(lat2-lat1)*p, dlon=(lon2-lon1)*p, a=Math.sin(dlat/2)**2+Math.cos(lat1*p)*Math.cos(lat2*p)*Math.sin(dlon/2)**2; return 2*EARTH_RADIUS_M*Math.asin(Math.sqrt(a)); }
    function scan(rows, lat, lon, radius_m) {
        var dlat=radius_m/111320, dlon=radius_m/(111320*Math.max(Math.cos(lat*Math.PI/180),1e-6));
        return rows.filter(function(r){ return r.lat>=lat-dlat&&r.lat<=lat+dlat&&r.lon>=lon-dlon&&r.lon<=lon+dlon; }).map(function(r){r.distance_m=haversine_m(lat,lon,r.lat,r.lon);return r;}).filter(function(r){return r.distance_m<=radius_m;}).sort(function(a,b){return a.distance_m-b.distance_m;});
    }
    root.LidarGeo = { looks_like_ecef:looks_like_ecef, load_points:load_points, scan:scan };
})(window);

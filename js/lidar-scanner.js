/* DetectLab — premium LIDAR Scanner
 * Reads data/lidar_scanner_points.csv as WGS 84 / EPSG:4326 latitude and
 * longitude. English and Romanian CSV headers are normalized while loading;
 * legacy EPSG:4936 ECEF X/Y/Z files remain supported by lidar-geo.js.
 */
(function () {
    'use strict';
    var DATA_URL = 'data/lidar_scanner_points.csv?v=20260811-latlon';
    var HERITAGE_RADIUS_M = 600;
    var map = null, resultsLayer = null, selectedMarker = null, selectionCircle = null;
    var points = [], selected = null, active = false, scanning = false, pointsPromise = null;
    var lidarBounds = {
        // County datasets already present in the LIDAR group.
        hd: [[45.20, 22.30], [46.15, 23.25]], ar: [[45.80, 20.85], [46.65, 22.70]],
        ab: [[45.20, 22.70], [46.45, 24.10]], bh: [[46.25, 21.35], [47.20, 23.15]],
        cs: [[44.55, 21.55], [45.50, 23.25]], cs917: [[44.55, 21.55], [45.50, 23.25]],
        dj917: [[43.90, 22.35], [45.10, 24.15]], gj917: [[44.45, 22.10], [45.25, 23.95]],
        mh917: [[44.15, 22.25], [44.95, 23.25]],
        ro2m: [[43.50, 19.50], [48.50, 30.50]], ro1m: [[43.50, 19.50], [48.50, 30.50]]
    };

    function distance(a, b) {
        var R = 6371000, p = Math.PI / 180, dLat = (b.lat-a.lat)*p, dLng = (b.lng-a.lng)*p;
        var x = Math.sin(dLat/2) ** 2 + Math.cos(a.lat*p)*Math.cos(b.lat*p)*Math.sin(dLng/2) ** 2;
        return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
    }
    function inBounds(ll, b) { return ll.lat >= b[0][0] && ll.lat <= b[1][0] && ll.lng >= b[0][1] && ll.lng <= b[1][1]; }
    function inAnyLidar(ll) { return Object.keys(lidarBounds).some(function (k) { return inBounds(ll, lidarBounds[k]); }); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
    function normalizeHeader(value) {
        var key = String(value == null ? '' : value).replace(/^\uFEFF/, '').trim().toLowerCase();
        if (key.normalize) key = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        var aliases = {
            lat: 'lat', latitude: 'lat', latitudine: 'lat',
            lon: 'lon', lng: 'lon', longitude: 'lon', longitudine: 'lon',
            category: 'category', categorie: 'category', categoria: 'category',
            name: 'name', nume: 'name', denumire: 'name',
            id: 'id', fid: 'id', x: 'X', y: 'Y', z: 'Z'
        };
        return aliases[key] || String(value == null ? '' : value).trim();
    }
    function csvNumber(value) {
        return parseFloat(String(value == null ? '' : value).trim().replace(',', '.'));
    }
    function parseCsv(text) {
        var lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(function (line) {
            return line.trim();
        });
        if (!lines.length) return [];

        var sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
        function row(line) {
            var out = [], current = '', quoted = false;
            for (var i = 0; i < line.length; i++) {
                var character = line[i];
                if (character === '"') {
                    if (quoted && line[i + 1] === '"') {
                        current += '"';
                        i++;
                    } else {
                        quoted = !quoted;
                    }
                } else if (character === sep && !quoted) {
                    out.push(current.trim());
                    current = '';
                } else {
                    current += character;
                }
            }
            out.push(current.trim());
            return out;
        }

        var headers = row(lines[0]).map(normalizeHeader);
        return lines.slice(1).map(function (line, index) {
            var values = row(line);
            var record = {};
            headers.forEach(function (header, column) {
                record[header] = values[column] == null ? '' : values[column];
            });
            record.category = record.category || 'Uncategorized';
            record.name = record.name || '';
            record.id = record.id || String(index + 1);
            ['lat', 'lon', 'X', 'Y', 'Z'].forEach(function (key) {
                if (record[key] !== undefined) record[key] = csvNumber(record[key]);
            });
            return record;
        });
    }
    function heritageRecords() {
        var data=window._localLayerData||{}, out=[];
        [0,5,6].forEach(function(id){ (data[id]&&data[id].features||[]).forEach(function(f){ if(f.geometry)out.push(f.geometry); }); }); return out;
    }
    function pointInRing(p, ring) { var inside=false; for(var i=0,j=ring.length-1;i<ring.length;j=i++){var a=ring[i],b=ring[j], yi=a[1],yj=b[1], xi=a[0],xj=b[0]; if(((yi>p.lat)!==(yj>p.lat))&&p.lng<(xj-xi)*(p.lat-yi)/(yj-yi)+xi)inside=!inside;} return inside; }
    function isNearHeritage(p) {
        return heritageRecords().some(function(g){
            var coords=g.coordinates||[], rings=[];
            if(g.type==='Point') return distance(p,{lat:coords[1],lng:coords[0]})<=HERITAGE_RADIUS_M;
            if(g.type==='Polygon') rings=coords;
            else if(g.type==='MultiPolygon') coords.forEach(function(poly){rings=rings.concat(poly);});
            else if(g.type==='MultiPoint') return coords.some(function(c){return distance(p,{lat:c[1],lng:c[0]})<=HERITAGE_RADIUS_M;});
            if(rings.some(function(r){return pointInRing(p,r);})) return true;
            return rings.some(function(r){return (r||[]).some(function(c){return distance(p,{lat:c[1],lng:c[0]})<=HERITAGE_RADIUS_M;});});
        });
    }
    // Result label offset, in pixels above the site.
    //
    // This MUST stay small and constant. A tooltip offset is measured in screen
    // pixels, while the result circle is measured in metres, so the two scale
    // differently: the circle doubles on screen with every zoom level, a pixel
    // offset never changes. The old -98 px offset therefore drifted against the
    // site it labels — at z12 it floated ~2.6 km (94 px) above the circle, and
    // past z17 it sank inside it. Anchoring the label a few pixels above the
    // centre keeps it locked onto its site at every zoom level.
    var RESULT_LABEL_OFFSET = [0, -14];
    function makeResult(p) {
        var circle=L.circle([p.lat,p.lng],{radius:100,color:'#8cff66',weight:2,dashArray:'3 6',fillColor:'#39ff14',fillOpacity:.11,opacity:.98,interactive:true});
        circle.bindTooltip('<span class="lidar-result-tag"><b>Category / Categoria</b><br>'+esc(p.category)+'</span>',{permanent:true,direction:'top',offset:RESULT_LABEL_OFFSET,className:'lidar-result-tooltip'});
        circle.bindPopup('<strong>'+esc(p.category)+'</strong>'+(p.name?'<br>'+esc(p.name):'')+'<br><small>'+p.lat.toFixed(5)+', '+p.lng.toFixed(5)+'</small>'); return circle;
    }
    function setStatus(s) { var e=document.getElementById('lidarScannerStatus'); if(e)e.textContent=s; }
    function drawSelection(ll) {
        selected = ll;
        if (selectedMarker) map.removeLayer(selectedMarker);
        if (selectionCircle) map.removeLayer(selectionCircle);
        var searchIcon = L.divIcon({
            className: 'lidar-search-marker-wrapper',
            html: '<div class="lidar-search-marker" title="Search Point / Punct Căutare"><div class="lidar-search-pulse"></div><div class="lidar-search-dot"></div></div>',
            iconSize: [26, 26],
            iconAnchor: [13, 13]
        });
        selectedMarker = L.marker(ll, {
            icon: searchIcon,
            zIndexOffset: 2000,
            interactive: true
        }).addTo(map);
        selectedMarker.bindTooltip('<span class="lidar-result-tag"><b>Search Point / Punct căutare</b><br>' + ll.lat.toFixed(4) + ', ' + ll.lng.toFixed(4) + '</span>', {
            direction: 'top',
            offset: [0, -14],
            className: 'lidar-result-tooltip'
        });
        selectionCircle = L.circle(ll, {
            radius: parseInt(document.getElementById('lidarScannerDistance').value, 10) * 1000,
            color: '#8cff66',
            weight: 1.8,
            dashArray: '5 6',
            fill: true,
            fillColor: '#39ff14',
            fillOpacity: 0.05,
            opacity: 0.85
        }).addTo(map);
        setStatus(ll.lat.toFixed(4) + ', ' + ll.lng.toFixed(4));
    }
    function run() {
        if (!selected || scanning) return;
        scanning = true;
        var overlay = document.getElementById('lidarScannerLoading');
        if (overlay) overlay.classList.add('visible');
        var radius = +document.getElementById('lidarScannerDistance').value * 1000;

        // Wait for the CSV before scanning. This also covers a quick click on
        // Scan immediately after the layer has been enabled.
        load().then(function () {
            setTimeout(function () {
                var out = LidarGeo.scan(points, selected.lat, selected.lng, radius).filter(function (point) {
                    return inAnyLidar(point) && !isNearHeritage(point);
                });
                if (resultsLayer) resultsLayer.clearLayers();
                else resultsLayer = L.layerGroup();
                out.forEach(function (point) { resultsLayer.addLayer(makeResult(point)); });
                resultsLayer.addTo(map);
                if (out.length) {
                    var bounds = L.latLngBounds(out.map(function (point) { return [point.lat, point.lon]; }));
                    map.fitBounds(bounds.pad(.18), { maxZoom: 14 });
                    setStatus(out.length + ' result' + (out.length === 1 ? '' : 's') + ' / rezultate');
                } else {
                    setStatus('No results / Niciun rezultat');
                }
                if (overlay) overlay.classList.remove('visible');
                scanning = false;
            }, 5000);
        }).catch(function () {
            if (overlay) overlay.classList.remove('visible');
            scanning = false;
        });
    }
    function setActive(on) {
        active = on;
        if (!map) return;
        var row = document.getElementById('lidarScannerRow');
        if (row) row.classList.toggle('is-on', on);
        if (!on) {
            if (selectedMarker) map.removeLayer(selectedMarker);
            if (selectionCircle) map.removeLayer(selectionCircle);
            if (resultsLayer) resultsLayer.clearLayers();
            selected = null;
            map.off('click', onMapClick);
            setStatus('Choose a point on the map / Alege un punct pe harta');
        } else {
            map.on('click', onMapClick);
            // load() reports the useful status and warning itself. Consume the
            // rejection here so an invalid file does not become an uncaught
            // promise in the browser console.
            load().catch(function () {});
        }
    }
    function onMapClick(e){ if(active&&!scanning)drawSelection(e.latlng); }
    function load() {
        if (pointsPromise) return pointsPromise;
        setStatus('Loading points / Se încarcă punctele…');
        pointsPromise = fetch(DATA_URL, { cache: 'no-cache' }).then(function (response) {
            if (!response.ok) throw Error('CSV HTTP ' + response.status);
            return response.text();
        }).then(function (text) {
            points = LidarGeo.load_points(parseCsv(text));
            setStatus(points.length + ' points loaded / puncte încărcate — choose a point on the map');
            return points;
        }).catch(function (error) {
            pointsPromise = null;
            console.warn('[LIDAR Scanner]', error);
            setStatus('Could not load scanner CSV / CSV-ul scannerului nu a putut fi încărcat');
            throw error;
        });
        return pointsPromise;
    }
    function wire(){ map=window._dlMap; if(!map){setTimeout(wire,200);return;} document.getElementById('lidarScannerToggle').addEventListener('change',function(){setActive(this.checked);}); document.getElementById('lidarScannerDistance').addEventListener('input',function(){document.getElementById('lidarScannerDistanceValue').textContent=this.value+' km';if(selected)selectionCircle.setRadius(+this.value*1000);}); document.getElementById('lidarScannerRun').addEventListener('click',run); setStatus('Choose a point on the map / Alege un punct pe harta'); }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
    window.toggleLidarScannerLayer=setActive;
})();

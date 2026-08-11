/* DetectLab — premium LIDAR Scanner
 * Reads data/lidar_scanner_points.csv. Accepted coordinate columns (header match
 * is case-insensitive):
 *   1. latitude / longitude  — EPSG:4326 geographic degrees (see
 *      data/lidar_scanner_points.csv.example). Used as-is.
 *   2. X / Y / Z             — EPSG:4936 geocentric ECEF metres; transformed to
 *      WGS84 once at load time. (An X/Y/Z export whose X/Y values are plain
 *      degrees — e.g. QGIS "add X/Y fields" in EPSG:4326 — is auto-detected and
 *      read as X=longitude, Y=latitude instead of failing.)
 * Every loaded point is normalised to carry .lat, .lon and .lng so both
 * LidarGeo.scan() (.lon) and the Leaflet rendering code (.lng) work.
 */
(function () {
    'use strict';
    var DATA_URL = 'data/lidar_scanner_points.csv';
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
    function parseCsv(text) {
        var lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(function(x){return x.trim();});
        if(!lines.length)return [];
        var sep=(lines[0].match(/;/g)||[]).length>(lines[0].match(/,/g)||[]).length?';':',';
        function row(line){var out=[],cur='',quote=false;for(var i=0;i<line.length;i++){var c=line[i];if(c==='"'){if(quote&&line[i+1]==='"'){cur+='"';i++;}else quote=!quote;}else if(c===sep&&!quote){out.push(cur.trim());cur='';}else cur+=c;}out.push(cur.trim());return out;}
        var headers=row(lines[0]);
        var catH=findHeader(headers,['category','categoria']), nameH=findHeader(headers,['name','denumire']), idH=findHeader(headers,['id','fid']);
        var rows=lines.slice(1).map(function(line,idx){var vals=row(line), r={};headers.forEach(function(h,i){r[h]=vals[i]||'';});r.category=(catH?r[catH]:'')||'Uncategorized';r.name=nameH?r[nameH]:'';r.id=(idH&&r[idH])?r[idH]:String(idx+1);return r;});
        rows.headers=headers;
        return rows;
    }
    function findHeader(headers,names){for(var i=0;i<names.length;i++)for(var j=0;j<headers.length;j++)if(String(headers[j]).trim().toLowerCase()===names[i])return headers[j];return null;}
    function num(v){return parseFloat(String(v==null?'':v).trim().replace(',','.'));}
    function toPoints(rows) {
        var headers=rows.headers||[];
        var hx=findHeader(headers,['x']), hy=findHeader(headers,['y']), hz=findHeader(headers,['z']);
        var hlat=findHeader(headers,['latitude','lat']), hlon=findHeader(headers,['longitude','lng','lon']);
        var geo=function(r,latV,lonV){r.lat=latV;r.lon=lonV;r.lng=lonV;return r;};
        if(hx&&hy&&hz){
            rows=rows.map(function(r){r[hx]=num(r[hx]);r[hy]=num(r[hy]);r[hz]=num(r[hz]);return r;}).filter(function(r){return isFinite(r[hx])&&isFinite(r[hy])&&isFinite(r[hz]);});
            if(!rows.length) return [];
            if(!LidarGeo.looks_like_ecef(rows,hx,hy,hz)&&rows.every(function(r){return Math.abs(r[hx])<=180&&Math.abs(r[hy])<=90;}))
                return rows.map(function(r){return geo(r,r[hy],r[hx]);}); // QGIS-style export: X/Y are degrees, not ECEF
            return LidarGeo.load_points(rows,hx,hy,hz).map(function(p){p.lng=p.lon;return p;});
        }
        if(hlat&&hlon)
            return rows.map(function(r){return geo(r,num(r[hlat]),num(r[hlon]));}).filter(function(r){return isFinite(r.lat)&&isFinite(r.lon)&&Math.abs(r.lat)<=90&&Math.abs(r.lon)<=180;});
        throw new Error('CSV must contain latitude/longitude (EPSG:4326) or X/Y/Z (EPSG:4936 ECEF) columns — found: '+(headers.join(', ')||'none'));
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
    function makeResult(p) {
        var circle=L.circle([p.lat,p.lng],{radius:100,color:'#8cff66',weight:2,dashArray:'3 6',fillColor:'#39ff14',fillOpacity:.11,opacity:.98,interactive:true});
        circle.bindTooltip('<span class="lidar-result-tag"><b>Category / Categoria</b><br>'+esc(p.category)+'</span>',{permanent:true,direction:'top',offset:[0,-98],className:'lidar-result-tooltip'});
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
        if(!selected||scanning)return; scanning=true; var overlay=document.getElementById('lidarScannerLoading'); if(overlay)overlay.classList.add('visible');
        var radius=+document.getElementById('lidarScannerDistance').value*1000;
        setTimeout(function(){
            var out=LidarGeo.scan(points, selected.lat, selected.lng, radius).filter(function(p){return inAnyLidar(p) && !isNearHeritage(p);});
            if(resultsLayer)resultsLayer.clearLayers(); else resultsLayer=L.layerGroup(); out.forEach(function(p){resultsLayer.addLayer(makeResult(p));}); resultsLayer.addTo(map);
            if(out.length){var b=L.latLngBounds(out.map(function(p){return [p.lat,p.lng];}));map.fitBounds(b.pad(.18),{maxZoom:14});setStatus(out.length+' result'+(out.length===1?'':'s')+' / rezultate');} else setStatus('No results / Niciun rezultat');
            if(overlay)overlay.classList.remove('visible'); scanning=false;
        },5000);
    }
    function setActive(on) { active=on; if(!map)return; var row=document.getElementById('lidarScannerRow'); if(row)row.classList.toggle('is-on',on); if(!on){ if(selectedMarker)map.removeLayer(selectedMarker);if(selectionCircle)map.removeLayer(selectionCircle);if(resultsLayer)resultsLayer.clearLayers();selected=null;map.off('click',onMapClick);setStatus('Choose a point on the map / Alege un punct pe harta'); } else {map.on('click',onMapClick); load();} }
    function onMapClick(e){ if(active&&!scanning)drawSelection(e.latlng); }
    function load(){if(pointsPromise)return pointsPromise;pointsPromise=fetch(DATA_URL).then(function(r){if(!r.ok)throw Error('CSV '+r.status);return r.text();}).then(function(t){points=toPoints(parseCsv(t));setStatus(points.length+' points loaded / puncte încărcate — choose a point on the map');return points;}).catch(function(e){pointsPromise=null;console.warn('[LIDAR Scanner]',e);setStatus('Invalid CSV / CSV invalid — need latitude,longitude or X,Y,Z columns');throw e;});return pointsPromise;}
    function wire(){ map=window._dlMap; if(!map){setTimeout(wire,200);return;} document.getElementById('lidarScannerToggle').addEventListener('change',function(){setActive(this.checked);}); document.getElementById('lidarScannerDistance').addEventListener('input',function(){document.getElementById('lidarScannerDistanceValue').textContent=this.value+' km';if(selected)selectionCircle.setRadius(+this.value*1000);}); document.getElementById('lidarScannerRun').addEventListener('click',run); setStatus('Choose a point on the map / Alege un punct pe harta'); }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
    window.toggleLidarScannerLayer=setActive;
})();

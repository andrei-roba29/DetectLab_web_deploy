/* DetectLab — premium LIDAR Scanner
 * Reads data/lidar_scanner_points.csv. Expected columns: latitude/lat, longitude/lng/lon,
 * and category/categoria. Optional name/denumire and id columns are preserved in popups.
 */
(function () {
    'use strict';
    var DATA_URL = 'data/lidar_scanner_points.csv';
    var HERITAGE_RADIUS_M = 600;
    var map = null, resultsLayer = null, selectedMarker = null, selectionCircle = null;
    var points = [], selected = null, active = false, scanning = false;
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
        var lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(function (x) { return x.trim(); });
        if (!lines.length) return [];
        var sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
        function row(line) { var out=[], cur='', quote=false; for (var i=0;i<line.length;i++) { var c=line[i]; if(c==='"'){ if(quote && line[i+1]==='"'){cur+='"';i++;} else quote=!quote; } else if(c===sep&&!quote){out.push(cur.trim());cur='';} else cur+=c; } out.push(cur.trim()); return out; }
        var head=row(lines[0]).map(function (h) { return h.toLowerCase().replace(/\s+/g,'_'); });
        function val(r, names) { for(var i=0;i<names.length;i++){var j=head.indexOf(names[i]);if(j>=0&&r[j]!==undefined&&r[j]!=='')return r[j];} return ''; }
        return lines.slice(1).map(function(line, idx){ var r=row(line), lat=parseFloat(String(val(r,['latitude','lat','y'])).replace(',','.')), lng=parseFloat(String(val(r,['longitude','lng','lon','long','x'])).replace(',','.')); if(!isFinite(lat)||!isFinite(lng))return null; return {lat:lat,lng:lng,category:val(r,['category','categoria','type','categorie'])||'Uncategorized',name:val(r,['name','denumire','title']),id:val(r,['id','fid'])||String(idx+1),raw:r}; }).filter(Boolean);
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
    function drawSelection(ll) { selected=ll; if(selectedMarker)map.removeLayer(selectedMarker); if(selectionCircle)map.removeLayer(selectionCircle); selectedMarker=L.circleMarker(ll,{radius:6,color:'#fff',weight:2,fillColor:'#a070e8',fillOpacity:1}).addTo(map); selectionCircle=L.circle(ll,{radius:parseInt(document.getElementById('lidarScannerDistance').value,10)*1000,color:'#a070e8',weight:1,dashArray:'4 5',fill:false,opacity:.45}).addTo(map); setStatus(ll.lat.toFixed(4)+', '+ll.lng.toFixed(4)); }
    function run() {
        if(!selected||scanning)return; scanning=true; var overlay=document.getElementById('lidarScannerLoading'); if(overlay)overlay.classList.add('visible');
        var radius=+document.getElementById('lidarScannerDistance').value*1000;
        setTimeout(function(){
            var out=points.filter(function(p){return distance(selected,p)<=radius && inAnyLidar(p) && !isNearHeritage(p);});
            if(resultsLayer)resultsLayer.clearLayers(); else resultsLayer=L.layerGroup(); out.forEach(function(p){resultsLayer.addLayer(makeResult(p));}); resultsLayer.addTo(map);
            if(out.length){var b=L.latLngBounds(out.map(function(p){return [p.lat,p.lng];}));map.fitBounds(b.pad(.18),{maxZoom:14});setStatus(out.length+' result'+(out.length===1?'':'s')+' / rezultate');} else setStatus('No results / Niciun rezultat');
            if(overlay)overlay.classList.remove('visible'); scanning=false;
        },5000);
    }
    function setActive(on) { active=on; if(!map)return; var row=document.getElementById('lidarScannerRow'); if(row)row.classList.toggle('is-on',on); if(!on){ if(selectedMarker)map.removeLayer(selectedMarker);if(selectionCircle)map.removeLayer(selectionCircle);if(resultsLayer)resultsLayer.clearLayers();selected=null;map.off('click',onMapClick);setStatus('Choose a point on the map / Alege un punct pe harta'); } else {map.on('click',onMapClick); load();} }
    function onMapClick(e){ if(active&&!scanning)drawSelection(e.latlng); }
    function load(){if(points.length)return;fetch(DATA_URL).then(function(r){if(!r.ok)throw Error('CSV '+r.status);return r.text();}).then(function(t){points=parseCsv(t);setStatus(points.length+' points loaded / puncte încărcate — choose a point on the map');}).catch(function(e){console.warn('[LIDAR Scanner]',e);setStatus('CSV unavailable / CSV indisponibil');});}
    function wire(){ map=window._dlMap; if(!map){setTimeout(wire,200);return;} document.getElementById('lidarScannerToggle').addEventListener('change',function(){setActive(this.checked);}); document.getElementById('lidarScannerDistance').addEventListener('input',function(){document.getElementById('lidarScannerDistanceValue').textContent=this.value+' km';if(selected)selectionCircle.setRadius(+this.value*1000);}); document.getElementById('lidarScannerRun').addEventListener('click',run); setStatus('Choose a point on the map / Alege un punct pe harta'); }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
    window.toggleLidarScannerLayer=setActive;
})();

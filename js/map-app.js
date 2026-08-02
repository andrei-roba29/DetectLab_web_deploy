        /* ── Layer Panel Tab Switching ── */
        function switchLayerTab(tab) {
            // Update active tab button
            document.querySelectorAll('.transp-panel-tabs button').forEach(btn => {
                btn.classList.remove('active');
                if (btn.dataset.tab === tab) {
                    btn.classList.add('active');
                }
            });

            // Update visibility of layer rows and dividers
            document.querySelectorAll('[data-category]').forEach(el => {
                el.classList.remove('active');
                if (el.dataset.category === tab) {
                    el.classList.add('active');
                }
            });
        }

        // Initialize with "free" tab active on page load
        window.addEventListener('load', function() {
            switchLayerTab('free');
        });
        
        (function initMap() {
            // ── SEARCH BAR (OSM Places ArcGIS — fără rate-limit) ──
            var searchDebounce = null;
            var selectedIndex = -1;
            var searchMarker = null;
            var _searchCache = {};
            // ── SURSA DATE OSM (fișier GeoJSON static pe Cloudflare R2) ──
            // Înlocuiește vechiul backend ArcGIS/Worker. Fișierul se încarcă o singură
            // dată și e refolosit atât de search bar, cât și de layerul OSM Places.
            var OSM_GEOJSON_URL = 'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/OSM.geojson';
            var _osmGeojsonFeatures = null;
            var _osmGeojsonPromise = null;

            // Caută prima proprietate existentă (și nenulă) dintr-o listă de nume
            // posibile de câmp — util pentru că fișierul GeoJSON poate avea
            // denumiri diferite pentru județ în funcție de sursă (judet/county/admin...).
            function _pickOsmProp(props, candidates) {
                for (var i = 0; i < candidates.length; i++) {
                    if (props[candidates[i]]) return props[candidates[i]];
                }
                var lower = candidates.map(function (c) { return c.toLowerCase(); });
                for (var key in props) {
                    if (lower.indexOf(key.toLowerCase()) !== -1 && props[key]) return props[key];
                }
                return null;
            }

            // Elimină diacriticele românești, aducând textul la forma de bază
            // (ă/â -> a, ș/ş -> s, ț/ţ -> t, î -> i). Folosită pentru search:
            // comparăm termenul căutat și numele localității ambele normalizate,
            // ca "sacalaseni" să găsească "Săcălășeni" indiferent de lungime.
            function normalizeRoDiacritics(str) {
                return (str || '')
                    .replace(/[ăâ]/g, 'a')
                    .replace(/[șş]/g, 's')
                    .replace(/[țţ]/g, 't')
                    .replace(/î/g, 'i');
            }

            function loadOsmGeojson() {
                if (_osmGeojsonFeatures) return Promise.resolve(_osmGeojsonFeatures);
                if (_osmGeojsonPromise) return _osmGeojsonPromise;
                _osmGeojsonPromise = fetch(OSM_GEOJSON_URL)
                    .then(function (res) {
                        if (!res.ok) throw new Error('HTTP ' + res.status);
                        return res.json();
                    })
                    .then(function (data) {
                        var feats = (data && data.features) ? data.features : [];
                        // Precalculăm numele normalizat (lowercase + fără diacritice) o
                        // singură dată, pentru search rapid pe tot setul de date.
                        for (var i = 0; i < feats.length; i++) {
                            var props = feats[i].properties || {};
                            var name = props.name || props.NAME || '';
                            feats[i]._lname = name.toLowerCase();
                            feats[i]._lnameNorm = normalizeRoDiacritics(feats[i]._lname);
                            var judet = _pickOsmProp(props, [
                                // Structura administrativă reală din fișierul OSM.geojson:
                                // adm2_name = județul (ex: "Constanța"), adm1_name = macroregiunea (ex: "Sud-Est").
                                'adm2_name', 'ADM2_NAME',
                                'judet', 'JUDET', 'Judet', 'județ', 'JUDEȚ', 'Județ',
                                'county', 'COUNTY', 'County',
                                'admin', 'ADMIN', 'admin_name', 'ADMIN_NAME',
                                'NAME_1', 'region', 'REGION', 'Region',
                                'adm1_name', 'ADM1_NAME'
                            ]);
                            feats[i]._judet = judet || '';
                            feats[i]._ljudet = (judet || '').toLowerCase();
                            feats[i]._ljudetNorm = normalizeRoDiacritics(feats[i]._ljudet);
                        }
                        _osmGeojsonFeatures = feats;
                        if (feats.length) {
                            console.log('[OSM DEBUG] Exemplu properties pentru prima localitate:', feats[0].properties);
                            console.log('[OSM DEBUG] Chei disponibile:', Object.keys(feats[0].properties || {}));
                        }
                        return _osmGeojsonFeatures;
                    })
                    .catch(function (err) {
                        console.warn('[OSM] Eroare la încărcarea sursei GeoJSON:', err.message);
                        _osmGeojsonFeatures = [];
                        return _osmGeojsonFeatures;
                    });
                return _osmGeojsonPromise;
            }

            // Pornim încărcarea din timp, ca datele să fie deja în cache
            // când utilizatorul caută sau activează layerul.
            loadOsmGeojson();

            // ── SURSA DATE UAT/Buildings (fișier GeoJSON static pe Cloudflare R2) ──
            // Înlocuiește vechile tile-uri vectoriale .pbf (tippecanoe, OSM/pbf_tiles).
            // Fișierul se încarcă o singură dată și e refolosit atât de layerul UAT
            // (randare directă pe hartă), cât și de funcționalitatea "clădiri dispărute"
            // (verificare dacă există deja o clădire modernă lângă un poligon candidat).
            // ── UAT — sursă raster (tile-uri PNG pe Cloudflare R2) ──────────────────
            // Fiecare tile e o imagine 256×256. Confirmat empiric pe hartă (nu doar pe
            // tile-uri de test izolate): pixelii întunecați + opaci sunt cei desenați
            // roșu pe strat, și reprezintă de fapt zone FĂRĂ o clădire actuală (opusul
            // denumirii inițiale "negru = clădire"). Cu alte cuvinte: roșu = fără
            // clădire acum. Această convenție e păstrată neschimbată pentru afișare (nu
            // contează cum se numește, doar cum arată) — vezi mai jos, la logica pentru
            // "clădiri dispărute", unde folosim explicit polul opus.
            var UAT_TILE_URL = 'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/UAT/{z}/{x}/{y}.png';
            // Reglabil live din consolă, fără redeploy: window.UAT_TILE_Z.
            // CONFIRMAT (2026-07, test live consolă): nivelul nativ real la care există
            // tile-urile UAT/Buildings pe R2 e 14, NU 15. La z=15, toate cererile dădeau
            // 404 silențios (înainte de fix-ul de logging) — verificarea de clădiri nu
            // excludea niciodată nimic (39/39 candidați desenați, 0 tăiați). La z=14,
            // tile-urile se încarcă fără nicio eroare [UAT], iar rezultatele sunt corecte
            // (testat pe o zonă goală de clădiri actuale — Turda/Râmeț — și pe una plină
            // de clădiri actuale — Mineu).
            window.UAT_TILE_Z = (window.UAT_TILE_Z !== undefined) ? window.UAT_TILE_Z : 14;
            var UAT_TILE_Z = window.UAT_TILE_Z; // nivelul nativ la care sunt generate tile-urile
            var UAT_TILE_SIZE = 256;
            // Comutator unic pentru polaritatea clasificării pixelilor "roșu pe hartă"
            // (NU neapărat "clădire reală" — vezi nota de mai sus și
            // _uatIsPresentBuildingPixel mai jos, pentru logica de clădiri dispărute).
            var UAT_BUILDING_IS_LIGHT = false;
            function _uatIsBuildingPixel(r, g, b, a) {
                if (a <= 128) return false; // transparent / fără date → niciodată roșu
                var lum = (r + g + b) / 3;
                return UAT_BUILDING_IS_LIGHT ? (lum >= 128) : (lum < 128);
            }
            // Pentru "clădiri dispărute": un candidat e valid DOAR dacă zona e ÎN
            // interiorul stratului roșu (adică exact acolo unde _uatIsBuildingPixel
            // întoarce true) — o clădire dispărută trebuie să cadă pe roșu = fără
            // clădire actuală acolo acum. Deci "există o clădire actuală prezentă" =
            // opusul lui _uatIsBuildingPixel, pentru pixelii cu date (opaci).
            //
            // FIX (2026-07): pixelii TRANSPARENȚI dintr-un tile încărcat cu succes NU
            // înseamnă "fără date, nu putem afirma nimic" — confirmat empiric (vezi
            // captura cu stratul UAT afișat direct: exact zona satului/clădirilor
            // actuale apare transparentă, netrasă cu roșu, în timp ce câmpurile/pădurea
            // din jur sunt opace-roșii). Practic, în acest set de date, absența oricărei
            // marcaje ("roșu = fără clădire") pe un pixel opac ÎNSEAMNĂ de fapt zonă
            // construită, iar transparența e un gol lăsat peste zonele construite, nu
            // "necunoscut". Vechea logică ignora acești pixeli ("nu putem afirma nimic"),
            // ceea ce lăsa poligoane "clădire dispărută" desenate direct peste clădiri
            // actuale reale în interiorul satelor. Acum tratăm pixelii transparenți la
            // fel ca restul cazurilor incerte din acest fișier (CORS/rețea): eșuăm
            // ÎNCHIS — presupunem "clădire prezentă" — și SINGURUL mod de a confirma
            // "fără clădire" e un pixel opac clasificat explicit ca roșu.
            function _uatIsPresentBuildingPixel(r, g, b, a) {
                if (a <= 128) return true; // transparent → incert → presupunem clădire prezentă (eșuăm închis)
                return !_uatIsBuildingPixel(r, g, b, a);
            }
            // Tile-urile au fost generate cu gdal2tiles.py fără flag-ul --xyz, deci sunt
            // în schema TMS (y=0 la SUD/jos, crescător spre nord) — Leaflet & tot restul
            // codului nostru lucrează în schema XYZ standard (y=0 la NORD/sus, crescător
            // spre sud). Conversia se face DOAR la nivel de nume de fișier cerut; restul
            // matematicii (poziția pixelului în interiorul tile-ului) rămâne XYZ, pentru
            // că imaginea în sine nu e răsturnată, doar numărul de rând din URL.
            function _uatTileYForUrl(y, z) { return Math.pow(2, z) - 1 - y; }

            function _uatLngToTileX(lng, z) { return (lng + 180) / 360 * Math.pow(2, z); }
            function _uatLatToTileY(lat, z) {
                var rad = lat * Math.PI / 180;
                return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z);
            }

            // Cache de tile-uri deja încărcate (Promise -> {data,size} | null | UAT_TILE_UNREADABLE).
            // Rezultatele posibile:
            //  - {data, size}      → tile citit cu succes, pixelii sunt disponibili.
            //  - null              → tile CONFIRMAT lipsă (404 chiar și fără CORS) — nu
            //                        există date acolo, tratat ca "fără informație".
            //  - UAT_TILE_UNREADABLE → tile-ul EXISTĂ (s-a încărcat fără CORS), dar nu-i
            //                        putem citi pixelii (CORS neconfigurat pe bucket-ul R2).
            //                        Diferența față de "null" contează: apelanții trebuie să
            //                        trateze asta ca INCERT, nu ca "sigur fără clădire" — vezi
            //                        uatHasBuildingNear mai jos, care eșuează "închis"
            //                        (presupune clădire prezentă) în loc de "deschis" pe acest caz.
            var UAT_TILE_UNREADABLE = { unreadable: true };
            var _uatPixelTileCache = {};
            function _uatGetTile(z, x, y) {
                var max = Math.pow(2, z);
                if (x < 0 || y < 0 || x >= max || y >= max) return Promise.resolve(null);
                var key = z + '/' + x + '/' + y;
                if (_uatPixelTileCache[key]) return _uatPixelTileCache[key];
                var url = UAT_TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', _uatTileYForUrl(y, z));
                var p = new Promise(function (resolve) {
                    function tryLoad(useCORS) {
                        var img = new Image();
                        var loadUrl = url;
                        if (useCORS) {
                            img.crossOrigin = 'anonymous'; // necesar pentru getImageData — bucket-ul R2 trebuie să aibă CORS activat
                        } else {
                            loadUrl += (url.indexOf('?') === -1 ? '?' : '&') + '_uatProbe=1';
                        }
                        img.onload = function () {
                            if (!useCORS) {
                                // S-a încărcat fără CORS → tile-ul EXISTĂ pe server, dar nu-i
                                // putem citi pixelii (fără header CORS pe bucket). INCERT, nu
                                // "fără clădire" — vezi nota de mai sus.
                                console.warn('[UAT] Tile ' + key + ' există dar nu poate fi citit (CORS neconfigurat pe bucket R2) — tratat ca INCERT în verificarea de proximitate.');
                                resolve(UAT_TILE_UNREADABLE);
                                return;
                            }
                            try {
                                var c = document.createElement('canvas');
                                c.width = img.width; c.height = img.height;
                                var ctx = c.getContext('2d');
                                ctx.drawImage(img, 0, 0);
                                var imgData = ctx.getImageData(0, 0, c.width, c.height);
                                resolve({ data: imgData.data, size: c.width });
                            } catch (e) {
                                console.warn('[UAT] Nu pot citi pixelii tile-ului ' + key + ' cu CORS, reîncerc fără CORS ca să confirm dacă tile-ul există:', e.message);
                                tryLoad(false);
                            }
                        };
                        img.onerror = function () {
                            if (useCORS) {
                                // Eșec cu CORS — poate fi 404 real SAU blocaj CORS. Reîncercăm
                                // fără crossOrigin ca să aflăm dacă resursa chiar există.
                                tryLoad(false);
                                return;
                            }
                            // Eșec și fără CORS → tile CONFIRMAT lipsă (404 real).
                            // FIX (2026-07): înainte, acest caz era complet silențios — nu se
                            // logga nimic, ceea ce a mascat un bug real (verificarea de clădiri
                            // eșua silențios pe 100% din candidați, fără niciun avertisment în
                            // consolă). Acum îl logăm explicit, ca să fie vizibil dacă tile-urile
                            // UAT lipsesc sistematic la zoom-ul cerut (UAT_TILE_Z).
                            console.warn('[UAT] Tile ' + key + ' CONFIRMAT lipsă (404) la zoom ' + z + ' — ' +
                                'verific dacă UAT_TILE_Z (' + UAT_TILE_Z + ') corespunde nivelului real generat pe R2.');
                            resolve(null);
                        };
                        img.src = loadUrl;
                    }
                    tryLoad(true);
                });
                _uatPixelTileCache[key] = p;
                return p;
            }
            window._uatGetTile = _uatGetTile;
            window._UAT_TILE_UNREADABLE = UAT_TILE_UNREADABLE;

            function _uatDegBufferFromMeters(meters, midLatDeg) {
                return {
                    dLat: meters / 111320,
                    dLng: meters / (111320 * Math.cos(midLatDeg * Math.PI / 180))
                };
            }

            // Verifică (async) dacă există cel puțin un pixel "clădire" (negru) în
            // bbox-ul sw..ne, extins cu bufferMeters în fiecare direcție — echivalentul
            // regulii "minDistM <= minBuildingDistM", dar pe raster în loc de distanță
            // geometrică exactă. cb(true|false) e apelat la final.
            //
            // IMPORTANT (2026-07, fix): dacă vreun tile relevant există dar nu poate fi
            // citit (CORS neconfigurat pe bucket — vezi UAT_TILE_UNREADABLE mai sus),
            // funcția NU mai presupune silențios "fără clădire acolo" (comportament vechi,
            // periculos: putea lăsa poligoane "clădire dispărută" desenate direct peste
            // clădiri actuale reale, doar pentru că nu am putut verifica). În schimb,
            // eșuează ÎNCHIS: cb(true) — tratează zona ca "posibil clădire prezentă", deci
            // candidatul e exclus/tăiat, nu desenat. E mai bine să ratăm o clădire
            // dispărută reală decât să desenăm una falsă peste o clădire existentă.
            function uatHasBuildingNear(sw, ne, bufferMeters, cb) {
                var midLat = (sw.lat + ne.lat) / 2;
                var buf = _uatDegBufferFromMeters(bufferMeters, midLat);
                var minLat = Math.min(sw.lat, ne.lat) - buf.dLat, maxLat = Math.max(sw.lat, ne.lat) + buf.dLat;
                var minLng = Math.min(sw.lng, ne.lng) - buf.dLng, maxLng = Math.max(sw.lng, ne.lng) + buf.dLng;

                var z = window.UAT_TILE_Z;
                var txMinF = _uatLngToTileX(minLng, z), txMaxF = _uatLngToTileX(maxLng, z);
                var tyMinF = _uatLatToTileY(maxLat, z), tyMaxF = _uatLatToTileY(minLat, z); // lat crește => tileY scade
                var txMin = Math.floor(txMinF), txMax = Math.floor(txMaxF);
                var tyMin = Math.floor(tyMinF), tyMax = Math.floor(tyMaxF);

                var tiles = [];
                for (var tx = txMin; tx <= txMax; tx++) {
                    for (var ty = tyMin; ty <= tyMax; ty++) tiles.push([tx, ty]);
                }

                Promise.all(tiles.map(function (t) { return _uatGetTile(z, t[0], t[1]); }))
                    .then(function (results) {
                        var anyUnreadable = false;
                        var anyMissing = false;
                        var anyLoaded = false;
                        for (var i = 0; i < results.length; i++) {
                            var tile = results[i];
                            if (tile === UAT_TILE_UNREADABLE) { anyUnreadable = true; continue; }
                            if (!tile) { anyMissing = true; continue; } // tile CONFIRMAT lipsă (404)
                            anyLoaded = true;
                            var tx = tiles[i][0], ty = tiles[i][1], size = tile.size;
                            var pxMinX = Math.max(0, Math.floor((txMinF - tx) * size));
                            var pxMaxX = Math.min(size - 1, Math.ceil((txMaxF - tx) * size));
                            var pxMinY = Math.max(0, Math.floor((tyMinF - ty) * size));
                            var pxMaxY = Math.min(size - 1, Math.ceil((tyMaxF - ty) * size));
                            for (var py = pxMinY; py <= pxMaxY; py++) {
                                for (var px = pxMinX; px <= pxMaxX; px++) {
                                    var idx = (py * size + px) * 4;
                                    if (_uatIsPresentBuildingPixel(tile.data[idx], tile.data[idx + 1], tile.data[idx + 2], tile.data[idx + 3])) { cb(true); return; }
                                }
                            }
                        }
                        if (anyUnreadable) {
                            // N-am putut confirma sigur "fără clădire" pentru toată zona —
                            // eșuăm închis (vezi nota de mai sus).
                            cb(true);
                            return;
                        }
                        // FIX (2026-07): dacă NICIUN tile din zona verificată nu s-a putut
                        // încărca deloc (toate 404 — de exemplu UAT_TILE_Z nu (mai) corespunde
                        // nivelului real generat pe R2 pentru acest set de date, sau lipsă de
                        // acoperire), vechiul cod trecea silențios la cb(false) = "fără clădire",
                        // FĂRĂ niciun avertisment în consolă — exact bug-ul confirmat empiric:
                        // 39/39 candidați desenați, 0 tăiați, 0 loguri [UAT]/[Buildings]. O
                        // absență TOTALĂ de date pe toată zona verificată nu e o confirmare de
                        // "fără clădire", e o necunoscută la fel de gravă ca un tile ilizibil —
                        // eșuăm închis și aici.
                        if (anyMissing && !anyLoaded) {
                            console.warn('[UAT] Niciun tile citit pentru zona verificată (toate lipsă la zoom ' + z + ') — eșuez închis (presupun clădire prezentă).');
                            cb(true);
                            return;
                        }
                        cb(false);
                    })
                    .catch(function (err) {
                        console.warn('[UAT] Eroare la citirea tile-urilor raster — eșuez închis (presupun clădire prezentă):', err && err.message);
                        cb(true); // eșec neașteptat → tot închis, nu deschis
                    });
            }
            window.uatHasBuildingNear = uatHasBuildingNear;

            // Funcția principală de search
            function doSearch(q) {
                var ul = document.getElementById('mapSearchResults');
                var searchTerm = q.trim();

                if (searchTerm.length < 2) {
                    closeResults();
                    return;
                }

                var cacheKey = normalizeRoDiacritics(searchTerm.toLowerCase());

                if (_searchCache[cacheKey]) {
                    displaySearchResults(_searchCache[cacheKey], searchTerm);
                    return;
                }

                ul.innerHTML = '<li class="map-search-msg">Searching…</li>';
                ul.classList.add('open');
                selectedIndex = -1;

                var searchNorm = cacheKey;

                loadOsmGeojson()
                    .then(function (features) {
                        var matches = [];
                        for (var i = 0; i < features.length; i++) {
                            var feat = features[i];
                            var lnameNorm = feat._lnameNorm || '';
                            var ljudetNorm = feat._ljudetNorm || '';
                            if (!lnameNorm) continue;
                            var hit = lnameNorm.indexOf(searchNorm) === 0;
                            var hitJudet = !hit && ljudetNorm && ljudetNorm.indexOf(searchNorm) === 0;
                            // Potrivire după numele localității are prioritate; dacă nu
                            // există, dar termenul căutat se potrivește cu județul,
                            // afișăm și localitățile din acel județ.
                            if (!hit && !hitJudet) continue;
                            var coords = feat.geometry && feat.geometry.coordinates;
                            if (!coords) continue;
                            var props = feat.properties || {};
                            matches.push({
                                lat: coords[1],
                                lon: coords[0],
                                display_name: props.name || props.NAME || '',
                                fclass: props.fclass || props.type || '',
                                judet: feat._judet || '',
                                population: props.population || props.pop || 0,
                                _matchedByJudet: !hit && hitJudet
                            });
                        }
                        // Localitățile care se potrivesc direct după nume apar înaintea
                        // celor găsite doar prin numele județului; în interiorul fiecărui
                        // grup, ordonăm după populație.
                        matches.sort(function (a, b) {
                            if (a._matchedByJudet !== b._matchedByJudet) {
                                return a._matchedByJudet ? 1 : -1;
                            }
                            return (b.population || 0) - (a.population || 0);
                        });
                        matches = matches.slice(0, 8);
                        _searchCache[cacheKey] = matches;
                        displaySearchResults(matches, searchTerm);
                    })
                    .catch(function (err) {
                        console.warn('[Search] Eroare OSM Places:', err.message);
                        ul.innerHTML = '<li class="map-search-msg">Search unavailable. Try again later.</li>';
                    });
            }

            function displaySearchResults(data, searchTerm) {
                var ul = document.getElementById('mapSearchResults');
                if (!data.length) {
                    ul.innerHTML = '<li class="map-search-msg">No results found</li>';
                    return;
                }
                ul.innerHTML = '';
                data.forEach(function (item, i) {
                    var li = document.createElement('li');
                    li.dataset.idx = i;
                    var name = item.display_name || '';
                    var typeLabel = item.fclass ? item.fclass.replace(/_/g, ' ') : '';
                    var meta = item.judet
                        ? ('jud. ' + item.judet) + (typeLabel ? ' · ' + typeLabel : '')
                        : typeLabel;
                    li.innerHTML =
                        '<svg class="sr-icon" width="12" height="12" viewBox="0 0 12 12" fill="none">' +
                        '<circle cx="6" cy="5" r="2.5" stroke="#B8D8F0" stroke-width="1.2"/>' +
                        '<path d="M6 1C3.79 1 2 2.79 2 5c0 3 4 7 4 7s4-4 4-7c0-2.21-1.79-4-4-4z" stroke="#B8D8F0" stroke-width="1.2" fill="none"/></svg>' +
                        '<span class="sr-name">' + name + '</span>' +
                        '<span class="sr-country">' + meta + '</span>';
                    li.addEventListener('click', function () { selectResult(item); });
                    ul.appendChild(li);
                });
                ul.classList.add('open');
            }

            function setActive(idx, items) {
                items.forEach(function (i) { i.classList.remove('active'); });
                selectedIndex = Math.max(0, Math.min(idx, items.length - 1));
                if (items[selectedIndex]) items[selectedIndex].classList.add('active');
            }

            function selectResult(item) {
                var lat = parseFloat(item.lat);
                var lon = parseFloat(item.lon);
                var latlng = L.latLng(lat, lon);
                var name = item.display_name || '';

                document.getElementById('mapSearchInput').value = name;
                document.getElementById('searchClearBtn').classList.add('visible');
                closeResults();

                map.flyTo(latlng, 13);

                setTimeout(function () {
                    if (typeof window._iosFreeActivateSearch === 'function') {
                        window._iosFreeActivateSearch(name, lat, lon);
                    }
                }, 200);

                removeSearchMarker();
                var icon = L.divIcon({
                    className: '',
                    html: '<svg width="22" height="28" viewBox="0 0 22 28" fill="none">' +
                        '<path d="M11 0C5 0 0 5 0 11c0 8 11 17 11 17S22 19 22 11C22 5 17 0 11 0z" fill="#6B3FA0"/>' +
                        '<circle cx="11" cy="11" r="5" fill="white" opacity="0.9"/></svg>',
                    iconSize: [22, 28],
                    iconAnchor: [11, 28]
                });
                searchMarker = L.marker(latlng, { icon: icon })
                    .bindTooltip(name, {
                        permanent: true,
                        direction: 'top',
                        offset: [0, -32],
                        className: 'map-search-tooltip'
                    })
                    .addTo(map);
            }

            function removeSearchMarker() {
                if (searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }
            }

            function closeResults() {
                var ul = document.getElementById('mapSearchResults');
                ul.classList.remove('open');
                selectedIndex = -1;
            }

            // Make clearSearch globally accessible for the HTML onclick
            window.clearSearch = function () {
                var input = document.getElementById('mapSearchInput');
                if (input) input.value = '';
                var clear = document.getElementById('searchClearBtn');
                if (clear) clear.classList.remove('visible');
                closeResults();
                removeSearchMarker();
            };

            // Attach search event listeners
            var searchInput = document.getElementById('mapSearchInput');
            if (searchInput) {
                searchInput.addEventListener('input', function (e) {
                    var val = e.target.value;
                    var clear = document.getElementById('searchClearBtn');
                    if (clear) clear.classList.toggle('visible', val.length > 0);
                    clearTimeout(searchDebounce);
                    if (val.length < 2) { closeResults(); return; }
                    searchDebounce = setTimeout(function () { doSearch(val); }, 350);
                });

                searchInput.addEventListener('keydown', function (e) {
                    var items = document.querySelectorAll('#mapSearchResults li[data-idx]');
                    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(selectedIndex + 1, items); }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(selectedIndex - 1, items); }
                    if (e.key === 'Enter') { e.preventDefault(); if (selectedIndex >= 0 && items[selectedIndex]) items[selectedIndex].click(); }
                    if (e.key === 'Escape') { closeResults(); }
                });
            }

            document.addEventListener('click', function (e) {
                if (!document.getElementById('mapSearchWrap').contains(e.target)) closeResults();
            });

            // Also attach clear button listener
            var clearBtn = document.getElementById('searchClearBtn');
            if (clearBtn) {
                clearBtn.onclick = function () {
                    searchInput.value = '';
                    clearBtn.classList.remove('visible');
                    closeResults();
                    removeSearchMarker();
                };
            }
            // APM image bounds [[south,west],[north,east]] in EPSG:4326
            var APM_BOUNDS = [
                [42.8657855276803872, 19.9018464511967004],
                [49.0024961993941517, 30.6713880698685237]
            ];
            var MAP_PAN_BOUNDS = L.latLngBounds(APM_BOUNDS);

            // Initialise Leaflet map inside DetectLab's existing container
            var map = L.map('detectlab-map', {
                zoomControl: false,
                minZoom: 5,
                maxZoom: 20,
                maxBounds: MAP_PAN_BOUNDS,
                maxBoundsViscosity: 1.0,
                worldCopyJump: false
            }).fitBounds(APM_BOUNDS);

            // Keep the map snapped to the valid APM canvas while letting the
            // user zoom out far enough to see it in its entirety: the minimum
            // zoom is the level at which the whole canvas fits inside the
            // viewport (never below 5). It must be recalculated when the map
            // changes size (for example, when entering fullscreen or rotating
            // a mobile device).
            function enforceMapCanvasBounds() {
                var canvasMinZoom = Math.max(5, map.getBoundsZoom(MAP_PAN_BOUNDS, false));
                map.setMinZoom(canvasMinZoom);
                if (map.getZoom() < canvasMinZoom) {
                    map.setZoom(canvasMinZoom, { animate: false });
                }
                map.panInsideBounds(MAP_PAN_BOUNDS, { animate: false });
            }

            map.whenReady(enforceMapCanvasBounds);
            map.on('resize', enforceMapCanvasBounds);
            map.on('dragend zoomend', enforceMapCanvasBounds);

            var hash = new L.Hash(map);

            // Zoom control (top-left, styled via existing CSS)
            L.control.zoom({ position: 'topleft' }).addTo(map);

            // Locate control (plugin kept for API but button hidden; we use our own)
            L.control.locate({ locateOptions: { maxZoom: 19 }, position: 'topleft' }).addTo(map);

            // ── CUSTOM LIVE LOCATION BUTTON ──
            (function () {
                var locationMarker = null;
                var locationCircle = null;
                var watchId = null;

                // Build button and inject after zoom control
                var btn = document.createElement('div');
                btn.className = 'leaflet-control leaflet-bar';
                btn.style.cssText = 'margin-top:8px;border:none;box-shadow:none;background:none;';
                btn.innerHTML =
                    '<button id="btnLiveLocation" class="btn-live-location" title="My Location" aria-label="Toggle live location">' +
                    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">' +
                    '<circle cx="8" cy="8" r="3" fill="currentColor"/>' +
                    '<path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
                    '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2"/>' +
                    '</svg>' +
                    '</button>';

                // Wait for DOM to be ready then insert below zoom buttons
                setTimeout(function () {
                    var zoomCtrl = document.querySelector('#detectlab-map .leaflet-top.leaflet-left');
                    if (zoomCtrl) zoomCtrl.appendChild(btn);
                    // Attach listener directly on the button (not delegated) so Leaflet's
                    // internal stopPropagation on control containers can't swallow clicks.
                    var btnEl = document.getElementById('btnLiveLocation');
                    if (btnEl) {
                        L.DomEvent.on(btnEl, 'click', function (e) {
                            L.DomEvent.stopPropagation(e);  // prevent map click firing underneath
                            watchId !== null ? stopTracking() : startTracking();
                        });
                    }
                }, 200);

                function createMarker(lat, lng, accuracy) {
                    removeMarker();
                    var icon = L.divIcon({
                        className: '',
                        html: '<div class="live-location-marker"></div>',
                        iconSize: [16, 16],
                        iconAnchor: [8, 8]
                    });
                    locationMarker = L.marker([lat, lng], { icon: icon, zIndexOffset: 1000 })
                        .bindPopup('<div class="map-place-popup">You are here</div>')
                        .addTo(map);
                    if (accuracy && accuracy < 5000) {
                        locationCircle = L.circle([lat, lng], {
                            radius: accuracy,
                            color: '#C42B2B', fillColor: '#C42B2B',
                            fillOpacity: 0.08, weight: 1, opacity: 0.4
                        }).addTo(map);
                    }
                }

                function removeMarker() {
                    if (locationMarker) { map.removeLayer(locationMarker); locationMarker = null; }
                    if (locationCircle) { map.removeLayer(locationCircle); locationCircle = null; }
                }

                function startTracking() {
                    if (!navigator.geolocation) {
                        alert('Geolocation is not supported by your browser.');
                        return;
                    }
                    // watchId is the single source of truth — already guarded by the click handler
                    document.getElementById('btnLiveLocation').classList.add('active');
                    document.getElementById('btnLiveLocation').title = 'Stop tracking';
                    watchId = navigator.geolocation.watchPosition(
                        function (pos) {
                            var lat = pos.coords.latitude;
                            var lng = pos.coords.longitude;
                            var acc = pos.coords.accuracy;
                            createMarker(lat, lng, acc);
                            map.flyTo([lat, lng], Math.max(map.getZoom(), 14), { duration: 1.2 });
                            // Share coordinates with detection system so it can fire immediately
                            // even if the user activates detection after live location is already on
                            _detLat = lat;
                            _detLng = lng;
                            // Publish presence so other detectorists can see this user ONLY if we are in detecting mode.
                            // Otherwise, setting visible to false cleans up any stale records.
                            if (typeof publishDetectorPresence === 'function') {
                                publishDetectorPresence(lat, lng, _det.active);
                            }
                            if (_det.active) _detCheck(lat, lng);
                        },
                        function (err) {
                            console.warn('Location error:', err.message);
                            stopTracking();
                        },
                        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
                    );
                }

                function stopTracking() {
                    if (watchId !== null) {
                        navigator.geolocation.clearWatch(watchId);
                        watchId = null;
                    }
                    removeMarker();
                    var btn = document.getElementById('btnLiveLocation');
                    if (btn) {
                        btn.classList.remove('active');
                        btn.title = 'My Location';
                    }
                }

                // Expose globally so the detection switch can auto-activate live location
                window._startLiveLocation = startTracking;
                window._stopLiveLocation = stopTracking;
                window._isLiveLocationActive = function () { return watchId !== null; };

            })();

            // ── CUSTOM MEASURE BUTTON ──
            (function () {
                var measuring = false;
                var measurePoints = [];
                var measurePolyline = null;
                var measureMarkers = [];
                var measureTooltips = [];
                var totalDistance = 0;

                // Build button and inject after live location button
                var btnWrap = document.createElement('div');
                btnWrap.className = 'leaflet-control leaflet-bar';
                btnWrap.style.cssText = 'margin-top:8px;border:none;box-shadow:none;background:none;';
                btnWrap.innerHTML =
                    '<button id="btnMeasure" class="btn-measure" title="Măsoară distanța" aria-label="Activează măsurarea distanței în metri">' +
                    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">' +
                    '<line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
                    '<line x1="2" y1="14" x2="5" y2="11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
                    '<line x1="5" y1="8" x2="8" y2="5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
                    '<line x1="14" y1="2" x2="11" y2="5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
                    '<circle cx="2" cy="14" r="1.8" fill="currentColor"/>' +
                    '<circle cx="14" cy="2" r="1.8" fill="currentColor"/>' +
                    '</svg>' +
                    '</button>';

                setTimeout(function () {
                    var topLeft = document.querySelector('#detectlab-map .leaflet-top.leaflet-left');
                    if (topLeft) topLeft.appendChild(btnWrap);
                    var btnEl = document.getElementById('btnMeasure');
                    if (btnEl) {
                        L.DomEvent.on(btnEl, 'click', function (e) {
                            L.DomEvent.stopPropagation(e);
                            if (measuring) {
                                stopMeasure();
                            } else {
                                startMeasure();
                            }
                        });
                    }
                }, 250);

                function formatDistance(meters) {
                    if (meters >= 1000) {
                        return (meters / 1000).toFixed(2) + ' km';
                    }
                    return Math.round(meters) + ' m';
                }

                // Create a dedicated pane on top of everything for measure layers
                map.createPane('measurePane');
                map.getPane('measurePane').style.zIndex = 700;
                map.getPane('measurePane').style.pointerEvents = 'none';

                function clearMeasure() {
                    if (measurePolyline) { map.removeLayer(measurePolyline); measurePolyline = null; }
                    measureMarkers.forEach(function (m) { map.removeLayer(m); });
                    measureMarkers = [];
                    measureTooltips.forEach(function (t) { map.removeLayer(t); });
                    measureTooltips = [];
                    measurePoints = [];
                    totalDistance = 0;
                }

                function startMeasure() {
                    measuring = true;
                    clearMeasure();
                    var btn = document.getElementById('btnMeasure');
                    if (btn) {
                        btn.classList.add('active');
                        btn.title = 'Oprește măsurarea';
                    }
                    map.getContainer().style.cursor = 'crosshair';
                    map.on('click', onMapClick);
                    map.on('dblclick', onMapDblClick);
                }

                function stopMeasure() {
                    measuring = false;
                    map.off('click', onMapClick);
                    map.off('dblclick', onMapDblClick);
                    map.getContainer().style.cursor = '';
                    var btn = document.getElementById('btnMeasure');
                    if (btn) {
                        btn.classList.remove('active');
                        btn.title = 'Măsoară distanța';
                    }
                    // Clear all measure drawings from map
                    clearMeasure();
                }

                function makeDotIcon() {
                    return L.divIcon({
                        className: '',
                        html: '<div style="width:12px;height:12px;background:#E8772A;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.6);"></div>',
                        iconSize: [12, 12],
                        iconAnchor: [6, 6]
                    });
                }

                function onMapClick(e) {
                    L.DomEvent.stopPropagation(e);
                    var latlng = e.latlng;
                    measurePoints.push(latlng);

                    // Dot marker using divIcon on measurePane so it always renders on top
                    var dot = L.marker(latlng, {
                        icon: makeDotIcon(),
                        pane: 'measurePane',
                        zIndexOffset: 2000,
                        interactive: false
                    }).addTo(map);
                    measureMarkers.push(dot);

                    // Draw or extend polyline
                    if (measurePolyline) {
                        measurePolyline.setLatLngs(measurePoints);
                    } else {
                        measurePolyline = L.polyline(measurePoints, {
                            color: '#E8772A',
                            weight: 2.5,
                            dashArray: '6 4',
                            opacity: 0.95,
                            pane: 'measurePane'
                        }).addTo(map);
                    }

                    // Segment distance tooltip
                    if (measurePoints.length > 1) {
                        var prev = measurePoints[measurePoints.length - 2];
                        var segDist = latlng.distanceTo(prev);
                        totalDistance += segDist;

                        var mid = L.latLng(
                            (latlng.lat + prev.lat) / 2,
                            (latlng.lng + prev.lng) / 2
                        );
                        var tt = L.tooltip({ permanent: true, className: 'measure-tooltip', direction: 'top', offset: [0, -6] })
                            .setContent(formatDistance(segDist))
                            .setLatLng(mid)
                            .addTo(map);
                        measureTooltips.push(tt);

                        // Total tooltip on last dot
                        var ttTotal = L.tooltip({ permanent: true, className: 'measure-tooltip', direction: 'right', offset: [8, 0] })
                            .setContent('<span class="measure-tooltip-total">Total: ' + formatDistance(totalDistance) + '</span>')
                            .setLatLng(latlng)
                            .addTo(map);
                        measureTooltips.push(ttTotal);
                    }
                }

                function onMapDblClick(e) {
                    L.DomEvent.stopPropagation(e);
                    stopMeasure();
                }

            })();

            function escapeHtml(str) {
                if (!str) return '';
                return String(str)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
            }

            // ── CUSTOM COORD PIN BUTTON ──
            (function () {
                var coordActive = false;
                var coordMarker = null;
                var coordPopup = null;

                // Build the button element directly (no wrapper div)
                var coordBtn = document.createElement('button');
                coordBtn.id = 'btnCoord';
                coordBtn.className = 'btn-coord';
                coordBtn.title = 'Afișează coordonatele unui punct';
                coordBtn.setAttribute('aria-label', 'Activează afișarea coordonatelor');
                coordBtn.innerHTML =
                    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                    '<path d="M8 1C5.239 1 3 3.239 3 6c0 3.75 5 9 5 9s5-5.25 5-9c0-2.761-2.239-5-5-5z" stroke="currentColor" stroke-width="1.4" fill="none"/>' +
                    '<circle cx="8" cy="6" r="1.6" fill="currentColor"/>' +
                    '</svg>';

                // Build the track-recording button element directly (no wrapper div).
                // IMPORTANT: this element MUST be declared here, before it is appended
                // below (trackWrap.appendChild) and before the TRACK RECORDING LOGIC
                // closure attaches its click handler — otherwise initMap aborts with
                // "ReferenceError: trackBtn is not defined" and the whole map fails to
                // initialize (blank/white map).
                var trackBtn = document.createElement('button');
                trackBtn.id = 'btnTrack';
                trackBtn.className = 'btn-track';
                trackBtn.title = 'Înregistrează traseu';
                trackBtn.setAttribute('aria-label', 'Înregistrează un traseu GPS');
                trackBtn.innerHTML =
                    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                    '<circle cx="3.5" cy="3.5" r="1.8" fill="currentColor"/>' +
                    '<circle cx="12.5" cy="12.5" r="1.8" fill="currentColor"/>' +
                    '<path d="M5.2 5.2 L10.8 10.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-dasharray="1 2"/>' +
                    '</svg>';

                // Inject it into the same wrapper as btnMeasure (they share the same leaflet-bar div)
                setTimeout(function () {
                    var measureWrap = document.getElementById('btnMeasure') && document.getElementById('btnMeasure').parentNode;
                    if (measureWrap) {
                        // Insert a visual gap then the button
                        var gap = document.createElement('div');
                        gap.style.cssText = 'height:8px;';
                        measureWrap.parentNode.insertBefore(gap, measureWrap.nextSibling);
                        var newWrap = document.createElement('div');
                        newWrap.className = 'leaflet-control leaflet-bar';
                        newWrap.style.cssText = 'border:none!important;box-shadow:none!important;background:none!important;';
                        newWrap.appendChild(coordBtn);
                        gap.parentNode.insertBefore(newWrap, gap.nextSibling);

                        // Add footstep button right after coord button
                        var trackWrap = document.createElement('div');
                        trackWrap.className = 'leaflet-control leaflet-bar';
                        trackWrap.style.cssText = 'border:none!important;box-shadow:none!important;background:none!important;';
                        trackWrap.appendChild(trackBtn);
                        gap.parentNode.insertBefore(trackWrap, newWrap.nextSibling);
                    } else {
                        // Fallback: append directly to top-left
                        var topLeft = document.querySelector('#detectlab-map .leaflet-top.leaflet-left');
                        if (topLeft) {
                            var newWrap2 = document.createElement('div');
                            newWrap2.className = 'leaflet-control leaflet-bar';
                            newWrap2.style.cssText = 'margin-top:8px;border:none!important;box-shadow:none!important;background:none!important;';
                            newWrap2.appendChild(coordBtn);
                            topLeft.appendChild(newWrap2);
                        }
                    }
                    L.DomEvent.on(coordBtn, 'click', function (e) {
                        L.DomEvent.stopPropagation(e);
                        if (coordActive) { stopCoord(); } else { startCoord(); }
                    });
                }, 400);

                function startCoord() {
                    coordActive = true;
                    var btn = document.getElementById('btnCoord');
                    if (btn) {
                        btn.classList.add('active');
                        btn.title = 'Oprește afișarea coordonatelor';
                    }
                    map.getContainer().style.cursor = 'crosshair';
                    map.on('click', onCoordClick);
                }

                function stopCoord() {
                    coordActive = false;
                    map.off('click', onCoordClick);
                    map.getContainer().style.cursor = '';
                    var btn = document.getElementById('btnCoord');
                    if (btn) {
                        btn.classList.remove('active');
                        btn.title = 'Afișează coordonatele unui punct';
                    }
                    if (coordMarker) { map.removeLayer(coordMarker); coordMarker = null; }
                    if (coordPopup) { map.closePopup(coordPopup); coordPopup = null; }
                }

                function onCoordClick(e) {
                    L.DomEvent.stopPropagation(e);
                    var lat = e.latlng.lat.toFixed(6);
                    var lng = e.latlng.lng.toFixed(6);

                    if (coordMarker) { map.removeLayer(coordMarker); }
                    coordMarker = L.marker(e.latlng, {
                        icon: L.divIcon({
                            className: '',
                            html: '<div style="width:10px;height:10px;background:#B8D8F0;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(0,0,0,0.6);margin-top:-5px;margin-left:-5px;"></div>',
                            iconSize: [0, 0]
                        }),
                        zIndexOffset: 900
                    }).addTo(map);

                    var popupContent = createCoordPopupContent(lat, lng);

                    if (coordPopup) { map.closePopup(coordPopup); }
                    coordPopup = L.popup({ className: 'coord-popup', closeOnClick: false, autoClose: false })
                        .setLatLng(e.latlng)
                        .setContent(popupContent)
                        .openOn(map);
                }

                // ── TRACK RECORDING LOGIC ──
                (function () {
                    var isTracking = false;
                    var trackPoints = [];
                    var trackPolyline = null;
                    var trackWatchId = null;
                    var trackStartTime = null;

                    function startTrackingPath() {
                        if (isTracking) return;
                        isTracking = true;
                        trackPoints = [];
                        trackStartTime = Date.now();

                        if (trackPolyline) map.removeLayer(trackPolyline);
                        trackPolyline = null;

                        trackBtn.classList.add('active');
                        trackBtn.title = 'Oprește înregistrarea traseului';

                        if (!navigator.geolocation) {
                            alert('Geolocation not supported');
                            stopTrackingPath();
                            return;
                        }

                        trackWatchId = navigator.geolocation.watchPosition(
                            function (pos) {
                                var lat = pos.coords.latitude;
                                var lng = pos.coords.longitude;
                                trackPoints.push([lat, lng]);

                                if (trackPolyline) {
                                    trackPolyline.setLatLngs(trackPoints);
                                } else {
                                    trackPolyline = L.polyline(trackPoints, {
                                        color: '#E8772A',
                                        weight: 3,
                                        opacity: 0.85
                                    }).addTo(map);
                                }

                                // Auto-stop after 10 hours
                                if (Date.now() - trackStartTime > 10 * 60 * 60 * 1000) {
                                    stopTrackingPath(true);
                                }
                            },
                            function (err) {
                                console.warn('Track error:', err);
                            },
                            { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
                        );
                    }

                    function stopTrackingPath(auto = false) {
                        if (!isTracking) return;
                        isTracking = false;

                        if (trackWatchId !== null) {
                            navigator.geolocation.clearWatch(trackWatchId);
                            trackWatchId = null;
                        }

                        trackBtn.classList.remove('active');
                        trackBtn.title = 'Înregistrează traseu';

                        if (trackPoints.length < 2) {
                            if (trackPolyline) map.removeLayer(trackPolyline);
                            trackPolyline = null;
                            trackPoints = [];
                            return;
                        }

                        // Save to Supabase
                        saveTrackToSupabase(trackPoints, auto);
                    }

                    async function saveTrackToSupabase(points, autoStopped) {
                        try {
                            if (!window.supabaseClient) return;

                            const userRes = await window.supabaseClient.auth.getUser();
                            if (!userRes.data || !userRes.data.user) return;

                            const payload = {
                                path: points,
                                started_at: new Date(trackStartTime).toISOString(),
                                ended_at: new Date().toISOString(),
                                auto_stopped: autoStopped
                            };

                            await window.supabaseClient.from('user_tracks').insert(payload);
                            console.log('[Track] Path saved to Supabase');
                        } catch (e) {
                            console.error('[Track] Failed to save path:', e);
                        }
                    }

                    // Click handler
                    L.DomEvent.on(trackBtn, 'click', function (e) {
                        L.DomEvent.stopPropagation(e);
                        if (isTracking) {
                            stopTrackingPath();
                        } else {
                            startTrackingPath();
                        }
                    });

                    // Expose for debugging
                    window._trackPath = { start: startTrackingPath, stop: stopTrackingPath };
                })();

                function createCoordPopupContent(lat, lng) {
                    var content = document.createElement('div');
                    content.innerHTML =
                        '<div class="coord-popup-title">📍 Coordonate</div>' +
                        '<div class="coord-popup-row"><span class="coord-popup-label">Lat:</span><span class="coord-popup-val" title="Click pentru selecție">' + lat + '</span></div>' +
                        '<div class="coord-popup-row"><span class="coord-popup-label">Lng:</span><span class="coord-popup-val" title="Click pentru selecție">' + lng + '</span></div>' +
                        '<div style="margin-top: 6px; display: flex; flex-direction: column; gap: 4px;">' +
                        '<input type="text" id="coordTitleInput" placeholder="Titlu pin (opțional)" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(184,216,240,0.25); border-radius: 4px; padding: 4px 6px; color: #F5F0EB; font-size: 0.76rem; font-family: \'Outfit\', sans-serif; width: 100%; box-sizing: border-box;" autocomplete="off">' +
                        '<textarea id="coordDescInput" placeholder="Descriere / Note (opțional)" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(184,216,240,0.25); border-radius: 4px; padding: 4px 6px; color: #F5F0EB; font-size: 0.76rem; font-family: \'Outfit\', sans-serif; width: 100%; height: 40px; resize: none; box-sizing: border-box;" autocomplete="off"></textarea>' +
                        '</div>' +
                        '<button type="button" class="coord-popup-copy">Copiază coordonatele</button>' +
                        '<button type="button" class="coord-popup-save" aria-label="Salvează coordonatele în contul tău">' +
                        '<svg class="coord-popup-save-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
                        '<path d="M2.25 1.5h9.1l2.4 2.4v10.6H2.25v-13Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>' +
                        '<path d="M5 1.5v4h6v-4M5 14.5V9h6v5.5" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>' +
                        '<circle cx="9.6" cy="3.5" r=".7" fill="currentColor"/>' +
                        '</svg>' +
                        '<span class="coord-popup-save-label">Salvează</span>' +
                        '</button>' +
                        '<div class="coord-popup-status" role="status" aria-live="polite"></div>';

                    var copyButton = content.querySelector('.coord-popup-copy');
                    var saveButton = content.querySelector('.coord-popup-save');
                    var titleInput = content.querySelector('#coordTitleInput');
                    var descInput = content.querySelector('#coordDescInput');
                    var status = content.querySelector('.coord-popup-status');
                    var coordinatesText = lat + ', ' + lng;

                    copyButton.addEventListener('click', function () {
                        copyCoordinates(coordinatesText, copyButton);
                    });

                    saveButton.addEventListener('click', function () {
                        var titleVal = titleInput ? titleInput.value.trim() : '';
                        var descVal = descInput ? descInput.value.trim() : '';
                        saveCoordinates(Number(lat), Number(lng), titleVal, descVal, saveButton, status);
                    });

                    return content;
                }

                function copyCoordinates(text, button) {
                    function showCopied() {
                        button.textContent = '✓ Copiat!';
                        setTimeout(function () {
                            if (button.isConnected) button.textContent = 'Copiază coordonatele';
                        }, 1500);
                    }

                    function legacyCopy() {
                        var textArea = document.createElement('textarea');
                        textArea.value = text;
                        textArea.style.position = 'fixed';
                        textArea.style.opacity = '0';
                        document.body.appendChild(textArea);
                        textArea.select();
                        try {
                            document.execCommand('copy');
                            showCopied();
                        } finally {
                            document.body.removeChild(textArea);
                        }
                    }

                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(text).then(showCopied).catch(legacyCopy);
                    } else {
                        legacyCopy();
                    }
                }

                async function saveCoordinates(lat, lng, title, description, button, status) {
                    var label = button.querySelector('.coord-popup-save-label');
                    button.disabled = true;
                    button.classList.remove('saved', 'error');
                    label.textContent = 'Se salvează…';
                    status.textContent = '';
                    status.className = 'coord-popup-status';

                    try {
                        if (!window.supabaseClient || !window.supabaseClient.auth) {
                            throw new Error('Supabase nu este disponibil momentan.');
                        }

                        // Verify the session before inserting. The database fills user_id
                        // from auth.uid(), and its RLS policy only permits the owner to save.
                        var userResult = await window.supabaseClient.auth.getUser();
                        if (userResult.error || !userResult.data || !userResult.data.user) {
                            if (typeof window.openAuth === 'function') window.openAuth('login');
                            throw new Error('Autentifică-te pentru a salva coordonatele.');
                        }

                        var insertData = {
                            latitude: lat,
                            longitude: lng
                        };
                        if (title) insertData.title = title;
                        if (description) insertData.description = description;

                        var insertResult = await window.supabaseClient
                            .from('saved_coordinates')
                            .insert(insertData);

                        if (insertResult.error) throw insertResult.error;

                        button.classList.add('saved');
                        label.textContent = 'Salvat!';
                        status.textContent = 'Coordonatele au fost salvate.';
                        status.classList.add('success');
                    } catch (err) {
                        console.error('Nu s-au putut salva coordonatele:', err);
                        button.disabled = false;
                        button.classList.add('error');
                        label.textContent = 'Încearcă din nou';
                        status.textContent = err && err.message
                            ? err.message
                            : 'Salvarea a eșuat. Încearcă din nou.';
                        status.classList.add('error');
                    }
                }
            })();

            // ── SAVED LOCATIONS ─────────────────────────────────────────────
            // This layer is intentionally separate from the one-off coordinate
            // marker above. It is populated only while the memory-card control
            // is active, so turning the control off immediately removes every
            // saved pin from the map.
            (function () {
                var savedLocationsLayer = L.layerGroup();
                var savedPathsLayer = L.layerGroup();

                // Master button state (memory-card button). Pins and paths are
                // independent sublayers controlled by the checkboxes panel.
                var savedPanelActive = false;
                var savedPinsVisible = false;
                var savedPinsLoading = false;
                var savedPathsVisible = false;
                var savedPathsLoading = false;
                var savedSwitchesContainer = null;
                var savedSwitchesStatus = null;

                function setControlState(active) {
                    ['savedLocationsBtn', 'pwaSavedLocationsBtn'].forEach(function (id) {
                        var button = document.getElementById(id);
                        if (!button) return;
                        button.classList.toggle('is-active', active);
                        button.setAttribute('aria-pressed', active ? 'true' : 'false');
                        button.title = active ? 'Hide saved locations' : 'Show saved locations';
                    });
                }

                function setSavedStatus(text, type) {
                    if (!savedSwitchesStatus) return;
                    savedSwitchesStatus.textContent = text || '';
                    savedSwitchesStatus.style.display = text ? 'block' : 'none';
                    savedSwitchesStatus.style.color = type === 'error' ? '#FFB09F' : 'rgba(184,216,240,0.72)';
                }

                function updateSavedSwitches() {
                    var pinsInput = document.getElementById('switchSavedPins');
                    if (pinsInput) {
                        pinsInput.checked = !!savedPinsVisible;
                        pinsInput.disabled = !!savedPinsLoading;
                    }
                    var pathsInput = document.getElementById('switchSavedPaths');
                    if (pathsInput) {
                        pathsInput.checked = !!savedPathsVisible;
                        pathsInput.disabled = !!savedPathsLoading;
                    }
                }

                async function getSavedLocationsUser() {
                    if (!window.supabaseClient || !window.supabaseClient.auth) return null;

                    // Let the central auth bootstrap finish when possible. This
                    // prevents a click during startup from looking like a signed
                    // out state and silently doing nothing.
                    if (window._authReadyPromise) {
                        try {
                            await Promise.race([
                                window._authReadyPromise,
                                new Promise(function (resolve) { setTimeout(resolve, 1800); })
                            ]);
                        } catch (e) {}
                    }

                    // Prefer the cached local session for responsiveness in PWA
                    // mode; fall back to getUser() for projects/browsers where
                    // getSession() is not enough.
                    try {
                        var sessionRes = await window.supabaseClient.auth.getSession();
                        var session = sessionRes && sessionRes.data ? sessionRes.data.session : null;
                        if (session && session.user) return session.user;
                    } catch (e) {}

                    try {
                        var userRes = await Promise.race([
                            window.supabaseClient.auth.getUser(),
                            new Promise(function (_, reject) {
                                setTimeout(function () { reject(new Error('Auth timeout')); }, 6000);
                            })
                        ]);
                        if (userRes && userRes.data && userRes.data.user) return userRes.data.user;
                    } catch (e) {
                        console.warn('Could not verify saved-locations session:', e);
                    }
                    return null;
                }

                function makeSavedLocationMarker(row) {
                    var rawLat = row.latitude !== undefined ? row.latitude : row.lat;
                    var rawLng = row.longitude !== undefined ? row.longitude : row.lng;
                    var lat = Number(rawLat);
                    var lng = Number(rawLng);
                    if (!isFinite(lat) || !isFinite(lng)) return null;

                    var title = row.title ? escapeHtml(row.title) : 'Punct salvat';
                    var desc = row.description ? escapeHtml(row.description) : '';
                    var savedAt = row.created_at ? new Date(row.created_at) : null;

                    var marker = L.marker([lat, lng], {
                        icon: L.divIcon({
                            className: 'saved-location-marker-wrap',
                            html: '<div class="saved-location-marker" title="' + title + '">' +
                                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                                '<path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11Z"/>' +
                                '<circle cx="12" cy="10" r="2.3"/>' +
                                '</svg></div>',
                            iconSize: [28, 36],
                            iconAnchor: [14, 34],
                            popupAnchor: [0, -34]
                        }),
                        zIndexOffset: 850
                    });

                    var popupContainer = document.createElement('div');
                    popupContainer.className = 'map-place-popup';
                    popupContainer.style.cssText = 'min-width: 180px;';

                    var html = '<strong style="font-size:0.86rem; color:#F5F0EB;">' + title + '</strong>';
                    if (desc) {
                        html += '<p style="margin: 4px 0 6px 0; font-size:0.78rem; color:rgba(245,240,235,0.85); line-height:1.3;">' + desc.replace(/\n/g, '<br>') + '</p>';
                    }
                    html += '<div style="font-size:0.72rem; color:rgba(184,216,240,0.6); margin-top:2px;">' +
                        lat.toFixed(6) + ', ' + lng.toFixed(6) +
                        (savedAt && !isNaN(savedAt.getTime()) ? '<br><small>' + savedAt.toLocaleString() + '</small>' : '') +
                        '</div>' +
                        '<button type="button" class="coord-popup-delete" style="margin-top:8px; width:100%; background:rgba(232,80,42,0.25); border:1px solid rgba(232,80,42,0.5); border-radius:4px; color:#FFB09F; font-size:0.72rem; font-family:\'Outfit\',sans-serif; padding:4px 0; cursor:pointer; font-weight:500;">Șterge pinul</button>';

                    popupContainer.innerHTML = html;

                    var deleteBtn = popupContainer.querySelector('.coord-popup-delete');
                    deleteBtn.addEventListener('click', async function () {
                        if (!confirm('Sigur doriți să ștergeți acest pin salvat?')) return;
                        deleteBtn.disabled = true;
                        deleteBtn.textContent = 'Se șterge…';
                        try {
                            if (!window.supabaseClient) throw new Error('Supabase indisponibil');
                            if (!row.id) throw new Error('Acest pin nu are ID pentru ștergere.');
                            var delRes = await window.supabaseClient
                                .from('saved_coordinates')
                                .delete()
                                .eq('id', row.id);
                            if (delRes.error) throw delRes.error;

                            savedLocationsLayer.removeLayer(marker);
                        } catch (err) {
                            console.error('Nu s-a putut șterge pinul:', err);
                            deleteBtn.disabled = false;
                            deleteBtn.textContent = 'Eroare. Încearcă din nou';
                        }
                    });

                    marker.bindPopup(popupContainer);
                    return marker;
                }

                function normalizePathPoints(points) {
                    if (typeof points === 'string') {
                        try { points = JSON.parse(points); } catch (e) { return []; }
                    }
                    if (!Array.isArray(points)) return [];
                    var out = [];
                    points.forEach(function (pt) {
                        if (Array.isArray(pt) && pt.length >= 2) {
                            out.push([Number(pt[0]), Number(pt[1])]);
                        } else if (pt && typeof pt === 'object') {
                            var lat = pt.lat !== undefined ? pt.lat : (pt.latitude !== undefined ? pt.latitude : pt.y);
                            var lng = pt.lng !== undefined ? pt.lng : (pt.longitude !== undefined ? pt.longitude : pt.x);
                            out.push([Number(lat), Number(lng)]);
                        }
                    });
                    return out.filter(function (pt) {
                        return isFinite(pt[0]) && isFinite(pt[1]);
                    });
                }

                function createSavedPathPolyline(points) {
                    var normalized = normalizePathPoints(points);
                    if (normalized.length < 2) return null;
                    return L.polyline(normalized, {
                        color: '#E8772A',
                        weight: 3,
                        opacity: 0.75
                    });
                }

                function showSavedSwitches() {
                    if (savedSwitchesContainer) {
                        updateSavedSwitches();
                        return;
                    }

                    savedSwitchesContainer = document.createElement('div');
                    savedSwitchesContainer.id = 'saved-switches';
                    savedSwitchesContainer.style.cssText =
                        'position:absolute;bottom:60px;left:12px;z-index:1200;' +
                        'background:rgba(6,14,30,0.92);border:1px solid rgba(184,216,240,0.2);' +
                        'border-radius:8px;padding:8px 12px;display:flex;flex-direction:column;gap:8px;' +
                        'font-size:0.75rem;color:#B8D8F0;box-shadow:0 8px 24px rgba(0,0,0,0.35);';

                    var pinsRow = document.createElement('label');
                    pinsRow.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;';
                    pinsRow.innerHTML = '<input type="checkbox" id="switchSavedPins">' +
                        '<span>Memorised pins</span>';
                    pinsRow.querySelector('input').onchange = async function () {
                        if (this.checked) {
                            await loadAndShowSavedPins();
                        } else {
                            savedPinsVisible = false;
                            savedLocationsLayer.clearLayers();
                            if (map.hasLayer(savedLocationsLayer)) map.removeLayer(savedLocationsLayer);
                            updateSavedSwitches();
                        }
                    };

                    var pathsRow = document.createElement('label');
                    pathsRow.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;';
                    pathsRow.innerHTML = '<input type="checkbox" id="switchSavedPaths">' +
                        '<span>Memorised paths</span>';
                    pathsRow.querySelector('input').onchange = async function () {
                        if (this.checked) {
                            await loadAndShowSavedPaths();
                        } else {
                            savedPathsVisible = false;
                            savedPathsLayer.clearLayers();
                            if (map.hasLayer(savedPathsLayer)) map.removeLayer(savedPathsLayer);
                            updateSavedSwitches();
                        }
                    };

                    savedSwitchesStatus = document.createElement('div');
                    savedSwitchesStatus.style.cssText = 'display:none;font-size:0.68rem;line-height:1.25;max-width:180px;';

                    savedSwitchesContainer.appendChild(pinsRow);
                    savedSwitchesContainer.appendChild(pathsRow);
                    savedSwitchesContainer.appendChild(savedSwitchesStatus);

                    var mapEl = document.getElementById('detectlab-map');
                    if (mapEl) mapEl.appendChild(savedSwitchesContainer);
                    updateSavedSwitches();
                }

                function removeSavedSwitches() {
                    if (savedSwitchesContainer) {
                        savedSwitchesContainer.remove();
                        savedSwitchesContainer = null;
                        savedSwitchesStatus = null;
                    }
                }

                async function loadAndShowSavedPins() {
                    if (savedPinsLoading) return;
                    savedPinsLoading = true;
                    setSavedStatus('Loading saved pins…');
                    updateSavedSwitches();

                    try {
                        var user = await getSavedLocationsUser();
                        if (!user) {
                            if (typeof window.openAuth === 'function') window.openAuth('login');
                            throw new Error('Log in to view saved pins.');
                        }

                        var result = await window.supabaseClient
                            .from('saved_coordinates')
                            .select('*')
                            .order('created_at', { ascending: false });
                        if (result.error) {
                            // Some older/manual tables may not have created_at;
                            // still show pins instead of failing the whole panel.
                            result = await window.supabaseClient
                                .from('saved_coordinates')
                                .select('*');
                        }
                        if (result.error) throw result.error;

                        if (!savedPanelActive) return;

                        savedLocationsLayer.clearLayers();
                        (result.data || []).forEach(function (row) {
                            var marker = makeSavedLocationMarker(row);
                            if (marker) savedLocationsLayer.addLayer(marker);
                        });
                        savedLocationsLayer.addTo(map);
                        savedPinsVisible = true;
                        setSavedStatus((result.data && result.data.length) ? '' : 'No saved pins yet.');
                    } catch (err) {
                        console.error('Could not load saved locations:', err);
                        savedPinsVisible = false;
                        savedLocationsLayer.clearLayers();
                        if (map.hasLayer(savedLocationsLayer)) map.removeLayer(savedLocationsLayer);
                        setSavedStatus((err && err.message) ? err.message : 'Could not load saved pins.', 'error');
                    } finally {
                        savedPinsLoading = false;
                        updateSavedSwitches();
                    }
                }

                async function loadAndShowSavedPaths() {
                    if (savedPathsLoading) return;
                    savedPathsLoading = true;
                    setSavedStatus('Loading saved paths…');
                    updateSavedSwitches();

                    try {
                        var user = await getSavedLocationsUser();
                        if (!user) {
                            if (typeof window.openAuth === 'function') window.openAuth('login');
                            throw new Error('Log in to view saved paths.');
                        }

                        var result = await window.supabaseClient
                            .from('user_tracks')
                            .select('*')
                            .order('started_at', { ascending: false })
                            .limit(20);
                        if (result.error) {
                            // Keep compatibility with older/manual tables that
                            // do not expose started_at yet.
                            result = await window.supabaseClient
                                .from('user_tracks')
                                .select('*')
                                .limit(20);
                        }
                        if (result.error) throw result.error;

                        if (!savedPanelActive) return;

                        savedPathsLayer.clearLayers();
                        (result.data || []).forEach(function (row) {
                            var poly = createSavedPathPolyline(row.path);
                            if (poly) savedPathsLayer.addLayer(poly);
                        });
                        savedPathsLayer.addTo(map);
                        savedPathsVisible = true;
                        setSavedStatus((result.data && result.data.length) ? '' : 'No saved paths yet.');
                    } catch (err) {
                        console.error('Failed to load saved paths:', err);
                        savedPathsVisible = false;
                        savedPathsLayer.clearLayers();
                        if (map.hasLayer(savedPathsLayer)) map.removeLayer(savedPathsLayer);
                        setSavedStatus((err && err.message) ? err.message : 'Could not load saved paths.', 'error');
                    } finally {
                        savedPathsLoading = false;
                        updateSavedSwitches();
                    }
                }

                // ── TOGGLE SAVED LOCATIONS + PATHS ──
                window.toggleSavedCoordinates = async function () {
                    if (savedPanelActive) {
                        savedPanelActive = false;
                        savedPinsVisible = false;
                        savedPathsVisible = false;
                        savedLocationsLayer.clearLayers();
                        savedPathsLayer.clearLayers();
                        if (map.hasLayer(savedLocationsLayer)) map.removeLayer(savedLocationsLayer);
                        if (map.hasLayer(savedPathsLayer)) map.removeLayer(savedPathsLayer);
                        setControlState(false);
                        removeSavedSwitches();
                        return;
                    }

                    if (!window.supabaseClient || !window.supabaseClient.auth) {
                        console.error('Supabase is unavailable; saved locations cannot be loaded.');
                        return;
                    }

                    savedPanelActive = true;
                    setControlState(true);
                    showSavedSwitches();

                    // Default action of the memory-card button: show saved pins.
                    // The paths checkbox stays available even if pins fail to load.
                    await loadAndShowSavedPins();
                    if (!savedPanelActive) return;
                    setControlState(true);
                    updateSavedSwitches();
                };
            })();

            map.createPane('pane_satellite');
            map.getPane('pane_satellite').style.zIndex = 400;
            var satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                pane: 'pane_satellite',
                opacity: 1.0,
                attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
                minZoom: 1,
                // maxZoom must reach the map's own max (20): with maxZoom 19 Leaflet
                // removed every satellite tile as soon as the map hit z20, leaving a
                // fully white base map. maxNativeZoom 19 makes z20 reuse scaled z19 tiles.
                maxZoom: 20,
                maxNativeZoom: 19
            }).addTo(map);
            window._satLayer = satelliteLayer;

            // ── OSM PLACES (ArcGIS FeatureServer Layer 6 — REST query, nu tile) ──
            // FeatureServer/tile nu este activat pe acest serviciu (HTTP 400).
            // Folosim query REST direct: fetch features pe bbox vizibil, randăm ca L.circleMarker.
            map.createPane('pane_osm_places');
            map.getPane('pane_osm_places').style.zIndex = 401; // imediat deasupra satellite (400)

            var _osmPlacesGroup = L.layerGroup([], { pane: 'pane_osm_places' });
            var _osmPlacesVisible = false;
            var _osmPlacesOpacity = 1.0;
            var _osmPlacesFetching = false;
            var _osmPlacesRenderedIds = {};

            // Sursa de date e cea încărcată mai sus în OSM_GEOJSON_URL / loadOsmGeojson().

            // Clasificare fclass -> culoare și raza markerului
            function _osmPlaceStyle(fclass, pop) {
                var r = 5, color = '#B8D8F0';
                if (fclass === 'city')            { r = 9;  color = '#FFD700'; }
                else if (fclass === 'town')       { r = 7;  color = '#FFA040'; }
                else if (fclass === 'suburb' || fclass === 'village') { r = 5; color = '#B8D8F0'; }
                else if (fclass === 'hamlet' || fclass === 'locality') { r = 4; color = '#8ab4d4'; }
                else                             { r = 4;  color = '#8ab4d4'; }
                return { r: r, color: color };
            }

            var OSM_LABEL_ZOOM = 11; // zoom minim pentru afișarea layerului

            // Icon transparent — doar eticheta text apare pe hartă
            var _osmLabelIcon = L.divIcon({ className: '', iconSize: [0, 0], iconAnchor: [0, 0] });

            function _osmBuildMarker(feat) {
                var coords = feat.geometry && feat.geometry.coordinates;
                if (!coords) return null;
                var props = feat.properties || {};
                var name = props.name || props.NAME || '';
                var fclass = props.fclass || props.type || '';
                var pop = (props.population || props.pop) ? ' · ' + (props.population || props.pop).toLocaleString() + ' loc.' : '';
                var m = L.marker([coords[1], coords[0]], {
                    pane: 'pane_osm_places',
                    icon: _osmLabelIcon,
                    interactive: false
                });
                if (name) m.bindTooltip(name, { permanent: true, direction: 'center', className: 'osm-places-tooltip', offset: [0, 0] });
                return m;
            }

            function _osmPlacesFetch() {
                if (!_osmPlacesVisible || _osmPlacesFetching) return;
                var bounds = map.getBounds();
                var sw = bounds.getSouthWest(), ne = bounds.getNorthEast();

                _osmPlacesFetching = true;
                loadOsmGeojson()
                    .then(function (features) {
                        _osmPlacesFetching = false;
                        for (var i = 0; i < features.length; i++) {
                            var feat = features[i];
                            var coords = feat.geometry && feat.geometry.coordinates;
                            if (!coords) continue;
                            var lon = coords[0], lat = coords[1];
                            // Filtrăm doar punctele aflate în viewport-ul curent
                            if (lat < sw.lat || lat > ne.lat || lon < sw.lng || lon > ne.lng) continue;

                            var props = feat.properties || {};
                            var fid = props.fid != null ? props.fid
                                    : (props.osm_id != null ? props.osm_id
                                    : (lon + '_' + lat + '_' + (props.name || props.NAME || '')));
                            if (!fid || _osmPlacesRenderedIds[fid]) continue;
                            _osmPlacesRenderedIds[fid] = true;
                            var m = _osmBuildMarker(feat);
                            if (m) _osmPlacesGroup.addLayer(m);
                        }
                    })
                    .catch(function () { _osmPlacesFetching = false; });
            }

            // La zoom change: ascunde sub zoom 11, arată și rerandează la >= 11
            map.on('zoomend', function() {
                if (!_osmPlacesVisible) return;
                if (map.getZoom() < OSM_LABEL_ZOOM) {
                    _osmPlacesGroup.clearLayers();
                    _osmPlacesRenderedIds = {};
                } else {
                    _osmPlacesGroup.clearLayers();
                    _osmPlacesRenderedIds = {};
                    _osmPlacesFetch();
                }
            });

            // Re-fetch la moveend doar dacă zoom e suficient
            map.on('moveend', function() {
                if (_osmPlacesVisible && map.getZoom() >= OSM_LABEL_ZOOM) _osmPlacesFetch();
            });

            window.toggleOsmPlacesLayer = function(on) {
                _osmPlacesVisible = on;
                if (on) {
                    _osmPlacesGroup.addTo(map);
                    if (map.getZoom() >= OSM_LABEL_ZOOM) _osmPlacesFetch();
                } else {
                    map.removeLayer(_osmPlacesGroup);
                    _osmPlacesGroup.clearLayers();
                    _osmPlacesRenderedIds = {};
                }
            };

            window.setOsmPlacesOpacity = function(val) {
                var pct = parseInt(val, 10);
                _osmPlacesOpacity = pct / 100;
                var el = document.getElementById('osmPlacesPct');
                if (el) el.textContent = pct + '%';
                _osmPlacesGroup.eachLayer(function(m) {
                    m.setStyle({
                        opacity: _osmPlacesOpacity,
                        fillOpacity: _osmPlacesOpacity * 0.75
                    });
                });
            };

            window._osmPlacesGroup = _osmPlacesGroup;

            // ── UAT LAYER — tile-uri raster PNG de pe Cloudflare R2 ──
            // (negru = clădire, alb = fără clădire). Extindem L.TileLayer și recolorăm
            // fiecare tile pe un <canvas>: negru → roșu semi-transparent (același stil
            // vizual ca vechiul strat GeoJSON), alb → complet transparent, ca harta de
            // bază să rămână vizibilă dedesubt. NOTĂ: necesită CORS activat pe bucket-ul
            // R2 (GET, orice origine sau domeniul site-ului) — altfel getImageData
            // aruncă SecurityError și tile-ul rămâne needesenat (vezi consola).
            var UatCanvasLayer = L.TileLayer.extend({
                createTile: function (coords, done) {
                    var tile = document.createElement('canvas');
                    var size = this.getTileSize();
                    tile.width = size.x; tile.height = size.y;
                    var ctx = tile.getContext('2d');
                    var url = this.getTileUrl(coords);

                    function drawRecolored(img) {
                        // Poate arunca SecurityError dacă imaginea a fost încărcată FĂRĂ CORS
                        // (canvas "tainted") — apelantul prinde eroarea și face fallback.
                        ctx.drawImage(img, 0, 0, tile.width, tile.height);
                        var imgData = ctx.getImageData(0, 0, tile.width, tile.height);
                        var px = imgData.data;
                        for (var i = 0; i < px.length; i += 4) {
                            if (_uatIsBuildingPixel(px[i], px[i + 1], px[i + 2], px[i + 3])) {
                                px[i] = 255; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 140; // clădire → roșu
                            } else {
                                px[i + 3] = 0; // fără clădire → complet transparent
                            }
                        }
                        ctx.putImageData(imgData, 0, 0);
                    }

                    function tryLoad(useCORS) {
                        var img = new Image();
                        var loadUrl = url;
                        if (useCORS) {
                            img.crossOrigin = 'anonymous';
                        } else {
                            // Cache-bust ca să nu reutilizăm din cache-ul browserului varianta
                            // CORS eșuată (unele browsere țin în cache răspunsul "opac" separat,
                            // dar mai bine sigur decât regret aici).
                            loadUrl += (url.indexOf('?') === -1 ? '?' : '&') + '_uatNoCors=1';
                        }
                        img.onload = function () {
                            try {
                                drawRecolored(img);
                            } catch (e) {
                                if (useCORS) {
                                    // Canvas "tainted" în ciuda crossOrigin (rar) — reîncercăm fără
                                    // CORS ca măcar tile-ul brut (nerecolorat) să fie vizibil.
                                    console.warn('[UAT] Recolorare eșuată cu CORS, reîncerc fără CORS (tile va fi vizibil nerecolorat):', e.message);
                                    tryLoad(false);
                                    return;
                                }
                                // Deja fără CORS și tot nu putem citi pixelii → desenăm imaginea
                                // brută, necolorată, ca măcar stratul să fie vizibil pe hartă.
                                console.warn('[UAT] Nu pot recolora tile-ul (CORS indisponibil pe bucket-ul R2) — afișez tile-ul brut, necolorat:', e.message);
                                try { ctx.clearRect(0, 0, tile.width, tile.height); ctx.drawImage(img, 0, 0, tile.width, tile.height); } catch (e2) {}
                            }
                            done(null, tile);
                        };
                        img.onerror = function () {
                            if (useCORS) {
                                // CORS a picat (header lipsă, eroare de rețea etc.) — reîncercăm
                                // fără crossOrigin ca tile-ul să apară totuși pe hartă, chiar dacă
                                // pixelii n-ar mai putea fi citiți pentru recolorare.
                                tryLoad(false);
                                return;
                            }
                            done(null, tile); // tile lipsă (404) → rămâne gol, nu blocăm harta
                        };
                        img.src = loadUrl;
                    }
                    tryLoad(true);
                    return tile;
                }
            });

            (function () {
                map.createPane('pane_uat');
                map.getPane('pane_uat').style.zIndex = 402; // deasupra OSM Places (401)

                var _uatLayer = new UatCanvasLayer(UAT_TILE_URL, {
                    pane: 'pane_uat',
                    maxNativeZoom: UAT_TILE_Z,
                    tileSize: UAT_TILE_SIZE,
                    tms: true, // tile-uri generate cu gdal2tiles.py (schema TMS) — Leaflet face conversia automat la XYZ
                    opacity: 0.9
                });

                window._uatLayer = _uatLayer;
                // Adăugăm pe hartă DOAR dacă checkbox-ul e deja bifat la încărcare —
                // înainte layerul se adăuga necondiționat, indiferent de starea reală a
                // switch-ului din UI (bug vechi, moștenit din versiunea GeoJSON).
                var _uatToggleEl = document.getElementById('uatToggle');
                if (_uatToggleEl && _uatToggleEl.checked) {
                    _uatLayer.addTo(map);
                }

                window.toggleUatLayer = function (on) {
                    // Nu se poate reactiva vizual cât timp Harta Iosefină + (premium) e
                    // activă — vezi window.toggleJosephineLayer, care apelează
                    // _uatForceHide(). Logica de excludere clădiri actuale (fundal) merge
                    // mai departe indiferent, prin uatHasBuildingNear / _uatGetTile.
                    if (on && window._uatSuppressedByJosephine) return;
                    if (on) {
                        _uatLayer.addTo(map);
                    } else {
                        map.removeLayer(_uatLayer);
                    }
                };

                // Ascunde forțat stratul vizual UAT (folosit când se activează Harta
                // Iosefină + premium) — NU afectează deloc logica de fundal (clădiri
                // dispărute), care nu depinde de _uatLayer, ci citește direct tile-urile
                // raster prin uatHasBuildingNear.
                window._uatForceHide = function () {
                    if (map.hasLayer(_uatLayer)) map.removeLayer(_uatLayer);
                    var el = document.getElementById('uatToggle');
                    if (el) el.checked = false;
                };

                // Sincronizare robustă cu vizibilitatea reală a Hărții Iosefine + —
                // ascultăm direct evenimentele Leaflet ale layerului (nu funcțiile de
                // toggle), ca să acoperim orice cale de cod care îl afișează/ascunde
                // (toggleJosephineLayer, toggleHistLayer, eventuale patch-uri ulterioare
                // peste ele — vezi mai jos în fișier), fără să depindem de a "prinde"
                // fiecare punct de apel individual.
                map.on('layeradd layerremove', function (e) {
                    if (window._jLayerRef && e.layer === window._jLayerRef) {
                        var josephineVisible = map.hasLayer(window._jLayerRef);
                        window._uatSuppressedByJosephine = josephineVisible;
                        if (josephineVisible) window._uatForceHide();
                    }
                });

                window.setUatOpacity = function (val) {
                    var pct = parseInt(val, 10);
                    var el = document.getElementById('uatPct');
                    if (el) el.textContent = pct + '%';
                    _uatLayer.setOpacity(pct / 100); // L.TileLayer are setOpacity() nativ
                };
            })();

            // ── PATRIMONIU LAYER — now sourced from DetectLab's own API instead of ──
            // ── the government WMS server. See detectlab-backend/ for the sync ──
            // ── pipeline that mirrors this data nightly into our own PostGIS. ──
            map.createPane('pane_patrimoniu');

            // Creează un pane special pentru imagini, deasupra WMS-ului
            map.createPane('pane_heritage_images');
            map.getPane('pane_heritage_images').style.zIndex = 630;

            // z-index 620: above the radius canvas (610) so site markers + their
            // labels always paint on top of the red radius circles.
            map.getPane('pane_patrimoniu').style.zIndex = 620;

            // Base URL of your DetectLab backend API (see the backend project's
            // README). Deployed on Railway — both this and the local PM2
            // instance point at the same Supabase database, so either backend
            // serves identical data.
            var DETECTLAB_API_BASE = 'https://detectlab-backend-production.up.railway.app/api';

            window._localLayerData = { 0: null, 5: null, 6: null };
            window._detectlabApiFailed = false; // set true if any layer 0/5/6 call fails

            function loadLocalLayerData() {
                var layerIds = [0, 5, 6];
                return Promise.all(layerIds.map(function (id) {
                    return fetch(DETECTLAB_API_BASE + '/layers/' + id + '/geojson')
                        .then(function (r) {
                            if (!r.ok) {
                                // Read the body so the real backend error message
                                // (e.g. a Supabase/DB error) shows up in the console
                                // instead of a generic "Cannot read properties of
                                // undefined" a step later.
                                return r.text().then(function (bodyText) {
                                    throw new Error('HTTP ' + r.status + ' for layer ' + id + ': ' + bodyText);
                                });
                            }
                            return r.json();
                        })
                        .then(function (fc) {
                            if (!fc || !Array.isArray(fc.features)) {
                                throw new Error('Layer ' + id + ' response was not a valid GeoJSON FeatureCollection: ' + JSON.stringify(fc));
                            }
                            window._localLayerData[id] = fc;
                            console.log('[DetectLab] Loaded layer', id, '—', fc.features.length, 'features from local API');
                        })
                        .catch(function (err) {
                            console.error('[DetectLab] Failed to load layer', id, 'from local API. Is the backend running (npm start)?', err);
                            window._localLayerData[id] = { type: 'FeatureCollection', features: [] };
                            window._detectlabApiFailed = true;
                        });
                }));
            }

            // A canvas renderer handles tens of thousands of markers/shapes far
            // more efficiently than one DOM element per feature (which is what
            // Leaflet's default SVG renderer would create, and would seriously
            // slow down or freeze the tab at this data volume).
            var _patrimoniuCanvasRenderer = L.canvas({ pane: 'pane_patrimoniu' });
            var patrimoniuLayer = L.layerGroup([]); // not added to map — off by default
            window._patrimoniuLayer = patrimoniuLayer;

            // ── PLAN B: direct government WMS fallback ──
            // If the DetectLab API (Railway/Supabase) fails to return one or more of
            // layers 0/5/6, fall back to rendering the raw WMS raster straight from
            // the source ArcGIS server so the map still shows *something* instead of
            // a blank layer. Built lazily — only created if a failure actually occurs.
            var patrimoniuWmsFallback = null;
            window._patrimoniuWmsFallback = null;

            function activatePatrimoniuWmsFallback() {
                if (patrimoniuWmsFallback) return; // already active
                console.warn('[DetectLab] One or more heritage layers failed to load from the API — falling back to the direct WMS service (eism.geo-spatial.ro).');
                patrimoniuWmsFallback = L.tileLayer.wms(
                    'https://eism.geo-spatial.ro/eismgeo/services/Patrimoniu/PatrimoniuWM/MapServer/WmsServer',
                    {
                        layers: '0,5,6',
                        format: 'image/png',
                        transparent: true,
                        version: '1.1.1',
                        pane: 'pane_patrimoniu',
                        opacity: 0.9,
                        attribution: '© CIMEC — eism.geo-spatial.ro (fallback)'
                    }
                );
                window._patrimoniuWmsFallback = patrimoniuWmsFallback;
                // If the heritage layer toggle is already switched on, show the
                // fallback immediately instead of waiting for the next toggle.
                if (map.hasLayer(patrimoniuLayer)) {
                    patrimoniuWmsFallback.addTo(map);
                }
            }

            function showLocalPopup(layerId, props, latlng) {
                var name = null, ran = null;
                if (layerId === 0) {
                    name = props.NUMESIT || null;
                    ran = props.CODSIT || null;
                } else if (layerId === 5) {
                    name = props.Eticheta || props.Tip || null;
                } else if (layerId === 6) {
                    name = props.Nume || props.Toponim || props.Localitate || null;
                    ran = props.CodRAN || null;
                }
                _openHeritagePopup(ran, name, latlng);
            }

            function buildPatrimoniuVisuals() {
                patrimoniuLayer.clearLayers();

                [0, 5].forEach(function (lid) {
                    var fc = window._localLayerData[lid];
                    if (!fc) return;
                    fc.features.forEach(function (f) {
                        if (!f.geometry || f.geometry.type !== 'Point') return;
                        var latlng = L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]);

                        // Layer 0 distinguishes exact vs approximate (by-locality only)
                        // findspots via the COORD field: "DA" (yes) = exact location known.
                        // Matches the original WMS legend: red = "Localizare exactă",
                        // green = "Localizare după localitate".
                        var color = lid === 5
                            ? '#E6A817'
                            : (f.properties && f.properties.COORD === 'DA' ? '#C42B2B' : '#2E9E4F');

                        var marker = L.circleMarker(latlng, {
                            renderer: _patrimoniuCanvasRenderer,
                            radius: lid === 5 ? 4 : 5,
                            color: color,
                            weight: 1.5,
                            fillColor: color,
                            fillOpacity: 0.85,
                            opacity: 0.85
                        });
                        marker.on('click', function (e) {
                            showLocalPopup(lid, f.properties, e.latlng);
                        });
                        patrimoniuLayer.addLayer(marker);
                    });
                });

                var fc6 = window._localLayerData[6];
                if (fc6) {
                    fc6.features.forEach(function (f) {
                        if (!f.geometry) return;
                        var gj = L.geoJSON(f, {
                            renderer: _patrimoniuCanvasRenderer,
                            style: { color: '#E60000', weight: 2, fillOpacity: 0, opacity: 0.85 }
                        });
                        gj.eachLayer(function (l) {
                            l.on('click', function (e) {
                                showLocalPopup(6, f.properties, e.latlng);
                            });
                            patrimoniuLayer.addLayer(l);
                        });
                    });
                }

                console.log('[DetectLab] Built visuals:', patrimoniuLayer.getLayers().length, 'shapes');

                var fc0 = window._localLayerData[0];
                if (fc0) {
                    var coordCounts = {};
                    fc0.features.forEach(function (f) {
                        var v = (f.properties && f.properties.COORD) || '(missing)';
                        coordCounts[v] = (coordCounts[v] || 0) + 1;
                    });
                    console.log('[DetectLab] Layer 0 COORD value distribution:', coordCounts);
                }
            }

            loadLocalLayerData().then(function () {
                buildPatrimoniuVisuals();
                if (window._detectlabApiFailed) {
                    activatePatrimoniuWmsFallback();
                }
            });

            // ── CLICK → WMS GetFeatureInfo → CIMEC popup + 600m radius circle ──
            var _WMS = 'https://eism.geo-spatial.ro/eismgeo/services/Patrimoniu/PatrimoniuWM/MapServer/WmsServer';

            // Track mousedown position to distinguish clicks from drags
            var _mdX = 0, _mdY = 0;
            document.getElementById('detectlab-map').addEventListener('mousedown', function (ev) {
                _mdX = ev.clientX; _mdY = ev.clientY;
            });

            // ── ALWAYS-ON 600m RADIUS CIRCLES ──
            // Queries the ArcGIS REST feature service for all sites in the current view
            // and draws a 600m semi-transparent red circle for every point / polygon vertex.
            // Cached by OBJECTID — pan/zoom never re-draws duplicates.

            // ── FLAT-OPACITY CANVAS OVERLAY ──
            // Canvas lives inside .leaflet-map-pane at z-index 450 (above tiles ~200-400,
            // below markerPane 600 and popupPane 700).
            // The pane CSS-translates during pan, so we use latLngToLayerPoint() for coords
            // (layer-relative = pane-relative) and keep canvas top/left at 0,0 — the pane
            // itself carries the offset, so coords land correctly on the canvas.
            var _offscreenCanvas = document.createElement('canvas');
            var _offscreenCtx = _offscreenCanvas.getContext('2d');
            var _displayCanvas = document.createElement('canvas');
            var _displayCtx = _displayCanvas.getContext('2d');

            var _mapContainer = map.getContainer();
            var _mapPane = _mapContainer.querySelector('.leaflet-map-pane');
            _displayCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:650;';
            _mapPane.appendChild(_displayCanvas);

            var FLAT_OPACITY = 0.35;   // default visible opacity; slider can adjust
            var STROKE_COLOR = '#C42B2B';
            var FILL_COLOR = '#C42B2B';
            var _circleStore = {};
            var _heritageImageStore = {};
            var _heritageImageSeen = {};
            var _heritageImagesVisible = false;
            var _circlesVisible = false;

            // Expune global pentru debugging
            window._heritageImageStore = _heritageImageStore;
            window._heritageImageSeen = _heritageImageSeen;
            window._heritageImagesVisible = _heritageImagesVisible;
            window._circlesVisible = _circlesVisible;
            window._circleStore = _circleStore;

            function _redrawAll() {
                var size = map.getSize();

                // Exact same approach as Leaflet's own L.Canvas renderer:
                // 1. Position the canvas element at the top-left corner of the viewport
                //    in layer-point space using L.DomUtil.setPosition (translate3d).
                // 2. Size the canvas to the viewport.
                // 3. Translate the 2D context by -topLeft so that latLngToLayerPoint()
                //    coords draw at the correct canvas pixel.
                var topLeft = map.containerPointToLayerPoint([0, 0]);
                L.DomUtil.setPosition(_displayCanvas, topLeft);

                if (_offscreenCanvas.width !== size.x) _offscreenCanvas.width = size.x;
                if (_offscreenCanvas.height !== size.y) _offscreenCanvas.height = size.y;
                if (_displayCanvas.width !== size.x) _displayCanvas.width = size.x;
                if (_displayCanvas.height !== size.y) _displayCanvas.height = size.y;

                if (!_circlesVisible || FLAT_OPACITY === 0) {
                    _displayCtx.clearRect(0, 0, _displayCanvas.width, _displayCanvas.height);
                    return;
                }

                var ctx = _offscreenCtx;
                ctx.clearRect(0, 0, _offscreenCanvas.width, _offscreenCanvas.height);
                // Shift context so latLngToLayerPoint coords map to correct canvas pixels
                ctx.save();
                ctx.translate(-topLeft.x, -topLeft.y);
                ctx.fillStyle = FILL_COLOR;
                ctx.strokeStyle = STROKE_COLOR;
                ctx.lineWidth = 1.5;

                var keys = Object.keys(_circleStore);
                for (var ki = 0; ki < keys.length; ki++) {
                    var shapes = _circleStore[keys[ki]];
                    if (!shapes) continue;
                    for (var si = 0; si < shapes.length; si++) {
                        var s = shapes[si];
                        if (s.type === 'circle') {
                            var px = map.latLngToLayerPoint(s.latlng);
                            var radiusPx = _metersToPixels(s.radius, s.latlng);
                            ctx.beginPath();
                            ctx.arc(px.x, px.y, radiusPx, 0, Math.PI * 2);
                            ctx.fill();
                            ctx.stroke();
                        }
                    }
                }

                ctx.restore();
                _displayCtx.clearRect(0, 0, _displayCanvas.width, _displayCanvas.height);
                _displayCtx.globalAlpha = FLAT_OPACITY;
                _displayCtx.drawImage(_offscreenCanvas, 0, 0);
                _displayCtx.globalAlpha = 1;
            }

            function _metersToPixels(meters, latlng) {
                var zoom = map.getZoom();
                var latRad = latlng.lat * Math.PI / 180;
                var mPerPx = (156543.03392 * Math.cos(latRad)) / Math.pow(2, zoom);
                return meters / mPerPx;
            }

            // Redraw on every map move/zoom — mirrors L.Canvas renderer approach exactly
            map.on('move zoom viewreset', _redrawAll);

            function unproject3857(x, y) {
                return L.CRS.EPSG3857.unproject(L.point(x, y));
            }

            function dedupePoints(pts) {
                var seen = {};
                return pts.filter(function (p) {
                    var k = p.lat.toFixed(4) + ',' + p.lng.toFixed(4);
                    if (seen[k]) return false;
                    seen[k] = true; return true;
                });
            }

            // ── 600m RADIUS CIRCLES via ArcGIS REST (JSONP — bypasses CORS) ──
            var _REST_BASE = 'https://eism.geo-spatial.ro/eismgeo/rest/services/Patrimoniu/PatrimoniuWM/MapServer';
            var _REST_LAYERS = [0, 5, 6];
            var _jsonpCounter = 0;

            var _oidStore = {};   // layerId:OID → true, permanent across pan/zoom
            var _fetchedBounds = null;
            var _fetchActive = false;

            function jsonpFetch(url, cb) {
                var cbName = '__dlJsonp' + (++_jsonpCounter);
                var script;
                window[cbName] = function (data) {
                    try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
                    if (script && script.parentNode) script.parentNode.removeChild(script);
                    cb(data);
                };
                script = document.createElement('script');
                script.src = url + '&callback=' + cbName;
                script.onerror = function () {
                    console.error('[RADIUS] JSONP script load failed for layer, url:', url);
                    try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
                    if (script.parentNode) script.parentNode.removeChild(script);
                    cb(null);
                };
                document.head.appendChild(script);
            }

            // Extract geometry into a list of {type:'circle', latlng, radius} shapes.
            // For polygons and polylines we place 600m circles at regular intervals along
            // every edge — spacing MAX_STEP_M apart — so even a triangle with 3 vertices
            // gets a fully continuous buffer with no gaps between corner circles.
            var MAX_STEP_M = 500; // interpolate a circle every 500m along each edge (600m radius = slight overlap)

            function _latlngDistM(a, b) {
                var R = 6371000;
                var dLat = (b.lat - a.lat) * Math.PI / 180;
                var dLng = (b.lng - a.lng) * Math.PI / 180;
                var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
                return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
            }

            // Interpolate n evenly-spaced points between [lng,lat] A and B (not including B)
            function _interpEdge(a, b, n) {
                var pts = [];
                for (var i = 0; i < n; i++) {
                    var t = i / n;
                    pts.push(L.latLng(a[1] + t * (b[1] - a[1]), a[0] + t * (b[0] - a[0])));
                }
                return pts;
            }

            function _coordsToCircles(coords) {
                // coords: array of [lng, lat]
                // Walk each edge, placing a circle every MAX_STEP_M metres.
                var shapes = [];
                var seen = {};
                function addPt(ll) {
                    // dedupe to ~50m grid to avoid massive arrays on dense geometries
                    var k = Math.round(ll.lat * 200) + ',' + Math.round(ll.lng * 200); // ~111000/200 ≈ 555m grid cells
                    if (seen[k]) return;
                    seen[k] = true;
                    shapes.push({ type: 'circle', latlng: ll, radius: 600 });
                }
                for (var i = 0; i < coords.length - 1; i++) {
                    var a = coords[i], b = coords[i + 1];
                    var distM = _latlngDistM(L.latLng(a[1], a[0]), L.latLng(b[1], b[0]));
                    var steps = Math.max(1, Math.ceil(distM / MAX_STEP_M));
                    var pts = _interpEdge(a, b, steps);
                    for (var j = 0; j < pts.length; j++) addPt(pts[j]);
                }
                // add the last vertex
                if (coords.length > 0) {
                    var last = coords[coords.length - 1];
                    addPt(L.latLng(last[1], last[0]));
                }
                return shapes;
            }

            function _geomToShapes(geom, gType) {
                if (!geom) return null;
                var shapes = [];
                if (gType === 'esriGeometryPoint') {
                    if (!isNaN(geom.x) && !isNaN(geom.y))
                        shapes.push({ type: 'circle', latlng: L.latLng(geom.y, geom.x), radius: 600 });
                } else if (gType === 'esriGeometryPolygon' && geom.rings) {
                    geom.rings.forEach(function (ring) {
                        _coordsToCircles(ring).forEach(function (s) { shapes.push(s); });
                    });
                } else if (gType === 'esriGeometryPolyline' && geom.paths) {
                    geom.paths.forEach(function (path) {
                        _coordsToCircles(path).forEach(function (s) { shapes.push(s); });
                    });
                }
                return shapes.length ? shapes : null;
            }
            // Adaugă imaginea PNG centrată pe coordonatele unui punct

            function _addHeritageImage(latlng, key) {
                if (_heritageImageStore[key]) return;

                var customIcon = L.divIcon({
                    html: '<img src="https://raw.githubusercontent.com/andrei-roba29/image/main/IMG_7710.PNG" style="width:100%;height:100%;object-fit:contain;">',
                    className: 'heritage-circle-icon',
                    iconSize: [40, 40],
                    iconAnchor: [20, 20]
                });

                var marker = L.marker(latlng, {
                    icon: customIcon,
                    interactive: false,
                    pane: 'pane_heritage_images'
                });

                if (_heritageImagesVisible && map) marker.addTo(map);
                _heritageImageStore[key] = marker;
            }

            // Build a GFI URL for a specific pixel (px, py) within a virtual WxH canvas over bounds
            function _queryLayer(layerId, fetchBounds, cb) {
                var sw = L.CRS.EPSG3857.project(fetchBounds.getSouthWest());
                var ne = L.CRS.EPSG3857.project(fetchBounds.getNorthEast());
                var url = _REST_BASE + '/' + layerId + '/query'
                    + '?where=1%3D1'
                    + '&geometry=' + encodeURIComponent(sw.x + ',' + sw.y + ',' + ne.x + ',' + ne.y)
                    + '&geometryType=esriGeometryEnvelope'
                    + '&inSR=102100&spatialRel=esriSpatialRelIntersects'
                    + '&outFields=OBJECTID&returnGeometry=true&outSR=4326'
                    + '&resultRecordCount=2000&f=json';
                console.log('[RADIUS] querying layer', layerId, 'url:', url);
                jsonpFetch(url, cb);
            }

            var MIN_ZOOM = 12;

            var _redrawTimer = null;
            function _scheduleRedraw() {
                if (_redrawTimer) return;
                _redrawTimer = requestAnimationFrame(function () {
                    _redrawTimer = null;
                    _redrawAll();
                });
            }
            window._scheduleRedraw = _scheduleRedraw;
            window._setFlatOpacity = function (v) { FLAT_OPACITY = v; };
            window._loadSiteCircles = loadSiteCircles;
            window._setCirclesVisible = function (v) { _circlesVisible = v; };
            window._resetFetchedBounds = function () { _fetchedBounds = null; };
            window.clearAllSiteCircles = clearAllSiteCircles;
            window._getDisplayCanvas = function () { return _displayCanvas; };

            function clearAllSiteCircles() {
                _oidStore = {};
                _circleStore = {};
                _fetchedBounds = null;
                _offscreenCtx.clearRect(0, 0, _offscreenCanvas.width, _offscreenCanvas.height);
                _displayCtx.clearRect(0, 0, _displayCanvas.width, _displayCanvas.height);
                _hideLoader();
            }

            // ── LOADER HELPERS ──
            var _loaderEl = null;
            function _getLoader() {
                if (!_loaderEl) _loaderEl = document.getElementById('mapRadiusLoader');
                return _loaderEl;
            }
            function _showLoader() { var el = _getLoader(); if (el) el.classList.add('visible'); }
            function _hideLoader() { var el = _getLoader(); if (el) el.classList.remove('visible'); }

            function _needsFetch(viewBounds) {
                if (!_fetchedBounds) return true;
                // Only fetch if the viewport has moved outside already-fetched area
                return (
                    viewBounds.getSouth() < _fetchedBounds.getSouth() ||
                    viewBounds.getNorth() > _fetchedBounds.getNorth() ||
                    viewBounds.getWest() < _fetchedBounds.getWest() ||
                    viewBounds.getEast() > _fetchedBounds.getEast()
                );
            }

            function _geoJsonToShapes(geometry) {
                if (!geometry) return null;
                if (geometry.type === 'Point') {
                    var c = geometry.coordinates;
                    return [{ type: 'circle', latlng: L.latLng(c[1], c[0]), radius: 600 }];
                } else if (geometry.type === 'Polygon') {
                    var shapes = [];
                    geometry.coordinates.forEach(function (ring) {
                        _coordsToCircles(ring).forEach(function (s) { shapes.push(s); });
                    });
                    return shapes.length ? shapes : null;
                }
                return null;
            }

            function _representativePoint(geometry) {
                if (!geometry) return null;
                if (geometry.type === 'Point') return L.latLng(geometry.coordinates[1], geometry.coordinates[0]);
                if (geometry.type === 'Polygon' && geometry.coordinates[0] && geometry.coordinates[0][0]) {
                    var c = geometry.coordinates[0][0];
                    return L.latLng(c[1], c[0]);
                }
                return null;
            }

            // Draws 600m radius circles + heritage images for whatever is in view,
            // reading from our already-loaded local dataset (window._localLayerData)
            // instead of live-querying the government server on every pan/zoom.
            // Same viewport-padding + OBJECTID-dedup caching as before, just backed
            // by an in-memory filter instead of a network request.
            function loadSiteCircles() {
                if (!_circlesVisible) return;
                if (map.getZoom() < MIN_ZOOM) {
                    _displayCtx.clearRect(0, 0, _displayCanvas.width, _displayCanvas.height);
                    return;
                }

                var viewBounds = map.getBounds();
                if (!_needsFetch(viewBounds)) {
                    _scheduleRedraw();
                    return;
                }

                var latSpan = viewBounds.getNorth() - viewBounds.getSouth();
                var lngSpan = viewBounds.getEast() - viewBounds.getWest();
                var fetchBounds = L.latLngBounds(
                    [viewBounds.getSouth() - latSpan * 0.3, viewBounds.getWest() - lngSpan * 0.3],
                    [viewBounds.getNorth() + latSpan * 0.3, viewBounds.getEast() + lngSpan * 0.3]
                );
                _fetchedBounds = _fetchedBounds ? _fetchedBounds.extend(fetchBounds) : fetchBounds;

                [0, 5, 6].forEach(function (lid) {
                    var fc = window._localLayerData[lid];
                    if (!fc) return;

                    fc.features.forEach(function (f) {
                        if (!f.geometry) return;
                        var rep = _representativePoint(f.geometry);
                        if (!rep || !fetchBounds.contains(rep)) return;

                        var oid = f.id;
                        if (oid == null) return;
                        var key = lid + ':' + oid;
                        if (_oidStore[key]) return;

                        var shapes = _geoJsonToShapes(f.geometry);
                        if (!shapes) return;
                        _oidStore[key] = true;
                        _circleStore['r:' + key] = shapes;

                        if ((lid === 0 || lid === 5) && f.geometry.type === 'Point') {
                            var imgKey = 'img:' + lid + ':' + oid;
                            if (!_heritageImageSeen[imgKey]) {
                                _heritageImageSeen[imgKey] = true;
                                _addHeritageImage(L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]), imgKey);
                            }
                        }
                    });
                });

                _scheduleRedraw();
            }

            var _fetchDebounce = null;
            map.on('moveend zoomend', function () {
                clearTimeout(_fetchDebounce);
                _fetchDebounce = setTimeout(loadSiteCircles, 400);
            });
            // Don't call loadSiteCircles() on init — circles are off by default

            // Build GFI URL for a specific single layer
            function buildGfiUrl(e, infoFormat, layerId) {
                var size = map.getSize();
                var bounds = map.getBounds();
                var sw = L.CRS.EPSG3857.project(bounds.getSouthWest());
                var ne = L.CRS.EPSG3857.project(bounds.getNorthEast());
                var pt = map.latLngToContainerPoint(e.latlng);
                var layerParam = encodeURIComponent(String(layerId));
                return _WMS
                    + '?SERVICE=WMS&REQUEST=GetFeatureInfo&VERSION=1.1.1'
                    + '&LAYERS=' + layerParam + '&QUERY_LAYERS=' + layerParam + '&STYLES='
                    + '&BBOX=' + sw.x + ',' + sw.y + ',' + ne.x + ',' + ne.y
                    + '&WIDTH=' + size.x + '&HEIGHT=' + size.y
                    + '&SRS=EPSG%3A3857'
                    + '&X=' + Math.round(pt.x) + '&Y=' + Math.round(pt.y)
                    + '&INFO_FORMAT=' + encodeURIComponent(infoFormat)
                    + '&FEATURE_COUNT=1';
            }

            // Parse props from ArcGIS HTML response — first feature's data table only.
            // FEATURE_COUNT may return multiple overlapping sites in separate tables.
            // We pick the first table that has <th> header cells (skipping layout wrappers).
            function parseHtmlProps(raw) {
                var props = {};
                try {
                    var dp = new DOMParser().parseFromString(raw, 'text/html');
                    // Find the first table that has <th> cells — that's a data table
                    var tables = dp.querySelectorAll('table');
                    var dataTable = null;
                    for (var t = 0; t < tables.length; t++) {
                        if (tables[t].querySelector('th')) { dataTable = tables[t]; break; }
                    }
                    // Fallback: just use the first table if none have <th>
                    if (!dataTable) dataTable = tables[0] || null;

                    var rows = dataTable ? dataTable.querySelectorAll('tr') : [];
                    rows.forEach(function (row) {
                        var th = row.querySelector('th');
                        var td = row.querySelector('td');
                        if (th && td) {
                            var key = th.textContent.trim();
                            var val = td.textContent.trim();
                            if (key && val && val.toLowerCase() !== 'null') props[key] = val;
                        }
                    });
                    if (Object.keys(props).length === 0) {
                        // Fallback: key/value pairs in consecutive <td> cells
                        var tds = dataTable ? dataTable.querySelectorAll('td') : dp.querySelectorAll('td');
                        for (var i = 0; i + 1 < tds.length; i += 2) {
                            var k = tds[i].textContent.trim();
                            var v = tds[i + 1].textContent.trim();
                            if (k && v && v.toLowerCase() !== 'null') props[k] = v;
                        }
                    }
                } catch (ex) { console.warn('[GFI] HTML parse exception:', ex); }
                return props;
            }

            // Extract ALL coordinate pairs from a GML response.
            // Handles <gml:coordinates>, <gml:pos>, <gml:posList> in EPSG:4326 or EPSG:3857.
            function parseGmlCoords(raw) {
                var points = []; // array of {lat, lng}
                try {
                    var xmlDoc = new DOMParser().parseFromString(raw, 'text/xml');
                    if (xmlDoc.querySelector('parsererror')) return points;

                    // Helper: parse "x,y x,y" or "x y x y" strings into lat/lng pairs
                    // ArcGIS WMS 1.1.1 returns CRS EPSG:4326 with coords as "lon,lat" in <gml:coordinates>
                    // or "lat lon" pairs in <gml:pos>/<gml:posList>
                    function coordsFromString(str, separator, isLatLonOrder) {
                        var pairs = str.trim().split(/\s+/);
                        if (separator === ',') {
                            // "lon,lat lon,lat" format (gml:coordinates)
                            pairs.forEach(function (pair) {
                                var parts = pair.split(',');
                                if (parts.length >= 2) {
                                    var x = parseFloat(parts[0]);
                                    var y = parseFloat(parts[1]);
                                    if (!isNaN(x) && !isNaN(y)) {
                                        // Determine if these are EPSG:3857 (metres) or 4326 (degrees)
                                        if (Math.abs(x) > 180 || Math.abs(y) > 90) {
                                            // Project from EPSG:3857 to LatLng
                                            var ll = L.CRS.EPSG3857.unproject(L.point(x, y));
                                            points.push({ lat: ll.lat, lng: ll.lng });
                                        } else {
                                            points.push({ lat: y, lng: x }); // lon,lat → lat,lng
                                        }
                                    }
                                }
                            });
                        } else {
                            // "lat lon lat lon" format (gml:pos / gml:posList)
                            for (var i = 0; i + 1 < pairs.length; i += 2) {
                                var a = parseFloat(pairs[i]);
                                var b = parseFloat(pairs[i + 1]);
                                if (!isNaN(a) && !isNaN(b)) {
                                    if (Math.abs(a) > 180 || Math.abs(b) > 90) {
                                        var ll2 = L.CRS.EPSG3857.unproject(L.point(a, b));
                                        points.push({ lat: ll2.lat, lng: ll2.lng });
                                    } else {
                                        // GML 3 posList for EPSG:4326 is "lat lon" order
                                        points.push({ lat: a, lng: b });
                                    }
                                }
                            }
                        }
                    }

                    // <gml:coordinates> — GML 2 style, used by ArcGIS WMS 1.1.1
                    var coordEls = xmlDoc.getElementsByTagNameNS('http://www.opengis.net/gml', 'coordinates');
                    if (coordEls.length === 0) coordEls = xmlDoc.getElementsByTagName('gml:coordinates');
                    if (coordEls.length === 0) coordEls = xmlDoc.getElementsByTagName('coordinates');
                    for (var i = 0; i < coordEls.length; i++) {
                        coordsFromString(coordEls[i].textContent, ',', false);
                    }

                    // <gml:pos> — GML 3 single point
                    if (points.length === 0) {
                        var posEls = xmlDoc.getElementsByTagNameNS('http://www.opengis.net/gml', 'pos');
                        if (posEls.length === 0) posEls = xmlDoc.getElementsByTagName('gml:pos');
                        if (posEls.length === 0) posEls = xmlDoc.getElementsByTagName('pos');
                        for (var j = 0; j < posEls.length; j++) {
                            coordsFromString(posEls[j].textContent, ' ', true);
                        }
                    }

                    // <gml:posList> — GML 3 polygon/linestring
                    if (points.length === 0) {
                        var plEls = xmlDoc.getElementsByTagNameNS('http://www.opengis.net/gml', 'posList');
                        if (plEls.length === 0) plEls = xmlDoc.getElementsByTagName('gml:posList');
                        if (plEls.length === 0) plEls = xmlDoc.getElementsByTagName('posList');
                        for (var k = 0; k < plEls.length; k++) {
                            coordsFromString(plEls[k].textContent, ' ', true);
                        }
                    }
                } catch (ex) { console.warn('[GFI] GML coord parse error:', ex); }
                return points;
            }

            // Case-insensitive pick from props
            function pickProp(props, candidates) {
                for (var i = 0; i < candidates.length; i++) {
                    if (props[candidates[i]]) return props[candidates[i]];
                }
                var lower = candidates.map(function (c) { return c.toLowerCase(); });
                for (var key in props) {
                    if (lower.indexOf(key.toLowerCase()) !== -1 && props[key]) return props[key];
                }
                return null;
            }

            // Show popup from a props object
            // Render and open the heritage popup. Called directly when we have all data,
            // or after an async REST enrichment call fills in the name.
            function _openHeritagePopup(ran, name, latlng) {
                var cimecUrl = ran
                    ? 'https://ran.cimec.ro/sel.asp?codran=' + encodeURIComponent(ran)
                    : 'https://ran.cimec.ro/sel.asp?descript=' + encodeURIComponent(name);

                var label = name || ran || 'Sit Arheologic';

                L.popup({ className: 'patrimoniu-popup', maxWidth: 320 })
                    .setLatLng(latlng)
                    .setContent(
                        '<div style="font-family:Outfit,sans-serif;min-width:210px;max-width:300px;padding:4px 2px">' +
                        '<div style="font-family:Cinzel,serif;font-size:0.9rem;color:#B8D8F0;font-weight:700;' +
                        'margin-bottom:10px;line-height:1.35">🏛 ' + label + '</div>' +
                        (ran
                            ? '<div style="font-size:0.75rem;color:rgba(196,160,240,0.85);margin-bottom:2px">' +
                            '📍 Cod RAN: <strong style="color:#c4a0f0">' + ran + '</strong></div>'
                            : '') +
                        '<a href="' + cimecUrl + '" target="_blank" rel="noopener" ' +
                        'style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:12px;' +
                        'background:linear-gradient(135deg,#6B3FA0,#4a2880);' +
                        'color:#fff;border-radius:6px;padding:9px 16px;font-size:0.82rem;font-weight:600;' +
                        'text-decoration:none;letter-spacing:0.04em;box-shadow:0 3px 14px rgba(107,63,160,0.5)">' +
                        '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" style="flex-shrink:0">' +
                        '<path d="M2 6.5h9M7.5 3l3.5 3.5L7.5 10" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
                        '</svg>Vezi pe CIMEC / RAN</a>' +
                        '</div>'
                    )
                    .openOn(map);
            }

            // Fetch the full site record from the ArcGIS REST service using a small
            // bounding-box query (same proven approach as the radius circle loader).
            // This returns the full COD_RAN (e.g. "54984.77") and DENUMIRE.
            // Cascades through REST_LAYERS until a feature matching the RAN hint is found.
            function _enrichAndPopup(ranHint, hitLayerId, latlng) {
                var layersToTry = [hitLayerId].concat(
                    _REST_LAYERS.filter(function (l) { return l !== hitLayerId; })
                );
                var intHint = ranHint ? String(ranHint).split('.')[0] : null;

                // Build a ~150m bbox around the click in EPSG:3857 (same as working radius query)
                function buildEnrichUrl(lid) {
                    var pt3857 = L.CRS.EPSG3857.project(latlng);
                    var d = 150; // metres in 3857 units ≈ metres at mid-latitudes
                    var bbox = (pt3857.x - d) + ',' + (pt3857.y - d) + ',' +
                        (pt3857.x + d) + ',' + (pt3857.y + d);
                    return _REST_BASE + '/' + lid + '/query'
                        + '?where=1%3D1'
                        + '&geometry=' + encodeURIComponent(bbox)
                        + '&geometryType=esriGeometryEnvelope'
                        + '&inSR=102100'
                        + '&spatialRel=esriSpatialRelIntersects'
                        + '&outFields=*'
                        + '&returnGeometry=false'
                        + '&resultRecordCount=10'
                        + '&f=json';
                }

                function tryRestLayer(idx) {
                    if (idx >= layersToTry.length) {
                        console.warn('[DetectLab] Enrichment: no match in any layer for RAN hint', ranHint);
                        _openHeritagePopup(ranHint, null, latlng);
                        return;
                    }
                    var lid = layersToTry[idx];
                    var url = buildEnrichUrl(lid);
                    console.log('[DetectLab] Enrichment layer', lid, 'url:', url);

                    jsonpFetch(url, function (data) {
                        // Always log the raw response so we can see field names in the console
                        console.log('[DetectLab] Enrichment layer', lid, 'raw response:',
                            JSON.stringify(data).slice(0, 1200));

                        if (!data || !data.features || data.features.length === 0) {
                            console.log('[DetectLab] Enrichment layer', lid, 'no features → next');
                            tryRestLayer(idx + 1);
                            return;
                        }

                        // Pick the best feature: prefer one whose RAN integer prefix matches hint
                        var best = null;
                        var bestRan = null;
                        for (var i = 0; i < data.features.length; i++) {
                            var a = data.features[i].attributes || {};
                            // Scan ALL fields for anything that looks like a RAN code
                            var candidateRan = null;
                            for (var fld in a) {
                                if (!a[fld]) continue;
                                var v = String(a[fld]);
                                if (/^\d{4,6}\.\d{2,3}$/.test(v) || (intHint && v === intHint)) {
                                    candidateRan = v; break;
                                }
                            }
                            var matches = intHint && candidateRan && candidateRan.split('.')[0] === intHint;
                            if (!best || matches) {
                                best = a; bestRan = candidateRan;
                                if (matches) break;
                            }
                        }

                        if (!best) { tryRestLayer(idx + 1); return; }

                        // Log all field names so we know what to look for
                        console.log('[DetectLab] Enrichment best feature fields:', JSON.stringify(best));

                        // Extract name — try every plausible field name
                        var name = null;
                        var nameFields = ['DENUMIRE', 'DENUMIRE_SIT', 'DENUMIRE_OBIECTIV', 'DENUMIRE_OB',
                            'DenumireSit', 'Denumire', 'denumire', 'NUME', 'NAME', 'TITLU', 'DESCRIPTION'];
                        for (var ni = 0; ni < nameFields.length; ni++) {
                            if (best[nameFields[ni]]) { name = String(best[nameFields[ni]]); break; }
                        }
                        // Also scan all fields: any long string (>10 chars) that isn't a date/code
                        if (!name) {
                            for (var fld2 in best) {
                                var v2 = best[fld2];
                                if (!v2 || typeof v2 !== 'string') continue;
                                if (v2.length > 10 && !/^\d/.test(v2) && !/\d{1,2}\/\d{1,2}\/\d{4}/.test(v2)) {
                                    name = v2; break;
                                }
                            }
                        }

                        // Extract full RAN — try known field names
                        var fullRan = bestRan || ranHint;
                        var ranFields = ['COD_RAN', 'NR_RAN', 'CodRAN', 'Cod_RAN', 'RAN', 'COD', 'Cod'];
                        if (!bestRan) {
                            for (var ri = 0; ri < ranFields.length; ri++) {
                                if (best[ranFields[ri]]) { fullRan = String(best[ranFields[ri]]); break; }
                            }
                        }

                        console.log('[DetectLab] Enrichment result → ran:', fullRan, '| name:', name);
                        _openHeritagePopup(fullRan, name, latlng);
                    });
                }

                tryRestLayer(0);
            }

            function showPatrimoniuPopup(props, coordPoints, latlng, hitLayerId) {
                console.log('[DetectLab] Props:', JSON.stringify(props), '| Coords:', coordPoints.length);
                if (Object.keys(props).length === 0) return;

                var ran = null;
                var name = null;

                // RAN codes come in two flavours from the WMS:
                //   • Full:    "54984.77"  (digits dot digits)
                //   • Integer: "54984"     (digits only, 4-6 chars) — Layer 0 Point features
                var ranPatternFull = /^\d{4,6}\.\d{2,3}$/;
                var ranPatternInt = /^\d{4,6}$/;
                // SIRUTA locality codes look the same as integer RANs; a SIRUTA key is
                // typically a short pure-number string (2-4 digits) — used to distinguish
                // "this 4-6 digit value is the RAN, not the key" below.
                var sirutaKeyPattern = /^\d{2,4}$/;
                var skipKeys = /^(point|administrator|objectid|fid|shape|globalid|created_|last_edit)$/i;
                var datePattern = /\d{1,2}\/\d{1,2}\/\d{4}/;
                var epochPattern = /^(eneolitic|neolitic|paleolitic|bronzului|fierului|medievala?|romana?|preistorie|migratiil|hallstatt|latene|epoca|secol|secolul)/i;

                // Pass 1: scan keys AND values for RAN patterns.
                // The WMS sometimes places the RAN code in the <th> (key) with the geometry
                // type ("Point") as the <td> (value), so we must check both directions.
                Object.keys(props).forEach(function (k) {
                    var v = props[k];
                    // Full RAN in key or value
                    if (ranPatternFull.test(k)) {
                        ran = k;
                    } else if (ranPatternFull.test(v)) {
                        ran = v;
                        // Integer RAN in value where the key looks like a SIRUTA code or short number
                    } else if (!ran && ranPatternInt.test(v) && sirutaKeyPattern.test(k)) {
                        ran = v;  // e.g. key="2466", value="54984" → RAN is the value
                        // Integer RAN in key where the value is clearly not a RAN (e.g. geometry type)
                    } else if (!ran && ranPatternInt.test(k) && !ranPatternInt.test(v) && !ranPatternFull.test(v)) {
                        ran = k;
                    }
                });

                // Pass 2: look for name by explicit key candidates (most reliable)
                name = pickProp(props, [
                    'DENUMIRE', 'DENUMIRE_SIT', 'DENUMIRE_OBIECTIV', 'DENUMIRE_OB',
                    'NUME', 'NUME_OBIECTIV', 'NAME', 'TITLU',
                    'Denumire', 'denumire', 'DenumireSit', 'denumire_sit',
                    'DESCRIPTION', 'DESCRIERE', 'LOCALITATE', 'Localitate'
                ]);

                // Pass 3: look for RAN by explicit key candidates if not found yet
                if (!ran) ran = pickProp(props, [
                    'COD_RAN', 'CODRAN', 'CodRAN', 'NR_RAN', 'RAN', 'Cod_RAN', 'ran',
                    'COD', 'Cod', 'CODE'
                ]);

                // Pass 4: last-resort name — scan values but with strict guards
                if (!name) {
                    Object.keys(props).forEach(function (k) {
                        if (name) return;
                        if (skipKeys.test(k)) return;
                        var v = props[k];
                        if (!v || v === ran) return;
                        if (ranPatternFull.test(v) || ranPatternInt.test(v)) return;
                        if (datePattern.test(v)) return;
                        if (/^\d+$/.test(v)) return;
                        if (epochPattern.test(v)) return;
                        if (v.length <= 4) return;
                        name = v;
                    });
                }

                if (!ran && !name) {
                    console.warn('[DetectLab] No RAN/name. Props:', JSON.stringify(props));
                    return;
                }

                console.log('[DetectLab] Resolved → ran:', ran, 'name:', name);

                // If we have a RAN but no name, try to enrich from the REST API asynchronously.
                // hitLayerId tells us which layer actually returned the feature.
                if (ran && !name && hitLayerId != null) {
                    _enrichAndPopup(ran, hitLayerId, latlng);
                } else {
                    _openHeritagePopup(ran, name, latlng);
                }
            }

            map.on('click', function (e) {
                return; // superseded: each marker/polygon now handles its own click (see buildPatrimoniuVisuals)
                var ox = e.originalEvent.clientX - _mdX;
                var oy = e.originalEvent.clientY - _mdY;
                if (Math.sqrt(ox * ox + oy * oy) > 5) return; // drag

                if (!map.hasLayer(window._patrimoniuLayer)) return;

                var latlng = e.latlng;

                // Query each layer individually (FEATURE_COUNT=1 each) so their field
                // schemas never mix. Use the first layer that returns a real feature.
                var LAYERS = [0, 5, 6];

                function queryLayer(layerId) {
                    return Promise.all([
                        fetch(buildGfiUrl(e, 'text/html', layerId)).then(function (r) { return r.text(); }).catch(function () { return ''; }),
                        fetch(buildGfiUrl(e, 'application/vnd.ogc.gml', layerId)).then(function (r) { return r.text(); }).catch(function () { return ''; })
                    ]).then(function (res) {
                        return { html: res[0], gml: res[1] };
                    });
                }

                // Query all layers in parallel and merge — Layer 0 gives the Point with
                // integer RAN; Layer 5/6 give overlapping Polygons with full decimal
                // RAN + DENUMIRE. We merge only the polygon whose integer prefix matches
                // the point's RAN, so nearby sites don't contaminate each other.
                // Polygon results that arrive before Layer 0 are queued and processed once
                // Layer 0 resolves, so the RAN hint is always available for comparison.
                var layer0Props = null;  // null = not yet resolved
                var layer0Coords = [];
                var polygonQueue = [];    // polygon results waiting for layer 0
                var extraProps = {};
                var extraCoords = [];
                var pending = LAYERS.length;
                var _rfFull = /^\d{4,6}\.\d{2,3}$/;
                var _rfInt = /^\d{4,6}$/;

                function extractRanFromProps(p) {
                    for (var k in p) {
                        if (_rfFull.test(k)) return k;
                        if (_rfFull.test(p[k])) return p[k];
                    }
                    for (var k2 in p) {
                        if (_rfInt.test(k2)) return k2;
                        if (_rfInt.test(p[k2])) return p[k2];
                    }
                    return null;
                }

                function tryMergePolygon(p, c) {
                    if (Object.keys(p).length === 0) return;
                    var pointRanInt = extractRanFromProps(layer0Props || {});
                    if (pointRanInt) pointRanInt = String(pointRanInt).split('.')[0];
                    var polygonRan = extractRanFromProps(p);
                    var polygonInt = polygonRan ? String(polygonRan).split('.')[0] : null;
                    var isMatch = pointRanInt && polygonInt && polygonInt === pointRanInt;
                    var noHint = !pointRanInt;
                    if (isMatch || noHint) {
                        console.log('[DetectLab] Polygon RAN', polygonRan, 'matches hint', pointRanInt, '→ merging');
                        Object.assign(extraProps, p);
                        if (c.length > extraCoords.length) extraCoords = c;
                    } else {
                        console.log('[DetectLab] Polygon RAN', polygonRan, '≠ hint', pointRanInt, '→ SKIP (different site)');
                    }
                }

                function finalMerge() {
                    var allProps = Object.assign({}, layer0Props || {}, extraProps);
                    var allCoords = extraCoords.length > 0 ? extraCoords : layer0Coords;
                    if (Object.keys(allProps).length === 0 && allCoords.length === 0) return;

                    if (_circlesVisible) {
                        var clickKey = 'click:' + latlng.lat.toFixed(4) + ',' + latlng.lng.toFixed(4);
                        if (!_circleStore[clickKey]) {
                            var cs;
                            if (allCoords.length > 1) {
                                cs = _coordsToCircles(allCoords.map(function (pt) { return [pt.lng, pt.lat]; }));
                            } else if (allCoords.length === 1) {
                                cs = [{ type: 'circle', latlng: L.latLng(allCoords[0].lat, allCoords[0].lng), radius: 600 }];
                            } else {
                                cs = [{ type: 'circle', latlng: latlng, radius: 600 }];
                            }
                            _circleStore[clickKey] = cs;
                            _scheduleRedraw();
                        }
                    }

                    console.log('[DetectLab] Final merged props:', JSON.stringify(allProps));
                    showPatrimoniuPopup(allProps, allCoords, latlng, LAYERS[0]);
                }

                LAYERS.forEach(function (lid) {
                    queryLayer(lid).then(function (res) {
                        var p = parseHtmlProps(res.html);
                        var c = parseGmlCoords(res.gml);
                        if (c.length === 0 && res.gml.trim().startsWith('<')) c = parseGmlCoords(res.html);

                        console.log('[DetectLab] Layer', lid, 'props:', JSON.stringify(p));
                        console.log('[DetectLab] Layer', lid, 'raw HTML:', res.html.slice(0, 1200));

                        if (lid === 0) {
                            layer0Props = p;
                            layer0Coords = c;
                            // Process any polygon results that arrived before us
                            polygonQueue.forEach(function (q) { tryMergePolygon(q.p, q.c); });
                            polygonQueue = [];
                        } else {
                            if (layer0Props === null) {
                                polygonQueue.push({ p: p, c: c }); // queue until layer 0 resolves
                            } else {
                                tryMergePolygon(p, c);
                            }
                        }

                        pending--;
                        if (pending === 0) finalMerge();
                    });
                });
            });

            // Single unified togglePatrimoniuLayer — handles WMS layer AND radius circles
            window.togglePatrimoniuLayer = function (on) {
                var layer = window._patrimoniuLayer;
                var m = window._dlMap;
                if (!layer || !m) return;
                if (on) { layer.addTo(m); } else { m.removeLayer(layer); }
                // Keep the WMS fallback (if active) in sync with the same toggle
                if (window._patrimoniuWmsFallback) {
                    if (on) { window._patrimoniuWmsFallback.addTo(m); } else { m.removeLayer(window._patrimoniuWmsFallback); }
                }
                _circlesVisible = on;

                // Arată sau ascunde imaginile PNG (doar pentru layer 0 și 5)
                _heritageImagesVisible = on;
                if (on) {
                    Object.keys(_heritageImageStore).forEach(function (k) {
                        if (!map.hasLayer(_heritageImageStore[k]))
                            _heritageImageStore[k].addTo(map);
                    });
                } else {
                    Object.keys(_heritageImageStore).forEach(function (k) {
                        if (map.hasLayer(_heritageImageStore[k]))
                            map.removeLayer(_heritageImageStore[k]);
                    });
                }

                if (on) {
                    var slider = document.getElementById('patrimoniuOpacitySlider');
                    if (slider && parseInt(slider.value, 10) === 0) {
                        slider.value = 25; FLAT_OPACITY = 0.25;
                        document.getElementById('patrimoniuPct').textContent = '25%';
                    }
                    _displayCanvas.style.display = '';
                    loadSiteCircles();
                } else {
                    _displayCanvas.style.display = 'none';
                    _scheduleRedraw();
                }
            };

            // Popup styles
            (function () {
                var s = document.createElement('style');
                s.textContent =
                    '.patrimoniu-popup .leaflet-popup-content-wrapper{background:rgba(6,14,30,0.95);backdrop-filter:blur(16px);border:1px solid rgba(107,63,160,0.5);border-radius:10px;color:#F5F0EB;box-shadow:0 8px 32px rgba(0,0,0,0.6)}' +
                    '.patrimoniu-popup .leaflet-popup-tip{background:rgba(6,14,30,0.95)}' +
                    '.patrimoniu-popup .leaflet-popup-close-button{color:#B8D8F0!important}';
                document.head.appendChild(s);
            })();

            map.createPane('pane_apm');
            map.getPane('pane_apm').style.zIndex = 401;

            var _APM_BASE = 'https://sclav.andreiroba2000.workers.dev';
            var _APM_BOUNDS = L.latLngBounds(
                [42.865092546835, 19.901846451197],
                [49.002496199394, 30.671388069869]
            );

            function _createApmLayer(useTms) {
                if (window._apmLayer) map.removeLayer(window._apmLayer);
                var layer = L.tileLayer(_APM_BASE + '/APM_TILES/{z}/{x}/{y}.png', {
                    pane: 'pane_apm',
                    opacity: 0.80,
                    bounds: _APM_BOUNDS,
                    minZoom: 5,
                    maxZoom: 18,
                    minNativeZoom: 6,
                    maxNativeZoom: 12,
                    tms: useTms,
                    crossOrigin: 'anonymous',
                    errorTileUrl: ''
                }).addTo(map);
                window._apmLayer = layer;
                return layer;
            }

            var _tmsProbe = new Image();
            _tmsProbe.onload = function () {
                console.log('[APM] Probe /6/36/40 OK => TMS format => tms:true');
                _createApmLayer(true);
            };
            _tmsProbe.onerror = function () {
                console.warn('[APM] Probe /6/36/40 failed, trying XYZ /6/36/23...');
                var _xyzProbe = new Image();
                _xyzProbe.onload = function () {
                    console.log('[APM] Probe /6/36/23 OK => XYZ format => tms:false');
                    _createApmLayer(false);
                };
                _xyzProbe.onerror = function () {
                    console.error('[APM] Both probes failed — check worker and bucket');
                    _createApmLayer(true);
                };
                _xyzProbe.src = _APM_BASE + '/APM_TILES/6/36/23.png';
            };
            _tmsProbe.src = _APM_BASE + '/APM_TILES/6/36/40.png';

            console.log('[DetectLab] APM tile layer probing Cloudflare R2...');

            // Expose for external controls
            window._dlMap = map;

            // ── APM LAYER TOGGLE ──
            window.toggleApmLayer = function (on) {
                var layer = window._apmLayer;
                if (!layer) return;
                if (on) { layer.addTo(map); } else { map.removeLayer(layer); }
            };

            // ── ROMAN EMPIRE — SUB-LAYER SYSTEM ──
            map.createPane('pane_roman');
            map.getPane('pane_roman').style.zIndex = 625;
            map.getPane('pane_roman').style.pointerEvents = 'none';

            var _romanOpacity = 0.70;
            var _romanVisible = false;

            // ── Sub-layer definitions ──
            // type: 'geojson' | 'wms' | 'tilelayer'
            // enabled: initial state (mirrors checkbox defaults in HTML)
            // NOTE: AWMC GeoServer WMS (awmc.unc.edu/awmc/map/geoserver) is defunct as of 2024.
            // All layers now use GeoJSON from forked AWMC repo (andrei-roba29/geo_data) which mirrors
            // the current AWMC/geodata structure. Folder layout changed — see Cultural-Data/ in fork.
            var _AWMC = 'https://raw.githubusercontent.com/andrei-roba29/geo_data/master/Cultural-Data/';
            var ROMAN_SUB_LAYERS = {

                // ── INFRASTRUCTURE ──
                roads: {
                    label: 'Roads', color: '#CC2222', weight: 2.0, enabled: false,
                    type: 'geojson',
                    url: 'https://raw.githubusercontent.com/andrei-roba29/geo_data/d81cd21/Cultural-Data/roads/roman_routes_under25mb.geojson'
                },
                // ── POINTS & LABELS ──
                urban_areas: {
                    label: 'Urban Areas', color: '#F0C060', weight: 1.0, enabled: false,
                    type: 'geojson',
                    url: _AWMC + 'urban_areas/urban_areas.geojson'
                },

                // ── POLITICAL SHADING ──
                shade_117: {
                    label: 'Roman Empire 117 CE', color: '#C4532D', weight: 0.8, enabled: false,
                    type: 'geojson',
                    url: _AWMC + 'political_shading/roman_empire_ce_117_extent/roman_empire_ce_117_extent.geojson'
                },
                shade_60bce: {
                    label: 'Roman Empire 60 BCE', color: '#B43C1E', weight: 0.8, enabled: false,
                    type: 'geojson',
                    url: _AWMC + 'political_shading/roman_empire_bce_60/roman_empire_bce_60.geojson'
                },
                shade_200: {
                    label: 'Roman Empire 200 CE', color: '#D2641E', weight: 0.8, enabled: false,
                    type: 'geojson',
                    url: _AWMC + 'political_shading/roman_empire_ce_200_extent/roman_empire_ce_200_extent.geojson'
                },
                shade_alexander: {
                    label: "Alexander's Empire", color: '#5082DC', weight: 0.8, enabled: false,
                    type: 'geojson',
                    url: _AWMC + 'political_shading/alexanders_empire/alexanders_empire.geojson'
                },
                shade_persian: {
                    label: 'Persian Empire', color: '#B464C8', weight: 0.8, enabled: false,
                    type: 'geojson',
                    url: _AWMC + 'political_shading/persian_extent/extent_of_the_persian_empire.geojson'
                },
                shade_diocletian: {
                    label: 'Roman Provinces after Diocletian', color: '#DCA032', weight: 0.8, enabled: false,
                    type: 'geojson',
                    url: _AWMC + 'political_shading/roman_empire_provinces post_diocletian/roman_empire_provinces post_diocletian.geojson'
                },
                shade_herod: {
                    label: "Herod's Empire", color: '#32B482', weight: 0.8, enabled: false,
                    type: 'geojson',
                    url: _AWMC + 'political_shading/herod/herods_kingdom.geojson'
                },
                shade_hasmonean: {
                    label: 'Hasmonean Kingdom', color: '#32A064', weight: 0.8, enabled: false,
                    type: 'geojson',
                    url: _AWMC + 'political_shading/hasmonean/hasmonean_kingdom.geojson'
                }
            };

            // Runtime state: leaflet layer instances per key
            var _romanLayers = {};   // key → Leaflet layer
            var _romanEnabled = {};  // key → bool (from checkbox state)
            var _romanCache  = {};   // url → GeoJSON data

            // Initialise enabled state from definitions
            Object.keys(ROMAN_SUB_LAYERS).forEach(function(k) {
                _romanEnabled[k] = ROMAN_SUB_LAYERS[k].enabled;
            });

            var _romanGroup = L.layerGroup([], { pane: 'pane_roman' });
            window._romanGroup = _romanGroup;

            // ── Build one Leaflet layer for a sub-layer config ──
            function _buildRomanLeafletLayer(key, cfg, geojsonData) {
                if (cfg.type === 'wms') {
                    return L.tileLayer.wms(cfg.url, {
                        layers: cfg.layers,
                        format: 'image/png',
                        transparent: true,
                        version: '1.1.1',
                        opacity: _romanOpacity,
                        pane: 'pane_roman',
                        attribution: '© AWMC'
                    });
                }
                if (cfg.type === 'geojson' && geojsonData) {
                    return L.geoJSON(geojsonData, {
                        pane: 'pane_roman',
                        style: function() {
                            return {
                                color: cfg.color,
                                fillColor: cfg.color,
                                weight: cfg.weight,
                                opacity: _romanOpacity,
                                fillOpacity: _romanOpacity * 0.18,
                                pane: 'pane_roman'
                            };
                        },
                        pointToLayer: function(feature, latlng) {
                            return L.circleMarker(latlng, {
                                pane: 'pane_roman',
                                radius: 4,
                                color: cfg.color,
                                fillColor: cfg.color,
                                fillOpacity: _romanOpacity * 0.6,
                                opacity: _romanOpacity,
                                weight: 1
                            });
                        },
                        onEachFeature: function(feature, layer) {
                            var p = feature.properties || {};
                            var name = p.label || p.name || p.NAME || p.Label || p.LABEL || p.PLabel || '';
                            if (name) {
                                layer.bindTooltip(
                                    '<span style="font-family:\'Cinzel\',serif;font-size:0.78rem;color:#E8772A;">' + name + '</span>' +
                                    '<br><span style="font-size:0.68rem;opacity:0.6;">' + cfg.label + ' · Roman Empire</span>',
                                    { className: 'map-search-tooltip', sticky: true }
                                );
                            }
                        }
                    });
                }
                return null;
            }

            // ── Load / toggle a single sub-layer ──
            function _loadRomanSubLayer(key) {
                var cfg = ROMAN_SUB_LAYERS[key];
                if (!cfg || !_romanEnabled[key] || !_romanVisible) return;

                if (cfg.type === 'wms') {
                    if (!_romanLayers[key]) {
                        var lyr = _buildRomanLeafletLayer(key, cfg, null);
                        _romanLayers[key] = lyr;
                    }
                    if (!_romanGroup.hasLayer(_romanLayers[key])) {
                        _romanLayers[key].addTo(_romanGroup);
                    }
                    return;
                }

                // GeoJSON path — skip if url is empty (layer unavailable in current data source)
                if (!cfg.url) { console.info('[Roman] "' + key + '" skipped — no URL'); return; }

                // GeoJSON path — fetch once, then build
                if (_romanLayers[key]) {
                    if (!_romanGroup.hasLayer(_romanLayers[key])) {
                        _romanLayers[key].addTo(_romanGroup);
                    }
                    return;
                }
                if (_romanCache[cfg.url]) {
                    var lyr2 = _buildRomanLeafletLayer(key, cfg, _romanCache[cfg.url]);
                    if (lyr2) { _romanLayers[key] = lyr2; lyr2.addTo(_romanGroup); }
                    return;
                }
                fetch(cfg.url)
                    .then(function(r){
                        if (!r.ok) { console.warn('[Roman] "' + key + '" HTTP ' + r.status + ' — ' + cfg.url); return null; }
                        return r.json();
                    })
                    .then(function(data) {
                        if (!data) return;
                        _romanCache[cfg.url] = data;
                        if (!_romanEnabled[key] || !_romanVisible) return;
                        var lyr3 = _buildRomanLeafletLayer(key, cfg, data);
                        if (lyr3) { _romanLayers[key] = lyr3; lyr3.addTo(_romanGroup); }
                        console.log('[Roman] "' + key + '" OK — ' + (data.features ? data.features.length : '?') + ' features');
                    })
                    .catch(function(e){ console.error('[Roman] "' + key + '" fetch error:', e.message, cfg.url); });
            }

            function _loadRomanData() {
                Object.keys(ROMAN_SUB_LAYERS).forEach(function(key) {
                    if (_romanEnabled[key]) {
                        _loadRomanSubLayer(key);
                    } else {
                        // Remove from group if disabled
                        if (_romanLayers[key] && _romanGroup.hasLayer(_romanLayers[key])) {
                            _romanGroup.removeLayer(_romanLayers[key]);
                        }
                    }
                });
            }

            // ── Public: toggle individual sub-layer from checkbox ──
            window.toggleRomanSub = function(key, on) {
                _romanEnabled[key] = on;
                if (on && !_romanVisible) {
                    var romanMasterToggle = document.getElementById('romanToggle');
                    if (romanMasterToggle) romanMasterToggle.checked = true;
                    window.toggleRomanLayer(true);
                }
                if (!_romanVisible) return; // group is off, changes take effect when group is turned on
                if (on) {
                    _loadRomanSubLayer(key);
                } else {
                    if (_romanLayers[key] && _romanGroup.hasLayer(_romanLayers[key])) {
                        _romanGroup.removeLayer(_romanLayers[key]);
                    }
                }
            };

            // ── Public: master toggle ──
            window.toggleRomanLayer = function(on) {
                _romanVisible = on;
                if (on) {
                    // The master switch must show a useful layer even when the
                    // previous master-off action cleared every sub-layer.
                    // Default to the canonical maximum extent (117 CE); users
                    // can still select any additional historical layers below.
                    var hasEnabledSubLayer = Object.keys(ROMAN_SUB_LAYERS).some(function (key) {
                        return _romanEnabled[key];
                    });
                    if (!hasEnabledSubLayer) {
                        _romanEnabled.shade_117 = true;
                        var defaultRomanLayer = document.getElementById('roman_shade_117');
                        if (defaultRomanLayer) defaultRomanLayer.checked = true;
                    }
                    _romanGroup.addTo(map);
                    _loadRomanData();
                } else {
                    map.removeLayer(_romanGroup);
                    // Oprirea switch-ului mare "Roman Empire" oprește automat toate
                    // switch-urile substraturilor lui, ca să nu rămână "aprinse" degeaba
                    // deși stratul de pe hartă a fost deja scos.
                    Object.keys(ROMAN_SUB_LAYERS).forEach(function (key) {
                        _romanEnabled[key] = false;
                        var el = document.getElementById('roman_' + key);
                        if (el) el.checked = false;
                    });
                }
                // Sync sub-layer panel visibility
                var subPanel = document.getElementById('romanSubLayers');
                if (subPanel) subPanel.style.opacity = on ? '1' : '0.45';
            };

            var _romanSubExpanded = false;
            window.toggleRomanSubLayers = function() {
                _romanSubExpanded = !_romanSubExpanded;
                var panel = document.getElementById('romanSubLayers');
                var icon = document.getElementById('romanExpandIcon');
                if (_romanSubExpanded) {
                    panel.style.maxHeight = '400px';
                    panel.style.opacity = '1';
                    panel.style.marginTop = '10px';
                    icon.style.transform = 'rotate(0deg)';
                } else {
                    panel.style.maxHeight = '0';
                    panel.style.opacity = '0';
                    panel.style.marginTop = '0';
                    icon.style.transform = 'rotate(-90deg)';
                }
            };

            window.setRomanOpacity = function(val) {
                _romanOpacity = val / 100;
                document.getElementById('romanPct').textContent = val + '%';
                // Update opacity on all active layers
                Object.keys(_romanLayers).forEach(function(key) {
                    var lyr = _romanLayers[key];
                    if (!lyr) return;
                    if (lyr.setOpacity) { lyr.setOpacity(_romanOpacity); } // WMS
                    if (lyr.eachLayer) {
                        lyr.eachLayer(function(sub) {
                            if (sub.setStyle) sub.setStyle({ opacity: _romanOpacity, fillOpacity: _romanOpacity * 0.18 });
                        });
                    } else if (lyr.setStyle) {
                        lyr.setStyle({ opacity: _romanOpacity, fillOpacity: _romanOpacity * 0.18 });
                    }
                });
                var toggle = document.getElementById('romanToggle');
                if (toggle) toggle.checked = (val > 0);
                if (val > 0 && !_romanVisible) window.toggleRomanLayer(true);
            };

            // Reload on pan/zoom when layer is active
            map.on('moveend', function() {
                if (_romanVisible) _loadRomanData();
            });

            // ── LIDAR LAYER SYSTEM ──
            map.createPane('pane_lidar');
            map.getPane('pane_lidar').style.zIndex = 610;
            map.getPane('pane_lidar').style.pointerEvents = 'none';

            var _lidarVisible = false;

            // Sub-layer definitions
            var LIDAR_SUB_LAYERS = {
                hd: {
                    label: 'HD',
                    enabled: false,
                    opacity: 0,
                    type: 'xyz',
                    url: 'https://tiles.arcgis.com/tiles/Q2Kmg0bQDn3rySgn/arcgis/rest/services/HD_MDH_tif/MapServer/tile/{z}/{y}/{x}',
                    leafletLayer: null
                },
                ar: {
                    label: 'AR',
                    enabled: false,
                    opacity: 0,
                    type: 'xyz',
                    url: 'https://tiles.arcgis.com/tiles/Q2Kmg0bQDn3rySgn/arcgis/rest/services/AR_MDH_tif/MapServer/tile/{z}/{y}/{x}',
                    leafletLayer: null
                },
                ab: {
                    label: 'AB',
                    enabled: false,
                    opacity: 0,
                    type: 'xyz',
                    url: 'https://tiles.arcgis.com/tiles/Q2Kmg0bQDn3rySgn/arcgis/rest/services/AB_MDH_tif/MapServer/tile/{z}/{y}/{x}',
                    leafletLayer: null
                },
                bh: {
                    label: 'BH',
                    enabled: false,
                    opacity: 0,
                    type: 'xyz',
                    url: 'https://tiles.arcgis.com/tiles/Q2Kmg0bQDn3rySgn/arcgis/rest/services/BH_MDH_tif/MapServer/tile/{z}/{y}/{x}',
                    leafletLayer: null
                },
                cs: {
                    label: 'CS',
                    enabled: false,
                    opacity: 0,
                    type: 'xyz',
                    url: 'https://tiles.arcgis.com/tiles/Q2Kmg0bQDn3rySgn/arcgis/rest/services/CS_MDH_tif/MapServer/tile/{z}/{y}/{x}',
                    leafletLayer: null
                },
                ro2m: {
                    label: 'Alte zone / Other areas',
                    enabled: false,
                    opacity: 0,
                    type: 'xyz',
                    url: 'https://tiles.arcgis.com/tiles/wCvLzGFkz06gCfBg/arcgis/rest/services/Ro2m/MapServer/tile/{z}/{y}/{x}',
                    maxNativeZoom: 16,
                    className: 'lidar-ro2m-tiles',
                    leafletLayer: null
                },
                cs917: {
                    label: 'CS - LAKI III',
                    enabled: false,
                    opacity: 0,
                    url: 'https://tiles.arcgis.com/tiles/wCvLzGFkz06gCfBg/arcgis/rest/services/CS_917/MapServer/tile/{z}/{y}/{x}',
                    maxNativeZoom: 17,
                    minZoom: 9,
                    leafletLayer: null
                },
                dj917: {
                    label: 'DJ - LAKI III',
                    enabled: false,
                    opacity: 0,
                    url: 'https://tiles.arcgis.com/tiles/wCvLzGFkz06gCfBg/arcgis/rest/services/DJ/MapServer/tile/{z}/{y}/{x}',
                    maxNativeZoom: 17,
                    minZoom: 9,
                    leafletLayer: null
                },
                gj917: {
                    label: 'GJ - LAKI III',
                    enabled: false,
                    opacity: 0,
                    url: 'https://tiles.arcgis.com/tiles/wCvLzGFkz06gCfBg/arcgis/rest/services/GJ_917/MapServer/tile/{z}/{y}/{x}',
                    maxNativeZoom: 17,
                    minZoom: 9,
                    leafletLayer: null
                },
                mh917: {
                    label: 'MH - LAKI III',
                    enabled: false,
                    opacity: 0,
                    url: 'https://tiles.arcgis.com/tiles/wCvLzGFkz06gCfBg/arcgis/rest/services/MH/MapServer/tile/{z}/{y}/{x}',
                    maxNativeZoom: 17,
                    minZoom: 9,
                    leafletLayer: null
                },

            };

            function _buildLidarLeafletLayer(key, cfg) {
                if (cfg.type === 'wms') {
                    return L.tileLayer.wms(cfg.url, {
                        layers: cfg.wmsLayers,
                        format: 'image/png',
                        transparent: true,
                        version: '1.3.0',
                        opacity: cfg.opacity,
                        pane: 'pane_lidar',
                        attribution: '© LIDAR ' + cfg.label,
                        crs: L.CRS.EPSG3857
                    });
                }



                // WMTS via KVP (evita ORB — Leaflet trimite parametrii in query string)
                if (cfg.type === 'wms_kvp') {
                    return L.tileLayer.wms(cfg.url, {
                        service: 'WMTS',
                        version: '1.0.0',
                        request: 'GetTile',
                        layers: cfg.wmsLayers,
                        layer: cfg.wmsLayers,
                        style: 'default',
                        tilematrixset: 'default028mm',
                        format: 'image/png',
                        transparent: true,
                        opacity: cfg.opacity,
                        pane: 'pane_lidar',
                        attribution: '© LIDAR ' + cfg.label,
                        maxZoom: 20,
                        maxNativeZoom: cfg.maxNativeZoom !== undefined ? cfg.maxNativeZoom : 17,
                        minZoom: 9,
                        tileSize: 256,
                        crs: L.CRS.EPSG3857,
                        className: cfg.className || ''
                    });
                }

                // default: xyz tile layer
                return L.tileLayer(cfg.url, {
                    opacity: cfg.opacity,
                    pane: 'pane_lidar',
                    attribution: '© LIDAR ' + cfg.label,
                    maxZoom: 20,
                    maxNativeZoom: cfg.maxNativeZoom !== undefined ? cfg.maxNativeZoom : 18,
                    minZoom: cfg.minZoom !== undefined ? cfg.minZoom : 0,
                    tileSize: 256,
                    crossOrigin: true,
                    className: cfg.className || ''
                });
            }

            var _lidarGroup = L.layerGroup([], { pane: 'pane_lidar' });
            window._lidarGroup = _lidarGroup;

            // ── Public: master toggle ──
            window.toggleLidarLayer = function(on) {
                _lidarVisible = on;
                if (on) {
                    _lidarGroup.addTo(map);
                    Object.keys(LIDAR_SUB_LAYERS).forEach(function(key) {
                        var cfg = LIDAR_SUB_LAYERS[key];
                        if (cfg.enabled && !cfg.leafletLayer) {
                            cfg.leafletLayer = _buildLidarLeafletLayer(key, cfg);
                            _lidarGroup.addLayer(cfg.leafletLayer);
                        } else if (cfg.enabled && cfg.leafletLayer && !_lidarGroup.hasLayer(cfg.leafletLayer)) {
                            _lidarGroup.addLayer(cfg.leafletLayer);
                        }
                    });
                } else {
                    map.removeLayer(_lidarGroup);
                    // Oprirea switch-ului mare "LIDAR" oprește automat toate
                    // substraturile lui (starea internă enabled + slider-ele de
                    // opacitate revin la 0), ca la repornirea masterului să nu
                    // reapară brusc substraturi lăsate "aprinse" din greșeală.
                    Object.keys(LIDAR_SUB_LAYERS).forEach(function (key) {
                        var cfg = LIDAR_SUB_LAYERS[key];
                        cfg.enabled = false;
                    });
                }
                var subPanel = document.getElementById('lidarSubLayers');
                if (subPanel) subPanel.style.opacity = on ? '1' : '0.45';
                if (window._updateCs917ZoomHint) window._updateCs917ZoomHint();
                if (window._updateDj917ZoomHint) window._updateDj917ZoomHint();
                if (window._updateGj917ZoomHint) window._updateGj917ZoomHint();
                if (window._updateMh917ZoomHint) window._updateMh917ZoomHint();
            };

            // ── Public: toggle individual sub-layer ──
            window.toggleLidarSub = function(key, on) {
                var cfg = LIDAR_SUB_LAYERS[key];
                if (!cfg) return;
                cfg.enabled = on;
                if (!_lidarVisible) return;
                if (on) {
                    if (!cfg.leafletLayer) {
                        cfg.leafletLayer = _buildLidarLeafletLayer(key, cfg);
                    }
                    if (!_lidarGroup.hasLayer(cfg.leafletLayer)) {
                        _lidarGroup.addLayer(cfg.leafletLayer);
                    }
                } else {
                    if (cfg.leafletLayer && _lidarGroup.hasLayer(cfg.leafletLayer)) {
                        _lidarGroup.removeLayer(cfg.leafletLayer);
                    }
                }
                if (key === 'cs917' && window._updateCs917ZoomHint) window._updateCs917ZoomHint();
                if (key === 'dj917' && window._updateDj917ZoomHint) window._updateDj917ZoomHint();
                if (key === 'gj917' && window._updateGj917ZoomHint) window._updateGj917ZoomHint();
                if (key === 'mh917' && window._updateMh917ZoomHint) window._updateMh917ZoomHint();
            };

            // ── Public: expand/collapse sub-layer panel ──
            var _lidarSubExpandedState = false;
            window.toggleLidarSubLayers = function() {
                _lidarSubExpandedState = !_lidarSubExpandedState;
                var panel = document.getElementById('lidarSubLayers');
                var icon = document.getElementById('lidarExpandIcon');
                if (_lidarSubExpandedState) {
                    panel.style.maxHeight = '900px';
                    panel.style.opacity = '1';
                    panel.style.marginTop = '10px';
                    icon.style.transform = 'rotate(0deg)';
                } else {
                    panel.style.maxHeight = '0';
                    panel.style.opacity = '0';
                    panel.style.marginTop = '0';
                    icon.style.transform = 'rotate(-90deg)';
                }
            };

            // ── Public: HD opacity slider ──
            window.setLidarHdOpacity = function(val) {
                var opacity = val / 100;
                var cfg = LIDAR_SUB_LAYERS['hd'];
                cfg.opacity = opacity;
                document.getElementById('lidarHdPct').textContent = val + '%';
                if (cfg.leafletLayer && cfg.leafletLayer.setOpacity) {
                    cfg.leafletLayer.setOpacity(opacity);
                }
                if (val > 0 && !cfg.enabled) {
                    window.toggleLidarSub('hd', true);
                }
                var masterToggle = document.getElementById('lidarToggle');
                if (masterToggle && val > 0 && !_lidarVisible) {
                    masterToggle.checked = true;
                    window.toggleLidarLayer(true);
                }
            };



            // ── Public: AR opacity slider ──
            window.setLidarArOpacity = function(val) {
                var opacity = val / 100;
                var cfg = LIDAR_SUB_LAYERS['ar'];
                cfg.opacity = opacity;
                var pctEl = document.getElementById('lidarArPct');
                if (pctEl) pctEl.textContent = val + '%';
                if (cfg.leafletLayer) {
                    // Suprascrie options.opacity astfel incat tile-urile noi (create la zoom) sa mosteneasca valoarea corecta
                    cfg.leafletLayer.options.opacity = opacity;
                    if (cfg.leafletLayer.setOpacity) {
                        cfg.leafletLayer.setOpacity(opacity);
                    }
                }
                if (val > 0 && !cfg.enabled) {
                    window.toggleLidarSub('ar', true);
                }
                var masterToggle = document.getElementById('lidarToggle');
                if (masterToggle && val > 0 && !_lidarVisible) {
                    masterToggle.checked = true;
                    window.toggleLidarLayer(true);
                }
            };

            // ── Public: AB opacity slider ──
            window.setLidarAbOpacity = function(val) {
                var opacity = val / 100;
                var cfg = LIDAR_SUB_LAYERS['ab'];
                cfg.opacity = opacity;
                var pctEl = document.getElementById('lidarAbPct');
                if (pctEl) pctEl.textContent = val + '%';
                if (cfg.leafletLayer) {
                    cfg.leafletLayer.options.opacity = opacity;
                    if (cfg.leafletLayer.setOpacity) {
                        cfg.leafletLayer.setOpacity(opacity);
                    }
                }
                if (val > 0 && !cfg.enabled) {
                    window.toggleLidarSub('ab', true);
                }
                var masterToggle = document.getElementById('lidarToggle');
                if (masterToggle && val > 0 && !_lidarVisible) {
                    masterToggle.checked = true;
                    window.toggleLidarLayer(true);
                }
            };

            // ── Public: BH opacity slider ──
            window.setLidarBhOpacity = function(val) {
                var opacity = val / 100;
                var cfg = LIDAR_SUB_LAYERS['bh'];
                cfg.opacity = opacity;
                var pctEl = document.getElementById('lidarBhPct');
                if (pctEl) pctEl.textContent = val + '%';
                if (cfg.leafletLayer) {
                    cfg.leafletLayer.options.opacity = opacity;
                    if (cfg.leafletLayer.setOpacity) {
                        cfg.leafletLayer.setOpacity(opacity);
                    }
                }
                if (val > 0 && !cfg.enabled) {
                    window.toggleLidarSub('bh', true);
                }
                var masterToggle = document.getElementById('lidarToggle');
                if (masterToggle && val > 0 && !_lidarVisible) {
                    masterToggle.checked = true;
                    window.toggleLidarLayer(true);
                }
            };

            // ── Re-aplica opacitatea LIDAR dupa fiecare zoom ──
            // Leaflet creeaza tile-uri noi la zoom si le initializeaza cu options.opacity,
            // dar GridLayer._resetView() poate reseta containerul. Fortam re-aplicarea.
            // ── Public: CS opacity slider ──
            window.setLidarCsOpacity = function(val) {
                var opacity = val / 100;
                var cfg = LIDAR_SUB_LAYERS['cs'];
                cfg.opacity = opacity;
                var pctEl = document.getElementById('lidarCsPct');
                if (pctEl) pctEl.textContent = val + '%';
                if (cfg.leafletLayer) {
                    cfg.leafletLayer.options.opacity = opacity;
                    if (cfg.leafletLayer.setOpacity) cfg.leafletLayer.setOpacity(opacity);
                }
                if (val > 0 && !cfg.enabled) { window.toggleLidarSub('cs', true); }
                var masterToggle = document.getElementById('lidarToggle');
                if (masterToggle && val > 0 && !_lidarVisible) { masterToggle.checked = true; window.toggleLidarLayer(true); }
            };

            // ── Public: Ro2m (Alte zone / Other areas) opacity slider ──
            window.setLidarRo2mOpacity = function(val) {
                var opacity = val / 100;
                var cfg = LIDAR_SUB_LAYERS['ro2m'];
                cfg.opacity = opacity;
                var pctEl = document.getElementById('lidarRo2mPct');
                if (pctEl) pctEl.textContent = val + '%';
                if (cfg.leafletLayer) {
                    cfg.leafletLayer.options.opacity = opacity;
                    if (cfg.leafletLayer.setOpacity) cfg.leafletLayer.setOpacity(opacity);
                }
                if (val > 0 && !cfg.enabled) { window.toggleLidarSub('ro2m', true); }
                var masterToggle = document.getElementById('lidarToggle');
                if (masterToggle && val > 0 && !_lidarVisible) { masterToggle.checked = true; window.toggleLidarLayer(true); }
            };

            // ── Public: CS917 (CS - LAKI III) opacity slider ──
            window.setLidarCs917Opacity = function(val) {
                var opacity = val / 100;
                var cfg = LIDAR_SUB_LAYERS['cs917'];
                cfg.opacity = opacity;
                var pctEl = document.getElementById('lidarCs917Pct');
                if (pctEl) pctEl.textContent = val + '%';
                if (cfg.leafletLayer) {
                    cfg.leafletLayer.options.opacity = opacity;
                    if (cfg.leafletLayer.setOpacity) cfg.leafletLayer.setOpacity(opacity);
                }
                if (val > 0 && !cfg.enabled) { window.toggleLidarSub('cs917', true); }
                var masterToggle = document.getElementById('lidarToggle');
                if (masterToggle && val > 0 && !_lidarVisible) { masterToggle.checked = true; window.toggleLidarLayer(true); }
                if (window._updateCs917ZoomHint) window._updateCs917ZoomHint();
            };

            // ── CS917 zoom hint ──
            var _CS917_MIN_ZOOM = 9;
            var _cs917HintVisible = false;

            function _updateCs917ZoomHint() {
                var cfg = LIDAR_SUB_LAYERS['cs917'];
                var hint = document.getElementById('cs917ZoomHint');
                if (!hint) return;

                // Only show when: layer is enabled, master LIDAR is on, zoom < minZoom
                var shouldShow = _lidarVisible && cfg.enabled && cfg.opacity > 0 &&
                                 map.getZoom() < _CS917_MIN_ZOOM;

                if (shouldShow && !_cs917HintVisible) {
                    // Build progress pips: current zoom / minZoom  (max 9 pips)
                    var bar = document.getElementById('cs917ZoomBar');
                    if (bar) {
                        bar.innerHTML = '';
                        var cur = Math.max(0, map.getZoom());
                        for (var i = 0; i < _CS917_MIN_ZOOM; i++) {
                            var pip = document.createElement('span');
                            pip.className = 'zh-pip' + (i < cur ? ' filled' : '');
                            bar.appendChild(pip);
                        }
                    }
                    hint.style.display = 'flex';
                    // Trigger transition on next frame
                    requestAnimationFrame(function() { hint.classList.add('visible'); });
                    _cs917HintVisible = true;
                } else if (shouldShow && _cs917HintVisible) {
                    // Update pips while already visible
                    var bar = document.getElementById('cs917ZoomBar');
                    if (bar) {
                        var pips = bar.querySelectorAll('.zh-pip');
                        var cur = Math.max(0, map.getZoom());
                        pips.forEach(function(p, i) {
                            p.classList.toggle('filled', i < cur);
                        });
                    }
                } else if (!shouldShow && _cs917HintVisible) {
                    hint.classList.remove('visible');
                    setTimeout(function() {
                        if (!_cs917HintVisible) hint.style.display = 'none';
                    }, 270);
                    _cs917HintVisible = false;
                }
            }

            // Expose so toggleLidarSub / setLidarCs917Opacity can trigger it too
            window._updateCs917ZoomHint = _updateCs917ZoomHint;

            // ── DJ917 zoom hint ──
            var _DJ917_MIN_ZOOM = 9;
            var _dj917HintVisible = false;

            function _updateDj917ZoomHint() {
                var cfg = LIDAR_SUB_LAYERS['dj917'];
                var hint = document.getElementById('dj917ZoomHint');
                if (!hint) return;

                var shouldShow = _lidarVisible && cfg.enabled && cfg.opacity > 0 &&
                                 map.getZoom() < _DJ917_MIN_ZOOM;

                if (shouldShow && !_dj917HintVisible) {
                    var bar = document.getElementById('dj917ZoomBar');
                    if (bar) {
                        bar.innerHTML = '';
                        var cur = Math.max(0, map.getZoom());
                        for (var i = 0; i < _DJ917_MIN_ZOOM; i++) {
                            var pip = document.createElement('span');
                            pip.className = 'zh-pip' + (i < cur ? ' filled' : '');
                            bar.appendChild(pip);
                        }
                    }
                    hint.style.display = 'flex';
                    requestAnimationFrame(function() { hint.classList.add('visible'); });
                    _dj917HintVisible = true;
                } else if (shouldShow && _dj917HintVisible) {
                    var bar = document.getElementById('dj917ZoomBar');
                    if (bar) {
                        var pips = bar.querySelectorAll('.zh-pip');
                        var cur = Math.max(0, map.getZoom());
                        pips.forEach(function(p, i) {
                            p.classList.toggle('filled', i < cur);
                        });
                    }
                } else if (!shouldShow && _dj917HintVisible) {
                    hint.classList.remove('visible');
                    setTimeout(function() {
                        if (!_dj917HintVisible) hint.style.display = 'none';
                    }, 270);
                    _dj917HintVisible = false;
                }
            }

            window._updateDj917ZoomHint = _updateDj917ZoomHint;

            // ── GJ917 zoom hint ──
            var _GJ917_MIN_ZOOM = 9;
            var _gj917HintVisible = false;

            function _updateGj917ZoomHint() {
                var cfg = LIDAR_SUB_LAYERS['gj917'];
                var hint = document.getElementById('gj917ZoomHint');
                if (!hint) return;

                var shouldShow = _lidarVisible && cfg.enabled && cfg.opacity > 0 &&
                                 map.getZoom() < _GJ917_MIN_ZOOM;

                if (shouldShow && !_gj917HintVisible) {
                    var bar = document.getElementById('gj917ZoomBar');
                    if (bar) {
                        bar.innerHTML = '';
                        var cur = Math.max(0, map.getZoom());
                        for (var i = 0; i < _GJ917_MIN_ZOOM; i++) {
                            var pip = document.createElement('span');
                            pip.className = 'zh-pip' + (i < cur ? ' filled' : '');
                            bar.appendChild(pip);
                        }
                    }
                    hint.style.display = 'flex';
                    requestAnimationFrame(function() { hint.classList.add('visible'); });
                    _gj917HintVisible = true;
                } else if (shouldShow && _gj917HintVisible) {
                    var bar = document.getElementById('gj917ZoomBar');
                    if (bar) {
                        var pips = bar.querySelectorAll('.zh-pip');
                        var cur = Math.max(0, map.getZoom());
                        pips.forEach(function(p, i) {
                            p.classList.toggle('filled', i < cur);
                        });
                    }
                } else if (!shouldShow && _gj917HintVisible) {
                    hint.classList.remove('visible');
                    setTimeout(function() {
                        if (!_gj917HintVisible) hint.style.display = 'none';
                    }, 270);
                    _gj917HintVisible = false;
                }
            }

            window._updateGj917ZoomHint = _updateGj917ZoomHint;

            // ── MH917 zoom hint ──
            var _MH917_MIN_ZOOM = 9;
            var _mh917HintVisible = false;

            function _updateMh917ZoomHint() {
                var cfg = LIDAR_SUB_LAYERS['mh917'];
                var hint = document.getElementById('mh917ZoomHint');
                if (!hint) return;

                var shouldShow = _lidarVisible && cfg.enabled && cfg.opacity > 0 &&
                                 map.getZoom() < _MH917_MIN_ZOOM;

                if (shouldShow && !_mh917HintVisible) {
                    var bar = document.getElementById('mh917ZoomBar');
                    if (bar) {
                        bar.innerHTML = '';
                        var cur = Math.max(0, map.getZoom());
                        for (var i = 0; i < _MH917_MIN_ZOOM; i++) {
                            var pip = document.createElement('span');
                            pip.className = 'zh-pip' + (i < cur ? ' filled' : '');
                            bar.appendChild(pip);
                        }
                    }
                    hint.style.display = 'flex';
                    requestAnimationFrame(function() { hint.classList.add('visible'); });
                    _mh917HintVisible = true;
                } else if (shouldShow && _mh917HintVisible) {
                    var bar = document.getElementById('mh917ZoomBar');
                    if (bar) {
                        var pips = bar.querySelectorAll('.zh-pip');
                        var cur = Math.max(0, map.getZoom());
                        pips.forEach(function(p, i) {
                            p.classList.toggle('filled', i < cur);
                        });
                    }
                } else if (!shouldShow && _mh917HintVisible) {
                    hint.classList.remove('visible');
                    setTimeout(function() {
                        if (!_mh917HintVisible) hint.style.display = 'none';
                    }, 270);
                    _mh917HintVisible = false;
                }
            }

            window._updateMh917ZoomHint = _updateMh917ZoomHint;

            // ── Public: MH917 (MH - LAKI III) opacity slider ──
            window.setLidarMh917Opacity = function(val) {
                var opacity = val / 100;
                var cfg = LIDAR_SUB_LAYERS['mh917'];
                cfg.opacity = opacity;
                var pctEl = document.getElementById('lidarMh917Pct');
                if (pctEl) pctEl.textContent = val + '%';
                if (cfg.leafletLayer) {
                    cfg.leafletLayer.options.opacity = opacity;
                    if (cfg.leafletLayer.setOpacity) cfg.leafletLayer.setOpacity(opacity);
                }
                if (val > 0 && !cfg.enabled) { window.toggleLidarSub('mh917', true); }
                var masterToggle = document.getElementById('lidarToggle');
                if (masterToggle && val > 0 && !_lidarVisible) { masterToggle.checked = true; window.toggleLidarLayer(true); }
                if (window._updateMh917ZoomHint) window._updateMh917ZoomHint();
            };

            // ── Public: GJ917 (GJ - LAKI III) opacity slider ──
            window.setLidarGj917Opacity = function(val) {
                var opacity = val / 100;
                var cfg = LIDAR_SUB_LAYERS['gj917'];
                cfg.opacity = opacity;
                var pctEl = document.getElementById('lidarGj917Pct');
                if (pctEl) pctEl.textContent = val + '%';
                if (cfg.leafletLayer) {
                    cfg.leafletLayer.options.opacity = opacity;
                    if (cfg.leafletLayer.setOpacity) cfg.leafletLayer.setOpacity(opacity);
                }
                if (val > 0 && !cfg.enabled) { window.toggleLidarSub('gj917', true); }
                var masterToggle = document.getElementById('lidarToggle');
                if (masterToggle && val > 0 && !_lidarVisible) { masterToggle.checked = true; window.toggleLidarLayer(true); }
                if (window._updateGj917ZoomHint) window._updateGj917ZoomHint();
            };

            // ── Public: DJ917 (DJ - LAKI III) opacity slider ──
            window.setLidarDj917Opacity = function(val) {
                var opacity = val / 100;
                var cfg = LIDAR_SUB_LAYERS['dj917'];
                cfg.opacity = opacity;
                var pctEl = document.getElementById('lidarDj917Pct');
                if (pctEl) pctEl.textContent = val + '%';
                if (cfg.leafletLayer) {
                    cfg.leafletLayer.options.opacity = opacity;
                    if (cfg.leafletLayer.setOpacity) cfg.leafletLayer.setOpacity(opacity);
                }
                if (val > 0 && !cfg.enabled) { window.toggleLidarSub('dj917', true); }
                var masterToggle = document.getElementById('lidarToggle');
                if (masterToggle && val > 0 && !_lidarVisible) { masterToggle.checked = true; window.toggleLidarLayer(true); }
                if (window._updateDj917ZoomHint) window._updateDj917ZoomHint();
            };

            map.on('zoomend', function() {
                ['ar', 'hd', 'ab', 'bh', 'cs', 'ro2m', 'cs917', 'dj917', 'gj917', 'mh917'].forEach(function(key) {
                    var cfg = LIDAR_SUB_LAYERS[key];
                    if (cfg && cfg.leafletLayer && cfg.enabled && _lidarVisible) {
                        cfg.leafletLayer.options.opacity = cfg.opacity;
                        cfg.leafletLayer.setOpacity(cfg.opacity);
                    }
                });
                _updateCs917ZoomHint();
                _updateDj917ZoomHint();
                _updateGj917ZoomHint();
                _updateMh917ZoomHint();
            });

            // ── SYNC initial state with HTML checkboxes ──
            // Safety net: if the romanToggle checkbox is ever marked checked in HTML,
            // make sure _romanVisible (which starts false) gets synced on page load.
            // With current markup nothing is checked by default, so this is a no-op.
            (function() {
                var toggle = document.getElementById('romanToggle');
                if (toggle && toggle.checked) {
                    window.toggleRomanLayer(true);
                }
            })();

            // ── NEARBY DETECTORISTS ──
            var nearbyLayer = L.layerGroup().addTo(map);
            // Map view captured when the nearby panel is opened, so "back to the
            // initial view" can restore exactly what the user was looking at.
            var _nearbyPrevView = null;
            // Stable per-browser device id so the SAME account signed in on two phones
            // (or two browser tabs) shows up as two distinct nearby detectorists instead
            // of one row overwriting the other. Falls back gracefully if storage is blocked.
            var DETECTOR_DEVICE_ID = (function () {
                try {
                    var d = localStorage.getItem('detector_device_id');
                    if (!d) {
                        d = (window.crypto && crypto.randomUUID)
                            ? crypto.randomUUID()
                            : 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2);
                        localStorage.setItem('detector_device_id', d);
                    }
                    return d;
                } catch (e) {
                    return 'web-' + Math.random().toString(36).slice(2);
                }
            })();
            function nearbyInitials(name) { return (name || '?').trim().split(/\s+/).slice(0,2).map(function(x){return x[0];}).join('').toUpperCase(); }
            function nearbyDistance(a,b,c,d) { var R=6371, x=(c-a)*Math.PI/180, y=(d-b)*Math.PI/180; var q=Math.sin(x/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(y/2)**2; return 2*R*Math.asin(Math.sqrt(q)); }
            function nearbyUser() { return window._authUser && window._authUser(); }
            window.openNearbyDetectors = function() {
                var m = document.getElementById('nearbyModal');
                var hasPins = nearbyLayer && nearbyLayer.getLayers().length > 0;
                
                if (m && (m.classList.contains('show') || hasPins)) {
                    // Modal is already open OR there are already pins on the map (clicking again).
                    // We hide the modal, clear the pins, hide the home button and reset status.
                    m.classList.remove('show');
                    if (nearbyLayer) {
                        nearbyLayer.clearLayers();
                    }
                    var homeBtn = document.getElementById('nearbyHomeBtn');
                    if (homeBtn) homeBtn.style.display = 'none';
                    
                    var btnEl = document.getElementById('nearbyDetectorsBtn');
                    if (btnEl) btnEl.classList.remove('is-active');
                    
                    var status = document.getElementById('nearbyStatus');
                    if (status) {
                        status.innerHTML = 'Cauți detectoriști pe o rază de 10 km?<br><small>Search within a 10 km radius?</small>';
                    }
                } else {
                    if (m) m.classList.add('show');
                    // Remember the current map view so the user can return to the initial
                    // aspect after the search zooms the map to the found pins.
                    _nearbyPrevView = { center: map.getCenter(), zoom: map.getZoom() };
                    // Broadcast our current position right away so others can see us ONLY if we are in detecting mode,
                    // otherwise set visible to false to clear any stale records.
                    if(_detLat !== null && typeof publishDetectorPresence === 'function') {
                        publishDetectorPresence(_detLat, _detLng, _det.active);
                    }
                }
            };
            window.closeNearbyDetectors = function() { var m=document.getElementById('nearbyModal'); if(m)m.classList.remove('show'); };
            // Restore the map view the user had before opening the nearby-detectorists
            // panel (falls back to the initial full-canvas view) and close the panel.
            window.resetNearbyView = function() {
                if (_nearbyPrevView) {
                    map.setView(_nearbyPrevView.center, _nearbyPrevView.zoom);
                    _nearbyPrevView = null;
                } else {
                    map.fitBounds(APM_BOUNDS);
                }
                window.closeNearbyDetectors();
            };
            window.searchNearbyDetectors = async function() {
                var status=document.getElementById('nearbyStatus'); var user=nearbyUser();
                if(!user) { status.innerHTML='Trebuie să fii autentificat pentru această funcție.<br><small>You must be logged in to use this feature.</small>'; return; }
                if(_detLat === null) { status.innerHTML='Activează detectorul (sau partajează locația) pentru a-ți transmite poziția.<br><small>Turn on Detect (or share your location) to broadcast your position.</small>'; return; }
                status.innerHTML='Se caută…<br><small>Searching…</small>';
                try {
                    // Make sure OUR position is freshly published first, so the other
                    // phone can see us even if its search runs a moment earlier (only if we are in detecting mode).
                    await publishDetectorPresence(_detLat, _detLng, _det.active);

                    // Try to read with device_id (new schema). If the migration hasn't been
                    // applied yet, fall back to the legacy columns-only query.
                    var rows, legacySchema = false;
                    var res = await window.supabaseClient
                        .from('detector_presence')
                        .select('user_id,device_id,full_name,email,latitude,longitude')
                        .eq('visible', true);
                    if (res.error) {
                        if (/device_id|column/i.test((res.error.message || '') + (res.error.details || '') + (res.error.hint || ''))) {
                            var res2 = await window.supabaseClient
                                .from('detector_presence')
                                .select('user_id,full_name,email,latitude,longitude')
                                .eq('visible', true);
                            if (res2.error) throw res2.error;
                            rows = res2.data || [];
                            legacySchema = true;
                        } else {
                            throw res.error;
                        }
                    } else {
                        rows = res.data || [];
                    }

                    nearbyLayer.clearLayers();
                    var total = rows.length, found = 0;
                    rows.forEach(function(row){
                        // Skip only OUR device (allow two devices of the same account to see
                        // each other on the new schema; fall back to user match on legacy schema).
                        if (!legacySchema && row.device_id === DETECTOR_DEVICE_ID) return;
                        if (legacySchema && row.user_id === user.id) return;
                        if (nearbyDistance(_detLat,_detLng,+row.latitude,+row.longitude) <= 10) {
                            found++;
                            var icon=L.divIcon({className:'',html:'<div class="detector-nearby-marker" title="'+String(row.full_name||'Detectorist').replace(/[<>&"]/g,'')+'">'+nearbyInitials(row.full_name)+'</div>',iconSize:[32,32],iconAnchor:[16,16]});
                            // zIndexOffset 1100 keeps these pins ABOVE our own live-location
                            // marker (zIndexOffset 1000), so a detectorist standing at ~our
                            // own position is still the one that receives the tap/click.
                            // Clicking a pin opens a small window with full name + email.
                            L.marker([+row.latitude,+row.longitude],{icon:icon,interactive:true,zIndexOffset:1100})
                                .bindPopup('<div class="map-place-popup"><strong>'+String(row.full_name||'Detectorist').replace(/[<>&]/g,'')+'</strong><br>'+String(row.email||'').replace(/[<>&]/g,'')+'</div>')
                                .addTo(nearbyLayer);
                        }
                    });
                    if (found) {
                        status.innerHTML = found + ' detectorist(i) găsit(i) în apropiere.<br><small>' + found + ' detectorist(s) found nearby.</small>';
                        var layers = nearbyLayer.getLayers();
                        // IMPORTANT: never let fitBounds zoom past the satellite base map's
                        // limit (maxNativeZoom 19). With only 1-2 nearby pins, an uncapped
                        // fitBounds jumps to the map max (20) and Leaflet hides every
                        // satellite tile — the "whole base map turns white" bug.
                        if (layers.length) {
                            var bounds = L.latLngBounds(layers.map(function(layer) { return layer.getLatLng(); }));
                            if (_detLat !== null && _detLng !== null) {
                                bounds.extend([_detLat, _detLng]);
                            }
                            map.fitBounds(bounds.pad(0.2), { maxZoom: 17 });
                        }
                        var btnEl = document.getElementById('nearbyDetectorsBtn');
                        if (btnEl) btnEl.classList.add('is-active');
                        var homeBtn = document.getElementById('nearbyHomeBtn');
                        if (homeBtn) homeBtn.style.display = '';
                    } else if (total > 0) {
                        status.innerHTML = 'Niciun detectorist în raza de 10 km (' + total + ' activ(i) în total).<br><small>No detectorists within 10 km (' + total + ' active in total).</small>';
                        var btnEl = document.getElementById('nearbyDetectorsBtn');
                        if (btnEl) btnEl.classList.remove('is-active');
                    } else {
                        status.innerHTML = 'Nu sunt detectoriști în apropiere.<br><small>No detectorists found nearby.</small>';
                        var btnEl = document.getElementById('nearbyDetectorsBtn');
                        if (btnEl) btnEl.classList.remove('is-active');
                    }
                } catch(e) {
                    var msg = (e && (e.message || (e.error && (e.error.message || e.error)) || e.details)) ? (e.message || (e.error && (e.error.message || e.error)) || e.details) : '';
                    console.warn('Nearby detectorists:', e);
                    var hint = '';
                    if (/relation|does not exist|404|schema cache/i.test(msg)) hint = '<br><small>Tabela "detector_presence" lipsește — aplică migrările Supabase.</small>';
                    else if (/permission|policy|42501|rls/i.test(msg)) hint = '<br><small>Acces blocat de RLS — verifică politicile pentru detector_presence.</small>';
                    status.innerHTML = 'Căutarea nu este disponibilă momentan.' + hint + '<br><small>Search unavailable. ' + (msg ? String(msg).slice(0,160) : '') + '</small>';
                }
            };
            async function publishDetectorPresence(lat,lng,visible) {
                try {
                    var u=nearbyUser();
                    if(!u || !window.supabaseClient) return;
                    var md=u.user_metadata||{};
                    var name=u.name||md.full_name||md.name||u.email||'Detectorist';
                    var payload = {
                        user_id:u.id,
                        full_name:name,
                        email:u.email||'',
                        latitude:lat,
                        longitude:lng,
                        visible:visible,
                        updated_at:new Date().toISOString()
                    };
                    try { payload.device_id = DETECTOR_DEVICE_ID; } catch(e){}
                    var result = await window.supabaseClient.from('detector_presence').upsert(payload);
                    if (result.error) {
                        var em = (result.error.message || '') + (result.error.details || '') + (result.error.hint || '');
                        // Legacy schema without the device_id column: retry without it.
                        if (/device_id|column/i.test(em)) {
                            var p2 = {}; for (var k in payload) { if (k !== 'device_id') p2[k] = payload[k]; }
                            var r2 = await window.supabaseClient.from('detector_presence').upsert(p2);
                            if (r2.error) console.warn('[Presence] upsert error:', r2.error.message || r2.error);
                        } else {
                            console.warn('[Presence] upsert error:', result.error.message || result.error);
                        }
                    }
                } catch(e) {
                    console.warn('[Presence] publish failed:', e && e.message ? e.message : e);
                }
            }

            // ── FULLSCREEN ──
            var isFullscreen = false;
            window.toggleMapFullscreen = function () {
                var frame = document.querySelector('.map-frame');
                var wrapper = document.querySelector('.map-wrapper');
                isFullscreen = !isFullscreen;
                frame.classList.toggle('is-fullscreen', isFullscreen);
                wrapper.classList.toggle('is-fullscreen', isFullscreen);
                document.body.style.overflow = isFullscreen ? 'hidden' : '';
                // Update the bottom-bar button label
                var fsLabel = document.getElementById('fsLabel');
                var fsIcon = document.getElementById('fsIcon');
                if (fsLabel) fsLabel.textContent = isFullscreen ? 'Exit Full Screen' : 'Full Screen';
                if (fsIcon) fsIcon.innerHTML = isFullscreen
                    ? '<path d="M5 1V5H1M9 5V1H13M9 13V9H13M1 9H5V13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
                    : '<path d="M1 5V1H5M9 1H13V5M13 9V13H9M5 13H1V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
                setTimeout(function () { map.invalidateSize(); }, 100);
            };
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && isFullscreen) window.toggleMapFullscreen();
            });

            // ── TRANSPARENCY PANEL ──
            var transpPanelOpen = false;
            window.toggleTranspPanel = function () {
                transpPanelOpen = !transpPanelOpen;
                document.getElementById('transpPanel').classList.toggle('open', transpPanelOpen);
                document.getElementById('transpTab').classList.toggle('open', transpPanelOpen);
            };

            // Close panel when clicking outside
            document.addEventListener('click', function (e) {
                if (!transpPanelOpen) return;
                var panel = document.getElementById('transpPanel');
                var tab = document.getElementById('transpTab');
                if (!panel.contains(e.target) && !tab.contains(e.target)) {
                    transpPanelOpen = false;
                    panel.classList.remove('open');
                    tab.classList.remove('open');
                }
            });

            window.setApmOpacity = function (val) {
                var opacity = val / 100;
                if (window._apmLayer) window._apmLayer.setOpacity(opacity);
                document.getElementById('apmPct').textContent = val + '%';
                // Keep the toggle in sync: if opacity > 0 consider layer "on"
                var toggle = document.getElementById('apmToggle');
                if (toggle) toggle.checked = (val > 0);
            };


            window.setSatOpacity = function (val) {
                var opacity = val / 100;
                if (window._satLayer) window._satLayer.setOpacity(opacity);
                document.getElementById('satPct').textContent = val + '%';
            };

            window.setPatrimoniuOpacity = function (val) {
                // Radius opacity slider controls ONLY the canvas FLAT_OPACITY.
                // It has no effect on the Heritage Sites WMS layer or its toggle.
                var wasZero = (FLAT_OPACITY === 0);
                FLAT_OPACITY = val / 100;
                document.getElementById('patrimoniuPct').textContent = val + '%';

                if (val > 0 && !_circlesVisible) {
                    // Slider dragged above 0 while circles are off — turn them on
                    _circlesVisible = true;
                    _displayCanvas.style.display = '';
                }
                if (val > 0 && wasZero) {
                    // Transitioning from hidden → visible: force a data fetch for this viewport
                    loadSiteCircles();
                }
                _scheduleRedraw();
            };

            // Keep opacity slider in sync when APM toggle is switched
            var _origToggle = window.toggleApmLayer;
            window.toggleApmLayer = function (on) {
                _origToggle(on);
                var slider = document.getElementById('apmOpacitySlider');
                if (slider) {
                    var newVal = on ? slider.value : 0;
                    if (!on) {
                        var pct = document.getElementById('apmPct');
                        if (pct) pct.textContent = '0%';
                    }
                }
            };

            // ── PROXIMITY DETECTION ──
            // When enabled: heritage sites + radiuses are turned on automatically.
            // Proximity check reads directly from _circleStore (same data the canvas draws).
            // Edge-triggered: alert fires once on entry, resets when user leaves all radiuses.

            var _det = {
                active: false,
                watchId: null,
                wasInside: false,   // was inside a radius on the last GPS tick?
                alertUp: false    // is the alert currently on screen?
            };

            function _playAlarm() {
                try {
                    var ctx = new (window.AudioContext || window.webkitAudioContext)();
                    [[880, 0, 0.18], [660, 0.22, 0.18], [880, 0.44, 0.18], [660, 0.66, 0.18]].forEach(function (t) {
                        var osc = ctx.createOscillator(), gain = ctx.createGain();
                        osc.connect(gain); gain.connect(ctx.destination);
                        osc.type = 'square';
                        osc.frequency.setValueAtTime(t[0], ctx.currentTime + t[1]);
                        gain.gain.setValueAtTime(0.35, ctx.currentTime + t[1]);
                        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t[1] + t[2]);
                        osc.start(ctx.currentTime + t[1]);
                        osc.stop(ctx.currentTime + t[1] + t[2] + 0.05);
                    });
                } catch (e) { console.warn('[DETECT] audio failed', e); }
            }

            function _detIsInside(lat, lng) {
                var R = 6371000;
                var keys = Object.keys(_circleStore);
                for (var ki = 0; ki < keys.length; ki++) {
                    var shapes = _circleStore[keys[ki]];
                    if (!shapes) continue;
                    for (var si = 0; si < shapes.length; si++) {
                        var s = shapes[si];
                        if (s.type !== 'circle') continue;
                        var dLat = (lat - s.latlng.lat) * Math.PI / 180;
                        var dLng = (lng - s.latlng.lng) * Math.PI / 180;
                        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                            Math.cos(s.latlng.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
                            Math.sin(dLng / 2) * Math.sin(dLng / 2);
                        if (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= s.radius) return true;
                    }
                }
                return false;
            }

            function _detCheck(lat, lng) {
                var inside = _detIsInside(lat, lng);
                if (inside && !_det.wasInside) {
                    _det.wasInside = true;
                    if (!_det.alertUp) {
                        _det.alertUp = true;
                        _playAlarm();
                        document.getElementById('siteAlert').classList.add('visible');
                    }
                } else if (!inside) {
                    _det.wasInside = false;
                    _det.alertUp = false;
                }
            }

            // Called after every new batch of circles loads into _circleStore
            // so if the user is already inside when data arrives, alert fires immediately
            function _detRecheck() {
                if (_det.active && _detLat !== null) _detCheck(_detLat, _detLng);
            }

            var _detLat = null, _detLng = null;

            function _detOnPosition(pos) {
                _detLat = pos.coords.latitude;
                _detLng = pos.coords.longitude;
                publishDetectorPresence(_detLat, _detLng, _det.active);
                _detCheck(_detLat, _detLng);
            }

            // Patch loadSiteCircles to call _detRecheck after each completed fetch
            var _origLoadSiteCircles = loadSiteCircles;
            loadSiteCircles = function () {
                _origLoadSiteCircles();
            };
            // Patch the internal pending===0 completion by wrapping _hideLoader
            var _origHideLoader = _hideLoader;
            _hideLoader = function () {
                _origHideLoader();
                _detRecheck();
            };

            window.toggleDetection = function (on) {
                _det.active = on;
                document.getElementById('detectWrap').classList.toggle('active', on);

                // ── Notify Service Worker + store state ──
                try {
                    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                        navigator.serviceWorker.controller.postMessage({
                            type: 'SET_DETECTION',
                            enabled: on
                        });
                    }
                    localStorage.setItem('detection_enabled', on ? 'true' : 'false');
                } catch (e) {}

                if (on) {
                    if (!navigator.geolocation) {
                        alert('Geolocation is not supported by your browser.');
                        document.getElementById('detectSwitch').checked = false;
                        _det.active = false;
                        document.getElementById('detectWrap').classList.remove('active');
                        return;
                    }

                    // ── Auto-activate live user location on map ──
                    if (typeof window._startLiveLocation === 'function' &&
                        typeof window._isLiveLocationActive === 'function' &&
                        !window._isLiveLocationActive()) {
                        window._startLiveLocation();
                    }

                    // Auto-enable heritage sites layer + radiuses
                    var heritageChk = document.querySelector('input[onchange*="togglePatrimoniuLayer"]');
                    if (heritageChk && !heritageChk.checked) {
                        heritageChk.click();   // triggers togglePatrimoniuLayer(true) which calls loadSiteCircles()
                    } else if (!_circlesVisible) {
                        // Heritage toggle already checked but circles somehow off — force on
                        _circlesVisible = true;
                        FLAT_OPACITY = Math.max(FLAT_OPACITY, 0.25);
                        _displayCanvas.style.display = '';
                        var slider = document.getElementById('patrimoniuOpacitySlider');
                        if (slider && parseInt(slider.value, 10) === 0) {
                            slider.value = 25;
                            document.getElementById('patrimoniuPct').textContent = '25%';
                        }
                        loadSiteCircles();
                    }
                    // loadSiteCircles() is now running (or already has data) —
                    // _hideLoader patch will call _detRecheck() when it completes.

                    // If live location is already active, we already have coordinates —
                    // fire an immediate check instead of waiting for the next GPS tick.
                    // The live-location watcher already publishes presence + checks sites,
                    // so we only start the detection's own watcher as a fallback when
                    // live location is NOT active (to avoid two concurrent watchPosition
                    // calls, which can conflict on mobile browsers).
                    if (_detLat !== null) _detCheck(_detLat, _detLng);

                    if (typeof window._isLiveLocationActive !== 'function' ||
                        !window._isLiveLocationActive()) {
                        // Live location is not active → start detection's own GPS watcher
                        _det.watchId = navigator.geolocation.watchPosition(
                            _detOnPosition,
                            function (e) { console.warn('[DETECT] geo error', e.code, e.message); },
                            { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
                        );
                    } else {
                        // Live location already active → its watcher handles presence + site checks
                        _det.watchId = null;
                    }

                } else {
                    if (_det.watchId !== null) {
                        navigator.geolocation.clearWatch(_det.watchId);
                        _det.watchId = null;
                    }
                    document.getElementById('siteAlert').classList.remove('visible');
                    
                    var presenceUser = nearbyUser();
                    if (presenceUser && window.supabaseClient) {
                        (async function() {
                            try {
                                var query = window.supabaseClient.from('detector_presence').delete().eq('user_id', presenceUser.id);
                                if (typeof DETECTOR_DEVICE_ID !== 'undefined' && DETECTOR_DEVICE_ID) {
                                    query = query.eq('device_id', DETECTOR_DEVICE_ID);
                                }
                                var delRes = await query;
                                if (delRes.error && /device_id|column/i.test(delRes.error.message || '')) {
                                    await window.supabaseClient.from('detector_presence').delete().eq('user_id', presenceUser.id);
                                }
                            } catch (err) {
                                console.warn('[Presence] delete failed:', err);
                                try {
                                    await window.supabaseClient.from('detector_presence').delete().eq('user_id', presenceUser.id);
                                } catch(e2){}
                            }
                        })();
                    }
                    
                    // Reset edge-trigger flags so the alert fires fresh on re-activation.
                    // Keep _detLat/_detLng — they're needed for the immediate recheck when
                    // the switch is turned back on, and harmless to retain while inactive.
                    _det.wasInside = false;
                    _det.alertUp = false;
                }
            };

            window.dismissSiteAlert = function () {
                document.getElementById('siteAlert').classList.remove('visible');
                // alertUp stays true → won't re-fire while still inside the same radius
                // wasInside stays true → resets only when user physically exits
            };

            // ── HISTORICAL MAPS — JOSEPHINE LAYER ──
            (function () {
                // [LEGACY / NEUTILIZAT] Mecanism vechi de citire directă a fișierului SQLite
                // din browser (HTTP Range + parsare manuală B-tree). Era folosit înainte ca
                // tile-urile să fie pre-generate ca JPG static în Cloudflare R2 (vezi _jLayer
                // mai jos, care folosește acum direct L.tileLayer cu URL R2).
                // DB_URL ('localhost:7777') nu mai e accesat de nimic activ — getTile()/
                // findTilesRoot()/scanPage() de mai jos nu sunt apelate de nicăieri în fișier.
                // Păstrat doar ca referință istorică; sigur de șters într-o curățare viitoare.
                var DB_URL = 'http://localhost:7777';
                var MIN_ZOOM = 8;
                var _opacity = 0.80;
                var _visible = false;
                var _expanded = false;

                // ── Tile cache: "z/x/y" → blob: URL ──
                var _tileCache = {};
                // ── [LEGACY] SQLite page cache: pageNo → ArrayBuffer ──
                var _pageCache = {};
                var _PAGE_SIZE = 4096;
                var _pagesSizeConfirmed = false;
                var _tilesRootPage = null;   // will be resolved once on first use

                // ── Leaflet GridLayer ──
                map.createPane('pane_josephine');
                map.getPane('pane_josephine').style.zIndex = 650;
                map.getPane('pane_josephine').style.pointerEvents = 'none';

                var _jLayer = L.tileLayer('https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Josephine/{z}/{x}/{y}.jpg', {
                    minZoom: 8,
                    maxZoom: 20,
                    maxNativeZoom: 15,
                    tileSize: 256,
                    opacity: _opacity,
                    pane: 'pane_josephine'
                });
                window._jLayerRef = _jLayer;
                console.log('[Josephine] _jLayer created:', _jLayer, '| map:', typeof map);

                // ── "Zoom in" hint ──
                var _hintEl = null;
                function _ensureHint() {
                    if (_hintEl) return;
                    _hintEl = document.createElement('div');
                    _hintEl.id = 'josephineZoomHint';
                    _hintEl.style.cssText = [
                        'position:absolute', 'bottom:18px', 'left:50%',
                        'transform:translateX(-50%)',
                        'background:rgba(6,14,30,0.78)',
                        'color:rgba(200,169,110,0.95)',
                        'border:1px solid rgba(200,169,110,0.4)',
                        'border-radius:6px', 'padding:7px 18px',
                        'font-family:Outfit,sans-serif', 'font-size:0.82rem',
                        'font-weight:500', 'letter-spacing:0.04em',
                        'pointer-events:none', 'z-index:800',
                        'backdrop-filter:blur(6px)', 'display:none',
                        'white-space:nowrap'
                    ].join(';');
                    var mapEl = document.getElementById('detectlab-map');
                    if (mapEl) mapEl.appendChild(_hintEl);
                }
                function _updateHint() {
                    _ensureHint();
                    if (!_hintEl) return;
                    var T = (typeof currentLang !== 'undefined' && translations[currentLang])
                        ? translations[currentLang] : translations['en'];
                    _hintEl.textContent = '🗺 ' + (T.hist_zoom_hint || 'Zoom in to see map');
                    _hintEl.style.display = (_visible && map.getZoom() < MIN_ZOOM) ? '' : 'none';
                }
                map.on('zoomend moveend', _updateHint);

                // Patch setLang to refresh hint text on language change
                setTimeout(function () {
                    var _sl = window.setLang;
                    if (typeof _sl === 'function') {
                        window.setLang = function (lang) { _sl(lang); _updateHint(); };
                    }
                }, 0);

                // ── SQLite helpers ──
                function fetchPage(pageNo, cb) {
                    if (_pageCache[pageNo]) { cb(_pageCache[pageNo]); return; }
                    var off = (pageNo - 1) * _PAGE_SIZE;
                    fetch(DB_URL, { headers: { Range: 'bytes=' + off + '-' + (off + _PAGE_SIZE - 1) } })
                        .then(function (r) { return (r.ok || r.status === 206) ? r.arrayBuffer() : null; })
                        .then(function (buf) {
                            if (!buf) { cb(null); return; }
                            if (pageNo === 1 && !_pagesSizeConfirmed) {
                                var ps = new DataView(buf).getUint16(16);
                                if (ps === 1) ps = 65536;
                                if (ps >= 512) _PAGE_SIZE = ps;
                                _pagesSizeConfirmed = true;
                            }
                            _pageCache[pageNo] = buf; cb(buf);
                        }).catch(function () { cb(null); });
                }

                function ru32(buf, off) { return new DataView(buf).getUint32(off); }

                function readVarint(buf, off) {
                    var u = new Uint8Array(buf), r = 0, b = 0;
                    for (var i = 0; i < 9; i++) {
                        b = u[off + i];
                        if (i < 8) { r = r * 128 + (b & 0x7f); if (!(b & 0x80)) return { v: r, n: i + 1 }; }
                        else { r = r * 256 + b; return { v: r, n: 9 }; }
                    }
                    return { v: r, n: 9 };
                }

                function readSerial(buf, off, s) {
                    var dv = new DataView(buf), u8 = new Uint8Array(buf);
                    if (s === 0) return { v: null, n: 0 };
                    if (s === 1) return { v: dv.getInt8(off), n: 1 };
                    if (s === 2) return { v: dv.getInt16(off), n: 2 };
                    if (s === 3) { var x = (u8[off] << 16) | (u8[off+1] << 8) | u8[off+2]; return { v: x >= 0x800000 ? x - 0x1000000 : x, n: 3 }; }
                    if (s === 4) return { v: dv.getInt32(off), n: 4 };
                    if (s === 5) return { v: dv.getInt16(off) * 4294967296 + dv.getUint32(off+2), n: 6 };
                    if (s === 6 || s === 7) return { v: dv.getFloat64(off), n: 8 };
                    if (s === 8) return { v: 0, n: 0 };
                    if (s === 9) return { v: 1, n: 0 };
                    if (s >= 12 && s % 2 === 0) { var ln = (s - 12) / 2; return { v: buf.slice(off, off + ln), n: ln }; }
                    if (s >= 13 && s % 2 === 1) {
                        var tl = (s - 13) / 2, tb = new Uint8Array(buf, off, tl), ts = '';
                        for (var ci = 0; ci < tb.length; ci++) ts += String.fromCharCode(tb[ci]);
                        return { v: ts, n: tl };
                    }
                    return { v: null, n: 0 };
                }

                function parseRecord(buf, ptr) {
                    var off = ptr;
                    var pl = readVarint(buf, off); off += pl.n;
                    var ri = readVarint(buf, off); off += ri.n;
                    var rs = off;
                    var hl = readVarint(buf, off); off += hl.n;
                    var serials = [];
                    while (off < rs + hl.v) { var sv = readVarint(buf, off); off += sv.n; serials.push(sv.v); }
                    var vals = [];
                    for (var i = 0; i < serials.length; i++) { var rv = readSerial(buf, off, serials[i]); vals.push(rv.v); off += rv.n; }
                    return vals;
                }

                // Find "tiles" table root page from sqlite_master (page 1)
                function findTilesRoot(cb) {
                    if (_tilesRootPage !== null) { cb(_tilesRootPage); return; }
                    fetchPage(1, function (buf) {
                        if (!buf) { cb(null); return; }
                        var dv = new DataView(buf);
                        var ptype = dv.getUint8(100); // page 1 has 100-byte file header
                        var cellCount = dv.getUint16(103);
                        for (var i = 0; i < cellCount; i++) {
                            var cptr = dv.getUint16(108 + i * 2);
                            try {
                                var vals = parseRecord(buf, cptr);
                                // sqlite_master cols: type, name, tbl_name, rootpage, sql
                                if (vals[0] === 'table' && vals[1] === 'tiles') {
                                    _tilesRootPage = vals[3];
                                    cb(_tilesRootPage);
                                    return;
                                }
                            } catch (e) { /* skip */ }
                        }
                        cb(null);
                    });
                }

                // Scan a B-tree page for tile (z, x, y) — columns: x, y, z, image
                function scanPage(pageNo, z, x, y, cb) {
                    fetchPage(pageNo, function (buf) {
                        if (!buf) { cb(null); return; }
                        var dv = new DataView(buf);
                        var ptype = dv.getUint8(0);
                        var cellCount = dv.getUint16(3);

                        if (ptype === 0x0d) { // leaf table
                            for (var i = 0; i < cellCount; i++) {
                                var cptr = dv.getUint16(8 + i * 2);
                                try {
                                    var vals = parseRecord(buf, cptr);
                                    if (vals[0] === x && vals[1] === y && vals[2] === z) {
                                        cb(vals[3] ? new Blob([vals[3]], { type: 'image/jpeg' }) : null);
                                        return;
                                    }
                                } catch (e) { /* skip */ }
                            }
                            cb(null);
                        } else if (ptype === 0x05) { // interior table
                            var rm = ru32(buf, 8);
                            var children = [];
                            for (var j = 0; j < cellCount; j++) {
                                var cp = dv.getUint16(12 + j * 2);
                                children.push(ru32(buf, cp));
                            }
                            children.push(rm);
                            var idx = 0;
                            (function next() {
                                if (idx >= children.length) { cb(null); return; }
                                scanPage(children[idx++], z, x, y, function (b) { b ? cb(b) : next(); });
                            })();
                        } else { cb(null); }
                    });
                }

                function getTile(z, x, y, cb) {
                    findTilesRoot(function (root) {
                        if (!root) { cb(null); return; }
                        scanPage(root, z, x, y, cb);
                    });
                }

                // ── Public API ──
                window.toggleHistLayer = function (on) {
                    _visible = on;

                    // Controlează layer-ul Josephine (cel cu SQLite) — respectă sub-toggle
                    var josToggle = document.getElementById('josephineToggle');
                    var josOn = !josToggle || josToggle.checked; // default on if no toggle yet
                    if (on && josOn) {
                        _jLayer.addTo(map);
                        var pane = map.getPane('pane_josephine');
                        if (pane) pane.style.display = '';
                    } else {
                        map.hasLayer(_jLayer) && map.removeLayer(_jLayer);
                    }

                    // Harta Iosefină (iosfree overlay) — respectă sub-toggle
                    var iosToggle = document.getElementById('iosfreeToggle');
                    var iosOn = !iosToggle || iosToggle.checked;
                    if (!on && _currentOverlay) {
                        if (map.hasLayer(_currentOverlay)) {
                            map.removeLayer(_currentOverlay);
                        }
                    } else if (on && iosOn && _currentOverlay) {
                        _currentOverlay.addTo(map);
                    }

                    _updateHint();
                    var sub = document.getElementById('histSubLayers');
                    if (sub) sub.style.opacity = on ? '1' : '0.45';
                };

                window.toggleHistSubLayers = function () {
                    _expanded = !_expanded;
                    var panel = document.getElementById('histSubLayers');
                    var icon  = document.getElementById('histExpandIcon');
                    if (_expanded) {
                        panel.style.maxHeight = '900px'; panel.style.opacity = '1'; panel.style.marginTop = '10px';
                        icon.style.transform = 'rotate(0deg)';
                    } else {
                        panel.style.maxHeight = '0'; panel.style.opacity = '0'; panel.style.marginTop = '0';
                        icon.style.transform = 'rotate(-90deg)';
                    }
                };

                window.setHistOpacity = function (val) {
                    document.getElementById('histOpacityPct').textContent = val + '%';
                    // Apply opacity to Josephine layer if visible
                    if (window._jLayer && map.hasLayer(window._jLayer)) {
                        window._jLayer.setOpacity(val / 100);
                    }
                    // Apply opacity to pane
                    var pane = map.getPane('pane_josephine');
                    if (pane) pane.style.opacity = val / 100;
                };

                window.setJosephineOpacity = function (val) {
                    _opacity = val / 100;
                    document.getElementById('josephinePct').textContent = val + '%';
                    _jLayer.setOpacity(_opacity);
                    var pane = map.getPane('pane_josephine');
                    if (pane) pane.style.opacity = _opacity;
                };

                // ── Patch toggleHistLayer to also control the new WMS layers ──
                var _origToggleHistLayer = window.toggleHistLayer;
                window.toggleHistLayer = function (on) {
                    _origToggleHistLayer(on);
                    // Austrian Map
                    if (window._austrianMapLayer) {
                        var aToggle = document.getElementById('austrianMapToggle');
                        if (!on) {
                            map.hasLayer(window._austrianMapLayer) && map.removeLayer(window._austrianMapLayer);
                        } else if (aToggle && aToggle.checked) {
                            window._austrianMapLayer.addTo(map);
                        }
                    }
                    // Firing Plans
                    if (window._firingPlansLayer) {
                        var fToggle = document.getElementById('firingPlansToggle');
                        if (!on) {
                            map.hasLayer(window._firingPlansLayer) && map.removeLayer(window._firingPlansLayer);
                        } else if (fToggle && fToggle.checked) {
                            window._firingPlansLayer.addTo(map);
                        }
                    }
                    // Soviet Map
                    if (window._sovietMapLayer) {
                        var sToggle = document.getElementById('sovietMapToggle');
                        if (!on) {
                            map.hasLayer(window._sovietMapLayer) && map.removeLayer(window._sovietMapLayer);
                        } else if (sToggle && sToggle.checked) {
                            window._sovietMapLayer.addTo(map);
                        }
                    }
                    // Bucovina 1861-1864, Harta Austro-Ungară, Moldova 1868, Moldova WWII,
                    // Harta tactică poloneză 1933 și WWI sunt acum straturi premium
                    // independente (tab Premium) — nu mai sunt controlate de switch-ul
                    // master Historical Maps.

                    // Oprirea switch-ului mare "Historical Maps" oprește automat toate
                    // switch-urile substraturilor lui (Harta Iosefină gratuită, Harta
                    // Austriacă, Planuri de Tragere, Harta Sovietică) — nu doar stratul
                    // de pe hartă, ci și starea vizuală a switch-ului, ca să nu rămână
                    // "aprins" degeaba.
                    if (!on) {
                        var iosfreeToggleEl = document.getElementById('iosfreeToggle');
                        if (iosfreeToggleEl) iosfreeToggleEl.checked = false;
                        var austrianToggleEl = document.getElementById('austrianMapToggle');
                        if (austrianToggleEl) austrianToggleEl.checked = false;
                        var firingToggleEl = document.getElementById('firingPlansToggle');
                        if (firingToggleEl) firingToggleEl.checked = false;
                        var sovietToggleEl = document.getElementById('sovietMapToggle');
                        if (sovietToggleEl) sovietToggleEl.checked = false;
                        var iosfreeRowEl = document.getElementById('iosfreeRow');
                        if (iosfreeRowEl) iosfreeRowEl.style.opacity = '0.45';
                    }

                    // Actualizăm butonul Buildings Search când Historical Maps e pornit/oprit
                    if (typeof window._refreshIosBldBtnVisibility === 'function') window._refreshIosBldBtnVisibility();
                    if (!on && typeof window.clearIosBldSearchHelp === 'function') window.clearIosBldSearchHelp();
                };

            })(); // end Josephine/Historical Maps

            // ── JOSEPHINE MAP + BUILDINGS SEARCH HELP ────────────────────────────────────
            // Detectează pe Harta Iosefină + (stratul premium) structuri/clădiri istorice
            // folosind un model ONNX (detectlab-v3-best.onnx, servit din Cloudflare R2) în
            // locul vechii euristici de culoare roșie. Poligoanele mai mari returnate de
            // model pot fi opțional subîmpărțite după punctele roșiatice din interior
            // (mai multe clădiri alipite marcate ca un singur box). Rezultatele sunt apoi
            // comparate cu tile-urile raster Buildings/UAT (Cloudflare, vezi
            // uatHasBuildingNear mai sus în fișier) — dacă acolo există deja o clădire
            // modernă, poligonul e ignorat. Exclude și radiusurile siturilor Heritage
            // (același mecanism ca APM 2.0).
            // NOTĂ: filtrul vechi bazat pe distanța până la cel mai apropiat punct OSM
            // (folosit ca să ajusteze pragul de aspect-ratio al clusterelor de culoare) a
            // fost eliminat — nu mai are sens fără detecția pe bază de culoare.
            (function () {
                map.createPane('pane_ios_bld_search_help');
                map.getPane('pane_ios_bld_search_help').style.zIndex = 651;

                var TILE_URL_JOSEPHINE_PLUS = 'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Josephine/{z}/{x}/{y}.jpg';
                var JOSEPHINE_MAX_NATIVE_Z = 15; // ultimul nivel cu tile-uri reale generate static în R2
                var TILE_SIZE  = 256;
                var GRID       = 4;
                // Prag minim de celule GRID×GRID pentru ca un poligon (rezultat din ONNX, sau
                // dintr-o sub-împărțire după puncte roșiatice) să fie considerat valid — sub
                // acest prag e ignorat ca prea mic/zgomot. Expus pe window ca să poată fi
                // coborât live din consolă, fără redeploy.
                window.IOS_BLD_MIN_CLUSTER_CELLS = (window.IOS_BLD_MIN_CLUSTER_CELLS !== undefined) ? window.IOS_BLD_MIN_CLUSTER_CELLS : 4;
                // [LEGACY / NEUTILIZATE] Foloseau la tăierea clusterelor uriașe (>40000 celule) în
                // bucăți de până la 80000 celule, care tot ajungeau desenate ca "clădiri" — doar
                // felii, nu respinse. Înlocuite (2026-07) cu un prag de respingere directă,
                // window.IOS_BLD_MAX_CLUSTER_CELLS (vezi mai jos, lângă filtrul MIN/MAX_CLUSTER_CELLS):
                // orice cluster peste acel prag e aruncat integral, nu mai e tăiat/poligonizat.
                var SPLIT_CLUSTER_CELLS = 40000;
                var MAX_CLUSTER_CELLS   = 80000;
                var MAX_AREA_KM2 = 150;
                // Prag minim de zoom sub care funcționalitatea nu e disponibilă. Coborât la 13
                // (2026-07) ca să fie disponibilă mai devreme; sub acest nivel tile-urile
                // Josephine sunt afișate suficient de mic încât detaliile (clădiri mici, hașură)
                // se pierd prin scalare/antialiasing și rata de fals-pozitive crește.
                // Reglabil live din consolă, fără redeploy: window.IOS_BLD_MIN_ZOOM.
                window.IOS_BLD_MIN_ZOOM = (window.IOS_BLD_MIN_ZOOM !== undefined) ? window.IOS_BLD_MIN_ZOOM : 13;
                // Prag maxim de zoom peste care funcționalitatea nu e disponibilă. Peste
                // nivelul 14, tile-urile raster UAT (Cloudflare R2, nivel nativ 15 — vezi
                // UAT_TILE_Z mai sus în fișier) ajung uneori lipsă/upscalate la randare,
                // ceea ce produce fals-pozitive ("clădire dispărută" deși de fapt tile-ul
                // UAT doar nu s-a randat la acel zoom). Funcționalitatea e limitată strict
                // la zoom 13–14, unde tile-urile UAT sunt randate fiabil. Reglabil live din
                // consolă, fără redeploy: window.IOS_BLD_MAX_ZOOM.
                window.IOS_BLD_MAX_ZOOM = (window.IOS_BLD_MAX_ZOOM !== undefined) ? window.IOS_BLD_MAX_ZOOM : 14;

                // Distanță minimă (metri) față de cea mai apropiată clădire actuală (setul
                // GeoJSON Buildings/UAT, Cloudflare) sub care NU considerăm clădirea drept
                // "dispărută" — chiar dacă bounding box-urile nu se suprapun explicit.
                // Motiv: harta Iosefină + (raster istoric) și tile-urile Buildings actuale
                // au mici erori de georeferențiere/proiecție; o clădire modernă aflată la
                // câțiva zeci de metri e aproape sigur ACEEAȘI clădire, doar ușor deplasată,
                // nu dovada că acolo a dispărut ceva. Peste acest prag, absența unei clădiri
                // apropiate e considerată o dovadă suficient de solidă de dispariție.
                // Reglabil live din consolă, fără redeploy: window.IOS_BLD_MIN_BUILDING_DIST_M.
                window.IOS_BLD_MIN_BUILDING_DIST_M = (window.IOS_BLD_MIN_BUILDING_DIST_M !== undefined) ? window.IOS_BLD_MIN_BUILDING_DIST_M : 150;

                var _running  = false;
                var _resultLG = null;
                var _runGen   = 0; // incrementat la fiecare start/clear, ca să invalidăm callback-urile async "vechi" (Overpass etc.)
                var _hintVisible = false;

                // ── helpers ──────────────────────────────────────────────────────────────

                function _t(key) {
                    var lang = (typeof currentLang !== 'undefined' ? currentLang : 'en') || 'en';
                    var T = (typeof translations !== 'undefined' && translations[lang]) ? translations[lang] : {};
                    return T[key] || key;
                }

                function _toast(msg, ms) {
                    var el = document.getElementById('iosBldSearchHelpToast');
                    if (!el) return;
                    el.textContent = msg;
                    el.style.display = 'block';
                    clearTimeout(el._t);
                    el._t = setTimeout(function () { el.style.display = 'none'; }, ms || 3500);
                }

                function _areaKm2() {
                    var b = map.getBounds(), lat = (b.getNorth() + b.getSouth()) / 2, r = lat * Math.PI / 180;
                    return (b.getNorth()-b.getSouth()) * 111.32 * (b.getEast()-b.getWest()) * 111.32 * Math.cos(r);
                }

                // ── Tile <-> lat/lng (Web Mercator, identic cu APM 2.0) ──
                function lon2tx(lon,z){ return (lon+180)/360*Math.pow(2,z); }
                function lat2ty(lat,z){ var r=lat*Math.PI/180; return (1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*Math.pow(2,z); }
                function tx2lon(x,z){ return x/Math.pow(2,z)*360-180; }
                function ty2lat(y,z){ var n=Math.PI-2*Math.PI*y/Math.pow(2,z); return 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))); }

                // ── Clasificare pixel roșu (folosită DOAR pentru sub-împărțirea poligoanelor ONNX mari) ──
                // Detecția principală de clădiri se face acum prin modelul ONNX (vezi mai jos,
                // _runOnnxDetection), nu prin culoare. _isRed/_rgb2hsv rămân ca helper opțional:
                // când un poligon detectat de model e prea mare (posibil mai multe clădiri
                // alipite marcate ca un singur box), _splitBoxByRedness caută puncte roșiatice
                // (clădiri pe Harta Iosefină, marcate tradițional cu cerneală roșu-cărămizie) în
                // interiorul boxului și îl împarte în componente conexe pe baza lor.
                // Praguri reglabile live din consolă, fără redeploy:
                //   window.IOS_BLD_HUE_LO / _HUE_HI  → interval de nuanță acceptat (roșu-roz, cu wrap la 0°)
                //   window.IOS_BLD_MIN_SAT            → saturație minimă (0-1)
                //   window.IOS_BLD_MIN_VAL             → luminozitate minimă (0-1), exclude cerneala foarte închisă
                window.IOS_BLD_HUE_LO  = (window.IOS_BLD_HUE_LO  !== undefined) ? window.IOS_BLD_HUE_LO  : 330; // grade, wrap peste 360→0
                window.IOS_BLD_HUE_HI  = (window.IOS_BLD_HUE_HI  !== undefined) ? window.IOS_BLD_HUE_HI  : 30;
                // Prag ridicat 0.14→0.39 (2026-07, iterația "3: calibrare pe date reale"):
                // pragul vechi (0.14) lăsa să treacă tonurile dominante de hârtie îmbătrânită
                // și hașură deschisă (ex. rgb(176,144,112), sat≈0.36), care apar de mii de ori
                // pe orice viewport și nu au nicio legătură cu clădirile — de-asta apăreau
                // "poligoane nonsens" presărate pe versanți goi. 0.39 confirmat manual pe
                // harta reală (zona Szek) ca separă bine cerneala de clădire de fundal/hașură.
                window.IOS_BLD_MIN_SAT = (window.IOS_BLD_MIN_SAT !== undefined) ? window.IOS_BLD_MIN_SAT : 0.39;
                window.IOS_BLD_MIN_VAL = (window.IOS_BLD_MIN_VAL !== undefined) ? window.IOS_BLD_MIN_VAL : 0.42;

                // RGB → HSV. h în [0,360), s și v în [0,1].
                function _rgb2hsv(r, g, b) {
                    r /= 255; g /= 255; b /= 255;
                    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
                    var h = 0;
                    if (d !== 0) {
                        if (max === r)      h = ((g - b) / d) % 6;
                        else if (max === g) h = (b - r) / d + 2;
                        else                 h = (r - g) / d + 4;
                        h *= 60;
                        if (h < 0) h += 360;
                    }
                    var s = max === 0 ? 0 : d / max;
                    return { h: h, s: s, v: max };
                }

                function _isRed(r, g, b) {
                    if (r + g + b < 30) return false;
                    var hsv = _rgb2hsv(r, g, b);
                    // Interval de nuanță cu wrap peste 0°/360° (roșu-cărămiziu → roz).
                    var hueOk = (window.IOS_BLD_HUE_LO <= window.IOS_BLD_HUE_HI)
                        ? (hsv.h >= window.IOS_BLD_HUE_LO && hsv.h <= window.IOS_BLD_HUE_HI)
                        : (hsv.h >= window.IOS_BLD_HUE_LO || hsv.h <= window.IOS_BLD_HUE_HI);
                    if (!hueOk) return false;
                    if (hsv.s < window.IOS_BLD_MIN_SAT) return false;
                    if (hsv.v < window.IOS_BLD_MIN_VAL) return false;
                    return true;
                }

                // Verifică dacă un cluster de celule (grilă GRID×GRID) conține ORICE pixel
                // roșiatic (cerneala tradițională pentru clădiri de pe Harta Iosefină) — spre
                // deosebire de _splitBoxByRedness (care cere o densitate minimă pentru a
                // împărți un poligon mare), aici e suficient un singur pixel pentru a considera
                // clusterul "confirmat" prin culoare și a-i crește scorul de încredere.
                function _clusterHasRed(cells, cols, data, compW, compH) {
                    for (var ci = 0; ci < cells.length; ci++) {
                        var gx = cells[ci] % cols, gy = (cells[ci] - gx) / cols;
                        for (var sy = 0; sy < GRID; sy++) {
                            for (var sx = 0; sx < GRID; sx++) {
                                var spx = gx * GRID + sx, spy = gy * GRID + sy;
                                if (spx >= compW || spy >= compH) continue;
                                var pi = (spy * compW + spx) * 4;
                                if (_isRed(data[pi], data[pi+1], data[pi+2])) return true;
                            }
                        }
                    }
                    return false;
                }

                // ── Pas SUPLIMENTAR de poligonizare ("Detector pas adițional") ──────────
                // Criteriu extra, opțional (implicit activ, comutabil din panoul de Setări),
                // aplicat DUPĂ confirmarea obligatorie de roșeață (_clusterHasRed) și ÎNAINTE
                // de verificarea vs Buildings/Overpass. Pornește de la particularitățile
                // vizuale comune identificate pe mostre reale de simbol de clădire de pe
                // Harta Iosefină (contur rotunjit tip "blob", nu poligon geometric drept;
                // umbrire internă parțială — o latură mai închisă, convenție grafică veche
                // pentru relief/acoperiș) și respinge clustere care, deși conțin un pixel
                // roșiatic izolat, nu au și restul semnăturii formă+textură a simbolului —
                // reducând fals-pozitivele de tip "pată/zgomot" sau "hașură dreaptă".
                window.IOS_BLD_EXTRA_MIN_COMPACTNESS = (window.IOS_BLD_EXTRA_MIN_COMPACTNESS !== undefined) ? window.IOS_BLD_EXTRA_MIN_COMPACTNESS : 0.42;
                window.IOS_BLD_EXTRA_MIN_GRAD_STD    = (window.IOS_BLD_EXTRA_MIN_GRAD_STD    !== undefined) ? window.IOS_BLD_EXTRA_MIN_GRAD_STD    : 6;

                function _extraShapeColorValidation(cells, cols, data, compW, compH) {
                    // 1) Compactitate = arie_cluster / arie_bounding_box (0-1). Formele
                    //    rotunjite ("blob") specifice simbolului au compactitate ridicată;
                    //    resping forme alungite/sparse (linii de drum, umbre difuze, zgomot).
                    var gx0=Infinity, gx1=-Infinity, gy0=Infinity, gy1=-Infinity;
                    cells.forEach(function(i){
                        var gx=i%cols, gy=(i-gx)/cols;
                        if(gx<gx0)gx0=gx; if(gx>gx1)gx1=gx;
                        if(gy<gy0)gy0=gy; if(gy>gy1)gy1=gy;
                    });
                    var bboxCells = (gx1-gx0+1) * (gy1-gy0+1);
                    var compactness = bboxCells > 0 ? (cells.length / bboxCells) : 0;
                    if (compactness < window.IOS_BLD_EXTRA_MIN_COMPACTNESS) {
                        return { pass: false, reason: 'compactitate ' + compactness.toFixed(2) + ' < ' + window.IOS_BLD_EXTRA_MIN_COMPACTNESS };
                    }

                    // 2) Umbrire internă: deviația standard a luminozității (V din HSV) în
                    //    interiorul clusterului. Simbolul tradițional are gradient intern
                    //    (nu e o pată complet uniformă); o deviație ~0 sugerează cerneală
                    //    vărsată/zgomot de scanare, nu o clădire desenată.
                    var vals = [];
                    cells.forEach(function(i){
                        var gx=i%cols, gy=(i-gx)/cols;
                        for (var sy=0; sy<GRID; sy++){
                            for (var sx=0; sx<GRID; sx++){
                                var spx=gx*GRID+sx, spy=gy*GRID+sy;
                                if (spx>=compW || spy>=compH) continue;
                                var pi=(spy*compW+spx)*4;
                                vals.push(_rgb2hsv(data[pi], data[pi+1], data[pi+2]).v*255);
                            }
                        }
                    });
                    if (!vals.length) return { pass: false, reason: 'fără pixeli eșantionați' };
                    var mean = vals.reduce(function(a,b){return a+b;},0)/vals.length;
                    var variance = vals.reduce(function(a,b){return a+(b-mean)*(b-mean);},0)/vals.length;
                    var std = Math.sqrt(variance);
                    if (std < window.IOS_BLD_EXTRA_MIN_GRAD_STD) {
                        return { pass: false, reason: 'gradient intern ' + std.toFixed(1) + ' < ' + window.IOS_BLD_EXTRA_MIN_GRAD_STD };
                    }

                    return { pass: true, compactness: compactness, gradStd: std };
                }

                // ── Încărcare tile cu CORS (identic cu APM 2.0 _loadTileImage) ──
                var _CB = '_josbld=' + Math.random().toString(36).slice(2);
                var _tileOkCount = 0, _tileFailCount = 0;
                function _loadTile(url) {
                    return new Promise(function (resolve) {
                        function try1(cors) {
                            var img = new Image();
                            var src = url;
                            if (cors) { img.crossOrigin = 'anonymous'; src += (url.indexOf('?') < 0 ? '?' : '&') + _CB; }
                            img.onload = function () {
                                _tileOkCount++;
                                console.log('[IosBld+] Tile OK (cors=' + cors + '):', src);
                                resolve(img);
                            };
                            img.onerror = function () {
                                if (cors) {
                                    console.warn('[IosBld+] Tile fail (CORS try), retrying fără CORS:', src);
                                    try1(false);
                                } else {
                                    _tileFailCount++;
                                    console.error('[IosBld+] Tile FAILED complet (Josephine Map+ tile server inaccesibil):', src);
                                    resolve(null);
                                }
                            };
                            img.src = src;
                        }
                        try1(true);
                    });
                }

                // ── BFS flood-fill (8-conectivitate) ──
                function _connComp(mask, cols, rows) {
                    var vis = new Uint8Array(cols * rows), comps = [];
                    var dxs = [-1,1,0,0,-1,1,-1,1], dys = [0,0,-1,1,-1,-1,1,1];
                    for (var idx = 0; idx < cols * rows; idx++) {
                        if (vis[idx] || !mask[idx]) continue;
                        var st = [idx], cells = []; vis[idx] = 1;
                        while (st.length) {
                            var c = st.pop(); cells.push(c);
                            var cx = c % cols, cy = (c - cx) / cols;
                            for (var d = 0; d < 8; d++) {
                                var nx = cx+dxs[d], ny = cy+dys[d];
                                if (nx<0||ny<0||nx>=cols||ny>=rows) continue;
                                var ni = ny*cols+nx;
                                if (!vis[ni] && mask[ni]) { vis[ni]=1; st.push(ni); }
                            }
                        }
                        comps.push(cells);
                    }
                    return comps;
                }

                // ── Convex hull (monotone chain) ──
                function _hull(pts) {
                    if (pts.length < 3) return pts;
                    pts = pts.slice().sort(function(a,b){ return a[0]-b[0]||a[1]-b[1]; });
                    function cr(o,a,b){ return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]); }
                    var lo=[], hi=[];
                    for (var i=0;i<pts.length;i++){ while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],pts[i])<=0)lo.pop(); lo.push(pts[i]); }
                    for (var j=pts.length-1;j>=0;j--){ while(hi.length>=2&&cr(hi[hi.length-2],hi[hi.length-1],pts[j])<=0)hi.pop(); hi.push(pts[j]); }
                    hi.pop(); lo.pop(); return lo.concat(hi);
                }

                // ── Moore neighborhood tracing (contur cluster) ──
                function _contour(cells, cols, csz) {
                    var cs = {}; cells.forEach(function(i){ cs[i]=true; });
                    function has(x,y){ return x>=0&&y>=0&&!!cs[y*cols+x]; }
                    var si = cells.reduce(function(b,i){ var bx=b%cols,by=(b-bx)/cols,ix=i%cols,iy=(i-ix)/cols; return (iy<by||(iy===by&&ix<bx))?i:b; }, cells[0]);
                    var sx=si%cols, sy=(si-sx)/cols;
                    var dxs=[1,1,0,-1,-1,-1,0,1], dys=[0,1,1,1,0,-1,-1,-1];
                    var out=[], cx=sx, cy=sy, dir=7, max=cells.length*4+8, steps=0;
                    do {
                        out.push([cx*csz+csz/2, cy*csz+csz/2]);
                        var bd=(dir+4)%8, ok=false;
                        for (var d=0;d<8;d++){ var nd=(bd+1+d)%8, nx=cx+dxs[nd], ny=cy+dys[nd]; if(has(nx,ny)){ cx=nx;cy=ny;dir=nd;ok=true;break; } }
                        if (!ok) break;
                    } while ((cx!==sx||cy!==sy) && ++steps<max);
                    if (out.length<3) { var ps=cells.map(function(i){ var x=i%cols,y=(i-x)/cols; return [x*csz+csz/2,y*csz+csz/2]; }); return _hull(ps); }
                    return out;
                }

                // ── Bisecție geometrică pentru clustere mari ──
                function _split(cells, cols, max) {
                    if (cells.length <= max) return [cells];
                    var ps = cells.map(function(i){ var x=i%cols,y=(i-x)/cols; return {i:i,x:x,y:y}; });
                    var mnX=Infinity,mxX=-Infinity,mnY=Infinity,mxY=-Infinity;
                    ps.forEach(function(p){ if(p.x<mnX)mnX=p.x; if(p.x>mxX)mxX=p.x; if(p.y<mnY)mnY=p.y; if(p.y>mxY)mxY=p.y; });
                    var onX = (mxX-mnX) >= (mxY-mnY);
                    ps.sort(function(a,b){ return onX?(a.x-b.x):(a.y-b.y); });
                    var mid = Math.floor(ps.length/2);
                    return _split(ps.slice(0,mid).map(function(p){return p.i;}), cols, max)
                          .concat(_split(ps.slice(mid).map(function(p){return p.i;}), cols, max));
                }

                // ── Detecție ONNX (model detectlab-v3-best.onnx, Cloudflare R2) ──────────
                // Înlocuiește vechea euristică de culoare roșie + filtre de formă/aspect (care
                // depindeau de distanța până la cel mai apropiat punct OSM). Modelul rulează
                // direct pe imaginea compusă din tile-urile Josephine Map+ și întoarce
                // bounding box-uri pentru clădiri/structuri istorice.
                var ONNX_MODEL_URL = 'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/detectlab-v3-best.onnx';
                // Praguri reglabile live din consolă, fără redeploy:
                window.IOS_BLD_ONNX_INPUT_SIZE   = (window.IOS_BLD_ONNX_INPUT_SIZE   !== undefined) ? window.IOS_BLD_ONNX_INPUT_SIZE   : 640;  // fallback dacă metadata modelului nu expune dimensiunea de intrare
                window.IOS_BLD_ONNX_CONF         = (window.IOS_BLD_ONNX_CONF         !== undefined) ? window.IOS_BLD_ONNX_CONF         : 0.25; // prag minim de încredere per detecție
                window.IOS_BLD_ONNX_IOU          = (window.IOS_BLD_ONNX_IOU          !== undefined) ? window.IOS_BLD_ONNX_IOU          : 0.45; // prag IoU pentru NMS
                window.IOS_BLD_ONNX_TILE_OVERLAP = (window.IOS_BLD_ONNX_TILE_OVERLAP !== undefined) ? window.IOS_BLD_ONNX_TILE_OVERLAP : 0.2;  // suprapunere între decupajele trimise modelului (0-1)
                // Arie (px² pe canvas-ul compus) peste care un poligon ONNX e considerat "prea
                // mare" pentru o singură clădire și e împărțit după punctele roșiatice din
                // interior (opțional — vezi _splitBoxByRedness mai jos).
                // [LEGACY / NEUTILIZAT activ] Fostul prag de arie de la care se aplica
                // split-ul după roșeață. De la introducerea _tightenBoxToRedCells (2026-07),
                // strângerea la celule roșii rulează pe FIECARE box, indiferent de mărime,
                // deci acest prag nu mai controlează comportamentul — lăsat declarat doar
                // pentru compatibilitate cu eventuale referințe externe/console.
                window.IOS_BLD_ONNX_SPLIT_AREA_PX2 = (window.IOS_BLD_ONNX_SPLIT_AREA_PX2 !== undefined) ? window.IOS_BLD_ONNX_SPLIT_AREA_PX2 : 2500;
                window.IOS_BLD_ONNX_SPLIT_ENABLED  = (window.IOS_BLD_ONNX_SPLIT_ENABLED  !== undefined) ? window.IOS_BLD_ONNX_SPLIT_ENABLED  : true;

                // Limită DURĂ de mărime (px pe canvas-ul compus) pentru orice poligon FINAL,
                // aplicată indiferent dacă split-ul după roșeață (mai sus) a găsit ceva sau
                // nu. Motiv: un box ONNX mare care acoperă un grup dens de clădiri poate să
                // nu aibă pixeli roșiatici suficient de clari (hașură, cerneală decolorată,
                // etc.), caz în care _splitBoxByRedness întoarce [] și boxul rămânea întreg
                // — un singur poligon uriaș peste multe clădiri, imposibil de comparat corect
                // cu tile-ul vectorial Buildings (unde clădirile sunt separate). Aici tăiem
                // orice poligon mai mare de acest prag pe o grilă fixă de bucăți de cel mult
                // IOS_BLD_ONNX_MAX_POLY_PX pe fiecare axă, păstrând doar celulele reale din
                // fiecare bucată (nu dreptunghiuri goale) — rezultă mai multe poligoane mici,
                // fiecare verificat individual față de Buildings. Reglabil live din consolă,
                // fără redeploy: window.IOS_BLD_ONNX_MAX_POLY_PX.
                window.IOS_BLD_ONNX_MAX_POLY_PX = (window.IOS_BLD_ONNX_MAX_POLY_PX !== undefined) ? window.IOS_BLD_ONNX_MAX_POLY_PX : 44;

                var _ortSessionPromise = null;
                function _getOnnxSession() {
                    if (!_ortSessionPromise) {
                        if (typeof ort === 'undefined') {
                            console.error('[IosBld+][ONNX] onnxruntime-web (ort) nu e încărcat — verifică tag-ul <script> din <head>.');
                            return Promise.reject(new Error('onnxruntime-web (ort) nu e încărcat'));
                        }
                        try { ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/'; } catch(e) {}
                        console.log('[IosBld+][ONNX] Încarc modelul:', ONNX_MODEL_URL);
                        _ortSessionPromise = ort.InferenceSession.create(ONNX_MODEL_URL, { executionProviders: ['wasm'] })
                            .then(function(session) {
                                console.log('[IosBld+][ONNX] Model încărcat. Input(uri):', session.inputNames, '| Output(uri):', session.outputNames);
                                return session;
                            })
                            .catch(function(err) {
                                console.error('[IosBld+][ONNX] Eroare la încărcarea modelului:', err);
                                _ortSessionPromise = null;
                                throw err;
                            });
                    }
                    return _ortSessionPromise;
                }

                // Dimensiunea de intrare așteptată de model (presupusă pătrată H=W). Încearcă
                // să o citească din metadata sesiunii; dacă nu e disponibilă (variază între
                // versiunile onnxruntime-web), folosește window.IOS_BLD_ONNX_INPUT_SIZE.
                function _onnxInputSize(session) {
                    try {
                        var meta = session.inputMetadata && session.inputMetadata[0];
                        var dims = meta && (meta.dimensions || meta.shape);
                        if (dims && dims.length === 4 && typeof dims[2] === 'number' && dims[2] > 0 && typeof dims[3] === 'number' && dims[3] > 0) {
                            return { w: dims[3], h: dims[2] };
                        }
                    } catch (e) { /* fallback mai jos */ }
                    return { w: window.IOS_BLD_ONNX_INPUT_SIZE, h: window.IOS_BLD_ONNX_INPUT_SIZE };
                }

                // Decupează o regiune din canvas-ul sursă, o redimensionează la (tw x th) și
                // întoarce un ort.Tensor float32 NCHW normalizat [0,1] (RGB).
                function _canvasCropToTensor(srcCanvas, sx, sy, sw, sh, tw, th) {
                    var c = document.createElement('canvas');
                    c.width = tw; c.height = th;
                    var cctx = c.getContext('2d');
                    cctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, tw, th);
                    var d = cctx.getImageData(0, 0, tw, th).data;
                    var floatData = new Float32Array(3 * tw * th);
                    var plane = tw * th;
                    for (var i = 0; i < plane; i++) {
                        var pi = i * 4;
                        floatData[i]         = d[pi]   / 255; // R
                        floatData[plane + i] = d[pi+1] / 255; // G
                        floatData[2*plane+i] = d[pi+2] / 255; // B
                    }
                    return new ort.Tensor('float32', floatData, [1, 3, th, tw]);
                }

                function _iou(a, b) {
                    var x1 = Math.max(a.x0, b.x0), y1 = Math.max(a.y0, b.y0);
                    var x2 = Math.min(a.x1, b.x1), y2 = Math.min(a.y1, b.y1);
                    var iw = Math.max(0, x2 - x1), ih = Math.max(0, y2 - y1);
                    var inter = iw * ih;
                    var areaA = (a.x1-a.x0)*(a.y1-a.y0), areaB = (b.x1-b.x0)*(b.y1-b.y0);
                    var uni = areaA + areaB - inter;
                    return uni <= 0 ? 0 : inter / uni;
                }

                function _nms(boxes) {
                    boxes = boxes.slice().sort(function(a,b){ return b.score - a.score; });
                    var kept = [];
                    boxes.forEach(function(b) {
                        for (var i = 0; i < kept.length; i++) {
                            if (_iou(b, kept[i]) > window.IOS_BLD_ONNX_IOU) return;
                        }
                        kept.push(b);
                    });
                    return kept;
                }

                // Parsează output-ul brut (format tipic export Ultralytics/YOLO: [1, 4+nc, N]
                // sau [1, N, 4+nc]) și întoarce box-uri {x0,y0,x1,y1,score} în spațiul de
                // pixeli al input-ului modelului (tw x th).
                function _parseYoloOutput(outputTensor, tw, th) {
                    var dims = outputTensor.dims, data = outputTensor.data;
                    if (!dims || dims.length !== 3) { console.warn('[IosBld+][ONNX] Format output neașteptat (dims):', dims); return []; }
                    var d1 = dims[1], d2 = dims[2];
                    var anchorsFirst = d1 > d2; // adică forma e [1, N, C] în loc de [1, C, N]
                    var N = anchorsFirst ? d1 : d2;
                    var C = anchorsFirst ? d2 : d1;
                    var nc = Math.max(1, C - 4);
                    var boxes = [];
                    for (var i = 0; i < N; i++) {
                        var val = anchorsFirst
                            ? function(ch){ return data[i*C + ch]; }
                            : function(ch){ return data[ch*N + i]; };
                        var cx = val(0), cy = val(1), w = val(2), h = val(3);
                        var bestScore = 0;
                        for (var c = 0; c < nc; c++) { var s = val(4 + c); if (s > bestScore) bestScore = s; }
                        if (bestScore < window.IOS_BLD_ONNX_CONF) continue;
                        boxes.push({ x0: cx - w/2, y0: cy - h/2, x1: cx + w/2, y1: cy + h/2, score: bestScore });
                    }
                    return boxes;
                }

                // Rulează modelul pe canvas-ul compus (decupat în ferestre de dimensiunea de
                // intrare a modelului, cu suprapunere + NMS global) și întoarce o listă de
                // "componente" (array-uri de indici de celule GRID×GRID) — exact formatul pe
                // care restul pipeline-ului (heritage mask, _contour, verificare Buildings) îl
                // aștepta și de la vechea detecție pe bază de culoare.
                function _runOnnxDetection(imgData, compW, compH, cols, rows) {
                    return _getOnnxSession().then(function(session) {
                        var inSize = _onnxInputSize(session);
                        var srcCanvas = document.createElement('canvas');
                        srcCanvas.width = compW; srcCanvas.height = compH;
                        srcCanvas.getContext('2d').putImageData(imgData, 0, 0);

                        var stepW = Math.max(1, Math.round(inSize.w * (1 - window.IOS_BLD_ONNX_TILE_OVERLAP)));
                        var stepH = Math.max(1, Math.round(inSize.h * (1 - window.IOS_BLD_ONNX_TILE_OVERLAP)));
                        var crops = [];
                        for (var oy = 0; oy < compH; oy += stepH) {
                            for (var ox = 0; ox < compW; ox += stepW) {
                                var cw = Math.min(inSize.w, compW - ox), ch = Math.min(inSize.h, compH - oy);
                                if (cw < 8 || ch < 8) continue;
                                crops.push({ ox: ox, oy: oy, cw: cw, ch: ch });
                            }
                        }
                        console.log('[IosBld+][ONNX] Decupaje de inferență:', crops.length, '| dimensiune model:', inSize.w+'x'+inSize.h);

                        var allBoxes = [];
                        var inputName = session.inputNames[0];

                        function runOne(idx) {
                            if (idx >= crops.length) return Promise.resolve();
                            var crop = crops[idx];
                            var tensor = _canvasCropToTensor(srcCanvas, crop.ox, crop.oy, crop.cw, crop.ch, inSize.w, inSize.h);
                            var feeds = {}; feeds[inputName] = tensor;
                            return session.run(feeds).then(function(results) {
                                var outName = session.outputNames[0];
                                var out = results[outName] || results[Object.keys(results)[0]];
                                var boxes = _parseYoloOutput(out, inSize.w, inSize.h);
                                var scaleX = crop.cw / inSize.w, scaleY = crop.ch / inSize.h;
                                boxes.forEach(function(b) {
                                    allBoxes.push({
                                        x0: crop.ox + b.x0*scaleX, y0: crop.oy + b.y0*scaleY,
                                        x1: crop.ox + b.x1*scaleX, y1: crop.oy + b.y1*scaleY,
                                        score: b.score
                                    });
                                });
                                return runOne(idx + 1);
                            });
                        }

                        return runOne(0).then(function() {
                            console.log('[IosBld+][ONNX] Detecții brute (înainte de NMS):', allBoxes.length);
                            var kept = _nms(allBoxes);
                            console.log('[IosBld+][ONNX] Detecții după NMS:', kept.length,
                                '(prag conf=' + window.IOS_BLD_ONNX_CONF + ', IoU=' + window.IOS_BLD_ONNX_IOU + ')');

                            var bigComps = [];
                            var _droppedNoRed = 0;
                            kept.forEach(function(box) {
                                var areaPx2 = (box.x1-box.x0) * (box.y1-box.y0);
                                // Strângem ÎNTOTDEAUNA boxul la celulele cu cerneală roșie reală —
                                // nu doar pentru boxuri "mari" ca înainte. Asta evită poligoane
                                // largi desenate peste teren gol în jurul unei clădiri mici.
                                var pieces = window.IOS_BLD_ONNX_SPLIT_ENABLED
                                    ? _tightenBoxToRedCells(imgData.data, compW, compH, cols, rows, box)
                                    : [_boxToCells(box, cols)];
                                if (!pieces.length) {
                                    // Nicio urmă de roșu în tot boxul → nu mai desenăm boxul întreg
                                    // (comportamentul vechi). Aruncăm complet detecția.
                                    _droppedNoRed++;
                                    return;
                                }
                                if (pieces.length > 1 || (pieces[0] && pieces[0].length < _boxToCells(box, cols).length)) {
                                    console.log('[IosBld+][ONNX] Box (' + Math.round(areaPx2) + 'px²) strâns la', pieces.length, 'sub-poligon(oane) pe baza punctelor roșiatice (bulinele clădirii), în loc de boxul YOLO întreg.');
                                }
                                // Capare finală de mărime maximă (grilă fixă) — rulează întotdeauna,
                                // ca plasă de siguranță pentru clustere anormal de mari rămase
                                // după strângere. Vezi window.IOS_BLD_ONNX_MAX_POLY_PX mai sus.
                                pieces.forEach(function(p) {
                                    var capped = _capPolygonSize(p, cols);
                                    if (capped.length > 1) {
                                        console.log('[IosBld+][ONNX] Poligon peste limita de', window.IOS_BLD_ONNX_MAX_POLY_PX, 'px → tăiat în', capped.length, 'bucăți (grilă fixă).');
                                    }
                                    // Păstrăm scorul de încredere al detecției ONNX-sursă alături de fiecare
                                    // bucată rezultată (folosit apoi în popup-ul de feedback 👍/👎).
                                    capped.forEach(function(c) { bigComps.push({ cells: c, score: box.score }); });
                                });
                            });
                            if (_droppedNoRed) {
                                console.log('[IosBld+][ONNX] Boxuri aruncate complet (fără nicio urmă de roșu în interior):', _droppedNoRed, '/', kept.length);
                            }
                            return bigComps;
                        });
                    });
                }

                // Taie un poligon (listă de indici de celule GRID×GRID) într-o grilă fixă de
                // bucăți de cel mult window.IOS_BLD_ONNX_MAX_POLY_PX pe fiecare axă, dacă
                // bounding box-ul lui depășește acest prag. Păstrează doar celulele reale din
                // fiecare bucată (nu creează dreptunghiuri goale) și elimină bucățile prea
                // mici (sub IOS_BLD_MIN_CLUSTER_CELLS). Dacă poligonul e deja sub prag, sau
                // dacă toate bucățile rezultate ar fi eliminate ca prea mici, întoarce
                // poligonul original neschimbat (nu aruncăm date bune din cauza limitei).
                function _capPolygonSize(cells, cols) {
                    var maxCellsPerSide = Math.max(1, Math.round((window.IOS_BLD_ONNX_MAX_POLY_PX || 70) / GRID));
                    var gx0=Infinity, gx1=-Infinity, gy0=Infinity, gy1=-Infinity;
                    cells.forEach(function(i){
                        var gx=i%cols, gy=(i-gx)/cols;
                        if(gx<gx0)gx0=gx; if(gx>gx1)gx1=gx;
                        if(gy<gy0)gy0=gy; if(gy>gy1)gy1=gy;
                    });
                    var w = gx1-gx0+1, h = gy1-gy0+1;
                    if (w <= maxCellsPerSide && h <= maxCellsPerSide) return [cells];

                    var buckets = {};
                    cells.forEach(function(i){
                        var gx=i%cols, gy=(i-gx)/cols;
                        var bx = Math.floor((gx-gx0)/maxCellsPerSide);
                        var by = Math.floor((gy-gy0)/maxCellsPerSide);
                        var key = bx+'_'+by;
                        (buckets[key] = buckets[key] || []).push(i);
                    });
                    var out = [];
                    Object.keys(buckets).forEach(function(k){
                        var piece = buckets[k];
                        if (piece.length >= (window.IOS_BLD_MIN_CLUSTER_CELLS || 2)) out.push(piece);
                    });
                    return out.length ? out : [cells];
                }

                // Rasterizează un bounding box (px pe canvas-ul compus) în indici de celule
                // GRID×GRID — aceeași grilă folosită de heritage mask / _contour / etc.
                function _boxToCells(box, cols) {
                    var gx0 = Math.max(0, Math.floor(box.x0 / GRID));
                    var gx1 = Math.max(gx0, Math.floor((box.x1 - 1) / GRID));
                    var gy0 = Math.max(0, Math.floor(box.y0 / GRID));
                    var gy1 = Math.max(gy0, Math.floor((box.y1 - 1) / GRID));
                    var cells = [];
                    for (var gy = gy0; gy <= gy1; gy++) {
                        for (var gx = gx0; gx <= Math.min(gx1, cols - 1); gx++) {
                            cells.push(gy * cols + gx);
                        }
                    }
                    return cells;
                }

                // Împarte un poligon ONNX prea mare în bucăți mai mici, urmărind punctele
                // roșiatice din interiorul lui (reutilizează _isRed + _connComp existente) —
                // util când modelul marchează mai multe clădiri alipite ca un singur box.
                // Dacă nu găsește nimic roșiatic în interior, întoarce [] și boxul rămâne întreg.
                function _splitBoxByRedness(data, compW, compH, cols, rows, box) {
                    var gx0 = Math.max(0, Math.floor(box.x0 / GRID)), gx1 = Math.min(cols-1, Math.floor(box.x1 / GRID));
                    var gy0 = Math.max(0, Math.floor(box.y0 / GRID)), gy1 = Math.min(rows-1, Math.floor(box.y1 / GRID));
                    var mask = new Uint8Array(cols * rows);
                    var any = false;
                    for (var gy = gy0; gy <= gy1; gy++) {
                        for (var gx = gx0; gx <= gx1; gx++) {
                            var vRed = 0, vTot = 0;
                            for (var sy = 0; sy < GRID; sy++) for (var sx = 0; sx < GRID; sx++) {
                                var spx = gx*GRID+sx, spy = gy*GRID+sy;
                                if (spx >= compW || spy >= compH) continue;
                                var pi = (spy*compW+spx)*4;
                                vTot++;
                                if (_isRed(data[pi], data[pi+1], data[pi+2])) vRed++;
                            }
                            if (vTot && vRed >= (window.IOS_BLD_CELL_MIN_COUNT || 4) && vRed > (vTot - vRed) * (window.IOS_BLD_CELL_MIN_RATIO || 0.6)) {
                                mask[gy*cols+gx] = 1; any = true;
                            }
                        }
                    }
                    if (!any) return [];
                    return _connComp(mask, cols, rows).filter(function(c) { return c.length >= (window.IOS_BLD_MIN_CLUSTER_CELLS || 2); });
                }

                // ── Strângerea poligonului la "bulinele" reale de clădire ──────────────
                // Motiv: un box YOLO poate fi mult mai mare decât simbolul de clădire pe
                // care îl încadrează, iar vechiul comportament desena ÎNTREGUL box brut de
                // îndată ce conținea UN SINGUR pixel roșiatic (vezi _clusterHasRed) —
                // rezultând poligoane mari peste teren gol în jurul unei clădiri mici, sau
                // chiar peste zone fără nicio clădire (un singur pixel roșu-maroniu izolat,
                // hașură decolorată etc.). _tightenBoxToRedCells încearcă întâi pragul
                // STRICT (densitate ridicată de roșu per celulă — cerneala reală a
                // simbolului), apoi un prag PERMISIV (celulă cu ≥1 pixel roșiatic) doar ca
                // rezervă — și, spre deosebire de comportamentul vechi, NU mai cade înapoi
                // pe boxul întreg dacă nu găsește nimic: boxul e aruncat complet (vezi
                // apelul din _runOnnxDetection). Rezultatul e apoi dilatat cu o mică marjă
                // (window.IOS_BLD_TIGHTEN_PAD_CELLS celule) ca poligonul să nu taie exact
                // prin pixelii de cerneală, dar rămâne mult mai aproape de simbolul real
                // decât boxul YOLO original.
                window.IOS_BLD_TIGHTEN_PAD_CELLS = (window.IOS_BLD_TIGHTEN_PAD_CELLS !== undefined) ? window.IOS_BLD_TIGHTEN_PAD_CELLS : 1;

                function _looseRedCellMask(data, compW, compH, cols, rows, box) {
                    var gx0 = Math.max(0, Math.floor(box.x0 / GRID)), gx1 = Math.min(cols-1, Math.floor(box.x1 / GRID));
                    var gy0 = Math.max(0, Math.floor(box.y0 / GRID)), gy1 = Math.min(rows-1, Math.floor(box.y1 / GRID));
                    var mask = new Uint8Array(cols * rows);
                    var any = false;
                    for (var gy = gy0; gy <= gy1; gy++) {
                        for (var gx = gx0; gx <= gx1; gx++) {
                            var found = false;
                            for (var sy = 0; sy < GRID && !found; sy++) {
                                for (var sx = 0; sx < GRID && !found; sx++) {
                                    var spx = gx*GRID+sx, spy = gy*GRID+sy;
                                    if (spx >= compW || spy >= compH) continue;
                                    var pi = (spy*compW+spx)*4;
                                    if (_isRed(data[pi], data[pi+1], data[pi+2])) found = true;
                                }
                            }
                            if (found) { mask[gy*cols+gx] = 1; any = true; }
                        }
                    }
                    if (!any) return [];
                    return _connComp(mask, cols, rows);
                }

                // Dilată un set de celule GRID×GRID cu `pad` celule în fiecare direcție,
                // decupat la limitele boxului original + o mică marjă suplimentară — ca
                // poligonul strâns să păstreze un mic buffer vizual în jurul cernelii, fără
                // să se întoarcă la dimensiunea boxului YOLO original.
                function _dilateCellsClipped(cells, cols, rows, pad, gx0, gx1, gy0, gy1) {
                    var set = {};
                    cells.forEach(function(i) {
                        var gx = i % cols, gy = (i - gx) / cols;
                        for (var dy = -pad; dy <= pad; dy++) {
                            for (var dx = -pad; dx <= pad; dx++) {
                                var nx = gx + dx, ny = gy + dy;
                                if (nx < Math.max(0, gx0) || nx > Math.min(cols-1, gx1)) continue;
                                if (ny < Math.max(0, gy0) || ny > Math.min(rows-1, gy1)) continue;
                                set[ny*cols+nx] = true;
                            }
                        }
                    });
                    return Object.keys(set).map(Number);
                }

                function _tightenBoxToRedCells(data, compW, compH, cols, rows, box) {
                    var gx0 = Math.max(0, Math.floor(box.x0 / GRID)), gx1 = Math.min(cols-1, Math.floor(box.x1 / GRID));
                    var gy0 = Math.max(0, Math.floor(box.y0 / GRID)), gy1 = Math.min(rows-1, Math.floor(box.y1 / GRID));
                    var pad = window.IOS_BLD_TIGHTEN_PAD_CELLS;

                    // 1) Prag STRICT — densitate ridicată de roșu per celulă (cerneala reală
                    //    a simbolului de clădire, nu doar un pixel izolat).
                    var strict = _splitBoxByRedness(data, compW, compH, cols, rows, box);
                    if (strict.length) {
                        return strict.map(function(c) { return _dilateCellsClipped(c, cols, rows, pad, gx0-pad, gx1+pad, gy0-pad, gy1+pad); });
                    }

                    // 2) Prag PERMISIV, doar rezervă — orice celulă cu ≥1 pixel roșiatic.
                    //    Tot mai strâns decât boxul YOLO întreg, dar nu cere densitate mare
                    //    (util pentru cerneală foarte decolorată/subțire).
                    var loose = _looseRedCellMask(data, compW, compH, cols, rows, box);
                    if (loose.length) {
                        return loose
                            .map(function(c) { return _dilateCellsClipped(c, cols, rows, pad, gx0-pad, gx1+pad, gy0-pad, gy1+pad); })
                            .filter(function(c) { return c.length > 0; });
                    }

                    // 3) Nicio urmă de roșu în tot boxul → nu returnăm nimic. Boxul e aruncat
                    //    complet de apelant (nu se mai desenează un poligon "gol", uriaș, peste
                    //    zone fără nicio clădire).
                    return [];
                }


                // ── Heritage fetch + mask (reutilizează jsonpFetch din pagină) ──
                function _fetchHeritage(bounds) {
                    return new Promise(function(resolve) {
                        var BASE = 'https://eism.geo-spatial.ro/eismgeo/rest/services/Patrimoniu/PatrimoniuWM/MapServer';
                        var LAYERS = [0,5,6];
                        var circles = [], pend = LAYERS.length;
                        function done(){ if(--pend===0) resolve(circles); }
                        LAYERS.forEach(function(lid){
                            var sw=L.CRS.EPSG3857.project(bounds.getSouthWest()), ne=L.CRS.EPSG3857.project(bounds.getNorthEast());
                            var url = BASE+'/'+lid+'/query?where=1%3D1&geometry='+encodeURIComponent(sw.x+','+sw.y+','+ne.x+','+ne.y)
                                +'&geometryType=esriGeometryEnvelope&inSR=102100&spatialRel=esriSpatialRelIntersects'
                                +'&outFields=OBJECTID&returnGeometry=true&outSR=4326&resultRecordCount=2000&f=json';
                            var to=setTimeout(function(){ console.warn('[IosBld+][Heritage] TIMEOUT (5s) pe layer', lid, '— continuă fără acest layer.'); done(); }, 5000);
                            jsonpFetch(url, function(data){
                                clearTimeout(to);
                                var before = circles.length;
                                if (data && data.features) data.features.forEach(function(f){
                                    var g=f.geometry, gt=data.geometryType; if(!g) return;
                                    if (gt==='esriGeometryPoint'&&!isNaN(g.x)&&!isNaN(g.y)) circles.push({latlng:L.latLng(g.y,g.x),radiusM:600});
                                    else if (gt==='esriGeometryPolygon'&&g.rings) g.rings.forEach(function(r){ r.forEach(function(pt){ circles.push({latlng:L.latLng(pt[1],pt[0]),radiusM:600}); }); });
                                    else if (gt==='esriGeometryPolyline'&&g.paths) g.paths.forEach(function(p){ p.forEach(function(pt){ circles.push({latlng:L.latLng(pt[1],pt[0]),radiusM:600}); }); });
                                });
                                console.log('[IosBld+][Heritage] Layer', lid, '→', (data && data.features ? data.features.length : 0), 'features,',
                                    (circles.length-before), 'cercuri adăugate.', (!data ? '(răspuns null/JSONP eșuat)' : ''));
                                done();
                            });
                        });
                    });
                }

                function _buildHeritageMask(circles, cols, rows, tileXs, tileYs, z) {
                    var mask = new Uint8Array(cols*rows); if(!circles.length) return mask;
                    var orig = map.project(L.latLng(ty2lat(tileYs[0],z), tx2lon(tileXs[0],z)), z);
                    var hpx = [], seen = {};
                    circles.forEach(function(hc){
                        var pt = map.project(hc.latlng, z);
                        var cx = pt.x-orig.x, cy = pt.y-orig.y;
                        var mpp = (156543.03392*Math.cos(hc.latlng.lat*Math.PI/180))/Math.pow(2,z);
                        var rPx = hc.radiusM/mpp;
                        var dk = Math.round(cx/30)+','+Math.round(cy/30);
                        if (seen[dk]) return; seen[dk]=true;
                        hpx.push({cx:cx, cy:cy, rSq:rPx*rPx});
                    });
                    for (var gy=0;gy<rows;gy++){ var cpy=gy*GRID+GRID/2;
                        for (var gx=0;gx<cols;gx++){ var cpx=gx*GRID+GRID/2;
                            for (var i=0;i<hpx.length;i++){ var h=hpx[i],dx=cpx-h.cx,dy=cpy-h.cy; if(dx*dx+dy*dy<h.rSq){ mask[gy*cols+gx]=1; break; } }
                        }
                    }
                    return mask;
                }

                // ── Verificare Buildings: folosește tile-urile raster UAT (negru = ──
                // clădire) în loc de fișierul GeoJSON unic / indexul spațial pe grilă.
                // uatHasBuildingNear extinde bbox-ul cu minBuildingDistM și caută orice
                // pixel "clădire" în zona extinsă — echivalentul raster al vechii reguli
                // "minDistM <= minBuildingDistM". Overpass rămâne fallback pentru cazul
                // (rar) în care niciun tile din zonă nu a putut fi citit (CORS/rețea).
                window.IOS_BLD_DOUBLE_CHECK_OVERPASS = (window.IOS_BLD_DOUBLE_CHECK_OVERPASS !== undefined) ? window.IOS_BLD_DOUBLE_CHECK_OVERPASS : false;

                function _hasBuildingsAt(sw, ne, cb) {
                    var minBuildingDistM = (window.IOS_BLD_MIN_BUILDING_DIST_M !== undefined) ? window.IOS_BLD_MIN_BUILDING_DIST_M : 150;
                    uatHasBuildingNear(sw, ne, minBuildingDistM, function (hasPolygon) {
                        console.log('[IosBld+][Buildings] UAT raster → pixel "clădire" în raza de',
                            minBuildingDistM + 'm', '=', hasPolygon);
                        if (hasPolygon) { cb(true); return; }
                        // Niciun pixel "clădire" găsit în tile-urile citite — acceptăm direct
                        // "fără clădire", fără dubla verificare Overpass (implicit dezactivată).
                        if (window.IOS_BLD_DOUBLE_CHECK_OVERPASS === false) { cb(false); return; }
                        _overpassHasBuildings(sw, ne, cb);
                    });
                }

                // ── Trimming la nivel de celulă vs. clădiri actuale ─────────────────────
                // Înainte, un candidat era acceptat/respins ÎN ÎNTREGIME pe baza unei
                // singure verificări pe bbox-ul lui întreg (_hasBuildingsAt), ceea ce putea
                // lăsa să treacă poligoane care ating sau chiar intersectează o clădire
                // actuală reală, atâta timp cât bbox-ul general "trecea" testul. Aici
                // verificăm FIECARE celulă individual — orice celulă aflată la mai puțin de
                // `bufferMeters` (implicit window.IOS_BLD_MIN_BUILDING_DIST_M, 150m — aceeași
                // valoare din panoul de Setări, "Distanță minimă față de clădire") de un
                // pixel "clădire actuală" e tăiată din poligonul final, nu doar tot
                // clusterul respins/acceptat în bloc. O celulă care intersectează direct
                // stratul UAT (distanță 0) e prinsă automat de același test.
                function _trimCellsNearBuildings(cells, cols, pxToLLFn, bufferMeters, cb) {
                    if (!cells.length) { cb([]); return; }
                    var kept = [];
                    var pending = cells.length;
                    cells.forEach(function (i) {
                        var gx = i % cols, gy = (i - gx) / cols;
                        var ll = pxToLLFn(gx * GRID + GRID / 2, gy * GRID + GRID / 2);
                        var pt = { lat: ll.lat, lng: ll.lng };
                        uatHasBuildingNear(pt, pt, bufferMeters, function (hasBldg) {
                            if (!hasBldg) kept.push(i);
                            if (--pending === 0) cb(kept);
                        });
                    });
                }

                // ── Overpass: coadă serializată + retry, ca să nu lovim rate-limit-ul
                // API-ului public (overpass-api.de) ─────────────────────────────────────
                // De la introducerea limitei de mărime maximă a poligoanelor (vezi
                // window.IOS_BLD_ONNX_MAX_POLY_PX), un singur box ONNX mare poate genera
                // acum zeci de sub-poligoane mici — și fiecare, dacă tile-ul Buildings arată
                // "fără clădire", declanșează o interogare Overpass de confirmare. Trimise
                // toate simultan (fără limitare), API-ul public Overpass răspunde cu eroarea
                // lui specifică de rate-limit — un XML de forma
                // "<?xml version=...><remark>runtime error: open64: ... Too many
                // requests...</remark>" — care NU e JSON valid, deși am cerut [out:json]
                // (Overpass ignoră formatul cerut pentru propriile erori de runtime).
                // fetch().json() eșuează la parsare, iar codul vechi presupunea în catch
                // "fără clădire" (cb(false)) — exact când ar fi trebuit să fie prudent —
                // rezultând poligoane "dispărute" desenate peste clădiri reale.
                // Fix: (1) o coadă globală care rulează cererile Overpass una câte una, cu
                // o pauză minimă între ele (window.IOS_BLD_OVERPASS_MIN_GAP_MS); (2) câteva
                // reîncercări cu backoff dacă răspunsul nu e JSON valid sau HTTP nu e OK
                // (window.IOS_BLD_OVERPASS_MAX_RETRIES); (3) dacă TOT eșuează, presupunem
                // "clădire prezentă" (cb(true) → NU marcăm drept dispărută) — un eșec de
                // rețea nu mai înseamnă implicit "sigur a dispărut", ci "nu putem confirma,
                // deci nu riscăm un fals-pozitiv peste o clădire reală".
                window.IOS_BLD_OVERPASS_MIN_GAP_MS  = (window.IOS_BLD_OVERPASS_MIN_GAP_MS  !== undefined) ? window.IOS_BLD_OVERPASS_MIN_GAP_MS  : 1100;
                window.IOS_BLD_OVERPASS_MAX_RETRIES = (window.IOS_BLD_OVERPASS_MAX_RETRIES !== undefined) ? window.IOS_BLD_OVERPASS_MAX_RETRIES : 2;

                var _opQueue = [];
                var _opQueueRunning = false;
                var _opLastCallTs = 0;

                function _opEnqueue(job) {
                    _opQueue.push(job);
                    _opDrainQueue();
                }

                function _opDrainQueue() {
                    if (_opQueueRunning) return;
                    _opQueueRunning = true;
                    function step() {
                        if (!_opQueue.length) { _opQueueRunning = false; return; }
                        var job = _opQueue.shift();
                        var minGap = (window.IOS_BLD_OVERPASS_MIN_GAP_MS !== undefined) ? window.IOS_BLD_OVERPASS_MIN_GAP_MS : 1100;
                        var wait = Math.max(0, minGap - (Date.now() - _opLastCallTs));
                        setTimeout(function() {
                            _opLastCallTs = Date.now();
                            job(step);
                        }, wait);
                    }
                    step();
                }

                function _overpassFetchOnce(opUrl) {
                    return fetch(opUrl).then(function(r) {
                        if (!r.ok) { var e = new Error('HTTP ' + r.status); e.httpStatus = r.status; throw e; }
                        return r.json();
                    });
                }

                // Interoghează Overpass pentru numărul de clădiri OSM dintr-un bbox — folosit
                // atât ca fallback (eroare de rețea/parsare pe tile-ul R2), cât și ca a doua
                // confirmare atunci când tile-ul Buildings (R2) indică "fără clădire" (posibil
                // fals-negativ dintr-un gol de acoperire în acel dataset). Cererile sunt
                // serializate prin _opEnqueue (vezi mai sus) ca să nu lovim rate-limit-ul.
                function _overpassHasBuildings(sw, ne, cb) {
                    var bbox = sw.lat+','+sw.lng+','+ne.lat+','+ne.lng;
                    var q = '[out:json][timeout:8];(way["building"]('+bbox+');relation["building"]('+bbox+'););out count;';
                    var opUrl = 'https://overpass-api.de/api/interpreter?data='+encodeURIComponent(q);

                    _opEnqueue(function(done) {
                        var maxRetries = (window.IOS_BLD_OVERPASS_MAX_RETRIES !== undefined) ? window.IOS_BLD_OVERPASS_MAX_RETRIES : 2;
                        var attempt = 0;
                        function tryOnce() {
                            attempt++;
                            console.log('[IosBld+][Buildings] Confirmare/fallback Overpass (încercare ' + attempt + '/' + (maxRetries+1) + '):', opUrl);
                            _overpassFetchOnce(opUrl).then(function(d) {
                                var cnt = (d&&d.elements&&d.elements[0]&&d.elements[0].tags) ? parseInt(d.elements[0].tags.total||'0',10) : 0;
                                console.log('[IosBld+][Buildings] Overpass count clădiri:', cnt);
                                cb(cnt>0);
                                done();
                            }).catch(function(opErr) {
                                if (attempt <= maxRetries) {
                                    var backoff = 800 * attempt;
                                    console.warn('[IosBld+][Buildings] Overpass a eșuat (' + (opErr && opErr.message) + ') → reîncerc peste', backoff, 'ms.');
                                    setTimeout(tryOnce, backoff);
                                } else {
                                    console.error('[IosBld+][Buildings] Overpass a eșuat definitiv:', opErr && opErr.message,
                                        '→ presupun "clădire prezentă" (NU marchez ca dispărută) ca să evit un fals-pozitiv.');
                                    cb(true);
                                    done();
                                }
                            });
                        }
                        tryOnce();
                    });
                }

                // ── Visibility refresh ──
                function _refreshVisibility() {
                    var btn  = document.getElementById('iosBldSearchHelpBtn');
                    var hint = document.getElementById('iosBldSearchHelpHint');
                    if (!btn || !hint) return;

                    // Butonul e activ dacă Josephine Map + (_jLayerRef) e pe hartă
                    var jOn = !!(window._jLayerRef && map.hasLayer(window._jLayerRef));
                    var _curZoom = map.getZoom();
                    var zoomOk = _curZoom >= window.IOS_BLD_MIN_ZOOM && _curZoom <= window.IOS_BLD_MAX_ZOOM;
                    var areaOk = _areaKm2() <= MAX_AREA_KM2 && zoomOk;

                    var settingsBtn = document.getElementById('iosBldSettingsBtn');
                    var suggestBtn = document.getElementById('iosBldSuggestBtn');

                    if (!jOn) {
                        btn.style.display = 'none';
                        if (settingsBtn) settingsBtn.style.display = 'none';
                        if (suggestBtn) suggestBtn.style.display = 'none';
                        window._iosBldStopSuggestDrawing && window._iosBldStopSuggestDrawing();
                        hint.classList.remove('visible');
                        hint.style.display = 'none';
                        _hintVisible = false;
                        return;
                    }
                    if (areaOk) {
                        hint.classList.remove('visible');
                        setTimeout(function(){ if(!_hintVisible) hint.style.display='none'; }, 250);
                        _hintVisible = false;
                        btn.style.display = 'flex';
                        if (settingsBtn) settingsBtn.style.display = 'flex';
                        if (suggestBtn) suggestBtn.style.display = 'flex';
                    } else {
                        btn.style.display = 'none';
                        if (settingsBtn) settingsBtn.style.display = 'none';
                        if (suggestBtn) suggestBtn.style.display = 'none';
                        window._iosBldStopSuggestDrawing && window._iosBldStopSuggestDrawing();
                        // FIX (2026-07): mesajul era static ("Zoom in mai mult") indiferent de
                        // motiv — confuz când zoom-ul curent e PESTE maxim (14), caz în care
                        // utilizatorul trebuie să dea zoom OUT, nu in. Alegem textul corect în
                        // funcție de motivul real: zoom prea mic → zoom in; zoom prea mare →
                        // zoom out; zoom OK dar viewport prea mare → zoom in (micșorează aria).
                        var hintLabel = document.getElementById('iosBldSearchHelpHintLabel');
                        if (hintLabel) {
                            var hintKey = (_curZoom > window.IOS_BLD_MAX_ZOOM) ? 'ios_bld_search_help_zoom_out' : 'ios_bld_search_help_zoom_in';
                            hintLabel.textContent = _t(hintKey);
                        }
                        if (!_hintVisible) {
                            hint.style.display = 'flex';
                            requestAnimationFrame(function(){ hint.classList.add('visible'); });
                            _hintVisible = true;
                        }
                        window.clearIosBldSearchHelp && window.clearIosBldSearchHelp();
                    }
                }

                map.on('zoomend moveend', _refreshVisibility);
                window.addEventListener('resize', _refreshVisibility);
                window._refreshIosBldBtnVisibility = _refreshVisibility;

                // ── Panou de setări ("Ruleaza detectia pe viewport", portat din model-test-v3.1.html) ──
                // Expune live, prin UI, praguri care înainte erau reglabile doar din consolă
                // (window.IOS_BLD_ONNX_CONF/_IOU/_MIN_BUILDING_DIST_M) și adaugă un flag nou de
                // excludere a clădirilor actuale + feedback (👍/👎) mereu activ, ca în model-test-v3.1.html.
                window.IOS_BLD_EXCLUDE_BUILDINGS = (window.IOS_BLD_EXCLUDE_BUILDINGS !== undefined) ? window.IOS_BLD_EXCLUDE_BUILDINGS : true;
                // Flag pentru pasul suplimentar de poligonizare (formă + culoare specifică
                // simbolului de clădire Iosefină) — vezi _extraShapeColorValidation mai jos.
                // Implicit ACTIV (checked by default în UI), comutabil din panoul de setări.
                window.IOS_BLD_EXTRA_STEP_ENABLED = (window.IOS_BLD_EXTRA_STEP_ENABLED !== undefined) ? window.IOS_BLD_EXTRA_STEP_ENABLED : true;

                window.toggleIosBldSettings = function () {
                    var panel = document.getElementById('iosBldSettingsPanel');
                    if (panel) panel.classList.toggle('open');
                };

                (function _bindIosBldSettingsControls() {
                    var confSlider  = document.getElementById('iosBldConfSlider');
                    var confVal     = document.getElementById('iosBldConfVal');
                    var iouSlider   = document.getElementById('iosBldIouSlider');
                    var iouVal      = document.getElementById('iosBldIouVal');
                    var excludeChk  = document.getElementById('iosBldExcludeCurrentBuildings');
                    var minDistIn   = document.getElementById('iosBldMinDistanceInput');

                    if (confSlider) {
                        confSlider.value = window.IOS_BLD_ONNX_CONF;
                        if (confVal) confVal.textContent = window.IOS_BLD_ONNX_CONF;
                        confSlider.addEventListener('input', function () {
                            window.IOS_BLD_ONNX_CONF = parseFloat(confSlider.value);
                            if (confVal) confVal.textContent = confSlider.value;
                        });
                    }
                    if (iouSlider) {
                        iouSlider.value = window.IOS_BLD_ONNX_IOU;
                        if (iouVal) iouVal.textContent = window.IOS_BLD_ONNX_IOU;
                        iouSlider.addEventListener('input', function () {
                            window.IOS_BLD_ONNX_IOU = parseFloat(iouSlider.value);
                            if (iouVal) iouVal.textContent = iouSlider.value;
                        });
                    }
                    if (excludeChk) {
                        excludeChk.checked = window.IOS_BLD_EXCLUDE_BUILDINGS;
                        excludeChk.addEventListener('change', function () {
                            window.IOS_BLD_EXCLUDE_BUILDINGS = !!excludeChk.checked;
                        });
                    }
                    if (minDistIn) {
                        minDistIn.value = window.IOS_BLD_MIN_BUILDING_DIST_M;
                        minDistIn.addEventListener('change', function () {
                            var v = parseFloat(minDistIn.value);
                            if (!(v >= 100)) v = 100;
                            if (v > 300) v = 300;
                            minDistIn.value = v;
                            window.IOS_BLD_MIN_BUILDING_DIST_M = v;
                        });
                    }
                    var extraStepChk = document.getElementById('iosBldExtraStepDetector');
                    if (extraStepChk) {
                        extraStepChk.checked = window.IOS_BLD_EXTRA_STEP_ENABLED;
                        extraStepChk.addEventListener('change', function () {
                            window.IOS_BLD_EXTRA_STEP_ENABLED = !!extraStepChk.checked;
                            console.log('[IosBld+][Extra] Detector pas adițional →', window.IOS_BLD_EXTRA_STEP_ENABLED ? 'ACTIV' : 'DEZACTIVAT');
                        });
                    }
                })();

                // ── Feedback (👍/👎), portat identic din model-test-v3.1.html: Worker URL fix,
                // butoanele de vot sunt mereu afișate pe fiecare detecție ──
                var IOS_BLD_FEEDBACK_WORKER_URL = 'https://detectlab-feedback.andreiroba2000.workers.dev';
                function _iosBldGetWorkerUrl() {
                    return IOS_BLD_FEEDBACK_WORKER_URL;
                }

                function _iosBldSendFeedback(vote, meta) {
                    var workerUrl = _iosBldGetWorkerUrl();
                    return fetch(workerUrl + '/feedback', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            vote: vote, cls: meta.cls, confidence: meta.confidence,
                            latNorth: meta.latNorth, latSouth: meta.latSouth,
                            lonWest: meta.lonWest, lonEast: meta.lonEast,
                            zoom: meta.zoom, tileX: meta.tileX, tileY: meta.tileY,
                            modelVersion: meta.modelVersion,
                        }),
                    }).then(function (resp) { return resp.ok; })
                      .catch(function (e) { console.error('[IosBld+] feedback error', e); return false; });
                }

                function _iosBldBuildFeedbackPopup(meta) {
                    var div = document.createElement('div');
                    div.id = 'iosBldFeedbackPopup';

                    var header = document.createElement('div');
                    header.innerHTML = '<b>' + meta.labelRo + '</b>' +
                        (meta.confidence != null ? '<br>Încredere: ' + (meta.confidence * 100).toFixed(1) + '%' : '');
                    div.appendChild(header);

                    var btnRow = document.createElement('div');
                    btnRow.className = 'ios-bld-fb-row';

                    var upBtn = document.createElement('button');
                    upBtn.textContent = '👍 Corect';
                    upBtn.style.background = '#f4faf6';

                    var downBtn = document.createElement('button');
                    downBtn.textContent = '👎 Greșit';
                    downBtn.style.background = '#fdf4f2';

                    var statusEl = document.createElement('div');
                    statusEl.style.cssText = 'margin-top:6px;font-size:11px;color:#888;';

                    function vote(v) {
                        upBtn.disabled = true; downBtn.disabled = true;
                        statusEl.textContent = 'Se trimite...';
                        _iosBldSendFeedback(v, meta).then(function (ok) {
                            statusEl.textContent = ok ? 'Mulțumim pentru feedback!' : 'Eroare la trimitere — verifică Worker URL.';
                        });
                    }
                    upBtn.addEventListener('click', function () { vote('up'); });
                    downBtn.addEventListener('click', function () { vote('down'); });

                    btnRow.appendChild(upBtn);
                    btnRow.appendChild(downBtn);
                    div.appendChild(btnRow);
                    div.appendChild(statusEl);
                    return div;
                }

                // ── "Sugerează un poligon" — desenare manuală de clădiri nedetectate ───────
                // Userul poate desena pe hartă un poligon acolo unde crede că exista o clădire
                // dispărută pe care detecția automată (ONNX) nu a semnalat-o, și îl poate
                // trimite ca sugestie prin același Worker de feedback (endpoint separat /suggest).
                var _suggestLG = null;
                var _suggestDrawing = false;
                var _suggestPoints = [];
                var _suggestTempLayer = null;
                var _suggestVertexLG = null;   // markere mari pentru fiecare colț
                var _suggestVertexMarkers = []; // referințe la markerele de mai sus, în ordine

                // Rază (px) markerelor de colț — suficient de mare ca să fie ușor de nimerit
                // pe mobil/desktop. Primul punct e desenat și mai mare, ca să fie clar unde
                // trebuie să dai click pentru a închide poligonul.
                var IOS_BLD_SUGGEST_VERTEX_R = 8;
                var IOS_BLD_SUGGEST_FIRST_VERTEX_R = 12;

                function _iosBldRedrawSuggestPreview() {
                    if (_suggestTempLayer) { map.removeLayer(_suggestTempLayer); _suggestTempLayer = null; }
                    if (_suggestPoints.length < 2) return;
                    _suggestTempLayer = L.polyline(_suggestPoints, {
                        color: '#6EC1E4', weight: 2, dashArray: '6,4', pane: 'pane_ios_bld_search_help'
                    }).addTo(map);
                }

                // Adaugă un marker mare, ușor de apăsat, pentru colțul curent. Primul colț
                // primește un stil aparte (mai mare, contur auriu) + tooltip, pentru că un
                // click pe el închide automat poligonul.
                function _iosBldAddSuggestVertexMarker(latlng, isFirst) {
                    if (!_suggestVertexLG) _suggestVertexLG = L.layerGroup().addTo(map);
                    var marker = L.circleMarker(latlng, {
                        radius: isFirst ? IOS_BLD_SUGGEST_FIRST_VERTEX_R : IOS_BLD_SUGGEST_VERTEX_R,
                        color: isFirst ? '#FFD166' : '#ffffff',
                        weight: isFirst ? 3 : 2,
                        fillColor: '#6EC1E4',
                        fillOpacity: 0.95,
                        pane: 'pane_ios_bld_search_help',
                        bubblingMouseEvents: false // click-ul pe marker nu trebuie să adauge și un punct nou pe hartă dedesubt
                    }).addTo(_suggestVertexLG);

                    if (isFirst) {
                        marker.bindTooltip('Click aici ca să închei poligonul', { direction: 'top', offset: [0, -10] });
                        marker.on('click', function (e) {
                            L.DomEvent.stop(e);
                            _iosBldFinishSuggestPolygon();
                        });
                    } else {
                        // Click pe un colț deja plasat nu face nimic (doar previne dublarea punctului)
                        marker.on('click', function (e) { L.DomEvent.stop(e); });
                    }

                    _suggestVertexMarkers.push(marker);
                }

                function _iosBldClearSuggestVertexMarkers() {
                    if (_suggestVertexLG) { map.removeLayer(_suggestVertexLG); _suggestVertexLG = null; }
                    _suggestVertexMarkers = [];
                }

                function _iosBldMapClickForSuggest(e) {
                    var isFirst = _suggestPoints.length === 0;
                    _suggestPoints.push(e.latlng);
                    _iosBldAddSuggestVertexMarker(e.latlng, isFirst);
                    _iosBldRedrawSuggestPreview();
                    if (_suggestPoints.length < 3) {
                        _toast('Punct adăugat (' + _suggestPoints.length + '). Mai adaugă cel puțin ' + (3 - _suggestPoints.length) + ' pentru a putea închide poligonul.', 4000);
                    } else {
                        _toast('Punct adăugat (' + _suggestPoints.length + '). Click pe primul punct (auriu) ca să închei poligonul, Esc ca să anulezi.', 4500);
                    }
                }

                function _iosBldKeyForSuggest(e) {
                    if (e.key === 'Escape') _iosBldCancelSuggest();
                }

                function _iosBldStartSuggestDrawing() {
                    if (_suggestDrawing) return;
                    _suggestDrawing = true;
                    _suggestPoints = [];
                    _iosBldClearSuggestVertexMarkers();
                    var btn = document.getElementById('iosBldSuggestBtn');
                    if (btn) btn.classList.add('active');
                    map.getContainer().style.cursor = 'crosshair';
                    map.on('click', _iosBldMapClickForSuggest);
                    document.addEventListener('keydown', _iosBldKeyForSuggest);
                    _toast('Click pe hartă ca să adaugi colțuri.', 5000);
                }

                function _iosBldStopSuggestDrawing() {
                    _suggestDrawing = false;
                    var btn = document.getElementById('iosBldSuggestBtn');
                    if (btn) btn.classList.remove('active');
                    map.getContainer().style.cursor = '';
                    map.off('click', _iosBldMapClickForSuggest);
                    document.removeEventListener('keydown', _iosBldKeyForSuggest);
                    if (_suggestTempLayer) { map.removeLayer(_suggestTempLayer); _suggestTempLayer = null; }
                    _iosBldClearSuggestVertexMarkers();
                }
                window._iosBldStopSuggestDrawing = _iosBldStopSuggestDrawing; // apelat din _refreshVisibility

                function _iosBldCancelSuggest() {
                    _suggestPoints = [];
                    _iosBldStopSuggestDrawing();
                    _toast('Desenare anulată.', 2000);
                }

                function _iosBldFinishSuggestPolygon() {
                    if (_suggestPoints.length < 3) {
                        _toast('Ai nevoie de minim 3 puncte pentru un poligon.', 3000);
                        return;
                    }
                    var latlngs = _suggestPoints.slice();
                    _iosBldStopSuggestDrawing();

                    if (!_suggestLG) _suggestLG = L.layerGroup().addTo(map);
                    var poly = L.polygon(latlngs, {
                        color: '#6EC1E4', weight: 2.5, dashArray: '6,4',
                        fillColor: '#6EC1E4', fillOpacity: 0.12,
                        pane: 'pane_ios_bld_search_help'
                    }).addTo(_suggestLG);

                    var meta = {
                        polygon: latlngs.map(function (p) { return [p.lat, p.lng]; }),
                        zoom: Math.round(map.getZoom()),
                        modelVersion: 'user-suggested',
                    };
                    poly.bindPopup(_iosBldBuildSuggestPopup(poly, meta)).openPopup();
                }

                window.toggleIosBldSuggestMode = function () {
                    if (_suggestDrawing) _iosBldCancelSuggest();
                    else _iosBldStartSuggestDrawing();
                };

                function _iosBldSendSuggestion(meta) {
                    var workerUrl = _iosBldGetWorkerUrl();
                    return fetch(workerUrl + '/suggest', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type: 'user_polygon', polygon: meta.polygon,
                            zoom: meta.zoom, modelVersion: meta.modelVersion, ts: Date.now(),
                        }),
                    }).then(function (resp) { return resp.ok; })
                      .catch(function (e) { console.error('[IosBld+] eroare trimitere sugestie', e); return false; });
                }

                function _iosBldBuildSuggestPopup(polyLayer, meta) {
                    var div = document.createElement('div');
                    div.id = 'iosBldSuggestPopup';

                    var header = document.createElement('div');
                    header.innerHTML = '<b>Sugestie clădire dispărută</b><br>Poligon desenat manual (' + meta.polygon.length + ' puncte)';
                    div.appendChild(header);

                    var btnRow = document.createElement('div');
                    btnRow.className = 'ios-bld-fb-row';

                    var sendBtn = document.createElement('button');
                    sendBtn.textContent = '📩 Trimite sugestia';
                    sendBtn.style.background = '#eef6ff';

                    var delBtn = document.createElement('button');
                    delBtn.textContent = '🗑 Șterge';
                    delBtn.style.background = '#fdf4f2';

                    var statusEl = document.createElement('div');
                    statusEl.style.cssText = 'margin-top:6px;font-size:11px;color:#888;';

                    sendBtn.addEventListener('click', function () {
                        sendBtn.disabled = true; delBtn.disabled = true;
                        statusEl.textContent = 'Se trimite...';
                        _iosBldSendSuggestion(meta).then(function (ok) {
                            statusEl.textContent = ok ? 'Mulțumim! Sugestia a fost trimisă.' : 'Eroare la trimitere — verifică Worker URL.';
                        });
                    });
                    delBtn.addEventListener('click', function () {
                        if (_suggestLG) _suggestLG.removeLayer(polyLayer);
                        map.closePopup();
                    });

                    btnRow.appendChild(sendBtn);
                    btnRow.appendChild(delBtn);
                    div.appendChild(btnRow);
                    div.appendChild(statusEl);
                    return div;
                }

                window.clearIosBldSearchHelp = function () {
                    _runGen++; // invalidează orice callback async (Overpass/R2) rămas dintr-o rulare anterioară
                    if (_resultLG) { map.removeLayer(_resultLG); _resultLG = null; }
                    _iosBldStopSuggestDrawing();
                };

                // ── Funcția principală ───────────────────────────────────────────────────
                window.runIosBldSearchHelp = function () {
                    console.log('[IosBld+] ── START căutare ──────────────────────');
                    if (_running) { console.warn('[IosBld+] Deja în curs (_running=true), ignor click.'); return; }
                    var jLayer = window._jLayerRef;
                    if (!jLayer || !map.hasLayer(jLayer)) {
                        console.error('[IosBld+] ABANDON: stratul Josephine Map+ (_jLayerRef) nu e activ pe hartă.', {jLayer: jLayer, onMap: jLayer ? map.hasLayer(jLayer) : null});
                        _toast(_t('ios_bld_search_help_error'), 4000);
                        return;
                    }
                    if (map.getZoom() < window.IOS_BLD_MIN_ZOOM || map.getZoom() > window.IOS_BLD_MAX_ZOOM) {
                        console.warn('[IosBld+] ABANDON: zoom în afara intervalului permis (13-14).', {zoom: map.getZoom(), min: window.IOS_BLD_MIN_ZOOM, max: window.IOS_BLD_MAX_ZOOM});
                        _toast(_t(map.getZoom() > window.IOS_BLD_MAX_ZOOM ? 'ios_bld_search_help_zoom_out' : 'ios_bld_search_help_zoom_in'), 3000);
                        return;
                    }
                    if (_areaKm2() > MAX_AREA_KM2) {
                        console.warn('[IosBld+] ABANDON: viewport prea mare.', {areaKm2: _areaKm2(), max: MAX_AREA_KM2});
                        _toast(_t('ios_bld_search_help_zoom_in'), 3000);
                        return;
                    }

                    window.clearIosBldSearchHelp();
                    _running = true;
                    var _myGen = _runGen; // "amprenta" acestei rulări — orice callback venit după un clear/restart o va vedea depășită
                    _tileOkCount = 0; _tileFailCount = 0;

                    var btn = document.getElementById('iosBldSearchHelpBtn');
                    var lbl = document.getElementById('iosBldSearchHelpLabel');
                    if (btn) btn.disabled = true;
                    if (lbl) lbl.textContent = _t('ios_bld_search_help_loading') || 'Se analizează…';

                    var z = Math.round(map.getZoom());
                    var fetchZ = Math.min(z, JOSEPHINE_MAX_NATIVE_Z); // nu cerem tile-uri peste nivelul generat static în R2
                    var overZoomDiff = z - fetchZ; // 0 dacă z <= 15
                    var overZoomScale = Math.pow(2, overZoomDiff);
                    if (overZoomDiff > 0) {
                        console.warn('[IosBld+] Zoom curent (' + z + ') peste maxNativeZoom Josephine (' + JOSEPHINE_MAX_NATIVE_Z + '). ' +
                            'Cer tile-uri de la z=' + fetchZ + ' și le decupez/scalez local (overzoom diff=' + overZoomDiff + ').');
                    }
                    var b = map.getBounds();
                    var minTX = Math.max(0, Math.floor(lon2tx(b.getWest(),  z)));
                    var maxTX = Math.floor(lon2tx(b.getEast(),  z));
                    var minTY = Math.max(0, Math.floor(lat2ty(b.getNorth(), z)));
                    var maxTY = Math.floor(lat2ty(b.getSouth(), z));

                    console.log('[IosBld+] Zoom curent:', z, '| fetchZ (Josephine):', fetchZ, '| Bounds:', b.toBBoxString());
                    console.log('[IosBld+] Tile range X:', minTX, '-', maxTX, '| Y:', minTY, '-', maxTY,
                        '(' , (maxTX-minTX+1)*(maxTY-minTY+1), 'tile-uri Josephine de încărcat )');
                    console.log('[IosBld+] URL exemplu tile Josephine:',
                        TILE_URL_JOSEPHINE_PLUS.replace('{z}', fetchZ)
                            .replace('{x}', Math.floor(minTX/overZoomScale))
                            .replace('{y}', Math.floor(minTY/overZoomScale)));
                    console.log('[IosBld+] Sursă Buildings (R2, raster):', UAT_TILE_URL);

                    var tileXs = [], tileYs = [];
                    for (var tx = minTX; tx <= maxTX; tx++) tileXs.push(tx);
                    for (var ty = minTY; ty <= maxTY; ty++) tileYs.push(ty);
                    if (!tileXs.length || !tileYs.length) { console.error('[IosBld+] ABANDON: niciun tile index calculat (tileXs/tileYs goale).'); _finish(false); return; }

                    var compW = tileXs.length * TILE_SIZE;
                    var compH = tileYs.length * TILE_SIZE;
                    var canvas = document.createElement('canvas');
                    canvas.width = compW; canvas.height = compH;
                    var ctx = canvas.getContext('2d');

                    // Funcție pixel → lat/lng (identic cu APM 2.0)
                    function pxToLL(px, py) {
                        return L.latLng(ty2lat(tileYs[0] + py/TILE_SIZE, z), tx2lon(tileXs[0] + px/TILE_SIZE, z));
                    }

                    // Încărcăm tile-urile Josephine Map + pe canvas.
                    // Dacă z <= 15: 1 tile cerut = 1 tile desenat, direct.
                    // Dacă z > 15 (overzoom): mai multe tile-uri "virtuale" cad pe același tile real
                    // de la fetchZ — îl cerem o singură dată (cache local) și desenăm doar porțiunea
                    // (crop) corespunzătoare fiecărui tile virtual, scalată la 256×256.
                    var promises = [];
                    var _fetchCache = {}; // 'tx_ty' (la fetchZ) -> Promise<img|null>
                    function _getFetchedTile(ftx, fty) {
                        var key = ftx + '_' + fty;
                        if (!_fetchCache[key]) {
                            var url = TILE_URL_JOSEPHINE_PLUS.replace('{z}', fetchZ).replace('{x}', ftx).replace('{y}', fty);
                            _fetchCache[key] = _loadTile(url);
                        }
                        return _fetchCache[key];
                    }
                    tileXs.forEach(function(tx, ix) {
                        tileYs.forEach(function(ty, iy) {
                            var ftx = Math.floor(tx / overZoomScale);
                            var fty = Math.floor(ty / overZoomScale);
                            promises.push(_getFetchedTile(ftx, fty).then(function(img) {
                                if (!img) return;
                                if (overZoomDiff === 0) {
                                    ctx.drawImage(img, ix*TILE_SIZE, iy*TILE_SIZE, TILE_SIZE, TILE_SIZE);
                                } else {
                                    // Crop-ul porțiunii corespunzătoare acestui tile virtual din tile-ul real
                                    var cropSize = TILE_SIZE / overZoomScale;
                                    var cellX = tx % overZoomScale, cellY = ty % overZoomScale;
                                    ctx.drawImage(img,
                                        cellX*cropSize, cellY*cropSize, cropSize, cropSize,
                                        ix*TILE_SIZE, iy*TILE_SIZE, TILE_SIZE, TILE_SIZE);
                                }
                            }));
                        });
                    });

                    Promise.all(promises).then(function() {
                        console.log('[IosBld+] Tile-uri Josephine încărcate. OK:', _tileOkCount, '| FAILED:', _tileFailCount, '/', promises.length);
                        if (_tileOkCount === 0) {
                            console.error('[IosBld+] NICIUN tile Josephine Map+ nu s-a încărcat. ' +
                                'Verifică dacă URL-ul R2 (' + TILE_URL_JOSEPHINE_PLUS + ') e accesibil din browser-ul curent — ' +
                                'posibile cauze: CORS, tile inexistent în R2, sau zoom curent (' + z + ') peste nivelul maxim generat static (' + JOSEPHINE_MAX_NATIVE_Z + ').');
                        }
                        var imgData;
                        try { imgData = ctx.getImageData(0, 0, compW, compH); }
                        catch(e) {
                            console.warn('[IosBld+] CORS blocat la getImageData:', e);
                            _finish(false, true); return;
                        }
                        var data = imgData.data;

                        var cols = Math.max(1, Math.floor(compW / GRID));
                        var rows = Math.max(1, Math.floor(compH / GRID));

                        _runOnnxDetection(imgData, compW, compH, cols, rows).then(function(bigComps) {

                        console.log('[IosBld+] Clustere finale (ONNX):', bigComps.length);
                        if (!bigComps.length) { _finish(false); return; }


                        // ── Heritage exclusion ──
                        console.log('[IosBld+] Interoghez Heritage (eismgeo) pentru excludere arii protejate…');
                        _fetchHeritage(map.getBounds().pad(0.15)).then(function(hCircles) {
                            console.log('[IosBld+] Heritage: ', hCircles.length, 'cercuri returnate.');
                            var hMask = _buildHeritageMask(hCircles, cols, rows, tileXs, tileYs, z);

                            // ── Buildings exclusion ──
                            var toCheck = [];
                            var totalClippedByHeritage = 0;
                            bigComps.forEach(function(comp) {
                                var cells = comp.cells, score = comp.score;
                                // Tai Heritage
                                var clipped = cells.filter(function(i){ return !hMask[i]; });
                                var cutByHeritage = cells.length - clipped.length;
                                totalClippedByHeritage += cutByHeritage;
                                if (clipped.length < window.IOS_BLD_MIN_CLUSTER_CELLS) {
                                    console.log('[IosBld+] Cluster de', cells.length, 'celule →', cutByHeritage, 'tăiate de Heritage → rămase', clipped.length, '< MIN_CLUSTER_CELLS, ELIMINAT.');
                                    return;
                                }

                                // Cerință OBLIGATORIE: clusterul trebuie să conțină cel puțin un
                                // pixel cu nuanță de roșu/maro (cerneala tradițională de clădire
                                // pe Harta Iosefină). Fără nicio urmă de roșu, zona e considerată
                                // fundal/hașură goală și NU se mai desenează niciun poligon —
                                // elimină poligoanele "nonsens" pe zone complet goale.
                                window.IOS_BLD_RED_SCORE_BONUS = (window.IOS_BLD_RED_SCORE_BONUS !== undefined) ? window.IOS_BLD_RED_SCORE_BONUS : 0.15;
                                var hasRed = _clusterHasRed(clipped, cols, data, compW, compH);
                                if (!hasRed) {
                                    console.log('[IosBld+] Cluster de', clipped.length, 'celule FĂRĂ nicio nuanță de roșu/maro → ELIMINAT (cerință obligatorie).');
                                    return;
                                }
                                var boostedScore = (score != null) ? Math.min(1, score + window.IOS_BLD_RED_SCORE_BONUS) : score;
                                console.log('[IosBld+] Cluster confirmat prin nuanță de roșu → scor', score, '→', boostedScore);

                                // ── Detector pas adițional (opțional, vezi panoul de Setări) ──
                                // Al doilea filtru, după cel de roșeață: cere și semnătura de
                                // formă (compactitate/rotunjime) + textură (umbrire internă)
                                // specifică simbolului de clădire Iosefină, nu doar un singur
                                // pixel roșiatic izolat.
                                if (window.IOS_BLD_EXTRA_STEP_ENABLED) {
                                    var extraCheck = _extraShapeColorValidation(clipped, cols, data, compW, compH);
                                    if (!extraCheck.pass) {
                                        console.log('[IosBld+][Extra] Cluster de', clipped.length, 'celule RESPINS de detectorul pas adițional:', extraCheck.reason);
                                        return;
                                    }
                                    console.log('[IosBld+][Extra] Cluster ACCEPTAT de detectorul pas adițional (compactitate=' + extraCheck.compactness.toFixed(2) + ', gradient=' + extraCheck.gradStd.toFixed(1) + ')');
                                }

                                // Bbox al clusterului
                                var mnLat=90,mxLat=-90,mnLng=180,mxLng=-180;
                                clipped.forEach(function(i){
                                    var gx=i%cols,gy=(i-gx)/cols;
                                    var ll=pxToLL(gx*GRID+GRID/2, gy*GRID+GRID/2);
                                    if(ll.lat<mnLat)mnLat=ll.lat; if(ll.lat>mxLat)mxLat=ll.lat;
                                    if(ll.lng<mnLng)mnLng=ll.lng; if(ll.lng>mxLng)mxLng=ll.lng;
                                });
                                // Padding în jurul bbox-ului clusterului înainte de verificarea vs
                                // Buildings — absoarbe mici erori de georeferențiere ale hărții
                                // Josephine (raster istoric) față de imaginea satelitară curentă.
                                // Reglabil live din consolă, fără redeploy: window.IOS_BLD_BUILDINGS_CHECK_PAD_DEG.
                                window.IOS_BLD_BUILDINGS_CHECK_PAD_DEG = (window.IOS_BLD_BUILDINGS_CHECK_PAD_DEG !== undefined) ? window.IOS_BLD_BUILDINGS_CHECK_PAD_DEG : 0.0004;
                                var pad = window.IOS_BLD_BUILDINGS_CHECK_PAD_DEG;
                                toCheck.push({ cells:clipped, score:boostedScore, sw:{lat:mnLat-pad,lng:mnLng-pad}, ne:{lat:mxLat+pad,lng:mxLng+pad} });
                            });
                            console.log('[IosBld+] Total celule tăiate de masca Heritage:', totalClippedByHeritage);

                            if (!toCheck.length) { console.warn('[IosBld+] ABANDON: toate clusterele au fost excluse de masca Heritage.'); _finish(false); return; }
                            console.log('[IosBld+] Clustere de verificat vs Buildings.mbtiles (R2):', toCheck.length);

                            _resultLG = L.layerGroup();
                            var pend = toCheck.length, added = 0;

                            function _draw(item) {
                                if (_myGen !== _runGen || !_resultLG) return; // rulare depășită (clear/restart între timp) — ignorăm
                                var cells = item.cells;
                                var hull = _contour(cells, cols, GRID);
                                if (hull.length < 3) return;
                                var lls = hull.map(function(p){ return pxToLL(p[0],p[1]); });
                                var poly = L.polygon(lls, {
                                    color:       '#FF2800',
                                    weight:      2.5,
                                    fillColor:   '#FF2800',
                                    fillOpacity: 0.16,
                                    opacity:     0.88,
                                    pane:        'pane_ios_bld_search_help'
                                }).addTo(_resultLG);
                                // Popup cu feedback 👍/👎 (portat din model-test-v3.1.html), activ
                                // doar dacă a fost completat un Worker URL în panoul de setări.
                                var meta = {
                                    cls: 'Buildings', labelRo: 'Clădire dispărută (posibilă)',
                                    confidence: (item.score != null ? item.score : null),
                                    latNorth: item.ne.lat, latSouth: item.sw.lat,
                                    lonWest: item.sw.lng, lonEast: item.ne.lng,
                                    zoom: z, tileX: tileXs[0], tileY: tileYs[0], modelVersion: 'v3',
                                };
                                poly.bindPopup(_iosBldBuildFeedbackPopup(meta));
                                added++;
                            }

                            toCheck.forEach(function(item) {
                                // Dacă "Exclude detecțiile pe clădiri actuale" e debifat în panoul de
                                // setări, desenăm direct fără să mai interogăm tile-ul Buildings/Overpass
                                // (comportament portat din checkbox-ul excludeCurrentBuildings din
                                // model-test-v3.1.html).
                                if (!window.IOS_BLD_EXCLUDE_BUILDINGS) {
                                    _draw(item);
                                    if (--pend === 0) {
                                        console.log('[IosBld+] ── FINAL: poligoane desenate =', added, '/', toCheck.length, 'clustere verificate ──');
                                        if (added > 0 && _resultLG) _resultLG.addTo(map);
                                        _finish(added > 0);
                                    }
                                    return;
                                }
                                var minBuildingDistM = (window.IOS_BLD_MIN_BUILDING_DIST_M !== undefined) ? window.IOS_BLD_MIN_BUILDING_DIST_M : 150;
                                _trimCellsNearBuildings(item.cells, cols, pxToLL, minBuildingDistM, function (keptCells) {
                                    if (_myGen !== _runGen) return; // rulare depășită — nu mai atingem _resultLG/_finish
                                    var cutByBuildings = item.cells.length - keptCells.length;
                                    if (keptCells.length < window.IOS_BLD_MIN_CLUSTER_CELLS) {
                                        console.log('[IosBld+][Buildings] Cluster de', item.cells.length, 'celule →', cutByBuildings,
                                            'tăiate (în raza de', minBuildingDistM, 'm de o clădire actuală) → rămase', keptCells.length,
                                            '< MIN_CLUSTER_CELLS, ELIMINAT.');
                                        if (--pend === 0) {
                                            console.log('[IosBld+] ── FINAL: poligoane desenate =', added, '/', toCheck.length, 'clustere verificate ──');
                                            if (added > 0 && _resultLG) _resultLG.addTo(map);
                                            _finish(added > 0);
                                        }
                                        return;
                                    }
                                    if (cutByBuildings) {
                                        console.log('[IosBld+][Buildings] Cluster de', item.cells.length, 'celule →', cutByBuildings,
                                            'tăiate (în raza de', minBuildingDistM, 'm de o clădire actuală) → rămase', keptCells.length, '.');
                                    }
                                    // Tăierea poate rupe clusterul în bucăți neconectate (ex. o
                                    // clădire modernă chiar prin mijlocul poligonului candidat) —
                                    // re-despărțim și desenăm fiecare bucată rămasă separat, ca să
                                    // nu unim vizual două zone care nu mai sunt de fapt legate.
                                    var subMask = new Uint8Array(cols * rows);
                                    keptCells.forEach(function (i) { subMask[i] = 1; });
                                    var pieces = _connComp(subMask, cols, rows).filter(function (c) { return c.length >= window.IOS_BLD_MIN_CLUSTER_CELLS; });
                                    pieces.forEach(function (pieceCells) {
                                        var mnLat=90,mxLat=-90,mnLng=180,mxLng=-180;
                                        pieceCells.forEach(function(i){
                                            var gx=i%cols,gy=(i-gx)/cols;
                                            var ll=pxToLL(gx*GRID+GRID/2, gy*GRID+GRID/2);
                                            if(ll.lat<mnLat)mnLat=ll.lat; if(ll.lat>mxLat)mxLat=ll.lat;
                                            if(ll.lng<mnLng)mnLng=ll.lng; if(ll.lng>mxLng)mxLng=ll.lng;
                                        });
                                        _draw({ cells: pieceCells, score: item.score, sw: {lat:mnLat,lng:mnLng}, ne: {lat:mxLat,lng:mxLng} });
                                    });
                                    if (--pend === 0) {
                                        console.log('[IosBld+] ── FINAL: poligoane desenate =', added, '/', toCheck.length, 'clustere verificate ──');
                                        if (added > 0 && _resultLG) _resultLG.addTo(map);
                                        _finish(added > 0);
                                    }
                                });
                            });
                        });

                        }).catch(function(onnxErr) {
                            console.warn('[IosBld+] Eroare la detecția ONNX:', onnxErr);
                            _finish(false, true);
                        });

                    }).catch(function(e) {
                        console.warn('[IosBld+] Eroare:', e);
                        _finish(false, true);
                    });

                    function _finish(found, err) {
                        if (_myGen !== _runGen) { console.log('[IosBld+] _finish ignorat — rulare depășită (clear/restart între timp).'); return; }
                        _running = false;
                        var btn = document.getElementById('iosBldSearchHelpBtn');
                        var lbl = document.getElementById('iosBldSearchHelpLabel');
                        if (btn) btn.disabled = false;
                        if (lbl) lbl.textContent = _t('ios_bld_search_help') || 'Clădiri Dispărute';
                        console.log('[IosBld+] ── SFÂRȘIT căutare. found =', !!found, '| err =', !!err, '──────────────────');
                        if (err)  _toast(_t('ios_bld_search_help_error'), 4000);
                        else if (!found) _toast(_t('ios_bld_search_help_empty'), 3500);
                    }
                };

            })();
            // ── END JOSEPHINE MAP + BUILDINGS SEARCH HELP ────────────────────────────────

            // ── AUSTRIAN MAP 1910 WMS LAYER ──
            (function () {
                map.createPane('pane_austrian');
                map.getPane('pane_austrian').style.zIndex = 640;
                map.getPane('pane_austrian').style.pointerEvents = 'none';

                window._austrianMapLayer = L.tileLayer.wms(
                    'https://services.geo-spatial.org/geoserver/eharta/wms',
                    {
                        layers: 'eharta:mozaic_austrian_200k',
                        format: 'image/png',
                        transparent: true,
                        version: '1.1.0',
                        opacity: 0.80,
                        pane: 'pane_austrian',
                        attribution: '© geo-spatial.org / Harta Austriacă 1910'
                    }
                );

                window.toggleAustrianMap = function (on) {
                    var histToggle = document.getElementById('histToggle');
                    var histOn = histToggle && histToggle.checked;
                    if (on && !histOn) {
                        if (histToggle) histToggle.checked = true;
                        window.toggleHistLayer(true);
                        histOn = true;
                    }
                    if (on && histOn) {
                        window._austrianMapLayer.addTo(map);
                    } else {
                        map.hasLayer(window._austrianMapLayer) && map.removeLayer(window._austrianMapLayer);
                    }
                };

                window.setAustrianMapOpacity = function (val) {
                    document.getElementById('austrianMapPct').textContent = val + '%';
                    window._austrianMapLayer.setOpacity(val / 100);
                };
            })();

            // ── APM 2.0 LAYER (XYZ tiles, JPG, zoom 4-15, direct din Cloudflare R2) ──
            // Trei seturi de tile-uri (principal + NORD + SUD) sunt suprapuse în aceeași
            // pană, pe aceleași bounds/zoom. Fiecare set are doar tile-urile pe care le
            // are fizic în R2 — restul cad pe errorTileUrl (transparent) — așa că cele
            // trei surse se "îmbină" vizual într-o singură hartă completă.
            (function () {
                map.createPane('pane_apm20');
                map.getPane('pane_apm20').style.zIndex = 645;
                map.getPane('pane_apm20').style.pointerEvents = 'none';

                var _apm20Bounds = L.latLngBounds(
                    L.latLng(42.86543190058622, 19.900994668187472),
                    L.latLng(49.003192791122444, 30.671530270425873)
                );

                // ── Tile layer simplu, direct (fără canvas, fără citire de pixeli) ──
                // Am eliminat eliminarea fundalului alb/crem și încercarea de CORS:
                // procesarea pe canvas (getImageData pe fiecare tile) încetinea mult
                // zoom-ul, iar reîncărcarea CORS→fallback dubla cererile de rețea și
                // ducea la tile-uri care nu mai apăreau la zoom out. Tile layer-ul
                // standard Leaflet e mult mai rapid și de încredere.
                function _makeApm20Tile(urlTemplate) {
                    return L.tileLayer(urlTemplate, {
                        opacity: 0.40, // = 80% slider (default) din noul cap de 50% opacitate maximă
                        pane: 'pane_apm20',
                        attribution: '© DetectLab APM 2.0',
                        tms: false,
                        minZoom: 4,
                        maxZoom: 15,
                        bounds: _apm20Bounds
                    });
                }

                // Set principal (cel existent) + cele două seturi care completează zonele lipsă
                window._apm20Layer = _makeApm20Tile('https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/{z}/{x}/{y}.jpg');
                window._apm20NorthLayer = _makeApm20Tile('https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/NORD/{z}/{x}/{y}.jpg');
                window._apm20SouthLayer = _makeApm20Tile('https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/SUD/{z}/{x}/{y}.jpg');

                window._apm20AllLayers = [window._apm20Layer, window._apm20NorthLayer, window._apm20SouthLayer];
                window._apm20MergeLayers = [window._apm20NorthLayer, window._apm20SouthLayer];

                // Sub acest zoom se vede DOAR sursa principală; de la acest zoom în sus
                // (inclusiv) se "îmbină" și NORD + SUD peste ea.
                var APM20_MERGE_MIN_ZOOM = 10;
                window._apm20MergeMinZoom = APM20_MERGE_MIN_ZOOM; // expus global pentru Search Help

                // Adaugă/scoate NORD+SUD în funcție de zoom, doar cât timp APM 2.0 e activ
                function _apm20UpdateMergeLayers() {
                    if (!map.hasLayer(window._apm20Layer)) return; // APM 2.0 e oprit → nu facem nimic
                    var shouldMerge = map.getZoom() >= APM20_MERGE_MIN_ZOOM;
                    window._apm20MergeLayers.forEach(function (layer) {
                        if (shouldMerge) {
                            map.hasLayer(layer) || layer.addTo(map);
                        } else {
                            map.hasLayer(layer) && map.removeLayer(layer);
                        }
                    });
                }
                map.on('zoomend', _apm20UpdateMergeLayers);

                window.toggleApm20Layer = function (on) {
                    if (on) {
                        window._apm20Layer.addTo(map);
                        _apm20UpdateMergeLayers(); // adaugă și NORD/SUD dacă zoom-ul curent e ≥ 10
                    } else {
                        window._apm20AllLayers.forEach(function (layer) {
                            map.hasLayer(layer) && map.removeLayer(layer);
                        });
                    }
                };

                window.setApm20Opacity = function (val) {
                    document.getElementById('apm20Pct').textContent = val + '%';
                    var APM20_MAX_OPACITY = 0.5; // capul maxim de opacitate al stratului
                    window._apm20AllLayers.forEach(function (layer) {
                        layer.setOpacity((val / 100) * APM20_MAX_OPACITY);
                    });
                };
            })();

            // ── MUTUAL EXCLUSIVITY: APM Layer and APM 2.0 are never on at the same time ──
            (function () {
                var _origToggleApm = window.toggleApmLayer;
                var _origToggleApm20 = window.toggleApm20Layer;

                window.toggleApmLayer = function (on) {
                    _origToggleApm(on);
                    if (on) {
                        var apm20Toggle = document.getElementById('apm20Toggle');
                        if (apm20Toggle && apm20Toggle.checked) {
                            apm20Toggle.checked = false;
                            _origToggleApm20(false);
                            var apm20Pct = document.getElementById('apm20Pct');
                            if (apm20Pct) apm20Pct.textContent = '0%';
                            var searchHelpBtn = document.getElementById('apm20SearchHelpBtn');
                            if (searchHelpBtn) searchHelpBtn.style.display = 'none';
                            if (typeof window.clearApm20SearchHelp === 'function') window.clearApm20SearchHelp();
                        }
                        // Restore original legend when APM 1 comes back on
                        if (typeof window._updateApm20Legend === 'function') window._updateApm20Legend(false);
                    }
                };

                window.toggleApm20Layer = function (on) {
                    console.log('[APM2.0] toggleApm20Layer called, on =', on);
                    _origToggleApm20(on);
                    if (on) {
                        var apmToggle = document.getElementById('apmToggle');
                        if (apmToggle && apmToggle.checked) {
                            apmToggle.checked = false;
                            _origToggleApm(false);
                            var apmPct = document.getElementById('apmPct');
                            if (apmPct) apmPct.textContent = '0%';
                        }
                    }
                    window._updateApm20Legend(on);
                    if (typeof window._refreshApm20SearchHelpBtnVisibility === 'function') {
                        console.log('[APM2.0] calling _refreshApm20SearchHelpBtnVisibility...');
                        window._refreshApm20SearchHelpBtnVisibility();
                        setTimeout(window._refreshApm20SearchHelpBtnVisibility, 50);
                    } else {
                        console.warn('[APM2.0] _refreshApm20SearchHelpBtnVisibility NOT defined yet!');
                    }
                    if (!on && typeof window.clearApm20SearchHelp === 'function') window.clearApm20SearchHelp();
                };

                // ── APM 2.0 LEGEND SWITCHER ──
                var _apm20LegendColors = [
                    { color: '#ff0000', value: '1' },   // red
                    { color: '#ff00ff', value: '2' },   // magenta
                    { color: '#808000', value: '3' },   // olive/dark yellow
                    { color: '#ffff99', value: '4' },   // light yellow
                    { color: '#00cc00', value: '4.5' }, // green
                    { color: '#0000ff', value: '5' }    // blue
                ];
                // APM 2.0 has 6 legend entries: value 1 = no potential, then 2/3/4/4.5/5
                var _apm20WhatLegendDefs = [
                    { color: '#0000ff', keyEN: 'apm20_leg5', keyRO: 'apm20_leg5' },
                    { color: '#00cc00', keyEN: 'apm20_leg4', keyRO: 'apm20_leg4' },
                    { color: '#ffff99', keyEN: 'apm20_leg3', keyRO: 'apm20_leg3' },
                    { color: '#808000', keyEN: 'apm20_leg2', keyRO: 'apm20_leg2' },
                    { color: '#ff00ff', keyEN: 'apm20_leg2b', keyRO: 'apm20_leg2b' },
                    { color: '#ff0000', keyEN: 'apm20_leg1', keyRO: 'apm20_leg1' }
                ];
                var _apm20MapPillDefs = [
                    { color: '#ff0000', label: '1' },
                    { color: '#ff00ff', label: '2' },
                    { color: '#808000', label: '3' },
                    { color: '#ffff99', label: '4' },
                    { color: '#00cc00', label: '4.5' },
                    { color: '#0000ff', label: '5' }
                ];
                // Original APM legend defs
                var _origWhatLegendHTML = null;
                var _origPillsHTML = null;

                window._updateApm20Legend = function _updateApm20Legend(on) {
                    var whatLegend = document.getElementById('whatLegendItems');
                    var pillsContainer = document.getElementById('legendPills');
                    var lang = (typeof _lang !== 'undefined' ? _lang : 'en') || 'en';
                    var t = (typeof translations !== 'undefined' && translations[lang]) ? translations[lang] : {};

                    if (on) {
                        // Save originals
                        if (whatLegend && !_origWhatLegendHTML) _origWhatLegendHTML = whatLegend.innerHTML;
                        if (pillsContainer && !_origPillsHTML) _origPillsHTML = pillsContainer.innerHTML;

                        // Update what-legend (6 items, top = highest)
                        if (whatLegend) {
                            whatLegend.innerHTML = _apm20WhatLegendDefs.map(function(d) {
                                var text = t[d.keyEN] || d.keyEN;
                                return '<div class="legend-item"><div class="legend-dot" style="background:' + d.color + '"></div><span class="t" data-key="' + d.keyEN + '">' + text + '</span></div>';
                            }).join('');
                        }
                        // Update map pills (6 items, low to high)
                        if (pillsContainer) {
                            pillsContainer.innerHTML = _apm20MapPillDefs.map(function(d) {
                                return '<div class="legend-pill"><div class="legend-pill-dot" style="background:' + d.color + '"></div><span>' + d.label + '</span></div>';
                            }).join('');
                        }
                    } else {
                        // Restore originals
                        if (whatLegend && _origWhatLegendHTML) {
                            whatLegend.innerHTML = _origWhatLegendHTML;
                            _origWhatLegendHTML = null;
                        }
                        if (pillsContainer && _origPillsHTML) {
                            pillsContainer.innerHTML = _origPillsHTML;
                            _origPillsHTML = null;
                        }
                        // Re-apply translations to restored items
                        if (typeof applyTranslations === 'function') applyTranslations();
                    }
                };
            })();

            // ── APM 2.0 SEARCH HELP (analiză culoare pe tile-uri vizibile + încadrare poligoane mov) ──
            // Activ doar când stratul APM 2.0 e pornit. La click pe buton:
            //  1. compune un canvas cu tile-urile JPG vizibile în viewport-ul curent
            //  2. clasifică fiecare pixel (sub-eșantionat) ca albastru / verde / galben / altceva,
            //     pe baza distanței euclidiene RGB faţă de culorile de referință din legendă
            //  3. regulă de prioritate pe zona analizată:
            //       - dacă densitatea albastru+verde e foarte mare  -> păstrează DOAR albastru
            //       - altfel, dacă există albastru SAU verde        -> păstrează albastru+verde
            //       - altfel (nu există nici albastru, nici verde)  -> fallback pe galben
            //  4. găsește componentele conexe ale măștii rezultate, ignoră clusterele mici
            //     (păstrăm doar zone mari/compacte), desenează un poligon mov (convex hull) per cluster
            (function () {
                map.createPane('pane_apm20_search_help');
                map.getPane('pane_apm20_search_help').style.zIndex = 646;

                var TILE_URL_TMPL = 'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/{z}/{x}/{y}.jpg';
                var TILE_URL_TMPL_NORTH = 'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/NORD/{z}/{x}/{y}.jpg';
                var TILE_URL_TMPL_SOUTH = 'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/SUD/{z}/{x}/{y}.jpg';
                var TILE_SIZE = 256;
                var GRID = 4;          // 4px/celulă — echilibru între rezoluție și viteză
                var MIN_CLUSTER_CELLS = 4;
                var SPLIT_CLUSTER_CELLS = 40000; // clustere mai mari decât asta sunt re-analizate pe masca originală (nedilatată)
                var MAX_CLUSTER_CELLS = 80000; // plasă de siguranță — trebuie > SPLIT_CLUSTER_CELLS, altfel split-ul de mai jos nu se mai execută niciodată
                var DENSE_THRESHOLD = 0.12;
                var TOL = 90;
                var MAX_AREA_KM2 = 150; // ~12x12 km viewport

                // Culori de referință — ajustate pentru ce returnează efectiv JPEG-ul (nu valorile pure din legendă)
                // JPEG compresie: albastrul pur #0000ff devine ~[30-60, 30-60, 200-230] în tile-uri comprimate
                var COL_BLUE   = [20, 20, 220];   // #0000ff comprimat JPEG
                var COL_GREEN  = [0, 185, 0];     // #00cc00 comprimat JPEG
                var COL_YELLOW = [240, 240, 140]; // #ffff99 comprimat JPEG

                var _resultLayerGroup = null;
                var _running = false;

                function _colorDist(r, g, b, ref) {
                    var dr = r - ref[0], dg = g - ref[1], db = b - ref[2];
                    return Math.sqrt(dr * dr + dg * dg + db * db);
                }

                // Clasifică un pixel: 0=none, 1=blue(score5), 2=green(score4.5), 3=yellow(score4), 4=dark-green-toward-blue(score4.8)
                // Regulă strictă: ALBASTRU înseamnă că B este NET dominant față de G.
                // Teal/verde-albăstrui (G ≈ B) → clasificat ca VERDE, nu albastru.
                // Tip 4: verde ÎNCHIS cu componentă albastră semnificativă (verde-teal spre albastru)
                //   Folosit DOAR în modul "blue rar" — înlocuiește tot verdele cu verdele care are afinitate albastră.
                var _debugPixelLog = true;
                function _classifyPixel(r, g, b) {
                    if (r + g + b < 15) return 0;
                    var total = r + g + b;
                    if (total < 40) return 0;
                    var rr = r / total, gr = g / total, br = b / total;

                    // ALBASTRU PUR (score 5): B net dominant față de atât R cât și G
                    // B trebuie să fie > G (nu doar aproape egal) și > R
                    // Condiție strictă: b > g * 1.3 elimină teal-ul/verde-albăstruiul
                    // Exemple valide: rgb(20,60,200), rgb(10,80,180), rgb(30,100,210)
                    // Exemple EXCLUSE: rgb(0,130,120) teal, rgb(0,100,100) teal
                    if (b > 80 && b > r * 2.0 && b > g * 1.3 && br > 0.38 && rr < 0.22) {
                        if (_debugPixelLog) { console.log('[APM2.0] 🔵 albastru RGB:', r, g, b, '| br:', br.toFixed(2), 'b/g:', (b/Math.max(g,1)).toFixed(2)); _debugPixelLog = false; }
                        return 1;
                    }

                    // VERDE ÎNCHIS SPRE ALBASTRU (score 4.8): verde cu componentă albastră notabilă
                    // G dominant dar B semnificativ (B ≥ 40% din G) și culoarea e închisă (nu verde lime strident)
                    // Exemple: rgb(0,120,80) verde-teal, rgb(0,100,70) verde forest, rgb(20,130,100)
                    // Excludem verdele lime pur (B prea mic față de G)
                    if (g > 60 && b > 30 && g > r * 1.4 && b >= g * 0.40 && b > r * 1.5 &&
                        gr > 0.30 && br > 0.15 && rr < 0.30 && g < 200) {
                        return 4;
                    }

                    // VERDE LIME/PUR (score 4.5): G net dominant față de R și B
                    // Include și teal-ul (G ≈ B, ambele mari, R mic) — e mai aproape de verde decât albastru
                    // Exemple: rgb(0,216,0), rgb(8,177,48), rgb(0,130,120) teal, rgb(50,200,30)
                    if (g > 80 && g > r * 1.4 && g > b * 0.7 && gr > 0.35 && rr < 0.35) return 2;

                    // GALBEN/OLIVE (score 4): R și G ambele mari, B mic
                    if (rr > 0.30 && gr > 0.30 && br < 0.22 && r > 100 && g > 100) return 3;

                    return 0;
                }

                // Conversii lat/lng <-> tile XYZ (Web Mercator standard, slippy-map)
                function _lon2tileX(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
                function _lat2tileY(lat, z) {
                    var rad = lat * Math.PI / 180;
                    return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z);
                }
                function _tileX2lon(x, z) { return x / Math.pow(2, z) * 360 - 180; }
                function _tileY2lat(y, z) {
                    var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
                    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
                }

                // Token unic per sesiune de pagină: folosit doar pentru a forța o cerere
                // de rețea nouă când încărcăm cu CORS, ca să nu nimerim peste varianta
                // fără CORS deja pusă în cache-ul de imagini de stratul de hartă (altfel
                // img.onload se declanșează "cu succes" dar canvas-ul rămâne tainted).
                var _CORS_CACHE_BUST = '_apm20cb=' + Math.random().toString(36).slice(2);

                function _loadTileImage(url) {
                    return new Promise(function (resolve) {
                        function tryLoad(useCORS) {
                            var img = new Image();
                            var loadUrl = url;
                            if (useCORS) {
                                // Încercăm întâi cu CORS: e necesar ca să putem citi pixelii
                                // (getImageData) pentru analiza Search Help. Dacă bucket-ul R2
                                // trimite Access-Control-Allow-Origin, tile-ul se încarcă normal
                                // și canvas-ul compus nu rămâne "tainted".
                                img.crossOrigin = 'anonymous';
                                loadUrl += (url.indexOf('?') === -1 ? '?' : '&') + _CORS_CACHE_BUST;
                            }
                            img.onload = function () { resolve(img); };
                            img.onerror = function () {
                                if (useCORS) {
                                    // CORS a picat din orice motiv (header lipsă, eroare de rețea
                                    // etc.) — reîncărcăm fără crossOrigin ca tile-ul să apară
                                    // totuși, chiar dacă pixelii n-ar mai putea fi citiți.
                                    tryLoad(false);
                                    return;
                                }
                                resolve(null);
                            };
                            img.src = loadUrl;
                        }
                        tryLoad(true);
                    });

                }

                function _showToast(msg, durationMs) {
                    var toast = document.getElementById('apm20SearchHelpToast');
                    if (!toast) return;
                    toast.textContent = msg;
                    toast.style.display = 'block';
                    clearTimeout(toast._hideTimer);
                    toast._hideTimer = setTimeout(function () { toast.style.display = 'none'; }, durationMs || 3500);
                }

                // BFS flood-fill: componente conexe (8-conectivitate) pe grid-ul binar de mască
                function _connectedComponents(maskGrid, cols, rows) {
                    var visited = new Uint8Array(cols * rows);
                    var components = [];
                    for (var idx = 0; idx < cols * rows; idx++) {
                        if (visited[idx] || !maskGrid[idx]) continue;
                        var stack = [idx];
                        var cells = [];
                        visited[idx] = 1;
                        while (stack.length) {
                            var cur = stack.pop();
                            cells.push(cur);
                            var cx = cur % cols, cy = (cur - cx) / cols;
                            var nb = [
                                [cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1],
                                [cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1], [cx + 1, cy + 1]
                            ];
                            for (var n = 0; n < nb.length; n++) {
                                var nx = nb[n][0], ny = nb[n][1];
                                if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
                                var nIdx = ny * cols + nx;
                                if (visited[nIdx] || !maskGrid[nIdx]) continue;
                                visited[nIdx] = 1;
                                stack.push(nIdx);
                            }
                        }
                        components.push(cells);
                    }
                    return components;
                }

                // Bisecție recursivă pe mediană (gen kd-tree): împarte un cluster de celule
                // în bucăți mai mici după poziția geometrică (NU după culoare).
                // Se folosește când o pată e prea mare ȘI prea uniformă ca să se separe
                // natural (densitate f. mare de albastru/verde, fără variație de nuanță
                // care să creeze o frontieră reală între sub-zone). Garantează că fiecare
                // bucată rezultată are cel mult maxSize celule, oricare ar fi forma petei.
                function _splitComponentByGeometry(cells, cols, maxSize) {
                    if (cells.length <= maxSize) return [cells];
                    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                    var pts = cells.map(function (idx) {
                        var cx = idx % cols, cy = (idx - cx) / cols;
                        if (cx < minX) minX = cx;
                        if (cx > maxX) maxX = cx;
                        if (cy < minY) minY = cy;
                        if (cy > maxY) maxY = cy;
                        return { idx: idx, x: cx, y: cy };
                    });
                    // Tăiem mereu pe axa cu extindere mai mare, ca bucățile rezultate
                    // să tindă spre poligoane compacte, nu fâșii alungite.
                    var splitOnX = (maxX - minX) >= (maxY - minY);
                    pts.sort(function (a, b) { return splitOnX ? (a.x - b.x) : (a.y - b.y); });
                    var mid = Math.floor(pts.length / 2);
                    var left = pts.slice(0, mid).map(function (p) { return p.idx; });
                    var right = pts.slice(mid).map(function (p) { return p.idx; });
                    return _splitComponentByGeometry(left, cols, maxSize)
                        .concat(_splitComponentByGeometry(right, cols, maxSize));
                }

                // Convex hull (monotone chain) — păstrat ca fallback
                function _convexHull(points) {
                    if (points.length < 3) return points;
                    points = points.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
                    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
                    var lower = [];
                    for (var i = 0; i < points.length; i++) {
                        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], points[i]) <= 0) lower.pop();
                        lower.push(points[i]);
                    }
                    var upper = [];
                    for (var j = points.length - 1; j >= 0; j--) {
                        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], points[j]) <= 0) upper.pop();
                        upper.push(points[j]);
                    }
                    upper.pop(); lower.pop();
                    return lower.concat(upper);
                }

                // Outline concav: urmărește marginea reală a clusterului de celule (marching squares simplificat)
                // Returnează lista de puncte [px,py] de pe conturul exterior al clusterului.
                function _hullFromCells(cells, cols, cellSizePx) {
                    // Construim set rapid de celule
                    var cellSet = {};
                    cells.forEach(function(idx) { cellSet[idx] = true; });

                    function has(cx, cy) {
                        if (cx < 0 || cy < 0) return false;
                        return !!cellSet[cy * cols + cx];
                    }

                    // Găsim celula de start: cea mai de sus-stânga din cluster
                    var startIdx = cells.reduce(function(best, idx) {
                        var bx = best % cols, by = (best - bx) / cols;
                        var ix = idx % cols, iy = (idx - ix) / cols;
                        return (iy < by || (iy === by && ix < bx)) ? idx : best;
                    }, cells[0]);
                    var sx = startIdx % cols, sy = (startIdx - sx) / cols;

                    // Moore neighborhood tracing — urmărește conturul exterior
                    // Direcții: 0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N, 7=NE
                    var dx = [1,1,0,-1,-1,-1,0,1];
                    var dy = [0,1,1,1,0,-1,-1,-1];

                    var outline = [];
                    var cx = sx, cy = sy;
                    var dir = 7; // venim din NE (standard pentru start de sus-stânga)
                    var maxSteps = cells.length * 4 + 8;
                    var steps = 0;

                    do {
                        outline.push([cx * cellSizePx + cellSizePx / 2, cy * cellSizePx + cellSizePx / 2]);
                        // Căutăm următoarea celulă din contur, rotind clockwise din direcția opusă celei de unde am venit
                        var backDir = (dir + 4) % 8;
                        var found = false;
                        for (var d = 0; d < 8; d++) {
                            var nd = (backDir + 1 + d) % 8;
                            var nx = cx + dx[nd], ny = cy + dy[nd];
                            if (has(nx, ny)) {
                                cx = nx; cy = ny; dir = nd;
                                found = true;
                                break;
                            }
                        }
                        if (!found) break;
                        steps++;
                    } while ((cx !== sx || cy !== sy) && steps < maxSteps);

                    // Dacă outline-ul e prea mic (forme degenerate), fallback la convex hull
                    if (outline.length < 3) {
                        var pts = cells.map(function(idx) {
                            var cx = idx % cols, cy = (idx - cx) / cols;
                            return [cx * cellSizePx + cellSizePx / 2, cy * cellSizePx + cellSizePx / 2];
                        });
                        return _convexHull(pts);
                    }

                    // Simplificăm outline-ul: păstrăm doar punctele care schimbă direcția (reducem zgomotul)
                    var simplified = [outline[0]];
                    for (var si = 1; si < outline.length - 1; si++) {
                        var prev = simplified[simplified.length - 1];
                        var curr = outline[si];
                        var next = outline[si + 1];
                        var ddx1 = curr[0] - prev[0], ddy1 = curr[1] - prev[1];
                        var ddx2 = next[0] - curr[0], ddy2 = next[1] - curr[1];
                        if (ddx1 !== ddx2 || ddy1 !== ddy2) simplified.push(curr);
                    }
                    simplified.push(outline[outline.length - 1]);
                    return simplified;
                }

                function _setButtonState(loading, T) {
                    var btn = document.getElementById('apm20SearchHelpBtn');
                    var labelSpan = document.getElementById('apm20SearchHelpLabel');
                    if (btn) btn.disabled = loading;
                    if (labelSpan) {
                        labelSpan.textContent = loading
                            ? (T['apm20_search_help_loading'] || 'Analyzing visible area…')
                            : (T['apm20_search_help'] || 'Search Help');
                    }
                }

                // Aria aproximativă (km²) a viewport-ului curent al hărții, calculată din bounds-ul real
                // (nu doar din nivelul de zoom — depinde și de dimensiunea ferestrei/ecranului).
                // Folosim formula haversine pentru lățime (la latitudinea medie) și înălțime, apoi le înmulțim.
                function _haversineKm(lat1, lng1, lat2, lng2) {
                    var R = 6371; // raza Pământului în km
                    var dLat = (lat2 - lat1) * Math.PI / 180;
                    var dLng = (lng2 - lng1) * Math.PI / 180;
                    var rLat1 = lat1 * Math.PI / 180, rLat2 = lat2 * Math.PI / 180;
                    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                            Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
                    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                }

                function _currentViewportAreaKm2() {
                    var b = map.getBounds();
                    var n = b.getNorth(), s = b.getSouth(), e = b.getEast(), w = b.getWest();
                    var midLat = (n + s) / 2;
                    var widthKm = _haversineKm(midLat, w, midLat, e);
                    var heightKm = _haversineKm(n, w, s, w);
                    return widthKm * heightKm;
                }

                // Arată/ascunde butonul "Search Help" și hint-ul de zoom: cât timp APM 2.0
                // e activ, afișăm fie hint-ul "Zoom in for advanced search" (zoom insuficient),
                // fie butonul "Search Help" (zoom suficient) — niciodată ambele simultan.
                var _apm20HintVisible = false;

                // Poziționarea se face acum integral din CSS (position:absolute, ancorat în
                // .map-wrapper — la fel ca celelalte hint-uri/controale ale hărții), așa că nu
                // mai e nevoie să recalculăm coordonate în JS la fiecare resize/scroll. Asta
                // elimină și bug-ul în care butonul "sărea" pe verticală când utilizatorul
                // interacționa cu slider-ele din panoul de opacitate (care declanșau recalculări
                // bazate pe getBoundingClientRect și un mic scroll/reflow al paginii).
                function _positionApm20Overlays() {
                    // no-op — păstrată doar pentru compatibilitate cu apelurile existente
                }
                window._positionApm20Overlays = _positionApm20Overlays;
                window._refreshApm20SearchHelpBtnVisibility = function () {
                    _positionApm20Overlays();
                    var btn = document.getElementById('apm20SearchHelpBtn');
                    var hint = document.getElementById('apm20SearchHelpHint');
                    console.log('[APM2.0] _refreshVisibility → btn:', btn, '| hint:', hint);
                    if (!btn || !hint) {
                        console.error('[APM2.0] ❌ btn sau hint NU a fost găsit în DOM! Verifică ID-urile.');
                        return;
                    }
                    var layerOn = !!(window._apm20Layer && map.hasLayer(window._apm20Layer));
                    var areaKm2 = _currentViewportAreaKm2();
                    var areaOk = areaKm2 <= MAX_AREA_KM2;
                    console.log('[APM2.0] layerOn:', layerOn, '| areaKm2:', areaKm2.toFixed(1), '| MAX_AREA_KM2:', MAX_AREA_KM2, '| areaOk:', areaOk);

                    if (!layerOn) {
                        console.log('[APM2.0] Layer OFF → ascundem btn și hint');
                        btn.style.display = 'none';
                        hint.classList.remove('visible');
                        hint.style.display = 'none';
                        _apm20HintVisible = false;
                        return;
                    }

                    var areaOk = _currentViewportAreaKm2() <= MAX_AREA_KM2;

                    if (areaOk) {
                        // Zoom suficient → arătăm butonul, ascundem hint-ul
                        console.log('[APM2.0] ✅ Zoom OK → afișăm butonul Search Help');
                        hint.classList.remove('visible');
                        if (_apm20HintVisible) {
                            setTimeout(function () {
                                if (!_apm20HintVisible) hint.style.display = 'none';
                            }, 250);
                        } else {
                            hint.style.display = 'none';
                        }
                        _apm20HintVisible = false;
                        btn.style.display = 'flex';
                        btn.classList.remove('needs-zoom');
                        // Verificare vizibilitate finală
                        setTimeout(function() {
                            var r = btn.getBoundingClientRect();
                            console.log('[APM2.0] btn.getBoundingClientRect():', JSON.stringify({top: r.top.toFixed(0), left: r.left.toFixed(0), width: r.width.toFixed(0), height: r.height.toFixed(0)}));
                            console.log('[APM2.0] btn computed display:', window.getComputedStyle(btn).display, '| visibility:', window.getComputedStyle(btn).visibility, '| opacity:', window.getComputedStyle(btn).opacity, '| z-index:', window.getComputedStyle(btn).zIndex);
                            var parent = btn.parentElement;
                            while (parent) {
                                var s = window.getComputedStyle(parent);
                                if (s.overflow === 'hidden' || s.overflow === 'clip') {
                                    console.warn('[APM2.0] ⚠️ Părinte cu overflow:hidden găsit:', parent.id || parent.className, '| overflow:', s.overflow);
                                }
                                parent = parent.parentElement;
                            }
                        }, 100);
                    } else {
                        // Zoom insuficient → arătăm hint-ul, ascundem butonul
                        console.log('[APM2.0] 🔍 Zoom insuficient → afișăm hint "Zoom in"');
                        btn.style.display = 'none';
                        btn.classList.remove('needs-zoom');
                        if (!_apm20HintVisible) {
                            hint.style.display = 'flex';
                            requestAnimationFrame(function () { hint.classList.add('visible'); });
                            _apm20HintVisible = true;
                        }
                        if (typeof window.clearApm20SearchHelp === 'function') window.clearApm20SearchHelp();
                    }
                };

                // Recalculăm vizibilitatea la fiecare schimbare de zoom/poziție/dimensiune a hărții
                map.on('zoomend moveend', function () {
                    window._refreshApm20SearchHelpBtnVisibility();
                });
                window.addEventListener('resize', function () {
                    window._refreshApm20SearchHelpBtnVisibility();
                });

                window.clearApm20SearchHelp = function () {
                    if (_resultLayerGroup) {
                        map.removeLayer(_resultLayerGroup);
                        _resultLayerGroup = null;
                    }
                };

                window.runApm20SearchHelp = function () {
                    if (_running) return;
                    if (!window._apm20Layer || !map.hasLayer(window._apm20Layer)) return; // doar când APM 2.0 e activ
                    if (_currentViewportAreaKm2() > MAX_AREA_KM2) {
                        var langZ = (typeof currentLang !== 'undefined' ? currentLang : 'en') || 'en';
                        var TZ = (typeof translations !== 'undefined' && translations[langZ]) ? translations[langZ] : {};
                        _showToast(TZ['apm20_search_help_zoom'] || 'Zoom in more to use Search Help', 3000);
                        return; // zoom insuficient, zona prea mare
                    }

                    window.clearApm20SearchHelp();
                    _running = true;

                    var lang = (typeof currentLang !== 'undefined' ? currentLang : 'en') || 'en';
                    var T = (typeof translations !== 'undefined' && translations[lang]) ? translations[lang] : {};
                    _setButtonState(true, T);

                    var z = Math.round(map.getZoom());
                    var bounds = map.getBounds();
                    var minTileX = Math.max(0, Math.floor(_lon2tileX(bounds.getWest(), z)));
                    var maxTileX = Math.floor(_lon2tileX(bounds.getEast(), z));
                    var minTileY = Math.max(0, Math.floor(_lat2tileY(bounds.getNorth(), z)));
                    var maxTileY = Math.floor(_lat2tileY(bounds.getSouth(), z));

                    var tileXs = [], tileYs = [];
                    for (var tx = minTileX; tx <= maxTileX; tx++) tileXs.push(tx);
                    for (var ty = minTileY; ty <= maxTileY; ty++) tileYs.push(ty);

                    if (tileXs.length === 0 || tileYs.length === 0) { _finish(false, T); return; }

                    var compositeW = tileXs.length * TILE_SIZE;
                    var compositeH = tileYs.length * TILE_SIZE;
                    var canvas = document.createElement('canvas');
                    canvas.width = compositeW;
                    canvas.height = compositeH;
                    var ctx = canvas.getContext('2d');

                    // Sub zoom-ul de îmbinare, analizăm DOAR sursa principală (la fel ca pe hartă);
                    // de la zoom-ul de îmbinare în sus, completăm canvas-ul și cu NORD/SUD,
                    // exact ca ordinea de stivuire de pe hartă (principal → NORD → SUD).
                    var mergeInSearchHelp = z >= (window._apm20MergeMinZoom || 10);

                    var loadPromises = [];
                    tileXs.forEach(function (tx, ix) {
                        tileYs.forEach(function (ty, iy) {
                            var px = ix * TILE_SIZE, py = iy * TILE_SIZE;
                            var urls = [TILE_URL_TMPL];
                            if (mergeInSearchHelp) urls.push(TILE_URL_TMPL_NORTH, TILE_URL_TMPL_SOUTH);

                            // Desenăm secvențial (nu în paralel) per celulă, ca sursele care
                            // se încarcă mai târziu (NORD/SUD) să nu poată ajunge să fie
                            // suprascrise de cele anterioare — păstrăm ordinea de stivuire.
                            var chain = Promise.resolve();
                            urls.forEach(function (tmpl) {
                                var url = tmpl.replace('{z}', z).replace('{x}', tx).replace('{y}', ty);
                                chain = chain.then(function () {
                                    return _loadTileImage(url).then(function (img) {
                                        if (img) ctx.drawImage(img, px, py, TILE_SIZE, TILE_SIZE);
                                    });
                                });
                            });
                            loadPromises.push(chain);
                        });
                    });

                    Promise.all(loadPromises).then(function () {
                        var imgData;
                        try {
                            imgData = ctx.getImageData(0, 0, compositeW, compositeH);
                        } catch (e) {
                            console.warn('APM 2.0 Search Help: nu pot citi pixelii canvas-ului (CORS?)', e);
                            _finish(false, T, true);
                            return;
                        }
                        var data = imgData.data;

                        // ── DEBUG: samplez 300 pixeli și loghez distribuția de culori reale din JPEG ──
                        (function() {
                            var samples = [];
                            var step = Math.max(1, Math.floor(data.length / 4 / 300));
                            for (var si = 0; si < data.length / 4; si += step) {
                                var sr = data[si*4], sg = data[si*4+1], sb = data[si*4+2];
                                if (sr + sg + sb > 30) samples.push([sr, sg, sb]);
                            }
                            // grupez în buckets grossolane de culoare dominantă
                            var bBlu = samples.filter(function(p){ var t=p[0]+p[1]+p[2]; return p[2]/t > 0.38 && p[2] > 80; });
                            var bGrn = samples.filter(function(p){ var t=p[0]+p[1]+p[2]; return p[1]/t > 0.45 && p[1] > 80; });
                            var bYel = samples.filter(function(p){ return p[0] > 120 && p[1] > 120 && p[2] < 100; });
                            console.log('[APM2.0] 🎨 Sample', samples.length, 'pixeli: albastru=', bBlu.length, '| verde=', bGrn.length, '| galben=', bYel.length);
                            if (bBlu.length > 0) console.log('[APM2.0] 🔵 Exemple albastre:', bBlu.slice(0,5).map(function(p){return 'rgb('+p+')';}).join(', '));
                            if (bGrn.length > 0) console.log('[APM2.0] 🟢 Exemple verzi:', bGrn.slice(0,5).map(function(p){return 'rgb('+p+')';}).join(', '));
                            if (bBlu.length === 0 && bGrn.length === 0) {
                                // niciun pixel recunoscut — loghez primii 10 pixeli brut ca să vedem ce vine
                                console.warn('[APM2.0] ⚠️ NICIO culoare recunoscută! Primii pixeli brut:', samples.slice(0,10).map(function(p){return 'rgb('+p+')';}).join(', '));
                            }
                        })();

                        var cols = Math.max(1, Math.floor(compositeW / GRID));
                        var rows = Math.max(1, Math.floor(compositeH / GRID));

                        // tip dominant per celulă grid: 0=none, 1=blue, 2=green, 3=yellow, 4=verde-albăstrui
                        var cellType = new Uint8Array(cols * rows);
                        var counts = { blue: 0, green: 0, yellow: 0, darkGreenBlue: 0 };

                        // Eșantionare majoritară: votăm culoarea dominantă din toți pixelii celulei GRID×GRID
                        // Asta elimină dependența de un singur pixel și crește acuratețea masiv.
                        for (var gy = 0; gy < rows; gy++) {
                            for (var gx = 0; gx < cols; gx++) {
                                var vBlue = 0, vGreen = 0, vYellow = 0, vDarkGreenBlue = 0, vNone = 0;
                                for (var sy = 0; sy < GRID; sy++) {
                                    for (var sx = 0; sx < GRID; sx++) {
                                        var spx = gx * GRID + sx;
                                        var spy = gy * GRID + sy;
                                        if (spx >= compositeW || spy >= compositeH) continue;
                                        var pidx = (spy * compositeW + spx) * 4;
                                        var sc = _classifyPixel(data[pidx], data[pidx+1], data[pidx+2]);
                                        if (sc === 1) vBlue++;
                                        else if (sc === 2) vGreen++;
                                        else if (sc === 3) vYellow++;
                                        else if (sc === 4) vDarkGreenBlue++;
                                        else vNone++;
                                    }
                                }
                                var cls = 0;
                                if (vBlue >= vGreen && vBlue >= vYellow && vBlue >= vDarkGreenBlue && vBlue > vNone * 0.3) cls = 1;
                                else if (vDarkGreenBlue >= vGreen && vDarkGreenBlue >= vYellow && vDarkGreenBlue > vNone * 0.3) cls = 4;
                                else if (vGreen >= vBlue && vGreen >= vYellow && vGreen > vNone * 0.3) cls = 2;
                                else if (vYellow >= vBlue && vYellow >= vGreen && vYellow > vNone * 0.3) cls = 3;
                                cellType[gy * cols + gx] = cls;
                                if (cls === 1) counts.blue++;
                                else if (cls === 2) counts.green++;
                                else if (cls === 3) counts.yellow++;
                                else if (cls === 4) counts.darkGreenBlue++;
                            }
                        }

                        // ── Regulă de prioritate ──
                        // 1) albastru + verde au prioritate peste galben
                        // 2) dacă densitatea albastru+verde e foarte mare în zona vizibilă, păstrăm DOAR albastru
                        // 3) dacă nu există nici albastru, nici verde, recurgem la galben
                        var totalCells = cols * rows;
                        console.log('[APM2.0] Clasificare grid:', cols, 'x', rows, '=', totalCells, 'celule | blue:', counts.blue, '| green:', counts.green, '| yellow:', counts.yellow, '| verde-albăstrui:', counts.darkGreenBlue);

                        var hasBlue = counts.blue > 0;
                        var hasGreen = counts.green > 0 || counts.darkGreenBlue > 0;
                        var blueRatio = counts.blue / totalCells;
                        var greenRatio = (counts.green + counts.darkGreenBlue) / totalCells;

                        // Prioritate: blue > green > yellow
                        // Dacă avem suficient blue (>0.3% din celule), încadrăm DOAR blue
                        // Dacă avem blue mai puțin sau deloc, includem și green
                        // Fallback yellow doar dacă nu există nici blue nici green
                        // ── Selecție tip țintă ──
                        // Dacă zona e dominată de blue+green (>40% celule active), selectăm DOAR blue.
                        // Altfel folosim blue cu prioritate, sau blue+green dacă e puțin blue.
                        var totalActive = counts.blue + counts.green + counts.yellow + counts.darkGreenBlue;
                        var activeFraction = totalActive / totalCells;

                        // ── Regulă nouă de prioritate ──
                        // Verificăm dacă există atât albastru cât și verde/galben în zona vizibilă:
                        //   → Dacă există albastru suficient (≥2% din celulele active): DOAR albastru
                        //   → Dacă există albastru dar foarte puțin (<2% din activ): albastru + verde ÎNCHIS SPRE ALBASTRU (tip 4)
                        //     (nu tot verdele — doar verdele cu afinitate albastră, verde forest/teal)
                        //   → Dacă există DOAR verde (fără albastru): încadrăm verde
                        //   → Dacă nu există nici albastru, nici verde: fallback galben
                        var hasYellow = counts.yellow > 0;
                        var hasGreenAny = counts.green > 0 || counts.darkGreenBlue > 0;
                        var hasDarkGreenBlue = counts.darkGreenBlue > 0;
                        var mixedColors = hasBlue && (hasGreenAny || hasYellow);
                        // Prag minim: albastrul trebuie să fie cel puțin 2% din celulele active
                        // ca să fie poligonizat singur. Sub acest prag, e prea rar/izolat.
                        var BLUE_MIN_FRACTION = 0.02;
                        var blueOfActive = totalActive > 0 ? counts.blue / totalActive : 0;
                        var blueSufficient = hasBlue && blueOfActive >= BLUE_MIN_FRACTION;

                        var targetTypes;
                        if (blueSufficient) {
                            // Albastru suficient → DOAR albastru (cel mai valoros)
                            targetTypes = [1];
                            console.log('[APM2.0] Mod: BLUE suficient (' + (blueOfActive*100).toFixed(1) + '% din activ) → DOAR BLUE');
                        } else if (hasBlue && hasDarkGreenBlue) {
                            // Albastru există dar e foarte rar → blue + verde ÎNCHIS SPRE ALBASTRU (tip 4)
                            // Nu poligonizăm tot verdele, doar verdele cu afinitate albastră (verde forest/teal)
                            targetTypes = [1, 4];
                            console.log('[APM2.0] Mod: BLUE rar (' + (blueOfActive*100).toFixed(1) + '% din activ) → BLUE + VERDE-ALBĂSTRUI (tip 4)');
                        } else if (hasBlue && hasGreenAny) {
                            // Albastru rar și nu există verde-albăstrui distinct → blue + tot verdele
                            targetTypes = [1, 4, 2];
                            console.log('[APM2.0] Mod: BLUE rar (' + (blueOfActive*100).toFixed(1) + '% din activ) → BLUE + GREEN (fără verde-albăstrui distinct)');
                        } else if (hasGreenAny) {
                            // Nu există albastru → încadrăm verde
                            targetTypes = [2, 4];
                            console.log('[APM2.0] Mod: DOAR GREEN (fără blue)');
                        } else {
                            // Fallback galben
                            targetTypes = [3];
                            console.log('[APM2.0] Mod: fallback YELLOW');
                        }

                        // Mască originală (nedilatată) — referință pentru split
                        var maskOriginal = new Uint8Array(totalCells);
                        for (var i = 0; i < totalCells; i++) {
                            maskOriginal[i] = targetTypes.indexOf(cellType[i]) >= 0 ? 1 : 0;
                        }

                        // ── Filtru densitate locală când zona e foarte densă ──
                        // Aplicăm doar când >55% activ: păstrăm celule cu ≥2 vecini în 3x3.
                        // Elimină pixeli izolați și păstrează clustere reale.
                        if (activeFraction > 0.55) {
                            var maskFiltered = new Uint8Array(totalCells);
                            for (var fy = 0; fy < rows; fy++) {
                                for (var fx = 0; fx < cols; fx++) {
                                    if (!maskOriginal[fy * cols + fx]) continue;
                                    var localCount = 0;
                                    for (var wy = -1; wy <= 1; wy++) {
                                        for (var wx = -1; wx <= 1; wx++) {
                                            var ny2 = fy + wy, nx2 = fx + wx;
                                            if (ny2 >= 0 && ny2 < rows && nx2 >= 0 && nx2 < cols) {
                                                if (maskOriginal[ny2 * cols + nx2]) localCount++;
                                            }
                                        }
                                    }
                                    if (localCount >= 2) maskFiltered[fy * cols + fx] = 1;
                                }
                            }
                            maskOriginal = maskFiltered;
                            var filteredCount = 0;
                            for (var fi2 = 0; fi2 < totalCells; fi2++) { if (maskOriginal[fi2]) filteredCount++; }
                            console.log('[APM2.0] Filtru 3x3: ' + filteredCount + ' celule rămase');
                        }

                        // ── Viewport clipping: zero-ificăm celulele din afara bounds-ului vizibil exact ──
                        // Tile-urile acoperă o zonă mai mare decât ecranul — eliminăm ce nu se vede.
                        (function () {
                            var vb = map.getBounds();
                            var vNorth = vb.getNorth(), vSouth = vb.getSouth();
                            var vWest  = vb.getWest(),  vEast  = vb.getEast();
                            for (var vy = 0; vy < rows; vy++) {
                                for (var vx = 0; vx < cols; vx++) {
                                    if (!maskOriginal[vy * cols + vx]) continue;
                                    // centrul celulei în lat/lng
                                    var cellGlobalTileX = tileXs[0] + (vx * GRID + GRID / 2) / TILE_SIZE;
                                    var cellGlobalTileY = tileYs[0] + (vy * GRID + GRID / 2) / TILE_SIZE;
                                    var cellLat = _tileY2lat(cellGlobalTileY, z);
                                    var cellLng = _tileX2lon(cellGlobalTileX, z);
                                    if (cellLat > vNorth || cellLat < vSouth ||
                                        cellLng < vWest  || cellLng > vEast) {
                                        maskOriginal[vy * cols + vx] = 0;
                                    }
                                }
                            }
                        })();

                        // Dilatare adaptivă:
                        // - Dacă suntem în mod "doar albastru" și există și verde/galben în imagine
                        //   (mixedColors), NU dilatăm deloc — vrem să izolăm strict patch-urile albastre
                        //   fără să le fuzionăm cu verdele/galbenul imediat vecin.
                        // - Altfel, dilatăm 1 celulă (3x3) pentru a uni patch-uri apropiate.
                        // Dezactivăm dilatarea când selectăm DOAR albastru în prezența altor culori
                        // (altfel dilatarea fuzionează patch-urile albastre cu verdele vecin)
                        var _mixedBlueOnly = (targetTypes.length === 1 && targetTypes[0] === 1 && (hasGreen || hasYellow));
                        var maskGrid = new Uint8Array(totalCells);
                        if (_mixedBlueOnly) {
                            // Fără dilatare — copiem masca originală direct
                            for (var di2 = 0; di2 < totalCells; di2++) maskGrid[di2] = maskOriginal[di2];
                            console.log('[APM2.0] Dilatare DEZACTIVATĂ (mod blue-only cu mix de culori)');
                        } else {
                            for (var dy = 0; dy < rows; dy++) {
                                for (var dx = 0; dx < cols; dx++) {
                                    if (maskOriginal[dy * cols + dx]) { maskGrid[dy * cols + dx] = 1; continue; }
                                    var found = false;
                                    outerD: for (var ky = -1; ky <= 1 && !found; ky++) {
                                        for (var kx = -1; kx <= 1 && !found; kx++) {
                                            var nx2 = dx + kx, ny2 = dy + ky;
                                            if (nx2 >= 0 && ny2 >= 0 && nx2 < cols && ny2 < rows && maskOriginal[ny2 * cols + nx2]) found = true;
                                        }
                                    }
                                    maskGrid[dy * cols + dx] = found ? 1 : 0;
                                }
                            }
                        }

                        var components = _connectedComponents(maskGrid, cols, rows);

                        // Clustere prea mari (fuzionate prin dilatare) → re-analizate pe masca originală
                        var finalComponents = [];
                        components.forEach(function(comp) {
                            if (comp.length < MIN_CLUSTER_CELLS) return;
                            if (comp.length > SPLIT_CLUSTER_CELLS) {
                                // Cluster mare, probabil fuzionat prin dilatare — îl re-analizăm pe masca
                                // originală (nedilatată) ca să recuperăm sub-zonele reale, în loc să-l aruncăm direct.
                                var subMask = new Uint8Array(totalCells);
                                comp.forEach(function(idx) { if (maskOriginal[idx]) subMask[idx] = 1; });
                                var subComps = _connectedComponents(subMask, cols, rows);

                                var produced = 0, dropped = 0, forcedCount = 0;
                                subComps.forEach(function(sc) {
                                    if (sc.length < MIN_CLUSTER_CELLS) { dropped++; return; }
                                    if (sc.length <= MAX_CLUSTER_CELLS) {
                                        finalComponents.push(sc);
                                        produced++;
                                        return;
                                    }
                                    // Sub-componenta e TOT prea mare — înseamnă că pata e foarte
                                    // densă și uniformă (fără diferență de nuanță suficientă ca să
                                    // se separe natural, ex. zone masive de albastru/verde).
                                    // În loc să o aruncăm, o împărțim forțat pe poziție geometrică
                                    // (bisecție recursivă) în bucăți mai mici, valide ca poligoane.
                                    forcedCount++;
                                    var pieces = _splitComponentByGeometry(sc, cols, MAX_CLUSTER_CELLS);
                                    pieces.forEach(function(piece) {
                                        if (piece.length >= MIN_CLUSTER_CELLS) {
                                            finalComponents.push(piece);
                                            produced++;
                                        } else {
                                            dropped++;
                                        }
                                    });
                                });
                                console.log('[APM2.0] Cluster mare (' + comp.length + ') → ' + produced + ' sub-clustere finale' +
                                    (forcedCount > 0 ? ' (' + forcedCount + ' pete uniforme împărțite forțat geometric)' : '') +
                                    (dropped > 0 ? ' (' + dropped + ' eliminate: prea mici)' : ''));
                            } else {
                                finalComponents.push(comp);
                            }
                        });

                        console.log('[APM2.0] Componente finale:', finalComponents.length, '(din', components.length, 'totale)');
                        var bigComponents = finalComponents;

                        if (bigComponents.length === 0) { _finish(false, T); return; }

                        function _pixelToLatLng(px, py) {
                            var globalTileX = tileXs[0] + px / TILE_SIZE;
                            var globalTileY = tileYs[0] + py / TILE_SIZE;
                            return L.latLng(_tileY2lat(globalTileY, z), _tileX2lon(globalTileX, z));
                        }

                        // ── Heritage exclusion helpers ──────────────────────────────────────────

                        // Fetch Heritage site circles direct din API pentru viewport curent
                        function _fetchHeritageSiteCirclesForBounds(fetchBounds) {
                            return new Promise(function (resolve) {
                                var REST_BASE = 'https://eism.geo-spatial.ro/eismgeo/rest/services/Patrimoniu/PatrimoniuWM/MapServer';
                                var LAYERS = [0, 5, 6];
                                var circles = [];
                                var pending = LAYERS.length;

                                function done() {
                                    pending--;
                                    if (pending === 0) resolve(circles);
                                }

                                LAYERS.forEach(function (lid) {
                                    var sw = L.CRS.EPSG3857.project(fetchBounds.getSouthWest());
                                    var ne = L.CRS.EPSG3857.project(fetchBounds.getNorthEast());
                                    var url = REST_BASE + '/' + lid + '/query'
                                        + '?where=1%3D1'
                                        + '&geometry=' + encodeURIComponent(sw.x + ',' + sw.y + ',' + ne.x + ',' + ne.y)
                                        + '&geometryType=esriGeometryEnvelope'
                                        + '&inSR=102100&spatialRel=esriSpatialRelIntersects'
                                        + '&outFields=OBJECTID&returnGeometry=true&outSR=4326'
                                        + '&resultRecordCount=2000&f=json';

                                    var timedOut = false;
                                    var timer = setTimeout(function () {
                                        timedOut = true;
                                        console.warn('[APM2.0 Heritage] timeout layer', lid);
                                        done();
                                    }, 5000);

                                    jsonpFetch(url, function (data) {
                                        if (timedOut) return;
                                        clearTimeout(timer);
                                        if (data && data.features) {
                                            data.features.forEach(function (f) {
                                                var g = f.geometry, gt = data.geometryType;
                                                if (!g) return;
                                                if (gt === 'esriGeometryPoint' && !isNaN(g.x) && !isNaN(g.y)) {
                                                    circles.push({ latlng: L.latLng(g.y, g.x), radiusM: 600 });
                                                } else if (gt === 'esriGeometryPolygon' && g.rings) {
                                                    g.rings.forEach(function (ring) {
                                                        ring.forEach(function (pt) {
                                                            circles.push({ latlng: L.latLng(pt[1], pt[0]), radiusM: 600 });
                                                        });
                                                    });
                                                } else if (gt === 'esriGeometryPolyline' && g.paths) {
                                                    g.paths.forEach(function (path) {
                                                        path.forEach(function (pt) {
                                                            circles.push({ latlng: L.latLng(pt[1], pt[0]), radiusM: 600 });
                                                        });
                                                    });
                                                }
                                            });
                                        }
                                        done();
                                    });
                                });
                            });
                        }

                        // Construiește o mască booleană: pentru fiecare celulă din grilă,
                        // marchează true dacă centrul ei se află în orice radius Heritage (600m).
                        // Lucrăm direct în spațiul pixel/grid — fără geometrie vectorială.
                        function _buildHeritageMask(hCircles, cols, rows, pixelToLatLng) {
                            var mask = new Uint8Array(cols * rows);
                            if (!hCircles.length) return mask;

                            // Convertim fiecare sit Heritage în coordonate pixel ale canvas-ului compozit.
                            // map.project() → coordonate globale tile la zoom z → scădem originea canvas-ului.
                            var originPt = map.project(
                                L.latLng(_tileY2lat(tileYs[0], z), _tileX2lon(tileXs[0], z)), z
                            );
                            // Deduplicăm siturile prea apropiate (< 50px) pentru a reduce iterațiile
                            var hPx = [];
                            var seen = {};
                            hCircles.forEach(function (hc) {
                                var pt = map.project(hc.latlng, z);
                                var cx = pt.x - originPt.x;
                                var cy = pt.y - originPt.y;
                                // Raza în pixeli: 600m → pixeli la zoom z
                                var latRad = hc.latlng.lat * Math.PI / 180;
                                var mPerPx = (156543.03392 * Math.cos(latRad)) / Math.pow(2, z);
                                var rPx = hc.radiusM / mPerPx;
                                // dedup key la 30px grid
                                var dk = Math.round(cx / 30) + ',' + Math.round(cy / 30);
                                if (seen[dk]) return;
                                seen[dk] = true;
                                hPx.push({ cx: cx, cy: cy, rPxSq: rPx * rPx });
                            });

                            // Comparăm fiecare celulă cu fiecare sit în spațiu pixel — fără trig
                            for (var gy = 0; gy < rows; gy++) {
                                var cpy = gy * GRID + GRID / 2;
                                for (var gx = 0; gx < cols; gx++) {
                                    var cpx = gx * GRID + GRID / 2;
                                    for (var ci = 0; ci < hPx.length; ci++) {
                                        var h = hPx[ci];
                                        var dx = cpx - h.cx, dy = cpy - h.cy;
                                        if (dx * dx + dy * dy < h.rPxSq) {
                                            mask[gy * cols + gx] = 1;
                                            break;
                                        }
                                    }
                                }
                            }
                            return mask;
                        }

                        // Un cluster conflictează cu Heritage dacă ORICE celulă a sa
                        // se află în masca Heritage.
                        function _clusterConflictsHeritage(cells, hMask) {
                            for (var i = 0; i < cells.length; i++) {
                                if (hMask[cells[i]]) return true;
                            }
                            return false;
                        }
                        // ────────────────────────────────────────────────────────────────────────

                        // Fetch Heritage sites direct din API, viewport extins 15%
                        var _hBounds = map.getBounds().pad(0.15);
                        _fetchHeritageSiteCirclesForBounds(_hBounds).then(function (heritageSiteCircles) {
                            console.log('[APM2.0] Heritage exclusion: found', heritageSiteCircles.length, 'site circles from API');

                            // Construim masca Heritage pe aceeași grilă ca analiza APM
                            // Fiecare celulă din grilă e marcată dacă centrul ei e în vreun radius de 600m
                            var hMask = _buildHeritageMask(heritageSiteCircles, cols, rows, _pixelToLatLng);
                            var maskedCells = 0;
                            for (var mi = 0; mi < hMask.length; mi++) { if (hMask[mi]) maskedCells++; }
                            console.log('[APM2.0] Celule Heritage excluse din grilă:', maskedCells, '/', hMask.length);

                            _resultLayerGroup = L.layerGroup();
                            var skippedByHeritage = 0;
                            var clippedByHeritage = 0;

                            function _drawCluster(cells) {
                                var hull = _hullFromCells(cells, cols, GRID);
                                if (hull.length < 3) return;
                                var latlngs = hull.map(function (p) { return _pixelToLatLng(p[0], p[1]); });
                                var poly = L.polygon(latlngs, {
                                    color: '#a020f0',
                                    weight: 2.5,
                                    fillColor: '#a020f0',
                                    fillOpacity: 0.12,
                                    opacity: 0.85,
                                    pane: 'pane_apm20_search_help'
                                });
                                _resultLayerGroup.addLayer(poly);
                            }

                            bigComponents.forEach(function (cells) {
                                if (!_clusterConflictsHeritage(cells, hMask)) {
                                    // Fără conflict Heritage — desenăm direct
                                    _drawCluster(cells);
                                    return;
                                }

                                // ── Decupăm celulele Heritage din cluster și redesenăm ce rămâne ──
                                var clipped = cells.filter(function(idx) { return !hMask[idx]; });
                                console.log('[APM2.0] Cluster tăiat Heritage: ' + cells.length + ' → ' + clipped.length + ' celule rămase');

                                if (clipped.length < MIN_CLUSTER_CELLS) {
                                    skippedByHeritage++;
                                    return;
                                }
                                clippedByHeritage++;

                                // Re-run connected components pe celulele rămase (tăierea Heritage
                                // poate rupe un cluster mare în mai multe bucăți disjuncte)
                                var subMaskClip = new Uint8Array(cols * rows);
                                clipped.forEach(function(idx) { subMaskClip[idx] = 1; });
                                var subComps = _connectedComponents(subMaskClip, cols, rows);

                                subComps.forEach(function(sc) {
                                    if (sc.length < MIN_CLUSTER_CELLS) return;
                                    if (sc.length <= MAX_CLUSTER_CELLS) {
                                        _drawCluster(sc);
                                    } else {
                                        var pieces = _splitComponentByGeometry(sc, cols, MAX_CLUSTER_CELLS);
                                        pieces.forEach(function(piece) {
                                            if (piece.length >= MIN_CLUSTER_CELLS) _drawCluster(piece);
                                        });
                                    }
                                });
                            });
                            console.log('[APM2.0] Clustere excluse complet (Heritage):', skippedByHeritage, '| tăiate parțial:', clippedByHeritage);
                            var addedPolys = _resultLayerGroup.getLayers().length;
                            _resultLayerGroup.addTo(map);

                            _finish(addedPolys > 0, T);
                        });
                    }).catch(function (e) {
                        console.warn('APM 2.0 Search Help error:', e);
                        _finish(false, T, true);
                    });

                    function _finish(found, T, errored) {
                        _running = false;
                        _setButtonState(false, T);
                        if (errored) {
                            _showToast(T['apm20_search_help_error'] || 'Could not analyze the visible area, please try again', 4000);
                        } else if (!found) {
                            _showToast(T['apm20_search_help_empty'] || 'No clear high-potential zones found in the visible area', 3500);
                        }
                    }
                };
            })();

            (function () {
                map.createPane('pane_firingplans');
                map.getPane('pane_firingplans').style.zIndex = 641;
                map.getPane('pane_firingplans').style.pointerEvents = 'none';

                window._firingPlansLayer = L.tileLayer.wms(
                    'https://services.geo-spatial.org/geoserver/eharta/wms',
                    {
                        layers: 'eharta:mozaic_planuri_tragere_20k',
                        format: 'image/png',
                        transparent: true,
                        version: '1.1.0',
                        opacity: 0.80,
                        pane: 'pane_firingplans',
                        attribution: '© geo-spatial.org / Planuri de Tragere'
                    }
                );

                window.toggleFiringPlans = function (on) {
                    var histToggle = document.getElementById('histToggle');
                    var histOn = histToggle && histToggle.checked;
                    if (on && !histOn) {
                        if (histToggle) histToggle.checked = true;
                        window.toggleHistLayer(true);
                        histOn = true;
                    }
                    if (on && histOn) {
                        window._firingPlansLayer.addTo(map);
                    } else {
                        map.hasLayer(window._firingPlansLayer) && map.removeLayer(window._firingPlansLayer);
                    }
                };

                window.setFiringPlansOpacity = function (val) {
                    document.getElementById('firingPlansPct').textContent = val + '%';
                    window._firingPlansLayer.setOpacity(val / 100);
                };
            })();

            // ── SOVIET MAP 1970s WMS LAYER ──
            (function () {
                map.createPane('pane_sovietmap');
                map.getPane('pane_sovietmap').style.zIndex = 642;
                map.getPane('pane_sovietmap').style.pointerEvents = 'none';

                window._sovietMapLayer = L.tileLayer.wms(
                    'https://services.geo-spatial.org/geoserver/eharta/wms',
                    {
                        layers: 'eharta:mozaic_soviet100k',
                        format: 'image/png',
                        transparent: true,
                        version: '1.1.0',
                        opacity: 0.80,
                        pane: 'pane_sovietmap',
                        attribution: '© geo-spatial.org / Harta Sovietică 1970'
                    }
                );

                window.toggleSovietMap = function (on) {
                    var histToggle = document.getElementById('histToggle');
                    var histOn = histToggle && histToggle.checked;
                    if (on && !histOn) {
                        if (histToggle) histToggle.checked = true;
                        window.toggleHistLayer(true);
                        histOn = true;
                    }
                    if (on && histOn) {
                        window._sovietMapLayer.addTo(map);
                    } else {
                        map.hasLayer(window._sovietMapLayer) && map.removeLayer(window._sovietMapLayer);
                    }
                };

                window.setSovietMapOpacity = function (val) {
                    document.getElementById('sovietMapPct').textContent = val + '%';
                    window._sovietMapLayer.setOpacity(val / 100);
                };
            })();

            // ── PREMIUM HISTORICAL MAPS COVERAGE POLYGONS ──
            // Create a shared pane for all coverage polygons
            map.createPane('pane_hist_coverage');
            map.getPane('pane_hist_coverage').style.zIndex = 615;
            map.getPane('pane_hist_coverage').style.pointerEvents = 'none';

            // Rough geographic bounds for each premium historical map
            var premiumMapCoverageBounds = {
                josephine: {
                    bounds: [[44.963611, 21.972695], [47.873181, 26.719332]],
                    label: 'Josephine Map +',
                    layerVar: '_jLayer'
                },
                bucovina: {
                    bounds: [[47.514971, 21.796526], [48.457705, 26.723135]],
                    label: 'Bucovina 1861-1864',
                    layerVar: '_bucovinaMapLayer'
                },
                austrohu: {
                    bounds: [[47.5469, 21.6211], [48.3124, 26.8506]],
                    label: 'Austro-Hungarian 1861-1864',
                    layerVar: '_austrohuMapLayer'
                },

                moldova1868: {
                    bounds: [[44.9959, 26.2354], [48.3124, 29.8389]],
                    label: 'Moldova 1868',
                    layerVar: '_moldova1868MapLayer'
                },

                moldovawwii: {
                    bounds: [[44.7467, 26.4990], [48.3124, 29.8389]],
                    label: 'Moldova WWII',
                    layerVar: '_moldovaWwiiMapLayer'
                },

                polishtactical1933: {
                    bounds: [[47.6950, 22.0166], [48.3124, 28.3887]],
                    label: 'Polish Tactical 1933',
                    layerVar: '_polishTactical1933MapLayer'
                },

                ww1: {
                    bounds: [[43.3252, 22.3242], [48.3416, 29.8828]],
                    label: 'WWI',
                    layerVar: '_ww1MapLayer'
                },

                ww2: {
                    bounds: [[43.8345, 20.0391], [48.4584, 29.8828]],
                    label: 'WWII',
                    layerVar: '_ww2MapLayer'
                },

                satellite60s: {
                    // CORONA imagery covers all of Romania via multiple satellite
                    // passes dynamically discovered from the CAST GeoServer. The
                    // bounds span the full extent of Romania.
                    bounds: [[43.5, 19.5], [48.5, 30.5]],
                    label: "Satellite imagery 60's",
                    layerVar: '_sat60MapLayer'
                },

                banat: {
                    // Banat 1769-1772 (Habsburg Banat maps, raster XYZ tiles on Supabase).
                    // Rough bounds covering the Banat region in western Romania.
                    bounds: [[44.55, 20.85], [46.35, 22.45]],
                    label: 'Banat 1769-1772',
                    layerVar: '_banatMapLayer'
                }
            };

            // Create coverage polygons for each premium map
            var premiumMapCoveragePolygons = {};
            Object.keys(premiumMapCoverageBounds).forEach(function(mapKey) {
                var data = premiumMapCoverageBounds[mapKey];
                premiumMapCoveragePolygons[mapKey] = L.rectangle(data.bounds, {
                    color: '#FF2800',
                    weight: 2,
                    opacity: 0.5,
                    fill: true,
                    fillColor: '#FF2800',
                    fillOpacity: 0.1,
                    dashArray: '5, 5',
                    pane: 'pane_hist_coverage',
                    className: 'premium-map-coverage'
                }).bindPopup(data.label + ' (Premium)');
            });

            // Function to update coverage polygon visibility based on zoom
            window.updatePremiumMapCoverageVisibility = function() {
                var currentZoom = map.getZoom();
                Object.keys(premiumMapCoveragePolygons).forEach(function(mapKey) {
                    var polygon = premiumMapCoveragePolygons[mapKey];
                    var layerVar = premiumMapCoverageBounds[mapKey].layerVar;
                    var sourceLayer = window[layerVar];
                    // Only show for maps whose sublayer is actually turned on,
                    // and only until zoom level 8 (minZoom, where real tiles take over)
                    var shouldShow = currentZoom < 8 && !!sourceLayer && map.hasLayer(sourceLayer);
                    if (shouldShow) {
                        if (!map.hasLayer(polygon)) {
                            polygon.addTo(map);
                        }
                    } else {
                        if (map.hasLayer(polygon)) {
                            map.removeLayer(polygon);
                        }
                    }
                });
            };

            // Listen for zoom changes
            map.on('zoomend', window.updatePremiumMapCoverageVisibility);
            window.updatePremiumMapCoverageVisibility();

            // ── BUCOVINA 1861-1864 (XYZ tiles, JPG, direct din Cloudflare R2) ──
            // Strat premium nou. Spre deosebire de Austrian/Soviet (WMS, geo-spatial.org),
            // sursa e raster XYZ pe R2, la fel ca Josephine Map + — vezi acolo (var _jLayer
            // mai sus în fișier) pentru pattern-ul original.
            (function () {
                map.createPane('pane_bucovina');
                map.getPane('pane_bucovina').style.zIndex = 641;
                map.getPane('pane_bucovina').style.pointerEvents = 'none';

                // Reglabil live din consolă, fără redeploy: window.BUCOVINA_TILE_MAX_NATIVE_Z.
                // Nivelul nativ real nu a fost încă verificat empiric (vezi lecția de azi cu
                // UAT_TILE_Z: presupunerile despre nivelul nativ pot fi greșite) — dacă tile-
                // urile lipsesc la un anumit zoom, testați alte valori aici înainte de a
                // presupune că sursa nu are acoperire acolo.
                window.BUCOVINA_TILE_MAX_NATIVE_Z = (window.BUCOVINA_TILE_MAX_NATIVE_Z !== undefined) ? window.BUCOVINA_TILE_MAX_NATIVE_Z : 15;

                window._bucovinaMapLayer = L.tileLayer(
                    'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Galitzien_and_Bukovina-1861-1864/Galitzien_and_Bukovina-1861-1864/{z}/{x}/{y}.jpg',
                    {
                        minZoom: 8,
                        maxZoom: 20,
                        maxNativeZoom: window.BUCOVINA_TILE_MAX_NATIVE_Z,
                        tileSize: 256,
                        opacity: 0.80,
                        pane: 'pane_bucovina',
                        attribution: '© Bucovina 1861-1864'
                    }
                );

                window.toggleBucovinaMap = function (on) {
                    if (on) {
                        var histPremToggle = document.getElementById('histPremiumToggle');
                        if (histPremToggle && !histPremToggle.checked) {
                            histPremToggle.checked = true;
                            window.toggleHistPremiumLayer(true);
                        }
                        window._bucovinaMapLayer.addTo(map);
                    } else {
                        map.hasLayer(window._bucovinaMapLayer) && map.removeLayer(window._bucovinaMapLayer);
                    }
                    window.updatePremiumMapCoverageVisibility && window.updatePremiumMapCoverageVisibility();
                };

                window.setBucovinaMapOpacity = function (val) {
                    document.getElementById('bucovinaMapPct').textContent = val + '%';
                    window._bucovinaMapLayer.setOpacity(val / 100);
                };
            })();

            // ── HARTA AUSTRO-UNGARĂ 1861-1864 (XYZ tiles, JPG, direct din Cloudflare R2) ──
            // Strat premium nou. Același pattern ca Bucovina 1861-1864 (mai sus),
            // dar sursa e subfolderul 1869-1912 din același bucket R2.
            (function () {
                map.createPane('pane_austrohu');
                map.getPane('pane_austrohu').style.zIndex = 642;
                map.getPane('pane_austrohu').style.pointerEvents = 'none';

                // Reglabil live din consolă, fără redeploy: window.AUSTROHU_TILE_MAX_NATIVE_Z.
                // Confirmat empiric: tile-uri există cel puțin până la z13 (ex. 13/4592/2840.jpg).
                // Dacă apar și la zoom mai mare, crește valoarea aici.
                window.AUSTROHU_TILE_MAX_NATIVE_Z = (window.AUSTROHU_TILE_MAX_NATIVE_Z !== undefined) ? window.AUSTROHU_TILE_MAX_NATIVE_Z : 13;

                window._austrohuMapLayer = L.tileLayer(
                    'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Galitzien_and_Bukovina-1861-1864/1869-1912/{z}/{x}/{y}.jpg',
                    {
                        minZoom: 8,
                        maxZoom: 20,
                        maxNativeZoom: window.AUSTROHU_TILE_MAX_NATIVE_Z,
                        tileSize: 256,
                        opacity: 0.80,
                        pane: 'pane_austrohu',
                        attribution: '© Austro-Hungarian Map 1861-1864'
                    }
                );

                window.toggleAustrohuMap = function (on) {
                    if (on) {
                        var histPremToggle = document.getElementById('histPremiumToggle');
                        if (histPremToggle && !histPremToggle.checked) {
                            histPremToggle.checked = true;
                            window.toggleHistPremiumLayer(true);
                        }
                        window._austrohuMapLayer.addTo(map);
                    } else {
                        map.hasLayer(window._austrohuMapLayer) && map.removeLayer(window._austrohuMapLayer);
                    }
                    window.updatePremiumMapCoverageVisibility && window.updatePremiumMapCoverageVisibility();
                };

                window.setAustrohuMapOpacity = function (val) {
                    document.getElementById('austrohuMapPct').textContent = val + '%';
                    window._austrohuMapLayer.setOpacity(val / 100);
                };
            })();

            // ── MOLDOVA 1868 (XYZ tiles, JPG, direct din Cloudflare R2) ──
            // Strat premium nou. Același pattern ca Bucovina 1861-1864 / Harta Austro-Ungară
            // de mai sus, subfolderul fiind moldova-1868 din același bucket R2.
            (function () {
                map.createPane('pane_moldova1868');
                map.getPane('pane_moldova1868').style.zIndex = 643;
                map.getPane('pane_moldova1868').style.pointerEvents = 'none';

                // Reglabil live din consolă, fără redeploy: window.MOLDOVA1868_TILE_MAX_NATIVE_Z.
                // Confirmat empiric: tile-uri există cel puțin până la z13 (ex. 13/4694/2838.jpg).
                // Dacă apar și la zoom mai mare, crește valoarea aici.
                window.MOLDOVA1868_TILE_MAX_NATIVE_Z = (window.MOLDOVA1868_TILE_MAX_NATIVE_Z !== undefined) ? window.MOLDOVA1868_TILE_MAX_NATIVE_Z : 13;

                window._moldova1868MapLayer = L.tileLayer(
                    'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Galitzien_and_Bukovina-1861-1864/moldova-1868/{z}/{x}/{y}.jpg',
                    {
                        minZoom: 8,
                        maxZoom: 20,
                        maxNativeZoom: window.MOLDOVA1868_TILE_MAX_NATIVE_Z,
                        tileSize: 256,
                        opacity: 0.80,
                        pane: 'pane_moldova1868',
                        attribution: '© Moldova 1868'
                    }
                );

                window.toggleMoldova1868Map = function (on) {
                    if (on) {
                        var histPremToggle = document.getElementById('histPremiumToggle');
                        if (histPremToggle && !histPremToggle.checked) {
                            histPremToggle.checked = true;
                            window.toggleHistPremiumLayer(true);
                        }
                        window._moldova1868MapLayer.addTo(map);
                    } else {
                        map.hasLayer(window._moldova1868MapLayer) && map.removeLayer(window._moldova1868MapLayer);
                    }
                    window.updatePremiumMapCoverageVisibility && window.updatePremiumMapCoverageVisibility();
                };

                window.setMoldova1868MapOpacity = function (val) {
                    document.getElementById('moldova1868MapPct').textContent = val + '%';
                    window._moldova1868MapLayer.setOpacity(val / 100);
                };
            })();

            // ── MOLDOVA WWII (XYZ tiles, JPG, direct din Cloudflare R2) ──
            // Strat premium nou. Același pattern ca celelalte hărți istorice de mai sus,
            // subfolderul fiind moldova-wwii din același bucket R2.
            (function () {
                map.createPane('pane_moldovawwii');
                map.getPane('pane_moldovawwii').style.zIndex = 644;
                map.getPane('pane_moldovawwii').style.pointerEvents = 'none';

                // Reglabil live din consolă, fără redeploy: window.MOLDOVAWWII_TILE_MAX_NATIVE_Z.
                // Confirmat empiric: tile-uri există cel puțin până la z13 (ex. 13/4702/2848.jpg).
                // Dacă apar și la zoom mai mare, crește valoarea aici.
                window.MOLDOVAWWII_TILE_MAX_NATIVE_Z = (window.MOLDOVAWWII_TILE_MAX_NATIVE_Z !== undefined) ? window.MOLDOVAWWII_TILE_MAX_NATIVE_Z : 13;

                window._moldovaWwiiMapLayer = L.tileLayer(
                    'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Galitzien_and_Bukovina-1861-1864/moldova-wwii/{z}/{x}/{y}.jpg',
                    {
                        minZoom: 8,
                        maxZoom: 20,
                        maxNativeZoom: window.MOLDOVAWWII_TILE_MAX_NATIVE_Z,
                        tileSize: 256,
                        opacity: 0.80,
                        pane: 'pane_moldovawwii',
                        attribution: '© Moldova WWII'
                    }
                );

                window.toggleMoldovaWwiiMap = function (on) {
                    if (on) {
                        var histPremToggle = document.getElementById('histPremiumToggle');
                        if (histPremToggle && !histPremToggle.checked) {
                            histPremToggle.checked = true;
                            window.toggleHistPremiumLayer(true);
                        }
                        window._moldovaWwiiMapLayer.addTo(map);
                    } else {
                        map.hasLayer(window._moldovaWwiiMapLayer) && map.removeLayer(window._moldovaWwiiMapLayer);
                    }
                    window.updatePremiumMapCoverageVisibility && window.updatePremiumMapCoverageVisibility();
                };

                window.setMoldovaWwiiMapOpacity = function (val) {
                    document.getElementById('moldovaWwiiMapPct').textContent = val + '%';
                    window._moldovaWwiiMapLayer.setOpacity(val / 100);
                };
            })();

            // ── HARTA TACTICĂ POLONEZĂ 1933 (XYZ tiles, JPG, direct din Cloudflare R2) ──
            // Strat premium nou. Același pattern ca celelalte hărți istorice de mai sus,
            // subfolderul fiind ukraine_zapad_pl-1933 din același bucket R2.
            (function () {
                map.createPane('pane_polishtactical1933');
                map.getPane('pane_polishtactical1933').style.zIndex = 645;
                map.getPane('pane_polishtactical1933').style.pointerEvents = 'none';

                // Reglabil live din consolă, fără redeploy: window.POLISHTACTICAL1933_TILE_MAX_NATIVE_Z.
                // Confirmat empiric: tile-uri există cel puțin până la z13 (ex. 13/4600/2840.jpg).
                // Dacă apar și la zoom mai mare, crește valoarea aici.
                window.POLISHTACTICAL1933_TILE_MAX_NATIVE_Z = (window.POLISHTACTICAL1933_TILE_MAX_NATIVE_Z !== undefined) ? window.POLISHTACTICAL1933_TILE_MAX_NATIVE_Z : 13;

                window._polishTactical1933MapLayer = L.tileLayer(
                    'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Galitzien_and_Bukovina-1861-1864/ukraine_zapad_pl-1933/{z}/{x}/{y}.jpg',
                    {
                        minZoom: 8,
                        maxZoom: 20,
                        maxNativeZoom: window.POLISHTACTICAL1933_TILE_MAX_NATIVE_Z,
                        tileSize: 256,
                        opacity: 0.80,
                        pane: 'pane_polishtactical1933',
                        attribution: '© Tactical Polish Map 1933'
                    }
                );

                window.togglePolishTactical1933Map = function (on) {
                    if (on) {
                        var histPremToggle = document.getElementById('histPremiumToggle');
                        if (histPremToggle && !histPremToggle.checked) {
                            histPremToggle.checked = true;
                            window.toggleHistPremiumLayer(true);
                        }
                        window._polishTactical1933MapLayer.addTo(map);
                    } else {
                        map.hasLayer(window._polishTactical1933MapLayer) && map.removeLayer(window._polishTactical1933MapLayer);
                    }
                    window.updatePremiumMapCoverageVisibility && window.updatePremiumMapCoverageVisibility();
                };

                window.setPolishTactical1933MapOpacity = function (val) {
                    document.getElementById('polishTactical1933MapPct').textContent = val + '%';
                    window._polishTactical1933MapLayer.setOpacity(val / 100);
                };
            })();

            // ── WWI (XYZ tiles, JPG, direct din Cloudflare R2) ──
            // Strat premium nou. Același pattern ca celelalte hărți istorice de mai sus,
            // subfolderul fiind ww1 din același bucket R2.
            (function () {
                map.createPane('pane_ww1');
                map.getPane('pane_ww1').style.zIndex = 646;
                map.getPane('pane_ww1').style.pointerEvents = 'none';

                // Reglabil live din consolă, fără redeploy: window.WW1_TILE_MAX_NATIVE_Z.
                // Confirmat empiric: tile-uri există cel puțin până la z11 (ex. 11/1154/712.jpg).
                // Dacă apar și la zoom mai mare, crește valoarea aici.
                window.WW1_TILE_MAX_NATIVE_Z = (window.WW1_TILE_MAX_NATIVE_Z !== undefined) ? window.WW1_TILE_MAX_NATIVE_Z : 11;

                window._ww1MapLayer = L.tileLayer(
                    'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Galitzien_and_Bukovina-1861-1864/ww1/{z}/{x}/{y}.jpg',
                    {
                        minZoom: 8,
                        maxZoom: 20,
                        maxNativeZoom: window.WW1_TILE_MAX_NATIVE_Z,
                        tileSize: 256,
                        opacity: 0.80,
                        pane: 'pane_ww1',
                        attribution: '© WWI'
                    }
                );

                window.toggleWw1Map = function (on) {
                    if (on) {
                        var histPremToggle = document.getElementById('histPremiumToggle');
                        if (histPremToggle && !histPremToggle.checked) {
                            histPremToggle.checked = true;
                            window.toggleHistPremiumLayer(true);
                        }
                        window._ww1MapLayer.addTo(map);
                    } else {
                        map.hasLayer(window._ww1MapLayer) && map.removeLayer(window._ww1MapLayer);
                    }
                    window.updatePremiumMapCoverageVisibility && window.updatePremiumMapCoverageVisibility();
                };

                window.setWw1MapOpacity = function (val) {
                    document.getElementById('ww1MapPct').textContent = val + '%';
                    window._ww1MapLayer.setOpacity(val / 100);
                };
            })();

            // ── WWII (XYZ tiles, JPG, direct din Cloudflare R2) ──
            // Strat premium nou. Același pattern ca celelalte hărți istorice de mai sus,
            // subfolderul fiind ww2 din același bucket R2.
            (function () {
                map.createPane('pane_ww2');
                map.getPane('pane_ww2').style.zIndex = 647;
                map.getPane('pane_ww2').style.pointerEvents = 'none';

                // Reglabil live din consolă, fără redeploy: window.WW2_TILE_MAX_NATIVE_Z.
                // Confirmat empiric: tile-uri există cel puțin până la z10 (ex. 10/572/356.jpg).
                // Dacă apar și la zoom mai mare, crește valoarea aici.
                window.WW2_TILE_MAX_NATIVE_Z = (window.WW2_TILE_MAX_NATIVE_Z !== undefined) ? window.WW2_TILE_MAX_NATIVE_Z : 10;

                window._ww2MapLayer = L.tileLayer(
                    'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Galitzien_and_Bukovina-1861-1864/ww2/{z}/{x}/{y}.jpg',
                    {
                        minZoom: 8,
                        maxZoom: 20,
                        maxNativeZoom: window.WW2_TILE_MAX_NATIVE_Z,
                        tileSize: 256,
                        opacity: 0.80,
                        pane: 'pane_ww2',
                        attribution: '© WWII'
                    }
                );

                window.toggleWw2Map = function (on) {
                    if (on) {
                        var histPremToggle = document.getElementById('histPremiumToggle');
                        if (histPremToggle && !histPremToggle.checked) {
                            histPremToggle.checked = true;
                            window.toggleHistPremiumLayer(true);
                        }
                        window._ww2MapLayer.addTo(map);
                    } else {
                        map.hasLayer(window._ww2MapLayer) && map.removeLayer(window._ww2MapLayer);
                    }
                    window.updatePremiumMapCoverageVisibility && window.updatePremiumMapCoverageVisibility();
                };

                window.setWw2MapOpacity = function (val) {
                    document.getElementById('ww2MapPct').textContent = val + '%';
                    window._ww2MapLayer.setOpacity(val / 100);
                };
            })();

            // ── BANAT 1769-1772 (XYZ tiles, PNG, direct din Supabase storage) ──
            // Strat premium nou. Același pattern ca celelalte hărți istorice de mai sus,
            // dar sursa e bucket-ul Supabase (Harti/Banat), nu Cloudflare R2.
            // Zoom-urile native sunt 11-15.
            (function () {
                map.createPane('pane_banat');
                map.getPane('pane_banat').style.zIndex = 649;
                map.getPane('pane_banat').style.pointerEvents = 'none';

                // Reglabil live din consolă, fără redeploy: window.BANAT_TILE_MAX_NATIVE_Z.
                // Zoom-urile disponibile sunt 11-15.
                window.BANAT_TILE_MAX_NATIVE_Z = (window.BANAT_TILE_MAX_NATIVE_Z !== undefined) ? window.BANAT_TILE_MAX_NATIVE_Z : 15;

                window._banatMapLayer = L.tileLayer(
                    'https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/Banat/{z}/{x}/{y}.png',
                    {
                        minZoom: 11,
                        maxZoom: 20,
                        maxNativeZoom: window.BANAT_TILE_MAX_NATIVE_Z,
                        tileSize: 256,
                        opacity: 0.80,
                        pane: 'pane_banat',
                        attribution: '© Banat 1769-1772'
                    }
                );

                window.toggleBanatMap = function (on) {
                    if (on) {
                        var histPremToggle = document.getElementById('histPremiumToggle');
                        if (histPremToggle && !histPremToggle.checked) {
                            histPremToggle.checked = true;
                            window.toggleHistPremiumLayer(true);
                        }
                        window._banatMapLayer.addTo(map);
                    } else {
                        map.hasLayer(window._banatMapLayer) && map.removeLayer(window._banatMapLayer);
                    }
                    window.updatePremiumMapCoverageVisibility && window.updatePremiumMapCoverageVisibility();
                };

                window.setBanatMapOpacity = function (val) {
                    document.getElementById('banatMapPct').textContent = val + '%';
                    window._banatMapLayer.setOpacity(val / 100);
                };
            })();

            // ── SATELIT 60s (WMS Corona via CAST UARK GeoServer) ──
            // FIX (2026-07): The old code hardcoded 2 passes (1106-1042, 1104-2155)
            // and dynamically generated frame names df012-df026/da012-da026 which
            // mostly don't exist on the server. Only 3 frames (da023-025 of pass
            // 1106-1042) actually existed - that's why users only saw 3 sheets.
            // The coverage polygon was also wrong (17E-21E instead of all Romania).
            // New approach: dynamically discover ALL Corona layers from the CAST
            // GeoServer GetCapabilities at page load. This loads every available
            // Corona frame across all passes, providing full coverage of Romania.
            (function () {
                map.createPane("pane_sat60");
                map.getPane("pane_sat60").style.zIndex = 648;
                map.getPane("pane_sat60").style.pointerEvents = "none";

                var SAT60_WMS_URL = "https://geoserve.cast.uark.edu/geoserver/gwc/service/wms";
                var SAT60_INITIAL_OPACITY = 0.85;

                // Romania bounds — defined at this scope so it is available both
                // during discovery and later during lazy layer creation.
                var ROMANIA_BOUNDS = L.latLngBounds([[43.5, 19.5], [48.5, 30.5]]);

                // Discover all Corona layers dynamically from the GeoServer
                function discoverCoronaLayers(callback) {
                    fetch(SAT60_WMS_URL + "?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities")
                        .then(function (r) { return r.text(); })
                        .then(function (xml) {
                            var layers = [];
                            var re = /<Name>(corona:[^<]+)<\/Name>/g;
                            var match;
                            var MAX_RAW_LAYERS = 600; // safety: we will never use more than this anyway
                            while ((match = re.exec(xml)) !== null && layers.length < MAX_RAW_LAYERS) {
                                var name = match[1];
                                // Skip metadata/index layers
                                if (name.indexOf("footprints") !== -1) continue;
                                layers.push(name);
                            }
                            console.log("[Sat60] Discovered", layers.length, "Corona WMS layers from CAST GeoServer (capped at parse time if huge)");
                            callback(layers);
                        })
                        .catch(function (err) {
                            console.warn("[Sat60] Failed to discover Corona layers, using fallback list:", err);
                            callback([
                                "corona:1103-2139Fore", "corona:1103-2139Aft",
                                "corona:1103-2155Fore", "corona:1103-2155Aft",
                                "corona:1103-2167Fore", "corona:1103-2167Aft",
                                "corona:1103-2171Fore", "corona:1103-2171Aft",
                                "corona:1103-2183Fore", "corona:1103-2183Aft",
                                "corona:1103-2200Fore", "corona:1103-2200Aft",
                                "corona:1106-1042da023", "corona:1106-1042da024", "corona:1106-1042da025",
                                "corona:1106-2070Fore", "corona:1106-2070Aft",
                                "corona:1106-2119Fore", "corona:1106-2119Aft",
                                "corona:1107-2170Fore", "corona:1107-2170Aft",
                                "corona:1108-2135Fore", "corona:1108-2135Aft",
                                "corona:1108-2167Fore", "corona:1108-2167Aft"
                            ]);
                        });
                }

                window._sat60FrameLayers = [];
                window._sat60MapLayer = L.layerGroup([]);
                window._sat60Ready = false;

                discoverCoronaLayers(function (layerNames) {
                    // CRITICAL FIX for "0 / 29920 requests" + ever-increasing transferred/resources:
                    // A full GetCapabilities often returns thousands of worldwide Corona layers.
                    // Each L.tileLayer.wms causes Leaflet to make a separate tile request *per visible tile*.
                    // 100+ layers × 20-30 tiles/view = thousands of simultaneous requests → browser chokes.
                    //
                    // Strategy (very aggressive now):
                    // - Hard-cap to **1** combined WMS layer total (maximum safety).
                    // - Only create when user actually turns the toggle ON (lazy creation).
                    // - If huge list from server → use small curated Romania set.
                    // - Add strict bounds + zoom limits on every WMS layer.

                    var MAX_COMBINED_WMS_LAYERS = 1;   // ABSOLUTE MAX — only ever create 1 L.tileLayer.wms
                    var CHUNK_SIZE = 200;              // one big combined layer

                    var effectiveLayers = layerNames;

                    // If the server gave us a ridiculous number of layers, fall back to the curated Romania list.
                    // This prevents the "29920 requests" storm.
                    if (layerNames.length > 300) {
                        console.warn("[Sat60] GetCapabilities returned", layerNames.length, "layers (worldwide). Using curated Romania fallback instead to avoid request explosion.");
                        effectiveLayers = [
                            "corona:1103-2139Fore", "corona:1103-2139Aft",
                            "corona:1103-2155Fore", "corona:1103-2155Aft",
                            "corona:1103-2167Fore", "corona:1103-2167Aft",
                            "corona:1103-2171Fore", "corona:1103-2171Aft",
                            "corona:1103-2183Fore", "corona:1103-2183Aft",
                            "corona:1103-2200Fore", "corona:1103-2200Aft",
                            "corona:1106-1042da023", "corona:1106-1042da024", "corona:1106-1042da025",
                            "corona:1106-2070Fore", "corona:1106-2070Aft",
                            "corona:1106-2119Fore", "corona:1106-2119Aft",
                            "corona:1107-2170Fore", "corona:1107-2170Aft",
                            "corona:1108-2135Fore", "corona:1108-2135Aft",
                            "corona:1108-2167Fore", "corona:1108-2167Aft"
                        ];
                    }

                    // Build at most MAX_COMBINED_WMS_LAYERS combined layers
                    var chunks = [];
                    for (var i = 0; i < effectiveLayers.length && chunks.length < MAX_COMBINED_WMS_LAYERS; i += CHUNK_SIZE) {
                        chunks.push(effectiveLayers.slice(i, i + CHUNK_SIZE));
                    }

                    console.log("[Sat60] Will create", chunks.length, "combined WMS layers (capped). Raw layers considered:", effectiveLayers.length);

                    // Store the *definitions* (not yet instantiated tile layers)
                    window._sat60LayerDefs = chunks.map(function (chunk) {
                        return {
                            layers: chunk.join(',')
                        };
                    });

                    window._sat60FrameLayers = [];
                    window._sat60MapLayer = L.layerGroup([]);
                    window._sat60Ready = true;

                    // If the toggle was already ON when discovery finished, activate now
                    var toggle = document.getElementById("satellite60sToggle");
                    if (toggle && toggle.checked) {
                        window.toggleSatellite60sMap(true);
                    }
                });

                window.toggleSatellite60sMap = function (on) {
                    if (on) {
                        var histPremToggle = document.getElementById("histPremiumToggle");
                        if (histPremToggle && !histPremToggle.checked) {
                            histPremToggle.checked = true;
                            window.toggleHistPremiumLayer(true);
                        }

                        if (!window._sat60Ready) {
                            console.log("[Sat60] Layers still being discovered, will add when ready");
                            return;
                        }

                        // LAZY CREATION: only build the actual L.tileLayer.wms instances
                        // the first time the user turns the layer ON. This is the main
                        // fix for the "0 / 29920 requests, increasing kB transferred"
                        // symptom — we no longer create dozens of WMS layers at page load.
                        if (window._sat60FrameLayers.length === 0 && window._sat60LayerDefs && window._sat60LayerDefs.length > 0) {
                            console.log("[Sat60] Lazy-creating", window._sat60LayerDefs.length, "WMS layers now that toggle is ON");
                            window._sat60FrameLayers = window._sat60LayerDefs.map(function (def) {
                                var lyr = L.tileLayer.wms(SAT60_WMS_URL, {
                                    layers: def.layers,
                                    format: "image/png",
                                    transparent: true,
                                    version: "1.1.1",
                                    attribution: "© Corona 1960s (CAST UARK)",
                                    tileSize: 256,
                                    opacity: SAT60_INITIAL_OPACITY,
                                    pane: "pane_sat60",
                                    bounds: ROMANIA_BOUNDS,   // stop requesting tiles outside Romania
                                    minZoom: 8,               // do not request tiles at very low zoom (prevents thousands of requests)
                                    maxZoom: 16,
                                    maxNativeZoom: 14
                                });
                                return lyr;
                            });
                            window._sat60MapLayer = L.layerGroup(window._sat60FrameLayers);
                        }

                        if (window._sat60MapLayer) {
                            window._sat60MapLayer.addTo(map);

                            // Helpful debug: log what the first tile URL will look like
                            // so user can paste it in browser / check DevTools Network tab
                            try {
                                var firstLayer = window._sat60FrameLayers[0];
                                if (firstLayer && firstLayer._url) {
                                    var sampleUrl = firstLayer.getTileUrl({ x: 140, y: 80, z: 7 }); // rough Romania tile
                                    console.log("[Sat60] Sample tile URL (paste in new tab to test):", sampleUrl);
                                }
                            } catch (e) {}
                        }
                    } else {
                        if (window._sat60MapLayer) {
                            map.hasLayer(window._sat60MapLayer) && map.removeLayer(window._sat60MapLayer);
                        }
                    }
                    window.updatePremiumMapCoverageVisibility && window.updatePremiumMapCoverageVisibility();
                };

                window.setSatellite60sMapOpacity = function (val) {
                    document.getElementById("satellite60sMapPct").textContent = val + "%";
                    var opacity = val / 100;
                    // Works whether layers were created eagerly or lazily
                    if (window._sat60FrameLayers && window._sat60FrameLayers.length) {
                        window._sat60FrameLayers.forEach(function (layer) {
                            if (layer && layer.setOpacity) layer.setOpacity(opacity);
                        });
                    }
                };
            })();

            // ── HARTI ISTORICE PREMIUM — PARENT GROUP FUNCTIONS ──
            var _histPremiumSubExpanded = false;
            window.toggleHistPremiumSubLayers = function() {
                _histPremiumSubExpanded = !_histPremiumSubExpanded;
                var panel = document.getElementById('histPremiumSubLayers');
                var icon = document.getElementById('histPremiumExpandIcon');
                if (_histPremiumSubExpanded) {
                    panel.style.maxHeight = '1000px';
                    panel.style.opacity = '1';
                    panel.style.marginTop = '10px';
                    icon.style.transform = 'rotate(0deg)';
                } else {
                    panel.style.maxHeight = '0';
                    panel.style.opacity = '0';
                    panel.style.marginTop = '0';
                    icon.style.transform = 'rotate(-90deg)';
                }
            };

            // Substraturile grupului "Harti istorice / Historical maps" (premium).
            // Când switch-ul mare e oprit, toate switch-urile astea (și straturile
            // lor de pe hartă) trebuie oprite automat — vezi bug-ul raportat.
            var HIST_PREMIUM_SUBLAYER_TOGGLES = [
                { id: 'josephineToggle', fnName: 'toggleJosephineLayer' },
                { id: 'bucovinaMapToggle', fnName: 'toggleBucovinaMap' },
                { id: 'austrohuMapToggle', fnName: 'toggleAustrohuMap' },
                { id: 'moldova1868MapToggle', fnName: 'toggleMoldova1868Map' },
                { id: 'moldovaWwiiMapToggle', fnName: 'toggleMoldovaWwiiMap' },
                { id: 'polishTactical1933MapToggle', fnName: 'togglePolishTactical1933Map' },
                { id: 'ww1MapToggle', fnName: 'toggleWw1Map' },
                { id: 'ww2MapToggle', fnName: 'toggleWw2Map' },
                { id: 'satellite60sToggle', fnName: 'toggleSatellite60sMap' },
                { id: 'banatMapToggle', fnName: 'toggleBanatMap' }
            ];

            window.toggleHistPremiumLayer = function (on) {
                var toggle = document.getElementById('histPremiumToggle');
                if (toggle) toggle.checked = on;

                if (!on) {
                    // Oprirea grupului mare oprește automat toate substraturile lui:
                    // debifăm fiecare switch și apelăm funcția lui de toggle(false),
                    // care știe deja cum să scoată stratul respectiv de pe hartă.
                    HIST_PREMIUM_SUBLAYER_TOGGLES.forEach(function (child) {
                        var el = document.getElementById(child.id);
                        if (el) el.checked = false;
                        var fn = window[child.fnName];
                        if (typeof fn === 'function') fn(false);
                    });
                }

                // Actualizează vizibilitatea poligoanelor de acoperire
                if (typeof window.updatePremiumMapCoverageVisibility === 'function') {
                    window.updatePremiumMapCoverageVisibility();
                }
            };

            // ── HARTA IOSEFINĂ GRATUITĂ (VERSIUNE CORECTATĂ) ──

            // ========== DECLARARE VARIABILE ==========
            var IOSFREE_MIN_ZOOM = 14;
            var _iosDB = null;
            var _lastLocality = null;
            var _imgCache = {};
            var _currentOverlay = null;
            var _currentLocality = null;
            var _isFlying = false;
            var _currentImageUrl = null;


            // Funcții helper
            function _t(key) {
                var lang = (typeof currentLang !== 'undefined') ? currentLang : 'ro';
                var T = (typeof translations !== 'undefined' && translations[lang]) ? translations[lang] : {};
                return T[key] || key;
            }

            function _msgEl() { return document.getElementById('iosfreePreviewMsg'); }
            function _previewEl() { return document.getElementById('iosfreePreview'); }

            function _removeOverlay() {
                if (_currentOverlay && window._dlMap) {
                    window._dlMap.removeLayer(_currentOverlay);
                    _currentOverlay = null;
                }
                _currentLocality = null;
                // Ascunde butoanele de pan din panel, arată Search
                var panelBtns = document.getElementById('iosfreePanelBtns');
                if (panelBtns) panelBtns.style.display = 'none';
                var searchBtn = document.getElementById('iosfreeSearchBtn');
                if (searchBtn) searchBtn.style.display = '';
            }

            window.setIosfreeOpacity = function (val) {
                var opacity = parseFloat(val) / 100;
                var pct = document.getElementById('iosfreeOpacityPct');
                if (pct) pct.textContent = Math.round(opacity * 100) + '%';
                if (_currentOverlay) _currentOverlay.setOpacity(opacity);
            };

            window.toggleIosfreeLayer = function (on) {
                var histToggle = document.getElementById('histToggle');
                var histOn = histToggle && histToggle.checked;
                if (on && !histOn) {
                    if (histToggle) histToggle.checked = true;
                    window.toggleHistLayer(true);
                    histOn = true;
                }
                if (!histOn) return; // master toggle controls visibility
                if (on) {
                    // re-show overlay if one was loaded
                    if (_currentOverlay && !map.hasLayer(_currentOverlay)) {
                        _currentOverlay.addTo(map);
                    }
                    var searchBtn = document.getElementById('iosfreeSearchBtn');
                    var panelBtns = document.getElementById('iosfreePanelBtns');
                    if (_currentOverlay && panelBtns) panelBtns.style.display = '';
                    else if (searchBtn) searchBtn.style.display = '';
                } else {
                    if (_currentOverlay && map.hasLayer(_currentOverlay)) {
                        map.removeLayer(_currentOverlay);
                    }
                }
                var row = document.getElementById('iosfreeRow');
                if (row) row.style.opacity = on ? '1' : '0.45';
            };

            window.toggleJosephineLayer = function (on) {
                if (on) {
                    var histPremToggle = document.getElementById('histPremiumToggle');
                    if (histPremToggle && !histPremToggle.checked) {
                        histPremToggle.checked = true;
                        window.toggleHistPremiumLayer(true);
                    }
                }
                // _jLayer is in the Josephine/Historical Maps closure — access via window._jLayerRef if set
                if (window._jLayerRef) {
                    if (on) {
                        window._jLayerRef.addTo(map);
                    } else {
                        map.hasLayer(window._jLayerRef) && map.removeLayer(window._jLayerRef);
                    }
                }
                var pane = map.getPane('pane_josephine');
                if (pane) pane.style.display = on ? '' : 'none';
                var row = document.getElementById('josephineRow');
                if (row) row.style.opacity = on ? '1' : '0.45';
                // Actualizăm vizibilitatea butonului Buildings Search
                if (typeof window._refreshIosBldBtnVisibility === 'function') window._refreshIosBldBtnVisibility();
                if (!on && typeof window.clearIosBldSearchHelp === 'function') window.clearIosBldSearchHelp();
            };

            function _calculateBounds(lat, lng, imageUrl, callback) {
                var img = new Image();
                img.onload = function () {
                    var imgWidth = img.width;
                    var imgHeight = img.height;
                    var aspectRatio = imgWidth / imgHeight;

                    // DUBLEAZĂ DIMENSIUNEA - de la 12 km la 24 km lățime
                    var widthKm = 24;   // era 12, acum 24 (dublu)
                    var heightKm = widthKm / aspectRatio;

                    var metersPerDegree = 111320;
                    var deltaLng = (widthKm * 1000 / 2) / (metersPerDegree * Math.cos(lat * Math.PI / 180));
                    var deltaLat = (heightKm * 1000 / 2) / metersPerDegree;

                    var bounds = L.latLngBounds(
                        [lat - deltaLat, lng - deltaLng],
                        [lat + deltaLat, lng + deltaLng]
                    );

                    callback(bounds);
                };
                img.onerror = function () {
                    // Fallback dublat și aici
                    var metersPerDegree = 111320;
                    var deltaDegrees = (16000 / 2) / metersPerDegree;  // era 8000, acum 16000
                    var bounds = L.latLngBounds(
                        [lat - deltaDegrees, lng - deltaDegrees],
                        [lat + deltaDegrees, lng + deltaDegrees]
                    );
                    callback(bounds);
                };
                img.src = imageUrl;
            }

            function _fetchWikiImage(wikiUrl, locality, cb) {
                console.log('[Iosefină] Fetch imagine pentru:', wikiUrl);
                var match = wikiUrl.match(/File:([^/]+)$/);
                if (!match) {
                    console.log('Nu se poate extrage numele fișierului');
                    cb(null);
                    return;
                }
                var filename = decodeURIComponent(match[1]);
                var apiUrl = 'https://en.wikipedia.org/w/api.php?action=query&titles=File:' +
                    encodeURIComponent(filename) +
                    '&prop=imageinfo&iiprop=url&format=json&origin=*';

                fetch(apiUrl)
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        console.log('Răspuns primit pentru', locality, data);
                        var pages = data.query && data.query.pages;
                        if (!pages) { cb(null); return; }
                        var page = Object.values(pages)[0];
                        var imgUrl = page.imageinfo && page.imageinfo[0] && page.imageinfo[0].url;
                        if (imgUrl) {
                            _imgCache[wikiUrl] = imgUrl;
                            console.log('✅ Imagine găsită:', imgUrl);
                            cb(imgUrl);
                        } else {
                            console.log('❌ Nu s-a găsit URL pentru imagine');
                            cb(null);
                        }
                    })
                    .catch(function (err) {
                        console.error('Eroare fetch:', err);
                        cb(null);
                    });
            }

            function _loadAndDisplay(entry, displayName, targetLat, targetLng, customBounds) {
                console.log('[Iosefină] Încarcă pentru:', displayName, targetLat, targetLng);

                _fetchWikiImage(entry.l, displayName, function (imgUrl) {
                    console.log('[Iosefină] Callback primit, imgUrl:', imgUrl);

                    if (!imgUrl) {
                        var msg = _msgEl();
                        if (msg) {
                            msg.style.display = '';
                            msg.innerHTML = '⚠ ' + _t('iosfree_notfound');
                        }
                        return;
                    }

                    _currentImageUrl = imgUrl;
                    _showThumbnail(imgUrl, displayName);

                    // Calculează limitele proporțional cu imaginea
                    if (customBounds && Array.isArray(customBounds) && customBounds.length === 2) {
                        // Folosește limitele personalizate din JSON
                        var bounds = L.latLngBounds(customBounds[0], customBounds[1]);
                        _finalizeDisplay(imgUrl, displayName, bounds, targetLat, targetLng);
                    } else if (targetLat != null && targetLng != null) {
                        // Calculează limitele proporțional
                        _calculateBounds(targetLat, targetLng, imgUrl, function (bounds) {
                            _finalizeDisplay(imgUrl, displayName, bounds, targetLat, targetLng);
                        });
                    } else {
                        console.warn('[Iosefină] Nu există coordonate');
                    }
                });
            }

            function _finalizeDisplay(imgUrl, displayName, bounds, targetLat, targetLng) {
                // ASCUNDE MESAJUL DE LOADING
                var msg = _msgEl();
                if (msg) {
                    msg.style.display = 'none';
                }

                // Micșorează imaginea cu 19% față de centrul geografic (0.9 × 0.9)
                var _scale = 0.81;
                var _c    = bounds.getCenter();
                var _dLat = (bounds.getNorth() - bounds.getSouth()) / 2 * _scale;
                var _dLng = (bounds.getEast()  - bounds.getWest())  / 2 * _scale;
                bounds = L.latLngBounds(
                    [_c.lat - _dLat, _c.lng - _dLng],
                    [_c.lat + _dLat, _c.lng + _dLng]
                );

                // Plasează overlay-ul pe hartă
                _placeOnMap(imgUrl, displayName, bounds);

                // Nu mai forțăm flyTo — utilizatorul poate vedea harta la orice zoom
            }


            // Caută o localitate în baza de date
            function _normalizeDiacritics(str) {
                return str
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    .replace(/[\u015f\u015e]/g, 's')
                    .replace(/[\u0163\u0162]/g, 't');
            }

            function lookupLocality(name, lat, lng) {
                if (!name || !_iosDB) return;

                var key = name.trim().toLowerCase();
                var keyNorm = _normalizeDiacritics(key);
                var entry = _iosDB[key];

                if (!entry) {
                    var keys = Object.keys(_iosDB);
                    for (var i = 0; i < keys.length; i++) {
                        var dbKeyNorm = _normalizeDiacritics(keys[i]);
                        if (keys[i] === key || dbKeyNorm === keyNorm ||
                            dbKeyNorm.indexOf(keyNorm) === 0 || keyNorm.indexOf(dbKeyNorm) === 0 ||
                            keys[i].indexOf(key) === 0 || keys[i].includes(key)) {
                            entry = _iosDB[keys[i]];
                            break;
                        }
                    }
                }

                if (!entry) {
                    var msg = _msgEl();
                    if (msg) {
                        msg.style.display = '';
                        msg.innerHTML = '⚠ ' + _t('iosfree_notfound') + ': <em>' + name + '</em>';
                    }
                    _removeOverlay();
                    return;
                }

                if (_currentLocality === key) return;
                _currentLocality = key;

                var targetLat = entry.lat || lat;
                var targetLng = entry.lng || lng;
                var displayName = entry.d || name;
                var customBounds = entry.bounds || null;

                if (entry.c && typeof entry.c === 'object') {
                    targetLat = entry.c.lat || targetLat;
                    targetLng = entry.c.lng || targetLng;
                }

                if (typeof targetLat === 'string' && targetLat.includes(',')) {
                    var parts = targetLat.split(',');
                    targetLat = parseFloat(parts[0]);
                    targetLng = parseFloat(parts[1]);
                }

                if (isNaN(targetLat) || isNaN(targetLng)) {
                    console.warn('[Iosefină] Coordonate invalide pentru', displayName);
                    var msg = _msgEl();
                    if (msg) {
                        msg.style.display = '';
                        msg.innerHTML = '⚠ Coordonate lipsă pentru ' + displayName;
                    }
                    return;
                }

                var msg = _msgEl();
                if (msg) {
                    msg.style.display = '';
                    msg.innerHTML = '⏳ ' + _t('iosfree_loading');
                }

                var oldImg = document.getElementById('iosfreeImg');
                if (oldImg) oldImg.remove();

                _loadAndDisplay(entry, displayName, targetLat, targetLng, customBounds);
            }

            // Activare la zoom/pan
            function _activate(lat, lng) {
                if (!_iosDB) return;

                var row = document.getElementById('iosfreeRow');
                if (row) row.style.display = '';

                var sub = document.getElementById('histSubLayers');
                if (sub && (sub.style.maxHeight === '0px' || sub.style.maxHeight === '0')) {
                    if (typeof toggleHistSubLayers === 'function') toggleHistSubLayers();
                }

                // Găsește cea mai apropiată localitate din DB față de coordonatele centrului
                var closestEntry = null;
                var closestKey = null;
                var minDist = Infinity;

                for (var key in _iosDB) {
                    var e = _iosDB[key];
                    // Suportă atât {lat, lng} cât și {c: {lat, lng}}
                    var eLat = (e.c && e.c.lat) ? e.c.lat : e.lat;
                    var eLng = (e.c && e.c.lng) ? e.c.lng : e.lng;
                    if (eLat == null || eLng == null) continue;

                    var d = Math.sqrt(
                        Math.pow(eLat - lat, 2) +
                        Math.pow(eLng - lng, 2)
                    );
                    if (d < minDist) {
                        minDist = d;
                        closestEntry = e;
                        closestKey = key;
                    }
                }

                if (!closestEntry) return;

                // ── FIX: verifică dacă cea mai apropiată localitate este
                //    în raza de acoperire a hărții Iozefine (~0.25° ≈ 25–28 km).
                //    Dacă centrul hărții este mai departe, zona nu are acoperire.
                var MAX_DIST_DEG = 0.25;
                if (minDist > MAX_DIST_DEG) {
                    var msg = _msgEl();
                    if (msg) {
                        msg.style.display = '';
                        msg.innerHTML = '⚠ ' + _t('iosfree_notfound');
                    }
                    _removeOverlay();
                    return;
                }

                // Evită reîncărcarea dacă e aceeași localitate
                var newKey = closestKey;
                if (_currentLocality === newKey) return;
                _currentLocality = newKey;

                var targetLat = (closestEntry.c && closestEntry.c.lat) ? closestEntry.c.lat : closestEntry.lat;
                var targetLng = (closestEntry.c && closestEntry.c.lng) ? closestEntry.c.lng : closestEntry.lng;
                var displayName = closestEntry.d || closestKey;
                var customBounds = closestEntry.bounds || null;

                // Arată mesaj de loading
                var msg = _msgEl();
                if (msg) { msg.style.display = ''; msg.innerHTML = '⏳ ' + _t('iosfree_loading') + ' (' + displayName + ')'; }

                // Încarcă direct imaginea pe baza coordonatelor — fără lookup după nume
                _loadAndDisplay(closestEntry, displayName, targetLat, targetLng, customBounds);
            }

            // Inițializare
            function _init() {
                if (!window._dlMap) {
                    setTimeout(_init, 200);
                    return;
                }

                var map = window._dlMap;

                if (!map.getPane('iosfreePane')) {
                    map.createPane('iosfreePane');
                    var iosPane = map.getPane('iosfreePane');
                    iosPane.style.zIndex = 1000;
                    iosPane.style.pointerEvents = 'auto';
                    console.log('[Iosefină] Pane dedicat creat cu zIndex 1000');
                }

                map.on('zoomend moveend', function () {
                    // Auto-căutarea a fost dezactivată — folosește butonul "Caută aici"
                    // (fostul cod chema _activate la orice mișcare)
                });

                // Activare inițială imediat după încărcarea bazei de date
                // Nu mai facem auto-activate — utilizatorul apasă butonul

                window._iosFreeActivateSearch = function (localityName, lat, lng) {
                    var toggle = document.getElementById('iosfreeToggle');
                    if (toggle && !toggle.checked) return; // layer is off — don't fetch or display anything
                    _currentLocality = null;
                    lookupLocality(localityName, lat, lng);
                };

                // Funcție publică pentru butonul "Caută / Search"
                window.iosfreeManualSearch = function () {
                    if (!window._dlMap) return;
                    var center = window._dlMap.getCenter();
                    _currentLocality = null; // Forțează re-căutare chiar dacă e aceeași zonă
                    _activate(center.lat, center.lng);
                };

                // Funcție publică pentru butonul X — închide harta curentă
                window.iosfreeCloseMap = function () {
                    _removeOverlay();
                    var msg = _msgEl();
                    if (msg) msg.style.display = 'none';
                };
            }

            // Încarcă baza de date JSON
            function loadDatabase() {
                fetch('iosfree_db.json')
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        _iosDB = data;
                        window._iosDB = data;  // ← ADĂUGĂ ASTA
                        console.log('[Iosefină] Bază de date încărcată cu', Object.keys(data).length, 'localități');
                        _init();
                    })
                    .catch(function (err) {
                        console.error('[Iosefină] Eroare la încărcarea bazei de date:', err);
                        _iosDB = {};
                        window._iosDB = {};  // ← ADĂUGĂ ASTA
                        _init();
                    });
            }

            // Pornește totul
            loadDatabase();

            // Verifică dacă funcția _showThumbnail există și este corectă
            function _showThumbnail(url, locality) {
                console.log('[Iosefină] _showThumbnail:', url, locality);
                var preview = _previewEl();
                if (!preview) return;

                var old = document.getElementById('iosfreeImg');
                if (old) old.remove();

                var wrapper = document.createElement('div');
                wrapper.style.cssText = 'width:100%;';

                var img = document.createElement('img');
                img.id = 'iosfreeImg';
                img.src = url;
                img.alt = locality;
                var opacity = (document.getElementById('iosfreeOpacitySlider') ?
                    document.getElementById('iosfreeOpacitySlider').value / 100 : 0.8);
                img.style.cssText = 'width:100%;display:block;object-fit:cover;cursor:pointer;border:none;opacity:' + opacity + ';';
                img.title = 'Harta Iosefină — ' + locality;
                img.onclick = function () {
                    if (typeof openIosfreeModal === 'function') openIosfreeModal(url, locality);
                };

                var caption = document.createElement('div');
                caption.style.cssText = 'font-size:0.68rem;color:rgba(168,216,160,0.7);margin-top:3px;';
                caption.innerHTML = '📜 ' + locality;

                wrapper.appendChild(img);
                wrapper.appendChild(caption);
                preview.appendChild(wrapper);
            }

            // ── Layer custom Leaflet cu rotație stabilă pe canvas ──
            var IOSFREE_ROTATION_DEG = -12; // grade, negativ = spre stânga

            L.RotatedImageOverlay = L.Layer.extend({
                initialize: function (url, bounds, options) {
                    this._url    = url;
                    this._bounds = bounds;
                    // Limitele inițiale — nu se modifică niciodată; dreptunghiul exterior e ancorat aici
                    this._initialBounds = L.latLngBounds(bounds.getSouthWest(), bounds.getNorthEast());
                    this._rotation = (options && options.rotation != null) ? options.rotation : 0;
                    this._opacity  = (options && options.opacity  != null) ? options.opacity  : 1;
                    this._pane     = (options && options.pane)    ? options.pane    : 'overlayPane';
                    this._locality = (options && options.locality) ? options.locality : '';
                    L.setOptions(this, options);
                },

                onAdd: function (map) {
                    this._map = map;
                    if (!this._canvas) {
                        this._canvas = document.createElement('canvas');
                        this._canvas.style.position = 'absolute';
                        this._canvas.style.pointerEvents = 'none';
                    }
                    var pane = map.getPane(this._pane) || map.getPanes().overlayPane;
                    pane.appendChild(this._canvas);

                    var self = this;
                    if (!this._img) {
                        this._img = new Image();
                        this._img.crossOrigin = 'anonymous';
                        this._img.onload = function () {
                            self._imgLoaded = true;
                            self._redraw();
                        };
                        this._img.src = this._url;
                    } else if (this._imgLoaded) {
                        this._redraw();
                    }

                    map.on('zoomstart', this._onZoomStart, this);
                    map.on('zoomend moveend viewreset', this._onZoomEnd, this);
                    return this;
                },

                onRemove: function (map) {
                    map.off('zoomstart', this._onZoomStart, this);
                    map.off('zoomend moveend viewreset', this._onZoomEnd, this);
                    if (this._canvas && this._canvas.parentNode) {
                        this._canvas.parentNode.removeChild(this._canvas);
                    }
                },

                setOpacity: function (opacity) {
                    this._opacity = opacity;
                    if (this._canvas) this._canvas.style.opacity = opacity;
                    return this;
                },

                setBounds: function (newBounds) {
                    this._bounds = newBounds;
                    this._redraw();
                    return this;
                },

                getElement: function () { return this._canvas; },

                _onZoomStart: function () {
                    if (this._canvas) this._canvas.style.display = 'none';
                },

                _onZoomEnd: function () {
                    if (this._canvas) this._canvas.style.display = '';
                    this._redraw();
                },

                _redraw: function () {
                    if (!this._map || !this._imgLoaded) return;

                    var map      = this._map;
                    var bounds   = this._bounds;
                    var initBounds = this._initialBounds || bounds;
                    var angleDeg = this._rotation;
                    var angleRad = angleDeg * Math.PI / 180;

                    // Centrul FIX al dreptunghiului exterior (nu se modifică la pan)
                    var initCenter   = initBounds.getCenter();
                    var initCenterPx = map.latLngToLayerPoint(initCenter);

                    // Centrul CURENT al imaginii (se modifică la pan)
                    var curCenter   = bounds.getCenter();
                    var curCenterPx = map.latLngToLayerPoint(curCenter);

                    // Dimensiunile imaginii din bounds-ul CURENT
                    var sw = map.latLngToLayerPoint(bounds.getSouthWest());
                    var ne = map.latLngToLayerPoint(bounds.getNorthEast());
                    var halfW = (ne.x - sw.x) / 2;
                    var halfH = (sw.y - ne.y) / 2;

                    // Dreptunghiul exterior: 3× dimensiunea imaginii
                    var rectHalfW = halfW * 3;
                    var rectHalfH = halfH * 3;

                    // Offset al imaginii față de centrul fix (în spațiu ecran)
                    var imgOffX = curCenterPx.x - initCenterPx.x;
                    var imgOffY = curCenterPx.y - initCenterPx.y;

                    // Conversia offset-ului din spațiu ecran în spațiu rotit (rotație inversă)
                    var cosA  =  Math.cos(angleRad);
                    var sinA  =  Math.sin(angleRad);
                    var imgOffXRot = imgOffX * cosA + imgOffY * sinA;
                    var imgOffYRot = -imgOffX * sinA + imgOffY * cosA;

                    // Bounding box: colțurile AMBELOR forme în spațiu ecran (față de initCenterPx)
                    function rotatedCornersAt(hw, hh, ox, oy) {
                        return [
                            { x: -hw + ox, y: -hh + oy },
                            { x:  hw + ox, y: -hh + oy },
                            { x:  hw + ox, y:  hh + oy },
                            { x: -hw + ox, y:  hh + oy }
                        ].map(function (c) {
                            return {
                                x: c.x * Math.cos(angleRad) - c.y * Math.sin(angleRad),
                                y: c.x * Math.sin(angleRad) + c.y * Math.cos(angleRad)
                            };
                        });
                    }

                    var rectCorners = rotatedCornersAt(rectHalfW, rectHalfH, 0, 0);
                    var imgCorners  = rotatedCornersAt(halfW, halfH, imgOffXRot, imgOffYRot);
                    var allCorners  = rectCorners.concat(imgCorners);

                    var pad = 4;
                    var minX = Math.min.apply(null, allCorners.map(function(c){return c.x;})) - pad;
                    var maxX = Math.max.apply(null, allCorners.map(function(c){return c.x;})) + pad;
                    var minY = Math.min.apply(null, allCorners.map(function(c){return c.y;})) - pad;
                    var maxY = Math.max.apply(null, allCorners.map(function(c){return c.y;})) + pad;

                    var MAX_CANVAS = 8192;
                    var cW = Math.min(Math.ceil(maxX - minX), MAX_CANVAS);
                    var cH = Math.min(Math.ceil(maxY - minY), MAX_CANVAS);

                    var canvas = this._canvas;
                    canvas.width  = cW;
                    canvas.height = cH;
                    canvas.style.opacity = this._opacity;

                    // Canvas ancorat față de initCenterPx (dreptunghiul nu se mișcă)
                    canvas.style.left = (initCenterPx.x + minX) + 'px';
                    canvas.style.top  = (initCenterPx.y + minY) + 'px';

                    var ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, cW, cH);
                    ctx.save();

                    // Origine = centrul FIX (initCenterPx) în coordonate canvas
                    ctx.translate(-minX, -minY);
                    ctx.rotate(angleRad);

                    // 1. Dreptunghi exterior — ANCORAT la origine (nu se mișcă)
                    ctx.strokeStyle = 'rgba(160, 160, 160, 0.5)';
                    ctx.lineWidth   = 2;
                    ctx.setLineDash([10, 6]);
                    ctx.strokeRect(-rectHalfW, -rectHalfH, rectHalfW * 2, rectHalfH * 2);

                    // 2. Imaginea hărții — offset față de centrul fix
                    ctx.setLineDash([]);
                    ctx.globalAlpha = 1;
                    ctx.drawImage(this._img,
                        -halfW + imgOffXRot, -halfH + imgOffYRot,
                        halfW * 2, halfH * 2);

                    ctx.restore();
                }
            });

            L.rotatedImageOverlay = function (url, bounds, options) {
                return new L.RotatedImageOverlay(url, bounds, options);
            };

            // Asigură-te că _placeOnMap folosește pane-ul corect
            function _placeOnMap(imageUrl, locality, bounds) {
                if (!window._dlMap) return;

                var map = window._dlMap;

                if (!map.getPane('iosfreePane')) {
                    map.createPane('iosfreePane');
                    map.getPane('iosfreePane').style.zIndex = 1000;
                    console.log('[Iosefină] Pane creat din _placeOnMap');
                }

                _removeOverlay();

                var opacity = (document.getElementById('iosfreeOpacitySlider') ?
                    document.getElementById('iosfreeOpacitySlider').value / 100 : 0.8);

                console.log('[Iosefină] Crează overlay rotit cu imaginea:', imageUrl);

                _currentOverlay = L.rotatedImageOverlay(imageUrl, bounds, {
                    opacity:  opacity,
                    rotation: IOSFREE_ROTATION_DEG,
                    pane:     'iosfreePane',
                    locality: locality
                }).addTo(map);

                _currentLocality = locality;
                window._iosfreeCurrentOverlay = _currentOverlay;
                window._iosfreeCurrentBounds  = bounds;

                // Arată butoanele de pan din panel, ascunde Search
                var panelBtns = document.getElementById('iosfreePanelBtns');
                if (panelBtns) panelBtns.style.display = '';
                var searchBtn = document.getElementById('iosfreeSearchBtn');
                if (searchBtn) searchBtn.style.display = 'none';

                // Populează mini-previzualizarea din widget-ul de navigare
                var panPreview = document.getElementById('iosfreePanPreview');
                if (panPreview) {
                    panPreview.innerHTML = '';
                    var thumb = document.createElement('img');
                    thumb.src = imageUrl;
                    thumb.alt = locality;
                    thumb.style.cssText = 'width:100%;display:block;border-radius:3px;';
                    panPreview.appendChild(thumb);
                }

                // ========== NOU: Dacă toggle-ul Historical Maps e OFF, ascunde overlay-ul ==========
                var histToggle = document.getElementById('histToggle');
                if (histToggle && !histToggle.checked) {
                    map.removeLayer(_currentOverlay);
                }

                console.log('[Iosefină] Overlay rotit plasat cu succes, bounds:', bounds);
            }

        })();

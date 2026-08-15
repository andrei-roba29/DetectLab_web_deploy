/* ══════════════════════════════════════════════════════════════════════════
   DetectLab — Last known (broad) location
   --------------------------------------------------------------------------
   Remembers, per user, the BROAD place they were last seen at (nearest
   city / town + county) instead of only a live coordinate pair.

   Used by:
     • "See other detectorists" — offline users from the same county are shown
       as black/white bubbles next to the live (orange) ones.
     • Event creation — everyone whose last location is in the event's county
       (or within 50 km of it) receives an "An event was created near you"
       notification with a "See event" button that zooms onto the event.

   Public API (window.DetectLabLastLocation):
     resolveBroadLocation(lat, lng)      -> Promise<{city, county, country, label}|null>
     recordLastLocation(lat, lng, opts)  -> Promise<row|null>   (throttled)
     getMyLastLocation()                 -> cached row for the signed-in user
     fetchLastLocations()                -> Promise<row[]>      (all users)
     fetchLastLocationsInCounty(county)  -> Promise<row[]>
     distanceKm(lat1, lng1, lat2, lng2)  -> number
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var TABLE = 'user_last_locations';

    // Re-publish when the user moved more than this, or after this much time.
    var MOVE_THRESHOLD_KM = 2;
    var TIME_THRESHOLD_MS = 10 * 60 * 1000;   // 10 minutes

    // Nominatim public policy: at most one request per second.
    var NOMINATIM_MIN_INTERVAL_MS = 1100;
    var lastNominatimAt = 0;

    // Reverse-geocode cache keyed by a coarse grid cell (~1.1 km), so panning
    // around a town never re-queries Nominatim.
    var GEO_CACHE_KEY = 'detectlab_geo_cache';
    var LAST_PUBLISH_KEY = 'detectlab_last_location_publish';

    var _tableMissing = false;      // set once the server says the table is absent
    var _inFlight = null;

    function lang() {
        try {
            if (typeof window._currentLang === 'function') return window._currentLang();
        } catch (e) {}
        return 'ro';
    }

    function currentUser() {
        try {
            return (typeof window._authUser === 'function') ? window._authUser() : null;
        } catch (e) { return null; }
    }

    function userName(u) {
        if (!u) return '';
        var md = u.user_metadata || {};
        return u.name || md.full_name || md.name || (u.email ? u.email.split('@')[0] : '') || 'Detectorist';
    }

    function distanceKm(a, b, c, d) {
        if (![a, b, c, d].every(function (n) { return typeof n === 'number' && isFinite(n); })) return Infinity;
        var R = 6371;
        var x = (c - a) * Math.PI / 180, y = (d - b) * Math.PI / 180;
        var q = Math.sin(x / 2) * Math.sin(x / 2) +
            Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(y / 2) * Math.sin(y / 2);
        return 2 * R * Math.asin(Math.sqrt(q));
    }

    function readJson(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
        catch (e) { return fallback; }
    }
    function writeJson(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    }

    function cacheKey(lat, lng) {
        return lat.toFixed(2) + ',' + lng.toFixed(2) + ',' + lang();
    }

    /* ── Normalising helpers ─────────────────────────────────────────────── */

    // Counties are compared across users, so strip diacritics / "județul" /
    // "county" noise and casing before matching. "Județul Maramureș",
    // "Maramures County" and "maramureş" must all match.
    function normaliseCounty(raw) {
        if (!raw) return '';
        var s = String(raw);
        try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
        // Romanian comma-below characters that some fonts/sources use directly.
        s = s.replace(/[şŞșȘ]/g, 's').replace(/[ţŢțȚ]/g, 't').replace(/[ăâĂÂ]/g, 'a').replace(/[îÎ]/g, 'i');
        s = s.toLowerCase();
        s = s.replace(/\b(judetul|judet|jud\.?|county|province|voivodeship|region|regiunea|municipiul)\b/g, ' ');
        s = s.replace(/[^a-z0-9]+/g, ' ').trim();
        return s;
    }

    function sameCounty(a, b) {
        var x = normaliseCounty(a), y = normaliseCounty(b);
        return !!x && !!y && x === y;
    }

    function buildLabel(city, county, country) {
        return [city, county, country].filter(Boolean).join(', ');
    }

    /* ── Reverse geocoding ───────────────────────────────────────────────── */

    function fetchJson(url, timeoutMs) {
        return new Promise(function (resolve, reject) {
            var done = false;
            var timer = setTimeout(function () {
                if (done) return;
                done = true;
                reject(new Error('timeout'));
            }, timeoutMs || 12000);
            fetch(url, { headers: { 'Accept': 'application/json', 'Accept-Language': lang() } })
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(function (d) { if (!done) { done = true; clearTimeout(timer); resolve(d); } })
                .catch(function (e) { if (!done) { done = true; clearTimeout(timer); reject(e); } });
        });
    }

    // Resolve the nearest city/town + county for a coordinate pair.
    // Returns null when the lookup fails (offline, rate-limited, …) — callers
    // must keep working with coordinates only.
    async function resolveBroadLocation(lat, lng) {
        if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) return null;

        var cache = readJson(GEO_CACHE_KEY, {});
        var key = cacheKey(lat, lng);
        if (cache[key]) return cache[key];

        try {
            var wait = Math.max(0, NOMINATIM_MIN_INTERVAL_MS - (Date.now() - lastNominatimAt));
            if (wait) await new Promise(function (r) { setTimeout(r, wait); });
            lastNominatimAt = Date.now();

            // zoom=10 gives the city/town level rather than a street address.
            var url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2' +
                '&lat=' + encodeURIComponent(lat) +
                '&lon=' + encodeURIComponent(lng) +
                '&zoom=10&addressdetails=1&accept-language=' + encodeURIComponent(lang());
            var data = await fetchJson(url);
            var a = (data && data.address) || {};
            var city = a.city || a.town || a.village || a.municipality || a.hamlet ||
                a.suburb || a.city_district || a.county || (data && data.name) || null;
            var county = a.county || a.state_district || a.state || null;
            var country = a.country || null;
            if (!city && !county) return null;

            var place = {
                city: city || null,
                county: county || null,
                country: country || null,
                label: buildLabel(city, county, country)
            };
            cache[key] = place;
            // Keep the cache small.
            var keys = Object.keys(cache);
            if (keys.length > 200) { keys.slice(0, keys.length - 200).forEach(function (k) { delete cache[k]; }); }
            writeJson(GEO_CACHE_KEY, cache);
            return place;
        } catch (e) {
            console.warn('[LastLocation] reverse geocode failed:', e && e.message ? e.message : e);
            return null;
        }
    }

    /* ── Publishing ──────────────────────────────────────────────────────── */

    function getPublishState() { return readJson(LAST_PUBLISH_KEY, null); }
    function setPublishState(state) { writeJson(LAST_PUBLISH_KEY, state); }

    function shouldPublish(lat, lng, force) {
        if (force) return true;
        var prev = getPublishState();
        if (!prev) return true;
        var user = currentUser();
        if (!user || prev.user_id !== user.id) return true;
        if (Date.now() - (prev.at || 0) > TIME_THRESHOLD_MS) return true;
        return distanceKm(prev.latitude, prev.longitude, lat, lng) > MOVE_THRESHOLD_KM;
    }

    function isMissingTableError(err) {
        var msg = ((err && (err.message || '')) + ' ' + (err && (err.details || '')) + ' ' + (err && (err.hint || ''))).toLowerCase();
        return msg.indexOf('does not exist') !== -1 ||
            msg.indexOf('schema cache') !== -1 ||
            msg.indexOf('relation') !== -1 && msg.indexOf('not') !== -1;
    }

    // Remember where this user is right now (broad place + coordinates).
    // Heavily throttled: only writes when the user moved > 2 km or 10 minutes
    // have passed, so it never hammers Nominatim or Supabase from the GPS
    // watcher (which fires every couple of seconds).
    async function recordLastLocation(lat, lng, opts) {
        opts = opts || {};
        var user = currentUser();
        if (!user || !user.id) return null;
        if (!window.supabaseClient || _tableMissing) return null;
        if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) return null;
        if (!shouldPublish(lat, lng, opts.force)) return null;
        if (_inFlight) return _inFlight;

        _inFlight = (async function () {
            try {
                var place = await resolveBroadLocation(lat, lng);
                var prev = getPublishState();
                // Nominatim unreachable: keep the previously resolved place name
                // (still better than nothing) but refresh the coordinates.
                if (!place && prev && prev.user_id === user.id && prev.city) {
                    place = { city: prev.city, county: prev.county, country: prev.country, label: prev.label };
                }
                var row = {
                    user_id: user.id,
                    full_name: userName(user),
                    email: user.email || '',
                    latitude: Number(lat),
                    longitude: Number(lng),
                    city: (place && place.city) || null,
                    county: (place && place.county) || null,
                    country: (place && place.country) || null,
                    label: (place && place.label) || null,
                    updated_at: new Date().toISOString()
                };
                var res = await window.supabaseClient.from(TABLE).upsert([row], { onConflict: 'user_id' });
                if (res && res.error) {
                    if (isMissingTableError(res.error)) {
                        _tableMissing = true;
                        console.warn('[LastLocation] Table "' + TABLE + '" is missing — apply migration 20260815000000_user_last_locations.sql.');
                    } else {
                        console.warn('[LastLocation] upsert failed:', res.error.message || res.error);
                    }
                    return null;
                }
                setPublishState({
                    user_id: user.id,
                    latitude: row.latitude,
                    longitude: row.longitude,
                    city: row.city,
                    county: row.county,
                    country: row.country,
                    label: row.label,
                    at: Date.now()
                });
                try {
                    window.dispatchEvent(new CustomEvent('detectlab:last-location', { detail: row }));
                } catch (e) {}
                return row;
            } catch (e) {
                console.warn('[LastLocation] recordLastLocation error:', e && e.message ? e.message : e);
                return null;
            } finally {
                _inFlight = null;
            }
        })();

        return _inFlight;
    }

    function getMyLastLocation() {
        var user = currentUser();
        var prev = getPublishState();
        if (!user || !prev || prev.user_id !== user.id) return null;
        return prev;
    }

    /* ── Reading other users ─────────────────────────────────────────────── */

    async function fetchLastLocations() {
        if (!window.supabaseClient || _tableMissing) return [];
        try {
            var res = await window.supabaseClient
                .from(TABLE)
                .select('user_id,full_name,email,latitude,longitude,city,county,country,label,updated_at');
            if (res.error) {
                if (isMissingTableError(res.error)) {
                    _tableMissing = true;
                    console.warn('[LastLocation] Table "' + TABLE + '" is missing — apply migration 20260815000000_user_last_locations.sql.');
                } else {
                    console.warn('[LastLocation] fetch failed:', res.error.message || res.error);
                }
                return [];
            }
            return res.data || [];
        } catch (e) {
            console.warn('[LastLocation] fetch error:', e && e.message ? e.message : e);
            return [];
        }
    }

    async function fetchLastLocationsInCounty(county) {
        var rows = await fetchLastLocations();
        if (!county) return [];
        return rows.filter(function (r) { return sameCounty(r.county, county); });
    }

    window.DetectLabLastLocation = {
        resolveBroadLocation: resolveBroadLocation,
        recordLastLocation: recordLastLocation,
        getMyLastLocation: getMyLastLocation,
        fetchLastLocations: fetchLastLocations,
        fetchLastLocationsInCounty: fetchLastLocationsInCounty,
        distanceKm: distanceKm,
        sameCounty: sameCounty,
        normaliseCounty: normaliseCounty,
        buildLabel: buildLabel
    };
})();

/* DetectLab — Google Maps directions helper
 * ─────────────────────────────────────────────────────────────────────────
 * Un singur loc care construiește butonul „🧭 Traseu Google Maps” folosit de
 * TOATE popup-urile hărții care desemnează un punct/locație:
 *
 *   • js/lidar-scanner.js   — fiecare punct sugerat de scanare (centrul inelului)
 *   • js/archeo-report.js   — fiecare candidat din Raportul arheologic (centrul inelului)
 *   • js/archeo-potential.js— fiecare bule cu potențial arheologic (centrul bulei)
 *   • js/map-app.js         — pinurile salvate de pe hartă
 *   • js/events.js          — popup-urile evenimentelor
 *
 * IMPORTANT — „în cadrul razelor mai mari, traseul va fi către centrul lor”:
 * toate aceste rezultate sunt cercuri (inel de rezultat LIDAR, bule de
 * potențial, inele de raport). Destinația transmisă Google Maps este ÎNTOTDEAUNA
 * coordonata centrului cercului (același lat/lng cu care cercul a fost desenat),
 * NU un punct de pe marginea lui — indiferent cât de mare este raza. Așa,
 * și pentru o bulă de 50 m și pentru una de 10 km, navigația te duce exact în
 * mijlocul zonei.
 *
 * Link-ul folosește API-ul oficial „Maps URLs” (google.com/maps/dir/?api=1):
 * fără `origin`, Google Maps pornește automat din locația curentă a utilizatorului.
 *
 * Fișierul este intenționat fără dependențe (fără Leaflet, fără fetch), ca să
 * poată fi încărcat devreme în index.html și testat direct în Node
 * (vezi test-gmaps-directions.js).
 */
(function (global) {
    'use strict';

    var DEFAULT_TRAVELMODE = 'driving';
    var DEFAULT_LABEL = 'Traseu Google Maps / Directions';
    var DEFAULT_TITLE = 'Deschide traseul în Google Maps / Open the route in Google Maps';
    var BTN_CLASS = 'dl-gmaps-directions-btn';

    // Coordonate numerice valide; altfel null (popup-urile nu trebuie să spargă
    // navigatea doar pentru că un rând din CSV/un eveniment are lat/lng gol).
    function sanitize(lat, lng) {
        // Number(null) este 0 — iar 0,0 e un punct valid (în Golful Guinea), deci
        // null/undefined trebuie respinse EXPLICIT înainte de conversie.
        if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
        lat = Number(lat);
        lng = Number(lng);
        if (!isFinite(lat) || !isFinite(lng)) return null;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
        return { lat: lat, lng: lng };
    }

    function round6(v) {
        // 6 zecimale ≈ 0.11 m — mai mult decât orice GPS de telefon poate ține,
        // dar suficient de scurt ca URL-ul să rămână lizibil.
        return (Math.round(v * 1e6) / 1e6).toString();
    }

    /* URL de direcții Google Maps, destinație = centrul cercului/pinului.
       Returnează null pentru coordonate invalide. */
    function directionsUrl(lat, lng, travelmode) {
        var c = sanitize(lat, lng);
        if (!c) return null;
        var mode = String(travelmode || DEFAULT_TRAVELMODE);
        // Garden-variety open redirect / injection guard: acceptăm doar
        // valorile suportate de API-ul Maps URLs.
        if (['driving', 'walking', 'bicycling', 'transit'].indexOf(mode) === -1) {
            mode = DEFAULT_TRAVELMODE;
        }
        return 'https://www.google.com/maps/dir/?api=1' +
            '&destination=' + round6(c.lat) + ',' + round6(c.lng) +
            '&travelmode=' + mode;
    }

    /* HTML-ul butonului (anchor real: target="_blank", deci middle-click /
       long-press → „deschide în tab nou” funcționează nativ, fără JS). */
    function buttonHtml(lat, lng, opts) {
        var url = directionsUrl(lat, lng, opts && opts.travelmode);
        if (!url) return '';
        var o = opts || {};
        var label = o.label || DEFAULT_LABEL;
        var title = o.title || DEFAULT_TITLE;
        var cls = BTN_CLASS + (o.className ? ' ' + o.className : '');
        return '<a class="' + cls + '" href="' + url + '" target="_blank" ' +
            'rel="noopener noreferrer" title="' + title + '">' +
            '<span class="dl-gmaps-directions-icon" aria-hidden="true">🧭</span>' +
            '<span class="dl-gmaps-directions-label">' + label + '</span></a>';
    }

    var api = {
        directionsUrl: directionsUrl,
        buttonHtml: buttonHtml
    };

    global.DetectLabDirections = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);

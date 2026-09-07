/* ──────────────────────────────────────────────────────────────
   DetectLab — Mini tutorial (slides)
   ------------------------------------------------------------
   A "?" button in the top-right corner of the map opens a 5-slide
   walkthrough drawn on top of the live UI:

     1. arrows + explanations for every button on the LEFT side
     2. arrows + explanations for every button in the BOTTOM bar
        (PWA bottom bar; falls back to the desktop .map-controls row)
     3. the layers panel: on/off switch, opacity slider, the vertical
        slider on the map, the neon-green "visible on screen" frame
     4. the layer catalogue with GRATIS / PREMIUM tabs
     5. tips for optimal performance

   Everything is purple with a transparent, blurred background.
   Targets are resolved at runtime from the real DOM, so the guide
   automatically adapts to whichever controls exist (PWA vs desktop).
   ────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    // ── i18n helpers ─────────────────────────────────────────────
    function lang() {
        try {
            if (typeof window._currentLang === 'function') {
                var l = window._currentLang();
                return l === 'en' ? 'en' : 'ro';
            }
        } catch (e) { /* storage/priv mode */ }
        return 'ro';
    }

    function tr(o) {
        if (o == null) return '';
        if (typeof o === 'string') return o;
        return o[lang()] || o.ro || o.en || '';
    }

    var UI = {
        help_title:  { ro: 'Ghid rapid', en: 'Quick guide' },
        prev:        { ro: 'Înapoi', en: 'Back' },
        next:        { ro: 'Înainte', en: 'Next' },
        close:       { ro: 'Închide ghidul', en: 'Close guide' },
        finish:      { ro: 'Am înțeles', en: 'Got it' },
        hint:        { ro: 'Atinge oriunde pentru slide-ul următor', en: 'Tap anywhere for the next slide' },
        free_tab:    { ro: 'GRATIS', en: 'FREE' },
        prem_tab:    { ro: 'PREMIUM', en: 'PREMIUM' }
    };

    // ── Slide definitions ────────────────────────────────────────
    // `sel` may be a CSS selector or an array of selectors (first match wins).
    var STEPS = [
        {
            id: 'left',
            title: { ro: 'Butoanele din stânga', en: 'The left-side buttons' },
            type: 'targets',
            placement: 'right',
            targets: [
                {
                    sel: '#detectlab-map .leaflet-control-zoom',
                    title: { ro: 'Zoom + / −', en: 'Zoom + / −' },
                    desc: {
                        ro: 'Mărește sau micșorează harta. Unele straturi apar doar de la un anumit nivel de zoom.',
                        en: 'Zoom the map in or out. Some layers only appear from a certain zoom level.'
                    }
                },
                {
                    sel: '#btnLiveLocation',
                    title: { ro: 'Locația mea', en: 'My location' },
                    desc: {
                        ro: 'Pornește / oprește urmărirea GPS în timp real și centrează harta pe poziția ta.',
                        en: 'Start / stop real-time GPS tracking and centre the map on your position.'
                    }
                },
                {
                    sel: '#btnMeasure',
                    title: { ro: 'Măsurare distanță', en: 'Measure distance' },
                    desc: {
                        ro: 'Atinge puncte pe hartă și afli distanța dintre ele (m / km). Apasă din nou pentru a opri.',
                        en: 'Tap points on the map to get the distance between them (m / km). Press again to stop.'
                    }
                },
                {
                    sel: '#btnCoord',
                    title: { ro: 'Coordonate', en: 'Coordinates' },
                    desc: {
                        ro: 'Alege un punct pe hartă și îi vezi coordonatele exacte; le poți copia, salva ca pin sau crea un eveniment din el.',
                        en: 'Pick a point on the map to see its exact coordinates; you can copy them, save them as a pin, or create an event from it.'
                    }
                },
                {
                    sel: '#btnTrack',
                    title: { ro: 'Înregistrare traseu', en: 'Record trail' },
                    desc: {
                        ro: 'Înregistrează pe hartă traseul parcurs pe teren, cu distanța și durata sesiunii.',
                        en: 'Record the trail you walk in the field on the map, with distance and session time.'
                    }
                },
                {
                    sel: '#detectlab-map .detectlab-compass',
                    title: { ro: 'Busolă & blocare rotire', en: 'Compass & rotation lock' },
                    desc: {
                        ro: 'Arată nordul și readuce harta la 0°. Trage-o în jos pe „LOCK” ca să blochezi rotirea hărții.',
                        en: 'Show north and reset the map to 0°. Drag it down onto “LOCK” to lock map rotation.'
                    }
                }
            ],
            notes: [
                {
                    ico: '📅',
                    text: {
                        ro: '<b>Creare eveniment:</b> cu butonul Coordonate (sau dintr-un pin salvat) marchezi un punct, apoi apeși „Creează un eveniment”. Poți face evenimentul public sau anonim (cu cod de invitație).',
                        en: '<b>Create an event:</b> with the Coordinates button (or from a saved pin) mark a point, then tap “Create event”. You can make it public or anonymous (with an invite code).'
                    }
                },
                {
                    ico: '🎟',
                    text: {
                        ro: '<b>Participare la evenimente:</b> evenimentele publice apar pe hartă ca un coif — atinge-l și trimite o cerere de participare. Pentru evenimente anonime, deschide Contul tău → Evenimente și introdu codul primit.',
                        en: '<b>Join events:</b> public events appear on the map as a helmet — tap it and send a join request. For anonymous events, open Your account → Events and enter the code you were given.'
                    }
                }
            ]
        },
        {
            id: 'bottom',
            title: { ro: 'Bara de jos', en: 'The bottom bar' },
            type: 'targets',
            placement: 'top',
            targets: [
                {
                    sel: ['#pwaDetectWrap', '#detectWrap'],
                    title: { ro: 'Detectare activitate', en: 'Activity detection' },
                    desc: {
                        ro: 'Te avertizează în timp real când te apropii de un sit arheologic sau de zona lui de protecție.',
                        en: 'Get real-time warnings when you approach an archaeological site or its protection zone.'
                    }
                },
                {
                    sel: ['#pwaSavedLocationsBtn', '#savedLocationsBtn'],
                    title: { ro: 'Locații salvate', en: 'Saved locations' },
                    desc: {
                        ro: 'Deschide lista coordonatelor salvate; atinge una și harta sare direct la ea.',
                        en: 'Open the list of saved coordinates; tap one and the map jumps straight to it.'
                    }
                },
                {
                    sel: '#pwaLangItem',
                    title: { ro: 'Limbă', en: 'Language' },
                    desc: {
                        ro: 'Schimbă limba aplicației între română și engleză.',
                        en: 'Switch the app language between Romanian and English.'
                    }
                },
                {
                    sel: ['.pwa-nearby-item', '#nearbyDetectorsBtn'],
                    title: { ro: 'Detectoriști din zonă', en: 'Detectorists nearby' },
                    desc: {
                        ro: 'Vezi ceilalți detectoriști activi în apropiere (necesită detectare + locație live pornite).',
                        en: 'See other detectorists active nearby (requires detection + live location switched on).'
                    }
                },
                {
                    sel: '#pwaUserItem',
                    title: { ro: 'Contul tău', en: 'Your account' },
                    desc: {
                        ro: 'Autentificare, administrarea contului și a abonamentului, evenimente și delogare.',
                        en: 'Log in, manage your account and subscription, events and log out.'
                    }
                },
                {
                    sel: '#fullscreenBtn',
                    title: { ro: 'Ecran complet', en: 'Full screen' },
                    desc: {
                        ro: 'Extinde harta pe tot ecranul.',
                        en: 'Expand the map to the full screen.'
                    }
                }
            ]
        },
        {
            id: 'layers',
            title: { ro: 'Panoul cu straturi', en: 'The layers panel' },
            type: 'targets',
            placement: 'left',
            openPanel: true,
            targets: [
                {
                    sel: ['#transpPanel .transp-layer-row.active .apm-toggle-switch', '#transpPanel .apm-toggle-switch'],
                    title: { ro: 'Switch ON / OFF', en: 'ON / OFF switch' },
                    desc: {
                        ro: 'Pornește sau oprește afișarea stratului pe hartă.',
                        en: 'Turn the layer on or off on the map.'
                    }
                },
                {
                    sel: ['#apmOpacitySlider', '#transpPanel .transp-slider'],
                    title: { ro: 'Slider de opacitate', en: 'Opacity slider' },
                    desc: {
                        ro: 'Reglează transparența stratului, de la 0% la 100%, ca să vezi și ce e dedesubt.',
                        en: 'Adjust the layer transparency from 0% to 100% so you can see what lies beneath.'
                    }
                }
            ],
            notes: [
                {
                    ico: '↕',
                    text: {
                        ro: '<b>Slider vertical pe hartă:</b> dacă apeși pe un strat, sliderul lui de opacitate apare vertical peste hartă, ca să reglezi transparența fără să acoperi zona studiată.',
                        en: '<b>Vertical slider on the map:</b> tapping a layer moves its opacity slider onto the map, vertically, so you can adjust it without covering the area you are studying.'
                    }
                },
                {
                    ico: '<span class="dl-tut-swatch"></span>',
                    text: {
                        ro: '<b>Încadrare verde:</b> fiecare strat care are acoperire pe ecran în acel moment este încadrat cu verde neon — așa știi imediat ce straturi îți sunt utile în zona vizibilă.',
                        en: '<b>Green frame:</b> every layer that has coverage on the current screen is framed in neon green — so you instantly know which layers are useful for the visible area.'
                    }
                }
            ]
        },
        {
            id: 'catalog',
            title: { ro: 'Straturile disponibile', en: 'Available layers' },
            type: 'catalog'
        },
        {
            id: 'performance',
            title: { ro: 'Sfaturi pentru performanță optimă', en: 'Tips for optimal performance' },
            type: 'performance'
        }
    ];

    // ── Layer catalogue (slide 4) ────────────────────────────────
    var CATALOG = {
        free: [
            {
                name: { ro: 'APM Layer', en: 'APM Layer' },
                desc: {
                    ro: 'Model de predicție arheologică bazat pe factori de mediu întâlniți în toate așezările antice încă de la începutul timpurilor. (vezi pe site legenda de culori)',
                    en: 'Archaeological prediction model based on environmental factors found in every ancient settlement since the dawn of time. (see the colour legend on the website)'
                }
            },
            {
                name: { ro: 'Satelit', en: 'Satellite' },
                desc: { ro: 'Stratul de bază.', en: 'The base layer.' }
            },
            {
                name: { ro: 'Localități OSM', en: 'OSM Places' },
                desc: { ro: 'Denumirile localităților.', en: 'The names of the localities.' }
            },
            {
                name: { ro: 'UAT', en: 'UAT' },
                desc: { ro: 'Unități administrativ teritoriale.', en: 'Administrative-territorial units.' }
            },
            {
                name: { ro: 'Patrimoniu', en: 'Heritage' },
                desc: {
                    ro: 'Situri arheologice CIMEC sincronizate zilnic cu baza noastră de date + zona de protecție.',
                    en: 'CIMEC archaeological sites synchronised daily with our database + the protection zone.'
                }
            },
            {
                name: { ro: 'Hărți istorice', en: 'Historical Maps' },
                desc: {
                    ro: 'Conține hărți istorice cu acoperire completă a României + harta Iosefină gratuită care conține foi — când e apăsat butonul „Caută aici” se furnizează foaia aferentă localității văzute pe hartă și se poate alinia corect folosind săgețile.',
                    en: 'Contains historical maps with full coverage of Romania + the free Josephine map made of sheets — pressing the “Search here” button delivers the sheet matching the locality shown on the map, and it can be aligned correctly using the arrows.'
                }
            },
            {
                name: { ro: 'LIDAR', en: 'LIDAR' },
                desc: {
                    ro: 'Light Detection and Ranging — strat laser ce pătrunde prin vegetație și este una dintre cele mai puternice unelte pentru arheologie (conține mai multe straturi de diferite rezoluții și pentru diferite zone).',
                    en: 'Light Detection and Ranging — a laser layer that penetrates vegetation and is one of the most powerful tools in archaeology (it contains several layers of different resolutions and for different areas).'
                }
            }
        ],
        premium: [
            {
                name: { ro: 'Biblioteca din Babel', en: 'Library of Babel' },
                desc: {
                    ro: 'Returnează informații istorice despre localități.',
                    en: 'Returns historical information about localities.'
                }
            },
            {
                name: { ro: 'APM 2.0', en: 'APM 2.0' },
                desc: {
                    ro: 'Model de predicție arheologică bazat pe factori de mediu întâlniți în toate așezările antice încă de la începutul timpurilor. Spre deosebire de APM, folosește informații mult mai precise. Butonul „Ajutor de căutare” / „Search help” poligonizează automat zonele cu cel mai ridicat potențial.',
                    en: 'Archaeological prediction model based on environmental factors found in every ancient settlement since the dawn of time. Unlike APM, it uses far more precise data. The “Search help” button automatically polygonises the areas with the highest potential.'
                }
            },
            {
                name: { ro: 'Imperiul roman', en: 'Roman Empire' },
                desc: {
                    ro: 'Conține toată rețeaua de drumuri imperiale de pe teritoriul României, cât și alte repere importante, precum vile romane, castre, cariere etc.',
                    en: 'Contains the entire network of imperial roads on Romanian territory, as well as other important landmarks such as Roman villas, forts, quarries, etc.'
                }
            },
            {
                name: { ro: 'Bătălii', en: 'Battles' },
                desc: {
                    ro: 'Conține cele mai importante conflicte militare de pe teritoriul României, începând cu sec. VIII î.Hr. până în prezent (folosește sliderul pentru a schimba secolul).',
                    en: 'Contains the most important military conflicts on Romanian territory, from the 8th century BC to the present day (use the slider to change the century).'
                }
            },
            {
                name: { ro: 'Hărți istorice', en: 'Historical maps' },
                desc: {
                    ro: 'Conține hărți istorice atât cu acoperire zonală, cât și totală a României.',
                    en: 'Contains historical maps with both regional and country-wide coverage of Romania.'
                }
            },
            {
                name: { ro: 'Imagini satelitare anii ’60', en: "Satellite imagery 60's" },
                desc: {
                    ro: 'Conține imagini aeriene din anii ’60 cu acoperire parțială a României.',
                    en: 'Contains aerial imagery from the 1960s with partial coverage of Romania.'
                }
            },
            {
                name: { ro: 'LIDAR Scanner', en: 'LIDAR Scanner' },
                desc: {
                    ro: 'Scanează și categorizează anomalii satelitare (alege un punct pe hartă și o arie de căutare, apoi apasă pe butonul de scanare).',
                    en: 'Scans and categorises satellite anomalies (pick a point on the map and a search area, then press the scan button).'
                }
            },
            {
                name: { ro: 'Zone cu potențial arheologic', en: 'Archaeological Potential Sites' }, // reproduces existing UI button spelling (Archeological)
                desc: {
                    ro: 'Se folosește de siturile arheologice existente pentru a triangula și a descoperi zone din proximitatea siturilor cu potențial arheologic (fiecărei zone îi este atribuit un scor).',
                    en: 'Uses the existing archaeological sites to triangulate and discover zones with archaeological potential in their proximity (each zone gets a score).'
                }
            },
            {
                name: { ro: 'Raport arheologic', en: 'Archaeological Report' }, // reproduces existing UI button spelling (Archeological)
                desc: {
                    ro: 'Returnează până la 3 zone cu potențial arheologic, făcând o medie ponderată între rezultatele straturilor APM 2.0, Zone cu potențial arheologic, LIDAR Scanner și Imperiul Roman. Rezultatul final poate fi descărcat ca PDF cu explicații detaliate.',
                    en: 'Returns up to 3 zones with archaeological potential by computing a weighted average of the results from the APM 2.0, Archaeological Potential Sites, LIDAR Scanner and Roman Empire layers. The final result can be downloaded as a PDF with detailed explanations.'
                }
            }
        ]
    };

    var PERF = {
        title: { ro: 'Sfaturi pentru performanță optimă', en: 'Tips for optimal performance' },
        body: {
            ro: 'Straturi precum <b>LIDAR</b> sau <b>Imagini satelitare anii ’60</b> sunt servite de pe web ca servicii <b>WMS</b> și sunt niște straturi foarte dense și detaliate care, deservite simultan, pot bloca temporar aplicația.',
            en: 'Layers such as <b>LIDAR</b> or <b>Satellite imagery 60\'s</b> are served from the web as <b>WMS</b> services and are very dense, highly detailed layers which, when served simultaneously, can temporarily freeze the app.'
        },
        tip: {
            ro: 'Recomandăm ca aceste straturi să fie activate <b>pe rând</b>, pentru cea mai bună experiență posibilă.',
            en: 'We recommend enabling these layers <b>one at a time</b>, for the best possible experience.'
        }
    };

    // ── State ────────────────────────────────────────────────────
    var state = {
        open: false,
        idx: 0,
        tab: 'free',
        openedPanel: false,
        panelTabRestore: null
    };

    var root = null, scrim = null, svg = null, stage = null,
        bar = null, dots = null, titleEl = null,
        btnPrev = null, btnNext = null;

    // ── Small DOM helpers ────────────────────────────────────────
    function el(tag, cls, parent) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (parent) parent.appendChild(n);
        return n;
    }

    function svgEl(tag, parent) {
        var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
        if (parent) parent.appendChild(n);
        return n;
    }

    function pick(sel) {
        var list = Array.isArray(sel) ? sel : [sel];
        for (var i = 0; i < list.length; i++) {
            var n;
            try { n = document.querySelector(list[i]); } catch (e) { n = null; }
            if (n && isVisible(n)) return n;
        }
        return null;
    }

    function isVisible(n) {
        if (!n) return false;
        var r = n.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        var st = window.getComputedStyle(n);
        if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) < 0.05) return false;
        if (n.closest && n.closest('.auth-hidden')) return false;
        return true;
    }

    function vw() { return window.innerWidth || document.documentElement.clientWidth; }
    function vh() { return window.innerHeight || document.documentElement.clientHeight; }

    function isPwa() {
        return !!(document.body && document.body.classList.contains('is-pwa'));
    }

    var TUTORIAL_VIDEO_URL = 'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Tutorial.mp4';

    function stopTutorialVideo() {
        var v = document.getElementById('dlTutVideo');
        if (!v) return;
        try { v.pause(); } catch (e) { /* ignore */ }
    }

    // ── Overlay construction ─────────────────────────────────────
    function build() {
        if (root) return;

        root = el('div', 'dl-tut');
        root.id = 'dlTutorial';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');

        scrim = el('div', 'dl-tut-scrim', root);

        svg = svgEl('svg', root);
        svg.setAttribute('class', 'dl-tut-arrows');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

        stage = el('div', 'dl-tut-stage', root);
        stage.style.cssText = 'position:absolute;inset:0;pointer-events:none;';

        bar = el('div', 'dl-tut-bar', root);

        btnPrev = el('button', 'dl-tut-nav-btn', bar);
        btnPrev.type = 'button';
        btnPrev.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 5 8 12 15 19"/></svg>';
        btnPrev.addEventListener('click', function (e) { e.stopPropagation(); go(state.idx - 1); });

        dots = el('div', 'dl-tut-dots', bar);

        btnNext = el('button', 'dl-tut-nav-btn', bar);
        btnNext.type = 'button';
        btnNext.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 5 16 12 9 19"/></svg>';
        btnNext.addEventListener('click', function (e) { e.stopPropagation(); go(state.idx + 1); });

        el('div', 'dl-tut-sep', bar);

        var btnClose = el('button', 'dl-tut-nav-btn dl-tut-close', bar);
        btnClose.type = 'button';
        btnClose.innerHTML = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
        btnClose.addEventListener('click', function (e) { e.stopPropagation(); close(); });

        titleEl = el('div', 'dl-tut-title', root);

        STEPS.forEach(function (s, i) {
            var d = el('button', 'dl-tut-dot', dots);
            d.type = 'button';
            d.addEventListener('click', function (e) { e.stopPropagation(); go(i); });
        });

        // Advance when tapping the empty (blurred) area.
        scrim.addEventListener('click', function (e) {
            e.stopPropagation();
            go(state.idx + 1);
        });

        // Never let a click inside the guide reach the page underneath
        // (the layers panel closes itself on any outside click).
        root.addEventListener('click', function (e) { e.stopPropagation(); }, false);
        root.addEventListener('mousedown', function (e) { e.stopPropagation(); }, false);
        root.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });

        document.body.appendChild(root);

        window.addEventListener('resize', onResize);
        window.addEventListener('orientationchange', onResize);
        window.addEventListener('scroll', onResize, { passive: true });
        document.addEventListener('detectlab:langchange', function () { if (state.open) render(); });
        document.addEventListener('keydown', function (e) {
            if (!state.open) return;
            if (e.key === 'Escape') { close(); }
            else if (e.key === 'ArrowRight') { go(state.idx + 1); }
            else if (e.key === 'ArrowLeft') { go(state.idx - 1); }
        });
    }

    var resizeTimer = null;
    function onResize() {
        if (!state.open) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(render, 120);
    }

    // ── Layers panel handling (slide 3) ──────────────────────────
    function panelIsOpen() {
        var p = document.getElementById('transpPanel');
        return !!(p && p.classList.contains('open'));
    }

    function ensurePanel(open) {
        var p = document.getElementById('transpPanel');
        if (!p) return;
        if (open && !panelIsOpen()) {
            if (typeof window.toggleTranspPanel === 'function') {
                window.toggleTranspPanel();
                state.openedPanel = true;
            }
            // The guide always demonstrates on the free tab (APM Layer row).
            var freeTab = document.querySelector('.transp-panel-tabs .tab-btn.active');
            state.panelTabRestore = freeTab ? freeTab.getAttribute('data-tab') : null;
            if (state.panelTabRestore && state.panelTabRestore !== 'free' &&
                typeof window.switchLayerTab === 'function') {
                window.switchLayerTab('free');
            }
        } else if (!open && state.openedPanel) {
            if (typeof window.toggleTranspPanel === 'function') window.toggleTranspPanel();
            state.openedPanel = false;
            if (state.panelTabRestore && state.panelTabRestore !== 'free' &&
                typeof window.switchLayerTab === 'function') {
                window.switchLayerTab(state.panelTabRestore);
            }
            state.panelTabRestore = null;
        }
    }

    // ── Geometry helpers ─────────────────────────────────────────
    function roundRectPath(x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        return 'M' + (x + r) + ',' + y +
            'h' + (w - 2 * r) +
            'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r +
            'v' + (h - 2 * r) +
            'a' + r + ',' + r + ' 0 0 1 ' + (-r) + ',' + r +
            'h' + (-(w - 2 * r)) +
            'a' + r + ',' + r + ' 0 0 1 ' + (-r) + ',' + (-r) +
            'v' + (-(h - 2 * r)) +
            'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + (-r) + 'z';
    }

    /* Punch the highlighted controls out of the blurred scrim so they
       stay perfectly sharp while everything else is blurred. */
    function applyScrimHoles(rects) {
        if (!scrim) return;
        if (!rects.length) { scrim.style.clipPath = ''; scrim.style.webkitClipPath = ''; return; }
        var d = 'M0,0H' + vw() + 'V' + vh() + 'H0Z';
        rects.forEach(function (r) {
            d += roundRectPath(r.x, r.y, r.w, r.h, 10);
        });
        var val = 'path(evenodd, "' + d + '")';
        scrim.style.clipPath = val;
        scrim.style.webkitClipPath = val;
    }

    /* Sequential packing of boxes inside [minY, maxY]. */
    function packVertical(items, minY, maxY, gap) {
        items.sort(function (a, b) { return a.pref - b.pref; });
        var y = minY;
        items.forEach(function (it) {
            it.y = Math.max(it.pref, y);
            y = it.y + it.h + gap;
        });
        if (y - gap > maxY) {
            var yy = maxY;
            for (var i = items.length - 1; i >= 0; i--) {
                items[i].y = Math.min(items[i].y, yy - items[i].h);
                yy = items[i].y - gap;
            }
            var yy2 = minY;
            for (var j = 0; j < items.length; j++) {
                if (items[j].y < yy2) items[j].y = yy2;
                yy2 = items[j].y + items[j].h + gap;
            }
        }
    }

    /* Point on the border of `box` in the direction of (tx, ty). */
    function edgePoint(box, tx, ty) {
        var cx = box.x + box.w / 2, cy = box.y + box.h / 2;
        var dx = tx - cx, dy = ty - cy;
        if (!dx && !dy) return { x: cx, y: cy };
        var sx = dx !== 0 ? (box.w / 2) / Math.abs(dx) : Infinity;
        var sy = dy !== 0 ? (box.h / 2) / Math.abs(dy) : Infinity;
        var s = Math.min(sx, sy);
        return { x: cx + dx * s, y: cy + dy * s };
    }

    function drawArrow(start, target) {
        var end = edgePoint(target, start.x, start.y);
        // stop a few px before the ring
        var vx = end.x - start.x, vy = end.y - start.y;
        var len = Math.sqrt(vx * vx + vy * vy) || 1;
        end = { x: end.x - (vx / len) * 9, y: end.y - (vy / len) * 9 };

        // gentle curve, perpendicular offset proportional to length
        var mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
        var off = Math.min(26, len * 0.18);
        var ctrl = { x: mx - (vy / len) * off, y: my + (vx / len) * off };

        var path = svgEl('path', svg);
        path.setAttribute('class', 'dl-tut-arrow-path');
        path.setAttribute('d', 'M' + start.x + ',' + start.y + ' Q' + ctrl.x + ',' + ctrl.y + ' ' + end.x + ',' + end.y);

        // arrow head, oriented along the tangent at the end point
        var ang = Math.atan2(end.y - ctrl.y, end.x - ctrl.x);
        var s = 8;
        var p1 = end;
        var p2 = { x: end.x - s * Math.cos(ang - 0.42), y: end.y - s * Math.sin(ang - 0.42) };
        var p3 = { x: end.x - s * Math.cos(ang + 0.42), y: end.y - s * Math.sin(ang + 0.42) };
        var head = svgEl('polygon', svg);
        head.setAttribute('class', 'dl-tut-arrow-head');
        head.setAttribute('points', p1.x + ',' + p1.y + ' ' + p2.x + ',' + p2.y + ' ' + p3.x + ',' + p3.y);
    }

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    /* Where the arrow leaves its callout, depending on which side of the
       highlighted control the callout column sits on. */
    function anchorFor(placement, box, target) {
        var tcx = target.x + target.w / 2;
        if (placement === 'top')   return { x: clamp(tcx, box.x + 16, box.x + box.w - 16), y: box.y + box.h };
        if (placement === 'below') return { x: clamp(tcx, box.x + 16, box.x + box.w - 16), y: box.y };
        if (placement === 'left')  return { x: box.x + box.w, y: box.y + box.h / 2 };
        return { x: box.x, y: box.y + box.h / 2 }; // 'right'
    }

    function addRing(r, num) {
        var pad = 5;
        var n = el('div', 'dl-tut-ring', stage);
        n.style.left = (r.x - pad) + 'px';
        n.style.top = (r.y - pad) + 'px';
        n.style.width = (r.w + pad * 2) + 'px';
        n.style.height = (r.h + pad * 2) + 'px';
        if (num != null) {
            var badge = el('span', 'dl-tut-ring-num', n);
            badge.textContent = String(num);
        }
        return n;
    }

    // ── Rendering ────────────────────────────────────────────────
    function clearStage() {
        stopTutorialVideo();
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        stage.innerHTML = '';
        scrim.style.clipPath = '';
        scrim.style.webkitClipPath = '';
        root.classList.remove('compact');
    }

    function render() {
        if (!root) return;
        var step = STEPS[state.idx];
        clearStage();

        svg.setAttribute('viewBox', '0 0 ' + vw() + ' ' + vh());

        titleEl.innerHTML = (state.idx + 1) + '/' + STEPS.length + ' · ' + tr(step.title);
        btnPrev.disabled = state.idx === 0;
        btnNext.disabled = state.idx === STEPS.length - 1;
        btnPrev.title = tr(UI.prev);
        btnNext.title = tr(UI.next);
        Array.prototype.forEach.call(dots.children, function (d, i) {
            d.classList.toggle('active', i === state.idx);
            d.setAttribute('aria-label', String(i + 1));
        });

        // The layers panel is only needed on its own slide.
        ensurePanel(!!step.openPanel);

        // Panel opening is animated — give it a frame before measuring.
        if (step.openPanel) {
            setTimeout(function () { if (state.open && STEPS[state.idx] === step) paint(step); }, 240);
        }
        paint(step);
    }

    function paint(step) {
        clearStage();
        svg.setAttribute('viewBox', '0 0 ' + vw() + ' ' + vh());

        if (step.type === 'targets') paintTargets(step);
        else if (step.type === 'catalog') paintCatalog(step);
        else if (step.type === 'performance') paintPerformance(step);
    }

    function barBottom() {
        var r = bar.getBoundingClientRect();
        var t = titleEl.getBoundingClientRect();
        return Math.max(r.bottom, t.bottom) + 10;
    }

    function paintTargets(step) {
        var found = [];
        step.targets.forEach(function (t) {
            var node = pick(t.sel);
            if (!node) return;
            var ringNode = node;
            if (t.ring) {
                var closest = node.closest ? node.closest(t.ring) : null;
                ringNode = closest || (node.parentNode && node.parentNode.querySelector ? (node.parentNode.querySelector(t.ring) || node) : node);
            }
            var r = ringNode.getBoundingClientRect();
            found.push({
                def: t,
                rect: { x: r.left, y: r.top, w: r.width, h: r.height }
            });
        });

        if (!found.length) {
            var empty = el('div', 'dl-tut-note', stage);
            empty.style.cssText += 'left:50%;top:50%;transform:translate(-50%,-50%);width:min(320px,calc(100% - 32px));text-align:center;';
            empty.innerHTML = lang() === 'en'
                ? 'These controls are not available on this screen.'
                : 'Aceste butoane nu sunt disponibile pe acest ecran.';
            return;
        }

        var top = barBottom();
        var bottom = vh() - 12;
        var placement = step.placement;

        // Union of every target — used by the "below" placement.
        var uni = found.reduce(function (a, f) {
            return {
                x1: Math.min(a.x1, f.rect.x),
                y1: Math.min(a.y1, f.rect.y),
                x2: Math.max(a.x2, f.rect.x + f.rect.w),
                y2: Math.max(a.y2, f.rect.y + f.rect.h)
            };
        }, { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });

        // On narrow screens there is no usable room beside the layers panel,
        // so the callouts drop underneath the highlighted row instead.
        if (placement === 'left' && (uni.x1 - 30) < 190) placement = 'below';

        // PWA bottom bar: number each button left-to-right so the callout
        // clearly maps to its control even when arrows cross.
        var numberBar = placement === 'top' && isPwa();
        var nums = [];
        if (numberBar) {
            found.map(function (f, i) { return i; })
                .sort(function (a, b) { return found[a].rect.x - found[b].rect.x; })
                .forEach(function (idx, n) { nums[idx] = n + 1; });
        }

        // Build the callouts first so we can measure their heights.
        var boxes = found.map(function (f, i) {
            var c = el('div', 'dl-tut-callout', stage);
            var numHtml = numberBar && nums[i]
                ? '<span class="dl-tut-c-num">' + nums[i] + '</span>'
                : '';
            c.innerHTML =
                '<span class="dl-tut-c-title">' + numHtml + tr(f.def.title) + '</span>' +
                '<span class="dl-tut-c-desc">' + tr(f.def.desc) + '</span>';
            return { node: c, f: f, num: nums[i] || null };
        });

        if (numberBar) root.classList.add('compact');

        var note = null;
        if (step.notes && step.notes.length) {
            note = el('div', 'dl-tut-note', stage);
            note.innerHTML = step.notes.map(function (n) {
                return '<div class="dl-tut-note-item"><span class="dl-tut-note-ico">' + n.ico + '</span><span>' + tr(n.text) + '</span></div>';
            }).join('');
        }

        // ── Column geometry ──
        var colX, colW;
        if (placement === 'right') {
            var maxRight = Math.max.apply(null, found.map(function (f) { return f.rect.x + f.rect.w; }));
            colX = Math.min(maxRight + 18, vw() * 0.36);
            colW = Math.min(300, vw() - colX - 12);
            if (colW < 150) { colX = 12; colW = vw() - 24; }
        } else if (placement === 'left') {
            colW = Math.min(300, Math.max(150, uni.x1 - 30));
            colX = Math.max(12, uni.x1 - colW - 18);
        } else if (placement === 'below') {
            colW = Math.min(360, vw() - 24);
            colX = Math.max(12, Math.min((uni.x1 + uni.x2) / 2 - colW / 2, vw() - colW - 12));
        } else { // 'top' — bottom bar
            colW = Math.min(340, vw() - 24);
            colX = (vw() - colW) / 2;
        }

        boxes.forEach(function (b) {
            b.node.style.left = colX + 'px';
            b.node.style.width = colW + 'px';
        });
        if (note) {
            note.style.left = colX + 'px';
            note.style.width = colW + 'px';
        }

        // Measure — shrink everything if the column would not fit.
        function totalHeight() {
            var t = 0;
            boxes.forEach(function (b) { t += b.node.offsetHeight; });
            if (note) t += note.offsetHeight + 10;
            return t + (boxes.length - 1) * 8;
        }

        var minTargetTop = uni.y1;
        var avail;
        if (placement === 'top') avail = (minTargetTop - 16) - top;
        else if (placement === 'below') avail = bottom - Math.max(top, uni.y2 + 24);
        else avail = bottom - top;

        if (totalHeight() > avail) root.classList.add('compact');

        // ── Vertical placement ──
        var items = boxes.map(function (b) {
            var h = b.node.offsetHeight;
            var pref;
            if (placement === 'top' || placement === 'below') pref = 0; // resolved below
            else pref = b.f.rect.y + b.f.rect.h / 2 - h / 2;
            return { box: b, h: h, pref: pref };
        });

        var noteH = note ? note.offsetHeight : 0;

        if (placement === 'top') {
            // Order the callouts left-to-right by the x of their target and
            // stack them upwards from just above the bar.
            var lowerBound = Math.max(top, minTargetTop - 16);
            items.sort(function (a, b) { return a.box.f.rect.x - b.box.f.rect.x; });

            if (numberBar && items.length >= 2) {
                // Two columns above the PWA bar: left buttons → left column,
                // right buttons → right column. Arrows stay mostly vertical.
                var split = Math.ceil(items.length / 2);
                var leftCol = items.slice(0, split);
                var rightCol = items.slice(split);
                var colW2 = Math.min(200, Math.max(136, Math.floor((vw() - 24) / 2)));
                var leftX = 8;
                var rightX = vw() - colW2 - 8;

                function layoutBarCol(col, x) {
                    col.forEach(function (it) {
                        it.x = x;
                        it.w = colW2;
                        it.box.node.style.left = x + 'px';
                        it.box.node.style.width = colW2 + 'px';
                    });
                    col.forEach(function (it) { it.h = it.box.node.offsetHeight; });
                    var yy = lowerBound;
                    for (var ci = col.length - 1; ci >= 0; ci--) {
                        yy -= col[ci].h;
                        col[ci].y = yy;
                        yy -= 6;
                    }
                    if (col.length && col[0].y < top) {
                        var sh = top - col[0].y;
                        col.forEach(function (it) { it.y += sh; });
                    }
                }
                layoutBarCol(leftCol, leftX);
                layoutBarCol(rightCol, rightX);
            } else {
                var y = lowerBound;
                for (var i = items.length - 1; i >= 0; i--) {
                    y -= items[i].h;
                    items[i].y = y;
                    y -= 8;
                }
                if (items.length && items[0].y < top) {
                    var shift = top - items[0].y;
                    items.forEach(function (it) { it.y += shift; });
                }
            }
        } else if (placement === 'below') {
            // Stack downwards, starting just under the highlighted controls.
            items.sort(function (a, b) { return a.box.f.rect.y - b.box.f.rect.y; });
            var yb = Math.max(top, uni.y2 + 26);
            items.forEach(function (it) {
                it.y = yb;
                yb += it.h + 8;
            });
            var overflow = (yb - 8 + (noteH ? noteH + 10 : 0)) - bottom;
            if (overflow > 0) {
                items.forEach(function (it) { it.y = Math.max(top, it.y - overflow); });
            }
        } else {
            var maxY = bottom - (noteH ? noteH + 10 : 0);
            packVertical(items, top, maxY, 8);
        }

        items.forEach(function (it) {
            if (it.x == null) { it.x = colX; it.w = colW; }
            it.box.node.style.top = Math.round(it.y) + 'px';
        });

        if (note) {
            var lastBottom = items.reduce(function (m, it) { return Math.max(m, it.y + it.h); }, top);
            note.style.top = Math.round(Math.min(lastBottom + 10, bottom - noteH)) + 'px';
        }

        // ── Rings, holes and arrows ──
        var holes = [];
        found.forEach(function (f, fi) {
            addRing(f.rect, numberBar ? nums[fi] : null);
            holes.push({ x: f.rect.x - 5, y: f.rect.y - 5, w: f.rect.w + 10, h: f.rect.h + 10 });
        });
        applyScrimHoles(holes);

        items.forEach(function (it) {
            var box = { x: it.x, y: it.y, w: it.w, h: it.h };
            drawArrow(anchorFor(placement, box, it.box.f.rect), it.box.f.rect);
        });
    }

    function cardShell(extraClass) {
        var top = barBottom();
        var card = el('div', 'dl-tut-card' + (extraClass ? ' ' + extraClass : ''), stage);
        card.style.pointerEvents = 'auto';
        card.style.top = top + 'px';
        card.style.maxHeight = (vh() - top - 16) + 'px';
        card.addEventListener('click', function (e) { e.stopPropagation(); });
        return card;
    }

    function paintCatalog(step) {
        var card = cardShell();

        var tabs = el('div', 'dl-tut-card-tabs', card);
        var body = el('div', 'dl-tut-card-body', card);

        function fill() {
            var list = CATALOG[state.tab] || [];
            body.innerHTML = list.map(function (l) {
                return '<div class="dl-tut-layer">' +
                    '<span class="dl-tut-layer-name">' + tr(l.name) + '</span>' +
                    '<span class="dl-tut-layer-desc">' + tr(l.desc) + '</span>' +
                    '</div>';
            }).join('');
            body.scrollTop = 0;
        }

        [['free', UI.free_tab, ''], ['premium', UI.prem_tab, ' premium']].forEach(function (t) {
            var b = el('button', 'dl-tut-tab' + t[2] + (state.tab === t[0] ? ' active' : ''), tabs);
            b.type = 'button';
            b.textContent = tr(t[1]);
            b.addEventListener('click', function (e) {
                e.stopPropagation();
                state.tab = t[0];
                Array.prototype.forEach.call(tabs.children, function (n, i) {
                    n.classList.toggle('active', (i === 0) === (t[0] === 'free'));
                });
                fill();
            });
        });

        fill();

        // The body must scroll inside the fixed-height card.
        requestAnimationFrame(function () {
            var used = tabs.offsetHeight + 12 + 28;
            body.style.maxHeight = Math.max(120, (vh() - card.getBoundingClientRect().top - 16) - used) + 'px';
        });
    }

    function paintPerformance(step) {
        var card = cardShell('dl-tut-card-perf');
        var body = el('div', 'dl-tut-card-body', card);
        body.innerHTML =
            '<div class="dl-tut-perf-layout">' +
                '<div class="dl-tut-perf">' +
                    '<span class="dl-tut-perf-ico">⚡</span>' +
                    '<div>' +
                        '<span class="dl-tut-layer-name" style="margin-bottom:6px">' + tr(PERF.title) + '</span>' +
                        '<p>' + tr(PERF.body) + '</p>' +
                        '<span class="dl-tut-tip">' + tr(PERF.tip) + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="dl-tut-perf-video">' +
                    '<video id="dlTutVideo" playsinline webkit-playsinline controls preload="metadata">' +
                        '<source src="' + TUTORIAL_VIDEO_URL + '" type="video/mp4">' +
                    '</video>' +
                '</div>' +
            '</div>';

        var fin = el('button', 'dl-tut-finish', card);
        fin.type = 'button';
        fin.textContent = tr(UI.finish);
        fin.addEventListener('click', function (e) { e.stopPropagation(); close(); });

        requestAnimationFrame(function () {
            var used = fin.offsetHeight + 14 + 28;
            body.style.maxHeight = Math.max(120, (vh() - card.getBoundingClientRect().top - 16) - used) + 'px';
        });
    }

    // ── Public API ───────────────────────────────────────────────
    function go(i) {
        if (i < 0) return;
        if (i >= STEPS.length) { close(); return; }
        state.idx = i;
        render();
    }

    function open(startIndex) {
        build();
        state.open = true;
        state.idx = typeof startIndex === 'number' ? startIndex : 0;
        root.classList.add('open');

        // On the website (non-PWA) the map can be scrolled half out of view —
        // bring it fully on screen so every arrow has a visible target.
        var frame = document.querySelector('.map-frame');
        if (frame && !document.body.classList.contains('is-pwa')) {
            var r = frame.getBoundingClientRect();
            if (r.top < 0 || r.bottom > vh()) {
                try { frame.scrollIntoView({ block: 'center' }); } catch (e) { frame.scrollIntoView(); }
            }
        }

        render();
        // A second pass after the scroll/paint settles keeps the arrows exact.
        requestAnimationFrame(function () { if (state.open) render(); });
    }

    function close() {
        if (!root) return;
        ensurePanel(false);
        state.open = false;
        root.classList.remove('open');
        clearStage();
    }

    window.openMapTutorial = function (i) { open(i); };
    window.closeMapTutorial = close;

    // Keep the "?" button label localised.
    function syncBtn() {
        var b = document.getElementById('mapHelpBtn');
        if (!b) return;
        b.title = tr(UI.help_title);
        b.setAttribute('aria-label', tr(UI.help_title));
    }

    document.addEventListener('detectlab:langchange', syncBtn);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', syncBtn);
    } else {
        syncBtn();
    }
})();

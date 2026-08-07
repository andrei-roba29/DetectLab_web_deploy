        // ── TRANSLATIONS ──
        const translations = {
            en: {
                nav_apm: 'What is APM', nav_map: 'Explore Map', nav_how: 'How it Works', nav_pricing: 'Pricing', nav_cta: 'Get Access',
                hero_badge: 'Archaeology × Artificial Intelligence', hero_tagline: 'Saving History Together',
                hero_desc: 'An Archaeological Prediction Model that automatically identifies high-potential zones for ancient settlements — using topographic, geological, and hydrographic data collected since the dawn of civilization.',
                hero_btn1: '🗺 Explore the Map', hero_btn2: 'View Membership Plans', scroll: 'Scroll to discover',
                what_label: 'Technology', what_title: 'What is an <span class="hl">Archaeological Prediction Model</span>?',
                what_desc: 'Think of it as a smart map that reads the landscape like an archaeologist. Instead of spending years walking fields and digging randomly, the APM analyzes thousands of environmental variables to tell you: <em>here is where people lived.</em>',
                card1_title: '🏔 Topographic Analysis', card1_desc: 'Elevation, slope and terrain relief — ancient settlements preferred defensible high ground and gentle southern slopes close to resources.',
                card2_title: '💧 Hydrographic Proximity', card2_desc: 'Distance to rivers, springs and wetlands — every civilization in history settled within reach of fresh water. The model maps those ancient corridors.',
                card3_title: '🪨 Geological Conditions', card3_desc: 'Soil fertility, substrate stability and mineral availability — factors that drove human migration and permanent settlement for 10,000 years.',
                leg5: 'Score 5.0 — Very High Potential', leg4: 'Score 4.0 — High Potential', leg3: 'Score 3.1 — Moderate Potential', leg2: 'Score 2.1 — Low Potential', leg1: 'Score 1.2 — Minimal Potential',
                apm20_leg5: 'Score 5 — Very High Potential', apm20_leg4: 'Score 4.5 — High Potential', apm20_leg3: 'Score 4 — Moderate Potential', apm20_leg2: 'Score 3 — Low Potential', apm20_leg2b: 'Score 2 — Minimal Potential', apm20_leg1: 'Score 1 — No Potential',
                map_label: 'Live Map', map_title: 'Explore the <span class="hl">APM Layer</span>',
                tab_free: '🔓 Free Preview', tab_member: '🔐 Members Map',
                manage_account: 'Manage Account',
                nav_events: 'Events', nav_logout: 'Log Out',
                lock_title: 'Members-Only Map', lock_desc: 'Subscribe to unlock full-resolution APM layers, advanced filters, and export tools.', lock_btn: 'View Plans',
                apm_score: 'APM Score:',
                how_label: 'Process', how_title: 'How <span class="hl">DetectLab</span> Works',
                step1_title: 'Data Collection', step1_desc: 'We aggregate topographic, hydrographic and geological datasets from national and international sources.',
                step2_title: 'QGIS Modeling', step2_desc: 'Layers are processed and weighted inside QGIS using spatial algorithms.',
                step3_title: 'Scoring & Classification', step3_desc: 'Every zone receives an APM score from 1 to 5.0 representing its probability of containing buried archaeological remains.',
                step4_title: 'Interactive Map', step4_desc: 'Results are published as an interactive web map overlaid on satellite imagery — ready for researchers, institutions and enthusiasts.',
                pricing_label: 'Membership', pricing_title: 'Choose Your <span class="hl">Plan</span>', pricing_desc: "Whether you're a hobbyist, a researcher, or an institution — DetectLab has a plan for you.",
                lbl_weekly: 'Weekly', lbl_monthly: 'Monthly', save_badge: 'Save up to 45%',
                tier_bronze: 'Bronze', tier_silver: 'Silver', tier_gold: 'Gold',
                plan_weekly: 'Weekly', plan_monthly: 'Monthly', plan_yearly: 'Yearly',
                note_weekly: 'Billed weekly', note_monthly: 'Billed monthly', note_yearly: 'Billed annually — save 45%',
                badge_popular: 'Most Popular',
                f_map: 'Full APM interactive map', f_sat: 'Satellite + APM overlay', f_legend: 'Score legend & zone info',
                f_export: 'Export data (GeoJSON, KMZ)', f_filters: 'Advanced layer filters', f_api: 'API access', f_api_plus: 'API access + priority support',
                btn_bronze: 'Buy', btn_silver: 'Buy', btn_gold: 'Buy',
                free_title: 'Free — Always Available', free_desc: 'Explore a limited preview of the APM map, read about the methodology and learn what archaeological prediction can do for research.', free_btn: 'Explore Free Map',
                f_product: 'Product', f_resources: 'Resources', f_contact: 'Contact',
                f_method: 'Methodology', f_docs: 'Documentation', f_papers: 'Research Papers', f_qgis: 'QGIS Project',
                f_about: 'About Us', f_partner: 'contact@detectlab.ro', f_press: 'Press',
                get_app_label: 'Mobile App',
                get_app_title: 'Get the <span class="hl">DetectLab</span> App',
                get_app_desc: 'Install the application on your mobile device for quick access to the prediction model.',
                btn_android: 'Android App',
                btn_ios: 'iOS App',
                footer_desc: 'Saving history together!',
                f_rights: 'All rights reserved.', f_built: 'Built with QGIS · OpenLayers · passion for the past',
                layer_opacity: 'Layer Opacity',
                layer_satellite: 'Satellite',
                layer_osm_places: 'OSM Places',
                layer_uat: 'UAT',
                layer_heritage: 'Heritage',
                heritage_legend_title: 'Legend',
                heritage_legend_red: 'Sites with correct coordinates',
                heritage_legend_green: 'Sites with approximate coordinates',
                heritage_legend_yellow: 'Tumulus',
                layer_opacity_label: 'Opacity',
                layer_roman: 'Roman Empire',
                layer_roads: 'Roads',
                layer_vici_sites: 'Roman Sites (DARE)',
                layer_dare_11: 'Major Settlements',
                layer_dare_17: 'Major Forts',
                layer_dare_13: 'Civitas Capitals',
                layer_dare_12: 'Regular Settlements',
                layer_dare_18: 'Forts/Castrum',
                layer_dare_53: 'Fortlets/Towers',
                layer_dare_16: 'Roads/Coastal Stations',
                layer_dare_61: 'Sanctuaries/Temples',
                layer_dare_66: 'Baths',
                layer_dare_32: 'Tumuli',
                layer_dare_63: 'Cemeteries',
                layer_dare_21: 'Monasteries',
                layer_dare_24: 'Churches',
                layer_dare_14: 'Villas',
                layer_dare_57: 'Mines/Quarries',
                layer_dare_49: 'Passes',
                layer_dare_51: 'Bridges',
                layer_dare_55: 'Roads/Milestones',
                layer_dare_52: 'Aqueducts',
                layer_dare_64: 'Monuments',
                layer_urban_areas: 'Urban Areas',
                layer_aqueducts: 'Aqueducts',
                layer_walls: 'Walls',
                layer_regional_names: 'Regional Names',
                layer_political_shading: 'Political Shading',
                layer_re_117: 'RE 117 CE',
                layer_re_60bce: 'RE 60 BCE',
                layer_re_200: 'RE 200 CE',
                layer_alexander: "Alexander's Empire",
                layer_persian: 'Persian Empire',
                layer_diocletian: 'Prov. after Diocletian',
                layer_historical: 'Historical Maps',
                layer_historical_premium: 'Historical maps',
                layer_josephine: 'Josephine Map +',
                layer_iosfree: 'Josephine Map',
                layer_austrian: 'Austrian Map 1910',
                layer_firingplans: 'Firing Plans',
                layer_sovietmap: "Soviet Map 1970's",
                layer_bucovina: 'Bucovina 1861-1864',
                layer_austrohu: 'Austro-Hungarian Map (1861-1864)',
                layer_moldova1868: 'Moldova 1868',
                layer_moldovawwii: 'Moldova WWII',
                layer_polishtactical1933: 'Tactical Polish Map 1933',
                layer_ww1: 'WWI',
                layer_ww2: 'WWII',
                layer_satellite60s: "Satellite imagery 60's",
                sat60_load_here: 'Load images here',
                sat60_zoom_more: 'Zoom in more',
                sat60_load_title: 'Load 1960s imagery for the visible area only',
                sat60_loading: 'Loading 1960s imagery for the visible area…',
                sat60_found: 'Loaded {n} tile(s) — 1960s imagery is available here',
                sat60_no_images: 'No images here',
                sat60_error: 'Could not load the imagery, please try again.',
                sat60_not_ready: 'The satellite layer is still loading… please try again in a few seconds.',
                sat60_zoom_hint: 'Zoom in to level 11 or more to load images here.',
                layer_banat: 'Banat - 1769-1772',
                layer_archeo_potential: 'Archeological Potential Sites',
                archeo_desc: 'Statistical analysis · 10 km radius',
                archeo_run_btn: 'Candidate Areas',
                archeo_run_running: 'Analyzing…',
                archeo_status_ready: 'Press the button to analyze the current 10 km radius.',
                archeo_legend_medium: 'Medium Potential',
                archeo_legend_high: 'High Potential',
                archeo_hint: 'Candidates = gaps between known sites, inside the UAT red zone, ≥ 700 m from every site.',
                archeo_show_label: 'Show results',
                
                
                iosfree_hint: 'Search or zoom into a locality',
                iosfree_loading: 'Loading image…',
                iosfree_notfound: 'No map found for this locality',
                iosfree_zoom: 'Zoom ≥ 13 or search a locality to activate',
                iosfree_search_btn: 'Search here',
                hist_zoom_hint: 'Zoom in to see map',
                apm20_search_help: 'Search Help',
                apm20_search_help_loading: 'Analyzing visible area…',
                apm20_search_help_empty: 'No clear high-potential zones found in the visible area',
                apm20_search_help_error: 'Could not analyze the visible area, please try again',
                apm20_search_help_zoom: 'Zoom in more to use Search Help',
                apm20_search_help_hint: 'Zoom in for advanced search',
                ios_bld_search_help: 'Vanished Buildings',
                ios_bld_search_help_loading: 'Analyzing Josephine Map +…',
                ios_bld_search_help_empty: 'No vanished building zones found in visible area',
                ios_bld_search_help_error: 'Enable Josephine Map + layer first',
                ios_bld_search_help_hint: 'Zoom in more',
                ios_bld_search_help_zoom: 'Zoom in more',
                ios_bld_search_help_zoom_in: 'Zoom in more',
                ios_bld_search_help_zoom_out: 'Zoom out more',
            },
            ro: {
                nav_apm: 'Ce este APM', nav_map: 'Explorează Harta', nav_how: 'Cum Funcționează', nav_pricing: 'Prețuri', nav_cta: 'Obține Acces',
                hero_badge: 'Arheologie × Inteligență Artificială', hero_tagline: 'Salvăm Istoria Împreună',
                hero_desc: 'Un Model de Predicție Arheologică care identifică automat zonele cu potențial ridicat pentru așezări antice — folosind date topografice, geologice și hidrografice colectate de la începuturile civilizației.',
                hero_btn1: '🗺 Explorează Harta', hero_btn2: 'Vezi Planurile de Abonament', scroll: 'Derulează pentru a descoperi',
                what_label: 'Tehnologie', what_title: 'Ce este un <span class="hl">Model de Predicție Arheologică</span>?',
                what_desc: 'Gândește-l ca pe o hartă inteligentă care citește peisajul ca un arheolog. În loc să petreci ani întregi mergând prin câmpuri și săpând aleatoriu, APM-ul analizează mii de variabile de mediu pentru a-ți spune: <em>aici au trăit oamenii.</em>',
                card1_title: '🏔 Analiză Topografică', card1_desc: 'Altitudine, pantă și relief — așezările antice preferau terenuri înalte, ușor apărabile și pante sudice blânde, aproape de resurse.',
                card2_title: '💧 Proximitate Hidrografică', card2_desc: 'Distanța față de râuri, izvoare și zone umede — fiecare civilizație din istorie s-a așezat în apropierea apei dulci. Modelul cartografiază aceste coridoare antice.',
                card3_title: '🪨 Condiții Geologice', card3_desc: 'Fertilitatea solului, stabilitatea substratului și disponibilitatea mineralelor — factori care au determinat migrațiile umane și așezările permanente timp de 10.000 de ani.',
                leg5: 'Scor 5.0 — Potențial Foarte Ridicat', leg4: 'Scor 4.0 — Potențial Ridicat', leg3: 'Scor 3.1 — Potențial Moderat', leg2: 'Scor 2.1 — Potențial Scăzut', leg1: 'Scor 1.2 — Potențial Minimal',
                apm20_leg5: 'Scor 5 — Potențial Foarte Ridicat', apm20_leg4: 'Scor 4.5 — Potențial Ridicat', apm20_leg3: 'Scor 4 — Potențial Moderat', apm20_leg2: 'Scor 3 — Potențial Scăzut', apm20_leg2b: 'Scor 2 — Potențial Minimal', apm20_leg1: 'Scor 1 — Fără Potențial',
                map_label: 'Hartă Live', map_title: 'Explorează <span class="hl">Stratul APM</span>',
                tab_free: '🔓 Previzualizare Gratuită', tab_member: '🔐 Harta Membrilor',
                manage_account: 'Gestionează Contul',
                nav_events: 'Evenimente', nav_logout: 'Deconectare',
                lock_title: 'Hartă Exclusivă Membrilor', lock_desc: 'Abonează-te pentru a debloca straturi APM la rezoluție completă, filtre avansate și instrumente de export.', lock_btn: 'Vezi Planuri',
                apm_score: 'Scor APM:',
                how_label: 'Proces', how_title: 'Cum Funcționează <span class="hl">DetectLab</span>',
                step1_title: 'Colectare Date', step1_desc: 'Agregăm seturi de date topografice, hidrografice și geologice din surse naționale și internaționale.',
                step2_title: 'Modelare în QGIS', step2_desc: 'Straturile sunt procesate și ponderate în QGIS folosind algoritmi spațiali.',
                step3_title: 'Atribuire scor și Clasificare', step3_desc: 'Fiecare zonă primește un scor APM de la 1 la 5.0 reprezentând probabilitatea de a conține vestigii arheologice îngropate.',
                step4_title: 'Hartă Interactivă', step4_desc: 'Rezultatele sunt publicate ca hartă web interactivă suprapusă pe imagini satelitare — gata pentru cercetători, instituții și entuziaști.',
                pricing_label: 'Abonament', pricing_title: 'Alege <span class="hl">Planul Tău</span>', pricing_desc: 'Fie că ești amator, cercetător sau instituție — DetectLab are un plan pentru tine.',
                lbl_weekly: 'Săptămânal', lbl_monthly: 'Lunar', save_badge: 'Economisești până la 45%',
                tier_bronze: 'Bronz', tier_silver: 'Argint', tier_gold: 'Aur',
                plan_weekly: 'Săptămânal', plan_monthly: 'Lunar', plan_yearly: 'Anual',
                note_weekly: 'Facturat săptămânal', note_monthly: 'Facturat lunar', note_yearly: 'Facturat anual — economisești 45%',
                badge_popular: 'Cel Mai Popular',
                f_map: 'Hartă APM interactivă completă', f_sat: 'Suprapunere satelit + APM', f_legend: 'Legendă scoruri & info zone',
                f_export: 'Export date (GeoJSON, KMZ)', f_filters: 'Filtre avansate de straturi', f_api: 'Acces API', f_api_plus: 'Acces API + suport prioritar',
                btn_bronze: 'Cumpără', btn_silver: 'Cumpără', btn_gold: 'Cumpără',
                free_title: 'Gratuit — Mereu Disponibil', free_desc: 'Explorează o previzualizare limitată a hărții APM, citește despre metodologie și înțelege ce poate face predicția arheologică pentru cercetare.', free_btn: 'Explorează Harta Gratuită',
                f_product: 'Produs', f_resources: 'Resurse', f_contact: 'Contact',
                f_method: 'Metodologie', f_docs: 'Documentație', f_papers: 'Articole Științifice', f_qgis: 'Proiect QGIS',
                f_about: 'Despre Noi', f_partner: 'contact@detectlab.ro', f_press: 'Presă',
                get_app_label: 'Aplicație Mobilă',
                get_app_title: 'Obține Aplicația <span class="hl">DetectLab</span>',
                get_app_desc: 'Instalează aplicația pe dispozitivul tău mobil pentru acces rapid la modelul de predicție.',
                btn_android: 'Aplicație Android',
                btn_ios: 'Aplicație iOS',
                footer_desc: 'Salvăm istoria împreună!',
                f_rights: 'Toate drepturile rezervate.', f_built: 'Construit cu QGIS · OpenLayers · pasiune pentru trecut',
                layer_opacity: 'Opacitate Straturi',
                layer_satellite: 'Satelit',
                layer_osm_places: 'Localități OSM',
                layer_uat: 'UAT',
                layer_heritage: 'Patrimoniu',
                heritage_legend_title: 'Legendă',
                heritage_legend_red: 'Situri cu coordonate corecte',
                heritage_legend_green: 'Situri cu coordonate aproximate',
                heritage_legend_yellow: 'Tumul',
                layer_opacity_label: 'Opacitate',
                layer_roman: 'Imperiul Roman',
                layer_roads: 'Drumuri',
                layer_vici_sites: 'Situri Romane (DARE)',
                layer_dare_11: 'Așezări majore',
                layer_dare_17: 'Forturi majore',
                layer_dare_13: 'Capitale Civitas',
                layer_dare_12: 'Așezări obișnuite',
                layer_dare_18: 'Forturi/Castrum',
                layer_dare_53: 'Fortulețe/Turnuri',
                layer_dare_16: 'Stații rutiere/de coastă',
                layer_dare_61: 'Sanctuare/Temple',
                layer_dare_66: 'Băi',
                layer_dare_32: 'Tumuli',
                layer_dare_63: 'Cimitire',
                layer_dare_21: 'Mănăstiri',
                layer_dare_24: 'Biserici',
                layer_dare_14: 'Vile',
                layer_dare_57: 'Mine/Cariere',
                layer_dare_49: 'Trecători',
                layer_dare_51: 'Poduri',
                layer_dare_55: 'Drumuri/Borne miliare',
                layer_dare_52: 'Apeducte',
                layer_dare_64: 'Monumente',
                layer_urban_areas: 'Zone urbane',
                layer_aqueducts: 'Apeducte',
                layer_walls: 'Ziduri',
                layer_regional_names: 'Denumiri regionale',
                layer_political_shading: 'Colorare Politică',
                layer_re_117: 'IR 117 d.Hr.',
                layer_re_60bce: 'IR 60 î.Hr.',
                layer_re_200: 'IR 200 d.Hr.',
                layer_alexander: 'Imperiul lui Alexandru',
                layer_persian: 'Imperiul Persan',
                layer_diocletian: 'Prov. după Dioclețian',
                layer_historical: 'Hărți Istorice',
                layer_historical_premium: 'Harti istorice',
                layer_josephine: 'Harta Iosefină +',
                layer_iosfree: 'Harta Iosefină',
                layer_austrian: 'Harta Austriacă 1910',
                layer_firingplans: 'Planuri de Tragere',
                layer_sovietmap: 'Harta Sovietică 1970',
                layer_bucovina: 'Bucovina 1861-1864',
                layer_austrohu: 'Harta Austro-Ungară (1861–1864)',
                layer_moldova1868: 'Moldova 1868',
                layer_moldovawwii: 'Moldova WWII',
                layer_polishtactical1933: 'Harta tactică poloneză 1933',
                layer_ww1: 'WWI',
                layer_ww2: 'WWII',
                layer_satellite60s: "Imagini satelitare anii 60'",
                sat60_load_here: 'Încarcă imagini aici',
                sat60_zoom_more: 'Mărește mai mult',
                sat60_load_title: "Încarcă imaginile satelitare anii '60 doar pentru zona vizibilă",
                sat60_loading: 'Se încarcă imaginile satelitare din zona vizibilă…',
                sat60_found: 'S-au încărcat {n} tile-uri — există imagini satelitare în această zonă',
                sat60_no_images: 'Nu există imagini aici',
                sat60_error: 'Nu s-au putut încărca imaginile, încearcă din nou.',
                sat60_not_ready: 'Stratul satelitar se încarcă încă… încearcă din nou în câteva secunde.',
                sat60_zoom_hint: 'Mărește zoom-ul la nivelul 11 sau mai mult pentru a încărca imagini aici.',
                layer_banat: 'Banat - 1769-1772',
                layer_archeo_potential: 'Zone cu potențial arheologic',
                archeo_desc: 'Analiză statistică · rază 10 km',
                archeo_run_btn: 'Zone candidati',
                archeo_run_running: 'Se analizează…',
                archeo_status_ready: 'Apasă butonul pentru a analiza raza de 10 km curentă.',
                archeo_legend_medium: 'Potențial Mediu',
                archeo_legend_high: 'Potențial Ridicat',
                archeo_hint: 'Candidații = goluri între siturile cunoscute, în zona roșie UAT, la ≥ 700 m de orice sit.',
                archeo_show_label: 'Arată rezultatele',
                iosfree_hint: 'Caută sau zoom pe o localitate',
                iosfree_loading: 'Se încarcă imaginea…',
                iosfree_notfound: 'Nu s-a găsit hartă pentru această localitate',
                iosfree_zoom: 'Zoom ≥ 13 sau caută o localitate pentru a activa',
                iosfree_search_btn: 'Caută aici',
                hist_zoom_hint: 'Zoom in ca să vezi harta',
                apm20_search_help: 'Ajutor de căutare',
                apm20_search_help_loading: 'Se analizează zona vizibilă…',
                apm20_search_help_empty: 'Nu s-au găsit zone clare cu potențial ridicat în zona vizibilă',
                apm20_search_help_error: 'Nu am putut analiza zona vizibilă, încearcă din nou',
                apm20_search_help_zoom: 'Mărește zoom-ul pentru a folosi Ajutor de căutare',
                apm20_search_help_hint: 'Mărește zoom-ul pentru căutare avansată',
                ios_bld_search_help: 'Clădiri Dispărute',
                ios_bld_search_help_loading: 'Se analizează Harta Iosefină +…',
                ios_bld_search_help_empty: 'Nu s-au găsit clădiri dispărute în zona vizibilă',
                ios_bld_search_help_error: 'Activează mai întâi stratul Harta Iosefină +',
                ios_bld_search_help_hint: 'Zoom in mai mult',
                ios_bld_search_help_zoom: 'Zoom in mai mult',
                ios_bld_search_help_zoom_in: 'Zoom in mai mult',
                ios_bld_search_help_zoom_out: 'Zoom out mai mult',
            }
        };

        const LANGUAGE_STORAGE_KEY = 'detectlab_lang';

        function getStoredLanguage() {
            try {
                var stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
                return translations[stored] ? stored : 'ro';
            } catch (e) {
                // Storage can be unavailable in private/restricted WebViews.
                return 'ro';
            }
        }

        let currentLang = getStoredLanguage();

        function toggleLangDropdown() {
            var dd = document.getElementById('langDropdown');
            if (dd) dd.classList.toggle('open');
        }

        function pickLang(lang) {
            setLang(lang);
            var dropdown = document.getElementById('langDropdown');
            if (dropdown) dropdown.classList.remove('open');
        }

        function syncLanguageSelectors(lang) {
            var flagMap = { en: '🇬🇧', ro: '🇷🇴' };
            var code = lang.toUpperCase();
            var flag = document.getElementById('langFlag');
            var desktopCode = document.getElementById('langCode');
            var desktopEn = document.getElementById('langOptEn');
            var desktopRo = document.getElementById('langOptRo');
            var pwaCode = document.getElementById('pwaLangCode');
            var pwaFlag = document.getElementById('pwaLangFlag');
            var pwaEn = document.getElementById('pwaLangOptEn');
            var pwaRo = document.getElementById('pwaLangOptRo');

            if (flag) flag.textContent = flagMap[lang];
            if (desktopCode) desktopCode.textContent = code;
            if (desktopEn) desktopEn.classList.toggle('selected', lang === 'en');
            if (desktopRo) desktopRo.classList.toggle('selected', lang === 'ro');
            if (pwaCode) pwaCode.textContent = code;
            if (pwaFlag) pwaFlag.style.display = 'none';
            if (pwaEn) pwaEn.classList.toggle('selected', lang === 'en');
            if (pwaRo) pwaRo.classList.toggle('selected', lang === 'ro');
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', function(e) {
            var dd = document.getElementById('langDropdown');
            if (dd && !dd.contains(e.target)) dd.classList.remove('open');
        });

        // ── BILLING TOGGLE ──
        let isMonthly = false;
        const prices = {
            weekly: { bronze: ['  ', '/week'], silver: ['  ', '/week'], gold: ['  ', '/week'] }
        };
        const periodRO = { '/week': '/săpt.', '/month': '/lună', '/year': '/an' };

        function setLang(lang) {
            if (!translations[lang]) lang = 'ro';
            currentLang = lang;

            try {
                localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
            } catch (e) {
                // Keep the in-memory choice even when storage is unavailable.
            }

            document.documentElement.lang = lang;
            const T = translations[lang];
            document.querySelectorAll('.t[data-key]').forEach(el => {
                const key = el.getAttribute('data-key');
                if (T[key] !== undefined) el.innerHTML = T[key];
            });
            syncLanguageSelectors(lang);
            updateBillingDisplay();
        }

        // Expose the canonical language state to PWA controls and map widgets.
        // A top-level `let` is not available as window.currentLang, which was
        // why the PWA polling fallback repeatedly reset the selector to RO.
        window._currentLang = function () { return currentLang; };
        window.pickLang = pickLang;
        window.setLang = setLang;

        // Restore the user's previous choice instead of forcing Romanian on
        // every load/relaunch of the installed app.
        setLang(currentLang);

        function toggleBilling() {
            isMonthly = !isMonthly;
            document.getElementById('billingToggle').classList.toggle('monthly', isMonthly);
            document.getElementById('lbl_weekly').classList.toggle('active', !isMonthly);
            document.getElementById('lbl_monthly').classList.toggle('active', isMonthly);
            updateBillingDisplay();
        }

        function updateBillingDisplay() {
            const mode = isMonthly ? 'monthly' : 'weekly';
            const T = translations[currentLang];
            ['bronze', 'silver', 'gold'].forEach(tier => {
                const [price, period] = prices[mode][tier];
                document.getElementById(tier + 'Price').textContent = price;
                const pEl = document.getElementById(tier + 'Period');
                pEl.textContent = currentLang === 'ro' ? periodRO[period] : period;
                const nKey = tier === 'gold' ? 'note_yearly' : (tier === 'silver' ? 'note_monthly' : 'note_weekly');
                document.getElementById(tier + 'Note').innerHTML = T[nKey] || '';
            });
        }

        // ── HARTA IOSEFINĂ OVERLAY ──
        function openIosfreeModal(imgUrl, locality) {
            var modal = document.getElementById('iosfreeModal');
            var img   = document.getElementById('iosfreeModalImg');
            if (!modal || !img) return;
            img.src = imgUrl;
            img.alt = locality;
            // Apply current slider opacity
            var slider = document.getElementById('iosfreeOpacitySlider');
            if (slider) img.style.opacity = slider.value / 100;
            modal.classList.add('visible');
            document.addEventListener('keydown', _iosfreeEscHandler);
        }
        function closeIosfreeModal() {
            var modal = document.getElementById('iosfreeModal');
            if (modal) modal.classList.remove('visible');
            document.removeEventListener('keydown', _iosfreeEscHandler);
        }
        function _iosfreeEscHandler(e) {
            if (e.key === 'Escape') closeIosfreeModal();
        }
        function iosfreeMapPan(dfracX, dfracY) {
            // dfracX, dfracY: fracțiuni din dimensiunea geografică a imaginii
            // ex: 0.12 înseamnă "mișcă cu 12% din lățimea/înălțimea hărții"
            var overlay = window._iosfreeCurrentOverlay;
            var map     = window._dlMap;
            if (!overlay || !map) return;

            var initBounds = overlay._initialBounds || overlay._bounds;
            var imgLat = initBounds.getNorth() - initBounds.getSouth(); // grade latitudine
            var imgLng = initBounds.getEast()  - initBounds.getWest(); // grade longitudine

            // Offset curent față de centrul inițial (grade)
            var initCenter = initBounds.getCenter();
            var curCenter  = overlay._bounds.getCenter();
            var curOffLng  = curCenter.lng - initCenter.lng;
            var curOffLat  = curCenter.lat - initCenter.lat;

            // Delta geografic propus
            var dLng = dfracX * imgLng;
            var dLat = dfracY * imgLat; // pozitiv = spre Nord

            // Limite: dreptunghiul e 3× imaginea → offset max = 1× dimensiunea imaginii
            var maxOffLng = imgLng;
            var maxOffLat = imgLat;

            var newOffLng = Math.max(-maxOffLng, Math.min(maxOffLng, curOffLng + dLng));
            var newOffLat = Math.max(-maxOffLat, Math.min(maxOffLat, curOffLat + dLat));

            var actualDLng = newOffLng - curOffLng;
            var actualDLat = newOffLat - curOffLat;
            if (Math.abs(actualDLng) < 1e-9 && Math.abs(actualDLat) < 1e-9) return;

            var b = overlay._bounds;
            var newBounds = L.latLngBounds(
                [b.getSouth() + actualDLat, b.getWest() + actualDLng],
                [b.getNorth() + actualDLat, b.getEast() + actualDLng]
            );
            overlay.setBounds(newBounds);
            window._iosfreeCurrentBounds = newBounds;
        }

        // ── MAP TABS ──
        function switchTab(el, type) {
            document.querySelectorAll('.map-tab').forEach(t => t.classList.remove('active'));
            el.classList.add('active');
            document.getElementById('mapLock').classList.toggle('show', type === 'member');

            // Weather tab toggle
            var weatherPanel = document.getElementById('weatherPanel');
            var mapWrapper = document.querySelector('.map-wrapper');
            var mapLegend = document.querySelector('.map-legend-bar');
            var mapControls = document.querySelector('.map-controls');
            var transpTab = document.getElementById('transpTab');
            var transpPanel = document.getElementById('transpPanel');
            var mapSearch = document.getElementById('mapSearchWrap');

            if (type === 'weather') {
                weatherPanel.classList.add('active');
                if (mapWrapper) mapWrapper.style.display = 'none';
                var mapFrame = document.querySelector('.map-frame');
                if (mapFrame) mapFrame.style.display = 'none';
                if (mapLegend) mapLegend.style.display = 'none';
                if (mapControls) mapControls.style.display = 'none';
                if (transpTab) transpTab.style.display = 'none';
                if (transpPanel) transpPanel.style.display = 'none';
                if (mapSearch) mapSearch.style.display = 'none';
            } else {
                weatherPanel.classList.remove('active');
                if (mapWrapper) mapWrapper.style.display = '';
                var mapFrame = document.querySelector('.map-frame');
                if (mapFrame) mapFrame.style.display = '';
                if (mapLegend) mapLegend.style.display = '';
                if (mapControls) mapControls.style.display = '';
                if (transpTab) transpTab.style.display = '';
                if (transpPanel) transpPanel.style.display = '';
                if (mapSearch) mapSearch.style.display = '';
            }
        }

        // ── WEATHER FEATURE ──
        (function () {
            var _suggestTimer = null;
            var _selectedLat = null, _selectedLon = null, _selectedName = null;

            var WMO_CODES = {
                0: ['☀️', 'Cer senin'],
                1: ['🌤', 'Predominant senin'],
                2: ['⛅', 'Parțial noros'],
                3: ['☁️', 'Noros'],
                45: ['🌫', 'Ceață'],
                48: ['🌫', 'Ceață cu chiciură'],
                51: ['🌦', 'Burniță ușoară'],
                53: ['🌦', 'Burniță moderată'],
                55: ['🌧', 'Burniță densă'],
                61: ['🌧', 'Ploaie ușoară'],
                63: ['🌧', 'Ploaie moderată'],
                65: ['🌧', 'Ploaie abundentă'],
                71: ['🌨', 'Ninsoare ușoară'],
                73: ['🌨', 'Ninsoare moderată'],
                75: ['❄️', 'Ninsoare abundentă'],
                77: ['🌨', 'Fulgi de nea'],
                80: ['🌦', 'Averse ușoare'],
                81: ['🌧', 'Averse moderate'],
                82: ['⛈', 'Averse puternice'],
                85: ['🌨', 'Ninsoare cu averse'],
                86: ['❄️', 'Ninsoare cu averse intense'],
                95: ['⛈', 'Furtună'],
                96: ['⛈', 'Furtună cu grindină'],
                99: ['⛈', 'Furtună cu grindină mare'],
            };

            function wmoInfo(code) {
                return WMO_CODES[code] || ['🌡', 'Condiții variate'];
            }

            var DAYS_RO = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm'];

            window.onWeatherInput = function (val) {
                clearTimeout(_suggestTimer);
                var list = document.getElementById('weatherSuggestList');
                if (val.trim().length < 2) { list.classList.add('hidden'); return; }
                _suggestTimer = setTimeout(function () { fetchSuggestions(val.trim()); }, 280);
            };

            window.onWeatherKey = function (e) {
                if (e.key === 'Enter') { searchWeather(); }
            };

            function fetchSuggestions(q) {
                var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) +
                    '&count=6&language=ro&countryCode=RO';
                fetch(url).then(function (r) { return r.json(); }).then(function (data) {
                    var list = document.getElementById('weatherSuggestList');
                    if (!data.results || !data.results.length) { list.classList.add('hidden'); return; }
                    list.innerHTML = '';
                    data.results.forEach(function (loc) {
                        var li = document.createElement('li');
                        li.textContent = loc.name + (loc.admin1 ? ', ' + loc.admin1 : '');
                        li.addEventListener('click', function () {
                            document.getElementById('weatherInput').value = li.textContent;
                            list.classList.add('hidden');
                            _selectedLat = loc.latitude;
                            _selectedLon = loc.longitude;
                            _selectedName = loc.name + (loc.admin1 ? ', ' + loc.admin1 : '');
                            loadWeather(_selectedLat, _selectedLon, _selectedName);
                        });
                        list.appendChild(li);
                    });
                    list.classList.remove('hidden');
                }).catch(function () { });
            }

            window.searchWeather = function () {
                var input = document.getElementById('weatherInput').value.trim();
                document.getElementById('weatherSuggestList').classList.add('hidden');
                if (!input) return;
                if (_selectedName && input === _selectedName && _selectedLat) {
                    loadWeather(_selectedLat, _selectedLon, _selectedName);
                    return;
                }
                // Geocode first
                var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(input) +
                    '&count=1&language=ro&countryCode=RO';
                showWeatherLoading();
                fetch(url).then(function (r) { return r.json(); }).then(function (data) {
                    if (!data.results || !data.results.length) {
                        showWeatherError('Localitatea "' + input + '" nu a fost găsită în România.');
                        return;
                    }
                    var loc = data.results[0];
                    _selectedLat = loc.latitude;
                    _selectedLon = loc.longitude;
                    _selectedName = loc.name + (loc.admin1 ? ', ' + loc.admin1 : '');
                    loadWeather(_selectedLat, _selectedLon, _selectedName);
                }).catch(function () {
                    showWeatherError('Eroare la geocodare. Verifică conexiunea la internet.');
                });
            };

            function loadWeather(lat, lon, name) {
                showWeatherLoading();
                var url = 'https://api.open-meteo.com/v1/forecast' +
                    '?latitude=' + lat + '&longitude=' + lon +
                    '&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,sunrise,sunset' +
                    '&hourly=relativehumidity_2m,windspeed_10m' +
                    '&current_weather=true' +
                    '&timezone=auto' +
                    '&forecast_days=6';
                fetch(url).then(function (r) { return r.json(); }).then(function (d) {
                    renderWeather(d, name);
                }).catch(function () {
                    showWeatherError('Eroare la încărcarea datelor meteo.');
                });
            }

            function renderWeather(d, name) {
                var cw = d.current_weather;
                var daily = d.daily;

                document.getElementById('wCityName').textContent = name;
                var latStr = _selectedLat ? _selectedLat.toFixed(3) + '°N, ' + _selectedLon.toFixed(3) + '°E' : '';
                document.getElementById('wCityMeta').textContent = latStr;

                // Today (index 0)
                var todayCode = daily.weathercode[0];
                var todayInfo = wmoInfo(todayCode);
                document.getElementById('wTodayIcon').textContent = todayInfo[0];
                document.getElementById('wTodayTemp').textContent = Math.round(cw.temperature) + '°C';
                document.getElementById('wTodayFeels').textContent =
                    'Max ' + Math.round(daily.temperature_2m_max[0]) + '° / Min ' + Math.round(daily.temperature_2m_min[0]) + '°';
                document.getElementById('wTodayDesc').textContent = todayInfo[1];

                // Details chips
                var detailsEl = document.getElementById('wTodayDetails');
                detailsEl.innerHTML =
                    chip('💨', 'Vânt', Math.round(cw.windspeed) + ' km/h') +
                    chip('🌧', 'Precipitații', (daily.precipitation_sum[0] || 0).toFixed(1) + ' mm') +
                    chip('🌅', 'Răsărit', fmtTime(daily.sunrise[0])) +
                    chip('🌇', 'Apus', fmtTime(daily.sunset[0]));

                // 5-day (index 1–5)
                var fiveDayEl = document.getElementById('w5Day');
                fiveDayEl.innerHTML = '';
                for (var i = 1; i <= 5; i++) {
                    var code = daily.weathercode[i];
                    var info = wmoInfo(code);
                    var date = new Date(daily.time[i] + 'T12:00:00');
                    var dayName = DAYS_RO[date.getDay()];
                    var rain = (daily.precipitation_sum[i] || 0).toFixed(1);
                    fiveDayEl.innerHTML +=
                        '<div class="weather-day-card">' +
                        '<div class="weather-day-name">' + dayName + '</div>' +
                        '<div class="weather-day-icon">' + info[0] + '</div>' +
                        '<div class="weather-day-max">' + Math.round(daily.temperature_2m_max[i]) + '°</div>' +
                        '<div class="weather-day-min">' + Math.round(daily.temperature_2m_min[i]) + '°</div>' +
                        '<div class="weather-day-rain">💧 ' + rain + ' mm</div>' +
                        '</div>';
                }

                document.getElementById('weatherLoading').classList.remove('show');
                document.getElementById('weatherError').classList.remove('show');
                document.getElementById('weatherResult').classList.add('show');
            }

            function chip(icon, label, val) {
                return '<div class="weather-detail-chip"><span>' + icon + ' ' + label + '</span><span>' + val + '</span></div>';
            }

            function fmtTime(isoStr) {
                if (!isoStr) return '—';
                var d = new Date(isoStr);
                return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
            }

            function showWeatherLoading() {
                document.getElementById('weatherLoading').classList.add('show');
                document.getElementById('weatherError').classList.remove('show');
                document.getElementById('weatherResult').classList.remove('show');
            }

            function showWeatherError(msg) {
                document.getElementById('weatherLoading').classList.remove('show');
                var el = document.getElementById('weatherError');
                el.textContent = '⚠️ ' + msg;
                el.classList.add('show');
                document.getElementById('weatherResult').classList.remove('show');
            }

            // Close suggestions when clicking outside
            document.addEventListener('click', function (e) {
                if (!e.target.closest('.weather-suggestions')) {
                    var list = document.getElementById('weatherSuggestList');
                    if (list) list.classList.add('hidden');
                }
            });
        })();

        // ── SCROLL REVEAL ──
        const observer = new IntersectionObserver(entries => {
            entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
        }, { threshold: 0.12 });

        document.querySelectorAll('.what-card, .step, .plan-card').forEach(el => observer.observe(el));

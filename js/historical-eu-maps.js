/* =====================================================================
 * historical-eu-maps.js — Hărți Istorice Europene (CENAGIS / IH PAN)
 * ---------------------------------------------------------------------
 * Colecție completă de hărți istorice, topografice și planuri urbane
 * georeferențiate, găzduite pe infrastructura CENAGIS (Politechnika Warszawska)
 * și dezvoltate în colaborare cu Instytut Historii PAN (Atlas Fontium / PastMaps).
 *
 * Categorisire pe fiecare țară europeană intersectată/suprapusă:
 *   • Polonia (PL), Germania (DE), Ucraina (UA), Belarus (BY), Lituania (LT),
 *     Letonia (LV), Cehia (CZ), Slovacia (SK), Austria (AT), Ungaria (HU),
 *     Rusia / Kaliningrad (RU), Moldova (MD), România (RO), Franța (FR),
 *     Belgia & Luxemburg (BE-LU), Țările de Jos (NL), Danemarca (DK),
 *     Estonia (EE), Elveția (CH).
 * ===================================================================== */
(function (root) {
    'use strict';

    var WMS_BASE_URL = 'https://pastmaps.cenagis.edu.pl/geoserver/ihpan/wms';

    // ── Catalogul complet al hărților CENAGIS ──
    var MAPS_CATALOG = {
        // --- Serii Topografice WIG (Wojskowy Instytut Geograficzny, 1918-1939 / 1947) ---
        'wig25k': {
            id: 'wig25k',
            wms_layer: 'wig25k_3857',
            title: { ro: 'Harta detaliată WIG 1:25 000', en: 'WIG Detailed Map 1:25,000', pl: 'Mapa szczegółowa WIG 1:25 000' },
            scale: '1:25 000',
            years: '1918–1939',
            provider: 'Wojskowy Instytut Geograficzny (WIG) / CENAGIS IH PAN',
            bounds: [[49.16, 15.66], [55.00, 27.33]]
        },
        'wig100k': {
            id: 'wig100k',
            wms_layer: 'wig100k_3857',
            title: { ro: 'Harta tactică WIG 1:100 000', en: 'WIG Tactical Map 1:100,000', pl: 'Mapa taktyczna WIG 1:100 000' },
            scale: '1:100 000',
            years: '1918–1939',
            provider: 'Wojskowy Instytut Geograficzny (WIG) / CENAGIS IH PAN',
            bounds: [[47.75, 12.83], [56.00, 28.83]]
        },
        'wig300k': {
            id: 'wig300k',
            wms_layer: 'wig300k_3857',
            title: { ro: 'Harta operațională WIG 1:300 000', en: 'WIG Operational Map 1:300,000', pl: 'Mapa operacyjna WIG 1:300 000' },
            scale: '1:300 000',
            years: '1918–1939',
            provider: 'Wojskowy Instytut Geograficzny (WIG) / CENAGIS IH PAN',
            bounds: [[49.00, 14.33], [55.80, 27.50]]
        },
        'wig500k_1947': {
            id: 'wig500k_1947',
            wms_layer: 'wig500k_3857',
            title: { ro: 'Harta Poloniei și a țărilor vecine WIG 1:500 000', en: 'WIG Poland & Neighboring Countries 1:500,000', pl: 'Mapa Polski i Krajów Ościennych WIG 1:500 000' },
            scale: '1:500 000',
            years: '1947',
            provider: 'Wojskowy Instytut Geograficzny (WIG) / CENAGIS IH PAN',
            bounds: [[49.00, 13.50], [55.00, 25.50]]
        },

        // --- Hărți Poloneze din Secolul al XIX-lea ---
        'tkkp_126k': {
            id: 'tkkp_126k',
            wms_layer: 'TKKP_126k_3857',
            title: { ro: 'Harta Topografică a Regatului Poloniei 1:126 000', en: 'Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000', pl: 'Topograficzna Karta Królestwa Polskiego 1:126 000' },
            scale: '1:126 000',
            years: '1839–1843',
            provider: 'Sztab Kwatermistrzostwa Generalnego WP / CENAGIS IH PAN',
            bounds: [[49.81, 17.27], [55.33, 24.92]]
        },
        'chrzanowski': {
            id: 'chrzanowski',
            wms_layer: 'chrzanowski_3857',
            title: { ro: 'Harta Vechii Polonii (Wojciech Chrzanowski) 1:300 000', en: 'Charter of Old Poland (Wojciech Chrzanowski) 1:300,000', pl: 'Karta Dawnej Polski 1:300 000 (Wojciech Chrzanowski)' },
            scale: '1:300 000',
            years: '1859',
            provider: 'Gen. Wojciech Chrzanowski (Paris 1859) / CENAGIS IH PAN',
            bounds: [[45.80, 11.90], [57.10, 38.28]]
        },
        'gaul': {
            id: 'gaul',
            wms_layer: 'gaul_3857',
            title: { ro: 'Harta Gaula / Raczyńskiego 1:125 000', en: 'Gaul / Raczyński Map 1:125,000', pl: 'Mapa Gaula/Raczyńskiego 1:125 000' },
            scale: '1:125 000',
            years: '1807–1812',
            provider: 'Edward Raczyński / Archiwum Państwowe w Poznaniu / CENAGIS IH PAN',
            bounds: [[51.49, 15.12], [52.99, 17.36]]
        },

        // --- Hărți Austriece ---
        'kummersberg': {
            id: 'kummersberg',
            wms_layer: 'kummersberg_3857',
            title: { ro: 'Harta Administrativă a Galiției și Lodomeriei (Kummersberg) 1:115 200', en: 'Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200', pl: 'Administrativ Karte von Galizien und Lodomerien (Kummersberg)' },
            scale: '1:115 200',
            years: '1855',
            provider: 'Carl Ritter von Kummersberg / CENAGIS IH PAN',
            bounds: [[48.83, 18.62], [50.85, 26.68]]
        },

        // --- Hărți Prusace și Germane ---
        'schroetter': {
            id: 'schroetter',
            wms_layer: 'schroetter_3857',
            title: { ro: 'Harta Schroetter (Prusia Răsăriteană și Apuseană) 1:150 000', en: 'Schroetter Map (East & West Prussia) 1:150,000', pl: 'Mapa Schroettera 1:150 000 (Ost- und Westpreussen)' },
            scale: '1:150 000',
            years: '1796–1802',
            provider: 'Friedrich Leopold von Schroetter / CENAGIS IH PAN',
            bounds: [[52.30, 15.10], [55.90, 22.96]]
        },
        'gilly': {
            id: 'gilly',
            wms_layer: 'gilly_3857',
            title: { ro: 'Harta Gilly (Prusia de Sud) 1:150 000', en: 'Gilly Map (South Prussia) 1:150,000', pl: 'Mapa Gilly\'ego 1:150 000 (Südpreussen)' },
            scale: '1:150 000',
            years: '1802–1803',
            provider: 'David Gilly (Special Karte von Südpreussen) / CENAGIS IH PAN',
            bounds: [[50.07, 14.88], [53.72, 21.87]]
        },
        'textor': {
            id: 'textor',
            wms_layer: 'textor_3857',
            title: { ro: 'Harta Textor-Sotzmann (Noua Prusie Răsăriteană) 1:150 000', en: 'Textor-Sotzmann Map (New East Prussia) 1:150,000', pl: 'Mapa Textora-Sotzmanna 1:150 000 (Neu Ostpreussen)' },
            scale: '1:150 000',
            years: '1806–1808',
            provider: 'J. C. Textor & D. F. Sotzmann / CENAGIS IH PAN',
            bounds: [[52.48, 18.56], [55.05, 24.34]]
        },
        'm25k': {
            id: 'm25k',
            wms_layer: 'm25k_3857',
            title: { ro: 'Hărțile Germane Messtischblätter 1:25 000', en: 'German Topographic Messtischblätter 1:25,000', pl: 'Messtischblätter 1:25 000' },
            scale: '1:25 000',
            years: '1870–1945',
            provider: 'Königlich Preussische Landesaufnahme / Reichsamt für Landesaufnahme / CENAGIS IH PAN',
            bounds: [[49.39, 13.99], [55.89, 24.66]]
        },
        'kdr': {
            id: 'kdr',
            wms_layer: 'kdr_3857',
            title: { ro: 'Harta Imperiului German (Karte des Deutschen Reiches) 1:100 000', en: 'German Empire Map (Karte des Deutschen Reiches) 1:100,000', pl: 'Karte des Deutschen Reiches 1:100 000' },
            scale: '1:100 000',
            years: '1870–1914 (~1900)',
            provider: 'Reichsamt für Landesaufnahme / CENAGIS IH PAN',
            bounds: [[47.25, 5.83], [56.00, 23.33]]
        },
        'kdr_gb': {
            id: 'kdr_gb',
            wms_layer: 'kdr_gb_3857',
            title: { ro: 'Harta Germană Grossblätter WWII 1:100 000', en: 'German Grossblätter WWII 1:100,000', pl: 'Karte des Deutschen Reiches – Grossblätter 1:100 000' },
            scale: '1:100 000',
            years: '1939–1944',
            provider: 'Hauptvermessungsabteilung / CENAGIS IH PAN',
            bounds: [[47.75, 13.33], [56.75, 28.33]]
        },
        'kdwr': {
            id: 'kdwr',
            wms_layer: 'kdwr_3857',
            title: { ro: 'Harta Rusiei Vestice (Karte des Westlichen Russlands) 1:100 000', en: 'Western Russia Map (Karte des Westlichen Russlands) 1:100,000', pl: 'Karte des Westlichen Russlands 1:100 000' },
            scale: '1:100 000',
            years: '1914–1921',
            provider: 'Kartographische Abteilung des Stellvertretenden Generalstabes / CENAGIS IH PAN',
            bounds: [[49.99, 17.33], [57.75, 27.33]]
        },
        'ukvme': {
            id: 'ukvme',
            wms_layer: 'ukvme_3857',
            title: { ro: 'Harta Europei Centrale (Übersichtskarte von Mitteleuropa) 1:300 000', en: 'Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000', pl: 'Übersichtskarte von Mitteleuropa 1:300 000' },
            scale: '1:300 000',
            years: '1890–1915 (~1900)',
            provider: 'Königlich Preussische Landesaufnahme / CENAGIS IH PAN',
            bounds: [[45.99, 12.33], [58.99, 34.33]]
        },
        'reymann': {
            id: 'reymann',
            wms_layer: 'reymann_3857',
            title: { ro: 'Harta Specială Reymann a Europei Centrale 1:200 000', en: 'Reymann\'s Special Map of Central Europe 1:200,000', pl: 'Reymann\'s Special-Karte von Central Europa 1:200 000' },
            scale: '1:200 000',
            years: '1850–1900',
            provider: 'Daniel Gottlob Reymann / Flemming / CENAGIS IH PAN',
            bounds: [[46.50, 5.20], [55.80, 28.50]]
        },

        // --- Hărți Rusești ---
        'dwuwiorstowka': {
            id: 'dwuwiorstowka',
            wms_layer: 'dwuwiorstowka_3857',
            title: { ro: 'Harta Rusă de Două Verste (Dvuhviorstka) 1:84 000', en: 'Russian 2-Verst Map (Dvukhverstka) 1:84,000', pl: 'Dwuwiorstówka 1:84 000' },
            scale: '1:84 000',
            years: '1908–1936',
            provider: 'Военно-Топографический Отдел Главного Штаба / CENAGIS IH PAN',
            bounds: [[50.00, 17.50], [56.00, 26.50]]
        },

        // --- Atlas Historyczny Polski (Secolul al XVI-lea) ---
        'ahp_ziemie_polskie': {
            id: 'ahp_ziemie_polskie',
            wms_layer: 'ahp_ziemie_polskie_3857',
            title: { ro: 'Țările Coroanei Poloneze în sec. XVI 1:250 000', en: 'Crown Lands of Poland in 16th c. 1:250,000', pl: 'Ziemie polskie Korony w II połowie XVI w. 1:250 000' },
            scale: '1:250 000',
            years: 'XVI w. (~1580)',
            provider: 'Atlas Historyczny Polski / Instytut Historii PAN (IH PAN)',
            bounds: [[48.88, 14.49], [55.00, 24.34]]
        },
        'ahp_drogi': {
            id: 'ahp_drogi',
            wms_layer: 'ahp_drogi_3857',
            title: { ro: 'Drumurile comerciale în sec. XVI 1:500 000', en: 'Trade & Postal Routes in 16th c. 1:500,000', pl: 'Drogi w II połowie XVI w. 1:500 000' },
            scale: '1:500 000',
            years: 'XVI w. (~1580)',
            provider: 'Atlas Historyczny Polski / Instytut Historii PAN (IH PAN)',
            bounds: [[48.88, 14.49], [55.00, 24.34]]
        },
        'ahp_koscielne': {
            id: 'ahp_koscielne',
            wms_layer: 'ahp_koscielne_3857',
            title: { ro: 'Împărțirile ecleziastice în sec. XVI 1:500 000', en: 'Ecclesiastical Divisions in 16th c. 1:500,000', pl: 'Podziały kościelne w II połowie XVI w. 1:500 000' },
            scale: '1:500 000',
            years: 'XVI w. (~1580)',
            provider: 'Atlas Historyczny Polski / Instytut Historii PAN (IH PAN)',
            bounds: [[48.88, 14.49], [55.00, 24.34]]
        },
        'ahp_wlasnosc': {
            id: 'ahp_wlasnosc',
            wms_layer: 'ahp_wlasnosc_3857',
            title: { ro: 'Structura proprietății funciare în sec. XVI 1:500 000', en: 'Land Ownership Structure in 16th c. 1:500,000', pl: 'Rozmieszczenie własności w II połowie XVI w. 1:500 000' },
            scale: '1:500 000',
            years: 'XVI w. (~1580)',
            provider: 'Atlas Historyczny Polski / Instytut Historii PAN (IH PAN)',
            bounds: [[48.88, 14.49], [55.00, 24.34]]
        },

        // --- Planuri Urbane (WWII & Istorice) ---
        'city_warszawa': {
            id: 'city_warszawa',
            wms_layer: 'warszawa_3857',
            title: { ro: 'Planul Varșoviei 1:25 000 (1944)', en: 'Warsaw City Plan 1:25,000 (1944)', pl: 'Plan Warszawy 1:25 000 (1944)' },
            scale: '1:25 000',
            years: '1944',
            provider: 'Geographical Section General Staff (GSGS 4435) / WIG / CENAGIS IH PAN',
            bounds: [[52.16, 20.88], [52.30, 21.15]]
        },
        'city_krakow': {
            id: 'city_krakow',
            wms_layer: 'krakow_3857',
            title: { ro: 'Planul Cracoviei 1:25 000 (1943)', en: 'Kraków City Plan 1:25,000 (1943)', pl: 'Plan Krakowa 1:25 000 (1943)' },
            scale: '1:25 000',
            years: '1943',
            provider: 'GSGS 4435 / WIG / CENAGIS IH PAN',
            bounds: [[49.99, 19.87], [50.10, 20.00]]
        },
        'city_gdansk': {
            id: 'city_gdansk',
            wms_layer: 'gdansk_3857',
            title: { ro: 'Planul Gdańskului 1:25 000 (1944)', en: 'Gdańsk City Plan 1:25,000 (1944)', pl: 'Plan Gdańska 1:25 000 (1944)' },
            scale: '1:25 000',
            years: '1944',
            provider: 'GSGS 4496 / WIG / CENAGIS IH PAN',
            bounds: [[54.32, 18.59], [54.42, 18.70]]
        },
        'city_wroclaw': {
            id: 'city_wroclaw',
            wms_layer: 'wroclaw_3857',
            title: { ro: 'Planul Wrocławului (Breslau) 1:25 000 (1944)', en: 'Wrocław (Breslau) City Plan 1:25,000 (1944)', pl: 'Plan Wrocławia 1:25 000 (1944)' },
            scale: '1:25 000',
            years: '1944',
            provider: 'GSGS 4480 / WIG / CENAGIS IH PAN',
            bounds: [[51.07, 16.98], [51.14, 17.10]]
        },
        'city_poznan': {
            id: 'city_poznan',
            wms_layer: 'poznan_3857',
            title: { ro: 'Planul Poznańului 1:25 000 (1943)', en: 'Poznań City Plan 1:25,000 (1943)', pl: 'Plan Poznania 1:25 000 (1943)' },
            scale: '1:25 000',
            years: '1943',
            provider: 'GSGS 4435 / WIG / CENAGIS IH PAN',
            bounds: [[52.36, 16.86], [52.43, 17.00]]
        },
        'city_lodz': {
            id: 'city_lodz',
            wms_layer: 'lodz_3857',
            title: { ro: 'Planul orașului Łódź 1:25 000 (1943)', en: 'Łódź City Plan 1:25,000 (1943)', pl: 'Plan Łodzi 1:25 000 (1943)' },
            scale: '1:25 000',
            years: '1943',
            provider: 'GSGS 4435 / WIG / CENAGIS IH PAN',
            bounds: [[51.64, 19.32], [51.87, 19.55]]
        },
        'city_katowice': {
            id: 'city_katowice',
            wms_layer: 'katowice_3857',
            title: { ro: 'Planul Katowice 1:25 000 (1943)', en: 'Katowice City Plan 1:25,000 (1943)', pl: 'Plan Katowic 1:25 000 (1943)' },
            scale: '1:25 000',
            years: '1943',
            provider: 'GSGS 4435 / WIG / CENAGIS IH PAN',
            bounds: [[50.23, 18.98], [50.28, 19.08]]
        },
        'city_czestochowa': {
            id: 'city_czestochowa',
            wms_layer: 'czestochowa_3857',
            title: { ro: 'Planul Częstochowa 1:25 000 (1943)', en: 'Częstochowa City Plan 1:25,000 (1943)', pl: 'Plan Częstochowy 1:25 000 (1943)' },
            scale: '1:25 000',
            years: '1943',
            provider: 'GSGS 4435 / WIG / CENAGIS IH PAN',
            bounds: [[50.77, 19.06], [50.83, 19.17]]
        },
        'city_bialystok': {
            id: 'city_bialystok',
            wms_layer: 'bialystok_3857',
            title: { ro: 'Planul Białystok 1:25 000 (1943)', en: 'Białystok City Plan 1:25,000 (1943)', pl: 'Plan Białegostoku 1:25 000 (1943)' },
            scale: '1:25 000',
            years: '1943',
            provider: 'GSGS 4435 / WIG / CENAGIS IH PAN',
            bounds: [[53.09, 23.09], [53.16, 23.21]]
        },
        'city_bydgoszcz': {
            id: 'city_bydgoszcz',
            wms_layer: 'bydgoszcz_3857',
            title: { ro: 'Planul Bydgoszcz 1:25 000 (1943)', en: 'Bydgoszcz City Plan 1:25,000 (1943)', pl: 'Plan Bydgoszczy 1:25 000 (1943)' },
            scale: '1:25 000',
            years: '1943',
            provider: 'GSGS 4435 / WIG / CENAGIS IH PAN',
            bounds: [[53.10, 17.94], [53.15, 18.06]]
        },
        'city_torun': {
            id: 'city_torun',
            wms_layer: 'torun_3857',
            title: { ro: 'Planul Toruń 1:25 000 (1943)', en: 'Toruń City Plan 1:25,000 (1943)', pl: 'Plan Torunia 1:25 000 (1943)' },
            scale: '1:25 000',
            years: '1943',
            provider: 'GSGS 4435 / WIG / CENAGIS IH PAN',
            bounds: [[52.98, 18.55], [53.05, 18.66]]
        },
        'city_lublin': {
            id: 'city_lublin',
            wms_layer: 'lublin_3857',
            title: { ro: 'Planul Lublin 1:25 000 (1943)', en: 'Lublin City Plan 1:25,000 (1943)', pl: 'Plan Lublina 1:25 000 (1943)' },
            scale: '1:25 000',
            years: '1943',
            provider: 'GSGS 4435 / WIG / CENAGIS IH PAN',
            bounds: [[51.20, 22.52], [51.28, 22.62]]
        },
        'city_kielce': {
            id: 'city_kielce',
            wms_layer: 'kielce_3857',
            title: { ro: 'Planul Kielce 1:25 000 (1943)', en: 'Kielce City Plan 1:25,000 (1943)', pl: 'Plan Kielc 1:25 000 (1943)' },
            scale: '1:25 000',
            years: '1943',
            provider: 'GSGS 4435 / WIG / CENAGIS IH PAN',
            bounds: [[50.83, 20.57], [50.89, 20.69]]
        },
        'city_radom': {
            id: 'city_radom',
            wms_layer: 'radom_3857',
            title: { ro: 'Planul Radom 1:25 000 (1943)', en: 'Radom City Plan 1:25,000 (1943)', pl: 'Plan Radomia 1:25 000 (1943)' },
            scale: '1:25 000',
            years: '1943',
            provider: 'GSGS 4435 / WIG / CENAGIS IH PAN',
            bounds: [[51.36, 21.09], [51.42, 21.21]]
        },
        'city_rzeszow': {
            id: 'city_rzeszow',
            wms_layer: 'rzeszow_3857',
            title: { ro: 'Planul Rzeszów 1:25 000 (1943)', en: 'Rzeszów City Plan 1:25,000 (1943)', pl: 'Plan Rzeszowa 1:25 000 (1943)' },
            scale: '1:25 000',
            years: '1943',
            provider: 'GSGS 4435 / WIG / CENAGIS IH PAN',
            bounds: [[50.01, 21.96], [50.07, 22.05]]
        },
        'city_tarnow': {
            id: 'city_tarnow',
            wms_layer: 'tarnow_3857',
            title: { ro: 'Planul Tarnów 1:25 000 (1943)', en: 'Tarnów City Plan 1:25,000 (1943)', pl: 'Plan Tarnowa 1:25 000 (1943)' },
            scale: '1:25 000',
            years: '1943',
            provider: 'GSGS 4435 / WIG / CENAGIS IH PAN',
            bounds: [[49.99, 20.94], [50.03, 21.05]]
        },
        'city_grudziadz': {
            id: 'city_grudziadz',
            wms_layer: 'grudziadz_3857',
            title: { ro: 'Planul Grudziądz 1:25 000 (1943)', en: 'Grudziądz City Plan 1:25,000 (1943)', pl: 'Plan Grudziądza 1:25 000 (1943)' },
            scale: '1:25 000',
            years: '1943',
            provider: 'GSGS 4435 / WIG / CENAGIS IH PAN',
            bounds: [[53.46, 18.72], [53.52, 18.80]]
        },
        'city_inowroclaw': {
            id: 'city_inowroclaw',
            wms_layer: 'inowroclaw_3857',
            title: { ro: 'Planul Inowrocław 1:25 000 (1943)', en: 'Inowrocław City Plan 1:25,000 (1943)', pl: 'Plan Inowrocławia 1:25 000 (1943)' },
            scale: '1:25 000',
            years: '1943',
            provider: 'GSGS 4435 / WIG / CENAGIS IH PAN',
            bounds: [[52.78, 18.20], [52.82, 18.30]]
        },
        'city_jaslo': {
            id: 'city_jaslo',
            wms_layer: 'jaslo_3857',
            title: { ro: 'Planul Jasło 1:25 000 (1943)', en: 'Jasło City Plan 1:25,000 (1943)', pl: 'Plan Jasła 1:25 000 (1943)' },
            scale: '1:25 000',
            years: '1943',
            provider: 'GSGS 4435 / WIG / CENAGIS IH PAN',
            bounds: [[49.71, 21.41], [49.79, 21.54]]
        },
        'city_siedlce': {
            id: 'city_siedlce',
            wms_layer: 'siedlce_3857',
            title: { ro: 'Planul Siedlce 1:25 000 (1943)', en: 'Siedlce City Plan 1:25,000 (1943)', pl: 'Plan Siedlec 1:25 000 (1943)' },
            scale: '1:25 000',
            years: '1943',
            provider: 'GSGS 4435 / WIG / CENAGIS IH PAN',
            bounds: [[52.13, 22.21], [52.20, 22.33]]
        },
        'city_warszawa_lindley': {
            id: 'city_warszawa_lindley',
            wms_layer: 'lindley_3857',
            title: { ro: 'Planul Lindley al Varșoviei 1:2 500 (1897–1901)', en: 'Lindley Warsaw Plan 1:2,500 (1897–1901)', pl: 'Warszawa - mapa Lindleyów (1897-1901)' },
            scale: '1:2 500',
            years: '1897–1901',
            provider: 'William Heerlein Lindley / Archiwum Państwowe w Warszawie / IH PAN',
            bounds: [[52.17, 20.94], [52.31, 21.08]]
        },
        'city_warszawa_1822': {
            id: 'city_warszawa_1822',
            wms_layer: 'warszawaOKI_2180',
            title: { ro: 'Planul Capitalei Varșovia (Corpul de Ingineri) 1:4 800 (1822)', en: 'Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)', pl: 'Plan miasta stołecznego Warszawy (1822)' },
            scale: '1:4 800',
            years: '1822',
            provider: 'Oficerowie Korpusu Inżynierów (1818-1819, litogr. 1822) / AGAD / IH PAN',
            bounds: [[52.19, 20.95], [52.28, 21.07]]
        },
        'city_praga_1796': {
            id: 'city_praga_1796',
            wms_layer: 'rauch_2180',
            title: { ro: 'Planul Suburbiei Praga (Varșovia) 1:7 200 (1796)', en: 'Praga Suburb (Warsaw) Plan 1:7,200 (1796)', pl: 'Original Plan der Vorstadt Praga (1796)' },
            scale: '1:7 200',
            years: '1796',
            provider: 'Johann Georg Gustav von Rauch / Staatsbibliothek zu Berlin / IH PAN',
            bounds: [[52.22, 20.99], [52.28, 21.07]]
        }
    };

    // ── Clasificare pe Țări Europene și Acoperire (%) ──
    var COUNTRIES_DATA = [
        {
            code: 'PL',
            flag: '🇵🇱',
            name: { ro: 'Polonia', en: 'Poland', pl: 'Polska' },
            maps: [
                { id: 'wig100k', pct: 100.0 },
                { id: 'chrzanowski', pct: 100.0 },
                { id: 'kdr_gb', pct: 100.0 },
                { id: 'ukvme', pct: 100.0 },
                { id: 'reymann', pct: 100.0 },
                { id: 'wig500k_1947', pct: 99.9 },
                { id: 'wig300k', pct: 99.7 },
                { id: 'ahp_ziemie_polskie', pct: 99.9 },
                { id: 'ahp_drogi', pct: 99.9 },
                { id: 'ahp_koscielne', pct: 99.9 },
                { id: 'ahp_wlasnosc', pct: 99.9 },
                { id: 'm25k', pct: 97.2 },
                { id: 'kdr', pct: 95.9 },
                { id: 'wig25k', pct: 91.7 },
                { id: 'tkkp_126k', pct: 69.5 },
                { id: 'kdwr', pct: 65.8 },
                { id: 'dwuwiorstowka', pct: 64.0 },
                { id: 'gilly', pct: 57.7 },
                { id: 'schroetter', pct: 38.8 },
                { id: 'textor', pct: 22.6 },
                { id: 'kummersberg', pct: 20.3 },
                { id: 'gaul', pct: 7.8 },
                // City plans
                { id: 'city_warszawa', pct: 100.0, isCity: true },
                { id: 'city_krakow', pct: 100.0, isCity: true },
                { id: 'city_gdansk', pct: 100.0, isCity: true },
                { id: 'city_wroclaw', pct: 100.0, isCity: true },
                { id: 'city_poznan', pct: 100.0, isCity: true },
                { id: 'city_lodz', pct: 100.0, isCity: true },
                { id: 'city_katowice', pct: 100.0, isCity: true },
                { id: 'city_czestochowa', pct: 100.0, isCity: true },
                { id: 'city_bialystok', pct: 100.0, isCity: true },
                { id: 'city_bydgoszcz', pct: 100.0, isCity: true },
                { id: 'city_torun', pct: 100.0, isCity: true },
                { id: 'city_lublin', pct: 100.0, isCity: true },
                { id: 'city_kielce', pct: 100.0, isCity: true },
                { id: 'city_radom', pct: 100.0, isCity: true },
                { id: 'city_rzeszow', pct: 100.0, isCity: true },
                { id: 'city_tarnow', pct: 100.0, isCity: true },
                { id: 'city_grudziadz', pct: 100.0, isCity: true },
                { id: 'city_inowroclaw', pct: 100.0, isCity: true },
                { id: 'city_jaslo', pct: 100.0, isCity: true },
                { id: 'city_siedlce', pct: 100.0, isCity: true },
                { id: 'city_warszawa_lindley', pct: 100.0, isCity: true },
                { id: 'city_warszawa_1822', pct: 100.0, isCity: true },
                { id: 'city_praga_1796', pct: 100.0, isCity: true }
            ]
        },
        {
            code: 'DE',
            flag: '🇩🇪',
            name: { ro: 'Germania', en: 'Germany', pl: 'Niemcy' },
            maps: [
                { id: 'reymann', pct: 100.0 },
                { id: 'kdr', pct: 99.8 },
                { id: 'chrzanowski', pct: 25.3 },
                { id: 'ukvme', pct: 19.4 },
                { id: 'wig100k', pct: 13.4 },
                { id: 'kdr_gb', pct: 8.6 },
                { id: 'wig500k_1947', pct: 7.0 },
                { id: 'm25k', pct: 3.5 },
                { id: 'wig300k', pct: 1.4 },
                { id: 'ahp_ziemie_polskie', pct: 0.7 },
                { id: 'ahp_drogi', pct: 0.7 },
                { id: 'ahp_koscielne', pct: 0.7 },
                { id: 'ahp_wlasnosc', pct: 0.7 },
                { id: 'gilly', pct: 0.1 }
            ]
        },
        {
            code: 'UA',
            flag: '🇺🇦',
            name: { ro: 'Ucraina', en: 'Ukraine', pl: 'Ukraina' },
            maps: [
                { id: 'chrzanowski', pct: 87.2 },
                { id: 'ukvme', pct: 69.5 },
                { id: 'reymann', pct: 27.9 },
                { id: 'wig100k', pct: 27.0 },
                { id: 'kdr_gb', pct: 24.8 },
                { id: 'wig300k', pct: 13.1 },
                { id: 'wig25k', pct: 11.7 },
                { id: 'kummersberg', pct: 8.5 },
                { id: 'kdwr', pct: 7.4 },
                { id: 'wig500k_1947', pct: 6.5 },
                { id: 'dwuwiorstowka', pct: 5.7 },
                { id: 'ahp_ziemie_polskie', pct: 2.8 },
                { id: 'ahp_drogi', pct: 2.8 },
                { id: 'ahp_koscielne', pct: 2.8 },
                { id: 'ahp_wlasnosc', pct: 2.8 },
                { id: 'm25k', pct: 2.7 },
                { id: 'tkkp_126k', pct: 2.5 },
                { id: 'kdr', pct: 1.8 }
            ]
        },
        {
            code: 'BY',
            flag: '🇧🇾',
            name: { ro: 'Belarus', en: 'Belarus', pl: 'Białoruś' },
            maps: [
                { id: 'chrzanowski', pct: 100.0 },
                { id: 'ukvme', pct: 100.0 },
                { id: 'kdwr', pct: 75.4 },
                { id: 'dwuwiorstowka', pct: 62.8 },
                { id: 'wig100k', pct: 55.3 },
                { id: 'kdr_gb', pct: 51.5 },
                { id: 'wig300k', pct: 36.5 },
                { id: 'wig25k', pct: 32.3 },
                { id: 'reymann', pct: 26.8 },
                { id: 'wig500k_1947', pct: 13.6 },
                { id: 'tkkp_126k', pct: 9.1 },
                { id: 'ahp_ziemie_polskie', pct: 7.2 },
                { id: 'ahp_drogi', pct: 7.2 },
                { id: 'ahp_koscielne', pct: 7.2 },
                { id: 'ahp_wlasnosc', pct: 7.2 },
                { id: 'm25k', pct: 4.8 },
                { id: 'kdr', pct: 3.5 },
                { id: 'textor', pct: 2.2 }
            ]
        },
        {
            code: 'LT',
            flag: '🇱🇹',
            name: { ro: 'Lituania', en: 'Lithuania', pl: 'Litwa' },
            maps: [
                { id: 'chrzanowski', pct: 100.0 },
                { id: 'kdwr', pct: 100.0 },
                { id: 'ukvme', pct: 100.0 },
                { id: 'dwuwiorstowka', pct: 98.4 },
                { id: 'wig100k', pct: 92.1 },
                { id: 'kdr_gb', pct: 89.5 },
                { id: 'wig300k', pct: 83.4 },
                { id: 'm25k', pct: 74.8 },
                { id: 'kdr', pct: 64.2 },
                { id: 'wig25k', pct: 52.6 },
                { id: 'wig500k_1947', pct: 51.8 },
                { id: 'tkkp_126k', pct: 48.2 },
                { id: 'textor', pct: 46.8 },
                { id: 'reymann', pct: 43.9 },
                { id: 'schroetter', pct: 31.5 },
                { id: 'ahp_ziemie_polskie', pct: 28.6 },
                { id: 'ahp_drogi', pct: 28.6 },
                { id: 'ahp_koscielne', pct: 28.6 },
                { id: 'ahp_wlasnosc', pct: 28.6 }
            ]
        },
        {
            code: 'LV',
            flag: '🇱🇻',
            name: { ro: 'Letonia', en: 'Latvia', pl: 'Łotwa' },
            maps: [
                { id: 'chrzanowski', pct: 100.0 },
                { id: 'ukvme', pct: 100.0 },
                { id: 'kdwr', pct: 83.1 },
                { id: 'dwuwiorstowka', pct: 12.4 },
                { id: 'wig100k', pct: 11.8 }
            ]
        },
        {
            code: 'CZ',
            flag: '🇨🇿',
            name: { ro: 'Cehia', en: 'Czech Republic', pl: 'Czechy' },
            maps: [
                { id: 'reymann', pct: 100.0 },
                { id: 'kdr', pct: 88.6 },
                { id: 'kdr_gb', pct: 87.2 },
                { id: 'ukvme', pct: 86.4 },
                { id: 'wig100k', pct: 72.1 },
                { id: 'chrzanowski', pct: 68.2 },
                { id: 'wig500k_1947', pct: 62.7 },
                { id: 'm25k', pct: 46.8 },
                { id: 'wig300k', pct: 35.1 }
            ]
        },
        {
            code: 'SK',
            flag: '🇸🇰',
            name: { ro: 'Slovacia', en: 'Slovakia', pl: 'Słowacja' },
            maps: [
                { id: 'chrzanowski', pct: 100.0 },
                { id: 'ukvme', pct: 100.0 },
                { id: 'kdr_gb', pct: 98.2 },
                { id: 'reymann', pct: 97.6 },
                { id: 'wig100k', pct: 52.4 },
                { id: 'wig500k_1947', pct: 38.5 },
                { id: 'wig300k', pct: 24.3 },
                { id: 'm25k', pct: 11.2 },
                { id: 'kdr', pct: 9.4 }
            ]
        },
        {
            code: 'AT',
            flag: '🇦🇹',
            name: { ro: 'Austria', en: 'Austria', pl: 'Austria' },
            maps: [
                { id: 'kdr', pct: 87.4 },
                { id: 'ukvme', pct: 81.6 },
                { id: 'reymann', pct: 75.8 },
                { id: 'chrzanowski', pct: 38.9 },
                { id: 'kdr_gb', pct: 31.7 }
            ]
        },
        {
            code: 'HU',
            flag: '🇭🇺',
            name: { ro: 'Ungaria', en: 'Hungary', pl: 'Węgry' },
            maps: [
                { id: 'chrzanowski', pct: 84.5 },
                { id: 'ukvme', pct: 83.7 },
                { id: 'reymann', pct: 52.8 },
                { id: 'kdr', pct: 33.2 },
                { id: 'kdr_gb', pct: 9.5 },
                { id: 'wig100k', pct: 8.4 }
            ]
        },
        {
            code: 'RU',
            flag: '🇷🇺',
            name: { ro: 'Rusia / Kaliningrad', en: 'Russia / Kaliningrad', pl: 'Rosja / Kaliningrad' },
            maps: [
                { id: 'wig100k', pct: 100.0 },
                { id: 'wig300k', pct: 100.0 },
                { id: 'tkkp_126k', pct: 100.0 },
                { id: 'chrzanowski', pct: 100.0 },
                { id: 'schroetter', pct: 100.0 },
                { id: 'm25k', pct: 100.0 },
                { id: 'kdr', pct: 100.0 },
                { id: 'kdr_gb', pct: 100.0 },
                { id: 'kdwr', pct: 100.0 },
                { id: 'ukvme', pct: 100.0 },
                { id: 'reymann', pct: 100.0 },
                { id: 'dwuwiorstowka', pct: 100.0 },
                { id: 'wig25k', pct: 95.3 },
                { id: 'wig500k_1947', pct: 94.6 },
                { id: 'textor', pct: 91.8 },
                { id: 'ahp_ziemie_polskie', pct: 91.2 },
                { id: 'ahp_drogi', pct: 91.2 },
                { id: 'ahp_koscielne', pct: 91.2 },
                { id: 'ahp_wlasnosc', pct: 91.2 }
            ]
        },
        {
            code: 'MD',
            flag: '🇲🇩',
            name: { ro: 'Republica Moldova', en: 'Moldova', pl: 'Mołdawia' },
            maps: [
                { id: 'ukvme', pct: 76.5 },
                { id: 'chrzanowski', pct: 70.7 },
                { id: 'reymann', pct: 40.1 },
                { id: 'wig100k', pct: 21.3 },
                { id: 'kdr_gb', pct: 17.1 }
            ]
        },
        {
            code: 'RO',
            flag: '🇷🇴',
            name: { ro: 'România', en: 'Romania', pl: 'Rumunia' },
            maps: [
                { id: 'ukvme', pct: 26.4 },
                { id: 'chrzanowski', pct: 24.7 },
                { id: 'reymann', pct: 20.2 },
                { id: 'kdr', pct: 1.6 },
                { id: 'kdr_gb', pct: 1.4 },
                { id: 'wig100k', pct: 1.2 }
            ]
        },
        {
            code: 'FR',
            flag: '🇫🇷',
            name: { ro: 'Franța', en: 'France', pl: 'Francja' },
            maps: [
                { id: 'reymann', pct: 13.1 },
                { id: 'kdr', pct: 9.4 }
            ]
        },
        {
            code: 'BE-LU',
            flag: '🇧🇪',
            name: { ro: 'Belgia & Luxemburg', en: 'Belgium & Luxembourg', pl: 'Belgia i Luksemburg' },
            maps: [
                { id: 'reymann', pct: 33.1 },
                { id: 'kdr', pct: 17.4 }
            ]
        },
        {
            code: 'NL',
            flag: '🇳🇱',
            name: { ro: 'Țările de Jos', en: 'Netherlands', pl: 'Holandia' },
            maps: [
                { id: 'reymann', pct: 52.2 },
                { id: 'kdr', pct: 36.0 }
            ]
        },
        {
            code: 'DK',
            flag: '🇩🇰',
            name: { ro: 'Danemarca', en: 'Denmark', pl: 'Dania' },
            maps: [
                { id: 'kdr', pct: 52.7 },
                { id: 'reymann', pct: 50.8 },
                { id: 'chrzanowski', pct: 14.0 },
                { id: 'ukvme', pct: 8.0 }
            ]
        },
        {
            code: 'EE',
            flag: '🇪🇪',
            name: { ro: 'Estonia', en: 'Estonia', pl: 'Estonia' },
            maps: [
                { id: 'ukvme', pct: 86.8 },
                { id: 'kdwr', pct: 11.3 },
                { id: 'chrzanowski', pct: 10.3 }
            ]
        },
        {
            code: 'CH',
            flag: '🇨🇭',
            name: { ro: 'Elveția', en: 'Switzerland', pl: 'Szwajcaria' },
            maps: [
                { id: 'reymann', pct: 52.2 },
                { id: 'kdr', pct: 20.6 }
            ]
        }
    ];

    // ── Instanțe de Straturi Leaflet (cache) ──
    var _leafletLayers = {};
    var _activeMap = null;
    var _selectedCountryCode = 'ALL';

    function getLang() {
        try {
            var docLang = document.documentElement && document.documentElement.lang;
            if (docLang === 'en' || docLang === 'ro' || docLang === 'pl') return docLang;
            var stored = root.localStorage && root.localStorage.getItem('detectlab_lang');
            if (stored === 'en' || stored === 'ro' || stored === 'pl') return stored;
            if (root.DetectLabSite && root.DetectLabSite.defaultLanguage) return root.DetectLabSite.defaultLanguage;
        } catch (e) {}
        return 'ro';
    }

    function getMapInstance() {
        return _activeMap || root._dlMap || root.map || null;
    }

    function createLeafletLayer(mapKey) {
        if (_leafletLayers[mapKey]) return _leafletLayers[mapKey];
        var mapMeta = MAPS_CATALOG[mapKey];
        if (!mapMeta) return null;

        var paneName = 'pane_cenagis_' + mapKey;
        var mapInst = getMapInstance();
        if (mapInst && typeof mapInst.createPane === 'function' && !mapInst.getPane(paneName)) {
            mapInst.createPane(paneName);
            var pane = mapInst.getPane(paneName);
            if (pane) {
                pane.style.zIndex = 635;
                pane.style.pointerEvents = 'none';
            }
        }

        var layer = L.tileLayer.wms(WMS_BASE_URL, {
            layers: 'topp:' + mapMeta.wms_layer,
            format: 'image/png',
            transparent: true,
            version: '1.3.0',
            crs: L.CRS.EPSG3857,
            opacity: 0.80,
            pane: paneName,
            attribution: '© ' + mapMeta.provider + ' · <a href="https://pastmaps.cenagis.edu.pl" target="_blank" rel="noopener">CENAGIS</a> / <a href="https://atlasfontium.pl" target="_blank" rel="noopener">IH PAN</a>'
        });

        _leafletLayers[mapKey] = layer;
        return layer;
    }

    function toggleCenagisLayer(mapKey, on) {
        var mapInst = getMapInstance();
        if (!mapInst) return;
        var layer = createLeafletLayer(mapKey);
        if (!layer) return;

        if (on) {
            var masterToggle = document.getElementById('histEuToggle');
            if (masterToggle && !masterToggle.checked) {
                masterToggle.checked = true;
            }
            if (!mapInst.hasLayer(layer)) {
                layer.addTo(mapInst);
            }
        } else {
            if (mapInst.hasLayer(layer)) {
                mapInst.removeLayer(layer);
            }
        }

        // Sincronizează toate checkbox-urile cu aceeași cheie de hartă (dacă o hartă apare în mai multe țări)
        var checkboxes = document.querySelectorAll('.cenagis-toggle[data-map-key="' + mapKey + '"]');
        checkboxes.forEach(function (cb) {
            if (cb.checked !== on) cb.checked = on;
        });

        if (typeof root.updatePremiumMapCoverageVisibility === 'function') {
            root.updatePremiumMapCoverageVisibility();
        }
    }

    function setCenagisLayerOpacity(mapKey, val) {
        var layer = createLeafletLayer(mapKey);
        var opacity = val / 100;
        if (layer && typeof layer.setOpacity === 'function') {
            layer.setOpacity(opacity);
        }

        // Sincronizează toate slider-ele și etichetele % pentru această hartă
        var sliders = document.querySelectorAll('.cenagis-opacity-slider[data-map-key="' + mapKey + '"]');
        sliders.forEach(function (s) {
            if (s.value !== String(val)) s.value = String(val);
        });
        var pctLabels = document.querySelectorAll('.cenagis-pct[data-map-key="' + mapKey + '"]');
        pctLabels.forEach(function (p) {
            p.textContent = val + '%';
        });
    }

    function toggleHistEuSubLayers() {
        var subContainer = document.getElementById('histEuSubLayers');
        var icon = document.getElementById('histEuExpandIcon');
        if (!subContainer) return;

        var isCollapsed = subContainer.style.maxHeight === '0px' || subContainer.style.opacity === '0' || !subContainer.style.maxHeight;
        if (isCollapsed) {
            subContainer.style.maxHeight = 'none';
            subContainer.style.opacity = '1';
            subContainer.style.marginTop = '8px';
            if (icon) icon.style.transform = 'rotate(0deg)';
        } else {
            subContainer.style.maxHeight = '0px';
            subContainer.style.opacity = '0';
            subContainer.style.marginTop = '0px';
            if (icon) icon.style.transform = 'rotate(-90deg)';
        }
    }

    function toggleHistEuLayer(on) {
        if (!on) {
            Object.keys(_leafletLayers).forEach(function (k) {
                var layer = _leafletLayers[k];
                var mapInst = getMapInstance();
                if (mapInst && layer && mapInst.hasLayer(layer)) {
                    mapInst.removeLayer(layer);
                }
            });
            var checkboxes = document.querySelectorAll('.cenagis-toggle');
            checkboxes.forEach(function (cb) {
                cb.checked = false;
            });
        }
    }

    function filterCountry(countryCode) {
        _selectedCountryCode = countryCode || 'ALL';
        var lang = getLang();
        var cards = document.querySelectorAll('.hist-eu-country-card');
        cards.forEach(function (card) {
            var cCode = card.getAttribute('data-country-code');
            if (_selectedCountryCode === 'ALL' || _selectedCountryCode === cCode) {
                card.style.display = '';
            } else {
                card.style.display = 'none';
            }
        });

        var pills = document.querySelectorAll('.hist-eu-country-pill');
        pills.forEach(function (p) {
            var pCode = p.getAttribute('data-country-code');
            if (pCode === _selectedCountryCode) {
                p.classList.add('active');
            } else {
                p.classList.remove('active');
            }
        });
    }

    function showMapInfo(mapKey) {
        var meta = MAPS_CATALOG[mapKey];
        if (!meta) return;
        var lang = getLang();
        var title = meta.title[lang] || meta.title.en || meta.title.ro;
        var desc = (lang === 'ro')
            ? ('Scară: ' + meta.scale + '\nPerioadă / Ani: ' + meta.years + '\nSursă / Institut: ' + meta.provider + '\nEndpoint: ' + WMS_BASE_URL + '\nStrat WMS: topp:' + meta.wms_layer)
            : ('Scale: ' + meta.scale + '\nPeriod / Years: ' + meta.years + '\nSource / Institute: ' + meta.provider + '\nEndpoint: ' + WMS_BASE_URL + '\nWMS Layer: topp:' + meta.wms_layer);

        if (typeof root.showLayerInfo === 'function') {
            root.showLayerInfo(title, desc);
        } else {
            alert(title + '\n\n' + desc);
        }
    }

    // ── Generare DOM UI în #histEuSubLayers ──
    function renderUi() {
        var container = document.getElementById('histEuSubLayers');
        if (!container) return;

        var lang = getLang();
        var allText = (lang === 'ro') ? 'Toate țările' : 'All countries';
        var searchPlaceholder = (lang === 'ro') ? 'Caută țară sau hartă...' : 'Search country or map...';

        var html = [];

        // 1. Selector / Pills pentru țări
        html.push('<div class="hist-eu-filter-wrap" style="margin-bottom:8px;">');
        html.push('  <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;">');
        html.push('    <span style="font-size:0.7rem;color:rgba(200,169,110,0.9);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Țară / Country</span>');
        html.push('    <select id="histEuCountrySelect" onchange="DetectLabEuMaps.filterCountry(this.value)" style="background:rgba(20,24,28,0.95);border:1px solid rgba(200,169,110,0.35);color:#f5f0eb;font-size:0.74rem;border-radius:4px;padding:2px 6px;cursor:pointer;outline:none;">');
        html.push('      <option value="ALL">🌍 ' + allText + ' (' + COUNTRIES_DATA.length + ')</option>');
        COUNTRIES_DATA.forEach(function (c) {
            var cName = c.name[lang] || c.name.en || c.name.ro;
            html.push('      <option value="' + c.code + '">' + c.flag + ' ' + cName + ' (' + c.maps.length + ')</option>');
        });
        html.push('    </select>');
        html.push('  </div>');

        // Quick scrollable pills
        html.push('  <div style="display:flex;gap:4px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin;">');
        html.push('    <button type="button" class="hist-eu-country-pill active" data-country-code="ALL" onclick="DetectLabEuMaps.filterCountry(\'ALL\')" style="background:rgba(200,169,110,0.15);border:1px solid rgba(200,169,110,0.4);color:#c8a96e;font-size:0.68rem;padding:2px 6px;border-radius:10px;cursor:pointer;white-space:nowrap;">🌍 ' + allText + '</button>');
        COUNTRIES_DATA.forEach(function (c) {
            var cName = c.name[lang] || c.name.en || c.name.ro;
            html.push('    <button type="button" class="hist-eu-country-pill" data-country-code="' + c.code + '" onclick="DetectLabEuMaps.filterCountry(\'' + c.code + '\')" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:rgba(245,240,235,0.85);font-size:0.68rem;padding:2px 6px;border-radius:10px;cursor:pointer;white-space:nowrap;">' + c.flag + ' ' + c.code + '</button>');
        });
        html.push('  </div>');
        html.push('</div>');

        // 2. Lista țărilor cu hărțile lor
        html.push('<div class="hist-eu-countries-list" style="display:flex;flex-direction:column;gap:10px;">');

        COUNTRIES_DATA.forEach(function (c) {
            var cName = c.name[lang] || c.name.en || c.name.ro;
            html.push('<div class="hist-eu-country-card" data-country-code="' + c.code + '" style="background:rgba(255,255,255,0.03);border:1px solid rgba(200,169,110,0.22);border-radius:6px;padding:8px 8px 6px 8px;">');
            
            // Header țară
            html.push('  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;border-bottom:1px solid rgba(200,169,110,0.15);padding-bottom:4px;">');
            html.push('    <span style="font-size:0.78rem;font-weight:600;color:#c8a96e;display:flex;align-items:center;gap:5px;">' + c.flag + ' <span>' + cName + '</span> <span style="font-size:0.65rem;color:rgba(245,240,235,0.5);font-weight:normal;">(' + c.maps.length + ' hărți)</span></span>');
            html.push('    <span style="font-size:0.62rem;color:rgba(200,169,110,0.7);background:rgba(200,169,110,0.1);padding:1px 5px;border-radius:3px;">CENAGIS / IH PAN</span>');
            html.push('  </div>');

            // Hărțile țării
            html.push('  <div style="display:flex;flex-direction:column;gap:7px;">');
            c.maps.forEach(function (mRef) {
                var m = MAPS_CATALOG[mRef.id];
                if (!m) return;
                var mTitle = m.title[lang] || m.title.en || m.title.ro;
                var coverageBadge = mRef.isCity ? '📍 Plan Urban' : (mRef.pct + '% acoperire');
                var coverageColor = (mRef.pct >= 90) ? '#4ade80' : ((mRef.pct >= 40) ? '#facc15' : '#fb923c');
                if (mRef.isCity) coverageColor = '#60a5fa';

                html.push('    <div class="hist-eu-map-row" data-map-id="' + m.id + '" style="background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.06);border-radius:5px;padding:6px 6px 5px 6px;">');
                
                // Nume hartă + Switch
                html.push('      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:4px;">');
                html.push('        <div style="min-width:0;flex:1;">');
                html.push('          <div style="font-size:0.74rem;color:#f5f0eb;font-weight:500;line-height:1.25;word-break:break-word;">' + mTitle + '</div>');
                html.push('          <div style="display:flex;align-items:center;gap:5px;margin-top:2px;flex-wrap:wrap;">');
                html.push('            <span style="font-size:0.62rem;color:rgba(245,240,235,0.6);">' + m.scale + ' · ' + m.years + '</span>');
                html.push('            <span style="font-size:0.58rem;font-weight:600;color:' + coverageColor + ';background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:3px;">' + coverageBadge + '</span>');
                html.push('          </div>');
                html.push('        </div>');
                html.push('        <label class="apm-toggle-switch" style="transform:scale(0.8);transform-origin:right top;flex-shrink:0;">');
                html.push('          <input type="checkbox" class="cenagis-toggle" data-map-key="' + m.id + '" onchange="DetectLabEuMaps.toggleCenagisLayer(\'' + m.id + '\', this.checked)">');
                html.push('          <span class="apm-toggle-track"></span>');
                html.push('        </label>');
                html.push('      </div>');

                // Slider Opacitate + Info
                html.push('      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:2px;">');
                html.push('        <span style="font-size:0.66rem;color:rgba(245,240,235,0.45);">Opacity</span>');
                html.push('        <input type="range" class="transp-slider cenagis-opacity-slider" data-map-key="' + m.id + '" min="0" max="100" value="80" style="flex:1;height:4px;margin:0 4px;" oninput="DetectLabEuMaps.setCenagisLayerOpacity(\'' + m.id + '\', this.value)">');
                html.push('        <span style="display:flex;align-items:center;gap:4px;">');
                html.push('          <span class="pct cenagis-pct" data-map-key="' + m.id + '" style="font-size:0.66rem;color:rgba(245,240,235,0.7);min-width:24px;text-align:right;">80%</span>');
                html.push('          <button type="button" class="layer-info-btn" onclick="event.stopPropagation();DetectLabEuMaps.showMapInfo(\'' + m.id + '\')" title="Layer info" style="background:none;border:none;cursor:pointer;color:rgba(200,169,110,0.8);padding:1px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="7.5" r="1.3" fill="currentColor"/><rect x="10.8" y="10.5" width="2.4" height="7" rx="1.2" fill="currentColor"/></svg></button>');
                html.push('        </span>');
                html.push('      </div>');

                html.push('    </div>');
            });
            html.push('  </div>');

            html.push('</div>');
        });

        html.push('</div>');

        container.innerHTML = html.join('\n');
    }

    // ── Export public ──
    var DetectLabEuMaps = {
        catalog: MAPS_CATALOG,
        countries: COUNTRIES_DATA,
        toggleCenagisLayer: toggleCenagisLayer,
        setCenagisLayerOpacity: setCenagisLayerOpacity,
        toggleHistEuLayer: toggleHistEuLayer,
        toggleHistEuSubLayers: toggleHistEuSubLayers,
        filterCountry: filterCountry,
        showMapInfo: showMapInfo,
        renderUi: renderUi,
        init: function (leafletMap) {
            if (leafletMap) _activeMap = leafletMap;
            renderUi();
            // Re-render when language changes
            document.addEventListener('detectlab:langchange', function () {
                renderUi();
                if (_selectedCountryCode) filterCountry(_selectedCountryCode);
            });
        }
    };

    root.DetectLabEuMaps = DetectLabEuMaps;
    root.toggleHistEuLayer = toggleHistEuLayer;
    root.toggleHistEuSubLayers = toggleHistEuSubLayers;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            DetectLabEuMaps.init();
        });
    } else {
        DetectLabEuMaps.init();
    }

}(window));

/* DetectLab National Archaeological Evidence Engine — "Dosarul arheologic"
 * Complete historical dossier per the canonical specification:
 *   RO: data/dossier-spec/FISA_ISTORICA_PROMPT_RO.md
 *   EN: data/dossier-spec/HISTORICAL_RECORD_PROMPT_EN.md
 * Evidence is retrieved exclusively from biblioteca-digitala.ro and assembled
 * deterministically by the backend (SIRUTA identity + verified claims).
 * Every UI string exists in BOTH site language variants (ro / en).
 */
(function () {
    'use strict';
    var MIN_ZOOM = 10;
    var API_BASE = window.DETECTLAB_API_BASE || 'https://detectlab-backend-production.up.railway.app/api';
    var running = false, lastResult = null, lastForm = null, lastNominatimAt = 0;

    /* ── i18n dictionaries — kept in strict ro/en parity (tested) ── */
    var C = {
        ro: {
            title: 'Biblioteca din Babel',
            subtitle: 'Fișă istorică documentată · SIRUTA + dovezi verificate',
            button: 'Cercetează zona', zoom: 'Zoom in mai mult',
            locating: 'Identificăm localitatea…', search: 'Cercetăm sursele și analizăm documentele…',
            failed: 'Cercetarea nu a putut fi finalizată.',
            sourceUnavailable: 'Sursa de publicații biblioteca-digitala.ro este momentan indisponibilă. Încearcă din nou mai târziu.',
            sourceTimeout: 'Sursa de publicații a răspuns prea lent. Încearcă din nou.',
            no: 'Nu au fost identificate claim-uri arheologice verificabile. Încearcă aliasuri istorice.',
            locality: 'Localitate', county: 'Județ (opțional)', aliases: 'Aliasuri istorice (separate prin virgulă)', run: 'Cercetează',
            sourcePolicy: 'Dovezi: Biblioteca Digitală / ProEuropeana · Identitate: INS SIRUTA',
            claims: 'dovezi', docs: 'documente analizate', quote: 'Dovadă din sursă', page: 'Pagina',
            original: 'Vezi documentul original', why: 'De ce este atribuit?', images: 'Figuri asociate',
            export: 'Exportă dosarul JSON', close: 'Închide', confidence: 'Încredere', unverified: 'Necesită verificare', ocr: 'Document scanat: OCR necesar',
            methodTitle: 'SIRUTA → ALIASURI → DOVEZI → PERIOADE → SECȚIUNI → CERTITUDINE → SURSE',
            methodLine: 'Identificare exactă (SIRUTA + județ + UAT) → extragere dovezi cu extras și pagină → clasificare pe perioade și secțiuni → nivel de certitudine → surse ierarhizate',
            ambiguousTitle: 'IDENTIFICARE INSUFICIENTĂ',
            ambiguousHelp: 'Există mai multe localități cu acest nume. Alege localitatea exactă (județ + UAT + SIRUTA) — informațiile nu se transferă între omonime (§1).',
            newSearch: 'Caută altă localitate',
            specRef: 'Specificație completă',
            noSource: 'Nu a fost identificată o sursă verificabilă.',
            sectIdentity: 'Identitate', sectNames: 'Denumiri istorice', sectAttestation: 'Prima atestare',
            sectHistory: 'Istorie', sectAdmin: 'Evoluție administrativă', sectPopulation: 'Populație',
            sectFamilies: 'Familii / proprietari / moșii', sectBuildings: 'Clădiri și monumente istorice',
            sectSites: 'Situri arheologice documentate', sectNearby: 'Situri din vecinătate',
            sectVanished: 'Localități / cătune dispărute', sectToponymy: 'Toponimie istorică',
            sectMaps: 'Hărți istorice', sectChecks: 'Verificare identitate (CHECK 1–7)',
            sectSources: 'Surse', sectCertainty: 'Nivel general de certitudine', sectAppendix: 'Anexă — dovezi complete',
            fName: 'Denumire', fCounty: 'Județ', fUat: 'UAT', fType: 'Tip', fSiruta: 'Cod SIRUTA',
            fCountyCode: 'Cod județ', fCoords: 'Coordonate', fLat: 'Latitudine', fLng: 'Longitudine',
            fLevel: 'Nivel', fParent: 'SIRUTA părinte', fRegSource: 'Sursă registru',
            colForm: 'Forma numelui', colType: 'Tip', colLang: 'Limbă', colVerified: 'Verificat',
            verifiedYes: 'da', verifiedNo: 'nu',
            namesNote: 'Variantele neverificate sunt marcate. Nu se presupune că două nume asemănătoare desemnează aceeași localitate (§3).',
            fYear: 'An', fHistoricalForm: 'Formă istorică', fDocument: 'Document', fDocumentType: 'Tip document',
            fDocumentLang: 'Limba documentului', fSource: 'Sursă', conflictsIntro: 'Conflicte între surse (§18)',
            conflictsNote: 'Documentul original trebuie verificat pentru stabilirea valorii corecte.',
            periodUnspecified: 'Perioadă nespecificată', historyNote: 'Perioadele fără dovezi rămân explicit necompletate — nu se estimează (§20).',
            fRanCode: 'Cod RAN', fCategory: 'Categorie', fSiteType: 'Tip', fComponents: 'Componente',
            fEpoch: 'Epocă', fPeriod: 'Perioadă', fCulture: 'Cultură', fChronology: 'Cronologie',
            fDescription: 'Descriere', fLmi: 'Cod LMI', fLinkRan: 'Link RAN/CIMEC', fOtherSources: 'Alte surse',
            unknownCulture: 'Necunoscut / nespecificat', notIdentified: 'nu a fost identificat',
            ranPendingTitle: 'Integrare RAN / CIMEC în curs',
            ranPendingBody: 'Codurile RAN și LMI, cultura arheologică și coordonatele siturilor se completează exclusiv din Repertoriul Arheologic Național. Până la integrare, aceste câmpuri rămân necompletate — nu se inventează identificatori (§13, §20).',
            officialPortals: 'Portaluri oficiale',
            nearbyNote: 'Secțiune rezervată siturilor atribuite explicit altor localități. Nu se mută situri între localități pe baza proximității (§12).',
            checkPass: 'OK', checkPending: 'în așteptare', checkFail: 'eșuat',
            checksIntro: 'Verificarea finală anti-omonime execută înainte de afișarea fișei (§21).',
            level1: 'Nivel 1 — surse oficiale', level2: 'Nivel 2 — surse academice',
            level3: 'Nivel 3 — surse locale', level4: 'Nivel 4 — surse secundare',
            notIntegrated: 'în curs de integrare',
            cIdentification: 'Identificarea localității', cNames: 'Denumiri istorice', cAttestation: 'Prima atestare',
            cHistory: 'Istoria localității', cSites: 'Situri arheologice', cToponymy: 'Toponimie', cOther: 'Alte informații',
            certCERT: 'Cert', certPROBABLE: 'Probabil', certCONTESTED: 'Controversat', certHYPOTHESIS: 'Ipoteză', certNO_DATA: 'fără date',
            legacyTitle: 'Dovezi arheologice',
            storageError: 'Stocarea bazei de date a eșuat. Reîncearcă într-un moment.',
            schemaError: 'Structura bazei de date de pe server nu este la zi; cercetarea este temporar indisponibilă.',
            notFound: 'Localitatea nu se află în registrul SIRUTA importat. Verifică denumirea sau alege o localitate de pe hartă.',
            truncatedNotice: 'Cercetarea s-a oprit la limita de timp impusă sursei: lista de mai jos este parțială și va fi completată la o căutare ulterioară.',
            retryLater: 'Reîncearcă', requestId: 'ID eroare',
            quotesRo: 'Citatele sunt redate în limba originală a publicației (română).',
            generatedAt: 'Generat', schemaLabel: 'Schema'
        },
        en: {
            title: 'Library of Babel',
            subtitle: 'Documented historical record · SIRUTA + verified evidence',
            button: 'Research area', zoom: 'Zoom in more',
            locating: 'Identifying locality…', search: 'Searching sources and analysing documents…',
            failed: 'Research could not be completed.',
            sourceUnavailable: 'The publication source biblioteca-digitala.ro is temporarily unavailable. Please try again later.',
            sourceTimeout: 'The publication source responded too slowly. Please try again.',
            no: 'No verifiable archaeological claims were identified. Try historical aliases.',
            locality: 'Locality', county: 'County (optional)', aliases: 'Historical aliases (comma-separated)', run: 'Research',
            sourcePolicy: 'Evidence: Digital Library / ProEuropeana · Identity: INS SIRUTA',
            claims: 'claims', docs: 'documents analysed', quote: 'Source evidence', page: 'Page',
            original: 'View original document', why: 'Why was this attributed?', images: 'Associated figures',
            export: 'Export dossier JSON', close: 'Close', confidence: 'Confidence', unverified: 'Needs verification', ocr: 'Scanned document: OCR required',
            methodTitle: 'SIRUTA → ALIASES → EVIDENCE → PERIODS → SECTIONS → CERTAINTY → SOURCES',
            methodLine: 'Exact identification (SIRUTA + county + UAT) → evidence extraction with excerpt and page → classification by period and section → certainty level → ranked sources',
            ambiguousTitle: 'INSUFFICIENT IDENTIFICATION',
            ambiguousHelp: 'Several localities share this name. Pick the exact locality (county + UAT + SIRUTA) — information is never transferred between homonyms (§1).',
            newSearch: 'Search another locality',
            specRef: 'Full specification',
            noSource: 'No verifiable source was identified.',
            sectIdentity: 'Identity', sectNames: 'Historical names', sectAttestation: 'First attestation',
            sectHistory: 'History', sectAdmin: 'Administrative evolution', sectPopulation: 'Population',
            sectFamilies: 'Families / owners / estates', sectBuildings: 'Historic buildings and monuments',
            sectSites: 'Documented archaeological sites', sectNearby: 'Sites in the vicinity',
            sectVanished: 'Vanished localities / hamlets', sectToponymy: 'Historical toponymy',
            sectMaps: 'Historical maps', sectChecks: 'Identity verification (CHECK 1–7)',
            sectSources: 'Sources', sectCertainty: 'Overall level of certainty', sectAppendix: 'Appendix — full evidence',
            fName: 'Name', fCounty: 'County', fUat: 'UAT', fType: 'Type', fSiruta: 'SIRUTA code',
            fCountyCode: 'County code', fCoords: 'Coordinates', fLat: 'Latitude', fLng: 'Longitude',
            fLevel: 'Level', fParent: 'Parent SIRUTA', fRegSource: 'Register source',
            colForm: 'Name form', colType: 'Type', colLang: 'Language', colVerified: 'Verified',
            verifiedYes: 'yes', verifiedNo: 'no',
            namesNote: 'Unverified variants are flagged. Two similar names are never assumed to designate the same locality (§3).',
            fYear: 'Year', fHistoricalForm: 'Historical form', fDocument: 'Document', fDocumentType: 'Document type',
            fDocumentLang: 'Document language', fSource: 'Source', conflictsIntro: 'Conflicts between sources (§18)',
            conflictsNote: 'The original document must be verified to establish the correct value.',
            periodUnspecified: 'Unspecified period', historyNote: 'Periods without evidence remain explicitly empty — nothing is estimated (§20).',
            fRanCode: 'RAN code', fCategory: 'Category', fSiteType: 'Type', fComponents: 'Components',
            fEpoch: 'Epoch', fPeriod: 'Period', fCulture: 'Culture', fChronology: 'Chronology',
            fDescription: 'Description', fLmi: 'LMI code', fLinkRan: 'RAN/CIMEC link', fOtherSources: 'Other sources',
            unknownCulture: 'Unknown / not specified', notIdentified: 'not identified',
            ranPendingTitle: 'RAN / CIMEC integration in progress',
            ranPendingBody: 'RAN and LMI codes, the archaeological culture and site coordinates are filled exclusively from the National Archaeological Repertory. Until integration these fields stay empty — no identifiers are invented (§13, §20).',
            officialPortals: 'Official portals',
            nearbyNote: 'Section reserved for sites explicitly attributed to other localities. Sites are never moved between localities based on proximity (§12).',
            checkPass: 'PASS', checkPending: 'pending', checkFail: 'failed',
            checksIntro: 'The final anti-homonym check runs before the record is shown (§21).',
            level1: 'Level 1 — official sources', level2: 'Level 2 — academic sources',
            level3: 'Level 3 — local sources', level4: 'Level 4 — secondary sources',
            notIntegrated: 'integration in progress',
            cIdentification: 'Locality identification', cNames: 'Historical names', cAttestation: 'First attestation',
            cHistory: 'Locality history', cSites: 'Archaeological sites', cToponymy: 'Toponymy', cOther: 'Other information',
            certCERT: 'Certain', certPROBABLE: 'Probable', certCONTESTED: 'Controversial', certHYPOTHESIS: 'Hypothesis', certNO_DATA: 'no data',
            legacyTitle: 'Archaeological evidence',
            storageError: 'The evidence database could not complete the request. Please try again shortly.',
            schemaError: 'The server database schema is out of date; research is temporarily unavailable.',
            notFound: 'This locality is not in the imported SIRUTA register. Check the spelling or pick a locality on the map.',
            truncatedNotice: 'Research stopped at the source time budget: the list below is partial and will be completed by a later search.',
            retryLater: 'Try again', requestId: 'Error ID',
            quotesRo: 'Quotes are given in the original language of the publication (Romanian).',
            generatedAt: 'Generated', schemaLabel: 'Schema'
        }
    };
    /* SIRUTA locality types (stored in Romanian) — translated for the EN variant */
    var TYPES_EN = {
        'municipiu': 'municipality', 'oraș': 'town', 'comună': 'commune', 'sector': 'sector',
        'localitate componentă reședință municipiu': 'municipality-seat component locality',
        'localitate componentă municipiu': 'municipality component locality',
        'sat aparținător municipiu': 'village belonging to a municipality',
        'localitate componentă reședință oraș': 'town-seat component locality',
        'localitate componentă oraș': 'town component locality',
        'sat reședință comună': 'commune-seat village', 'sat component comună': 'commune component village'
    };
    var ALIAS_TYPES = {
        ro: { CURRENT: 'actuală', HISTORICAL: 'istorică', HUNGARIAN: 'maghiară', GERMAN: 'germană', LATIN: 'latină', SLAVIC: 'slavă', ORTHOGRAPHIC: 'ortografică', ADMINISTRATIVE: 'administrativă', VARIANT: 'variantă' },
        en: { CURRENT: 'current', HISTORICAL: 'historical', HUNGARIAN: 'Hungarian', GERMAN: 'German', LATIN: 'Latin', SLAVIC: 'Slavic', ORTHOGRAPHIC: 'spelling', ADMINISTRATIVE: 'administrative', VARIANT: 'variant' }
    };

    function lang() { return typeof window._currentLang === 'function' && window._currentLang() === 'en' ? 'en' : 'ro'; }
    function t(k) { return (C[lang()][k] != null) ? C[lang()][k] : k; }
    function L(bilingual) { return (bilingual && typeof bilingual === 'object') ? (bilingual[lang()] != null ? bilingual[lang()] : bilingual.ro) : bilingual; }
    function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function safeUrl(v) { try { var u = new URL(v); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '#'; } catch (_) { return '#'; } }
    function open() { var m = document.getElementById('babelModal'); if (m) { m.hidden = false; document.body.classList.add('babel-modal-open'); } }
    function close() { var m = document.getElementById('babelModal'); if (m) { m.hidden = true; document.body.classList.remove('babel-modal-open'); } }
    function status(message) { open(); document.getElementById('babelBody').innerHTML = '<div class="babel-state is-loading"><span class="babel-orbit"></span><p>' + esc(message) + '</p></div>'; }
    function isPremium() { if (typeof window._dlIsPremium === 'function') return window._dlIsPremium(); var u = typeof window._authUser === 'function' ? window._authUser() : null; return !!(u && u.plan === 'premium'); }
    function updateButton() { var b = document.getElementById('babelSearchBtn'), m = window._dlMap; if (!b) return; var ok = !!(m && m.getZoom() >= MIN_ZOOM); b.disabled = running || !ok; b.textContent = running ? '…' : ok ? t('button') : t('zoom'); }

    function fetchJson(url, options, timeout) {
        var c = new AbortController(), timer = setTimeout(function () { c.abort(); }, timeout || 120000);
        return fetch(url, Object.assign({}, options || {}, { signal: c.signal })).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (data) {
                if (!r.ok) { var e = new Error(data.message || data.error || ('HTTP ' + r.status)); e.status = r.status; e.data = data; throw e; }
                return data;
            });
        }).finally(function () { clearTimeout(timer); });
    }

    async function reverse(center) {
        var delay = Math.max(0, 1000 - (Date.now() - lastNominatimAt)); if (delay) await new Promise(function (r) { setTimeout(r, delay); });
        lastNominatimAt = Date.now();
        var u = new URL('https://nominatim.openstreetmap.org/reverse');
        u.search = new URLSearchParams({ format: 'jsonv2', lat: center.lat, lon: center.lng, zoom: 10, addressdetails: 1, 'accept-language': lang() });
        var d = await fetchJson(u.href, {}, 15000), a = d.address || {};
        return { name: a.city || a.town || a.village || a.municipality || a.hamlet || '', county: (a.county || '').replace(/^Județul\s+/i, '') };
    }

    function form(place) {
        lastForm = { name: place.name || '', county: place.county || '' };
        open();
        document.getElementById('babelBody').innerHTML =
            '<div class="evidence-intro"><span class="evidence-source-seal">✓</span><div><h2>' + esc(t('title')) + '</h2><p>' + esc(t('sourcePolicy')) + '</p></div></div>' +
            '<form id="evidenceForm" class="evidence-form"><label>' + esc(t('locality')) + '<input id="evidenceLocality" required maxlength="120" value="' + esc(place.name) + '"></label>' +
            '<label>' + esc(t('county')) + '<input id="evidenceCounty" maxlength="80" value="' + esc(place.county) + '"></label>' +
            '<label class="wide">' + esc(t('aliases')) + '<input id="evidenceAliases" maxlength="500" placeholder="Apahida, Apahida I…"></label>' +
            '<button type="submit">' + esc(t('run')) + '</button></form>' +
            '<div class="evidence-method"><b>' + esc(t('methodTitle')) + '</b><span>' + esc(t('methodLine')) + '</span></div>';
        document.getElementById('evidenceForm').onsubmit = function (e) { e.preventDefault(); run(document.getElementById('evidenceLocality').value, document.getElementById('evidenceCounty').value, document.getElementById('evidenceAliases').value); };
    }

    async function begin() {
        var map = window._dlMap;
        if (!map || map.getZoom() < MIN_ZOOM || running) { updateButton(); return; }
        if (!isPremium()) { if (typeof window.openPremiumModal === 'function') window.openPremiumModal(); return; }
        running = true; updateButton(); status(t('locating'));
        try { form(await reverse(map.getCenter())); } catch (e) { form({ name: '', county: '' }); } finally { running = false; updateButton(); }
    }

    async function run(locality, county, aliases, localityId) {
        if (!localityId) { locality = String(locality || '').trim(); if (!locality) return; }
        running = true; updateButton(); status(t('search'));
        var body = { locality: locality || undefined, county: county || null, aliases: String(aliases || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean), limit: 10, includeFullText: true };
        if (localityId) body.localityId = String(localityId);
        try {
            lastResult = await fetchJson(API_BASE + '/evidence/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 150000);
            render();
        } catch (e) {
            if (e.data && e.data.error === 'ambiguous_locality' && e.data.matches && e.data.matches.length) { renderAmbiguous(e.data.matches); }
            else { failure(e, locality, county); }
        } finally { running = false; updateButton(); }
    }

    /* Every failure mode of POST /evidence/search has its own wording: the
     * backend answers source problems (502/504), storage problems (503) and
     * unknown bugs (500 + requestId) with distinct codes, and the modal must
     * never degrade to an anonymous “Internal server error”. */
    function failure(e, locality, county) {
        var code = (e.data && e.data.error) || '';
        var heading = t('failed'), detail = (e.data && e.data.message) || e.message || '';
        if (code === 'source_unavailable' || e.status === 502) heading = t('sourceUnavailable');
        else if (code === 'source_timeout' || e.status === 504 || e.name === 'AbortError') { heading = t('sourceTimeout'); detail = ''; }
        else if (code === 'database_schema_outdated' || code === 'database_query_rejected') heading = t('schemaError');
        else if (code === 'storage_write_failed' || code === 'database_unreachable' || code === 'search_failed' || e.status === 503) heading = t('storageError');
        else if (code === 'locality_not_found') { heading = t('notFound'); detail = ''; }
        var requestId = e.data && e.data.requestId ? '<small>' + esc(t('requestId')) + ': <code>' + esc(e.data.requestId) + '</code></small>' : '';
        document.getElementById('babelBody').innerHTML = '<div class="babel-state"><p>' + esc(heading) + '</p>' + (detail && detail !== heading ? '<small>' + esc(detail) + '</small>' : '') + requestId + '<button class="evidence-retry" id="evidenceRetry">' + esc(t('retryLater')) + '</button></div>';
        var retry = document.getElementById('evidenceRetry');
        if (retry) retry.onclick = function () { form({ name: locality || '', county: county || '' }); };
    }

    /* §1 — IDENTIFICARE INSUFICIENTĂ: pick the exact SIRUTA entity */
    function renderAmbiguous(matches) {
        open();
        document.getElementById('babelBody').innerHTML =
            '<div class="dossier-ambiguous"><b>⚠ ' + esc(t('ambiguousTitle')) + '</b><p>' + esc(t('ambiguousHelp')) + '</p><ul>' +
            matches.map(function (m, i) {
                return '<li><button class="dossier-pick" data-id="' + esc(m.id) + '"><strong>' + esc(m.name) + '</strong><span>' + esc(m.county) + ' · ' + esc(m.uat || '—') + ' · SIRUTA ' + esc(m.siruta || '—') + '</span></button></li>';
            }).join('') + '</ul><button class="evidence-retry" id="evidenceNew">' + esc(t('newSearch')) + '</button></div>';
        Array.prototype.forEach.call(document.querySelectorAll('.dossier-pick'), function (btn) {
            btn.onclick = function () { run(null, null, '', btn.getAttribute('data-id')); };
        });
        document.getElementById('evidenceNew').onclick = function () { form(lastForm || { name: '', county: '' }); };
    }

    /* ── small render helpers ── */
    var CERT_CLS = { CERT: 'cert', PROBABLE: 'probable', CONTESTED: 'contested', HYPOTHESIS: 'hypothesis', NO_DATA: 'nodata' };
    var CERT_ICON = { CERT: '🟢', PROBABLE: '🟡', CONTESTED: '🟠', HYPOTHESIS: '🔴', NO_DATA: '⚪' };
    function certBadge(level) { var k = CERT_CLS[level] ? level : 'NO_DATA'; return '<span class="certainty-badge ' + CERT_CLS[k] + '">' + CERT_ICON[k] + ' ' + esc(t('cert' + k)) + '</span>'; }
    function row(label, value) { return value == null || value === '' ? '' : '<div class="dossier-row"><span>' + esc(label) + '</span><b>' + value + '</b></div>'; }    function noSourceBlock() { return '<p class="dossier-nosource">' + esc(t('noSource')) + '</p>'; }
    function section(key, title, inner, badge) {
        return '<section class="dossier-section" id="dossier-sec-' + key + '"><h3>' + esc(title) + (badge || '') + '</h3>' + inner + '</section>';
    }
    function sourceLine(src) {
        if (!src) return '';
        var url = safeUrl(src.pdfUrl || src.url || '');
        return '<footer><div><strong>' + esc(src.title || '') + '</strong><span>' + esc((src.authors || []).join(', ')) + (src.year ? ' · ' + esc(src.year) : '') + (src.publication ? ' · ' + esc(src.publication) : '') + '</span></div>' + (url !== '#' ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(t('original')) + ' ↗</a>' : '') + '</footer>';
    }
    function entryHtml(entry) {
        var ev = entry.evidence && entry.evidence[0] || {};
        var page = ev.printedPage || ev.pdfPage || '—';
        return '<article class="dossier-entry">' +
            '<header>' + (entry.periods && entry.periods.length ? '<div class="evidence-periods">' + entry.periods.map(function (p) { return '<span>' + esc(p) + '</span>'; }).join('') + '</div>' : '') + certBadge(entry.certainty) + '</header>' +
            '<p class="dossier-claim">' + esc(entry.claim) + '</p>' +
            (ev.excerpt ? '<div class="evidence-quote dossier-quote"><small>' + esc(t('quote')) + '</small><blockquote>„' + esc(ev.excerpt) + '”</blockquote><div><b>' + esc(t('page')) + ':</b> ' + esc(page) + (ev.pdfPage ? ' <span>(PDF ' + esc(ev.pdfPage) + ')</span>' : '') + '</div></div>' : '') +
            sourceLine(entry.source) + '</article>';
    }
    function entriesSection(key, title, data) {
        if (!data) return section(key, title, noSourceBlock());
        if (data.noVerifiedSource || !data.entries || !data.entries.length) {
            return section(key, title, (data.note ? '<p class="dossier-note">' + esc(L(data.note)) + '</p>' : '') + noSourceBlock());
        }
        return section(key, title, data.entries.map(entryHtml).join(''), '<span class="dossier-count">' + data.entries.length + '</span>');
    }

    /* ── dossier sections ── */
    function renderIdentity(d) {
        var i = d.identity || {}, type = i.type ? (lang() === 'en' ? (TYPES_EN[i.type] || i.type) : i.type) : null;
        var coords = i.coordinates ? (Number(i.coordinates.lat)).toFixed(5) + ', ' + (Number(i.coordinates.lng)).toFixed(5) : null;
        var inner =
            row(t('fName'), esc(i.name)) + row(t('fCounty'), esc(i.county)) + row(t('fUat'), esc(i.uat)) + row(t('fType'), esc(type)) +
            row(t('fSiruta'), esc(i.siruta)) + row(t('fCountyCode'), esc(i.countyCode)) + row(t('fParent'), esc(i.parentSiruta)) +
            row(t('fCoords'), coords) + row(t('fLat'), i.latitude != null ? esc(i.latitude) : null) + row(t('fLng'), i.longitude != null ? esc(i.longitude) : null) +
            row(t('fRegSource'), esc((i.source && i.source.name) + (i.source && i.source.version ? ' · ' + i.source.version : ''))) +
            (i.coordinatesNote ? '<p class="dossier-note">' + esc(L(i.coordinatesNote)) + '</p>' : '') +
            (i.source && i.source.url ? '<a class="dossier-reglink" href="' + esc(safeUrl(i.source.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(i.source.url) + ' ↗</a>' : '');
        return section('identity', t('sectIdentity'), inner, certBadge('CERT'));
    }
    function renderNames(d) {
        var n = d.historicalNames || {};
        if (n.noVerifiedSource || !n.entries || !n.entries.length) return entriesSection('names', t('sectNames'), n);
        var table = '<table class="dossier-table"><thead><tr><th>' + esc(t('colForm')) + '</th><th>' + esc(t('colType')) + '</th><th>' + esc(t('colLang')) + '</th><th>' + esc(t('colVerified')) + '</th></tr></thead><tbody>' +
            n.entries.map(function (e) { return '<tr><td>' + esc(e.form) + '</td><td>' + esc((ALIAS_TYPES[lang()][e.aliasType] || e.aliasType)) + '</td><td>' + esc(e.language || '—') + '</td><td>' + (e.verified ? '✓ ' + esc(t('verifiedYes')) : '○ ' + esc(t('verifiedNo'))) + '</td></tr>'; }).join('') + '</tbody></table>' +
            (n.note ? '<p class="dossier-note">' + esc(L(n.note)) + '</p>' : '');
        return section('names', t('sectNames'), table, '<span class="dossier-count">' + n.entries.length + '</span>');
    }
    function renderAttestation(d) {
        var a = d.firstAttestation || {};
        if (a.status !== 'DOCUMENTED') return section('attestation', t('sectAttestation'), noSourceBlock() + certBadge('NO_DATA'));
        var conflicts = a.conflicts && a.conflicts.length
            ? '<div class="dossier-conflicts"><b>' + esc(t('conflictsIntro')) + '</b><ul>' + a.conflicts.map(function (c) { return '<li>' + esc(c.year) + ' — „' + esc(String(c.excerpt || '').slice(0, 220)) + '”' + (c.source && c.source.title ? ' <i>(' + esc(c.source.title) + ')</i>' : '') + '</li>'; }).join('') + '</ul><p>' + esc(t('conflictsNote')) + '</p></div>' : '';
        var inner =
            row(t('fYear'), esc(a.year)) + row(t('fHistoricalForm'), esc(a.historicalForm)) +
            row(t('fDocumentType'), esc(a.documentType)) + row(t('fDocumentLang'), esc(a.documentLanguage)) +
            (a.excerpt ? '<div class="evidence-quote dossier-quote"><small>' + esc(t('quote')) + '</small><blockquote>„' + esc(a.excerpt) + '”</blockquote></div>' : '') +
            conflicts + (a.note ? '<p class="dossier-note">' + esc(L(a.note)) + '</p>' : '') +
            sourceLine(a.source);
        return section('attestation', t('sectAttestation'), inner, certBadge(a.certainty));
    }
    function renderHistory(d) {
        var h = d.history || { buckets: [] };
        var inner = (h.note ? '<p class="dossier-note">' + esc(L(h.note)) + '</p>' : '') + h.buckets.map(function (b) {
            var has = b.entries && b.entries.length;
            return '<div class="dossier-period' + (has ? '' : ' is-empty') + '"><h4>' + esc(L(b.label)) + (has ? ' <span>(' + b.entries.length + ')</span>' : '') + '</h4>' + (has ? b.entries.map(entryHtml).join('') : '<p class="dossier-period-empty">' + esc(t('noSource')) + '</p>') + '</div>';
        }).join('');
        return section('history', t('sectHistory'), inner);
    }
    function renderSites(d) {
        var s = d.ranSites || {};
        var banner = '<div class="dossier-banner"><b>⧉ ' + esc(t('ranPendingTitle')) + '</b><p>' + esc(t('ranPendingBody')) + '</p>' +
            (s.officialPortals && s.officialPortals.length ? '<div class="dossier-portals"><span>' + esc(t('officialPortals')) + ':</span> ' + s.officialPortals.map(function (p) { return '<a href="' + esc(safeUrl(p.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(p.name) + ' ↗</a>'; }).join('') + '</div>' : '') + '</div>';
        var sites = (s.entries || []).map(function (site) {
            return '<article class="dossier-site">' +
                '<h4>' + esc(L(site.name)) + '</h4>' + certBadge(site.certainty) +
                row(t('fRanCode'), site.ranCode ? esc(site.ranCode) : '<i>' + esc(t('notIdentified')) + '</i>') +
                row(t('fCategory'), esc(L(site.categoryLabel))) +
                row(t('fSiteType'), esc(L(site.type))) +
                row(t('fComponents'), esc(site.components)) +
                row(t('fEpoch'), site.epoch ? esc(L(site.epoch)) : null) +
                row(t('fPeriod'), site.periods && site.periods.length ? esc(site.periods.join(', ')) : null) +
                row(t('fCulture'), site.culture ? esc(site.culture) : '<i>' + esc(t('unknownCulture')) + '</i>') +
                row(t('fChronology'), esc(site.chronology)) +
                (site.description ? '<p class="dossier-desc">' + esc(site.description) + '</p>' : '') +
                row(t('fCoords'), site.coordinates ? esc(site.coordinates.lat + ', ' + site.coordinates.lng) : '<i>' + esc(t('notIdentified')) + '</i>') +
                row(t('fLmi'), site.lmiCode ? esc(site.lmiCode) : '<i>' + esc(t('notIdentified')) + '</i>') +
                row(t('fLinkRan'), site.links && site.links.ran ? '<a href="' + esc(safeUrl(site.links.ran)) + '" target="_blank" rel="noopener noreferrer">' + esc(site.links.ran) + '</a>' : '<i>' + esc(t('notIdentified')) + '</i>') +
                (site.links && site.links.other && safeUrl(site.links.other) !== '#' ? row(t('fOtherSources'), '<a href="' + esc(safeUrl(site.links.other)) + '" target="_blank" rel="noopener noreferrer">' + esc(t('original')) + ' ↗</a>') : '') +
                (site.pendingIntegration ? '<p class="dossier-note">' + esc(L(site.pendingIntegration)) + '</p>' : '') +
                (site.evidence && site.evidence.length ? site.evidence.map(function (ev) { return ev.excerpt ? '<div class="evidence-quote dossier-quote"><small>' + esc(t('quote')) + '</small><blockquote>„' + esc(ev.excerpt) + '”</blockquote></div>' : ''; }).join('') : '') +
                sourceLine(site.source) + '</article>';
        }).join('');
        var note = s.note ? '<p class="dossier-note">' + esc(L(s.note)) + '</p>' : '';
        return section('sites', t('sectSites'), banner + note + (sites || noSourceBlock()), s.entries && s.entries.length ? '<span class="dossier-count">' + s.entries.length + '</span>' : '');
    }
    function renderNearby(d) {
        var n = d.nearbySites || {};
        if (!n.entries || !n.entries.length) return section('nearby', t('sectNearby'), '<p class="dossier-note">' + esc(L(n.note) || t('nearbyNote')) + '</p>');
        return section('nearby', t('sectNearby'), n.entries.map(entryHtml).join(''));
    }
    function renderChecks(d) {
        var checks = d.identityChecks || [];
        var inner = '<p class="dossier-note">' + esc(t('checksIntro')) + '</p><ul class="dossier-checks">' + checks.map(function (c) {
            var mark = c.status === 'PASS' ? '<span class="check pass">✓ ' + esc(t('checkPass')) + '</span>' : c.status === 'PENDING' ? '<span class="check pending">◔ ' + esc(t('checkPending')) + '</span>' : '<span class="check fail">✕ ' + esc(t('checkFail')) + '</span>';
            return '<li><div><b>' + esc(c.id) + '</b> ' + esc(L(c.label)) + '</div><div>' + mark + ' <small>' + esc(L(c.detail)) + '</small></div></li>';
        }).join('') + '</ul>';
        return section('checks', t('sectChecks'), inner);
    }
    function renderSources(d) {
        var levelName = { 1: t('level1'), 2: t('level2'), 3: t('level3'), 4: t('level4') };
        var inner = '<ul class="dossier-sources">' + (d.sources || []).map(function (s) {
            var detail = s.detail ? ' <small>' + esc((s.detail.authors || []).join(', ') + (s.detail.year ? ' · ' + s.detail.year : '') + (s.detail.publication ? ' · ' + s.detail.publication : '')) + '</small>' : '';
            return '<li><span class="source-level lv' + s.level + '">' + esc(levelName[s.level] || s.level) + '</span><div><b>' + esc(L(s.name)) + '</b>' + detail + (s.role ? '<p>' + esc(L(s.role)) + '</p>' : '') + (s.status === 'NOT_INTEGRATED' ? ' <em>· ' + esc(t('notIntegrated')) + '</em>' : '') + (s.url && safeUrl(s.url) !== '#' ? ' <a href="' + esc(safeUrl(s.url)) + '" target="_blank" rel="noopener noreferrer">↗</a>' : '') + '</div></li>';
        }).join('') + '</ul>';
        return section('sources', t('sectSources'), inner);
    }
    function renderCertainty(d) {
        var c = d.certainty || {};
        var inner = [
            [t('cIdentification'), c.identification], [t('cNames'), c.historicalNames], [t('cAttestation'), c.firstAttestation],
            [t('cHistory'), c.history], [t('cSites'), c.archaeologicalSites], [t('cToponymy'), c.toponymy], [t('cOther'), c.otherInfo]
        ].map(function (r) { return '<div class="dossier-certainly-row"><span>' + esc(r[0]) + '</span>' + certBadge(r[1] || 'NO_DATA') + '</div>'; }).join('');
        return section('certainty', t('sectCertainty'), inner);
    }

    function claimHtml(c, index) {
        var ev = (c.evidence && c.evidence[0]) || {}, loc = (c.locations && c.locations[0]) || {}, src = c.source || {}, url = safeUrl(src.pdfUrl || src.url), page = ev.printedPage || ev.pdfPage || '—';
        return '<article class="evidence-card"><header><div><span class="evidence-index">0' + (index + 1) + '</span><span class="evidence-category">' + esc(c.category) + '</span></div>' + confidence(c) + '</header><h3>' + esc(c.claim) + '</h3>' + (c.periods && c.periods.length ? '<div class="evidence-periods">' + c.periods.map(function (p) { return '<span>' + esc(p) + '</span>'; }).join('') + '</div>' : '') + '<div class="evidence-quote"><small>' + esc(t('quote')) + '</small><blockquote>„' + esc(ev.excerpt || '') + '”</blockquote><div><b>' + esc(t('page')) + ':</b> ' + esc(page) + (ev.pdfPage ? ' <span>(PDF ' + esc(ev.pdfPage) + ')</span>' : '') + ' · ' + esc(ev.extractionMethod || '') + '</div></div><details><summary>' + esc(t('why')) + '</summary><p>' + esc(loc.attributionReason || '') + '</p><code>' + esc(loc.role || 'UNKNOWN') + '</code></details>' + (c.images && c.images.length ? '<div class="evidence-images"><b>' + esc(t('images')) + '</b><ul>' + c.images.map(imageHtml).join('') + '</ul></div>' : '') + '<footer><div><strong>' + esc(src.title || '') + '</strong><span>' + esc((src.authors || []).join(', ')) + (src.year ? ' · ' + esc(src.year) : '') + (src.publication ? ' · ' + esc(src.publication) : '') + '</span></div><a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(t('original')) + ' ↗</a></footer></article>';
    }
    function confidence(c) { var pct = Math.round((c.confidence || 0) * 100), level = c.confidenceLevel || 'LOW'; return '<span class="evidence-confidence ' + level.toLowerCase() + '">' + esc(t('confidence')) + ' ' + pct + '% · ' + esc(level) + '</span>'; }
    function imageHtml(image) { return '<li><span>' + esc(image.figureNumber || image.type) + '</span><p>' + esc(image.caption) + '</p><small>PDF p. ' + esc(image.pdfPage || '—') + ' · ' + esc(image.type) + (image.imageRepublicationAllowed ? '' : ' · © status necunoscut') + '</small></li>'; }

    function render() {
        var claims = lastResult.archaeologicalInformation || [], docs = lastResult.documents || [], loc = lastResult.locality || {}, d = lastResult.dossier;
        var head = '<header class="evidence-head"><div><span>DETECTLAB · HISTORICAL DOSSIER</span><h2>' + esc(loc.currentName) + (loc.county ? ', ' + esc(loc.county) : '') + '</h2><p>' + claims.length + ' ' + esc(t('claims')) + ' · ' + docs.length + ' ' + esc(t('docs')) + (d ? ' · SIRUTA ' + esc(d.identity && d.identity.siruta || loc.siruta || '—') : '') + '</p></div><button id="evidenceNew">＋ ' + esc(t('locality')) + '</button></header>' +
            '<div class="evidence-sourcebar"><b>✓ ' + esc(t('sourcePolicy')) + '</b><span>' + esc((lastResult.audit && lastResult.audit.verifiedClaims) || 0) + ' verified</span></div>' +
            (lastResult.truncated ? '<div class="dossier-banner"><b>⏱ ' + esc(t('truncatedNotice')) + '</b></div>' : '');
        var body;
        if (d) {
            var nav = ['identity', 'names', 'attestation', 'history', 'admin', 'population', 'families', 'buildings', 'sites', 'nearby', 'vanished', 'toponymy', 'maps', 'checks', 'sources', 'certainty'];
            var navLabels = { identity: t('sectIdentity'), names: t('sectNames'), attestation: t('sectAttestation'), history: t('sectHistory'), admin: t('sectAdmin'), population: t('sectPopulation'), families: t('sectFamilies'), buildings: t('sectBuildings'), sites: t('sectSites'), nearby: t('sectNearby'), vanished: t('sectVanished'), toponymy: t('sectToponymy'), maps: t('sectMaps'), checks: t('sectChecks'), sources: t('sectSources'), certainty: t('sectCertainty') };
            body = '<nav class="dossier-nav">' + nav.map(function (k) { return '<button data-target="dossier-sec-' + k + '">' + esc(navLabels[k]) + '</button>'; }).join('') + '</nav>' +
                renderIdentity(d) + renderNames(d) + renderAttestation(d) + renderHistory(d) +
                entriesSection('admin', t('sectAdmin'), d.administrativeEvolution) +
                entriesSection('population', t('sectPopulation'), d.population) +
                entriesSection('families', t('sectFamilies'), d.familiesAndEstates) +
                entriesSection('buildings', t('sectBuildings'), d.historicBuildings) +
                renderSites(d) + renderNearby(d) +
                entriesSection('vanished', t('sectVanished'), d.vanishedLocalities) +
                entriesSection('toponymy', t('sectToponymy'), d.toponymy) +
                entriesSection('maps', t('sectMaps'), d.historicalMaps) +
                renderChecks(d) + renderSources(d) + renderCertainty(d) +
                (claims.length ? section('appendix', t('sectAppendix'), '<p class="dossier-note">' + esc(t('quotesRo')) + '</p><section class="evidence-list">' + claims.map(claimHtml).join('') + '</section>') : '') +
                '<p class="dossier-footer-meta">' + esc(t('generatedAt')) + ': ' + esc(d.generatedAt || '') + ' · ' + esc(t('schemaLabel')) + ' ' + esc(d.schemaVersion || '') + ' · <a href="https://github.com/andrei-roba29/DetectLab_web_deploy/blob/main/data/dossier-spec/' + (lang() === 'en' ? 'HISTORICAL_RECORD_PROMPT_EN.md' : 'FISA_ISTORICA_PROMPT_RO.md') + '" target="_blank" rel="noopener noreferrer">' + esc(t('specRef')) + ' ↗</a></p>';
        } else {
            body = '<section class="evidence-list">' + (claims.length ? claims.map(claimHtml).join('') : '<div class="babel-empty">' + esc(t('no')) + '</div>') + '</section>';
        }
        document.getElementById('babelBody').innerHTML = head + body + '<div class="evidence-actions"><button id="evidenceExport">↓ ' + esc(t('export')) + '</button></div>';
        document.getElementById('evidenceNew').onclick = function () { form({ name: loc.currentName || '', county: loc.county || '' }); };
        document.getElementById('evidenceExport').onclick = function () { download('detectlab-dossier-' + slug(loc.currentName) + '.json', JSON.stringify(lastResult, null, 2)); };
        Array.prototype.forEach.call(document.querySelectorAll('.dossier-nav button'), function (btn) {
            btn.onclick = function () { var el = document.getElementById(btn.getAttribute('data-target')); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
        });
    }

    function slug(v) { return String(v || 'locality').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
    function download(name, content) { var u = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' })), a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(u); }, 1000); }

    function apply() {
        var title = document.getElementById('babelModalTitle'), sub = document.getElementById('babelScrollSubtitle'), closeBtn = document.getElementById('babelClose'), scrollTitle = document.getElementById('babelScrollTitle');
        if (title) title.textContent = t('title');
        if (scrollTitle) scrollTitle.textContent = t('title');
        if (sub) sub.textContent = t('subtitle');
        if (closeBtn) closeBtn.setAttribute('aria-label', t('close'));
        var m = document.getElementById('babelModal');
        if (m && !m.hidden) { if (lastResult) render(); else if (lastForm) form(lastForm); }
        updateButton();
    }
    function init() {
        var b = document.getElementById('babelSearchBtn'), x = document.getElementById('babelClose'), m = document.getElementById('babelModal');
        if (!b || !m) return;
        b.onclick = begin; x.onclick = close; m.onclick = function (e) { if (e.target === m) close(); };
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !m.hidden) close(); });
        var wait = setInterval(function () { if (window._dlMap) { clearInterval(wait); window._dlMap.on('zoomend', updateButton); updateButton(); } }, 100);
        setTimeout(function () { clearInterval(wait); updateButton(); }, 15000);
        var old = window.setLang; if (typeof old === 'function') window.setLang = function (v) { old(v); apply(); };
        apply();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    window.DetectLabEvidenceEngine = { open: begin, close: close, research: run };
})();

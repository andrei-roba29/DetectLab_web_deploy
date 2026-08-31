#!/usr/bin/env node
'use strict';

// Period-classification contract of the multi-source search agent:
//   1. findings with NO detected period (perioada „nespecificată”) are removed
//      from the Library of Babel results entirely;
//   2. the Roman period is decided by a broad lexical field of genuinely
//      ancient-Roman terms (castru / legiune / opait / burgus / villa …), NOT
//      by the bare words „roman / romana / romani / romane / romanii /
//      romanilor”, which — once diacritics are stripped — could also be
//      „român / română / români / române…” (the Romanian language/nationality)
//      and would produce false positives. „Romania” the country never triggers
//      the Roman period.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = __dirname;

function loadEngine(fetchImpl) {
    const elements = new Map();
    const element = (id) => {
        if (!elements.has(id)) elements.set(id, { id, innerHTML: '', hidden: true, textContent: '', disabled: false, onclick: null, onchange: null, value: '', title: '', className: '', setAttribute() {}, getAttribute() { return null; }, focus() {}, classList: { add() {}, remove() {} } });
        return elements.get(id);
    };
    let lang = 'ro';
    const sandbox = {
        console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, Date, JSON,
        Blob: class {}, Object, Array, String, Number, Promise, Error, RegExp, Math,
        window: null,
        document: {
            readyState: 'complete',
            getElementById: element,
            querySelectorAll: () => [],
            createElement: () => ({ click() {}, set href(v) {}, href: '', set download(v) {}, download: '' }),
            addEventListener() {}, body: { classList: { add() {}, remove() {} } }
        },
        fetch: (u) => fetchImpl(String(u))
    };
    sandbox.localStorage = { getItem: () => 'TESTKEY', setItem: () => {}, removeItem: () => {} };
    sandbox.window = sandbox;
    sandbox.window._currentLang = () => lang;
    sandbox.setLang = (v) => { lang = v; };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/library-of-babel.js'), 'utf8'), sandbox);
    sandbox.window.DetectLabEvidenceEngine._noThrottle();
    return { sandbox, body: () => element('babelBody').innerHTML };
}

const wikiRo = {
    query: { search: [
        { title: 'Castrul roman de la Apulum', snippet: 'Castru din legiunea a XIII-a Gemina de la Apulum.', timestamp: '2026-01-01T00:00:00Z' },
        { title: 'Cetatea medievala din localitatea Romana', snippet: 'Cetate medievala din satul Romana.', timestamp: '2026-01-02T00:00:00Z' },
        { title: 'Muzeul National de Istorie a Romaniei', snippet: 'Muzeu modern despre istoria Romaniei.', timestamp: '2026-01-03T00:00:00Z' },
        { title: 'Comuna fara nicio perioada', snippet: 'O localitate din judetul Cluj.', timestamp: '2026-01-04T00:00:00Z' }
    ] }
};
const empties = {
    roWiki: { query: { search: [] } },
    wd: { results: { bindings: [] } },
    osm: [],
    commons: { query: { pages: {} } },
    dbpedia: { docs: [] },
    archive: { response: { docs: [] } },
    europeana: { items: [] }
};
const http = (payload) => () => Promise.resolve({ ok: true, status: 200, json: async () => payload });

(async () => {
    const app = loadEngine((url) => {
        if (url.includes('ro.wikipedia.org')) return http(wikiRo)();
        if (url.includes('en.wikipedia.org')) return http(empties.roWiki)();
        if (url.includes('query.wikidata.org')) return http(empties.wd)();
        if (url.includes('nominatim')) return http(empties.osm)();
        if (url.includes('commons')) return http(empties.commons)();
        if (url.includes('dbpedia')) return http(empties.dbpedia)();
        if (url.includes('archive.org')) return http(empties.archive)();
        if (url.includes('europeana')) return http(empties.europeana)();
        throw new Error('unexpected URL ' + url);
    });

    await app.sandbox.window.DetectLabEvidenceEngine.research('Apulum');
    const html = app.body();
    const rows = app.sandbox.window.DetectLabEvidenceEngine._export.rows();

    /* ── 1: unspecified-period findings are dropped ── */
    assert.ok(/<b>3<\/b>\s*rezultate/.test(html), 'only the 3 period-bearing findings are shown (4 raw − 1 untagged)');
    assert.ok(!rows.some((r) => r.titlu === 'Comuna fara nicio perioada'), 'a result with no period is removed');
    assert.ok(!/Nespecificată/.test(html), 'the „unspecified” period is no longer offered as a filter/timeline chip');
    assert.ok(!/value="unspecified"/.test(html), 'no „unspecified” option in the period select');

    /* ── 2: the Roman period is lexicon-driven (no „român” false positive) ── */
    const roman = rows.find((r) => r.titlu === 'Castrul roman de la Apulum');
    assert.ok(roman && roman.perioade.includes('Roman'), '„castru / legiune / Apulum” → Roman period');

    const medieval = rows.find((r) => r.titlu === 'Cetatea medievala din localitatea Romana');
    assert.ok(medieval && medieval.perioade.includes('Medieval'), 'a medieval castle is classified as Medieval');
    assert.ok(!medieval.perioade.includes('Roman'), '„Romana” (no diacritics → română) does NOT trigger the Roman period');

    const modern = rows.find((r) => r.titlu === 'Muzeul National de Istorie a Romaniei');
    assert.ok(modern && modern.perioade.includes('Modern'), 'the country name „Romania” is classified as Modern');
    assert.ok(!modern.perioade.includes('Roman'), '„Romania” the country never triggers the Roman period');

    console.log('✓ Biblioteca din Babel period-classification tests passed');
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });

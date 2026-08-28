#!/usr/bin/env node
'use strict';

// User-facing contract of the "Biblioteca din Babel" modal for every failure
// mode of POST /api/evidence/search.
//
// The bug this guards: the backend answered a rejected SQL query with a bare
// `500 Internal server error` and the modal simply echoed that string, so a
// total outage of the feature looked like a mysterious server problem. Now the
// API answers with a code + request id per failure class, and the modal must
// (a) name the problem in the user's language, (b) never leak
// "Internal server error", (c) offer a retry, and (d) flag a partial answer.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;

function loadEngine(response) {
    const elements = new Map();
    const element = (id) => {
        if (!elements.has(id)) elements.set(id, { id, innerHTML: '', hidden: true, textContent: '', disabled: false, onclick: null, setAttribute() {}, getAttribute() { return null; }, classList: { add() {}, remove() {} } });
        return elements.get(id);
    };
    let currentLangCode = 'ro';
    const sandbox = {
        console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, Date, JSON, Blob: class {}, Object, Array, String, Number, Promise, Error, RegExp, Math,
        window: null,
        document: {
            readyState: 'complete',
            getElementById: element,
            querySelectorAll: () => [],
            createElement: () => ({ click() {}, set href(v) {}, href: '', set download(v) {}, download: '' }),
            addEventListener() {}, body: { classList: { add() {}, remove() {} } },
        },
        fetch: () => Promise.resolve(typeof response === 'function' ? response() : response),
    };
    sandbox.window = sandbox;
    sandbox.window._currentLang = () => currentLangCode;
    sandbox.setLang = (v) => { currentLangCode = v; };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/library-of-babel.js'), 'utf8'), sandbox);
    return { sandbox, body: () => element('babelBody').innerHTML, setLang: (v) => { currentLangCode = v; } };
}

const http = (status, payload) => () => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => payload });

(async () => {
    // 1. A coded 500 (the class of bug reported): named, with a request id.
    let app = loadEngine(http(500, { error: 'search_failed', requestId: 'a1b2c3d4', message: 'Cercetarea a eșuat dintr-o eroare internă. Reîncearcă; dacă se repetă, raportează ID-ul a1b2c3d4' }));
    await app.sandbox.window.DetectLabEvidenceEngine.research('Apahida', 'Cluj', '');
    let html = app.body();
    assert.ok(!/Internal server error/.test(html), 'the raw server string is never shown to users');
    assert.ok(/Stocarea bazei de date a eșuat/.test(html), 'RO: a storage failure is described as such');
    assert.ok(/a1b2c3d4/.test(html), 'the request id is printed so the log can be found');
    assert.ok(/Reîncearcă/.test(html), 'a retry action is offered');

    // 2. The same answer in English.
    app.setLang('en');
    app.sandbox.window.setLang && app.sandbox.window.setLang('en');
    await app.sandbox.window.DetectLabEvidenceEngine.research('Apahida', 'Cluj', '');
    html = app.body();
    assert.ok(/could not complete the request|evidence database/i.test(html), 'EN: the same failure is translated');
    assert.ok(!/Internal server error/.test(html), 'EN: no raw server string either');

    // 3. Refused / slow source keeps its dedicated, actionable wording.
    app = loadEngine(http(502, { error: 'source_unavailable', source: 'https://biblioteca-digitala.ro/', message: 'Sursa de publicații biblioteca-digitala.ro este momentan indisponibilă.' }));
    await app.sandbox.window.DetectLabEvidenceEngine.research('Apahida', 'Cluj', '');
    assert.ok(/biblioteca-digitala\.ro este momentan indisponibilă/.test(app.body()), 'a 502 explains the source outage');

    app = loadEngine(http(504, { error: 'source_timeout', message: 'Sursa de publicații a răspuns prea lent.' }));
    await app.sandbox.window.DetectLabEvidenceEngine.research('Apahida', 'Cluj', '');
    assert.ok(/prea lent/.test(app.body()), 'a 504 explains the slow source');

    // 4. An un-migrated database is reported as a server-side schema problem.
    app = loadEngine(http(503, { error: 'database_schema_outdated', sqlState: '42P10', message: 'Structura bazei de date `knowledge.*` nu este la zi pe server (rulează `npm run migrate`).' }));
    await app.sandbox.window.DetectLabEvidenceEngine.research('Apahida', 'Cluj', '');
    assert.ok(/nu este la zi/.test(app.body()), 'a 503 schema problem is named, not hidden');

    // 5. A locality absent from SIRUTA is a sentence, not an error.
    app = loadEngine(http(404, { error: 'locality_not_found', message: 'Localitatea nu există în registrul SIRUTA importat.' }));
    await app.sandbox.window.DetectLabEvidenceEngine.research('Nicăieri', '', '');
    assert.ok(/nu se află în registrul SIRUTA/.test(app.body()), 'RO: unknown locality is explained');

    // 6. A time-boxed (partial) answer is announced as partial, and the empty
    //    result still says what to do next.
    app = loadEngine(http(201, {
        schemaVersion: '2.0', truncated: { reason: 'research_budget_exhausted', budgetMs: 45000 },
        locality: { id: 42, currentName: 'APAHIDA', county: 'CLUJ' },
        archaeologicalInformation: [], documents: [], audit: { verifiedClaims: 0, claims: 0, evidence: 0 },
    }));
    await app.sandbox.window.DetectLabEvidenceEngine.research('Apahida', 'Cluj', '');
    html = app.body();
    assert.ok(/dossier-banner/.test(html), 'the truncation banner is rendered');
    assert.ok(/parțială/.test(html), 'RO: the user is told the list is partial and will be completed later');
    assert.ok(/claim-uri arheologice verificabile/.test(html), 'and that no claim was found yet');

    console.log('✓ Biblioteca din Babel failure-mode tests passed');
    process.exit(0); // the module's map-poll interval would otherwise idle ~15s
})().catch((err) => { console.error(err); process.exit(1); });

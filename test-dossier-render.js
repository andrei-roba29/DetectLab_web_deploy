#!/usr/bin/env node
'use strict';

// End-to-end contract test: a dossier built by the real backend builder is
// rendered by the real frontend module (stubbed DOM), in BOTH site languages.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;

// 1. Build a realistic dossier with the real backend builder.
(async () => {
    const { buildDossier } = await import(path.join(root, 'backend/src/services/evidence/dossier.js'));
    const locality = {
        id: 7, name: 'Apahida', county: 'Cluj', county_code: 'CJ', uat_name: 'Comuna Apahida',
        siruta_code: '57247', locality_type: 'sat reședință comună', level: 3,
        latitude: 46.8115, longitude: 23.8352, source_name: 'INS SIRUTA', source_version: 'S1 2025',
        source_url: 'https://data.gov.ro/siruta',
        aliases: [{ alias: 'Apahida', type: 'CURRENT', language: 'ro', verified: true }],
    };
    const claims = [{
        id: 1, claim: 'La Apahida este documentată descoperirea unei necropole.', category: 'NECROPOLIS',
        periods: ['Roman'], status: 'VERIFIED', confidence: 0.9, confidenceLevel: 'HIGH', fullyVerified: true,
        evidence: [{ excerpt: 'În necropola de la Apahida au fost descoperite morminte de incinerație din sec. IV p.Chr.', contextWindow: '', printedPage: '40', pdfPage: 4, sourceUrl: 'https://biblioteca-digitala.ro/?articol=2-test' }],
        source: { title: 'Necropola de la Apahida', authors: [], year: 1971, url: 'https://biblioteca-digitala.ro/?articol=2-test', pdfUrl: 'https://biblioteca-digitala.ro/reviste/test2.pdf' },
        locations: [{ name: 'Apahida', role: 'ARCHAEOLOGICAL_TARGET', confidence: 0.9 }], images: [],
    }, {
        id: 2, claim: 'Atestare.', category: 'OTHER_ARCHAEOLOGICAL_EVIDENCE',
        periods: ['Medieval'], status: 'NEEDS_REVIEW', confidence: 0.6, confidenceLevel: 'MEDIUM', fullyVerified: false,
        evidence: [{ excerpt: 'Localitatea, atestată documentar în 1332, aparținuse de comitatul Cluj; recensământul consemna locuitori sași.', contextWindow: '', printedPage: '9', pdfPage: 2, sourceUrl: 'https://biblioteca-digitala.ro/?articol=3' }],
        source: { title: 'Monografie', authors: [], year: 1930, url: 'https://biblioteca-digitala.ro/?articol=3' },
        locations: [{ name: 'Apahida', role: 'HISTORICAL_LOCATION', confidence: 0.6 }], images: [],
    }, {
        id: 3, claim: 'Atestare alternativă.', category: 'OTHER_ARCHAEOLOGICAL_EVIDENCE',
        periods: ['Medieval'], status: 'NEEDS_REVIEW', confidence: 0.55, confidenceLevel: 'MEDIUM', fullyVerified: false,
        evidence: [{ excerpt: 'Prima mențiune documentară a satului ar dateza din 1334, conform unei alte monografii.', contextWindow: '', printedPage: '11', pdfPage: 3, sourceUrl: 'https://biblioteca-digitala.ro/?articol=4' }],
        source: { title: 'Altă monografie', authors: [], year: 1935, url: 'https://biblioteca-digitala.ro/?articol=4' },
        locations: [{ name: 'Apahida', role: 'HISTORICAL_LOCATION', confidence: 0.55 }], images: [],
    }];
    const bundle = {
        schemaVersion: '2.0', locality: { currentName: 'Apahida', county: 'Cluj', siruta: '57247' },
        archaeologicalInformation: claims, documents: [], audit: { verifiedClaims: 1 },
        dossier: buildDossier(locality, { archaeologicalInformation: claims, documents: [] }, { sites: [] }),
    };

    // 2. Load the frontend module in a sandboxed DOM.
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
        fetch: () => Promise.resolve({ ok: true, json: async () => bundle }),
    };
    sandbox.window = sandbox;
    sandbox.window._currentLang = () => currentLangCode;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/library-of-babel.js'), 'utf8'), sandbox);

    // 3. Drive the real research flow (fetch stub returns the bundle) → RO render.
    await sandbox.window.DetectLabEvidenceEngine.research('Apahida', 'Cluj', '');
    const body = () => element('babelBody').innerHTML;
    let html = body();
    for (const expected of [
        'HISTORICAL DOSSIER', 'Apahida, Cluj', 'Identitate', 'Cod SIRUTA', '57247',
        'Prima atestare', '1332', 'Conflicte între surse',
        'Istorie', 'Antichitate', 'Roman', 'Evul Mediu',
        'Evoluție administrativă', 'comitatul', 'Populație', 'recensământul'.replace('ă', 'ă'),
        'Situri arheologice documentate', 'Cod RAN', 'Integrare RAN / CIMEC în curs',
        'Verificare identitate (CHECK 1–7)', 'CHECK_4', 'Nivel general de certitudine',
        'Nu a fost identificată o sursă verificabilă.', '🟢 Cert',
    ]) assert.ok(html.includes(expected), `RO render contains "${expected}"`);

    // 4. Switch language → EN render of the same dossier.
    currentLangCode = 'en';
    await sandbox.window.DetectLabEvidenceEngine.research('Apahida', 'Cluj', '');
    html = body();
    for (const expected of [
        'HISTORICAL DOSSIER', 'Apahida, Cluj', 'Identity', 'SIRUTA code', '57247',
        'First attestation', '1332', 'Conflicts between sources',
        'History', 'Antiquity', 'Middle Ages', 'Administrative evolution', 'Population',
        'Documented archaeological sites', 'RAN code', 'RAN / CIMEC integration in progress',
        'Identity verification (CHECK 1–7)', 'Overall level of certainty',
        'No verifiable source was identified.', '🟢 Certain',
    ]) assert.ok(html.includes(expected), `EN render contains "${expected}"`);

    // 5. Anti-hallucination invariants in the rendered output.
    assert.ok(!/"ranCode":"[^"]/.test(html.replace(/"ranCode":null/g, '')), 'no fabricated RAN codes are rendered');
    assert.ok(html.includes('Unknown / not specified'), 'culture shows the specification wording, never a guess');

    console.log('✓ Dossier end-to-end render tests passed (ro + en)');
    process.exit(0); // the module's map-poll interval would otherwise idle ~15s
})().catch((err) => { console.error(err); process.exit(1); });

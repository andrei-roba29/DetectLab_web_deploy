#!/usr/bin/env node
'use strict';

// Guards the "Dosarul istoric" (historical dossier) layer:
//  1. every UI string exists in BOTH language variants (ro + en);
//  2. the specification's canonical anti-hallucination sentences are present;
//  3. the frontend section set matches the backend dossier section set.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const source = fs.readFileSync(path.join(root, 'js/library-of-babel.js'), 'utf8');

function extractDict(lang) {
    const start = source.indexOf(`\n        ${lang}: {`);
    assert(start > 0, `${lang} dictionary exists in library-of-babel.js`);
    const end = source.indexOf(`\n        ${lang === 'ro' ? 'en' : 'ro'}: {`, start);
    const block = source.slice(start, end > 0 ? end : undefined);
    const keys = new Set();
    const pattern = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
    let match;
    while ((match = pattern.exec(block))) keys.add(match[1]);
    keys.delete(lang); // the leading `ro:` / `en:` key marker
    return keys;
}

const ro = extractDict('ro');
const en = extractDict('en');

assert.ok(ro.size >= 60, `ro dictionary is substantial (${ro.size} keys)`);
const missingInEn = [...ro].filter((k) => !en.has(k));
const missingInRo = [...en].filter((k) => !ro.has(k));
assert.deepStrictEqual(missingInEn, [], `every ro key has an en translation (missing: ${missingInEn.join(', ')})`);
assert.deepStrictEqual(missingInRo, [], `every en key has an ro translation (missing: ${missingInRo.join(', ')})`);

// Canonical specification sentences must survive in both variants (§1, §20).
assert(source.includes("'Nu a fost identificată o sursă verificabilă.'"), 'ro anti-hallucination sentence present');
assert(source.includes("'No verifiable source was identified.'"), 'en anti-hallucination sentence present');
assert(source.includes("'IDENTIFICARE INSUFICIENTĂ'"), 'ro insufficient-identification marker present');
assert(source.includes("'INSUFFICIENT IDENTIFICATION'"), 'en insufficient-identification marker present');
assert(source.includes("'Necunoscut / nespecificat'"), 'ro unknown-culture wording matches the specification');
assert(source.includes("'Unknown / not specified'"), 'en unknown-culture wording matches the specification');

// SIRUTA locality types must be translatable for the EN variant.
assert(source.includes('TYPES_EN'), 'SIRUTA type translation map exists');
assert(source.includes("'sat reședință comună'"), 'TYPES_EN covers commune-seat villages');

// Frontend section rendering must cover the backend dossier sections.
(async () => {
    const dossierModule = await import(path.join(root, 'backend/src/services/evidence/dossier.js'));
    const dossier = dossierModule.buildDossier(
        { name: 'X', county: 'Y', uat_name: 'Z', siruta_code: '12345', latitude: 1, longitude: 2, aliases: [] },
        { archaeologicalInformation: [], documents: [] },
        {}
    );
    for (const key of dossier.sectionOrder) {
        assert.ok(key in dossier, `backend builds section ${key}`);
    }
    // Every section the backend emits must be rendered by the frontend.
    const renderChecks = {
        identity: 'renderIdentity', historicalNames: 'renderNames', firstAttestation: 'renderAttestation',
        history: 'renderHistory', administrativeEvolution: "entriesSection('admin'", population: "entriesSection('population'",
        familiesAndEstates: "entriesSection('families'", historicBuildings: "entriesSection('buildings'",
        ranSites: 'renderSites', nearbySites: 'renderNearby', vanishedLocalities: "entriesSection('vanished'",
        toponymy: "entriesSection('toponymy'", historicalMaps: "entriesSection('maps'", identityChecks: 'renderChecks',
        sources: 'renderSources', certainty: 'renderCertainty',
    };
    for (const [key, marker] of Object.entries(renderChecks)) {
        assert(source.includes(marker), `frontend renders backend section ${key}`);
    }
    // Bilingual parity at the data level: notes carry ro+en.
    assert.equal(typeof dossier.history.note.ro, 'string');
    assert.equal(typeof dossier.history.note.en, 'string');
    console.log('✓ Dossier i18n + section parity tests passed');
})().catch((err) => { console.error(err); process.exit(1); });

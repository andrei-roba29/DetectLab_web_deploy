import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOSSIER_SCHEMA_VERSION, HISTORY_BUCKETS, buildDossier, buildHistory, bucketForPeriods,
  certaintyFromClaim, classifyThematic, extractFirstAttestation, identityChecks,
} from '../src/services/evidence/dossier.js';

const locality = {
  id: 1, name: 'Apahida', county: 'Cluj', county_code: 'CJ', uat_name: 'Comuna Apahida',
  siruta_code: '57247', locality_type: 'sat reședință comună', level: 3,
  latitude: 46.8115, longitude: 23.8352, source_name: 'INS SIRUTA', source_version: 'S1 2025',
  source_url: 'https://data.gov.ro/siruta', aliases: [
    { alias: 'Apahida', type: 'CURRENT', language: 'ro', verified: true },
    { alias: 'Apahida I', type: 'HISTORICAL', language: 'ro', verified: false },
  ],
};

const claim = (overrides = {}) => ({
  id: 10, claim: 'La Apahida este documentată descoperirea unei necropole.', category: 'NECROPOLIS',
  periods: ['Roman'], status: 'VERIFIED', confidence: 0.9, confidenceLevel: 'HIGH',
  evidence: [{ excerpt: 'În necropola de la Apahida au fost descoperite morminte de incinerație.', contextWindow: 'context', printedPage: '40', pdfPage: 4, sourceUrl: 'https://biblioteca-digitala.ro/?articol=2-test' }],
  source: { title: 'Necropola de la Apahida', authors: [], year: 1971, url: 'https://biblioteca-digitala.ro/?articol=2-test', pdfUrl: 'https://biblioteca-digitala.ro/reviste/test2.pdf' },
  locations: [{ name: 'Apahida', role: 'ARCHAEOLOGICAL_TARGET', confidence: 0.9 }],
  images: [], fullyVerified: true, conflictingSources: false, ...overrides,
});

test('dossier exposes the full specification section order and version', () => {
  const dossier = buildDossier(locality, { archaeologicalInformation: [claim()], documents: [] });
  assert.equal(dossier.schemaVersion, DOSSIER_SCHEMA_VERSION);
  assert.deepEqual(dossier.sectionOrder, [
    'identity', 'historicalNames', 'firstAttestation', 'history', 'administrativeEvolution',
    'population', 'familiesAndEstates', 'historicBuildings', 'ranSites', 'nearbySites',
    'vanishedLocalities', 'toponymy', 'historicalMaps', 'identityChecks', 'sources', 'certainty',
  ]);
  for (const key of dossier.sectionOrder) assert.ok(key in dossier, `section ${key} present`);
});

test('identity comes from the official SIRUTA register and coordinates are labelled as locality coordinates', () => {
  const dossier = buildDossier(locality, { archaeologicalInformation: [], documents: [] });
  assert.equal(dossier.identity.name, 'Apahida');
  assert.equal(dossier.identity.siruta, '57247');
  assert.deepEqual(dossier.identity.coordinates, { lat: 46.8115, lng: 23.8352 });
  assert.match(dossier.identity.coordinatesNote.ro, /localitatea, nu un sit/);
});

test('empty sections are explicitly unverified instead of estimated (anti-hallucination)', () => {
  const dossier = buildDossier(locality, { archaeologicalInformation: [], documents: [] });
  for (const key of ['administrativeEvolution', 'population', 'familiesAndEstates', 'historicBuildings', 'vanishedLocalities', 'toponymy', 'historicalMaps']) {
    assert.equal(dossier[key].noVerifiedSource, true, `${key} flagged`);
    assert.equal(dossier[key].entries.length, 0, `${key} empty`);
    assert.equal(dossier[key].note.ro, 'Nu a fost identificată o sursă verificabilă.');
    assert.equal(dossier[key].note.en, 'No verifiable source was identified.');
  }
  assert.equal(dossier.firstAttestation.status, 'NO_VERIFIED_SOURCE');
  assert.equal(dossier.certainty.identification, 'CERT');
  assert.equal(dossier.certainty.history, 'NO_DATA');
});

test('site entries never invent RAN/LMI codes, cultures or site coordinates', () => {
  const dossier = buildDossier(locality, { archaeologicalInformation: [claim()], documents: [] });
  assert.equal(dossier.ranSites.entries.length, 1);
  const site = dossier.ranSites.entries[0];
  assert.equal(site.ranCode, null);
  assert.equal(site.lmiCode, null);
  assert.equal(site.culture, null);
  assert.equal(site.coordinates, null);
  assert.equal(site.links.ran, null);
  assert.ok(site.pendingIntegration.ro.includes('RAN'));
  // locality coordinates are never reused for the site
  assert.notDeepEqual(site.coordinates, dossier.identity.coordinates);
});

test('first attestation is quote-backed, probable at most, and conflicts are surfaced', () => {
  const attested = claim({
    id: 11, claim: 'Atestare', evidence: [{ excerpt: 'Localitatea Apahida, atestată documentar în 1332 în registrele papale, „Apahida”.'.repeat(1), contextWindow: '', sourceUrl: 'https://biblioteca-digitala.ro/?a=1' }],
  });
  const other = claim({
    id: 12, claim: 'Atestare alternativă', evidence: [{ excerpt: 'Prima mențiune a localității datează din 1334.', contextWindow: '', sourceUrl: 'https://biblioteca-digitala.ro/?a=2' }],
  });
  const dossier = buildDossier(locality, { archaeologicalInformation: [attested, other], documents: [] });
  assert.equal(dossier.firstAttestation.status, 'DOCUMENTED');
  assert.equal(dossier.firstAttestation.year, 1332);
  assert.equal(dossier.firstAttestation.certainty, 'PROBABLE');
  assert.ok(dossier.firstAttestation.excerpt.length > 0);
  assert.equal(dossier.firstAttestation.documentType, null); // never guessed
  assert.ok(dossier.firstAttestation.conflicts.some((c) => c.year === 1334));
});

test('claims are bucketed into the specification history periods', () => {
  assert.equal(bucketForPeriods(['Roman']), 'antichitate');
  assert.equal(bucketForPeriods(['Epoca bronzului']), 'preistorie');
  assert.equal(bucketForPeriods(['Medieval']), 'ev-mediu');
  assert.equal(bucketForPeriods([]), 'nespecificat');
  const history = buildHistory([claim(), claim({ id: 11, periods: ['Preistorie'] })]);
  assert.equal(history.buckets.length, HISTORY_BUCKETS.length);
  const byKey = new Map(history.buckets.map((b) => [b.key, b]));
  assert.equal(byKey.get('antichitate').entries.length, 1);
  assert.equal(byKey.get('preistorie').entries.length, 1);
  assert.equal(byKey.get('ev-mediu').entries.length, 0);
});

test('report taxonomy epochs map onto the dossier history buckets', () => {
  const toBucket = {
    preistorie: ['Preistorie', 'Paleolitic', 'Mezolitic', 'Neolitic', 'Eneolitic', 'Epoca bronzului', 'Hallstatt'],
    antichitate: ['La Tène', 'Epoca fierului', 'Dacic / getic', 'Roman', 'Antichitate'],
    'ev-mediu-timpuriu': ['Epoca migrațiilor'],
    'ev-mediu': ['Medieval'],
    'moderna-timpurie': ['Modern'],
  };
  for (const [bucket, epochs] of Object.entries(toBucket)) {
    for (const epoch of epochs) {
      assert.equal(bucketForPeriods([epoch]), bucket, `${epoch} -> ${bucket}`);
    }
  }
  assert.equal(bucketForPeriods([]), 'nespecificat');
});

test('thematic sections classify only claims whose verified text matches', () => {
  const population = claim({ id: 13, claim: 'Populație', periods: [], evidence: [{ excerpt: 'Recensământul din 1850 consemna 1.204 locuitori, majoritatea români ortodocși.', contextWindow: '' }] });
  const families = claim({ id: 14, claim: 'Moșie', periods: [], evidence: [{ excerpt: 'Moșia aparținuse familiei Bánffy până la 1848.', contextWindow: '' }] });
  const maps = claim({ id: 15, claim: 'Hartă', periods: [], evidence: [{ excerpt: 'Harta militarică habsburgică consemnează localitatea sub numele Apahida.', contextWindow: '' }] });
  const thematic = classifyThematic([population, families, maps, claim()]);
  assert.equal(thematic.population.length, 1);
  assert.equal(thematic.familiesAndEstates.length, 1);
  assert.equal(thematic.historicalMaps.length, 1);
  assert.equal(thematic.administrativeEvolution.length, 0);
  assert.equal(thematic.toponymy.length, 0);
});

test('identity checks implement CHECK 1–7 with PASS/PENDING and never fail silently', () => {
  const checks = identityChecks(locality, [claim()], []);
  assert.equal(checks.length, 7);
  assert.deepEqual(checks.map((c) => c.id), ['CHECK_1', 'CHECK_2', 'CHECK_3', 'CHECK_4', 'CHECK_5', 'CHECK_6', 'CHECK_7']);
  assert.equal(checks[0].status, 'PASS'); // name
  assert.equal(checks[3].status, 'PASS'); // SIRUTA
  assert.equal(checks[4].status, 'PASS'); // coordinates
  assert.equal(checks[5].status, 'PENDING'); // RAN not integrated yet
  assert.equal(checks[6].status, 'PASS'); // sources attributed
  const noCoords = identityChecks({ ...locality, latitude: null, longitude: null }, [], []);
  assert.equal(noCoords[4].status, 'PENDING');
  assert.match(noCoords[4].detail.ro, /rămâne necompletat/);
});

test('sources are levelled: SIRUTA level 1, publications level 2, RAN declared not integrated', () => {
  const dossier = buildDossier(locality, { archaeologicalInformation: [claim()], documents: [{ title: 'Necropola de la Apahida', authors: [], publication_year: 1971, catalog_url: 'https://biblioteca-digitala.ro/?articol=2-test' }] });
  assert.equal(dossier.sources[0].level, 1);
  assert.match(dossier.sources[0].name.ro, /SIRUTA/);
  const ran = dossier.sources.find((s) => /RAN/.test(s.name.ro));
  assert.equal(ran.status, 'NOT_INTEGRATED');
  const publication = dossier.sources.find((s) => s.level === 2);
  assert.equal(publication.url, 'https://biblioteca-digitala.ro/?articol=2-test');
});

test('certainty levels come only from the allowed vocabulary and stored confidence', () => {
  assert.equal(certaintyFromClaim(claim()), 'CERT');
  assert.equal(certaintyFromClaim(claim({ fullyVerified: false, confidence: 0.6 })), 'PROBABLE');
  assert.equal(certaintyFromClaim(claim({ fullyVerified: false, confidence: 0.05 })), 'HYPOTHESIS');
  assert.equal(certaintyFromClaim(null), 'NO_DATA');
  const dossier = buildDossier(locality, { archaeologicalInformation: [claim()], documents: [] });
  assert.equal(dossier.certainty.history, 'CERT');
  assert.equal(dossier.certainty.historicalNames, 'CERT');
});

test('bilingual parity: every generated note and check carries both ro and en', () => {
  const dossier = buildDossier(locality, { archaeologicalInformation: [claim()], documents: [] });
  const notes = [
    dossier.identity.coordinatesNote, dossier.firstAttestation.note, dossier.history.note,
    dossier.ranSites.note, dossier.nearbySites.note, dossier.ranSites.entries[0].pendingIntegration,
    ...dossier.identityChecks.map((c) => c.label), ...dossier.identityChecks.map((c) => c.detail),
    ...dossier.sources.map((s) => s.name), ...dossier.sources.map((s) => s.role),
  ];
  for (const note of notes) {
    assert.equal(typeof note.ro, 'string');
    assert.equal(typeof note.en, 'string');
    assert.ok(note.ro.length > 0 && note.en.length > 0);
  }
});

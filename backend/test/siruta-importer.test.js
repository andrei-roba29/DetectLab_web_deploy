import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../scripts/importSiruta.js', import.meta.url), 'utf8');

// ── Static guarantees (mirror the style of persistent-knowledge.test.js) ──

test('importer always records the official data.gov.ro URL as source_url', () => {
  assert.match(source, /OFFICIAL_SOURCE_URL/);
  assert.match(source, /data\.gov\.ro\/dataset\/fcba1a54-cffd-422c-b3ac-920f63564085\/resource\/0ab29d86-302c-4cfa-b9b9-fd5c7ff90710\/download\/siruta_s1_2025\.csv/);
  // The INSERT always uses OFFICIAL_SOURCE_URL as source_url ($3 = OFFICIAL_SOURCE_URL)
  assert.match(source, /source_url=EXCLUDED\.source_url/);
  assert.match(source, /\[JSON\.stringify\(batch\),VERSION,OFFICIAL_SOURCE_URL\]/);
});

test('importer has SIRUTA_SOURCE_URL as the preferred fetch override', () => {
  assert.match(source, /process\.env\.SIRUTA_SOURCE_URL/);
  assert.match(source, /FETCH_URL = process\.env\.SIRUTA_SOURCE_URL \|\| process\.env\.SIRUTA_URL \|\| OFFICIAL_SOURCE_URL/);
  assert.match(source, /fetch_url/);
});

test('SIRUTA_URL is kept as a backwards-compatible fallback for FETCH_URL', () => {
  assert.match(source, /process\.env\.SIRUTA_URL/);
});

test('importer supports SIRUTA_CSV_PATH environment variable', () => {
  assert.match(source, /process\.env\.SIRUTA_CSV_PATH/);
  assert.match(source, /using CSV from SIRUTA_CSV_PATH/);
});

test('official URL fetch has timeout, retries and exponential backoff', () => {
  assert.match(source, /FETCH_TIMEOUT_MS/);
  assert.match(source, /AbortController/);
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), FETCH_TIMEOUT_MS\)/);
  assert.match(source, /for \(let attempt = 1; attempt <= FETCH_RETRIES; attempt\+\+\)/);
  assert.match(source, /1000 \* Math\.pow\(2, attempt - 1\)/);
  assert.match(source, /SIRUTA: retrying in/);
});

test('failed fetch produces a useful diagnostic mentioning the appropriate workaround', () => {
  assert.match(source, /SIRUTA download failed after/);
  assert.match(source, /SIRUTA_SOURCE_URL/);
  assert.match(source, /SIRUTA_CSV_PATH/);
});

test('existing CLI behavior and core logic remain intact', () => {
  // CLI argument still accepted as highest priority source
  assert.match(source, /process\.argv\[2\]/);
  // Validation / normalization / hierarchy / pilot / alias logic untouched
  assert.match(source, /normalize\('NFD'\)/);
  assert.match(source, /function ancestor\(record, wantedLevel\)/);
  assert.match(source, /pilot:pilot\.has/);
  assert.match(source, /curatedAliases/);
  assert.match(source, /ON CONFLICT\(siruta_code\) DO UPDATE/);
  assert.match(source, /ON CONFLICT DO NOTHING/);
  assert.match(source, /windows-1250/);
});

// ── Functional tests (module can be imported without a PG connection) ─────

const MODULE_URL = new URL('../scripts/importSiruta.js', import.meta.url).href;

test('acquire() resolves the CLI argument first', async () => {
  const prevArg = process.argv[2];
  process.argv[2] = '/tmp/cli-supplied.csv';
  process.env.SIRUTA_CSV_PATH = '/tmp/env-supplied.csv';
  try {
    const m = await import(`${MODULE_URL}?cli=1&${Date.now()}`);
    const result = await m.acquire();
    assert.deepEqual(result, { file: '/tmp/cli-supplied.csv', temporary: false });
  } finally {
    process.argv[2] = prevArg;
    delete process.env.SIRUTA_CSV_PATH;
  }
});

test('acquire() resolves SIRUTA_CSV_PATH when no CLI argument is given', async () => {
  const prevArg = process.argv[2];
  process.argv[2] = undefined;
  process.env.SIRUTA_CSV_PATH = '/tmp/env-supplied.csv';
  try {
    const m = await import(`${MODULE_URL}?env=1&${Date.now()}`);
    const result = await m.acquire();
    assert.deepEqual(result, { file: '/tmp/env-supplied.csv', temporary: false });
  } finally {
    process.argv[2] = prevArg;
    delete process.env.SIRUTA_CSV_PATH;
  }
});

test('SIRUTA_SOURCE_URL is exported and takes precedence over SIRUTA_URL', async () => {
  const prevArg = process.argv[2];
  process.argv[2] = undefined;
  delete process.env.SIRUTA_CSV_PATH;
  process.env.SIRUTA_SOURCE_URL = 'https://example.com/mirror.csv';
  process.env.SIRUTA_URL = 'https://old-override-url.gov.ro/file.csv';
  try {
    const m = await import(`${MODULE_URL}?src=1&${Date.now()}`);
    assert.equal(m.FETCH_URL, 'https://example.com/mirror.csv');
    assert.equal(m.OFFICIAL_SOURCE_URL, 'https://data.gov.ro/dataset/fcba1a54-cffd-422c-b3ac-920f63564085/resource/0ab29d86-302c-4cfa-b9b9-fd5c7ff90710/download/siruta_s1_2025.csv');
    assert.equal(m.OFFICIAL_SOURCE_URL, 'https://data.gov.ro/dataset/fcba1a54-cffd-422c-b3ac-920f63564085/resource/0ab29d86-302c-4cfa-b9b9-fd5c7ff90710/download/siruta_s1_2025.csv');
  } finally {
    process.argv[2] = prevArg;
    delete process.env.SIRUTA_SOURCE_URL;
    delete process.env.SIRUTA_URL;
  }
});

test('without any override, FETCH_URL equals OFFICIAL_SOURCE_URL', async () => {
  const prevArg = process.argv[2];
  process.argv[2] = undefined;
  delete process.env.SIRUTA_CSV_PATH;
  delete process.env.SIRUTA_SOURCE_URL;
  delete process.env.SIRUTA_URL;
  try {
    const m = await import(`${MODULE_URL}?noenv=1&${Date.now()}`);
    assert.equal(m.FETCH_URL, m.OFFICIAL_SOURCE_URL);
  } finally {
    process.argv[2] = prevArg;
  }
});

test('SIRUTA_URL alone sets FETCH_URL but does not change OFFICIAL_SOURCE_URL', async () => {
  const prevArg = process.argv[2];
  process.argv[2] = undefined;
  delete process.env.SIRUTA_CSV_PATH;
  delete process.env.SIRUTA_SOURCE_URL;
  process.env.SIRUTA_URL = 'https://backwards-compat-only.gov.ro/file.csv';
  try {
    const m = await import(`${MODULE_URL}?surl=1&${Date.now()}`);
    assert.equal(m.FETCH_URL, 'https://backwards-compat-only.gov.ro/file.csv');
    assert.equal(m.OFFICIAL_SOURCE_URL, 'https://data.gov.ro/dataset/fcba1a54-cffd-422c-b3ac-920f63564085/resource/0ab29d86-302c-4cfa-b9b9-fd5c7ff90710/download/siruta_s1_2025.csv');
  } finally {
    process.argv[2] = prevArg;
    delete process.env.SIRUTA_URL;
  }
});

test('acquire() throws a clear diagnostic when all fetch retries are exhausted', async () => {
  const prevArg = process.argv[2];
  process.argv[2] = undefined;
  delete process.env.SIRUTA_CSV_PATH;
  delete process.env.SIRUTA_SOURCE_URL;
  delete process.env.SIRUTA_URL;
  process.env.SIRUTA_FETCH_RETRIES = '1';
  process.env.SIRUTA_FETCH_TIMEOUT_MS = '500';
  try {
    const m = await import(`${MODULE_URL}?fail=1&${Date.now()}`);
    await assert.rejects(
      () => m.acquire(),
      (err) => {
        assert.match(err.message, /SIRUTA download failed after 1 attempts/);
        assert.match(err.message, /data\.gov\.ro/);
        assert.match(err.message, /SIRUTA_SOURCE_URL/);
        return true;
      }
    );
  } finally {
    process.argv[2] = prevArg;
    delete process.env.SIRUTA_FETCH_RETRIES;
    delete process.env.SIRUTA_FETCH_TIMEOUT_MS;
  }
});

test('acquire() uses FETCH_URL when SIRUTA_SOURCE_URL is set (mirror scenario)', async () => {
  const prevArg = process.argv[2];
  process.argv[2] = undefined;
  delete process.env.SIRUTA_CSV_PATH;
  process.env.SIRUTA_SOURCE_URL = 'http://127.0.0.1:1/unreachable-mirror.csv';
  process.env.SIRUTA_FETCH_RETRIES = '1';
  process.env.SIRUTA_FETCH_TIMEOUT_MS = '500';
  try {
    const m = await import(`${MODULE_URL}?mirror=1&${Date.now()}`);
    await assert.rejects(
      () => m.acquire(),
      (err) => {
        assert.match(err.message, /SIRUTA download failed after 1 attempts/);
        assert.match(err.message, /unreachable-mirror\.csv/);
        // Should mention SIRUTA_SOURCE_URL in the error since that's what was used
        assert.match(err.message, /SIRUTA_SOURCE_URL/);
        return true;
      }
    );
  } finally {
    process.argv[2] = prevArg;
    delete process.env.SIRUTA_SOURCE_URL;
    delete process.env.SIRUTA_FETCH_RETRIES;
    delete process.env.SIRUTA_FETCH_TIMEOUT_MS;
  }
});

test('normalize() strips diacritics and maps ş/ţ variants', async () => {
  const m = await import(`${MODULE_URL}?norm=1&${Date.now()}`);
  assert.equal(m.normalize('Cluj-Napoca'), 'cluj-napoca');
  assert.equal(m.normalize('Șimleu Silvaniei'), 'simleu silvaniei');
  assert.equal(m.normalize('Târgu Mureș'), 'targu mures');
  assert.equal(m.normalize('ŢIGĂNAŞI'), 'tiganasi');
});

test('parseCsv() detects ; vs , delimiter and handles quoted cells', async () => {
  const m = await import(`${MODULE_URL}?csv=1&${Date.now()}`);
  const semicolon = 'SIRUTA;DENLOC;NIV\n1001;"Cluj-Napoca";2\n1002;Apahida;3\n';
  assert.deepEqual(m.parseCsv(semicolon), [
    ['SIRUTA', 'DENLOC', 'NIV'],
    ['1001', 'Cluj-Napoca', '2'],
    ['1002', 'Apahida', '3'],
  ]);
  const comma = 'SIRUTA,DENLOC,NIV\n1001,Cluj-Napoca,2\n';
  assert.deepEqual(m.parseCsv(comma), [
    ['SIRUTA', 'DENLOC', 'NIV'],
    ['1001', 'Cluj-Napoca', '2'],
  ]);
});

test('pick() and localityType() preserve existing field aliasing and type mapping', async () => {
  const m = await import(`${MODULE_URL}?pick=1&${Date.now()}`);
  assert.equal(m.pick({ DENLOC: 'X', NUME: 'Y' }, ['DENLOC', 'NUMENAME', 'NUME']), 'X');
  assert.equal(m.pick({ NUME: 'Y' }, ['DENLOC', 'NUME']), 'Y');
  assert.equal(m.pick({}, ['DENLOC', 'NUME']), null);
  assert.equal(m.localityType('1'), 'municipiu');
  assert.equal(m.localityType('23'), 'sat component comună');
  assert.equal(m.localityType('99'), '99');
  assert.equal(m.localityType(undefined), 'necunoscut');
});

test('pilot set covers the expected 30 pilot localities', async () => {
  const m = await import(`${MODULE_URL}?pilot=1&${Date.now()}`);
  assert.ok(m.pilot.has('cluj|cluj-napoca'));
  assert.ok(m.pilot.has('alba|alba iulia'));
  assert.ok(m.pilot.has('constanta|istria'));
  assert.equal(m.pilot.size, 30);
});
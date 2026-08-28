import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Guards the SQL of the persistent evidence layer.
 *
 * The whole "Biblioteca din Babel" search failure came down to one PostgreSQL
 * rule violated by the very first query of every search:
 *
 *   SELECT DISTINCT l.* … ORDER BY CASE WHEN … END, l.id
 *     → ERROR 42P10: for SELECT DISTINCT, ORDER BY expressions must appear
 *       in select list
 *
 * With DISTINCT, each ORDER BY expression of that query level must be part of
 * its select list, so a CASE/function sort key is rejected. It threw before
 * the publication source was contacted, the route had no mapping for it, and
 * the browser therefore only ever displayed "Internal server error". Rather
 * than trusting one call site, every SQL literal in backend/src is linted.
 */

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/**
 * Comments document SQL shapes too (this very file does), so block comments and
 * standalone `//` lines are dropped before literals are harvested. URLs inside
 * strings must survive, hence whole-line filtering instead of a `//.*$` regex.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
}

function sqlLiteralsOf(file) {
  const source = stripComments(fs.readFileSync(file, 'utf8'));
  const out = [];
  const pattern = /`([^`]*(?:SELECT|UPDATE|INSERT|DELETE)[^`]*)`/gis;
  let match;
  while ((match = pattern.exec(source))) {
    // Template placeholders stand for the county clause: normalise them so the
    // scan sees one flat statement.
    out.push({ file: path.relative(srcRoot, file), sql: match[1].replace(/\$\{[\w.]+\}/g, '1').replace(/\s+/g, ' ') });
  }
  return out;
}

function collectSql(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectSql(full));
    else if (entry.name.endsWith('.js')) files.push(...sqlLiteralsOf(full));
  }
  return files;
}

/**
 * Sort terms of the query level that starts at `from` (the offset of a
 * `SELECT DISTINCT`), or null when that level has no ORDER BY: an ORDER BY
 * reached after the block closes belongs to an outer query and is judged
 * against that query's own select list.
 */
function orderByTermsOfLevel(sql, from) {
  let depth = 0;
  for (let i = from; i < sql.length; i += 1) {
    const char = sql[i];
    if (char === '(') { depth += 1; continue; }
    if (char === ')') { if (depth === 0) return null; depth -= 1; continue; }
    if (char === ';') return null;
    if (depth !== 0) continue;
    const head = sql.slice(i).match(/^ORDER\s+BY\s+/i);
    if (!head) continue;
    const terms = [];
    let buffer = '', level = 0;
    for (let j = i + head[0].length; j < sql.length; j += 1) {
      const c = sql[j];
      if (c === '(') level += 1;
      else if (c === ')') { if (level === 0) break; level -= 1; }
      else if (level === 0 && /^(?:LIMIT|OFFSET|FETCH|RETURNING)\b/i.test(sql.slice(j)) && !/\w/.test(sql[j - 1] || ' ')) break;
      if (c === ',' && level === 0) { terms.push(buffer); buffer = ''; continue; }
      buffer += c;
    }
    terms.push(buffer);
    return terms.map((term) => term.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
  return null;
}

// Safe under DISTINCT: an ordinal or a plain [alias.]column (optionally with
// ASC/DESC/NULLS). Anything computed must be projected first — see the fix in
// repository.js, which projects `(l.normalized_name=$1) AS exact_match`.
const PLAIN_SORT_KEY = /^[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?(?:\s+(?:ASC|DESC|NULLS\s+(?:FIRST|LAST)))*$/i;

function offendersIn(sql) {
  const found = [];
  for (const match of sql.matchAll(/SELECT\s+DISTINCT\b/gi)) {
    const terms = orderByTermsOfLevel(sql, match.index + match[0].length);
    if (!terms) continue;
    for (const term of terms) if (!/^\d+$/.test(term) && !PLAIN_SORT_KEY.test(term)) found.push(term);
  }
  return found;
}

test('no DISTINCT query in the backend sorts by a computed expression', () => {
  const queries = collectSql(srcRoot);
  assert.ok(queries.length >= 20, `the lint actually scanned the backend SQL (${queries.length} literals)`);
  const offenders = [];
  for (const { file, sql } of queries) for (const term of offendersIn(sql)) offenders.push(`${file} → ORDER BY ${term}`);
  assert.deepEqual(offenders, [], `every SELECT DISTINCT must sort by projected columns only:\n${offenders.join('\n')}`);
});

test('the lint rejects the query shape that broke every evidence search', () => {
  const broken = 'SELECT DISTINCT l.* FROM knowledge.localities l LEFT JOIN knowledge.locality_aliases a ON a.locality_id=l.id WHERE (l.normalized_name=$1 OR a.normalized_alias=$1) ORDER BY CASE WHEN l.normalized_name=$1 THEN 0 ELSE 1 END,l.id LIMIT 2';
  assert.deepEqual(offendersIn(broken), ['CASE WHEN l.normalized_name=$1 THEN 0 ELSE 1 END'], 'the historical offender is caught');
  const fixed = 'SELECT * FROM ( SELECT DISTINCT l.*, (l.normalized_name=$1) AS exact_match FROM knowledge.localities l WHERE l.normalized_name=$1 ) m ORDER BY m.exact_match DESC, m.id LIMIT 2';
  assert.deepEqual(offendersIn(fixed), [], 'the fixed shape is accepted');
});

test('locality identification projects the exact-name preference instead of sorting on it', async () => {
  // Building the query only needs a config-complete environment; no database
  // connection is opened.
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://detectlab:detectlab@localhost:5432/detectlab',
    JWT_SECRET: 'test-secret',
    ARCGIS_BASE_URL: 'https://example.invalid/MapServer',
  });
  const { localityLookupQuery } = await import('../src/services/evidence/repository.js');
  const { sql, params } = localityLookupQuery('Apahida');
  assert.match(sql, /SELECT\s+DISTINCT l\.\*, \(l\.normalized_name=\$1\) AS exact_match/, 'exact-name preference is projected');
  assert.match(sql, /FROM \(/, 'the DISTINCT is nested so the outer ORDER BY is legal');
  assert.match(sql, /ORDER BY m\.exact_match DESC, m\.id/, 'ordering uses projected columns only');
  assert.match(sql, /a\.normalized_alias=\$1/, 'historical aliases still identify the locality (§1)');
  assert.match(sql, /LIMIT 2/, 'two candidates are enough to answer ambiguous_locality');
  assert.deepEqual(params, ['apahida'], 'the searched name is normalised');

  const scoped = localityLookupQuery('Apahida', 'Cluj');
  assert.deepEqual(scoped.params, ['apahida', 'Cluj'], 'the county is a bound parameter, never interpolated');
  assert.match(scoped.sql, /lower\(l\.county\)=lower\(\$2\)/, 'a supplied county narrows the homonym set');
  assert.deepEqual(offendersIn(scoped.sql.replace(/\s+/g, ' ')), [], 'no computed sort key survives in either shape');
});

#!/usr/bin/env node
// Export knowledge.localities + locality_aliases to a JSON file for offline matching.
// Usage: DATABASE_URL=... node scripts/exportSirutaDictionary.js [output.json]

import fs from 'node:fs';
import { pool } from '../src/config/db.js';

const out = process.argv[2] || 'siruta_dictionary.json';
const { rows: localities } = await pool.query('SELECT id, siruta_code, name, normalized_name, county, county_code FROM knowledge.localities ORDER BY id');
const { rows: aliases } = await pool.query('SELECT locality_id, alias, normalized_alias, alias_type, language FROM knowledge.locality_aliases ORDER BY locality_id');
await pool.end();
fs.writeFileSync(out, JSON.stringify({ localities, aliases }, null, 2), 'utf8');
console.log(`Exported ${localities.length} localities, ${aliases.length} aliases → ${out}`);

import { pool } from '../src/config/db.js';
import { workOnce } from '../src/services/evidence/ingestionWorker.js';
try {
  const processed = await workOnce();
  console.log(JSON.stringify({ processed }));
} finally { await pool.end(); }

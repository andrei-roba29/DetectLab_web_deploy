// DetectLab — Worker de feedback (👍/👎 pe detecții)
//
// Rute:
//   POST /feedback   — trimite un vot (public, cu rate-limit per IP)
//   GET  /export      — descarcă tot feedback-ul brut, ca JSON (protejat cu ?token=ADMIN_TOKEN)
//   GET  /stats        — agregare rapidă per clasă/vot (public, fără date sensibile)
//
// Config necesar (vezi README.md):
//   - D1 database legat ca binding "DB" (vezi wrangler.toml)
//   - secret ADMIN_TOKEN  (protejează /export)
//   - secret IP_SALT      (folosit ca sare la hash-uirea IP-ului, doar pt. rate-limit)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const RATE_LIMIT_MAX = 40;      // voturi
const RATE_LIMIT_WINDOW = 15;   // minute

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      if (url.pathname === '/feedback' && request.method === 'POST') {
        return await handleFeedback(request, env);
      }
      if (url.pathname === '/export' && request.method === 'GET') {
        return await handleExport(url, env);
      }
      if (url.pathname === '/stats' && request.method === 'GET') {
        return await handleStats(env);
      }
    } catch (err) {
      return jsonResponse({ error: 'internal error', detail: String(err) }, 500);
    }

    return jsonResponse({ error: 'not found' }, 404);
  },
};

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function hashIp(ip, salt) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(ip + ':' + salt));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function handleFeedback(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid json' }, 400);
  }

  const {
    vote, cls, confidence,
    latNorth, latSouth, lonWest, lonEast,
    zoom, tileX, tileY, modelVersion,
  } = body || {};

  if (!['up', 'down'].includes(vote)) {
    return jsonResponse({ error: 'vote must be "up" or "down"' }, 400);
  }
  if (
    typeof cls !== 'string' ||
    typeof latNorth !== 'number' || typeof latSouth !== 'number' ||
    typeof lonWest !== 'number' || typeof lonEast !== 'number'
  ) {
    return jsonResponse({ error: 'missing or invalid required fields' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = await hashIp(ip, env.IP_SALT || 'dev-salt-change-me');

  const rl = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM feedback WHERE ip_hash = ? AND created_at > datetime('now', ?)`
  ).bind(ipHash, `-${RATE_LIMIT_WINDOW} minutes`).first();

  if (rl && rl.n >= RATE_LIMIT_MAX) {
    return jsonResponse({ error: 'rate limited, încearcă mai târziu' }, 429);
  }

  await env.DB.prepare(
    `INSERT INTO feedback
      (vote, class, confidence, lat_north, lat_south, lon_west, lon_east, zoom, tile_x, tile_y, model_version, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    vote, cls, confidence ?? null,
    latNorth, latSouth, lonWest, lonEast,
    zoom ?? null, tileX ?? null, tileY ?? null,
    modelVersion ?? null, ipHash
  ).run();

  return jsonResponse({ ok: true });
}

async function handleExport(url, env) {
  const token = url.searchParams.get('token');
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const classFilter = url.searchParams.get('class');
  const voteFilter = url.searchParams.get('vote');

  let query = `SELECT id, created_at, vote, class, confidence, lat_north, lat_south, lon_west, lon_east, zoom, tile_x, tile_y, model_version FROM feedback`;
  const conditions = [];
  const params = [];
  if (classFilter) { conditions.push('class = ?'); params.push(classFilter); }
  if (voteFilter) { conditions.push('vote = ?'); params.push(voteFilter); }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY created_at DESC';

  const stmt = params.length ? env.DB.prepare(query).bind(...params) : env.DB.prepare(query);
  const { results } = await stmt.all();

  return jsonResponse(results);
}

async function handleStats(env) {
  const { results } = await env.DB.prepare(
    `SELECT class, vote, COUNT(*) as n FROM feedback GROUP BY class, vote ORDER BY class, vote`
  ).all();
  return jsonResponse(results);
}

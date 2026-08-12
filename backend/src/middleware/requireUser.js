/* ═══════════════════════════════════════════════════════════════════════
   Auth middleware for payment endpoints.
   ───────────────────────────────────────────────────────────────────────
   Validates the user's Supabase access token against Supabase itself
   (GET /auth/v1/user with the anon key) — robust even if the backend's
   JWT_SECRET env var differs from the Supabase project's JWT secret.
   Attaches req.user = { id, email } on success.
   ═══════════════════════════════════════════════════════════════════════ */

import { env } from '../config/env.js';
import { logger } from '../logger.js';

export async function requireUser(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    return res.status(503).json({ error: 'payments_not_configured' });
  }

  try {
    const r = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!r.ok) return res.status(401).json({ error: 'Unauthorized' });

    const data = await r.json();
    if (!data || !data.id) return res.status(401).json({ error: 'Unauthorized' });

    req.user = { id: data.id, email: data.email || null };
    next();
  } catch (err) {
    logger.error({ err }, 'Auth verification failed');
    res.status(503).json({ error: 'auth_unavailable' });
  }
}

import { Router } from 'express';
import { researchLocality } from '../services/evidence/engine.js';

const router = Router();

router.post('/evidence/search', async (req, res, next) => {
  try {
    const locality = String(req.body?.locality || '').trim();
    if (locality.length < 2 || locality.length > 120) {
      return res.status(400).json({ error: 'invalid_locality', message: 'Locality must contain between 2 and 120 characters.' });
    }
    const aliases = Array.isArray(req.body?.aliases)
      ? req.body.aliases.map((value) => String(value).trim()).filter(Boolean).slice(0, 10)
      : [];
    const result = await researchLocality({
      locality,
      county: req.body?.county ? String(req.body.county).trim().slice(0, 80) : null,
      aliases,
      limit: Math.min(Number(req.body?.limit) || 10, 20),
      includeFullText: req.body?.includeFullText !== false,
    });
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    res.json(result);
  } catch (error) {
    if (error?.name === 'AbortError') return res.status(504).json({ error: 'source_timeout', source: 'https://biblioteca-digitala.ro/' });
    next(error);
  }
});

export default router;

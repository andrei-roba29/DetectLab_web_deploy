import crypto from 'node:crypto';
import { Router } from 'express';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../logger.js';
import { researchLocality } from '../services/evidence/engine.js';
import { SourceUnavailableError } from '../services/evidence/bibliotecaDigitala.js';
import { createRun, setRunStatus } from '../services/evidence/ingestionWorker.js';
import { findLocality, getClaim, getDossier, getEvidence, getLocality, getLocalityArchaeology, getLocalityDocuments, getLocalityEvidence, getPersistentBundle, persistResearchResult } from '../services/evidence/repository.js';

const router = Router();
const numericId = (value) => /^\d+$/.test(String(value));
function admin(req,res,next){if(!env.ingestionAdminKey)return res.status(503).json({error:'ingestion_admin_not_configured'});if(req.get('x-ingestion-key')!==env.ingestionAdminKey)return res.status(403).json({error:'forbidden'});next();}

/**
 * Live research is throttled at the source (one polite request lane) and can
 * legitimately take a long time. Concurrent searches for the SAME locality
 * must not each start an independent crawl — the first request owns the run
 * and everybody else awaits the same promise. Without this, a user pressing
 * "Cercetează" repeatedly multiplies the load and every duplicate request
 * keeps the pool and the source busy for minutes.
 */
const inFlightResearch = new Map();
function researchOnce(localityId, task) {
  const existing = inFlightResearch.get(localityId);
  if (existing) return { promise: existing, shared: true };
  const promise = task().finally(() => inFlightResearch.delete(localityId));
  inFlightResearch.set(localityId, promise);
  return { promise, shared: false };
}

/**
 * Storage-layer failures used to reach the app-level handler and answer the
 * browser with a contentless `Internal server error` — which is exactly the
 * symptom this route was reported for. They are now logged with a request id
 * (and the real Postgres error) and answered with a code the UI can translate,
 * so an un-migrated or unreachable database is obvious instead of mysterious.
 * Set `EVIDENCE_DEBUG=true` on the server to also echo the underlying message.
 */
// "The deployed schema and this code disagree."
const SCHEMA_ERRORS = new Set(['42P01' /* undefined_table */, '42703' /* undefined_column */, '42704' /* undefined_object */, '42883' /* undefined_function */, '42P10' /* invalid_dependency */]);
// The server refused the statement itself — e.g. `SELECT DISTINCT … ORDER BY
// CASE … END` (0A000 feature_not_supported), the shape that broke every search.
const REJECTED_QUERY = new Set(['0A000']);
// A write the knowledge schema's constraints legitimately refused to accept.
const WRITE_ERRORS = new Set(['23502', '23503', '23505', '23507', '23514']);

export function classifyStorageError(error, requestId = '—') {
  const sqlState = error?.code || null;
  if (SCHEMA_ERRORS.has(sqlState)) return { status: 503, code: 'database_schema_outdated', message: 'Structura bazei de date `knowledge.*` de pe server nu este la zi (rulează `npm run migrate`).' };
  if (REJECTED_QUERY.has(sqlState)) return { status: 503, code: 'database_query_rejected', message: 'Interogarea bazei de date a fost respinsă de serverul PostgreSQL (sintaxă incompatibilă cu versiunea acestuia).' };
  if (WRITE_ERRORS.has(sqlState)) return { status: 500, code: 'storage_write_failed', message: `Salvarea dovezilor a fost respinsă de restricțiile bazei de date. Reîncearcă; dacă se repetă, raportează ID-ul ${requestId}.` };
  if (/timeout|connection|ECONN/i.test(String(error?.message || '')) || sqlState === 'ETYIMOUT' || sqlState === '57P01' || sqlState === '57P02' || sqlState === '57P03') return { status: 503, code: 'database_unreachable', message: 'Baza de date nu a putut fi contactată. Reîncearcă în câteva minute.' };
  return { status: 500, code: 'search_failed', message: `Cercetarea a eșuat dintr-o eroare internă. Reîncearcă; dacă se repetă, raportează ID-ul ${requestId}.` };
}

function failSearch(res, error, status, code, message, requestId) {
  logger.error({ err: error, requestId, code: error?.code || null, sqlMessage: error?.sqlMessage || null, relation: error?.relation || null, responseCode: code }, 'evidence/search failed');
  const body = { error: code, requestId, message };
  if (error?.code) body.sqlState = error.code;
  if (env.exposeErrorDetails) body.detail = String(error?.message || error);
  return res.status(status).json(body);
}

router.post('/evidence/search', async (req, res) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const localityName = String(req.body?.locality || '').trim();
  try {
    const county = req.body?.county ? String(req.body.county).trim().slice(0,80) : null;
    // §1 exact identification: a numeric localityId (SIRUTA register row) may
    // be supplied alone when the user resolved an ambiguous homonym by hand.
    const hasLocalityId = Boolean(req.body?.localityId && numericId(req.body.localityId));
    if (!hasLocalityId && (localityName.length < 2 || localityName.length > 120)) return res.status(400).json({error:'invalid_locality'});
    const matches = hasLocalityId
      ? [await getLocality(req.body.localityId)].filter(Boolean)
      : await findLocality(localityName, county);
    if (!matches.length) return res.status(404).json({error:'locality_not_found',message:'Localitatea nu există în registrul SIRUTA importat.'});
    if (matches.length > 1) return res.status(409).json({error:'ambiguous_locality',message:'Selectarea necesită ID-ul/SIRUTA exact; numele nu este îmbinat automat.',matches:matches.map((l)=>({id:l.id,name:l.name,county:l.county,uat:l.uat_name,siruta:l.siruta_code}))});
    const locality = matches[0];
    const cached = async () => {
      const bundle = await getPersistentBundle(locality.id);
      if (!bundle) return res.status(404).json({ error: 'locality_not_found', requestId, message: 'Înregistrarea localității nu a putut fi citită. Reîncearcă.' });
      return res.json(bundle);
    };
    if (locality.ingestion_status === 'PROCESSED' && req.body?.refresh !== true) {
      res.set('X-DetectLab-Storage','persistent-cache');
      return await cached();
    }
    const explicitAliases = Array.isArray(req.body?.aliases) ? req.body.aliases.map(String).slice(0,10) : [];
    const stored = await getLocality(locality.id);
    const aliases = [...new Set([...(stored.aliases||[]).map((a)=>a.alias),...explicitAliases])];
    const { promise: resultPromise, shared } = researchOnce(locality.id, () => researchLocality({
      locality: locality.name, county: locality.county, aliases,
      limit: Math.min(Number(req.body?.limit) || 10, 20),
      includeFullText: req.body?.includeFullText !== false,
      budgetMs: env.evidenceResearchBudgetMs,
    }));
    if (shared) res.set('X-DetectLab-Research','shared-in-flight');
    const result = await resultPromise;
    await persistResearchResult(locality.id,result);
    res.set('X-DetectLab-Storage','newly-persisted');
    const bundle = await getPersistentBundle(locality.id);
    // Saved but unreadable means the storage layer is misbehaving; report it
    // with the same coded vocabulary instead of a silent 500.
    if (!bundle) { const failure = classifyStorageError(null, requestId); return res.status(failure.status).json({ error: failure.code, requestId, message: failure.message }); }
    // A time-boxed run returns what it managed to analyse; the UI says so
    // instead of letting the browser abort the request at 150 s.
    if (result.truncated) bundle.truncated = { reason: 'research_budget_exhausted', budgetMs: env.evidenceResearchBudgetMs };
    return res.status(201).json(bundle);
  } catch(error){
    // The exclusive publication source is the only external dependency of the
    // research path. When it is unreachable or refuses a request, surface an
    // actionable 502 (source_unavailable) instead of a bare 500.
    if (error?.name === 'AbortError') return failSearch(res, error, 504, 'source_timeout', 'Sursa de publicații a răspuns prea lent. Reîncearcă.', requestId);
    if (error instanceof SourceUnavailableError) return failSearch(res, error, 502, 'source_unavailable', 'Sursa de publicații biblioteca-digitala.ro este momentan indisponibilă. Încearcă din nou mai târziu.', requestId);
    // Everything else comes from the storage layer or is a real bug: classify
    // it so the user sees a sentence and the log sees the cause.
    const failure = classifyStorageError(error, requestId);
    if (!error?.code) logger.error({ err: error, requestId, locality: localityName || req.body?.localityId || null }, 'evidence/search unhandled error');
    return failSearch(res, error, failure.status, failure.code, failure.message, requestId);
  }
});

router.get('/localities/:id/dossier', async(req,res,next)=>{try{if(!numericId(req.params.id))return res.status(400).json({error:'invalid_id'});const dossier=await getDossier(req.params.id);dossier?res.json({localityId:req.params.id,dossier}):res.status(404).json({error:'not_found'});}catch(e){next(e);}});
router.get('/localities/:id', async(req,res,next)=>{try{if(!numericId(req.params.id))return res.status(400).json({error:'invalid_id'});const row=await getLocality(req.params.id);row?res.json(row):res.status(404).json({error:'not_found'});}catch(e){next(e);}});
router.get('/localities/:id/archaeology', async(req,res,next)=>{try{res.json({localityId:req.params.id,claims:await getLocalityArchaeology(req.params.id)});}catch(e){next(e);}});
router.get('/localities/:id/evidence', async(req,res,next)=>{try{res.json({localityId:req.params.id,evidence:await getLocalityEvidence(req.params.id)});}catch(e){next(e);}});
router.get('/localities/:id/documents', async(req,res,next)=>{try{res.json({localityId:req.params.id,documents:await getLocalityDocuments(req.params.id)});}catch(e){next(e);}});
router.get('/claims/:id', async(req,res,next)=>{try{const row=await getClaim(req.params.id);row?res.json(row):res.status(404).json({error:'not_found'});}catch(e){next(e);}});
router.get('/evidence/:id', async(req,res,next)=>{try{const row=await getEvidence(req.params.id);row?res.json(row):res.status(404).json({error:'not_found'});}catch(e){next(e);}});

router.post('/ingestion/locality/:id',admin,async(req,res,next)=>{try{const run=await createRun({type:'LOCALITY',localityIds:[req.params.id]});res.status(202).json(run);}catch(e){next(e);}});
router.post('/ingestion/runs',admin,async(req,res,next)=>{try{const type=String(req.body?.type||'PILOT').toUpperCase();if(!['PILOT','NATIONAL','INCREMENTAL','REPROCESS'].includes(type))return res.status(400).json({error:'invalid_run_type'});res.status(202).json(await createRun({type,county:req.body?.county||null,localityIds:req.body?.localityIds||null}));}catch(e){next(e);}});
router.post('/ingestion/runs/:id/:action',admin,async(req,res,next)=>{try{const map={pause:'PAUSED',resume:'RUNNING',cancel:'CANCELLED'},status=map[req.params.action];if(!status)return res.status(400).json({error:'invalid_action'});const run=await setRunStatus(req.params.id,status);run?res.json(run):res.status(404).json({error:'not_found'});}catch(e){next(e);}});

router.get('/ingestion/status',async(req,res,next)=>{try{
  const [totals,counties,runs]=await Promise.all([
    pool.query(`SELECT count(*)::int total_localities,count(*) FILTER(WHERE ingestion_status='PROCESSED')::int localities_processed,count(*) FILTER(WHERE ingestion_status NOT IN ('PROCESSED'))::int localities_remaining FROM knowledge.localities`),
    pool.query(`SELECT county,count(*)::int total,count(*) FILTER(WHERE ingestion_status='PROCESSED')::int processed,count(*) FILTER(WHERE ingestion_status='FAILED')::int failed FROM knowledge.localities GROUP BY county ORDER BY county`),
    pool.query(`SELECT * FROM knowledge.extraction_runs ORDER BY created_at DESC LIMIT 20`)
  ]);
  const metrics=await pool.query(`SELECT (SELECT count(*) FROM knowledge.documents)::int documents_discovered,(SELECT count(*) FROM knowledge.documents WHERE processing_status IN ('PROCESSED','PDF_TEXT','OCR_COMPLETED'))::int documents_processed,(SELECT count(*) FROM knowledge.archaeological_claims)::int archaeological_claims,(SELECT count(*) FROM knowledge.evidence)::int evidence_records,(SELECT count(*) FROM knowledge.documents WHERE processing_status='OCR_REQUIRED')::int ocr_required,(SELECT count(*) FROM knowledge.documents WHERE processing_status IN ('FAILED','ACCESS_FAILED','OCR_FAILED','MALFORMED'))::int failed_documents,(SELECT count(*) FROM knowledge.review_queue WHERE status='OPEN')::int review_required`);
  res.json({...totals.rows[0],...metrics.rows[0],pdfs_permanently_stored:0,counties:counties.rows,runs:runs.rows});
}catch(e){next(e);}});
router.get('/review-queue',admin,async(req,res,next)=>{try{const limit=Math.min(Number(req.query.limit)||100,500);const {rows}=await pool.query(`SELECT * FROM knowledge.review_queue WHERE status=COALESCE($1,status) ORDER BY CASE severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,created_at LIMIT $2`,[req.query.status||'OPEN',limit]);res.json({items:rows});}catch(e){next(e);}});

export default router;

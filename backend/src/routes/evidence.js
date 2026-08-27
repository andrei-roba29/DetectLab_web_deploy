import { Router } from 'express';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { researchLocality } from '../services/evidence/engine.js';
import { createRun, setRunStatus } from '../services/evidence/ingestionWorker.js';
import { findLocality, getClaim, getDossier, getEvidence, getLocality, getLocalityArchaeology, getLocalityDocuments, getLocalityEvidence, getPersistentBundle, persistResearchResult } from '../services/evidence/repository.js';

const router = Router();
const numericId = (value) => /^\d+$/.test(String(value));
function admin(req,res,next){if(!env.ingestionAdminKey)return res.status(503).json({error:'ingestion_admin_not_configured'});if(req.get('x-ingestion-key')!==env.ingestionAdminKey)return res.status(403).json({error:'forbidden'});next();}

router.post('/evidence/search', async (req, res, next) => {
  try {
    const localityName = String(req.body?.locality || '').trim();
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
    if (locality.ingestion_status === 'PROCESSED' && req.body?.refresh !== true) {
      res.set('X-DetectLab-Storage','persistent-cache');
      return res.json(await getPersistentBundle(locality.id));
    }
    const explicitAliases = Array.isArray(req.body?.aliases) ? req.body.aliases.map(String).slice(0,10) : [];
    const stored = await getLocality(locality.id);
    const aliases = [...new Set([...(stored.aliases||[]).map((a)=>a.alias),...explicitAliases])];
    const result = await researchLocality({locality:locality.name,county:locality.county,aliases,limit:Math.min(Number(req.body?.limit)||10,20),includeFullText:req.body?.includeFullText!==false});
    await persistResearchResult(locality.id,result);
    res.set('X-DetectLab-Storage','newly-persisted');
    res.status(201).json(await getPersistentBundle(locality.id));
  } catch(error){if(error?.name==='AbortError')return res.status(504).json({error:'source_timeout',source:'https://biblioteca-digitala.ro/'});next(error);}
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

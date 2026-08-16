import os from 'node:os';
import crypto from 'node:crypto';
import { pool, withTransaction } from '../../config/db.js';
import { researchLocality } from './engine.js';
import { persistResearchResult, PIPELINE_VERSION } from './repository.js';
import { logger } from '../../logger.js';

const workerId = `${os.hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
let timer = null;
let busy = false;

export async function createRun({ type = 'PILOT', county = null, localityIds = null } = {}) {
  return withTransaction(async (client) => {
    const conditions = [];
    const params = [];
    if (type === 'PILOT') conditions.push('pilot=TRUE');
    if (county) { params.push(county); conditions.push(`county=$${params.length}`); }
    if (Array.isArray(localityIds) && localityIds.length) { params.push(localityIds); conditions.push(`id=ANY($${params.length}::bigint[])`); }
    if (type === 'INCREMENTAL') conditions.push('(next_check_at IS NULL OR next_check_at<=now())');
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const selected = await client.query(`SELECT id FROM knowledge.localities ${where} ORDER BY id`, params);
    const selectedIds = selected.rows.map((row) => row.id);
    const { rows: [run] } = await client.query(`INSERT INTO knowledge.extraction_runs(run_type,status,scope,total_localities,pipeline_version) VALUES($1,'QUEUED',$2,$3,$4) RETURNING *`, [type, JSON.stringify({ county, localityIds }), selectedIds.length, PIPELINE_VERSION]);
    if (selectedIds.length) await client.query(`INSERT INTO knowledge.ingestion_jobs(run_id,locality_id,priority) SELECT $1,id,CASE WHEN pilot THEN 100 ELSE 0 END FROM knowledge.localities WHERE id=ANY($2::bigint[]) ON CONFLICT DO NOTHING`, [run.id, selectedIds]);
    return run;
  });
}

async function claimJob() {
  return withTransaction(async (client) => {
    // A killed worker leaves an auditable RUNNING row. Reclaim only stale locks;
    // completed locality transactions are never replayed.
    await client.query(`UPDATE knowledge.ingestion_jobs SET status='RETRY',available_at=now(),locked_at=NULL,locked_by=NULL,last_error=COALESCE(last_error,'stale worker lock recovered') WHERE status='RUNNING' AND locked_at < now()-interval '15 minutes'`);
    const { rows } = await client.query(`SELECT j.id,j.run_id,j.locality_id,j.attempt_count,j.max_attempts,l.name,l.county
      FROM knowledge.ingestion_jobs j JOIN knowledge.extraction_runs r ON r.id=j.run_id JOIN knowledge.localities l ON l.id=j.locality_id
      WHERE j.status IN ('QUEUED','RETRY') AND j.available_at<=now() AND r.status IN ('QUEUED','RUNNING')
      ORDER BY j.priority DESC,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1`);
    if (!rows[0]) return null;
    const job = rows[0];
    const aliasResult = await client.query(`SELECT COALESCE(array_agg(alias),'{}') aliases FROM knowledge.locality_aliases WHERE locality_id=$1`, [job.locality_id]);
    job.aliases = aliasResult.rows[0].aliases;
    await client.query(`UPDATE knowledge.ingestion_jobs SET status='RUNNING',locked_at=now(),locked_by=$2,started_at=COALESCE(started_at,now()),attempt_count=attempt_count+1 WHERE id=$1`, [job.id, workerId]);
    await client.query(`UPDATE knowledge.extraction_runs SET status='RUNNING',started_at=COALESCE(started_at,now()),heartbeat_at=now(),worker_id=$2 WHERE id=$1`, [job.run_id, workerId]);
    await client.query(`UPDATE knowledge.localities SET ingestion_status='PROCESSING' WHERE id=$1`, [job.locality_id]);
    return job;
  });
}

async function completeJob(job, counts) {
  await withTransaction(async (client) => {
    await client.query(`UPDATE knowledge.ingestion_jobs SET status='COMPLETED',finished_at=now(),locked_at=NULL,locked_by=NULL WHERE id=$1`, [job.id]);
    await client.query(`UPDATE knowledge.extraction_runs SET processed_localities=processed_localities+1,cursor_locality_id=$2,heartbeat_at=now() WHERE id=$1`, [job.run_id, job.locality_id]);
    const remaining = await client.query(`SELECT count(*)::int n FROM knowledge.ingestion_jobs WHERE run_id=$1 AND status IN ('QUEUED','RUNNING','RETRY')`, [job.run_id]);
    if (!remaining.rows[0].n) await client.query(`UPDATE knowledge.extraction_runs SET status='COMPLETED',finished_at=now(),heartbeat_at=now() WHERE id=$1`, [job.run_id]);
  });
  logger.info({ jobId: job.id, locality: job.name, ...counts }, 'Evidence ingestion locality completed');
}

async function failJob(job, error) {
  const attempt = Number(job.attempt_count) + 1;
  const retry = attempt < job.max_attempts;
  const delaySeconds = Math.min(3600, 30 * (2 ** Math.max(0, attempt - 1)));
  await withTransaction(async (client) => {
    await client.query(`UPDATE knowledge.ingestion_jobs SET status=$2,last_error=$3,available_at=now()+($4||' seconds')::interval,locked_at=NULL,locked_by=NULL,finished_at=CASE WHEN $2='FAILED' THEN now() ELSE NULL END WHERE id=$1`, [job.id, retry ? 'RETRY' : 'FAILED', String(error.message || error).slice(0, 2000), delaySeconds]);
    await client.query(`UPDATE knowledge.extraction_runs SET failures=failures+1,heartbeat_at=now(),error_message=$2 WHERE id=$1`, [job.run_id, String(error.message || error).slice(0, 2000)]);
    await client.query(`UPDATE knowledge.localities SET ingestion_status=$2 WHERE id=$1`, [job.locality_id, retry ? 'QUEUED' : 'FAILED']);
    await client.query(`INSERT INTO knowledge.review_queue(entity_type,entity_id,locality_id,reason,severity,payload) VALUES('INGESTION_JOB',$1,$2,'PROCESSING_FAILED','HIGH',$3) ON CONFLICT (entity_type, entity_id, reason) DO UPDATE SET payload=EXCLUDED.payload,created_at=now()`, [String(job.id), job.locality_id, JSON.stringify({ error: error.message, attempt })]);
  });
  logger.warn({ jobId: job.id, err: error, retry, delaySeconds }, 'Evidence ingestion locality failed');
}

export async function workOnce() {
  if (busy) return false;
  busy = true;
  try {
    const job = await claimJob();
    if (!job) return false;
    try {
      const result = await researchLocality({ locality: job.name, county: job.county, aliases: job.aliases, limit: 10, includeFullText: true });
      const counts = await persistResearchResult(job.locality_id, result, { runId: job.run_id });
      await completeJob(job, counts);
    } catch (error) { await failJob(job, error); }
    return true;
  } finally { busy = false; }
}

export function startEvidenceWorker({ pollMs = 5000 } = {}) {
  if (timer) return;
  timer = setInterval(() => workOnce().catch((error) => logger.error({ err: error }, 'Evidence worker tick failed')), pollMs);
  timer.unref();
  logger.info({ workerId, pollMs, concurrency: 1 }, 'Conservative evidence ingestion worker started');
}

export function stopEvidenceWorker() { if (timer) clearInterval(timer); timer = null; }

export async function setRunStatus(id, status) {
  if (!['PAUSED','RUNNING','CANCELLED'].includes(status)) throw new Error('Invalid run status');
  const { rows } = await pool.query(`UPDATE knowledge.extraction_runs SET status=$2,heartbeat_at=now(),finished_at=CASE WHEN $2 IN ('CANCELLED') THEN now() ELSE finished_at END WHERE id=$1 RETURNING *`, [id, status]);
  if (status === 'CANCELLED') await pool.query(`UPDATE knowledge.ingestion_jobs SET status='CANCELLED',finished_at=now() WHERE run_id=$1 AND status IN ('QUEUED','RETRY')`, [id]);
  return rows[0] || null;
}

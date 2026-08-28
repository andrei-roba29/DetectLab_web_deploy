import crypto from 'node:crypto';
import { pool, withTransaction } from '../../config/db.js';
import { buildDossier } from './dossier.js';

export const PIPELINE_VERSION = 'detectlab-evidence-2.0.0';
const normalize = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[șş]/gi, 's').replace(/[țţ]/gi, 't').toLowerCase().replace(/\s+/g, ' ').trim();
const hash = (v) => crypto.createHash('sha256').update(String(v || '')).digest('hex');

async function upsertDocument(client, source) {
  const metadataHash = hash(JSON.stringify({ title: source.title, authors: source.authors, year: source.year, publication: source.publication, volume: source.volume }));
  const values = [source.sourceId, source.title || 'Fără titlu', normalize(source.title), JSON.stringify(source.authors || []), source.publication, source.volume, source.year, metadataHash, PIPELINE_VERSION];
  let lookup = await client.query(`SELECT id FROM knowledge.documents WHERE provider_document_id=$1 OR metadata_hash=$2 LIMIT 1`, [source.sourceId, metadataHash]);
  let document = lookup.rows[0];
  if (document) {
    await client.query(`UPDATE knowledge.documents SET title=$2,normalized_title=$3,authors=$4,publication=$5,volume=$6,publication_year=$7,processing_status='PROCESSED',last_processed_at=now(),pipeline_version=$9 WHERE id=$10`, [...values, document.id]);
  } else {
    const inserted = await client.query(`INSERT INTO knowledge.documents(provider_document_id,title,normalized_title,authors,publication,volume,publication_year,metadata_hash,processing_status,last_processed_at,pipeline_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PROCESSED',now(),$9) ON CONFLICT DO NOTHING RETURNING id`, values);
    document = inserted.rows[0];
    if (!document) document = (await client.query(`SELECT id FROM knowledge.documents WHERE provider_document_id=$1 OR metadata_hash=$2 LIMIT 1`, [source.sourceId, metadataHash])).rows[0];
  }
  await client.query(`INSERT INTO knowledge.document_sources(document_id,catalog_url,document_url,source_identifier,last_accessed_at)
    VALUES($1,$2,$3,$4,now()) ON CONFLICT DO NOTHING`,
    [document.id, source.url, source.pdfUrl, source.sourceId]);
  return document.id;
}

async function pageId(client, documentId, item) {
  if (!item.pdfPage) return null;
  const { rows: [page] } = await client.query(`INSERT INTO knowledge.document_pages(document_id,pdf_page,printed_page,text_checksum,character_count,extraction_method,ocr_status)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(document_id,pdf_page) DO UPDATE SET printed_page=COALESCE(EXCLUDED.printed_page,knowledge.document_pages.printed_page),text_checksum=COALESCE(EXCLUDED.text_checksum,knowledge.document_pages.text_checksum),character_count=GREATEST(COALESCE(EXCLUDED.character_count,0),COALESCE(knowledge.document_pages.character_count,0)),extraction_method=COALESCE(EXCLUDED.extraction_method,knowledge.document_pages.extraction_method) RETURNING id`,
    [documentId, item.pdfPage, item.printedPage, item.pageTextChecksum || (item.excerpt ? hash(item.excerpt) : null), item.pageCharacterCount || item.excerpt?.length || null, item.extractionMethod, item.extractionMethod === 'OCR' ? 'COMPLETED' : 'NOT_REQUIRED']);
  return page.id;
}

export async function persistResearchResult(localityId, result, { runId = null } = {}) {
  return withTransaction(async (client) => {
    let claimsCreated = 0, evidenceCreated = 0;
    for (const claim of result.archaeologicalInformation || []) {
      const source = claim.source;
      if (!source?.url?.startsWith('https://biblioteca-digitala.ro/')) continue;
      const documentId = await upsertDocument(client, source);
      const location = claim.locations?.[0] || {};
      const normalizedClaim = normalize(claim.claim);
      const fingerprint = hash(`${localityId}|${claim.category}|${normalizedClaim}`);
      const categoryResult = await client.query('SELECT id FROM knowledge.archaeological_categories WHERE code=$1', [claim.category]);
      const { rows: [storedClaim] } = await client.query(`INSERT INTO knowledge.archaeological_claims(locality_id,category_id,claim_text,normalized_claim,claim_fingerprint,status,extraction_confidence,locality_confidence,role_confidence,pipeline_version)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(locality_id,claim_fingerprint) DO UPDATE SET extraction_confidence=GREATEST(knowledge.archaeological_claims.extraction_confidence,EXCLUDED.extraction_confidence),updated_at=now() RETURNING id,(xmax=0) AS inserted`,
        [localityId, categoryResult.rows[0]?.id || null, claim.claim, normalizedClaim, fingerprint, claim.fullyVerified ? 'VERIFIED' : 'NEEDS_REVIEW', claim.confidence || 0, location.confidence || 0, location.confidence || 0, PIPELINE_VERSION]);
      if (storedClaim.inserted) claimsCreated++;
      for (const period of claim.periods || []) {
        await client.query(`INSERT INTO knowledge.claim_periods(claim_id,period_id,confidence) SELECT $1,id,$3 FROM knowledge.periods WHERE label_ro=$2 ON CONFLICT DO NOTHING`, [storedClaim.id, period, claim.confidence || 0]);
      }
      for (const item of claim.evidence || []) {
        const storedPageId = await pageId(client, documentId, item);
        const resultInsert = await client.query(`INSERT INTO knowledge.evidence(claim_id,document_id,page_id,excerpt,excerpt_hash,context_excerpt,extraction_method,confidence,source_url,pipeline_version)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING id`,
          [storedClaim.id, documentId, storedPageId, item.excerpt, hash(item.excerpt), item.contextWindow, item.extractionMethod, item.confidence || 0, item.sourceUrl, PIPELINE_VERSION]);
        evidenceCreated += resultInsert.rowCount;
        await client.query(`INSERT INTO knowledge.locality_mentions(locality_id,document_id,page_id,original_text,context_excerpt,role,confidence) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [localityId, documentId, storedPageId, location.originalName || result.locality.currentName, item.contextWindow, location.role || 'UNKNOWN', location.confidence || 0]);
      }
      for (const figure of claim.images || []) {
        const figurePage = figure.pdfPage ? await pageId(client, documentId, { pdfPage: figure.pdfPage, printedPage: figure.printedPage, excerpt: null, extractionMethod: 'PDF_TEXT' }) : null;
        await client.query(`INSERT INTO knowledge.figures(document_id,page_id,claim_id,figure_number,caption,figure_type,relevance_confidence,source_url,republication_allowed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
          [documentId, figurePage, storedClaim.id, figure.figureNumber, figure.caption, figure.type, figure.confidence, source.pdfUrl || source.url, figure.imageRepublicationAllowed || false]);
      }
      if ((claim.confidence || 0) < .5 || !claim.fullyVerified) await client.query(`INSERT INTO knowledge.review_queue(entity_type,entity_id,locality_id,document_id,reason,severity,payload) VALUES('CLAIM',$1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [storedClaim.id, localityId, documentId, !claim.fullyVerified ? 'NOT_FULLY_VERIFIED' : 'LOW_CONFIDENCE', (claim.confidence || 0) < .2 ? 'HIGH' : 'MEDIUM', JSON.stringify({ claim: claim.claim, confidence: claim.confidence })]);
    }
    for (const document of result.documents || []) {
      if (['OCR_REQUIRED','OCR_FAILED','PDF_EXTRACTION_FAILED'].includes(document.extractionStatus)) {
        const documentId = await upsertDocument(client, { sourceId: document.documentId, title: document.title, authors: document.authors, year: document.year, publication: document.publication, volume: document.volume, url: document.url, pdfUrl: document.pdfUrl });
        await client.query(`UPDATE knowledge.documents SET processing_status=$2 WHERE id=$1`, [documentId, document.extractionStatus === 'PDF_EXTRACTION_FAILED' ? 'FAILED' : document.extractionStatus]);
        await client.query(`INSERT INTO knowledge.review_queue(entity_type,entity_id,locality_id,document_id,reason,severity,payload) VALUES('DOCUMENT',$1,$2,$1,$3,'MEDIUM','{}') ON CONFLICT DO NOTHING`, [documentId, localityId, document.extractionStatus]);
      }
    }
    for (const failure of result.failures || []) {
      const failureId = hash(JSON.stringify(failure.candidate || failure)).slice(0, 32);
      await client.query(`INSERT INTO knowledge.review_queue(entity_type,entity_id,locality_id,reason,severity,payload) VALUES('SOURCE_FAILURE',$1,$2,'DISCOVERY_OR_ACCESS_FAILED','HIGH',$3) ON CONFLICT DO UPDATE SET payload=EXCLUDED.payload,created_at=now()`, [failureId, localityId, JSON.stringify(failure)]);
    }
    // A run that hit its time budget (or lost documents on the way) is never
    // marked PROCESSED: it stays eligible for the next search, which resumes the
    // research and merges into the same idempotent records. A complete locality
    // is not re-crawled for 30 days; an incomplete one is retried the same day,
    // so a rate-limited source can never freeze a locality into a permanently
    // partial dossier.
    const incomplete = Boolean(result.failures?.length || result.truncated);
    await client.query(`UPDATE knowledge.localities SET ingestion_status=$2,last_ingested_at=now(),next_check_at=now()+($3::interval),updated_at=now() WHERE id=$1`, [localityId, incomplete ? 'PARTIAL' : 'PROCESSED', incomplete ? '6 hours' : '30 days']);
    if (runId) await client.query(`UPDATE knowledge.extraction_runs SET documents_discovered=documents_discovered+$2,documents_processed=documents_processed+$3,claims_created=claims_created+$4,evidence_created=evidence_created+$5,failures=failures+$6,heartbeat_at=now() WHERE id=$1`, [runId, result.candidateCount || 0, result.documentCount || 0, claimsCreated, evidenceCreated, result.failures?.length || 0]);
    return { claimsCreated, evidenceCreated, documentsDiscovered: result.candidateCount || 0, documentsProcessed: result.documentCount || 0 };
  });
}

/**
 * Locality identification (§1) — the very first query of every evidence
 * search, so it must be valid SQL for PostgreSQL.
 *
 * It used to be `SELECT DISTINCT l.* … ORDER BY CASE WHEN … END`, which
 * PostgreSQL rejects outright (`0A000 feature_not_supported: for SELECT
 * DISTINCT, ORDER BY expressions must appear in select list`). The route
 * mapped nothing of it, so every search died as a bare HTTP 500 before the
 * publication source was even contacted.
 *
 * The exact-name preference is therefore projected as `exact_match` *inside*
 * the DISTINCT subselect, and the ordering happens in the outer query over
 * plain columns. The alias LEFT JOIN can still fan a locality out over several
 * rows; DISTINCT over (locality row, exact_match) collapses them again because
 * `exact_match` is functionally determined by the row (localities.id is the PK).
 */
export function localityLookupQuery(name, county = null) {
  const params = [normalize(name)];
  let countyClause = '';
  if (county) { params.push(String(county).trim()); countyClause = `AND lower(l.county)=lower($2)`; }
  const sql = `SELECT * FROM (
  SELECT DISTINCT l.*, (l.normalized_name=$1) AS exact_match
  FROM knowledge.localities l
  LEFT JOIN knowledge.locality_aliases a ON a.locality_id=l.id
  WHERE (l.normalized_name=$1 OR a.normalized_alias=$1) ${countyClause}
) m ORDER BY m.exact_match DESC, m.id LIMIT 2`;
  return { sql, params };
}

export async function findLocality(name, county = null) {
  const { sql, params } = localityLookupQuery(name, county);
  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function getPersistentBundle(id) {
  const locality = await getLocality(id);
  if (!locality) return null;
  const claims = await getLocalityArchaeology(id);
  const evidenceRows = await getLocalityEvidence(id);
  const documents = await getLocalityDocuments(id);
  const sites = await getLocalitySites(id);
  const evidenceByClaim = new Map();
  evidenceRows.forEach((item) => { const list = evidenceByClaim.get(item.claim_id) || []; list.push({ id:item.id,excerpt:item.excerpt,contextWindow:item.context_excerpt,printedPage:item.printed_page,pdfPage:item.pdf_page,sourceUrl:item.source_url,extractionMethod:item.extraction_method,confidence:Number(item.confidence) }); evidenceByClaim.set(item.claim_id,list); });
  const bundle = { schemaVersion:'2.0',storage:'PERSISTENT_POSTGRESQL',locality:{ id:locality.id,currentName:locality.name,county:locality.county,siruta:locality.siruta_code,aliases:(locality.aliases||[]).map((a)=>a.alias),coordinates:locality.latitude&&locality.longitude?{lat:locality.latitude,lng:locality.longitude}:null,ingestionStatus:locality.ingestion_status,lastIngestedAt:locality.last_ingested_at },sourcePolicy:{exclusiveProvider:'https://biblioteca-digitala.ro/',pdfsPermanentlyStored:false},archaeologicalInformation:claims.map((claim)=>({id:claim.id,claim:claim.claim,category:claim.category,periods:claim.periods,status:claim.status,confidence:Number(claim.extraction_confidence),confidenceLevel:Number(claim.extraction_confidence)>=.8?'HIGH':Number(claim.extraction_confidence)>=.5?'MEDIUM':'LOW',evidence:evidenceByClaim.get(claim.id)||[],source:(()=>{const e=evidenceRows.find((x)=>x.claim_id===claim.id);return e?{title:e.title,authors:e.authors,year:e.publication_year,publication:e.publication,url:e.catalog_url,pdfUrl:e.document_url}:{};})(),locations:[{name:locality.name,role:'ARCHAEOLOGICAL_TARGET',confidence:Number(claim.role_confidence),attributionReason:'Stored contextual classification; inspect linked evidence records for audit.'}],images:[],fullyVerified:claim.status==='VERIFIED',conflictingSources:claim.conflicting_sources})),documents,audit:{verifiedClaims:claims.filter((c)=>c.status==='VERIFIED').length,claims:claims.length,evidence:evidenceRows.length} };
  // Complete historical dossier (specification: data/dossier-spec/*.md) —
  // deterministic assembly from SIRUTA identity + verified claims only.
  bundle.dossier = buildDossier(locality, bundle, { sites });
  return bundle;
}

export async function getLocalitySites(id) {
  try {
    const { rows } = await pool.query(`SELECT * FROM knowledge.archaeological_sites WHERE locality_id=$1 ORDER BY created_at`, [id]);
    return rows;
  } catch (_) {
    // Older deployments may not have the table yet — the dossier then simply
    // reports no stored sites (anti-hallucination: never fabricate entries).
    return [];
  }
}

export async function getDossier(id) {
  const bundle = await getPersistentBundle(id);
  return bundle ? bundle.dossier : null;
}

export async function getLocality(id) {
  const { rows } = await pool.query(`SELECT l.*,COALESCE(json_agg(json_build_object('alias',a.alias,'type',a.alias_type,'language',a.language,'verified',a.verified)) FILTER(WHERE a.id IS NOT NULL),'[]') aliases FROM knowledge.localities l LEFT JOIN knowledge.locality_aliases a ON a.locality_id=l.id WHERE l.id=$1 GROUP BY l.id`, [id]);
  return rows[0] || null;
}

export async function getLocalityArchaeology(id) {
  const { rows } = await pool.query(`SELECT c.id,c.claim_text AS claim,c.status,c.extraction_confidence,c.locality_confidence,c.role_confidence,c.conflicting_sources,cat.code AS category,COALESCE(json_agg(DISTINCT p.label_ro) FILTER(WHERE p.id IS NOT NULL),'[]') periods,COUNT(DISTINCT e.id)::int evidence_count FROM knowledge.archaeological_claims c LEFT JOIN knowledge.archaeological_categories cat ON cat.id=c.category_id LEFT JOIN knowledge.claim_periods cp ON cp.claim_id=c.id LEFT JOIN knowledge.periods p ON p.id=cp.period_id LEFT JOIN knowledge.evidence e ON e.claim_id=c.id WHERE c.locality_id=$1 GROUP BY c.id,cat.code ORDER BY c.extraction_confidence DESC,c.created_at DESC`, [id]);
  return rows;
}

export async function getLocalityEvidence(id) {
  const { rows } = await pool.query(`SELECT e.id,e.claim_id,e.excerpt,e.context_excerpt,e.extraction_method,e.confidence,e.source_url,e.extracted_at,dp.pdf_page,dp.printed_page,d.title,d.authors,d.publication,d.publication_year,ds.catalog_url,ds.document_url FROM knowledge.evidence e JOIN knowledge.archaeological_claims c ON c.id=e.claim_id JOIN knowledge.documents d ON d.id=e.document_id LEFT JOIN knowledge.document_pages dp ON dp.id=e.page_id JOIN knowledge.document_sources ds ON ds.document_id=d.id AND ds.is_canonical WHERE c.locality_id=$1 ORDER BY e.confidence DESC`, [id]);
  return rows;
}

export async function getLocalityDocuments(id) {
  const { rows } = await pool.query(`SELECT DISTINCT d.*,ds.catalog_url,ds.document_url FROM knowledge.documents d JOIN knowledge.document_sources ds ON ds.document_id=d.id JOIN knowledge.evidence e ON e.document_id=d.id JOIN knowledge.archaeological_claims c ON c.id=e.claim_id WHERE c.locality_id=$1 ORDER BY d.publication_year DESC NULLS LAST`, [id]);
  return rows;
}

export async function getClaim(id) {
  const { rows } = await pool.query(`SELECT c.*,cat.code category,l.name locality,COALESCE(json_agg(json_build_object('id',e.id,'excerpt',e.excerpt,'pdfPage',dp.pdf_page,'printedPage',dp.printed_page,'confidence',e.confidence,'sourceUrl',e.source_url,'document',d.title)) FILTER(WHERE e.id IS NOT NULL),'[]') evidence FROM knowledge.archaeological_claims c JOIN knowledge.localities l ON l.id=c.locality_id LEFT JOIN knowledge.archaeological_categories cat ON cat.id=c.category_id LEFT JOIN knowledge.evidence e ON e.claim_id=c.id LEFT JOIN knowledge.document_pages dp ON dp.id=e.page_id LEFT JOIN knowledge.documents d ON d.id=e.document_id WHERE c.id=$1 GROUP BY c.id,cat.code,l.name`, [id]); return rows[0] || null;
}

export async function getEvidence(id) { const { rows } = await pool.query(`SELECT e.*,dp.pdf_page,dp.printed_page,d.title,d.authors,d.publication,d.publication_year,ds.catalog_url,ds.document_url FROM knowledge.evidence e JOIN knowledge.documents d ON d.id=e.document_id LEFT JOIN knowledge.document_pages dp ON dp.id=e.page_id JOIN knowledge.document_sources ds ON ds.document_id=d.id AND ds.is_canonical WHERE e.id=$1`, [id]); return rows[0] || null; }

-- DetectLab persistent National Archaeological Knowledge Database.
-- Source PDFs are NEVER stored. Only source URLs, metadata, bounded excerpts,
-- page checksums and extraction/provenance records are persisted.
CREATE SCHEMA IF NOT EXISTS knowledge;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS knowledge.localities (
  id BIGSERIAL PRIMARY KEY,
  siruta_code TEXT UNIQUE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  county_code TEXT,
  county TEXT NOT NULL,
  parent_siruta_code TEXT,
  uat_name TEXT,
  locality_type TEXT,
  level SMALLINT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  source_name TEXT NOT NULL DEFAULT 'INS SIRUTA',
  source_version TEXT,
  source_url TEXT,
  pilot BOOLEAN NOT NULL DEFAULT FALSE,
  ingestion_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (ingestion_status IN ('PENDING','QUEUED','PROCESSING','PROCESSED','PARTIAL','FAILED')),
  last_ingested_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS localities_normalized_idx ON knowledge.localities(normalized_name);
CREATE INDEX IF NOT EXISTS localities_progress_idx ON knowledge.localities(ingestion_status, county);

CREATE TABLE IF NOT EXISTS knowledge.locality_aliases (
  id BIGSERIAL PRIMARY KEY,
  locality_id BIGINT NOT NULL REFERENCES knowledge.localities(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  language TEXT,
  alias_type TEXT NOT NULL DEFAULT 'VARIANT' CHECK (alias_type IN ('CURRENT','HISTORICAL','HUNGARIAN','GERMAN','LATIN','SLAVIC','ORTHOGRAPHIC','ADMINISTRATIVE','VARIANT')),
  source TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(locality_id, normalized_alias)
);
CREATE INDEX IF NOT EXISTS locality_alias_lookup_idx ON knowledge.locality_aliases(normalized_alias);

CREATE TABLE IF NOT EXISTS knowledge.documents (
  id BIGSERIAL PRIMARY KEY,
  provider_document_id TEXT,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  authors JSONB NOT NULL DEFAULT '[]',
  publication TEXT,
  volume TEXT,
  issue TEXT,
  publication_year INT,
  pagination TEXT,
  language TEXT,
  abstract TEXT,
  descriptors JSONB NOT NULL DEFAULT '[]',
  doi TEXT,
  content_hash TEXT,
  metadata_hash TEXT UNIQUE,
  processing_status TEXT NOT NULL DEFAULT 'DISCOVERED' CHECK (processing_status IN ('DISCOVERED','METADATA_READY','QUEUED','PROCESSING','PDF_TEXT','OCR_REQUIRED','OCR_COMPLETED','OCR_FAILED','ACCESS_FAILED','UNAVAILABLE','MALFORMED','UNSUPPORTED','PROCESSED','FAILED')),
  first_discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_processed_at TIMESTAMPTZ,
  pipeline_version TEXT,
  UNIQUE(provider_document_id),
  UNIQUE(content_hash)
);
CREATE INDEX IF NOT EXISTS documents_status_idx ON knowledge.documents(processing_status);
CREATE INDEX IF NOT EXISTS documents_identity_idx ON knowledge.documents(normalized_title, publication_year);

CREATE TABLE IF NOT EXISTS knowledge.document_sources (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'Biblioteca Digitală / ProEuropeana',
  catalog_url TEXT NOT NULL,
  document_url TEXT,
  source_identifier TEXT,
  is_canonical BOOLEAN NOT NULL DEFAULT TRUE,
  access_status TEXT NOT NULL DEFAULT 'AVAILABLE',
  last_accessed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  CHECK (catalog_url LIKE 'https://biblioteca-digitala.ro/%'),
  CHECK (document_url IS NULL OR document_url LIKE 'https://biblioteca-digitala.ro/%'),
  UNIQUE(catalog_url)
);

CREATE TABLE IF NOT EXISTS knowledge.document_pages (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
  pdf_page INT NOT NULL CHECK (pdf_page > 0),
  printed_page TEXT,
  text_checksum TEXT,
  character_count INT,
  extraction_method TEXT CHECK (extraction_method IN ('PDF_TEXT','OCR','HTML','ABSTRACT','METADATA')),
  ocr_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (ocr_status IN ('NOT_REQUIRED','REQUIRED','QUEUED','COMPLETED','FAILED')),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(document_id, pdf_page)
);

CREATE TABLE IF NOT EXISTS knowledge.archaeological_categories (
  id SMALLSERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, label_ro TEXT NOT NULL, parent_id SMALLINT REFERENCES knowledge.archaeological_categories(id)
);
CREATE TABLE IF NOT EXISTS knowledge.periods (
  id SMALLSERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, label_ro TEXT NOT NULL, start_year INT, end_year INT
);

CREATE TABLE IF NOT EXISTS knowledge.archaeological_sites (
  id BIGSERIAL PRIMARY KEY,
  locality_id BIGINT NOT NULL REFERENCES knowledge.localities(id),
  name TEXT,
  normalized_name TEXT,
  site_type TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  location_precision TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(locality_id, normalized_name, site_type)
);

CREATE TABLE IF NOT EXISTS knowledge.archaeological_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locality_id BIGINT NOT NULL REFERENCES knowledge.localities(id),
  site_id BIGINT REFERENCES knowledge.archaeological_sites(id),
  category_id SMALLINT REFERENCES knowledge.archaeological_categories(id),
  claim_text TEXT NOT NULL,
  normalized_claim TEXT NOT NULL,
  claim_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'EXTRACTED' CHECK (status IN ('EXTRACTED','VERIFIED','DISPUTED','REJECTED','NEEDS_REVIEW')),
  extraction_confidence NUMERIC(4,3) NOT NULL CHECK (extraction_confidence BETWEEN 0 AND 1),
  locality_confidence NUMERIC(4,3) NOT NULL CHECK (locality_confidence BETWEEN 0 AND 1),
  role_confidence NUMERIC(4,3) NOT NULL CHECK (role_confidence BETWEEN 0 AND 1),
  conflicting_sources BOOLEAN NOT NULL DEFAULT FALSE,
  pipeline_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(locality_id, claim_fingerprint)
);
CREATE INDEX IF NOT EXISTS claims_locality_idx ON knowledge.archaeological_claims(locality_id, status);

CREATE TABLE IF NOT EXISTS knowledge.claim_periods (
  claim_id UUID REFERENCES knowledge.archaeological_claims(id) ON DELETE CASCADE,
  period_id SMALLINT REFERENCES knowledge.periods(id),
  confidence NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
  PRIMARY KEY(claim_id, period_id)
);

CREATE TABLE IF NOT EXISTS knowledge.evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES knowledge.archaeological_claims(id) ON DELETE CASCADE,
  document_id BIGINT NOT NULL REFERENCES knowledge.documents(id),
  page_id BIGINT REFERENCES knowledge.document_pages(id),
  excerpt TEXT NOT NULL CHECK (length(excerpt) BETWEEN 1 AND 2000),
  excerpt_hash TEXT NOT NULL,
  context_excerpt TEXT CHECK (length(context_excerpt) <= 3000),
  extraction_method TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source_url TEXT NOT NULL CHECK (source_url LIKE 'https://biblioteca-digitala.ro/%'),
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pipeline_version TEXT NOT NULL,
  UNIQUE(claim_id, document_id, page_id, excerpt_hash)
);
CREATE INDEX IF NOT EXISTS evidence_document_idx ON knowledge.evidence(document_id);
CREATE UNIQUE INDEX IF NOT EXISTS evidence_dedupe_idx ON knowledge.evidence(claim_id,document_id,COALESCE(page_id,0),excerpt_hash);

CREATE TABLE IF NOT EXISTS knowledge.locality_mentions (
  id BIGSERIAL PRIMARY KEY,
  locality_id BIGINT NOT NULL REFERENCES knowledge.localities(id),
  document_id BIGINT NOT NULL REFERENCES knowledge.documents(id),
  page_id BIGINT REFERENCES knowledge.document_pages(id),
  original_text TEXT NOT NULL,
  context_excerpt TEXT,
  role TEXT NOT NULL CHECK (role IN ('ARCHAEOLOGICAL_TARGET','FINDSPOT','EXCAVATION_LOCATION','SURVEY_LOCATION','HISTORICAL_LOCATION','ARCHAEOLOGICAL_CONTEXT','INSTITUTION','MUSEUM_LOCATION','COLLECTION_LOCATION','EXHIBITION_LOCATION','AUTHOR_AFFILIATION','PUBLICATION_LOCATION','BIBLIOGRAPHIC_REFERENCE','INCIDENTAL_MENTION','UNKNOWN')),
  confidence NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(locality_id,document_id,page_id,role,original_text)
);

CREATE TABLE IF NOT EXISTS knowledge.findspots (
  id BIGSERIAL PRIMARY KEY,
  claim_id UUID NOT NULL REFERENCES knowledge.archaeological_claims(id) ON DELETE CASCADE,
  locality_id BIGINT NOT NULL REFERENCES knowledge.localities(id),
  artifact_type TEXT,
  description TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  location_precision TEXT,
  UNIQUE(claim_id, locality_id)
);

CREATE TABLE IF NOT EXISTS knowledge.figures (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES knowledge.documents(id),
  page_id BIGINT REFERENCES knowledge.document_pages(id),
  claim_id UUID REFERENCES knowledge.archaeological_claims(id),
  figure_number TEXT,
  caption TEXT,
  figure_type TEXT,
  relevance_confidence NUMERIC(4,3) CHECK (relevance_confidence BETWEEN 0 AND 1),
  source_url TEXT NOT NULL CHECK (source_url LIKE 'https://biblioteca-digitala.ro/%'),
  image_copied BOOLEAN NOT NULL DEFAULT FALSE CHECK (image_copied = FALSE),
  republication_allowed BOOLEAN,
  copyright_metadata JSONB NOT NULL DEFAULT '{}',
  UNIQUE(document_id,page_id,claim_id,figure_number,caption)
);

CREATE TABLE IF NOT EXISTS knowledge.citations (
  id BIGSERIAL PRIMARY KEY,
  citing_document_id BIGINT NOT NULL REFERENCES knowledge.documents(id),
  cited_document_id BIGINT REFERENCES knowledge.documents(id),
  citation_text TEXT NOT NULL,
  page_id BIGINT REFERENCES knowledge.document_pages(id),
  confidence NUMERIC(4,3),
  UNIQUE(citing_document_id, cited_document_id, citation_text)
);
CREATE TABLE IF NOT EXISTS knowledge.contradictions (
  id BIGSERIAL PRIMARY KEY,
  claim_a_id UUID NOT NULL REFERENCES knowledge.archaeological_claims(id),
  claim_b_id UUID NOT NULL REFERENCES knowledge.archaeological_claims(id),
  contradiction_type TEXT,
  explanation TEXT,
  confidence NUMERIC(4,3),
  status TEXT NOT NULL DEFAULT 'POTENTIAL',
  reviewed_at TIMESTAMPTZ,
  UNIQUE(claim_a_id, claim_b_id)
);

CREATE TABLE IF NOT EXISTS knowledge.extraction_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type TEXT NOT NULL CHECK (run_type IN ('LOCALITY','PILOT','NATIONAL','INCREMENTAL','REPROCESS')),
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','PAUSED','COMPLETED','FAILED','CANCELLED')),
  scope JSONB NOT NULL DEFAULT '{}',
  cursor_locality_id BIGINT,
  total_localities INT NOT NULL DEFAULT 0,
  processed_localities INT NOT NULL DEFAULT 0,
  documents_discovered INT NOT NULL DEFAULT 0,
  documents_processed INT NOT NULL DEFAULT 0,
  claims_created INT NOT NULL DEFAULT 0,
  evidence_created INT NOT NULL DEFAULT 0,
  failures INT NOT NULL DEFAULT 0,
  worker_id TEXT,
  pipeline_version TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge.ingestion_jobs (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID REFERENCES knowledge.extraction_runs(id) ON DELETE CASCADE,
  locality_id BIGINT NOT NULL REFERENCES knowledge.localities(id),
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','RETRY','COMPLETED','PARTIAL','FAILED','CANCELLED')),
  priority INT NOT NULL DEFAULT 0,
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 4,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  UNIQUE(run_id, locality_id)
);
CREATE INDEX IF NOT EXISTS ingestion_jobs_claim_idx ON knowledge.ingestion_jobs(status, available_at, priority DESC);

CREATE TABLE IF NOT EXISTS knowledge.review_queue (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  locality_id BIGINT REFERENCES knowledge.localities(id),
  document_id BIGINT REFERENCES knowledge.documents(id),
  reason TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW','MEDIUM','HIGH')),
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_REVIEW','RESOLVED','REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE(entity_type, entity_id, reason)
);

INSERT INTO knowledge.archaeological_categories(code,label_ro) VALUES
 ('NECROPOLIS','Necropolă'),('BURIAL','Mormânt / context funerar'),('SETTLEMENT','Așezare'),('FORTIFICATION','Fortificație'),('HOARD','Tezaur'),('COIN_FIND','Descoperire monetară'),('ARTEFACT','Artefact'),('SURVEY','Cercetare de suprafață'),('EXCAVATION','Săpătură'),('ARCHAEOLOGICAL_SITE','Sit arheologic'),('OTHER_ARCHAEOLOGICAL_EVIDENCE','Altă evidență arheologică') ON CONFLICT DO NOTHING;
INSERT INTO knowledge.periods(code,label_ro) VALUES
 ('PREHISTORY','Preistorie'),('BRONZE_AGE','Epoca bronzului'),('HALLSTATT','Hallstatt'),('LA_TENE','La Tène'),('DACIAN_GETIC','Dacic / getic'),('ROMAN','Roman'),('MEDIEVAL','Medieval') ON CONFLICT DO NOTHING;

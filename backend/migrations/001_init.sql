-- =====================================================================
-- DetectLab: archaeological sites mirror
--
-- Design: two physical tables (_a / _b) act as a double buffer. A view
-- ("archaeological_sites") always points at whichever one is currently
-- "live". Nightly sync writes into the OFFLINE table, indexes it, then
-- atomically repoints the view. Readers (the Express API) only ever
-- query the view and never see a partial/mid-import state.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---- Physical buffer tables -----------------------------------------
CREATE TABLE IF NOT EXISTS archaeological_sites_a (
  object_id     BIGINT PRIMARY KEY,       -- ArcGIS OBJECTID, stable identifier
  attributes    JSONB NOT NULL,            -- raw ArcGIS attribute payload
  geom          geometry(Geometry, 4326) NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS archaeological_sites_b (
  LIKE archaeological_sites_a INCLUDING ALL
);

-- ---- Indirection view: the ONLY table the app ever queries ----------
CREATE OR REPLACE VIEW archaeological_sites AS
  SELECT * FROM archaeological_sites_a;

-- ---- Tracks which physical table is currently live -------------------
CREATE TABLE IF NOT EXISTS sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO sync_state (key, value)
VALUES ('active_table', 'archaeological_sites_a')
ON CONFLICT (key) DO NOTHING;

-- ---- Audit trail / observability for every sync attempt --------------
CREATE TABLE IF NOT EXISTS sync_runs (
  id                 SERIAL PRIMARY KEY,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'running', -- running | success | partial | failed
  target_table       TEXT,                             -- which buffer table was written this run
  features_expected  INT,
  features_fetched   INT,
  duration_ms        INT,
  error_message      TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at ON sync_runs (started_at DESC);

-- Note: no spatial/GIN indexes created on the buffer tables here on
-- purpose — they're added AFTER each bulk load (see swap.js), since
-- indexing empty-then-filling tables is far slower than bulk-load-then-index.

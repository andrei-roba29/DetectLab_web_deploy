-- =====================================================================
-- DetectLab: CIMEC Clasate Archaeological Artifacts
--
-- Stores all ~21,761 classified mobile cultural goods from the
-- Arheologie domain of clasate.cimec.ro, enriched with approximate
-- coordinates derived from their finding places.
--
-- Data has been ingested by the scraper.
-- and served as GeoJSON by the Express API (/api/clasate/*).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---- Main artifacts table -------------------------------------------
CREATE TABLE IF NOT EXISTS clasate_artifacts (
  -- Unique identifier (MD5 hash key from clasate.cimec.ro)
  id              TEXT PRIMARY KEY,

  -- Core fields from the detail page
  name            TEXT NOT NULL,                   -- "Tip" field (e.g. "Castron", "Topor")
  description     TEXT,                            -- "Descriere" full text
  holder          TEXT,                            -- "Deținător" museum/institution
  domain          TEXT DEFAULT 'Arheologie',       -- "Domeniu"
  dating          TEXT,                            -- "Datare" (e.g. "Mil. V a. Chr.")
  period          TEXT,                            -- "Epoca/Perioada" (e.g. "Eneolitic")
  culture         TEXT,                            -- "Etnia/Cultura" (e.g. "Cucuteni")
  finding_place   TEXT,                            -- "Loc de descoperire" raw text
  material        TEXT,                            -- "Material/Tehnică (text)"
  inventory_nr    TEXT,                            -- "Nr. inventar"
  classification  TEXT,                            -- "Ordin de clasare" (e.g. "Fond" / "Tezaur")

  -- Listing-level metadata
  county_holder   TEXT,                            -- "Județ deținător" from listing
  category_type   TEXT,                            -- "Tip categorial" from listing
  specific_type   TEXT,                            -- "Tip specific / Titlu" from listing
  ordinal         INT,                             -- Position in the full listing

  -- Source URL for traceability
  detail_url      TEXT,                            -- Permanent link on clasate.cimec.ro

  -- Image URLs (first medium image from the detail page)
  image_url       TEXT,                            -- Medium-resolution image URL

  -- Geocoded approximate coordinates from finding_place
  geom            geometry(Point, 4326),           -- Approximate lat/lng from finding place
  geocode_method  TEXT,                            -- How coords were determined
  geocode_confidence TEXT,                         -- 'exact', 'locality', 'commune', 'county'

  -- Timestamps
  scraped_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_clasate_geom ON clasate_artifacts USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_clasate_period ON clasate_artifacts (period);
CREATE INDEX IF NOT EXISTS idx_clasate_culture ON clasate_artifacts (culture);
CREATE INDEX IF NOT EXISTS idx_clasate_county ON clasate_artifacts (county_holder);
CREATE INDEX IF NOT EXISTS idx_clasate_classification ON clasate_artifacts (classification);
CREATE INDEX IF NOT EXISTS idx_clasate_finding_place ON clasate_artifacts (finding_place);
CREATE INDEX IF NOT EXISTS idx_clasate_dating ON clasate_artifacts (dating);
CREATE INDEX IF NOT EXISTS idx_clasate_holder ON clasate_artifacts (holder);

-- A view that exposes only map-ready rows (those with valid coordinates)
CREATE OR REPLACE VIEW clasate_geojson_ready AS
  SELECT * FROM clasate_artifacts
  WHERE geom IS NOT NULL;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_clasate_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_clasate_updated ON clasate_artifacts;
CREATE TRIGGER trigger_clasate_updated
  BEFORE UPDATE ON clasate_artifacts
  FOR EACH ROW
  EXECUTE FUNCTION update_clasate_timestamp();

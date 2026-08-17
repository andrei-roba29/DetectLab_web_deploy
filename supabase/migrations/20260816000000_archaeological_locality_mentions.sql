-- Candidate mentions from historical corpus (repertorii + CCA)
-- Complements knowledge.locality_mentions (which is tied to knowledge.documents)
-- This table stores flat document_name/page mentions from the local D:\Babel corpus
-- without requiring a document_id / biblioteca-digitala.ro linkage.

CREATE TABLE IF NOT EXISTS knowledge.archaeological_locality_mentions (
    id BIGSERIAL PRIMARY KEY,

    document_name TEXT NOT NULL,
    page INTEGER NOT NULL,

    locality_id BIGINT
        REFERENCES knowledge.localities(id) ON DELETE SET NULL,

    siruta_code TEXT,
    locality_name TEXT,
    county TEXT,

    matched_text TEXT NOT NULL,
    normalized_match TEXT,

    -- alias type from knowledge.locality_aliases.alias_type or 'CURRENT' for primary name
    match_type TEXT,

    -- Source classification derived from filename: REPERTORY / CCA / OTHER_ARCHAEOLOGICAL_SOURCE
    source_type TEXT CHECK (source_type IN ('REPERTORY','CCA','OTHER_ARCHAEOLOGICAL_SOURCE')),

    -- Context around the mention (500-1500 chars total, sentence-aware when possible)
    context TEXT,
    context_before TEXT,
    context_after TEXT,

    -- Optional confidence (1.0 = exact normalized match, lower for fuzzy variants if added later)
    match_confidence NUMERIC CHECK (match_confidence BETWEEN 0 AND 1),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(document_name, page, locality_id, matched_text)
);

CREATE INDEX IF NOT EXISTS archaeological_locality_mentions_locality_idx
    ON knowledge.archaeological_locality_mentions(locality_id);
CREATE INDEX IF NOT EXISTS archaeological_locality_mentions_siruta_idx
    ON knowledge.archaeological_locality_mentions(siruta_code);
CREATE INDEX IF NOT EXISTS archaeological_locality_mentions_document_idx
    ON knowledge.archaeological_locality_mentions(document_name, page);
CREATE INDEX IF NOT EXISTS archaeological_locality_mentions_county_idx
    ON knowledge.archaeological_locality_mentions(county);
CREATE INDEX IF NOT EXISTS archaeological_locality_mentions_source_type_idx
    ON knowledge.archaeological_locality_mentions(source_type);

COMMENT ON TABLE knowledge.archaeological_locality_mentions IS
    'Candidate locality mentions extracted from D:\Babel corpus (repertorii + CCA). One row per match with document_name/page/context.';

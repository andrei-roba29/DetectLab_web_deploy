-- Extends the buffer tables to hold multiple ArcGIS layers (points AND
-- polygons) in one shared snapshot. OBJECTIDs are only unique WITHIN a
-- layer, not across layers, so the primary key becomes (layer_id, object_id).

ALTER TABLE archaeological_sites_a ADD COLUMN IF NOT EXISTS layer_id INT NOT NULL DEFAULT 0;
ALTER TABLE archaeological_sites_b ADD COLUMN IF NOT EXISTS layer_id INT NOT NULL DEFAULT 0;

ALTER TABLE archaeological_sites_a ADD COLUMN IF NOT EXISTS layer_name TEXT;
ALTER TABLE archaeological_sites_b ADD COLUMN IF NOT EXISTS layer_name TEXT;

ALTER TABLE archaeological_sites_a DROP CONSTRAINT IF EXISTS archaeological_sites_a_pkey;
ALTER TABLE archaeological_sites_b DROP CONSTRAINT IF EXISTS archaeological_sites_b_pkey;

ALTER TABLE archaeological_sites_a ADD PRIMARY KEY (layer_id, object_id);
ALTER TABLE archaeological_sites_b ADD PRIMARY KEY (layer_id, object_id);

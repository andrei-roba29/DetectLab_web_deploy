-- Some source features (e.g. certain site_boundaries polygons) have no
-- recorded geometry at all (empty rings). Rather than force bad source
-- data to fit, we store these rows with a NULL geometry.

ALTER TABLE archaeological_sites_a ALTER COLUMN geom DROP NOT NULL;
ALTER TABLE archaeological_sites_b ALTER COLUMN geom DROP NOT NULL;

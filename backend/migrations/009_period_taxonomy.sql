-- DetectLab Historical Dossier — align the epoch taxonomy with the
-- Archaeological Report (js/archeo-report.js PERIOD_RULES).
--
-- The dossier now classifies claims into the same epochs as the report
-- (Paleolitic, Mezolitic, Neolitic, Eneolitic, Epoca bronzului, Hallstatt,
-- Epoca fierului, Dacic / getic, Roman, Epoca migrațiilor, Medieval, Modern,
-- Preistorie, Antichitate). This seeds the extra `knowledge.periods` rows so
-- the report's taxonomy persists for claims/evidence.
--
-- Idempotent — safe to run multiple times / on already-migrated databases.

INSERT INTO knowledge.periods(code, label_ro) VALUES
 ('PALEOLITHIC', 'Paleolitic'),
 ('MESOLITHIC', 'Mezolitic'),
 ('NEOLITHIC', 'Neolitic'),
 ('ENEOLITHIC', 'Eneolitic'),
 ('IRON_AGE', 'Epoca fierului'),
 ('MIGRATION', 'Epoca migrațiilor'),
 ('MODERN', 'Modern'),
 ('ANTIQUITY', 'Antichitate')
ON CONFLICT DO NOTHING;

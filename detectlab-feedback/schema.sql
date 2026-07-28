-- DetectLab feedback schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS feedback (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  vote          TEXT NOT NULL CHECK (vote IN ('up','down')),
  class         TEXT NOT NULL,
  confidence    REAL,
  lat_north     REAL NOT NULL,
  lat_south     REAL NOT NULL,
  lon_west      REAL NOT NULL,
  lon_east      REAL NOT NULL,
  zoom          INTEGER,
  tile_x        INTEGER,
  tile_y        INTEGER,
  model_version TEXT,
  ip_hash       TEXT
);

CREATE INDEX IF NOT EXISTS idx_feedback_vote  ON feedback(vote);
CREATE INDEX IF NOT EXISTS idx_feedback_class ON feedback(class);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_iphash ON feedback(ip_hash);

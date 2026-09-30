CREATE TABLE maintenance_health (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK(id=1),
  run_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  succeeded_at INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0,
  failures TEXT NOT NULL DEFAULT '[]',
  reclaimed_bytes INTEGER NOT NULL DEFAULT 0,
  total_reclaimed_bytes INTEGER NOT NULL DEFAULT 0
);

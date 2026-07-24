CREATE TABLE IF NOT EXISTS plan_generation_cache (
  cache_key TEXT PRIMARY KEY,
  steps_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

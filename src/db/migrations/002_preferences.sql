-- Brukerpreferanser per oppskrift
CREATE TABLE IF NOT EXISTS preferences (
  recipe_id INTEGER PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
  rating    INTEGER CHECK (rating BETWEEN 1 AND 5),
  liked     INTEGER NOT NULL DEFAULT 1,
  frequency TEXT NOT NULL DEFAULT 'normal'
    CHECK (frequency IN ('often', 'normal', 'seldom', 'never'))
);

-- Global konfigurasjon (nøkkel/verdi)
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Standardverdier
INSERT OR IGNORE INTO config (key, value) VALUES ('household_size', '4');
INSERT OR IGNORE INTO config (key, value) VALUES ('plan_days', '5');
INSERT OR IGNORE INTO config (key, value) VALUES ('dietary', '[]');

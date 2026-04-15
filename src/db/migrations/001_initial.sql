-- Oppskrifter
CREATE TABLE IF NOT EXISTS recipes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  servings    INTEGER NOT NULL DEFAULT 4,
  tags        TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ingredienser koblet til oppskrifter
CREATE TABLE IF NOT EXISTS ingredients (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id       INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  quantity        REAL NOT NULL,
  unit            TEXT NOT NULL,
  oda_search_hint TEXT
);

-- Kokehistorikk
CREATE TABLE IF NOT EXISTS meal_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  cooked_on  TEXT NOT NULL DEFAULT (date('now')),
  servings   INTEGER,
  notes      TEXT
);

-- Ukeplaner (én rad per dag per uke)
CREATE TABLE IF NOT EXISTS weekly_plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start  TEXT NOT NULL,
  day_offset  INTEGER NOT NULL CHECK (day_offset BETWEEN 0 AND 6),
  recipe_id   INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  custom_meal TEXT,
  UNIQUE(week_start, day_offset)
);

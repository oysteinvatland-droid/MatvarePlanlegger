import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, DB_PATH } from '../config/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;
  mkdirSync(DATA_DIR, { recursive: true });
  _db = new DatabaseSync(DB_PATH);
  _db.exec('PRAGMA journal_mode = WAL');
  _db.exec('PRAGMA foreign_keys = ON');
  runMigrations(_db);
  return _db;
}

function runMigrations(db: DatabaseSync): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
      name   TEXT PRIMARY KEY,
      run_at TEXT NOT NULL
    )`
  );

  const applied = new Set<string>(
    (db.prepare('SELECT name FROM _migrations').all() as { name: string }[])
      .map(r => r.name)
  );

  // Migrasjonsfilene ligger under src/db/migrations/
  const migrationsDir = join(__dirname, '..', '..', 'src', 'db', 'migrations');

  let files: string[];
  try {
    files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
  } catch {
    // Fallback for kjøring fra dist/
    const fallback = join(process.cwd(), 'src', 'db', 'migrations');
    files = readdirSync(fallback)
      .filter(f => f.endsWith('.sql'))
      .sort();
  }

  for (const file of files) {
    if (!applied.has(file)) {
      const migrationsPath = readdirSync(migrationsDir).length
        ? migrationsDir
        : join(process.cwd(), 'src', 'db', 'migrations');
      const sql = readFileSync(join(migrationsPath, file), 'utf8');
      db.exec(sql);
      db.prepare('INSERT INTO _migrations VALUES (?, ?)').run(
        file,
        new Date().toISOString()
      );
    }
  }
}

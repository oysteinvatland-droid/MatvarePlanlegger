import { getDb } from './client.js';
import type { Preference, Config } from './types.js';

interface PreferenceRow {
  recipe_id: number;
  rating: number | null;
  liked: number;
  frequency: string;
}

function toPreference(row: PreferenceRow): Preference {
  return {
    recipeId: row.recipe_id,
    rating: row.rating,
    liked: row.liked === 1,
    frequency: row.frequency as Preference['frequency'],
  };
}

export function getPreference(recipeId: number): Preference | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM preferences WHERE recipe_id = ?')
    .get(recipeId) as PreferenceRow | undefined;
  return row ? toPreference(row) : null;
}

export function upsertPreference(
  recipeId: number,
  updates: Partial<Omit<Preference, 'recipeId'>>
): void {
  const db = getDb();
  const existing = getPreference(recipeId);

  if (existing) {
    const rating = updates.rating !== undefined ? updates.rating : existing.rating;
    const liked = updates.liked !== undefined ? (updates.liked ? 1 : 0) : (existing.liked ? 1 : 0);
    const frequency = updates.frequency ?? existing.frequency;

    db.prepare(
      `UPDATE preferences SET rating = ?, liked = ?, frequency = ?
       WHERE recipe_id = ?`
    ).run(rating, liked, frequency, recipeId);
  } else {
    db.prepare(
      `INSERT INTO preferences (recipe_id, rating, liked, frequency)
       VALUES (?, ?, ?, ?)`
    ).run(
      recipeId,
      updates.rating ?? null,
      updates.liked !== undefined ? (updates.liked ? 1 : 0) : 1,
      updates.frequency ?? 'normal'
    );
  }
}

export function getConfig(): Config {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM config').all() as {
    key: string;
    value: string;
  }[];
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

  return {
    householdSize: parseInt(map['household_size'] ?? '4', 10),
    planDays: parseInt(map['plan_days'] ?? '5', 10),
    dietary: JSON.parse(map['dietary'] ?? '[]') as string[],
  };
}

export function setConfig(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)'
  ).run(key, value);
}

import { getDb } from './client.js';
import type { MealHistory } from './types.js';

interface HistoryRow {
  id: number;
  recipe_id: number;
  cooked_on: string;
  servings: number | null;
  notes: string | null;
}

function toHistory(row: HistoryRow): MealHistory {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    cookedOn: row.cooked_on,
    servings: row.servings,
    notes: row.notes,
  };
}

export function getRecentHistory(limit = 20): MealHistory[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT h.*, r.name as recipe_name
       FROM meal_history h
       JOIN recipes r ON r.id = h.recipe_id
       ORDER BY h.cooked_on DESC
       LIMIT ?`
    )
    .all(limit) as unknown as (HistoryRow & { recipe_name: string })[];
  return rows.map(toHistory);
}

export function getHistoryWithNames(
  limit = 20
): (MealHistory & { recipeName: string })[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT h.*, r.name as recipe_name
       FROM meal_history h
       JOIN recipes r ON r.id = h.recipe_id
       ORDER BY h.cooked_on DESC
       LIMIT ?`
    )
    .all(limit) as unknown as (HistoryRow & { recipe_name: string })[];
  return rows.map(row => ({ ...toHistory(row), recipeName: row.recipe_name }));
}

export function getLastCookedDate(recipeId: number): string | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT cooked_on FROM meal_history
       WHERE recipe_id = ?
       ORDER BY cooked_on DESC
       LIMIT 1`
    )
    .get(recipeId) as { cooked_on: string } | undefined;
  return row?.cooked_on ?? null;
}

export function logMeal(
  recipeId: number,
  cookedOn?: string,
  notes?: string
): MealHistory {
  const db = getDb();
  const date = cookedOn ?? new Date().toISOString().split('T')[0];
  const result = db
    .prepare(
      `INSERT INTO meal_history (recipe_id, cooked_on, notes)
       VALUES (?, ?, ?)`
    )
    .run(recipeId, date, notes ?? null);

  const row = db
    .prepare('SELECT * FROM meal_history WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as unknown as HistoryRow;
  return toHistory(row);
}

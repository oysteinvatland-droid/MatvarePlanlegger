import { getDb } from '../db/client.js';
import { getRecipeById } from '../db/recipes.js';
import type { WeeklyPlan } from '../db/types.js';

interface PlanRow {
  id: number;
  week_start: string;
  day_offset: number;
  recipe_id: number | null;
  custom_meal: string | null;
}

export const DAYS_NO = [
  'Mandag',
  'Tirsdag',
  'Onsdag',
  'Torsdag',
  'Fredag',
  'Lørdag',
  'Søndag',
];

/**
 * Beregn ISO-dato for mandag i en gitt uke.
 * offset=0 = denne uken, offset=1 = neste uke
 */
export function getMondayOfWeek(offset = 0): string {
  const now = new Date();
  const day = now.getDay(); // 0 = søndag
  const diff = day === 0 ? -6 : 1 - day; // mandag = dag 1
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff + offset * 7);
  return monday.toISOString().split('T')[0]!;
}

export interface WeeklyPlanEntry {
  dayOffset: number;
  dayName: string;
  recipeName: string | null;
  recipeId: number | null;
  customMeal: string | null;
}

export function getWeeklyPlan(weekStart: string): WeeklyPlanEntry[] {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT * FROM weekly_plans WHERE week_start = ? ORDER BY day_offset'
    )
    .all(weekStart) as unknown as PlanRow[];

  const byOffset = new Map<number, PlanRow>(rows.map(r => [r.day_offset, r]));

  return Array.from({ length: 7 }, (_, i) => {
    const row = byOffset.get(i);
    const recipeName = row?.recipe_id
      ? (getRecipeById(row.recipe_id)?.name ?? null)
      : null;

    return {
      dayOffset: i,
      dayName: DAYS_NO[i]!,
      recipeName: recipeName ?? row?.custom_meal ?? null,
      recipeId: row?.recipe_id ?? null,
      customMeal: row?.custom_meal ?? null,
    };
  });
}

export function setDayPlan(
  weekStart: string,
  dayOffset: number,
  recipeId: number | null,
  customMeal?: string
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO weekly_plans (week_start, day_offset, recipe_id, custom_meal)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(week_start, day_offset)
     DO UPDATE SET recipe_id = excluded.recipe_id, custom_meal = excluded.custom_meal`
  ).run(weekStart, dayOffset, recipeId, customMeal ?? null);
}

export function clearDayPlan(weekStart: string, dayOffset: number): void {
  const db = getDb();
  db.prepare(
    'DELETE FROM weekly_plans WHERE week_start = ? AND day_offset = ?'
  ).run(weekStart, dayOffset);
}

export function clearWeekPlan(weekStart: string): void {
  const db = getDb();
  db.prepare('DELETE FROM weekly_plans WHERE week_start = ?').run(weekStart);
}

export function getWeekIngredientsForPlan(
  weekStart: string
): { recipeName: string; ingredients: { name: string; quantity: number; unit: string; odaSearchHint: string | null }[] }[] {
  const db = getDb();
  const plans = db
    .prepare('SELECT * FROM weekly_plans WHERE week_start = ? AND recipe_id IS NOT NULL')
    .all(weekStart) as unknown as PlanRow[];

  const result = [];
  for (const plan of plans) {
    if (!plan.recipe_id) continue;
    const recipe = getRecipeById(plan.recipe_id);
    if (!recipe) continue;
    const ingredients = db
      .prepare('SELECT * FROM ingredients WHERE recipe_id = ?')
      .all(plan.recipe_id) as {
        name: string;
        quantity: number;
        unit: string;
        oda_search_hint: string | null;
      }[];
    result.push({
      recipeName: recipe.name,
      ingredients: ingredients.map(i => ({
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        odaSearchHint: i.oda_search_hint,
      })),
    });
  }
  return result;
}

import { getDb } from './client.js';
import type { Recipe, Ingredient } from './types.js';

interface RecipeRow {
  id: number;
  name: string;
  description: string | null;
  servings: number;
  tags: string;
  oda_url: string | null;
  price: number | null;
  created_at: string;
  updated_at: string;
}

interface IngredientRow {
  id: number;
  recipe_id: number;
  name: string;
  quantity: number;
  unit: string;
  oda_search_hint: string | null;
}

function toRecipe(row: RecipeRow): Recipe {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    servings: row.servings,
    tags: JSON.parse(row.tags) as string[],
    odaUrl: row.oda_url ?? null,
    price: row.price ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toIngredient(row: IngredientRow): Ingredient {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    odaSearchHint: row.oda_search_hint,
  };
}

export function getAllRecipes(): Recipe[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM recipes ORDER BY name').all() as unknown as RecipeRow[];
  return rows.map(toRecipe);
}

export function getRecipeByName(name: string): Recipe | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM recipes WHERE lower(name) = lower(?)')
    .get(name) as RecipeRow | undefined;
  return row ? toRecipe(row) : null;
}

export function getRecipeById(id: number): Recipe | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM recipes WHERE id = ?')
    .get(id) as RecipeRow | undefined;
  return row ? toRecipe(row) : null;
}

export function getIngredientsByRecipe(recipeId: number): Ingredient[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM ingredients WHERE recipe_id = ? ORDER BY id')
    .all(recipeId) as unknown as IngredientRow[];
  return rows.map(toIngredient);
}

export interface NewRecipe {
  name: string;
  description?: string;
  servings?: number;
  tags?: string[];
}

export interface NewIngredient {
  name: string;
  quantity: number;
  unit: string;
  odaSearchHint?: string;
}

export function createRecipe(
  recipe: NewRecipe,
  ingredients: NewIngredient[]
): Recipe {
  const db = getDb();

  const insertRecipe = db.prepare(
    `INSERT INTO recipes (name, description, servings, tags)
     VALUES (?, ?, ?, ?)`
  );

  const insertIngredient = db.prepare(
    `INSERT INTO ingredients (recipe_id, name, quantity, unit, oda_search_hint)
     VALUES (?, ?, ?, ?, ?)`
  );

  let recipeId!: number;
  const insertRecipeResult = insertRecipe.run(
    recipe.name,
    recipe.description ?? null,
    recipe.servings ?? 4,
    JSON.stringify(recipe.tags ?? [])
  );
  recipeId = Number(insertRecipeResult.lastInsertRowid);

  for (const ing of ingredients) {
    insertIngredient.run(
      recipeId,
      ing.name,
      ing.quantity,
      ing.unit,
      ing.odaSearchHint ?? null
    );
  }
  return getRecipeById(recipeId)!;
}

export function deleteRecipe(id: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
  return result.changes > 0;
}

export function upsertRecipeFromSeed(
  recipe: NewRecipe,
  ingredients: NewIngredient[]
): void {
  const existing = getRecipeByName(recipe.name);
  if (existing) return;
  createRecipe(recipe, ingredients);
}

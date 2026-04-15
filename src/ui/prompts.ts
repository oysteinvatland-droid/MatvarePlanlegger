import { input, select, confirm, number, checkbox } from '@inquirer/prompts';
import type { Recipe } from '../db/types.js';

export { input, select, confirm, number, checkbox };

export async function selectRecipe(
  recipes: Recipe[],
  message = 'Velg oppskrift:'
): Promise<Recipe | null> {
  if (recipes.length === 0) {
    console.log('Ingen oppskrifter funnet.');
    return null;
  }

  const choices = [
    ...recipes.map(r => ({ name: r.name, value: r.id })),
    { name: '(Hopp over)', value: -1 },
  ];

  const id = await select({ message, choices });
  if (id === -1) return null;
  return recipes.find(r => r.id === id) ?? null;
}

import { getAllRecipes } from '../db/recipes.js';
import { getConfig } from '../db/preferences.js';
import { scoreRecipe, type ScoredRecipe } from './scorer.js';

/**
 * Generer N middagsforslag, sortert fra best til dårligst.
 * Ekskluderer oppskrifter laget nylig, ikke-likte, osv.
 * Sørger for mangfold: maks 2 oppskrifter med samme tag per resultat.
 */
export function suggestMeals(count: number = 5): ScoredRecipe[] {
  const config = getConfig();
  const recipes = getAllRecipes();
  const preferredTags = config.dietary;

  const scored = recipes
    .map(r => scoreRecipe(r, preferredTags))
    .filter(s => !s.excluded && s.score > 0)
    .sort((a, b) => b.score - a.score);

  // Diversitetsfilter: maks 2 av samme tag i utvalget
  const tagCount: Record<string, number> = {};
  const result: ScoredRecipe[] = [];

  for (const item of scored) {
    if (result.length >= count) break;

    const tags = item.recipe.tags;
    const wouldExceed = tags.some(tag => (tagCount[tag] ?? 0) >= 2);

    if (!wouldExceed || result.length < count / 2) {
      result.push(item);
      for (const tag of tags) {
        tagCount[tag] = (tagCount[tag] ?? 0) + 1;
      }
    }
  }

  // Fyll opp om diversitetsfilter fjernet for mye
  if (result.length < count) {
    for (const item of scored) {
      if (result.length >= count) break;
      if (!result.find(r => r.recipe.id === item.recipe.id)) {
        result.push(item);
      }
    }
  }

  return result;
}

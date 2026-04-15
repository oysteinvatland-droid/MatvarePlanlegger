import { getLastCookedDate } from '../db/history.js';
import { getPreference } from '../db/preferences.js';
import type { Recipe } from '../db/types.js';

export interface ScoredRecipe {
  recipe: Recipe;
  score: number;
  recencyScore: number;
  preferenceScore: number;
  tagScore: number;
  excluded: boolean;
  excludeReason?: string;
}

/**
 * Beregn antall dager siden en dato
 */
function daysSince(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

/**
 * Score en oppskrift basert på ferskhet og preferanser.
 *
 * Totalscore = RecencyScore (0–50) + PreferenceScore (0–40) + TagScore (0–10)
 */
export function scoreRecipe(
  recipe: Recipe,
  preferredTags: string[] = []
): ScoredRecipe {
  const lastCooked = getLastCookedDate(recipe.id);
  const preference = getPreference(recipe.id);

  // --- Ekskludering ---
  if (preference?.frequency === 'never') {
    return {
      recipe,
      score: 0,
      recencyScore: 0,
      preferenceScore: 0,
      tagScore: 0,
      excluded: true,
      excludeReason: 'Merket som aldri',
    };
  }

  if (preference?.liked === false) {
    return {
      recipe,
      score: 0,
      recencyScore: 0,
      preferenceScore: 0,
      tagScore: 0,
      excluded: true,
      excludeReason: 'Merket som ikke likt',
    };
  }

  // --- RecencyScore (0–50) ---
  let recencyScore: number;
  if (!lastCooked) {
    recencyScore = 50; // Aldri laget
  } else {
    const days = daysSince(lastCooked);
    if (days < 7) {
      // Laget nylig – ekskluder
      return {
        recipe,
        score: 0,
        recencyScore: 0,
        preferenceScore: 0,
        tagScore: 0,
        excluded: true,
        excludeReason: `Laget for ${days} dager siden`,
      };
    } else if (days < 14) {
      recencyScore = 10;
    } else if (days < 28) {
      recencyScore = 30;
    } else {
      recencyScore = 45;
    }
  }

  // --- PreferenceScore (0–40) ---
  let preferenceScore = 10; // Standard for 'normal'
  if (preference) {
    switch (preference.frequency) {
      case 'often':
        preferenceScore = 20;
        break;
      case 'seldom':
        preferenceScore = -20;
        break;
      default:
        preferenceScore = 10;
    }
    if (preference.rating !== null) {
      if (preference.rating >= 4) preferenceScore += 20;
      else if (preference.rating <= 2) preferenceScore -= 10;
    }
  }
  preferenceScore = Math.max(0, Math.min(40, preferenceScore));

  // --- TagScore (0–10) ---
  let tagScore = 0;
  if (preferredTags.length > 0) {
    const matches = recipe.tags.filter(t =>
      preferredTags.map(p => p.toLowerCase()).includes(t.toLowerCase())
    ).length;
    tagScore = Math.min(10, matches * 5);
  }

  const score = recencyScore + preferenceScore + tagScore;

  return {
    recipe,
    score,
    recencyScore,
    preferenceScore,
    tagScore,
    excluded: false,
  };
}

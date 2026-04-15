export interface Recipe {
  id: number;
  name: string;
  description: string | null;
  servings: number;
  tags: string[];
  odaUrl: string | null;
  price: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Ingredient {
  id: number;
  recipeId: number;
  name: string;
  quantity: number;
  unit: string;
  odaSearchHint: string | null;
}

export interface MealHistory {
  id: number;
  recipeId: number;
  cookedOn: string;
  servings: number | null;
  notes: string | null;
}

export interface WeeklyPlan {
  id: number;
  weekStart: string;
  dayOffset: number;
  recipeId: number | null;
  customMeal: string | null;
}

export interface Preference {
  recipeId: number;
  rating: number | null;
  liked: boolean;
  frequency: 'often' | 'normal' | 'seldom' | 'never';
}

export interface Config {
  householdSize: number;
  planDays: number;
  dietary: string[];
}

export type Unit =
  | 'g' | 'kg'
  | 'ml' | 'dl' | 'l'
  | 'stk'
  | 'ss' | 'ts'
  | 'neve' | 'pakke' | 'boks'
  | string;

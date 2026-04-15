import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../config/paths.js';
import { seedRecipesNonDestructive } from '../commands/seed.js';
import { getAllRecipes } from '../db/recipes.js';
import { getHistoryWithNames } from '../db/history.js';
import { getWeeklyPlan, setDayPlan, getMondayOfWeek, clearWeekPlan } from '../planner/week.js';
import { getConfig, setConfig } from '../db/preferences.js';
import { suggestMeals } from '../planner/engine.js';
import { getBrowserContext, closeBrowser } from '../oda/client.js';
import { ensureLoggedIn, saveSession } from '../oda/auth.js';
import { addRecipeToCart } from '../oda/cart.js';
import { getDb } from '../db/client.js';
import type Anthropic from '@anthropic-ai/sdk';

const PREFERENCES_PATH = join(DATA_DIR, 'preferences.md');

const DEFAULT_PREFERENCES = `# Matlagingspreferanser

Skriv preferanser her. Agenten leser dette og tilpasser seg.
Eksempel:
- En middag per uke skal være fisk
- Ingen lam
- Raske middager på hverdager (under 30 min)
`;

function ensurePreferences(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(PREFERENCES_PATH)) {
    writeFileSync(PREFERENCES_PATH, DEFAULT_PREFERENCES, 'utf8');
  }
}

// --- Verktøydefinisjonerlister for Claude API ---

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'list_recipes',
    description: 'Hent alle oppskrifter lagret i databasen, med navn, tags og sist laget dato.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_week_plan',
    description: 'Hent ukens plan. offset=0 er denne uken, offset=1 er neste uke.',
    input_schema: {
      type: 'object' as const,
      properties: {
        offset: { type: 'number', description: '0 = denne uken, 1 = neste uke' },
      },
      required: [],
    },
  },
  {
    name: 'get_recent_meals',
    description: 'Hent de siste N middagene fra kokehistorikken, for å unngå gjentak.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Antall måltider å hente (standard: 14)' },
      },
      required: [],
    },
  },
  {
    name: 'set_week_plan',
    description: 'Sett ukesplanen for neste uke. Send en liste med recipe_id for mandag–fredag (dag 0–4).',
    input_schema: {
      type: 'object' as const,
      properties: {
        meals: {
          type: 'array',
          description: 'Liste med { day_offset: 0–6, recipe_id: number }',
          items: {
            type: 'object',
            properties: {
              day_offset: { type: 'number' },
              recipe_id: { type: 'number' },
            },
            required: ['day_offset', 'recipe_id'],
          },
        },
        week_offset: { type: 'number', description: '0 = denne uken, 1 = neste uke (standard: 1)' },
      },
      required: ['meals'],
    },
  },
  {
    name: 'read_preferences',
    description: 'Les preferences.md – fritekstfilen med brukerens matpreferanser.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'update_preferences',
    description: 'Oppdater preferences.md med nytt innhold. Erstatter hele filen.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'Nytt innhold for preferences.md' },
      },
      required: ['content'],
    },
  },
  {
    name: 'get_config',
    description: 'Hent konfigurasjon: husholdningsstørrelse, antall planleggingsdager, kostholdspreferanser.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'set_config',
    description: 'Sett en konfigurasjonsverdi. Nøkler: household_size, plan_days, dietary (JSON-array).',
    input_schema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Konfigurasjonsnøkkel' },
        value: { type: 'string', description: 'Ny verdi' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'suggest_meals',
    description: 'Generer N middagsforslag basert på scorer og preferanser.',
    input_schema: {
      type: 'object' as const,
      properties: {
        count: { type: 'number', description: 'Antall forslag (standard: 5)' },
      },
      required: [],
    },
  },
  {
    name: 'order_on_oda',
    description: 'Legg neste ukes planlagte middager i Oda.no-handlekurven. Krever ODA_EMAIL og ODA_PASSWORD i env.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'refresh_recipes',
    description: 'Hent nye oppskrifter fra oda.no og legg dem til i databasen. Sletter IKKE eksisterende oppskrifter eller historikk. Bruk når brukeren ber om oppdatering eller det er lite å velge mellom.',
    input_schema: {
      type: 'object' as const,
      properties: {
        antall: { type: 'number', description: 'Maks antall nye oppskrifter å hente (standard: 10)' },
      },
      required: [],
    },
  },
];

// --- Verktøyimplementasjoner ---

export async function runTool(
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'list_recipes': {
      const recipes = getAllRecipes();
      const history = getHistoryWithNames(50);
      const lastCooked = new Map(history.map(h => [h.recipeId, h.cookedOn]));
      return recipes.map(r => ({
        id: r.id,
        name: r.name,
        tags: r.tags,
        price: r.price ?? null,
        lastCooked: lastCooked.get(r.id) ?? null,
      }));
    }

    case 'get_week_plan': {
      const offset = typeof input['offset'] === 'number' ? input['offset'] : 0;
      const weekStart = getMondayOfWeek(offset);
      const plan = getWeeklyPlan(weekStart);
      return { weekStart, days: plan };
    }

    case 'get_recent_meals': {
      const limit = typeof input['limit'] === 'number' ? input['limit'] : 14;
      return getHistoryWithNames(limit);
    }

    case 'set_week_plan': {
      const weekOffset = typeof input['week_offset'] === 'number' ? input['week_offset'] : 1;
      const weekStart = getMondayOfWeek(weekOffset);
      clearWeekPlan(weekStart);
      const meals = input['meals'] as { day_offset: number; recipe_id: number }[];
      for (const meal of meals) {
        setDayPlan(weekStart, meal.day_offset, meal.recipe_id);
      }
      return { ok: true, weekStart, mealsSet: meals.length };
    }

    case 'read_preferences': {
      ensurePreferences();
      return readFileSync(PREFERENCES_PATH, 'utf8');
    }

    case 'update_preferences': {
      const content = String(input['content'] ?? '');
      ensurePreferences();
      writeFileSync(PREFERENCES_PATH, content, 'utf8');
      return { ok: true };
    }

    case 'get_config': {
      return getConfig();
    }

    case 'set_config': {
      const key = String(input['key'] ?? '');
      const value = String(input['value'] ?? '');
      setConfig(key, value);
      return { ok: true, key, value };
    }

    case 'suggest_meals': {
      const count = typeof input['count'] === 'number' ? input['count'] : 5;
      const suggestions = suggestMeals(count);
      return suggestions.map(s => ({
        id: s.recipe.id,
        name: s.recipe.name,
        score: s.score,
        tags: s.recipe.tags,
      }));
    }

    case 'order_on_oda': {
      const weekStart = getMondayOfWeek(1);
      const plan = getWeeklyPlan(weekStart);
      const db = getDb();

      const orders: { name: string; odaUrl: string }[] = [];
      for (const entry of plan) {
        if (!entry.recipeId) continue;
        const row = db
          .prepare('SELECT name, oda_url FROM recipes WHERE id = ?')
          .get(entry.recipeId) as { name: string; oda_url: string | null } | undefined;
        if (row?.oda_url) {
          orders.push({ name: row.name, odaUrl: row.oda_url });
        }
      }

      if (orders.length === 0) {
        return { ok: false, error: 'Ingen oppskrifter planlagt for neste uke.' };
      }

      const odaEmail = process.env['ODA_EMAIL'];
      const odaPassword = process.env['ODA_PASSWORD'];
      if (!odaEmail || !odaPassword) {
        return { ok: false, error: 'ODA_EMAIL eller ODA_PASSWORD mangler i miljøvariabler.' };
      }

      let context;
      const results: { name: string; ok: boolean; unavailableIngredients: string[] }[] = [];

      try {
        context = await getBrowserContext(true);
        const page = await ensureLoggedIn(context, odaEmail, odaPassword);
        await saveSession(context);

        for (const order of orders) {
          try {
            const result = await addRecipeToCart(page, order.odaUrl);
            results.push({ name: order.name, ...result });
          } catch (err) {
            results.push({ name: order.name, ok: false, unavailableIngredients: [] });
          }
        }
      } finally {
        await closeBrowser();
      }

      return { results };
    }

    case 'refresh_recipes': {
      const antall = typeof input['antall'] === 'number' ? input['antall'] : 10;
      const result = await seedRecipesNonDestructive({ wanted: antall, scanCount: 30 });
      return result;
    }

    default:
      throw new Error(`Ukjent verktøy: ${name}`);
  }
}

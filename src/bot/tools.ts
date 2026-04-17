import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../config/paths.js';
import { seedRecipesNonDestructive } from '../commands/seed.js';
import { getAllRecipes } from '../db/recipes.js';
import { getHistoryWithNames } from '../db/history.js';
import { getWeeklyPlan, setDayPlan, getMondayOfWeek, clearWeekPlan } from '../planner/week.js';
import { getConfig, setConfig, getGlutenKeywords, upsertPreference } from '../db/preferences.js';
import { getScheduleConfig, setScheduleTime, setScheduleDay, triggerWeeklyJobManually } from './scheduler.js';
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
    description: 'Hent konfigurasjon: husholdningsstørrelse, antall planleggingsdager, kostholdspreferanser, og glutennøkkelordliste (glutenKeywords).',
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
    name: 'get_schedule',
    description: 'Vis når den ukentlige jobben kjører (seed + planlegging + bestilling).',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'set_schedule',
    description: 'Endre dag og/eller tidspunkt for den ukentlige jobben. day = ukedag (mandag–søndag). time = klokkeslett i HH:MM-format.',
    input_schema: {
      type: 'object' as const,
      properties: {
        day: { type: 'string', enum: ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'], description: 'Ukedag for kjøring' },
        time: { type: 'string', description: 'Klokkeslett i HH:MM-format, f.eks. "09:00"' },
      },
      required: [],
    },
  },
  {
    name: 'trigger_weekly_job',
    description: 'Kjør den ukentlige jobben manuelt nå (seed + planlegging + bestilling). Bruk når brukeren vil teste eller trigge jobben uten å vente på neste planlagte kjøring.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'delete_recipe',
    description: 'Slett en oppskrift fra databasen permanent. Bruk når brukeren vil fjerne en oppskrift.',
    input_schema: {
      type: 'object' as const,
      properties: {
        recipe_id: { type: 'number', description: 'ID til oppskriften som skal slettes' },
      },
      required: ['recipe_id'],
    },
  },
  {
    name: 'set_recipe_preference',
    description: 'Sett preferanse for en oppskrift: frequency (often/normal/seldom/never) og/eller liked (true/false). Bruk "never" for å aldri foreslå den igjen.',
    input_schema: {
      type: 'object' as const,
      properties: {
        recipe_id: { type: 'number', description: 'ID til oppskriften' },
        frequency: { type: 'string', enum: ['often', 'normal', 'seldom', 'never'], description: 'Hvor ofte oppskriften skal foreslås' },
        liked: { type: 'boolean', description: 'Om oppskriften er likt (false = aldri foreslå)' },
      },
      required: ['recipe_id'],
    },
  },
  {
    name: 'refresh_recipes',
    description: 'Hent nye oppskrifter fra oda.no og legg dem til i databasen. Sletter IKKE eksisterende oppskrifter eller historikk. Hopper over oppskrifter med gluteningredienser og ikke-middagsoppskrifter. Bruk når brukeren ber om oppdatering eller det er lite å velge mellom.',
    input_schema: {
      type: 'object' as const,
      properties: {
        antall: { type: 'number', description: 'Maks antall nye oppskrifter å hente (standard: 10)' },
        max_pris: { type: 'number', description: 'Hopp over oppskrifter dyrere enn dette beløpet i kr (valgfri)' },
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
      return { ...getConfig(), glutenKeywords: getGlutenKeywords() };
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

    case 'get_schedule': {
      const config = getScheduleConfig();
      const dayNames: Record<string, string> = {
        '0': 'søndag', '1': 'mandag', '2': 'tirsdag', '3': 'onsdag',
        '4': 'torsdag', '5': 'fredag', '6': 'lørdag',
      };
      const dayName = dayNames[config.day] ?? config.day;
      return {
        beskrivelse: `Ukentlig jobb (seed 20 oppskrifter + planlegging + bestilling) kjører ${dayName} kl. ${config.time} (norsk tid)`,
        dag: dayName,
        tid: config.time,
      };
    }

    case 'set_schedule': {
      const dayMap: Record<string, string> = {
        'mandag': '1', 'tirsdag': '2', 'onsdag': '3', 'torsdag': '4',
        'fredag': '5', 'lørdag': '6', 'søndag': '0',
      };
      const dayInput = input['day'] ? String(input['day']).toLowerCase() : null;
      const timeInput = input['time'] ? String(input['time']) : null;

      if (!dayInput && !timeInput) {
        return { ok: false, error: 'Oppgi dag og/eller tidspunkt.' };
      }

      if (timeInput) {
        if (!/^\d{2}:\d{2}$/.test(timeInput)) {
          return { ok: false, error: 'Ugyldig tidsformat. Bruk HH:MM, f.eks. "09:00".' };
        }
        const [h, m] = timeInput.split(':').map(Number);
        if (h < 0 || h > 23 || m < 0 || m > 59) {
          return { ok: false, error: 'Ugyldig klokkeslett.' };
        }
        setScheduleTime(timeInput);
      }

      if (dayInput) {
        const dayNum = dayMap[dayInput];
        if (!dayNum) {
          return { ok: false, error: `Ugyldig dag: ${dayInput}. Bruk mandag–søndag.` };
        }
        setScheduleDay(dayNum);
      }

      const updated = getScheduleConfig();
      const dayNames: Record<string, string> = {
        '0': 'søndag', '1': 'mandag', '2': 'tirsdag', '3': 'onsdag',
        '4': 'torsdag', '5': 'fredag', '6': 'lørdag',
      };
      return {
        ok: true,
        message: `Ukentlig jobb kjører nå ${dayNames[updated.day] ?? updated.day} kl. ${updated.time} (norsk tid).`,
      };
    }

    case 'trigger_weekly_job': {
      triggerWeeklyJobManually().catch(err => {
        console.error('Feil under manuell ukentlig jobb:', err);
      });
      return { ok: true, message: 'Ukentlig jobb startet. Resultater sendes til Discord-kanalen.' };
    }

    case 'delete_recipe': {
      const id = typeof input['recipe_id'] === 'number' ? input['recipe_id'] : null;
      if (!id) return { ok: false, error: 'recipe_id mangler.' };
      const db = getDb();
      const recipe = db.prepare('SELECT name FROM recipes WHERE id = ?').get(id) as { name: string } | undefined;
      if (!recipe) return { ok: false, error: `Fant ingen oppskrift med id ${id}.` };
      db.prepare('DELETE FROM weekly_plans WHERE recipe_id = ?').run(id);
      db.prepare('DELETE FROM meal_history WHERE recipe_id = ?').run(id);
      db.prepare('DELETE FROM preferences WHERE recipe_id = ?').run(id);
      db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
      return { ok: true, deleted: recipe.name };
    }

    case 'set_recipe_preference': {
      const id = typeof input['recipe_id'] === 'number' ? input['recipe_id'] : null;
      if (!id) return { ok: false, error: 'recipe_id mangler.' };
      const updates: Record<string, unknown> = {};
      if (input['frequency']) updates['frequency'] = input['frequency'];
      if (typeof input['liked'] === 'boolean') updates['liked'] = input['liked'];
      if (Object.keys(updates).length === 0) return { ok: false, error: 'Ingen endringer oppgitt.' };
      upsertPreference(id, updates as Parameters<typeof upsertPreference>[1]);
      return { ok: true, recipe_id: id, ...updates };
    }

    case 'refresh_recipes': {
      const antall = typeof input['antall'] === 'number' ? input['antall'] : 10;
      const maxPrice = typeof input['max_pris'] === 'number' ? input['max_pris'] : undefined;
      const result = await seedRecipesNonDestructive({ wanted: antall, maxPrice });
      return result;
    }

    default:
      throw new Error(`Ukjent verktøy: ${name}`);
  }
}

import { Command } from 'commander';
import chalk from 'chalk';
import { getMondayOfWeek, getWeeklyPlan, setDayPlan, clearDayPlan, clearWeekPlan, DAYS_NO } from '../planner/week.js';
import { getConfig } from '../db/preferences.js';
import { getAllRecipes } from '../db/recipes.js';
import { suggestMeals } from '../planner/engine.js';
import { printWeeklyPlan } from '../ui/table.js';
import { selectRecipe, confirm } from '../ui/prompts.js';
import { select } from '@inquirer/prompts';

const planCommand = new Command('uke')
  .description('Vis og rediger ukens middagsplan')
  .option('-n, --neste', 'Planlegg neste uke i stedet')
  .option('--fyll', 'Fyll tomme dager automatisk med forslag')
  .option('--slett', 'Slett alle middager for uken')
  .option('--endre', 'Endre middag for én dag')
  .action(async (opts: { neste?: boolean; fyll?: boolean; slett?: boolean; endre?: boolean }) => {
    const weekOffset = opts.neste ? 1 : 0;
    const weekStart = getMondayOfWeek(weekOffset);
    const config = getConfig();
    let entries = getWeeklyPlan(weekStart);

    // -- Slett hele uken --
    if (opts.slett) {
      printWeeklyPlan(weekStart, entries, config.planDays);
      const ok = await confirm({
        message: 'Er du sikker på at du vil slette alle middager for denne uken?',
        default: false,
      });
      if (ok) {
        clearWeekPlan(weekStart);
        console.log(chalk.yellow('  Alle middager for uken er slettet.\n'));
      }
      return;
    }

    printWeeklyPlan(weekStart, entries, config.planDays);

    // -- Endre én dag --
    if (opts.endre) {
      const filledDays = entries.slice(0, config.planDays).filter(e => e.recipeName);
      if (filledDays.length === 0) {
        console.log(chalk.yellow('  Ingen dager er planlagt enda.\n'));
        return;
      }

      const dayChoice = await select({
        message: 'Hvilken dag vil du endre?',
        choices: [
          ...filledDays.map(e => ({ name: `${e.dayName}: ${e.recipeName}`, value: e.dayOffset })),
          { name: '(Avbryt)', value: -1 },
        ],
      });
      if (dayChoice === -1) return;

      clearDayPlan(weekStart, dayChoice);
      entries = getWeeklyPlan(weekStart);

      const usedRecipeIds = new Set<number>(
        entries.filter(e => e.recipeId !== null).map(e => e.recipeId!)
      );
      const allRecipes = getAllRecipes();
      const suggestions = suggestMeals(10);
      const availableSuggestions = suggestions.filter(s => !usedRecipeIds.has(s.recipe.id));
      const availableRecipes = allRecipes.filter(r => !usedRecipeIds.has(r.id));

      const choices = [
        ...availableSuggestions.slice(0, 5).map(s => ({ name: s.recipe.name, value: s.recipe.id })),
        { name: '--- Velg fra alle oppskrifter ---', value: -1 },
        { name: '(La stå tom)', value: -2 },
      ];

      const newChoice = await select({ message: 'Velg ny middag:', choices });
      if (newChoice === -2) {
        console.log(chalk.dim(`  Dagen er nå tom.\n`));
      } else if (newChoice === -1) {
        const recipe = await selectRecipe(availableRecipes);
        if (recipe) setDayPlan(weekStart, dayChoice, recipe.id);
      } else {
        setDayPlan(weekStart, dayChoice, newChoice);
      }

      console.log('');
      printWeeklyPlan(weekStart, getWeeklyPlan(weekStart), config.planDays);
      return;
    }

    // -- Fyll tomme dager --
    const emptyDays = entries
      .slice(0, config.planDays)
      .filter(e => !e.recipeName);

    if (emptyDays.length === 0) {
      console.log(chalk.green('  Alle dager er planlagt!\n'));
      return;
    }

    if (!opts.fyll) {
      const shouldFill = await confirm({
        message: `${emptyDays.length} dag(er) er tomme. Vil du fylle dem inn nå?`,
        default: true,
      });
      if (!shouldFill) return;
    }

    const suggestions = suggestMeals(emptyDays.length * 2);
    const allRecipes = getAllRecipes();

    // Hold styr på oppskrifter som allerede er satt denne uken
    const usedRecipeIds = new Set<number>(
      entries.filter(e => e.recipeId !== null).map(e => e.recipeId!)
    );

    for (const day of emptyDays) {
      console.log(chalk.bold(`\n  ${DAYS_NO[day.dayOffset]}:`));

      const availableSuggestions = suggestions.filter(s => !usedRecipeIds.has(s.recipe.id));
      const availableRecipes = allRecipes.filter(r => !usedRecipeIds.has(r.id));

      const choices = [
        ...availableSuggestions
          .slice(0, 5)
          .map(s => ({ name: s.recipe.name, value: s.recipe.id })),
        { name: '--- Velg fra alle oppskrifter ---', value: -1 },
        { name: '(Hopp over)', value: -2 },
      ];

      const choice = await select({
        message: 'Velg middag:',
        choices,
      });

      if (choice === -2) continue;

      if (choice === -1) {
        const recipe = await selectRecipe(availableRecipes);
        if (recipe) {
          setDayPlan(weekStart, day.dayOffset, recipe.id);
          usedRecipeIds.add(recipe.id);
        }
      } else {
        setDayPlan(weekStart, day.dayOffset, choice);
        usedRecipeIds.add(choice);
        const name = suggestions.find(s => s.recipe.id === choice)?.recipe.name;
        console.log(chalk.green(`  ✓ ${DAYS_NO[day.dayOffset]}: ${name}`));
      }
    }

    // Vis oppdatert plan
    const updated = getWeeklyPlan(weekStart);
    console.log('');
    printWeeklyPlan(weekStart, updated, config.planDays);
  });

export default planCommand;

import { Command } from 'commander';
import chalk from 'chalk';
import { suggestMeals } from '../planner/engine.js';
import { getLastCookedDate } from '../db/history.js';
import { printSuggestions } from '../ui/table.js';

const suggestCommand = new Command('forslag')
  .description('Foreslå middager basert på historikk og preferanser')
  .option('-a, --antall <n>', 'Antall forslag', '5')
  .action(async (opts: { antall: string }) => {
    const count = parseInt(opts.antall, 10);
    const suggestions = suggestMeals(count);

    if (suggestions.length === 0) {
      console.log(chalk.yellow('Ingen forslag tilgjengelig. Legg til oppskrifter med: plan oppskrift legg-til'));
      return;
    }

    printSuggestions(
      suggestions.map(s => ({
        name: s.recipe.name,
        score: s.score,
        tags: s.recipe.tags,
        lastCooked: getLastCookedDate(s.recipe.id),
      }))
    );
  });

export default suggestCommand;

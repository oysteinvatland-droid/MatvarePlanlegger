import { Command } from 'commander';
import chalk from 'chalk';
import { getHistoryWithNames, logMeal } from '../db/history.js';
import { getRecipeByName, getAllRecipes } from '../db/recipes.js';
import { selectRecipe } from '../ui/prompts.js';

const historikkCommand = new Command('historikk')
  .description('Se eller legg til kokehistorikk');

historikkCommand
  .command('vis', { isDefault: true })
  .description('Vis siste 20 kokte middager')
  .option('-n, --antall <n>', 'Antall å vise', '20')
  .action(async (opts: { antall: string }) => {
    const limit = parseInt(opts.antall, 10);
    const history = getHistoryWithNames(limit);

    if (history.length === 0) {
      console.log(chalk.yellow('Ingen historikk ennå. Bruk: plan historikk lagre'));
      return;
    }

    console.log('');
    console.log(chalk.bold.cyan('  Kokehistorikk:'));
    console.log(chalk.gray('  ' + '─'.repeat(40)));
    for (const h of history) {
      const date = new Date(h.cookedOn).toLocaleDateString('nb-NO', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      console.log(`  ${chalk.dim(date.padEnd(22))}  ${chalk.white(h.recipeName)}`);
    }
    console.log('');
  });

historikkCommand
  .command('lagre [navn]')
  .description('Merk en oppskrift som laget i dag')
  .option('-d, --dato <dato>', 'Dato (YYYY-MM-DD), standard: i dag')
  .action(async (navn: string | undefined, opts: { dato?: string }) => {
    let recipe = navn ? getRecipeByName(navn) : null;

    if (!recipe) {
      const all = getAllRecipes();
      recipe = await selectRecipe(all, 'Hvilken oppskrift ble laget?');
    }

    if (!recipe) {
      console.log('Avbrutt.');
      return;
    }

    logMeal(recipe.id, opts.dato);
    console.log(
      chalk.green(`\n  ✓ Lagret: ${recipe.name} (${opts.dato ?? 'i dag'})\n`)
    );
  });

export default historikkCommand;

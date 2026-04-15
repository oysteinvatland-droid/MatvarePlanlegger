import { Command } from 'commander';
import chalk from 'chalk';
import { requireOdaCredentials } from '../config/env.js';
import { getBrowserContext, closeBrowser } from '../oda/client.js';
import { ensureLoggedIn, saveSession } from '../oda/auth.js';
import { getMondayOfWeek, getWeeklyPlan } from '../planner/week.js';
import { getRecipeByName } from '../db/recipes.js';
import { getDb } from '../db/client.js';
import { startSpinner } from '../ui/spinner.js';
import { addRecipeToCart } from '../oda/cart.js';

const bestillCommand = new Command('bestill')
  .description('Legg ukens middager i Oda.no-handlekurven (5 porsjoner per middag)')
  .option('-n, --neste', 'Bestill for neste uke')
  .option('-o, --oppskrift <navn>', 'Bestill kun én oppskrift')
  .option('--headless <bool>', 'Kjør nettleser i bakgrunnen (standard: true)', 'true')
  .action(async (opts: { neste?: boolean; oppskrift?: string; headless: string }) => {
    const env = requireOdaCredentials();
    const headless = opts.headless !== 'false' && env.PLAYWRIGHT_HEADLESS !== false;

    // Samle oppskrifter som skal bestilles
    interface RecipeOrder { name: string; odaUrl: string }
    let orders: RecipeOrder[] = [];

    if (opts.oppskrift) {
      const recipe = getRecipeByName(opts.oppskrift);
      if (!recipe) {
        console.log(chalk.red(`  Oppskrift "${opts.oppskrift}" ikke funnet.`));
        return;
      }
      const db = getDb();
      const row = db.prepare('SELECT oda_url FROM recipes WHERE id = ?').get(recipe.id) as { oda_url: string | null };
      if (!row?.oda_url) {
        console.log(chalk.red(`  "${recipe.name}" mangler oda.no-URL. Kjør: npm run dev -- seed`));
        return;
      }
      orders = [{ name: recipe.name, odaUrl: row.oda_url }];
    } else {
      const weekStart = getMondayOfWeek(opts.neste ? 1 : 0);
      const plan = getWeeklyPlan(weekStart);
      const db = getDb();

      for (const entry of plan) {
        if (!entry.recipeId) continue;
        const row = db.prepare('SELECT name, oda_url FROM recipes WHERE id = ?').get(entry.recipeId) as { name: string; oda_url: string | null } | undefined;
        if (row?.oda_url) {
          orders.push({ name: row.name, odaUrl: row.oda_url });
        }
      }

      if (orders.length === 0) {
        console.log(chalk.yellow('  Ingen middager planlagt denne uken. Kjør: npm run dev -- uke'));
        return;
      }
    }

    console.log(chalk.bold.cyan('\n  Starter Oda.no-bestilling\n'));
    console.log(chalk.dim(`  Middager: ${orders.map(o => o.name).join(', ')}`));
    console.log(chalk.dim(`  Porsjoner per middag: 5\n`));

    const loginSpinner = startSpinner('Logger inn på Oda.no...');
    let context;

    try {
      context = await getBrowserContext(headless);
      const page = await ensureLoggedIn(context, env.ODA_EMAIL, env.ODA_PASSWORD);
      await saveSession(context);
      loginSpinner.succeed('Innlogget på Oda.no');

      const results: { name: string; ok: boolean; unavailableIngredients: string[] }[] = [];

      for (const order of orders) {
        const spinner = startSpinner(`Legger til: ${order.name}`);
        try {
          const { ok, unavailableIngredients } = await addRecipeToCart(page, order.odaUrl);
          if (ok) {
            spinner.succeed(`Lagt til: ${order.name} (5 porsjoner)`);
          } else if (unavailableIngredients.length > 0) {
            spinner.fail(`Ikke bestilt: ${order.name} – utsolgte ingredienser`);
            for (const ing of unavailableIngredients) {
              console.log(chalk.red(`    • ${ing}`));
            }
          } else {
            spinner.fail(`Fant ikke handlekurv-knapp: ${order.name}`);
          }
          results.push({ name: order.name, ok, unavailableIngredients });
        } catch (err) {
          spinner.fail(`Feil: ${order.name} – ${String(err)}`);
          results.push({ name: order.name, ok: false, unavailableIngredients: [] });
        }
      }

      const ok = results.filter(r => r.ok);
      const failed = results.filter(r => !r.ok);

      console.log(chalk.bold.cyan('\n  Oppsummering:'));
      console.log(chalk.gray('  ' + '─'.repeat(40)));
      for (const r of ok) console.log(chalk.green(`  ✓ ${r.name}`));
      for (const r of failed) {
        if (r.unavailableIngredients.length > 0) {
          console.log(chalk.red(`  ✗ ${r.name} (utsolgt: ${r.unavailableIngredients.join(', ')})`));
        } else {
          console.log(chalk.red(`  ✗ ${r.name}`));
        }
      }
      console.log(`\n  ${chalk.green(ok.length + ' lagt til')}${failed.length ? '  ' + chalk.red(failed.length + ' feilet') : ''}\n`);

    } finally {
      await closeBrowser();
    }
  });

export default bestillCommand;

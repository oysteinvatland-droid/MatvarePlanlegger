import { Command } from 'commander';
import chalk from 'chalk';
import {
  getAllRecipes,
  getRecipeByName,
  getIngredientsByRecipe,
  createRecipe,
  deleteRecipe,
  type NewIngredient,
} from '../db/recipes.js';
import { input, number, confirm, select } from '@inquirer/prompts';

const oppskriftCommand = new Command('oppskrift').description(
  'Administrer oppskrifter'
);

// plan oppskrift vis [navn]
oppskriftCommand
  .command('vis [navn]')
  .description('List alle oppskrifter, eller vis én i detalj')
  .action(async (navn?: string) => {
    if (navn) {
      const recipe = getRecipeByName(navn);
      if (!recipe) {
        console.log(chalk.red(`  Oppskrift "${navn}" ikke funnet.`));
        return;
      }
      const ingredients = getIngredientsByRecipe(recipe.id);
      console.log('');
      console.log(chalk.bold.cyan(`  ${recipe.name}`));
      if (recipe.description)
        console.log(chalk.dim(`  ${recipe.description}`));
      console.log(
        chalk.dim(
          `  Porsjoner: ${recipe.servings}  |  Tagger: ${recipe.tags.join(', ') || 'ingen'}`
        )
      );
      console.log(chalk.gray('  ' + '─'.repeat(40)));
      for (const ing of ingredients) {
        console.log(
          `  ${chalk.white(ing.name.padEnd(25))} ${ing.quantity} ${ing.unit}`
        );
      }
      console.log('');
    } else {
      const recipes = getAllRecipes();
      if (recipes.length === 0) {
        console.log(
          chalk.yellow(
            '  Ingen oppskrifter. Legg til med: plan oppskrift legg-til'
          )
        );
        return;
      }
      console.log('');
      console.log(chalk.bold.cyan('  Oppskrifter:'));
      console.log(chalk.gray('  ' + '─'.repeat(50)));
      for (const r of recipes) {
        const tags = r.tags.length ? chalk.dim(` [${r.tags.join(', ')}]`) : '';
        const price = r.price !== null ? chalk.dim(` – ${r.price} kr`) : '';
        console.log(`  ${chalk.white(r.name)}${tags}${price}`);
      }
      console.log(chalk.dim(`\n  Totalt: ${recipes.length} oppskrifter\n`));
    }
  });

// plan oppskrift legg-til
oppskriftCommand
  .command('legg-til')
  .description('Legg til en ny oppskrift interaktivt')
  .action(async () => {
    console.log(chalk.bold.cyan('\n  Ny oppskrift\n'));

    const name = await input({ message: 'Navn på oppskriften:' });
    if (!name.trim()) { console.log('Avbrutt.'); return; }

    const existing = getRecipeByName(name);
    if (existing) {
      console.log(chalk.red(`  "${name}" finnes allerede.`));
      return;
    }

    const description = await input({ message: 'Beskrivelse (valgfritt):' });
    const servings = await number({ message: 'Antall porsjoner:', default: 4, min: 1 });
    const tagsRaw = await input({ message: 'Tagger (kommaseparert, f.eks: kjøtt,rask):' });
    const tags = tagsRaw
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    // Ingredienser
    const ingredients: NewIngredient[] = [];
    console.log(chalk.dim('\n  Legg til ingredienser (tom linje for å avslutte):\n'));

    while (true) {
      const ingName = await input({ message: `  Ingrediens ${ingredients.length + 1} (Enter for ferdig):` });
      if (!ingName.trim()) break;

      const qty = await number({ message: '    Mengde:', min: 0, default: 1 });
      const unit = await select({
        message: '    Enhet:',
        choices: [
          { name: 'g (gram)', value: 'g' },
          { name: 'kg (kilo)', value: 'kg' },
          { name: 'dl (desiliter)', value: 'dl' },
          { name: 'l (liter)', value: 'l' },
          { name: 'ml (milliliter)', value: 'ml' },
          { name: 'stk (stykker)', value: 'stk' },
          { name: 'ss (spiseskje)', value: 'ss' },
          { name: 'ts (teskje)', value: 'ts' },
          { name: 'neve', value: 'neve' },
          { name: 'pakke', value: 'pakke' },
          { name: 'boks', value: 'boks' },
        ],
      });

      ingredients.push({
        name: ingName.trim(),
        quantity: qty ?? 1,
        unit,
      });
    }

    if (ingredients.length === 0) {
      const ok = await confirm({ message: 'Ingen ingredienser – vil du likevel lagre?', default: false });
      if (!ok) { console.log('Avbrutt.'); return; }
    }

    const recipe = createRecipe(
      { name: name.trim(), description: description.trim() || undefined, servings, tags },
      ingredients
    );

    console.log(
      chalk.green(
        `\n  ✓ Oppskrift "${recipe.name}" lagret med ${ingredients.length} ingredienser.\n`
      )
    );
  });

// plan oppskrift slett <navn>
oppskriftCommand
  .command('slett <navn>')
  .description('Slett en oppskrift')
  .action(async (navn: string) => {
    const recipe = getRecipeByName(navn);
    if (!recipe) {
      console.log(chalk.red(`  Oppskrift "${navn}" ikke funnet.`));
      return;
    }

    const ok = await confirm({
      message: `Vil du slette "${recipe.name}"?`,
      default: false,
    });

    if (!ok) { console.log('Avbrutt.'); return; }

    deleteRecipe(recipe.id);
    console.log(chalk.green(`\n  ✓ "${recipe.name}" er slettet.\n`));
  });

export default oppskriftCommand;

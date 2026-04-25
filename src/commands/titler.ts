import { Command } from 'commander';
import chalk from 'chalk';
import { scrapeRecipeTitles } from '../oda/scrape-titles.js';

const titlerCommand = new Command('titler')
  .description('Hent oppskriftstitler fra oda.no og lagre i fil')
  .option('-n, --antall <n>', 'Antall titler å hente', '50')
  .option('-o, --ut <fil>', 'Filsti for output', './data/titler.txt')
  .action(async (opts: { antall: string; ut: string }) => {
    const count = parseInt(opts.antall, 10);
    console.log(chalk.dim(`\n  Henter ${count} oppskriftstitler fra oda.no...\n`));

    const titles = await scrapeRecipeTitles(count, opts.ut);

    console.log(chalk.green(`  ✓ ${titles.length} titler lagret i ${opts.ut}`));
    console.log();
  });

export default titlerCommand;

#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('plan')
  .description('MatvarePlanlegger – norsk ukemeny-planlegger med Oda.no-integrasjon')
  .version('1.0.0');

// Last inn kommandoer
const [
  planMod,
  suggestMod,
  bestillMod,
  oppskriftMod,
  historikkMod,
  konfigurerMod,
  seedMod,
] = await Promise.all([
  import('./commands/plan.js'),
  import('./commands/suggest.js'),
  import('./commands/bestill.js'),
  import('./commands/oppskrift.js'),
  import('./commands/historikk.js'),
  import('./commands/konfigurer.js'),
  import('./commands/seed.js'),
]);

program.addCommand(planMod.default);
program.addCommand(suggestMod.default);
program.addCommand(bestillMod.default);
program.addCommand(oppskriftMod.default);
program.addCommand(historikkMod.default);
program.addCommand(konfigurerMod.default);
program.addCommand(seedMod.default);

program.parse();

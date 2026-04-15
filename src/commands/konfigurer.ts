import { Command } from 'commander';
import chalk from 'chalk';
import { getConfig, setConfig } from '../db/preferences.js';
import { number, input, select } from '@inquirer/prompts';

const konfigurerCommand = new Command('konfigurer')
  .description('Konfigurer husholdningsstørrelse og preferanser')
  .action(async () => {
    const config = getConfig();

    console.log(chalk.bold.cyan('\n  Konfigurasjon\n'));
    console.log(chalk.dim(`  Nåværende innstillinger:`));
    console.log(
      `  Husholdningsstørrelse:  ${config.householdSize} personer`
    );
    console.log(`  Planlegg dager per uke: ${config.planDays}`);
    console.log(
      `  Matpreferanser:         ${config.dietary.join(', ') || '(ingen)'}`
    );
    console.log('');

    const householdSize = await number({
      message: 'Husholdningsstørrelse (antall personer):',
      default: config.householdSize,
      min: 1,
      max: 20,
    });
    setConfig('household_size', String(householdSize ?? config.householdSize));

    const planDays = await select({
      message: 'Antall middager å planlegge per uke:',
      default: config.planDays,
      choices: [
        { name: '5 (mandag–fredag)', value: 5 },
        { name: '6 (mandag–lørdag)', value: 6 },
        { name: '7 (hele uken)', value: 7 },
      ],
    });
    setConfig('plan_days', String(planDays));

    const dietaryRaw = await input({
      message:
        'Matpreferanser/tagger å prioritere (kommaseparert, tom for ingen):',
      default: config.dietary.join(', '),
    });
    const dietary = dietaryRaw
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    setConfig('dietary', JSON.stringify(dietary));

    console.log(chalk.green('\n  ✓ Innstillinger lagret.\n'));
  });

export default konfigurerCommand;

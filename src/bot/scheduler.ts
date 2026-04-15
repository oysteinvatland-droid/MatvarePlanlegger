import cron from 'node-cron';
import { runFridayAgent } from './agent.js';
import { sendToDiscord } from './discord.js';
import { seedRecipesNonDestructive } from '../commands/seed.js';

/**
 * Start den automatiske fredag-scheduleren.
 * Kjører kl. 08:00 hver fredag.
 */
export function startScheduler(): void {
  // Cron-uttrykk: 0 8 * * 5 = kl. 08:00 hver fredag
  const task = cron.schedule('0 8 * * 5', async () => {
    console.log('Fredag-agent starter...');
    try {
      await sendToDiscord('Starter ukentlig planlegging og bestilling...');
      const summary = await runFridayAgent();
      await sendToDiscord(summary);
    } catch (err) {
      const msg = `Feil under fredag-planlegging: ${String(err)}`;
      console.error(msg);
      await sendToDiscord(`⚠️ ${msg}`);
    }
  }, {
    timezone: 'Europe/Oslo',
  });

  task.start();
  console.log('Fredag-scheduler startet (kl. 08:00 norsk tid).');

  // Tirsdag kl. 07:00 – oppdater oppskriftslisten automatisk
  const seedTask = cron.schedule('0 7 * * 2', async () => {
    console.log('Tirsdag-seed starter...');
    try {
      const { added, skipped } = await seedRecipesNonDestructive({ wanted: 10, scanCount: 30 });
      if (added > 0) {
        await sendToDiscord(`Oppskriftsliste oppdatert: ${added} nye oppskrifter lagt til (${skipped} utsolgte hoppet over).`);
      }
    } catch (err) {
      console.error('Feil ved automatisk seed:', err);
    }
  }, {
    timezone: 'Europe/Oslo',
  });

  seedTask.start();
  console.log('Tirsdag-seed startet (kl. 07:00 norsk tid).');
}

/**
 * Kjør fredag-agenten manuelt (for testing).
 */
export async function triggerFridayAgentManually(): Promise<void> {
  console.log('Manuell kjøring av fredag-agent...');
  await sendToDiscord('Manuell kjøring av planlegging og bestilling...');
  const summary = await runFridayAgent();
  await sendToDiscord(summary);
}

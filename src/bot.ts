import 'dotenv/config';
import { startDiscordBot } from './bot/discord.js';
import { startScheduler } from './bot/scheduler.js';

async function main() {
  console.log('Starter MatvarePlanlegger Discord-bot...');

  // Start Discord-boten
  await startDiscordBot();

  // Start fredag-scheduleren
  startScheduler();

  console.log('Boten kjører. Trykk Ctrl+C for å stoppe.');
}

main().catch(err => {
  console.error('Fatal feil ved oppstart:', err);
  process.exit(1);
});

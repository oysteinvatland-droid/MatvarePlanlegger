import cron, { type ScheduledTask } from 'node-cron';
import { runFridayAgent } from './agent.js';
import { sendToDiscord } from './discord.js';
import { seedRecipesNonDestructive } from '../commands/seed.js';
import { getDb } from '../db/client.js';
import { setConfig } from '../db/preferences.js';

let fridayTask: ScheduledTask | null = null;
let tuesdayTask: ScheduledTask | null = null;

const DEFAULT_FRIDAY_TIME = '08:00';
const DEFAULT_TUESDAY_TIME = '07:00';

export interface ScheduleTimes {
  friday: string;   // HH:MM
  tuesday: string;  // HH:MM
}

export function getScheduleTimes(): ScheduleTimes {
  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM config WHERE key IN ('schedule_friday_time', 'schedule_tuesday_time')")
    .all() as { key: string; value: string }[];
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    friday: map['schedule_friday_time'] ?? DEFAULT_FRIDAY_TIME,
    tuesday: map['schedule_tuesday_time'] ?? DEFAULT_TUESDAY_TIME,
  };
}

export function setScheduleTime(job: 'fredag' | 'tirsdag', time: string): void {
  const key = job === 'fredag' ? 'schedule_friday_time' : 'schedule_tuesday_time';
  setConfig(key, time);
  restartScheduler();
}

function timeToCron(time: string, dayOfWeek: number): string {
  const [hourStr, minuteStr] = time.split(':');
  const hour = parseInt(hourStr ?? '8', 10);
  const minute = parseInt(minuteStr ?? '0', 10);
  return `${minute} ${hour} * * ${dayOfWeek}`;
}

export function startScheduler(): void {
  restartScheduler();
}

export function restartScheduler(): void {
  fridayTask?.stop();
  tuesdayTask?.stop();

  const times = getScheduleTimes();

  fridayTask = cron.schedule(timeToCron(times.friday, 5), async () => {
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
  }, { timezone: 'Europe/Oslo' });

  tuesdayTask = cron.schedule(timeToCron(times.tuesday, 2), async () => {
    console.log('Tirsdag-seed starter...');
    try {
      const { added, skipped } = await seedRecipesNonDestructive({ wanted: 10 });
      if (added > 0) {
        await sendToDiscord(`Oppskriftsliste oppdatert: ${added} nye oppskrifter lagt til (${skipped} hoppet over).`);
      }
    } catch (err) {
      console.error('Feil ved automatisk seed:', err);
    }
  }, { timezone: 'Europe/Oslo' });

  fridayTask.start();
  tuesdayTask.start();

  console.log(`Fredag-scheduler startet (kl. ${times.friday} norsk tid).`);
  console.log(`Tirsdag-seed startet (kl. ${times.tuesday} norsk tid).`);
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

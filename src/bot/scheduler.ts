import cron, { type ScheduledTask } from 'node-cron';
import { runFridayAgent } from './agent.js';
import { sendToDiscord } from './discord.js';
import { seedRecipesNonDestructive } from '../commands/seed.js';
import { getDb } from '../db/client.js';
import { setConfig } from '../db/preferences.js';

let weeklyTask: ScheduledTask | null = null;

const DEFAULT_SCHEDULE_TIME = '08:00';
const DEFAULT_SCHEDULE_DAY = '5'; // fredag

export interface ScheduleConfig {
  time: string;  // HH:MM
  day: string;   // 0–6 (søndag–lørdag)
}

export function getScheduleConfig(): ScheduleConfig {
  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM config WHERE key IN ('schedule_time', 'schedule_day')")
    .all() as { key: string; value: string }[];
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    time: map['schedule_time'] ?? DEFAULT_SCHEDULE_TIME,
    day: map['schedule_day'] ?? DEFAULT_SCHEDULE_DAY,
  };
}

const DAY_NAMES: Record<string, string> = {
  '0': 'søndag', '1': 'mandag', '2': 'tirsdag', '3': 'onsdag',
  '4': 'torsdag', '5': 'fredag', '6': 'lørdag',
};

export function setScheduleTime(time: string): void {
  setConfig('schedule_time', time);
  restartScheduler();
}

export function setScheduleDay(day: string): void {
  setConfig('schedule_day', day);
  restartScheduler();
}

function timeToCron(time: string, dayOfWeek: string): string {
  const [hourStr, minuteStr] = time.split(':');
  const hour = parseInt(hourStr ?? '8', 10);
  const minute = parseInt(minuteStr ?? '0', 10);
  return `${minute} ${hour} * * ${dayOfWeek}`;
}

export function startScheduler(): void {
  restartScheduler();
}

export function restartScheduler(): void {
  weeklyTask?.stop();

  const config = getScheduleConfig();

  weeklyTask = cron.schedule(timeToCron(config.time, config.day), async () => {
    console.log('Ukentlig jobb starter: seed + planlegging + bestilling...');
    try {
      await sendToDiscord('Starter ukentlig oppdatering: henter nye oppskrifter, planlegger og bestiller...');

      const { added, skipped } = await seedRecipesNonDestructive({ wanted: 20 });
      if (added > 0) {
        await sendToDiscord(`${added} nye oppskrifter lagt til (${skipped} hoppet over). Starter planlegging...`);
      } else {
        await sendToDiscord(`Ingen nye oppskrifter funnet (${skipped} hoppet over). Starter planlegging...`);
      }

      const summary = await runFridayAgent();
      await sendToDiscord(summary);
    } catch (err) {
      const msg = `Feil under ukentlig jobb: ${String(err)}`;
      console.error(msg);
      await sendToDiscord(`⚠️ ${msg}`);
    }
  }, { timezone: 'Europe/Oslo' });

  weeklyTask.start();

  const dayName = DAY_NAMES[config.day] ?? config.day;
  console.log(`Ukentlig jobb startet: ${dayName} kl. ${config.time} (norsk tid).`);
}

export async function triggerWeeklyJobManually(): Promise<void> {
  console.log('Manuell kjøring av ukentlig jobb...');
  await sendToDiscord('Manuell kjøring: henter oppskrifter, planlegger og bestiller...');

  const { added, skipped } = await seedRecipesNonDestructive({ wanted: 20 });
  if (added > 0) {
    await sendToDiscord(`${added} nye oppskrifter lagt til (${skipped} hoppet over). Starter planlegging...`);
  }

  const summary = await runFridayAgent();
  await sendToDiscord(summary);
}

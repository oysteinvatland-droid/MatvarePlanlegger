import chalk from 'chalk';
import type { WeeklyPlanEntry } from '../planner/week.js';

/**
 * Skriv ut ukeplanen som en pen terminalvisning
 */
export function printWeeklyPlan(
  weekStart: string,
  entries: WeeklyPlanEntry[],
  planDays: number = 5
): void {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + planDays - 1);

  console.log('');
  console.log(
    chalk.bold.cyan(`  Ukeplan uke ${getWeekNumber(weekStart)}  `) +
      chalk.gray(`(${formatDate(weekStart)} – ${formatDate(weekEnd.toISOString().split('T')[0]!)})`)
  );
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  for (let i = 0; i < planDays; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const day = chalk.bold(entry.dayName.padEnd(10));
    const meal = entry.recipeName
      ? chalk.white(entry.recipeName)
      : chalk.dim('(tom)');
    console.log(`  ${day}  ${meal}`);
  }

  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log('');
}

/**
 * Skriv ut forslagsliste
 */
export function printSuggestions(
  suggestions: { name: string; score: number; tags: string[]; lastCooked?: string | null }[]
): void {
  console.log('');
  console.log(chalk.bold.cyan('  Middagsforslag:'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  suggestions.forEach((s, i) => {
    const num = chalk.cyan(`  ${i + 1}.`);
    const name = chalk.white.bold(s.name.padEnd(30));
    const tags = chalk.dim(s.tags.join(', '));
    const lastStr = s.lastCooked
      ? chalk.dim(`Sist: ${formatDate(s.lastCooked)}`)
      : chalk.dim('Aldri laget');
    console.log(`${num} ${name} ${tags}`);
    console.log(`     ${lastStr}`);
  });

  console.log('');
}

function getWeekNumber(dateStr: string): number {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((d.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7
    )
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('nb-NO', {
    day: 'numeric',
    month: 'short',
  });
}

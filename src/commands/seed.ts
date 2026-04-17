import { Command } from 'commander';
import chalk from 'chalk';
import type { Page } from 'playwright';
import { getDb } from '../db/client.js';
import { getGlutenKeywords } from '../db/preferences.js';
import { getBrowserContext, closeBrowser } from '../oda/client.js';

const RECIPES_BASE = 'https://oda.com/no/recipes/all/?filters=meal%3A65';
const MAX_SCAN = 200;

export interface SeedOptions {
  wanted?: number;
  maxPrice?: number;
  onProgress?: (msg: string) => void;
}

export interface SeedResult {
  added: number;
  skipped: number;
  duplicates: number;
  totalScanned: number;
  stopReason: 'done' | 'no-more-recipes' | 'max-scan-reached';
}

async function gotoWithRetry(
  page: Page,
  url: string,
  log?: (msg: string) => void,
  maxAttempts = 2,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return;
    } catch (err) {
      if (attempt < maxAttempts) {
        log?.(`Retry ${attempt}/${maxAttempts - 1} for ${url}`);
        await page.waitForTimeout(3000);
      } else {
        throw err;
      }
    }
  }
}

/**
 * Hent nye oppskrifter fra oda.no uten å slette eksisterende data.
 * Fortsetter å hente (med scroll) til wanted er lagt til eller ingen flere finnes.
 */
export async function seedRecipesNonDestructive(opts: SeedOptions = {}): Promise<SeedResult> {
  const wanted = opts.wanted ?? 10;
  const maxPrice = opts.maxPrice ?? null;
  const log = opts.onProgress ?? ((msg: string) => console.log(`[seed] ${msg}`));

  const glutenKeywords = getGlutenKeywords();
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO recipes (name, oda_url, tags, price) VALUES (?, ?, ?, ?)`
  );

  const context = await getBrowserContext();
  const listPage = await context.newPage();
  const recipePage = await context.newPage();

  try {
    let added = 0;
    let skipped = 0;
    let duplicates = 0;
    let totalScanned = 0;
    let page = 1;
    let stopReason: SeedResult['stopReason'] = 'done';
    let cookieHandled = false;

    while (added < wanted && totalScanned < MAX_SCAN) {
      const url = `${RECIPES_BASE}&page=${page}`;
      log(`Side ${page}… (${added}/${wanted} lagt til så langt)`);
      await gotoWithRetry(listPage, url, log);
      await listPage.waitForSelector('[data-testid^="recipe-tile"]', { timeout: 15000 }).catch(() => {});

      if (!cookieHandled) {
        const cookieBtn = listPage.getByRole('button', { name: /godkjenn alle/i });
        if (await cookieBtn.count() > 0) await cookieBtn.click();
        cookieHandled = true;
      }

      const cards = await listPage.evaluate(() => {
        const tiles = document.querySelectorAll('[data-testid^="recipe-tile"]');
        return Array.from(tiles).map(card => ({
          name: card.getAttribute('aria-label')?.replace(/ - \d+.*$/, '').trim() ?? '',
          url: 'https://oda.com' + (card.querySelector('a')?.getAttribute('href') ?? ''),
        })).filter(r => r.name && r.url);
      });

      if (cards.length === 0) {
        stopReason = 'no-more-recipes';
        log(`Ingen oppskrifter på side ${page} – Oda har ikke flere`);
        break;
      }

      for (const candidate of cards) {
        if (added >= wanted) break;
        if (totalScanned >= MAX_SCAN) {
          stopReason = 'max-scan-reached';
          break;
        }
        totalScanned++;
        log(`[${totalScanned}] Sjekker: ${candidate.name}…`);

        await recipePage.waitForTimeout(1000 + Math.random() * 1000);
        const info = await getRecipeInfo(recipePage, candidate.url, glutenKeywords);

        if (info.unavailable.length > 0) {
          skipped++;
          log(`Utsolgt: ${candidate.name}`);
          continue;
        }
        if (info.glutenIngredients.length > 0) {
          skipped++;
          log(`Gluten: ${candidate.name} (${info.glutenIngredients.join(', ')})`);
          continue;
        }
        if (maxPrice !== null && info.price !== null && info.price > maxPrice) {
          skipped++;
          log(`For dyr: ${candidate.name} (${info.price} kr)`);
          continue;
        }

        const result = insert.run(candidate.name, candidate.url, JSON.stringify(info.tags), info.price);
        if (result.changes > 0) {
          added++;
          log(`Lagt til: ${candidate.name}${info.price !== null ? ` (${info.price} kr)` : ''}`);
        } else {
          duplicates++;
          log(`Allerede i databasen: ${candidate.name}`);
        }
      }

      page++;
    }

    if (added >= wanted) stopReason = 'done';
    else if (totalScanned >= MAX_SCAN) stopReason = 'max-scan-reached';

    return { added, skipped, duplicates, totalScanned, stopReason };
  } finally {
    await listPage.close();
    await recipePage.close();
    await closeBrowser();
  }
}


interface RecipeInfo {
  unavailable: string[];
  glutenIngredients: string[];
  tags: string[];
  price: number | null;
}

async function getRecipeInfo(page: Page, url: string, glutenKeywords: string[]): Promise<RecipeInfo> {
  await gotoWithRetry(page, url);
  await page.waitForSelector('a[href*="/products/"], tr', { timeout: 15000 }).catch(() => {});

  return page.evaluate((args: { glutenKeywords: string[] }): RecipeInfo => {
    const unavailable: string[] = [];
    const glutenIngredients: string[] = [];

    // Strategi 1: Tabellrader med ingredient-quantity-klasse
    const rows = Array.from(document.querySelectorAll('tr')).filter(
      tr => tr.querySelector('[class*="ingredient-quantity"]')
    );
    for (const tr of rows) {
      const text = tr.textContent ?? '';
      if (/utsolgt|utilgj|ikke tilgjengelig|midlertidig utilgjengelig/i.test(text)) {
        const cells = tr.querySelectorAll('td');
        unavailable.push(cells[1]?.textContent?.trim() ?? text.trim().slice(0, 50) ?? 'ukjent');
      }
      const lower = text.toLowerCase();
      for (const kw of args.glutenKeywords) {
        if (lower.includes(kw)) {
          const cells = tr.querySelectorAll('td');
          const name = cells[1]?.textContent?.trim() ?? text.trim().slice(0, 50);
          if (name) glutenIngredients.push(name);
          break;
        }
      }
    }

    if (unavailable.length === 0) {
      // Strategi 2: Produktlenker nær "utsolgt"-tekst
      const productLinks = Array.from(
        document.querySelectorAll('a[href*="/products/"]')
      ).filter(a => {
        const parts = (a.getAttribute('href') ?? '').replace(/\/$/, '').split('/').filter(Boolean);
        return parts.length >= 3;
      });

      for (const link of productLinks) {
        let container: Element = link;
        for (let i = 0; i < 5; i++) {
          if (!container.parentElement) break;
          container = container.parentElement;
        }
        if (/utsolgt|utilgj/i.test(container.textContent ?? '')) {
          const name = link.textContent?.trim();
          if (name && name.length > 1) unavailable.push(name);
        }
      }
    }

    // Hent kategori-tags
    const tags: string[] = [];
    const recipeLinks = Array.from(document.querySelectorAll('a[href*="/recipes/"]'));
    for (const a of recipeLinks) {
      const href = a.getAttribute('href') ?? '';
      const parts = href.replace(/\/$/, '').split('/').filter(Boolean);
      const lastPart = parts[parts.length - 1] ?? '';
      if (parts.length === 3 && !/^\d/.test(lastPart)) {
        const label = a.textContent?.trim();
        if (label && label.length > 0) tags.push(label);
      }
    }

    // Hent totalpris
    const priceText = document.querySelector('[data-testid="products-total"] .k-text-style--headline-m')?.textContent ?? null;
    const price = priceText ? parseFloat(priceText.replace(/[^\d,]/g, '').replace(',', '.')) : null;

    return {
      unavailable: [...new Set(unavailable)].filter(s => s.length > 0),
      glutenIngredients: [...new Set(glutenIngredients)].filter(s => s.length > 0),
      tags: [...new Set(tags)],
      price: price !== null && !isNaN(price) ? price : null,
    };
  }, { glutenKeywords });
}

const seedCommand = new Command('seed')
  .description('Hent middager fra oda.no og lagre i databasen (hopper over utsolgte)')
  .option('-n, --antall <n>', 'Antall oppskrifter å lagre', '10')
  .option('--max-pris <kr>', 'Hopp over oppskrifter dyrere enn dette (kr)')
  .action(async (opts: { antall: string; maxPris?: string }) => {
    const wanted = parseInt(opts.antall, 10);
    const maxPrice = opts.maxPris ? parseFloat(opts.maxPris) : undefined;
    console.log('\n  ' + chalk.dim(`Henter ${wanted} oppskrifter fra oda.no (fortsetter til målet er nådd)...`));

    const result = await seedRecipesNonDestructive({
      wanted,
      maxPrice,
      onProgress: (msg) => {
        if (msg.startsWith('Lagt til:')) {
          console.log(chalk.green(`  ✓ ${msg.replace('Lagt til: ', '')}`));
        } else if (msg.startsWith('Allerede i databasen:')) {
          console.log(chalk.dim(`  – ${msg}`));
        } else if (msg.startsWith('Side ')) {
          console.log(chalk.dim(`  ↓ ${msg}`));
        } else if (msg.startsWith('Ingen ')) {
          console.log(chalk.red(`  ✗ ${msg}`));
        } else {
          console.log(chalk.yellow(`  ⚠ ${msg}`));
        }
      },
    });

    const parts = [
      `${result.added} nye lagret`,
      result.duplicates > 0 ? `${result.duplicates} allerede i db` : null,
      result.skipped > 0 ? `${result.skipped} hoppet over` : null,
      `${result.totalScanned} skannet`,
    ].filter(Boolean).join(', ');

    console.log(chalk.dim(`\n  ${parts}`));
    if (result.stopReason === 'no-more-recipes') {
      console.log(chalk.yellow(`  Oda hadde ikke flere oppskrifter å laste.`));
    } else if (result.stopReason === 'max-scan-reached') {
      console.log(chalk.yellow(`  Sikkerhetsgrense nådd (${MAX_SCAN} skannet).`));
    }
    console.log();
  });

export default seedCommand;

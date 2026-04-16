import { Command } from 'commander';
import chalk from 'chalk';
import { chromium, type Page } from 'playwright';
import { getDb } from '../db/client.js';
import { getGlutenKeywords } from '../db/preferences.js';

const RECIPES_URL = 'https://oda.com/no/recipes/';

export interface SeedOptions {
  wanted?: number;
  scanCount?: number;
  maxPrice?: number;
  onProgress?: (msg: string) => void;
}

export interface SeedResult {
  added: number;
  skipped: number;
}

/**
 * Hent nye oppskrifter fra oda.no uten å slette eksisterende data.
 * Bruker INSERT OR IGNORE slik at duplikater hoppes over.
 * Scaner alle scanCount kandidater, sorterer på pris og lagrer de N billigste.
 */
export async function seedRecipesNonDestructive(opts: SeedOptions = {}): Promise<SeedResult> {
  const wanted = opts.wanted ?? 10;
  const scanCount = opts.scanCount ?? 30;
  const maxPrice = opts.maxPrice ?? null;
  const log = opts.onProgress ?? (() => {});

  const glutenKeywords = getGlutenKeywords();
  const browser = await chromium.launch({ headless: true });
  const listPage = await browser.newPage();
  const recipePage = await browser.newPage();

  try {
    await listPage.goto(RECIPES_URL, { waitUntil: 'networkidle', timeout: 30000 });

    const cookieBtn = listPage.getByRole('button', { name: /godkjenn alle/i });
    if (await cookieBtn.count() > 0) await cookieBtn.click();

    const candidates = await listPage.evaluate((max: number) => {
      const cards = document.querySelectorAll('[data-testid^="recipe-tile"]');
      return Array.from(cards).slice(0, max).map(card => ({
        name: card.getAttribute('aria-label')?.replace(/ - \d+.*$/, '').trim() ?? '',
        url: 'https://oda.com' + (card.querySelector('a')?.getAttribute('href') ?? ''),
      })).filter(r => r.name && r.url);
    }, scanCount);

    if (candidates.length === 0) return { added: 0, skipped: 0 };

    // Scan alle kandidater og samle tilgjengelige med pris
    const available: { name: string; url: string; price: number | null; tags: string[] }[] = [];
    let skipped = 0;

    for (const candidate of candidates) {
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
        log(`For dyr: ${candidate.name} (${info.price} kr > ${maxPrice} kr)`);
        continue;
      }

      // Filtrer på "Middag"-tag, men bare hvis vi faktisk fant tags
      if (info.tags.length > 0 && !info.tags.some(t => /middag/i.test(t))) {
        skipped++;
        log(`Ikke middag: ${candidate.name} (tags: ${info.tags.join(', ')})`);
        continue;
      }

      available.push({ name: candidate.name, url: candidate.url, price: info.price, tags: info.tags });
      log(`Tilgjengelig: ${candidate.name}${info.price !== null ? ` (${info.price} kr)` : ''}`);
    }

    // Sorter billigst-først (null-pris bakerst)
    available.sort((a, b) => {
      if (a.price === null && b.price === null) return 0;
      if (a.price === null) return 1;
      if (b.price === null) return -1;
      return a.price - b.price;
    });

    const db = getDb();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO recipes (name, oda_url, tags, price) VALUES (?, ?, ?, ?)`
    );

    let added = 0;
    for (const recipe of available.slice(0, wanted)) {
      const result = insert.run(recipe.name, recipe.url, JSON.stringify(recipe.tags), recipe.price);
      if (result.changes > 0) {
        added++;
        log(`Lagt til: ${recipe.name}${recipe.price !== null ? ` (${recipe.price} kr)` : ''}`);
      }
    }

    return { added, skipped };
  } finally {
    await browser.close();
  }
}

interface RecipeInfo {
  unavailable: string[];
  glutenIngredients: string[];
  tags: string[];
  price: number | null;
}

async function getRecipeInfo(page: Page, url: string, glutenKeywords: string[]): Promise<RecipeInfo> {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  return page.evaluate((args: { glutenKeywords: string[] }): RecipeInfo => {
    const unavailable: string[] = [];
    const glutenIngredients: string[] = [];

    // Strategi 1: Tabellrader med ingredient-quantity-klasse
    const rows = Array.from(document.querySelectorAll('tr')).filter(
      tr => tr.querySelector('[class*="ingredient-quantity"]')
    );
    for (const tr of rows) {
      const text = tr.textContent ?? '';
      if (/utsolgt|ikke tilgjengelig|midlertidig utilgjengelig/i.test(text)) {
        const cells = tr.querySelectorAll('td');
        unavailable.push(cells[1]?.textContent?.trim() ?? text.trim().slice(0, 50) ?? 'ukjent');
      }
      // Glutensjekk mot ingredienstekst
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
      // Strategi 2: Start fra produktlenker og sjekk om "utsolgt" finnes nær dem.
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
        if (/utsolgt/i.test(container.textContent ?? '')) {
          const name = link.textContent?.trim();
          if (name && name.length > 1) unavailable.push(name);
        }
      }
    }

    // Hent kategori-tags: Oda.no viser kategorier som lenker til /no/recipes/<kategori>/
    // Kategorilenker er korte stier uten tall i siste ledd (skiller fra oppskriftslenker som starter med siffer)
    const tags: string[] = [];
    const recipeLinks = Array.from(document.querySelectorAll('a[href*="/recipes/"]'));
    for (const a of recipeLinks) {
      const href = a.getAttribute('href') ?? '';
      const parts = href.replace(/\/$/, '').split('/').filter(Boolean);
      const lastPart = parts[parts.length - 1] ?? '';
      // Kategorilenker: /no/recipes/middag/ → siste ledd uten siffer i starten
      // Oppskriftslenker: /no/recipes/5289-laks/ → starter med siffer
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
  .option('--skann <n>', 'Antall oppskrifter å skanne fra listesiden', '30')
  .option('--max-pris <kr>', 'Hopp over oppskrifter dyrere enn dette (kr)')
  .action(async (opts: { antall: string; skann: string; maxPris?: string }) => {
    const wanted = parseInt(opts.antall, 10);
    const scanCount = parseInt(opts.skann, 10);
    const maxPrice = opts.maxPris ? parseFloat(opts.maxPris) : null;
    const glutenKeywords = getGlutenKeywords();
    console.log('\n  ' + chalk.dim(`Henter opp til ${scanCount} oppskrifter fra oda.no og sjekker tilgjengelighet...`));

    const browser = await chromium.launch({ headless: true });
    const listPage = await browser.newPage();
    const recipePage = await browser.newPage();

    try {
      await listPage.goto(RECIPES_URL, { waitUntil: 'networkidle', timeout: 30000 });

      const cookieBtn = listPage.getByRole('button', { name: /godkjenn alle/i });
      if (await cookieBtn.count() > 0) await cookieBtn.click();

      const candidates = await listPage.evaluate((max: number) => {
        const cards = document.querySelectorAll('[data-testid^="recipe-tile"]');
        return Array.from(cards).slice(0, max).map(card => ({
          name: card.getAttribute('aria-label')?.replace(/ - \d+.*$/, '').trim() ?? '',
          url: 'https://oda.com' + (card.querySelector('a')?.getAttribute('href') ?? ''),
        })).filter(r => r.name && r.url);
      }, scanCount);

      if (candidates.length === 0) {
        console.log(chalk.red('  Fant ingen oppskrifter på oda.no.'));
        return;
      }

      // Slett eksisterende data og forbered insert
      const db = getDb();
      db.exec('DELETE FROM meal_history');
      db.exec('DELETE FROM weekly_plans');
      db.exec('DELETE FROM preferences');
      db.exec('DELETE FROM ingredients');
      db.exec('DELETE FROM recipes');

      const insert = db.prepare(
        `INSERT INTO recipes (name, oda_url, tags, price) VALUES (?, ?, ?, ?)`
      );

      let added = 0;
      let skipped = 0;

      for (const candidate of candidates) {
        if (added >= wanted) break;

        process.stdout.write(chalk.dim(`  Sjekker: ${candidate.name}...`));
        const info = await getRecipeInfo(recipePage, candidate.url, glutenKeywords);

        if (info.unavailable.length > 0) {
          process.stdout.write('\r' + chalk.yellow(`  ⚠ Utsolgt: ${candidate.name} (${info.unavailable.join(', ')})`) + ' '.repeat(10) + '\n');
          skipped++;
          continue;
        }

        if (info.glutenIngredients.length > 0) {
          process.stdout.write('\r' + chalk.yellow(`  ⚠ Gluten: ${candidate.name} (${info.glutenIngredients.join(', ')})`) + ' '.repeat(10) + '\n');
          skipped++;
          continue;
        }

        if (maxPrice !== null && info.price !== null && info.price > maxPrice) {
          process.stdout.write('\r' + chalk.yellow(`  ⚠ For dyr: ${candidate.name} (${info.price} kr)`) + ' '.repeat(10) + '\n');
          skipped++;
          continue;
        }

        if (info.tags.length > 0 && !info.tags.some(t => /middag/i.test(t))) {
          process.stdout.write('\r' + chalk.yellow(`  ⚠ Ikke middag: ${candidate.name} (${info.tags.join(', ')})`) + ' '.repeat(10) + '\n');
          skipped++;
          continue;
        }

        const priceLabel = info.price !== null ? ` – ${info.price} kr` : '';
        const tagsLabel = info.tags.length > 0 ? ` [${info.tags.join(', ')}]` : '';
        process.stdout.write('\r' + chalk.green(`  ✓ ${candidate.name}${priceLabel}${tagsLabel}`) + ' '.repeat(10) + '\n');
        insert.run(candidate.name, candidate.url, JSON.stringify(info.tags), info.price);
        added++;
      }

      console.log(chalk.dim(`\n  ${added} oppskrifter lagret${skipped ? `, ${skipped} hoppet over` : ''}\n`));
    } finally {
      await browser.close();
    }
  });

export default seedCommand;

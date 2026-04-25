import { writeFileSync } from 'node:fs';
import { getBrowserContext, closeBrowser } from './client.js';

const BASE_URL = 'https://oda.com/no/recipes/all/?filters=meal%3A65';

export async function scrapeRecipeTitles(count: number, outPath: string): Promise<string[]> {
  const context = await getBrowserContext();
  const page = await context.newPage();
  const titles: string[] = [];
  let pageNum = 1;
  let cookieHandled = false;

  try {
    while (titles.length < count) {
      await page.goto(`${BASE_URL}&page=${pageNum}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await page.waitForSelector('[data-testid^="recipe-tile"]', { timeout: 15000 }).catch(() => {});

      if (!cookieHandled) {
        const cookieBtn = page.getByRole('button', { name: /godkjenn alle/i });
        if (await cookieBtn.count() > 0) await cookieBtn.click();
        cookieHandled = true;
      }

      const names = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid^="recipe-tile"]'))
          .map(el => el.getAttribute('aria-label')?.replace(/ - \d+.*$/, '').trim())
          .filter((n): n is string => !!n)
      );

      if (names.length === 0) break;

      for (const name of names) {
        if (titles.length >= count) break;
        titles.push(name);
      }

      pageNum++;
      await page.waitForTimeout(1000 + Math.random() * 1000);
    }

    writeFileSync(outPath, titles.join('\n') + '\n', 'utf-8');
    return titles;
  } finally {
    await page.close();
    await closeBrowser();
  }
}

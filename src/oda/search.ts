import type { Page } from 'playwright';

export interface OdaProduct {
  name: string;
  priceKr: number | null;  // pris i kroner, null hvis ikke funnet
  priceText: string;
  available: boolean;
  index: number;
}

const SEARCH_BASE = 'https://oda.com/no/search/products/?q=';

/**
 * Søk etter produkter på oda.no og returner topp N treff med pris og tilgjengelighet.
 */
export async function searchProducts(
  page: Page,
  query: string,
  maxResults = 10
): Promise<OdaProduct[]> {
  const url = `${SEARCH_BASE}${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  await page.waitForSelector('article[data-testid="product-tile"]', {
    timeout: 15000,
  }).catch(() => null);

  const products = await page.evaluate((max: number) => {
    const cards = document.querySelectorAll('article[data-testid="product-tile"]');
    const results: {
      name: string;
      priceText: string;
      available: boolean;
      index: number;
    }[] = [];

    Array.from(cards).slice(0, max).forEach((card, index) => {
      const name = card.getAttribute('aria-label') ?? '';
      const allText = card.textContent?.replace(/\s+/g, ' ').trim() ?? '';

      // Sjekk om utsolgt (ulike varianter)
      const available = !/utsolgt|ikke tilgjengelig|midlertidig utilgjengelig/i.test(allText);

      // Hent første pris fra teksten: f.eks. "64,90 kr" (ikke kr/kg)
      // Prøv data-testid først, ellers regex på tekst
      const priceEl = card.querySelector(
        '[data-testid="product-price"], [class*="CurrentPrice"], [class*="current-price"]'
      );
      let priceText = priceEl?.textContent?.trim() ?? '';

      if (!priceText) {
        // Hent første "XX,XX kr" eller "XXX kr" fra allText (ikke kr/kg-priser)
        const match = allText.match(/(\d[\d\s]*,\d{2})\s*kr(?!\s*\/)/);
        if (match) priceText = `${match[1]} kr`;
      }

      if (name) {
        results.push({ name, priceText, available, index });
      }
    });

    return results;
  }, maxResults);

  // Parse kroner til tall for sortering
  return products.map(p => ({
    ...p,
    priceKr: parsePrice(p.priceText),
  }));
}

function parsePrice(text: string): number | null {
  if (!text) return null;
  const match = text.replace(/\s/g, '').match(/(\d+),(\d{2})/);
  if (match) return parseInt(match[1]!, 10) + parseInt(match[2]!, 10) / 100;
  const intMatch = text.replace(/\s/g, '').match(/^(\d+)kr/);
  if (intMatch) return parseInt(intMatch[1]!, 10);
  return null;
}

/**
 * Velg billigste tilgjengelige produkt blant søkeresultatene.
 * Returnerer null hvis ingen er tilgjengelige.
 */
export function pickCheapest(products: OdaProduct[]): OdaProduct | null {
  const available = products.filter(p => p.available);
  if (available.length === 0) return null;

  // Sorter: produkter med kjent pris først, deretter etter pris
  const withPrice = available.filter(p => p.priceKr !== null);
  const withoutPrice = available.filter(p => p.priceKr === null);

  if (withPrice.length > 0) {
    return withPrice.sort((a, b) => a.priceKr! - b.priceKr!)[0]!;
  }
  return withoutPrice[0]!; // Ingen priser funnet, ta første tilgjengelige
}

/**
 * Legg til produkt direkte fra søkesiden.
 */
export async function addProductFromSearch(
  page: Page,
  productIndex: number
): Promise<boolean> {
  const cards = page.locator('article[data-testid="product-tile"]');
  const card = cards.nth(productIndex);
  const addBtn = card.locator('button[data-testid="cart-buttons-add"]');
  if ((await addBtn.count()) === 0) return false;
  await addBtn.click();
  await page.waitForTimeout(500);
  return true;
}

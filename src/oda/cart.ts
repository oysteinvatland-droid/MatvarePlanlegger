import type { Page } from 'playwright';

const PORTIONS = 5;

export interface CartResult {
  ok: boolean;
  unavailableIngredients: string[];
}

/**
 * Naviger til en oppskriftsside på Oda.no, sett porsjoner og legg til i handlekurven.
 * Returnerer ok=false med ingrediensnavn hvis noe er utsolgt.
 */
export async function addRecipeToCart(
  page: Page,
  odaUrl: string,
): Promise<CartResult> {
  await page.goto(odaUrl, { waitUntil: 'networkidle', timeout: 30000 });

  // Godkjenn cookies om nødvendig
  const cookieBtn = page.getByRole('button', { name: /godkjenn alle/i });
  if (await cookieBtn.count() > 0) await cookieBtn.click();

  // Sett porsjoner til PORTIONS
  const combobox = page.locator('#recipe-detail-portions-select');
  if (await combobox.count() > 0) {
    await combobox.click();
    await page.waitForTimeout(500);
    await page.locator('[role="listbox"] [role="option"]')
      .filter({ hasText: new RegExp(`^${PORTIONS} porsjoner$`) })
      .first()
      .click();
    await page.waitForTimeout(600);
  }

  // Sjekk ingrediensrader for utsolgte varer
  const unavailableIngredients = await page.evaluate((): string[] => {
    const results: string[] = [];

    // Strategi 1: Tabellrader med ingredient-quantity-klasse
    const rows = Array.from(document.querySelectorAll('tr')).filter(
      tr => tr.querySelector('[class*="ingredient-quantity"]')
    );
    for (const tr of rows) {
      if (/utsolgt|ikke tilgjengelig|midlertidig utilgjengelig/i.test(tr.textContent ?? '')) {
        const cells = tr.querySelectorAll('td');
        results.push(cells[1]?.textContent?.trim() ?? tr.textContent?.trim().slice(0, 50) ?? 'ukjent');
      }
    }
    if (results.length > 0) return results;

    // Strategi 2: Start fra produktlenker og sjekk om "utsolgt" finnes nær dem.
    // Kategorilenker (/products/snarveier/) filtreres ut – produktlenker har lengre URL-sti.
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
        if (name && name.length > 1) results.push(name);
      }
    }

    return [...new Set(results)].filter(s => s.length > 0);
  });

  if (unavailableIngredients.length > 0) {
    return { ok: false, unavailableIngredients };
  }

  // Klikk "Legg til i handlekurven"
  const addBtn = page.locator('button[data-testid="add-to-cart-button"]');
  if (await addBtn.count() === 0) return { ok: false, unavailableIngredients: [] };

  await addBtn.click();
  await page.waitForTimeout(800);
  return { ok: true, unavailableIngredients: [] };
}

/**
 * Naviger til et produkts side og legg det i handlekurven.
 * Brukes som fallback om direkte søk-knapp ikke virker.
 */
export async function addToCart(page: Page, productUrl: string): Promise<boolean> {
  await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const addButton = page.locator(
    'button[data-testid="cart-buttons-add"], button[aria-label*="Legg til i handlekurven"]'
  );

  if ((await addButton.count()) === 0) return false;

  await addButton.first().click();
  await page.waitForTimeout(500);
  return true;
}

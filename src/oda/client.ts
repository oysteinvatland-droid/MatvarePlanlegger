import { chromium, type Browser, type BrowserContext } from 'playwright';
import { existsSync } from 'node:fs';
import { SESSION_PATH } from '../config/paths.js';

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;

/**
 * Hent (eller opprett) en Playwright-nettleserkontekst.
 * Laster lagret session om tilgjengelig.
 */
export async function getBrowserContext(headless = true): Promise<BrowserContext> {
  if (_context) return _context;

  _browser = await chromium.launch({
    headless,
    executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] ?? undefined,
  });

  const storageState = existsSync(SESSION_PATH)
    ? SESSION_PATH
    : undefined;

  _context = await _browser.newContext({
    storageState,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'nb-NO',
    timezoneId: 'Europe/Oslo',
  });

  return _context;
}

/**
 * Lukk nettleseren og frigjør ressurser.
 */
export async function closeBrowser(): Promise<void> {
  if (_context) {
    await _context.close();
    _context = null;
  }
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

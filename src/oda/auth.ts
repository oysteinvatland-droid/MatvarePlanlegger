import type { BrowserContext, Page } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { SESSION_PATH } from '../config/paths.js';

const LOGIN_URL = 'https://oda.com/no/user/login/';

export async function ensureLoggedIn(
  context: BrowserContext,
  email: string,
  password: string
): Promise<Page> {
  const page = await context.newPage();

  // Naviger alltid til login-siden.
  // Hvis session er gyldig, blir vi omdirigert til forsiden direkte.
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Sjekk om vi allerede er innlogget (omdirigert bort fra login-siden)
  if (!page.url().includes('/login')) {
    return page;
  }

  // Vi er på login-siden – fyll inn og logg inn
  await page.waitForSelector('#email-input', { timeout: 10000 });
  await page.fill('#email-input', email);
  await page.fill('#password-input', password);
  await page.getByRole('button', { name: 'Logg inn' }).click();

  // Vent på omdirigering bort fra login-siden
  try {
    await page.waitForURL(url => !url.pathname.includes('/login'), {
      timeout: 15000,
    });
  } catch {
    throw new Error(
      'Innlogging feilet. Sjekk ODA_EMAIL og ODA_PASSWORD i .env-filen.'
    );
  }

  // Lagre session for neste gang
  mkdirSync(dirname(SESSION_PATH), { recursive: true });
  await context.storageState({ path: SESSION_PATH });

  return page;
}

export async function saveSession(context: BrowserContext): Promise<void> {
  mkdirSync(dirname(SESSION_PATH), { recursive: true });
  await context.storageState({ path: SESSION_PATH });
}

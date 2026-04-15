import { config } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

// Last inn .env fra prosjektrot
config({ path: resolve(process.cwd(), '.env') });

const OdaEnvSchema = z.object({
  ODA_EMAIL: z.string().email('ODA_EMAIL må være en gyldig e-postadresse'),
  ODA_PASSWORD: z.string().min(1, 'ODA_PASSWORD er påkrevd'),
  PLAYWRIGHT_HEADLESS: z.string().optional().transform(v => v !== 'false'),
  DATA_DIR: z.string().optional(),
});

export type OdaEnv = z.infer<typeof OdaEnvSchema>;

/**
 * Valider Oda.no-kredentialer. Kall kun fra bestill-kommandoen.
 * Feiler med tydelig feilmelding hvis .env mangler nødvendige felter.
 */
export function requireOdaCredentials(): OdaEnv {
  const result = OdaEnvSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map(i => `  - ${String(i.path[0])}: ${i.message}`)
      .join('\n');
    console.error('Manglende konfigurasjon for Oda.no.\n');
    console.error(`Opprett en .env-fil i prosjektmappen med:\n${missing}`);
    console.error('\nSe .env.example for mal.');
    process.exit(1);
  }
  return result.data;
}

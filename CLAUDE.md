# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev -- <kommando>   # Kjør CLI under utvikling (tsx, ingen build nødvendig)
npm run build               # Kompiler TypeScript til dist/
npm run start -- <kommando> # Kjør kompilert versjon
npm run bot                 # Start Discord-boten lokalt (tsx, ingen build nødvendig)
npm run oda:debug           # Start Playwright med synlig nettleser (PLAYWRIGHT_HEADLESS=false)
```

### CLI-kommandoer

```bash
npm run dev -- seed                        # Hent 10 oppskrifter fra oda.com/no/recipes/ (hopper over utsolgte)
npm run dev -- seed --antall 10 --skann 40 # Skann 40 kandidater, lagre 10 godkjente
npm run dev -- uke                         # Vis/fyll ukens middagsplan
npm run dev -- uke --endre                 # Endre én allerede satt dag
npm run dev -- uke --slett                 # Slett alle middager for uken
npm run dev -- forslag --antall 5          # Foreslå middager basert på historikk
npm run dev -- bestill                     # Legg ukens middager i Oda.no-handlekurven
npm run dev -- bestill --oppskrift "Navn"  # Bestill én spesifikk oppskrift
npm run dev -- oppskrift vis               # List alle oppskrifter
npm run dev -- historikk                   # Vis kokehistorikk
npm run dev -- konfigurer                  # Endre husholdningsstørrelse/preferanser
```

## Arkitektur

**ESM-only prosjekt** med `"type": "module"` og `"module": "NodeNext"`. Alle lokale imports må ha `.js`-suffiks (selv `.ts`-filer).

### To inngangspunkter

```
src/index.ts   → CLI (commander-basert, interaktiv terminal)
src/bot.ts     → Discord-bot (kjører som long-running prosess på Railway)
```

### Dataflyt – CLI

```
src/index.ts
  → commands/       Én fil per kommando, registrert med commander
  → db/             SQLite via node:sqlite (innebygd i Node.js v22+, IKKE better-sqlite3)
  → planner/        Forslagslogikk og ukemeny
  → oda/            Playwright-automatisering mot oda.no
  → ui/             Terminal-visning (spinner, tabell, prompts)
```

### Dataflyt – Discord-bot

```
src/bot.ts
  → bot/discord.ts      Discord.js-klient, lytter på meldinger i én kanal (DISCORD_CHANNEL_ID)
  → bot/agent.ts        Agentic loop mot Claude API (claude-opus-4-6) med tool use
  → bot/tools.ts        Verktøydefinisjoner og -implementasjoner Claude kan kalle
  → bot/scheduler.ts    cron-jobs: fredag kl. 08:00 planlegger+bestiller, tirsdag kl. 07:00 seeder nye oppskrifter
```

Boten holder samtalehistorikk per Discord-bruker i minnet (ikke persistert). Agenten bruker prompt caching på system-prompten (`cache_control: ephemeral`).

### Database

- Lagres i `~/.matvareplanlegger/data.db` lokalt, `/data/data.db` i produksjon (Railway persistent volume)
- Overstyres med `DATA_DIR`-env-variabel
- `getDb()` i `src/db/client.ts` er singleton – kjører automatisk SQL-migrasjoner fra `src/db/migrations/*.sql` i alfabetisk rekkefølge ved første kall
- Migrasjoner er idempotente via `_migrations`-tabell
- Ny migrasjon: opprett `src/db/migrations/00N_navn.sql`

### Brukerpreferanser

To parallelle mekanismer for preferanser:
- **`preferences.md`** (`/data/preferences.md`) – fritekstfil agenten leser og skriver. Brukes av Claude-agenten til å tolke og huske brukerønsker.
- **`config`-tabell i SQLite** – strukturert konfigurasjon: `household_size`, `plan_days`, `dietary` (JSON-array). Brukes av forslagsalgoritmen.

### Oppskrifter og Oda.no

Oppskrifter lagres kun med `name` og `oda_url` (ingen ingredienser lokalt). `seed`-kommandoen scraper `oda.com/no/recipes/` med Playwright, besøker hver oppskriftsside og hopper over de med utsolgte ingredienser. Skanner inntil `--skann` (standard 30) kandidater til `--antall` (standard 10) godkjente er funnet.

`bestill`-kommandoen:
1. Logger inn på `oda.com/no/user/login/` (session gjenbrukes fra `~/.matvareplanlegger/oda-session.json`)
2. Navigerer til oppskriftens `oda_url`
3. Setter porsjoner til 5 via Radix UI combobox (`#recipe-detail-portions-select`)
4. Skanner siden for utsolgte ingredienser med to strategier:
   - Strategi 1: `<tr>`-rader med `[class*="ingredient-quantity"]`
   - Strategi 2: `a[href*="/products/"]` med URL-sti ≥ 3 ledd (filtrerer kategorilenker som `/products/snarveier/`), går 5 DOM-nivåer opp og sjekker for "utsolgt"-tekst
5. Klikker `button[data-testid="add-to-cart-button"]` hvis ingen ingredienser er utsolgte

Samme utsolgt-logikk brukes i både `seed` og `bestill` – hold dem i sync.

### Forslagsalgoritme

`src/planner/scorer.ts` scorer oppskrifter: **RecencyScore (0–50) + PreferenceScore (0–40) + TagScore (0–10)**

- Laget for < 7 dager siden → ekskludert
- `frequency='never'` eller `liked=false` → ekskludert
- `src/planner/engine.ts` håndhever diversitet: maks 2 oppskrifter med samme tag per forslag

### Kredentialer

Kun `bestill`-kommandoen og Discord-boten krever `.env`. CLI-kommandoene fungerer uten. Opprett `.env` fra `.env.example`:

```
ODA_EMAIL=din@epost.no
ODA_PASSWORD=dittpassord
ANTHROPIC_API_KEY=sk-...
DISCORD_TOKEN=...
DISCORD_CHANNEL_ID=...
PLAYWRIGHT_HEADLESS=false   # valgfri, for debugging
```

`requireOdaCredentials()` i `src/config/env.ts` validerer med zod og avslutter prosessen med tydelig feilmelding hvis felter mangler.

### Docker / Railway

Playwright bruker sin egen nedlastede Chromium (`npx playwright install --with-deps chromium` i Dockerfile). `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` skal **ikke** settes. Railway krever et persistent volume mountet på `/data` for at databasen og preferences.md skal overleve redeploys.

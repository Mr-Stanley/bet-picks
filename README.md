# Daily Picks

A Next.js dashboard with one button: click it, and it pulls today's football,
basketball and tennis odds from real bookmakers, scores each match by
cross-bookmaker consensus, and builds combo slips targeting 2x, 5x, 50x, 100x
and 1000x odds. Everything is saved to Supabase. You copy a slip and enter it
into your betting app yourself - nothing here logs into or places bets on any
betting platform.

## Read this first

This tool scores matches using **odds consensus** (how tightly bookmakers
agree on a price, and how many books quote it) - not team form, injuries, or
head-to-head stats. That's an honest, real signal, but it is not the same as
deep scouting data, and it says nothing at all about whether a 1000x
accumulator will land. Combined odds are just multiplication: an 8-leg combo
at ~2.0 average odds pays ~256x, and needs all 8 legs to win. The app shows
the true implied probability next to every combo tier for exactly this
reason - please actually read it before staking anything.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- Supabase (Postgres) for persistence, no auth (single-user tool)
- [The Odds API](https://the-odds-api.com) free tier for live odds across
  football, basketball, tennis
- Deploy target: Vercel

## Setup

### 1. Get a free odds API key
Sign up at https://the-odds-api.com - the free tier gives 500 requests/month.

### 2. Create a Supabase project
1. Create a project at https://supabase.com
2. Open the SQL editor and run everything in `supabase/schema.sql`
3. Go to Project Settings -> API and grab:
   - Project URL
   - `service_role` key (secret - used server-side only)
   - `anon` public key

### 3. Configure environment variables
Copy `.env.example` to `.env.local` and fill in all five values.

### 4. Run locally
```bash
npm install
npm run dev
```
Open http://localhost:3000 and click "Run today's analysis."

## Disclaimer

This is a research and organization tool. It does not predict outcomes with
certainty, does not place bets, and does not interact with any betting
platform. All betting decisions and all bet placement are entirely up to you.

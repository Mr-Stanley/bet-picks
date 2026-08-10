// Wrapper around The Odds API (https://the-odds-api.com), which has a free tier
// (500 requests/month) and covers football, basketball and tennis odds pulled
// from many real bookmakers. It does not carry team-form/injury data, so the
// confidence score in lib/scoring.ts is built from cross-bookmaker consensus
// rather than deep statistical modelling -- see the README for how to extend
// this with a stats provider if you want richer signals.
//
// Featured markets (h2h / spreads / totals) come from the bulk /odds endpoint
// for every active Soccer / Basketball / Tennis league. Cards, quarter, and
// set markets require the per-event endpoint and are fetched for a small
// capped sample so a free-tier key isn't burned in one run.

const BASE_URL = "https://api.the-odds-api.com/v4";

export type BookmakerPrice = {
  bookmaker: string;
  price: number; // decimal odds
};

export type MarketKey = string;

export type NormalizedOutcome = {
  market: MarketKey;
  selection: string;
  point: number | null;
  prices: BookmakerPrice[];
  bestPrice: number;
  numBooks: number;
  priceSpread: number;
};

export type NormalizedMatch = {
  eventId: string;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  outcomes: NormalizedOutcome[];
  raw: unknown;
};

type SportEntry = {
  key: string;
  group: string;
  active: boolean;
  has_outrights?: boolean;
};

const TARGET_GROUPS = ["Soccer", "Basketball", "Tennis"] as const;

const ODDS_FETCH_CONCURRENCY = 8;
const MAX_EXTRA_EVENTS_PER_GROUP = 2;

const FEATURED_MARKETS = "h2h,spreads,totals";

const EXTRA_MARKETS_BY_GROUP: Record<(typeof TARGET_GROUPS)[number], string> = {
  Soccer: "alternate_totals_cards,btts",
  Basketball: "h2h_q1,totals_q1,spreads_q1",
  Tennis: "spreads_s1,totals_s1,h2h_s1",
};

function regionsForGroup(group: string): string {
  if (group === "Basketball") return "us";
  return "eu";
}

function groupForSportKey(sportKey: string): (typeof TARGET_GROUPS)[number] | null {
  if (sportKey.startsWith("soccer_")) return "Soccer";
  if (sportKey.startsWith("basketball_")) return "Basketball";
  if (sportKey.startsWith("tennis_")) return "Tennis";
  return null;
}

function formatSelection(
  market: string,
  name: string,
  point?: number | null,
  description?: string
): string {
  const pointSuffix =
    point === null || point === undefined
      ? ""
      : ` ${point > 0 ? `+${point}` : String(point)}`;

  if (market === "btts") return `BTTS ${name}`;
  if (market.includes("cards")) {
    return description
      ? `Cards ${description} ${name}${pointSuffix}`.trim()
      : `Cards ${name}${pointSuffix}`.trim();
  }
  if (market.startsWith("totals") || market.includes("totals")) {
    return `${name}${point === null || point === undefined ? "" : ` ${point}`}`;
  }
  if (market.startsWith("spreads") || market.includes("spreads")) {
    return `${name}${pointSuffix}`;
  }
  if (description) return `${description} ${name}${pointSuffix}`.trim();
  return `${name}${pointSuffix}`.trim();
}

function outcomeKey(
  market: string,
  name: string,
  point?: number | null,
  description?: string
): string {
  return [market, name, point ?? "", description ?? ""].join("|");
}

export function marketLabel(market: string): string {
  const labels: Record<string, string> = {
    h2h: "Match winner",
    spreads: "Handicap",
    totals: "Total",
    btts: "Both teams to score",
    alternate_totals_cards: "Cards O/U",
    alternate_spreads_cards: "Cards handicap",
    h2h_q1: "Q1 winner",
    totals_q1: "Q1 total",
    spreads_q1: "Q1 handicap",
    h2h_s1: "Set 1 winner",
    spreads_s1: "Set 1 game handicap",
    totals_s1: "Set 1 games O/U",
  };
  return labels[market] ?? market;
}

function aggregateBookmakerMarkets(event: any): NormalizedOutcome[] {
  const outcomeMap = new Map<
    string,
    {
      market: string;
      selection: string;
      point: number | null;
      prices: BookmakerPrice[];
    }
  >();

  for (const bookmaker of event.bookmakers ?? []) {
    for (const market of bookmaker.markets ?? []) {
      for (const outcome of market.outcomes ?? []) {
        const point = typeof outcome.point === "number" ? outcome.point : null;
        const description =
          typeof outcome.description === "string" ? outcome.description : undefined;
        const key = outcomeKey(market.key, outcome.name, point, description);
        const selection = formatSelection(market.key, outcome.name, point, description);
        const entry = outcomeMap.get(key) ?? {
          market: market.key,
          selection,
          point,
          prices: [] as BookmakerPrice[],
        };
        entry.prices.push({ bookmaker: bookmaker.title, price: outcome.price });
        outcomeMap.set(key, entry);
      }
    }
  }

  return Array.from(outcomeMap.values()).map((o) => {
    const priceVals = o.prices.map((p) => p.price);
    return {
      market: o.market,
      selection: o.selection,
      point: o.point,
      prices: o.prices,
      bestPrice: Math.max(...priceVals),
      numBooks: o.prices.length,
      priceSpread: Math.max(...priceVals) - Math.min(...priceVals),
    };
  });
}

function toNormalizedMatch(event: any): NormalizedMatch {
  return {
    eventId: event.id,
    sport: event.sport_key,
    league: event.sport_title,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    commenceTime: event.commence_time,
    outcomes: aggregateBookmakerMarkets(event),
    raw: event,
  };
}

export async function fetchActiveSports(apiKey: string): Promise<SportEntry[]> {
  const res = await fetch(`${BASE_URL}/sports?apiKey=${apiKey}`);
  if (!res.ok) {
    throw new Error(`Odds API /sports failed: ${res.status} ${await res.text()}`);
  }
  const all: SportEntry[] = await res.json();
  return all.filter(
    (s) =>
      s.active &&
      TARGET_GROUPS.includes(s.group as (typeof TARGET_GROUPS)[number]) &&
      !s.key.includes("winner") &&
      !s.key.includes("outright")
  );
}

export async function fetchOddsForSport(
  apiKey: string,
  sportKey: string,
  group: string
): Promise<{ matches: NormalizedMatch[]; status: number; quotaExhausted: boolean }> {
  const regions = regionsForGroup(group);
  const url = `${BASE_URL}/sports/${sportKey}/odds?apiKey=${apiKey}&regions=${regions}&markets=${FEATURED_MARKETS}&oddsFormat=decimal`;
  const res = await fetch(url);
  if (!res.ok) {
    let quotaExhausted = res.status === 401 || res.status === 429;
    try {
      const body = await res.json();
      if (
        body?.error_code === "OUT_OF_USAGE_CREDITS" ||
        String(body?.message ?? "").toLowerCase().includes("quota")
      ) {
        quotaExhausted = true;
      }
    } catch {
      /* ignore body parse */
    }
    console.warn(`Odds API failed for ${sportKey}: ${res.status}`);
    return { matches: [], status: res.status, quotaExhausted };
  }
  const events = await res.json();
  return {
    matches: (events as any[]).map(toNormalizedMatch),
    status: res.status,
    quotaExhausted: false,
  };
}

async function fetchEventExtraMarkets(
  apiKey: string,
  sportKey: string,
  eventId: string,
  group: (typeof TARGET_GROUPS)[number]
): Promise<NormalizedOutcome[]> {
  const markets = EXTRA_MARKETS_BY_GROUP[group];
  const regions = regionsForGroup(group);
  const url = `${BASE_URL}/sports/${sportKey}/events/${eventId}/odds?apiKey=${apiKey}&regions=${regions}&markets=${markets}&oddsFormat=decimal`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`Odds API event extras failed for ${sportKey}/${eventId}: ${res.status}`);
    return [];
  }
  const event = await res.json();
  return aggregateBookmakerMarkets(event).filter((o) =>
    markets.split(",").includes(o.market)
  );
}

function mergeOutcomes(
  base: NormalizedOutcome[],
  extra: NormalizedOutcome[]
): NormalizedOutcome[] {
  const keyOf = (o: NormalizedOutcome) => `${o.market}|${o.selection}|${o.point ?? ""}`;
  const map = new Map(base.map((o) => [keyOf(o), o]));
  for (const o of extra) map.set(keyOf(o), o);
  return Array.from(map.values());
}

async function mapInBatches<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

/** Prefer major / high-liquidity leagues first so free-tier quota lasts longer. */
const PRIORITY_SPORT_KEYS = [
  "soccer_epl",
  "soccer_spain_la_liga",
  "soccer_italy_serie_a",
  "soccer_germany_bundesliga",
  "soccer_france_ligue_one",
  "soccer_uefa_champs_league",
  "soccer_uefa_europa_league",
  "soccer_usa_mls",
  "soccer_efl_champ",
  "basketball_nba",
  "basketball_euroleague",
  "tennis_atp_aus_open_singles",
  "tennis_wta_aus_open_singles",
];

function maxSportsPerRun(): number {
  const n = Number(process.env.ODDS_MAX_SPORTS_PER_RUN ?? "12");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 12;
}

function prioritizeSports(sports: SportEntry[]): SportEntry[] {
  const limit = maxSportsPerRun();
  const ranked = [...sports].sort((a, b) => {
    const ai = PRIORITY_SPORT_KEYS.indexOf(a.key);
    const bi = PRIORITY_SPORT_KEYS.indexOf(b.key);
    const ap = ai === -1 ? 999 : ai;
    const bp = bi === -1 ? 999 : bi;
    return ap - bp;
  });
  return ranked.slice(0, limit);
}

/** Fetches odds across football/basketball/tennis for matches starting in the next 24h. */
export async function fetchTodaysOdds(apiKey: string): Promise<NormalizedMatch[]> {
  const sports = prioritizeSports(await fetchActiveSports(apiKey));

  const results = await mapInBatches(sports, ODDS_FETCH_CONCURRENCY, (s) =>
    fetchOddsForSport(apiKey, s.key, s.group)
  );

  const quotaHits = results.filter((r) => r.quotaExhausted).length;
  const okCount = results.filter((r) => r.status >= 200 && r.status < 300).length;

  if (okCount === 0 && quotaHits > 0) {
    throw new Error(
      "The Odds API usage quota is exhausted (OUT_OF_USAGE_CREDITS). No odds could be fetched, so no picks can be generated. Get a new key or upgrade at https://the-odds-api.com, or wait until your monthly credits reset."
    );
  }

  if (okCount === 0) {
    throw new Error(
      "Odds API returned no league data (all requests failed). Check ODDS_API_KEY and network."
    );
  }

  const now = Date.now();
  const cutoff = now + 24 * 60 * 60 * 1000;

  const matches = results
    .flatMap((r) => r.matches)
    .filter((m) => {
      const t = new Date(m.commenceTime).getTime();
      return t >= now && t <= cutoff;
    });

  const extrasBudget = new Map<string, number>(
    TARGET_GROUPS.map((g) => [g, MAX_EXTRA_EVENTS_PER_GROUP])
  );

  const enriched = await Promise.all(
    matches.map(async (match) => {
      const group = groupForSportKey(match.sport);
      if (!group) return match;
      const remaining = extrasBudget.get(group) ?? 0;
      if (remaining <= 0) return match;
      extrasBudget.set(group, remaining - 1);

      const extra = await fetchEventExtraMarkets(
        apiKey,
        match.sport,
        match.eventId,
        group
      );
      if (extra.length === 0) return match;
      return { ...match, outcomes: mergeOutcomes(match.outcomes, extra) };
    })
  );

  return enriched;
}

/** Scores for live/completed games (daysFrom includes completed up to N days). */
export async function fetchScores(
  apiKey: string,
  sportKey: string,
  daysFrom = 3
): Promise<any[]> {
  const url = `${BASE_URL}/sports/${sportKey}/scores?apiKey=${apiKey}&daysFrom=${daysFrom}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`Odds API scores failed for ${sportKey}: ${res.status}`);
    return [];
  }
  return res.json();
}

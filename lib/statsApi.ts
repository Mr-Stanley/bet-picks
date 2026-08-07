// API-Football (api-sports.io) — form, H2H, goals, corners for soccer fixtures.
// Optional: without API_FOOTBALL_KEY, analysis falls back to odds-only ranking.

import { NormalizedMatch } from "./oddsApi";

const BASE_URL = "https://v3.football.api-sports.io";
const STATS_CONCURRENCY = 5;
const MAX_STATS_MATCHES = 20;
const LAST_N = 5;

export type MatchStats = {
  homeFormPts: number;
  awayFormPts: number;
  h2hHomeWins: number;
  h2hAwayWins: number;
  h2hDraws: number;
  h2hPlayed: number;
  homeGoalsForAvg: number;
  homeGoalsAgainstAvg: number;
  awayGoalsForAvg: number;
  awayGoalsAgainstAvg: number;
  expectedGoalsTotal: number;
  homeCornersAvg: number | null;
  awayCornersAvg: number | null;
  hint: string;
};

type AfTeam = { id: number; name: string };
type AfFixture = {
  fixture: { id: number; date: string };
  teams: { home: AfTeam; away: AfTeam };
  goals: { home: number | null; away: number | null };
};

function apiKey(): string | null {
  const key = process.env.API_FOOTBALL_KEY?.trim();
  return key || null;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) {
    return true;
  }
  return false;
}

async function afFetch<T>(path: string, key: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { "x-apisports-key": key },
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`API-Football ${path} failed: ${res.status}`);
      return null;
    }
    const json = await res.json();
    return (json?.response ?? null) as T | null;
  } catch (err) {
    console.warn(`API-Football ${path} error`, err);
    return null;
  }
}

async function mapInBatches<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

function dateKeysForMatches(matches: NormalizedMatch[]): string[] {
  const days = new Set<string>();
  for (const m of matches) {
    days.add(m.commenceTime.slice(0, 10));
  }
  return Array.from(days).slice(0, 3);
}

function formPoints(
  fixtures: AfFixture[],
  teamId: number
): { pts: number; gf: number; ga: number; n: number } {
  let pts = 0;
  let gf = 0;
  let ga = 0;
  let n = 0;
  for (const f of fixtures) {
    const hg = f.goals.home;
    const ag = f.goals.away;
    if (hg === null || ag === null) continue;
    const isHome = f.teams.home.id === teamId;
    const forG = isHome ? hg : ag;
    const againstG = isHome ? ag : hg;
    gf += forG;
    ga += againstG;
    n++;
    if (forG > againstG) pts += 3;
    else if (forG === againstG) pts += 1;
  }
  return { pts, gf, ga, n };
}

async function teamLastFixtures(
  key: string,
  teamId: number,
  cache: Map<number, AfFixture[]>
): Promise<AfFixture[]> {
  if (cache.has(teamId)) return cache.get(teamId)!;
  const data = await afFetch<AfFixture[]>(
    `/fixtures?team=${teamId}&last=${LAST_N}`,
    key
  );
  const list = data ?? [];
  cache.set(teamId, list);
  return list;
}

async function cornersAvgForTeam(
  key: string,
  fixtures: AfFixture[],
  teamId: number,
  budget: { left: number }
): Promise<number | null> {
  const completed = fixtures.filter(
    (f) => f.goals.home !== null && f.goals.away !== null
  );
  const sample = completed.slice(0, 2);
  const corners: number[] = [];
  for (const f of sample) {
    if (budget.left <= 0) break;
    budget.left--;
    const stats = await afFetch<
      {
        team: AfTeam;
        statistics: { type: string; value: number | string | null }[];
      }[]
    >(`/fixtures/statistics?fixture=${f.fixture.id}`, key);
    if (!stats) continue;
    const row = stats.find((s) => s.team.id === teamId);
    const cornerStat = row?.statistics.find(
      (s) => s.type.toLowerCase() === "corner kicks"
    );
    if (cornerStat?.value === null || cornerStat?.value === undefined) continue;
    const n = Number(cornerStat.value);
    if (!Number.isNaN(n)) corners.push(n);
  }
  if (corners.length === 0) return null;
  return corners.reduce((a, b) => a + b, 0) / corners.length;
}

function buildHint(stats: Omit<MatchStats, "hint">): string {
  const form =
    stats.homeFormPts === stats.awayFormPts
      ? "even form"
      : stats.homeFormPts > stats.awayFormPts
        ? `home form ${stats.homeFormPts}-${stats.awayFormPts}`
        : `away form ${stats.awayFormPts}-${stats.homeFormPts}`;
  const h2h =
    stats.h2hPlayed === 0
      ? "no H2H"
      : `H2H ${stats.h2hHomeWins}-${stats.h2hDraws}-${stats.h2hAwayWins}`;
  const goals = `xG~${stats.expectedGoalsTotal.toFixed(1)}`;
  return `${form} · ${h2h} · ${goals}`;
}

/**
 * Enrich soccer matches with form / H2H / goals / corners.
 * Returns a map keyed by Odds API eventId. Empty if no API key.
 */
export async function fetchMatchStatsMap(
  matches: NormalizedMatch[]
): Promise<Map<string, MatchStats>> {
  const out = new Map<string, MatchStats>();
  const key = apiKey();
  if (!key) return out;

  const soccer = matches
    .filter((m) => m.sport.startsWith("soccer_"))
    .sort(
      (a, b) =>
        new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime()
    )
    .slice(0, MAX_STATS_MATCHES);

  if (soccer.length === 0) return out;

  const dates = dateKeysForMatches(soccer);
  const dayFixtures: AfFixture[] = [];
  for (const d of dates) {
    const data = await afFetch<AfFixture[]>(`/fixtures?date=${d}`, key);
    if (data) dayFixtures.push(...data);
  }

  type Pair = {
    match: NormalizedMatch;
    homeId: number;
    awayId: number;
  };
  const pairs: Pair[] = [];

  for (const match of soccer) {
    const hit = dayFixtures.find(
      (f) =>
        namesMatch(f.teams.home.name, match.homeTeam) &&
        namesMatch(f.teams.away.name, match.awayTeam)
    );
    if (!hit) continue;
    pairs.push({
      match,
      homeId: hit.teams.home.id,
      awayId: hit.teams.away.id,
    });
  }

  const teamCache = new Map<number, AfFixture[]>();
  const cornerBudget = { left: Math.min(pairs.length * 2, 24) };

  const enriched = await mapInBatches(pairs, STATS_CONCURRENCY, async (pair) => {
    const [homeLast, awayLast, h2h] = await Promise.all([
      teamLastFixtures(key, pair.homeId, teamCache),
      teamLastFixtures(key, pair.awayId, teamCache),
      afFetch<AfFixture[]>(
        `/fixtures/headtohead?h2h=${pair.homeId}-${pair.awayId}&last=${LAST_N}`,
        key
      ),
    ]);

    const homeForm = formPoints(homeLast, pair.homeId);
    const awayForm = formPoints(awayLast, pair.awayId);

    let h2hHomeWins = 0;
    let h2hAwayWins = 0;
    let h2hDraws = 0;
    for (const f of h2h ?? []) {
      const hg = f.goals.home;
      const ag = f.goals.away;
      if (hg === null || ag === null) continue;
      const homeIsListedHome = f.teams.home.id === pair.homeId;
      const homeGoals = homeIsListedHome ? hg : ag;
      const awayGoals = homeIsListedHome ? ag : hg;
      if (homeGoals > awayGoals) h2hHomeWins++;
      else if (awayGoals > homeGoals) h2hAwayWins++;
      else h2hDraws++;
    }
    const h2hPlayed = h2hHomeWins + h2hAwayWins + h2hDraws;

    const homeGf = homeForm.n ? homeForm.gf / homeForm.n : 0;
    const homeGa = homeForm.n ? homeForm.ga / homeForm.n : 0;
    const awayGf = awayForm.n ? awayForm.gf / awayForm.n : 0;
    const awayGa = awayForm.n ? awayForm.ga / awayForm.n : 0;
    const expectedGoalsTotal = homeGf + awayGf;

    const [homeCornersAvg, awayCornersAvg] = await Promise.all([
      cornersAvgForTeam(key, homeLast, pair.homeId, cornerBudget),
      cornersAvgForTeam(key, awayLast, pair.awayId, cornerBudget),
    ]);

    const base = {
      homeFormPts: homeForm.pts,
      awayFormPts: awayForm.pts,
      h2hHomeWins,
      h2hAwayWins,
      h2hDraws,
      h2hPlayed,
      homeGoalsForAvg: homeGf,
      homeGoalsAgainstAvg: homeGa,
      awayGoalsForAvg: awayGf,
      awayGoalsAgainstAvg: awayGa,
      expectedGoalsTotal,
      homeCornersAvg,
      awayCornersAvg,
    };

    return {
      eventId: pair.match.eventId,
      stats: { ...base, hint: buildHint(base) } satisfies MatchStats,
    };
  });

  for (const row of enriched) {
    if (row) out.set(row.eventId, row.stats);
  }

  return out;
}

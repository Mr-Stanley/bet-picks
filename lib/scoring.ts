// Confidence + rank scoring from book consensus, favorites, and optional soccer stats.

import { marketLabel, NormalizedMatch } from "./oddsApi";
import { MatchStats } from "./statsApi";

export type PickCategory =
  | "match_winner"
  | "draw"
  | "totals"
  | "spreads"
  | "cards"
  | "period"
  | "other";

export type ScoredPick = {
  eventId: string;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  market: string;
  marketLabel: string;
  category: PickCategory;
  selection: string;
  point: number | null;
  bestPrice: number;
  book: string;
  numBooks: number;
  priceSpread: number;
  impliedProb: number;
  confidenceScore: number;
  confidenceBand: "high" | "medium" | "low";
  rankScore: number;
  statsHint?: string;
  raw: unknown;
};

export type CategorizedPicks = Record<PickCategory, ScoredPick[]>;

const CATEGORY_ORDER: PickCategory[] = [
  "match_winner",
  "draw",
  "totals",
  "spreads",
  "cards",
  "period",
  "other",
];

function scoreOutcome(
  bestPrice: number,
  numBooks: number,
  priceSpread: number
): number {
  const relativeSpread = priceSpread / bestPrice;
  const consensusFactor = Math.max(0, 1 - relativeSpread * 4);
  const coverageFactor = Math.min(numBooks / 8, 1);
  const score = 0.6 * consensusFactor + 0.4 * coverageFactor;
  return Math.round(score * 100);
}

function bandFor(score: number): "high" | "medium" | "low" {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function isDrawSelection(selection: string): boolean {
  return selection.trim().toLowerCase() === "draw";
}

export function categorizePick(
  market: string,
  selection: string
): PickCategory {
  if (market === "h2h" && isDrawSelection(selection)) return "draw";
  if (market === "h2h") return "match_winner";
  if (market.includes("cards")) return "cards";
  if (/_(q|h|s|p)\d/.test(market) || market.includes("period")) return "period";
  if (
    market.startsWith("totals") ||
    market.includes("totals") ||
    market === "btts"
  ) {
    return "totals";
  }
  if (market.startsWith("spreads") || market.includes("spreads")) return "spreads";
  return "other";
}

function favoriteFactor(bestPrice: number): number {
  if (bestPrice <= 1.5) return 1;
  if (bestPrice >= 4) return 0;
  return Math.max(0, 1 - (bestPrice - 1.5) / 2.5);
}

function marketPreference(category: PickCategory): number {
  switch (category) {
    case "match_winner":
      return 1;
    case "totals":
    case "spreads":
      return 0.85;
    case "draw":
      return 0.7;
    case "cards":
    case "period":
      return 0.35;
    default:
      return 0.4;
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function statsAlignment(
  pick: {
    category: PickCategory;
    selection: string;
    homeTeam: string;
    awayTeam: string;
    point: number | null;
    market: string;
  },
  stats: MatchStats | undefined
): number {
  if (!stats) return 0.5;

  const sel = pick.selection.toLowerCase();
  const isHome = pick.selection === pick.homeTeam;
  const isAway = pick.selection === pick.awayTeam;

  const formDiff = (stats.homeFormPts - stats.awayFormPts) / 15;
  let h2hEdge = 0;
  if (stats.h2hPlayed > 0) {
    h2hEdge =
      (stats.h2hHomeWins - stats.h2hAwayWins) / Math.max(stats.h2hPlayed, 1);
  }

  if (pick.category === "match_winner") {
    if (isHome) return clamp01(0.5 + 0.35 * formDiff + 0.25 * h2hEdge);
    if (isAway) return clamp01(0.5 - 0.35 * formDiff - 0.25 * h2hEdge);
    return 0.4;
  }

  if (pick.category === "draw") {
    const evenForm = 1 - Math.abs(formDiff);
    const drawish =
      stats.h2hPlayed > 0 ? stats.h2hDraws / stats.h2hPlayed : 0.33;
    return clamp01(0.35 * evenForm + 0.65 * drawish);
  }

  if (pick.category === "totals" || pick.market.includes("totals")) {
    const xg = stats.expectedGoalsTotal;
    const isOver = sel.includes("over");
    const isUnder = sel.includes("under");
    const point = pick.point ?? 2.5;
    if (isOver) return clamp01(0.5 + (xg - point) * 0.25);
    if (isUnder) return clamp01(0.5 + (point - xg) * 0.25);
    return 0.45;
  }

  if (pick.market.includes("corner")) {
    if (stats.homeCornersAvg === null || stats.awayCornersAvg === null) {
      return 0.4;
    }
    const total = stats.homeCornersAvg + stats.awayCornersAvg;
    const isOver = sel.includes("over");
    const isUnder = sel.includes("under");
    const point = pick.point ?? 9.5;
    if (isOver) return clamp01(0.5 + (total - point) * 0.08);
    if (isUnder) return clamp01(0.5 + (point - total) * 0.08);
    return 0.4;
  }

  return 0.5;
}

function formFactor(stats: MatchStats | undefined): number {
  if (!stats) return 0.5;
  return clamp01(0.5 + Math.abs(stats.homeFormPts - stats.awayFormPts) / 30);
}

function h2hFactor(stats: MatchStats | undefined): number {
  if (!stats || stats.h2hPlayed === 0) return 0.5;
  const decisive =
    Math.abs(stats.h2hHomeWins - stats.h2hAwayWins) / stats.h2hPlayed;
  return clamp01(0.4 + 0.6 * decisive);
}

function goalsFactor(stats: MatchStats | undefined): number {
  if (!stats) return 0.5;
  const xg = stats.expectedGoalsTotal;
  if (xg >= 3.2 || xg <= 1.8) return 0.85;
  if (xg >= 2.8 || xg <= 2.1) return 0.7;
  return 0.55;
}

function cornersFactor(stats: MatchStats | undefined): number {
  if (!stats || stats.homeCornersAvg === null || stats.awayCornersAvg === null) {
    return 0.5;
  }
  const edge = Math.abs(stats.homeCornersAvg - stats.awayCornersAvg);
  return clamp01(0.45 + edge * 0.05);
}

export function computeRankScore(
  pick: {
    confidenceScore: number;
    bestPrice: number;
    category: PickCategory;
    selection: string;
    homeTeam: string;
    awayTeam: string;
    point: number | null;
    market: string;
  },
  stats: MatchStats | undefined
): number {
  const consensus = pick.confidenceScore / 100;
  const favorite = favoriteFactor(pick.bestPrice);
  const market = marketPreference(pick.category);
  const align = statsAlignment(pick, stats);

  let score: number;
  if (stats) {
    score =
      0.3 * consensus +
      0.2 * favorite +
      0.15 * market +
      0.15 * align +
      0.08 * formFactor(stats) +
      0.07 * h2hFactor(stats) +
      0.03 * goalsFactor(stats) +
      0.02 * cornersFactor(stats);
    score = 0.85 * score + 0.15 * align;
  } else {
    score = 0.5 * consensus + 0.35 * favorite + 0.15 * market;
  }

  return Math.round(clamp01(score) * 100);
}

/** Scores every outcome; optional stats map boosts soccer ranking. */
export function scoreMatches(
  matches: NormalizedMatch[],
  statsByEvent?: Map<string, MatchStats>
): ScoredPick[] {
  const picks: ScoredPick[] = [];

  for (const match of matches) {
    const stats = statsByEvent?.get(match.eventId);
    for (const outcome of match.outcomes) {
      if (outcome.numBooks < 2) continue;

      const bestEntry = outcome.prices.find((p) => p.price === outcome.bestPrice);
      const score = scoreOutcome(
        outcome.bestPrice,
        outcome.numBooks,
        outcome.priceSpread
      );
      const category = categorizePick(outcome.market, outcome.selection);
      const base = {
        confidenceScore: score,
        bestPrice: outcome.bestPrice,
        category,
        selection: outcome.selection,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        point: outcome.point,
        market: outcome.market,
      };

      picks.push({
        eventId: match.eventId,
        sport: match.sport,
        league: match.league,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        commenceTime: match.commenceTime,
        market: outcome.market,
        marketLabel: marketLabel(outcome.market),
        category,
        selection: outcome.selection,
        point: outcome.point,
        bestPrice: outcome.bestPrice,
        book: bestEntry?.bookmaker ?? "unknown",
        numBooks: outcome.numBooks,
        priceSpread: outcome.priceSpread,
        impliedProb: 1 / outcome.bestPrice,
        confidenceScore: score,
        confidenceBand: bandFor(score),
        rankScore: computeRankScore(base, stats),
        statsHint: stats?.hint,
        raw: match.raw,
      });
    }
  }

  return picks.sort((a, b) => b.rankScore - a.rankScore);
}

export function eventKey(p: {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
}): string {
  return p.eventId || `${p.homeTeam}__${p.awayTeam}__${p.commenceTime}`;
}

function isBetterPick(candidate: ScoredPick, current: ScoredPick): boolean {
  if (candidate.rankScore !== current.rankScore) {
    return candidate.rankScore > current.rankScore;
  }
  if (candidate.impliedProb !== current.impliedProb) {
    return candidate.impliedProb > current.impliedProb;
  }
  return candidate.confidenceScore > current.confidenceScore;
}

/** One recommended pick per game — highest rankScore. */
export function pickBestPerEvent(picks: ScoredPick[]): ScoredPick[] {
  const best = new Map<string, ScoredPick>();
  for (const pick of picks) {
    const key = eventKey(pick);
    const current = best.get(key);
    if (!current || isBetterPick(pick, current)) {
      best.set(key, pick);
    }
  }
  return Array.from(best.values()).sort((a, b) => b.rankScore - a.rankScore);
}

export function categorizePicks(picks: ScoredPick[]): CategorizedPicks {
  const buckets: CategorizedPicks = {
    match_winner: [],
    draw: [],
    totals: [],
    spreads: [],
    cards: [],
    period: [],
    other: [],
  };

  for (const pick of picks) {
    buckets[pick.category].push(pick);
  }

  for (const key of CATEGORY_ORDER) {
    buckets[key].sort((a, b) => b.rankScore - a.rankScore);
  }

  return buckets;
}

export { CATEGORY_ORDER };

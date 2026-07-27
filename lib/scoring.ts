// Confidence scoring from cross-bookmaker consensus and coverage.
// This is not the same as team form / injuries — see README.

import { marketLabel, NormalizedMatch } from "./oddsApi";

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

function scoreOutcome(bestPrice: number, numBooks: number, priceSpread: number): number {
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

export function categorizePick(market: string, selection: string): PickCategory {
  if (market === "h2h" && isDrawSelection(selection)) return "draw";
  if (market === "h2h") return "match_winner";
  if (market.includes("cards")) return "cards";
  if (/_(q|h|s|p)\d/.test(market) || market.includes("period")) return "period";
  if (market.startsWith("totals") || market.includes("totals") || market === "btts") {
    return "totals";
  }
  if (market.startsWith("spreads") || market.includes("spreads")) return "spreads";
  return "other";
}

/** Scores every outcome of every match and returns a flat, sorted-by-confidence list. */
export function scoreMatches(matches: NormalizedMatch[]): ScoredPick[] {
  const picks: ScoredPick[] = [];

  for (const match of matches) {
    for (const outcome of match.outcomes) {
      if (outcome.numBooks < 2) continue;

      const bestEntry = outcome.prices.find((p) => p.price === outcome.bestPrice);
      const score = scoreOutcome(outcome.bestPrice, outcome.numBooks, outcome.priceSpread);
      const category = categorizePick(outcome.market, outcome.selection);

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
        raw: match.raw,
      });
    }
  }

  return picks.sort((a, b) => b.confidenceScore - a.confidenceScore);
}

/** Stable key for one fixture (prefer Odds API event id). */
export function eventKey(p: {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
}): string {
  return p.eventId || `${p.homeTeam}__${p.awayTeam}__${p.commenceTime}`;
}

function isBetterPick(candidate: ScoredPick, current: ScoredPick): boolean {
  if (candidate.confidenceScore !== current.confidenceScore) {
    return candidate.confidenceScore > current.confidenceScore;
  }
  if (candidate.impliedProb !== current.impliedProb) {
    return candidate.impliedProb > current.impliedProb;
  }
  return candidate.bestPrice < current.bestPrice;
}

/** One recommended pick per game — highest confidence, then probability, then shorter price. */
export function pickBestPerEvent(picks: ScoredPick[]): ScoredPick[] {
  const best = new Map<string, ScoredPick>();
  for (const pick of picks) {
    const key = eventKey(pick);
    const current = best.get(key);
    if (!current || isBetterPick(pick, current)) {
      best.set(key, pick);
    }
  }
  return Array.from(best.values()).sort(
    (a, b) => b.confidenceScore - a.confidenceScore
  );
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
    buckets[key].sort((a, b) => b.confidenceScore - a.confidenceScore);
  }

  return buckets;
}

export { CATEGORY_ORDER };

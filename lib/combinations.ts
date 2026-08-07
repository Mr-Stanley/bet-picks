// Builds accumulator ("combo") slips — soft-fills every tier when possible.

import { eventKey, ScoredPick } from "./scoring";

export type Tier = {
  tier: string;
  targetOdds: number;
};

export const TIERS: Tier[] = [
  { tier: "2x", targetOdds: 2 },
  { tier: "5x", targetOdds: 5 },
  { tier: "10x", targetOdds: 10 },
  { tier: "50x", targetOdds: 50 },
  { tier: "100x", targetOdds: 100 },
  { tier: "1000x", targetOdds: 1000 },
];

/** Separate draw accumulator (highest-probability draws, ~5x target). */
export const DRAW_TIER: Tier = { tier: "draw", targetOdds: 5 };

/** Main odds tiers + draw slot for UI ordering. */
export const DISPLAY_TIERS: Tier[] = [...TIERS, DRAW_TIER];

export type Combination = {
  tier: string;
  targetOdds: number;
  combinedOdds: number;
  impliedProbability: number;
  legs: ScoredPick[];
};

const MAX_LEGS = 25;
const CONFIDENCE_STEPS = [40, 25, 10, 0];

function matchKey(p: ScoredPick): string {
  return eventKey(p);
}

function comboSort(a: ScoredPick, b: ScoredPick): number {
  const ar = a.rankScore ?? a.confidenceScore;
  const br = b.rankScore ?? b.confidenceScore;
  if (br !== ar) return br - ar;
  return a.bestPrice - b.bestPrice;
}

function shortFavoriteFirst(a: ScoredPick, b: ScoredPick): number {
  const aShort = a.bestPrice <= 2.2 ? 0 : 1;
  const bShort = b.bestPrice <= 2.2 ? 0 : 1;
  if (aShort !== bShort) return aShort - bShort;
  return comboSort(a, b);
}

function greedyCombo(
  usablePicks: ScoredPick[],
  tier: string,
  targetOdds: number,
  preferShort: boolean
): Combination | null {
  const ordered = preferShort
    ? [...usablePicks].sort(shortFavoriteFirst)
    : usablePicks;

  const usedMatches = new Set<string>();
  const legs: ScoredPick[] = [];
  let combinedOdds = 1;

  for (const pick of ordered) {
    if (combinedOdds >= targetOdds) break;
    if (legs.length >= MAX_LEGS) break;

    const key = matchKey(pick);
    if (usedMatches.has(key)) continue;

    legs.push(pick);
    usedMatches.add(key);
    combinedOdds *= pick.bestPrice;
  }

  if (legs.length === 0) return null;

  return {
    tier,
    targetOdds,
    combinedOdds: Math.round(combinedOdds * 100) / 100,
    impliedProbability: 1 / combinedOdds,
    legs,
  };
}

function buildWithRelaxation(
  picks: ScoredPick[],
  tier: string,
  targetOdds: number,
  preferShort: boolean,
  drawOnly: boolean
): Combination | null {
  for (const minConf of CONFIDENCE_STEPS) {
    const usable = picks
      .filter((p) => {
        if (drawOnly) {
          if (p.category !== "draw") return false;
        } else if (p.category === "draw") {
          return false;
        }
        return (p.rankScore ?? p.confidenceScore) >= minConf;
      })
      .sort(comboSort);

    const combo = greedyCombo(usable, tier, targetOdds, preferShort);
    if (combo) return combo;
  }
  return null;
}

/**
 * Soft-fills one combination per main odds tier. Returns a slip whenever any
 * usable legs exist (may be under target odds).
 */
export function buildCombinations(picks: ScoredPick[]): (Combination | null)[] {
  return TIERS.map(({ tier, targetOdds }) =>
    buildWithRelaxation(picks, tier, targetOdds, targetOdds >= 50, false)
  );
}

/**
 * Draw-only soft-fill accumulator (~5x), one draw per game, highest impliedProb.
 */
export function buildDrawCombination(
  allScoredPicks: ScoredPick[]
): Combination | null {
  const bestDrawByEvent = new Map<string, ScoredPick>();

  for (const pick of allScoredPicks) {
    if (pick.category !== "draw") continue;
    const key = matchKey(pick);
    const current = bestDrawByEvent.get(key);
    if (
      !current ||
      pick.impliedProb > current.impliedProb ||
      (pick.impliedProb === current.impliedProb &&
        (pick.rankScore ?? pick.confidenceScore) >
          (current.rankScore ?? current.confidenceScore))
    ) {
      bestDrawByEvent.set(key, pick);
    }
  }

  return buildWithRelaxation(
    Array.from(bestDrawByEvent.values()),
    DRAW_TIER.tier,
    DRAW_TIER.targetOdds,
    false,
    true
  );
}

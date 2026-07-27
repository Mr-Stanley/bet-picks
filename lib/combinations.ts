// Builds accumulator ("combo") slips out of the highest-confidence individual
// picks, targeting 2x / 5x / 10x / 50x / 100x / 1000x, plus a draw slip.

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
const MIN_CONFIDENCE_FOR_COMBOS = 25;

function matchKey(p: ScoredPick): string {
  return eventKey(p);
}

/**
 * Prefer high-confidence, shorter prices so high tiers (50x–1000x) can be
 * reached with enough legs before MAX_LEGS.
 */
function comboSort(a: ScoredPick, b: ScoredPick): number {
  if (b.confidenceScore !== a.confidenceScore) {
    return b.confidenceScore - a.confidenceScore;
  }
  return a.bestPrice - b.bestPrice;
}

function greedyCombo(
  usablePicks: ScoredPick[],
  tier: string,
  targetOdds: number,
  opts?: { skipLongShots?: boolean }
): Combination | null {
  const usedMatches = new Set<string>();
  const legs: ScoredPick[] = [];
  let combinedOdds = 1;

  for (const pick of usablePicks) {
    if (combinedOdds >= targetOdds) break;
    if (legs.length >= MAX_LEGS) break;

    const key = matchKey(pick);
    if (usedMatches.has(key)) continue;

    // Skip very long shots as legs — they burn quota of MAX_LEGS without
    // helping a clean high-confidence slip.
    if (opts?.skipLongShots && pick.bestPrice > 3.5 && targetOdds >= 50) {
      continue;
    }

    legs.push(pick);
    usedMatches.add(key);
    combinedOdds *= pick.bestPrice;
  }

  if (combinedOdds < targetOdds || legs.length === 0) return null;

  return {
    tier,
    targetOdds,
    combinedOdds: Math.round(combinedOdds * 100) / 100,
    impliedProbability: 1 / combinedOdds,
    legs,
  };
}

/**
 * Greedily builds one combination per main odds tier. Always returns an entry
 * per tier (null when there aren't enough qualifying picks to reach the target).
 */
export function buildCombinations(picks: ScoredPick[]): (Combination | null)[] {
  const usablePicks = picks
    .filter(
      (p) =>
        p.confidenceScore >= MIN_CONFIDENCE_FOR_COMBOS && p.category !== "draw"
    )
    .sort(comboSort);

  return TIERS.map(({ tier, targetOdds }) =>
    greedyCombo(usablePicks, tier, targetOdds, { skipLongShots: true })
  );
}

/**
 * Draw-only accumulator from the full scored list: one draw per game, ranked
 * by highest implied probability, targeting ~5x.
 */
export function buildDrawCombination(
  allScoredPicks: ScoredPick[]
): Combination | null {
  const bestDrawByEvent = new Map<string, ScoredPick>();

  for (const pick of allScoredPicks) {
    if (pick.category !== "draw") continue;
    if (pick.confidenceScore < MIN_CONFIDENCE_FOR_COMBOS) continue;

    const key = matchKey(pick);
    const current = bestDrawByEvent.get(key);
    if (
      !current ||
      pick.impliedProb > current.impliedProb ||
      (pick.impliedProb === current.impliedProb &&
        pick.confidenceScore > current.confidenceScore)
    ) {
      bestDrawByEvent.set(key, pick);
    }
  }

  const usablePicks = Array.from(bestDrawByEvent.values()).sort((a, b) => {
    if (b.impliedProb !== a.impliedProb) return b.impliedProb - a.impliedProb;
    return b.confidenceScore - a.confidenceScore;
  });

  return greedyCombo(usablePicks, DRAW_TIER.tier, DRAW_TIER.targetOdds);
}

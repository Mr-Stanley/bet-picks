// Six risk-tiered accumulators from Step-1 qualified picks only.

import { eventKey, ScoredPick } from "./scoring";

export type TierMeta = {
  tier: string;
  targetOdds: number;
  minLegs: number;
  maxLegs: number;
  riskProfile: string;
  slipNote: string;
  requiresDisclaimer: boolean;
};

export const TIERS: TierMeta[] = [
  {
    tier: "2x",
    targetOdds: 2,
    minLegs: 1,
    maxLegs: 2,
    riskProfile: "Lowest",
    slipNote: "core slip",
    requiresDisclaimer: false,
  },
  {
    tier: "5x",
    targetOdds: 5,
    minLegs: 2,
    maxLegs: 3,
    riskProfile: "Low-to-medium",
    slipNote: "core slip",
    requiresDisclaimer: false,
  },
  {
    tier: "10x",
    targetOdds: 10,
    minLegs: 3,
    maxLegs: 5,
    riskProfile: "Medium",
    slipNote: "core slip",
    requiresDisclaimer: false,
  },
  {
    tier: "50x",
    targetOdds: 50,
    minLegs: 5,
    maxLegs: 8,
    riskProfile: "Medium-to-high",
    slipNote: "high-variance/longshot slip",
    requiresDisclaimer: false,
  },
  {
    tier: "100x",
    targetOdds: 100,
    minLegs: 7,
    maxLegs: 10,
    riskProfile: "High",
    slipNote: "high-variance/longshot slip",
    requiresDisclaimer: true,
  },
  {
    tier: "1000x",
    targetOdds: 1000,
    minLegs: 10,
    maxLegs: 25,
    riskProfile: "Very high",
    slipNote: "high-variance/longshot slip",
    requiresDisclaimer: true,
  },
];

export const DISPLAY_TIERS = TIERS;

export const HIGH_TIER_DISCLAIMER =
  "Low-probability, high-variance combination included for entertainment/upside purposes — not the model's genuine confidence pick.";

export type Combination = {
  tier: string;
  targetOdds: number;
  combinedOdds: number;
  impliedProbability: number;
  legs: ScoredPick[];
  riskProfile: string;
  slipNote: string;
  targetReached: boolean;
  disclaimer: string | null;
};

function matchKey(p: ScoredPick): string {
  return eventKey(p);
}

function byConfidence(a: ScoredPick, b: ScoredPick): number {
  const ar = a.rankScore ?? a.confidenceScore;
  const br = b.rankScore ?? b.confidenceScore;
  if (br !== ar) return br - ar;
  return a.bestPrice - b.bestPrice;
}

function shortFirst(a: ScoredPick, b: ScoredPick): number {
  const aShort = a.bestPrice <= 2.2 ? 0 : 1;
  const bShort = b.bestPrice <= 2.2 ? 0 : 1;
  if (aShort !== bShort) return aShort - bShort;
  return byConfidence(a, b);
}

function buildTier(
  picks: ScoredPick[],
  meta: TierMeta
): Combination | null {
  if (picks.length === 0) return null;

  // Low tiers: highest confidence first. High tiers: short favorites first.
  const ordered =
    meta.targetOdds >= 50
      ? [...picks].sort(shortFirst)
      : [...picks].sort(byConfidence);

  // For low-risk tiers, only use stronger legs
  const minRank =
    meta.targetOdds <= 2 ? 70 : meta.targetOdds <= 5 ? 55 : meta.targetOdds <= 10 ? 40 : 0;
  let pool = ordered.filter(
    (p) => (p.rankScore ?? p.confidenceScore) >= minRank
  );
  if (pool.length === 0) pool = ordered;

  const used = new Set<string>();
  const legs: ScoredPick[] = [];
  let combined = 1;

  for (const pick of pool) {
    if (legs.length >= meta.maxLegs) break;
    if (combined >= meta.targetOdds && legs.length >= meta.minLegs) break;

    const key = matchKey(pick);
    if (used.has(key)) continue;

    legs.push(pick);
    used.add(key);
    combined *= pick.bestPrice;
  }

  // If under min legs but we have legs, keep soft-fill
  if (legs.length === 0) return null;

  // Try to reach target with more short-priced legs if still short
  if (combined < meta.targetOdds && legs.length < meta.maxLegs) {
    for (const pick of ordered) {
      if (combined >= meta.targetOdds) break;
      if (legs.length >= meta.maxLegs) break;
      const key = matchKey(pick);
      if (used.has(key)) continue;
      legs.push(pick);
      used.add(key);
      combined *= pick.bestPrice;
    }
  }

  const targetReached = combined >= meta.targetOdds * 0.98;

  return {
    tier: meta.tier,
    targetOdds: meta.targetOdds,
    combinedOdds: Math.round(combined * 100) / 100,
    impliedProbability: 1 / combined,
    legs,
    riskProfile: meta.riskProfile,
    slipNote: meta.slipNote,
    targetReached,
    disclaimer: meta.requiresDisclaimer ? HIGH_TIER_DISCLAIMER : null,
  };
}

/**
 * Build six accumulators from Step-1 picks only. Always returns an array of
 * length 6 (null entries when zero qualified picks).
 */
export function buildCombinations(
  picks: ScoredPick[]
): (Combination | null)[] {
  return TIERS.map((meta) => buildTier(picks, meta));
}

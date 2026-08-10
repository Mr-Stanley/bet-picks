import { NextResponse } from "next/server";
import {
  analysisWindowLabel,
  currentCalendarDayStart,
  nextCalendarDayStart,
} from "@/lib/scanLock";
import {
  DISPLAY_TIERS,
  HIGH_TIER_DISCLAIMER,
  TIERS,
} from "@/lib/combinations";
import { getSupabaseServer } from "@/lib/supabase";

export async function GET() {
  try {
    const supabase = getSupabaseServer();
    const dayStart = currentCalendarDayStart();
    const nextUnlock = nextCalendarDayStart();

    const { data: todayRun } = await supabase
      .from("runs")
      .select("id")
      .gte("created_at", dayStart.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const ranToday = Boolean(todayRun);
    const scanLocked = ranToday;
    const canRunToday = !ranToday;

    const { data: run, error: runError } = await supabase
      .from("runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (runError) throw runError;
    if (!run) {
      return NextResponse.json({
        run: null,
        canRunToday: true,
        ranToday: false,
        scanLocked: false,
        nextUnlockAt: nextUnlock.toISOString(),
        windowLabel: analysisWindowLabel(),
      });
    }

    const { data: combinations, error: comboError } = await supabase
      .from("combinations")
      .select("*")
      .eq("run_id", run.id);

    if (comboError) throw comboError;

    const allMatchIds = Array.from(
      new Set((combinations ?? []).flatMap((c) => c.match_ids ?? []))
    );

    let matchById = new Map<string, any>();
    if (allMatchIds.length > 0) {
      const { data: legs, error: legError } = await supabase
        .from("matches")
        .select(
          "id, sport, league, home_team, away_team, commence_time, market, pick_selection, best_price, confidence_score, confidence_band, raw"
        )
        .in("id", allMatchIds);
      if (legError) throw legError;
      matchById = new Map((legs ?? []).map((m) => [m.id, m]));
    }

    const tierMeta = new Map(TIERS.map((t) => [t.tier, t]));

    const byTier = new Map(
      (combinations ?? []).map((c) => {
        const meta = tierMeta.get(c.tier);
        const combinedOdds = Number(c.combined_odds);
        const targetOdds = Number(c.target_odds);
        return [
          c.tier,
          {
            tier: c.tier,
            targetOdds,
            combinedOdds,
            impliedProbability: Number(c.implied_probability),
            riskProfile: meta?.riskProfile ?? "Medium",
            slipNote: meta?.slipNote ?? "core slip",
            targetReached: combinedOdds >= targetOdds * 0.98,
            underfillNote:
              combinedOdds >= targetOdds * 0.98
                ? null
                : `Closest achievable: ${combinedOdds.toFixed(1)}x (target ${targetOdds}x) — soft-filled from available Step-1 picks.`,
            disclaimer: meta?.requiresDisclaimer ? HIGH_TIER_DISCLAIMER : null,
            legs: (c.match_ids ?? [])
              .map((id: string) => matchById.get(id))
              .filter(Boolean)
              .map((m: any) => ({
                sport: m.sport,
                league: m.league ?? "",
                homeTeam: m.home_team,
                awayTeam: m.away_team,
                commenceTime: m.commence_time,
                market: m.market,
                marketLabel: m.market,
                selection: m.pick_selection,
                bestPrice: Number(m.best_price),
                confidenceScore: Number(m.confidence_score),
                confidenceBand: m.confidence_band,
              })),
          },
        ];
      })
    );

    const ordered = DISPLAY_TIERS.map((meta) => {
      const existing = byTier.get(meta.tier);
      if (existing) return existing;
      return {
        tier: meta.tier,
        targetOdds: meta.targetOdds,
        combinedOdds: 0,
        impliedProbability: 0,
        riskProfile: meta.riskProfile,
        slipNote: meta.slipNote,
        targetReached: false,
        underfillNote:
          "Not enough Step-1 picks to reach this target today.",
        disclaimer: meta.requiresDisclaimer ? HIGH_TIER_DISCLAIMER : null,
        legs: [] as any[],
      };
    });

    return NextResponse.json({
      runId: run.id,
      matchCount: run.match_count,
      createdAt: run.created_at,
      sports: run.sports,
      canRunToday,
      ranToday,
      scanLocked,
      nextUnlockAt: nextUnlock.toISOString(),
      windowLabel: analysisWindowLabel(),
      combinations: ordered,
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err.message ?? "Failed to load latest run." },
      { status: 500 }
    );
  }
}

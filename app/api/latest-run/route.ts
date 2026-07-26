import { NextResponse } from "next/server";
import {
  analysisWindowLabel,
  currentAnalysisWindowStart,
  nextAnalysisUnlock,
} from "@/lib/analysisWindow";
import { TIERS } from "@/lib/combinations";
import { getSupabaseServer } from "@/lib/supabase";

export async function GET() {
  try {
    const supabase = getSupabaseServer();
    const windowStart = currentAnalysisWindowStart();
    const unlockAt = nextAnalysisUnlock();

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
        nextUnlockAt: unlockAt.toISOString(),
        windowLabel: analysisWindowLabel(),
      });
    }

    const ranInCurrentWindow =
      new Date(run.created_at).getTime() >= windowStart.getTime();
    const canRunToday = !ranInCurrentWindow;

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
          "id, sport, league, home_team, away_team, commence_time, market, pick_selection, best_price, confidence_score, confidence_band"
        )
        .in("id", allMatchIds);
      if (legError) throw legError;
      matchById = new Map((legs ?? []).map((m) => [m.id, m]));
    }

    const byTier = new Map(
      (combinations ?? []).map((c) => [
        c.tier,
        {
          tier: c.tier,
          targetOdds: Number(c.target_odds),
          combinedOdds: Number(c.combined_odds),
          impliedProbability: Number(c.implied_probability),
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
      ])
    );

    // Always surface 2x / 5x / 50x / 100x / 1000x slots
    const ordered = TIERS.map(({ tier, targetOdds }) => {
      const existing = byTier.get(tier);
      if (existing) return existing;
      return {
        tier,
        targetOdds,
        combinedOdds: 0,
        impliedProbability: 0,
        legs: [] as any[],
      };
    });

    return NextResponse.json({
      runId: run.id,
      matchCount: run.match_count,
      createdAt: run.created_at,
      sports: run.sports,
      canRunToday,
      nextUnlockAt: unlockAt.toISOString(),
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

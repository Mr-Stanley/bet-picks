import { NextResponse } from "next/server";
import {
  analysisWindowLabel,
  currentAnalysisWindowStart,
  nextAnalysisUnlock,
} from "@/lib/analysisWindow";
import { fetchTodaysOdds } from "@/lib/oddsApi";
import { categorizePicks, scoreMatches } from "@/lib/scoring";
import { buildCombinations } from "@/lib/combinations";
import { getSupabaseServer } from "@/lib/supabase";

export const maxDuration = 60;

export async function POST() {
  try {
    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing ODDS_API_KEY environment variable." },
        { status: 500 }
      );
    }

    const supabase = getSupabaseServer();
    const windowStart = currentAnalysisWindowStart();
    const unlockAt = nextAnalysisUnlock();

    // One analysis per day-window starting at 09:00 local (ANALYSIS_TZ).
    const { data: todaysRun, error: todaysError } = await supabase
      .from("runs")
      .select("id, created_at")
      .gte("created_at", windowStart.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (todaysError) throw todaysError;

    if (todaysRun) {
      return NextResponse.json(
        {
          error: `Analysis already ran for today's window (opens daily at ${analysisWindowLabel()}). Next run available ${unlockAt.toLocaleString()}.`,
          runId: todaysRun.id,
          ranAt: todaysRun.created_at,
          canRunToday: false,
          nextUnlockAt: unlockAt.toISOString(),
          windowStart: windowStart.toISOString(),
        },
        { status: 429 }
      );
    }

    const matches = await fetchTodaysOdds(apiKey);
    const picks = scoreMatches(matches);
    const categorized = categorizePicks(picks);
    const combinations = buildCombinations(picks);

    // Active picks belong to the current run only — clear previous pending
    // rows so they don't mix with the new slip. Settled results are kept.
    const { error: clearPendingError } = await supabase
      .from("matches")
      .delete()
      .eq("result", "pending");
    if (clearPendingError) throw clearPendingError;

    const { data: run, error: runError } = await supabase
      .from("runs")
      .insert({
        sports: Array.from(new Set(matches.map((m) => m.sport))),
        match_count: matches.length,
        status: "complete",
      })
      .select()
      .single();

    if (runError) throw runError;

    if (picks.length > 0) {
      const { error: matchesError } = await supabase.from("matches").insert(
        picks.map((p) => ({
          run_id: run.id,
          event_id: p.eventId,
          sport: p.sport,
          league: p.league,
          home_team: p.homeTeam,
          away_team: p.awayTeam,
          commence_time: p.commenceTime,
          market: p.market,
          pick_selection: p.selection,
          best_price: p.bestPrice,
          book: p.book,
          num_books: p.numBooks,
          price_spread: p.priceSpread,
          implied_prob: p.impliedProb,
          confidence_score: p.confidenceScore,
          confidence_band: p.confidenceBand,
          result: "pending",
          raw: p.raw,
        }))
      );
      if (matchesError) throw matchesError;
    }

    const { data: insertedMatches, error: fetchError } = await supabase
      .from("matches")
      .select("id, home_team, away_team, commence_time, pick_selection")
      .eq("run_id", run.id);
    if (fetchError) throw fetchError;

    const idLookup = new Map(
      (insertedMatches ?? []).map((m) => [
        `${m.home_team}__${m.away_team}__${m.commence_time}__${m.pick_selection}`,
        m.id,
      ])
    );

    const comboRows = combinations
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map((c) => ({
        run_id: run.id,
        tier: c.tier,
        target_odds: c.targetOdds,
        combined_odds: c.combinedOdds,
        implied_probability: c.impliedProbability,
        leg_count: c.legs.length,
        match_ids: c.legs
          .map((l) =>
            idLookup.get(
              `${l.homeTeam}__${l.awayTeam}__${l.commenceTime}__${l.selection}`
            )
          )
          .filter(Boolean),
      }));

    if (comboRows.length > 0) {
      const { error: comboError } = await supabase
        .from("combinations")
        .insert(comboRows);
      if (comboError) throw comboError;
    }

    return NextResponse.json({
      runId: run.id,
      matchCount: matches.length,
      pickCount: picks.length,
      picks,
      categorized,
      combinations,
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err.message ?? "Unknown error running analysis." },
      { status: 500 }
    );
  }
}

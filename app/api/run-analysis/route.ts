import { NextResponse } from "next/server";
import { fetchTodaysOdds } from "@/lib/oddsApi";
import {
  categorizePicks,
  pickBestPerEvent,
  scoreMatches,
  ScoredPick,
} from "@/lib/scoring";
import {
  buildCombinations,
  buildDrawCombination,
} from "@/lib/combinations";
import { getSupabaseServer } from "@/lib/supabase";

export const maxDuration = 60;

function pickInsertKey(p: ScoredPick): string {
  return `${p.homeTeam}__${p.awayTeam}__${p.commenceTime}__${p.selection}`;
}

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

    const matches = await fetchTodaysOdds(apiKey);
    const scored = scoreMatches(matches);
    const bestPicks = pickBestPerEvent(scored);
    const categorized = categorizePicks(bestPicks);
    const mainCombos = buildCombinations(bestPicks);
    const drawCombo = buildDrawCombination(scored);
    const combinations = [...mainCombos, drawCombo];

    // Persist one pick per game, plus any draw-combo legs not already selected.
    const toInsert: ScoredPick[] = [...bestPicks];
    const insertedKeys = new Set(bestPicks.map(pickInsertKey));
    if (drawCombo) {
      for (const leg of drawCombo.legs) {
        const key = pickInsertKey(leg);
        if (!insertedKeys.has(key)) {
          toInsert.push(leg);
          insertedKeys.add(key);
        }
      }
    }

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

    if (toInsert.length > 0) {
      const { error: matchesError } = await supabase.from("matches").insert(
        toInsert.map((p) => ({
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
      pickCount: bestPicks.length,
      leagueCount: new Set(matches.map((m) => m.sport)).size,
      picks: bestPicks,
      categorized,
      combinations,
      canRunToday: true,
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err.message ?? "Unknown error running analysis." },
      { status: 500 }
    );
  }
}

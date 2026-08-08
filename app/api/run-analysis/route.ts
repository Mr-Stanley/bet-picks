import { NextResponse } from "next/server";
import {
  analysisWindowLabel,
  currentCalendarDayStart,
  nextCalendarDayStart,
} from "@/lib/scanLock";
import { fetchTodaysOdds } from "@/lib/oddsApi";
import {
  pickBestPerEvent,
  scoreMatches,
  ScoredPick,
} from "@/lib/scoring";
import { buildCombinations } from "@/lib/combinations";
import {
  buildMatchReports,
  qualifiedPicksFromReports,
} from "@/lib/analyst";
import { fetchMatchStatsMap } from "@/lib/statsApi";
import { getSupabaseServer } from "@/lib/supabase";

export const maxDuration = 60;

function pickInsertKey(p: ScoredPick): string {
  return `${p.homeTeam}__${p.awayTeam}__${p.commenceTime}__${p.selection}`;
}

async function parseForce(req: Request): Promise<boolean> {
  const url = new URL(req.url);
  if (url.searchParams.get("force") === "true") return true;
  try {
    const clone = req.clone();
    const body = await clone.json();
    return body?.force === true;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing ODDS_API_KEY environment variable." },
        { status: 500 }
      );
    }

    const force = await parseForce(req);

    const supabase = getSupabaseServer();
    const dayStart = currentCalendarDayStart();
    const nextDay = nextCalendarDayStart();

    const { data: todaysRun, error: todaysError } = await supabase
      .from("runs")
      .select("id, created_at")
      .gte("created_at", dayStart.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (todaysError) throw todaysError;

    if (todaysRun && !force) {
      return NextResponse.json(
        {
          error:
            "Scan already cached for today. Refuse to re-run until the next calendar day unless you explicitly force a re-scan.",
          runId: todaysRun.id,
          ranAt: todaysRun.created_at,
          scanLocked: true,
          canRunToday: false,
          nextUnlockAt: nextDay.toISOString(),
          windowLabel: analysisWindowLabel(),
        },
        { status: 429 }
      );
    }

    const matches = await fetchTodaysOdds(apiKey);
    const statsByEvent = await fetchMatchStatsMap(matches);
    const scored = scoreMatches(matches, statsByEvent);
    const bestPerEvent = pickBestPerEvent(scored);
    const reports = buildMatchReports(bestPerEvent, statsByEvent);
    const qualified = qualifiedPicksFromReports(reports);
    const combinations = buildCombinations(qualified);

    const toInsert: ScoredPick[] = [...qualified];
    // Also persist no-pick events as placeholder rows? Plan says table of all matches.
    // Store all bestPerEvent with analysis; only qualified have real picks for combos.
    // For no-pick rows use a sentinel selection so UI can show the report.
    const insertedKeys = new Set(qualified.map(pickInsertKey));
    for (const report of reports) {
      if (report.scoredPick) continue;
      const stub: ScoredPick = bestPerEvent.find(
        (p) => p.eventId === report.eventId
      )!;
      if (!stub) continue;
      const key = pickInsertKey(stub);
      if (insertedKeys.has(key)) continue;
      toInsert.push(stub);
      insertedKeys.add(key);
    }

    const { error: clearPendingError } = await supabase
      .from("matches")
      .delete()
      .eq("result", "pending");
    if (clearPendingError) throw clearPendingError;

    // On force re-scan, also drop today's prior combinations via cascade when we
    // don't delete runs — pending matches cleared; old run rows remain history.
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

    const reportByEvent = new Map(reports.map((r) => [r.eventId, r]));

    if (toInsert.length > 0) {
      const { error: matchesError } = await supabase.from("matches").insert(
        toInsert.map((p) => {
          const report = reportByEvent.get(p.eventId);
          const isQualified = Boolean(report?.scoredPick);
          return {
            run_id: run.id,
            event_id: p.eventId,
            sport: p.sport,
            league: p.league,
            home_team: p.homeTeam,
            away_team: p.awayTeam,
            commence_time: p.commenceTime,
            market: isQualified ? p.market : p.market,
            pick_selection: isQualified
              ? p.selection
              : report?.noPickReason ?? "no pick — insufficient data",
            best_price: p.bestPrice,
            book: p.book,
            num_books: p.numBooks,
            price_spread: p.priceSpread,
            implied_prob: p.impliedProb,
            confidence_score: report?.confidence ?? p.rankScore ?? p.confidenceScore,
            confidence_band: p.confidenceBand,
            result: "pending",
            raw: {
              analysis: report
                ? {
                    form: report.form,
                    h2h: report.h2h,
                    injuries: report.injuries,
                    context: report.context,
                    weather: report.weather,
                    referee: report.referee,
                    lineMovement: report.lineMovement,
                    marketNotes: report.marketNotes,
                    assessedProb: report.assessedProb,
                    impliedProb: report.impliedProb,
                    valueFlag: report.valueFlag,
                    risk: report.risk,
                    confidence: report.confidence,
                    justification: report.justification,
                    whatCouldGoWrong: report.whatCouldGoWrong,
                    pickSelection: report.pickSelection,
                    pickOdds: report.pickOdds,
                    noPickReason: report.noPickReason,
                  }
                : null,
              statsHint: p.statsHint ?? null,
              consensusScore: p.confidenceScore,
              rankScore: p.rankScore,
              hasPick: isQualified,
            },
          };
        })
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
      pickCount: qualified.length,
      reportCount: reports.length,
      leagueCount: new Set(matches.map((m) => m.sport)).size,
      statsMatched: statsByEvent.size,
      reports,
      combinations,
      scanLocked: true,
      canRunToday: false,
      nextUnlockAt: nextDay.toISOString(),
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err.message ?? "Unknown error running analysis." },
      { status: 500 }
    );
  }
}

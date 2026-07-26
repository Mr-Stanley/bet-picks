import { NextResponse } from "next/server";
import { fetchScores } from "@/lib/oddsApi";
import { getSupabaseServer } from "@/lib/supabase";
import { settlePick } from "@/lib/settle";

export const maxDuration = 60;

async function runSettle() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing ODDS_API_KEY" },
      { status: 500 }
    );
  }

  const supabase = getSupabaseServer();
  const { data: pending, error } = await supabase
    .from("matches")
    .select(
      "id, event_id, sport, market, pick_selection, home_team, away_team, best_price, commence_time"
    )
    .eq("result", "pending")
    .lt("commence_time", new Date().toISOString());

  if (error) throw error;
  if (!pending?.length) {
    return NextResponse.json({
      settled: 0,
      skipped: 0,
      message: "No pending picks to settle.",
    });
  }

  const sports = Array.from(new Set(pending.map((p) => p.sport)));
  const scoresByEvent = new Map<string, any>();
  const scoresByTeams = new Map<string, any>();

  for (const sport of sports) {
    const rows = await fetchScores(apiKey, sport, 3);
    for (const row of rows) {
      if (row.completed && row.scores) {
        scoresByEvent.set(row.id, row);
        scoresByTeams.set(
          `${row.sport_key}|${row.home_team}|${row.away_team}`,
          row
        );
      }
    }
  }

  let settled = 0;
  let skipped = 0;

  for (const pick of pending) {
    let scores =
      (pick.event_id && scoresByEvent.get(pick.event_id)?.scores) || null;
    if (!scores) {
      const row = scoresByTeams.get(
        `${pick.sport}|${pick.home_team}|${pick.away_team}`
      );
      scores = row?.scores ?? null;
    }

    const result = settlePick(
      {
        id: pick.id,
        market: pick.market,
        pick_selection: pick.pick_selection,
        point: null,
        home_team: pick.home_team,
        away_team: pick.away_team,
        best_price: Number(pick.best_price),
      },
      scores
    );

    if (!result) {
      skipped++;
      continue;
    }

    const { error: upErr } = await supabase
      .from("matches")
      .update({ result: result.result, profit: result.profit })
      .eq("id", pick.id);
    if (upErr) throw upErr;
    settled++;
  }

  return NextResponse.json({
    settled,
    skipped,
    settledAt: new Date().toISOString(),
  });
}

export async function POST() {
  try {
    return await runSettle();
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err.message ?? "Settle failed." },
      { status: 500 }
    );
  }
}

/** Vercel Cron uses GET. */
export async function GET() {
  return POST();
}

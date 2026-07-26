import { NextResponse } from "next/server";
import { marketLabel } from "@/lib/oddsApi";
import { getSupabaseServer } from "@/lib/supabase";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tab = searchParams.get("tab") === "results" ? "results" : "picks";
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
    const pageSize = Math.min(
      50,
      Math.max(1, Number(searchParams.get("pageSize") ?? "20") || 20)
    );
    let runId = searchParams.get("runId");
    const sport = searchParams.get("sport");
    const league = searchParams.get("league");
    const outcome = searchParams.get("outcome"); // won | lost | void | all
    const fromDate = searchParams.get("from"); // YYYY-MM-DD
    const toDate = searchParams.get("to");

    const supabase = getSupabaseServer();

    // Picks tab always shows the latest run's pending picks (until next re-run).
    if (tab === "picks" && !runId) {
      const { data: latest } = await supabase
        .from("runs")
        .select("id")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      runId = latest?.id ?? null;
      if (!runId) {
        return NextResponse.json({
          tab,
          page,
          pageSize,
          total: 0,
          totalPages: 1,
          runId: null,
          items: [],
          filters: { sports: [], leagues: [] },
        });
      }
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase.from("matches").select(
      "id, run_id, event_id, sport, league, home_team, away_team, commence_time, market, pick_selection, best_price, book, confidence_score, confidence_band, result, profit",
      { count: "exact" }
    );

    if (tab === "picks") {
      query = query
        .eq("result", "pending")
        .order("commence_time", { ascending: true });
      if (runId) query = query.eq("run_id", runId);
    } else {
      query = query
        .in("result", ["won", "lost", "void"])
        .order("commence_time", { ascending: false });

      if (outcome && ["won", "lost", "void"].includes(outcome)) {
        query = query.eq("result", outcome);
      }
      if (fromDate) {
        query = query.gte("commence_time", `${fromDate}T00:00:00.000Z`);
      }
      if (toDate) {
        query = query.lte("commence_time", `${toDate}T23:59:59.999Z`);
      }
    }

    if (sport) query = query.eq("sport", sport);
    if (league) query = query.eq("league", league);

    const { data, error, count } = await query.range(from, to);
    if (error) throw error;

    // Distinct filter options for the Results UI (from settled rows).
    let sports: string[] = [];
    let leagues: string[] = [];
    if (tab === "results") {
      const { data: settledMeta } = await supabase
        .from("matches")
        .select("sport, league")
        .in("result", ["won", "lost", "void"]);
      sports = Array.from(
        new Set((settledMeta ?? []).map((r) => r.sport).filter(Boolean))
      ).sort();
      leagues = Array.from(
        new Set(
          (settledMeta ?? [])
            .map((r) => r.league)
            .filter((l): l is string => Boolean(l))
        )
      ).sort();
    }

    const items = (data ?? []).map((m) => ({
      id: m.id,
      runId: m.run_id,
      eventId: m.event_id,
      sport: m.sport,
      league: m.league ?? "",
      homeTeam: m.home_team,
      awayTeam: m.away_team,
      commenceTime: m.commence_time,
      market: m.market,
      marketLabel: marketLabel(m.market),
      selection: m.pick_selection,
      bestPrice: Number(m.best_price),
      book: m.book ?? "unknown",
      confidenceScore: Number(m.confidence_score),
      confidenceBand: m.confidence_band as "high" | "medium" | "low",
      result: m.result as "pending" | "won" | "lost" | "void",
      profit:
        m.profit === null || m.profit === undefined ? null : Number(m.profit),
    }));

    const total = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return NextResponse.json({
      tab,
      page,
      pageSize,
      total,
      totalPages,
      runId: runId ?? null,
      items,
      filters: { sports, leagues },
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err.message ?? "Failed to load picks." },
      { status: 500 }
    );
  }
}

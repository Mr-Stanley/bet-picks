"use client";

import { useCallback, useEffect, useState } from "react";

type ConfidenceBand = "high" | "medium" | "low";

type PickItem = {
  id: string;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  market: string;
  marketLabel: string;
  selection: string;
  bestPrice: number;
  book: string;
  confidenceScore: number;
  confidenceBand: ConfidenceBand;
  result: "pending" | "won" | "lost" | "void";
  profit: number | null;
};

type ComboLeg = {
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  league: string;
  marketLabel?: string;
  selection: string;
  bestPrice: number;
  confidenceScore: number;
  confidenceBand: ConfidenceBand;
};

type Combination = {
  tier: string;
  targetOdds: number;
  combinedOdds: number;
  impliedProbability: number;
  legs: ComboLeg[];
};

type LatestRun = {
  runId: string;
  matchCount: number;
  createdAt: string;
  combinations: Combination[];
  canRunToday: boolean;
  nextUnlockAt?: string;
  windowLabel?: string;
};

type PicksPage = {
  tab: "picks" | "results";
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  runId?: string | null;
  items: PickItem[];
  filters?: { sports: string[]; leagues: string[] };
};

const bandColor: Record<ConfidenceBand, string> = {
  high: "text-accent",
  medium: "text-warn",
  low: "text-danger",
};

const PAGE_SIZE = 20;
const AUTO_MS = 5 * 60 * 1000;

function formatKickoff(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ProbabilityGauge({ probability }: { probability: number }) {
  const pct = Math.max(probability * 100, 0.5);
  return (
    <div className="h-1.5 w-full rounded-full bg-surfaceRaised overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-accent to-warn"
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

function resultBadge(result: PickItem["result"]) {
  if (result === "won") return "text-accent";
  if (result === "lost") return "text-danger";
  if (result === "void") return "text-muted";
  return "text-muted";
}

function ComboCard({ combo }: { combo: Combination }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5 flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">
            Target {combo.tier}
          </div>
          <div className="font-display text-2xl font-bold">
            {combo.combinedOdds.toFixed(2)}x
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-muted">
            Implied probability
          </div>
          <div className="font-mono text-lg">
            {(combo.impliedProbability * 100).toFixed(2)}%
          </div>
        </div>
      </div>
      <ProbabilityGauge probability={combo.impliedProbability} />
      <div className="text-xs text-muted">
        {combo.legs.length} leg{combo.legs.length !== 1 ? "s" : ""} - every leg
        must win
      </div>
      <div className="flex flex-col gap-2">
        {combo.legs.map((leg, i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-md bg-surfaceRaised px-3 py-2 text-sm"
          >
            <div className="flex flex-col">
              <span className="font-medium">
                {leg.homeTeam} vs {leg.awayTeam}
              </span>
              <span className="text-muted text-xs">
                {leg.league} · {formatKickoff(leg.commenceTime)}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="font-mono">{leg.selection}</span>
              <span className={`text-xs font-mono ${bandColor[leg.confidenceBand]}`}>
                {leg.bestPrice.toFixed(2)} - {leg.confidenceScore}/100
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [latest, setLatest] = useState<LatestRun | null>(null);
  const [tab, setTab] = useState<"picks" | "results">("picks");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<PicksPage | null>(null);
  const [lastSettleAt, setLastSettleAt] = useState<string | null>(null);
  const [filterSport, setFilterSport] = useState("all");
  const [filterLeague, setFilterLeague] = useState("all");
  const [filterOutcome, setFilterOutcome] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [canRunToday, setCanRunToday] = useState(true);
  const [nextUnlockAt, setNextUnlockAt] = useState<string | null>(null);
  const [windowLabel, setWindowLabel] = useState("09:00");

  const loadLatest = useCallback(async () => {
    const res = await fetch("/api/latest-run");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to load latest run.");
    setCanRunToday(data.canRunToday !== false);
    setNextUnlockAt(data.nextUnlockAt ?? null);
    setWindowLabel(data.windowLabel ?? "09:00");
    if (data.runId) {
      setLatest({
        runId: data.runId,
        matchCount: data.matchCount,
        createdAt: data.createdAt,
        combinations: data.combinations ?? [],
        canRunToday: Boolean(data.canRunToday),
        nextUnlockAt: data.nextUnlockAt,
        windowLabel: data.windowLabel,
      });
    } else {
      setLatest(null);
    }
  }, []);

  const loadList = useCallback(
    async (
      nextTab: "picks" | "results",
      nextPage: number,
      filters?: {
        sport?: string;
        league?: string;
        outcome?: string;
        from?: string;
        to?: string;
      }
    ) => {
      const params = new URLSearchParams({
        tab: nextTab,
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      if (nextTab === "results") {
        const f = filters ?? {
          sport: filterSport,
          league: filterLeague,
          outcome: filterOutcome,
          from: filterFrom,
          to: filterTo,
        };
        if (f.sport && f.sport !== "all") params.set("sport", f.sport);
        if (f.league && f.league !== "all") params.set("league", f.league);
        if (f.outcome && f.outcome !== "all") params.set("outcome", f.outcome);
        if (f.from) params.set("from", f.from);
        if (f.to) params.set("to", f.to);
      }
      const res = await fetch(`/api/picks?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load picks.");
      setList(data);
    },
    [filterFrom, filterLeague, filterOutcome, filterSport, filterTo]
  );

  const settleAndRefresh = useCallback(async () => {
    try {
      const res = await fetch("/api/settle", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setLastSettleAt(data.settledAt ?? new Date().toISOString());
        if (data.settled > 0) {
          setStatus(`Auto-settled ${data.settled} pick(s).`);
        }
      }
      await loadList(tab, page);
      await loadLatest();
    } catch {
      /* ignore background settle errors */
    }
  }, [loadLatest, loadList, page, tab]);

  useEffect(() => {
    (async () => {
      try {
        await loadLatest();
        await loadList("picks", 1);
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, [loadLatest, loadList]);

  useEffect(() => {
    const id = setInterval(() => {
      settleAndRefresh();
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [settleAndRefresh]);

  useEffect(() => {
    function onFocus() {
      settleAndRefresh();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [settleAndRefresh]);

  async function runAnalysis() {
    if (!canRunToday) {
      setError(
        `Analysis already ran for today's window. Next run available at ${
          nextUnlockAt
            ? new Date(nextUnlockAt).toLocaleString()
            : windowLabel
        }.`
      );
      return;
    }
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/run-analysis", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Run failed.");
      setStatus(
        `Run complete — ${data.pickCount} picks from ${data.matchCount} matches.`
      );
      setTab("picks");
      setPage(1);
      await loadLatest();
      await loadList("picks", 1);
    } catch (e: any) {
      setError(e.message);
      await loadLatest();
    } finally {
      setLoading(false);
    }
  }

  async function switchTab(next: "picks" | "results") {
    setTab(next);
    setPage(1);
    try {
      await loadList(next, 1);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function goPage(nextPage: number) {
    setPage(nextPage);
    try {
      await loadList(tab, nextPage);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function applyResultFilters() {
    setPage(1);
    try {
      await loadList("results", 1, {
        sport: filterSport,
        league: filterLeague,
        outcome: filterOutcome,
        from: filterFrom,
        to: filterTo,
      });
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function clearResultFilters() {
    setFilterSport("all");
    setFilterLeague("all");
    setFilterOutcome("all");
    setFilterFrom("");
    setFilterTo("");
    setPage(1);
    try {
      await loadList("results", 1, {
        sport: "all",
        league: "all",
        outcome: "all",
        from: "",
        to: "",
      });
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function settleNow() {
    setStatus("Settling…");
    try {
      const res = await fetch("/api/settle", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Settle failed.");
      setLastSettleAt(data.settledAt ?? new Date().toISOString());
      setStatus(
        `Settled ${data.settled} (skipped ${data.skipped ?? 0}).`
      );
      await loadList(tab, page);
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  return (
    <main className="max-w-5xl mx-auto px-6 py-12 flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <span className="text-xs uppercase tracking-widest text-muted font-mono">
          Football - Basketball - Tennis
        </span>
        <h1 className="font-display text-4xl font-bold">Daily Picks</h1>
        <p className="text-muted max-w-2xl text-sm leading-relaxed">
          Pulls today&apos;s odds, scores by bookmaker consensus, and builds
          combo slips. Active picks stay until you re-run analysis (settled
          games move to Results). Filter Results by sport, league, outcome, and
          date to look back.
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          <button
            onClick={runAnalysis}
            disabled={loading || !canRunToday}
            className="font-medium px-5 py-2.5 rounded-md bg-accent text-bg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? "Running analysis..."
              : !canRunToday
                ? "Already ran today"
                : "Run today's analysis"}
          </button>
          <button
            onClick={settleNow}
            className="px-4 py-2.5 rounded-md border border-border text-sm text-muted hover:text-text hover:border-accent"
          >
            Settle now
          </button>
        </div>
        {error && <div className="text-danger text-sm">{error}</div>}
        {status && <div className="text-muted text-sm font-mono">{status}</div>}
        <div className="text-xs text-muted font-mono">
          Auto-refresh every 5m · new analysis unlocks daily at {windowLabel}
          {lastSettleAt
            ? ` · last settle ${new Date(lastSettleAt).toLocaleTimeString()}`
            : ""}
          {!canRunToday && nextUnlockAt
            ? ` · next run ${new Date(nextUnlockAt).toLocaleString()}`
            : ""}
        </div>
      </header>

      {latest && (
        <>
          <div className="text-sm text-muted font-mono">
            Latest run {latest.runId.slice(0, 8)} · {latest.matchCount} matches ·{" "}
            {new Date(latest.createdAt).toLocaleString()}
          </div>

          <section className="flex flex-col gap-5">
            <h2 className="font-display text-xl font-bold">
              Combo tiers (2x · 5x · 50x · 100x · 1000x)
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {latest.combinations.map((combo) =>
                combo.legs.length > 0 ? (
                  <ComboCard key={combo.tier} combo={combo} />
                ) : (
                  <div
                    key={combo.tier}
                    className="rounded-lg border border-dashed border-border p-5 text-sm text-muted"
                  >
                    <div className="font-display text-lg font-bold text-text mb-1">
                      Target {combo.tier}
                    </div>
                    Not enough high-confidence legs today to honestly reach this
                    tier.
                  </div>
                )
              )}
            </div>
          </section>
        </>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex gap-2 border-b border-border">
          <button
            type="button"
            onClick={() => switchTab("picks")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === "picks"
                ? "border-accent text-text"
                : "border-transparent text-muted hover:text-text"
            }`}
          >
            Picks
          </button>
          <button
            type="button"
            onClick={() => switchTab("results")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === "results"
                ? "border-accent text-text"
                : "border-transparent text-muted hover:text-text"
            }`}
          >
            Results
          </button>
        </div>

        {tab === "picks" && latest && (
          <p className="text-xs text-muted">
            Showing pending picks from the latest run — they remain until the
            next analysis (finished ones move to Results).
          </p>
        )}

        {tab === "results" && (
          <div className="flex flex-wrap gap-3 items-end text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Outcome</span>
              <select
                className="bg-surface border border-border rounded px-2 py-1.5"
                value={filterOutcome}
                onChange={(e) => setFilterOutcome(e.target.value)}
              >
                <option value="all">All</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
                <option value="void">Void</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Sport</span>
              <select
                className="bg-surface border border-border rounded px-2 py-1.5"
                value={filterSport}
                onChange={(e) => setFilterSport(e.target.value)}
              >
                <option value="all">All</option>
                {(list?.filters?.sports ?? []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">League</span>
              <select
                className="bg-surface border border-border rounded px-2 py-1.5 max-w-[12rem]"
                value={filterLeague}
                onChange={(e) => setFilterLeague(e.target.value)}
              >
                <option value="all">All</option>
                {(list?.filters?.leagues ?? []).map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">From</span>
              <input
                type="date"
                className="bg-surface border border-border rounded px-2 py-1.5"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">To</span>
              <input
                type="date"
                className="bg-surface border border-border rounded px-2 py-1.5"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={applyResultFilters}
              className="px-3 py-1.5 rounded-md bg-accent text-bg text-sm font-medium"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={clearResultFilters}
              className="px-3 py-1.5 rounded-md border border-border text-muted text-sm hover:text-text"
            >
              Clear
            </button>
          </div>
        )}

        <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
          {!list || list.items.length === 0 ? (
            <div className="px-4 py-8 text-sm text-muted">
              {tab === "picks"
                ? "No pending picks. Run today's analysis to populate."
                : "No settled results yet. They appear after games finish and settle."}
            </div>
          ) : (
            list.items.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between px-4 py-3 bg-surface text-sm gap-4"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="font-medium truncate">
                    {p.homeTeam} vs {p.awayTeam}
                  </span>
                  <span className="text-muted text-xs">
                    {p.league} · {formatKickoff(p.commenceTime)} ·{" "}
                    {p.marketLabel}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-right">{p.selection}</span>
                  <span className="font-mono w-12 text-right">
                    {p.bestPrice.toFixed(2)}
                  </span>
                  {tab === "results" ? (
                    <>
                      <span
                        className={`font-mono text-xs uppercase ${resultBadge(p.result)}`}
                      >
                        {p.result}
                      </span>
                      <span className="font-mono text-xs w-14 text-right">
                        {p.profit === null
                          ? "—"
                          : `${p.profit >= 0 ? "+" : ""}${p.profit.toFixed(2)}`}
                      </span>
                    </>
                  ) : (
                    <span
                      className={`font-mono text-xs px-2 py-1 rounded ${bandColor[p.confidenceBand]} bg-surfaceRaised`}
                    >
                      {p.confidenceScore}/100
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {list && list.totalPages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => goPage(page - 1)}
              className="px-3 py-1.5 rounded border border-border text-muted hover:text-text disabled:opacity-40"
            >
              Prev
            </button>
            <span className="font-mono text-muted">
              Page {list.page} of {list.totalPages} · {list.total} total
            </span>
            <button
              type="button"
              disabled={page >= list.totalPages}
              onClick={() => goPage(page + 1)}
              className="px-3 py-1.5 rounded border border-border text-muted hover:text-text disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

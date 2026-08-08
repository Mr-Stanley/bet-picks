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
  homeScore: number | null;
  awayScore: number | null;
  statsHint?: string | null;
  hasPick?: boolean;
  analysis?: {
    form: string;
    h2h: string;
    injuries: string;
    context: string;
    risk: string | null;
    confidence: number | null;
    justification: string;
    whatCouldGoWrong: string;
    pickSelection: string | null;
    pickOdds: number | null;
    noPickReason: string | null;
    valueFlag: boolean;
  } | null;
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
  riskProfile?: string;
  slipNote?: string;
  targetReached?: boolean;
  disclaimer?: string | null;
};

type LatestRun = {
  runId: string;
  matchCount: number;
  createdAt: string;
  combinations: Combination[];
  canRunToday: boolean;
  ranToday?: boolean;
  scanLocked?: boolean;
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

function formatScore(home: number | null, away: number | null): string {
  if (home === null || away === null || Number.isNaN(home) || Number.isNaN(away)) {
    return "—";
  }
  return `${home}–${away}`;
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

function ConfidenceBar({
  score,
  band,
}: {
  score: number;
  band: ConfidenceBand;
}) {
  const fill =
    band === "high" ? "bg-accent" : band === "medium" ? "bg-warn" : "bg-danger";
  return (
    <div className="flex items-center gap-2 min-w-[5.5rem]">
      <div className="h-1 flex-1 rounded-full bg-surfaceRaised overflow-hidden">
        <div
          className={`h-full rounded-full ${fill}`}
          style={{ width: `${Math.min(Math.max(score, 0), 100)}%` }}
        />
      </div>
      <span className={`font-mono text-[11px] tabular-nums ${bandColor[band]}`}>
        {score}
      </span>
    </div>
  );
}

function resultBadge(result: PickItem["result"]) {
  if (result === "won") return "text-accent bg-accent/10";
  if (result === "lost") return "text-danger bg-danger/10";
  if (result === "void") return "text-muted bg-surfaceRaised";
  return "text-muted bg-surfaceRaised";
}

function tierLabel(tier: string): string {
  return `Target ${tier}`;
}

function formatComboSlip(combo: Combination): string {
  const lines = [
    `${tierLabel(combo.tier)} @ ${combo.combinedOdds.toFixed(2)}x (${combo.riskProfile ?? ""} · ${combo.slipNote ?? ""})`,
    ...combo.legs.map(
      (leg, i) =>
        `${i + 1}. ${leg.homeTeam} vs ${leg.awayTeam} — ${leg.selection} @ ${leg.bestPrice.toFixed(2)}`
    ),
  ];
  if (combo.disclaimer) lines.push("", combo.disclaimer);
  return lines.join("\n");
}

function ComboCard({ combo }: { combo: Combination }) {
  const [copied, setCopied] = useState(false);
  const underTarget =
    combo.targetReached === false ||
    combo.combinedOdds + 0.001 < combo.targetOdds;

  async function copySlip() {
    try {
      await navigator.clipboard.writeText(formatComboSlip(combo));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  if (combo.legs.length === 0) {
    return (
      <div className="combo-card rounded-xl border border-dashed border-border/80 p-4 sm:p-5 text-sm text-muted bg-surface/30">
        <div className="font-display text-lg font-bold text-text mb-1">
          {tierLabel(combo.tier)}
        </div>
        <div className="text-xs mb-2">
          {combo.riskProfile} · {combo.slipNote}
        </div>
        Not enough Step-1 picks to build this slip today.
        {combo.disclaimer && (
          <p className="mt-3 text-[11px] text-warn leading-relaxed">
            {combo.disclaimer}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="combo-card rounded-xl border border-border bg-surface/80 backdrop-blur-sm p-4 sm:p-5 flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted">
            {tierLabel(combo.tier)} · {combo.riskProfile}
          </div>
          <div className="font-display text-2xl font-bold tabular-nums">
            {combo.combinedOdds.toFixed(2)}x
          </div>
          <div className="text-[11px] text-muted mt-0.5">{combo.slipNote}</div>
          {underTarget && (
            <div className="text-[11px] text-warn mt-1">
              Closest achievable: {combo.combinedOdds.toFixed(1)}x (target{" "}
              {combo.targetOdds}x)
            </div>
          )}
        </div>
        <div className="text-right flex flex-col items-end gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted">
              Implied
            </div>
            <div className="font-mono text-base sm:text-lg tabular-nums">
              {(combo.impliedProbability * 100).toFixed(2)}%
            </div>
          </div>
          <button
            type="button"
            onClick={copySlip}
            className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted hover:text-text hover:border-accent transition-colors"
          >
            {copied ? "Copied" : "Copy slip"}
          </button>
        </div>
      </div>
      <ProbabilityGauge probability={combo.impliedProbability} />
      <div className="text-xs text-muted">
        {combo.legs.length} leg{combo.legs.length !== 1 ? "s" : ""} — every leg
        must win
      </div>
      {combo.disclaimer && (
        <p className="text-[11px] text-warn leading-relaxed border border-warn/20 rounded-lg px-3 py-2 bg-warn/5">
          {combo.disclaimer}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {combo.legs.map((leg, i) => (
          <div
            key={i}
            className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between rounded-lg bg-surfaceRaised/80 px-3 py-2.5 text-sm"
          >
            <div className="flex flex-col min-w-0">
              <span className="font-medium truncate">
                {leg.homeTeam} vs {leg.awayTeam}
              </span>
              <span className="text-muted text-xs">
                {leg.league} · {formatKickoff(leg.commenceTime)}
              </span>
            </div>
            <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2 sm:gap-0.5 shrink-0">
              <span className="font-mono text-sm">{leg.selection}</span>
              <span
                className={`text-xs font-mono ${bandColor[leg.confidenceBand]}`}
              >
                {leg.bestPrice.toFixed(2)} · {leg.confidenceScore}/10
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PickRow({
  pick,
  tab,
}: {
  pick: PickItem;
  tab: "picks" | "results";
}) {
  const scoreLabel = formatScore(pick.homeScore, pick.awayScore);
  const a = pick.analysis;
  const displayPick =
    a?.noPickReason ?? a?.pickSelection ?? pick.selection;
  const displayOdds = a?.pickOdds ?? pick.bestPrice;
  const conf = a?.confidence ?? Math.round(pick.confidenceScore / 10);

  return (
    <article className="flex flex-col gap-3 px-4 py-4 sm:px-5 bg-surface/60 hover:bg-surface transition-colors">
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-medium text-sm sm:text-base leading-snug">
            {pick.homeTeam}{" "}
            <span className="text-muted font-normal">vs</span> {pick.awayTeam}
          </h3>
          {tab === "results" && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-sm tabular-nums text-text">
                {scoreLabel}
              </span>
              <span
                className={`font-mono text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-md ${resultBadge(pick.result)}`}
              >
                {pick.result}
              </span>
            </div>
          )}
          {tab === "picks" && a?.risk && (
            <span className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-md bg-surfaceRaised text-muted shrink-0">
              {a.risk} risk
            </span>
          )}
        </div>
        <p className="text-muted text-xs leading-relaxed">
          <span className="uppercase tracking-wide">{pick.sport}</span>
          {pick.league ? ` · ${pick.league}` : ""} ·{" "}
          {formatKickoff(pick.commenceTime)} · {pick.marketLabel}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] uppercase tracking-wide text-muted">
            Pick
          </span>
          <span className="font-mono truncate">{displayPick}</span>
        </div>
        {!a?.noPickReason && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-muted">
              Odds
            </span>
            <span className="font-mono tabular-nums">
              {displayOdds.toFixed(2)}
            </span>
          </div>
        )}
        {tab === "results" ? (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[11px] uppercase tracking-wide text-muted">
              P/L
            </span>
            <span
              className={`font-mono text-xs tabular-nums ${
                pick.profit === null
                  ? "text-muted"
                  : pick.profit >= 0
                    ? "text-accent"
                    : "text-danger"
              }`}
            >
              {pick.profit === null
                ? "—"
                : `${pick.profit >= 0 ? "+" : ""}${pick.profit.toFixed(2)}`}
            </span>
          </div>
        ) : (
          <div className="ml-auto font-mono text-xs tabular-nums text-muted">
            Conf {conf}/10
          </div>
        )}
      </div>

      {tab === "picks" && a && (
        <div className="grid gap-2 text-xs text-muted border-t border-border/60 pt-3">
          <p>
            <span className="text-text/80">Justification:</span>{" "}
            {a.justification || "—"}
          </p>
          <p>
            <span className="text-text/80">What could go wrong:</span>{" "}
            {a.whatCouldGoWrong || "—"}
          </p>
          <p className="font-mono text-[11px] text-accent/80">
            Form: {a.form} · H2H: {a.h2h}
          </p>
          <p className="font-mono text-[11px]">
            Injuries: {a.injuries} · Context: {a.context}
          </p>
        </div>
      )}
    </article>
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
  const [ranToday, setRanToday] = useState(false);
  const [scanLocked, setScanLocked] = useState(false);
  const [nextUnlockAt, setNextUnlockAt] = useState<string | null>(null);

  const loadLatest = useCallback(async () => {
    const res = await fetch("/api/latest-run");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to load latest run.");
    setRanToday(Boolean(data.ranToday));
    setScanLocked(Boolean(data.scanLocked));
    setNextUnlockAt(data.nextUnlockAt ?? null);
    if (data.runId) {
      setLatest({
        runId: data.runId,
        matchCount: data.matchCount,
        createdAt: data.createdAt,
        combinations: data.combinations ?? [],
        canRunToday: Boolean(data.canRunToday),
        ranToday: Boolean(data.ranToday),
        scanLocked: Boolean(data.scanLocked),
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

  async function runAnalysis(force = false) {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/run-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Run failed.");
      const leagues =
        typeof data.leagueCount === "number"
          ? ` across ${data.leagueCount} leagues`
          : "";
      const stats =
        typeof data.statsMatched === "number" && data.statsMatched > 0
          ? ` · ${data.statsMatched} with form/H2H stats`
          : "";
      setStatus(
        `Scan complete — ${data.pickCount} qualified picks from ${data.matchCount} matches${leagues}${stats}. Cached until next calendar day.`
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
      setStatus(`Settled ${data.settled} (skipped ${data.skipped ?? 0}).`);
      await loadList(tab, page);
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  const filterInputClass =
    "w-full bg-surfaceRaised border border-border rounded-lg px-3 py-2.5 text-sm min-h-[44px] focus:outline-none focus:border-accent/60";

  return (
    <main className="relative min-h-screen">
      <div className="page-glow pointer-events-none absolute inset-x-0 top-0 h-[28rem]" />
      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-8 sm:gap-10">
        <header className="hero-enter flex flex-col gap-4">
          <span className="text-[11px] uppercase tracking-[0.2em] text-muted font-mono">
            Football · Basketball · Tennis
          </span>
          <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight">
            Daily Picks
          </h1>
          <p className="text-muted max-w-2xl text-sm sm:text-[15px] leading-relaxed">
            Once-daily research scan: form, H2H, injuries/context when available,
            market consensus, and risk-rated picks. Builds six accumulators
            (~2x→~1000x) from Step-1 picks only. Missing data is marked
            unavailable — never invented. Force re-scan only when you explicitly
            choose it.
          </p>

          <div className="sticky top-0 z-20 -mx-4 sm:mx-0 px-4 sm:px-0 py-3 sm:py-0 sm:static bg-bg/85 sm:bg-transparent backdrop-blur-md sm:backdrop-blur-none border-b border-border/60 sm:border-0">
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <button
                onClick={() => runAnalysis(false)}
                disabled={loading || scanLocked}
                className="w-full sm:w-auto font-medium px-5 py-3 sm:py-2.5 rounded-lg bg-accent text-bg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
              >
                {loading
                  ? "Running research scan..."
                  : scanLocked
                    ? "Cached for today"
                    : "Run today's analysis"}
              </button>
              {scanLocked && (
                <button
                  onClick={() => runAnalysis(true)}
                  disabled={loading}
                  className="w-full sm:w-auto px-4 py-3 sm:py-2.5 rounded-lg border border-warn/50 text-sm text-warn hover:bg-warn/10 transition-colors min-h-[44px] disabled:opacity-50"
                >
                  Force re-scan
                </button>
              )}
              <button
                onClick={settleNow}
                className="w-full sm:w-auto px-4 py-3 sm:py-2.5 rounded-lg border border-border text-sm text-muted hover:text-text hover:border-accent transition-colors min-h-[44px]"
              >
                Settle now
              </button>
            </div>
          </div>

          {error && (
            <div className="text-danger text-sm rounded-lg border border-danger/30 bg-danger/5 px-3 py-2">
              {error}
            </div>
          )}
          {status && (
            <div className="text-muted text-sm font-mono">{status}</div>
          )}
          <div className="text-xs text-muted font-mono leading-relaxed">
            One scan per calendar day · auto-settle every 5m
            {lastSettleAt
              ? ` · last settle ${new Date(lastSettleAt).toLocaleTimeString()}`
              : ""}
            {scanLocked && nextUnlockAt
              ? ` · next free scan ${new Date(nextUnlockAt).toLocaleString()}`
              : ""}
          </div>
        </header>

        {latest && (
          <>
            <div className="text-xs sm:text-sm text-muted font-mono">
              Latest run {latest.runId.slice(0, 8)} · {latest.matchCount} matches
              · {new Date(latest.createdAt).toLocaleString()}
            </div>

            <section className="flex flex-col gap-4 sm:gap-5">
              <h2 className="font-display text-lg sm:text-xl font-bold">
                Accumulators
                <span className="block sm:inline font-body text-sm font-normal text-muted sm:ml-2">
                  ~2x · ~5x · ~10x · ~50x · ~100x · ~1000x
                </span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                {latest.combinations.map((combo) => (
                  <ComboCard key={combo.tier} combo={combo} />
                ))}
              </div>
            </section>
          </>
        )}

        <section className="flex flex-col gap-4">
          <div className="flex gap-1 p-1 rounded-xl bg-surfaceRaised/50 border border-border w-full sm:w-fit">
            <button
              type="button"
              onClick={() => switchTab("picks")}
              className={`flex-1 sm:flex-none px-4 py-2.5 text-sm font-medium rounded-lg min-h-[44px] transition-colors ${
                tab === "picks"
                  ? "bg-surface text-text shadow-sm"
                  : "text-muted hover:text-text"
              }`}
            >
              Picks
            </button>
            <button
              type="button"
              onClick={() => switchTab("results")}
              className={`flex-1 sm:flex-none px-4 py-2.5 text-sm font-medium rounded-lg min-h-[44px] transition-colors ${
                tab === "results"
                  ? "bg-surface text-text shadow-sm"
                  : "text-muted hover:text-text"
              }`}
            >
              Results
            </button>
          </div>

          {tab === "picks" && latest && (
            <p className="text-xs text-muted leading-relaxed">
              Pending picks from the latest run — they remain until the next
              analysis (finished ones move to Results with scores).
            </p>
          )}

          {tab === "results" && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
              <label className="flex flex-col gap-1.5 col-span-1">
                <span className="text-[11px] uppercase tracking-wide text-muted">
                  Outcome
                </span>
                <select
                  className={filterInputClass}
                  value={filterOutcome}
                  onChange={(e) => setFilterOutcome(e.target.value)}
                >
                  <option value="all">All</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                  <option value="void">Void</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-muted">
                  Sport
                </span>
                <select
                  className={filterInputClass}
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
              <label className="flex flex-col gap-1.5 col-span-2 sm:col-span-1">
                <span className="text-[11px] uppercase tracking-wide text-muted">
                  League
                </span>
                <select
                  className={filterInputClass}
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
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-muted">
                  From
                </span>
                <input
                  type="date"
                  className={filterInputClass}
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-muted">
                  To
                </span>
                <input
                  type="date"
                  className={filterInputClass}
                  value={filterTo}
                  onChange={(e) => setFilterTo(e.target.value)}
                />
              </label>
              <div className="col-span-2 sm:col-span-3 lg:col-span-1 flex gap-2 items-end">
                <button
                  type="button"
                  onClick={applyResultFilters}
                  className="flex-1 px-3 py-2.5 rounded-lg bg-accent text-bg text-sm font-medium min-h-[44px]"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={clearResultFilters}
                  className="flex-1 px-3 py-2.5 rounded-lg border border-border text-muted text-sm hover:text-text min-h-[44px]"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col divide-y divide-border rounded-xl border border-border overflow-hidden bg-surface/40">
            {!list || list.items.length === 0 ? (
              <div className="px-4 py-10 text-sm text-muted text-center">
                {tab === "picks"
                  ? "No pending picks. Run today's analysis to populate."
                  : "No settled results yet. They appear after games finish and settle."}
              </div>
            ) : (
              list.items.map((p) => (
                <PickRow key={p.id} pick={p} tab={tab} />
              ))
            )}
          </div>

          {list && list.totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 text-sm">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => goPage(page - 1)}
                className="px-4 py-2.5 rounded-lg border border-border text-muted hover:text-text disabled:opacity-40 min-h-[44px]"
              >
                Prev
              </button>
              <span className="font-mono text-muted text-xs sm:text-sm text-center">
                Page {list.page} of {list.totalPages} · {list.total}
              </span>
              <button
                type="button"
                disabled={page >= list.totalPages}
                onClick={() => goPage(page + 1)}
                className="px-4 py-2.5 rounded-lg border border-border text-muted hover:text-text disabled:opacity-40 min-h-[44px]"
              >
                Next
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

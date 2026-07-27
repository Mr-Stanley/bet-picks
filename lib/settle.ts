/** Settle pick results from final scores (h2h, totals, spreads). Stake = 1 unit. */

export type ScoreRow = { name: string; score: string };

export type SettlePick = {
  id: string;
  market: string;
  pick_selection: string;
  point: number | null;
  home_team: string;
  away_team: string;
  best_price: number;
};

export type SettleResult = {
  result: "won" | "lost" | "void";
  profit: number;
};

export type ParsedScores = { home: number; away: number };

/** Parse Odds API score rows into home/away numerics for a fixture. */
export function parseMatchScores(
  scores: ScoreRow[] | null | undefined,
  home: string,
  away: string
): ParsedScores | null {
  if (!scores) return null;
  const homeScore = scores.find((s) => s.name === home);
  const awayScore = scores.find((s) => s.name === away);
  if (!homeScore || !awayScore) return null;
  const homeNum = Number(homeScore.score);
  const awayNum = Number(awayScore.score);
  if (Number.isNaN(homeNum) || Number.isNaN(awayNum)) return null;
  return { home: homeNum, away: awayNum };
}

function scoresMap(
  scores: ScoreRow[] | null | undefined,
  home: string,
  away: string
) {
  return parseMatchScores(scores, home, away);
}

function pnl(won: boolean, bestPrice: number): SettleResult {
  if (won) {
    return {
      result: "won",
      profit: Math.round((bestPrice - 1) * 100) / 100,
    };
  }
  return { result: "lost", profit: -1 };
}

function pointFromSelection(
  selection: string,
  fallback: number | null
): number | null {
  if (fallback !== null && fallback !== undefined) return fallback;
  const m = selection.match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  return m ? Number(m[1]) : null;
}

export function settlePick(
  pick: SettlePick,
  scores: ScoreRow[] | null | undefined
): SettleResult | null {
  const s = scoresMap(scores, pick.home_team, pick.away_team);
  if (!s || Number.isNaN(s.home) || Number.isNaN(s.away)) return null;

  const market = pick.market;
  const selection = pick.pick_selection;
  const point = pointFromSelection(selection, pick.point);
  const price = Number(pick.best_price);

  if (market === "h2h") {
    if (selection.toLowerCase() === "draw") {
      return pnl(s.home === s.away, price);
    }
    if (selection === pick.home_team) return pnl(s.home > s.away, price);
    if (selection === pick.away_team) return pnl(s.away > s.home, price);
    return null;
  }

  if (market === "totals" || market.startsWith("totals")) {
    if (point === null) return null;
    const total = s.home + s.away;
    const isOver = selection.toLowerCase().includes("over");
    const isUnder = selection.toLowerCase().includes("under");
    if (total === point) return { result: "void", profit: 0 };
    if (isOver) return pnl(total > point, price);
    if (isUnder) return pnl(total < point, price);
    return null;
  }

  if (market === "spreads" || market.startsWith("spreads")) {
    if (point === null) return null;
    const isHome = selection.startsWith(pick.home_team);
    const isAway = selection.startsWith(pick.away_team);
    if (!isHome && !isAway) return null;
    if (isHome) {
      const margin = s.home + point - s.away;
      if (margin === 0) return { result: "void", profit: 0 };
      return pnl(margin > 0, price);
    }
    const margin = s.away + point - s.home;
    if (margin === 0) return { result: "void", profit: 0 };
    return pnl(margin > 0, price);
  }

  return null;
}

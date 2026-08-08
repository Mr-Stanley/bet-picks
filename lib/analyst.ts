// Per-match research reports: form / H2H / injuries / context / market / risk.
// Never invent data — use "unavailable" when a source is missing.

import { MatchStats } from "./statsApi";
import { eventKey, ScoredPick } from "./scoring";

export type RiskLevel = "Low" | "Medium" | "High";

export type MatchReport = {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  sport: string;
  commenceTime: string;
  form: string;
  h2h: string;
  injuries: string;
  context: string;
  weather: string;
  referee: string;
  lineMovement: string;
  marketNotes: string;
  assessedProb: number | null;
  impliedProb: number | null;
  valueFlag: boolean;
  risk: RiskLevel | null;
  confidence: number | null; // 1–10
  justification: string;
  whatCouldGoWrong: string;
  pickSelection: string | null;
  pickMarket: string | null;
  pickOdds: number | null;
  noPickReason: string | null;
  /** Underlying scored pick when a pick is issued (for accumulators). */
  scoredPick: ScoredPick | null;
};

const MIN_CONFIDENCE = 6;
const UNAVAILABLE = "unavailable";

function isSoccer(sport: string): boolean {
  return sport.startsWith("soccer_");
}

function formText(stats: MatchStats | undefined, soccer: boolean): string {
  if (!soccer) {
    return `${UNAVAILABLE} (form detail requires soccer stats feed)`;
  }
  if (!stats) return UNAVAILABLE;
  return `Last-5 pts home ${stats.homeFormPts}/15, away ${stats.awayFormPts}/15; goals for avg ${stats.homeGoalsForAvg.toFixed(1)} / ${stats.awayGoalsForAvg.toFixed(1)}; hint: ${stats.hint}`;
}

function h2hText(stats: MatchStats | undefined, soccer: boolean): string {
  if (!soccer) return `${UNAVAILABLE} (H2H requires soccer stats feed)`;
  if (!stats) return UNAVAILABLE;
  if (stats.h2hPlayed === 0) return "no recent H2H meetings in feed";
  return `Last ${stats.h2hPlayed}: home ${stats.h2hHomeWins} · draw ${stats.h2hDraws} · away ${stats.h2hAwayWins}`;
}

function riskFromConfidence(c: number): RiskLevel {
  if (c >= 8) return "Low";
  if (c >= 6) return "Medium";
  return "High";
}

/**
 * Build one MatchReport per unique event from best-ranked scored picks + stats.
 * Only issues a pick when confidence ≥ 6 and odds consensus exists.
 */
export function buildMatchReports(
  bestPerEvent: ScoredPick[],
  statsByEvent: Map<string, MatchStats>
): MatchReport[] {
  return bestPerEvent.map((pick) => {
    const soccer = isSoccer(pick.sport);
    const stats = statsByEvent.get(pick.eventId);
    const form = formText(stats, soccer);
    const h2h = h2hText(stats, soccer);
    const injuries = UNAVAILABLE; // no reliable free source wired yet
    const context = UNAVAILABLE;
    const weather = UNAVAILABLE;
    const referee = UNAVAILABLE;
    const lineMovement = UNAVAILABLE;

    const impliedProb = pick.impliedProb;
    // Map rankScore 0–100 → assessed probability nudged toward favorite strength
    const assessedProb = Math.min(
      0.92,
      Math.max(0.08, (pick.rankScore / 100) * 0.55 + impliedProb * 0.45)
    );
    const valueFlag = assessedProb > impliedProb + 0.04;

    const hasFormOrH2h =
      (form !== UNAVAILABLE && !form.startsWith(UNAVAILABLE)) ||
      (h2h !== UNAVAILABLE &&
        !h2h.startsWith(UNAVAILABLE) &&
        h2h !== "no recent H2H meetings in feed");
    const hasConsensus = pick.numBooks >= 2 && pick.confidenceScore >= 25;

    // Confidence 1–10 from rankScore
    let confidence = Math.round(pick.rankScore / 10);
    confidence = Math.max(1, Math.min(10, confidence));
    if (!hasConsensus) confidence = Math.min(confidence, 4);
    if (soccer && !stats) confidence = Math.min(confidence, 5);

    const enoughData = hasConsensus && (hasFormOrH2h || !soccer || confidence >= 7);

    let pickSelection: string | null = null;
    let pickMarket: string | null = null;
    let pickOdds: number | null = null;
    let scoredPick: ScoredPick | null = null;
    let noPickReason: string | null = null;
    let risk: RiskLevel | null = null;
    let justification = "";
    let whatCouldGoWrong = "";

    if (!enoughData || confidence < MIN_CONFIDENCE) {
      noPickReason = "no pick — insufficient data";
      justification =
        "Data too thin for a supported selection (need book consensus and, for soccer, form/H2H when available).";
      whatCouldGoWrong = "Issuing a pick here would be guessing.";
    } else {
      pickSelection = pick.selection;
      pickMarket = pick.market;
      pickOdds = pick.bestPrice;
      scoredPick = pick;
      risk = riskFromConfidence(confidence);
      justification = [
        `Consensus ${pick.confidenceScore}/100 across ${pick.numBooks} books @ ${pick.bestPrice.toFixed(2)}.`,
        `Rank ${pick.rankScore}/100; assessed ~${(assessedProb * 100).toFixed(0)}% vs implied ${(impliedProb * 100).toFixed(0)}%.`,
        valueFlag ? "Assessed probability above odds (value flag)." : "No clear value edge vs books.",
        stats?.hint ? `Stats: ${stats.hint}.` : soccer ? "Soccer stats unmatched." : "Non-soccer: odds-led.",
      ].join(" ");
      whatCouldGoWrong = [
        "Late lineup/injury news not in feed.",
        "Variance in a single match outcome.",
        pick.category === "draw" ? "Draws are inherently volatile." : null,
        pick.bestPrice >= 2.5 ? "Longer price — higher upset risk." : null,
      ]
        .filter(Boolean)
        .join(" ");
    }

    const marketNotes = [
      `Best price ${pick.bestPrice.toFixed(2)} (${pick.book}), ${pick.numBooks} books.`,
      lineMovement === UNAVAILABLE ? "Line movement: unavailable." : "",
    ]
      .filter(Boolean)
      .join(" ");

    return {
      eventId: pick.eventId,
      homeTeam: pick.homeTeam,
      awayTeam: pick.awayTeam,
      league: pick.league,
      sport: pick.sport,
      commenceTime: pick.commenceTime,
      form,
      h2h,
      injuries,
      context,
      weather,
      referee,
      lineMovement,
      marketNotes,
      assessedProb,
      impliedProb,
      valueFlag,
      risk,
      confidence: enoughData && confidence >= MIN_CONFIDENCE ? confidence : confidence,
      justification,
      whatCouldGoWrong,
      pickSelection,
      pickMarket,
      pickOdds,
      noPickReason,
      scoredPick,
    };
  });
}

/** Qualified Step-1 picks only (for accumulators). */
export function qualifiedPicksFromReports(reports: MatchReport[]): ScoredPick[] {
  return reports
    .filter((r) => r.scoredPick && !r.noPickReason)
    .map((r) => r.scoredPick!)
    .sort((a, b) => {
      const ac = a.rankScore ?? a.confidenceScore;
      const bc = b.rankScore ?? b.confidenceScore;
      return bc - ac;
    });
}

export function reportKey(r: MatchReport): string {
  return eventKey({
    eventId: r.eventId,
    homeTeam: r.homeTeam,
    awayTeam: r.awayTeam,
    commenceTime: r.commenceTime,
  });
}

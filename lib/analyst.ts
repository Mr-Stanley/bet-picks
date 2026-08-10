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

/** Plan threshold: pick only if confidence ≥ 6/10 with enough core data. */
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
 *
 * Pick rules (plan):
 * - confidence ≥ 6/10
 * - core data: odds consensus (≥2 books), optionally enriched by form/H2H
 * - missing form/H2H/injuries/context/weather/referee/line moves → "unavailable"
 * - never invent data
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
    const injuries = stats?.injuriesSummary ?? UNAVAILABLE;
    const context = stats?.contextSummary ?? UNAVAILABLE;
    const weather = UNAVAILABLE;
    const referee = UNAVAILABLE;
    const lineMovement = UNAVAILABLE;

    const impliedProb = pick.impliedProb;
    const assessedProb = Math.min(
      0.92,
      Math.max(0.08, (pick.rankScore / 100) * 0.55 + impliedProb * 0.45)
    );
    const valueFlag = assessedProb > impliedProb + 0.04;

    const hasConsensus = pick.numBooks >= 2 && pick.bestPrice > 1;

    // Confidence 1–10 from rankScore + favorite strength
    let confidence = Math.round(pick.rankScore / 10);
    if (pick.bestPrice <= 1.55) confidence += 2;
    else if (pick.bestPrice <= 1.85) confidence += 1;
    else if (pick.bestPrice >= 3.0) confidence -= 1;

    if (stats) {
      // Form/H2H edge boosts confidence when available
      const formEdge = Math.abs(stats.homeFormPts - stats.awayFormPts);
      if (formEdge >= 6) confidence += 1;
      if (stats.h2hPlayed >= 3) confidence += 1;
    } else if (soccer) {
      // Soft penalty only — still allow odds-led picks
      confidence -= 1;
    }

    confidence = Math.max(1, Math.min(10, confidence));
    if (!hasConsensus) confidence = Math.min(confidence, 3);

    // Plan: odds + consensus is enough core data; form/H2H optional
    const enoughData = hasConsensus;

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
      justification = !hasConsensus
        ? "Fewer than 2 books quoting this market — cannot form a consensus pick."
        : `Confidence ${confidence}/10 below threshold (${MIN_CONFIDENCE}) after ranking odds${soccer && !stats ? " (soccer stats unmatched/unavailable)" : ""}.`;
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
        stats?.hint
          ? `Stats: ${stats.hint}.`
          : soccer
            ? "Soccer form/H2H: unavailable (odds-led pick)."
            : "Non-soccer: odds-led.",
      ].join(" ");
      whatCouldGoWrong = [
        "Late lineup/injury news not in feed.",
        "Variance in a single match outcome.",
        !stats && soccer ? "No form/H2H verification for this fixture." : null,
        pick.category === "draw" ? "Draws are inherently volatile." : null,
        pick.bestPrice >= 2.5 ? "Longer price — higher upset risk." : null,
      ]
        .filter(Boolean)
        .join(" ");
    }

    const marketNotes = [
      `Best price ${pick.bestPrice.toFixed(2)} (${pick.book}), ${pick.numBooks} books.`,
      "Line movement: unavailable.",
    ].join(" ");

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
      confidence,
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
